# CLAUDE.md — AI 작업 가이드라인

React + Django 기반 웹 애플리케이션. 아래 규칙을 **반드시** 모두 준수한다.

---

> ⛔ **최우선 원칙 — 사용자의 의도가 가장 중요하다.**
> 시작 전 승인은 **규칙 A**, 작업 **도중** 계획에 없던 것을 발견했을 때는 **규칙 K(정지 → 보고 → 승인)** 를 따른다.
> 판단이 서지 않으면 **진행이 아니라 질문**을 택한다.

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
- 이해도가 부족하면 **반드시 즉시** 질문한다. (작업 도중의 발견은 규칙 K)
- 이해도가 충분하면 **반드시** 아래 형식으로 확인한다:
  `✅ 이해한 내용: ... 진행해도 될까요?`

---

## ✅ 규칙 C. 완료 후 검증 [필수]

1. **테스트 실행 및 결과 보고 — "환경이 없어서 못 돌렸다"로 넘어가지 않는다 [필수]**

   기본 경로 (Docker 가 살아 있을 때):
   - Backend: `docker exec -it <backend_container> python manage.py test`
   - Frontend: `cd frontend && npm test -- --watchAll=false --passWithNoTests`
   - Type check: `cd frontend && npx tsc --noEmit 2>&1 | grep -c "error TS"`
   - 실패 시 수정 후 **반드시** 재실행 결과까지 보고한다.

   **1-1. Docker·MySQL 이 없어도 반드시 먼저 시도한다 [필수].**
   원격 세션 등 컨테이너가 없는 환경에서도 **전체 테스트가 돈다**(2026-08-04 실행 검증 완료).
   "테스트 환경이 없다"고 단정하기 전에 **반드시 아래를 실제로 실행해 보고**, 그래도 안 되면
   *무엇을 시도했고 어떤 에러로 막혔는지*까지 함께 보고한다.

   ```bash
   SP=/tmp/e2e                                   # 프로젝트 밖 작업 디렉터리
   mkdir -p $SP/stubs && python3 -m venv $SP/venv

   # requirements.txt 를 그대로 쓰지 않는다.
   #  - mysqlclient 제외: 빌드에 libmysqlclient-dev+gcc 필요, sqlite 로 돌리므로 불필요
   #  - mozilla-django-oidc / PyJWT 추가: requirements.txt 에 없지만 실제로 필요하다
   $SP/venv/bin/pip install -q \
     Django==4.2.13 djangorestframework==3.15.1 django-cors-headers==4.3.1 \
     djangorestframework-simplejwt==5.3.1 Pillow==10.3.0 python-dotenv==1.0.1 \
     django-filter==24.2 django-apscheduler==0.6.2 pandas==2.2.2 sqlalchemy==2.0.30 \
     requests==2.31.0 pymysql==1.1.1 mozilla-django-oidc PyJWT

   # 사내 전용 모듈 스텁 (utils.py 가 import) — 프로젝트 밖에 둔다
   cat > $SP/stubs/datacenterquery.py <<'EOF'
   def login(*a, **k):   raise RuntimeError('stub: 테스트에서 호출되면 안 된다')
   def getData(*a, **k): raise RuntimeError('stub: 테스트에서 호출되면 안 된다')
   EOF

   cat > $SP/stubs/test_settings.py <<'EOF'
   from config.settings.base import *
   DEBUG = True
   DATABASES = {'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'}}
   EOF

   cd backend && PYTHONPATH=$SP/stubs DJANGO_SETTINGS_MODULE=test_settings \
     $SP/venv/bin/python manage.py test api
   ```
   - 소요: pip 약 20초 / 백엔드 테스트 약 4초 / `npm ci` 약 30초.
   - `staticfiles.W004` 경고 1건은 무해하다.
   - 상세·배경은 `docs/E2E_TEST_AND_BUGS.md` **§1.4.1** 참조(이 절차의 원본).

   **1-2. 버그를 발견하면 "재현 테스트"로 사실을 고정한다 [필수].**
   코드 정독만으로 단정하지 말고, 가능한 것은 **실제로 돌려서 출력으로 증명**한다.
   임시 재현 테스트는 **프로젝트 밖**(`$SP/stubs/verify_xxx.py`)에 두고
   `manage.py test verify_xxx` 로 실행한다 — `backend/api/tests.py` 를 오염시키지 않는다.
   보고할 때는 **실행 출력 원문**을 붙인다.

   **1-3. 확인하지 않은 것을 단정하지 않는다 [필수].**
   "안 된다 / 불가능하다 / 없다" 는 **직접 실행해 확인한 뒤에만** 쓴다.
   확인 못 한 것은 "확인하지 못했다"라고 **정확히 그대로** 적는다. 추측을 사실처럼 보고하지 않는다.

2. **검증 방법 제공** — 실행 명령어 또는 확인 경로 (`http://localhost:10011`)

   2-1. **실제 웹 페이지 수동 검증 시나리오를 반드시 함께 제시한다 [필수].**
   "테스트 통과"만으로 끝내지 말고, 사용자가 **직접 브라우저에서 무엇을 클릭·입력·이동해야** 이 변경을 제대로 확인할 수 있는지 **단계별 동작 지시**로 적는다.
   - 형식: `1. [경로/화면 진입] → 2. [구체적 조작: 어떤 버튼 클릭 / 무슨 값 입력 / 어느 탭 이동] → 3. [기대 결과: 화면에 무엇이 보여야 하는지]`
   - **어느 페이지·어느 메뉴에서 시작**하는지 명시한다 (예: 결재 현황 → 의뢰서 행 클릭 → '결재 경로' 탭).
   - 여러 역할/상태에 따라 동작이 다르면 **역할·상태별 시나리오를 각각** 적는다 (예: TE_J 로그인 시 / 반려 문서일 때).
   - 각 시나리오에 **성공 판정 기준(무엇이 보이면 정상)** 과, 있다면 **실패로 보이는 신호**를 함께 적는다.
   - 원격/컨테이너 제약 등으로 자동 테스트를 못 돌렸다면, 이 수동 시나리오가 **검증의 핵심**이므로 더욱 구체적으로 적는다.

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
- 작업 중 고치고 싶은 것을 발견해도 **먼저 멈추고 보고한다 → 규칙 K.**

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

---

## 🛑 규칙 K. 발견 시 정지 → 보고 → 승인 [필수 — 절대 생략 불가]

작업 도중 **요청받지 않은 문제**를 발견하면 — 버그, 잘못된 코드, 문서와 구현 불일치,
더 나은 구현 방식, 누락된 검증 등 무엇이든 — **그 자리에서 손을 멈추고 먼저 보고한다.**
**임의로 고치지 않는다.**

> 이유: **나(사용자)의 의도가 가장 중요하다.** 코드가 "틀려 보이는" 것과
> "고쳐야 하는" 것은 다르다. 무엇을 고칠지는 내가 정한다.

보고 형식 (반드시 이 형식으로 제시):
```
🛑 발견 보고
발견: [무엇이 잘못됐는지 한 문장]
위치: [파일:라인]
근거: [코드 인용 / 실행 출력 등 확인한 사실]
영향: [고치지 않으면 실제로 무슨 일이 생기는지]
선택지: 1) [지금 고친다 — 범위: …]  2) [다르게 고친다 — …]  3) [지금은 두고 기록만 남긴다]
추천: [있으면 하나만, 이유 한 줄]
어떻게 할까요?
```

절대 규칙:
- 사용자의 답변을 받기 전까지 **그 부분은 한 줄도 수정하지 않는다.**
- **"명백한 버그"라도 예외 없다.** 명백함은 수정의 근거가 되지 않는다.
- **"고치는 김에"** 는 금지다. 답변에 없는 것을 덤으로 고치지 않는다(규칙 H).
- 사용자가 방향을 정하면 **그 답변의 범위 안에서만** 수정한다.
- 발견과 **무관한** 원래 작업은 계속 진행해도 된다. 단 발견 사항은 **반드시** 보고한다.
- 여러 건이면 **모아서 한 번에** 보고한다. 단 작업을 막는 것(blocker)은 **즉시** 보고한다.
- 이미 고친 뒤에 규칙 위반을 깨달았다면, **되돌리지 말고 먼저 보고**한다
  (되돌리기도 사용자가 결정할 사항이다).
- 사용자가 이미 결정한 사항을 **다시 문제 삼지 않는다.** 재확인이 필요하면 새 근거를 함께 제시한다.

보고만 하고 넘어가도 되는 경우 (판단 기준):
- 오탈자·포맷 등 **동작에 영향이 없고** 지금 수정 중인 줄에 포함된 것 → 고치고 **보고에 한 줄 남긴다.**
- 그 외 **동작·데이터·결재 흐름·저장 형식에 닿는 것은 전부** 위 정지 규칙을 적용한다.

---

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
