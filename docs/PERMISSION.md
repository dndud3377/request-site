# PERMISSION.md — 권한 관리 기능 가이드

## 개요

사용자 역할(role) 부여 및 그룹 관리 기능이다.
MASTER가 `role=NONE` 사용자에게 역할을 부여하고, 역할별 그룹을 생성/관리한다.
권한 변경은 SSE(Server-Sent Events)를 통해 실시간으로 브로드캐스트된다.

---

## 관련 파일

### Backend
| 파일 | 역할 |
|------|------|
| `backend/api/models.py` | `UserProfile`, `UserGroup` 모델 |
| `backend/api/views.py` | `UserViewSet`, `UserGroupViewSet`, `user_events()` (SSE) |
| `backend/api/serializers.py` | `UserSerializer`, `UserGroupSerializer` |
| `backend/api/sse.py` | SSE 브로드캐스터 |

### Frontend
| 파일 | 역할 |
|------|------|
| `frontend/src/pages/PermissionPage.tsx` | 사용자 관리, 역할 부여, 그룹 관리 전체 |
| `frontend/src/contexts/AuthContext.tsx` | 로컬 권한 상태 반영 (SSE 수신) |
| `frontend/src/locales/ko.json` / `en.json` | `permission.*` 키 |

---

## API Endpoints

| Method | URL | 설명 |
|--------|-----|------|
| GET | `/api/users/` | 사용자 목록 |
| POST | `/api/users/` | 사용자 생성 |
| DELETE | `/api/users/{id}/` | 사용자 삭제 |
| GET | `/api/users/for-assignment/` | 역할 부여 대상 (role=NONE) |
| POST | `/api/users/{id}/assign-role/` | 역할 부여 |
| GET | `/api/users/events/` | SSE 스트림 (권한 변경 실시간 브로드캐스트) |
| GET | `/api/user-groups/` | 그룹 목록 (현재 사용자가 멤버인 것만) |
| POST | `/api/user-groups/` | 그룹 생성 |
| PATCH | `/api/user-groups/{id}/` | 그룹 수정 |
| DELETE | `/api/user-groups/{id}/` | 그룹 삭제 |
| GET | `/api/user-groups/{id}/available-members/` | 추가 가능 멤버 |
| POST | `/api/user-groups/{id}/add-member/` | 멤버 추가 |
| POST | `/api/user-groups/{id}/remove-member/` | 멤버 제거 |

---

## 주요 모델

### UserProfile
| 필드 | 타입 | 설명 |
|------|------|------|
| `loginid` | CharField | 로그인 ID |
| `username` | CharField | 이름 |
| `mail` | EmailField | 이메일 |
| `deptname` | CharField | 부서명 |
| `role` | CharField | `NONE` / `PL` / `TE_R` / `TE_P` / `TE_J` / `TE_O` / `TE_E` / `MASTER` |

### UserGroup
| 필드 | 타입 | 설명 |
|------|------|------|
| `name` | CharField | 그룹명 |
| `creator_fk` | FK | 그룹 생성자 (UserProfile) |
| `members` | M2M | 그룹 멤버 (UserProfile) |
| `created_at` | DateTimeField | 생성 일시 |

---

## 주요 로직 및 제약 조건

- **역할 체계**: `NONE`(기본) → MASTER가 `PL` / `TE_R` / `TE_P` / `TE_J` / `TE_O` / `TE_E` / `MASTER` 중 하나 부여.
- **그룹 멤버 제한**: creator와 동일 role인 사용자만 그룹 멤버로 추가 가능.
- **그룹 조회 범위**: 현재 사용자가 멤버인 그룹만 조회 가능 (MASTER 예외 여부 확인 필요).
- **SSE 브로드캐스트**: 역할 변경 시 `sse.py`의 브로드캐스터를 통해 모든 연결된 클라이언트에 실시간 전송.
- **전체 사용자 관리**: MASTER 역할만 모든 사용자를 조회/관리할 수 있다.

---

## 수정 시 주의사항

- `UserProfile.role` 값 추가/변경 시 `APPROVAL.md`의 결재 플로우, `REQUEST.md`의 PLEL 조건에 영향을 미친다.
- SSE 연결(`/api/users/events/`) 수정 시 `AuthContext.tsx`의 SSE 수신 로직도 함께 확인한다.
- 그룹 멤버 추가 권한 로직 변경 시 `available-members` 엔드포인트의 필터 조건을 함께 수정한다.
- `UserSerializer` 수정 시 로그인 응답(`/api/auth/me/`)에도 영향을 줄 수 있다.

---

## 완료 후 필수 처리

1. **이 파일(`docs/PERMISSION.md`)을 반드시 최신 내용으로 업데이트한다.**
2. **`CLAUDE.md`를 다시 읽은 후 반드시 "다음 작업은 무엇인가요?" 라고 묻는다.**
