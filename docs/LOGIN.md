# 로그인 (ADFS OIDC SSO)

운영(`AUTH_MODE=sso`)은 ADFS OIDC **form_post** 로그인, 개발(`AUTH_MODE=dev`)은 드롭다운 로그인(`/api/auth/dev-login/`)이다.
이 문서는 **운영 SSO 흐름**의 동작·검증 규칙·설정을 정리한다. (관련 기록: `E2E_TEST_AND_BUGS.md` B-27 / B-28 / B-36)

## 1. 흐름

1. 프론트가 `GET /api/auth/oidc/login/` 호출 (`AuthContext.loginSSO` 또는 401 시 `client.ts` `redirectToSSO`)
2. 백엔드가 `nonce`·`state` 를 생성해 서명한 **`oidc_state` 쿠키**로 내려주고, ADFS URL(`redirect_url`)을 응답한다
   - 응답 본문에는 nonce/state 서명값(예전 `nonce_jwt`)이 **없다**
3. 브라우저가 ADFS 로 이동 → 인증
4. ADFS 가 `response_mode=form_post` 로 `https://<호스트>:10010/oidc-callback` 에 `id_token`·`code`·`state` 를 POST
5. nginx 가 `/oidc-callback` 을 백엔드 `POST /api/auth/oidc/callback/` 로 직접 전달한다 (SPA 는 관여하지 않는다)
6. 백엔드가 검증(§2) 후 사용자 생성/갱신 → `access_token`(12h)·`refresh_token`(7d) HttpOnly 쿠키 발급 → `/` 로 302

> `OIDCCallbackPage` 와 `localStorage['oidc_state_jwt']` 는 삭제되었다. SPA 는 form_post 본문을 읽을 수 없어 어떤 설정에서도 동작할 수 없는 코드였다.

## 2. 콜백 검증 규칙 (모두 fail-closed)

| 검증 | 규칙 | 실패 시 |
|---|---|---|
| 설정 | `OIDC_ISSUER`, `OIDC_RP_CLIENT_ID` 가 비어 있지 않아야 함 | 500 (로그인 불가) |
| 서명 | ADFS 인증서(RS256) | 401 |
| `exp` / `iss` / `aud` | 반드시 존재. `iss == OIDC_ISSUER`, `aud == OIDC_RP_CLIENT_ID` | 401 |
| `nbf` / `iat` | 있으면 검증 | 401 |
| 시계 오차 | leeway 60초 (`OIDC_ID_TOKEN_LEEWAY_SECONDS`) | - |
| `oidc_state` 쿠키 | 존재 + 서명 유효(SECRET_KEY, HS256) + 10분 이내 + `typ=oidc_state` | 400 |
| `state` | POST 된 `state` == 쿠키의 `state` | 400 |
| `nonce` | `id_token.nonce` == 쿠키의 `nonce` (id_token 에 nonce 가 없어도 거부) | 400 |

- `oidc_state` 쿠키는 성공·실패와 무관하게 콜백 응답에서 **삭제(1회용)** 된다.
- 쿠키 속성: `HttpOnly; Secure; SameSite=None; Path=/; Max-Age=600`.
  form_post 는 ADFS 에서 넘어오는 cross-site POST 라 `SameSite=Lax` 쿠키는 전달되지 않는다. 그래서 `None` 이며 HTTPS 필수다.
  Path 가 `/` 인 이유: 브라우저가 보는 콜백 경로가 `/oidc-callback` (nginx 재작성 전) 이기 때문이다.
- 서버 메모리(gunicorn 워커 2개 + LocMemCache)에 의존하지 않도록 nonce/state 를 쿠키에 담았다.

## 3. 인증 실패 응답 (`CookieJWTAuthentication`)

- 만료·서명 오류·사용자 없음 → **401** + `WWW-Authenticate: Bearer` (예전에는 `authenticate_header` 가 없어 403 이었다)
- 사용자 없음은 `return None`(익명 통과) 이 아니라 `AuthenticationFailed`
- `oidc_login_init` / `oidc_callback` / `oidc_logout` 은 `authentication_classes([])` — 잔존·만료 쿠키가 있어도 로그인 시작·로그아웃이 가능해야 한다
- 프론트 `client.ts`: 401 이면 ADFS 로 자동 리다이렉트. 단 `/auth/oidc/*`, `/auth/dev-login/*`, **`/auth/me/`** 는 제외
  - `/auth/me/` 제외 이유: 최초 진입(쿠키 없음)에서는 로그인 화면을 보여주고, 쿠키가 저장되지 않는 환경에서 ADFS 왕복 루프가 생기지 않게 한다

## 4. 설정값

| 변수 | 설명 |
|---|---|
| `OIDC_RP_CLIENT_ID` | ADFS 에 등록된 클라이언트 ID. id_token `aud` 검증에도 사용 |
| `OIDC_ISSUER` (**신규**, 필수) | id_token `iss` 기대값 (ADFS Federation Service 식별자). 미설정 시 로그인 거부 |
| `OIDC_OP_AUTHORIZATION_ENDPOINT` | ADFS 인증 URL |
| `OIDC_CALLBACK_BASE_URL` | `redirect_uri = <값>/oidc-callback` |
| `OIDC_CERT_FILE_PATH` / `OIDC_CERT_FILE_NAME` | id_token 서명 검증 인증서 |
| `SERVICE_JWT_SECRET_KEY` | 서비스 access/refresh JWT 서명 |

> **배포 전 필수**: 운영 `.env` 에 `OIDC_ISSUER` 를 추가한다. 값은 운영 로그의 `[OIDC] 토큰 Issuer (iss): ...` 줄과 **정확히 일치**해야 한다.
> `aud` 는 `OIDC_RP_CLIENT_ID` 와 같아야 한다. ADFS 가 다른 형식(예: `microsoft:identityserver:<client_id>`)으로 주면 로그인이 401 이 되므로 로그의 `토큰 Audience (aud)` 줄로 먼저 확인한다.

## 5. 테스트

- `backend/api/tests.py` — `OidcLoginSecurityTest`(nonce/state 쿠키, exp/nbf/aud/iss, 1회용 쿠키, 설정 누락),
  `CookieJwtAuthenticationTest`(401 + `WWW-Authenticate`, 사용자 없음이 익명 통과하지 않음)
- 실행: CLAUDE.md 규칙 C-1-1 의 sqlite 절차 → `manage.py test api.tests.OidcLoginSecurityTest api.tests.CookieJwtAuthenticationTest`

## 6. 알려진 한계 / 미적용

- **`code` 교환 미사용**: hybrid flow(`code+id_token`)지만 `code` 는 사용하지 않는다 (B-43).
- **`refresh_token_view`**: `IsAuthenticated` 라 access_token 이 만료되면 refresh 불가 (B-36, 미수정).
- id_token 에 nonce 를 넣지 않는 ADFS 설정이면 로그인이 400 이 된다 (OIDC hybrid flow 에서는 nonce 필수라 표준 ADFS 는 포함).
- 콜백의 JSON 요청 분기(`is_json_request`)는 예전 SPA 콜백 페이지용이다. 지금은 쓰이지 않지만 동일 검증을 거친다 (정리 여부는 별도 결정).
