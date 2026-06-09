# CLAUDE.md — AI 작업 가이드라인

React + Django 기반 웹 애플리케이션. 아래 규칙을 **반드시** 모두 준수한다.

---

## 🗂️ 기능별 참조 문서

작업할 기능이 정해지면 **반드시** 해당 .md 파일을 먼저 읽는다.

| 기능 | 참조 파일 |
|------|---------|
| 로그인/인증 | `docs/LOGIN.md` |
| 의뢰서 작성 | `docs/REQUEST.md` |
| 결재 현황 | `docs/APPROVAL.md` |
| 이력 조회 | `docs/HISTORY.md` |
| VOC | `docs/VOC.md` |
| 권한 관리 | `docs/PERMISSION.md` |
| 공지사항/가이드 | `docs/NOTICE.md` |

---

## ⚡ 규칙 A. 세션 시작 프로토콜 [필수 — 절대 생략 불가]

새로운 작업 요청을 받으면 **반드시** 아래 순서를 따른다:

1. **CLAUDE.md를 다시 읽는다.**
2. **해당 기능의 `docs/*.md` 파일을 읽는다.**
3. **작업 계획을 제시하고 사용자 승인을 받는다.**
4. **승인 전까지 코드를 한 줄도 작성하지 않는다.**

계획 형식 (반드시 이 형식으로 제시):
```
📌 작업 계획
목표: [한 문장]
작업 단계: 1. ... 2. ... 3. ...
영향 받는 파일: [목록]
진행할까요?
```

---

## 🔍 규칙 B. 코드 작성 전 체크 [필수]

- 관련 파일, 디렉토리 구조, 기존 코드를 **반드시** 먼저 확인한다.
- 의존성 및 사이드 이펙트를 **반드시** 검토한다.
- 오탈자, 변수명 불일치, import 누락을 **반드시** 확인한다.
- 사용자 요청을 **90% 이상 이해했을 때만** 코드를 작성한다.
- 이해도가 부족하면 **반드시 즉시** 질문한다.
- 이해도가 충분하면 **반드시** 아래 형식으로 확인한다:
  `✅ 이해한 내용: ... 진행해도 될까요?`

---

## ✅ 규칙 C. 완료 후 검증 [필수]

1. **테스트 실행 및 결과 보고**
   - Backend: `docker exec -it <backend_container> python manage.py test`
   - Frontend: `cd frontend && npm test -- --watchAll=false --passWithNoTests`
   - 실패 시 수정 후 **반드시** 재실행 결과까지 보고한다.

2. **검증 방법 제공** — 실행 명령어 또는 확인 경로 (`http://localhost:10011`)

3. **잠재 버그 및 주의사항 보고** — 마이그레이션 누락, CORS 설정, 엣지 케이스 등

4. **해당 기능 `docs/*.md` 파일을 반드시 최신화한다.**
   - API 엔드포인트 추가·변경 시
   - UI 흐름 변경 시
   - 설정값·환경변수 변경 시

---

## 🔒 규칙 D. 보안 [필수]

- `.env` 파일은 **읽기만** 한다. 수정 **절대 금지.**
- API 키, 비밀번호, 토큰을 코드에 **하드코딩하지 않는다.**
- 민감정보가 필요한 경우 **반드시** 사용자에게 먼저 물어본다.
- `settings.py`, `config.py` 수정 시 **반드시** 사용자에게 먼저 알린다.

커밋 전 체크:
- [ ] 하드코딩된 Key / Password 없음
- [ ] `.env` 파일이 `.gitignore`에 포함됨
- [ ] 민감 로직이 프론트엔드에 노출되지 않음

---

## 📂 규칙 E. 파일 관리 [필수]

- 명시적 허락 없이 기존 파일을 **삭제하지 않는다.**
- 새 파일 생성 전 **반드시** 같은 역할의 파일이 존재하는지 확인한다.
- 파일 수정 범위가 클 경우 **반드시** 영향 범위를 먼저 보고한다.
- 여러 파일 수정 시 **반드시** 파일별로 개별 커밋한다.

---

## 🧩 규칙 F. 컨텍스트 관리 [필수]

자동 압축(compaction) 발생 시 **반드시** 아래 정보를 보존한다:
- 수정한 파일 전체 목록
- 완료/미완료 작업 목록
- 주요 기술 결정사항

작업이 길어질 경우 **반드시** 현재 상태를 요약 보고한다:
```
📊 현재 진행 상태
완료: [...] / 진행 중: [...] / 미완료: [...]
수정된 파일: [...]
```

---

## 🌐 규칙 G. i18n [필수]

프론트엔드의 모든 텍스트는 **반드시** i18n을 통해 사용한다. 하드코딩 **절대 금지.**

- 라이브러리: `i18next` 23.10.0 / `react-i18next` 14.1.0
- 위치: `frontend/src/locales/ko.json` (기본) / `en.json`
- 키 구조: `nav.*` / `home.*` / `request.*` / `approval.*` / `history.*` / `voc.*` / `permission.*` / `login.*` / `common.*` / `notice.*` / `session.*` / `guide.*` / `group.*`

절차 (반드시 순서 준수):
1. `ko.json` / `en.json`에 키를 **반드시 동시에** 추가한다. (하나만 추가 절대 금지)
2. `const { t } = useTranslation();` 후 `{t('키')}` 방식으로 사용한다.
3. 키 불일치 발견 시 **즉시** 사용자에게 보고 후 동기화한다.

체크:
- [ ] `ko.json` 키 추가 완료
- [ ] `en.json` 동일 키 추가 완료
- [ ] 하드코딩된 텍스트 없음

---

## 🎯 규칙 H. 작업 범위 제한 [필수]

- 요청하지 않은 기능을 **임의로 추가하지 않는다.**
- 요청하지 않은 코드를 **리팩토링하지 않는다.**
- 변경은 **요청된 범위 내 최소한**으로 유지한다.
- 불필요한 추상화·레이어를 **추가하지 않는다.**

---

## 🧹 규칙 I. 코드 품질 [필수]

- `console.log`, `print()` 디버그 코드를 최종 코드에 **남기지 않는다.**
- 주석 처리된 코드(dead code)를 **남기지 않는다.**
- 매직 스트링·숫자는 **반드시 상수로 분리한다.**
- TypeScript `any` 타입 사용 **절대 금지.** (불가피한 경우 사용자 승인 후 주석 명시)
- API 응답 타입은 반드시 `src/types/`에 정의한다.

---

## ⚠️ 규칙 J. 에러 처리 [필수]

- API 호출 시 **반드시** `loading` / `error` / `empty` 세 가지 상태를 처리한다.
- `try-catch` 없는 `async` 함수를 작성하지 않는다.
- 에러 메시지는 **반드시** i18n 키를 사용한다.
- DB 데이터 삭제 (`DELETE`, `DROP`, `TRUNCATE`) 실행 전 **반드시** 사용자에게 확인한다.

## 🛠️ 기술 스택

| 영역 | 기술 | 버전/비고 |
|------|------|---------|
| Frontend | React + TypeScript | 18.2.0 / 4.9.5 (strict mode) |
| Backend | Django + DRF | 4.2.13 / 3.15.1 |
| Database | MySQL | 8.0 |
| 인증 | JWT + OIDC SSO | simplejwt 5.3.1, mozilla-django-oidc |
| i18n | react-i18next / i18next | 14.1.0 / 23.10.0 |
| 라우팅 | React Router | 6.22.3 |
| API | REST API (JSON) + SSE | SSE: `/api/users/events/` |
| 인프라 | Docker + Nginx | 운영: HTTPS 10010, 개발: HTTP 10011 |
| 백그라운드 | APScheduler | django-apscheduler 0.6.2 |
| 데이터 처리 | pandas, SQLAlchemy | Cloudera Impala ODBC 연동 |

컨벤션:
- Python: PEP8, 함수·클래스에 docstring 작성
- React: 함수형 컴포넌트, props 타입 명시 (TypeScript strict)
- API 응답: `{ data, message, status }` 형태 통일
- 설정: `backend/config/settings/base.py` / `development.py` / `production.py`

---

## 📁 프로젝트 구조

```
request-site/
├── backend/
│   ├── manage.py / requirements.txt
│   ├── config/settings/ (base, development, production)
│   └── api/
│       ├── models.py           # RequestDocument, VOC, UserProfile 등
│       ├── views.py            # DRF ViewSets
│       ├── serializers.py
│       ├── auth_views.py       # OIDC 인증
│       ├── auth_views_dev.py   # 개발용 로그인
│       ├── authentication.py   # 커스텀 JWT
│       ├── scheduler.py        # APScheduler
│       ├── sse.py              # Server-Sent Events
│       └── migrations/
├── frontend/src/
│   ├── App.tsx / index.tsx / i18n.ts
│   ├── api/client.ts
│   ├── components/             # ApprovalFlow, AutocompleteInput, Modal 등
│   ├── contexts/AuthContext.tsx
│   ├── pages/                  # 7개 페이지
│   ├── locales/ (ko.json, en.json)
│   └── types/
├── docs/                       # 기능별 참조 문서
│   ├── LOGIN.md / REQUEST.md / APPROVAL.md
│   ├── HISTORY.md / VOC.md / PERMISSION.md
│   └── NOTICE.md
├── nginx/ / mysql/
├── docker-compose.yml / docker-compose.dev.yml
└── CLAUDE.md
```

---

*규칙이 변경되면 이 파일과 해당 `docs/*.md`를 반드시 함께 업데이트한다.*
