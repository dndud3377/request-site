# 제품 소개 지도 의뢰 시스템

제품의 소개 지도 제작을 위한 의뢰서를 작성하고 상신하는 웹 플랫폼입니다.

## 기술 스택

- **Backend**: Django 4.2 + Django REST Framework
- **Frontend**: React 18 + react-i18next
- **Database**: MySQL 8.0
- **Server**: Nginx
- **Container**: Docker + Docker Compose

## 주요 기능

- 의뢰서 작성 (임시저장 / 상신)
- 상신 시 담당자 이메일 자동 발송
- 결재 현황 조회 (역할별 권한 분리)
- 이력 조회
- VOC (Voice of Customer) 등록
- 한국어 / 영어 다국어 지원

## 환경 구성

두 가지 환경을 완전히 분리하여 운영합니다.

| 항목 | 운영 | 개발 |
|------|------|------|
| 실행 명령 | `docker compose up --build` | `docker compose -f docker-compose.dev.yml up --build` |
| 포트 | 10010 | 10011 |
| DB | `requestdb` | `requestdb_dev` |
| 인증 | OIDC SSO | 로그인 없음, Navbar 드롭다운 유저 전환 |
| Django 설정 | `config.settings.production` | `config.settings.development` |
| HTTPS | 강제 | 없음 (HTTP) |
| Scheduler | 활성 | 비활성 |

---

## 운영 환경

### 1. 환경 변수 설정

`.env.example`을 복사하여 `.env`를 만들고 값을 채웁니다.

```bash
cp .env.example .env
```

### 2. 실행

```bash
docker compose up --build
```

- 접속: `https://<서버주소>:10010`
- 인증: ADFS OIDC SSO

---

## 개발 환경

### 1. 환경 변수 설정

`.env.dev.example`을 복사하여 `.env.dev`를 만들고 값을 채웁니다.

```bash
cp .env.dev.example .env.dev
```

주요 설정:

```env
MYSQL_HOST=<운영과 동일한 MySQL 서버>
MYSQL_DB=requestdb          # 운영 DB (복사 원본)
DEV_MYSQL_DB=requestdb_dev  # 개발 DB (복사 대상)
SKIP_DB_SYNC=false          # true로 설정하면 기존 dev DB 유지
```

### 2. 실행

```bash
docker compose -f docker-compose.dev.yml up --build
```

- 접속: `http://localhost:10011`
- 인증: 불필요 — Navbar 상단의 DEV 드롭다운에서 역할별 테스트 유저 전환

### DB 동기화

개발 환경을 `--build`로 시작하면 `db-sync` 서비스가 운영 DB(`requestdb`)를 개발 DB(`requestdb_dev`)로 자동 복사합니다. 백엔드는 복사 완료 후 시작됩니다.

```
docker compose -f docker-compose.dev.yml up --build
  ↓
[db-sync] requestdb → requestdb_dev 복사
  ↓ (완료 후)
[backend] migrate + create_users + runserver
```

개발 중 생성한 데이터를 유지하면서 재시작하려면:

```bash
# .env.dev에 설정하거나 인라인으로 전달
SKIP_DB_SYNC=true docker compose -f docker-compose.dev.yml up --build
```

---

## 개발 → 운영 배포 흐름

```
1. 개발 환경에서 기능 구현 및 테스트
   docker compose -f docker-compose.dev.yml up --build

2. 기능 완성 후 main에 merge

3. 운영 서버에서 재배포
   docker compose up --build
```

개발 전용 코드(`auth_views_dev.py`, `settings/development.py`, `db-sync` 서비스)는
모두 환경변수로 격리되어 있어 main에 merge해도 운영에 영향이 없습니다.

---

## 페이지 구성

| 경로 | 페이지 | 접근 가능 역할 |
|------|--------|--------------|
| `/` | 홈 | 전체 |
| `/request` | 의뢰서 작성 | PL, TE_*, MASTER |
| `/approval` | 결재 현황 | 전체 |
| `/history` | 이력 조회 | 전체 |
| `/voc` | VOC | 전체 |
| `/guide` | 가이드 | 전체 |
| `/permissions` | 권한 관리 | PL, TE_*, MASTER |

## 역할 구조

| 역할 | 설명 |
|------|------|
| `NONE` | 권한 없음 (SSO 로그인 후 기본값) |
| `PL` | 제품 담당자 — 의뢰서 작성 및 전체 열람 |
| `TE_R` | AGENT R팀 — R단계 결재 |
| `TE_J` | AGENT J팀 — J단계 결재 |
| `TE_O` | AGENT O팀 — O단계 결재 |
| `TE_E` | AGENT E팀 — E단계 결재 |
| `MASTER` | 관리자 — 모든 권한 |

## Admin 계정 생성

```bash
docker compose exec backend python manage.py createsuperuser
```

## 이메일 설정

`.env`에서 설정:

```env
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USE_TLS=True
EMAIL_HOST_USER=your-email@gmail.com
EMAIL_HOST_PASSWORD=your-app-password
APPROVAL_EMAIL_LIST=approver@company.com
```
