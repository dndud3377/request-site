# LOGGING — 운영 로그 30일 보관

> 2026-11-28 추가. **운영에만 적용**(사용자 결정). 개발(10011)과 자동 테스트는 이전과 같다(콘솔 로그만).

## 0. 목적

- **오래된 의뢰서의 오류 추적**: 의뢰서에서 문제가 발견됐을 때 그 시점의 서버 로그를 찾아본다.
- **데이터가 사라졌을 때 경위 확인**: 누가 언제 어떤 쓰기 요청을 보냈는지 찾는다.

이전에는 운영 로그가 컨테이너 표준 출력(`docker logs`)에만 있었다. 그래서 컨테이너를 다시 만들 때
(이미지 재빌드 배포) 함께 지워졌다. 이제는 호스트 폴더 `./logs` 에 날짜별 파일로 남고 **30일 보관**된다.

DB 백업은 이 작업의 범위가 아니다(2026-11-28 사용자 결정 — 지금은 하지 않음).

## 1. 무엇이 어디에 남나

운영 서버의 프로젝트 폴더(`docker-compose.yml` 이 있는 곳) 기준:

| 파일 | 내용 | 기록 주체 |
|---|---|---|
| `logs/app-YYYY-MM-DD.log` | Django 애플리케이션 로그(INFO 이상). 결재·철회·삭제·동기화·메일 로그, 500 에러 traceback(`django.request`) | backend(gunicorn 워커 2개) + scheduler |
| `logs/request-YYYY-MM-DD.log` | **쓰기 요청 기록**: POST/PUT/PATCH/DELETE 1건당 1줄 | backend |
| `logs/nginx/access-YYYY-MM-DD.log` | nginx 접근 로그(모든 요청, 응답시간 `rt=` 포함) | nginx |

- **보관**: 매일 03:10 scheduler 잡 `delete_old_log_files` 가 파일 이름의 날짜가 30일보다 오래된 파일을 지운다
  (`docs/SCHEDULER.md` 등록 잡 표). 오늘 포함 31개 날짜 파일이 남는다.
- **콘솔 출력은 그대로**: `docker logs request_backend` 등은 이전과 같이 볼 수 있다(재배포 시 사라지는 것도 같다).
- **요청 본문은 남기지 않는다**: 무엇을 바꿨는지(필드 값)는 로그에 없다. 반려·철회 시점의 문서 내용은
  DB 의 `RejectionSnapshot`·`WithdrawSnapshot` 에 있다(`docs/HISTORY.md`).

### 1.1 줄 형식

`app-*.log`, `request-*.log` (formatter `file`):
```
2026-11-28 15:25:47,182 INFO [1848] api.request_log hong POST /api/documents/1234/submit/ 200 87ms
└─ 시각(KST) ─────────┘ 레벨 [PID] 로거 이름     └ 내용 ──────────────────────────────────────┘
```
- 요청 기록 내용은 `<loginid> <METHOD> <경로?쿼리> <응답코드> <처리ms>ms` 형식이다. 로그인하지 않은 요청은 loginid 가 `-` 다.
- loginid 는 응답이 끝난 뒤 읽는다. DRF 가 JWT·세션 인증한 사용자를 원래 요청에도 넣어 주기 때문이다.
- `[PID]` 로 gunicorn 워커와 scheduler 프로세스를 구분한다.

`nginx/access-*.log` (log_format `archive` = 기존 `main` + `rt=<초>`):
```
10.1.2.3 - - [28/Nov/2026:06:24:36 +0000] "POST /api/documents/ HTTP/1.1" 201 512 "-" "Mozilla/5.0 ..." rt=0.087
```

### 1.2 시각 기준 (주의)

| 로그 | 시각·파일 날짜 기준 |
|---|---|
| `app`·`request` | **KST** — backend 이미지가 `TZ=Asia/Seoul`(`backend/Dockerfile`) |
| `nginx/access` | **UTC**(`+0000`) — nginx 컨테이너에 TZ 설정이 없다. 파일 날짜도 UTC 라 KST 09:00 에 다음 날 파일로 넘어간다 |

## 2. 찾는 방법 (운영 서버에서)

```bash
cd <프로젝트 폴더>

# 의뢰서 1234 에 대한 모든 쓰기 요청(누가·언제·결과)
grep -h "/api/documents/1234/" logs/request-*.log

# 특정 사용자의 쓰기 요청
grep -h " api.request_log hong " logs/request-*.log

# 삭제 요청만 (철회 확정·삭제 기능·DELETE)
grep -hE " DELETE | POST /api/documents/[0-9]+/(delete|withdraw|confirm-withdraw)/" logs/request-*.log

# 에러·경고와 traceback
grep -h -A 30 " ERROR " logs/app-*.log
grep -h "\[DELETE_STALE_DRAFT\]\|\[WITHDRAW_DOCUMENT\]" logs/app-*.log

# 5xx 응답 / 느린 요청(2초 이상) — nginx
awk '$9 >= 500' logs/nginx/access-*.log
grep -hE "rt=([2-9]|[0-9]{2,})\." logs/nginx/access-*.log
```

## 3. 구현

| 위치 | 내용 |
|---|---|
| `backend/api/logging_utils.py` | `DailyFileHandler`, `RequestLogMiddleware`, `delete_old_log_files()`, `LOG_RETENTION_DAYS = 30` |
| `backend/config/settings/base.py` (LOGGING 아래) | `LOG_DIR` 환경변수가 있을 때만 파일 핸들러 `app_file`·`request_file` 과 미들웨어를 붙인다 |
| `backend/api/scheduler.py` | `_add_delete_old_log_files_job()` — `start()`(운영)에서만 매일 03:10 등록 |
| `docker-compose.yml` | backend·scheduler 에 `LOG_DIR=/app/logs` + `./logs:/app/logs`, nginx 에 `./logs/nginx:/var/log/nginx-archive` |
| `nginx/nginx.conf` | `map $time_iso8601 $log_date` + `access_log /var/log/nginx-archive/access-$log_date.log archive`, `root /usr/share/nginx/html` |
| `nginx/docker-entrypoint.d/40-log-archive-dir.sh` | 기동 시 root 로 `/var/log/nginx-archive` 를 만들고 `nginx` 사용자에게 넘긴다 |

### 3.1 왜 `TimedRotatingFileHandler` 가 아닌가

같은 파일에 **여러 프로세스**가 쓴다(gunicorn 워커 2개 + scheduler 컨테이너). 표준 회전 핸들러는
자정에 프로세스마다 따로 파일 이름을 바꾸고(rename) 새로 연다. 그래서 서로의 로그를 덮어쓰거나 잃는다.
`DailyFileHandler` 는 처음부터 날짜가 들어간 이름의 파일에 이어 쓰기(append)만 한다. 날짜가 바뀌면
다음 줄부터 새 날짜 파일을 연다. 이름을 바꾸지 않으므로 프로세스끼리 충돌하지 않는다.
- 검증(2026-11-28): gunicorn `--workers 2 --threads 10` 에 동시 POST 200건을 보냈다. request 파일에
  200줄이 모두 남았고 두 워커 PID 가 모두 기록됐다.
- 한계: 한 줄이 약 8KB 를 넘는 긴 traceback 은 드물게 다른 프로세스의 줄과 섞일 수 있다(내용은 남는다).

### 3.2 nginx 가 날짜별 파일을 쓰기 위한 조건

- 경로에 변수가 있는 `access_log` 는 **워커(`nginx` 사용자)** 가 파일을 연다. 그래서 폴더에 쓰기 권한이
  필요하다. 엔트리포인트 스크립트가 해결한다(호스트 `./logs/nginx` 의 소유자가 uid 101 로 바뀐다).
- 변수 경로 `access_log` 는 기록 전에 요청의 `root` 폴더가 있는지 확인하고, 없으면 **조용히 기록을 건너뛴다**.
  기본 root(`/etc/nginx/html`)는 이미지에 없다. 그래서 `root /usr/share/nginx/html` 을 지정했다.
  모든 location 이 `proxy_pass`/`alias` 라 응답에는 영향이 없다.
- 검증(2026-11-28): `nginx:1.25-alpine` 으로 이미지를 빌드해 실행했다. root 지정 전에는 `testing "/etc/nginx/html"
  existence failed` 로 파일이 생기지 않았다. 지정 후에는 `access-2026-11-28.log` 가 생겼다. 컨테이너를 다시 만든
  뒤에도 같은 파일에 이어서 기록됐다.

## 4. 배포

1. 평소처럼 `docker compose up -d --build` 를 실행한다. `./logs`·`./logs/nginx` 가 없으면 docker 가 만든다.
2. 확인:
   ```bash
   ls -l logs logs/nginx
   tail -f logs/request-$(date +%F).log
   ```
3. `.env` 는 바꾸지 않는다. `LOG_DIR` 은 `docker-compose.yml` 의 `environment` 에 있다.
- `logs/` 의 `*.log` 는 `.gitignore`(`*.log`)로 커밋되지 않는다.

## 5. 남지 않는 것 (알려진 한계)

- **gunicorn 자체 로그**(워커 타임아웃 `WORKER TIMEOUT`, 워커 재시작 등)는 Django 로깅을 거치지 않는다.
  그래서 파일에 남지 않고 `docker logs request_backend` 에만 있다.
- MySQL 로그, 프론트엔드(브라우저) 오류.
- 쓰기 요청의 본문(무엇을 어떤 값으로 바꿨는지).
- 개발환경(10011) — 적용하지 않음(사용자 결정).

## 6. 테스트

- `api/tests.py::OperationLogFilesTest`: 날짜별 파일 전환, 핸들러 2개 동시 기록, 30일 삭제(하위 폴더·비대상 파일),
  `LOG_DIR` 없을 때 무동작, `LOG_DIR` 설정 시 app·request 파일 분리(하위 프로세스로 Django 기동), 정리 잡 등록(운영만 03:10)
- `api/tests.py::RequestLogMiddlewareTest`: 로그인 사용자 loginid·경로·응답코드 기록, 비로그인 `-`, GET 미기록
