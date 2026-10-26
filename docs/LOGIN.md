# LOGIN — 로그인·인증·세션

> 작성일: 2026-10-26
> 목적: 로그인·인증·세션 유지의 **실제 구현 동작**을 기록한다. 의도와 구현이 일치하는지 검증할 때
> 이 문서를 기준으로 확인한다. (⚠️ 표시는 "확인이 필요"하거나 "알려진 문제"인 부분이다.)
> 버그·수정 이력의 원본은 `docs/E2E_TEST_AND_BUGS.md`(§5-6 OIDC, §5-7 접근 경로, §5-8 refresh)이고,
> 외부 연동 API Key 는 `docs/EXTERNAL_API.md` 가 원본이다.

- 백엔드: `backend/api/auth_views.py`(SSO), `backend/api/auth_views_dev.py`(개발 로그인),
  `backend/api/authentication.py`(`CookieJWTAuthentication`, `ExternalApiKeyAuthentication`)
- 설정: `backend/config/settings/base.py` (`AUTH_MODE`, `SERVICE_JWT_*`, `OIDC_*`, `REST_FRAMEWORK`)
- 프론트: `frontend/src/contexts/AuthContext.tsx`, `frontend/src/api/client.ts`, `frontend/src/pages/LoginPage.tsx`,
  `frontend/src/hooks/useIdleTimer.ts`, `frontend/src/components/SessionWarningModal.tsx`

---

## 0. 모드

`AUTH_MODE` 환경변수(기본 `sso`)로 갈린다. 프론트는 빌드 시 `REACT_APP_AUTH_MODE` 로 같은 값을 받는다.

| | 운영 `sso` | 개발 `dev` |
|---|---|---|
| 로그인 | ADFS OIDC (implicit, `id_token` form_post) | 사용자 드롭다운 → `POST /api/auth/dev-login/` (비밀번호 없음) |
| 서버 인증 수단 | HttpOnly 쿠키 `approval_system_token` 만 | 쿠키 + `Authorization: Bearer`(simplejwt) |
| 토큰 보관 | 쿠키(JS 접근 불가) | `localStorage['approval_system_token']` |
| 자동 로그아웃 | 활동 없음 12시간 | 없음 |

- `DEFAULT_AUTHENTICATION_CLASSES` 는 `CookieJWTAuthentication` 하나이고, `AUTH_MODE=dev` 일 때만 simplejwt
  `JWTAuthentication` 이 추가된다(`base.py`). 운영에서는 Bearer 가 통과하지 않는다(B-74).
- `dev-login` 은 `AUTH_MODE != 'dev'` 이면 403 이다.

---

## 1. 토큰과 쿠키

| 쿠키 | 내용 | 수명 | 속성 |
|---|---|---|---|
| `approval_system_token` | 서비스 access JWT (HS256, `SERVICE_JWT_SECRET_KEY`, `username`=loginid) | 12시간 (`SERVICE_JWT_ACCESS_TOKEN_LIFETIME`, 쿠키 `max_age` 도 같다) | HttpOnly, Secure, SameSite=Lax, path=/ |
| `approval_system_refresh` | refresh JWT (`type: 'refresh'`) | 7일 (`SERVICE_JWT_REFRESH_TOKEN_LIFETIME`) | 같음 |
| `oidc_auth_state` | 서명된 state·nonce (로그인 시작~콜백 사이 1회용) | 10분 | HttpOnly, Secure, SameSite=None |

- 쿠키 `max_age` 가 JWT 만료와 같아서, 만료 시점에 브라우저가 access 쿠키를 지운다 →
  서버 입장에서는 "만료"보다 "쿠키 없음"으로 보이는 경우가 대부분이다.
- `Secure` 고정이라 HTTP(개발 10011)에서는 쿠키가 저장되지 않는다 — 개발은 Bearer 경로를 쓴다.

---

## 2. API

| 메서드 | 경로 | 권한 | 동작 |
|---|---|---|---|
| GET | `/api/auth/oidc/login/` | AllowAny | ADFS 인증 URL(`redirect_url`) 반환 + `oidc_auth_state` 쿠키 설정 |
| POST | `/api/auth/oidc/callback/` | AllowAny, csrf_exempt | ADFS form_post(`id_token`, `state`) 검증 → 사용자 생성/갱신 → 두 쿠키 설정 → `/` 로 302 |
| POST | `/api/auth/oidc/logout/` | AllowAny | 두 쿠키 삭제, `logout_url`(ADFS) 반환 |
| GET | `/api/auth/me/` | IsAuthenticated | `{ user }` (`id`, `username`=loginid, `name`, `role`, `department`, `email`) |
| POST | `/api/auth/refresh/` | **인증 클래스 없음 + AllowAny** | refresh 쿠키만 검증 → access·refresh 둘 다 재발급(슬라이딩 7일) |
| POST | `/api/auth/dev-login/` | AllowAny (dev 전용) | `{ username }` → `{ access, refresh, user }` |

### 2.1 콜백 검증 (`oidc_callback`)
필수 설정(`OIDC_OP_ISSUER`, `OIDC_RP_CLIENT_ID`, `OIDC_OP_JWKS_ENDPOINT`)이 비면 500.
이후 state 쿠키 서명·만료 → form `state` 일치 → JWKS 로 서명 키 조회 → `id_token` 서명·만료·`iss`·`aud`·필수 클레임
→ `nonce` 일치 순으로 검사하고, 실패하면 400/401 을 준다. 상세 순서·응답은 `E2E_TEST_AND_BUGS.md` §5-6.

### 2.2 사용자 생성/갱신 (`create_or_update_user_from_oidc`)
- 식별자는 `loginid` 클레임 **하나만** 신뢰한다(없으면 로그인 실패). 처음 보는 loginid 는 `role='NONE'` 으로 생성된다.
- 재로그인 시 `mail` 은 클레임이 비면 기존 값을 유지하지만, `deptname`·`username` 은 **빈 값으로 덮어쓴다** ⚠️ (B-37, 미수정).
- 새 사용자는 권한관리 화면의 30초 폴링으로 목록에 나타난다(`docs/PERMISSION.md` §4).

### 2.3 refresh (`refresh_token_view`)
- 2026-10-26 부터 access 쿠키 상태(유효·만료·위조·없음)와 무관하게 refresh 쿠키가 유효하면 200(B-36).
  `AllowAny` 만으로는 부족하다 — 인증 클래스가 남아 있으면 만료된 access 쿠키에서 `AuthenticationFailed` 가
  먼저 나 403 이 된다. 그래서 `@authentication_classes([])` 를 함께 단다.
- refresh 쿠키 없음·만료·위조·`type != 'refresh'`·미등록 사용자 → 401.

---

## 3. 서버 인증 판정 (`CookieJWTAuthentication`)

| 쿠키 상태 | `authenticate()` 결과 | DRF 응답(IsAuthenticated 뷰) |
|---|---|---|
| 없음 | `None` (인증 안 함) | **403** |
| 만료 | `AuthenticationFailed('토큰이 만료되었습니다.')` | **403** |
| 위조·형식 오류 | `AuthenticationFailed('유효하지 않은 토큰입니다.')` | **403** |
| 사용자 조회 중 오류 | `AuthenticationFailed('인증 오류가 발생했습니다.')` | **403** |
| 정상 | `(user, token)` | 200 |

⚠️ **미인증이 401 이 아니라 403 이다.** 클래스에 `authenticate_header()` 가 없어서 DRF 가 401 을 403 으로 바꾼다
(같은 파일의 `ExternalApiKeyAuthentication` 에는 있다). 프론트(`client.ts`)는 401 만 SSO 로 보내므로,
운영에서 일반 API 가 SSO 리다이렉트를 일으키는 일은 사실상 없다. 검토 중인 항목 — `E2E_TEST_AND_BUGS.md` §5-8 "남은 것".

---

## 4. 프론트 흐름

### 4.1 첫 진입 (`AuthContext`)
- **운영**: `GET /api/auth/me/` 를 최대 5회 시도(네트워크 오류만 1·2·3·4초 간격 재시도, HTTP 오류는 즉시 중단).
  성공하면 로그인 상태, 실패하면 `LoginPage`(SSO 버튼 → `oidc/login/` 의 `redirect_url` 로 이동).
- **개발**: `localStorage['approval_system_user_id']` 의 사용자(없으면 목록 첫 사용자)로 `dev-login` 을 호출해 Bearer 를 저장.

### 4.2 API 호출 (`client.ts` `request()`)
- 항상 `credentials: 'include'`. 개발 모드에서만 `Authorization: Bearer` 를 붙인다.
- 응답이 **401** 이고 운영이며 경로가 `/auth/oidc/`·`/auth/dev-login/` 이 아니면 `redirectToSSO()` 후 영원히 대기하는 Promise 를 반환
  (중복 리다이렉트 방지 플래그 `isRedirectingToSSO`). 그 외 오류는 `Error('HTTP <code>: <error|detail>')` 로 던진다.

### 4.3 세션 유지·자동 로그아웃 (운영만)
- `useIdleTimer`: `mousemove`·`keydown`·`mousedown`·`scroll`·`touchstart` 가 없으면 **12시간** 뒤 `autoLogout`
  (`oidc/logout/` 호출 → 로그아웃 상태), 그 **10분 전** `SessionWarningModal` 표시.
- 모달의 '연장' → `extendSession()` → 타이머 리셋 + `POST /api/auth/refresh/`(실패는 `catch {}` 로 무시 ⚠️).
- ⚠️ 타이머는 **마지막 활동·페이지 로드** 기준이고 access 토큰은 **로그인(또는 마지막 refresh)** 기준이라 두 시계가 다르다.
  활동 중에는 refresh 를 호출하지 않으므로, 12시간 넘게 계속 쓰면 access 가 먼저 끝나 일반 API 가 403 을 받는다(§3).

---

## 5. 알려진 사항

| 항목 | 상태 | 원본 |
|---|---|---|
| 미인증 403 → SSO 리다이렉트 안 됨 | 검토 중 | §3, E2E §5-8 |
| 연장 버튼이 refresh 실패를 알리지 않음 | 미수정 | E2E §5-8 |
| 재로그인 시 이름·부서 빈 값 덮어쓰기 | 미수정 | E2E B-37 |
| 저장소 nginx 에 `/oidc-callback` POST 를 백엔드로 넘기는 location 이 없음 | 미결(운영 서버 설정 확인 필요) | E2E §5-6 |
| 로그에 OIDC 클레임(개인정보) 평문 | 미수정 | E2E B-35 |
| refresh 만료 후 동작 | ✅ 2026-10-26 | E2E B-36, §5-8 |
