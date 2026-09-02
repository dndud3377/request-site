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

> ℹ️ **개발 환경은 왜 DCQ/RTDB 동기화가 필요 없는가.** dev 는 `db-sync` 서비스가 재빌드마다
> `mysqldump` 로 **운영 DB 전체를 통째로** dev DB 로 복사해온다(`docker-compose.dev.yml`). 즉
> dev 의 폼 옵션·바코드·공휴일·디자인룰 데이터는 이미 최신 운영 데이터로 채워져 있으므로,
> dev 에서 스케줄러가 DCQ/RTDB 를 계속 조회해 최신화할 필요가 없다 - `SKIP_SCHEDULER=true`
> 로 무거운 동기화 잡을 꺼두는 이유다. dev 의 `scheduler` 서비스가 그럼에도 계속 떠 있는
> 이유는 **결재 알림 메일 큐(`process_mail_queue`) 재시도 안전망**을 위해서다(아래
> "동기화 실패 알림 메일" 절과 무관 - 이건 결재 알림 메일).

> ⚠️ 로컬에서 compose 없이 `runserver` 만 띄우면 스케줄러/메일이 자동 실행되지 않는다.
> 필요하면 별도 터미널에서 `python manage.py run_scheduler` 를 실행한다.

## 등록 잡

| 잡 ID | 주기 | 함수 | 설명 |
|-------|------|------|------|
| `sync_rtdb_options` | **10분** | `sync_rtdb_options()` | 라인1·3~5·`nv` 의 공정-품목 / 품목-공정ID / 스텝 (RTDB 단독) 동기화 (`nv` 는 스텝 제외). 실패 시 실패 목록을 모아 **RTDB 동기화 실패** 알림 메일 1통 발송 |
| `sync_form_options` | 1시간 | `sync_form_options()` | 바코드-품목 / MAP 이름 + **라인2 공정-품목 / 품목-공정ID** (DCQ 단독) 동기화. 실패 시 실패 목록을 모아 **DCQ 동기화 실패** 알림 메일 1통 발송 |
| `sync_holidays` | 매일 02:00 | `sync_holidays()` | 공휴일 동기화 (act_date UNIQUE → 날짜 기준 중복 제거 후 저장). 실패 시 **DCQ 동기화 실패** 알림 메일 발송 |
| `sync_design_rule` | 매일 02:00 | `sync_design_rule()` | 공정-디자인룰(DCQ `S.M`) 동기화 → `api_designrule` 전체 갱신. 실패 시 **DCQ 동기화 실패** 알림 메일 발송 |
| `process_mail_queue` | 1분 | `process_mail_queue()` | 결재 알림 메일 큐 발송 |

> `sync_rtdb_options`는 RTDB(REST API) 소스만, `sync_form_options`/`sync_holidays`/`sync_design_rule`는
> DCQ 소스만 다루므로 실패 알림도 그에 맞춰 각각 `rtdb_sync_failed`(RTDB) / `dcq_sync_failed`(DCQ)로
> 나뉜다. 두 알림 모두 수신자는 같은 `.env`의 `RTDB_SYNC_ALERT_MAIL`을 공유한다(§"동기화 실패 알림 메일" 참고).

> `scheduler` 서비스(`run_scheduler`) 기동 시 `sync_rtdb_options` / `sync_form_options` / `sync_holidays` / `sync_design_rule` 는 각각 스레드로 1회 즉시 실행된다.
> (구 `sync_process_product` 잡은 `sync_rtdb_options` 로 통합되었으며, `start()` 에서 잔여 잡을 제거한다.)

## 데이터 소스 구조 (RTDB 단독 + 재시도 + 실패 알림)

> ⚠️ **2026-08 변경**: 예전에는 RTDB(MAIN)가 실패하면 DCQ로 자동 폴백했다. 지금은 **DCQ 폴백을
> 쓰지 않는다** — 대신 RTDB 조회가 실패하거나 빈 결과면 **최대 3회까지 재시도**하고(아래 참고),
> 그래도 안 되면 그 데이터는 이번 주기에 동기화하지 않고 실패 목록에 기록만 한다. 사이클이
> 끝나면 실패 목록을 모아 **알림 메일 1통**을 큐에 적재한다(자세한 내용은 아래 "동기화 실패
> 알림 메일" 절 참고). 쓰기 방식(변경 감지 후 `DELETE(line) → INSERT`)은 그대로다 — "없는 것만
> 추가"하는 diff 병합을 한때 시도했으나, 실제로 없어진(단종 등) 데이터까지 계속 남게 되는
> 문제가 있어 되돌렸다(아래 "쓰기 전략" 절 참고).

`api_processproduct`(공정-품목)·`api_productprocessid`(품목-공정ID)·스텝(`api_teps1`/`api_steps3~5`)
동기화는 하나의 10분 잡 `sync_rtdb_options()` 에서 **RTDB 토큰을 1회만 발급**해 세 소스를 함께
처리한다. 각 RTDB 조회는 **table_name·select·filter 가 각각 다르다**(`{suffix}` 는 라인 접미사로 치환).

| 대상 테이블 | RTDB table / select / filter |
|-------------|-----------------------------------|
| `api_processproduct` | `A_{suffix}.B` / `partnumber, descript, pkgtype_2` / `X $eq "Y"` |
| `api_productprocessid` | `X_{suffix}.Y` / `partnumber, processid` / `X $neq " "` |
| `api_teps1`/`api_steps3~5` (스텝) | `O_{suffix}.W` / `processid, stepseq, descript, recipeid, areaname, eqptype, updated, layerid` / `a $eq "aaaaaa", e/l/p/r/s $neq " "` |

```
RTDB(REST API)  →  /api/queries
    └─ 성공 & 데이터 있음 → 결과 사용
    └─ 예외(None) 또는 0건 → 5초 대기 후 재조회, 최대 3회까지 반복
        └─ 3회 모두 실패 → 이번 주기 스킵 + 실패 목록에 (line, target) 기록
변경 감지: 조회 결과 == 현재 테이블(해당 line) → skip
쓰기:      다를 때만 DELETE(line) → to_sql(대상 테이블) - "쓰기 전략" 절 참고
사이클 종료: 실패 목록이 있으면 mailer.enqueue_rtdb_sync_failed() 로 알림 메일 1통 적재
```

- **재시도**(2026-08 추가): `RTDB_FETCH_MAX_RETRIES`(3회)/`RTDB_FETCH_RETRY_DELAY_SEC`(5초) 상수로
  관리한다(`scheduler.py`). `get_data_from_rtdb()`는 예외도 내부에서 잡아 `None`으로 통일해 반환하므로,
  스케줄러 쪽에서는 "결과가 `None`이거나 0건"이라는 단일 조건으로 예외·빈 결과를 함께 재시도 대상으로
  다룬다. 재시도는 이미 받아온 RTDB 토큰을 그대로 재사용하며 다시 로그인하지 않는다.
- **스텝 조회 전 대기**(2026-08 추가): 라인별 스텝(col_step) 조회 직전에 `RTDB_STEP_PRE_FETCH_DELAY_SEC`
  (3초) 대기한다 - RTDB 쪽 데이터 갱신이 조회 시점에 아직 안 끝나 있는 경우를 대비한다. 재시도와
  달리 **실패 여부와 무관하게 매번** 스텝 조회 전에 한 번 대기한다.
- **스텝은 `STEP_TABLE_MAP` 에 등록된 라인만** 동기화한다. 등록되지 않은 라인(`nv`)은 **RTDB 조회 자체를 건너뛴다**
  (스텝 테이블이 없는 라인이라 애초에 실패로 볼 대상이 아니므로 실패 목록에도 남기지 않고, 대기도 하지 않는다).
- RTDB 가 **3회 재시도 후에도 실패이거나 빈 결과(0건)** 이면 그 (line, 데이터 종류) 는 실패로 기록되고,
  해당 테이블은 이번 주기에 갱신되지 않는다(이전 값 유지).
- RTDB 토큰은 동기화 **주기당 1회** 발급하여 세 소스·라인 반복에서 재사용한다(재시도 포함).
- 나머지 동기화(바코드, MAP 이름, 공휴일, 공정-디자인룰, 라인2)는 기존 DCQ 단일 소스를 그대로 사용한다 — 이번 변경의 영향을 받지 않는다.

### MAP 이름 (`api_mapname`, DCQ 단독)

`sync_form_options()` 안에서 `X.Y` 테이블을 조회해 `api_mapname` 을 갱신한다(변경 감지 없이 매 사이클
전체 `DELETE → INSERT`). 라인 필터는 `utils.LINE_TO_LINEID_MAP` 의 `lineid` 값들로 구성한다.

| 대상 테이블 | DCQ 소스 | 조회 컬럼 |
|-------------|----------|-----------|
| `api_mapname` | `X.Y` | `lineid`, `partid`, `AAA1`, `AAA2`, `AAA3` (2026-09 추가 — `AAA1`~`AAA3` 는 실제 배포 전 이름이 확정되면 쿼리·모델 필드명을 함께 변경할 예정인 임시 컬럼명) |

`AAA1`/`AAA2`/`AAA3` 는 값이 항상 있다는 보장이 없어 `MapName` 모델에서 `null=True, blank=True` 로
저장한다(`backend/api/models.py`).

### 라인2 (DCQ 단독, 폴백 구조 아님)

라인2 는 소스 테이블 구조가 다른 라인들과 달라 **RTDB 를 지원하지 않는다.** 따라서 위 RTDB 조회
구조를 타지 않고, 1시간 잡 `sync_form_options()` 안에서 **DCQ 단독**으로 동기화한다(RTDB 실패 알림
메일 대상도 아니다).
(스텝 테이블 `api_steps2` 는 존재하지 않으므로 라인2 스텝 동기화는 없다.)

| 대상 테이블 | DCQ 소스 | 조회 컬럼 → 저장 컬럼 |
|-------------|----------|----------------------|
| `api_processproduct` | `M.L` | `product_design_rule`(폴백 시 `product_desc`) → `process`, `product_id` → `product_name` |
| `api_productprocessid` | `M.L` | `product_id` → `product_name`, `process_id` → `process_id` |

#### `product_desc` 폴백 규칙 (processproduct 전용)

`product_design_rule` 이 아래 중 하나면 **`product_desc` 값을 대신 사용**한다. SQL 의 `CASE` 결과를
`AS product_design_rule` 로 별칭 처리하므로 파이썬 쪽 rename 로직은 그대로다.

- `NULL` 이거나 `TRIM` 후 빈 문자열인 경우
- `TRIM` 후 **정확히 `-`** 인 경우
- **정수 또는 소수 형태의 숫자로만** 이루어진 경우 — 판정 정규식 `LINE2_NUMERIC_ONLY_RE`
  (`^[0-9]+([.][0-9]*)?$|^[.][0-9]+$`)

| 예시 값 | 판정 | 저장되는 `process` |
|---------|------|--------------------|
| `130` / `0.13` / `13.` / `.5` | 숫자 | `product_desc` |
| `-` / `" - "` | placeholder | `product_desc` |
| `13.5um` / `A12` / `12-3` / `-5` / `--` | 대상 아님 | `product_design_rule` |

위 판정 조건은 **`LINE2_DR_UNUSABLE` 상수 한 곳에 정의**하고 `CASE`(그대로) 와 `WHERE`(`NOT (...)` 부정형)
양쪽에서 재사용한다. 조건을 추가·변경할 때는 이 상수만 고치면 두 곳이 자동으로 같이 반영된다.

> 정규식에 `\.` 대신 **문자 클래스 `[.]`** 를 쓴다. Python 문자열 리터럴과 Impala 문자열 리터럴
> 양쪽에서 백슬래시가 이스케이프로 해석되는 문제를 피하기 위함이다. 음수 부호(`-`)는 숫자로 보지 않는다.

- `productprocessid` 쿼리는 조회 컬럼이 **NULL 이거나 빈 문자열인 행을 WHERE 에서 제외**한다.
- `processproduct` 쿼리는 폴백이 있으므로 `product_design_rule` 단독으로는 행을 제외하지 않고,
  **`product_design_rule` 과 `product_desc` 가 모두 사용 불가일 때만** 행을 제외한다.
- 저장은 다른 라인과 동일하게 `_write_if_changed()` 를 사용하므로 **변경 감지 후 `DELETE(line='라인2') → INSERT`** 로 라인2 행만 갱신한다.
- 라인2 의 `line` 컬럼 값은 `Line` 마스터·프론트엔드 표기와 동일한 **공백 없는 `'라인2'`** 이다.
  (2026-08 이전에는 `scheduler.LINES` 가 `'라인 1'` 처럼 공백이 있는 표기를 써서 서로 달랐으나,
  지금은 나머지 라인들도 전부 공백 없는 표기로 통일됐다 — 아래 주의사항 참고.)

### `nv` (RTDB 단독 구조, 스텝 없음)

`nv` 는 라인1·3~5 와 **동일한 RTDB 조회 구조**를 그대로 탄다. `scheduler.LINE_NV` 상수로 정의하고
`LINES` 에 포함시키면 `sync_rtdb_options()` 의 기존 반복이 공정-품목·품목-공정ID 를 처리한다.

| 항목 | 값 |
|------|-----|
| `line` 컬럼 값 | `'nv'` (`Line` 마스터·프론트엔드 표기와 동일) |
| RTDB 접미사 | `utils.LINE_SUFFIX_MAP['nv'] = 'lineN'` → `A_lineN.B` / `X_lineN.Y` (다른 라인과 동일 규칙) |
| 외부 DB lineid | `utils.LINE_TO_LINEID_MAP['nv']` (MAP 이름 동기화 `WHERE` 절에 자동 포함) |
| 스텝 | **없음** — `STEP_TABLE_MAP` 미등록이라 스텝 조회를 skip 한다 |
| 저장 | 다른 라인과 동일하게 `_write_if_changed()` (변경 감지 후 `DELETE(line='nv') → INSERT`) |

> (2026-08 이전) `nv` 는 DCQ fallback 소스 테이블(`N.V`/`N.V2`)만 다른 라인과 규칙이 달라
> `DCQ_PP_QUERY_OVERRIDE`/`NV_DCQ_PP_QUERY` 등으로 별도 오버라이드했다. DCQ fallback 자체가
> 폐지되며 이 상수들도 함께 제거됐다 — 지금은 RTDB 실패 시 다른 라인과 동일하게 실패 목록에
> 기록되고 알림 메일 대상이 될 뿐, `nv` 전용 분기가 없다.

- `Line` 마스터에 행이 있어야 의뢰상세 라인 드롭다운에 노출된다 → 배포 시 `python manage.py seed_lines` 실행.
- 조회 API(`form-options/processes` / `products` / `process-id`)는 `line` 파라미터를 그대로 필터에 넘기므로
  **엔드포인트 추가·수정이 없다.**
- 스텝 기반 API(`job-file-layer` / `ovl-layer` / `layer-ids` / `bb-external`)는 `views.py` 의 `model_map` 에
  `nv` 가 없으므로 **항상 빈 목록**을 반환한다(스텝 테이블이 없으므로 의도된 동작).

### 쓰기 전략 (변경 감지, `_write_if_changed`)

RTDB 소스(라인1·3~5·nv)와 DCQ 소스(라인2)가 같은 방식을 쓴다. 대상별 키 컬럼 집합을 현재
테이블 값과 비교해 **동일하면 skip, 다르면 트랜잭션 내에서 `DELETE(line) → INSERT`** 로
원자적으로 갱신한다(삭제된 행도 자동 반영) — 이 사이클에 받아온 데이터가 항상 "현재 상태의
원본"이라고 보고, DB 를 거기에 맞춘다.

| 대상 테이블 | 비교 키(key_cols) |
|-------------|-------------------|
| `api_processproduct` | `(process, product_name)` |
| `api_productprocessid` | `(product_name, process_id)` |

- **동일** → `DELETE + INSERT` 를 건너뛰고 로그만 남긴다(대부분의 사이클).
- **다름** → 트랜잭션 내에서 `DELETE(line) → INSERT` 로 원자적 갱신(삭제된 행도 자동 반영).
- **스텝(`api_teps1`/`api_steps3~5`)은 라인별 단독 테이블(공용 `line` 컬럼 없음)** 이라
  `_write_if_changed` 대상이 아니며, 매 사이클 해당 테이블 **전체 `DELETE` → `to_sql`** 로 갱신한다.

> ⚠️ **2026-08 한때 변경했다가 되돌림**: RTDB 가 간헐적으로 비정상적으로 적은 데이터를 반환하는
> 문제 대응으로, RTDB 소스 3개 테이블만 "테이블에 없는 키만 INSERT하고 기존 행은 절대 삭제하지
> 않는" diff 병합(`_write_merge_only`/`_write_step_merge_only`)으로 바꿔봤다. 하지만 이 방식은
> 원본(RTDB)에서 실제로 없어진(단종 등) 데이터까지 DB 에 계속 남아, "현재 사용 가능한 데이터만
> 써야 하고 실제로 없어진 데이터는 쓰면 안 된다"는 요구사항과 맞지 않아 다시 원래의 변경 감지
> (delete+insert) 방식으로 되돌렸다. 대신 위 "재시도"(최대 3회)로 일시적인 빈 응답 자체를 줄여서
> 같은 문제를 완화한다.

## RTDB(REST API) 유틸 (`utils.py`)

| 함수 | 설명 |
|------|------|
| `get_rtdb_credentials()` | `.env` 의 `RTDB_ID` / `RTDB_PASSWORD`(JSON pack) 읽기 |
| `get_rtdb_token()` | **스케줄러가 실제로 호출하는 진입점.** 아래 토큰 캐시/refresh 규칙에 따라 풀 로그인 또는 refresh 중 하나를 선택해 유효한 `access_token`을 반환 |
| `rtdb_login_with_retry()` | `POST /api/tokens/login`, 비밀번호 목록 순차 재시도 → `access_token`(+ 응답의 `refresh_token`을 캐시에 저장) |
| `rtdb_refresh_token(refresh_token)` | `GET /api/auth/refresh`(`Authorization: Bearer {refresh_token}`) → 갱신된 `access_token`(실패 시 `None`) |
| `get_data_from_rtdb(payload, token)` | `POST /api/queries` 조회 → DataFrame (실패/에러 시 `None`) |

### RTDB 토큰 캐시 / refresh 정책 (2026-08 추가)

`sync_rtdb_options()`는 사이클마다 `rtdb_login_with_retry()`를 직접 부르지 않고 `get_rtdb_token()`을
1회 호출해 그 사이클의 모든 조회에 재사용한다. `get_rtdb_token()`은 매번 무거운 풀 로그인을 하지
않고, 아래 규칙으로 풀 로그인과 가벼운 refresh 중 하나를 고른다.

```
캐시(_rtdb_token_cache: refresh_token, 발급시각)에 refresh_token 이 있는가?
  없음(최초 호출 / 프로세스 재시작 직후) → 풀 로그인 (POST /api/tokens/login)
  있음 → 경과시간 < (TTL 90일 − 여유 7일) = 83일 이내인가?
           예 → refresh (GET /api/auth/refresh) 시도
                  성공 → 새 access_token 반환
                  실패 → 풀 로그인으로 폴백
           아니오(발급 후 83일 이상 경과, 여유 소진) → 풀 로그인
풀 로그인 성공 시: access_token 반환 + 응답의 refresh_token 을 캐시에 저장(발급시각 갱신)
```

| 항목 | 값 | 비고 |
|------|-----|------|
| `RTDB_REFRESH_TOKEN_TTL` | `7,776,000`초(90일) | RTDB 쪽 refresh_token 유효기간 정책(고정값, 응답으로 내려오지 않음) |
| `RTDB_REFRESH_TOKEN_RENEW_MARGIN` | `604,800`초(7일) | 유효기간이 끝나기 전에 미리 풀 로그인하기 위한 여유. 즉 **발급 후 83일이 지나면** 만료(90일)를 기다리지 않고 다음 사이클에 풀 로그인으로 갱신. (2026-08 축소: 45일 → 7일 — 풀 로그인 빈도를 90일에 1번(예전 45일 마진 기준)에서 83일에 1번으로 더 줄인다) |
| access_token 유효기간 | `access_token_expires_in`(RTDB 응답, 통상 3600초=1시간) | 우리 쪽에서 만료를 직접 추적하지 않는다 — 10분 주기라 이미 충분히 여유 있고, `get_data_from_rtdb()` 조회가 401 등으로 실패하면 재시도(최대 3회) 과정에서도 계속 실패하고, 다음 주기 `get_rtdb_token()` 호출 시 새로 받는다 |

- **캐시는 프로세스 메모리에만 있다** — DB나 파일에 영속화하지 않는다. `run_scheduler` 프로세스가
  재시작되면(배포 등) 캐시가 비워지고, **재시작 후 첫 호출은 풀 로그인부터 다시 시작한다**(의도된 동작).
- refresh 요청 자체가 실패(네트워크 오류, refresh_token 무효화 등)해도 그 사이클이 통째로 실패 처리되지
  않는다 — 그 즉시 풀 로그인으로 폴백해 새 토큰을 받는다.
- 동시성: `sync_rtdb_options` 잡은 `max_instances=1`이라 사이클끼리 겹쳐 돌지 않으므로 캐시에 별도
  락을 걸지 않는다. 다만 `start()`가 기동 시 스레드로 1회 즉시 실행하는 것과 스케줄 잡이 이론상
  거의 동시에 도는 극히 드문 경우, 캐시를 각자 갱신할 수 있다(둘 다 정상 로그인 결과이므로 데이터
  정합성엔 영향 없음). (2026-08 추가) `sync_rtdb_options()` 본문 전체가 이제
  `utils.external_sync_lock()` 으로도 감싸여 있어, RTDB 동기화와 DCQ 동기화(`sync_form_options`
  등)가 서로 겹쳐 도는 것도 막힌다 — 아래 "주의사항"의 "RTDB·DCQ 동기화 상호 배제" 항목 참고.

## 동기화 실패 알림 메일 (2026-08 추가, DCQ 대상 확장)

스케줄러로 외부 데이터를 가져오는 **모든 잡**(`sync_rtdb_options`/`sync_form_options`/`sync_holidays`/
`sync_design_rule`)은 각자 한 사이클 안에서 조회가 실패(예외)했거나 빈 결과였던 (구분, 데이터 종류)
쌍을 모아, 그 사이클이 끝난 뒤 **실패가 하나라도 있으면 알림 메일 1통**을 큐에 적재한다. 소스에 따라
메일이 둘로 나뉜다 — **RTDB 실패는 RTDB 메일, DCQ 실패는 DCQ 메일**로 따로 온다. RTDB 는 실패로
집계되기 전에 이미 최대 3회 재시도(5초 간격)를 거친 뒤이므로, 이 메일은 "재시도까지 다 해봤지만
안 됐다"는 뜻이다(§"데이터 소스 구조" 참고). DCQ 잡들은 재시도를 하지 않는다(이번 변경 범위 밖).

| 소스 | 대상 잡 | `event_type` | 적재 함수 | 표 첫 컬럼 |
|------|---------|--------------|-----------|-----------|
| RTDB | `sync_rtdb_options` | `rtdb_sync_failed` | `mailer.enqueue_rtdb_sync_failed(failures)` | 라인 |
| DCQ | `sync_form_options` / `sync_holidays` / `sync_design_rule` | `dcq_sync_failed` | `mailer.enqueue_dcq_sync_failed(failures)` | 구분 |

- 구현: 각 스케줄러 함수가 실패 목록(`failures: [{'context':.., 'target':..}, ...]`)을 모아 함수
  종료 시(또는 로그인 자체가 실패해 조기 종료할 때) `scheduler._send_sync_failure_alert(mailer_func_name,
  failures)` 를 호출한다. 이 헬퍼가 RTDB/DCQ 알림을 공통으로 라우팅한다(메일 적재 자체가 실패해도
  잡을 죽이지 않도록 예외를 잡아 로그만 남긴다). 메일 발송 자체는 결재 알림과 동일한 `MailNotification`
  큐 + DXHUB 인프라를 그대로 재사용한다(`document=None`, 즉시 발송 + 실패 시 `process_mail_queue` 재시도).
  RTDB/DCQ 두 메일은 렌더링 템플릿(`mailer._render_sync_failure_email`)과 수신자 조회
  (`mailer._resolve_sync_alert_recipients`)를 공유하고, 제목·본문 헤드라인·표 컬럼명만 다르다.
- **수신자**: RTDB·DCQ 알림 **둘 다** `.env` 의 `RTDB_SYNC_ALERT_MAIL`(콤마 구분 이메일 목록)을 그대로
  쓴다 — DCQ 전용 env var 는 따로 두지 않는다. **비어 있으면 두 알림 모두 메일을 적재하지 않는다.**
- **발송 빈도**: 장애 지속 여부를 별도로 추적하지 않는다 — 장애가 이어지는 동안은 **그 잡이 도는
  주기마다 매번**(RTDB/`sync_form_options`는 자주, `sync_holidays`/`sync_design_rule`는 매일 02:00에 1번)
  그 시점의 실패 목록으로 새 메일을 보낸다(중복 억제 없음).
- **판정 기준**: 로그인 자체 실패(그 사이클이 다루는 항목 전부가 한꺼번에 실패)와, 로그인은 됐지만
  개별 조회가 예외이거나 빈 결과(0건)인 경우를 **모두 실패로 취급**한다 — RTDB 는 예전에 DCQ fallback을
  타던 조건과 동일하고, DCQ 도 같은 기준을 그대로 적용한다.
- **DCQ 쪽 항목 구성**(`context`/`target`):
  - `sync_form_options`: (`-`, 바코드-품목) / (`-`, MAP 이름) / (`라인2`, 공정-품목) / (`라인2`, 품목-공정ID) —
    DCQ 로그인 자체가 실패하면 `scheduler.FORM_OPTIONS_TARGETS` 4개 전부가 실패로 기록된다.
  - `sync_holidays`: (`-`, 공휴일) 1건
  - `sync_design_rule`: (`-`, 공정-디자인룰) 1건
  - 라인 개념이 없는 항목은 `context='-'`로 표시된다(표 "구분" 컬럼).
- **본문**: 실패한 (구분, 데이터 종류) 표. `MAIL_REDIRECT_TO` 가 설정된 개발 환경에서는 이 알림도 그
  주소로 강제 발송된다(`_apply_redirect`).
- **범위**: 스텝을 건너뛴 `nv`(스텝 테이블 없음)처럼 애초에 조회하지 않은 항목은 실패로 집계되지 않는다.
  라인2 는 `sync_form_options`(DCQ) 소속이라 DCQ 메일 대상이다.
- ⚠️ `sync_holidays()`는 `dcq_id, _ = get_dcq_credentials()` 에서 `gettext_lazy` 별칭 `_` 를 덮어쓰는
  기존 버그(아래 "주의사항" 참고)가 있어, 그 줄 이후의 `logger.warning/error(_("..."))` 호출이
  `TypeError` 로 깨질 수 있다. 이 버그의 영향을 덜 받도록 **알림 메일 적재 호출을 항상 그 아래의
  `_(...)` 로그 호출보다 먼저 실행**하게 해뒀다 — 로그 자체는 못 남기더라도 메일은 나갈 수 있다.

## 필요한 환경변수 (`.env`)

RTDB 소스를 사용하려면 아래 변수를 `.env` 에 추가해야 한다. **미설정 시 RTDB 로그인이 실패하며,
DCQ 로 자동 대체되지 않고 그 데이터는 동기화되지 않는다**(2026-08 변경 — 예전에는 DCQ fallback으로
동작했다). `RTDB_SYNC_ALERT_MAIL` 까지 설정해 두면 이 경우(및 DCQ 동기화 실패 시에도) 알림 메일로
인지할 수 있다.

| 변수 | 예시 | 설명 |
|------|------|------|
| `RTDB_BASE_URL` | `https://<host>.company.com` | REST API 베이스 URL |
| `RTDB_ID` | `myaccount` | AD 계정 아이디 |
| `RTDB_PASSWORD` | `["pw1","pw2","pw3"]` | 비밀번호 목록(JSON pack) 또는 단일 문자열 |
| `RTDB_SYNC_ALERT_MAIL` | `a@company.com,b@company.com` | **RTDB·DCQ 동기화 실패 알림 메일 공통 수신자**(콤마 구분). 비우면 두 알림 모두 보내지 않는다 |

## 주의사항

- REST 호출은 사내 인증서 정책에 따라 `verify=False`(SSL 검증 비활성화)로 동작한다. `utils.py` 에서 `InsecureRequestWarning` 을 억제한다.
- 요청 타임아웃은 `utils.RTDB_REQUEST_TIMEOUT`(기본 30초) 상수로 관리한다.
- ✅ **(2026-08 수정 완료, 이후 RTDB까지 확장) DCQ SDK 스레드 비안전성으로 인한 간헐적 동기화 실패.**
  DCQ Python SDK(v2.5.0, C 확장)는 전역 토큰 상태를 쓰기 때문에 스레드 비안전이다. 기존에는
  `cq_login()`(DCQ 로그인)이 전역 `sys.stdin` 을 교체하는 **로그인 구간만** `_DCQ_LOGIN_LOCK` 으로
  잠갔고, 로그인 이후의 `getTokenTime()`/`getData()` 구간은 잠금 밖에 있었다. `start()` 가
  `sync_form_options`/`sync_holidays`/`sync_design_rule`(모두 DCQ 사용) 을 daemon 스레드로 동시에
  기동하다 보니, 한 스레드가 로그인 후 `getData` 를 도는 동안 다른 스레드가 동시에 재로그인하며 SDK
  전역 토큰 상태를 덮어써 `getTokenTime()` 등에서 간헐적으로 오류가 났다. 이를 막기 위해:
  - `utils._EXTERNAL_SYNC_LOCK`(모듈 레벨 `threading.RLock`, 구 `_DCQ_LOGIN_LOCK` → `_DCQ_LOCK`)을
    로그인 구간뿐 아니라 `utils.external_sync_lock()` 컨텍스트 매니저를 통해 **DCQ 로그인부터 그
    잡의 마지막 데이터 조회까지 전체 구간**을 감싸도록 확장했다. `cq_login()` 내부에서 다시 이 락에
    들어오는 중첩 호출이 있어 `RLock` 을 쓴다.
  - `scheduler.py` 의 `sync_form_options()`/`sync_holidays()`/`sync_design_rule()` 각 함수 본문(DCQ
    로그인 ~ 마지막 `get_data_from_dcq()` 호출)을 `with external_sync_lock():` 으로 감싸, 세 잡이
    겹쳐 실행되더라도 DCQ SDK 사용 구간이 한 번에 하나씩만 실행되도록 직렬화했다.
  - `start()` 에서 이 3개 잡의 `scheduler.add_job(...)` 에도 `max_instances=1` 을 추가해(기존
    `sync_rtdb_options`/`process_mail_queue` 와 동일), 락과 별개로 APScheduler 레벨에서도 사이클
    겹침을 이중으로 방지한다.
  - `start()` 기동 시 4개 daemon 스레드를 동시에 띄우던 방식도 바꿨다 — DCQ 를 쓰는 3개 잡
    (`sync_form_options`/`sync_holidays`/`sync_design_rule`) 은 **하나의 daemon 스레드에서 순차
    실행**하고, DCQ 를 쓰지 않는 `sync_rtdb_options` 만 별도 daemon 스레드로 유지한다. 락만으로도
    겹침 실행은 막히지만, 기동 시점에 동시 시작 자체를 없애 이중으로 방어한다.
  - **(2026-08 추가) RTDB 동기화까지 같은 락으로 확장.** 락 이름을 `_DCQ_LOCK` → `_EXTERNAL_SYNC_LOCK`,
    `dcq_session_lock()` → `external_sync_lock()` 으로 바꾸고, `sync_rtdb_options()` 본문(RTDB 토큰
    발급 ~ 라인별 조회·저장 전체)도 동일한 락으로 감쌌다. 이제 DCQ 동기화와 RTDB 동기화는 서로도
    겹쳐 돌지 않는다 — 별도 daemon 스레드(DCQ 순차 스레드 / RTDB 스레드)로 기동되는 건 그대로지만,
    실제 외부 호출 구간은 이 공용 락으로 완전히 직렬화된다.
- 동기화/조회/로그인 실패 로그는 `exc_info=True` 로 남긴다. 따라서 `... 동기화 실패` / `[DCQ] 데이터 조회 실패`
  / `[RTDB] 데이터 조회 실패` 등의 로그에는 **예외 종류·메시지와 함께 전체 traceback(파일·라인·호출 스택)** 이
  같이 출력되어, 어느 파일 몇 번째 줄에서 무슨 에러가 났는지 바로 확인할 수 있다. (`scheduler.py`·`utils.py`)
- ✅ **(2026-08 수정 완료, ensure_dcq_session() 도입으로 해소) `get_dcq_credentials()` 반환값을
  `_` 로 받으면 안 되는 문제.** `scheduler.py` 는 `gettext_lazy` 를 `_` 로 import 하므로,
  `dcq_id, _ = get_dcq_credentials()` 로 쓰면 `_` 가 비밀번호 문자열로 덮여 이후 모든 `_("...")`
  호출이 `TypeError: 'str' object is not callable` 로 실패한다(`sync_holidays()`에 실제로 있던
  버그). `scheduler.py` 세 함수 모두 `utils.ensure_dcq_session()` 하나만 호출하도록 바뀌면서
  `get_dcq_credentials()` 를 scheduler.py 에서 직접 호출하는 코드 자체가 없어져 이 문제가
  구조적으로 사라졌다. `utils.py` 는 `gettext_lazy` 를 쓰지 않으므로 내부에서 `get_dcq_credentials()`
  를 호출해도 이 충돌이 없다.
- ✅ **(2026-08 수정 완료) 라인명 표기 불일치.** 예전에는 `scheduler.LINES`가 `'라인 1'`(공백
  포함)을, `utils.LINE_SUFFIX_MAP`이 `'LINE1'`(영문)을 각각 다르게 써서, `LINE_SUFFIX_MAP[line]`
  조회가 `nv`를 제외한 모든 라인에서 `KeyError`로 죽었다(스케줄러가 사실상 라인1·3·4·5를 전혀
  동기화하지 못하던 상태). `Line` 마스터 시드(`seed_lines.py`)·프론트엔드 `OPTION_LINE`과 동일한
  공백 없는 `'라인1'`~`'라인5'` 표기로 `LINES`/`STEP_TABLE_MAP`(scheduler.py)과 `LINE_SUFFIX_MAP`
  (utils.py)을 통일했다. 아무도 호출하지 않던 `utils.get_line_suffix()`(이 불일치를 우회하려던
  죽은 코드)도 함께 제거했다.
- ✅ **(2026-08 수정 완료) `bq_login` import 오류.** `scheduler.py`가 `utils.py`에 존재하지 않는
  `bq_login`을 import하고 있어(어디에도 쓰이지 않는 죽은 import) `scheduler.py` 자체가 로드조차
  안 됐다 — `run_scheduler`가 기동 즉시 죽는 상태였다. 쓰이지 않는 import를 제거해 해결했다.
- ⚠️ **(2026-08 완화책 추가, 원인 미확정) 로그인 직후 "이전 토큰" 오류로 DCQ 동기화 실패.**
  `sync_form_options` 실행 로그에서 `login()` 성공 직후(수 ms~수십 초 뒤) `getTokenTime()`/
  `getData()`가 다음과 같은 오류로 실패하는 사례가 관측됐다(운영 알림 메일 기준 4회 중 2~3회):
  ```
  Token user 'wh' has is A********, but latest token server has is B********.
  ```
  서버가 "네가 보낸 토큰(A)은 낡았고 최신은 B"라고 응답하는 형태라, 우리 로그인 직후 아주 짧은
  시간 안에 같은 계정으로 또 다른 로그인이 있었다는 뜻으로 읽힌다. `datacenterquery` 는 사내
  전용 비공개 모듈이라 이 레포에 소스가 없고, 우리 쪽 코드(`utils.py`)는 `login()`/
  `getTokenTime()`/`getData()` 어디에도 토큰을 명시적으로 주고받지 않아(전부 SDK 내부 전역
  상태에 위임) **원인이 "SDK 내부 캐시 반영 지연"인지 "동시 로그인 충돌(예: 스케줄러 프로세스
  중복 실행)"인지는 코드만으로 확정하지 못했다.** `_DCQ_LOCK`(같은 프로세스 내 직렬화, 위 항목
  참고)은 프로세스 로컬이라 프로세스가 2개면 애초에 보호되지 않는다는 점도 함께 감안해야 한다.
  - **적용한 완화책** (원인 제거가 아니라 실패율을 낮추는 안전장치임에 유의):
    - `dcq_login_with_retry()`: 로그인 성공 직후 `utils.DCQ_LOGIN_SETTLE_DELAY_SEC`(2초) 대기
      후 반환한다.
    - `get_dcq_token_info()`(`getTokenTime`): 실패 시 `utils.DCQ_TOKEN_INFO_RETRY_DELAY_SEC`
      (1초) 간격으로 `utils.DCQ_TOKEN_INFO_MAX_RETRIES`(3회)까지 재시도한다.
  - **커버 범위**: 로그인 직후 곧바로 발생하는 실패만 완화한다. 첫 쿼리는 성공했지만 이후 오래
    걸리는 DB 쓰기 도중 세션 중간에 토큰이 무효화되는 경우(관측 사례 있음)는 이 완화책으로 막지
    못한다 — 쿼리 단위 재시도는 아직 미적용.
  - **검증 방법**: `backend/api/tests.py`의 `DcqTokenSettleRetryTest` (mock 으로 `time.sleep`을
    대체해 대기/재시도 횟수만 검증, 실제 대기는 하지 않음). 실제 운영 효과는 다음 실패/성공
    사이클의 알림 메일로 확인해야 한다.
  - **진단 로깅(2026-08 추가) - 다음 재발 시 원인을 사실로 확정하기 위한 것.** DCQ 관련 로그
    (`cq_login`/`dcq_login_with_retry`/`get_dcq_token_info`/`get_data_from_dcq`, `utils.py`)
    전부에 `[DCQ][{hostname}:{PID}]` 형태의 프로세스 식별자(`utils._DCQ_PROC_TAG`, 모듈 로드
    시 1회 계산)를 남긴다. `run_scheduler.py` 기동 시에도 `스케줄러 프로세스 시작: {hostname}:
    {PID}` 를 한 줄 남긴다.
    - `docker-compose.yml` 의 `scheduler` 서비스는 `hostname` 오버라이드가 없어, 컨테이너
      인스턴스마다 hostname 이 자동으로 고유하게 부여된다(재배포로 컨테이너가 바뀌면 다름).
      따라서 실패 시각 전후 로그의 태그를 비교하면:
      - **hostname 이 다른 태그가 동시에 보임** → 컨테이너(프로세스)가 2개 이상 떠 있었다는 뜻
      - **hostname 은 같은데 PID 가 다른 태그가 동시에 보임** → 같은 컨테이너 안에서
        `run_scheduler` 가 중복 실행됐다는 뜻(예: 수동 디버그 실행이 남아있었던 경우)
      - **태그가 항상 하나뿐** → 프로세스 중복이 아니라 SDK 내부 캐시 반영 지연 쪽에 무게가
        실린다
    - 다음에 DCQ 동기화 실패 알림 메일이 오면, 그 시각 전후 로그를 이 태그 기준으로 먼저
      확인해서 원인을 확정하고, 그에 맞는 근본 조치(프로세스 중복 제거 vs SDK 문의)로 넘어간다.
  - **(2026-08 재조사) 실패 로그 재분석 결과, 애초에 두 개의 다른 문제가 섞여 있었다.**
    - `login()` 자체가 거부되는 실패(다수, 계정 자격 증명 자체가 원인)는 **DCQ 계정 비밀번호
      교체 시기가 지났는데 교체가 늦어져 발생**한 것으로 확인됐다(운영자 확인, 코드로는 검증
      불가). 비밀번호 교체 후 이 유형의 실패는 재발하지 않았다 — DCQ SDK 나 이 코드의 문제가
      아니었다.
    - 로그인 성공 후 `getTokenTime()`/`getData()` 가 실패하는 유형(위 "이전 토큰" 오류)은 위
      완화책(안정화 대기 + 재시도) 적용 후에도 남아 있고, 시간대별로 반복되는 패턴이 관측됐다
      (운영자 확인 - 같은 DCQ 계정을 쓰는 외부 프로세스는 없다고 함). 근본 원인은 여전히
      **미확정**이지만, 아래 `ensure_dcq_session()` 를 추가 완화책으로 도입했다.
- ⚠️ **(2026-08 추가 완화책, 원인 미확정) DCQ 세션 재사용 + 실패 시 재로그인.** 기존에는
  `sync_form_options`/`sync_holidays`/`sync_design_rule` 각 사이클마다 매번 `dcq_login_with_retry()`
  로 완전히 새로 로그인했다. 재로그인이 잦을수록 서버 쪽 "최신 토큰" 포인터가 자주 갱신되므로,
  로그인 빈도 자체를 줄이면 "이전 토큰" 불일치가 줄어들 것이라는 가설로 `utils.ensure_dcq_session()`
  을 도입했다:
  - 같은 프로세스 안에서 이전에 확보해둔 세션이 있으면(`utils._dcq_session_cache`) **재로그인을
    생략**하고, `get_dcq_token_info()` 로 세션이 아직 살아있는지만 확인해서 재사용한다.
  - 이 확인이 실패하면(세션이 끊어졌다고 판단) 그 자리에서 즉시 재로그인한다. 새로 로그인한
    경우에도 반환 전 `get_dcq_token_info()` 로 한 번 더 확인하고, 그마저 실패하면 재로그인을
    한 번 더 시도한다(최대 2회 로그인).
  - RTDB(`utils.get_rtdb_token()`)와 달리 DCQ SDK 는 만료 시각을 명시적으로 반환하지 않아(비공개
    SDK, `getTokenTime()` 반환 스키마 미확정) **TTL 기반 선제 갱신은 적용하지 못했다** — 대신
    "확인 실패 시에만 재로그인"하는 반응형 방식을 쓴다. `getTokenTime()` 반환값의 만료 필드가
    확인되면, RTDB 처럼 TTL 기반 선제 갱신으로 개선할 여지가 있다.
  - `scheduler.py` 의 세 함수는 이제 `dcq_login_with_retry()`/`get_dcq_credentials()`/
    `get_dcq_token_info()` 를 직접 호출하지 않고 `ensure_dcq_session()` 하나만 호출한다.
  - **검증 방법**: `backend/api/tests.py` 의 `EnsureDcqSessionTest` (세션 재사용/재검증 실패 시
    재로그인 전환/최대 2회 제한을 mock 으로 검증). 실제 운영 효과(토큰 불일치 발생률 변화)는
    다음 실패/성공 사이클의 알림 메일로 확인해야 한다.
- ⚠️ **(2026-08 추가) RTDB·DCQ 동기화 상호 배제.** 기존에는 `sync_rtdb_options()` 가 DCQ 3개 잡과
  완전히 독립된 daemon 스레드/스케줄로 돌아, RTDB 동기화와 DCQ 동기화가 동시에 실행될 수 있었다.
  `utils.external_sync_lock()`(구 `dcq_session_lock()`)을 `sync_rtdb_options()` 본문에도 적용해
  RTDB 동기화와 DCQ 동기화가 서로 겹쳐 돌지 않도록 직렬화했다(위 "DCQ SDK 스레드 비안전성" 항목
  참고). 검증: `backend/api/tests.py` 의 `ExternalSyncLockTest`.
- ✅ **(2026-09 수정 완료) `SKIP_SCHEDULER=true`(개발)인데도 DCQ/RTDB 동기화 잡이 실행되어 운영과
  충돌한 사고.** `start_mail_only()`는 `process_mail_queue`만 `add_job`하지만, `DjangoJobStore`는
  잡스토어에 연결되는 순간 **DB(`django_apscheduler_djangojob` 테이블)에 저장된 잡을 전부 그대로
  복원**한다. 이 테이블은 `db-sync`가 재빌드마다 운영 DB를 통째로 mysqldump 해오는 대상에도
  포함되어 있었으므로, 운영 스케줄러가 실시간으로 갱신 중인 잡 상태(가까운 `next_run_time`
  포함)가 그대로 dev DB로 복사됐다. 그 결과 dev의 `start_mail_only()`가 `sync_form_options`/
  `sync_rtdb_options`/`sync_holidays`/`sync_design_rule`까지 복원해 실행했고, dev가 운영과 같은
  DCQ 계정으로 거의 동시에 로그인하면서 운영의 DCQ 토큰을 무효화해 **운영 DCQ 동기화 실패**로
  이어졌다(운영·개발 재시작 시각이 우연히 겹친 사례로 재현·확정).
  - **수정 1 (근본 방어)**: `start_mail_only()`가 `BackgroundScheduler`를 만들기 **전에** 무거운
    동기화 잡 ID(`scheduler.HEAVY_SYNC_JOB_IDS` = `sync_form_options`/`sync_rtdb_options`/
    `sync_holidays`/`sync_design_rule`)에 해당하는 `django_apscheduler.models.DjangoJob` 행을
    ORM `.delete()`로 직접 지운다. `SKIP_SCHEDULER=true` 환경에서는 DB에 이 잡들이 어떤
    경로로 남아있든(과거 `start()` 실행 이력, db-sync 유입 등) 실행되지 않음을 보장한다.
    제거가 실제로 발생하면 경고 로그를 남겨 유입 흔적을 알 수 있게 했다.
    - ⚠️ **처음엔 `scheduler.remove_job(job_id)`(APScheduler API)로 구현했다가 재현 테스트로
      "아무 것도 지워지지 않는다"는 것을 확인하고 ORM 삭제로 바꿨다.** `remove_job()`은
      스케줄러 `state`가 `STOPPED`(= `scheduler.start()` 호출 전)이면 잡스토어(DB)를 건드리지
      않고 그 스케줄러 인스턴스가 이번 호출에서 `add_job`한 `_pending_jobs`만 뒤진다
      (`apscheduler/schedulers/base.py`). `scheduler.start()`를 부르기 **전에** 지워야 이후
      스케줄러 스레드가 그 잡을 집어 실행하는 걸 막을 수 있는데, DB에서 상속된 잡은
      `_pending_jobs`에 없으므로 `remove_job()`은 `JobLookupError`만 내고 조용히 무시되어
      아무 것도 지워지지 않는 상태였다(같은 패턴을 쓰는 `start()`의 기존
      `remove_job('sync_process_product')` 잔여 잡 제거 코드도 이론상 동일한 문제가 있을
      수 있으나, 그 잡은 대상 함수 자체가 더는 없어 `_get_jobs()`의 역직렬화 실패 시
      자동 제거 경로(`_reconstitute_job` 실패 → "Removing it..." 로그 후 삭제, 위 "쓰기
      전략" 관련 `jobstores.py` 코드 참고)로 결과적으로 정리되어 왔을 뿐이라 별도 이슈로
      남겨뒀다).
  - **수정 2 (유입 경로 차단)**: `docker-compose.dev.yml`의 `db-sync` `mysqldump` 명령에
    `--ignore-table=django_apscheduler_djangojob` / `--ignore-table=django_apscheduler_djangojobexecution`
    을 추가해, 애초에 운영 스케줄러의 잡 상태가 dev DB로 복사되지 않도록 했다.
    - ⚠️ **이 수정 과정에서 `db-sync`의 `command: >` 블록 자체가 (제 변경과 무관하게) 원래부터
      깨져 있던 것을 추가로 발견해 함께 고쳤다.** `command: >` (YAML 폴딩 스칼라)는 기준
      들여쓰기(`bash -c "` 줄)보다 더 깊이 들여쓴 줄들을 절대 한 줄로 접지 않고 개행을 그대로
      유지한다 — `mysqldump -h ... -p$$MYSQL_PASSWORD`와 그 아래 `--single-transaction ...`
      줄, `mysql -h ... -p$$MYSQL_PASSWORD`와 그 아래 `-e 'CREATE DATABASE...'` 줄이 전부 이
      경우였다. 그 결과 컨테이너 안에서는 `mysqldump`가 `-h`/`-u`/`-p`만 받고 이어지는 줄들은
      "명령을 찾을 수 없음"으로 각각 별도 실행되어, `mysqldump`가 DB 이름도 없이 실행되며
      "Usage" 메시지를 내고 실패했다(`set -eo pipefail`로 그 즉시 스크립트 전체 종료 →
      `depends_on: db-sync: condition: service_completed_successfully`에 걸려 `backend`/
      `scheduler`도 못 뜸). `mysql -h ... -e 'CREATE DATABASE...'` 줄도 동일한 이유로
      `-e: command not found`로 깨져 있었다(다만 이쪽은 `set -e` 적용 전이라 스크립트를
      죽이진 않고 조용히 넘어갔다).
      - **왜 지금까지 문제없어 보였나**: `docker compose up`은 서비스 설정(`command:` 등)이
        이전 실행과 동일하면 이미 `exit 0`로 끝난 기존 컨테이너를 재사용하고 재실행하지
        않는다. 이 파일은 최초 도입(2026-08-17) 이후 이번 수정 전까지 `command:`가 한 번도
        바뀐 적이 없어, 최초 1회 이후로는 실제로 재검증되지 않았을 가능성이 높다 - 이번에
        `--ignore-table` 옵션을 추가하며 `command:`가 바뀌자 docker compose 가 db-sync 를
        다시 실행했고, 그 때 원래부터 있던 이 버그가 처음으로 겉으로 드러났다.
      - **왜 `\`(백슬래시) 줄바꿈으로는 못 고치나**: 처음엔 각 줄 끝에 `\`를 붙여 bash의
        줄 연결 문법을 쓰려 했으나, docker compose 의 `command:` 문자열 파서 자체가
        `\<개행>`을 "개행 문자에 대한 이스케이프"로 소비해 백슬래시를 지워버린다(직접
        `docker compose config --format json` 으로 확인) - 그러면 bash 입장에선 그냥
        평범한 개행만 남아 줄 연결이 되지 않는다. 그래서 **깨져 있던 두 명령 각각을 물리적으로
        한 줄로 합치는 방식**으로 고쳤다(파이프 뒤 `mysql -h ... $$MYSQL_DB;` 줄은 `|`로
        끝나는 줄 뒤에 오는 정상적인 bash 파이프 연속이라 원래도 문제없어 그대로 두었다).
      - **검증(실제 실행 확인)**: `docker compose config --format json`으로 렌더링된
        실제 `bash -c` 스크립트를 mysqldump/mysql을 흉내 낸 mock 커맨드로 직접 실행해,
        수정 전엔 `mysqldump`가 `-h`/`-u`/`-p`만 받고 실패, 수정 후엔 `--single-transaction`
        /`--skip-lock-tables`/두 `--ignore-table`/DB 이름까지 전부 받아 exit 0로 끝나는 것을
        확인했다(Docker 데몬이 없는 세션이라 실제 MySQL 컨테이너로 끝까지 확인하지는
        못했다 - 위 "실제 웹/수동 검증 시나리오" 참고).
  - **검증 방법(실제 실행 확인 완료)**: `backend/api/tests.py`의
    `StartMailOnlyRemovesHeavyJobsTest`. DB에 `HEAVY_SYNC_JOB_IDS` 4개 잡 행을 직접 심어두고
    `start_mail_only()` 실행 후 (1) 그 4개가 `DjangoJob` 테이블에서 사라졌는지, (2)
    `process_mail_queue`는 정상 등록됐는지, (3) 심어둔 잡이 없어도 `process_mail_queue`는
    정상 등록되는지 확인한다. CLAUDE.md §규칙 C-1-1 sqlite 절차로 실제 실행해 2건 모두
    통과 확인(`api` 앱 전체 369건도 회귀 없이 통과).
