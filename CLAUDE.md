# CLAUDE.md — AI 작업 가이드라인

> 이 프로젝트는 **React + Django** 기반 웹 애플리케이션입니다.
> 아래 규칙을 **항상** 준수하며 작업하세요.

---

## 🔍 규칙 1. 꼼꼼히 체크할 것

- 코드를 작성하기 전에 관련 파일, 디렉토리 구조, 기존 코드를 **반드시** 먼저 확인한다.
- 새로운 파일을 생성하거나 기존 파일을 수정하기 전에 **의존성 및 사이드 이펙트**를 검토한다.
- 오탈자, 변수명 불일치, import 누락 등 **사소한 실수**도 놓치지 않는다.
- 작업 전 체크리스트:
  - [ ] 관련 파일 전체 읽기 완료
  - [ ] 기존 코드 스타일·컨벤션 파악
  - [ ] 의존 패키지 및 버전 확인
  - [ ] 환경변수·설정값 확인

---

## 🤔 규칙 2. 이해도 90% 이상일 때만 코드를 구현할 것

- 사용자의 요청을 **90% 이상 명확히 이해했을 때**만 코드를 작성한다.
- 이해도가 부족하면 코드 작성을 **즉시 멈추고** 질문을 통해 이해도를 높인다.
- 질문은 **한 번에 1~2개**로 핵심적인 것만 묻는다. (사용자 피로 방지)
- 질문 예시 형식:

  ```
  ❓ 확인이 필요합니다.
  1. [불명확한 부분 A]는 [해석 A1]로 이해해도 될까요, 아니면 [해석 A2]인가요?
  2. [불명확한 부분 B]에 대해 조금 더 설명해 주실 수 있나요?
  ```

- 이해도가 충분하면 코드 작성 전 아래 형식으로 요약 확인을 한다:

  ```
  ✅ 이해한 내용 요약:
  - [핵심 요구사항 1]
  - [핵심 요구사항 2]
  - ...
  위 내용으로 진행해도 될까요?
  ```

---

## 📋 규칙 3. 항상 계획을 먼저 세우고 사용자에게 제시할 것

코드 작성 전에 **반드시** 아래 형식으로 작업 계획을 제시하고 승인을 받는다.

```
📌 작업 계획

목표: [한 문장으로 목표 요약]

작업 단계:
  1. [Step 1 — 예: 모델 설계]
  2. [Step 2 — 예: API 엔드포인트 구현]
  3. [Step 3 — 예: React 컴포넌트 작성]
  4. [Step 4 — 예: 연동 테스트]

영향 받는 파일:
  - backend/models.py
  - frontend/src/components/Example.tsx
  - ...

예상 소요 시간: [짧음 / 보통 / 김]

진행할까요? (수정 사항이 있으면 말씀해 주세요)
```

---

## ✅ 규칙 4. 각 작업 완료 후 검증 방법과 잠재 버그를 알려줄 것

작업이 완료되면 **반드시** 아래 내용을 함께 제공한다.

### 검증 방법

```
🧪 검증 방법

1. [명령어 또는 동작 — 예: `python manage.py test api.tests.UserTest`]
2. [브라우저에서 확인할 경로 — 예: http://localhost:3000/users]
3. [확인해야 할 응답값 또는 UI 상태]
```

### 잠재 버그 및 주의사항

```
⚠️ 주의사항 및 잠재 버그

- [버그 가능성 1 — 예: DB 마이그레이션 누락 시 500 에러 발생]
- [버그 가능성 2 — 예: CORS 설정 미비 시 React → Django API 호출 실패]
- [엣지 케이스 — 예: 빈 배열 응답 시 프론트 렌더링 오류 가능]
```

---

## 🔒 규칙 5. 보안 — 시크릿·민감정보 절대 노출 금지

- `.env` 파일은 **절대 수정하지 않는다.** 읽기만 허용.
- API 키, 비밀번호, 토큰 등을 코드에 **하드코딩 금지.**
- 민감정보가 필요한 경우 반드시 사용자에게 물어본 후 `.env`에 추가하도록 안내한다.
- `settings.py`, `config.py` 등 설정 파일 수정 시 **반드시 사용자에게 먼저 알린다.**
- Git 커밋 전 시크릿 포함 여부를 자체 점검한다.

```
🚨 보안 체크 (커밋 전)
- [ ] 하드코딩된 API Key / Password 없음
- [ ] .env 파일이 .gitignore에 포함됨
- [ ] 민감 로직이 프론트엔드에 노출되지 않음
```

---

## 📂 규칙 6. 파일 관리 — 신중하게 다룰 것

- 명시적 허락 없이 **기존 파일을 삭제하지 않는다.**
- 여러 파일을 수정했을 경우 **파일별로 개별 커밋**한다. (변경 추적 용이)
- 새 파일 생성 전, 같은 역할의 파일이 이미 존재하는지 **먼저 확인**한다.
- 파일 수정 범위가 클 경우 사용자에게 **영향 범위를 먼저 보고**한다.

```
📝 파일 수정 보고 형식
수정 파일: backend/api/models.py
수정 이유: User 모델에 phone_number 필드 추가
영향 범위: serializers.py, admin.py, migration 파일 신규 생성 필요
진행할까요?
```

---

## 🧪 규칙 7. 테스트 — 구현 후 반드시 검증할 것

- 새 기능 구현 시 **테스트 코드를 함께 작성**한다.
- 구현이 끝나면 아래 명령어를 **반드시 실행하고 결과를 보고**한다.

```bash
# Backend
python manage.py test

# Frontend
npm test
```

- 테스트 실패 시 코드 수정 후 **재실행 결과까지 확인**한다.
- 테스트 작성이 어려운 경우, 그 이유를 사용자에게 설명하고 대안을 제시한다.

---

## 🧩 규칙 8. 컨텍스트 관리 — 대화가 길어져도 핵심을 잃지 말 것

- 대화 중 자동 압축(compaction)이 발생해도 아래 정보는 **반드시 보존**한다:

```
📌 보존 필수 정보
- 지금까지 수정한 파일 전체 목록
- 실행한 테스트 명령어
- 완료된 작업 / 미완료 작업 목록
- 사용자가 선택한 주요 기술 결정사항 (예: JWT 방식, REST vs GraphQL 등)
```

- 작업이 길어질 것 같으면 중간에 **현재 상태를 요약해서 보고**한다:

```
📊 현재 진행 상태 요약
완료: [작업 A], [작업 B]
진행 중: [작업 C — 현재 Step 2/4]
미완료: [작업 D], [작업 E]
수정된 파일: models.py, serializers.py, UserCard.tsx
```

- 새로운 대화에서 이어서 작업할 경우, 위 요약을 복사해서 붙여넣으면 컨텍스트를 빠르게 복원할 수 있다.

---

## 🌐 규칙 9. Frontend 텍스트 — 반드시 i18n 파일을 통해 사용할 것

프론트엔드에서 사용자에게 보이는 **모든 텍스트(라벨, 버튼, 메시지, 제목 등)는 코드에 직접 하드코딩하지 않는다.**

### 사용 라이브러리

- `i18next` 23.10.0
- `react-i18next` 14.1.0
- `i18next-browser-languagedetector` 7.2.1 — localStorage → navigator 순서로 언어 자동 감지
- 설정 파일: `frontend/src/i18n.ts`

### 절차

1. `ko.json` / `en.json`에 용어를 **먼저 추가**한다.
2. 컴포넌트에서는 해당 키를 **참조하는 방식**으로 사용한다.
3. 두 파일을 **항상 동시에 업데이트**한다. (하나만 추가 금지)

### 파일 위치

```
frontend/src/locales/
├── ko.json   # 한국어 (기본 fallback)
└── en.json   # 영어
```

### 현재 키 구조 (최상위 네임스페이스)

| 키 | 설명 |
|----|------|
| `nav.*` | 네비게이션 메뉴 |
| `home.*` | 홈 페이지 |
| `request.*` | 의뢰서 작성 페이지 |
| `approval.*` | 결재 현황 페이지 |
| `history.*` | 이력 조회 페이지 |
| `voc.*` | VOC 페이지 |
| `permission.*` | 권한 관리 페이지 |
| `login.*` | 로그인 페이지 |
| `common.*` | 공통 UI 텍스트 (버튼, 상태 등) |
| `notice.*` | 공지사항 관련 텍스트 |

### 작성 예시

```json
// ko.json
{
  "nav": {
    "home": "홈",
    "request": "의뢰서 작성",
    "approval": "결재 현황"
  },
  "request": {
    "title": "의뢰서 작성",
    "save_draft": "임시저장",
    "submit": "상신하기",
    "required": "필수 입력 항목입니다."
  }
}

// en.json
{
  "nav": {
    "home": "Home",
    "request": "New Request",
    "approval": "Approval Status"
  },
  "request": {
    "title": "New Request",
    "save_draft": "Save Draft",
    "submit": "Submit",
    "required": "This field is required."
  }
}
```

### 컴포넌트 사용 예시

```tsx
// ❌ 하드코딩 — 금지
<button>임시저장</button>

// ✅ i18n 키 참조 — 올바른 방식
const { t } = useTranslation();
<button>{t('request.save_draft')}</button>
```

### 체크리스트 (텍스트 추가 시)

```
🌐 i18n 체크
- [ ] ko.json에 키 추가 완료
- [ ] en.json에 동일 키 추가 완료
- [ ] 컴포넌트에서 t('키') 방식으로 참조
- [ ] 하드코딩된 한글/영문 텍스트 없음
```

---

## 🛠️ 기술 스택 참고사항

| 영역 | 기술 | 버전 / 비고 |
|------|------|------------|
| Frontend | React + TypeScript | 18.2.0 / 4.9.5 (strict mode, **TypeScript 필수**) |
| Backend | Django + Django REST Framework | 4.2.13 / 3.15.1 |
| 언어 | Python (backend), TypeScript (frontend) | |
| Database | MySQL | 8.0 |
| 인증 | JWT + OIDC SSO | djangorestframework-simplejwt 5.3.1, mozilla-django-oidc |
| i18n | react-i18next / i18next | 14.1.0 / 23.10.0 (한국어 기본, 영어 지원) |
| 라우팅 | React Router | 6.22.3 |
| API 방식 | REST API (JSON) + SSE | SSE는 실시간 알림(`/api/users/events/`)에 사용 |
| 인프라 | Docker + Nginx | 운영: HTTPS 10010 포트, 개발: HTTP 10011 포트 |
| 백그라운드 작업 | APScheduler | django-apscheduler 0.6.2 |
| 데이터 처리 | pandas, SQLAlchemy | Cloudera Impala ODBC 연동 (form options) |

### 공통 컨벤션
- Python: **PEP8** 준수, 함수·클래스에 docstring 작성
- React: 컴포넌트는 **함수형** 사용, props에 타입 명시 (TypeScript strict mode)
- API 응답: 항상 `{ data, message, status }` 형태 통일 권장
- 환경변수: `.env` 파일 사용, 코드에 하드코딩 금지
- 설정 파일: `backend/config/settings/` 하위에 `base.py`, `development.py`, `production.py` 분리

---

## 📁 프로젝트 구조

```
request-site/
├── backend/                        # Django 프로젝트
│   ├── manage.py
│   ├── requirements.txt
│   ├── config/                     # 프로젝트 설정
│   │   ├── settings/
│   │   │   ├── base.py             # 공통 설정
│   │   │   ├── development.py      # 개발 환경
│   │   │   └── production.py       # 운영 환경
│   │   ├── urls.py
│   │   └── wsgi.py
│   └── api/                        # 단일 Django 앱
│       ├── models.py               # DB 모델 (RequestDocument, VOC, User 등)
│       ├── views.py                # DRF ViewSets
│       ├── serializers.py
│       ├── urls.py
│       ├── auth_views.py           # OIDC 인증 처리
│       ├── auth_views_dev.py       # 개발용 로그인 (유저 전환)
│       ├── authentication.py       # 커스텀 JWT 인증
│       ├── scheduler.py            # APScheduler 백그라운드 작업
│       ├── sse.py                  # Server-Sent Events 처리
│       ├── utils.py
│       ├── management/             # Django 커스텀 management commands
│       └── migrations/
├── frontend/                       # React 프로젝트
│   ├── public/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── App.tsx                 # 라우터 & 레이아웃
│       ├── index.tsx
│       ├── i18n.ts                 # i18next 설정 (언어 감지: localStorage → navigator)
│       ├── api/
│       │   └── client.ts           # API 호출 함수 모음
│       ├── components/             # 공통 컴포넌트
│       │   ├── Navbar.tsx
│       │   ├── Modal.tsx
│       │   ├── Toast.tsx
│       │   └── ...
│       ├── contexts/
│       │   └── AuthContext.tsx     # 인증 상태 관리
│       ├── pages/                  # 페이지 컴포넌트
│       │   ├── HomePage.tsx
│       │   ├── RequestPage.tsx
│       │   ├── ApprovalPage.tsx
│       │   ├── HistoryPage.tsx
│       │   ├── VOCPage.tsx
│       │   ├── PermissionPage.tsx
│       │   ├── GuidePage.tsx
│       │   ├── LoginPage.tsx
│       │   └── OIDCCallbackPage.tsx
│       ├── locales/                # 다국어 파일
│       │   ├── ko.json             # 한국어 (기본 fallback)
│       │   └── en.json             # 영어
│       ├── styles/
│       │   └── global.css
│       └── types/
│           ├── index.ts            # 공통 타입 정의
│           └── i18n.d.ts           # i18next 타입 확장
├── nginx/                          # Nginx 설정
│   ├── nginx.conf                  # 운영 (HTTPS, 10010 포트)
│   └── nginx.dev.conf              # 개발 (HTTP, 10011 포트)
├── mysql/                          # MySQL 설정
│   ├── my.cnf
│   └── my.dev.cnf
├── docker-compose.yml              # 운영 컨테이너 구성
├── docker-compose.dev.yml          # 개발 컨테이너 구성
├── .env.example                    # 운영 환경변수 템플릿
├── .env.dev.example                # 개발 환경변수 템플릿
└── CLAUDE.md                       # ← 이 파일
```

---

*이 파일은 Claude Code가 프로젝트 전반에서 일관되게 작동하도록 돕는 가이드입니다.*
*요구사항이 바뀌면 이 파일을 업데이트해 주세요.*
