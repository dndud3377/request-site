# SCHEDULER — 외부 DB 동기화 스케줄러

APScheduler 기반 백그라운드 동기화 작업 문서. 관련 코드: `backend/api/scheduler.py`, `backend/api/utils.py`,
`backend/api/management/commands/run_scheduler.py`, `backend/api/apps.py`.

## 실행 구조 (단일 프로세스)

스케줄러는 **전용 단일 프로세스에서만** 실행한다. gunicorn 은 다중 워커(`--workers N`)로 뜨는데,
과거에는 `apps.py` 의 `ready()` 가 워커마다 실행되어 스케줄러가 **중복 기동**되었다. 그 결과 여러
`BackgroundScheduler` 가 같은 `DjangoJobStore`(DB) 의 job 을 `replace_existing=True` 로 서로 탈취해
`job ... no longer exists` 가 반복되고 메일 큐가 이중 발송될 수 있었다.

이를 막기 위해:

- **`apps.py` 는 스케줄러를 자동 기동하지 않는다.** (gunicorn 워커·runserver 어디서도 안 뜸)
- 스케줄러는 관리 명령 **`python manage.py run_scheduler`** 로 띄우는 **`scheduler` 서비스(컨테이너 1개)** 에서만 실행한다.
  - `run_scheduler` 는 `SKIP_SCHEDULER=true` 면 `start_mail_only()`(메일만), 아니면 `start()`(전체)를 호출하고 프로세스를 유지한다.
- `docker-compose.yml`: 운영 `scheduler` 서비스(`SKIP_SCHEDULER=false`, 전체 동기화 + 메일).
- `docker-compose.dev.yml`: 개발 `scheduler` 서비스(`SKIP_SCHEDULER=true`, 메일 큐만).
- 마이그레이션/시드/정적파일 수집은 **웹 `backend` 서비스**가 담당하고, `scheduler` 서비스는 `wait_for_db` 후 스케줄러만 실행한다.

> ⚠️ 로컬에서 compose 없이 `runserver` 만 띄우면 스케줄러/메일이 자동 실행되지 않는다.
> 필요하면 별도 터미널에서 `python manage.py run_scheduler` 를 실행한다.

## 등록 잡

| 잡 ID | 주기 | 함수 | 설명 |
|-------|------|------|------|
| `sync_rtdb_options` | **10분** | `sync_rtdb_options()` | 라인1·3~5 의 공정-품목 / 품목-공정ID / 스텝 (RTDB MAIN + DCQ fallback) 동기화 |
| `sync_form_options` | 1시간 | `sync_form_options()` | 바코드-품목 / MAP 이름 + **라인2 공정-품목 / 품목-공정ID** (DCQ 단독) 동기화 |
| `sync_holidays` | 매일 02:00 | `sync_holidays()` | 공휴일 동기화 (act_date UNIQUE → 날짜 기준 중복 제거 후 저장) |
| `sync_design_rule` | 매일 02:00 | `sync_design_rule()` | 공정-디자인룰(DCQ `S.M`) 동기화 → `api_designrule` 전체 갱신 |
| `process_mail_queue` | 1분 | `process_mail_queue()` | 결재 알림 메일 큐 발송 |

> `scheduler` 서비스(`run_scheduler`) 기동 시 `sync_rtdb_options` / `sync_form_options` / `sync_holidays` / `sync_design_rule` 는 각각 스레드로 1회 즉시 실행된다.
> (구 `sync_process_product` 잡은 `sync_rtdb_options` 로 통합되었으며, `start()` 에서 잔여 잡을 제거한다.)

## 데이터 소스 구조 (MAIN / FALLBACK)

`api_processproduct`(공정-품목)·`api_productprocessid`(품목-공정ID)·스텝(`api_teps1`/`api_steps3~5`)
동기화는 두 개의 소스를 **폴백 구조**로 사용하며, 하나의 10분 잡 `sync_rtdb_options()` 에서
**RTDB 토큰을 1회만 발급**해 세 소스를 함께 처리한다. 각 RTDB 조회는 **table_name·select·filter 가
각각 다르다**(`{suffix}` 는 라인 접미사로 치환).

| 대상 테이블 | RTDB(MAIN) table / select / filter | DCQ(FALLBACK) |
|-------------|-----------------------------------|---------------|
| `api_processproduct` | `A_{suffix}.B` / `partnumber, descript, pkgtype_2` / `X $eq "Y"` | `query_cp` (`A.B_{suffix}`) |
| `api_productprocessid` | `X_{suffix}.Y` / `partnumber, processid` / `X $neq " "` | `query_pc` (`A.B_{suffix}_processproduct`) |
| `api_teps1`/`api_steps3~5` (스텝) | `O_{suffix}.W` / `processid, stepseq, descript, recipeid, areaname, eqptype, updated, layerid` / `a $eq "aaaaaa", e/l/p/r/s $neq " "` | `dcq_ps` (`A.B_{suffix}_step`) |

```
① MAIN     RTDB(REST API)  →  /api/queries
                └─ 성공 & 데이터 있음 → 결과 사용
                └─ 예외(None) 또는 0건 ↓
② FALLBACK DCQ (datacenterquery)  →  대상별 기존 쿼리
                └─ 결과 사용
변경 감지: 조회 결과 == 현재 테이블(해당 line) → skip
쓰기:      다를 때만 DELETE(line) → to_sql(대상 테이블)
```

- MAIN 이 **예외로 실패하거나 빈 결과(0건)** 이면 FALLBACK(DCQ)을 실행한다.
- MAIN(RTDB) 토큰은 동기화 **주기당 1회** 발급하여 세 소스·라인 반복에서 재사용한다.
- **DCQ fallback 은 RTDB 가 실패한 경우에만 지연 로그인**하며, 그 로그인 상태는 세 소스가 공유한다(평소에는 DCQ 를 호출하지 않음).
- 나머지 동기화(바코드, MAP 이름, 공휴일)는 기존 DCQ 단일 소스를 그대로 사용한다.

### 라인2 (DCQ 단독, 폴백 구조 아님)

라인2 는 소스 테이블 구조가 다른 라인들과 달라 **RTDB 를 지원하지 않는다.** 따라서 위 MAIN/FALLBACK
구조를 타지 않고, 1시간 잡 `sync_form_options()` 안에서 **DCQ 단독**으로 동기화한다.
(스텝 테이블 `api_steps2` 는 존재하지 않으므로 라인2 스텝 동기화는 없다.)

| 대상 테이블 | DCQ 소스 | 조회 컬럼 → 저장 컬럼 |
|-------------|----------|----------------------|
| `api_processproduct` | `M.L` | `product_design_rule`(폴백 시 `product_desc`) → `process`, `product_id` → `product_name` |
| `api_productprocessid` | `M.L` | `product_id` → `product_name`, `process_id` → `process_id` |

#### `product_desc` 폴백 규칙 (processproduct 전용)

`product_design_rule` 이 아래 중 하나면 **`product_desc` 값을 대신 사용**한다. SQL 의 `CASE` 결과를
`AS product_design_rule` 로 별칭 처리하므로 파이썬 쪽 rename 로직은 그대로다.

- `NULL` 이거나 `TRIM` 후 빈 문자열인 경우
- **정수 또는 소수 형태의 숫자로만** 이루어진 경우 — 판정 정규식 `LINE2_NUMERIC_ONLY_RE`
  (`^[0-9]+([.][0-9]*)?$|^[.][0-9]+$`)

| 예시 값 | 판정 | 저장되는 `process` |
|---------|------|--------------------|
| `130` / `0.13` / `13.` / `.5` | 숫자 | `product_desc` |
| `13.5um` / `A12` / `12-3` / `-5` | 숫자 아님 | `product_design_rule` |

> 정규식에 `\.` 대신 **문자 클래스 `[.]`** 를 쓴다. Python 문자열 리터럴과 Impala 문자열 리터럴
> 양쪽에서 백슬래시가 이스케이프로 해석되는 문제를 피하기 위함이다. 음수 부호(`-`)는 숫자로 보지 않는다.

- `productprocessid` 쿼리는 조회 컬럼이 **NULL 이거나 빈 문자열인 행을 WHERE 에서 제외**한다.
- `processproduct` 쿼리는 폴백이 있으므로 `product_design_rule` 단독으로는 행을 제외하지 않고,
  **`product_design_rule` 과 `product_desc` 가 모두 사용 불가일 때만** 행을 제외한다.
- 저장은 다른 라인과 동일하게 `_write_if_changed()` 를 사용하므로 **변경 감지 후 `DELETE(line='라인2') → INSERT`** 로 라인2 행만 갱신한다.
- 라인2 의 `line` 컬럼 값은 `Line` 마스터·프론트엔드 표기와 동일한 **공백 없는 `'라인2'`** 이다.
  (기존 라인들은 `scheduler.LINES` 에서 `'라인 1'` 처럼 공백이 있는 표기를 쓰고 있어 서로 다르다 — 아래 주의사항 참고.)

### 변경 감지(Change Detection) 쓰기 전략

10분 주기에서 매번 전체 삭제·재삽입하는 부하를 줄이기 위해, 대상별 키 컬럼 집합을 현재 테이블 값과 비교한다.
공통 로직은 `_write_if_changed(engine, table, line, df, key_cols, order_cols)` 헬퍼로 처리한다.

| 대상 테이블 | 비교 키(key_cols) |
|-------------|-------------------|
| `api_processproduct` | `(process, product_name)` |
| `api_productprocessid` | `(product_name, process_id)` |

- **동일** → `DELETE + INSERT` 를 건너뛰고 로그만 남긴다(대부분의 사이클).
- **다름** → 트랜잭션 내에서 `DELETE(line) → INSERT` 로 원자적 갱신(삭제된 행도 자동 반영).
- **스텝(`api_teps1`/`api_steps3~5`)은 라인별 단독 테이블(공용 `line` 컬럼 없음)** 이라 `_write_if_changed`
  대상이 아니며, 매 사이클 해당 테이블 **전체 `DELETE` → `to_sql`** 로 갱신한다.

## RTDB(REST API) 유틸 (`utils.py`)

| 함수 | 설명 |
|------|------|
| `get_rtdb_credentials()` | `.env` 의 `RTDB_ID` / `RTDB_PASSWORD`(JSON pack) 읽기 |
| `rtdb_login_with_retry()` | `POST /api/tokens/login`, 비밀번호 목록 순차 재시도 → `access_token` |
| `get_data_from_rtdb(payload, token)` | `POST /api/queries` 조회 → DataFrame (실패/에러 시 `None`) |

## 필요한 환경변수 (`.env`)

RTDB MAIN 소스를 사용하려면 아래 변수를 `.env` 에 추가해야 한다. **미설정 시 RTDB 로그인이 실패하고 자동으로 DCQ fallback 으로 동작한다.**

| 변수 | 예시 | 설명 |
|------|------|------|
| `RTDB_BASE_URL` | `https://<host>.company.com` | REST API 베이스 URL |
| `RTDB_ID` | `myaccount` | AD 계정 아이디 |
| `RTDB_PASSWORD` | `["pw1","pw2","pw3"]` | 비밀번호 목록(JSON pack) 또는 단일 문자열 |

## 주의사항

- REST 호출은 사내 인증서 정책에 따라 `verify=False`(SSL 검증 비활성화)로 동작한다. `utils.py` 에서 `InsecureRequestWarning` 을 억제한다.
- 요청 타임아웃은 `utils.RTDB_REQUEST_TIMEOUT`(기본 30초) 상수로 관리한다.
- `cq_login()`(DCQ 로그인)은 전역 `sys.stdin` 을 교체하는 방식이라, 기동 시 동시에 뜨는 3개 동기화 스레드가
  경쟁하면 stdin 이 엉켜 `>> Enter AD Password:` 프롬프트 추락·빈 로그인 실패가 발생한다. 이를 막기 위해
  로그인 구간을 `utils._DCQ_LOGIN_LOCK`(모듈 레벨 `threading.Lock`)으로 직렬화한다.
- 동기화/조회/로그인 실패 로그는 `exc_info=True` 로 남긴다. 따라서 `... 동기화 실패` / `[DCQ] 데이터 조회 실패`
  / `[RTDB] 데이터 조회 실패` 등의 로그에는 **예외 종류·메시지와 함께 전체 traceback(파일·라인·호출 스택)** 이
  같이 출력되어, 어느 파일 몇 번째 줄에서 무슨 에러가 났는지 바로 확인할 수 있다. (`scheduler.py`·`utils.py`)
- `get_dcq_credentials()` 의 반환값을 받을 때 **비밀번호를 `_` 로 받지 않는다.** `scheduler.py` 는
  `gettext_lazy` 를 `_` 로 import 하므로, `dcq_id, _ = get_dcq_credentials()` 로 쓰면 `_` 가 비밀번호
  문자열로 덮여 이후 모든 `_("...")` 호출이 `TypeError: 'str' object is not callable` 로 실패한다.
  반드시 `dcq_id, _pw = get_dcq_credentials()` 형태로 받는다.
- **라인명 표기가 두 가지로 섞여 있다.** `scheduler.LINES` 는 `'라인 1'`(공백 포함)을 쓰지만
  `Line` 마스터·프론트엔드·라인2 동기화는 `'라인1'`(공백 없음)을 쓴다. `api_processproduct` /
  `api_productprocessid` 의 `line` 컬럼에 두 표기가 함께 저장되므로, 조회 시 표기 불일치로
  빈 결과가 나올 수 있다.
