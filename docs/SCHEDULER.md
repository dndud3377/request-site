# SCHEDULER — 외부 DB 동기화 스케줄러

APScheduler 기반 백그라운드 동기화 작업 문서. 관련 코드: `backend/api/scheduler.py`, `backend/api/utils.py`.

## 등록 잡

| 잡 ID | 주기 | 함수 | 설명 |
|-------|------|------|------|
| `sync_process_product` | **10분** | `sync_process_product()` | 공정-품목(RTDB MAIN + DCQ fallback) 동기화 |
| `sync_form_options` | 1시간 | `sync_form_options()` | 폼 옵션(품목-공정ID/스텝/바코드/MAP) 동기화 |
| `sync_holidays` | 매일 02:00 | `sync_holidays()` | 공휴일 동기화 |
| `process_mail_queue` | 1분 | `process_mail_queue()` | 결재 알림 메일 큐 발송 |

> 앱 기동 시 `sync_process_product` / `sync_form_options` / `sync_holidays` 는 각각 스레드로 1회 즉시 실행된다.

## 데이터 소스 구조 (MAIN / FALLBACK)

`api_processproduct`(공정-품목) 동기화는 두 개의 소스를 **폴백 구조**로 사용하며, 전용 10분 잡 `sync_process_product()` 에서 실행된다.

```
① MAIN     RTDB(REST API)  →  /api/queries
                └─ 성공 & 데이터 있음 → 결과 사용
                └─ 예외(None) 또는 0건 ↓
② FALLBACK DCQ (datacenterquery)  →  기존 query_cp
                └─ 결과 사용
변경 감지: 조회 결과 == 현재 테이블(해당 line) → skip
쓰기:      다를 때만 DELETE(line) → to_sql(api_processproduct)
```

- MAIN 이 **예외로 실패하거나 빈 결과(0건)** 이면 FALLBACK(DCQ)을 실행한다.
- MAIN(RTDB) 토큰은 동기화 **주기당 1회** 발급하여 라인 반복에서 재사용한다.
- **DCQ fallback 은 RTDB 가 실패한 경우에만 지연 로그인**한다(평소에는 DCQ 를 호출하지 않음).
- 두 소스는 `partnumber, descript, pkgtype_2` 동일 컬럼을 반환하므로 이후 rename·저장 로직을 공유한다.
- 나머지 동기화(품목-공정ID, 스텝, 바코드, MAP 이름, 공휴일)는 기존 DCQ 단일 소스를 그대로 사용한다.

### 변경 감지(Change Detection) 쓰기 전략

10분 주기에서 매번 전체 삭제·재삽입하는 부하를 줄이기 위해, 라인별로 조회 결과의
`(process, product_name)` 집합을 현재 테이블 값과 비교한다.

- **동일** → `DELETE + INSERT` 를 건너뛰고 로그만 남긴다(대부분의 사이클).
- **다름** → 기존과 동일하게 트랜잭션 내에서 `DELETE(line) → INSERT` 로 원자적 갱신(삭제된 행도 자동 반영).

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
