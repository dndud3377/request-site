# PROJECT_CONTEXT.md

이 파일은 Claude Code가 레포지토리에 없는 파일과 환경 정보를 이해하기 위한 참고 문서입니다.
실제 파일이 없더라도 이 문서를 보고 역할과 내용을 파악할 수 있도록 기술합니다.

---

## 인프라 구조

```
[클라이언트]
    ↓ 80/443
[Nginx 리버스 프록시] (nginx/)
    ├── /api/      → backend:8000  (Django)
    ├── /admin/    → backend:8000  (Django Admin)
    ├── /static/   → /var/www/static/ (Django collectstatic 결과물)
    ├── /media/    → /var/www/media/
    └── /         → frontend:80   (React 빌드 결과물)

[Backend] Django + gunicorn (port 8000)
[Frontend] nginx:alpine serving React build (port 80)
[DB] MySQL 8.0 (port 3306, 내부 네트워크만)
```

Docker Compose 서비스: `db`, `backend`, `frontend`, `nginx`

---

## 레포지토리에 없는 파일 (.gitignore 처리)

### `backend/sources.list`
- **역할**: apt-get 패키지 설치 시 사용할 사내 Debian 미러 저장소 주소 목록
- **위치**: 빌드 시 `/etc/apt/sources.list`로 복사됨 (Dockerfile `COPY ./sources.list /etc/apt/sources.list`)
- **형식**: 표준 Debian `sources.list` 형식
  ```
  deb http://<내부-debian-mirror>/debian bullseye main
  deb http://<내부-debian-mirror>/debian bullseye-updates main
  ...
  ```
- **필요 이유**: 폐쇄망 환경에서 외부 apt 저장소 접근 불가

---

### `backend/pip.conf`
- **역할**: pip 패키지 설치 시 사용할 사내 PyPI 서버 설정
- **형식**:
  ```ini
  [global]
  index-url = http://<내부-pypi>/simple
  trusted-host = <내부-pypi-host>
  ```
- **필요 이유**: 폐쇄망 환경에서 PyPI 직접 접근 불가
- **Dockerfile에서**: `ARG PIP_INDEX_URL`, `ARG PIP_TRUSTED_HOST`로 빌드 인자로 전달

---

### `.npmrc`
- **역할**: npm 패키지 설치 시 사용할 사내 npm 레지스트리 설정
- **형식**:
  ```
  registry=http://<내부-npm-registry>/
  ```
- **필요 이유**: 폐쇄망 환경에서 npmjs.org 직접 접근 불가
- **frontend Dockerfile에서**: `ARG NPM_REGISTRY_URL`로 빌드 인자로 전달 (예정)

---

### `backend/config/odbc/odbc.ini.template`
- **역할**: Cloudera Impala ODBC 연결 설정 템플릿
- **위치**: 빌드 시 `envsubst`로 환경변수 치환 후 `/usr/local/odbc/odbc.ini`로 생성
- **형식**:
  ```ini
  [ODBC Data Sources]
  ImpalaDS=Cloudera ODBC Driver for Impala 64-bit

  [ImpalaDS]
  Driver=/opt/cloudera/impalaodbc/lib/64/libclouderaimpalaodbc64.so
  Host=${ODBC_HOST}
  Port=${ODBC_PORT}
  Database=${ODBC_DATABASE}
  AuthMech=${ODBC_AUTH_MECH}
  ...
  ```
- **치환되는 환경변수**: `ODBC_HOST`, `ODBC_PORT`, `ODBC_DATABASE`, `ODBC_AUTH_MECH`, `ODBC_UID`, `ODBC_PWD` 등 (`.env.example` 참고)

---

### `backend/config/odbc/odbcinst.ini`
- **역할**: ODBC 드라이버 등록 설정
- **위치**: `/usr/local/odbc/odbcinst.ini`로 복사됨
- **형식**:
  ```ini
  [ODBC Drivers]
  Cloudera ODBC Driver for Impala 64-bit=Installed

  [Cloudera ODBC Driver for Impala 64-bit]
  Description=Cloudera ODBC Driver for Impala (64-bit)
  Driver=/opt/cloudera/impalaodbc/lib/64/libclouderaimpalaodbc64.so
  ```

---

### `.env`
- **역할**: 실제 운영/개발 환경변수 파일 (`.env.example`을 복사하여 실제 값으로 채운 것)
- **위치**: 프로젝트 루트 (`/home/user/request-site/.env`)
- **참고**: `.env.example`에 모든 키 목록과 설명이 있음

---

## 환경변수 요약 (`.env.example` 기준)

| 변수 | 설명 |
|------|------|
| `IMAGE_PATH` | 사내 컨테이너 레지스트리 prefix (예: `registry.internal/`) |
| `CONTAINER_IMAGE` | MySQL 이미지 전체 경로 |
| `CONTAINER_DB` | MySQL 컨테이너 이름 |
| `PIP_INDEX_URL` | 사내 PyPI 주소 |
| `PIP_TRUSTED_HOST` | 사내 PyPI 호스트 (SSL 없이 신뢰) |
| `BIGDATA_INDEX_URL` | 빅데이터 전용 PyPI 주소 |
| `BIGDATA_TRUSTED_HOST` | 빅데이터 PyPI 호스트 |
| `NPM_REGISTRY_URL` | 사내 npm 레지스트리 주소 |
| `VITE_USE_MOCK` | `true`면 Mock API 사용, `false`면 실 백엔드 연동 |
| `BDQ_ID` / `BDQ_PASSWORD` | 외부 빅데이터 DB 접근 계정 |
| `ODBC_*` | Cloudera Impala ODBC 연결 설정 일체 |
| `SKIP_SCHEDULER` | 설정 시 앱 시작 시 스케줄러 실행 안 함 (마이그레이션 용도) |

---

## 빌드 / 배포 흐름

```
1. .env 파일 준비 (.env.example 참고)
2. 사내 환경 전용 파일 준비:
   - backend/sources.list
   - backend/config/odbc/odbc.ini.template
   - backend/config/odbc/odbcinst.ini
3. docker-compose up --build
4. 자동 실행:
   - python manage.py migrate
   - python manage.py create_users
   - python manage.py seed_lines
   - python manage.py collectstatic
   - gunicorn 시작 (스케줄러 포함)
```

---

## Frontend API 모드

`VITE_USE_MOCK` 환경변수로 제어:
- `true`: `frontend/src/api/mock.ts` 사용 (백엔드 없이 독립 실행)
- `false`: `frontend/src/api/client.ts` 사용 (실 백엔드 연동)

현재 Mock 모드에서 실 백엔드 연동으로 전환 작업 진행 중.

---

## 사용자 역할

| 역할 | 설명 |
|------|------|
| `PL` | 의뢰서 작성 및 제출 |
| `TE_R` | AGENT R — 초기 검토 및 결재 |
| `TE_J` | AGENT J — 병렬 검토 (J-ayer 담당) |
| `TE_O` | AGENT O — 병렬 검토 (O-ayer 담당) |
| `TE_E` | AGENT E — 최종 결재 (설탕 추가 등 조건부) |
| `MASTER` | 전체 열람 및 관리 |

결재 흐름: `PL 제출 → TE_R → TE_J + TE_O (병렬) → TE_E → 승인`

---

## 백엔드 연동 현황 (VITE_USE_MOCK=false 전환 관련)

> main 브랜치에는 없지만 실제 운영 브랜치에 구현된 코드의 현황을 기록한다.
> Claude가 main 브랜치만 분석하면 "미구현"으로 오탐할 수 있으므로 이 문서를 참고할 것.

### #1 — urls.py import 대상 구현 여부

`backend/api/urls.py`에서 import 하는 모든 뷰/함수는 **구현되어 있음**.

**`backend/api/views.py`:**

| import 대상 | 상태 |
|---|---|
| `VOCViewSet` | ✅ 구현됨 |
| `LineViewSet` | ✅ 구현됨 |
| `form_options_combinations` | ✅ 구현됨 |
| `form_options_products` | ✅ 구현됨 |
| `form_options_cooking` | ✅ 구현됨 |
| `form_options_step_info` | ✅ 구현됨 |

**`backend/api/models.py`:**

| 모델 | 상태 |
|---|---|
| `VOC` | ✅ 구현됨 |
| `Line` | ✅ 구현됨 |
| `CombinationProduct` | ✅ 구현됨 |
| `ProductCooking` | ✅ 구현됨 |
| `StepInfo` | ✅ 구현됨 |

**`backend/api/serializers.py`:**

| 시리얼라이저 | 상태 |
|---|---|
| `VOCSerializer` | ✅ 구현됨 |
| `LineSerializer` | ✅ 구현됨 |

### #4 — AuthContext 인증 방식 (미결정)

현재: 앱 시작 시 `MOCK_USERS[0]` 자격증명으로 자동 로그인 시도.
→ 실제 백엔드에 해당 유저가 없으면 이후 모든 API 인증 실패.

**상태: later** — 로그인 페이지 도입 vs 유저 스위처 유지 방향 미결정. 추후 재논의.

### #5 — 외부 DB 동기화 (scheduler.py / sync_form_options_manual.py)

**상태: ✅ 구현됨** (비공개 브랜치)

- **`backend/api/scheduler.py`**: Big Data를 사용하여 폼 옵션 데이터를 1시간 주기로 자동 동기화
  - 동기화 대상: `CombinationProduct` (조합법-제품), `ProductCooking` (제품-조리법)
  - 라인 2 제외: `LINES = ['라인 1', '라인 3', '라인 4', '라인 5']`
  - APScheduler `IntervalTrigger(hours=1)` + 시작 시 즉시 1회 실행
  - 주요 함수: `bd_login()`, `login_with_retry()`, `get_data_from_bd()`, `sync_form_options()`, `start()`
  - 환경변수: `ID`, `PASSWORD` (Big Data 계정), `MYSQL_*` (Django DB)

- **`backend/api/management/commands/sync_form_options_manual.py`**: 수동 동기화 커맨드
  ```bash
  docker compose exec backend python manage.py sync_form_options_manual
  ```

### #6 — JWT 토큰 만료 처리 없음

**상태: later** — 테스트 서버 운영 중에는 실질적 문제 없음. #4(인증 방식) 결정 후 함께 처리.

**문제 내용:**
- 백엔드(SimpleJWT)는 `{ access, refresh }` 두 토큰을 발급하지만, 프론트엔드는 **access token만 저장**하고 refresh token은 버림 (`AuthContext.tsx`)
- `client.ts`에서 401 응답을 특별히 처리하지 않고 단순 `throw` → 각 페이지에서 toast 에러만 표시됨
- 자동 갱신 인터셉터 없음

**지금 문제가 안 되는 이유:**
- 현재 앱은 페이지 로드 시 / 유저 스위칭 시마다 재로그인하여 새 토큰을 받음
- 테스트 서버 사용자는 세션 중 토큰이 만료될 만큼 장시간 머물지 않음

**해결 시점:** 프로덕션 전환 전 (또는 테스트 중 401 에러가 자주 발생할 경우)

**임시 우회:** `backend/config/settings.py`의 `SIMPLE_JWT.ACCESS_TOKEN_LIFETIME`을 1~7일로 늘리는 것만으로 충분 (코드 변경 없음)

**정식 해결 (나중에):**
1. 백엔드 `urls.py`에 `/auth/refresh/` 엔드포인트 추가
2. `client.ts`에서 401 감지 시 refresh token으로 재발급 후 원래 요청 재시도
3. refresh 실패 시 로그인 페이지로 리다이렉트

### #7 — DRF 권한 AllowAny (의도적 임시 설정)

**상태: later** — 테스트 서버 운영 중 누구나 접근 가능해야 하므로 의도적으로 설정. 프로덕션 전환 전 복구 필요.

**현재 상태:**
- `backend/api/views.py`: `VOCViewSet`, `LineViewSet` 등 뷰에 `permission_classes = [AllowAny]` 직접 지정
- `backend/config/settings.py`의 `DEFAULT_PERMISSION_CLASSES`는 `IsAuthenticatedOrReadOnly`로 유지 중

**프로덕션 전환 시:**
- 각 뷰의 `permission_classes = [AllowAny]` 제거 → `settings.py` 기본값(`IsAuthenticatedOrReadOnly`) 적용
- 또는 역할별 세밀한 권한 제어가 필요하면 커스텀 Permission 클래스 작성
