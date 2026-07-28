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
> ⚠️ 이 문서의 버그 항목 중 `재현✅` 표시는 **이 세션에서 Django 테스트로 실제 실행해 결과를 확인**한 것이고,
> `분석🔍` 표시는 코드 정독으로 도출했으나 런타임 실행까지는 하지 못한 것이다. 근거를 각 항목에 명시했다.

---

## 0. 요약 (먼저 읽을 것)

| 구분 | 건수 | 비고 |
|------|------|------|
| 🔴 치명 (Critical) | **4** | 인가 부재로 데이터 영구 삭제 / PAUSE 동결 우회 / 미인증 파일 업로드 |
| 🟠 높음 (High) | **6** | 결재 담당 배정 검증 부재, 내 차례 필터 누락, 재상신 검토자 프리필 무효화 등 |
| 🟡 중간 (Medium) | **8** | 이력 유실, 잔여 회차 단계 오노출, i18n 키 미정의(화면에 키 문자열 노출) 등 |
| ⚪ 낮음/위생 (Low) | **7** | 하드코딩 문자열, `any` 사용, 테스트 깨짐, 표시 부정확 |
| **합계** | **25** | |

**즉시 조치 권고 TOP 3**
1. **[B-01] 의뢰서 삭제 인가 전무** — 로그인만 하면 (역할 `NONE` 포함) **결재 완료 문서까지 삭제** 가능. 재현✅
2. **[B-06] PAUSE 동결 우회** — 중단(pause) 문서에서 PL 합의/반려가 그대로 동작해 결재가 재개돼 버림. 재현✅
3. **[B-02] 업로드 API 미인증 + 확장자 무검증** — 비로그인 상태로 `.svg`(스크립트 포함) 업로드 성공. 재현✅

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
grep -E "POST_APPROVER_LOGINID|MAIL_REDIRECT_TO|DXHUB_MAIL_URL|EXTERNAL_API_KEY|P_LINE_FALLBACK" .env
```
- `POST_APPROVER_LOGINID` : **RFG 팀(TE_R) loginid**. 비어 있으면 후결자(RA)가 아예 안 생기고,
  **Only MAP 의뢰서는 R 합의 즉시 `approved`** 로 끝나 후결 단계가 통째로 사라진다(재현✅ B-04).
- `MAIL_REDIRECT_TO` : 설정 시 **모든 결재 메일이 이 주소 하나로** 간다(검증용). 운영 반영 전 반드시 비운다.

### 1.4 자동 테스트 실행

**백엔드** (컨테이너 안)
```bash
docker exec -it <backend> python manage.py test api -v 2
```
컨테이너 없이(이번 세션처럼 MySQL 이 없을 때) sqlite 로 돌리려면 — 프로젝트 파일은 건드리지 않는다:
```bash
# 임시 설정 파일(프로젝트 밖)
cat > /tmp/test_settings.py <<'EOF'
from config.settings.base import *
DEBUG = True
DATABASES = {'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'}}
EOF
cd backend && PYTHONPATH=/tmp DJANGO_SETTINGS_MODULE=test_settings python manage.py test api
```
> 사내 전용 모듈 `datacenterquery` 가 없으면 import 에서 죽는다. 같은 경로에 스텁을 두면 통과한다.

**프론트엔드**
```bash
cd frontend && npm ci
CI=true npx react-scripts test --watchAll=false --passWithNoTests    # 테스트 파일 없음 → 통과
npx tsc --noEmit 2>&1 | grep -c "error TS"                          # 47 = 기존 baseline (docs/REQUEST.md §4)
```

### 1.5 이번 세션 실제 실행 결과 (2026-07-28)

```
Ran 75 tests in 1.397s
FAILED (failures=2, errors=1)
```
| 실패 테스트 | 원인 | 판정 |
|------------|------|------|
| `MessageBuildingTest.test_broadcast_subject_has_no_name_prefix` | 제목이 항상 `[결재 요청] ...` 로 시작하는데 `assertFalse(startswith('['))` 로 단언 → **논리상 절대 통과 불가** | **테스트 자체 결함** (B-22) |
| `HybridImmediateSendTest.test_enqueue_schedules_immediate_send_on_commit` | TE_R 사용자가 없어 수신자 0 → `_enqueue` 가 `None` 반환 → `noti.id` AttributeError. `.env` 의 `MAIL_REDIRECT_TO` 가 있어야만 통과 | **환경 의존 테스트** (B-23) |
| `ExternalApiKeyAccessTest.test_wrong_key_returns_401` | `ExternalApiKeyAuthentication` 에 `authenticate_header()` 가 없어 DRF 가 401→403 으로 변환 | **코드/문서 불일치** (B-19) |

> ⇒ **현재 `manage.py test api` 는 red 다.** CI 가 돌고 있지 않다는 신호이므로, 아래 CASE 검증 전에 먼저 green 을 만들 것을 권한다.

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
                                       ├── 경로2: O [+ E ─[EV]] ┼─▶ 전원 합의 ▶ approved
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

#### T-B6 기타 목적 `완성된 MAP 변경` 단독 동작
- 조작: 기타 목적에서 **완성된 MAP 변경** 클릭 → (입력이 있으면) 초기화 확인 → 검색 툴바에서 **결재완료 문서 선택 → '적용'**
- ✅ 요청 목적이 자동 `기타`, `map_type=EDIT` 고정, STEP2 MAP 필드만 프리필. **선택만으로는 프리필되지 않고 '적용'을 눌러야 함**
- ✅ 다른 기타 목적을 클릭하면 이탈 확인 모달 → MAP 키 전체 초기화
- ❌ '적용' 없이 프리필되거나, 라인/제품이 지워지면 회귀

#### T-B7 `Layer 추가/삭제` 참조 요청서 Merge
- 조작: 기타 목적 `Layer 추가/삭제` → 참조 요청서 검색 → 선택 → **Merge**
- ✅ 병합 통계 모달 → 확인 시 J/O 표에 행 추가, 병합 행은 `loaded=true` 라 **`process_id·sp·sd·layerid·pp` 5개 컬럼이 읽기전용**
- ❌ 병합 행의 원본 컬럼이 편집되면 `LOADED_LOCK_COLS` 회귀

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
- ✅ 저장된 JSON 에 `prodc_*`·REV·지도편차 값이 **남아 있지 않다**
- ❌ 남아 있으면 감사 R-2~R-6 회귀 (백엔드에 유령 값 저장)
- 동일 검증: `map_change=변경 없음` → `map_value_x/y`·`map_reason` 초기화 / `ea_change=변경 없음` → `ea_value` 초기화 /
  `mshot_change=없음|삭제` → `mshot_image_*` 초기화

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
- 조작: Only MAP / 완성된 MAP 변경 모드
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
| 매핑된 J행 **비활성화** | ✅ bb 행 제거, 원본 목록에도 안 뜸. **복원 시 목록 복귀** |
| 라인/조합법/조리법 변경 | ✅ `bbRows`·`mappedJayerRowIds`·`stagedMappings` 전부 초기화(고아 bb 방지) |

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

#### T-F3 임시저장 그룹 가시성
| 로그인 | 기대 |
|---|---|
| 작성자 본인 | ✅ 보임 |
| 작성자와 **같은 '나만의 그룹'** 멤버 | ✅ 보임 |
| 무관한 사용자 | ✅ **안 보임** (목록에도 상세 조회에도) |
| MASTER | ✅ 전부 보임 |
> 자동 커버: `backend/api/tests.py::DraftVisibilityTest`

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
- ✅ **P(4영업일) / O(6영업일) / [E(pp에 `plel` 포함 시)] / RA(후결자, 6영업일)** 동시 생성
- ✅ 결재현황이 **경로1·경로2·경로3 = 최대 3행** 으로 rowSpan 분기
- ✅ 기한은 **주말 + `Holiday(isholiday='Y')` 제외** 영업일 계산

#### T-I4 E 단계 조건부 생성
| J-layer `pp` 값 | 기대 |
|---|---|
| 어느 행이든 `plel` 포함(대소문자 무관) | ✅ E 단계 생성 |
| 전 행에 없음 | ✅ E 단계 미생성, 경로2 는 O 만 |

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
| EV 까지 전원 합의 + RA 전원 합의 | ✅ `approved` + 승인 메일 + 통보처 메일 |
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

#### T-K4 완성된 MAP 변경 문서의 이력
- ✅ 상신 시 `history=[{detail: 원본 MAP 스냅샷}]` **단일 항목**(append 아님) — 재상신·draft 왕복에도 diff 기준이 '원본 MAP' 으로 고정
- ✅ 상세뷰에서 **MAP 관련 항목만** 강조(기본정보·표는 양쪽 동일 → 노이즈 없음)

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

#### T-L2 삭제 — **현재 인가 없음**
- 조작: 무관한 사용자(역할 `NONE` 포함)가 `POST /api/documents/{id}/delete/` 또는 `DELETE /api/documents/{id}/`
- ✅ **기대**: 403
- ❌ **실제**: 200 / 204 로 **삭제 성공**(결재 완료 문서 포함) → §5 **B-01** 🔴

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
| 조작 | 기대 |
|---|---|
| pause 문서에 `approve-step/` | ✅ 400 |
| `reject-step/` | ✅ 400 |
| `assign-step/` | ✅ 400 |
| `claim-step/` | ✅ 400 |
| **`peer-approve/` / `peer-reject/` / `peer-submit/`** | ❌ **그대로 동작해버림** → §5 **B-06** 🔴 |

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
| 경로3 | `후결자(미합의자 이름)` |
| pause | 단일 행 + `PAUSE` 배지 |

#### T-O2 상태 배지
- ✅ pending 인데 담당자 없음 → **`대기중`(unassigned)** / 있음 → **`검토중`**
- ✅ PV/EV 는 지정 즉시 담당자 확정이라 항상 `검토중`
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
- ✅ 그룹 멤버는 서로의 **임시저장 문서**를 볼 수 있고 **철회**도 가능(T-F3, T-L1)

#### T-P5 외부 API
```bash
curl -H "X-API-Key: $EXTERNAL_API_KEY" 'http://localhost:10011/api/external/v1/documents/?p_approved=true&fields=id,title,status'
```
- ✅ 키 없음 → 403 / 잘못된 키 → 인증 실패 / 올바른 키 → **draft 포함 전체** 반환
- ✅ 쓰기 메서드 미노출(ReadOnly), 내부 `/api/documents/` 는 `X-API-Key` 로 접근 불가
- ✅ `fields` 에 허용되지 않는 이름 → 400
- ⚠️ 잘못된 키의 응답 코드가 **401 이 아니라 403** → §5 **B-19**

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

### X-2 완성된 MAP 변경 × 재상신 × 이력 diff
1. 결재완료 문서를 원본으로 '완성된 MAP 변경' 프리필 → 상신 → 반려
2. 재상신 화면 재진입 → ✅ `history[0].detail` 에서 baseline 이 복원돼 **diff 기준이 여전히 '원본 MAP'**
3. ✅ 상세뷰에서 기본정보·J/O/BB 표는 강조되지 않고 **MAP 항목만** 강조
4. ❌ 여기서 기준이 '직전 재상신본' 으로 바뀌면 회귀

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

### X-7 PAUSE × 기한 연장 × 재상신
1. O 단계에서 중단 확정 → 5일 뒤 재개 → ✅ pending 단계 `due_date` 가 +5일
2. 이어서 O 반려 → 재상신 → ✅ 새 회차 기한은 새로 계산(이전 연장분이 이월되지 않음)

### X-8 그룹 × 임시저장 × 철회 × 삭제
1. PL-A 가 임시저장 → 같은 그룹 PL-D 가 목록에서 확인 ✅
2. PL-D 가 그 문서를 상신 → ✅ 가능(그룹 멤버는 `can_edit` 대상)
3. 무관한 사용자로 임시저장 문서 조회 → ✅ 404/미노출
4. ❌ 그러나 **상신 이후**(draft 가 아님)에는 목록 필터가 걸리지 않으므로 무관한 사용자가 **삭제 가능** → B-01 🔴

### X-9 동시성
| 시나리오 | 기대 |
|---|---|
| 두 TE_O 가 동시에 '검토중' | ✅ 1명만 성공, 나머지 409 |
| J·O 담당자가 동시에 마지막 합의 | ✅ `select_for_update` 직렬화 → `approved` 1회만, 승인 메일 1통 |
| 다중 PL 이 동시에 마지막 합의 | ✅ R 단계 중복 생성 없음(`_advance_after_pl` 문서 락 + 존재 검사) |
| 같은 문서를 두 탭에서 동시 편집 후 저장 | ⚠️ **마지막 저장이 통째로 이김**(낙관적 잠금 없음) → R-05 |

### X-10 메일 전 구간 (1건의 문서로 끝까지)
상신 → PL 합의 → R 도착 → R 지정 → RV 도착 → 병렬 도착(P·O·[E]·RA) → PV 지정 → J 도착 → 승인
- ✅ 각 전이마다 `MailNotification` 이 1행씩 쌓이고 **커밋 직후 즉시 1회 발송**
- ✅ 실패분은 `pending` 으로 남아 APScheduler `process_mail_queue`(1분 주기)가 **최대 5회** 재시도 후 `failed`
- ✅ 검증 쿼리
  ```sql
  SELECT event_type, status, attempts, LEFT(subject,60), recipients
  FROM api_mailnotification WHERE document_id = ? ORDER BY created_at;
  ```
- ✅ 개인 지정 메일은 제목이 `[이름님] [결재 요청] ...`, 팀 브로드캐스트는 접두어 없음, 후결은 `[후결 요청] {제목}`

---

## 5. 발견된 버그

> 심각도: 🔴치명 / 🟠높음 / 🟡중간 / ⚪낮음
> 상태: **재현✅** = 이번 세션에서 Django 테스트로 직접 실행해 확인 / **분석🔍** = 코드 정독으로 도출

### 🔴 B-01 의뢰서 삭제에 인가가 전혀 없다 — 결재 완료 문서까지 누구나 삭제 **재현✅**
- 위치: `backend/api/views.py:100-102`(`permission_classes = [IsAuthenticatedInProd]`), `views.py:397-405`(`delete` 액션)
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

### 🔴 B-06 PAUSE 동결이 PL 단계 액션에는 적용되지 않는다 **재현✅**
- 위치: `views.py:1092-1140`(`peer_approve`/`peer_reject`/`peer_submit`), `views.py:1142`(`change_designee`)
- 내용: `approve_step`·`reject_step`·`assign_step`·`claim_step` 에는 모두
  `if document.status == 'pause': return 400` 가드가 있으나, **PL 단계 전용 액션 4개에는 없다.**
  중단 요청은 PL 검토 단계에서도 가능하므로(`request_pause` 는 pending step 이면 무엇이든 target 으로 잡는다)
  "PL 단계에서 pause 확정" 상태가 실제로 만들어진다.
- 재현 결과
  ```
  [B-06a] pause 문서 peer-approve -> 200 | status = under_review | R단계 생성: True
  [B-06b] pause 문서 peer-reject  -> 200 | status = rejected
  ```
- 영향: 작성자가 요청하고 팀이 확인해 **정식으로 멈춘 결재를 PL 이 혼자 되살리거나 끝내버린다.**
  `PauseRequest` 는 `confirmed` 로 남아 있어 상태가 어긋난다(문서는 `under_review` 인데 활성 중단요청 존재 →
  `can_request_pause` 가 계속 False → **작성자가 다시 중단 요청도 못 한다**).
- 권고: 4개 액션 앞에 동일 가드 추가. 공통 데코레이터/헬퍼로 빼서 향후 액션 추가 시 누락 방지.

### 🔴 B-02 업로드 API가 미인증 + 확장자 무검증 **재현✅**
- 위치: `views.py:1718-1758`(`upload_image`), `views.py:1765-1804`(`upload_video`)
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
- 위치: `views.py:990-1031`(`_advance_to_parallel`), `mailer.post_approver_users`
- 내용: Only MAP 문서는 P/O/E/J 가 없어 **후결자(RA)가 유일한 종단 경로**다. 그런데 후결자가 0명이면
  `if not post_users: return 'approved'` 로 **R 합의 즉시 최종 승인**된다.
  후결자는 `.env POST_APPROVER_LOGINID` 로만 들어오므로, 값이 비어 있거나 그 loginid 의 계정이 없으면(오타/퇴사/DB 미생성)
  조용히 이 경로를 탄다. 로그도 남지 않는다.
- 재현 결과
  ```
  [B-04] Only MAP, POST_APPROVER_LOGINID='' → R 합의: 200 | 문서 status = approved
  ```
- 영향: 후결 결재가 **무음으로 스킵**된 채 승인 완료 메일까지 나간다. `remove-post-approver` 는 "최소 1명 유지" 를
  막고 있는데(views.py:1306) 정작 **애초에 0명인 경우는 막지 않아** 정책이 앞뒤가 안 맞는다.
- 권고: 기동 시 `settings.POST_APPROVER_LOGINID` 실존 검증(`manage.py check` 또는 앱 ready) + 미설정 시
  `_advance_to_parallel` 에서 승인 대신 **에러/경고 로그 + 관리자 알림**.

---

### 🟠 B-07 `assign-step`(R 담당자)에 역할 검증이 없고, 담당자 이름을 클라이언트가 정한다 **재현✅**
- 위치: `views.py:637-645`
- 내용: 검토자(RV)는 `User.objects.get(loginid=..., role='TE_R')` 로 **TE_R 을 강제**하는데,
  **담당자(assignee)는 `User.objects.get(loginid=...)`** 뿐이다. 게다가 `step.assignee_name` 은
  **요청 본문의 `assignee_name` 을 그대로** 저장한다(실제 사용자명과 대조하지 않음).
- 재현 결과
  ```
  [B-07] R 담당자로 role=NONE 사용자 지정 -> 200
         assignee = none9 / role = NONE | 저장된 이름 = "아무개(위장이름)"
  ```
- 영향: RFG 팀이 아닌 사람이 R 담당자가 되면 `_can_act_on_step`(assignee 본인) 덕에 **합의는 가능**하다 →
  권한 없는 사람이 결재선을 통과시킨다. 표시 이름 위조로 **결재 이력 신뢰성**도 깨진다.
- 권고: `role='TE_R'` 필터 추가 + `assignee_name` 은 서버에서 `user.username or user.loginid` 로 파생.

### 🟠 B-11 재상신 시 '검토자(지정 PL) 프리필' 이 상신 모달 직전에 지워진다 **분석🔍**
- 위치: `frontend/src/pages/RequestPage/index.tsx:696` (프리필) ↔ **`:3083` `setDesignees([])`**
- 내용: 편집 로드에서 이전 회차 PL 담당자를 `setDesignees(prevDesignees)` 로 채워두는데,
  STEP5 의 **상신 버튼 핸들러 `handleSubmitClick` 이 모달을 열기 직전에 `setDesignees([])` 를 무조건 호출**한다.
  결과적으로 모달은 **항상 비어서** 열린다.
  같은 함수에서 `postApprovers` 는 지우지 않아 후결자만 프리필이 살아 있는 **비대칭** 상태다.
- 영향: `docs/APPROVAL.md` Case I / `docs/REQUEST.md`(2026-07) 에 명시된 기능이 **동작하지 않는다.**
  재상신 때마다 검토자를 매번 다시 검색·선택해야 하고, 다중 PL 이었다면 누구였는지 알 수 없어 결재선이 바뀔 수 있다.
- 재현 방법: 반려 문서 → '수정 후 재상신' → STEP5 → 상신 → **검토자 칸이 비어 있으면 버그**
- 권고: `setDesignees([])` 를 `if (!isEditMode) setDesignees([])` 로 한정하거나, 프리필 값을 별도 ref 에 보관 후 복원.

### 🟠 B-12 '내 차례' 필터가 claim 방식 단계를 못 잡는다 **분석🔍**
- 위치: `ApprovalPage.tsx:147-151`, `:181`
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
- 위치: `ApprovalPage.tsx:1046-1053`(`pendingSteps`), `:1083`(`hasPendingPLStep`)
- 내용: `pendingSteps` 는 `action === 'pending'` 만 보고 **`round` 필터가 없다.**
  반려는 반려당한 step 하나만 `rejected` 로 바꾸므로 **같은 회차의 다른 pending step(P/J/O/E/PL)은 그대로 남고**,
  재상신하면 새 회차가 추가되면서 두 회차의 pending 이 공존한다(재현✅ X-4: 회차 `[1, 2]` 공존, 1회차 PL 단계 `pending` 잔존).
  목록 표(`approvalTable.ts:113`)는 `maxRound` 로 거르는데 **상세 footer 만 안 거른다.**
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
| `request.btn_all_o` / `btn_all_x` / `btn_all_new` / `btn_all_copy` / `btn_reset` | `RequestPage/components/Step2.tsx:94-102`, `Step3.tsx:200-208` | **J·O-layer 표 헤더의 일괄 버튼 5종**에 `request.btn_all_o` 같은 문자열 |
| `guide.search_placeholder` | `GuidePage.tsx:216` | 가이드 검색창 placeholder |
| `profile.name` / `profile.email` / `profile.department` | `Navbar.tsx:227,231,235` | 프로필 드롭다운 라벨. `\|\| '이름'` 폴백을 뒀지만 **i18next 가 키 문자열(truthy)을 반환해 폴백이 절대 안 걸린다** |
- 검증 결과: `ko.json` 에 `request.btn*` 키 **0개**, `profile` 섹션 **없음**, `guide.search_placeholder` **없음**
- 영향: 의뢰서 작성 핵심 화면(J/O-layer 일괄 편집 버튼)에 개발용 키가 그대로 보인다. **규칙 G 위반.**
- 권고: ko/en 동시 추가.

### 🟠 B-15 `voc.page_other` 가 `ko.json` 에만 있다 **재현✅**
- 위치: `locales/ko.json:428` (en.json 없음), 사용처 `VOCPage.tsx:26`
- 검증: ko 854키 / en 853키 — 차이 정확히 이 1개
- 영향: 영어 전환 시 VOC 페이지 선택지에 `voc.page_other` 노출. **규칙 G(동시 추가) 위반.**

---

### 🟡 B-03 `additional_notes` JSON 이 깨지면 BB 매핑 검증이 통과된다 **재현✅**
- 위치: `views.py:244-271`(`_validate_bb_mapping` 의 `except (JSONDecodeError, TypeError): pass`)
- 재현 결과
  ```
  깨진 JSON  → _validate_bb_mapping = None      (= 검증 통과)
  정상 JSON(미매핑) → '모든 원본 데이터에 bb 을 매핑해야 상신할 수 있습니다.'
  ```
- 근본 원인: `additional_notes` 가 `JSONField` 가 아니라 **`TextField`** 라 DB 가 깨진 JSON 도 받는다.
  `get_detail()` 도 실패 시 조용히 `{}` 를 돌려주므로 `is_only_map()`·`has_ppid_plel()`·`_validate_post_approvers`
  **전부 무음으로 오판**한다 → Only MAP 문서가 일반 경로를 타거나, E 단계가 안 생기거나, C가문 후결자 검증이 스킵된다.
- 권고: 파싱 실패 시 **400 으로 거부**(관대한 통과 대신). 중기적으로 `JSONField` 전환 + 마이그레이션.

### 🟡 B-08 `change_designee` 만 `requester` FK 직접 비교라 레거시 문서에서 작성자가 403 **재현✅**
- 위치: `views.py:1150-1154`
  ```python
  is_requester = (document.requester and document.requester.loginid == caller_loginid)
  ```
- 내용: 다른 곳은 모두 `doc_permissions.is_requester`(FK + **`requester_email` 폴백**)를 쓴다.
  `requester` FK 는 `on_delete=SET_NULL` 이라 **작성자 계정이 삭제되거나, `perform_create` 이전에 만들어진 레거시 문서**는 FK 가 비어 있다.
- 재현 결과
  ```
  [B-08] FK 없는 문서의 실제 작성자가 change-designee -> 403   ← 버그
         같은 사용자·같은 문서로 withdraw          -> 200   ← 폴백이 있어 정상
  ```
- 영향: 실제 작성자가 지정자 변경만 못 한다. `add_post_approver` 는 2026-07 에 같은 버그를 고쳤는데 **여기만 남았다.**
- 권고: `doc_permissions.is_requester(request.user, document)` 로 교체.

### 🟡 B-09 철회 시 **모든 회차의 결재 이력이 전량 삭제**된다 **재현✅**
- 위치: `views.py:393` `ApprovalStep.objects.filter(document=document).delete()`
- 재현 결과: 1·2회차 합쳐 4건의 단계가 있는 문서를 철회 → **0건**
- 영향: "1회차에 누가 언제 왜 반려했는지" 가 영구 소실된다. 감사 추적 불가.
  결재 이력을 담는 별도 테이블이 없고 `ApprovalStep` 자체가 이력이라 복구 수단이 없다.
- 권고: 철회는 **현재 회차 pending step 만** 삭제하거나, 전 회차를 `withdrawn` 으로 마킹해 보존.

### 🟡 B-17 `resolvePathStatus`/`getDisplayStatus` 가 `pause` 를 반영하지 못하는 경로가 있다 **분석🔍**
- 위치: `utils/approvalTable.ts:14-23`(`getDisplayStatus`), `:89-98`(`resolvePathStatus`)
- 내용: `getDisplayStatus` 는 `doc.status !== 'under_review'` 면 원본 상태를 그대로 반환하므로 pause 는 정상이나,
  `resolvePathStatus` 는 `docStatus === 'rejected'` 만 특별 처리하고 **pause 는 분기하지 않는다**.
  `getDocTableRows` 가 pause 를 앞단에서 가로채기 때문에 지금은 드러나지 않지만,
  이 헬퍼를 다른 곳에서 재사용하면 pause 문서가 `under_review`/`unassigned` 로 표시된다.
- 권고: `resolvePathStatus` 에도 `if (docStatus === 'pause') return 'pause';` 추가.

### 🟡 B-18 '최종 완료예정' path1 추정치가 **영업일이 아니라 달력일** **분석🔍**
- 위치: `utils/approvalTable.ts:61-69`
- 내용: J 단계가 아직 없을 때 `P.due + 4` 를 **달력일**로 더한다. 백엔드 실제 J 기한은
  `calculate_business_due_date(p_date, 4)`(주말·공휴일 제외)라 **최대 4일 이상 차이**날 수 있다.
- 영향: 목록의 '최종 완료예정' 이 실제보다 이르게 표시 → 일정 관리 오판.
- 권고: J 미생성 시 `-`/`(예상)` 표기하거나 서버가 예상 기한을 내려주기.

### 🟡 B-19 외부 API 잘못된 키가 401 이 아니라 403 **재현✅**(기존 테스트가 실패)
- 위치: `authentication.py:84-102`(`ExternalApiKeyAuthentication`)
- 내용: `AuthenticationFailed` 를 던지지만 클래스에 **`authenticate_header()` 가 없어** DRF 가 401 → 403 으로 변환한다.
- 근거: `tests.py::ExternalApiKeyAccessTest.test_wrong_key_returns_401` 이 `AssertionError: 403 != 401` 로 실패
- 영향: 외부 연동 측이 "인증 실패(재시도/키 갱신)" 와 "권한 없음(포기)" 를 구분 못 한다. `docs/EXTERNAL_API.md` 와 불일치.
- 권고: `def authenticate_header(self, request): return 'X-API-Key'` 추가.

### 🟡 B-20 VOC 제출자 정보를 클라이언트가 정한다 **분석🔍**
- 위치: `views.py:1474-1476`(`VOCViewSet.perform_create`), `serializers.VOCSerializer(fields='__all__')`
- 내용: `submitter_user_id`·`submitter_name`·`submitter_email` 이 **요청 본문 그대로** 저장된다(서버 파생 없음).
  `update_status` 의 '완료' 권한이 `voc.submitter_user_id != request.user.id` 로 판정되므로,
  **작성 시 남의 id 를 넣으면 그 사람만 완료 처리할 수 있게 되거나** 신고자를 위조할 수 있다.
- 권고: `perform_create` 에서 `request.user` 로 강제 세팅 + 해당 필드 `read_only`.

### 🟡 B-21 VOC 상태를 바꿔도 `responded_at` 이 안 채워진다 **분석🔍**
- 위치: `views.py:1478-1505`(`update_status`)
- 내용: `voc.status` 만 저장하고 `responded_at` 은 건드리지 않는다(모델에 필드는 있음). 항상 `null`.
- 권고: 완료/거부 시 `responded_at = timezone.now()`.

---

### ⚪ B-16 하드코딩 한국어 (규칙 G 위반) **재현✅**(정적 검색)
| 파일:라인 | 문자열 |
|---|---|
| `HistoryPage.tsx:183` | 삭제 버튼 `삭제` |
| `HistoryPage.tsx:220-223` | `문서 삭제` / `"…" 문서를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.` / `삭제` |
| `ApprovalPage.tsx:557` | `지정자가 변경되었습니다.` |
| `ApprovalPage.tsx:729` | `의뢰서가 삭제되었습니다.` |
| `ApprovalPage.tsx:1030` | `의뢰서가 완전히 삭제됩니다. 복구할 수 없습니다.` |
| `RequestPage/index.tsx:2600,2617,2640,…` | `validate()` 의 `errorMessages` 다수 (`… 필수 입력 항목입니다.` 등) |
| `RequestPage/index.tsx:2789` | `모든 원본 데이터에 Backbone을 매핑해야 상신할 수 있습니다.` |
| `RequestPage/index.tsx:3124,3145,3156` | `수정 후 상신되었습니다.` / `재상신되었습니다.` / `오류 발생: …` / `알 수 없는 오류` |
| `RequestPage/components/*` | `활성/전체`, `STEP 정렬`, `+ 행 추가`, `선택 비활성화`, `범위 추가`, `Ctrl+V 로 이미지를 붙여넣으세요` 등 (REQUEST.md §4 에 기록된 기존 항목) |
> 백엔드 응답 메시지(`'권한이 없습니다.'` 등)도 전부 한국어 고정이라 영어 사용자에게 그대로 노출된다.

### ⚪ B-22 절대 통과할 수 없는 테스트가 있다 **재현✅**
- 위치: `tests.py:546-549` `test_broadcast_subject_has_no_name_prefix`
- 내용: `_build_message('stage_arrival', doc, agent='R')` 의 제목은 **항상 `[결재 요청] {제목} - R`** 인데
  `assertFalse(subject.startswith('['))` 로 단언한다 → 구현이 어떻든 실패.
- 의도 추정: "이름 접두어(`[홍길동님] `)가 없어야 한다" 였을 것 → `assertFalse(subject.startswith('[홍'))` 가 아니라
  `self.assertNotIn('님] ', subject)` 또는 `assertTrue(subject.startswith('[결재 요청]'))` 로 고쳐야 한다.

### ⚪ B-23 테스트가 개발자 `.env` 에 의존한다 **재현✅**
- 위치: `config/settings/base.py:7` `load_dotenv()` + `tests.py:609-614`
- 내용: `test_enqueue_schedules_immediate_send_on_commit` 은 TE_R 사용자를 만들지 않아 수신자가 0명이라
  `_enqueue` 가 `None` 을 반환한다. **`.env` 에 `MAIL_REDIRECT_TO` 가 설정돼 있을 때만** 수신자가 강제로 채워져 통과한다.
- 영향: CI/다른 개발자 환경에서 재현 불가한 실패. 설정 의존 없는 테스트여야 한다.
- 권고: `@override_settings(MAIL_REDIRECT_TO='x@company.com')` 또는 TE_R 사용자 생성 추가.

### ⚪ B-24 `any` 사용 (규칙 I 위반) **재현✅**
- `ApprovalPage.tsx:213` — `(data as any).results`
- `HistoryPage.tsx:53` — `(data as any).results`
> `documentsAPI.list` 의 반환 타입은 이미 `{ results, count }` 로 좁혀져 있어 캐스팅 자체가 불필요하다.

### ⚪ B-25 `StatusBadge` 가 VOC '거부' 를 결재 '반려' 로 표시 **분석🔍**
- 위치: `components/StatusBadge.tsx` — `STATUS_I18N_KEY` 에 `rejected: 'common.status_rejected'` 하나뿐.
  VOC 도 `rejected` 를 쓰므로 VOC 목록에서 `voc.status_rejected` 가 아니라 결재용 라벨('반려')이 나온다.
  (`checking`/`completed` 는 VOC 키가 있는데 `rejected` 만 빠짐)

---

## 6. 잠재 위험 (아직 버그로 터지지 않았지만 구조적으로 위험한 것)

### R-01 🔴 `additional_notes` 가 `TextField` — 도메인 데이터 전체가 스키마 없는 문자열
J/O-layer·BB·MAP·통보처·후결자·history 가 **전부 이 한 칼럼**에 들어간다.
- DB 레벨 제약이 0 → 깨진 JSON 도 저장되고 `get_detail()` 이 조용히 `{}` 반환(B-03)
- 쿼리·인덱싱·집계 불가. 문서 1건이 커질수록 목록 API 가 통째로 무거워짐
  (`RequestDocumentListSerializer` 가 **목록에도 `additional_notes` 를 포함**한다 → 문서 수백 건이면 응답 수십 MB)
- 완화: 최소한 목록 serializer 에서 `additional_notes` 를 빼고 필요한 파생값만 내려주기 → 중기적으로 JSONField 전환

### R-02 🟠 결재 단계에 '취소/무효' 상태가 없다
`ApprovalStep.ACTION_CHOICES = pending / approved / rejected` 뿐이라, **반려로 회차가 끝나도 나머지 단계는 영원히 `pending`** 이다.
B-13(잘못된 버튼 노출)·X-4·X-5 의 공통 뿌리이며, 통계(`stats`)·메일 수신자 산출·표시 로직이 전부 이 잔여 pending 을 우회하려고
각자 `max_round` 필터를 중복 구현하고 있다(한 곳이라도 빠지면 버그 — 실제로 상세 footer 가 빠졌다).
- 권고: `cancelled` 액션 추가 + 반려 시 같은 회차 pending 일괄 전이.

### R-03 🟠 `.env` 값에 결재 경로가 직접 의존하는데 검증 시점이 없다
`POST_APPROVER_LOGINID`(B-04), `MAIL_REDIRECT_TO`(전 메일 하이재킹), `EXTERNAL_API_KEY`(비면 모든 키 거부),
`P_LINE_FALLBACK`(JSON 파싱 실패 시 조용히 `{}`) 모두 **잘못돼도 기동은 성공**하고 런타임에 조용히 다른 동작을 한다.
- 권고: `AppConfig.ready()` 또는 `manage.py check` 커스텀 체크로 기동 시 경고.

### R-04 🟠 P/E 검토자(PV/EV) 지정 취소·변경 API가 없다
`_create_reviewers` 로 생성만 가능하고 제거 경로가 없다. **잘못 지정하면 그 사람이 합의할 때까지 단계가 영구히 멈춘다**
(휴직·퇴사 시 MASTER 가 대신 합의하는 것 외엔 방법 없음). `APPROVAL.md §6-7` 에도 제약으로 기록돼 있다.

### R-05 🟡 문서 수정에 낙관적 잠금이 없다
`PATCH /documents/{id}/` 는 `updated_at` 비교 없이 통째로 덮어쓴다. 반려 문서는 **의뢰자·지정PL·의뢰자 그룹멤버**가
모두 편집 가능하므로(`can_edit`), 두 사람이 동시에 열어 저장하면 **먼저 저장한 쪽 작업이 흔적 없이 사라진다.**
`/request` 는 20분 자동저장까지 돌아 충돌 확률이 낮지 않다.

### R-06 🟡 `submitted` 는 데드 상태값
`STATUS_CHOICES` 에 있지만 어떤 코드도 이 값을 만들지 않는다. 그런데 `withdraw`·`can_edit` 는 이 값을 분기에 포함하고 있어
읽는 사람을 오도한다.

### R-07 🟡 결재 판정 규칙이 프론트·백엔드에 **이중 구현**돼 있다
`ApprovalFlow.tsx`(canUserAgree/canUserAssign/canUserClaim) ↔ `views.py`(`_can_act_on_step`/`_can_assign_step`/`_can_claim_step`)
가 "1:1 일치" 를 전제로 각각 손으로 유지된다. 이미 B-12(내 차례 필터)·B-13(회차 필터)에서 어긋났다.
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

### R-11 ⚪ 이름(`requester_name`) 기반 본인 판정이 남아 있다
`ApprovalPage.tsx:1084` `isOriginalPL = isPL && selected?.requester_name === currentUser.name` —
**동명이인이면 남의 문서에 '지정자 변경' 버튼이 뜬다.** 바로 아래 `isPauseRequester` 는 `requester_loginid` 를 우선 쓰므로
같은 파일 안에서도 규칙이 다르다. `applyClientFilter` 의 PL 판정(`:138`)도 동일 문제.
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

버그 수정 후 재확인:
- [ ] B-01 무관한 사용자로 `DELETE /api/documents/{id}/` → **403**
- [ ] B-06 pause 문서에서 `peer-approve/` → **400**
- [ ] B-02 비로그인 `POST /api/upload-image/` → **401/403**, `.svg` 업로드 → **400**
- [ ] B-04 `POST_APPROVER_LOGINID` 미설정 + Only MAP → R 합의로 approved 되지 **않음**
- [ ] B-11 재상신 상신 모달에 이전 검토자 **프리필됨**
- [ ] B-12 TE_O 로 '내 차례' → 미선점 O 단계 문서 **보임**
- [ ] B-13 재상신 문서 상세에 이전 회차 '검토중' 버튼 **없음**
- [ ] B-14/B-15 `npm start` 후 J/O-layer 표 헤더 버튼에 한글 라벨 표시 + 영어 전환 시 VOC 유형 정상
- [ ] `manage.py test api` → **OK (0 failures)**

---

## 8. 이번 세션에서 실제로 수행한 검증 (근거)

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

> 검증에 사용한 임시 테스트 파일은 scratchpad 에서 실행 후 **프로젝트에서 제거**했다(코드 변경 0건).
> 프론트엔드는 이 세션에 `node_modules` 가 없어 `tsc`/`react-scripts test` 를 돌리지 못했다 →
> 프론트 항목은 전부 **코드 정독 + 정적 분석** 근거이며, §7 체크리스트로 브라우저 확인이 필요하다.

---

*이 문서의 CASE 나 버그 상태가 바뀌면 반드시 함께 갱신한다. 버그 수정 시 해당 항목에 `✅수정완료(커밋 해시)` 를 남긴다.*
