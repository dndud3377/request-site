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

## `backend/api/scheduler.py`

```python
# 역할: Big Data 를 사용하여 폼 옵션 데이터 (조합법 - 제품 이름, 제품 이름 - 조리법) 를 주기적으로 동기화하는 스케줄러

# 라인 2 제외 (테이블 없음)
LINES = ['라인 1', '라인 3', '라인 4', '라인 5']
LINE_SUFFIX_MAP = {
    '라인 1': '라인1',
    '라인 3': '라인3',
    '라인 4': '라인4',
    '라인 5': '라인5',
}

# 동기화 데이터
# 1. 조합법-제품 이름: {suffix}_map → api_combinationproduct
# 2. 제품 이름-조리법: {suffix}_map → api_productcooking

# 필요 이유: bigdata 데이터베이스의 최신 조합법/제품이름/조리법 정보를 Django 애플리케이션의 폼 옵션으로 제공하기 위해 주기적 또는 수동으로 동기화 필요

# 실행 방식:
#   - APScheduler 를 사용한 백그라운드 스케줄러
#   - 1 시간 주기 (IntervalTrigger(hours=1)) 로 자동 실행
#   - 스케줄러 시작 시 즉시 1 회 실행
#   - start() 함수 호출로 스케줄러 등록 및 시작

# 환경 변수 요구사항:
#   ID: bigdata 계정 ID
#   PASSWORD: 비밀번호 (JSON pack 또는 문자열)
#   MYSQL_USER, MYSQL_PASSWORD, MYSQL_HOST, MYSQL_PORT, MYSQL_DB: Django DB 연결 정보

# 주요 함수:
#   - bd_login(): bigdata 로그인
#   - login_with_retry(): 여러 비밀번호로 재시도 로그인
#   - get_data_from_bd(): bigdata 를 사용하여 데이터 조회 (DataFrame 반환)
#   - sync_form_options(): 실제 동기화 수행 (각 라인별 데이터 삭제 후 추가)
#   - start(): 스케줄러 등록 및 시작
```

---

## `backend/api/management/commands/sync_form_options_manual.py`

**역할**: bigdata를 사용하여 폼 옵션 데이터(조합법-제품 이름, 제품 이름-조리법)를 수동으로 동기화하는 Django 관리 명령어

**형식**:
```python
# 라인 2 제외 (테이블 없음)
LINES = ['라인 1', '라인 3', '라인 4', '라인 5']
LINE_SUFFIX_MAP = {
    '라인 1': '라인1',
    '라인 3': '라인3',
    '라인 4': '라인4',
    '라인 5': '라인5',
}

# 동기화 데이터
# 1. 조합법-제품 이름: {suffix}_map → api_combinationproduct
# 2. 제품 이름-조리법: {suffix}_map → api_productcooking
```

**필요 이유**: bigdata 데이터베이스의 최신 조합법/제품이름/조리법 정보를 Django 애플리케이션의 폼 옵션으로 제공하기 위해 주기적 또는 수동으로 동기화 필요

**실행 방법**:
```bash
docker compose exec backend python manage.py sync_form_options_manual
```

**환경 변수 요구사항**:
- `ID`: bigdata 계정 ID
- `PASSWORD`: 비밀번호
- `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_DB`: Django DB 연결 정보

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
