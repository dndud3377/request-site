# E2E_TEST_AND_BUGS — 전 기능 CASE별 테스트 시나리오 & 버그·잠재위험 리포트

> 작성일: 2026-07-28 · 작업 브랜치: `claude/project-testing-bug-review-jnygop`
> 범위: **의뢰서 작성 → 임시저장 → 상신 → 결재(전 단계) → 반려/재상신 → 중단/재개 → 승인 → 이력 조회**
> 전 구간 + 부가 기능(권한관리 / VOC / 공지 / 가이드 / 주소록 / 메일 / 외부 API).
> 성격: 이 문서 하나로 **(1) 무엇을 어떻게 클릭해서 검증하는지**와 **(2) 지금 어떤 버그가 있는지**를 모두 본다.
>
> **기존 문서와의 관계** (규칙 E — 같은 역할 파일 확인 결과)
> - `docs/audit/REQUEST_AUDIT.md` : **의뢰서 작성 페이지 1개**의 기능 카탈로그 + 버그 (페이지 단위)
> - `docs/VERIFICATION.md` : **특정 브랜치 변경분**의 검증 체크리스트 (변경 단위)
> - `docs/FIX_PROGRESS.md` : 과거 수정 작업의 진행 기록
> - **이 문서** : **페이지를 가로지르는 E2E 흐름 단위**의 CASE 테스트 + 교차 조합 + 신규 버그 (역할 중복 없음)
>
> ⚠️ 이 문서의 버그 항목 중 `재현✅` 표시는 **당시 세션에서 Django 테스트로 실제 실행해 결과를 확인**한 것이고,
> `분석🔍` 표시는 코드 정독으로 도출했으나 런타임 실행까지는 하지 못한 것이다. 근거를 각 항목에 명시했다.
>
> 📌 **2026-08-04 갱신** — 코드가 여러 차례 바뀌어 문서의 `파일:라인` 참조가 실제와 어긋나 있었다.
> **전 항목의 코드 위치를 현재 코드 기준으로 재검증·정정**했고, 함께 수행한 3차 정독
> (**`additional_notes` 저장 정합성** 집중)에서 나온 신규 8건을 **§5-4** 에 추가했다.
> 라인 번호는 다시 밀린다 — 위치는 **함수/심볼 이름을 먼저 적고 라인은 보조**로 병기한다.

---

## 0. 요약 (먼저 읽을 것)

> **2차 정독(2026-07-28 추가)**: 1차에서 다루지 못한 **OIDC 인증 / 파일 업로드 / 메일 본문 렌더 /
> 사용자 삭제 파급 / nginx·설정** 영역을 전수 정독하고 재현 테스트 19건을 추가 실행했다.
> 여기서 **치명 3건이 더** 나왔다(저장형 XSS 권한상승 체인, id_token 만료검증 비활성화, nonce/state 검증 우회).

| 구분 | 1차 | 2차 추가 | 3차 추가 | 합계 | 비고 |
|------|-----|---------|---------|------|------|
| 🔴 치명 (Critical) | 4 | **+3** | 0 | **7** (1건 수정완료) | 인가 부재 삭제 / PAUSE 우회 / 미인증 업로드 / **저장형 XSS→권한상승** / **토큰 재사용** / **CSRF** |
| 🟠 높음 (High) | 6 | **+6** | **+3** | **15** | 담당자 계정 삭제 시 결재 교착, 그룹 CASCADE 소실, 중단요청 고착, **후결자 소실**, **필터 행 소실** 등 |
| 🟡 중간 (Medium) | 8 | **+7** | **+4** | **19** | 세션 갱신 불가, PII 로깅, 통계 노출, **detail 유령값 2종**, **blob 덮어쓰기** 등 |
| ⚪ 낮음/위생 (Low) | 7 | **+7** | **+1** | **15** | 하드코딩, `any` 83건, 데드코드, 취약한 휴리스틱 |
| **합계** | 25 | **+23** | **+8** | **56** | |

> 3차(2026-08-04)는 **`additional_notes` 저장 정합성**만 파고들었다 — "저장되면 안 되는 값이 남는가 / 저장돼야 하는 값이
> 사라지는가". 결과는 §5-4 (B-57 ~ B-64). 신규 8건 중 **4건이 값 소실**(B-57·58·59·61),
> **2건이 유령값**(B-60·64), 1건이 blob 덮어쓰기(B-62), 1건이 크래시(B-63)다.

**즉시 조치 권고 TOP 5** (전부 재현✅)
1. **[B-26] 저장형 XSS → MASTER 권한 탈취** — 역할 `NONE` 사용자가 VOC 내용에 임의 HTML/스크립트를 저장할 수 있고,
   그것을 열람한 MASTER의 세션으로 `assign-role` 이 호출되면 **공격자가 MASTER로 승격**된다. sanitizer 의존성 자체가 없다.
2. **[B-27] OIDC id_token 만료 검증이 꺼져 있다** (`verify_exp: False`) — 한 번 유출된 id_token으로 **기한 없이 로그인** 가능.
3. ~~**[B-01] 의뢰서 삭제 인가 전무**~~ → ✅ **수정 완료**(2026-07-28, `03b2240`) — 인가 적용 + REST DELETE 405 차단.
4. **[B-06] PAUSE 동결 우회** — 중단(pause) 문서에서 PL 합의/반려가 그대로 동작해 결재가 되살아난다.
5. **[B-02+B-34] 미인증 업로드 + 무방비 `/media/` 서빙** — 비로그인으로 스크립트 포함 `.svg` 업로드 → 같은 오리진에서 실행.

> 1~5는 서로 맞물린다. B-02로 올린 `.svg`를 B-34가 실행 가능하게 서빙하고, 그 스크립트가 B-01로 문서를 지우거나
> B-26의 경로로 권한을 올린다. **개별 패치가 아니라 한 묶음으로 처리**할 것을 권한다.

**데이터 정합성 즉시 조치 권고 (3차, 2026-08-04)** — 보안 TOP5 와 별개 트랙이다.
1. **[B-57] 추가 후결자 소실** — C가문이 아닌 문서에서 `add-post-approver` 로 넣은 후결자가
   재상신/재개/PL수정후상신 저장 한 번에 `detail.post_approvers = []` 로 지워져, 재상신 후 **RA 단계가 안 생긴다.**
2. **[B-58] 필터로 가려진 J/O 행이 상신 시 문서에서 빠진다** — 게다가 필터 정의는 `localStorage` 에만 있어
   **같은 문서를 다른 PC 에서 상신하면 저장 결과가 달라진다.**
3. **[B-59] 고아 bb 행** — 필터 비활성화 경로만 `unmapJayerRows` 를 부르지 않아, 원본 J행이 없는 bb 행이 저장된다.

---

## 1. 테스트 환경 준비

### 1.1 구동
```bash
cd /home/user/request-site
docker compose -f docker-compose.dev.yml up -d
docker ps --format "{{.Names}}"        # backend/frontend 컨테이너명 확인
```
- 접속: **http://localhost:10011**
- 개발 로그인은 `AuthContext.MOCK_USERS` 기준 (Navbar 우측 사용자 전환)

### 1.2 필요한 계정 (역할별 최소 1명, 병렬/다중 검증엔 2명 이상)

| 역할 | 개발 계정(예) | 이 문서에서 쓰는 표기 |
|------|--------------|----------------------|
| PL (제품담당자·의뢰자) | `pl_user` | **PL-A**(작성자), **PL-B**(지정 PL), **PL-C**(2번째 지정 PL) |
| TE_R (RFG) | `agent_r1~r3` | **R-1**, **R-2**(검토자 RV용) |
| TE_P | `agent_p1~p3` | **P-1**, **P-2**(검토자 PV용) |
| TE_J | `agent_j1~j3` | **J-1** |
| TE_O | `agent_o1~o3` | **O-1** |
| TE_E | `agent_e1~e3` | **E-1** |
| MASTER | `master` | **M** |

> PL-B / PL-C 는 **PL-A 본인이 아니어야** 한다(`_resolve_designated_pls` 가 본인 지정을 400 으로 막음).

### 1.3 `.env` 선행 확인 (안 하면 결재가 멈추거나 조용히 건너뛴다 — §5 R-03 참조)
```bash
grep -E "POST_APPROVER_LOGINID|MAIL_REDIRECT_TO|DXHUB_MAIL_URL|EXTERNAL_API_KEY" .env
```
- `POST_APPROVER_LOGINID` : **RFG 팀(TE_R) loginid**. 비어 있으면 후결자(RA)가 아예 안 생기고,
  **Only MAP 의뢰서는 R 합의 즉시 `approved`** 로 끝나 후결 단계가 통째로 사라진다(재현✅ B-04).
- `MAIL_REDIRECT_TO` : 설정 시 **모든 결재 메일이 이 주소 하나로** 간다(검증용). 운영 반영 전 반드시 비운다.

### 1.4 자동 테스트 실행

**백엔드** (컨테이너 안)
```bash
docker exec -it <backend> python manage.py test api -v 2
```

#### 1.4.1 Docker·MySQL 없이 백엔드 테스트 돌리기 (검증된 레시피 — 2026-08-04 실행 성공)

원격 세션처럼 **docker 데몬도 MySQL 도 없는 환경**에서도 전체 백엔드 테스트가 돈다.
아래는 실제로 성공한 순서다. **프로젝트 파일은 하나도 건드리지 않는다**(전부 프로젝트 밖에 만든다).

```bash
SP=/tmp/e2e            # 아무 작업 디렉터리(프로젝트 밖)
mkdir -p $SP/stubs && python3 -m venv $SP/venv

# 1) 의존성 — requirements.txt 를 그대로 쓰지 않는다.
#    mysqlclient 는 libmysqlclient-dev + gcc 가 필요해 실패하고, sqlite 로 돌리므로 불필요하다.
#    requirements.txt 에 없는 mozilla-django-oidc / PyJWT 는 INSTALLED_APPS·auth_views 가 쓰므로 반드시 넣는다.
$SP/venv/bin/pip install -q \
  Django==4.2.13 djangorestframework==3.15.1 django-cors-headers==4.3.1 \
  djangorestframework-simplejwt==5.3.1 Pillow==10.3.0 python-dotenv==1.0.1 \
  django-filter==24.2 django-apscheduler==0.6.2 pandas==2.2.2 sqlalchemy==2.0.30 \
  requests==2.31.0 pymysql==1.1.1 mozilla-django-oidc PyJWT

# 2) 사내 전용 모듈 스텁 — utils.py 가 import 하므로 없으면 죽는다.
cat > $SP/stubs/datacenterquery.py <<'EOF'
def login(*a, **k):   raise RuntimeError('stub: 테스트에서 호출되면 안 된다')
def getData(*a, **k): raise RuntimeError('stub: 테스트에서 호출되면 안 된다')
EOF

# 3) sqlite 테스트 설정
cat > $SP/stubs/test_settings.py <<'EOF'
from config.settings.base import *
DEBUG = True
DATABASES = {'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'}}
EOF

# 4) 실행
cd backend && PYTHONPATH=$SP/stubs DJANGO_SETTINGS_MODULE=test_settings \
  $SP/venv/bin/python manage.py test api
```
- 소요: pip 설치 **약 20초**, 테스트 실행 **약 4초**.
- `staticfiles.W004`(static 디렉터리 없음) 경고 1건은 무해하다.
- **임시 재현 테스트를 붙이려면** `$SP/stubs/` 에 `verify_xxx.py` 를 두고
  `manage.py test verify_xxx` 로 부르면 된다 — 프로젝트의 `api/tests.py` 를 오염시키지 않는다.
  (§5-4 의 B-06·B-32·B-57·B-63 재현이 이 방식으로 확인됐다.)

**프론트엔드** (검증된 레시피 — 2026-08-04 실행 성공)
```bash
cd frontend && npm ci                                               # 약 30초, 1667 packages
CI=true npx react-scripts test --watchAll=false --passWithNoTests    # 67건 통과
npx tsc --noEmit 2>&1 | grep -c "error TS"                          # 24 (baseline 47 → 감소)
```

### 1.5 실행 결과

#### 2026-08-04 (3차) 실행 결과 — **백엔드·프론트 모두 실행 성공**

> 처음엔 "Django 미설치 → 실행 불가" 로 판단했으나, **§1.4.1 레시피로 전부 돌릴 수 있었다.**
> docker 데몬만 없을 뿐 pypi·npm 은 열려 있다. 아래는 실제 출력이다.

**백엔드** — `manage.py test api` (sqlite)
```
Ran 167 tests in 3.993s
FAILED (failures=2, errors=1)
```
| 실패 테스트 | 판정 |
|---|---|
| `ExternalApiKeyAccessTest.test_wrong_key_returns_401` → `AssertionError: 403 != 401` | **B-19 여전히 red** |
| `MessageBuildingTest.test_broadcast_subject_has_no_name_prefix` | **B-22 여전히 red** |
| `HybridImmediateSendTest.test_enqueue_schedules_immediate_send_on_commit` → `AttributeError: 'NoneType'` | **B-23 여전히 red** |

> ⇒ **1차(2026-07-28)에 지적한 3건이 그대로 남아 있다.** 테스트가 75 → 167건으로 늘어나는 동안
> 이 3건은 손대지 않았다는 뜻이며, **CI 가 여전히 돌지 않는다는 신호**다.

**프론트엔드**
```
Test Suites: 2 passed, 2 total      (terminology.test.ts, RequestPage/helpers.test.ts)
Tests:       67 passed, 67 total
npx tsc --noEmit | grep -c "error TS"  →  24
```
- 1차 문서의 "테스트 파일 없음 → 통과" 서술은 **현재와 다르다** — 실제로 **67건이 존재하고 전부 통과**한다.
- `tsc` 오류 24건 내역 (baseline 47 → 24 로 감소)

| 유형 | 건수 | 비고 |
|---|---|---|
| **미정의 i18n 키**(TS2345) | **16** | `request.btn_all_*`·`btn_reset` 12 / `profile.*` 3 / `guide.search_placeholder` 1 → **B-14 를 타입체커가 이미 잡고 있다** |
| `Set` 반복(TS2802, `--downlevelIteration`) | 6 | `index.tsx` 4 · `PagedDetailView` 1 · `Step4` 1 |
| `string \| null` 할당(TS2322) | 2 | `VOCPage.tsx:149, 202` |

**그 외 정적 검증**

| 항목 | 방법 | 결과 |
|---|---|---|
| 문서의 전 `파일:라인` 참조 | 심볼 grep 으로 현재 위치 대조 | **약 90건 중 60건 이상이 어긋나 있어 정정** |
| i18n 키 정합성 | `ko.json`/`en.json` 평탄화 비교 | **ko 1003 / en 1002**, `voc.page_other` 여전히 ko 전용 (B-15 유효) |

#### 2026-07-28 (1차) 실행 결과

```
Ran 75 tests in 1.397s
FAILED (failures=2, errors=1)
```
| 실패 테스트 | 원인 | 판정 |
|------------|------|------|
| `MessageBuildingTest.test_broadcast_subject_has_no_name_prefix` | 제목이 항상 `[결재 요청] ...` 로 시작하는데 `assertFalse(startswith('['))` 로 단언 → **논리상 절대 통과 불가** | **테스트 자체 결함** (B-22) |
| `HybridImmediateSendTest.test_enqueue_schedules_immediate_send_on_commit` | TE_R 사용자가 없어 수신자 0 → `_enqueue` 가 `None` 반환 → `noti.id` AttributeError. `.env` 의 `MAIL_REDIRECT_TO` 가 있어야만 통과 | **환경 의존 테스트** (B-23) |
| `ExternalApiKeyAccessTest.test_wrong_key_returns_401` | `ExternalApiKeyAuthentication` 에 `authenticate_header()` 가 없어 DRF 가 401→403 으로 변환 | **코드/문서 불일치** (B-19) |

> ⇒ **1차 시점 `manage.py test api` 는 red 였다.** CI 가 돌고 있지 않다는 신호이므로, 아래 CASE 검증 전에 먼저 green 을 만들 것을 권한다.
> (2026-08-04 현재 테스트는 167건으로 늘었으나 이 세션에서는 실행 불가 — red/green 여부 미확인.)

---

## 2. 기능 인벤토리 (테스트 대상 전수)

### 2.1 화면 / 라우트
| 라우트 | 컴포넌트 | 역할 제한 | 핵심 기능 |
|--------|----------|-----------|-----------|
| `/` | `HomePage` | 전원 | 최근 의뢰 현황(결재현황과 동일 표), 공지 |
| `/request` | `RequestPage/` | `NONE` 제외 | **5단계 위저드** — 작성/임시저장/재상신/PL수정후상신/재개 |
| `/approval` | `ApprovalPage` | `NONE` 제외 | 목록·필터·정렬 / 상세 / 결재 액션 전부 |
| `/history` | `HistoryPage` | `NONE` 제외 | `approved` 문서 조회·검색·상세(읽기전용)·삭제(MASTER) |
| `/voc` | `VOCPage` | `NONE` 제외 | VOC 등록·댓글·완료/거부 |
| `/permissions` | `PermissionPage` | `NONE` 제외 | 역할 부여/회수, 나만의 그룹, SSE 실시간 반영 |
| `/guide` | `GuidePage` | `NONE` 제외 | 가이드 CRUD, 전체 가이드 투어 |
| `/address-book` | `AddressBookPage` | `NONE` 제외 | 통보처 프리셋 CRUD |

### 2.2 결재 상태 기계
```
draft ──상신──▶ under_review ──(PL 전원 합의)──▶ R ──(합의)──▶ [RV] ──▶
                                       ┌── 경로1: P ─[PV]─▶ J ──┐
                                       ├── 경로2: O, E ─[EV 중 1명] ┼─▶ 합의 ▶ approved
                                       └── 경로3: RA(후결자, 병렬)┘
  어느 단계든 반려 ──▶ rejected ──재상신(round+1)──▶ under_review
  under_review ──중단요청→전원확인──▶ pause ──재개──▶ under_review (멈춘 단계부터)
  under_review/rejected ──철회──▶ draft (모든 단계 삭제)
  [Only MAP] draft ▶ PL ▶ R ▶ (P/O/E 없이) RA 전원 합의 ▶ approved
```

### 2.3 API 엔드포인트 (테스트 커버 대상)
`submit` / `resubmit` / `withdraw` / `delete` / `approve-step` / `reject-step` / `assign-step` /
`claim-step` / `peer-approve` / `peer-reject` / `peer-submit` / `change-designee` /
`add-post-approver` / `remove-post-approver` / `request-pause` / `confirm-pause` / `resume` / `cancel-pause`
+ `form-options/*` 9종 + `upload-image` / `upload-video` + `external/v1/documents` + `users/events`(SSE)

---

## 3. CASE별 수동 검증 시나리오

> 표기 규칙 — 각 CASE는 **사전조건 → 조작 → ✅성공판정 → ❌실패신호** 로 적는다.
> `❌실패신호` 는 "이렇게 보이면 버그" 이며, 뒤의 §5 버그 ID 와 연결된다.

### 3.A 로그인 / 권한 (T-A)

#### T-A1 역할 없는 사용자(NONE) 진입 차단
- 사전: 역할 `NONE` 계정으로 로그인
- 조작: 주소창에 직접 `/request`, `/approval`, `/history` 입력
- ✅ 모두 `/`(홈)으로 리다이렉트. Navbar 에 해당 메뉴 미노출
- ❌ 페이지가 열리면 `ProtectedRoute` 회귀

#### T-A2 역할 부여 (권한관리)
- 사전: **M** 로그인 → `/permissions`
- 조작: `NONE` 사용자 검색 → `TE_O` 부여 → **다른 브라우저 탭에서 그 사용자로 로그인**
- ✅ 역할이 **새로고침 없이** 반영(SSE `/api/users/events/`), '최근 추가순' 정렬 상단에 뜸
- ❌ 새로고침해야만 반영되면 SSE 스트림(nginx 버퍼링) 확인

#### T-A3 일반 사용자의 역할 부여 제한
- 사전: **O-1**(TE_O) 로그인 → `/permissions`
- 조작: `NONE` 사용자에게 `TE_J` 부여 시도 → 이어서 `TE_O` 부여 시도
- ✅ `TE_J` 는 403('자신의 역할로만 부여할 수 있습니다'), `TE_O` 는 성공
- ❌ 둘 다 되면 `assign_role` 인가 회귀

#### T-A4 세션 만료 경고
- 사전: 12시간 세션. 검증 시에는 `AuthContext.SESSION_TIMEOUT_MS` 를 짧게 두고 확인
- ✅ 만료 10분 전 `SessionWarningModal` 표시 → '연장' 클릭 시 `/auth/refresh/` 성공

---

### 3.B 의뢰서 작성 — STEP 1 기본정보 (T-B)

#### T-B1 필수값 미입력 시 진행 차단 + 오류 필드 스크롤
- 조작: `/request` 진입 → 아무것도 입력하지 않고 **다음** 클릭
- ✅ 토스트가 필드 수만큼 뜨고, **첫 번째 오류 필드로 자동 스크롤 + 노란 깜빡임(`field-error-flash`) + 포커스**
- ❌ 화면 최상단으로만 스크롤 → `scrollToFirstError` 회귀

#### T-B2 제품 이름 화이트리스트 검증
- 조작: 라인/조합법 선택 후 제품 이름 칸에 **목록에 없는 문자열** 직접 타이핑 → 다음
- ✅ `request.partid_not_in_list` 오류로 차단
- ❌ 통과되면 존재하지 않는 제품으로 상신 가능

#### T-B3 흐름도 Step 화이트리스트
- 조작: 흐름도 행 추가 → `step_from`/`step_to` 에 목록 밖 값 입력 → 다음
- ✅ 해당 셀만 빨간 테두리 + `flow_step_not_in_list`

#### T-B4 Backbone 조합영역 부분 입력 차단
- 조작: Backbone 항목 추가 후 **위치만** 입력(제품·조리법 공란) → 다음
- ✅ "모든 항목을 입력하거나 불필요한 항목은 삭제" 로 차단
- ⚠️ 이 안내문은 **하드코딩 한국어** (B-16)

#### T-B5 요청 목적 `Only MAP` 전환 초기화
- 사전: 흐름도/특이사항/Backbone 을 채운 상태
- 조작: 요청 목적을 **Only MAP** 으로 변경 → 확인 모달 '확인'
- ✅ 기타목적·흐름도·특이사항·Backbone·J/O 표·매핑 전부 초기화되고 입력 비활성. **라인·조합법·제품·조리법·고객/요구사항·생산일은 유지**
- ❌ 라인/제품까지 비면 `applyOnlyMap` 범위 회귀
- 추가: **첫 선택**(기존 목적 없음)일 때는 모달 없이 바로 적용돼야 한다

#### T-B7 `Layer 추가/삭제` 참조 요청서 Merge
- 조작: 기타 목적 `Layer 추가/삭제` → 참조 요청서 검색 → 선택 → **Merge**
- ✅ 병합 통계 모달 → 확인 시 J/O 표에 행 추가, 병합 행은 `loaded=true` 라 **`process_id·sp·sd·layerid·pp` 5개 컬럼이 읽기전용**
- ❌ 병합 행의 원본 컬럼이 편집되면 `LOADED_LOCK_COLS` 회귀

##### T-B7 사양 (기획 의도 — 2026-08-02 확정)
A = 이미 결재완료된 **참조 요청서**, B = **지금 작성 중인 요청서**. Merge 는 B 를 A 와 대조해 3-way 로 분류한다.

| 구분 | 조건 | `col_st` | `col_new_or_copy` |
|------|------|----------|-------------------|
| ① 신규 | **B 에만** 있음 (A 에 없음) | `O` | `신규` |
| ② layer 삭제 | **A 에만** 있음 (B 에 없음) → B 표에 행 추가 | `X` | `layer삭제` |
| ③ 기등록 | A·B **양쪽** 존재 | `X` | `기등록` |

- **비교 축 분리(필수)**: J-layer 는 J-layer 끼리, O-layer 는 O-layer 끼리만 비교한다.
- **J↔O 동기화 차단(필수)**: Merge 결과는 **오직 A 기준**으로 결정된다. J 행이 바뀌었다고 같은 `layerid` 의 O 행이 따라 바뀌면 **안 된다**.
  A 대조 결과 `기등록`인 행이 동기화 규칙 때문에 `신규` 등으로 뒤집히는 일이 없어야 한다.
- **"존재" 정의**: `!disabled && new_or_copy !== 'layer삭제'`. `layer삭제` 는 그 시점에 이미 지워진 layer 이므로 **부재**로 본다(A·B 대칭).
  → A 에서 `layer삭제` 인 layer 가 B 에 있으면 "A 엔 없던 것이 B 에 생김" → **①(신규)**.
- **참조는 의뢰서당 1건**: Merge 를 마치면 참조 선택 입력과 Merge 버튼이 **영구 잠긴다**(`detail.merge_ref_doc_id`).
  임시저장 후 재진입·재상신해도 잠금이 유지된다. 새 의뢰서를 작성하면 다시 지정할 수 있다.
- ✅ 판정: 위 표대로 `st`/`new_or_copy` 가 설정되고, 모달 건수 = 실제 표 반영 건수
- ❌ 회귀 신호: ① 이 반영되지 않음 / ② 행이 A 원본 값(`신규` 등)을 그대로 들고 들어옴 / J·O 값이 서로 전염됨 /
  Merge 후에도 참조를 바꿔 다시 Merge 할 수 있음 / 임시저장 재진입 후 잠금이 풀림
- 자동 테스트: `computeLayerMerge` 단위 테스트 12건 (`frontend/src/pages/RequestPage/helpers.test.ts`)

> **의도된 동작 (버그 아님)**: `handleMergeConfirm` 이 `handleJayerChange` 를 거치지 않고 `setJayerRows`·`setOayerRows` 를
> 직접 호출해 **T-D1 의 J↔O 동기화를 우회**하는 것은 위 "J↔O 동기화 차단" 요구사항을 만족하기 위한 **의도된 설계**다.
> 이전 검토에서 "동기화 누락"으로 분류했던 항목은 철회한다. 다만 Merge **이후** 사용자가 셀을 편집할 때의 전파는 B-52 참조.

---

### 3.C 의뢰서 작성 — STEP 2 MAP (T-C)

#### T-C1 map_type 필수 / CLONE 원본 필수
- ✅ `map_type` 미선택 시 차단. `CLONE` 선택 시 **원본 위치·원본 Part ID 블록이 나타나고 둘 다 필수**
- ✅ `EXISTING`/`NEW` 에서는 원본 블록 자체가 안 보임

#### T-C2 map_type 변경 시 초기화 범위
- 사전: MAP 필드를 모두 채우고 STEP1/3/4/5 도 입력한 상태
- 조작: `map_type` 을 `NEW` → `CLONE` 으로 변경 → 확인
- ✅ **StepMap 필드만** 초기화. `bb_entries`·`partial_shot`·`tbvtlv_*` 등 다른 STEP 데이터는 **보존**
- ❌ 다른 STEP 이 날아가면 `handleMapTypeChangeConfirm` 회귀

#### T-C3 C가문(only_prodc=Yes) X/Y 부호·동일값 검증
| 입력 (X북 / X남) | 기대 |
|---|---|
| `10` / `-10` | ✅ 통과 (절대값 동일 + 부호 반대) |
| `10` / `10`  | ❌ 차단 (`map_x_sign_error`) |
| `10` / `-20` | ❌ 차단 (절대값 다름) |
| `0` / `0`    | ✅ **통과** (0 은 부호 예외) |
| Y북 `5` / Y남 `5` | ✅ 통과 |
| Y북 `5` / Y남 `6` | ❌ 차단 (`map_y_equal_error`) |

#### T-C4 조건부 섹션 해제 시 하위값 초기화
- 조작: C가문 `Yes` → 상/중/하판 채움 → 다시 `No` 로 변경 → **임시저장 후 상세보기**
- ✅ 저장된 JSON 에 `prodc_*`·지도편차(리전)·X표시 값이 **남아 있지 않다**(`handleOnlyProdcChange`)
- ❌ 남아 있으면 감사 R-2~R-6 회귀 (백엔드에 유령 값 저장)
- 동일 검증(**2026-08-04 코드 확인 — 아래 4종은 정상 동작**)

| 조작 | 초기화 대상 | 핸들러 |
|---|---|---|
| `map_change=변경 없음` | `map_value_x/y`·`map_reason` | `index.tsx:1703` |
| `map_change_{top\|bottom}=변경 없음` | 그 리전 `map_value_x/y` (+양쪽 다 없음이면 `map_reason`) | `index.tsx:1645` |
| `ea_change=변경 없음` | `ea_value` | `index.tsx:1714` |
| `mshot_change=없음\|삭제` | `mshot_image_copy{,_top,_bottom}` | `index.tsx:1724` |
| `inter=NO` | `inter_xs`·`inter_ys`·`in_apply`·`inter_select` | `StepMap.tsx:548` |
| `rev_yn=NO` | `rev_entries` | `StepMap.tsx:210` |

- ❌ **반대 방향(`No` → `Yes`)은 정리되지 않는다** — C가문으로 전환하면 일반 지도편차
  (`map_change`/`map_value_x`/`map_value_y`)가 화면에서 사라진 채 값만 남아 저장된다 → §5 **B-64**
- 추가 검증: C가문 `Yes` 상태에서 **`prodc_scope` 를 ONLY 스코프로 바꿔** 한 리전을 끄고 임시저장 →
  꺼진 리전의 `map_change_{r}` 이 `변경 있음` 으로 남아 있으면 **B-64(b)**

#### T-C5 숫자 전용 입력
- 조작: MAP X/Y(일반 6개) 와 예외구역 값에 `--1.2.3abc` 붙여넣기
- ✅ 부호 1개·소수점 1개만 남고 문자는 제거됨(`sanitizeSignedDecimal`)

#### T-C6 M-shot 이미지
- 조작: `mshot_change=추가` 선택 후 **이미지 없이** 다음
- ✅ 차단. C가문이면 북/남 **2장 모두** 필수
- 조작: Ctrl+V 로 이미지 붙여넣기 → 업로드
- ✅ 2MB 초과 시 거부. ⚠️ 업로드 API 자체는 §5 B-02 참조

#### T-C7 REV Layer 드래그 다중 선택
- ✅ REV Layer 버튼 위를 드래그하면 지나간 버튼이 일괄 선택/해제(첫 버튼에서 add/remove 모드 결정), 개별 클릭 토글도 유지

---

### 3.D 의뢰서 작성 — STEP 3/4 J·O-layer (T-D)

#### T-D1 J↔O 동기화 (`layerid` 기준)
| 사전 상태 | 조작 | 기대 |
|---|---|---|
| J행·O행의 `layerid` 동일, 둘 다 활성·정상 | J행 `st` 를 `O` 로 변경 | ✅ 같은 layer 의 O행 `st` 도 `O` 로 |
| O행이 **비활성** | J행 `st` 변경 | ✅ O행 **변경 안 됨**(격리) |
| O행 `new_or_copy=기등록` | J행 일괄 '전체 O' | ✅ O행 **변경 안 됨** |
| J행 `new_or_copy` 를 `기등록`으로 | — | ✅ **그 행의 `st` 만 자동 'X'**, 다른 행에 전파 없음 |
| `layerid` 공란 | 변경 | ✅ 동기화 제외 |

#### T-D2 `차용` 행 필수값
- 조작: J행 하나를 `new_or_copy=차용` 으로 두고 `product_name`·`step` 을 비운 채 STEP3→4 이동
- ✅ 토스트(`jayer_noc_required`, 건수 보간) + **해당 셀에 빨간 테두리** + 그 셀로 스크롤(깜빡임 없음)
- ✅ O-layer 도 STEP4→5 에서 동일. **최종 상신(STEP5)에서도 재검사**
- ❌ 표 상단에 고정 문구가 뜨면 회귀(토스트만이 정상)

#### T-D3 불러온(loaded) 행 컬럼 잠금
- 사전: 자동채움(JOB FILE/OVL)으로 채워진 행
- 조작: `process_id`·`sp`·`sd`·`layerid`·`pp` 에 타이핑 / 엑셀 붙여넣기 / Delete
- ✅ 5개 컬럼은 값이 바뀌지 않고, 나머지 컬럼(`st` 등)은 편집됨
- ✅ 수동 `+ 행 추가` 로 만든 행은 **전 컬럼 편집 가능**
- ✅ 구버전 문서(`loaded` 없음)는 **Update 날짜 유무**로 판정

#### T-D4 셀 드래그 선택
- ✅ 여러 셀을 드래그해도 브라우저 기본 텍스트 선택(파란 배경)이 생기지 않음
- ✅ 단일 클릭/더블클릭 편집, input 내부 텍스트 선택은 정상

#### T-D5 STEP4 정보 탭 — Partial Shot / TBV·TLV
- 조작: 일반 모드에서 `partial_shot` 미선택 → 다음
- ✅ **'info' 탭으로 자동 전환**된 뒤 오류 표시
- 조작: O행 `sd` 에 TBV/TLV 가 있는데 두께 또는 항목이 비어 있을 때 다음
- ✅ 경고 모달(무시하고 진행 가능)
- 조작: TBV/TLV 비고표 X칸에 엑셀 2열(탭 구분) 여러 줄 붙여넣기
- ✅ X·Y 동시 채움 + 행 수 초과분 자동 생성
- 조작: Only MAP 모드
- ✅ Partial Shot·TBV/TLV·SD 버튼·비고표가 **전부 비활성**이고 필수 검증도 우회

---

### 3.E 의뢰서 작성 — STEP 5 Backbone (T-E)

#### T-E1 자동채움은 '남은 원본 행'만 대상
- 사전: J행 10개 중 4개를 이미 매핑
- 조작: 자동채움 패널 열기 → 범위 추가 → 적용
- ✅ **미매핑 6개만** 채워지고, 기존 4개 행은 **덮어쓰이지 않음**(항상 append)
- ❌ 이미 채워진 행이 다시 채워지면 2026-06-25 수정 회귀

#### T-E2 라인만 다른 동일 제품명 구분
- 사전: `bb_entries` 에 `[LineA] BB제품1`, `[LineB] BB제품1` 두 항목
- 조작: 자동채움 범위에서 `[LineB] BB제품1` 선택 → 적용
- ✅ 결과표 `bb_name` 이 `[LineB] BB제품1` 로 정확히 표시(인덱스 기반 `entryIdx`)
- ❌ 항상 LineA 가 잡히면 `findIndex(product)` 회귀

#### T-E3 탭별 색상
- ✅ 외부 데이터 탭이 **2개 이상일 때만** 파스텔 색 부여. 색칠 대상은 **탭 버튼 + Ref.PART ID 셀 한 칸**만(행 전체 아님)
- ✅ 결재 상세보기/이력조회에서도 **같은 색 재현**
- ✅ 탭 1개일 땐 기존 `bb-tab-active` 동작

#### T-E4 J행 변경 시 매핑 자동 해제
| 조작 | 기대 |
|---|---|
| 매핑된 J행의 아무 셀 수정 | ✅ bb 행 제거 + **원본 목록에 재노출**(재매핑 가능) |
| 매핑된 J행 붙여넣기 / Delete | ✅ 동일 |
| 매핑된 J행 **수동** 비활성화(체크 → '선택 비활성화') | ✅ bb 행 제거, 원본 목록에도 안 뜸. **복원 시 목록 복귀** |
| 매핑된 J행이 **필터로** 비활성화 | ❌ **bb 행이 그대로 남는다**(`unmapJayerRows` 미호출) → §5 **B-59** |
| 라인/조합법/조리법 변경 | ✅ `bbRows`·`mappedJayerRowIds`·`stagedMappings` 전부 초기화(고아 bb 방지) |
| 참조 요청서 '재선택'(Merge 롤백) | ✅ 스냅샷에 없는 J행의 bb 매핑을 함께 정리(`handleMergeReselectConfirm`) |

#### T-E5 매핑 필수 검증 (프론트 + 백엔드 이중)
- 조작: 활성 + `process_id` 있는 J행을 매핑하지 않고 **상신**
- ✅ STEP5 에서 프론트가 차단(인라인 `.form-error` + 스크롤)
- ✅ 프론트를 우회해 API 를 직접 호출해도 `_validate_bb_mapping` 이 400
- ✅ `기등록`/`layer삭제`/비활성 행은 **양쪽 모두 검증 제외**
- ❌ **`additional_notes` JSON 이 깨져 있으면 백엔드 검증이 통과된다** → §5 **B-03**

---

### 3.F 임시저장 / 자동저장 / 가시성 (T-F)

#### T-F1 임시저장 → 재진입
- 조작: 일부만 입력 → **임시저장** → 결재현황 '임시저장' 탭에서 문서 열기 → 수정 후 재상신
- ✅ 위저드 값이 그대로 복원. **비활성 행도 임시저장에는 포함**(상신 시에만 제거)

#### T-F2 20분 무조작 자동저장
- ✅ 라인·제품·조합법·조리법이 모두 있을 때만 동작, 토스트 `auto_save_success`
- ✅ 수동 저장/상신 중이면 건너뜀(중복 create 방지)

#### T-F3 임시저장 공유 그룹 가시성 **(2026-08-07 정책 변경)**
공유 대상은 작성자가 문서마다 지정하는 **그룹 1개**(`RequestDocument.shared_group`)다.
결재 현황 → 임시저장 행 → `👥 그룹 지정` 으로 지정/해제한다.

| 로그인 | 기대 |
|---|---|
| 작성자 본인 | ✅ 보임 |
| 문서에 **지정된** 공유 그룹의 멤버 | ✅ 보임 · 수정 · 상신 가능 (삭제·공유대상 변경은 불가) |
| 작성자와 **다른** 그룹만 공유하는 멤버 | ✅ **안 보임** (그룹이 3개여도 지정한 1개에만 공유) |
| 공유 그룹 **미지정** 문서 | ✅ 작성자 본인·MASTER 외 **안 보임** |
| 무관한 사용자 | ✅ **안 보임** (목록에도 상세 조회에도) |
| MASTER | ✅ 전부 보임 |
> 자동 커버: `backend/api/tests.py::DraftVisibilityTest`, `::SharedGroupDraftTest`
> ⚠️ 기존 임시저장 문서는 `shared_group=null` 로 마이그레이션된다 → **작성자 본인·MASTER 에게만** 보이게 된다(데이터 손실 없음, 노출 범위만 축소).

#### T-F4 로드 실패 시 덮어쓰기 차단
- 조작: 존재하지 않는 `?editDocId=99999` 로 `/request` 진입 후 저장/상신 시도
- ✅ `request.edit_load_failed` 토스트 + **저장 차단**(빈 폼으로 기존 문서를 덮어쓰지 않음)

---

### 3.G 상신 (T-G)

#### T-G1 지정 PL 단일
- 조작: STEP5 → 상신 → 검색에서 **PL-B** 선택 → 상신
- ✅ 상태 `검토중`, 결재현황 현재단계 `PL 검토(PL-B)`, PL-B 에게 `[PL-B님] [결재 요청] ...` 메일
- ❌ 본인(PL-A)을 고르면 400 '본인을 지정할 수 없습니다'

#### T-G2 지정 PL 다중 (전원 합의)
- 조작: **PL-B, PL-C** 둘 다 지정 → 상신
- ✅ `PL` pending 단계가 **2개** 생성, 각자에게 개별 메일
- ✅ PL-B 만 합의 → **R 단계 미생성**, 현재단계에 `PL 검토(PL-C)` 만 남음
- ✅ PL-C 도 합의 → 그때 R 생성
- ✅ **둘 중 1명이라도 반려하면 즉시 `rejected`**

#### T-G3 통보처(Notifier)
- 조작: 상신 모달에서 통보처 2명 지정 → 상신
- ✅ 상신 시 `notify_submitted`, 최종 승인 시 `notify_approved` 메일이 통보처 전원에게
- ✅ 결재 경로 탭에서 **의뢰자 바로 다음 행**에 '통보처'(이름 + 이메일)
- ✅ 이메일 미등록자가 있으면 통보처 블록에 인라인 경고
- ✅ 통보처는 **결재 권한 없음** — 그 사람 로그인 시 합의 버튼 미노출

#### T-G4 주소록 불러오기/저장
- 조작: 통보처 3명 지정 → '통보처로 저장' → 새 이름 입력 → 저장 → 다른 문서 상신 시 '통보처 불러오기'
- ✅ 저장 시 **실존 사용자만 정규화**(없는 loginid 제외, 이름 최신화)
- ✅ 불러오기는 현재 통보처를 **덮어쓰기**(기존 목록 있으면 확인 모달)
- ✅ `/address-book` 에서 **본인 것만** 조회/수정

#### T-G5 C가문 후결자 필수
- 조작: `only_prodc=Yes` 문서를 후결자 없이 상신
- ✅ 프론트 토스트 + 백엔드 400 `_validate_post_approvers` 이중 차단

#### T-G6 상신 실패 경로
| 조작 | 기대 |
|---|---|
| `draft` 아닌 문서에 `submit/` 호출 | ✅ 400 '임시저장 상태의 의뢰서만' |
| 존재하지 않는 PL loginid | ✅ 400 |
| 매핑 미완료 | ✅ 400 |
| 제목이 매우 긴 라인/제품 조합 | ✅ 600자로 잘려 저장 성공(`_unique_title`), 중복 시 `_2`, `_3` |

---

### 3.H PL 검토 단계 (T-H)

#### T-H1 PL 합의 / 반려 / 수정 후 상신
| 조작 | 기대 |
|---|---|
| PL-B 로그인 → 상세 → **합의** | ✅ 다음 단계 진행(다중이면 대기) |
| **반려** (사유 입력) | ✅ 즉시 `rejected`, 작성자 + 기합의자 + 미합의 지정 PL 에게 반려 메일 |
| **수정 후 상신** | ✅ `/request` 로 이동해 편집 → 상신 시 `peer-submit/` 호출, 코멘트 앞에 `[수정 후 상신]` 태그 |

#### T-H2 PL 수정 시 의뢰자 고정
- 조작: PL-B 가 '수정 후 상신'
- ✅ 목록·상세의 **의뢰자가 계속 PL-A**(PL-B 로 바뀌지 않음). 백엔드 `RequestDocumentSerializer.update` 가 `requester_*` pop

#### T-H3 지정자 변경
- 조작: **PL-A(작성자)** 또는 **M** → 상세 → '지정자 변경' → PL-C 선택
- ✅ 현재 회차 PL step 의 담당자 교체 + **새 지정자에게 상신과 동일한 메일**
- ❌ 작성자인데 403 이면 → §5 **B-08** (레거시 `requester` FK 없는 문서)
- ⚠️ 다중 PL 중 특정 1명 스왑은 미지원(대표 1건만 교체) — 알려진 제약

#### T-H4 인가 우회 시도
- 조작: PL-B 가 아닌 제3자가 `peer-approve/` 를 직접 호출
- ✅ 400 '대기 중인 본인 PL 검토 단계가 없습니다'

---

### 3.I R(RFG) 단계 — 담당자·검토자·후결자 (T-I)

#### T-I1 담당자 지정 + 검토자 동시 지정
- 조작: **R-1** 로그인 → 상세 → **지정하기** → 드롭다운에서 담당자 선택 → 검토자 드롭다운(맨 위 '검토자 없음') 에서 **R-2** 선택 → 확인
- ✅ `R` 단계에 담당자 배정 + `RV` 단계 생성. 결재현황 라벨은 **`RFG`**(담당자 아님), RV 는 `검토자`
- ✅ 결재 경로 탭에서 **R 행 하나에 `합의자(R) + 검토자(RV)` 를 함께** 표시(별도 행 아님)
- ❌ 담당자와 검토자를 같은 사람으로 → 400

#### T-I2 검토자 순차 가드
- 조작: **R-2**(RV) 가 담당자(R) 합의 **전에** 합의 시도
- ✅ 400 '담당자 합의가 먼저 필요합니다'
- ✅ 담당자 합의 후에는 정상 처리

#### T-I3 R 합의 → 병렬 전환
- 조작: R(검토자 있으면 RV 까지) 합의
- ✅ **P(4영업일) / O(6영업일) / E(6영업일) / RA(후결자, 6영업일)** 동시 생성
- ✅ 결재현황이 **경로1·경로2·경로3 = 최대 3행** 으로 rowSpan 분기
- ✅ 기한은 **주말 + `Holiday(isholiday='Y')` 제외** 영업일 계산

#### T-I4 E 단계 조건부 생성
| J-layer `pp` 값 | 기대 |
|---|---|
| 어느 행이든 `plel` 포함(대소문자 무관) | ✅ E 단계 생성, Validation System 은 `대상`(상신자가 `비대상`으로 토글 가능) |
| 전 행에 없음 | ✅ E 단계 미생성, Validation System 은 `해당없음`(토글 비활성) |

#### T-I5 후결자(RA)
- ✅ 고정 후결자(`.env POST_APPROVER_LOGINID`)는 **항상 포함**, 화면에 🔒 잠금 칩(제거 버튼 없음)
- ✅ C가문은 상신 시 지정한 추가 후결자도 RA 로 생성
- ✅ 각 후결자에게 `[후결 요청] {제목}` 메일(접미 라벨 없음)
- 조작: 작성자/M 이 병렬 진입 후 후결자 **추가** → 즉시 `[후결 요청]` 메일
- 조작: **제거** → 이미 합의(approved)한 RA 는 제거 불가 / 고정 후결자 제거 불가
- 조작: Only MAP 문서에서 마지막 RA 제거 → ✅ 400(최종 승인 경로가 사라지므로)
- 조작: C가문에서 (고정 제외) 추가 후결자를 0명으로 → ✅ 400
- ❌ `.env` 미설정 시 → §5 **B-04**

---

### 3.J P / J / O / E 단계 — 검토중(claim) (T-J)

#### T-J1 선점(claim)
- 조작: **O-1** 로그인 → 상세 → **검토중** 클릭
- ✅ 그 순간 assignee 로 고정(취소·재클릭 불가), 버튼 즉시 사라짐, 배지 `대기중` → `검토중`
- ✅ 다른 TE_O 가 동시에 눌렀다면 **409** '이미 다른 담당자가 검토 중입니다'
- ✅ 선점 **전에는** 합의/반려 버튼이 안 보인다

#### T-J2 팀 공동 합의
- 사전: O-1 이 선점
- 조작: **다른 TE_O(O-2)** 로 로그인 → 상세
- ✅ 합의/반려 가능(같은 팀 누구나). 단 **표시되는 담당자명은 선점자(O-1)** 로 남는다(감사 기록은 `acted_at`/comment)

#### T-J3 P/E 검토자(PV/EV) 동시 지정
- 조작: **P-1** 이 P 선점 → 합의 버튼 옆 검토자 드롭다운에서 **P-2** 클릭(칩 추가, 여러 명 가능) → **합의** 클릭
- ✅ 한 번의 요청으로 **PV 단계 생성 + P 담당자 합의**가 함께 처리
- ✅ **J 단계는 아직 생성 안 됨** — PV 전원 합의 후에 생성
- ✅ 결재현황 경로1 이 `검토자(P-2)` 로 표시
- ✅ '반려' 를 누르면 선택한 검토자는 **버려지고** 그냥 반려
- ❌ 담당자 본인을 검토자로 → 400 / 다른 팀 사람 → 400
- ⚠️ **지정 취소·변경 API 없음** — 한 번 지정하면 못 뺀다(알려진 제약)

#### T-J4 검토자 없이 진행(하위호환)
- 조작: 검토자 미선택 상태로 P 합의
- ✅ **즉시 J 단계 생성**(due = P 합의일 포함 4영업일)

#### T-J5 최종 승인 판정
| 상태 | 기대 |
|---|---|
| J·O 합의, E 담당자만 합의(EV 대기) | ✅ `under_review` 유지 |
| EV 중 1명 합의(OR) + RA 전원 합의 | ✅ `approved` + 승인 메일 + 통보처 메일. 남은 EV 는 `skip` |
| 두 결재자가 **거의 동시에** 마지막 합의 | ✅ 문서 행 락으로 직렬화 → approved 누락 없음 |

#### T-J6 어느 단계든 반려
- ✅ 어떤 단계에서 반려해도 즉시 `rejected`
- ✅ 반려 메일 수신자 = 작성자 + 현재 회차 기합의자 전원 + **아직 합의를 마치지 않은 결재선 단계의 담당 팀 전원**(반려자 본인 제외)
- ✅ **이미 합의를 마친 팀에는 팀 전체 메일이 가지 않음**
- ✅ Only MAP 문서는 P/O/E/J 팀이 애초에 결재선에 없으므로 제외

---

### 3.K 반려 → 재상신 (T-K)

#### T-K1 재상신 기본
- 조작: 반려 문서 → '수정 후 재상신' → `/request` 편집 → 상신
- ✅ `round` 가 +1 되고 새 PL pending 생성, **이전 회차 단계는 이력으로 보존**
- ✅ 결재 경로 탭에서 회차별로 구분 표시

#### T-K2 변경 이력 강조 (4종)
- 조작: 재상신 후 결재현황 상세 보기
- ✅ **J/O/BB 표**: 바뀐 행에 강조 + '이력 확인' → **가로 비교 모달**(헤더=원본 컬럼, 본문 2행 = 변경 전/후, 바뀐 셀만 색)
- ✅ **엠샷 / 생산정보(C가문) / REV** 블록: 빨간 테두리 + '이력 확인' 버튼
- ✅ **O-ayer 정보 탭**(Partial Shot·TBV/TLV): 변경 시 빨간 테두리 + 이력 확인, 탭 배지가 **빨강 점**(미변경·데이터 있음은 초록 점)
- ✅ **n회차**: `FieldHistoryModal` 에 회차별 `최초 / 변경됨 / 변경 없음` 열

#### T-K3 검토자(지정 PL) 프리필 — **현재 깨져 있음**
- 조작: 반려 문서 재상신 화면 진입 → STEP5 → **상신** 클릭
- ✅ **기대**: 이전 회차에 지정했던 PL 이 상신 모달 검토자 칸에 **미리 채워져** 있고 수정 가능
- ❌ **실제**: 항상 **비어 있음** → §5 **B-11**

---

### 3.L 철회 / 삭제 (T-L)

#### T-L1 철회 권한
| 로그인 | 기대 |
|---|---|
| 작성자 본인 | ✅ 가능 |
| 지정 PL 본인 | ✅ 가능 |
| 작성자와 같은 그룹 멤버 | ✅ 가능 |
| MASTER | ✅ 가능 |
| 무관한 사용자 | ✅ **403** |
- ✅ 철회 시 `draft` 로 되돌아가고 `submitted_at=None`
- ⚠️ **모든 회차의 결재 단계가 전량 삭제된다** → §5 **B-09**

#### T-L2 삭제 권한 (B-01 수정 후 기준)
| 로그인 | 문서 상태 | `POST delete/` 기대 |
|---|---|---|
| 작성자 / 지정 PL / 의뢰자 그룹멤버 | draft·under_review·rejected·**pause** | ✅ 200 (삭제) |
| 무관한 사용자 · 역할 `NONE` | 전부 | ✅ **403** |
| 작성자(본인이라도) | **approved** | ✅ **403** (이력 보존) |
| MASTER | 전부 | ✅ 200 |
- ✅ `DELETE /api/documents/{id}/` 는 권한 유무와 무관하게 **405** — 삭제는 `POST delete/` 한 경로뿐
- ✅ 삭제 성공 시 서버 로그에 `[DELETE_DOCUMENT] user=… doc=… status=… title=…` 기록
- ⚠️ 삭제는 복구 불가 — `ApprovalStep`·`PauseRequest` 가 CASCADE 로 함께 사라진다

---

### 3.M 결재 중단(PAUSE) / 재개 (T-M)

#### T-M1 중단 요청
- 조작: 작성자 → 진행 중 문서 상세 → '중단 요청' → **사유 입력**(필수) → 요청
- ✅ 상태 배지는 **검토중 그대로**, 현재단계 칸에 `중단 요청중` 칩만
- ✅ 사유 미입력 시 400

#### T-M2 중단 확인 (병렬 전원)
- 사전: 경로1(P) / 경로2(O) / 경로3(RA) 3개가 pending 인 상태에서 중단 요청
- 조작: P 담당자만 '중단 확인'
- ✅ '다른 단계의 확인을 기다립니다' → 아직 `under_review`
- 조작: O·RA 담당자도 확인
- ✅ **전원 확인 시** `pause` 전이 + 배지 `PAUSE` + 현재단계 텍스트 유지

#### T-M3 동결
| 조작 | 백엔드 | 프론트 버튼 노출 |
|---|---|---|
| pause 문서에 `approve-step/` | ✅ 400 (`views.py:445`) | ⚠️ **'합의' 버튼은 그대로 보인다** → 누르면 400 토스트 |
| `reject-step/` | ✅ 400 (`views.py:677`) | ⚠️ 위와 동일 |
| `assign-step/` | ✅ 400 (`views.py:752`) | ⚠️ '담당자 지정' 버튼 그대로 |
| `claim-step/` | ✅ 400 (`views.py:876`) | ⚠️ **'검토중' 버튼 그대로** |
| **`peer-approve/` / `peer-reject/` / `peer-submit/`** | ❌ **그대로 동작해버림** → §5 **B-06** 🔴 | ❌ 버튼도 그대로 |

> 프론트 판정 헬퍼(`ApprovalFlow.tsx` 의 `canUserAgree:44` / `canUserAssign:22` / `canUserClaim:31`)는
> **`document.status` 를 아예 보지 않는다.** 서버가 내려주는 플래그를 쓰는 중단·재개 버튼(`can_request_pause`/`can_resume`)과 달리
> 결재 액션 버튼은 클라이언트 계산이라 pause 를 모른다. 백엔드가 막으므로 데이터 손상은 없고 **UX 결함**이다(R-07 의 증상).

#### T-M4 재개 + 기한 연장
- 조작: 작성자 → pause 문서를 `/request` 로 열어 수정 → **재개** 클릭
- ✅ 상신 모달 라벨이 '재개', **지정 PL 선택 UI 없음**(멈춘 단계부터 이어지므로)
- ✅ `pause → under_review`, **회차 새로 만들지 않고** 멈춘 pending 단계 그대로 유지
- ✅ 중단 확정~재개 사이 **달력일수만큼 pending 단계 `due_date` 가 뒤로 밀림**
  (재현✅ 5일 중단 → `2026-08-01` → `2026-08-06`)
- ✅ PAUSE 동안 목록의 '현재 단계 완료예정'·'최종 완료예정' 은 날짜 대신 회색 **`중단`**

#### T-M5 요청 취소 / 자동 취소
- ✅ 확인 완료 전 작성자/M 이 '중단 요청 취소' 가능
- ✅ 요청중 상태에서 결재가 정상 진행(합의/반려)되면 기존 요청이 자동 `cancelled`

---

### 3.N 승인 → 이력 조회 (T-N)

#### T-N1 목록 이관
- 조작: 최종 합의로 `approved` 전이
- ✅ **결재현황 목록에서 사라지고**(`status !== 'approved'` 필터) **이력조회에 나타남**
- ✅ 홈 '최근 의뢰 현황' 에서도 제외

#### T-N2 이력 조회 표시
- ✅ 컬럼: No / 제목 / 제품명 / 의뢰자(+부서) / 상태 / 상신일 / **결재완료일**
- ✅ 결재완료일 = `approved` 단계 중 **가장 늦은 `acted_at`**
- ✅ 4분기 상태 처리: `loading → error(재시도 버튼) → empty → table`

#### T-N3 검색 경쟁 조건
- 조작: 검색어를 빠르게 연속 입력(예: `A` → `AB` → `ABC`)
- ✅ 마지막 요청 결과만 반영(`fetchSeqRef` 시퀀스 토큰) — 이전 응답이 늦게 도착해도 덮어쓰지 않음

#### T-N4 상세 보기(읽기 전용)
- ✅ **6개 탭 전부**(의뢰 상세 / MAP 정보 / J-ayer / O-ayer / 뼈찜 / 결재 경로)가 **모든 역할**에 열림
- ✅ 저장했던 STEP 값이 그대로: MAP X/Y 뒤 `um`, 예외구역 뒤 `mm` 접미
- ✅ BB Ref.PART ID 셀 색상이 작성 화면 탭 색과 동일
- ✅ 결재 경로: 의뢰자 → **통보처** → 결재자(이름 + 이메일), R 행에 검토자 병기

#### T-N5 메일 딥링크
- 조작: 진행 중 메일의 링크 → `/approval?id={id}` / 완료 메일 → `/history?id={id}`
- ✅ 해당 문서 상세 모달이 자동으로 열리고 배경 목록도 그 제목으로 검색됨
- ✅ 접근 불가/삭제된 id 면 조용히 무시(에러 화면 없음)

#### T-N6 이력 삭제(MASTER)
- ✅ MASTER 에게만 삭제 버튼 노출 → 확인 모달 → 삭제
- ⚠️ 버튼/모달 문구가 **하드코딩 한국어** → §5 **B-16**
- ⚠️ 백엔드 인가는 §5 **B-01** 참조(사실상 누구나 가능)

---

### 3.O 목록 표시·정렬·필터 (T-O)

#### T-O1 현재 단계 표시 규칙
| 상태 | 기대 텍스트 |
|---|---|
| PL 검토(다중) | `PL 검토(미합의자1 / 미합의자2)` |
| R 미합의 | `RFG(담당자명)` — 미지정이면 이름 없이 `RFG` |
| 경로1 진행 중 | `P(담당자)` → `검토자(이름)` → `J`(**진행 중엔 이름 미표시**) |
| 경로1 완료 | `P(이름) / 검토자(이름) / JOB(이름)` — **완료 시엔 전원 이름 노출** |
| 경로2 진행 중 | `O`(이름 미표시) / `E(담당자)` |
| 경로2 완료 | `O(이름) / E(이름) / 검토자(합의한 EV 이름)` — **`skip` 된 EV 는 결재자로 표시하지 않는다** |
| 경로3 | `후결자(미합의자 이름)` |
| pause | 단일 행 + `PAUSE` 배지 |

#### T-O2 상태 배지
- ✅ pending 인데 담당자 없음 → **`대기중`(unassigned)** / 있음 → **`검토중`**
- ✅ PV/EV 는 지정 즉시 담당자 확정이라 pending 이면 항상 `검토중`. EV 가 `skip` 이면 `건너뜀`(회색)
- ✅ **홈과 결재현황이 같은 헬퍼(`approvalTable.ts`)** 를 쓰므로 두 화면 표시가 항상 일치

#### T-O3 정렬 3단
- 조작: 양산일 헤더 클릭 3회
- ✅ 오름차순 → 내림차순 → 원래 상태
- ✅ 양산일 미입력 행은 방향 무관 **항상 맨 아래**
- ✅ 필터 탭을 바꾸면 양산일 정렬 자동 리셋
- ✅ 단계별 필터(agent_*) 활성 시 기본 정렬이 '그 단계 pending step `created_at` 오름차순' 으로 대체

#### T-O4 필터 탭
| 탭 | 기대 |
|---|---|
| 전체 | approved 제외 전부 |
| **내 차례** | 내가 처리할 문서만 |
| agent별(R·P·J·O·E) | 그 agent 의 pending 이 있는 문서 |
| 임시저장 / 반려 / 중단 | 상태별 |
- ❌ **TE_* 역할로 '내 차례' 를 눌렀을 때, 아직 아무도 선점하지 않은 내 팀 단계 문서가 안 나온다** → §5 **B-12** 🟠

---

### 3.P 부가 기능 (T-P)

#### T-P1 VOC
- ✅ 등록 시 MASTER 에게 `voc_created` 메일, 댓글 시 `voc_comment` 메일
- ✅ '완료' 는 **작성자 본인만**, '거부' 는 **MASTER만**(거부 시 사유 댓글 자동 등록)
- ✅ 삭제는 MASTER만(`IsAuthenticatedOrMasterDelete`)
- ⚠️ `submitter_user_id` 를 클라이언트가 보낸다 → §5 **B-20**
- ⚠️ 상태 변경 시 `responded_at` 이 안 채워짐 → §5 **B-21**

#### T-P2 공지 / Release Note
- ✅ 읽기는 전원, 쓰기는 MASTER만(`IsMasterOrReadOnly`)
- ✅ 최신 공지 갱신 시 Navbar 배지 표시

#### T-P3 가이드
- ✅ 조회 전원 / 작성·수정은 **PL 제외** 인증 사용자 / 삭제는 MASTER
- ✅ 의뢰서 작성 화면의 **가이드 배지는 배지를 직접 클릭할 때만** 열림(label 행 클릭으로는 안 열림)
- ✅ `/approval?embed=tour` 투어 모드는 **실데이터 API 를 타지 않고** 샘플 시드로 동작(평상시 무영향)
- ❌ 가이드 검색창 placeholder 가 `guide.search_placeholder` 문자열 그대로 보임 → §5 **B-14**

#### T-P4 나만의 그룹
- ✅ 멤버인 그룹만 조회, 생성자와 **동일 role** 인 사용자만 멤버 추가 가능
- ✅ 모든 멤버가 이름 변경·멤버 추가/제거·삭제 가능
- ✅ **(2026-08-07)** 그룹의 쓰임새는 두 가지다 — 그룹 자체가 메일 발송 대상이 되지는 **않는다**.
  1. **통보처 일괄 추가**: 상신 모달 통보처 블록의 `👥 그룹 불러오기` → 멤버 전원이 통보처에 추가(append, 본인·중복 제외)
  2. **임시저장 공유**: 작성자가 문서마다 그룹 **1개**를 지정해야 그 그룹 멤버에게만 보인다(T-F3)
- ✅ 그룹 멤버는 **지정된** 임시저장 문서를 보고 **수정·상신·철회**까지 가능. **삭제는 불가**(의뢰자·지정 PL·MASTER 만)
> 자동 커버: `backend/api/tests.py::SharedGroupDraftTest`

#### T-P5 외부 API
```bash
curl -H "X-API-Key: $EXTERNAL_API_KEY" 'http://localhost:10011/api/external/v1/documents/?p_approved=true&fields=id,title,status'
```
- ✅ 키 없음 → 403 / 잘못된 키 → 인증 실패 / 올바른 키 → **draft 포함 전체** 반환
- ✅ 쓰기 메서드 미노출(ReadOnly), 내부 `/api/documents/` 는 `X-API-Key` 로 접근 불가
- ✅ `fields` 에 허용되지 않는 이름 → 400
- ✅ **(2026-08-07)** 잘못된 키 → **401** (B-19 수정 완료)

---

### 3.Q 인증 / SSO / 세션 (T-Q) — 2차 추가

#### T-Q1 OIDC 로그인 정상 경로
- 조작: 비로그인 상태로 `/` 접속 → 자동으로 `/api/auth/oidc/login/` → ADFS 리다이렉트 → 로그인 → `/oidc-callback`
- ✅ `access_token`·`refresh_token`이 **HttpOnly + Secure + SameSite=Lax** 쿠키로 설정
- ✅ 최초 로그인 사용자는 `role='NONE'`으로 자동 생성되고 권한관리 화면에 실시간(SSE)으로 뜬다
- ❌ `secure=True` 고정이라 **HTTP(개발 10011)에서는 쿠키가 저장되지 않는다** — dev는 `AUTH_MODE=dev`(Bearer) 경로를 쓰므로 우회되지만, dev에서 SSO를 시험하면 무한 리다이렉트처럼 보인다

#### T-Q2 id_token 재사용(replay) — **현재 통과해버림**
- 조작: 정상 로그인 시 브라우저 개발자도구 Network에서 `/api/auth/oidc/callback/` 요청 body의 `id_token` 값을 복사
  → **며칠 뒤(또는 만료 후)** 그 값만으로 `POST /api/auth/oidc/callback/` 재전송
- ✅ **기대**: 401 (만료된 토큰)
- ❌ **실제**: 로그인 성공, 새 쿠키 발급 → §5 **B-27** 🔴

#### T-Q3 nonce / state 검증
- 조작: 위 재전송 시 `nonce_jwt` 필드를 **아예 빼고** 전송
- ✅ **기대**: 400 (nonce 불일치/누락)
- ❌ **실제**: nonce 검증 블록이 `if nonce_jwt and id_token_nonce:` 라 **통째로 건너뛴다** → §5 **B-28** 🔴
- ❌ `state` 파라미터는 생성해 ADFS에 보내지만 **콜백에서 비교하지 않는다**(저장조차 안 함)

#### T-Q4 세션 만료 후 갱신
- 조작: `access_token` 쿠키를 삭제(또는 12시간 경과)한 뒤 '세션 연장' 또는 `POST /api/auth/refresh/`
- ✅ **기대**: `refresh_token`(7일)으로 재발급
- ❌ **실제**: `refresh_token_view`에 `@permission_classes([IsAuthenticated])`가 붙어 있어 **access_token이 살아 있어야만** 호출된다 → 만료 후에는 항상 401, 재로그인 강제. **refresh 7일 설정이 사실상 무의미** → §5 **B-36**
- 성공 판정: 만료 상태에서 연장 버튼을 눌러 **재로그인 없이** 세션이 이어져야 정상

#### T-Q5 SSO 재로그인 시 프로필 덮어쓰기
- 조작: ADFS가 `deptname` 클레임을 주지 않는 상황(또는 값이 빈 경우)에서 재로그인
- ❌ `user.deptname = dept_name or ''` / `user.username = user_name or ''` 라 **기존 부서·이름이 빈 문자열로 덮어써진다** → §5 **B-37**
- 확인 방법: 권한관리 목록에서 해당 사용자의 이름/부서가 비어 있는지

#### T-Q6 dev 모드 오배포 확인 (배포 점검 필수)
```bash
curl -s http://<host>/api/documents/ | head -c 200      # 쿠키·토큰 없이
```
- ✅ **기대**: 401/403
- ❌ `AUTH_MODE=dev`로 떠 있으면 **비인증 200 + 전체 목록**이 나온다(재현✅) → §5 **B-29**

#### T-Q7 로그 PII 확인
```bash
docker logs <backend> 2>&1 | grep "\[OIDC\]" | head -20
```
- ❌ 로그인 1회마다 **메일·부서·성·이름·UPN·sub**가 평문으로 남는다 → §5 **B-35**

---

### 3.R 파일 업로드 / 미디어 서빙 (T-R) — 2차 추가

#### T-R1 미인증 업로드
```bash
curl -i -F "image=@evil.svg;type=image/png" http://localhost:10011/api/upload-image/
```
- ✅ **기대**: 401/403
- ❌ **실제**: 200 + 저장 경로 반환(재현✅) → §5 **B-02**

#### T-R2 확장자 위조
- 조작: `evil.svg`(내용에 `<script>`) 를 `Content-Type: image/png` 으로 업로드
- ❌ 저장 파일명이 `mshot_<uuid>.svg` — **원본 파일명의 확장자를 그대로** 사용(재현✅)
- 조작: 반환된 `url`을 브라우저 주소창에 직접 입력
- ❌ nginx `/media/`가 `image/svg+xml`로 서빙 → **같은 오리진에서 스크립트 실행** → §5 **B-34**

#### T-R3 미디어 접근 제어
- 조작: **로그아웃 상태**에서 다른 사람 의뢰서의 M-shot 이미지 URL 직접 접근
- ❌ 인가 검사가 없어 URL만 알면 열람된다(UUID라 추측은 어려우나 인가는 0)

#### T-R4 보안 헤더
```bash
curl -sI https://localhost:10010/ | grep -iE "content-security-policy|x-frame-options|x-content-type-options|referrer-policy"
```
- ❌ **하나도 나오지 않는다** → CSP 없음(XSS 방어선 0), X-Frame-Options 없음(클릭재킹), nosniff 없음 → §5 **B-42**

#### T-R5 크기 제한
- ✅ 이미지 2MB / 동영상 50MB 초과 시 400. nginx `client_max_body_size 50M`, Django `DATA_UPLOAD_MAX_MEMORY_SIZE 55MB`로 일관

---

### 3.S 저장형 XSS / 사용자 삭제 파급 (T-S) — 2차 추가

#### T-S1 VOC 저장형 XSS
- 조작(API 직접): 아무 역할(`NONE` 포함) 사용자로
  ```
  POST /api/voc/  { "title":"문의", "category":"inquiry", "page":"request",
                    "submitter_name":"홍길동", "submitter_email":"x@c.com",
                    "content":"<img src=x onerror=\"alert(document.domain)\">" }
  ```
- ✅ **기대**: 서버 또는 렌더 시점에 sanitize
- ❌ **실제**: 원문 그대로 저장(재현✅) → MASTER가 VOC 상세를 열면 `VOCPage.tsx:446`의
  `dangerouslySetInnerHTML`로 **실행**된다 → §5 **B-26** 🔴
- 같은 패턴: `GuidePage.tsx:268,328` · `GuideSlidePanel.tsx:132` · `HomePage.tsx:257`(공지)

#### T-S2 제출자 위조
- 위 요청에서 `submitter_user_id`를 **다른 사람의 id**로 지정
- ❌ 그대로 저장된다(재현✅). `update_status('completed')`가 이 값으로 권한을 판정하므로 **완료 권한이 남에게 넘어간다** → §5 **B-20**

#### T-S3 VOC 알림 메일 본문
- 조작: VOC 제목을 `<b>굵게</b><script>alert(1)</script>`로 등록 → 관리자 메일 확인
- ❌ 제목·본문에 **원문 그대로** 들어간다(재현✅). 결재 메일(`_build_message`)은 `escape()` 처리되는데 **VOC 메일만 누락** → §5 **B-33**

#### T-S4 사용자 삭제가 진행 중 결재에 미치는 영향 — **회복 불가 경로 있음**
| 삭제 대상 | 결과 | 회복 |
|---|---|---|
| J/O/E/P **검토중 선점자** | `assignee=None`으로 초기화 | ✅ 다른 팀원이 **재-검토중 선점 가능**(재현✅ 200) |
| R 담당자 | `assignee=None` | ✅ `assign-step`으로 재지정 가능(미지정 상태가 됨) |
| **RA(후결자) / RV / PV / EV** | `assignee=None`, `action=pending` 인 **고아 단계**로 잔존 | ❌ claim 불가(400), 합의 불가(400), **재지정 API 없음**(재현✅) |
- ❌ 후결자를 새로 추가해도 **고아 RA 단계는 pending 그대로** 남아 `모든 RA approved` 조건을 영구히 막는다 →
  **문서가 영영 승인되지 않는다**(MASTER가 대신 합의해야만 탈출) → §5 **B-30** 🟠
- 조작 주체 주의: **MASTER가 아니어도 같은 역할끼리 서로 삭제 가능**(`UserViewSet.destroy`) — TE_O가 진행 중 O단계 담당자인 동료 TE_O를 지울 수 있다(재현✅ 204)

#### T-S5 그룹 생성자 삭제
- 조작: 멤버가 여럿인 '나만의 그룹'의 **생성자** 계정을 삭제
- ❌ `UserGroup.creator`가 `CASCADE`라 **그룹이 통째로 사라진다**(재현✅). 남은 멤버는 예고 없이
  임시저장 공유·철회 권한·승인 메일 수신 대상에서 빠진다. 주소록(`AddressBook.owner`)도 함께 삭제 → §5 **B-31**

---

## 4. 조합(교차) 시나리오 — 단일 CASE 로는 안 잡히는 것

> "각 기능별 CASE 를 종합·조합했을 때 오류가 없어야 한다" 는 요구에 대응하는 구간이다.
> 아래 X-시나리오는 **여러 기능이 서로의 상태를 밟는** 지점만 골랐다.

### X-1 Only MAP × 후결자 × 반려
1. Only MAP 문서 작성 → 상신 → PL 합의 → R 지정·합의
2. ✅ **P/O/E 가 생성되지 않고** 후결자(RA)만 pending
3. RA 가 반려 → ✅ `rejected`. 반려 메일은 **R·RV·RA 라인에만**(P/O/E/J 팀 제외)
4. 재상신 → ✅ 새 회차에서 동일 경로
5. ⚠️ `.env POST_APPROVER_LOGINID` 가 비어 있으면 3번이 아니라 **R 합의 순간 `approved`** — 결재가 통째로 생략된다(B-04)

### X-3 J행 비활성화 × BB 매핑 × 상신 × 재편집
1. J행 10개 전부 매핑 → 그중 3개를 **비활성화**
2. ✅ bb 정보에서 3행 제거 + 원본 목록에도 안 뜸 → **매핑 검증 통과**(비활성 행은 대상 제외)
3. 상신 → ✅ 저장 JSON 의 `jayerRows` 에서 **비활성 3행이 제거됨**
4. 반려 후 재편집 → ✅ 남은 7행 기준으로 정상 로드. **3행이 되살아나지 않는다**
5. ⚠️ 임시저장 경로는 비활성 행도 저장하므로 3·4 결과가 다르다 — 의도된 차이임을 인지하고 검증할 것

### X-4 다중 PL × 반려 × 재상신 (잔여 단계)
1. PL-B·PL-C 지정 상신 → **PL-B 가 반려**
2. ✅ `rejected`. ⚠️ **PL-C 의 1회차 단계는 `pending` 인 채로 영구히 남는다**(재현✅)
3. 재상신(round=2) → ✅ `[1, 2]` 두 회차 공존
4. ✅ PL-C 가 합의하면 backend 는 max_round 로 재해석해 **2회차 단계**를 처리(오동작 없음)
5. ❌ 다만 결재 경로 탭 1회차에 미결 단계가 계속 보이고, **상세 footer 는 회차 필터가 없어 이전 회차 단계로 버튼을 띄운다** → B-13

### X-5 반려(비-PL 단계) × 재상신 × 이전 회차 claim 버튼
1. R 합의 후 병렬 진입(P/O/J 대기) → **O 가 반려**
2. ⚠️ P·J 단계는 1회차에 `pending` 으로 남는다
3. 재상신 → 2회차는 **PL 검토** 상태
4. ❌ 이때 **TE_J 로 로그인해 상세를 열면 '검토중' 버튼이 뜬다**(1회차 J 단계를 보고) → 누르면 백엔드가 max_round 에서 J 를 못 찾아 **400** → B-13 🟠

### X-6 PAUSE × PL 단계
1. PL 검토 중인 문서에 **중단 요청** → PL 이 '중단 확인' → `pause` 전이
2. ❌ 그 상태에서 PL 이 **'합의'** 를 누르면 그대로 성공하며 `under_review` 로 되돌아가고 **R 단계까지 생성**된다(재현✅) → B-06 🔴
3. ❌ '반려' 도 동작해 `rejected` 로 간다(재현✅)
4. ✅ 반면 R/P/J/O/E 단계에서는 400 으로 정상 차단
5. ⚠️ 다만 **버튼은 어느 단계에서든 그대로 노출**된다 — TE_O 로 pause 문서 상세를 열면 '검토중' 버튼이 보이고,
   누르면 `claim_step` 가드(`views.py:876`)에 걸려 400 토스트가 뜬다(T-M3 표 참조)

### X-7 PAUSE × 기한 연장 × 재상신
1. O 단계에서 중단 확정 → 5일 뒤 재개 → ✅ pending 단계 `due_date` 가 +5일
2. 이어서 O 반려 → 재상신 → ✅ 새 회차 기한은 새로 계산(이전 연장분이 이월되지 않음)

### X-8 그룹 × 임시저장 × 철회 × 삭제
1. PL-A 가 임시저장 → 같은 그룹 PL-D 가 목록에서 확인 ✅
2. PL-D 가 그 문서를 상신 → ✅ 가능(그룹 멤버는 `can_edit` 대상)
3. 무관한 사용자로 임시저장 문서 조회 → ✅ 404/미노출
4. ~~상신 이후에는 무관한 사용자가 삭제 가능~~ → ✅ **수정 완료**(B-01, `03b2240`).
   현재는 `doc_permissions.can_delete` 가 상태별로 인가하고 REST `DELETE` 는 405 다 → 기대 동작은 **T-L2 표** 참조

### X-9 동시성
| 시나리오 | 기대 |
|---|---|
| 두 TE_O 가 동시에 '검토중' | ✅ 1명만 성공, 나머지 409 |
| J·O 담당자가 동시에 마지막 합의 | ✅ `select_for_update` 직렬화 → `approved` 1회만, 승인 메일 1통 |
| 다중 PL 이 동시에 마지막 합의 | ✅ R 단계 중복 생성 없음(`_advance_after_pl` 문서 락 + 존재 검사) |
| 같은 문서를 두 탭에서 동시 편집 후 저장 | ⚠️ **마지막 저장이 통째로 이김**(낙관적 잠금 없음) → R-05 |

### X-10 메일 전 구간 (1건의 문서로 끝까지)
상신 → PL 합의 → R 도착 → R 지정 → RV 도착 → 병렬 도착(P·O·E·RA) → PV 지정 → J 도착 → 승인
- ✅ 각 전이마다 `MailNotification` 이 1행씩 쌓이고 **커밋 직후 즉시 1회 발송**
- ✅ 실패분은 `pending` 으로 남아 APScheduler `process_mail_queue`(1분 주기)가 **최대 5회** 재시도 후 `failed`
- ✅ 검증 쿼리
  ```sql
  SELECT event_type, status, attempts, LEFT(subject,60), recipients
  FROM api_mailnotification WHERE document_id = ? ORDER BY created_at;
  ```
- ✅ 개인 지정 메일은 제목이 `[이름님] [결재 요청] ...`, 팀 브로드캐스트는 접두어 없음, 후결은 `[후결 요청] {제목}`

### X-11 XSS × 권한상승 체인 (전 구간 최악 시나리오) — 2차 추가
1. 역할 `NONE` 사용자가 VOC를 `content: <img src=x onerror="...">` 로 등록 (재현✅ — 권한 제한 없음)
2. MASTER가 VOC 상세를 연다 → 스크립트가 **MASTER의 세션 쿠키로** 동작 시작
   (쿠키는 HttpOnly라 토큰 값은 못 읽지만, `fetch(..., {credentials:'include'})`는 그대로 나간다)
3. 스크립트가 `POST /api/users/{공격자id}/assign-role/ {role:'MASTER'}` 호출
   → ✅ **성공한다**(재현✅ 200, role=MASTER) — MASTER는 모든 역할 변경 가능
4. 승격된 공격자가 `DELETE /api/documents/{id}/` 로 **결재 완료 문서 삭제**(B-01) 또는
   `assign-step`으로 결재선 조작(B-07)
- ⛔ **끊어야 할 고리(우선순위 순)**: ① VOC/가이드/공지 sanitize + CSP(B-26·B-42)
  ② 삭제 인가(B-01) ③ 업로드 인가·확장자(B-02) ④ 담당자 역할검증(B-07)
- 검증 방법: 위 1~3을 **격리된 개발 DB**에서만 재현할 것. 운영에서 시도 금지.

### X-12 담당자 계정 삭제 × 진행 중 결재 (교착) — 2차 추가
1. 문서가 병렬 단계 진입(P/O/RA pending), RA는 고정 후결자 + 추가 후결자 2명
2. 권한관리에서 **추가 후결자 계정을 삭제**(MASTER 또는 같은 역할 동료)
3. ❌ 그 RA 단계는 `assignee=None, pending` 고아로 남고 **claim·합의·재지정 전부 불가**(재현✅)
4. 작성자가 후결자를 새로 추가해도 ❌ 고아 단계가 남아 최종 승인이 **영구 차단**
5. ✅ 유일한 탈출: MASTER가 `approve-step(agent='RA')` 로 대신 합의(assignee 필터를 안 타는 분기)
- 같은 문제가 RV/PV/EV에도 적용. **J/O/E/P만 재-claim으로 자가 회복**된다.

### X-13 PL 단계 중단요청 × 정상 진행 (요청 고착) — 2차 추가
1. PL 검토 중 작성자가 **중단 요청**(사유 입력) → 아직 `requested`
2. PL이 그냥 **합의**를 눌러 R 단계로 진행
3. ❌ 중단 요청이 `requested` 그대로 남는다(재현✅) — `approve_step`/`reject_step`에는 자동취소가 있는데
   `peer_approve`/`peer_reject`/`peer_submit`에는 **없다**(대조군 R 합의는 `cancelled` 정상)
4. ❌ 결과: 작성자는 `can_request_pause`가 False가 되어 **다시 중단 요청 불가**(403, 재현✅),
   담당자는 target 단계가 이미 approved라 **확인도 불가**(403, 재현✅)
5. ✅ 유일한 탈출: 작성자/MASTER가 '중단 요청 취소'(`cancel-pause`)
→ §5 **B-32**

---

## 5. 발견된 버그

> 심각도: 🔴치명 / 🟠높음 / 🟡중간 / ⚪낮음
> 상태: **재현✅** = 발견 당시 세션에서 Django 테스트로 직접 실행해 확인 / **분석🔍** = 코드 정독으로 도출
>
> 📌 각 항목의 `위치` 는 **2026-08-04 기준 코드**로 정정했다(함수명 우선, 라인은 보조).

### 🔴 B-01 의뢰서 삭제에 인가가 전혀 없다 — 결재 완료 문서까지 누구나 삭제 **재현✅** → ✅**수정완료** (`fcf57b9`·`03b2240`·`aa8865e`)

> **[2026-07-28 수정 완료]**
> - **적용 규칙**: `approved` = MASTER 전용 / 그 외(`draft`·`under_review`·`rejected`·`pause`) = 철회 가능 범위
>   (의뢰자·지정PL·의뢰자 그룹멤버·MASTER). `doc_permissions.can_delete()` 신설, `can_withdraw` 재사용으로
>   레거시(`requester` FK 없음) 문서의 이메일 폴백 판정 승계.
> - **`DELETE /documents/{id}/` 는 405 로 차단**(사용자 선택) — 삭제 경로를 `POST delete/` 하나로 일원화.
> - **감사 로그**(사용자 선택): 삭제 성공 시 `WARNING [DELETE_DOCUMENT] user=… doc=… status=… title=…` 1줄.
> - **`pause` 문서 삭제는 허용**(사용자 선택) — 철회 범위와 동일.
> - **프론트 변경 0건** — 기존 버튼 노출 조건이 새 서버 규칙의 부분집합이라 정상 사용자는 차이가 없다.
> - 회귀 테스트 12건 추가(`DocumentDeleteAuthTest`). 전체 75 → 87건.
>
> **현재 코드 확인(2026-08-04)** — `RequestDocumentViewSet.http_method_names`(`views.py:111`)에서 `delete` 가 빠져
> REST `DELETE /api/documents/{id}/` 는 **405**, 삭제는 `POST documents/{id}/delete/`(`views.py:407-428`) 한 경로뿐이며
> `doc_permissions.can_delete` 인가 + `[DELETE_DOCUMENT]` WARNING 감사 로그가 붙어 있다. **수정 상태 유지됨.**
>
> 아래는 수정 전 기록(재발 방지용 원문 보존).
- 위치(수정 전 기준): `backend/api/views.py` 의 `permission_classes = [IsAuthenticatedInProd]`, `delete` 액션
- 내용:
  1. `RequestDocumentViewSet` 은 `ModelViewSet` 이라 라우터가 **`DELETE /api/documents/{id}/`(destroy)** 를 그대로 노출한다.
     `destroy` 오버라이드가 없고 permission 은 "인증만" → **상태·역할·작성자 무관하게 누구나 삭제**.
  2. `POST /documents/{id}/delete/` 액션의 docstring 은 "approved 는 MASTER만, 나머지는 **PL/MASTER**" 라고 적혀 있으나
     코드에는 **PL/MASTER 검사가 아예 없다**. approved 가 아니면 무조건 통과.
  3. 비교: `withdraw` 는 `_can_withdraw`, `update` 는 `_can_edit` 로 막혀 있어 **삭제만 구멍**이다.
- 재현 결과
  ```
  [B-01a] DELETE /api/documents/{id}/  (role=NONE, 승인 문서) -> 204 | 문서 잔존: False
  [B-01b] POST /documents/{id}/delete/ (role=NONE, 검토중 문서) -> 200 | 문서 잔존: False
  [대조]  POST /documents/{id}/withdraw/ (role=NONE)          -> 403  ← 이쪽은 정상
  ```
- 영향: **복구 불가능한 결재 이력 영구 소실.** `ApprovalStep`·`PauseRequest` 는 CASCADE 라 함께 지워진다.
  개발 모드(`AUTH_MODE=dev`)에서는 `IsAuthenticatedInProd` 가 비인증도 통과시키므로 **로그인조차 필요 없다.**
- 권고: `destroy` 를 오버라이드해 `delete` 액션과 같은 인가로 통일하고, 두 경로 모두 **"작성자 or 지정PL or MASTER, approved 는 MASTER 전용"** 으로 명시 구현. 또는 소프트 삭제 전환.

### 🔴 B-06 PAUSE 동결이 PL 단계 액션에는 적용되지 않는다 **재현✅** — ⚠️ **미수정 (2026-08-04 재확인)**
- 위치(현재 코드)
  | 액션 | pause 가드 | 라인 |
  |---|---|---|
  | `approve_step` | ✅ 있음 | `views.py:431` (가드 `:445`) |
  | `reject_step` | ✅ 있음 | `views.py:665` (가드 `:677`) |
  | `assign_step` | ✅ 있음 | `views.py:734` (가드 `:752`) |
  | `claim_step` | ✅ 있음 | `views.py:859` (가드 `:876`) |
  | **`peer_approve`** | ❌ **없음** | `views.py:1291` |
  | **`peer_reject`** | ❌ **없음** | `views.py:1305` |
  | **`peer_submit`** | ❌ **없음** | `views.py:1326` |
  | **`change_designee`** | ❌ **없음** | `views.py:1341` |
- 내용: 일반 단계 액션 4개에는 모두 `if document.status == 'pause': return 400` 가드가 있으나,
  **PL 단계 전용 액션 4개에는 없다.** 경로가 실제로 성립하는지도 코드로 확인했다.
  1. `submit`(`views.py:296`) 이 `status='under_review'` + `agent='PL'` pending 단계를 만든다.
  2. `can_request_pause`(`doc_permissions.py:140`)는 `under_review` 만 요구 → **PL 검토 중에도 중단 요청 가능**.
  3. `_can_confirm_pause`(`views.py:211`)는 단계 assignee 본인을 허용 → **지정 PL 본인이 확인해 `pause` 확정 가능**.
  4. 그 상태에서 `peer_approve` → `_advance_after_pl`(`views.py:1263`)이 **조건 없이 `document.status = 'under_review'`
     로 덮어쓴다**(`:1283`, `:1287`) → 되살아나고 R 단계까지 생성된다.
- 재현 결과 (**2026-08-04 재실행 — 여전히 재현됨**)
  ```
  [사전]  request-pause=200  confirm-pause=200  | status = pause     ← PL 단계에서 pause 확정 성립
  [B-06a] pause 문서 peer-approve -> 200 | status = under_review | R단계 생성: True
  [B-06b] pause 문서 peer-reject  -> 200 | status = rejected
  [B-32]  PauseRequest.state = confirmed (cancelled 여야 정상) | 작성자 재-중단요청 -> 403
  [대조]  pause 문서 approve-step -> 400 / claim-step -> 400        ← 일반 단계는 정상 차단
  ```
- 영향: 작성자가 요청하고 팀이 확인해 **정식으로 멈춘 결재를 PL 이 혼자 되살리거나 끝내버린다.**
  `PauseRequest` 는 `confirmed` 로 남아 있어 상태가 어긋난다(문서는 `under_review` 인데 활성 중단요청 존재 →
  `can_request_pause` 가 계속 False → **작성자가 다시 중단 요청도 못 한다**). B-32 와 같은 뿌리다 —
  `_cancel_active_pause_requests`(`views.py:234`)는 `approve_step`(`:521`)·`reject_step`(`:723`)에서만 호출된다.
- 부가(프론트): 결재 액션 버튼 노출 판정(`ApprovalFlow.tsx` `canUserAgree:44`/`canUserAssign:22`/`canUserClaim:31`)에
  **문서 상태 검사가 없어**, pause 문서에서도 '합의/반려/검토중/담당자 지정' 버튼이 그대로 보인다.
  일반 단계는 서버가 400 으로 막지만 사용자에겐 "눌렀는데 에러"로 보인다(T-M3 표).
- 권고: 4개 액션 앞에 동일 가드 추가 + `_advance_after_pl`·`peer_reject` 에 `_cancel_active_pause_requests` 호출 추가(B-32 동시 해결).
  공통 데코레이터/헬퍼로 빼서 향후 액션 추가 시 누락 방지. 프론트는 서버가 step 별 가능 플래그를 내려주는 방식으로 통일(R-07).

### 🔴 B-02 업로드 API가 미인증 + 확장자 무검증 **재현✅**
- 위치: `views.py:2073`(`upload_image`), `views.py:2120`(`upload_video`) — **2026-08-04 미수정 확인**
- 내용: 두 뷰 모두 `@csrf_exempt @require_POST` 인 **순수 Django 뷰**로, DRF permission 이 걸리지 않는다.
  검증은 (a) **클라이언트가 보낸 `Content-Type`** 이 `image/`·`video/` 로 시작하는지, (b) 크기(2MB/50MB) 뿐이다.
  저장 파일명 확장자는 **업로더가 준 원본 파일명**에서 그대로 떼어 쓴다(`image.name.split('.')[-1]`).
- 재현 결과
  ```
  [B-02] POST /api/upload-image/ (비로그인, <script> 포함 svg, Content-Type: image/svg+xml)
         -> 200 {"path": "mshot_images/mshot_....svg", "url": "/media/mshot_images/..."}
  ```
- 영향:
  1. **인증 없는 파일 업로드** — 저장소 고갈(50MB × N), 무단 파일 호스팅.
  2. `Content-Type` 은 위조 가능하므로 실질적으로 **임의 확장자 업로드**. `/media/` 가 nginx 로 그대로 서빙되면
     `.svg`/`.html` 업로드 → **저장형 XSS** 경로가 된다.
- 권고: DRF 뷰로 옮겨 `IsAuthenticatedInProd` 적용 + 확장자 화이트리스트(`png/jpg/jpeg/gif/webp`) +
  실제 바이트 검사(Pillow `Image.open`) + `/media/` 응답에 `Content-Disposition: attachment`·`X-Content-Type-Options: nosniff`.

### 🔴 B-04 `POST_APPROVER_LOGINID` 미설정 시 Only MAP 결재가 통째로 생략된다 **재현✅**
- 위치: `views.py:1185-1230`(`_advance_to_parallel`, 즉시 승인 분기 `:1198-1200`), `mailer.py:215`(`post_approver_users`)
- 내용: Only MAP 문서는 P/O/E/J 가 없어 **후결자(RA)가 유일한 종단 경로**다. 그런데 후결자가 0명이면
  `if not post_users: return 'approved'` 로 **R 합의 즉시 최종 승인**된다.
  후결자는 `.env POST_APPROVER_LOGINID` 로만 들어오므로, 값이 비어 있거나 그 loginid 의 계정이 없으면(오타/퇴사/DB 미생성)
  조용히 이 경로를 탄다. 로그도 남지 않는다.
- 재현 결과
  ```
  [B-04] Only MAP, POST_APPROVER_LOGINID='' → R 합의: 200 | 문서 status = approved
  ```
- 영향: 후결 결재가 **무음으로 스킵**된 채 승인 완료 메일까지 나간다. `remove_post_approver` 는 "최소 1명 유지" 를
  막고 있는데(`views.py:1545`, Only MAP 가드 `:1586-1591` / C가문 가드 `:1594-1598`) 정작
  **애초에 0명인 경우는 막지 않아** 정책이 앞뒤가 안 맞는다.
- 권고: 기동 시 `settings.POST_APPROVER_LOGINID` 실존 검증(`manage.py check` 또는 앱 ready) + 미설정 시
  `_advance_to_parallel` 에서 승인 대신 **에러/경고 로그 + 관리자 알림**.

---

### 🟠 B-07 `assign-step`(R 담당자)에 역할 검증이 없고, 담당자 이름을 클라이언트가 정한다 **재현✅**
- 위치: `views.py:767-775`(담당자 조회·이름 저장) ↔ 대조 `views.py:789`(검토자 RV) — **2026-08-04 미수정 확인**
- 내용: 검토자(RV)는 `User.objects.get(loginid=reviewer_loginid, role='TE_R')`(`:789`) 로 **TE_R 을 강제**하는데,
  **담당자(assignee)는 `User.objects.get(loginid=assignee_loginid)`**(`:769`) 뿐이다. 게다가 `step.assignee_name` 은
  **요청 본문의 `assignee_name` 을 그대로**(`:775`) 저장한다(실제 사용자명과 대조하지 않음).
- 재현 결과
  ```
  [B-07] R 담당자로 role=NONE 사용자 지정 -> 200
         assignee = none9 / role = NONE | 저장된 이름 = "아무개(위장이름)"
  ```
- 영향: RFG 팀이 아닌 사람이 R 담당자가 되면 `_can_act_on_step`(assignee 본인) 덕에 **합의는 가능**하다 →
  권한 없는 사람이 결재선을 통과시킨다. 표시 이름 위조로 **결재 이력 신뢰성**도 깨진다.
- 권고: `role='TE_R'` 필터 추가 + `assignee_name` 은 서버에서 `user.username or user.loginid` 로 파생.

### 🟠 B-11 재상신 시 '검토자(지정 PL) 프리필' 이 상신 모달 직전에 지워진다 **분석🔍**
- 위치: `frontend/src/pages/RequestPage/index.tsx:782-789` (프리필 `setDesignees(prevDesignees)`) ↔
  **`:3576` `setDesignees([])`**(`handleSubmitClick` 내부) — **2026-08-04 미수정 확인**
- 내용: 편집 로드에서 이전 회차 PL 담당자를 `setDesignees(prevDesignees)` 로 채워두는데,
  STEP5 의 **상신 버튼 핸들러 `handleSubmitClick` 이 모달을 열기 직전에 `setDesignees([])` 를 무조건 호출**한다.
  결과적으로 모달은 **항상 비어서** 열린다.
  같은 함수에서 `postApprovers`(프리필은 `:826`)는 지우지 않아 후결자만 프리필이 살아 있는 **비대칭** 상태다.
- 영향: `docs/APPROVAL.md` Case I / `docs/REQUEST.md`(2026-07) 에 명시된 기능이 **동작하지 않는다.**
  재상신 때마다 검토자를 매번 다시 검색·선택해야 하고, 다중 PL 이었다면 누구였는지 알 수 없어 결재선이 바뀔 수 있다.
- 재현 방법: 반려 문서 → '수정 후 재상신' → STEP5 → 상신 → **검토자 칸이 비어 있으면 버그**
- 권고: `setDesignees([])` 를 `if (!isEditMode) setDesignees([])` 로 한정하거나, 프리필 값을 별도 ref 에 보관 후 복원.

### 🟠 B-12 '내 차례' 필터가 claim 방식 단계를 못 잡는다 **분석🔍**
- 위치: `ApprovalPage.tsx:146-151`(`applyClientFilter` 의 TE_* 분기), `:181`(`getTabCount` 동일 분기) — **2026-08-04 미수정 확인**
- 내용: TE_* 역할의 '내 차례' 판정이
  ```ts
  (d.approval_steps ?? []).some(s => s.action === 'pending' && s.assignee_loginid === currentUser.username)
  ```
  인데, **J·O·E·P 는 검토중(claim) 방식이라 선점 전에는 `assignee_loginid` 가 없다.**
  즉 "내가 지금 선점해서 처리해야 할 새 문서" 가 정확히 **내 차례 탭에서 빠진다.**
- 영향: TE_O/TE_J/TE_E/TE_P 사용자가 **자기 일감을 '내 차례' 에서 볼 수 없다.** 결재 지연의 직접 원인.
  (`canUserClaim` 은 같은 팀이면 허용하므로 **권한과 필터가 서로 불일치**한다.)
- 재현 방법: R 합의로 O 단계가 갓 생긴 문서 → TE_O 로 로그인 → '내 차례' 탭 → 문서가 **없으면 버그**. '전체' 탭에는 보인다.
- 권고: 판정을 `s.assignee_loginid === me || (CLAIM_AGENTS.includes(s.agent) && !s.assignee_loginid && ROLE_TO_AGENT[role] === s.agent)` 로 확장.
  탭 카운트(`getTabCount`)에도 동일 적용.

### 🟠 B-13 상세 모달의 결재 버튼이 **회차(round)를 거르지 않는다** **분석🔍** (재현 근거✅)
- 위치: `ApprovalPage.tsx:1081-1088`(`pendingSteps`), `:1119`(`hasPendingPLStep`) — **2026-08-04 미수정 확인**
- 내용: `pendingSteps` 는 `action === 'pending'` 만 보고 **`round` 필터가 없다.**
  반려는 반려당한 step 하나만 `rejected` 로 바꾸므로 **같은 회차의 다른 pending step(P/J/O/E/PL)은 그대로 남고**,
  재상신하면 새 회차가 추가되면서 두 회차의 pending 이 공존한다(재현✅ X-4: 회차 `[1, 2]` 공존, 1회차 PL 단계 `pending` 잔존).
  목록 표(`approvalTable.ts:112-113` `getDocTableRows`)는 `maxRound` 로 거르는데 **상세 footer 만 안 거른다.**
- 영향:
  1. 2회차가 PL 검토 중인데 **1회차 J/O 단계를 보고 '검토중' 버튼이 노출** → 클릭 시 백엔드는 max_round 에서 그 agent 를 못 찾아 **400 '해당 단계를 찾을 수 없습니다'**
  2. `canChangeDesignee` 도 잔여 1회차 PL step 때문에 참이 될 수 있다.
- 재현 방법: 병렬 진입 후 O 반려 → 재상신 → TE_J 로 로그인 → 상세 열기 → **'검토중' 버튼이 보이면 버그**
- 권고: `pendingSteps` 에 `(s.round ?? 1) === getCurrentRound(selected)` 추가. 근본적으로는
  **반려 시 같은 회차의 나머지 pending step 을 `cancelled` 등으로 종결**시키는 게 맞다(현재 그런 상태값이 없음 — R-06 참조).

### 🟠 B-14 정의되지 않은 i18n 키가 화면에 그대로 노출된다 **재현✅**(정적 분석 스크립트)
- 위치: 아래 표
- 내용: `t()` 로 참조하지만 `ko.json`/`en.json` **양쪽 모두에 없는 키** — i18next 는 키 문자열을 그대로 렌더한다.

| 키 | 사용처 | 화면에 보이는 것 |
|---|---|---|
| `request.btn_all_o` / `btn_all_x` / `btn_all_new` / `btn_all_copy` / `btn_reset` | `RequestPage/components/Step2.tsx:124-132`, `Step3.tsx:201-208` | **J·O-layer 표 헤더의 일괄 버튼 5종**에 `request.btn_all_o` 같은 문자열 |
| `guide.search_placeholder` | `GuidePage.tsx:216` | 가이드 검색창 placeholder |
| `profile.name` / `profile.email` / `profile.department` | `Navbar.tsx:227,231,235` | 프로필 드롭다운 라벨. `\|\| '이름'` 폴백을 뒀지만 **i18next 가 키 문자열(truthy)을 반환해 폴백이 절대 안 걸린다** |
- 검증 결과(**2026-08-04 재확인**): `ko.json`/`en.json` **양쪽 모두** `request.btn*` 5종 **0개**, `profile` 섹션 **없음**,
  `guide.search_placeholder` **없음** — 사용처 라인만 밀렸고 **버그는 그대로**다.
- 🔥 **타입체커가 이미 잡고 있다**(2026-08-04 `npx tsc --noEmit` 실행): 전체 오류 24건 중 **16건이 이 버그**다.
  ```
  Step2.tsx(124,107): error TS2345: Argument of type '["request.btn_all_o"]' is not assignable ...
  Navbar.tsx(227,55): error TS2345: Argument of type '["profile.name"]' is not assignable ...
  GuidePage.tsx(216,28): error TS2345: Argument of type '["guide.search_placeholder"]' ...
  ```
  i18next 의 키 타입이 `ko.json` 에서 생성되므로 **정의되지 않은 키는 컴파일 단계에서 이미 오류**다.
  즉 이 버그는 "정적 분석으로 발견" 수준이 아니라 **빌드 경고를 무시하고 있는 상태**이며,
  `tsc --noEmit` 을 CI 게이트로 걸면 즉시 재발 방지된다. (나머지 8건은 §1.5 표 참조 — 별개 유형)
- 영향: 의뢰서 작성 핵심 화면(J/O-layer 일괄 편집 버튼)에 개발용 키가 그대로 보인다. **규칙 G 위반.**
- 권고: ko/en 동시 추가.

### 🟠 B-15 `voc.page_other` 가 `ko.json` 에만 있다 **재현✅**
- 위치: `locales/ko.json` (en.json 없음), 사용처 `VOCPage.tsx:26`
- 검증(**2026-08-04 재확인**): ko **1003키** / en **1002키** — 차이는 여전히 **정확히 `voc.page_other` 1개**
- 영향: 영어 전환 시 VOC 페이지 선택지에 `voc.page_other` 노출. **규칙 G(동시 추가) 위반.**

---

### 🟡 B-03 `additional_notes` JSON 이 깨지면 BB 매핑 검증이 통과된다 **재현✅**
- 위치: `views.py:254-281`(`_validate_bb_mapping`, 관대한 `except (JSONDecodeError, TypeError): pass` 는 `:279-280`) — **2026-08-04 미수정 확인**
- 재현 결과
  ```
  깨진 JSON  → _validate_bb_mapping = None      (= 검증 통과)
  정상 JSON(미매핑) → '모든 원본 데이터에 bb 을 매핑해야 상신할 수 있습니다.'
  ```
- 근본 원인: `additional_notes` 가 `JSONField` 가 아니라 **`TextField`**(`models.py:108`)라 DB 가 깨진 JSON 도 받는다.
  `get_detail()`(`models.py:132-137`)도 실패 시 조용히 `{}` 를 돌려주므로 `is_only_map()`(`:139`)·
  `_validate_post_approvers`(`views.py:283`) **전부 무음으로 오판**한다 → Only MAP 문서가 일반 경로를 타거나,
  C가문 후결자 검증이 스킵된다. `has_ppid_plel()`(`models.py:164`)도 같은 `get_detail()` 을 쓰므로,
  JSON 이 깨진 문서는 `plel` 이 있어도 E 단계가 생성되지 않는다.
- 권고: 파싱 실패 시 **400 으로 거부**(관대한 통과 대신). 중기적으로 `JSONField` 전환 + 마이그레이션.
- 관련: 파싱이 성공해도 **최상위가 dict 가 아니면 `AttributeError` → 500** 이 되는 별개 구멍이 있다 → **B-63**.

### 🟡 B-08 `change_designee` 만 `requester` FK 직접 비교라 레거시 문서에서 작성자가 403 **재현✅**
- 위치: `views.py:1349-1353`(`change_designee`) — **2026-08-04 미수정 확인**
  ```python
  is_requester = (
      document.requester and document.requester.loginid == caller_loginid
  )
  ```
- 내용: 다른 곳은 모두 `doc_permissions.is_requester`(FK + **`requester_email` 폴백**, `doc_permissions.py:26-29`)를 쓴다.
  같은 파일 안에서도 `_can_manage_post_approver`(`views.py:1479`)·`update_validation_system`(`views.py:1078`)·
  `cancel_pause`(`views.py:1046`)는 전부 헬퍼를 쓰고 **`change_designee` 만 직접 비교**다.
  `requester` FK 는 `on_delete=SET_NULL` 이라 **작성자 계정이 삭제되거나, `perform_create` 이전에 만들어진 레거시 문서**는 FK 가 비어 있다.
- 재현 결과
  ```
  [B-08] FK 없는 문서의 실제 작성자가 change-designee -> 403   ← 버그
         같은 사용자·같은 문서로 withdraw          -> 200   ← 폴백이 있어 정상
  ```
- 영향: 실제 작성자가 지정자 변경만 못 한다. `add_post_approver` 는 2026-07 에 같은 버그를 고쳤는데 **여기만 남았다.**
- 권고: `doc_permissions.is_requester(request.user, document)` 로 교체.

### 🟡 B-09 철회 시 **모든 회차의 결재 이력이 전량 삭제**된다 **재현✅**
- 위치: `views.py:403` (`withdraw` 안의 `ApprovalStep.objects.filter(document=document).delete()`) — **2026-08-04 미수정 확인**
- 재현 결과: 1·2회차 합쳐 4건의 단계가 있는 문서를 철회 → **0건**
- 영향: "1회차에 누가 언제 왜 반려했는지" 가 영구 소실된다. 감사 추적 불가.
  결재 이력을 담는 별도 테이블이 없고 `ApprovalStep` 자체가 이력이라 복구 수단이 없다.
- 권고: 철회는 **현재 회차 pending step 만** 삭제하거나, 전 회차를 `withdrawn` 으로 마킹해 보존.

### 🟡 B-17 `resolvePathStatus`/`getDisplayStatus` 가 `pause` 를 반영하지 못하는 경로가 있다 **분석🔍**
- 위치: `utils/approvalTable.ts:14`(`getDisplayStatus`), `:89`(`resolvePathStatus`)
- 내용: `getDisplayStatus` 는 `doc.status !== 'under_review'` 면 원본 상태를 그대로 반환하므로 pause 는 정상이나,
  `resolvePathStatus` 는 `docStatus === 'rejected'` 만 특별 처리하고 **pause 는 분기하지 않는다**.
  `getDocTableRows` 가 pause 를 앞단에서 가로채기 때문에 지금은 드러나지 않지만,
  이 헬퍼를 다른 곳에서 재사용하면 pause 문서가 `under_review`/`unassigned` 로 표시된다.
- 권고: `resolvePathStatus` 에도 `if (docStatus === 'pause') return 'pause';` 추가.

### 🟡 B-18 '최종 완료예정' path1 추정치가 **영업일이 아니라 달력일** **분석🔍**
- 위치: `utils/approvalTable.ts:61-67` (`d.setDate(d.getDate() + 4)`)
- 내용: J 단계가 아직 없을 때 `P.due + 4` 를 **달력일**로 더한다. 백엔드 실제 J 기한은
  `calculate_business_due_date(p_date, 4)`(주말·공휴일 제외)라 **최대 4일 이상 차이**날 수 있다.
- 영향: 목록의 '최종 완료예정' 이 실제보다 이르게 표시 → 일정 관리 오판.
- 권고: J 미생성 시 `-`/`(예상)` 표기하거나 서버가 예상 기한을 내려주기.

### ✅ B-19 외부 API 잘못된 키가 401 이 아니라 403 — **2026-08-07 수정 완료**
- 조치: `ExternalApiKeyAuthentication.authenticate_header()` 추가(`return 'X-API-Key'`).
  `ExternalApiKeyAccessTest` 11건 통과.
- ⚠️ 외부 연동 영향: 잘못된 키의 응답 코드가 **403 → 401** 로 바뀐다(정상 키·키 없음 경로는 불변).

<details><summary>수정 전 기록</summary>

#### 🟡 B-19 외부 API 잘못된 키가 401 이 아니라 403 **재현✅**(기존 테스트가 실패)
- 위치: `authentication.py:84`(`ExternalApiKeyAuthentication`) — **2026-08-04 미수정 확인**(`authenticate_header` grep 결과 0건)
- 내용: `AuthenticationFailed` 를 던지지만 클래스에 **`authenticate_header()` 가 없어** DRF 가 401 → 403 으로 변환한다.
- 근거: `tests.py:349 ExternalApiKeyAccessTest.test_wrong_key_returns_401` 이 `AssertionError: 403 != 401` 로 실패
- 영향: 외부 연동 측이 "인증 실패(재시도/키 갱신)" 와 "권한 없음(포기)" 를 구분 못 한다. `docs/EXTERNAL_API.md` 와 불일치.
- 권고: `def authenticate_header(self, request): return 'X-API-Key'` 추가.

</details>

### 🟡 B-20 VOC 제출자 정보를 클라이언트가 정한다 **분석🔍**
- 위치: `views.py:1827-1829`(`VOCViewSet.perform_create` — `serializer.save()` 뿐), `serializers.VOCSerializer(fields='__all__')` — **2026-08-04 미수정 확인**
- 내용: `submitter_user_id`·`submitter_name`·`submitter_email` 이 **요청 본문 그대로** 저장된다(서버 파생 없음).
  `update_status`(`views.py:1832`)의 '완료' 권한이 `voc.submitter_user_id != request.user.id`(`:1841`) 로 판정되므로,
  **작성 시 남의 id 를 넣으면 그 사람만 완료 처리할 수 있게 되거나** 신고자를 위조할 수 있다.
- 권고: `perform_create` 에서 `request.user` 로 강제 세팅 + 해당 필드 `read_only`.

### 🟡 B-21 VOC 상태를 바꿔도 `responded_at` 이 안 채워진다 **분석🔍**
- 위치: `views.py:1832-1858`(`update_status`, 저장은 `:1856-1857`) — **2026-08-04 미수정 확인**
- 내용: `voc.status` 만 저장하고 `responded_at` 은 건드리지 않는다(모델에 필드는 있음). 항상 `null`.
- 권고: 완료/거부 시 `responded_at = timezone.now()`.

---

### ⚪ B-16 하드코딩 한국어 (규칙 G 위반) **재현✅**(정적 검색)
| 파일:라인 | 문자열 |
|---|---|
| `HistoryPage.tsx:183` | 삭제 버튼 `삭제` |
| `HistoryPage.tsx:220-223` | `문서 삭제` / `"…" 문서를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.` / `삭제` |
| `ApprovalPage.tsx:593` | `지정자가 변경되었습니다.` |
| `ApprovalPage.tsx:765` | `의뢰서가 삭제되었습니다.` |
| `ApprovalPage.tsx:1066` | `의뢰서가 완전히 삭제됩니다. 복구할 수 없습니다.` |
| `RequestPage/index.tsx` `validate()` 내부 | `errorMessages` 다수 (`… 필수 입력 항목입니다.` 등) |
| `RequestPage/index.tsx` `handleSubmit` 주변(`:3608`, `:3623` 인근) | `수정 후 상신되었습니다.` / `재상신되었습니다.` / `오류 발생: …` / `알 수 없는 오류` |
| `RequestPage/index.tsx:2974`, `:2990` | `필터 "…"이 삭제되었습니다.` / `모든 필터가 삭제되었습니다.` |
| `RequestPage/components/*` | `활성/전체`, `STEP 정렬`, `+ 행 추가`, `선택 비활성화`, `범위 추가`, `Ctrl+V 로 이미지를 붙여넣으세요` 등 (REQUEST.md §4 에 기록된 기존 항목) |
> 백엔드 응답 메시지(`'권한이 없습니다.'` 등)도 전부 한국어 고정이라 영어 사용자에게 그대로 노출된다.

### ✅ B-22 절대 통과할 수 없는 테스트가 있다 — **2026-08-07 수정 완료**
- 조치: 단언을 `assertEqual(subject, f'[결재 요청] {title}')` 로 교체.
  `[결재 요청]` 접두어는 2026-08-03(a1121dc)에 도입된 **의도된 구현**이고, 테스트가
  2026-07-24(6d3a756) 기준에 머물러 있던 것이 원인이었다.

<details><summary>수정 전 기록</summary>

#### ⚪ B-22 절대 통과할 수 없는 테스트가 있다 **재현✅**
- 위치: `tests.py:557` `test_broadcast_subject_has_no_name_prefix`
- 내용: `_build_message('stage_arrival', doc, agent='R')` 의 제목은 **항상 `[결재 요청] {제목} - R`** 인데
  `assertFalse(subject.startswith('['))` 로 단언한다 → 구현이 어떻든 실패.
- 의도 추정: "이름 접두어(`[홍길동님] `)가 없어야 한다" 였을 것 → `assertFalse(subject.startswith('[홍'))` 가 아니라
  `self.assertNotIn('님] ', subject)` 또는 `assertTrue(subject.startswith('[결재 요청]'))` 로 고쳐야 한다.

</details>

### ✅ B-23 테스트가 개발자 `.env` 에 의존한다 — **2026-08-07 수정 완료**
- 조치: `HybridImmediateSendTest.setUp` 에 TE_R 사용자를 추가해 `.env` 없이도 수신자가 잡히게 했다.
  (R 미배정 도착 → TE_R 팀 전원 발송은 2026-07-28 bd27b86 에서 도입된 규칙)

<details><summary>수정 전 기록</summary>

#### ⚪ B-23 테스트가 개발자 `.env` 에 의존한다 **재현✅**
- 위치: `config/settings/base.py:6` `load_dotenv()` + `tests.py:749`
- 내용: `test_enqueue_schedules_immediate_send_on_commit` 은 TE_R 사용자를 만들지 않아 수신자가 0명이라
  `_enqueue` 가 `None` 을 반환한다. **`.env` 에 `MAIL_REDIRECT_TO` 가 설정돼 있을 때만** 수신자가 강제로 채워져 통과한다.
- 영향: CI/다른 개발자 환경에서 재현 불가한 실패. 설정 의존 없는 테스트여야 한다.
- 권고: `@override_settings(MAIL_REDIRECT_TO='x@company.com')` 또는 TE_R 사용자 생성 추가.

</details>

### ⚪ B-24 `any` 사용 (규칙 I 위반) **재현✅**
- `ApprovalPage.tsx:213`, `:515` — `(data as any).results` (2026-08-04 재확인, 1곳 더 늘었다)
- `HistoryPage.tsx:53` — `(data as any).results`
> 이 외에 `ApprovalPage.tsx:544, 556, 943, 1675` 의 `t(\`approval.agent_${...}\` as any)` 는 i18next 키 타입 우회다(별개 유형).
> `documentsAPI.list` 의 반환 타입은 이미 `{ results, count }` 로 좁혀져 있어 캐스팅 자체가 불필요하다.

### ⚪ B-25 `StatusBadge` 가 VOC '거부' 를 결재 '반려' 로 표시 **분석🔍**
- 위치: `components/StatusBadge.tsx` — `STATUS_I18N_KEY` 에 `rejected: 'common.status_rejected'` 하나뿐.
  VOC 도 `rejected` 를 쓰므로 VOC 목록에서 `voc.status_rejected` 가 아니라 결재용 라벨('반려')이 나온다.
  (`checking`/`completed` 는 VOC 키가 있는데 `rejected` 만 빠짐)

---
---

## 5-2. 2차 정독에서 추가로 발견된 버그 (B-26 ~ B-47)

> 1차에서 다루지 않았던 **OIDC 인증 / 업로드·미디어 / 메일 렌더 / 사용자 삭제 파급 / 인프라 설정** 영역.

### 🔴 B-26 저장형 XSS → MASTER 권한 탈취 체인 **재현✅**
- 위치
  - 저장: `views.py:1827`(`VOCViewSet.perform_create` — sanitize 없음), `serializers.VOCSerializer(fields='__all__')`
  - 렌더: `pages/VOCPage.tsx:446`, `pages/GuidePage.tsx:268,328`, `components/GuideSlidePanel.tsx:132`, `pages/HomePage.tsx:257`
  - 의존성: `frontend/package.json` 에 **DOMPurify·sanitize-html 등 sanitizer가 아예 없다**
- 내용: VOC 내용은 `RichTextEditor`(TipTap)가 만든 **HTML 문자열**을 그대로 저장하고 그대로 `dangerouslySetInnerHTML`로 렌더한다.
  에디터를 거치지 않고 **API를 직접 호출**하면 임의 태그를 넣을 수 있다. VOC 작성은 **역할 제한이 없어** `NONE` 사용자도 가능하다.
- 재현 결과
  ```
  [C-01] VOC 생성(role=NONE) -> 201 | 저장된 content == 공격 payload 원문: True
  [C-03] (XSS로 탈취한) MASTER 세션으로 임의 사용자 MASTER 승격 -> 200 | role = MASTER
  [C-05] 가이드 생성(TE_O) -> 201 | content 원문 저장: True
  ```
- 영향: 쿠키가 HttpOnly라 **토큰 값은 못 읽지만**, 스크립트가 피해자 세션으로 API를 호출하는 것은 막지 못한다.
  피해자가 MASTER면 **역할 부여·사용자 삭제·문서 삭제**까지 한 번에 열린다(X-11).
  CSP도 없어(B-42) 2차 방어선이 전무하다.
- 권고: ① 서버 저장 시 허용 태그 화이트리스트로 sanitize(`bleach` 등) ② 렌더 시 DOMPurify ③ CSP `script-src 'self'` 도입.
  ①만으로도 기존 저장분은 남으니 **마이그레이션 시 기존 레코드도 재-sanitize** 필요.

### 🔴 B-27 OIDC `id_token` 만료·audience 검증이 꺼져 있다 **분석🔍**
- 위치: `auth_views.py:316-323` (`verify_exp` `:320` / `verify_aud` `:321`) — **2026-08-04 미수정 확인**
  ```python
  decoded_id_token = jwt.decode(..., options={
      'verify_signature': True,
      'verify_exp': False,   # ← 만료 검증은 ADFS가 처리하므로 생략
      'verify_aud': False,   # ← audience 미검증
  })
  ```
- 내용: 서명만 맞으면 **아무리 오래된 id_token도 영구히 유효**하다. 주석의 "만료 검증은 ADFS가 처리"는 성립하지 않는다 —
  이 엔드포인트는 **클라이언트가 보낸 토큰을 그대로 받는** 구조라 ADFS가 개입하지 않는다.
  `verify_aud: False` 때문에 **같은 ADFS가 다른 RP(다른 애플리케이션)에 발급한 토큰**도 통과한다.
- 재현 방법(T-Q2): 정상 로그인 시 network 탭에서 `id_token`을 복사 → 시간이 지난 뒤 `POST /api/auth/oidc/callback/` 에
  그 값만 담아 재전송 → **로그인 성공**
- 영향: 로그·프록시·브라우저 히스토리·referer 등 어디서든 id_token이 한 번 유출되면 **무기한 계정 탈취**.
  다른 사내 시스템의 토큰으로도 로그인 가능.
- 권고: `verify_exp: True`, `verify_aud: True` + `audience=OIDC_RP_CLIENT_ID`, `iss` 검증 추가.

### 🔴 B-28 nonce 검증을 호출자가 생략할 수 있고, `state`는 검증하지 않는다 **분석🔍**
- 위치: `auth_views.py:337-356`(nonce — `if nonce_jwt and id_token_nonce:` 는 `:337`, 실패 무시 `:355-356`),
  `auth_views.py:259-260`(state 를 URL 에 붙이기만 함), `:291`(`nonce_jwt` 를 요청 본문에서 받음) — **2026-08-04 미수정 확인**
  ```python
  if nonce_jwt and id_token_nonce:      # ← 둘 중 하나만 없어도 검증 전체를 건너뜀
      ...
      except Exception:
          logger.warning(...)            # ← 검증 실패해도 '호환성'을 이유로 그대로 진행
  ```
- 내용: `nonce_jwt`는 **요청 본문에 클라이언트가 넣는 값**이다. 공격자는 그냥 **빼고 보내면** 검증이 스킵된다.
  검증에 실패해도 warning 로그만 남기고 로그인이 진행된다. `state`는 ADFS로 보내기만 하고 **저장·비교하지 않는다**.
  코드 주석도 "CSRF 방어는 나중에 별도 처리"라고 인정하고 있다.
- 영향: OIDC의 표준 CSRF/replay 방어(nonce·state)가 **실질적으로 없다**. B-27과 결합하면 토큰 주입 로그인이 매우 쉬워진다.
- 권고: nonce_jwt를 클라이언트가 아닌 **서버 세션/쿠키**에 보관하고, 없거나 불일치하면 **무조건 400**.
  `state`도 동일하게 세션 저장 후 비교.

### 🔴 B-29 `AUTH_MODE=dev` 로 배포되면 전 API가 비인증 개방 **재현✅**
- 위치: `views.py:44`(`_is_dev`), `IsMasterOrReadOnly`(`:48`) / `IsAuthenticatedInProd`(`:57`) / `IsAuthenticatedOrMasterDelete`(`:64`) — **2026-08-04 미수정 확인**
- 내용: 세 permission 클래스 모두 `_is_dev() or request.user.is_authenticated` 형태라, dev 모드에서는 **인증 자체를 건너뛴다.**
- 재현 결과
  ```
  [C-04] (dev모드) 비인증 GET /api/documents/  -> 200
         (dev모드) 비인증 DELETE 승인문서      -> 204 | 문서 잔존: False
  ```
- 영향: 스테이징/검증 서버가 사내망에 노출돼 있으면 **로그인 없이 전체 의뢰서 열람·삭제**. `dev-login`은
  `AUTH_MODE` 가드가 있는데 permission 쪽은 정반대로 열려 있어 **가드가 무의미**하다.
- 권고: dev 우회를 최소 범위(읽기 전용 form-options 등)로 좁히고, **쓰기·삭제는 dev에서도 인증 요구**.
  배포 점검 항목에 `AUTH_MODE` 확인 추가(T-Q6).

---

### 🟠 B-30 담당자 계정 삭제 시 RA/RV/PV/EV 단계가 고아가 되어 결재가 영구 교착 **재현✅**
- 위치: `models.py`(`ApprovalStep.assignee = ForeignKey(..., on_delete=SET_NULL)`),
  `views.py:160`(`_can_act_on_step`) / `:178`(`_can_assign_step`) / `:195`(`_can_claim_step`), `views.py:2445`(`UserViewSet.destroy`)
- 내용: 계정이 지워지면 `assignee=None`이 되는데,
  - **J/O/E/P**는 `claim_step`이 `not step.assignee_id` 조건이라 ✅ 다른 팀원이 다시 선점해 회복된다.
  - **RA/RV/PV/EV**는 claim 대상이 아니고(`_CLAIM_AGENTS`에 없음) **재지정 API도 없다** → 아무도 처리할 수 없다.
- 재현 결과
  ```
  [E-01] TE_O 가 동료 TE_O(진행중 O단계 담당자) 삭제 -> 204 | assignee = None
         → 다른 TE_O 의 재-검토중 선점: 200   (회복 가능)
  [E-02] 후결자(RA) 계정 삭제 -> assignee = None | action = pending
         → 다른 PL 이 RA 합의 시도: 400 / RA claim 시도: 400   (처리 불가)
         → 작성자가 후결자 신규 추가로 회복: 200 | 고아 RA 단계는 pending 그대로: 1건
  ```
- 영향: `ra_ok = all(s.action=='approved' for s in ra_steps)` 이므로 고아 1건이 **최종 승인을 영구 차단**한다.
  MASTER가 `approve-step(agent='RA')`로 대신 합의해야만 탈출(MASTER 분기만 assignee 필터를 안 탄다).
- 부가: **MASTER가 아니어도 같은 역할끼리 서로 삭제 가능**하다(`UserViewSet.destroy`) — 진행 중 결재 담당 여부를 전혀 보지 않는다.
- 권고: 삭제 전 "진행 중 pending 단계 담당자" 검사 후 차단하거나, `remove-post-approver`가 **고아(assignee=None) RA도 제거**할 수 있게 확장.

### 🟠 B-31 그룹 생성자 계정 삭제 시 그룹이 통째로 사라진다 **재현✅**
- 위치: `models.py` `UserGroup.creator = ForeignKey(..., on_delete=CASCADE)`, `AddressBook.owner` 동일
- 재현 결과: `[E-03] 그룹 생성자 삭제 -> 그룹 잔존: False | 주소록 잔존: False`
- 영향: 그룹은 **임시저장 가시성(T-F3)·철회 권한(T-L1)·승인 메일 수신자** 판정의 근거다.
  생성자 한 명이 퇴사 처리되면 남은 멤버들이 **예고 없이** 서로의 draft를 못 보게 되고 철회 권한도 잃는다.
  이미 발송 대상이던 승인 메일도 조용히 줄어든다(에러 없음 → 인지 불가).
- 권고: `SET_NULL` + creator 부재 시 멤버 중 1명 승계, 또는 삭제 전 경고/이관 UI.

### 🟠 B-32 PL 액션에서 중단 요청 자동취소가 누락돼 요청이 고착된다 **재현✅**
- 위치: `views.py:234`(`_cancel_active_pause_requests` 정의) — 호출은 `:521`(`approve_step`)·`:723`(`reject_step`) **2곳뿐** ↔
  `views.py:1263`(`_advance_after_pl`)·`:1305`(`peer_reject`)에는 **호출 없음** — **2026-08-04 재실행으로 재현 재확인**
  (`PauseRequest.state = confirmed` 잔존 + 작성자 재-중단요청 403 — B-06 재현 블록 참조)
- 재현 결과
  ```
  [D-01a] PL 합의 후 중단요청 state = requested   (cancelled 여야 정상)
  [대조]  R  합의 후 중단요청 state = cancelled   ← 일반 단계는 정상
  [D-01b] 작성자의 재-중단요청 -> 403 (활성 요청에 막힘)
  [D-01c] 남은 중단요청 확인 시도 -> 403 (target이 이미 approved → 확인 불가)
  ```
- 영향: 유령 중단 요청이 남아 **작성자는 다시 중단 요청을 못 하고**, 담당자는 확인도 못 한다.
  화면에는 '중단 요청중' 칩이 계속 붙어 있어 오해를 부른다. 탈출은 `cancel-pause` 뿐.
- 권고: `_advance_after_pl` 와 `peer_reject` 에도 `_cancel_active_pause_requests(document)` 추가(B-06 가드와 함께).

### 🟠 B-33 VOC 알림 메일 본문이 escape되지 않는다 **재현✅**
- 위치: `mailer.py:855-877`(`_build_voc_message` — `voc.title`/`voc.submitter_name` 을 f-string 직삽입, `:860-862`) ↔
  대조 `mailer.py:585`(`_render_hero_kpi_email` 은 `escape()` 사용, `:594-598`) — **2026-08-04 미수정 확인**
- 재현 결과
  ```
  [C-02] VOC 메일 제목: [VOC 등록] <b>굵게</b><script>alert(1)</script>
         본문에 <script> 원문 포함: True | <i>이름</i> 원문 포함: True
  [대조] 결재 메일 본문에 <script> 원문 포함: False   ← escape 정상
  ```
- 내용: `voc.title`·`voc.submitter_name`·`commenter_name` 을 f-string으로 직접 HTML에 넣는다.
  결재 메일 경로는 `escape()`를 쓰는데 **VOC 경로만 빠졌다**.
- 영향: 관리자 메일함에서 **HTML 주입**(가짜 링크·위장 문구 삽입). 메일 클라이언트에 따라 피싱으로 이어진다.
- 권고: `_build_voc_message`에도 `escape()` 적용(제목은 메일 헤더라 태그 제거).

### 🟠 B-34 `/media/` 가 인가·보안헤더 없이 원본 Content-Type으로 서빙된다 **분석🔍**
- 위치: `nginx/nginx.conf:95-99` — **2026-08-04 미수정 확인**(`add_header` 는 `/django-static/` 의 `Cache-Control`(`:92`) 하나뿐)
  ```nginx
  location /media/ { alias /var/www/media/; expires 7d; }
  ```
- 내용: 접근 제어 없음, `Content-Disposition` 없음, `X-Content-Type-Options` 없음.
  nginx `mime.types`가 `.svg`→`image/svg+xml`, `.html`→`text/html`로 서빙하므로 **브라우저가 실행**한다.
- 영향: **B-02(미인증·확장자 무검증 업로드)와 결합하면 동일 오리진 저장형 XSS가 완성**된다.
  또한 의뢰서 첨부 M-shot 이미지가 인가 없이 열람 가능하다.
- 권고: `add_header X-Content-Type-Options nosniff always;` + 업로드 확장자 화이트리스트(B-02) +
  민감 첨부는 Django 경유 인가 서빙으로 전환.

### 🟠 B-35 OIDC 클레임(개인정보)이 평문 INFO 로그로 남는다 **분석🔍**
- 위치: `auth_views.py:390-407`(클레임 전 필드 루프 로깅), `authentication.py:55`(토큰 payload username 을 INFO 로 출력),
  설정 `base.py LOGGING` — root/`api.auth_views` 모두 `level: INFO`, console 핸들러
- 내용: 로그인 1회마다 **메일·부서·성·이름·UPN·sub·nonce**가 `docker logs`/수집기에 남는다.
- 영향: 개인정보 로그 유출(사내 규정·개인정보보호 이슈). 로그 접근 권한이 넓을수록 위험.
- 권고: 해당 루프를 `DEBUG` 레벨로 낮추고 운영은 `WARNING` 이상, 또는 마스킹 후 출력.

---

### 🟡 B-36 세션 갱신(refresh)이 access token 만료 후엔 동작하지 않는다 **분석🔍**
- 위치: `auth_views.py:118-120`
  ```python
  @api_view(['POST'])
  @permission_classes([IsAuthenticated])   # ← refresh 인데 인증을 요구
  def refresh_token_view(request):
  ```
- 내용: `CookieJWTAuthentication`이 만료된 access_token에 대해 `AuthenticationFailed`를 던지므로,
  **access가 살아 있을 때만** refresh를 호출할 수 있다. `SERVICE_JWT_REFRESH_TOKEN_LIFETIME = 7일` 설정이 사실상 사문화.
- 영향: 12시간 지나 돌아온 사용자는 항상 **재로그인**. 세션 경고 모달 흐름(만료 10분 전)에서만 우연히 동작한다.
- 부가: `refresh`가 **refresh_token을 회전하지 않는다**(재발급 없이 access만 갱신). `SIMPLE_JWT`의
  `ROTATE_REFRESH_TOKENS`/`BLACKLIST_AFTER_ROTATION` 설정은 이 쿠키 흐름에 **적용되지 않는 데드 설정**이다.
- 권고: `permission_classes([AllowAny])` + refresh_token 자체 검증만으로 처리(이미 함수 안에서 하고 있다).

### 🟡 B-37 SSO 재로그인 시 이름·부서가 빈 값으로 덮어써질 수 있다 **분석🔍**
- 위치: `auth_views.py:65-66`
  ```python
  user.deptname = dept_name or ''
  user.username = user_name or ''
  ```
- 내용: 클레임이 없거나 비면 **기존 값을 `''`로 밀어버린다**(보존이 아님). `mail`만 `email or user.mail`로 보존된다.
- 영향: 권한관리·결재 경로·메일 제목의 표시 이름이 빈칸이 된다. 이미 `ApprovalStep.assignee_name`에
  복사된 이름은 그대로라 **같은 사람이 화면마다 다르게 보인다**.
- 권고: `mail`과 동일하게 `dept_name or user.deptname` 패턴으로 통일.

### 🟡 B-38 `/documents/stats/` 가 draft 가시성 규칙을 무시한다 **재현✅**
- 위치: `views.py:1646-1655`(`stats`) — `RequestDocument.objects.count()` (get_queryset 미사용) — **2026-08-04 미수정 확인**
- 재현 결과: `[D-02] 외부인 목록 건수 = 0 | stats.by_status.draft = 2 | stats.total = 2`
- 영향: 목록에서는 숨겨진 남의 임시저장 문서가 **통계에는 집계**된다(건수 수준 정보 노출).
- 권고: `self.filter_queryset(self.get_queryset())` 기반으로 집계.

### 🟡 B-39 메일 재시도에 backoff가 없어 짧은 장애로 영구 유실된다 **분석🔍**
- 위치: `mailer.py:938`(`_process_one`) / `:973`(`process_mail_queue`), 스케줄러 주기 1분, `max_attempts=5`
- 내용: 실패해도 대기 없이 **1분 주기로 5회 연속** 시도한 뒤 `status='failed'`로 확정된다.
  즉 **DXHUB가 5~6분만 죽어 있어도 그 시간대의 모든 결재 알림이 영구 유실**된다.
  failed 행을 다시 태우는 재처리 경로도, 관리자 알림도 없다(Django admin 목록에서 눈으로 보는 것이 전부).
- 영향: 결재 도착 알림 누락 → 결재 지연. 사용자는 메일이 안 온 사실 자체를 모른다.
- 권고: `attempts`에 비례한 지수 backoff(다음 시도 시각 필드 추가) + `failed` 발생 시 관리자 통보.

### 🟡 B-40 재상신 변경이력 diff가 오탐할 수 있다 **분석🔍**
- 위치: `components/PagedDetailView.tsx:513-518`(`computeDetailDiff`), 호출 `:742` — **2026-08-04 미수정 확인**
  ```ts
  if (JSON.stringify(cur?.[k]) !== JSON.stringify(prev?.[k])) changed.add(k);
  ```
- 내용: ① `JSON.stringify`는 **객체 키 순서에 민감**하다. `setDetail({ ...parsed.detail, other_purpose, bb_entries, notifiers })`
  처럼 일부 키를 뒤에 재삽입하면 저장 시 키 순서가 바뀌어 **내용이 같아도 '변경됨'** 으로 잡힌다.
  ② 편집 로드 시 `bb_entries`에 **id를 백필**한다(`e.id ?? genId()`) → 이전 스냅샷에는 없던 `id`가 생겨
  `bb_entries`가 **항상 변경으로 표시**된다.
- 영향: 상세보기에서 실제로 바뀌지 않은 항목이 빨갛게 강조 → 결재자가 변경분을 신뢰하지 못한다(경고 피로).
- 권고: 키 정렬 후 비교(`rowContentSig`처럼) + 비교 전 `id` 등 비의미 필드 제거.
- 부가 확인 필요: `buildEnrichedForm`은 **PL '수정 후 상신'(`isPeerReviewMode`)에서도 `shouldAddHistory=true`** 로 호출된다.
  즉 PL이 수정할 때마다 history가 쌓여 상세에 '변경 이력'으로 표시되는데, `docs/APPROVAL.md §7`은
  "**반려 후 재상신 시** 직전 스냅샷 대비"라고만 적혀 있다 → **문서와 구현의 범위 불일치**(의도 확인 필요).

### 🟡 B-41 `SECRET_KEY` 기본값이 안전하지 않고 production에서도 오버라이드되지 않는다 **분석🔍**
- 위치: `config/settings/base.py:11` — **2026-08-04 미수정 확인**
  ```python
  SECRET_KEY = os.environ.get('DJANGO_SECRET_KEY', 'django-insecure-change-me-in-production')
  ```
  `production.py`는 SSL/HSTS만 설정하고 `SECRET_KEY`를 손대지 않는다.
- 내용: `.env`에 `DJANGO_SECRET_KEY`가 없으면 **공개 저장소에 적힌 문자열**이 그대로 쓰인다.
  이 키는 세션 서명 + **OIDC `nonce_jwt` 서명**에 쓰이므로(B-28), 키가 알려지면 nonce 위조까지 가능하다.
- 권고: 미설정 시 기동 실패(`raise ImproperlyConfigured`)로 fail-fast.

### 🟡 B-42 보안 응답 헤더가 하나도 없다 **분석🔍**
- 위치: `nginx/nginx.conf` 전체 — `add_header`는 `/django-static/`의 `Cache-Control` 하나뿐
- 내용: **CSP / X-Frame-Options / X-Content-Type-Options / Referrer-Policy 전부 없음**.
  Django의 `XFrameOptionsMiddleware`는 Django 응답에만 붙고, React SPA는 별도 프론트 컨테이너가 서빙하므로 적용되지 않는다.
- 영향: ① B-26 XSS의 2차 방어선 부재 ② 클릭재킹 가능 ③ `/media/` MIME 스니핑(B-34)
- 권고: nginx `server` 블록에 4종 헤더 추가. 단 `/approval?embed=tour` iframe(전체 가이드)이 **동일 출처**이므로
  `X-Frame-Options: SAMEORIGIN`(DENY 아님)으로 둘 것 — DENY로 하면 투어가 깨진다.

---

### ⚪ B-43 OIDC 콜백의 데드코드·취약한 휴리스틱 **분석🔍**
- `auth_views.py:288` `auth_code = request.POST.get('code') or request.data.get('code')` — **받기만 하고 전혀 사용하지 않는다**.
  authorization code 교환(token endpoint)도, `at_hash`/`c_hash` 검증도 없다.
- `auth_views.py:444-450` — `if username and '=' in username:` 이면 **base64 디코딩을 시도**한다.
  loginid/UPN에 `=`가 들어가는 순간 엉뚱한 값으로 바뀔 수 있는 매우 취약한 추론이다(실패 시 `except: pass`로 조용히 넘어감).

### ✅ B-44 담당자 미지정 시 고정 수신 이메일이 코드에 하드코딩 **해결(2026-08)**
- **해결**: J 병렬 분리와 함께 `UNASSIGNED_FALLBACK` 딕셔너리를 **삭제**했다. J 도 R·P 와 동일하게
  "미배정이면 팀 전원(`_team_emails`), 배정 후엔 그 담당자 1명" 규칙을 쓴다(`mailer.py resolve_stage_recipients`).
  이 딕셔너리가 유일한 하드코딩 수신 주소였으므로 코드에 남은 고정 주소는 없다.
  회귀 고정: `RecipientResolutionTest.test_j_unassigned_broadcasts_to_whole_team`,
  `PEStageReviewerFlowTest.test_j_unassigned_arrival_has_no_hardcoded_fallback_address`
- (이하 원래 지적 내용) 위치: `mailer.py:102` `UNASSIGNED_FALLBACK = {'J': 'user_J@company.com'}` (사용처 `mailer.py:286`)
- 주석이 "이 딕셔너리를 직접 수정하고 재시작하라"고 안내한다. **수신자 변경에 배포가 필요**하다.
  규칙 D의 "설정은 코드에 하드코딩하지 않는다" 취지와 어긋난다.
  (참고: 비교 대상이었던 P 단계 라인별 `.env` 설정 `P_LINE_FALLBACK`은 미사용 상태로 코드에서 삭제됨 — 2026-08)

### ⚪ B-45 `useCellSelection` 의 키 구분자와 메모이제이션 **분석🔍**
- 위치: `hooks/useCellSelection.ts:20-21`(`SEP`/`keyOf`), 이후 `k.split(SEP)` 구간
- `const SEP = ' '`(공백)로 `${rowId} ${col}` 키를 만들고 `k.split(SEP)`로 **구조분해**한다.
  현재 `genId()`가 `${Date.now()}_${random}` 이라 공백이 없어 동작하지만, id 생성 규칙이 바뀌면 조용히 깨진다.
- `cellLocked`가 컴포넌트 본문에서 **매 렌더 새 함수**로 만들어지고 `clearSelectedValues`/`onCellPaste`의
  `useCallback` deps에 들어가 있어, **매 렌더마다 document keydown/mousedown 리스너가 재등록**된다(기능 영향은 없으나 낭비).

### ⚪ B-46 `title` 에 DB 유니크 제약이 없다 **재현✅**
- 재현 결과: 순차 생성 3건 → `['같은제목', '같은제목_2', '같은제목_3']`(정상). 단 `title.unique = False`
- `_unique_title`은 **조회 기반**이라 두 사용자가 동시에 저장하면 같은 suffix를 계산해 **중복 제목**이 생긴다.
  또 create/update마다 `title__startswith` 전체 스캔이 돌아 문서가 늘수록 저장이 느려진다(인덱스 없음).

### ⚪ B-47 `.gitignore` 규칙과 실제 추적 파일이 모순 **재현✅**
- `.gitignore`에 `nginx.conf` / `*nginx.conf`가 있는데 `nginx/nginx.conf`·`nginx/nginx.dev.conf`는 **이미 추적 중**이다
  (`git ls-files` 확인). 이미 추적된 파일에는 ignore가 적용되지 않아 규칙이 무의미하고, 읽는 사람을 오도한다.
- `backend/api/certs/*.cer` 2개가 **추적되고 있으며 .gitignore에 없다**(현재는 36/26바이트 placeholder).
  실제 인증서를 넣는 순간 커밋될 위험이 있다. 참고로 placeholder 상태에서는 `get_adfs_public_key()`가
  파싱에 실패해 `oidc_callback`이 500('인증서 로드 실패')을 반환하므로 **SSO 로그인이 아예 되지 않는다**.

### ⚪ B-48 미적용 마이그레이션 1건 (스키마 영향 없음) — ✅ **해소 확인**(2026-08-04)

> **2026-08-04 재실행**: `manage.py makemigrations --check --dry-run` → **`No changes detected`(exit 0)**.
> 그 사이 마이그레이션이 `0012_design_rule_overrides` 까지 추가되면서 정리된 것으로 보인다.
> 아래는 1차 기록(원문 보존).
```
$ python manage.py makemigrations --check --dry-run
Migrations for 'api':
  api/migrations/0011_alter_requestdocument_production_date.py
    - Alter field production_date on requestdocument
```
- 차이는 **`verbose_name` 뿐**이다 — 마이그레이션 `0001`은 `verbose_name='request.production_date'`,
  현재 모델은 `'실제 생산 진행 날짜'`. DB 컬럼 변경은 없으므로 **데이터·동작 영향은 없다**
  (`models.py` 상단의 "MASKING 처리된 파일" 안내와 관련된 흔적으로 보인다).
- 다만 CI에 `makemigrations --check`를 넣으면 **바로 실패**하고, 개발자가 `makemigrations`를 돌릴 때마다
  이 파일이 생성돼 노이즈가 된다. 정리해 두는 편이 좋다.

---

## 5-3. Merge 기획 의도 대조에서 발견된 버그 (B-49 ~ B-56)

> 2026-08-02, `Layer 추가/삭제` Merge 의 기획 의도(**T-B7 사양** 참조)를 확정한 뒤 코드를 재대조해 나온 항목.
> 대상 코드는 전부 프론트 `frontend/src/pages/RequestPage/index.tsx` 의 `handleMergeClick` / `handleMergeConfirm` 이었다.
> **백엔드에는 J/O-layer Merge 로직이 존재하지 않는다.**
>
> ⚠️ **2026-08-04 위치 갱신** — 수정 결과 판정 로직이 `RequestPage/helpers.ts` 의 순수 함수 `computeLayerMerge` 로 이동했다.
> 아래 B-49~B-56 본문에 인용된 `index.tsx:21xx` 코드 블록은 **더 이상 존재하지 않는 수정 전 원문**이다(재발 방지용 보존).
> 현재 위치: `index.tsx:2301`(`handleMergeClick` — `stats` 만 사용) / `:2309`(`handleMergeConfirm` — `merged` 만 사용) /
> `:2327`(`merge_ref_doc_id` 기록) / `helpers.ts`(`computeLayerMerge` 본체).
>
> **처리 현황 (2026-08-02)** — B-49·B-50·B-51·B-54·B-55 **수정 완료**, B-52·B-53 **철회**(기획 확인 결과 버그 아님), B-56 **보류**.
> 판정 로직은 순수 함수 `computeLayerMerge`(`RequestPage/helpers.ts`)로 분리했고 단위 테스트 12건이 붙어 있다.

### 🟠 B-49 ① 신규 판정이 아예 구현돼 있지 않다 (사양 ① 미구현) — ✅ **수정 완료**(2026-08-02)
- 위치(수정 전): `index.tsx` 구 `handleMergeConfirm`
```js
const mergedJayer = jayerRows.map((r) => {
  if (!r.disabled && refJayerKeyMap.has(makeKey(r))) {
    return { ...r, st: 'X', new_or_copy: '기등록' };   // ③ 만 처리
  }
  return r;                                            // ← ① 이어야 할 행을 그대로 둔다
});
```
- 내용: **B 에만 있는 행(A 에 없음)** 은 사양상 `st='O'` / `new_or_copy='신규'` 가 되어야 하는데,
  `return r` 로 **원래 값이 그대로 유지**된다. 통계에도 잡히지 않아 확인 모달에 **신규 건수 자체가 없다**.
- 영향: Merge 를 눌러도 "이번에 추가되는 layer" 가 표시되지 않는다.
  **"미매칭이 1건 있는데 모달에 0건으로 나온다"는 현상의 원인**(2026-08-02 기획 확인으로 확정) — 모달의 두 숫자는 ③과 ②뿐이라 ①은 어떤 값으로도 나타나지 않는다.
- **수정(2026-08-02)**: `computeLayerMerge` 가 ①을 `st='O'`/`new_or_copy='신규'` 로 판정하고 `stats.added` 로 집계한다. 확인 모달도 3-way 로 바꿨다.

### 🟠 B-50 ② layer 삭제 행이 A 원본 값을 그대로 들고 들어온다 (사양 ② 미구현) — ✅ **수정 완료**(2026-08-02)
- 위치(수정 전): `index.tsx` 구 `handleMergeConfirm` 의 push 루프
```js
refJayerRows.filter((r) => !r.disabled).forEach((r) => {
  if (!activeJayerKeys.has(makeKey(r))) {
    mergedJayer.push({ ...r, id: genId(), sortOrder: Date.now(), loaded: true });
  }                        // ↑ st / new_or_copy 를 덮어쓰지 않는다
});
```
- 내용: A 에만 있는 행은 `st='X'` / `new_or_copy='layer삭제'` 로 추가돼야 하는데,
  `{ ...r }` 로 **A 의 `st`·`new_or_copy` 를 그대로 복사**한다. A 는 결재완료 문서라 그 값은 대개 `O`/`신규` 다.
- 영향: **삭제되어야 할 layer 가 '신규'로 표시**된다. 사양과 정반대 값이라 그대로 상신되면 후속 공정이 오판한다. O-layer 도 동일.
- **수정(2026-08-02)**: `computeLayerMerge` 가 ② 행을 `st='X'`/`new_or_copy='layer삭제'` 로 **덮어써서** 추가한다.
  또한 A 의 `layer삭제` 행은 **부재**로 보므로 ② 대상에서 제외된다(사양 확정).

### 🟠 B-51 Merge 가 멱등하지 않다 — 두 번 누르면 `layer삭제` 가 `기등록` 으로 뒤집힌다 — ✅ **수정 완료**(2026-08-02)
- 내용: 1회차 Merge 로 추가된 ② 행들은 B 의 활성 행이 된다. 같은 A 로 2회차 Merge 를 누르면
  그 행들의 키가 `activeJayerKeys` 에 들어가 있으므로 **③(기등록)으로 매칭**되어 `new_or_copy` 가 `layer삭제` → `기등록` 으로 덮인다.
- 재현: 참조 요청서 선택 → Merge → 확인 → **같은 문서로 다시 Merge → 확인** → 노란색(`layer삭제`) 행이 회색(`기등록`)으로 바뀜
- 영향: 실수로 두 번 누르면 삭제 대상 정보가 조용히 소실된다. 되돌릴 UI 가 없다.
- **수정(2026-08-02)**: 참조 요청서를 **의뢰서당 1건**으로 제한. `detail.merge_ref_doc_id` 에 기록하고, 값이 있으면
  참조 선택 입력·Merge 버튼을 모두 잠근다. `additional_notes` 에 저장되므로 임시저장 후 재진입해도 유지된다.
  추가로 `computeLayerMerge` 자체가 멱등하도록 만들었다(같은 A 로 두 번 계산해도 결과 동일 — 단위 테스트 포함).

### ⚪ B-52 ~~Merge 이후 셀 편집이 J↔O 로 전파돼 A 기준 판정을 뒤집을 수 있다~~ — 🚫 **철회**(의도된 동작)
- 내용: Merge **시점** 의 J↔O 격리는 의도대로 동작한다(T-B7 참조). 그러나 Merge **이후** 사용자가 셀을 편집하면
  `handleJayerChange`(`index.tsx:1877~`)의 J→O 동기화가 다시 살아난다.
  `기등록`·`layer삭제` 는 `isNocSpecial`(`constants.ts:93`) 로 송·수신이 모두 차단되어 보호되지만,
  **B-49 를 고쳐 ① 이 `신규` 로 채워지면 그 행은 "참여행" 이라 전파 대상**이 된다.
- 영향: A 대조로 정한 값이 같은 `layerid` 의 반대편 표로 전염될 수 있다(사양 "J↔O 동기화 차단" 위반).
- **철회 사유(2026-08-02)**: 기획 확인 결과 "J↔O 동기화 차단"은 **Merge 시점에만** 요구되는 것이고,
  Merge **이후** 수동 편집은 기존 J↔O 동기화 규칙(T-D1)을 그대로 따르는 것이 의도된 동작이다. 조치하지 않는다.

### ⚪ B-53 ~~매칭 키에 `layerid` 가 없고, `Set` 중복 제거로 건수가 축약된다~~ — 🚫 **철회**(사양상 키에 포함하지 않음)
- 위치(수정 전): `index.tsx` 구 `makeKey = process_id||sp||sd||pp` (**`layerid` 미포함**). 현재는 `helpers.ts` `computeLayerMerge` 내부.
- 내용: 같은 `(process_id, sp, sd, pp)` 에 `layerid` 만 다른 행이 A 에 2개 있으면
  `new Set(...)` 이 **1개 키로 축약**해 둘을 구분하지 못한다. 통계뿐 아니라 `handleMergeConfirm` 도 같은 키를 쓰므로
  그 행이 **표에 추가조차 되지 않는다**.
- **철회 사유(2026-08-02)**: 운영 데이터상 `(process_id, sp, sd, pp)` 4-tuple 중복이 없다고 확인되어 `layerid` 를 키에 넣지 않기로 확정.
  다만 값 앞뒤 공백 때문에 오매칭이 나지 않도록 **`trim()` 정규화만** `computeLayerMerge` 에 추가했다.

### 🟡 B-54 통계와 실제 반영이 서로 다른 코드에서 계산된다 — ✅ **수정 완료**(2026-08-02)
- 위치(수정 전): `handleMergeClick` 과 `handleMergeConfirm` 에 `makeKey` 와 매칭 로직이 **각각 복붙**돼 있었다.
- 내용: 두 곳이 어긋나면 **모달 숫자와 실제 표 반영이 달라진다**. 지금도 B-49 때문에 실제로 어긋나 있다
  (모달은 ①을 세지 않고, 반영도 하지 않는다 — 우연히 일치할 뿐 구조적 보장이 없다).
- **수정(2026-08-02)**: `computeLayerMerge(curRows, refRows) → { merged, stats }` 순수 함수로 단일화.
  `handleMergeClick` 은 `stats` 만, `handleMergeConfirm` 은 `merged` 만 쓴다 → 모달 숫자와 표 반영이 어긋날 수 없다.

### ⚪ B-55 push 되는 행이 모두 같은 `sortOrder` 를 받는다 — ✅ **수정 완료**(2026-08-02)
- 위치(수정 전): `index.tsx` 구 push 루프 2곳 — `sortOrder: Date.now()`
- 내용: `forEach` 루프가 같은 밀리초에 돌면 추가된 행 전부가 **동일한 `sortOrder`** 를 갖는다.
  `sort((a,b) => a.sortOrder - b.sortOrder)` 는 안정 정렬이라 즉시 깨지진 않지만, 저장·재로드 시 순서 보장이 없다.
- **수정(2026-08-02)**: `base + index` 로 부여해 추가 행마다 서로 다른 값을 갖는다.

### ⚪ B-56 B 의 비활성 행과 키가 같은 A 행이 중복으로 추가된다 — ⏸ **보류**(영향 경미)
- 내용: B 의 `disabled` 행은 `activeJayerKeys` 에서 제외된다. 그 키가 A 에 있으면 "②(A에만 있음)" 로 판정되어
  **같은 `process_id/sp/sd/pp` 행이 하나 더 push** 된다 → 표에 비활성 행과 신규 행이 나란히 보인다.
- 참고: 결재완료 문서(A)는 상신 시 `jayerRows.filter(r => !r.disabled)` (`index.tsx:3359-3360`, `buildEnrichedForm`)로 저장되어
  **비활성 행이 아예 없다**. 따라서 이 문제는 **B 쪽 비활성 행**에서만 발생한다.
  ⚠️ 단 이 "비활성 행은 저장에서 빠진다" 는 성질 자체가 별도 결함의 원인이다 → **B-58 / B-59**.
- **보류 사유(2026-08-02)**: B 의 비활성 행도 상신 시 저장에서 제외되므로 **최종 문서에는 중복이 남지 않는다**.
  작성 중 화면에만 두 행이 나란히 보이는 수준이라 이번 범위에서 제외했다.

### Validation System 리뷰(2026-08-04) — 이번에 고치지 않은 MEDIUM/LOW 10건

2026-08-03 "Validation System 판정 주체 상신자 단일화" 구현에 대한 코드 리뷰 결과 중,
BLOCKER 1건 + HIGH 4건만 수정했다(커밋 `e320776`~`152d2df`). 나머지는 아래에 기록만 한다.

**MEDIUM**

| # | 위치 | 증상 |
|---|---|---|
| ~~VS-06~~ | ~~`_rewind_e_stage`~~ | ✅ **(2026-08-06 해결)** 되감기 자체를 제거해 자연 소멸. 값 변경은 E step `comment` 의 `[값 변경 …]` note 로만 남는다(`_note_validation_system_change`). 근거: `docs/superpowers/plans/2026-08-06-mask-ev-or-consensus-and-remove-rewind/` |
| VS-07 | `frontend/src/pages/ApprovalPage.tsx:943` 인근 (반려 모달) | '수정 요청' 버튼을 눌러도 모달 제목이 `approval.modal_reject_title`("… 반려"), 라벨이 "반려 이유 (선택)", 확인 버튼이 빨간 `btn-danger` 다. 성공 토스트만 분기돼 있다 |
| VS-08 | `backend/api/views.py:709-715`(`reject_step` 의 E/EV 분기), `backend/api/mailer.py:785`(`enqueue_revision_requested`) | `enqueue_revision_requested(document)` 가 comment 를 받지 않아 **수정 사유가 메일 본문에 실리지 않는다.** 상신자는 결재 경로 탭을 직접 뒤져야 한다 |
| VS-09 | `frontend/src/pages/ApprovalPage.tsx` `handleValidationSystemChange`(`:497~`) | 모든 실패를 `common.process_error` 로 뭉갠다. 백엔드는 "MASK 검토가 끝난 의뢰서는 변경할 수 없습니다" 같은 구체적 사유를 준다 |
| VS-10 | `frontend/src/pages/ApprovalPage.tsx:488`(`canEditValidationSystem` 의 `isOwner`) | `isOwner` 에 `requester_name` 폴백이 없다. 형제 검사(`:1125-1129` `isPauseRequester`)와 `backend/api/doc_permissions.py:26-29` 에는 있다. fail-closed 라 손상은 없고 기능만 안 보인다 |
| VS-11 | `frontend/src/pages/ApprovalPage.tsx` `handleValidationSystemChange` | `processing` in-flight 가드가 없다(규칙 J). 연타하면 동시 POST 가 나가고 토스트 순서가 뒤집힌다. `select_for_update` 가 직렬화하므로 데이터 손상은 없다 |
| ~~VS-12~~ | ~~`handleValidationSystemChange`~~ | ✅ **(2026-08-06 해결)** 응답 `rewound` 필드를 제거하고 토스트를 단일 문구로 단일화해 자연 소멸. 근거: `docs/superpowers/plans/2026-08-06-mask-ev-or-consensus-and-remove-rewind/` |

**LOW**

| # | 위치 | 증상 |
|---|---|---|
| VS-13 | `backend/api/views.py:1391` `_get_validation_system` | `(JSONDecodeError, TypeError)` 만 잡는다. `json.loads('[]')` 처럼 비-dict 가 나오면 `data.get` 에서 `AttributeError` → 500. 기존 `_set_validation_system`(`:1400`)에도 있던 구멍이라 회귀는 아니다 → **범위를 넓혀 B-63 으로 승격** |
| VS-14 | `docs/REQUEST.md:319, 322` | 레거시 문서 항목이 아직 "MASK 담당자 합의 모달"을 언급한다(그 모달은 삭제됐다). 용어 교체 항목의 "뒤의 두 문구"도 실제로는 한 개만 나열한다 |
| VS-15 | `backend/api/views.py:677`(`reject_step` pause 가드) ↔ `:1082`(`update_validation_system` 는 `('under_review','pause')` 허용) | 문서가 `pause` 상태면 MASK 가 수정 요청을 보낼 수 없는데, 상신자는 `pause` 중에도 값을 바꿀 수 있다. 사소한 비대칭 |

---

## 5-4. 3차 정독 — `additional_notes` 저장 정합성 (B-57 ~ B-64)

> 2026-08-04. 주제 하나만 봤다: **`additional_notes` 에 저장되면 안 되는 값이 남는가, 저장돼야 하는 값이 사라지는가.**
> 이 컬럼은 J/O-layer·BB·MAP·통보처·후결자·Validation System·Merge 스냅샷·history 를 **전부** 담는
> 스키마 없는 `TextField` 라(R-01), 한 번의 잘못된 저장이 결재 경로 자체를 바꾼다.
>
> **검증 상태**: 백엔드에서 관찰 가능한 **B-57·B-63 은 `재현✅`**(§1.4.1 레시피로 실행, 출력은 각 항목에 첨부).
> 나머지 6건(B-58·59·60·61·62·64)은 **프론트 위저드 상태 전이가 있어야 재현되는 항목**이라 `분석🔍` 이며,
> §7 의 브라우저 수동 시나리오로 확인해야 한다. 각 항목에 코드 근거 라인과 재현 절차를 함께 적었다.

### 저장 경로 지도 (읽기 전에)

| # | 경로 | 저장 방식 | 코드 |
|---|---|---|---|
| ① | 의뢰서 작성/편집 화면의 임시저장·자동저장·상신·재상신·재개·PL수정후상신 | **`additional_notes` blob 통째로 PATCH** | `RequestPage/index.tsx:3297` `buildEnrichedForm` → `client.ts:176` `patch` |
| ② | Validation System 변경 | 서버가 `detail.validation_system` **부분 수정** | `views.py:1400` `_set_validation_system` |
| ③ | 후결자 추가/제거 | 서버가 `detail.post_approvers` **부분 수정** | `views.py:1457` `_sync_post_approvers_detail` |

> ①은 blob 전체를 덮어쓰고 ②③은 부분 수정이다. **①이 나중에 실행되면 ②③의 결과가 사라진다** — B-62 의 뿌리이며,
> B-57·B-61 은 그 구체적 발현이다.

---

### 🟠 B-57 C가문이 아닌 문서의 **추가 후결자가 저장 때마다 전량 삭제**된다 **재현✅**(2026-08-04)
- 위치
  - 저장: `RequestPage/index.tsx:3351`
    ```ts
    post_approvers: detail.only_prodc === 'Yes' ? postApprovers : [],
    ```
  - 서버 기록: `views.py:1487` `add_post_approver` → `views.py:1457` `_sync_post_approvers_detail`
  - 소비: `mailer.py:230-237` `post_approver_users` → `views.py:1221-1229` `_advance_to_parallel` (RA 단계 생성)
- 내용: `add_post_approver` 에는 **`only_prodc` 검사가 없다**(`views.py:1487-1540`). 프론트의 후결자 관리 UI도
  `canManagePa`(`ApprovalPage.tsx:1153`)가 `isMaster || isPauseRequester` + `under_review` + 병렬 진입만 보므로
  **일반 문서(only_prodc ≠ 'Yes')에도 후결자를 추가할 수 있다.**
  `remove_post_approver` 의 docstring(`views.py:1548-1551`)도 *"그 외 일반 문서는 0명까지 뺄 수 있다"* 라고 적어
  **일반 문서에 추가 후결자가 존재하는 것을 정상 상태로 전제**한다 — 저장 쪽만 그 전제를 어기고 있다.
  그런데 작성 화면의 저장은 `only_prodc === 'Yes'` 가 아니면 **무조건 `[]`** 를 쓴다.
  편집 로드가 `detail.post_approvers` 를 `postApprovers` state 로 복원해 두어도(`index.tsx:826`) 이 삼항이 그 값을 버린다.
- 발현 경로 3가지 (모두 `buildEnrichedForm(..., isDraft=false)` → PATCH)
  1. **반려 → 재상신** (`index.tsx:3623` → `resubmit`)
  2. **PAUSE → 재개** (`index.tsx:3623` → `resume`)
  3. **PL '수정 후 상신'** (`index.tsx:3608` → `peer_submit`)
- 영향: 재상신 경로가 가장 나쁘다. `resubmit`(`views.py:343`)은 RA 단계를 만들지 않고,
  RA 는 나중에 `_advance_to_parallel` 이 **`detail.post_approvers` 를 다시 읽어** 생성한다.
  그 값이 `[]` 가 됐으므로 **추가 후결자의 결재 단계가 아예 생성되지 않는다** — 반려 전에 결재선에 있던 사람이
  조용히 빠지고, 아무 에러도 나지 않는다.
  (C가문 문서는 `_validate_post_approvers`(`views.py:283`)가 재상신을 400 으로 막아 주므로 이 경로에서 보호된다.
   **보호받지 못하는 쪽이 일반 문서**라는 점이 이 버그의 핵심이다.)
- **재현 결과**(2026-08-04, `APIClient` 로 전 구간 완주 — 프론트 저장 payload 는 `only_prodc='No'` + `post_approvers=[]` 로 재현)
  ```
  [사전] 병렬 진입 status=under_review
  [1] add-post-approver -> 200 | detail.post_approvers=[{'loginid':'extrara','name':'extrara'}] | RA=['extrara','fixedra']
  [2] 재상신 직전 PATCH -> 200 | detail.post_approvers=[]        ← 저장 한 번에 소실
  [3] 재상신 후 round=2 RA 단계 = ['fixedra']                     ← 추가 후결자 단계가 생성되지 않음
  ```
  **`add-post-approver` 는 일반 문서에서도 200 으로 통과**하고(전제 확인), 그 뒤 저장 한 번으로
  `detail.post_approvers` 가 비고, 재상신 후 RA 는 고정 후결자 1명만 생성된다.
- 브라우저 재현 절차: 일반 의뢰서(only_prodc=No) 상신 → R 합의로 병렬 진입 → 결재현황 상세에서 **'+ 후결자 추가'** 로 1명 추가
  → 그 문서를 반려 → 작성자가 '수정 후 재상신' → STEP5 상신 →
  **결재 경로 탭에 추가했던 후결자의 RA 단계가 없으면 버그.**
- 권고: 삼항을 없애고 `post_approvers: postApprovers` 로 저장하되, `only_prodc` 를 'No' 로 바꾸는 핸들러
  (`index.tsx:1665-1700`)에서 `setPostApprovers([])` 를 함께 호출해 **초기화 책임을 상태 변경 시점으로 옮긴다.**
  근본적으로는 후결자를 `detail` blob 이 아니라 `ApprovalStep(agent='RA')` 단일 진실원천으로 두는 것이 맞다.

### 🟠 B-58 필터로 비활성화된 J/O 행이 **상신 시 문서에서 사라지고**, 그 판정이 `localStorage` 에 달려 있다 **분석🔍**
- 위치
  - 저장 제외: `index.tsx:3359-3360`
    ```ts
    jayerRows: isMapOnlyScope ? [] : (isDraft ? jayerRows : jayerRows.filter(r => !r.disabled))...
    ```
  - `disabled` 산출: `helpers.ts:31` `calcDisabled = row.manuallyDisabled || filterSets.some(...)`
  - 필터 정의 저장소: **`localStorage`** — `index.tsx:836`, `:2963`, `:2971`, `:3995`, `:4015` (`jayerFilterSets`/`oayerFilterSets`)
  - 활성 필터 id 저장소: **`additional_notes`** — `index.tsx:3364-3365` (`jayerActiveFilterIds`/`oayerActiveFilterIds`)
- 내용: 표 헤더의 필터 버튼(`components/Step2.tsx:148-151`)은 행을 `disabled` 로 만든다. 상신 저장은 `disabled` 행을 제외한다.
  즉 **"보기 필터"처럼 생긴 UI 가 실제로는 문서에서 행을 영구히 빼는 조작**이다.
  더 나쁜 것은 저장 위치의 비대칭이다 — **어떤 필터가 켜져 있었는지(id)는 문서에 저장되지만, 그 필터가 무슨 조건인지(정의)는
  브라우저 `localStorage` 에만 있다.**
- 영향
  1. **같은 문서를 다른 PC/브라우저에서 열면 결과가 달라진다.** 편집 로드(`index.tsx:836-843`)가
     `localStorage` 에서 `fSets` 를 읽는데 그 브라우저엔 정의가 없으므로 `calcDisabled` 는 `manuallyDisabled` 만 반영한다
     → **필터로 빠졌던 행이 되살아난 채로** 상신된다. 반대로 원 작성자 PC 에서는 계속 빠진다.
  2. 필터를 켠 채 상신하면 **가려진 행이 문서에서 소실**되는데, 확인 모달도 경고도 없다
     (수동 비활성화 `handleJayerBulkDisable`(`:2097`)은 사용자가 명시적으로 누른 조작이라 성격이 다르다).
  3. Validation System 판정(`helpers.ts:324` `isValidationTarget`)도 `!r.disabled` 를 쓰므로,
     **`plel` 이 필터로 가려진 행에만 있으면 문서가 '해당없음'이 되고 E(MASK) 단계가 생성되지 않는다.**
     백엔드 `has_ppid_plel`(`models.py:164`)은 저장된 행만 보므로 서버도 같은 결론을 낸다 — 즉 **아무도 이상을 눈치채지 못한다.**
- 재현 절차: STEP3 J-layer 표에서 `+ 필터` 로 특정 `pp` 를 거르는 필터를 만들어 **켠 상태로** 상신 →
  상세보기 J-layer 탭에 그 행들이 **없으면** 1·2 확인. 이어서 **다른 브라우저(시크릿 창)** 로 같은 문서를 재상신하면
  그 행들이 **다시 포함**된다 → 1 확인.
- 권고: ① 상신 확인 모달에 "활성 필터로 제외되는 행 N건" 을 명시하고 동의를 받는다.
  ② 필터 정의(`FilterSet`)를 `localStorage` 가 아니라 `additional_notes`(또는 사용자 설정 API)에 저장해
  `jayerActiveFilterIds` 와 저장 위치를 맞춘다. ③ 최소한 필터 비활성화와 수동 비활성화를 **다른 필드로 분리**해,
  저장 제외는 `manuallyDisabled` 만 보게 한다.

### 🟠 B-59 필터 비활성화 경로만 `unmapJayerRows` 를 부르지 않아 **고아 bb 행이 저장**된다 **분석🔍**
- 위치
  - 해제 헬퍼: `index.tsx:1843` `unmapJayerRows` — 호출처는 **3곳뿐**
    `:1862`(`unmapIfMapped` — 셀 편집/붙여넣기), `:1880`(`handleJayerChange`), `:2102`(`handleJayerBulkDisable`)
  - **호출하지 않는 경로**: `components/Step2.tsx:148-151`(필터 토글), `index.tsx:2964`·`:2972`(필터 삭제),
    `:3996`·`:4016`(필터 저장/수정) — 전부 `calcDisabled` 로 `disabled` 만 바꾼다
  - 저장: `index.tsx:3361` `bbRows: isMapOnlyScope ? [] : bbRows` (**필터링 없이 전량 저장**)
- 내용: 매핑된 J행이 **수동으로** 비활성화되면 `unmapJayerRows` 가 해당 bb 행을 지운다(`:2102`, 주석도 그렇게 적혀 있다).
  그런데 **필터로** 비활성화되는 경로에는 그 호출이 없다. 결과적으로
  **J행은 저장에서 빠지고(B-58) bb 행만 남는다.**
- 영향
  1. `additional_notes.bbRows` 에 **존재하지 않는 `sourceJayerRowId` 를 가리키는 행**이 남는다.
  2. 백엔드 검증은 통과한다 — `_validate_bb_mapping`(`views.py:254-281`)은 "저장된 jayerRows 중 미매핑이 있는가"만 보고
     **반대 방향(원본 없는 bb 행)은 보지 않는다.**
  3. 그 문서를 다시 편집하면 `mappedJayerRowIds` 가 bb 행 기준으로 복원되므로(`index.tsx:872-876`)
     **고아 매핑이 계속 따라다닌다.**
  4. 상세보기 BB 탭에 원본을 특정할 수 없는 행이 표시된다.
- 재현 절차: J-layer 행 몇 개에 bb 매핑을 건 뒤, **그 행들을 거르는 필터를 켜고** 상신 →
  상세보기 **BB 탭의 행 수 > J-layer 탭에서 매핑된 행 수** 면 버그.
- 권고: `calcDisabled` 로 `disabled` 가 새로 `true` 가 되는 모든 지점에서 `unmapIfMapped` 를 함께 호출한다.
  더 안전한 쪽은 **저장 시점 정리** — `buildEnrichedForm` 에서 `bbRows` 를 저장 대상 `jayerRows` 의 id 로 필터링한다
  (`handleMergeReselectConfirm`(`:2356`)이 이미 그 방식을 쓴다).

### 🟡 B-60 'Only MAP' 전환이 **ADI CD 표와 `map_type` 을 지우지 않아 유령값이 저장**된다 **분석🔍**
- 위치: `index.tsx:1403-1430` `applyOnlyMap` ↔ 대조 `index.tsx:2586-2596` `exitAdiCd`
- 내용: 기타 목적 'ADI CD 변경' 을 선택하면 `handleSelectAdiCdPurpose`(`:2569`)가
  `map_type='ADI'` 고정 + `adi_cd_before/after` 템플릿을 깐다.
  이 목적을 **재클릭으로 해제**하면 `exitAdiCd` 가 `adi_cd_before: []`, `adi_cd_after: []`,
  `adi_cd_delete_all: false`, `map_type` 원복까지 전부 정리한다.
  그런데 **요청 목적을 'Only MAP' 으로 바꾸는 경로**(`applyOnlyMap`)는 `other_purpose: []` 로 비우기만 하고
  `adi_cd_*` 와 `map_type` 을 **건드리지 않는다.**
- 영향: 목적에 'ADI CD 변경' 이 없는데 `detail.adi_cd_before/after` 에 입력값이 남아 저장된다.
  `map_type` 이 `'ADI'` 로 남으면 자동 생성 제목(`index.tsx:3303`)까지 `..._MAP(ADI)_...` 로 오염된다.
  Merge 관련 키(`merge_ref_doc_id`·`merge_pairs` 등)는 `other_purpose` 감시 effect(`index.tsx:588-598`)가
  `clearMergeComparison()` 을 태워 정리되므로 **ADI CD 만 빠져 있는 비대칭**이다.
- 재현 절차: STEP1 → 기타 목적 **'ADI CD 변경'** 체크 → 변경전/후 표에 값 입력 →
  요청 목적을 **'Only MAP'** 으로 변경(확인 모달 승인) → 임시저장 →
  상세보기(또는 `additional_notes`)에 `adi_cd_before` 값이 남아 있고 제목이 `MAP(ADI)` 면 버그.
- 권고: `applyOnlyMap` 에 `exitAdiCd` 와 같은 초기화를 추가하거나, `other_purpose` 감시 effect 를 하나 더 두어
  'ADI CD 변경' 이 빠지면 `adi_cd_*`·`map_type` 을 정리한다(Merge 와 동일한 패턴).

### 🟡 B-61 `validation_system_submitted`(상신 시점 판단)가 **PL 수정후상신·재개 저장에 덮어써진다** **분석🔍**
- 위치: `index.tsx:3356`
  ```ts
  ...(isDraft ? {} : { validation_system_submitted: detail.validation_system }),
  ```
- 내용: 이 키의 정의는 "**상신·재상신 시점의 상신자 판단**을 고정 기록"(같은 파일 주석, `views.py:1405` 주석도 동일)이다.
  서버의 `_set_validation_system`(`views.py:1400-1422`)은 이 키를 **일부러 건드리지 않는다.**
  그런데 저장 조건이 `isDraft` 하나뿐이라, **상신자가 아닌 주체의 저장에도 값이 갱신**된다.
  - **PL '수정 후 상신'** (`index.tsx:3608`, `buildEnrichedForm(submitNote, true)` → `isDraft=false`)
  - **PAUSE 재개** (`index.tsx:3623`, 동일)
- 영향: 상신자가 상신 시 'YES' 로 판단 → 이후 `update_validation_system` 으로 'NO' 로 변경
  (`validation_system` 만 바뀌고 `submitted` 는 'YES' 유지) → 그 뒤 PL 이 '수정 후 상신' 하면
  `submitted` 가 **'NO' 로 덮인다.** 상세보기가 이 값을 '상신 시점 판단'으로 표시하므로
  (`PagedDetailView.tsx:734` `vsSubmitted`), **MASK(E) 가 검증해야 할 "원래 판단"의 근거가 소실**된다.
  변경 추적용 `validation_system_changed_by/at`(`views.py:1416-1418`)은 blob 에 그대로 실려 살아남기 때문에,
  "바꾼 사람 기록은 있는데 바꾸기 전 값은 없는" 어긋난 상태가 된다.
- 재현 절차: 상신자가 VS='YES' 로 상신 → 결재현황 상세에서 VS 를 'NO' 로 변경 →
  지정 PL 로 로그인해 '수정 후 상신' → 상세보기의 **'상신 시 판단' 이 'NO' 로 바뀌어 있으면 버그**(원래 'YES' 여야 한다).
- 권고: 저장 조건을 `isDraft` 가 아니라 **"신규 상신 또는 재상신일 때만"** 으로 좁힌다
  (`!isDraft && !isPeerReviewMode && !isResumeMode`). 근본적으로는 이 값을 클라이언트가 아니라
  `submit`/`resubmit` 액션에서 **서버가 기록**해야 한다.

### 🟡 B-62 작성 화면 저장이 `additional_notes` **blob 전체를 덮어써** 서버측 부분 수정을 되돌린다 **분석🔍**
- 위치: `client.ts:176-178`(`patch` 로 `additional_notes` 통째 전송) ↔
  서버 부분 수정 2곳 — `views.py:1400`(`_set_validation_system`) / `:1457`(`_sync_post_approvers_detail`)
- 내용: 작성 화면은 문서를 열 때 `additional_notes` 를 파싱해 state 로 펼치고(`index.tsx:766-880`),
  저장할 때 그 state 로 **JSON 전체를 다시 만들어 보낸다**(`:3347`). 즉 **로드 시점 스냅샷 기준의 통째 덮어쓰기**다.
  `RequestDocumentSerializer.update`(`serializers.py:167-173`)는 `requester_*` 만 막고 `additional_notes` 는 그대로 받는다.
  `perform_update`(`views.py:1642`)도 제목만 손댄다. **버전·`updated_at` 비교가 어디에도 없다.**
- 영향
  1. 화면을 연 뒤 서버에서 바뀐 `validation_system`·`post_approvers` 가 저장 한 번에 **되돌아간다**(B-57·B-61 의 상위 원인).
  2. `can_edit` 대상이 **의뢰자·지정PL·의뢰자 그룹멤버**로 넓어(R-05) 두 사람이 동시에 열면
     먼저 저장한 쪽 작업이 **흔적 없이** 사라진다. 20분 자동저장(`index.tsx:3395` `handleIdleAutoSave`)이
     사용자가 인지하지 못한 채 이 덮어쓰기를 일으킬 수 있다.
- 재현 절차: 작성자가 반려 문서를 `/request` 로 연 채 **닫지 말고**, 다른 탭(또는 다른 사람)이
  결재현황에서 후결자를 추가하거나 VS 를 변경 → 원래 탭에서 '임시저장' →
  방금 서버에서 바뀐 값이 **원래대로 돌아가 있으면** 재현.
- 권고: ① `PATCH` 에 `updated_at`(또는 버전) 을 함께 보내 불일치 시 **409** 로 거부하고 사용자에게 재로드를 안내한다.
  ② 서버가 소유하는 키(`validation_system*`, `post_approvers`, `history`)는
  **클라이언트 blob 에서 제외하고 serializer 가 기존 값을 보존**하도록 병합 저장으로 바꾼다.
  ②만으로도 B-57·B-61 이 함께 닫힌다.

### 🟡 B-64 **C가문으로 전환할 때만** 반대편 지도편차 값이 정리되지 않는다 **분석🔍**
- 위치
  - (a) `index.tsx:1667` `handleOnlyProdcChange` — **`No` 분기(`:1676-1691`)는 리전 값을 전부 지우는데
    `Yes` 분기(`:1669-1675`)는 `only_prodc` 와 `mshot_change='수정'` 만 설정**하고 끝난다.
  - (b) `index.tsx:1579` `handleProdcScopeChange` — 꺼지는 리전의 `map_value_x/y_{r}`·`mshot_image_copy_{r}` 는 지우지만
    **`map_change_{r}` 은 지우지 않는다**(`:1591-1600`).
  - 렌더 분기: `components/StepMap.tsx:380` — `isProdc` 면 리전 UI 만, 아니면 일반 UI 만 그린다(둘은 배타).
- 내용
  - **(a)** 일반 모드에서 `map_change='변경 있음'` + X/Y/사유를 입력한 뒤 C가문 `Yes` 로 전환하면,
    화면에는 리전별 UI 만 뜨고 일반 필드는 **렌더 자체가 안 되는데 state 에는 그대로 남아** 저장된다.
    `validate()` 도 `if (isProdc) {...} else if (detail.map_change === '변경 있음')`(`index.tsx:3158`) 구조라
    C가문 모드에서는 일반 분기를 **아예 건너뛴다** → 검증에도 안 걸린다.
  - **(b)** `prodc_scope` 를 `only_bottom` 등으로 바꿔 북판을 끄면 `map_value_x_top/y_top` 은 비워지는데
    `map_change_top` 은 `'변경 있음'` 인 채 남는다.
- 영향
  1. **(a)** 화면 표시는 안전하다 — 상세보기도 `isProdc` 로 분기해(`PagedDetailView.tsx:1144`) 리전 값만 보여준다.
     문제는 **`additional_notes` 를 그대로 노출하는 외부 API**(`ExternalRequestDocumentSerializer`)와
     후속 공정이다. `detail.map_change`/`map_value_x` 를 읽는 소비자는 **C가문 문서에서 전혀 다른 지도편차 값**을 본다.
  2. **(b)** 이쪽은 **화면에도 보인다.** 상세보기의 `regionLine`(`PagedDetailView.tsx:1147-1154`)이
     top/bottom 두 줄을 **스코프와 무관하게 항상 출력**하므로, 쓰지 않는 리전이
     `[북판] X: - / Y: -` 로 표시된다(`map_change_top !== '변경 없음'` 이라 '변경 없음' 문구도 안 나온다).
     결재자가 존재하지 않는 리전 편차를 검토 대상으로 오인할 수 있다.
- 재현 절차
  - **(a)** STEP2 에서 C가문 `No` 상태로 지도편차 `변경 있음` + X/Y/사유 입력 → C가문을 `Yes` 로 전환 →
    임시저장 → 저장된 `detail.map_change` 가 `'변경 있음'` 이고 `map_value_x` 에 값이 남아 있으면 버그.
  - **(b)** C가문 `Yes` + 북/남 모두 `변경 있음` 입력 → `prodc_scope` 를 **'남판만'** 으로 변경(확인 모달 승인) →
    임시저장 후 상세보기 → **MAP 칩에 `[북판]` 줄이 그대로 보이면** 버그.
- 권고: `handleOnlyProdcChange` 의 `Yes` 분기에 `map_change`·`map_value_x`·`map_value_y` 초기화를 추가하고
  (`No` 분기와 대칭), `handleProdcScopeChange` 의 `clearRegions` 루프에 `map_change_{r}` 을 포함시킨다.
  더 나은 방향은 **저장 직전에 "현재 모드에서 쓰이지 않는 키" 를 일괄 제거**하는 정규화 단계를
  `buildEnrichedForm` 에 두는 것이다 — B-60 과 같은 유형이 반복되고 있어 개별 핸들러 패치는 또 새는다.

### ⚪ B-63 `additional_notes` 최상위가 dict 가 아니면 **파싱은 성공하고 500 이 난다** **재현✅**(2026-08-04)
- 위치: `models.py:132-137`(`get_detail`), `views.py:254`(`_validate_bb_mapping`),
  `views.py:1391`(`_get_validation_system`), `:1400`(`_set_validation_system`), `:1457`(`_sync_post_approvers_detail`),
  `serializers.py:156-166`(`get_notifier_mails`)
- 내용: 이 지점들은 모두 `json.loads(...)` 후 곧바로 `.get(...)` 을 호출하고, 예외는
  **`(json.JSONDecodeError, TypeError)` 만** 잡는다. `additional_notes` 가 `'[]'`·`'"x"'`·`'null'` 처럼
  **유효한 JSON 이지만 dict 가 아니면** `json.loads` 는 성공하고 `.get` 에서 **`AttributeError`** 가 난다 → **500**.
  B-03(깨진 JSON → 조용히 통과)과는 **정반대 방향의 같은 뿌리**다: 하나는 너무 관대하고 하나는 잡지 못한다.
  `serializers.get_notifier_mails` 는 `except Exception` 이라 유일하게 안전하고,
  `_sync_post_approvers_detail` 은 조용히 넘어가야 할 자리인데 `AttributeError` 를 못 잡아 500 을 낸다.
- 영향: 정상 사용에서는 나오지 않지만 **외부 API·수동 DB 편집·마이그레이션 사고로 한 문서만 이 상태가 되면**
  그 문서의 조회·상신·후결자 변경·VS 변경이 전부 500 이 된다. `TextField` 라 DB 가 막아 주지 않는다(R-01).
- **재현 결과**(2026-08-04)
  ```
  additional_notes='[]'    | get_detail() -> []    | is_only_map() -> AttributeError
  additional_notes='null'  | get_detail() -> None  | is_only_map() -> AttributeError
  additional_notes='"x"'   | get_detail() -> 'x'   | is_only_map() -> AttributeError
  ```
  즉 **`get_detail()` 자체는 예외를 던지지 않고 비-dict 를 그대로 돌려주며**, 크래시는 그 값을 쓰는
  호출부(`is_only_map`·`has_ppid_plel`·`_validate_bb_mapping` 등)에서 난다.
  → **정규화 지점은 `get_detail()` 하나**라는 권고가 그대로 유효하다.
- 브라우저/스크립트 재현 절차(격리 DB): `RequestDocument.objects.filter(pk=N).update(additional_notes='[]')` 후
  `POST /api/documents/N/submit/` → **500** 이면 재현.
- 권고: `get_detail()` 에서 **dict 가 아니면 `{}` 를 반환**하도록 한 곳에서 정규화하고, 나머지는 전부 그것을 경유한다.
  (VS-13 을 이 범위로 확장한 항목이다.) 중기적으로는 `JSONField` 전환(R-01).

---

## 6. 잠재 위험 (아직 버그로 터지지 않았지만 구조적으로 위험한 것)

### R-01 🔴 `additional_notes` 가 `TextField` — 도메인 데이터 전체가 스키마 없는 문자열
- 위치: `models.py:108` (`additional_notes = models.TextField(...)`), 파싱 진입점 `models.py:132` `get_detail()`
- J/O-layer·BB·MAP·통보처·후결자·Validation System·Merge 스냅샷·history 가 **전부 이 한 칼럼**에 들어간다.
- DB 레벨 제약이 0 → 깨진 JSON 도 저장되고 `get_detail()` 이 조용히 `{}` 반환(B-03).
  유효 JSON 이지만 dict 가 아니면 반대로 **500**(B-63).
- **저장 주체가 4곳인데 조율 장치가 없다** — 작성 화면은 blob 통째 덮어쓰기, 서버는 부분 수정.
  낙관적 잠금도 병합도 없어 나중에 저장한 쪽이 이긴다 → **B-57 / B-61 / B-62** 가 전부 여기서 나왔다.
- 쿼리·인덱싱·집계 불가. 문서 1건이 커질수록 목록 API 가 통째로 무거워짐
  (`RequestDocumentListSerializer`(`serializers.py:176-192`)가 **목록에도 `additional_notes` 를 포함**한다 →
  문서 수백 건이면 응답 수십 MB)
- 완화: ① 목록 serializer 에서 `additional_notes` 를 빼고 필요한 파생값만 내려주기
  ② **서버 소유 키를 blob 에서 분리**(B-62 권고) ③ 중기적으로 JSONField 전환 + 마이그레이션
> **3차 정독(§5-4) 7건 중 5건이 이 항목의 직접적 증상이다.** 개별 패치보다 저장 구조 정리가 근본 해법이다.

### R-02 🟠 결재 단계에 '취소/무효' 상태가 없다
`ApprovalStep.ACTION_CHOICES = pending / approved / rejected` 뿐이라, **반려로 회차가 끝나도 나머지 단계는 영원히 `pending`** 이다.
B-13(잘못된 버튼 노출)·X-4·X-5 의 공통 뿌리이며, 통계(`stats`)·메일 수신자 산출·표시 로직이 전부 이 잔여 pending 을 우회하려고
각자 `max_round` 필터를 중복 구현하고 있다(한 곳이라도 빠지면 버그 — 실제로 상세 footer 가 빠졌다).
- 권고: `cancelled` 액션 추가 + 반려 시 같은 회차 pending 일괄 전이.

### R-03 🟠 `.env` 값에 결재 경로가 직접 의존하는데 검증 시점이 없다
`POST_APPROVER_LOGINID`(B-04), `MAIL_REDIRECT_TO`(전 메일 하이재킹), `EXTERNAL_API_KEY`(비면 모든 키 거부)
모두 **잘못돼도 기동은 성공**하고 런타임에 조용히 다른 동작을 한다.
(`P_LINE_FALLBACK`은 미사용 상태로 코드에서 삭제됨 — 2026-08)
- 권고: `AppConfig.ready()` 또는 `manage.py check` 커스텀 체크로 기동 시 경고.

### R-04 🟠 P/E 검토자(PV/EV) 지정 취소·변경 API가 없다
`_create_reviewers` 로 생성만 가능하고 제거 경로가 없다. **잘못 지정하면 그 사람이 합의할 때까지 단계가 영구히 멈춘다**
(휴직·퇴사 시 MASTER 가 대신 합의하는 것 외엔 방법 없음). `APPROVAL.md §6-7` 에도 제약으로 기록돼 있다.

### R-05 🟡 문서 수정에 낙관적 잠금이 없다
`PATCH /documents/{id}/`(`views.py:1635` `update` → `:1642` `perform_update`)는 `updated_at` 비교 없이 통째로 덮어쓴다.
반려 문서는 **의뢰자·지정PL·의뢰자 그룹멤버**가 모두 편집 가능하므로(`can_edit`), 두 사람이 동시에 열어 저장하면
**먼저 저장한 쪽 작업이 흔적 없이 사라진다.** `/request` 는 20분 자동저장(`index.tsx:3395`)까지 돌아 충돌 확률이 낮지 않다.
- 사용자 간 충돌뿐 아니라 **사용자 ↔ 서버 부분수정** 충돌도 같은 뿌리다 → **B-62** 참조.

### R-06 🟡 `submitted` 는 데드 상태값
`STATUS_CHOICES` 에 있지만 어떤 코드도 이 값을 만들지 않는다. 그런데 `withdraw`·`can_edit` 는 이 값을 분기에 포함하고 있어
읽는 사람을 오도한다.

### R-07 🟡 결재 판정 규칙이 프론트·백엔드에 **이중 구현**돼 있다
`ApprovalFlow.tsx`(`canUserAssign:22` / `canUserClaim:31` / `canUserAgree:44`) ↔
`views.py`(`_can_act_on_step:160` / `_can_assign_step:178` / `_can_claim_step:195`)
가 "1:1 일치" 를 전제로 각각 손으로 유지된다. 이미 B-12(내 차례 필터)·B-13(회차 필터)에서 어긋났고,
**프론트 3종에는 `document.status` 검사 자체가 없어** pause 문서에서도 결재 버튼이 노출된다(B-06 부가, T-M3).
- 권고: 서버가 step 별 `can_agree`/`can_claim`/`can_assign` 플래그를 내려주고 프론트는 그걸 렌더만 하기
  (이미 `can_edit`/`can_withdraw` 는 그 방식이라 선례가 있다).

### R-08 🟡 마스터 데이터 조회 API 9종이 전부 미인증
`/api/form-options/*` 는 `@require_GET` 순수 뷰라 인증이 없다. 라인·조합법·제품·process_id·layer·바코드·MAP 이름이
**로그인 없이 전량 열람 가능**하다(사내망 전제라 하더라도 최소 인증은 필요).

### R-09 🟡 SSE 스트림에 인증·정리 로직이 없다
`user_events` 는 `@csrf_exempt` 만 붙은 무한 제너레이터다. 인증 검사가 없고 구독자 수 제한도 없어
연결이 쌓이면 워커(gunicorn 동기 워커)를 점유한다. `X-Accel-Buffering: no` 는 있으나 nginx `proxy_read_timeout` 설정도 함께 확인 필요.

### R-10 ⚪ 목록 재조회가 필터 탭 변경마다 서버를 다시 친다
`ApprovalPage.fetchDocs` 의 `useCallback` 의존성에 `filter` 가 들어 있는데, 정작 필터링은 **클라이언트에서** 한다.
탭만 눌러도 전체 목록 API 를 다시 호출한다(불필요한 왕복 + `additional_notes` 포함 대용량 응답 → R-01 과 결합해 체감 지연).

### R-12 🔴 XSS 방어가 **한 겹도** 없다 (2차 추가)
저장 시 sanitize 없음(B-26) → 렌더 시 `dangerouslySetInnerHTML` 5곳 → 응답 헤더에 CSP 없음(B-42) →
같은 오리진 `/media/`가 임의 확장자를 실행 가능하게 서빙(B-34) → 미인증 업로드(B-02).
**다섯 겹이 전부 뚫려 있어 어느 한 곳만 고쳐도 나머지 경로가 남는다.** 보안 항목 중 유일하게
"개별 수정"이 아니라 **정책 수립**이 필요한 영역이다.

### R-13 🟠 인증 계층이 표준 OIDC 검증을 대부분 생략하고 자체 구현으로 대체돼 있다 (2차 추가)
`mozilla-django-oidc`가 `INSTALLED_APPS`에 들어 있지만 **실제 로그인 흐름은 `auth_views.py`의 수작업 구현**이다.
그 과정에서 만료(B-27)·audience(B-27)·nonce(B-28)·state(B-28)·code 교환(B-43) 검증이 모두 빠졌다.
라이브러리를 쓰지 않기로 했다면 최소한 **검증 항목 체크리스트**를 문서화하고 테스트로 고정해야 한다
(현재 `tests.py`에 **인증 관련 테스트가 0건**이다).

### R-14 🟠 사용자 삭제가 도메인 상태를 고려하지 않는다 (2차 추가)
`UserViewSet.destroy`는 "같은 역할끼리 삭제 가능"만 검사하고, 그 사용자가 **진행 중 결재의 담당자인지,
그룹 생성자인지** 전혀 보지 않는다. 결과가 B-30(결재 교착)·B-31(그룹 소실)이다.
FK 정책도 일관되지 않다 — `ApprovalStep.assignee`/`RequestDocument.requester`는 `SET_NULL`인데
`UserGroup.creator`/`AddressBook.owner`는 `CASCADE`다. **삭제 전 영향도 점검(pre-check)** 이 필요하다.

### R-15 🟡 결재 알림이 "발송 실패해도 아무도 모르는" 구조다 (2차 추가)
`_enqueue`는 수신자가 0명이면 `logger.info`만 남기고 조용히 건너뛴다(`None` 반환).
발송은 5회 실패 후 `failed`로 굳고 재처리 경로가 없다(B-39). 두 경우 모두 **화면·관리자에게 신호가 가지 않는다.**
결재 도착 알림은 이 시스템의 핵심 촉진 수단인데 **유실이 무음**이라는 점이 구조적 위험이다.

### R-16 🟡 `PagedDetailView` 1,757줄에 `as any` 40건이 몰려 있다 (2차 추가)
전체 `any` 사용 **83건 중 40건(48%)** 이 이 파일이다(다음이 `approvalTable.ts`·`VOCPage`·`RichTextEditor` 각 9건).
`detail`이 스키마 없는 JSON(R-01)이라 타입이 서지 않아 `as any`로 우회한 결과다.
규칙 I(“`any` 절대 금지”) 위반이면서, **저장 구조 문제(R-01)의 증상**이기도 하다 — 타입만 손보는 것으로는 해결되지 않는다.

### R-17 ⚪ 인증 흐름에 테스트가 전무하다 (2차 추가)
`tests.py` 75건은 **메일(mailer) 중심**이고 결재 로직 일부를 덮는다. OIDC 콜백·refresh·권한 클래스·업로드·
XSS 저장 경로에는 테스트가 **하나도 없다**. 이번에 발견된 치명 7건 중 6건이 이 사각지대에서 나왔다.

### R-11 ⚪ 이름(`requester_name`) 기반 본인 판정이 남아 있다
`ApprovalPage.tsx:1120` `isOriginalPL = isPL && selected?.requester_name === currentUser.name` —
**동명이인이면 남의 문서에 '지정자 변경' 버튼이 뜬다.** 바로 아래 `isPauseRequester`(`:1125-1129`)는
`requester_loginid` 를 우선 쓰므로 같은 파일 안에서도 규칙이 다르다.
`applyClientFilter` 의 PL 판정(`:137`)과 `getTabCount`(`:174`)도 동일 문제.
serializer 가 `requester_loginid` 를 이미 내려주므로 전부 그것으로 통일하면 된다.

---

## 7. 회귀 체크리스트 (릴리스 전 최소 통과 세트)

핵심 흐름 1회 완주 — **한 문서로 아래를 순서대로**:

- [ ] T-B1~B4 STEP1 필수/화이트리스트 검증
- [ ] T-C1~C4 MAP 필수 + 조건부 초기화 (**저장 JSON 에 유령값 없음까지 확인**)
- [ ] T-D1~D3 J↔O 동기화 / 차용 필수 / loaded 잠금
- [ ] T-E1, E4, E5 자동채움 append / 매핑 해제 / 매핑 필수
- [ ] T-F1, F3 임시저장 왕복 + 그룹 가시성
- [ ] T-G1, G2, G3 상신(단일·다중 PL·통보처)
- [ ] T-H1, H2 PL 합의/반려/수정후상신 + 의뢰자 고정
- [ ] T-I1, I3, I5 R 지정(+검토자) → 병렬 전환 → 후결자
- [ ] T-J1, J3, J5 claim → 검토자 동시지정 → 최종 승인
- [ ] T-K1, K2 반려 → 재상신 → 변경이력 4종
- [ ] T-M1~M4 중단요청 → 전원확인 → 동결 → 재개+기한연장
- [ ] T-N1, N2, N4 승인 → 이력 이관 → 상세 6탭
- [ ] X-9 동시성 4종
- [ ] X-10 메일 전 구간 (`api_mailnotification` 쿼리로 확인)

2차 추가 CASE:
- [ ] T-Q1~Q7 인증·SSO·세션 (특히 **Q2 재사용 / Q3 nonce 생략 / Q6 dev 모드 오배포**)
- [ ] T-R1~R5 업로드·미디어·보안헤더
- [ ] T-S1~S5 XSS·제출자 위조·사용자 삭제 파급
- [ ] X-11 XSS→권한상승 체인 (**격리 DB에서만**)
- [ ] X-12 담당자 삭제 후 결재 교착
- [ ] X-13 PL 단계 중단요청 고착

버그 수정 후 재확인:

*보안 (한 묶음으로)*
- [ ] B-26 `NONE` 사용자가 VOC에 `<img onerror>` 저장 → 렌더 시 **실행되지 않음**(sanitize) + 기존 저장분도 정화됨
- [ ] B-42 `curl -sI` 로 **CSP / X-Frame-Options(SAMEORIGIN) / nosniff / Referrer-Policy** 4종 확인
- [ ] B-27 만료된 `id_token` 재전송 → **401**
- [ ] B-28 `nonce_jwt` 없이 콜백 → **400** / `state` 불일치 → **400**
- [ ] B-29 `AUTH_MODE` 값 확인 + dev 모드에서도 쓰기·삭제는 **인증 요구**
- [x] B-01 무관한 사용자로 `DELETE /api/documents/{id}/` → **405** / `POST delete/` → **403** ✅ 수정완료
- [ ] B-02 비로그인 `POST /api/upload-image/` → **401/403**, `.svg` 업로드 → **400**
- [ ] B-34 업로드 파일 URL 직접 접근 시 스크립트 **미실행**
- [ ] B-35 `docker logs | grep '\[OIDC\]'` → 개인정보 **미출력**
- [ ] B-41 `DJANGO_SECRET_KEY` 미설정 시 **기동 실패**

*결재 정합성*
- [ ] B-06 pause 문서에서 `peer-approve/` / `peer-reject/` / `peer-submit/` / `change-designee/` → **전부 400**
- [ ] B-06(프론트) pause 문서 상세에서 '합의/반려/검토중/담당자 지정' 버튼이 **보이지 않음**
- [ ] B-32 PL 합의 후 중단요청 state → **cancelled**
- [ ] B-30 후결자 계정 삭제 후에도 최종 승인 **도달 가능**
- [ ] B-31 그룹 생성자 삭제 후 그룹 **잔존**
- [ ] B-04 `POST_APPROVER_LOGINID` 미설정 + Only MAP → R 합의로 approved 되지 **않음**
- [ ] B-07 R 담당자로 TE_R 아닌 사용자 지정 → **400**

*화면/UX*
- [ ] B-11 재상신 상신 모달에 이전 검토자 **프리필됨**
- [ ] B-12 TE_O 로 '내 차례' → 미선점 O 단계 문서 **보임**
- [ ] B-13 재상신 문서 상세에 이전 회차 '검토중' 버튼 **없음**
- [ ] B-14/B-15 J/O-layer 표 헤더 버튼에 한글 라벨 표시 + 영어 전환 시 VOC 유형 정상
- [ ] B-36 access 만료 상태에서 '세션 연장' → **재로그인 없이** 이어짐
- [ ] B-40 변경 없는 재상신에서 `bb_entries` 가 **강조되지 않음**

*`additional_notes` 저장 정합성 (3차 · §5-4)*

전부 **브라우저에서 상신·재상신까지 완주한 뒤 상세보기(또는 저장된 `additional_notes`)로** 확인한다.
자동 테스트가 없는 영역이므로 이 수동 시나리오가 검증의 핵심이다.

- [ ] **B-57** 일반 의뢰서(only_prodc=No) 상신 → R 합의 → 결재현황 상세에서 '+ 후결자 추가' 1명 →
      반려 → 작성자가 '수정 후 재상신' → **결재 경로 탭에 그 후결자의 RA 단계가 남아 있음**
      (실패 신호: RA 가 고정 후결자 1명뿐)
- [ ] **B-58a** J-layer 필터를 켠 채 상신 → 상세보기 J-layer 탭에 **가려졌던 행이 그대로 있음**
      (또는 상신 확인 모달이 "제외되는 행 N건" 을 명시)
- [ ] **B-58b** 같은 문서를 **시크릿 창(다른 localStorage)** 에서 열어 재상신 → 저장되는 J/O 행 집합이 **원래와 동일**
- [ ] **B-58c** `plel` 이 필터로 가려진 행에만 있는 문서 → 상신 후 결재 경로에 **E(MASK) 단계가 정상 생성**
- [ ] **B-59** bb 매핑을 건 J행을 필터로 가린 뒤 상신 → 상세보기 **BB 탭 행 수 = 매핑된 J행 수**
      (실패 신호: 원본을 특정할 수 없는 bb 행이 더 있음)
- [ ] **B-60** 기타목적 'ADI CD 변경' 입력 → 요청목적을 'Only MAP' 으로 전환 → 임시저장 →
      `detail.adi_cd_before/after` 가 **비어 있고** 제목에 `MAP(ADI)` 가 **없음**
- [ ] **B-61** 상신자가 VS='YES' 상신 → VS 를 'NO' 로 변경 → 지정 PL 이 '수정 후 상신' →
      상세보기 **'상신 시 판단' 이 여전히 'YES'**
- [ ] **B-62** 작성 화면을 연 채 다른 탭에서 후결자 추가/VS 변경 → 원래 탭에서 '임시저장' →
      **409 등으로 거부되거나 서버 변경분이 보존됨**(실패 신호: 조용히 원복)
- [ ] **B-63** (격리 DB) `additional_notes='[]'` 인 문서 조회·상신 → **500 이 아님**
- [ ] **B-64a** 일반 모드에서 지도편차 '변경 있음' + X/Y 입력 → C가문 `Yes` 로 전환 → 임시저장 →
      저장 JSON 의 `map_change`/`map_value_x/y` 가 **비어 있음**
- [ ] **B-64b** C가문 북·남 모두 '변경 있음' → `prodc_scope` 를 '남판만' 으로 변경 → 임시저장 → 상세보기 →
      MAP 칩에 **`[북판]` 줄이 보이지 않음**

*테스트*
- [ ] `manage.py test api` → **OK (0 failures)** — 현재 167건 중 **3건 red**(B-19·B-22·B-23), §1.4.1 레시피로 재현 가능
- [ ] `npx tsc --noEmit` → **0건** (현재 24건, 그중 16건이 B-14) — **CI 게이트로 걸 것**
- [ ] 인증(OIDC 콜백·refresh)·업로드·XSS 저장 경로 **테스트 신규 추가**(현재 0건 — R-17)
- [ ] **`additional_notes` 저장 회귀 테스트 신규 추가** — 위 B-57~B-63 은 전부 서버 단위 테스트로 고정 가능하다
      (`buildEnrichedForm` 상당의 payload 를 만들어 PATCH → `get_detail()` 결과 단언)

---

## 8. 실제로 수행한 검증 (근거)

### 8.1 1차 정독에서 수행한 검증 (2026-07-28)

| 항목 | 방법 | 결과 |
|---|---|---|
| 백엔드 기존 테스트 | sqlite 임시설정으로 `manage.py test api` 실행 | 75건 중 **2 failures / 1 error** (B-19·B-22·B-23) |
| B-01 삭제 인가 | `APIClient` 로 role=NONE 이 승인문서 DELETE / 검토중문서 delete 액션 | **204 / 200, 문서 삭제됨** |
| B-02 업로드 인가 | 비인증 `POST /api/upload-image/` 에 script 포함 svg | **200, 저장 성공** |
| B-03 JSON 파손 우회 | 깨진 `additional_notes` 로 `_validate_bb_mapping` 직접 호출 | **None(통과)** |
| B-04 Only MAP 후결 생략 | `POST_APPROVER_LOGINID=''` + Only MAP → R 합의 | **status=approved** |
| B-06 PAUSE 우회 | pause 문서에 `peer-approve/`·`peer-reject/` | **200 / under_review, R 생성 / rejected** |
| B-07 담당자 역할 검증 | R 담당자에 role=NONE + 위장 이름 지정 | **200, 그대로 저장** |
| B-08 레거시 작성자 | FK=None 문서에서 작성자가 `change-designee/` | **403** (withdraw 는 200) |
| B-09 이력 삭제 | 2회차 4단계 문서 철회 | **4건 → 0건** |
| X-4 잔여 pending | 다중 PL 1명 반려 후 재상신 | **1회차 PL step 이 pending 잔존, 회차 [1,2] 공존** |
| PAUSE 정상 동작 | 동결(400) + 재개 기한 연장 | **정상** (5일 중단 → due +5일) |
| i18n 정합성 | `ko.json`/`en.json` 평탄화 비교 + 전 `.ts(x)` 62개 `t()` 정적 추출 | **ko 854 / en 853, 미정의 키 9개 확인** |

### 8.2 2차 정독에서 추가 수행한 검증

| 항목 | 방법 | 결과 |
|---|---|---|
| B-26 저장형 XSS | role=`NONE` 으로 `POST /api/voc/` 에 `<img onerror>` payload | **201, content 원문 그대로 저장** |
| B-26 권한상승 체인 | MASTER 세션으로 `POST /api/users/{id}/assign-role/ {role:'MASTER'}` | **200, role=MASTER 승격 성공** |
| B-26 가이드 경로 | TE_O 로 `POST /api/guides/` 에 payload | **201, 원문 저장** (대조: PL 은 403) |
| B-33 VOC 메일 escape | `mailer._build_voc_message` 직접 호출 | **`<script>` 원문 포함 True** (대조: 결재 메일 False) |
| B-29 dev 모드 개방 | `AUTH_MODE=dev` + 비인증 요청 | **GET 200 / DELETE 승인문서 204** |
| B-30 담당자 삭제 | RA 담당자 계정 삭제 후 처리 시도 | **claim 400 / 합의 400 / 고아 pending 1건 잔존** |
| B-30 대조(J/O/E/P) | O 선점자 삭제 후 다른 TE_O 재선점 | **200 (자가 회복)** |
| B-30 삭제 주체 | TE_O 가 동료 TE_O 삭제 (MASTER 아님) | **204 (허용됨)** |
| B-31 그룹 CASCADE | 그룹 생성자 계정 삭제 | **그룹·주소록 모두 삭제됨** |
| B-32 중단요청 고착 | PL 합의 후 PauseRequest 상태 확인 | **requested 잔존** (대조: R 합의는 cancelled) |
| B-32 후속 영향 | 재-중단요청 / 중단확인 시도 | **403 / 403** |
| B-38 통계 노출 | 외부인이 `/documents/` 와 `/documents/stats/` 비교 | **목록 0건 vs stats draft 2건** |
| 대조 D-03 draft 인가 | 외부인의 남의 draft GET/PATCH/submit/DELETE | **전부 404 (정상)** |
| 대조 D-04 수정 인가 | 무관한 PL 이 under_review/approved/rejected PATCH | **전부 403 (정상)** |
| B-46 제목 중복 | 동일 제목 3회 생성 + 필드 메타 확인 | **`_2`/`_3` 정상, `unique=False`** |
| B-47 추적 파일 | `git ls-files nginx/ backend/api/certs/` | **ignore 규칙과 무관하게 추적 중** |
| i18n `any` 집계 | 전 `.ts(x)` 정적 집계 | **`any` 83건 / PagedDetailView 40건** |
| sanitizer 의존성 | `frontend/package.json` 검색 | **DOMPurify·sanitize-html 없음** |
| 보안 헤더 | `nginx/nginx.conf` 전수 확인 | **CSP/XFO/nosniff/Referrer-Policy 전무** |

> 검증에 사용한 임시 테스트 파일은 scratchpad 에서 실행 후 **프로젝트에서 제거**했다(코드 변경 0건).
> 프론트엔드는 그 세션에 `node_modules` 가 없어 `tsc`/`react-scripts test` 를 돌리지 못했다 →
> 1·2차의 프론트 항목은 **코드 정독 + 정적 분석** 근거다.
> (3차에서는 `npm ci` 로 프론트 테스트·타입체크까지 실행했다 — §1.5 참조.)

### 8.3 3차 정독에서 수행한 검증 (2026-08-04)

| 항목 | 방법 | 결과 |
|---|---|---|
| 전 버그 항목의 코드 위치 | 심볼(함수·상수·문자열) grep 으로 현재 라인 대조 | **약 90건 중 60건 이상 정정** — 아래 "위치 변경 요약" |
| B-06 경로 성립 여부 | `submit`→`can_request_pause`→`_can_confirm_pause`→`_advance_after_pl` 코드 추적 | **PL 단계 pause 확정 → peer_approve 부활 경로 성립 확인**(가드 4개 부재) |
| pause 프론트 가드 | `ApprovalFlow.tsx` 판정 3종에 `status` 참조 여부 grep | **0건 — 상태 검사 없음** |
| `additional_notes` 저장 경로 전수 | 쓰기 지점 4곳(①~④) + 읽기 소비처 추적 | **B-57 ~ B-63 도출** |
| 조건부 필드 초기화 전수(2차 확인) | `map_change`·리전·`ea_change`·`mshot_change`·`inter`·`rev_yn`·`only_prodc`·`prodc_scope` 핸들러 대조 | **6종 정상 / `only_prodc` Yes 방향·`prodc_scope` off 리전 2곳 누락 → B-64** |
| §3·§4 시나리오 본문 재확인 | T-C4·T-E4·T-G6·T-I5·T-L2·X-8 을 코드와 대조 | **X-8 이 수정 완료된 B-01 을 현재형으로 서술 → 정정**, `title max_length=600`·`DraftVisibilityTest` 등은 정확 |
| `post_approvers` 소실 체인 | `index.tsx:3351` → `mailer.py:230` → `views.py:1221` 연결 확인 | **RA 단계 미생성까지 이어짐 확인**(B-57) |
| 필터 ↔ 저장 상호작용 | `calcDisabled` 호출 5경로 vs `unmapJayerRows` 호출 3경로 대조 | **필터 경로에만 unmap 누락**(B-59) |
| 필터 정의 저장소 | `jayerFilterSets`(localStorage) vs `jayerActiveFilterIds`(additional_notes) | **저장 위치 비대칭 확인**(B-58) |
| Merge 유령값 반증 | `other_purpose` 감시 effect(`index.tsx:588-598`) 확인 | **Merge 키는 정상 정리됨 — ADI CD 만 누락**(B-60) |
| i18n 정합성 | `ko.json`/`en.json` 평탄화 비교 + 미정의 키 조회 | **ko 1003 / en 1002**, B-14·B-15 유효 |
| **백엔드 자동 테스트** | §1.4.1 레시피(venv + sqlite + `datacenterquery` 스텁) | **167건 실행, 2 failures / 1 error — B-19·B-22·B-23 이 1차 이후 그대로 red** |
| **프론트 자동 테스트** | `npm ci` → `react-scripts test` | **67건 전부 통과**(1차 문서의 "테스트 파일 없음" 서술은 낡음) |
| **타입 체크** | `npx tsc --noEmit` | **24건** — 그중 **16건이 B-14(미정의 i18n 키)** |
| **B-06 / B-32 재현** | 임시 테스트를 프로젝트 밖(`$SP/stubs/verify_rest.py`)에 두고 실행 | **pause 확정 후 peer-approve 200 + R 생성 / PauseRequest confirmed 잔존 / 재-중단요청 403** — 전부 재현 |
| **B-06 대조군** | 같은 pause 문서에 `approve-step`·`claim-step` | **둘 다 400** — 일반 단계는 정상 차단 |
| **B-57 재현** | 상신→PL합의→R합의→후결자추가→반려→PATCH→재상신 전 구간 완주 | **재상신 후 RA = 고정 1명뿐, 추가 후결자 단계 미생성** |
| **B-63 재현** | `additional_notes` 를 `'[]'`/`'null'`/`'"x"'` 로 바꿔 `get_detail()`·`is_only_map()` 호출 | **get_detail() 은 비-dict 를 그대로 반환, 호출부에서 `AttributeError`** |

**위치 변경 요약** (자주 참조되는 것만; 그 외는 각 항목에 반영)

| 심볼 | 문서(구) | 현재 |
|---|---|---|
| `peer_approve` / `peer_reject` / `peer_submit` / `change_designee` | `views.py:1092-1142` | **`:1291` / `:1305` / `:1326` / `:1341`** |
| `_advance_to_parallel` | `:990-1031` | **`:1185`** |
| `_validate_bb_mapping` | `:244-271` | **`:254`** |
| `withdraw` 의 step 전량 삭제 | `:393` | **`:403`** |
| `assign_step` 담당자 조회·이름 | `:637-645` | **`:767-775`** |
| `upload_image` / `upload_video` | `:1718` / `:1765` | **`:2073` / `:2120`** |
| `VOCViewSet.perform_create` / `update_status` | `:1474` / `:1478` | **`:1827` / `:1832`** |
| `stats` | `:1374` | **`:1647`** |
| `_cancel_active_pause_requests` 호출 | `:484` · `:593` | **`:521` · `:723`** |
| `ApprovalPage` `pendingSteps` | `:1046-1053` | **`:1081-1088`** |
| `ApprovalPage` 내 차례 필터 | `:147-151` | **`:146-151`** |
| `RequestPage` `setDesignees([])` | `:3083` | **`:3576`** |
| `mailer._build_voc_message` | `:658-679` | **`:855`** |
| `PagedDetailView` diff | `:412-418` | **`:513-518`** |
| Merge 로직 | `index.tsx:2098-2151` | **`helpers.ts` `computeLayerMerge`** (함수로 이동) |

### 8.4 이번 검토에서 다루지 않은 범위 (남은 사각지대)

정직하게 남겨둔다 — 아래는 **읽었지만 깊게 파지 않았거나, 실행 검증을 못 한** 영역이다.
- `scheduler.py`(504줄) — 외부 DCQ/RTDB 연동 동기화 잡. 사내 전용 모듈(`datacenterquery`)이 없어
  **로직 정독만 했고 실행 검증 불가**. 동기화 실패 시 폼 옵션이 비는 경로(`form_options_*` → 빈 목록)는
  화면상 "선택지가 안 뜸"으로 나타나며, 사용자에게 원인이 보이지 않는다.
- `utils.py`의 DCQ 로그인 — 전역 `sys.stdin` 을 교체하는 방식이라 락으로 직렬화하고 있으나,
  gunicorn 멀티워커에서는 **프로세스별로 락이 따로 걸린다**(프로세스 간 보호 없음). 실사용 영향 확인 필요.
- `RichTextEditor.tsx`(574줄)·`GuideTourModal`·`guideDemos/*` — 투어·에디터 UI. `any` 9건 외 기능 검증 미실시.
- `PagedDetailView.tsx`(1,757줄) — diff 로직(B-40)과 `any` 집계만 확인. 6개 탭의 렌더 정확성은 브라우저 확인 필요.
- ~~마이그레이션 일치 여부~~ → 1·3차 모두 **실행 완료**. 3차 결과는 **`No changes detected`(exit 0)** →
  B-48 은 **해소됨**(§5-2 참조).
- 성능·부하 — `additional_notes` 포함 목록 응답 크기(R-01), 문서 수백~수천 건 시 응답 시간 미측정.
- **3차 추가분(2026-08-04)**
  - ~~조건부 토글의 유령값 여부 미확인~~ → **재확인 완료**. `map_change`·리전 지도편차·`ea_change`·
    `mshot_change`·`inter`·`rev_yn` 6종은 모두 하위값을 정상 초기화한다(T-C4 표).
    누락은 `only_prodc` 의 **Yes 방향**과 `prodc_scope` 의 **off 리전 `map_change_{r}`** 2곳이었다 → **B-64**.
    다만 `detail` 필드 수가 많아 **전수는 아니다** — 저장 직전 정규화(B-64 권고)가 없는 한 같은 유형이 또 나올 수 있다.
  - `design_rule_stats.py`(`:120` `_parse_detail`)의 `additional_notes` 소비 경로 — 통계 집계라 결재에 영향은 없으나 미검증.
  - 프론트 자동 테스트 — `helpers.ts` 에는 `computeLayerMerge` 단위 테스트 12건이 있으나
    **`buildEnrichedForm` 의 저장 payload 를 검증하는 테스트는 0건**이다(§7 마지막 항목).

---

*이 문서의 CASE 나 버그 상태가 바뀌면 반드시 함께 갱신한다. 버그 수정 시 해당 항목에 `✅수정완료(커밋 해시)` 를 남긴다.*
