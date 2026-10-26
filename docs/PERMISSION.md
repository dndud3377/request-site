# PERMISSION — 역할·권한 관리 (PermissionPage)

> 작성일: 2026-10-26
> 목적: 역할 체계와 권한관리 화면의 **실제 구현 동작**을 기록한다. 의도와 구현이 일치하는지 검증할 때
> 이 문서를 기준으로 확인한다. (⚠️ 표시는 "확인이 필요"하거나 "알려진 문제"인 부분이다.)
> 로그인·인증은 `docs/LOGIN.md`, 결재 경로별 역할은 `docs/APPROVAL.md` 가 원본이다.

- 프론트 라우트: `/permissions`
- 진입 컴포넌트: `frontend/src/pages/PermissionPage.tsx`
- 메뉴 노출: `frontend/src/components/Navbar.tsx` (`ROLE_PERMISSIONS`), 라우트 가드: `frontend/src/App.tsx` (`ProtectedRoute`)
- 백엔드: `backend/api/views.py` (`UserViewSet`, `UserGroupViewSet`, `IsMasterOrReadOnly`), `backend/api/models.py` (`UserProfile`, `UserGroup`)

---

## 1. 역할

`UserProfile.role` — `NONE` / `PL` / `PL_GL` / `TE_R` / `TE_P` / `TE_J` / `TE_O` / `TE_E` / `MASTER`.

| 역할 | 뜻 |
|---|---|
| `NONE` | 역할 없음. SSO 최초 로그인 시 자동 생성되는 상태. 홈(`/`)만 접근 |
| `PL` / `PL_GL` | 국내 / 해외 제품 담당자. 권한은 같고 **의뢰서 조회 범위만** 다르다(`PL_GL` 은 해외 문서와 본인 문서만) |
| `TE_R`·`TE_P`·`TE_J`·`TE_O`·`TE_E` | 결재 단계별 담당(R·P·J·O·E). 구역 구성은 `CLAUDE.md` 용어 정리·`docs/APPROVAL.md` §2 |
| `MASTER` | 관리자. 역할 변경·사용자 관리 전권 |

- 메뉴: `NONE` 은 `/` 만, 나머지 역할은 전부 같은 9개 페이지(`/`, `/request`, `/approval`, `/change-status`, `/history`,
  `/voc`, `/guide`, `/permissions`, `/address-book`).
- `ProtectedRoute` 는 `role === 'NONE'` 이면 `/` 로 돌려보낸다.

### 1.1 사용자 필드 (권한관리 화면이 다루는 것)

| 필드 | 뜻 |
|---|---|
| `loginid` / `username`(표시 이름) / `deptname` / `mail` | SSO 클레임에서 채운다(`docs/LOGIN.md` §2.2) |
| `role_assigned_at` | 역할이 마지막으로 배정된 시각. '최근 추가순' 정렬용. `NONE` 으로 회수하면 비운다 |
| `receive_all_mail` (기본 True) / `mail_lines` | 라인별 메일 수신. 대상 역할은 `MAIL_LINE_FILTER_ROLES` = `TE_R`·`TE_P`·`TE_J`·`TE_O`·`TE_E`·`MASTER` |
| `receive_voc_mail` (기본 True) | VOC 등록 알림. `MASTER` 만 의미 있음 |
| `receive_submit_mail` (기본 False) | 상신 알림(통보처와 같은 메일). `TE_P` 만 의미 있음 |

---

## 2. API

### 2.1 사용자 (`/api/users/`, `UserViewSet`, 페이지네이션 없음)

| 메서드 | 경로 | 권한 | 동작 |
|---|---|---|---|
| GET | `/api/users/` (`?role=`) | 운영: 로그인 / 개발: 허용 | 전체(또는 역할별) 사용자 목록 |
| GET | `/api/users/for-assignment/` (`?role=`) | 같음 | 추가 후보. MASTER + `role` → 그 역할이 **아닌** 전체, 그 외 → `NONE` 사용자만 |
| POST | `/api/users/` | MASTER | loginid 로 사용자 생성 |
| POST | `/api/users/{id}/assign-role/` | 로그인 | 역할 변경 (§3) |
| PATCH | `/api/users/{id}/mail-lines/` | 로그인 | `{receive_all: true}` 또는 `{receive_all: false, lines: [...]}` (§3) |
| PATCH | `/api/users/{id}/voc-mail/` | 로그인 | `{receive_voc_mail: bool}` — 대상이 MASTER 가 아니면 400 |
| PATCH | `/api/users/{id}/submit-mail/` | 로그인 | `{receive_submit_mail: bool}` — 대상이 TE_P 가 아니면 400 |
| DELETE | `/api/users/{id}/` | 로그인 | 삭제 (§3). 없는 사용자 404, 삭제 실패 400 고정 문구 |

### 2.2 나만의 그룹 (`/api/user-groups/`, `UserGroupViewSet`)

| 메서드 | 경로 | 동작 |
|---|---|---|
| GET | `/api/user-groups/` | **본인이 멤버인** 그룹만 |
| POST | `/api/user-groups/` | 생성(`NONE` 은 403). 생성자가 자동으로 멤버가 된다 |
| PATCH / DELETE | `/api/user-groups/{id}/` | 이름 변경 / 삭제 — 생성자가 아니어도 **멤버면 누구나** 가능(멤버가 아니면 404) |
| GET | `/api/user-groups/{id}/available-members/` | 생성자와 **같은 역할**이면서 아직 멤버가 아닌 사용자 |
| POST | `/api/user-groups/{id}/add-member/` · `remove-member/` | `{user_id}`. 생성자와 다른 역할은 추가 400 |

그룹은 메일 수신자가 아니다 — 상신 모달에서 통보처를 한꺼번에 넣거나, 임시저장 문서를 그룹 멤버에게 공유(`shared_group`)할 때 쓴다.

---

## 3. 권한 규칙

| 동작 | MASTER | `PL`·`PL_GL`·`TE_*` | `NONE` |
|---|---|---|---|
| 역할 변경 (`assign-role`) | 누구든 어떤 역할로든(`NONE` 회수 포함) | 대상이 `NONE` 이고, **자기 역할로만** 부여 | 403 |
| 사용자 삭제 | 제한 없음 ⚠️(코드상 본인 삭제도 막지 않는다 — 실행 확인 안 함) | **같은 역할** 사용자만, 본인 제외 | 403 |
| 메일 설정 3종 | 누구 것이든 | **본인 것만** | 본인 것만(대상 역할이 아니면 400) |
| 사용자 생성 (`POST /api/users/`) | 가능 | 403 | 403 |

- 역할 변경은 `role_assigned_at` 도 갱신한다(`NONE` 이면 비움). 응답은 행 전체(메일 설정 포함)라 프론트가 행을 통째로 교체한다.

---

## 4. 화면 흐름

### 4.1 역할 탭
- 상단 탭은 역할별(`NONE` 포함). 탭마다 검색(loginid·이름·부서), '최근 추가순' 정렬(`role_assigned_at`, 없으면 뒤로).
- 수정 가능 탭: `NONE` 이 아니고, MASTER 이거나 **자기 역할 탭**일 때(`canModifyTab`).
- **사용자 추가**: 후보(`for-assignment`)에서 여러 명을 골라 일괄 부여. MASTER 는 대상 역할을 고르고, 나머지는 자기 역할로만.
  일부 실패 시 `permission.add_partial_success` 토스트.
- **이메일 설정 컬럼**: 대상 역할에만 보인다 — 라인별 수신(전체 받기/라인 선택), MASTER 의 VOC 토글, TE_P 의 '상신 받기' 토글.
  끄는 동작은 확인 모달을 거친다.
- **삭제**: 확인 모달 후 `DELETE`.

### 4.2 나만의 그룹
- 본인이 멤버인 그룹만 보인다. 그룹 생성은 **자기 역할 탭**에서만 가능하고, MASTER 와 `NONE` 은 화면에 생성 버튼이 없다
  (`canCreateGroup`. 백엔드는 MASTER 생성을 막지 않는다).

### 4.3 다른 사용자의 변경 반영 — 30초 폴링 (2026-10-26, SSE 대체)
- 화면이 열려 있는 동안 `users/` 와 `users/for-assignment/` 를 **30초마다** 다시 조회한다(`USERS_POLL_INTERVAL_MS`).
- 로딩 표시 없이 목록만 바꾼다. 조회가 실패하면 **기존 목록을 그대로 둔다**(토스트 없음).
- 탭이 숨겨진 동안(`document.visibilityState !== 'visible'`)은 건너뛰고, 다시 보이면 즉시 1회 조회한다.
- 예전 SSE(`/api/users/events/`)는 워커별 메모리 브로드캐스트라 다른 워커 탭에 이벤트가 유실됐고 연결마다 스레드를 점유해
  제거했다 — `E2E_TEST_AND_BUGS.md` §5-8.
- ⚠️ 역할을 바꾼 순간 이미 나가 있던 폴링 응답이 늦게 도착하면 다음 폴링(최대 30초)까지 이전 목록이 보일 수 있다.

---

## 5. i18n

`permission.*`(역할 탭·추가·삭제·메일 설정 문구), `group.*`(나만의 그룹). 백엔드 오류 응답의 한글 고정 문구
(예: `'사용자 삭제 중 오류가 발생했습니다.'`)는 토스트에 그대로 표시된다 ⚠️ — 앱 전역 기존 패턴(검토 항목 E).

---

## 6. 알려진 사항

| 항목 | 상태 | 원본 |
|---|---|---|
| 사용자 삭제가 진행 중 결재 담당자·그룹 생성자 여부를 보지 않음 | 미수정 | E2E R-14, B-30, B-31 |
| 그룹 생성자 삭제 시 그룹 CASCADE 삭제 | 미수정 | E2E B-31 |
| 액세스 토큰 만료 후 폴링이 403 으로 조용히 실패 → 목록 갱신이 멈춤 | 검토 중 | `docs/LOGIN.md` §3 |
| SSE 워커 간 유실·스레드 점유 | ✅ 2026-10-26 폴링으로 대체 | E2E §5-8 |
