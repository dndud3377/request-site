# 제품 소개 지도 의뢰 시스템

제품의 소개 지도 제작을 위한 의뢰서를 작성하고 상신하는 웹 플랫폼입니다.

---

## 기술 스택

| 영역 | 기술 |
|------|------|
| Backend | Django 4.2 + Django REST Framework |
| Frontend | React 18 + TypeScript + react-i18next |
| Database | MySQL 8.0 |
| Auth | ADFS OIDC SSO (운영) / 드롭다운 유저 전환 (개발) |
| Server | Nginx |
| Container | Docker + Docker Compose |
| Background | APScheduler (django-apscheduler) |
| External DB | Cloudera Impala (ODBC) |

---

## 환경 구성

운영과 개발을 완전히 분리하여 운영합니다.

| 항목 | 운영 | 개발 |
|------|------|------|
| 실행 명령 | `docker compose up --build` | `docker compose -f docker-compose.dev.yml up --build` |
| 포트 | 10010 | 10011 |
| DB | `requestdb` | `requestdb_dev` |
| 인증 | ADFS OIDC SSO | 없음 — Navbar 드롭다운으로 유저 전환 |
| Django 설정 | `config.settings.production` | `config.settings.development` |
| HTTPS | 강제 | 없음 (HTTP) |
| Scheduler | 활성 | 비활성 (`SKIP_SCHEDULER=true`) |

---

## 운영 환경

### 1. 환경 변수 설정

```bash
cp .env.example .env
# .env 파일을 열어 값 입력
```

### 2. 실행

```bash
docker compose up --build
```

접속: `https://<서버주소>:10010`

---

## 개발 환경

### 1. 환경 변수 설정

```bash
cp .env.dev.example .env.dev
# .env.dev 파일을 열어 값 입력
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

접속: `http://localhost:10011`

인증 불필요 — Navbar 상단 DEV 드롭다운에서 역할별 테스트 유저 전환

### DB 자동 동기화

`--build` 시마다 `db-sync` 서비스가 운영 DB를 개발 DB로 자동 복사합니다.

```
docker compose -f docker-compose.dev.yml up --build
  ↓
[db-sync] requestdb → requestdb_dev 복사
  ↓ 완료 후
[backend] migrate + create_users + runserver
```

개발 중 생성한 데이터를 유지하면서 재시작하려면:

```bash
SKIP_DB_SYNC=true docker compose -f docker-compose.dev.yml up --build
# 또는 .env.dev에 SKIP_DB_SYNC=true 설정 후 실행
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
환경변수로 격리되어 있어 main에 merge해도 운영에 영향이 없습니다.

---

## 파일 구조

```
request-site/
├── docker-compose.yml          # 운영 환경
├── docker-compose.dev.yml      # 개발 환경 (db-sync 포함)
├── .env.example                # 운영 환경변수 템플릿
├── .env.dev.example            # 개발 환경변수 템플릿
│
├── backend/
│   ├── config/
│   │   ├── settings/
│   │   │   ├── base.py         # 공통 설정
│   │   │   ├── production.py   # 운영 전용 (HTTPS 강제)
│   │   │   └── development.py  # 개발 전용 (DEBUG=True)
│   │   └── urls.py
│   └── api/
│       ├── models.py
│       ├── views.py
│       ├── serializers.py
│       ├── auth_views.py       # OIDC 인증 (운영)
│       ├── auth_views_dev.py   # 드롭다운 로그인 (개발)
│       ├── scheduler.py        # 백그라운드 작업
│       └── management/commands/
│           ├── create_users.py
│           ├── seed_lines.py
│           └── wait_for_db.py
│
├── frontend/
│   └── src/
│       ├── pages/              # 페이지 컴포넌트
│       ├── components/         # 공통 UI 컴포넌트
│       ├── contexts/           # AuthContext
│       ├── api/                # client.ts (HTTP), mock.ts
│       └── locales/            # ko.json, en.json
│
└── nginx/
    ├── nginx.conf              # 운영 Nginx 설정
    └── nginx.dev.conf          # 개발 Nginx 설정
```

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

---

## 역할 구조

| 역할 | 설명 |
|------|------|
| `NONE` | 권한 없음 — SSO 로그인 후 기본값, 관리자가 역할 지정 필요 |
| `PL` | 제품 담당자 — 의뢰서 작성 및 전체 열람 |
| `TE_R` | AGENT R팀 — R단계 결재 |
| `TE_J` | AGENT J팀 — J단계 결재 |
| `TE_O` | AGENT O팀 — O단계 결재 |
| `TE_E` | AGENT E팀 — E단계 결재 |
| `MASTER` | 관리자 — 모든 권한 |

결재 순서: `R → J / O (병렬) → E`

---

## 주요 API 엔드포인트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/api/auth/oidc/login/` | OIDC 로그인 초기화 |
| POST | `/api/auth/oidc/callback/` | OIDC 콜백 처리 |
| POST | `/api/auth/oidc/logout/` | 로그아웃 |
| POST | `/api/auth/dev-login/` | 개발용 로그인 (AUTH_MODE=dev 시만 동작) |
| GET | `/api/auth/me/` | 현재 사용자 정보 |
| GET/POST | `/api/documents/` | 의뢰서 목록 / 작성 |
| GET/PATCH | `/api/documents/{id}/` | 의뢰서 상세 / 수정 |
| GET/POST | `/api/voc/` | VOC 목록 / 작성 |
| GET | `/api/notices/` | 공지사항 |
| GET | `/api/lines/` | 라인 목록 |
| GET | `/api/users/` | 사용자 목록 |
| GET | `/api/health/` | 헬스체크 |

---

## 다국어 지원

`ko.json` / `en.json`에서 번역 관리. Navbar 드롭다운에서 KO / EN 전환 가능.

---

## Admin

```bash
# 운영
docker compose exec backend python manage.py createsuperuser

# 개발
docker compose -f docker-compose.dev.yml exec backend python manage.py createsuperuser
```

Admin 접속: `http(s)://<주소>/admin/`

---

## 이메일 설정

상신 시 담당자에게 이메일 자동 발송. `.env`에서 설정:

```env
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USE_TLS=True
EMAIL_HOST_USER=your-email@gmail.com
EMAIL_HOST_PASSWORD=your-app-password
DEFAULT_FROM_EMAIL=noreply@your-domain.com
APPROVAL_EMAIL_LIST=approver1@company.com,approver2@company.com
```
