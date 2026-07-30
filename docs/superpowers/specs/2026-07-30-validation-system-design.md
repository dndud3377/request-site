# Validation System 대상/비대상 — 설계 스펙

> 작성: 2026-07-30 / 브랜치: `worktree-bridge-cse_01TA99Xg3CrYsrMCumaLnKtw` (머지 대상 `woobin`)
> 상태: 사용자 결정 완료, 구현 계획 작성 전

## 1. 배경과 목적

의뢰서가 **Validation System 대상인지 비대상인지**를 시스템이 자동 판정해 화면에 드러내고,
상신자가 크로스체크한 뒤, **MASK 팀(결재 단계 `E`)이 결재 과정에서 최종 확정**하게 한다.

> `Validation System` 은 가명이다. 실제 사내 용어는 추후 `ko.json` / `en.json` 값만 교체한다.
> 코드에는 중립적 키(`validation_system`)만 들어간다 — 이 repo의 마스킹 관례.

핵심 역할 분담:

| 주체 | 역할 |
|---|---|
| 시스템 | J-layer 표의 `pp` 값으로 대상/비대상을 **자동 판정**해 기본값 제시 |
| 상신자 | 자동 판정을 **크로스체크**하고, 필요하면 상신 전에 수정 |
| MASK 팀(`E`) | "이 제품이 정말 대상이 맞는가"를 **검증하고 최종 확정** |

## 2. 확정된 결정 사항

| 항목 | 결정 |
|---|---|
| MASK 팀 정체 | 기존 `E` 단계 (`ko.json: agent_E`) |
| 자동 판정 기준 | J-layer 행의 `pp` 에 키워드(`plel`, 대소문자 무관) 포함 여부 — 기존 `has_ppid_plel()` 규칙과 동일 |
| 판정 범위 | **J-layer(`jayerRows`) 활성 행만** (O-layer 미포함 — 현행 유지) |
| E 단계 생성 조건 | **대상/비대상과 무관하게 항상 생성** (기존: 키워드 있을 때만) |
| Only MAP 문서 | **제외 유지** — `is_only_map()` 문서는 지금처럼 P/O/E/J 없이 R→RA |
| 기존 진행 문서 | **소급 생성 없음** — 배포 후 R 단계를 통과하는 문서부터 E 생성 |
| 상신자 수정 | 가능 (자동값은 기본값) |
| MASK 수정 | **가능** — 합의 시점에 값 확정 |
| 상신 UI 위치 | J-layer(위저드 3단계, `Step2.tsx`) 표 상단 |
| 상세보기 위치 | J-layer 탭 표 위 |
| 상신자↔MASK 값 차이 | **병기 표시** (`상신 시 X → 확정 Y`) |
| `has_ppid_plel()` | **삭제** (참조처 0이 됨) |
| `plel` 키워드 하드코딩 | **프론트 6곳 전부 상수화** |
| 용어 | 가명 유지 |

## 3. 데이터 설계 — 마이그레이션 없음

`RequestDocument.additional_notes` JSON 의 `detail` 하위에 키 2개를 추가한다.
모델 필드 추가·마이그레이션·스키마 변경은 **없다**.

```jsonc
{
  "detail": {
    "validation_system": "YES",            // 현재 유효값 (MASK 가 확정한 최종값)
    "validation_system_submitted": "YES"   // 상신/재상신 시점의 상신자 값
  },
  "jayerRows": [ /* ... */ ]
}
```

- `validation_system` — 화면에 표시되는 값. 상신 시 상신자 값으로 설정되고, MASK 합의 시 덮어쓸 수 있다.
- `validation_system_submitted` — **상신/재상신 시에만** 기록한다. MASK 가 값을 바꿔도 건드리지 않는다.
  두 값이 다르면 상세보기에 병기해 "상신자 판단과 MASK 검증이 갈렸다"는 사실을 남긴다.
- 두 키가 모두 없는 **레거시 문서**는 저장된 `jayerRows` 로 그때그때 자동 판정해 표시한다(폴백).

값은 `'YES' | 'NO'` 문자열 리터럴 유니온으로 타입을 잡는다. `any` 금지(규칙 I).

## 4. 판정 규칙 — 단일 소스

`frontend/src/pages/RequestPage/constants.ts` 에 상수를 둔다.

```ts
/** Validation System 대상 판정 키워드 (pp 값에 포함되면 대상) */
export const VALIDATION_KEYWORD = 'plel';
export const VS_TARGET = 'YES';
export const VS_NONTARGET = 'NO';
/** 판정 키워드를 포함한 pp 셀 배경색 */
export const VALIDATION_CELL_COLOR = '#fff9c4';
```

`frontend/src/pages/RequestPage/helpers.ts` 에 순수 함수 2개를 추가한다.
기존 헬퍼들과 같은 스타일(인자만 사용, state 비의존).

```ts
/** 행 단위: 이 행의 pp 가 판정 키워드를 포함하는가 (셀 하이라이트 공용) */
export const isValidationKeywordRow = (pp: string | undefined): boolean =>
  !!pp && pp.toLowerCase().includes(VALIDATION_KEYWORD);

/** 문서 단위: 활성 J-layer 행 중 하나라도 키워드를 포함하면 대상 */
export const isValidationTarget = (
  rows: { disabled?: boolean; pp?: string }[]
): boolean => rows.some((r) => !r.disabled && isValidationKeywordRow(r.pp));
```

`isValidationTarget` 이 **활성 행만** 보는 점이 기존 백엔드 `has_ppid_plel()` 과 다르다.
상신 시 `disabled` 행은 저장에서 제외되므로(`index.tsx:2891`) 상신 문서에는 차이가 없고,
비활성 행까지 저장하는 **임시저장(draft) 상태에서만** 결과가 달라진다. 활성 행 기준이 의도한 동작이다.

### 4-1. 기존 셀 하이라이트 6곳 상수화

`pp` 셀 노란 배경(`#fff9c4`)은 지금 JSX 인라인으로 6곳에 중복돼 있다.
동작은 그대로 두고 `isValidationKeywordRow()` 호출로 치환한다.

| 파일 | 라인 | 대상 |
|---|---|---|
| `frontend/src/pages/RequestPage/components/Step2.tsx` | 206 | 상신 J-layer 표 |
| `frontend/src/pages/RequestPage/components/Step3.tsx` | 300 | 상신 O-layer 표 |
| `frontend/src/components/PagedDetailView.tsx` | 265 | 상세보기 J-layer 표 (`JayerTable`, `request.jayer_row_history`) |
| `frontend/src/components/PagedDetailView.tsx` | 328 | 상세보기 O-layer 표 (`OayerTable`, `request.oayer_row_history`) |
| `frontend/src/components/PagedDetailView.tsx` | 542 | J-layer 엑셀 내보내기(`exportJayer`, pp = col 5) |
| `frontend/src/components/PagedDetailView.tsx` | 574 | O-layer 엑셀 내보내기(`exportOayer`, pp = col 6) |

색상 `#fff9c4` 도 함께 상수(`VALIDATION_CELL_COLOR`)로 뺀다. 기존 `ST_CELL_COLOR` 와 같은 자리.

## 5. 결재 경로 — E 단계 무조건 생성

MASK 팀은 "대상이 맞는지 확인"하는 검증 주체이므로 **대상/비대상과 무관하게 항상 결재선에 포함**된다.

### 5-1. 백엔드

| 파일:라인 | 현재 | 변경 |
|---|---|---|
| `backend/api/views.py:1121` | `if document.has_ppid_plel():` 안에서 E step 생성 | 조건 제거, `is_only_map()` 이 아닌 문서면 항상 생성 |
| `backend/api/mailer.py:344` | `if agent == 'E' and not document.has_ppid_plel(): continue` | 분기 삭제 |
| `backend/api/mailer.py:485` | `if not document.has_ppid_plel(): route -= {'E','EV'}` | 분기 삭제 |
| `backend/api/models.py:161` | `has_ppid_plel()` 정의 | **삭제** (참조처 0) |
| `backend/api/views.py:1099` | docstring `[E(plel 시 6영업일)]` | 문구 수정 |
| `backend/api/mailer.py:476` | docstring `Only MAP 이거나 plel 이 아닌` | 문구 수정 |

E step 의 due_date 는 기존과 동일(`o_due`, 6영업일), `is_parallel=True` 유지.
`mailer.enqueue_stage_arrival(document, 'E', e_step)` 도 그대로.

### 5-2. 프론트엔드

| 파일:라인 | 변경 |
|---|---|
| `frontend/src/components/PagedDetailView.tsx:1434, 1520, 1664` | `hasPlel` 정의(1434)와 사용처 2곳 제거 — 1520 `getStepDisplays()` 의 `agent === 'E' && !hasPlel → 'na'` 분기, 1664 렌더의 동일 조건. `isOnlyMap` 분기는 **유지**한다 |
| `frontend/src/components/ApprovalRouteDiagram.tsx:7` | 파일 상단 주석의 "E(EUV)는 plel 존재 시에만" 문구 제거. **렌더링 변경 없음** — `Box label={agent('E')} dim`(56행)은 이미 조건 없이 항상 그린다. 실제 안내 문구는 69행이 i18n `approval.route_diagram.note_e` 로 출력하므로 §5-3 에서 처리 |

### 5-3. i18n 문구 수정 (ko/en 동시)

| 키 | 현재 (ko) | 변경 |
|---|---|---|
| `approval.route_diagram.note_e` | "EUV(E) 단계는 plel(노란 셀) 항목이 있는 경우에만 진행됩니다." | E 단계는 항상 진행되며 대상/비대상 판정을 검증한다는 내용으로 교체 |
| `guide.tour.steps.route.description` | "…(E는 plel 존재 시, Only MAP 의뢰는 R까지)" | "…(Only MAP 의뢰는 R까지)" |

`guide.tour.steps.approval.flow.route` / `.assign_btn` / `.route_tab` 은 E 를 조건부로 서술하지 않으므로 손대지 않는다.

### 5-4. 기존 문서

배포 시점에 진행 중이던 문서에는 E step 을 **소급 생성하지 않는다**.
배포 직후 일정 기간 문서마다 결재 경로가 달라 보이는 것은 의도된 동작이다.

## 6. 상신 화면 (위저드 3단계 = `Step2.tsx`)

### 6-1. 상태

`Step2.tsx` 는 순수 표현 컴포넌트라 상태를 `index.tsx` 로 올린다.

- **별도 state 를 만들지 않는다.** `validation_system` 은 `DetailFormState` 의 필드이므로 `index.tsx` 의 기존 detail state 안에 살고, 기존 detail 저장·복원 흐름을 그대로 탄다.
- `vsManuallySet: boolean` — `index.tsx` 의 **별도 세션 로컬 state. detail 에 넣지 않고 저장하지도 않는다**
- `useEffect([jayerRows])`: `vsManuallySet` 이 false 일 때만 `isValidationTarget(jayerRows)` 결과로 자동 갱신
- 사용자가 토글을 누르면 `vsManuallySet = true` → 이후 J-layer 를 고쳐도 자동 갱신되지 않음
- 저장된 문서를 불러와 수정할 때는 `vsManuallySet = true` 로 시작(불러온 값 보존)

### 6-2. UI

`Step2.tsx:81` 의 `form-section-title` 우측, `활성 n / 전체 n` 표기 옆에 2버튼 토글을 둔다.
props 로 `validationSystem` 과 `onValidationSystemChange` 를 받는다.

```
🔷 {JOB Li}  [?]              [ 대상 | 비대상 ]  활성 12 / 전체 15
```

- 라벨은 i18n 키 사용
- 자동 판정값과 현재 선택이 다르면 옆에 작은 안내(예: `자동 판정: 대상`)를 붙여 상신자가 인지하게 한다

### 6-3. 저장

- 상신(`submit`)·재상신(`resubmit`) 시 `detail.validation_system_submitted = detail.validation_system` 을 함께 기록
- 임시저장에는 `validation_system` 만 기록(`_submitted` 는 기록하지 않음)

## 7. MASK 팀 값 수정 — 새 엔드포인트 없음

`views.py:490` 에 이미 **"P/E 담당자 합의 요청 한 번으로 담당자 합의 + 검토자(PV/EV) 지정을 함께 처리"** 하는
선례가 있다. 같은 자리·같은 형태로 얹는다.

### 7-1. 백엔드 (`approve-step` 확장)

```
POST /api/documents/<id>/approve-step/
{ "agent": "E", "comment": "...", "reviewer_loginids": [...], "validation_system": "NO" }
```

- `validation_system` 은 **optional**. `agent == 'E'` 일 때만 수용하고, 그 외 agent 의 값은 무시한다.
- 값 검증: `'YES' | 'NO'` 외의 값은 400.
- 인가는 별도 체크를 추가하지 않는다 — 이미 통과한 `_can_act_on_step(request.user, step)` 이 곧 "이 사람이 E 단계를 처리할 수 있는가"이다.
- 반영: `additional_notes` JSON 을 파싱해 `detail.validation_system` 만 덮어쓰고 `save(update_fields=['additional_notes'])`.
  `validation_system_submitted` 는 **건드리지 않는다**.
- `_sync_post_approvers_detail()`(`views.py:1289`) 과 동일한 관대한 JSON 파싱 정책을 따른다(파싱 실패 시 조용히 건너뜀).
- 전체가 `@transaction.atomic` + `select_for_update()` 안에서 일어나므로 동시성 처리는 기존 그대로.

### 7-2. 프론트엔드

| 파일 | 변경 |
|---|---|
| `frontend/src/api/client.ts:236` | `approveStep(...)` 에 `validationSystem?: 'YES'\|'NO'` 인자 추가. `agent === 'E'` 일 때만 body 에 포함(기존 `reviewer_loginids` 와 같은 패턴) |
| `frontend/src/pages/ApprovalPage.tsx:903` | 합의 모달에서 `pendingAction.agent === 'E' && pendingAction.type === 'agree'` 일 때만 토글 노출. 기본값은 문서의 현재 `detail.validation_system` |
| `frontend/src/pages/ApprovalPage.tsx:523` | `approveStep` 호출에 인자 전달 |

MASK 가 "대상이 아니다"라고 판단하면 값을 고쳐 합의하면 된다. 반려는 다른 사유일 때 쓴다.

## 8. 상세보기 (`PagedDetailView.tsx`)

J-layer 탭의 표 **위**에 표시한다. 판정 근거(노란 `pp` 셀)와 결론이 한 화면에 보이게 하는 것이 목적이다.

표시 로직:

1. `detail.validation_system` 이 있으면 그 값
2. 없으면(레거시 문서) 저장된 `jayerRows` 로 `isValidationTarget()` 폴백 판정
3. `detail.validation_system_submitted` 가 있고 `validation_system` 과 **다르면** 병기:
   `상신 시 비대상 → 확정 대상`

재상신 변경이력은 기존 `computeDetailDiff(detail, prevSnap.detail)`(`PagedDetailView.tsx:619`)이
detail 필드를 자동으로 비교하므로 **추가 코드 없이** `validation_system` 변경이 강조된다.
구현 시 이 동작을 실제로 확인한다.

## 9. i18n (ko/en 동시 추가 — 규칙 G)

| 키 | ko (가명) | en (가명) |
|---|---|---|
| `request.validation_system` | Validation System | Validation System |
| `request.validation_system_target` | 대상 | Target |
| `request.validation_system_nontarget` | 비대상 | Non-target |
| `request.validation_system_auto` | 자동 판정: {{value}} | Auto: {{value}} |
| `approval.validation_system_confirm` | Validation System 확정 | Confirm Validation System |
| `request.validation_system_changed` | 상신 시 {{from}} → 확정 {{to}} | Submitted {{from}} → Confirmed {{to}} |

기존 `guide.*.note_e` / 결재 경로 `description` 수정도 ko/en 동시 반영.

## 10. 영향 받는 파일 전체 목록

**백엔드**
- `backend/api/models.py` — `has_ppid_plel()` 삭제
- `backend/api/views.py` — E 무조건 생성, `approve-step` 에 `validation_system` 수용, docstring
- `backend/api/mailer.py` — E/EV 제외 분기 2곳 삭제, docstring
- `backend/api/tests.py` — 기존 단언 수정 + 신규 테스트

**프론트엔드**
- `frontend/src/types/index.ts` — `DetailFormState` 에 `validation_system`, `validation_system_submitted`
- `frontend/src/pages/RequestPage/constants.ts` — 상수 4개
- `frontend/src/pages/RequestPage/helpers.ts` — 판정 함수 2개
- `frontend/src/pages/RequestPage/index.tsx` — state, 자동 갱신 effect, 저장 로직
- `frontend/src/pages/RequestPage/components/Step2.tsx` — 토글 UI + 하이라이트 상수화
- `frontend/src/pages/RequestPage/components/Step3.tsx` — 하이라이트 상수화
- `frontend/src/pages/ApprovalPage.tsx` — MASK 확정 토글
- `frontend/src/api/client.ts` — `approveStep` 인자
- `frontend/src/components/PagedDetailView.tsx` — 표시·폴백·병기, `hasPlel` 제거, 하이라이트 상수화
- `frontend/src/components/ApprovalRouteDiagram.tsx` — 조건 문구 제거
- `frontend/src/locales/ko.json`, `en.json` — 신규 키 + 기존 문구 수정

**문서**
- `docs/APPROVAL.md` — §2 Case E/G, 라인 92-93 (E 생성 조건)
- `docs/MAIL.md` — 라인 113, 160 (라우팅에서 E 조건)
- `docs/REQUEST.md` — detail 구조에 신규 키

## 11. 검증

### 11-1. 백엔드 테스트

`backend/api/tests.py` (1832줄) 에 기존 테스트가 있다. 이번 변경으로 **깨지는 테스트를 먼저 고친다**.

| 위치 | 현재 단언 | 조치 |
|---|---|---|
| `tests.py:596` | `assertNotIn('E', by_label, 'plel 이 아니면 E 는 경로에 넣지 않는다')` | 단언 반전 — 항상 경로에 있음 |
| `tests.py:623` | Only MAP 에서 `P/J/O/E` 제외 | **유지** (Only MAP 은 그대로) |
| `tests.py:812` | `_advance_to_parallel(plel=False/True)` 헬퍼 | 두 경우 모두 E 가 생기도록 기대값 조정 |

신규 테스트:
1. `plel` 없는 일반 문서도 R 합의 후 E step 이 생성된다
2. Only MAP 문서에는 여전히 E step 이 생기지 않는다
3. `approve-step` 에 `agent='E'` + `validation_system='NO'` 를 보내면 `detail.validation_system` 이 바뀌고 `validation_system_submitted` 는 안 바뀐다
4. `agent='O'` 로 `validation_system` 을 보내면 무시된다
5. 잘못된 값(`'MAYBE'`)은 400

실행: `docker exec -it <backend_container> python manage.py test` — **컨테이너명을 먼저 확인해야 한다(미확인)**.

### 11-2. 프론트엔드 테스트

테스트 파일이 없다(`npm test` → `No tests found`). 따라서 **수동 브라우저 시나리오가 검증의 핵심**(규칙 C-2-1).
구현 완료 시 역할별 시나리오를 별도로 제시한다:
- 상신자: 자동 판정 → 수동 변경 → J-layer 수정해도 자동 갱신 안 됨 → 상신
- MASK(TE_E): 결재 화면에서 값 확인·수정 후 합의
- 임의 결재자: 상세보기 J-layer 탭에서 값과 병기 표시 확인
- 레거시 문서: 키가 없는 기존 문서에서 폴백 판정이 뜨는지

## 12. 미결 사항

- **MASK 팀이 결재를 받은 뒤 어떤 규칙으로 작업하는지**는 이번 범위 밖. 별도 논의.
- **실제 사내 용어** 미확정 — 확정되면 `ko.json`/`en.json` 값만 교체한다(키 구조 변경 없음).
- **백엔드 테스트 컨테이너명** 미확인 — 구현 착수 시 확인 필요.

## 13. 리스크

| 리스크 | 완화 |
|---|---|
| E 무조건 생성으로 **MASK 팀 결재 물량이 늘어난다** | 의도된 변경. 다만 운영 영향이 크므로 배포 전 팀 공지가 필요하다 |
| 반려 메일 수신자에 MASK 팀이 항상 포함된다 (`mailer.py:344` 삭제 결과) | 결재선에 항상 있으므로 정합적. `docs/MAIL.md` §3.1 갱신 |
| 배포 시점 진행 중 문서와 신규 문서의 결재 경로가 다르다 | 소급 없음이 결정 사항. 일정 기간 뒤 자연 해소 |
| 마스킹 훅이 Bash 출력의 `plel` 을 다른 문자로 바꿔 보여준 사례가 있다 | 필드명·키워드는 **파일 원문을 Read 로 확인**한 뒤 코드에 반영한다 |
