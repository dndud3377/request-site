# LOGIN.md — 인증·세션 관리 가이드

> 이 문서는 이 프로젝트의 로그인 흐름, 토큰 구조, 세션 자동 만료 동작을 설명합니다.

---

## 1. 모드 구분

`REACT_APP_AUTH_MODE` 환경변수로 두 가지 인증 모드가 분기됩니다.

| 모드 | 값 | 사용 환경 |
|------|-----|----------|
| SSO (운영) | `sso` (기본값) | 운영 서버 — ADFS OIDC 인증 |
| Dev (개발) | `dev` | 로컬 개발 — 비밀번호 없이 유저 전환 |

백엔드 설정: `backend/config/settings/base.py`
```python
AUTH_MODE = os.environ.get('AUTH_MODE', 'sso')
```

---

## 2. 운영 모드 로그인 흐름 (ADFS OIDC)

```
브라우저 접속
    │
    ▼
AuthContext 초기화
    │  GET /api/auth/me/  (Cookie에 access_token 포함 시 즉시 복원)
    │  → 최대 5회 재시도 (HTTP 에러는 즉시 중단, 네트워크 오류는 backoff)
    │
    ├─ 성공 → 로그인 상태 복원 (재인증 불필요)
    │
    └─ 실패(401) → loginSSO() → redirectToSSO()
            │
            ▼
        GET /api/auth/oidc/login/
            │  nonce 생성 (UUID) → HS256 JWT로 서명 (10분 유효)
            │  ADFS 인증 URL 생성 (response_mode=form_post, response_type=code+id_token)
            │  nonce_jwt → localStorage('oidc_state_jwt') 저장
            ▼
        ADFS 로그인 페이지로 리다이렉트
            │
            ▼
        ADFS → form_post로 /oidc-callback 페이지에 id_token, state 전달
            │
            ▼
        OIDCCallbackPage.tsx
            │  localStorage에서 nonce_jwt 꺼냄
            │  POST /api/auth/oidc/callback/  { id_token, nonce_jwt }
            │
            ▼
        백엔드 oidc_callback()
            │  ADFS 인증서(.cer)로 id_token 서명 검증 (RS256)
            │  nonce_jwt로 nonce 값 비교 (CSRF 방지)
            │  OIDC 클레임 파싱 (loginid, mail, deptname 등)
            │  DB에 User 생성/업데이트
            │  Django 세션 로그인
            │
            ▼
        서비스용 JWT 2개 생성 (HS256, SERVICE_JWT_SECRET_KEY)
            ├─ access_token  → 12시간
            └─ refresh_token → 7일
            │
            ▼
        HttpOnly Cookie로 응답 (secure, samesite=Lax)
            ├─ Set-Cookie: access_token
            └─ Set-Cookie: refresh_token
            │
            ▼
        메인 페이지로 리다이렉트
```

---

## 3. 개발 모드 로그인 흐름

```
AuthContext 초기화
    │  localStorage('approval_system_user_id')에서 저장된 유저 ID 조회
    │  없으면 MOCK_USERS[0] (pl_user) 사용
    │
    ▼
POST /api/auth/dev-login/  { username }
    │  운영 환경(AUTH_MODE=sso)에서 호출 시 → 403 반환
    │  DB에서 loginid로 유저 조회
    │  djangorestframework-simplejwt로 JWT 쌍 생성
    ▼
{ access, refresh, user } JSON 응답
    │
    ▼
access 토큰 → localStorage('access_token') 저장
이후 API 요청 시 Authorization: Bearer <token> 헤더로 전송
```

유저 전환(Navbar DEV 드롭다운) 시에도 동일한 `/api/auth/dev-login/` 흐름을 반복합니다.

---

## 4. 토큰 구조

### 운영 모드 (서비스 JWT)

| 항목 | access_token | refresh_token |
|------|-------------|---------------|
| 알고리즘 | HS256 | HS256 |
| 서명 키 | `SERVICE_JWT_SECRET_KEY` | `SERVICE_JWT_SECRET_KEY` |
| 유효기간 | **12시간** | **7일** |
| 저장 위치 | HttpOnly Cookie | HttpOnly Cookie |
| 전달 방식 | Cookie 자동 포함 (`credentials: 'include'`) | Cookie 자동 포함 |
| 설정 위치 | `base.py` `SERVICE_JWT_ACCESS_TOKEN_LIFETIME` | `base.py` `SERVICE_JWT_REFRESH_TOKEN_LIFETIME` |

**access_token 페이로드:**
```json
{
  "sub": "...",
  "username": "loginid",
  "email": "...",
  "name": "...",
  "department": "...",
  "source": "internal-auth",
  "iat": "...",
  "exp": "..."
}
```

### 개발 모드 (simplejwt)

| 항목 | access_token |
|------|-------------|
| 알고리즘 | simplejwt 기본값 |
| 유효기간 | **12시간** (`SIMPLE_JWT.ACCESS_TOKEN_LIFETIME`) |
| 저장 위치 | localStorage(`access_token`) |
| 전달 방식 | `Authorization: Bearer <token>` 헤더 |

---

## 5. 인증 미들웨어 (백엔드)

`api/authentication.py` — `CookieJWTAuthentication`

1. `request.COOKIES.get('access_token')` 으로 토큰 추출
2. `SERVICE_JWT_SECRET_KEY`로 서명 검증 (`verify_exp: True`)
3. `payload['username']`으로 `User.objects.get(loginid=username)` 조회
4. 만료 시 `AuthenticationFailed('토큰이 만료되었습니다.')` → 401 반환

`REST_FRAMEWORK` 설정에서 `CookieJWTAuthentication`이 `JWTAuthentication`보다 먼저 등록되어 있어 운영 모드에서 우선 적용됩니다.

---

## 6. 토큰 갱신

**엔드포인트:** `POST /api/auth/refresh/`

- Cookie의 `refresh_token`을 읽어 검증 후 새 `access_token`을 Cookie에 발급
- 프론트엔드에서는 "세션 연장" 버튼 클릭 시 자동 호출 (`authAPI.refresh()`)
- 개발 모드에서는 사용하지 않음

---

## 7. 세션 자동 만료 (무활동 기반)

### 동작 방식

- **기준:** 마지막 사용자 활동(마우스 이동, 클릭, 키보드 입력, 스크롤, 터치)으로부터 **12시간** 무활동
- **경고:** 만료 **10분 전** 중앙 모달 팝업 표시
- **적용 범위:** 운영 모드(`AUTH_MODE=sso`)에서만 동작. 개발 모드는 비활성화

### 흐름

```
로그인
    │
    ▼
useIdleTimer 시작 (SESSION_TIMEOUT_MS = 12h, WARN_BEFORE_MS = 10min)
    │  사용자 활동 감지 시 타이머 리셋
    │
    ├─ 11시간 50분 무활동 → SessionWarningModal 표시 (10:00 카운트다운)
    │       │
    │       ├─ "세션 연장" 클릭
    │       │     → 모달 닫힘
    │       │     → 타이머 리셋
    │       │     → POST /api/auth/refresh/ (토큰 갱신)
    │       │
    │       └─ "로그아웃" 클릭 또는 10분 추가 무활동
    │             → POST /api/auth/oidc/logout/ (서버 Cookie 삭제)
    │             → 클라이언트 상태 초기화
    │             → 로그인 페이지 표시
    ▼
자동 로그아웃 (isLoggedIn = false → LoginPage 렌더링)
```

### 관련 파일

| 파일 | 역할 |
|------|------|
| `frontend/src/hooks/useIdleTimer.ts` | 무활동 감지 훅 (경고 콜백 + 만료 콜백) |
| `frontend/src/components/SessionWarningModal.tsx` | 경고 모달 UI |
| `frontend/src/contexts/AuthContext.tsx` | 타이머 연결, `extendSession`, `autoLogout` |
| `frontend/src/App.tsx` | `SessionWarningModal` 렌더링 |

### 개발 모드에서 빠른 테스트 방법

`AuthContext.tsx` 상단 상수를 임시로 변경:
```ts
const SESSION_TIMEOUT_MS = 30 * 1000;  // 30초
const WARN_BEFORE_MS = 10 * 1000;      // 10초 전 경고
```

---

## 8. 로그아웃

### 수동 로그아웃 (Navbar)

`Navbar.tsx` → `handleLogout()`

```
POST /api/auth/oidc/logout/
    │  Django 세션 종료
    │  access_token Cookie 삭제 (max_age=0)
    │  refresh_token Cookie 삭제 (max_age=0)
    ▼
window.location.href = '/?logged_out=true'
```

### 자동 로그아웃 (세션 만료)

`AuthContext.tsx` → `autoLogout()`

```
POST /api/auth/oidc/logout()  (서버 Cookie 삭제)
    ▼
clearToken()          (localStorage dev 토큰 삭제)
setIsLoggedIn(false)  (React 상태 → LoginPage 표시)
setCurrentUser(EMPTY_USER)
```

---

## 9. 접속 시간별 동작 요약

| 상황 | 동작 |
|------|------|
| 최초 접속 (Cookie 없음) | `/api/auth/me/` 401 → ADFS 리다이렉트 |
| 로그인 후 12시간 이내 재접속 | Cookie 유효 → 즉시 로그인 복원 |
| 무활동 11시간 50분 | 경고 모달 표시 (10분 카운트다운) |
| 무활동 12시간 (경고 무시) | 자동 로그아웃 → 로그인 페이지 |
| "세션 연장" 클릭 | 타이머 리셋 + 토큰 갱신 → 12시간 연장 |
| refresh_token 만료 (7일 경과) | 세션 연장 실패 → ADFS 재인증 필요 |
| 브라우저 종료 후 재접속 | HttpOnly Cookie 유지 → 유효기간 내면 복원 |

---

## 10. 주요 설정값 위치

```
backend/config/settings/base.py
  SERVICE_JWT_ACCESS_TOKEN_LIFETIME  = timedelta(hours=12)  # access_token 수명
  SERVICE_JWT_REFRESH_TOKEN_LIFETIME = timedelta(days=7)    # refresh_token 수명
  SERVICE_JWT_SECRET_KEY             = env('SERVICE_JWT_SECRET_KEY')
  SERVICE_JWT_ALGORITHM              = 'HS256'
  AUTH_MODE                          = env('AUTH_MODE', 'sso')

  SIMPLE_JWT (개발 모드용)
    ACCESS_TOKEN_LIFETIME  = timedelta(hours=12)
    REFRESH_TOKEN_LIFETIME = timedelta(days=7)

frontend/src/contexts/AuthContext.tsx
  SESSION_TIMEOUT_MS = 12 * 60 * 60 * 1000  # 무활동 만료 기준 (12시간)
  WARN_BEFORE_MS     = 10 * 60 * 1000        # 경고 표시 시점 (10분 전)
```

---

*이 파일은 인증 관련 변경 시 함께 업데이트해 주세요.*
