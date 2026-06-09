# LOGIN.md — 로그인/인증 기능 가이드

## 개요

OIDC/ADFS SSO 기반 운영 인증 + 개발 환경용 username 단독 로그인 지원.
JWT 토큰(service_jwt)을 사용하며 access_token + refresh_token(HttpOnly Cookie) 방식이다.

---

## 관련 파일

### Backend
| 파일 | 역할 |
|------|------|
| `backend/api/auth_views.py` | OIDC SSO 핵심 로직 (nonce 생성, id_token 검증, 세션 생성) |
| `backend/api/auth_views_dev.py` | 개발 환경용 로그인 (username만으로 로그인 가능) |
| `backend/api/authentication.py` | 커스텀 JWT 인증 클래스 |
| `backend/api/models.py` | `UserProfile` 모델 |
| `backend/config/settings/base.py` | OIDC 설정 값 |

### Frontend
| 파일 | 역할 |
|------|------|
| `frontend/src/pages/LoginPage.tsx` | SSO 로그인 UI (ADFS 연동 버튼) |
| `frontend/src/pages/OIDCCallbackPage.tsx` | OIDC 콜백 처리 |
| `frontend/src/contexts/AuthContext.tsx` | 인증 상태 관리, 세션 타이머, 토큰 갱신 |
| `frontend/src/api/client.ts` | API 호출 시 토큰 헤더 주입 |
| `frontend/src/locales/ko.json` / `en.json` | `login.*` 키 |

---

## API Endpoints

| Method | URL | 설명 |
|--------|-----|------|
| POST | `/api/auth/oidc/login/` | OIDC 로그인 초기화 (nonce 생성, ADFS URL 반환) |
| POST | `/api/auth/oidc/callback/` | OIDC 콜백 처리 (id_token 검증, 세션 생성) |
| POST | `/api/auth/oidc/logout/` | OIDC 로그아웃 |
| POST | `/api/auth/dev-login/` | 개발 모드 로그인 (username 기반) |
| GET | `/api/auth/me/` | 현재 사용자 정보 조회 |
| POST | `/api/auth/refresh/` | Access Token 갱신 (Cookie 기반) |

---

## 주요 모델

### UserProfile
| 필드 | 타입 | 설명 |
|------|------|------|
| `loginid` | CharField | 사용자 로그인 ID (OIDC sub) |
| `username` | CharField | 사용자 이름 |
| `mail` | EmailField | 이메일 |
| `deptname` | CharField | 부서명 |
| `role` | CharField | 역할: `NONE` / `PL` / `TE_R` / `TE_P` / `TE_J` / `TE_O` / `TE_E` / `MASTER` |

---

## 주요 로직 및 제약 조건

- **Nonce 기반 CSRF 방어**: OIDC 로그인 시 nonce를 생성하고 callback에서 검증한다.
- **세션 타임아웃**: 12시간, 만료 10분 전 경고 팝업 표시.
- **토큰 갱신**: `AuthContext`에서 만료 전 자동 갱신 처리.
- **개발 모드**: `AUTH_MODE=dev`일 때 `auth_views_dev.py`가 동작하며 password 없이 로그인 가능.
- **역할 기본값**: 신규 사용자는 `role=NONE`으로 생성되며, MASTER가 권한을 부여한다.
- **운영 모드**: `AUTH_MODE=oidc`일 때 `auth_views.py`의 OIDC 플로우가 동작한다.

---

## 수정 시 주의사항

- OIDC 설정값 변경은 반드시 `.env` 파일에서만 한다. `settings.py` 직접 수정 금지.
- `authentication.py` 수정 시 전체 API 인증에 영향을 미치므로 반드시 사용자에게 보고 후 진행한다.
- `UserProfile.role` 값 추가/변경 시 `PermissionPage`, `ApprovalPage` 로직에 영향을 준다.
- 토큰 구조 변경 시 `client.ts`의 헤더 주입 로직도 함께 수정해야 한다.

---

## 완료 후 필수 처리

1. **이 파일(`docs/LOGIN.md`)을 반드시 최신 내용으로 업데이트한다.**
2. **`CLAUDE.md`를 다시 읽은 후 반드시 "다음 작업은 무엇인가요?" 라고 묻는다.**
