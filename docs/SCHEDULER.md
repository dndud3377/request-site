# SCHEDULER — 외부 DB 동기화 스케줄러

APScheduler 기반 백그라운드 동기화 작업 문서. 관련 코드: `backend/api/scheduler.py`, `backend/api/utils.py`.

## 등록 잡

| 잡 ID | 주기 | 함수 | 설명 |
|-------|------|------|------|
| `sync_rtdb_options` | **10분** | `sync_rtdb_options()` | 공정-품목 / 품목-공정ID / 스텝 (RTDB MAIN + DCQ fallback) 동기화 |
| `sync_form_options` | 1시간 | `sync_form_options()` | 바코드-품목 / MAP 이름 (DCQ) 동기화 |
| `sync_holidays` | 매일 02:00 | `sync_holidays()` | 공휴일 동기화 |
| `process_mail_queue` | 1분 | `process_mail_queue()` | 결재 알림 메일 큐 발송 |

> 앱 기동 시 `sync_rtdb_options` / `sync_form_options` / `sync_holidays` 는 각각 스레드로 1회 즉시 실행된다.
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
