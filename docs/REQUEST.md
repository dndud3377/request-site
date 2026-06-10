# REQUEST — 의뢰서 작성 페이지 (RequestPage)

의뢰서(RequestDocument) 신규 작성 / 반려 후 재상신을 담당하는 5단계 위저드 페이지.

- 라우트: `/request` (`frontend/src/App.tsx`)
- 진입 컴포넌트: `frontend/src/pages/RequestPage/` (default export)
- 관련 API: `documentsAPI`, `linesAPI`, `formOptionsAPI`, `uploadImageAPI`, `guidesAPI` (`src/api/client.ts`)

---

## 1. 파일 구조 (2026-06 리팩토링 후)

기존 단일 파일 `pages/RequestPage.tsx`(4,083줄)를 폴더로 전환하고, **동작에 영향이 없도록** 독립 단위 → 5개 Step 컴포넌트 순으로 분리했다. **모든 분리는 로직 복사 + props 주입만** 수행했으며 동작/문구 변경은 없다(검증: `tsc` 에러 총수 47개 불변).

```
pages/RequestPage/
├── index.tsx                       # 메인 컴포넌트 (현재 ~2,242줄) — 상태·핸들러·조립
├── constants.ts                    # 상수·팩토리·초기 상태 (외부 state 비의존)
└── components/
    ├── ProdcRow.tsx                # PRODC 북/중/남 공통 행 (REGION_LABEL_KEY 동봉)
    ├── MshotImageUpload.tsx        # M-shot 이미지 붙여넣기 영역 (자기완결)
    ├── WizardIndicator.tsx         # 상단 단계 인디케이터 (자기완결)
    ├── Step1.tsx                   # step 1 — 기본정보(라인/목적/흐름도/뼈찜entry/고객/생산일)
    ├── StepMap.tsx                 # step 2 — MAP(타입/원본/PRODC/REV/지도편차/예외/M-shot/맵옵션)
    ├── Step2.tsx                   # step 3 — J-layer 표
    ├── Step3.tsx                   # step 4 — O-layer 표 + TBV/TLV·partial_shot 정보 탭
    └── Step4.tsx                   # step 5 — Backbone(bb) 자동채움·매핑·결과 표
```

> ⚠️ **Step 파일명 ↔ step 번호 매핑 주의** (기존 `renderStepN` 명명을 그대로 보존):
> `step 1 → Step1` / `step 2 → StepMap` / `step 3 → Step2` / `step 4 → Step3` / `step 5 → Step4`.

> 폴더 진입점은 `index.tsx` 이므로 `import RequestPage from './pages/RequestPage'` 경로는 변경 없이 그대로 유효하다. (App.tsx 수정 불필요)

### Step 컴포넌트 분리 패턴 (중요 — 후속 작업 시 동일하게)
- state·setter·핸들러·파생값·내부 컴포넌트(`GuideBadge`)는 **모두 props 로 주입**. state 소유권은 index.tsx 에 그대로 둔다(클로저 동작 보존).
- `GuideBadge` 는 index.tsx 에 남아 있고 `React.FC<{ fk; tk }>` 타입의 prop 으로 각 Step 에 전달 → 배지 호출부(`<GuideBadge fk tk/>`)·클로저(`toggleSlidePanel`/`slidePanel`) 변경 0.
- `t`(useTranslation), `ST_CELL_COLOR`, `AutocompleteInput`, `FormSelect`, `ProdcRow`, `MshotImageUpload` 등 **import 가능한 것은 Step 파일에서 직접 import**.
- 파생 불리언(`isProdc`/`isMapRegistered`/`hasMapChange`/`hasEaChange`/`mshotDeleteMode`/`mshotEditAddMode`/`availableRevLayers`)은 동일값 보장을 위해 **props 로 전달**(Step 내부 재계산 금지).
- 검증: 매 분리 후 `tsc` 전체 error 가 47개로 유지되는지 확인. 신규 `TS2304/2305/2307/2552/6133` 발생 시 즉시 수정.

### `constants.ts` export 목록
- 옵션: `OPTION_REQUEST_PURPOSE`, `OPTION_LINE`, `OPTION_OTHER_PURPOSE`, `ST_CELL_COLOR`
- 공용 타입: `CRegion` (`'top' | 'middle' | 'bottom'`)
- 팩토리: `genId`, `makeRow`, `makeJayerRow`, `makeOayerRow`, `makeBbRow`
- 초기 상태: `INITIAL_DETAIL`, `INITIAL_FORM`, `DETAIL_REQUIRED`

> `ST_CELL_COLOR` 는 `components/PagedDetailView.tsx` 에도 **동일 정의가 중복** 존재한다(상세보기 전용). 추후 공통 모듈로 합치는 것을 고려할 수 있으나, 이번 범위 밖이라 그대로 둔다.

---

## 2. 메인 컴포넌트(index.tsx) 내부 구성

### 2.1 상태(state) 그룹
- **옵션 캐시**: `lineOptions`, `processOptions`, `productOptions`, `processIdOptions`, `top/middle/bottomProductOptions`, `Bb*Options`, `Flow*Options`
- **위저드**: `step`, `form`, `detail`, `errors`
- **J-layer**: `jayerRows`, `jayerChecked`, `jayerDragInfo`(ref), `jayerFilterSets`, `jayerActiveFilterIds`, `jayerFilterModalOpen`, `jayerNewFilter`, `jayerBarcodeCache`
- **O-layer**: `oayerRows`, `oayerChecked`, `oayerDragInfo`(ref), `oayerFilterSets`, `oayerActiveFilterIds`, `oayerFilterModalOpen`
- **뼈찜(Bb)**: `bbRows`, `bbExternalData`, `bbExternalLoading`, `activeBbTab`, `bbChecked`, `bbAutoFillRanges`, `showAutoFillPanel`, `isBbSorted`, `bbSearchQueries`, `stagedMappings`, `mappedJayerRowIds`, `selectedJayerRowId`
- **참조문서 병합**: `refDocId`, `refDocLabel`, `refJayerRows`, `refOayerRows`, `mergeConfirmOpen`, `mergeStats`
- **저장/상신**: `saving`, `submitting`, `confirmOpen`, `submitNote`, `savedId`, 각종 confirm 모달 상태

### 2.2 핸들러 그룹 (접두사별)
| 접두사 | 개수 | 비고 |
|--------|------|------|
| `handleJayer*` | 10 | J-layer 행 편집/체크/드래그/일괄처리 |
| `handleOayer*` | 10 | O-layer (J-layer와 대칭 구조) |
| `handleBb*` | 8 | 뼈찜 표 + 외부 데이터 매핑 |
| `handleFlow*` | 3 | Flow chart 행 |
| `handleMap*` / `handleMerge*` / `handleFilter*` / `handleProdc*` / `handleDetail*` / `handleApply*` | 각 2 | |
| 기타 (`handleSubmit`, `handleSave`, `handleReset`, `handleStage`, `handleSort`, `handleRange`, `handleRadio`, `handleImage`, `handleRef`, `handleNext`/`handlePrev` 등) | 1~2 | |

### 2.3 렌더 함수 → Step 컴포넌트 (✅ 분리 완료)
메인 `return` 은 `step` 값에 따라 §1의 Step 컴포넌트를 렌더한다. 기존 `renderStepN()` 인라인 렌더 함수는 모두 제거되고 `components/StepN.tsx` 로 분리됨.

| step | 컴포넌트 | 역할 |
|------|----------|------|
| 1 | `Step1` | 기본정보 + 목적/라인/제품 + Flow/Bb entry |
| 2 | `StepMap` | MAP 변경 단계 |
| 3 | `Step2` | J-layer 표 |
| 4 | `Step3` | O-layer 표 + TBV/TLV·partial_shot 정보 탭 |
| 5 | `Step4` | 뼈찜(Bb) 표 + 자동채움·매핑 |

---

## 3. 향후 리팩토링 계획 (남은 작업: 커스텀 훅 추출)

독립 단위 분리(1차) + 5개 Step 컴포넌트 분리(2차)가 완료되어 index.tsx 는 4,083 → 2,242줄로 줄었다. 더 줄이려면 **state에 강하게 결합된 핸들러**를 커스텀 훅으로 빼야 한다. 위험도가 가장 높으므로 아래 원칙을 따른다.

### 3.1 커스텀 훅으로 핸들러 추출 (도메인별) — 미완료
핸들러가 이미 `handleJayer*` / `handleOayer*` / `handleBb*` 접두사로 도메인 분리되어 있어 훅으로 떼어내기 좋다.

```
pages/RequestPage/hooks/
├── useJayer.ts     # jayerRows·jayerChecked·필터 state + handleJayer* 일괄
├── useOayer.ts     # useJayer와 대칭 (공통화 여지 검토)
├── useBbTable.ts   # bbRows·외부데이터·자동채움 + handleBb* / handleApply* / handleStage
└── useFlowChart.ts # flow_chart 행 핸들러
```

- 훅은 `{ state, setState, handlers }` 를 반환하여 index.tsx에서 구조분해로 사용.
- **주의**: Step 컴포넌트 분리(props 주입)와 달리, 훅 추출은 **state 소유권을 index.tsx → 훅으로 이동**시키므로 `tsc` 가 못 잡는 런타임 버그(stale closure, 렌더 타이밍) 위험이 있다. 여러 핸들러가 `detail`, `errors`, `setDetail`, 옵션 캐시 등 **컴포넌트 전역 state를 교차 참조**하므로, 훅 시그니처에 의존 state/setter를 명시적으로 주입(파라미터)해야 한다.
- J-layer / O-layer 는 거의 대칭이므로 `useLayerTable(kind: 'jayer' | 'oayer')` 형태의 단일 제네릭 훅으로 통합하는 것도 검토(단, 미묘한 차이가 있으니 diff 먼저 확인).

### 3.2 진행 원칙 (필수)
- 한 번에 한 도메인씩, **파일별 개별 커밋** (CLAUDE.md 규칙 E).
- 각 단계마다 검증: `npx tsc --noEmit` 의 전체 error 개수가 **베이스라인과 동일**한지 확인(현재 베이스라인 = 47개, 모두 기존 i18n strict 키 타이핑 / es5 target의 `Set` 순회 관련 pre-existing). 신규 `TS2304/2305/2307/2552`(미정의·import) 발생 시 즉시 수정.
- 동작 동일성이 핵심. 로직/문구 변경 금지(요청 시에만).

---

## 4. 알려진 pre-existing 이슈 (이번 리팩토링 무관)
- `tsc --noEmit` 기준 전체 47개 error 존재 — i18n `t()` 의 strict 키 타입 + `Set` 순회(es5 target). CRA(Babel) 빌드는 통과하므로 런타임 영향 없음.
- 하드코딩 한글 문자열 다수 잔존 (예: `MshotImageUpload` 의 "Ctrl+V 로 이미지를 붙여넣으세요", `Step2~Step4`/`StepMap` 의 "활성/전체", "STEP 정렬", "+ 행 추가", "선택 비활성화", "범위 추가", "특정 제품 삭제 필요" 등). CLAUDE.md 규칙 G(i18n) 위반이나, 분리 시 동작 보존 위해 원문 그대로 이동. 추후 `request.*` 키로 일괄 이관 필요.

---

## 5. 검증 방법
```bash
# 타입체크 (전체 error 47개 = 정상)
cd frontend && npx tsc --noEmit 2>&1 | grep -c "error TS"

# 테스트 (현재 테스트 파일 없음 → passWithNoTests)
cd frontend && CI=true npx react-scripts test --watchAll=false --passWithNoTests

# 개발 서버 확인 경로
http://localhost:10011  → /request
```
