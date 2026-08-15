# REQUEST — 의뢰서 작성 페이지 (RequestPage)

의뢰서(RequestDocument) 신규 작성 / 반려 후 재상신을 담당하는 5단계 위저드 페이지.

- 라우트: `/request` (`frontend/src/App.tsx`)
- 진입 컴포넌트: `frontend/src/pages/RequestPage/` (default export)
- 관련 API: `documentsAPI`, `linesAPI`, `formOptionsAPI`, `uploadImageAPI`, `guidesAPI` (`src/api/client.ts`)

---

## 1. 파일 구조 (2026-06 리팩토링 후)

기존 단일 파일 `pages/RequestPage.tsx`(4,083줄)를 폴더로 전환하고, **동작에 영향이 없도록** 독립 단위 → 5개 Step 컴포넌트 순으로 분리했다. **모든 분리는 로직 복사 + props 주입만** 수행했으며 동작/문구 변경은 없다(당시 검증: `tsc` 에러 총수 47개 불변 — 이 47은 **2026-06 당시 값**이고 현재 베이스라인은 §4 참조).

> 아래 줄수는 **2026-08-06 `wc -l` 실측값**이다. 리팩토링 직후(3차 종료 시점)와 달라진 이유는 §3 표의 '현황' 행 참조.

```
pages/RequestPage/
├── index.tsx                       # 4,548줄  메인 컴포넌트 — 상태·핸들러·effect·검증·저장/상신·조립
├── constants.ts                    #   343줄  상수·팩토리·초기 상태 (외부 state 비의존)
├── helpers.ts                      #   477줄  순수 헬퍼 (아래 'helpers.ts export 목록' 참조)
├── helpers.test.ts                 #   463줄  helpers.ts 단위 테스트 (63건)
└── components/
    ├── ProdcRow.tsx                #    90줄  PRODC 북/중/남 공통 행 (REGION_LABEL_KEY 동봉)
    ├── MshotImageUpload.tsx        #    51줄  M-shot 이미지 붙여넣기 영역 (자기완결)
    ├── WizardIndicator.tsx         #    33줄  상단 단계 인디케이터 (자기완결)
    ├── FilterManageModal.tsx       #   185줄  J/O 필터 관리 모달 (공유 — jayer↔oayer props 매개변수화)
    ├── BeforeAfterPanel.tsx        #   참조 요청서 BEFORE/AFTER 매핑 + 변경전/변경후 직접 입력 패널 (step 1 인라인)
    ├── AdiCdPanel.tsx              #   139줄  ADI CD 변경전/변경후 스텝 표 (step 1 인라인)
    ├── AdiCdColumnMapModal.tsx     #   128줄  ADI CD 붙여넣기 컬럼 매핑 모달
    ├── Step1.tsx                   #   538줄  step 1 — 기본정보(라인/목적/흐름도/뼈찜entry/고객/생산일)
    ├── StepMap.tsx                 #   695줄  step 2 — MAP(타입/원본/PRODC/REV/지도편차/예외/M-shot/맵옵션/삭제·수정 이유)
    ├── Step2.tsx                   #   298줄  step 3 — J-layer 표
    ├── Step3.tsx                   #   591줄  step 4 — O-layer 표 + TBV/TLV·partial_shot 정보 탭
    └── Step4.tsx                   #   539줄  step 5 — Backbone(bb) 자동채움·매핑·결과 표
```

> ⚠️ **Step 파일명 ↔ step 번호 매핑 주의** (기존 `renderStepN` 명명을 그대로 보존):
> `step 1 → Step1` / `step 2 → StepMap` / `step 3 → Step2` / `step 4 → Step3` / `step 5 → Step4`.

> 폴더 진입점은 `index.tsx` 이므로 `import RequestPage from './pages/RequestPage'` 경로는 변경 없이 그대로 유효하다. (App.tsx 수정 불필요)

### Step 컴포넌트 분리 패턴 (중요 — 후속 작업 시 동일하게)
- state·setter·핸들러·파생값·내부 컴포넌트(`GuideBadge`)는 **모두 props 로 주입**. state 소유권은 index.tsx 에 그대로 둔다(클로저 동작 보존).
- `GuideBadge` 는 index.tsx 에 남아 있고 `React.FC<{ fk; tk }>` 타입의 prop 으로 각 Step 에 전달 → 배지 호출부(`<GuideBadge fk tk/>`)·클로저(`toggleSlidePanel`/`slidePanel`) 변경 0.
- `t`(useTranslation), `ST_CELL_COLOR`, `AutocompleteInput`, `FormSelect`, `ProdcRow`, `MshotImageUpload` 등 **import 가능한 것은 Step 파일에서 직접 import**.
- 파생 불리언(`isProdc`/`isMapRegistered`/`hasMapChange`/`hasEaChange`/`mshotDeleteMode`/`mshotEditAddMode`/`availableRevLayers`)은 동일값 보장을 위해 **props 로 전달**(Step 내부 재계산 금지).
- 검증: 매 분리 후 `tsc` 전체 error 총수가 **작업 직전 실측값과 동일**한지 확인(§4 참조 — 2026-08-06 기준 24개). 신규 `TS2304/2305/2307/2552/6133` 발생 시 즉시 수정.

### `constants.ts` export 목록 (2026-08-06 실측)

| 분류 | export |
|---|---|
| 목적 옵션 | `OPTION_REQUEST_PURPOSE`, `OPTION_LINE`, `OPTION_OTHER_PURPOSE`, `ONLY_MAP_PURPOSE`, `MAP_DELETE_EDIT_PURPOSE`, `OTHER_PURPOSE_LAB` |
| Merge | `MERGE_ENABLED_PURPOSES`, `isMergePurposeSelected`, `MERGE_UNREGISTERED_ID`, `MERGE_MANUAL_FIELDS`, `MERGE_DEFAULT_TABLE` |
| ADI CD | `OTHER_PURPOSE_ADI_CD`, `ADI_CD_TEMPLATE_ROWS`, `ADI_CD_MAX_ROWS`, `ADI_CD_HEADER_SCAN_ROWS`, `ADI_CD_STEP_ID_LABEL`, `ADI_CD_STEP_DESC_LABEL` |
| MAP 삭제/수정 | `MAP_TYPE_EDIT_REQ`, `MAP_TYPE_DELETE_REQ`, `isMapDeleteEditType` |
| Validation System | `VALIDATION_KEYWORD`, `VS_TARGET`, `VS_NONTARGET`, `VS_NA`, `VALIDATION_CELL_COLOR` |
| 표 컬럼 | `JAYER_EDITABLE_COLS`, `OAYER_EDITABLE_COLS`, `LOADED_LOCK_COLS` |
| NOC/ST 값 | `NOC_NEW`, `NOC_BORROW`, `NOC_REGISTERED`, `NOC_LAYER_DELETE`, `ST_O`, `ST_X`, `isNocSpecial` |
| C가문 스코프 | `PRODC_SCOPE_OPTIONS`, `inferProdcScope` |
| 색상(재수출) | `ST_CELL_COLOR` |
| 공용 타입 | `CRegion` (`'top' \| 'middle' \| 'bottom'`), `ProdcScope` |
| 팩토리 | `genId`, `makeRow`, `makeBbEntry`, `makeJayerRow`, `makeOayerRow`, `makeBbRow`, `makeAdiCdStep` |
| 초기 상태 | `INITIAL_DETAIL`, `INITIAL_FORM`, `DETAIL_REQUIRED` |
| 가이드 투어 시드 | `makeTourDetail`, `makeTourJayerRows`, `makeTourOayerRows`, `makeTourBbRows`, `makeTourBbExternalData`, `TOUR_JAYER_LAYERS`, `TOUR_JAYER_PRODUCT`, `TOUR_JAYER_STEPS`, `TOUR_JAYER_ITEMS` |

> ✅ `ST_CELL_COLOR` 중복은 **해소됐다**. 현재는 공통 모듈 `src/utils/stCellColor.ts` 가 단일 정의이고,
> `constants.ts` 는 이를 **재수출**(`export { ST_CELL_COLOR } from '../../utils/stCellColor'`)할 뿐이다.
> `components/PagedDetailView.tsx` 도 공통 모듈에서 직접 import 한다.

### `helpers.ts` export 목록 (2026-08-06 실측 — 순수 함수/타입 24개)

| 분류 | export |
|---|---|
| 표 행 유틸 | `formatUpdatedDate`, `shouldDisableRow`, `calcDisabled`, `emptyDraftWords`, `sanitizeSignedDecimal`, `findNocBorrowViolations` |
| 3-way Merge | `MergeComparableRow`(타입), `MergeStats`(타입), `computeLayerMerge` |
| BEFORE/AFTER 비교 | `BaComparableRow`(타입), `toMergeRowInfo`, `BeforeAfterResult`(타입), `computeBeforeAfter` |
| 변경전/변경후 직접 입력 | `isMergeSideEmpty`, `normalizeMergeSide`, `deriveMergeKind`, `emptyMergeRowInfo`, `emptyMergePair`, `parseMergePasteRows`, `validateMergePairs` |
| Validation System | `isValidationKeywordRow`, `isValidationTarget`, `autoValidationSystem` |
| ADI CD 붙여넣기 | `parseClipboardTable`, `AdiCdHeaderMatch`(타입), `detectAdiCdHeader`, `AdiCdPasteDecision`(타입), `decideAdiCdPaste`, `buildAdiCdRows`, `AdiCdValidationResult`(타입), `validateAdiCdRows` |

---

## 2. 메인 컴포넌트(index.tsx) 내부 구성

### 2.1 상태(state) 그룹

> 규모(2026-08-06 실측): `useState` **112**개 · `useEffect` **25**개 · `handle*` 핸들러 **89**개.

- **옵션 캐시**: `lineOptions`, `processOptions`, `productOptions`, `processIdOptions`, `top/middle/bottomProductOptions`, `top/middle/bottomProcessOptions`, `Bb*Options`, `Flow*Options`, `sourcePartIdOptions`
- **위저드**: `step`, `form`, `detail`, `errors`
- **J-layer**: `jayerRows`, `jayerChecked`, `jayerDragInfo`(ref), `jayerFilterSets`, `jayerActiveFilterIds`, `jayerFilterModalOpen`, `jayerNewFilter`, `jayerBarcodeCache`, `jayerSortBySp`
- **O-layer**: `oayerRows`, `oayerChecked`, `oayerDragInfo`(ref), `oayerFilterSets`, `oayerActiveFilterIds`, `oayerFilterModalOpen`, `oayerNewFilter`, `oayerSortBySp`, `oayerInfoTab`
- **뼈찜(Bb)**: `bbRows`, `bbExternalData`, `bbExternalLoading`, `activeBbTab`, `bbChecked`, `bbAutoFillRanges`, `showAutoFillPanel`, `bbSearchQueries`, `stagedMappings`, `mappedJayerRowIds`, `selectedJayerRowId`, `bbExtCache`(ref), `bbExtPrevPid`(ref)
- **참조문서 병합**: `refDocId`, `refDocLabel`, `refJayerRows`, `refOayerRows`, `mergeConfirmOpen`, `mergePreview`, `mergeSnapshot`, `mergeReselectConfirm`, `mergeModeConfirm`
- **BEFORE/AFTER 비교**: `baSelBefore`, `baSelAfter`, `baSameCount`
- **ADI CD 변경**: `adiCdLeaveConfirm`, `adiCdMapModal`, `adiCdPendingApply`
- **C가문(PRODC)**: `prodcScopeConfirm`
- **REV**: `revLayersSelected`, `revGds`
- **TBV/TLV**: `tbvtlvSdsSelected`, `tbvtlvNoteRows`, `tbvtlvWarnModal`
- **Validation System**: `vsManuallySet` (상신자가 토글을 직접 눌렀는지 — 이후 자동 판정 갱신 중단)
- **지정 PL / 수신참조 / 주소록**: `designees`, `designeeSearchQuery`, `designeeDropdownOpen`, `designeeError`, `plUserOptions`, `postApprovers`, `postApprover*`, `notifierUserOptions`, `notifier*`, `addressBooks`, `abLoadOpen`, `abSaveOpen`, `abSaveMode`, `abSaveNewName`, `abConfirm`, `abLoadQuery`
- **가이드**: `featureGuideKeys`, `slidePanel` (`GuideBadge` 클릭 시 열리는 슬라이드 패널)
- **가이드 투어**(`?embed=tour`): `tourJCursor`, `tourJChip`, `tourJClicking`, `tourRef`, `snapStateRef`
- **저장/상신**: `saving`, `submitting`, `confirmOpen`, `submitNote`, `savedId`, `loadError`, `editDocStatus`, `productionDate`, `isPersistingRef`, `isLoadingEditRef`, `originalRequesterRef`, 각종 confirm 모달 상태(`deleteConfirm`, `mapTypeChangeConfirm`, `onlyMapConfirm`, `bbResetConfirm`, `specialCareConfirm`, `filterDeleteConfirm`, `filterAllDeleteConfirm`)

### 2.2 핸들러 그룹 (접두사별 — 2026-08-06 실측, 총 89개)
| 접두사 | 개수 | 비고 |
|--------|------|------|
| `handleJayer*` | 11 | J-layer 행 편집/붙여넣기/체크/드래그/일괄처리 |
| `handleOayer*` | 11 | O-layer (J-layer와 대칭 구조) |
| `handleBb*` | 8 | 뼈찜 표 + entry + 외부 데이터 매핑 |
| `handleAdiCd*` | 6 | ADI CD 셀 편집·행 추가/삭제·전체삭제 토글·붙여넣기·컬럼 매핑 |
| `handleFlow*` | 4 | Flow chart 행 |
| `handleMap*` / `handleMerge*` / `handleProdc*` / `handleBa*` | 각 3 | `handleBa*` = BEFORE/AFTER 선택·적용·해제 |
| `handleFilter*` / `handleDetail*` / `handleApply*` | 각 2 | |
| 기타 단일 핸들러 | 각 1 | `handleSubmitClick`, `handleSubmit`, `handleSaveDraft`, `handleIdleAutoSave`, `handleReset`, `handleNextStep`, `handlePrevStep`, `handleRequestPurposeSelect`, `handleSelectAdiCdPurpose`, `handleLeaveAdiCd`, `handleOnlyMapConfirm`, `handleOnlyProdcChange`, `handleRegionMapChangeChange`, `handleEaChangeChange`, `handleMshotChangeChange`, `handleRadioChange`, `handleImagePaste`, `handleRefDocSelect`, `handleStageMapping`, `handleClearStaging`, `handleSortBbRows`, `handleResetBbRows`, `handleOpenAutoFillPanel`, `handleAddRange`, `handleRemoveRange`, `handleRangeChange`, `handlePartidSelectionBlur`, `handleDragEnd` 등 |

### 2.3 렌더 함수 → Step 컴포넌트 (✅ 분리 완료)
메인 `return` 은 `step` 값에 따라 §1의 Step 컴포넌트를 렌더한다. 기존 `renderStepN()` 인라인 렌더 함수는 모두 제거되고 `components/StepN.tsx` 로 분리됨.

| step | 컴포넌트 | 역할 |
|------|----------|------|
| 1 | `Step1` | 기본정보 + 목적/라인/제품 + Flow/Bb entry |
| 2 | `StepMap` | MAP 변경 단계 |
| 3 | `Step2` | J-layer 표 |
| 4 | `Step3` | O-layer 표 + TBV/TLV·partial_shot 정보 탭 |
| 5 | `Step4` | 뼈찜(Bb) 표 + 자동채움·매핑 |

### 2.4 단계 이동 규칙 (`goToStep` — 2026-08-10 신설)

'다음'/'이전' 버튼과 **상단 인디케이터 탭 클릭**이 모두 `goToStep(target)` 하나를 거친다.

| 방향 | 규칙 |
|---|---|
| 뒤로 (`target < step`) | **검증 없이 즉시 이동.** 이미 통과해서 지나온 단계다. |
| 앞으로 (`target > step`) | `현재 step` ~ `target-1` 을 **순서대로 `validate()`**. 전부 통과해야 `target` 도달. |
| 전진 실패 | **처음 막힌 단계에 멈추고**(`setStep(s)`) 오류 토스트 + `scrollToFirstError(s)`. 단 `validate()` 가 `redirectStep` 을 돌려주면 그 단계로 보낸다(입력칸이 다른 단계에 있는 오류 — 현재는 `bb_entries` → STEP1). |
| 현재 단계 클릭 / 범위 밖 | 무동작. |

- **범위 밖의 상한은 고정 5가 아니라 `lastStep` 이다 (2026-08).**
  `Only MAP` / `MAP 삭제` 는 J-ayer·O-ayer·Backbone 을 작성하지 않으므로 `lastStep = 2`(MAP 정보)다.
  `goToStep` 이 `target > lastStep` 을 막으므로 **버튼·인디케이터 탭·키보드 모두 한 곳에서 차단**된다.
  - 하단 버튼: `step < lastStep` 이면 `다음 →`, 아니면 `📤 상신` → 2단계에서 바로 상신한다.
  - `handleSubmitClick` 은 `validate(5)` 가 아니라 **`validate(lastStep)`** 을 돌린다.
    5단계 검증은 J-ayer↔Backbone 매핑 검사라 이 경로에서는 돌면 안 된다.
  - 인디케이터는 `disabledSteps` 로 3·4·5 를 **흐리게(opacity .4) 남긴다** — 숨기지 않는 이유는
    전체 흐름 중 어디까지 작성하는지 보이고, 요청 목적을 되돌리면 그대로 살아나기 때문이다.
  - ⚠️ 잠긴 단계에는 **완료(✓) 표시를 하지 않는다.** 지나온 단계가 아니라 '거치지 않는' 단계다.

- **통과 여부를 캐시하지 않는다 [중요].** "한 번 통과했다"는 기록을 남기면, 뒤로 돌아가 필수값을
  지운 뒤에도 앞으로 나갈 수 있게 되어 검증이 무력화된다. 전진할 때마다 매번 새로 `validate()` 한다.
  이 때문에 인디케이터는 **회색 잠금 표시를 하지 않고 클릭 시점에 판정**한다
  (`validate()` 가 `setErrors` 부작용을 가져 렌더 중 호출이 불가능한 이유도 있다).
- **전진 시작점이 `1` 이 아니라 `현재 step` 인 이유**: 각 단계의 입력은 그 단계 화면에서만 편집할 수
  있으므로, 지나온 단계를 깨뜨리려면 반드시 그 단계로 되돌아가야 한다. 되돌아가면 `step` 이 낮아져
  다음 전진 때 그 단계부터 재검증된다.

#### 관문 모달 2개 (검증 통과 후 사용자 확인)

`step 1` 특이사항 미기재(`specialCareConfirm`) · `step 4` TBV/TLV 미입력(`tbvtlvWarnModal`).
탭으로 여러 단계를 건너뛸 때도 **그대로 통과해야 한다**(탭으로 우회 불가).

- `pendingStepTarget` (state): 모달이 뜬 시점의 **최종 목적지**. `'계속 진행'` 시 `step+1` 이 아니라
  이 목적지까지 이어서 이동한다. 없으면 여러 단계 점프 중 목적지가 유실된다.
- `ackedStepGatesRef` (ref): 이번 이동에서 **이미 확인한 관문**. 없으면 step1 관문 확인 →
  step4 관문 → `'계속 진행'` → step1 관문 재등장으로 **두 모달이 무한 반복**된다.
- ⚠️ 확인 기록을 비우는 곳은 **`startStepMove` 한 곳뿐이다.** 공용 `ConfirmModal` 은
  `onClick={() => { onConfirm(); onClose(); }}`(`components/Modal.tsx`)로 **onConfirm 직후 항상
  onClose 를 부르므로**, `onClose` 에서 비우면 방금 이어서 뜬 다음 관문의 기록까지 지워진다.
- `startStepMove` = 사용자가 새로 시작하는 이동(버튼·탭) / `resumePendingStep(gate)` = 모달 '계속 진행'.
- step 4 관문은 **관문이 있는 단계로 먼저 이동한 뒤** 모달을 띄운다 → 취소하면 그 단계(4)에 머물러
  바로 값을 채울 수 있다.

#### 인디케이터(`WizardIndicator`)

- optional prop `onStepClick?: (step: number) => void` · `stepTitle?: (label: string) => string`.
  **미지정 시 기존 표시 전용 동작 그대로**(클릭·키보드 비활성).
- 현재 단계는 클릭 대상에서 제외. 클릭 가능한 단계는 `.wizard-step.clickable`(커서·hover·focus 표시),
  `role="button"` + `tabIndex=0` + Enter/Space 키 지원.
- **투어 모드(`?embed=tour`)는 `onStepClick={undefined}`** — URL 이 단계를 지정하는 읽기 전용
  미리보기라 탭 이동을 막는다.
- `scrollToFirstError(atStep = step)`: 탭 점프 시 `setStep` 직후 호출되면 클로저의 `step` 이 아직
  갱신 전이라 신뢰할 수 없어 대상 단계를 인자로 받는다. 기본값이 `step` 이라 기존 호출부는 불변.

---

## 3. 리팩토링 진행 현황 & 향후 방향

| 단계 | 내용 | 상태 | index.tsx |
|------|------|------|-----------|
| 1차 | 독립 단위 분리(상수·팩토리·ProdcRow/Mshot/Wizard) | ✅ | 4,083 → 3,795 |
| 2차 | 5개 Step 컴포넌트 분리(renderStepN → StepN) | ✅ | 3,795 → 2,242 |
| 3차 | 순수 헬퍼(helpers.ts) + 공유 필터 모달(FilterManageModal) 분리 | ✅ | 2,242 → 2,028 |
| **현황** | **3차 종료 후 기능 추가분 누적** — 참조 요청서 Merge/BEFORE·AFTER 비교, ADI CD 변경, C가문 `prodc_scope` 게이트·ONLY 스코프, Validation System, 가이드 투어, MAP 삭제/수정·연구소 제품 등 | — | **2,028 → 4,548** (2026-08-06 실측) |

> ⚠️ 위 1~3차 수치는 **2026-06 리팩토링 당시의 기록**이다. 이후 신규 기능이 index.tsx 에 계속 쌓여
> 현재는 4,452줄로, 리팩토링 종료 시점(2,028줄)의 2배가 넘는다. §3.1 의 "2,028줄을 합리적 종료점으로
> 인정" 결론은 **그 시점의 판단**이며, 재분리 필요성은 현재 규모 기준으로 다시 판단해야 한다.

### 3.1 커스텀 훅으로 핸들러 추출 — ⛔ 검증 결과 비권장

원래 계획했던 `useJayer`/`useOayer`/`useBbTable` 분리를 **코드로 검증한 결과, 도메인이 분리 불가능**하여 진행하지 않기로 결정했다(2026-06). 근거:

- **Jayer ↔ Bb 교차 쓰기**: `handleJayerBulkDisable` 이 `setSelectedJayerRowId`·`setStagedMappings`(Bb 매핑 state)를 변경.
- **Bb ↔ Jayer 교차 읽기/쓰기**: `handleApplyMappings`·`buildAutoFillRows` 가 `jayerRows`·`detail.bb_entries`·`bbExternalData` 를 읽고 `setMappedJayerRowIds`(jayer 결합)를 씀.
- **effect 의 연쇄 동기화**(판단 당시 16개 → **2026-08-06 실측 25개**): 대부분 `detail.*` 에 키를 두고 옵션 캐시 + `setDetail` 연쇄 초기화 + jayer/oayer 행 채우기를 교차 수행. 전부 `eslint-disable react-hooks/exhaustive-deps` 로 **의존성 배열을 의도적으로 부분 지정**, 공유 `isLoadingEditRef` 가드 ref 사용.

→ 훅으로 옮기면 (1) 주입 의존성이 도메인당 15~30개로 폭증해 복잡도가 오히려 증가하고, (2) **state 소유권 이동이 클로저 캡처·effect 실행 타이밍을 바꿔 `tsc` 가 못 잡는 런타임 버그**(stale closure / effect 순서)를 유발할 수 있다. "기존 기능 무손상 최우선" 원칙과 충돌하므로 **당시 상태(2,028줄)를 합리적 종료점으로 인정**했다(2026-06 판단 — 현재 규모는 §3 표의 '현황' 행 참조).

> 굳이 추가로 줄여야 한다면: 남은 confirm/merge/submit 모달(8~28줄, 이미 공용 `ConfirmModal`/`Modal` 기반)을 컴포넌트화할 수 있으나 props 주입 오버헤드 대비 이득이 적다. 훅 추출이 정말 필요해지면 **도메인이 아니라 응집된 한 덩어리**(예: 옵션-fetch effect 묶음)부터, 광범위한 수동 회귀 테스트를 동반해 시도할 것.

### 3.2 분리 작업 진행 원칙 (필수 — 후속 작업 시에도 동일)
- 한 번에 한 단위씩, **파일별 개별 커밋** (CLAUDE.md 규칙 E).
- **state 소유권은 index.tsx 에 유지**, JSX·순수 함수만 이동(props 주입). 이것이 `tsc` 로 완전 검증 가능한 안전 패턴.
- 각 단계마다 검증: `npx tsc --noEmit` 의 전체 error 개수가 **작업 직전 실측값과 동일**한지 확인(고정 상수가 아니다 — 2026-06 당시 47개 → **2026-08-06 실측 24개**). 이 error 들은 모두 기존 i18n strict 키 타이핑 / es5 target `Set` 순회 관련 pre-existing 이므로, 파일만 이동했다면 총수가 불변인 것이 곧 신규 0 의 증명이다. 신규 `TS2304/2305/2307/2552/6133`(미정의·import·미사용) 발생 시 즉시 수정.
- 동작 동일성이 핵심. 로직/문구 변경 금지(요청 시에만).

---

## 4. 알려진 pre-existing 이슈 (이번 리팩토링 무관)
> 아래는 모두 **2026-08-06 재실측**으로 확인한 현재 상태다.

- `tsc --noEmit` 기준 전체 **24개** error 존재 — i18n `t()` 의 strict 키 타입 + `Set` 순회(es5 target).
  파일별 분포: `Step3.tsx` 6 · `Step2.tsx` 6 · `RequestPage/index.tsx` 4 · `Navbar.tsx` 3 · `VOCPage.tsx` 2 · `Step4.tsx` 1 · `GuidePage.tsx` 1 · `PagedDetailView.tsx` 1.
  **베이스라인은 고정 상수가 아니다** — 2026-06 문서에 적힌 47개는 옛 값이고, 후속 작업에서는 "작업 직전 실측값과 동일한지"로 판단할 것.
- ⚠️ `npx react-scripts build` 는 **현재도 실패한다**(종료코드 1). 원인은 그대로 `Navbar.tsx:227` 의 `t('profile.name')` — i18n strict 키 타입 TS2345.
  ```
  $ CI=true npx react-scripts build
  Failed to compile.
  TS2345: Argument of type '["profile.name"]' is not assignable to parameter of type ...
    > 227 |   <span className="dropdown-label">{t('profile.name') || '이름'}</span>
  ```
  이전 커밋에서도 동일하게 실패하는 pre-existing 이슈다. "CRA 빌드는 통과한다"는 과거 기술은 더 이상 사실이 아니다.
- 테스트는 통과한다: `npx react-scripts test --watchAll=false` → **2 suites / 67건 전부 통과**
  (`RequestPage/helpers.test.ts` 63건 + `locales/terminology.test.ts` 4건).
- 하드코딩 한글 문자열 다수 잔존 — CLAUDE.md 규칙 G(i18n) 위반이나, 분리 시 동작 보존 위해 원문 그대로 이동했다. 추후 `request.*` 키로 일괄 이관 필요. 현존 확인된 예:

  | 파일 | 문자열 |
  |---|---|
  | `MshotImageUpload.tsx` | "Ctrl+V 로 이미지를 붙여넣으세요" |
  | `Step2.tsx` / `Step3.tsx` | `활성 N / 전체 N`, "STEP 정렬", "+ 행 추가", "선택 비활성화" |
  | `Step4.tsx` | "+ 행 추가", "범위 추가" |
  | `StepMap.tsx` | "특정 제품 삭제 필요" |
  | `FilterManageModal.tsx` | "저장된 필터", "저장된 필터가 없습니다.", "새 필터 만들기", "필터 수정", "수정 적용", "+ 추가", "수정", "삭제", "전체 삭제", "닫기", "키워드 입력 후 Enter", "🔵 STEPSEQ / 🟢 STEP 설명 / 🟠 PPID" |

---

## 4.1 기능 변경 이력 (2026-06)

### 버그 수정 (2026-08-15 — 중단(PAUSE) 후 재개 시 수정 내용이 변경 이력에 남지 않음)

- **증상**: 결재 중단(pause) 상태에서 `/request` 편집으로 내용을 고친 뒤 재개(`resume`)하면, 결재
  상세보기('이력 확인')에서 뭐가 바뀌었는지 전혀 확인할 수 없었다. 재개는 회차(round)를 새로 만들지
  않아 다른 방법으로도 변경분을 알 수 없다.
- **원인**: `RequestPage/index.tsx`의 저장 핸들러가 `additional_notes.history[]`에 수정 전 스냅샷을
  쌓을지(`shouldAddHistory`) 결정할 때 반려 후 재상신(`isRejected`) 여부만 봤다. 중단 후 재개
  (`isPause`)는 이 조건에서 빠져 있어, PL 수정 후 상신(Case D)·재상신(Case I)과 달리 재개(Case M)만
  이력이 안 쌓였다.
- **수정**: `const enriched = buildEnrichedForm(submitNote, isRejected)` → `buildEnrichedForm(submitNote,
  isRejected || isPause)`(`RequestPage/index.tsx:4150`). 결재 진행 중 내용을 고쳐 다시 제출할 수 있는
  세 경로(PL 수정 후 상신 / 반려 재상신 / 중단 후 재개) 모두 이력을 남기도록 통일했다.
- **영향 파일**: `frontend/src/pages/RequestPage/index.tsx` (1개 파일, 조건식 1곳) · `docs/APPROVAL.md`
  §6(Case M)·§7 동기화.
- **검증(2026-08-15 실행)**: `npx tsc --noEmit` — 신규 에러 0(기존 tsconfig 옵션 경고 2건 + 기존
  i18n/`Set` 관련 에러 19건은 이번 변경 이전부터 있던 것으로 확인, 변경한 줄과 무관). `npm test
  --watchAll=false` — 8 suites / **201건 전부 통과**(신규 실패 없음). `bb_entries` id 백필 오탐 관련
  건(B-40)은 이번 수정과 무관한 별개 이슈로 `docs/E2E_TEST_AND_BUGS.md`에 재확인 기록만 남기고
  손대지 않았다.

### 버그 수정 (2026-08-15 — MAP 삭제 → 다른 요청 목적 전환 시 map_type·삭제 이유가 초기화되지 않음)

- **증상**: 요청 목적을 `MAP 삭제`로 선택(진입 시 `map_type`이 `삭제`로 자동 고정되고 삭제 이유를
  작성)한 뒤, 요청 목적을 `신규` 등 다른 값으로 바꾸면 **모달 없이 즉시 전환**됐고, StepMap
  화면은 여전히 `삭제`가 선택된 채 작성했던 이유도 그대로 남아있었다(요청 목적은 바뀌었는데
  MAP 정보 섹션만 `MAP 삭제` 화면 그대로 남는 버그).
- **원인**: `index.tsx` `handleRequestPurposeSelect`의 "Only MAP 스코프 이탈" 확인 조건이
  `isLabProduct || postApprovers.length > 0`만 검사했다. `MAP 삭제`에서 나갈 때는 이 두 값이
  항상 false/0이라 조건에 걸리지 않고 `handleDetailSet('request_purpose', val)`만 실행돼
  `map_type`·`map_change_reason`이 그대로 남았다(`applyLeaveMapOnlyScope`도 이 두 필드를
  다루지 않았다).
- **수정**:
  - `handleRequestPurposeSelect`: 이탈 확인 조건에 `isMapDeleteEdit`(현재 목적이 `MAP 삭제`)을
    추가 — `MAP 삭제`에서 나갈 때는 항상 확인 모달(`onlyMapConfirm`)을 띄운다.
  - `applyLeaveMapOnlyScope`: 이전 목적이 `MAP 삭제`였으면 `map_type`·`map_change_reason`을
    `INITIAL_DETAIL` 값으로 초기화(빈 값)한다.
  - 확인 모달 문구를 이탈 대상 목적이 아니라 **이탈 전 목적**(`detail.request_purpose`)으로
    분기 — `MAP 삭제`에서 나가는 경우 기존 "연구소 제품·후결자 해제" 문구 대신 새 문구
    (`map_delete_leave_confirm_title`/`_msg`)를 노출한다. `Only MAP`에서 나가는 기존 동작(연구소
    제품·후결자 해제 안내)은 변경 없음.
- **i18n**: `request.map_delete_leave_confirm_title`·`map_delete_leave_confirm_msg` 2키 ko/en 동시 추가.
- **영향 파일**: `frontend/src/pages/RequestPage/index.tsx`, `frontend/src/locales/{ko,en}.json`.
- **검증**: `npx tsc --noEmit` 22개(변경 없음, 신규 0) · `react-scripts test --watchAll=false` 8 suites
  / **201건 통과**.

### 기능 개선 (2026-08-13 — 흐름도 행: 위치/제품 이름/조리법/Step 중 하나라도 입력하면 나머지 전부 필수)

- **증상/요청**: 흐름도(`flow_chart`)에서 위치(라인)만 선택하고 제품 이름·조리법·Step(`step_from`/
  `step_to`)을 비워둔 채로도 상신이 가능했다. 한 행에 값을 넣기 시작했으면 그 행 전체를 채우도록
  검증을 요청받았다.
- **규칙**: 한 행의 위치·제품 이름·조리법·Step(`step_from`+`step_to`) 5개 필드 중 **하나라도**
  값이 있으면 **나머지 전부**를 채워야 STEP1 통과·상신이 가능하다(완전히 빈 신규 행은 검증 대상
  아님). Step 필드는 기존 "목록에 있는 값만 허용" 검증과 별개로 동작하며 서로 겹치지 않는다(전자는
  빈 값, 후자는 목록 밖 값을 검사).
- **구현**: `RequestPage/index.tsx`의 `validate(1)`에 `flow_chart` 각 행을 순회하는 검사를
  추가(`flow_step_${row.id}_${field}` 에러 키 재사용, 메시지 `request.flow_row_incomplete`).
  `Step1.tsx`에서 위치(`<select>`)·제품 이름·조리법 입력에도 기존 Step 입력과 동일하게
  `error`(빨간 테두리) 연결을 추가했다(기존엔 Step 입력에만 연결돼 있었다).
- **i18n**: `request.flow_row_incomplete` 키를 `ko.json`/`en.json`에 동시 추가.
- **영향 파일**: `frontend/src/pages/RequestPage/index.tsx`, `frontend/src/pages/RequestPage/components/Step1.tsx`,
  `frontend/src/locales/ko.json`, `frontend/src/locales/en.json`. 백엔드 변경 없음(프론트 전용 검증).
- **검증(2026-08-13 실행)**: `npx tsc --noEmit` — 신규 에러 0(기존 tsconfig 옵션 경고 2건만,
  무관). `react-scripts test --watchAll=false` — 6 suites / **184건 통과**(전부 기존 테스트,
  회귀 없음). 이번 변경에 대한 신규 자동 테스트는 추가하지 않았다.
- **수동 검증 시나리오** (원격 세션이라 브라우저 확인은 못 했다 — 아래가 검증의 핵심):
  1. [`/request` → 새 의뢰서 작성 → STEP1 → 흐름도 영역에서 "위치" 드롭다운만 선택하고 제품
     이름·조리법·Step은 비워둠] → 2. ["다음" 버튼 클릭] → 3. [기대 결과: 다음 단계로 넘어가지
     않고, 비워둔 제품 이름·조리법·Step 칸에 빨간 테두리가 표시되며 안내 메시지("흐름도 행은
     위치·제품 이름·조리법·Step을 모두 입력해야 합니다.")가 뜬다.]
  2. [같은 화면에서 위치는 비워두고 제품 이름만 입력 후 "다음" 클릭] → [기대 결과: 1과 동일하게
     위치·조리법·Step 칸에 빨간 테두리와 안내 메시지가 뜨며 진행이 막힌다.]
  3. [흐름도 행의 5개 칸(위치·제품 이름·조리법·Step 시작/끝)을 모두 채운 뒤 "다음" 클릭] →
     [기대 결과: 정상적으로 다음 단계로 진행된다.]
  4. [흐름도 행을 완전히 비워둔 채(기본 신규 행) "다음" 클릭] → [기대 결과: 흐름도 관련 에러
     없이 진행된다(다른 필수 항목은 별개로 채워야 함) — 이번 변경으로 새로 막히지 않아야 한다.]

### 기능 추가 (2026-08-14 — ADI CD 행 단위 '미등록' + Validation System 필수 선택)

두 변경 모두 **"사용자가 직접 고른 값만 저장된다"** 는 같은 원칙이라 함께 진행했다.

#### ① ADI CD 변경 — 행 단위 '미등록'

- **요청**: 변경전/변경후 표에서 "이 STEP 은 그쪽에 등록돼 있지 않다"를 표현할 방법이 없었다.
  한 칸만 채우면 불완전 행으로 막히고, 둘 다 비우면 아예 없는 행으로 취급됐다.
- **구현**: `AdiCdStep` 에 `unregistered?: boolean` 신설. 표에 미등록 체크박스 열을 추가해
  켜면 그 행의 `step_id`/`step_desc` 를 **비우고** 두 칸을 합쳐 '미등록'만 보여준다(입력 불가).
  체크를 풀면 빈 입력칸으로 돌아온다(이전 값 복원 없음).
  - 용례: 변경전 미등록 = 새로 생기는 STEP / 변경후 미등록 = 삭제되는 STEP.
  - `unregistered` 를 **optional 로 둔 이유**: 이 필드 도입 전 저장 문서에는 키가 없다(없으면 `false`).
    마이그레이션 없이 그대로 열린다.
- **검증 규칙**(`validateAdiCdRows`, `helpers.ts`): 미등록 행은 **유효 1건으로 집계**하고
  불완전·STEP_ID 중복 검사에서는 **제외**한다. 미등록이 아닌 행의 기존 규칙은 그대로다.
- **상세보기**(`PagedDetailView.tsx` `AdiCdStepsTable`): 빈 값 필터에 미등록 행이 걸려
  사라지던 것을 고쳐, 미등록 행도 '미등록'(회색)으로 표시한다.
- **i18n**: `request.adi_cd_unregistered` ko/en 동시 추가. CSS `.adi-cd-unreg-cell` 신설.

#### ② Validation System — 자동 선택 폐지, 상신자가 반드시 직접 선택

- **요청**: 판정 키워드(`plel`)가 있으면 `validation_system` 이 `'YES'`(대상)로 **자동 선택**돼
  있었다. 판정 주체는 상신자 하나이므로 자동 선택을 없애고, 고르지 않으면 O-layer 단계로
  넘어가지 못하게 한다. **시스템의 자동 판정값도 화면에 보여주지 않는다**(순수하게 사용자 판단).
- **구현**:
  - `ValidationSystemValue` 에 `''`(미선택) 추가, 상수 `VS_UNSELECTED` 신설(`constants.ts`).
    `INITIAL_DETAIL.validation_system` 도 `VS_NONTARGET` → `VS_UNSELECTED`.
  - 자동 갱신 effect(`index.tsx`): 키워드가 있으면 `auto`(=`VS_TARGET`) 를 넣던 것을
    **미선택으로 둔다.** 키워드가 전부 사라지면 종전대로 `VS_NA` 강제(E 단계 불일치 방지).
  - **게이트 2곳**: `validate(3)` 이 3→4단계 이동을 막고, `validate(5)` 최종 안전망에도 같은
    검사를 넣었다 — 상신 검증은 `validate(lastStep)` **하나만** 도는 구조라 STEP3 을 거치지
    않고 온 문서가 미선택으로 상신되는 구멍이 남기 때문이다(기존 안전망 패턴과 동일).
  - **레거시 백필**(`index.tsx`): VS 필드 도입 전 문서는 키워드가 없을 때만 `VS_NA` 로 백필하고,
    키워드가 있으면 **미선택**으로 둬 상신자가 다시 고르게 한다(예전엔 `'대상'` 자동 백필).
  - 이미 `YES`/`NO`/`NA` 가 저장된 문서는 그 값을 유지한다(로드 시 `setVsManuallySet(true)`).
- **자동 판정 표기 제거 + 연쇄 정리**(`Step2.tsx`):
  - `validation_system_auto` 문구("자동 판정: {{value}}") 렌더 제거 → **i18n 키도 ko/en 삭제**
    (사용처가 이 한 곳뿐이었다).
  - 그 문구에서만 쓰던 `vsLabel`(`useValidationSystemLabel`) 지역 변수·import 제거.
  - prop `autoValidationSystem: ValidationSystemValue` → **`vsNotApplicable: boolean`** 으로 좁힘.
    남는 용도가 `=== VS_NA` 판정 하나뿐이라, "판정값"이 아니라 "적용 대상인지"만 넘긴다.
  - ⚠️ `helpers.ts` 의 `autoValidationSystem()` **함수 자체는 남긴다** — '해당없음' 판정과
    레거시 백필에 여전히 쓰인다. 없어진 건 그 값을 **사용자에게 보여주던** 부분이다.
- **백엔드 변경 없음(확인함)**: E(MASK) 단계 생성은 `RequestDocument.has_ppid_plel()`
  (`models.py:225`)이 **jayerRows 의 pp 키워드로만** 판정하고 `validation_system` 값을 보지 않는다.
  미선택 상태가 결재 경로를 깨지 않는다. 마이그레이션도 없다(`additional_notes` JSON 하위).
- **i18n**: `request.validation_system_required` ko/en 추가(사내 용어 규칙에 따라
  `$t(request.validation_system)` 중첩 참조 사용 — `terminology.test.ts` 통과 확인).

#### 검증 (2026-08-14 실행)

| 항목 | 작업 전 | 작업 후 |
|---|---|---|
| `npx tsc --noEmit` | 22개 | **22개** (신규 0, `TS2304/2305/2307/2552/6133` 없음) |
| `react-scripts test` | 7 suites / 187건 | **8 suites / 201건 통과** |
| `eslint`(수정 파일) | 경고 6건 | **5건** (신규 0 — 미사용 1건이 오히려 줄었다) |

- 신규 테스트 `adiCdUnregisteredAndVs.test.tsx` **14건**. `validateAdiCdRows` 는 순수 함수라
  단위 테스트로, 화면 동작·저장 payload 는 실제 작성 흐름을 구동해 확인한다.
- **각 기능을 수정 전으로 되돌려 실제로 실패하는 것까지 확인**했다(가짜 통과 아님):
  - ADI CD: 미등록 예외 처리 제거 → 단위 테스트 3건 실패
  - VS 백필 경로: 자동 백필 복원 → 2건 실패
  - VS effect 경로: 자동 선택 복원 → `Expected: "" / Received: "YES"` 로 실패
- ⚠️ **검증 과정에서 발견해 보강한 것**: 편집 로드 경로는 `setVsManuallySet(true)` 때문에
  자동 갱신 effect 가 early-return 한다. 그래서 편집 로드 테스트만으로는 **effect 경로(신규 문서에서
  J-layer 를 API 로 불러오는 길 — 실사용 주 경로)가 전혀 커버되지 않았다.** 신규 문서 전용
  describe 를 따로 추가해 두 경로를 모두 고정했다.

#### 수동 검증 시나리오

**① ADI CD 미등록**
1. [`/request` 새 문서 → Step1 에서 라인·조합법·제품 이름·조리법 입력 → 요청 목적 '기타' →
   기타 목적 'ADI CD 변경' 클릭] → 2. [변경전 표 첫 행에 STEP_ID `1000`, STEP_DESC `ADI` 입력 후
   그 행의 '미등록' 체크] → 3. [기대 결과: 두 입력칸이 사라지고 회색 '미등록' 한 칸으로 바뀐다.
   입력했던 값은 지워진다.]
2. [체크를 다시 해제] → [기대 결과: 빈 입력칸 2개로 돌아온다(`1000`/`ADI` 는 복원되지 않는다).]
3. [변경전은 '미등록' 1행만, 변경후는 `1000`/`ADI` 1행을 채우고 '다음 →' 클릭] → [기대 결과:
   "변경전 표에 최소 1개 이상의 유효한 행이 필요합니다" 오류 **없이** 통과해야 한다.]
4. [임시저장 후 결재 현황/이력에서 그 문서 상세 → 'ADI CD 변경' 섹션] → [기대 결과: 변경전 표에
   '미등록' 행이 회색으로 보인다. 행이 통째로 사라지면 실패.]

**② Validation System**
1. [J-layer(3단계)에 PP 값이 `PLEL_...` 인 행이 있는 의뢰서를 작성 → 3단계 진입] → [기대 결과:
   상단 Validation System 토글의 **대상/비대상 어느 쪽도 색이 차 있지 않아야** 한다.
   '자동 판정: 대상' 같은 문구도 **보이면 안 된다**.]
2. [아무것도 고르지 않고 '다음 →' 클릭] → [기대 결과: "Validation System 대상/비대상을
   선택해주세요." 토스트가 뜨고 **3단계에 그대로 머문다**. 4단계(O-layer)로 넘어가면 실패.]
3. ['대상' 또는 '비대상' 클릭 후 '다음 →'] → [기대 결과: 고른 쪽이 색으로 채워지고 4단계로 넘어간다.]
4. [PP 에 `PLEL` 이 하나도 없는 의뢰서로 3단계 진입] → [기대 결과: 종전대로 토글이 잠기고
   '해당없음' 배지가 뜨며, 바로 '다음 →' 으로 넘어갈 수 있어야 한다.]
5. [미선택 상태에서 '임시저장(💾)' 클릭] → [기대 결과: 차단 없이 저장된다(초안이므로).
   다시 열면 여전히 미선택이어야 한다.]

### 리팩토링 (2026-08-14 — 잠기는 MAP 칸의 기본값을 `map_type` 이 정하도록 단일화)

- **배경**: 바로 아래 항목(CLONE/EXISTING 지도편차·예외구역 버그)을 "전환 지점마다 값을 강제로
  되돌리는" 방식으로 고쳤더니 `registered ? '변경 없음' : INITIAL_DETAIL...` 같은 조건문이
  **5군데에 흩어졌다.** 새 전환 경로가 생기면 또 빠뜨릴 구조라, 기본값 자체가 `map_type` 을 알도록
  바꿔 그 5군데를 함수 호출 한 줄씩으로 줄였다. **동작은 이전과 동일하다**(재현 테스트가 그대로 통과).
- **`constants.ts` 에 신설한 단일 출처**:

  | 이름 | 역할 |
  |---|---|
  | `MAP_TYPE_CLONE` / `MAP_TYPE_EXISTING` | `'CLONE'`/`'EXISTING'` 매직 스트링 제거(규칙 I) |
  | `isMapRegisteredType(mapType)` | 이미 등록된 MAP 을 쓰는 유형인가(= 입력칸이 전부 잠기는 유형) |
  | `MAP_NO_CHANGE` / `MAP_HAS_CHANGE` | 지도 편차 선택값 상수 |
  | `regionMapChangeDefault(mapType)` | 리전별 지도편차 기본값 — CLONE/EXISTING 이면 `'변경 없음'` |
  | `eaDefaultValue(onlyProdc, mapType)` | 예외구역 기본값 — CLONE/EXISTING 이면 `''`(인자 1개 추가) |

- **`INITIAL_DETAIL` 도 이 함수들에서 파생**시켰다(`map_change_top: regionMapChangeDefault()`,
  `ea_value: eaDefaultValue()`). `map_type` 이 비어 있는 초기 상태의 값이라 종전과 동일하다.
- **정리한 코드**:
  - `EA_DEFAULT_NORMAL`/`EA_DEFAULT_PRODC` 의 `export` 제거 — `map_type` 조건이 `eaDefaultValue`
    안에 있어야 하므로 바깥에서 raw 상수를 직접 읽으면 안 된다. 이제 모듈 안에서만 쓴다.
  - `index.tsx` 의 `isRegistered`/`registered` 지역 변수 5개와 그에 딸린 삼항 조건문 제거.
  - `map_type === 'CLONE'` 매직 스트링 2곳(`index.tsx` validate, `StepMap.tsx` 원본 위치 블록)을
    `MAP_TYPE_CLONE` 으로 교체.
- **화면 변화 1건**: 예외 구역 `변경 없음` 선택지 라벨이 CLONE/EXISTING 에서는 기본값 표기 없이
  `변경 없음` 으로만 보인다(NEW 는 종전대로 `변경 없음 (300)`). 기본값 자체가 없는 상태를 라벨이
  그대로 반영하게 한 것이다 — i18n 키는 기존 `map_no_change` 를 재사용해 신규 키 추가는 없다.
- **의도적으로 바꾸지 않은 것 — `requiresSalesAgreer`(`index.tsx`)**: 계획 단계에서는 여기에도
  `map_type` 을 넘기려 했으나, 확인해 보니 **백엔드 `RequestDocument.requires_sales_agreer`
  (`models.py:191`)는 `map_type` 과 무관하게 300/500 으로만 비교**한다. 여기서 CLONE/EXISTING 의
  빈 기본값(`''`)을 쓰면 오히려 앞뒤 기준이 어긋나므로 인자를 넘기지 않고 그대로 뒀다
  (CLONE/EXISTING 은 `ea_change` 가 항상 `'변경 없음'` 이라 첫 조건에서 걸러진다). 코드에 주석으로 남겼다.
- **영향 파일**: `frontend/src/pages/RequestPage/constants.ts` ·
  `frontend/src/pages/RequestPage/index.tsx` ·
  `frontend/src/pages/RequestPage/components/StepMap.tsx` ·
  `frontend/src/pages/RequestPage/cloneMapRegionDefault.test.tsx` (라벨 검증 1건 추가)
- **검증(2026-08-14 실행)**:

  | 항목 | 작업 전 | 작업 후 |
  |---|---|---|
  | `npx tsc --noEmit` | 22개 | **22개** (신규 0, `TS2304/2305/2307/2552/6133` 없음) |
  | `react-scripts test` | 7 suites / 186건 | **7 suites / 187건 통과** |
  | `eslint`(수정 파일) | index.tsx 경고 3건 | **동일 3건**(전부 pre-existing, 신규 0) |

  - **리팩토링 검증의 핵심**: 기존 재현 테스트 3건이 **코드를 고치지 않고 그대로 통과**하는 것이
    동작 불변의 증거다.
  - 신규 라벨 테스트도 분기를 임시로 되돌려 **실제로 실패하는 것까지 확인**했다
    (`Expected: "변경 없음" / Received: "변경 없음 (300)"`).
- **수동 검증 시나리오**:
  1. [`/request` 새 문서 → Step1 채우고 Step2 진입 → MAP 목적 `NEW` 선택] → [기대 결과: 예외 구역
     드롭다운이 `변경 없음 (300)`, 값 칸에 `300`. C가문 `Yes` 로 바꾸면 `변경 없음 (500)`/`500`.]
  2. [같은 화면에서 MAP 목적을 `CLONE` 으로 변경 → 확인 모달 '확인'] → [기대 결과: 예외 구역
     드롭다운이 `변경 없음`(괄호 없음), 값 칸은 **빈 채로 잠김**. 리전별 지도편차도 `변경 없음` 잠김.]
  3. [`EXISTING` 으로도 2번 반복] → [기대 결과: `CLONE` 과 동일.]
  4. [2번 상태에서 임시저장 → 목록에서 다시 편집으로 열기] → [기대 결과: 빈 값/`변경 없음` 이 그대로
     유지되어야 한다. `300`·`변경 있음` 이 되살아나면 실패.]

### 버그 수정 (2026-08-13 — CLONE/EXISTING 상신 시 리전별 지도편차·예외구역이 잠긴 채 '변경 있음'/300 으로 저장됨)

- **증상**: MAP 목적이 `CLONE`(차용)·`EXISTING`(기등록)이면 StepMap 에서 리전별 지도편차
  (`map_change_top`/`map_change_bottom`)·예외구역(`ea_value`) 입력칸이 전부 잠기는데도, C가문
  (`only_prodc`)을 `Yes`로 켜면 `map_change_top`/`map_change_bottom`이 `'변경 있음'`인 채로,
  `ea_value`가 300(또는 500) 기본값인 채로 상신됐다. 사용자는 잠긴 입력칸을 고칠 방법이 없는데도
  "값이 바뀌었다"는 상태가 그대로 저장되는 문제였다.
- **원인**: `map_change_top`/`map_change_bottom`의 전역 기본값(`INITIAL_DETAIL`, `constants.ts:265,268`)
  이 `'변경 있음'`으로 박혀 있고, `ea_value`도 C가문 여부에 따라 항상 300/500 기본값을 채우는데,
  CLONE/EXISTING으로 진입·전환되는 5개 지점(`handleMapTypeSelect` 최초 선택 / `handleMapTypeChangeConfirm`
  / `handleOnlyProdcChange` Yes·No 분기 / `line` 변경 감지 `useEffect`) 중 어디도 "잠긴 상태니까
  반드시 변경없음/빈 값"으로 강제하지 않았다. `validate()`도 `isMapRegistered`면 이 필드들 검증을
  통째로 건너뛰어(`index.tsx` 의 `!isMapRegistered` 가드), 잘못된 기본값이 그대로 상신됐다.
- **수정**: 위 5개 지점에서 대상 `map_type`이 `EXISTING`/`CLONE`이면(`registered`/`isRegistered` 판정)
  `map_change_top`/`map_change_bottom`을 `'변경 없음'`으로, X/Y 값을 빈 문자열로, `ea_value`를 빈
  문자열(`''`)로 설정하도록 고쳤다. 그 외(NEW 등)의 기존 기본값(`'변경 있음'`/300·500)은 그대로
  유지한다 — CLONE/EXISTING 전용 수정이다.
- **`ea_value`를 빈 값(`''`)으로 정한 근거**: `ea_change`(변경있음/없음 상태)는 원래도 항상
  `'변경 없음'`으로 정상 고정돼 있었다. 숫자 필드인 `ea_value`에 "변경없음"이라는 문자열을 그대로
  넣을 수는 없어, 사용자에게 확인한 결과 빈 값으로 저장하기로 했다(대안이었던 "기존처럼 300/500
  기본값 유지"는 채택하지 않음).
- **범위 밖**: 이미 저장된(기존) CLONE/EXISTING 문서의 DB 데이터는 이 수정으로 자동 고쳐지지
  않는다 — 소급 백필은 요청받지 않아 진행하지 않았다.
- **영향 파일**: `frontend/src/pages/RequestPage/index.tsx` (5개 함수/effect 수정 — 1개 파일)
- **검증(2026-08-13 실행)**: `npm ci` 후 `npx tsc --noEmit` **22개**(작업 전후 동일, 신규 0) ·
  `react-scripts test --watchAll=false` **7 suites / 186건 통과**(기존 184건 + 신규 재현
  테스트 2건). 신규 테스트(`cloneMapRegionDefault.test.tsx`)는 신규 문서에서 CLONE 선택 →
  C가문 Yes 전환(및 Yes→No→Yes 재전환) 흐름을 실제로 구동해 임시저장 payload 를 검증하며,
  수정 전 코드로 되돌려 실제로 실패하는 것까지 확인했다(가짜 통과 아님).
- **수동 검증 시나리오**:
  1. [요청서 작성(`/request`) 새 문서 → Step1 라인·조합법·제품·조리법·요청 목적(예: '차용')까지
     채우고 '다음' → Step2(MAP 정보)에서 MAP 목적 `CLONE` 선택] → 2. [Only C가문 제품을 `Yes`로
     전환] → 3. [기대 결과: 리전별 지도편차(상판/하판) select 가 `변경 없음`으로 잠겨 있고, 예외
     구역 값 입력칸이 빈 채로 잠겨 있어야 한다.] → 4. [임시저장 후 다시 편집으로 열어 같은 값이
     유지되는지 확인]
  2. [같은 문서에서 Only C가문 제품을 `No` → `Yes`로 다시 전환] → [기대 결과: 여전히 `변경 없음`/
     빈 값이어야 한다 — '있음'/300 으로 되돌아가면 실패.]
  3. [MAP 목적이 `NEW`(신규)인 문서에서 C가문 Yes 전환] → [기대 결과: 기존과 동일하게 리전별
     지도편차가 `'변경 있음'` 기본값으로 열려 사용자가 직접 입력할 수 있어야 한다 — 이번 수정으로
     영향 받지 않아야 한다.]

### 기능 개선 (2026-08-13 — 상세보기: CLONE/EXISTING 은 잠긴 MAP 항목을 회색 "없음"으로 표시)

- **요청**: MAP 목적이 `CLONE`(차용)·`EXISTING`(기등록)이면 StepMap 작성 화면에서 지도편차·예외구역·
  X표시 변경 여부·C가문 세부 정보(제품 해당 위치·상/중/하판) 입력칸이 전부 잠겨(`isMapRegistered`)
  사용자가 실제로 값을 넣을 수 없는데도, 상세보기(`PagedDetailView.tsx`)에서는 저장된 기본값을
  마치 실제 입력값처럼 그대로 보여줬다. Map Option·Inter 가 비활성일 때 쓰는 것과 같은 회색
  "없음" 표시로 통일했다.
- **제외(실값 유지)**: MAP 목적(`map_type`)·원본 위치(`source_line`)·원본 제품 이름(`source_partid`,
  CLONE 전용)·C가문 제품 여부(`only_prodc` Yes/No, `prodc_status`) — 이 4개는 `isMapRegistered`
  에서도 잠기지 않거나(C가문 Yes/No 는 여전히 사용자가 바꿀 수 있다) CLONE/EXISTING 을 식별하는
  값 자체이므로 그대로 표시한다. REV 여부도 StepMap 주석대로 CLONE/EXISTING 에서 잠그지 않는
  독립 항목이라 손대지 않았다.
- **회색 "없음" 처리 대상**: 지도 편차·예외 구역(`request.map`/`request.ea_change` 칩),
  X표시 변경 여부(`mshot_change`), C가문 세부 정보(`buildProdcInfo()` — 제품 해당 위치 +
  상/중/하판 라인·공정·제품). C가문 세부 정보는 `Only C가문 제품(Yes/No)` 옆 칸만 "없음"으로
  바뀌고, Yes/No 값 자체는 그대로 유지된다.
- **구현**: `PagedDetailView.tsx`에 `isMapRegisteredDetail`(= `map_type === 'EXISTING' || 'CLONE'`)
  파생값과, Map Option/Inter 와 동일한 회색 "없음" 스타일을 내는 `PlaceholderChip` 헬퍼를 추가했다.
  MAP 섹션에서 `isMapRegisteredDetail`일 때는 각 항목을 `PlaceholderChip`으로, 아닐 때는 기존
  로직(`buildMapValue`/`buildEaValue`/`buildProdcInfo`, 변경 이력 확인 버튼 포함)을 그대로 쓴다.
- **영향 파일**: `frontend/src/components/PagedDetailView.tsx` (1개 파일). 백엔드·i18n 키·작성
  화면(StepMap.tsx) 변경 없음 — 읽기 전용 상세보기 렌더링만 수정했다.
- **검증(2026-08-13 실행)**: `npm ci` 후 `npx tsc --noEmit` **22개**(작업 전후 동일, 신규 0 —
  `PagedDetailView.tsx` 관련 에러 없음) · `react-scripts test --watchAll=false` **6 suites /
  184건 통과**(전부 pre-existing, 이번 변경과 무관).
- **수동 검증 시나리오** (원격 세션이라 브라우저 확인은 못 했다 — 아래가 검증의 핵심):
  1. [승인 현황 또는 이력 페이지 → CLONE 또는 EXISTING 으로 등록된 의뢰서 행 클릭 → 상세보기의
     "MAP 정보" 탭 이동] → 2. [지도 편차 칩·예외 구역 칩을 확인] → 3. [기대 결과: 값 텍스트가
     아니라 회색 "없음"이 보여야 한다. 이력 확인(빨간 테두리) 버튼은 뜨지 않아야 한다.]
  2. [같은 화면에서 "X표시 변경 여부" 칸 확인] → [기대 결과: 회색 "없음".]
  3. [C가문 제품(`only_prodc`)이 `Yes`인 CLONE/EXISTING 문서를 열어 "Only C가문 제품" 칸 확인]
     → [기대 결과: 좌측 `Yes` 값은 그대로 보이고, 우측 세부 정보 칸만 회색 "없음"으로 보여야
     한다.]
  4. [MAP 목적이 `NEW`인 일반 의뢰서를 열어 같은 항목들 확인] → [기대 결과: 기존과 동일하게 실제
     입력값(지도편차·예외구역·X표시·C가문 세부 정보)이 그대로 보여야 한다 — 이번 변경으로 영향
     받지 않아야 한다.]

### 기능 개선 (2026-08-13 — 참조 요청서 '없음' 확정을 라디오 확인만으로 완료)

- **증상/요청**: 참조 요청서 `없음` 라디오를 선택해 확인 모달까지 통과해도 곧바로 확정되지 않고,
  `Merge` 버튼을 한 번 더 눌러야 "없음"으로 잠기고 변경전/변경후 표가 열렸다. 별도 버튼 클릭이
  불필요하다는 사용자 지적에 따라 라디오 확인만으로 바로 확정되도록 바꿨다.
- **수정**: `handleMergeModeConfirm`(`index.tsx`)에서 `clearMergeComparison(mode)` 직후
  `mode === 'none'`이면 `merge_applied: true` + `merge_pairs`가 비어 있으면 `[emptyMergePair()]`을
  함께 세팅해 즉시 확정한다. `isMergeDone`(`Step1.tsx`)이 `merge_applied` 로 판정되므로 이 시점부터
  바로 참조 입력칸·`Merge` 버튼이 잠기고 `BeforeAfterPanel`의 변경전/변경후 표(빈 행 1개)가 열린다.
  `있음(ref)` 전환은 문서 선택 후 `Merge` 클릭이 여전히 필요하다(3-way 반영 대상이 있으므로 미변경).
- **`handleMergeClick`의 기존 `mode==='none'` 분기는 그대로 남겨뒀다** — 이번 수정 이전에 라디오만
  "없음"으로 선택한 채(즉 `merge_applied: false`) 임시저장된 문서를 다시 열었을 때, `Merge` 버튼이
  여전히 눌려 있어 그 경로로 확정할 수 있는 유일한 복구 수단이기 때문이다. 이번 변경 이후로 정상
  흐름에서는 이 분기가 다시 실행되지 않는다(라디오 확인 시점에 이미 확정되므로).
- **영향 파일**: `frontend/src/pages/RequestPage/index.tsx` (1개 파일, 함수 1곳)
- **검증(2026-08-13 실행)**: `npx tsc --noEmit` 22개(작업 전후 동일, 신규 0) ·
  `react-scripts test --watchAll=false` 5 suites / **174건 통과**.

### 추가 변경 이력 (2026-08-15 — 스텝 단위 하이라이트 가이드 투어 (기존 "영상 가이드" 배지 대체))

- **개요**: 필드마다 흩어져 있던 "영상 가이드" 배지(9개 애니메이션 데모)와 "가이드"(글) 배지를
  **위저드 스텝 제목 옆 배지 1개(총 5개)** 로 통합했다. 클릭하면 슬라이드 패널 대신, **지금 보고
  있는 실제 화면 위에** 스포트라이트+캡션을 그리고 "이전/다음" 버튼으로 수동으로 넘겨보는 방식이다
  (자동재생 없음). 홈 화면의 "전체 가이드"(iframe+모달, `GuideTourModal`)와는 별개 기능 — 그대로 유지.
- **그룹 구성(총 23개, 스텝당 2~7개)** — 이전에 텍스트 배지로 개별 노출되던 필드 설명까지 전부
  이 투어 그룹으로 흡수했다:
  - Step1 의뢰 상세(7): 라인·조합법·제품이름·조리법 / 요청 목적 / 참조요청서 Merge / ADI CD 변경 /
    흐름도 / 뼈찜 조합 영역 / 고객·업체명
  - Step2 MAP(6): MAP 유형 / 원본 위치(CLONE) / REV 여부 / Only C가문 Yes-No / C가문 하위 영역 /
    나머지 옵션 통합(지도편차·예외구역·X표시·Inter·MAP옵션)
  - Step3 J-ayer(3): 표 자동채움 / 체크→비활성화·복원 / +필터 버튼
  - Step4 O-ayer(4): 표(탭+자동채움) / 체크→비활성화·복원 / Partial Shot / TBV·TLV
  - Step5 뼈찜(BB)(3): 자동채움 버튼 / 매핑 패널+적용 / bb 정보(적용 결과) 표
- **조건부로만 나타나는 요소 처리** (`pages/RequestPage/useStepGuideTour.ts`): 참조요청서 Merge·
  ADI CD 변경·CLONE 원본위치·C가문 하위 영역처럼 실제 업무 데이터(`other_purpose`/`map_type`/
  `only_prodc`)에 따라서만 렌더되는 요소는, 투어가 **열릴 때 `detail`(+`jayerChecked`/`oayerChecked`/
  `oayerInfoTab`/`showAutoFillPanel`) 상태를 스냅샷**해두고, 그룹에 진입할 때 필요한 값만 최소한으로
  임시 반영해 실제로 화면에 나타나게 한다. 그룹을 벗어나거나(이전/다음) 투어를 닫을 때는 항상
  스냅샷으로 복원한 뒤 다음 그룹의 패치를 적용해, 되감기·연속 조건부 그룹 사이에서도 상태가 누적되지
  않는다. 사용자가 실제로 작성 중이던 값은 투어가 끝나면 정확히 그대로 남는다.
- **신규 컴포넌트** `components/StepGuideTour.tsx` — iframe 없는 순수 오버레이 엔진. 그룹의
  `selectors`(배열)를 모두 찾아 **합집합 사각형**으로 스포트라이트를 그린다(예: MAP의 "나머지 옵션
  통합" 그룹은 5개 블록을 한 번에 감싼다). 스크롤·리사이즈 시 재측정, Esc·포커스 트랩, 스텝
  인디케이터(`n / 총계`) 포함. 자동재생 타이머 없음 — "다음"을 눌러야만 진행된다.
- **신규 훅** `pages/RequestPage/useStepGuideTour.ts` — 스텝별 23개 그룹 정의(선택자·i18n 캡션·
  조건부 그룹의 `onEnter`)와 스냅샷/복원 상태를 관리.
- **배지 이동**: `GuideBadge`(필드별 영상·글 배지 렌더 헬퍼)와 그 기반이던 `slidePanel` 상태·
  `toggleSlidePanel`·`<GuideSlidePanel>` 렌더·`featureGuideKeys`(글 가이드 존재 여부 조회)를
  `RequestPage/index.tsx`에서 전부 제거했다(요청서 작성 페이지의 모든 필드 배지가 새 투어로
  흡수되어 완전히 미사용 상태가 됐기 때문). **주의**: `components/GuideSlidePanel.tsx`와
  `components/guideDemos/*` 자체는 삭제하지 않았다 — `PermissionPage.tsx`가 `GuideSlidePanel`을
  여전히 쓰고, `guideDemos/*` 9개 컴포넌트는 코드는 남아있으나 더 이상 어디서도 import되지 않는다
  (삭제 여부는 별도 확인 필요, 이번 범위 아님).
- **`data-tour` 신규 부여** — 조건부/미표시 영역을 그룹 대상으로 삼기 위해 추가:
  `bb-entry`·`customer-vendor`(Step1), `map-source-location`·`map-rev`·`map-cfamily-toggle`·
  `map-cfamily-detail`·`map-inter`·`map-options`(StepMap, `map-deviation`은 C가문 분기에도 추가),
  `jayer-table`·`jayer-bulk-actions`(Step2/J-ayer), `oayer-table`·`oayer-bulk-actions`·
  `oayer-partial-shot`(Step3/O-ayer), `bb-autofill-panel`·`bb-mapping-panel`·`bb-table`(Step4/BB).
- **i18n**: `guide.tour.step.done`("닫기") + `guide.tour.step.groups.s{1~5}g{1~7}.{title|desc}`
  (23그룹 × 2 = 46키) ko/en 동시 추가. 기존 `guide.tour.next`/`prev`/`guide.video_btn`은 재사용.
- **영향 파일**: 신규 `components/StepGuideTour.tsx`, `pages/RequestPage/useStepGuideTour.ts` /
  수정 `pages/RequestPage/index.tsx`, `components/Step1.tsx`·`StepMap.tsx`·`Step2.tsx`·`Step3.tsx`·
  `Step4.tsx`, `styles/global.css`(`.step-guide-tour-*`), `locales/ko.json`·`en.json` /
  변경 없음(미사용 방치) `components/GuideSlidePanel.tsx`(PermissionPage 용으로 계속 사용),
  `components/guideDemos/*`
- **검증(2026-08-15 실행, 원격 세션·Docker 없이)**:

  | 항목 | 작업 전 | 작업 후 |
  |---|---|---|
  | `npx tsc --noEmit` | 22개 | **22개** (신규 0, 전부 기존 항목과 동일) |
  | `react-scripts test` | 8 suites / 201건 | **8 suites / 201건 통과** |

  ⚠️ 결재 흐름을 건드리지 않아 `scripts/approval_cases` 러너는 대상 아님. 실제 화면 수동 검증은
  아직 못했다 — 아래 "수동 검증 시나리오" 참고.

### 추가 변경 이력 (2026-08-13 — 기능 가이드 항목 3개 추가 + 영상·글 가이드 동시 노출)

- **개요**: `/guide` 기능별 가이드 지식베이스(`GUIDE_STEP_FEATURES`)에 아직 배지가 없던 위저드
  기능 3개에 가이드 배지를 신설했고, 빌트인 영상 데모와 사용자가 작성한 글 가이드가 같은
  `feature_key`에 함께 있을 때 하나만 보이던 것을 **둘 다(영상 → 글 순서로)** 보이도록 고쳤다.
- **신규 `feature_key` 3개** (`types/index.ts` `GuideFeatureKey`/`GUIDE_STEP_FEATURES`):
  - `step1_ref_doc_merge` — 참조 요청서 Merge(`showMergeBlock` 블록: 참조 있음/없음, Merge,
    BEFORE/AFTER 표). 배지를 블록 상단 소제목에 두어 **조건부 렌더를 그대로 물려받아 해당 목적을
    선택했을 때만** 노출된다.
  - `step1_adi_cd_change` — ADI CD 변경(`isAdiCdSelected` 블록: `AdiCdPanel` 변경전/변경후 스텝 표).
    동일하게 블록 상단 소제목에 배지를 붙여 조건부 노출.
  - `step2_inter` — MAP 단계 Inter 섹션(IN 적용 O/X + Xs/Ys/XYs/없음). 기존 `map_opt_inter` 라벨에
    배지를 붙였다(이 필드 자체는 상시 노출이라 다른 배지들과 동일한 방식).
- **영상+글 가이드 동시 노출** (`components/GuideSlidePanel.tsx`): 이전엔 `GUIDE_DEMOS[featureKey]`가
  있으면 글 가이드 API 조회 자체를 건너뛰어 데모만 보였다. 데모 유무와 무관하게 항상
  `guidesAPI.list({feature_key})`를 조회하도록 바꾸고, 렌더 순서를 **데모 컴포넌트 → (구분선) →
  글 가이드**로 고정했다. 데모·글 둘 다 없을 때만 기존 "내용 없음" 빈 상태를 보여준다(데모만 있고
  글이 없을 땐 빈 상태 문구를 생략해 불필요한 노출을 막는다).
- **i18n**: `guide.feat.step1_ref_doc_merge` / `step1_adi_cd_change` / `step2_inter` ko/en 동시 추가.
- **영향 파일**: `types/index.ts`, `locales/ko.json`·`en.json`,
  `pages/RequestPage/components/Step1.tsx`·`StepMap.tsx`, `components/GuideSlidePanel.tsx`
- **검증(2026-08-13 실행)**:

  | 항목 | 작업 전 | 작업 후 |
  |---|---|---|
  | `npx tsc --noEmit` | 22개 | **22개** (신규 0, 전부 기존 항목과 동일) |
  | `react-scripts test` | 5 suites / 174건 | **5 suites / 174건 통과** |

  ⚠️ 원격 세션이라 Docker 없이 실행했고, 백엔드 변경이 없어 백엔드 테스트는 별도로 돌리지 않았다.

### 버그 수정 (2026-08-13 — CLONE/EXISTING + C가문 Yes 전환 시 X표시 변경 여부가 '수정'으로 잘못 상신됨)

- **증상**: MAP 목적이 `EXISTING`(기등록) 또는 `CLONE`(차용)일 때 C가문(`only_prodc`)을 `Yes`로
  전환하면, 실제로는 아무 값도 입력하지 않았는데도(입력칸이 전부 잠겨 있어 입력 자체가 불가능)
  X표시 변경 여부(`mshot_change`)가 `'수정'`으로 바뀐 채 그대로 상신됐다.
- **원인**: `handleOnlyProdcChange`(`index.tsx`)가 C가문 `Yes` 전환 시 `map_type`과 무관하게
  무조건 `mshot_change: '수정'`을 자동 설정하고 있었다. `EXISTING`/`CLONE`(`isMapRegistered`)은
  MAP 관련 입력칸이 전부 잠겨 사용자가 실제로 값을 바꿀 수 없는데도 이 자동 설정만은 걸렸다.
- **수정**: `setDetail` 콜백 안에서 `prev.map_type === 'EXISTING' || prev.map_type === 'CLONE'`
  여부를 판정해, 이 경우에는 `mshot_change`를 건드리지 않고 기존 값을 그대로 둔다(초기값은
  `INITIAL_DETAIL.mshot_change === '없음'`). `NEW`(신규)일 때는 기존과 동일하게 `'수정'` 자동
  설정을 유지한다 — `NEW`는 입력칸이 잠기지 않아 실제로 X표시 변경이 필요한 경우가 많기 때문이다.
- **범위 밖(의도적으로 유지)**: `ea_value`(예외 구역 값)의 C가문 기본값 연동(300→500)은 실제
  계산된 기본값을 보여주는 용도라 이번 수정과 무관하게 그대로 둔다.
- **영향 파일**: `frontend/src/pages/RequestPage/index.tsx` (`handleOnlyProdcChange`, 1개 파일)
- **검증(2026-08-13 실행)**: `npx tsc --noEmit` 22개(작업 전후 동일, 신규 0) ·
  `react-scripts test --watchAll=false` 5 suites / **174건 통과**.

### 버그 수정 (2026-08-13 — J-ayer/O-ayer 기본값을 빈 행 1개 → 빈 배열로 통일)

- **배경**: §바로 위 항목(이력 바로 등록 실패)에서 `applyMapOnlyScope` 하나만 고쳤는데, 같은 "빈 행 1개"
  패턴이 다른 두 곳에도 남아 있어 추가로 정리했다.
- **수정 1 — 컴포넌트 마운트 기본값**(`index.tsx` `jayerRows`/`oayerRows` 최초 `useState`):
  `[makeJayerRow()]`/`[makeOayerRow()]`(빈 행 1개) → `[]`. 신규 문서를 열면 이제 두 표 모두 빈 배열로
  시작한다(투어 모드는 영향 없음 — `makeTourJayerRows()`/`makeTourOayerRows()` 그대로).
- **수정 2 — `process_id`(조리법) 변경 감지 effect의 Only MAP·MAP 삭제 분기**: 여기도
  `[makeJayerRow()]`/`[makeOayerRow()]`로 남아 있던 것을 `[]`로 통일했다. 처음엔
  `detail.request_purpose === ONLY_MAP_PURPOSE` 만 검사해 **MAP 삭제**가 빠져 있었다 — MAP 삭제
  선택 중 조리법을 바꾸면 이 우회를 타지 않고 `fetchJobFileLayerAndPopulateJayer`/
  `fetchOvlLayerAndPopulateOayer` 가 실제로 실행됐다(불필요한 API 호출 + 화면에 보이지 않는 사이
  jayerRows/oayerRows 가 실제 데이터로 잠시 채워짐 — 저장 시점엔 `buildEnrichedForm` 의
  `isMapOnlyScope ? [] : ...` 가 있어 저장값 자체는 항상 안전했다). 조건을 `MAP_DELETE_EDIT_PURPOSE`
  까지 포함하도록 넓혀 **Only MAP·MAP 삭제 둘 다** 재조회 자체가 일어나지 않게 고쳤다.
- **수정 3 — `fetchJobFileLayerAndPopulateJayer`/`fetchOvlLayerAndPopulateOayer`**: API가 빈 결과를
  반환했을 때(`length === 0`) 토스트만 띄우고 표를 그대로 두던 것을, `setJayerRows([])`/
  `setOayerRows([])`를 함께 호출하도록 고쳤다. 이전에는 데이터가 있던 조리법에서 데이터가 없는
  조리법으로 바꾸면 **이전 조리법의 행이 화면에 그대로 남아 있었다**(오조회로 오인하기 쉬운 상태).
  API 예외(네트워크 오류 등)는 기존대로 표를 건드리지 않는다(사용자 입력을 실수로 지우지 않기 위한
  의도적 동작 — 아래 테스트 Case H).
- **검증 방법**: 신규 문서 작성 흐름(라인 → 조합법 → 제품 → 조리법 선택)을 실제로 구동하는 테스트
  `RequestPage/jayerOayerDefault.test.tsx` 신설(10 케이스) — 초기 빈 배열, 데이터 있음/없음 조리법
  선택, 데이터 있음→없음/없음→있음 전환, 서로 다른 데이터 간 전환, API 예외, Only MAP·MAP 삭제 중
  조리법 변경.
- **영향 파일**: `frontend/src/pages/RequestPage/index.tsx` (3곳),
  `frontend/src/pages/RequestPage/jayerOayerDefault.test.tsx`(신규)
- **검증(2026-08-13 실행)**: `npx tsc --noEmit` 22개(변경 없음) · `react-scripts test --watchAll=false`
  6 suites / **184건 통과**(기존 174 + 신규 10).

### 버그 수정 (2026-08-13 — Only MAP/MAP 삭제: J-ayer·O-ayer 빈 행 1개로 인한 이력 바로 등록 실패)

- **증상**: MASTER 가 `Only MAP` 또는 `MAP 삭제` 목적을 선택한 뒤(J/O-ayer·Backbone 표를 만지지 않고)
  바로 `📋 이력에 바로 등록`(§4.5, `docs/HISTORY.md`)을 누르면 등록이 되지 않았다.
- **원인**: `applyMapOnlyScope`(`index.tsx`, 목적을 Only MAP/MAP 삭제 로 바꿀 때 실행)가
  `bbRows` 는 `[]`(완전히 빔)로 초기화하면서, `jayerRows`/`oayerRows` 는 실수로
  `[makeJayerRow()]`/`[makeOayerRow()]`(빈 행 **1개**)로 초기화하고 있었다.
  이 빈 행은 `disabled: false`(활성 행)라서, `이력에 바로 등록`이 실행하는 5단계 전체 검증
  (`validate(5)` — st/new_or_copy 필수 체크 등)에 걸려 등록이 막혔다.
  - `상신하기`(`handleSubmitClick`)는 `validate(lastStep)`을 써서 Only MAP/MAP 삭제일 때
    `lastStep=2`라 이 검증 자체를 타지 않으므로 증상이 드러나지 않았다(저장 시점에는
    `jayerRows: isMapOnlyScope ? [] : ...` 로 어차피 빈 배열로 버려졌기 때문에 결과물은 같았다).
  - `이력에 바로 등록`(`handleDirectHistoryClick`)은 `validate(5)`를 고정 호출해서 문제가 드러났다.
- **수정**: `applyMapOnlyScope`의 `setJayerRows([makeJayerRow()])` / `setOayerRows([makeOayerRow()])`를
  `bbRows`와 동일하게 `setJayerRows([])` / `setOayerRows([])`로 변경.
- **부작용**: Only MAP/MAP 삭제에서 다른 목적으로 되돌아갈 때(`applyLeaveMapOnlyScope`)는
  `bbRows`와 마찬가지로 J/O-ayer 도 자동으로 빈 행이 다시 채워지지 않는다 — 표에서
  `+ 행 추가`를 눌러야 한다(기존 `bbRows` 동작과 동일한 대칭이라 새로운 불일치는 아니다).
- **영향 파일**: `frontend/src/pages/RequestPage/index.tsx` (1개 파일, 2줄)
- **검증(2026-08-13 실행)**: `npx tsc --noEmit` 22개(작업 전후 동일, 신규 0) ·
  `react-scripts test --watchAll=false` 5 suites / **174건 통과**.

### 추가 변경 이력 (2026-08-12 — MASTER '이력에 바로 등록')

- **개요**: MASTER 가 step 5 에서 `상신하기` 대신 `📋 이력에 바로 등록` 을 눌러, **결재 경로를 전혀
  거치지 않고** 문서를 이력 조회에 올린다. 상신일·결재 완료일은 모달에서 직접 입력한다.
  **사양 전문은 `docs/HISTORY.md` §4.5** 참조.
- **신규 API**: `POST /api/documents/{id}/direct-approve/` — MASTER 전용, `draft` 만.
  `status='approved'` + 완료 기록 `ApprovalStep` 1행 생성. **메일 발송 없음. 마이그레이션 없음.**
- `index.tsx`:
  - 모듈 스코프 `todayISO()` 신설(`toISOString` 은 UTC 기준이라 쓰지 않는다).
  - `canDirectHistory` — `role='MASTER'` && `!isPeerReviewMode` && `editDocStatus ∈ {null, 'draft'}`.
  - `handleDirectHistoryClick`(검증 후 모달 열기) · `handleDirectHistoryRegister`(저장 → 등록 → `/history`).
  - `buildEnrichedForm` 에 **4번째 optional 인자 `submittedDate`** 추가. 제목 끝의 `_요청서_YYMMDD`
    를 만드는 로직은 `titleDateStr(isoDate?)` 로 분리했고, **인자를 주지 않으면 종전대로 오늘 날짜**다
    → 기존 호출부(임시저장·자동저장·상신·재상신·peer) **동작 불변**.
- **검증에서 생략하는 것은 결재선 입력뿐**이다 — 지정 PL·후결자·통보자. 5단계 위저드 필수값과
  서버측 Backbone 매핑 검증은 상신과 완전히 동일하게 적용된다.
- **i18n**: `request.direct_history*` 7키 ko/en 동시 추가.
- **영향 파일**: `backend/api/views.py`, `backend/api/tests.py`, `frontend/src/api/client.ts`,
  `pages/RequestPage/index.tsx`, `locales/ko.json`·`en.json`, `docs/HISTORY.md`
- **검증(2026-08-12 실행)**:

  | 항목 | 작업 전 | 작업 후 |
  |---|---|---|
  | `npx tsc --noEmit` | 22개 | **22개** (파일별 분포 동일 — 신규 0) |
  | `react-scripts test` | 5 suites / 124건 | **5 suites / 124건 통과** |
  | 백엔드 `manage.py test api` | 279건 | **288건 OK** (신규 `DirectHistoryRegisterTest` 9건) |

  ⚠️ `tsc` 베이스라인은 이 문서 §4 에 적힌 24개가 아니라 **작업 직전 실측 22개**였다.
  (`VOCPage.tsx` 2건이 그 사이 해소됨 — 베이스라인은 고정 상수가 아니라는 §3.2 원칙대로 매번 실측할 것)

### 추가 변경 이력 (2026-08-12 — Backbone 조합 영역 조건부 필수 + J/O-ayer st·new_or_copy 필수)

- **Backbone 조합 영역(`bb_entries`)이 STEP1 무조건 필수에서 조건부 필수로 바뀌었다.**
  이 값이 실제로 필요한 문서는 **J-ayer 표에 `st` 가 'O 계열'인 활성 행이 있는 문서**뿐인데,
  기존에는 그와 무관하게 STEP1 을 벗어나려면 위치·제품·조리법 3칸을 반드시 채워야 했다.
  - **판정 근거는 J-ayer 표 하나뿐이다** — O-ayer 는 보지 않는다. 활성 행(`!disabled`)만 본다.
  - **'O 계열' = `'O'` 또는 `'O (D)'`** (`isStO`, `constants.ts`). 표의 st 선택지는 이 둘과 `'X'` 셋뿐이다.
  - `new_or_copy`(신규/차용)는 **판정에 쓰지 않는다.** `기등록`·`layer삭제` 는 st 가 자동으로 `'X'` 가 되고,
    신규/차용 행은 st 가 O 로 따라오므로 st 하나로 충분하다.
  - 순수 헬퍼 3종을 `helpers.ts` 에 추가했다(단위테스트 `helpers.test.ts` 동봉):
    `requiresBbEntries(jayerRows)` / `findBbEntryViolations(entries, required)` / `findEmptyStNocViolations(rows)`.
- **검증 시점과 차단 동작**
  | 단계 | 검사 |
  |---|---|
  | STEP1 → 2 | 필수 여부와 무관하게 **일부만 채운 항목**만 막는다(3칸 중 일부만 채운 값은 언제나 오류). 필수 상태로 되돌아온 경우엔 완전 입력을 요구한다. |
  | STEP3 → 4 | J-ayer 기준으로 처음 판정. 필수인데 미완성이면 **모달 없이 STEP1 로 즉시 이동** + 에러 토스트 + 해당 항목 스크롤·강조. |
  | STEP5 상신 | 초안 복원 등으로 단계를 건너뛴 경로 대비 안전망(동일 검사 반복). 여기서 막혀도 STEP1 로 이동한다. |
  - 이동 방식: `validate()` 가 `redirectStep?: number` 를 함께 반환하고, `goToStep`·`handleSubmitClick` 이 그 값으로
    `setStep` 한다. **`bb_entries` 오류 하나만 남았을 때만** 이동한다 — 다른 오류가 섞여 있으면 그 오류는 현재
    단계에서 고쳐야 하므로 이동하지 않는다.
  - `validate(1)`·`validate(4)` 에 있던 **`isOnlyMap`/`isAdiCdOnly` 우회 분기 중 Backbone 몫은 제거**했다.
    그 문서들은 J-ayer 에 O 행이 생기지 않아 조건 자체로 걸러진다(§ADI CD 절의 "우회 대상 2곳" 중 첫 항목이 없어졌다).
  - **STEP1 라벨의 `*` 는 동적**이다 — 필수일 때만 `*`, 아닐 때는 안내 문구(`bb_entries_optional_hint`)를 보여준다
    (`Step1.tsx` prop `bbEntriesRequired`, CSS `.form-label .form-hint`).
- **J/O-ayer 표의 `st`·`new_or_copy` 공란 금지**: 활성 행은 두 값을 반드시 채워야 한다(`findEmptyStNocViolations`).
  검증 시점은 차용 행 검증과 같다(J = STEP3→4, O = STEP4→5, 상신 시 재검사). 에러 표시도 같은 방식 —
  행별 키 `jayer_stnoc_${id}_st`/`_new_or_copy`(O 는 `oayer_stnoc_*`)로 해당 셀에 빨간 테두리 + `field-error-target`
  스크롤, 안내는 토스트(`jayer_stnoc_required`/`oayer_stnoc_required`, count 보간) 하나로만.
- **`layer삭제` 행의 `st` 잠금**: `layer삭제` 는 st 가 항상 `'X'` 다(선택 시 자동 설정은 기존 동작).
  이제 **셀 편집(`disabled`)과 붙여넣기(`isLayerCellLocked` 의 `col === 'st'`) 양쪽에서 값을 바꿀 수 없다.**
  J·O-ayer 표 모두 적용. 같은 행의 다른 컬럼은 그대로 편집 가능하다.
- **신규 i18n 키** (ko/en 동시): `request.bb_entries_optional_hint` / `bb_entries_required` / `bb_entries_partial`
  / `stnoc_field_error` / `jayer_stnoc_required` / `oayer_stnoc_required`.
- 백엔드 변경 없음(마이그레이션 없음).

### 추가 변경 이력 (2026-08-12 — MAP 삭제 단순화 / ADI 버튼 제거 / 상신 모달 확대 / 예외 구역 기본값 / 영업·기술지원 합의자)

#### ① 요청 목적 'MAP 삭제/수정' → 'MAP 삭제'

- 요청 목적에서 **'수정'을 제거**하고 저장값을 `MAP 삭제` 로 변경했다.
  - 프론트: `constants.ts` `MAP_DELETE_EDIT_PURPOSE` / `OPTION_REQUEST_PURPOSE`
  - 백엔드: `models.py` `RequestDocument.MAP_DELETE_EDIT_PURPOSE`
  - ⚠️ 두 값은 **항상 같아야 한다** — 다르면 결재 경로(`mailer.route_agents_for`) 판정이 깨진다.
- `map_type` 후보가 `삭제` 하나뿐이라, 목적 선택 시 **자동 고정**한다(`applyMapOnlyScope`).
  예전에는 후보가 2개라 사용자가 StepMap 에서 직접 골라야 했다.
- `MAP_TYPE_EDIT_REQ('수정')` 상수와 i18n 키(`map_type_edit_req`, `map_change_reason_edit`)를 삭제했다.
- 상세보기 이유 라벨도 `MAP 삭제 이유` 하나로 통일(`PagedDetailView`).

#### ② StepMap 의 ADI 버튼 제거

- `map_type` 버튼 목록에서 `ADI` 를 뺐다. 기타 목적 **'ADI CD 변경'이 `map_type='ADI'` 로
  자동 고정하는 동작은 그대로**이며, 고정된 동안은 버튼 대신 안내 문구(`map_type_adi_fixed`)를 띄운다.

#### ③ 상신 모달 확대

- `maxWidth` 520px → **1040px**(상수 `SUBMIT_MODAL_MAX_WIDTH`).
- 공용 `.modal-body { max-height: 82vh }` 는 **건드리지 않고**, `Modal` 에 `bodyStyle` prop 을
  새로 만들어 이 모달에만 최소 높이(62vh)를 준다 — 다른 모달에 영향이 없다.
- 특이사항 textarea `rows` 3 → **10**, 세로 리사이즈 허용.

#### ④ 예외 구역(ea_change) 기본값을 C가문 여부에 연동

| only_prodc | 기본값 |
|---|---|
| `No` (일반) | **300** |
| `Yes` (C가문) | **500** |

- `변경 없음` 선택지 라벨에 적용 기본값을 함께 표시한다(`no_change_with_default`, 예: `변경 없음(300)`).
- 값 칸을 **숨기지 않고 표시한 뒤 잠근다** — 실제로 저장되는 기본값이 보이도록 한 것이다.
- C가문 Yes/No 를 전환하면 `변경 없음` 상태일 때만 기본값을 함께 갱신한다.
  `변경 있음`이면 사용자가 직접 넣은 값이므로 건드리지 않는다.
- 상수: `EA_NO_CHANGE` / `EA_HAS_CHANGE` / `EA_DEFAULT_NORMAL` / `EA_DEFAULT_PRODC` / `eaDefaultValue()`
- ⚠️ 백엔드 `RequestDocument.EA_*` 와 **같은 값**이어야 한다(합의자 필수 판정이 양쪽에서 동일해야 함).

#### ⑤ Only MAP · MAP 삭제: J-ayer·O-ayer·Backbone 단계 차단 (2026-08-12)

- 이 두 목적은 원래도 저장 시 `jayerRows/oayerRows/bbRows` 를 **빈 배열로 버렸는데**,
  화면에서는 그 단계에 들어가 입력까지 할 수 있어 "입력했는데 사라진다"는 혼란이 있었다.
- 이제 **단계 자체를 막는다** — `lastStep = 2`(MAP 정보)이고, 2단계 하단 버튼이 `다음 →` 대신
  **`📤 상신`** 이 된다. 상세 규칙은 위 **§2.4 단계 이동 규칙** 참조.
- 인디케이터의 3·4·5 는 숨기지 않고 흐리게 남긴다(`WizardIndicator.disabledSteps`).
- ⚠️ 기타 목적 **'ADI CD 변경'(`isAdiCdOnly`)은 이번 범위가 아니다.** 같은 자리에서 3·4단계 검증을
  건너뛰지만(`validate`), 단계 이동은 종전대로 열려 있다.

#### ⑥ 영업/기술지원 합의자(SA) — 신설 결재 단계

작성자가 **상신 모달에서 PL 권한자 중 지정**하는 결재 단계다. 자세한 결재 흐름은
`docs/APPROVAL.md` **Case P** 참조.

- 저장 위치: `detail.sales_agreers` (`[{loginid, name}]`), 미지정 사유는 `detail.sales_agreer_none_reason`
- **지정 필수 조건**(`requiresSalesAgreer` / `RequestDocument.requires_sales_agreer`):
  `ea_change === '변경 있음'` **이고** `ea_value` 가 기본값(300/500)과 **다를 때**.
  이때 합의자 1명 이상 또는 미지정 사유가 없으면 상신이 막힌다.
- 재상신 시 이전 회차 지정이 모달에 그대로 채워지고, 작성자가 바꿀 수 있다.
- **UI — 2026-08-13 개선**: 이전에는 `ea_value` 변경 여부와 무관하게 합의자 블록이 **항상** 표시되고, 검색
  입력과 '지정하지 않는 사유' 입력이 **동시에** 보였다. 이제는:
  - 블록 자체가 `requiresSalesAgreer` 일 때만(`ea_value`가 기본값과 다를 때만) 나타난다.
  - 블록 안에 **"합의자 없음" 체크박스**(`salesAgreerNone` state, 신규)를 추가해 검색·선택 UI 와
    사유 입력을 **상호 배타적**으로 만들었다 — 체크 해제(기본) 시 합의자 검색·선택만, 체크 시 사유
    입력만 보인다. 체크 시 이미 선택된 합의자는 비운다(`setSalesAgreers([])`).
  - 편집/재상신 로드 시 `sales_agreers`가 비어있고 `sales_agreer_none_reason`이 있으면
    `salesAgreerNone`을 `true`로 복원한다.
  - 저장 데이터 형태·검증 로직(`requiresSalesAgreer`, 백엔드 `requires_sales_agreer`)은 변경 없음 —
    화면 표시 방식만 바뀌었다.
  - 신규 i18n 키: `request.sales_agreer_none_toggle`(ko/en). 더 이상 쓰이지 않게 된
    `request.sales_agreer_help`는 제거했다(블록이 항상 필수 상태로만 보이므로 비필수용 문구가 불필요해짐).


### 추가 변경 이력 (2026-08-11 — 임시저장 재진입 시 `source_partid` 유실 수정 + 왕복 테스트 신설)

- **문제**: 임시저장(또는 반려) 문서를 `편집`으로 다시 열면 **원본 제품 이름(`source_partid`)이 항상
  빈 값**이 됐다. `map_type='CLONE'` 문서에서는 상신 필수값이라, 그대로 임시저장하면 DB 값까지
  덮어써 영구 유실됐다.
- **원인**: `index.tsx` 의 `[detail.source_line]` effect 하나만 다른 연쇄 초기화 effect
  (라인·조합법·제품·조리법)와 달리 **`isLoadingEditRef` 로드 가드가 없었다.** 편집 로드가
  `source_line` 을 채우는 순간 effect 가 돌아 하위 값을 초기화했다.
- **수정**: 해당 effect 의 `setDetail(... source_partid: '')` 를 `if (!isLoadingEditRef.current)` 로 감쌌다.
  **사용자가 직접 원본 위치를 바꿀 때의 초기화는 변경 없음** — `source_line` select 는
  `handleDetailChange`(`index.tsx:1393`)를 쓰고, 이 핸들러가 먼저 로드 가드를 해제한다.
  옵션 fetch(`getMapNames`)·`sourcePartIdOptions` 갱신은 종전 그대로 무조건 수행한다.
- **범위**: 프론트 1개 effect. 백엔드·마이그레이션·저장 payload 구조·i18n **변경 없음.**
- **신규 테스트**: `pages/RequestPage/draftRoundTrip.test.tsx` (5건) — 「모든 항목을 채운 문서를
  편집 모드로 로드 → 곧바로 임시저장」의 payload 를 `detail` **전 항목 단위로 비교**해 유실을 잡는다.
  후속 기능 추가 때도 이 테스트가 왕복 유실을 자동으로 잡아 준다.
  - ⚠️ `RichTextEditor` 는 tiptap(ESM)이라 jest 가 파싱하지 못해 **mock 으로 대체**한다.
  - ⚠️ CRA jest 설정이 `resetMocks: true` 라 `jest.fn` 구현이 매 테스트마다 지워진다 →
    API mock 은 **평범한 함수**로 둔다.
- **검증(2026-08-11 실행)**:

  | 항목 | 작업 전 | 작업 후 |
  |---|---|---|
  | `npx tsc --noEmit` | 24개 | **24개** (파일별 분포 동일 — 신규 0) |
  | `react-scripts test` | 4 suites / 119건 | **5 suites / 124건 통과** |
  | 백엔드 `manage.py test api` | 256건 OK | **256건 OK** |

- **함께 발견했으나 고치지 않은 건**: 저장된 필터가 켜져 있으면 **다시 열기만 해도**
  `detail.tbvtlv_entries` 가 삭제된다 → `docs/DATA_FLOW_AUDIT.md` **R-10** 참조(처리 방침 미정).

### 추가 변경 이력 (2026-08-11 — 특이사항·변경 요청 목적 입력 개방 / 상세보기 역할 조건 정리)

- **Step1 `change_purpose_note`(특이사항·변경 요청 목적) 입력 개방**
  (`components/Step1.tsx`): `disabled={disableOptional}` → `disabled={!canSelectPurpose}`.
  이제 요청 목적이 `Only MAP` · `MAP 삭제/수정` 이어도 **입력할 수 있다.**
  잠기는 조건은 라인·조합법·제품 이름·조리법 미선택(`!canSelectPurpose`) **하나뿐**이다.
  - **초기화 동작은 변경 없음**: `Only MAP`/`MAP 삭제/수정` 으로 **전환**하면
    `applyMapOnlyScope`(`index.tsx`)가 `change_purpose_note` 를 `''` 로 되돌린다.
    전환 확인 모달 판정(`mapOnlyScopeHasData`)에도 이 필드가 그대로 포함된다.
    → 입력은 가능하되 목적을 바꾸면 비워지므로, **목적을 먼저 고르고 나서 작성**해야 한다.
  - `disableOptional`(기타 목적·흐름도·Backbone·참조 요청서)은 **무변경**.
- **상세보기 `change_purpose_note` 노출 조건 정리**
  (`components/PagedDetailView.tsx`): `((isO && !isR && !isJ) || role === 'MASTER' || isPL || isP)`
  → `detail.change_purpose_note` 유무만 판정. `isP`/`isR`/`isJ`/`isO` 가 모두 `true` 상수라
  기존 조건식은 **항상 참인 죽은 코드**였다(전원 공개 동작은 그대로 유지 — 화면 변화 없음).
  이 조건식이 유일한 사용처였던 `isPL` 상수도 함께 제거했다.

### 추가 변경 이력 (2026-08-11 — 뼈찜(bb_ref) 항목 상세보기 용어 연동)

- **문제**: 상세보기(`components/PagedDetailView.tsx` `buildBbValue`)가 뼈찜 항목을
  `[1] 위치: … / 제품: … / 조리법: …` 로 **한국어 라벨을 하드코딩**하고 있어,
  작성 화면(Step1)이 쓰는 i18n 용어와 어긋나고 영어(en) 전환 시에도 한국어로 고정됐다.
- **수정**: 라벨 3개를 Step1(`components/Step1.tsx:442/454/465`)과 **동일한 키 그대로** 사용하도록 교체.

  | 필드 | i18n 키 | ko | en |
  |---|---|---|---|
  | `entry.location` | `request.bb_ref_line` | 뼈찜 위치 선택 | Bone Stew Location |
  | `entry.product` | `request.bb_ref_part_id` | 뼈찜 제품 이름 선택 | Bone Stew Product Name |
  | `entry.process_id` | `request.bb_ref_process_id` | 뼈찜 조리법 | Bone Stew Cooking Method |

- **범위**: 라벨(표시 문자열)만 변경. 저장 값(`location`/`product`/`process_id`)·데이터 구조·백엔드·마이그레이션 **변경 없음**.
  i18n 키도 **신규 추가 없이 기존 키 재사용**이다.
- `buildBbValue` 는 상세 칩(`bb_status`)과 **'이력 확인' 모달(회차별 값 비교)** 이 공유하므로 두 곳에 함께 반영된다.
- **연동 상태 전수 확인 결과**: 뼈찜 정보 표 헤더(`col_bb_process_id`/`col_bb_partid`/`col_bb_layer`/`col_bb_stepseq`/`col_bb_step`)와
  칩 제목(`bb_status`)은 이미 i18n 연동되어 있었다. `bb_entries` 를 표시하는 상세 화면은 `PagedDetailView.tsx` **한 곳뿐**이다.
- **미조치(요청 범위 밖, 기록만)**: 같은 파일의 `buildMapValue`/`buildEaValue` 는 `변경:`·`사유:`·`값:` 을 여전히 하드코딩한다.
  `RequestPage/constants.ts` 의 `bb_zone: '존재'` 는 라벨이 아니라 **저장 값**이라 i18n 대상이 아니다.

### 추가 변경 이력 (2026-08-10 — 단계 인디케이터 탭 클릭 이동)

- **개요**: '다음'/'이전' 버튼으로만 가능하던 단계 이동에 **상단 인디케이터 탭 클릭**을 추가했다.
  뒤로는 자유, 앞으로는 사이 단계가 모두 검증을 통과할 때만 이동한다. 규칙 전문은 **§2.4** 참조.
  **백엔드·마이그레이션·`validate()` 본문·Step 컴포넌트 변경 없음.**
- `index.tsx`: `goToStep(target)` 신설(단계 이동 단일 진입점) + `startStepMove`/`resumePendingStep`.
  기존 `handleNextStep`/`handlePrevStep` 은 `startStepMove(step±1)` 로 위임하는 한 줄 래퍼가 됐다
  — **'다음'/'이전' 버튼 동작은 완전히 동일**하다(검증 → 관문 모달 → 이동 순서 보존).
  `pendingStepTarget` state · `ackedStepGatesRef` ref 신설, `scrollToFirstError(atStep = step)` 인자화.
- `components/WizardIndicator.tsx`: optional `onStepClick`/`stepTitle` 추가(미지정 시 기존 동작).
- `styles/global.css`: `.wizard-step.clickable` 커서·hover·`:focus-visible` 추가(기존 `.wizard-step` 불변).
- **i18n**: `request.step_move` 1키 ko/en 동시 추가(툴팁).
- **구현 중 발견해 설계로 막은 함정 2건** — 둘 다 여러 단계를 한 번에 건너뛸 때만 나타난다:
  1. 관문 모달 `onConfirm` 이 `handleNextStep(true)` 처럼 **목적지를 `step+1` 로 고정**하고 있어
     점프 목적지가 유실됨 → `pendingStepTarget` 으로 해결.
  2. `ConfirmModal` 이 `onConfirm(); onClose();` 를 연달아 부르는 구조라, step1 관문 확인 후
     이어서 뜬 step4 관문의 상태를 `onClose` 가 되돌려 **두 모달이 무한 반복**됨
     → 확인 기록(`ackedStepGatesRef`)을 `startStepMove` 에서만 비우도록 해결.
- **테스트**: `components/WizardIndicator.test.tsx` **신규 11건** — 코드베이스 최초의 컴포넌트
  테스트다. `setupTests.ts` 가 없어 `jest-dom` 매처가 등록되지 않으므로 **전역 설정 파일을 만들지
  않고 표준 DOM 단언만** 쓴다(다른 테스트 영향 0). 커버: prop 미지정 시 기존 동작 보존 ·
  현재 단계 제외 · 클릭 시 단계 번호 · Enter/Space · 그 밖의 키 무반응 · 툴팁 · done/active 회귀.
- **검증(2026-08-10 실행)**:

  | 항목 | 작업 전 | 작업 후 |
  |---|---|---|
  | `npx tsc --noEmit` | 24개 | **24개** (파일별 분포 동일 — 신규 0) |
  | `react-scripts test` | 3 suites / 84건 | **4 suites / 95건 통과** |
  | 백엔드 `manage.py test api` | — | **201건 통과 (OK)** |
  | `react-scripts build` | 실패(`Navbar.tsx:227`) | **실패(동일)** — 선행 이슈, 무관 |

  ⚠️ RTL 13 + React 18 조합에서 `ReactDOMTestUtils.act is deprecated` 경고가 뜨지만
  **테스트는 전부 통과**한다. 라이브러리 버전 문제라 이번 범위에서 손대지 않았다.
- **자동 테스트 한계**: `goToStep` 의 이동 판정 자체는 `setErrors` 부작용이 있는 `validate()` 에
  의존해 순수 함수 단위 테스트로 분리할 수 없다. 억지 추상화 대신 **수동 시나리오 검증을
  핵심**으로 둔다(재검증·다단계 점프·관문 모달 연속 경로).

### 추가 변경 이력 (2026-08-07 — J-ayer 정보 '검토 항목' 서브탭 + 마스터 목록 동기화)

- **개요**: 의뢰 상세 'J-ayer 정보' 탭에 `JOB Layer 목록` / `검토 항목` 서브탭을 추가했다.
  검토 항목은 **전역 마스터 목록의 문서별 사본**이며, 검토자 지정·확인 상태는 그 의뢰서에만 남는다.
  결재선(`ApprovalStep`)과 분리돼 있어 **결재 경로 탭·결재 현황 목록에는 나타나지 않는다.**
- **채우기 시점**: 문서에 **J 단계가 생성되는 순간** 마스터 활성 항목을 복사한다(제목만).
  J 단계를 거치지 않는 경로(Only MAP 등)에는 항목이 생기지 않는다.
- **전파**: 어느 문서에서든 추가·제목수정·삭제하면 마스터와 **결재 진행 중이고 현재 회차 J 단계가
  대기인 다른 문서**에 함께 반영된다. 결재가 끝난 문서는 그 시점 목록으로 굳는다.
  삭제는 이미 확인한 검토자가 있는 다른 문서 사본을 건드리지 않는다.
- **재상신**: 항목·검토자는 남고 확인 상태만 초기화되며, 새 회차 J 단계가 열릴 때 마스터를 따라잡는다.
- **결재 현황 MY 탭**: '내가 검토자인 미확인 항목 ≥ 1' 조건이 기존 조건과 **OR** 로 합쳐졌다.
- **영향 파일**: `backend/api/review_items.py`(신규·정책 단일 소스), `models.py`, `serializers.py`,
  `views.py`, `migrations/0018_*.py`, `frontend/src/components/ReviewItems.tsx`(신규),
  `PagedDetailView.tsx`, `pages/ApprovalPage.tsx`, `pages/HistoryPage.tsx`, `api/client.ts`,
  `types/index.ts`, `locales/ko.json`·`en.json`, `styles/global.css`
- **상세 사양·인가·API 목록**: `docs/APPROVAL.md` §10

### 추가 변경 이력 (2026-08-06 — 마이그레이션 leaf 충돌 해소 + 0009 번호 예약)

- **개요**: 기존 마이그레이션 그래프에 leaf(끝 노드)가 2개 있어(`0013_alter_approvalstep_action`,
  `0013_alter_mailnotification_event_type` 이 같은 부모 `0012_design_rule_overrides` 를 가리킴)
  `manage.py test`/`migrate` 가 `CommandError: Conflicting migrations detected` 로 **아예 실행되지
  않는** 상태였다. 두 파일이 서로 다른 브랜치에서 각각 만들어져 병합된 결과다.
- **재정렬**(전부 `git mv` 로 이력 보존, `dependencies` 를 새 체인에 맞게 갱신):

  | 이전 | 이후 |
  |---|---|
  | `0009_alter_approvalstep_agent` | → `0010_alter_approvalstep_agent` |
  | `0010_designrule` | → `0011_designrule` |
  | `0011_alter_mailnotification_event_type` | → `0012_alter_mailnotification_event_type` |
  | `0012_design_rule_overrides` | → `0013_design_rule_overrides` |
  | `0013_alter_mailnotification_event_type`(08-05 04:19 생성) | → `0014_alter_mailnotification_event_type` |
  | `0013_alter_approvalstep_action`(08-06 00:47 생성) | → `0015_alter_approvalstep_action` |

- **`0009` 번호는 비워둔다**: 사내 메신저(Knox 채팅방/알림) 기능이 추가되면서 생길 `UserProfile`
  마이그레이션 자리다. 보안상 이 저장소에는 내용을 넣지 않는다. 그때까지 `0010`(재정렬 전 `0009`)은
  그대로 `0008` 을 의존성으로 유지한다 — 존재하지 않는 파일을 가리키면 이 저장소 단독으로 `migrate`
  가 깨진다. `0009` 파일이 실제로 추가되는 시점에 `0008→0009`, `0009→0010` 의존성 연결은 **그
  작업에서 함께** 처리해야 한다.
- **모델 필드 변경 없음** — 순서만 바뀐 것이라 이미 옛 번호로 배포된 DB 에도 안전하다
  (`makemigrations --check --dry-run` → `No changes detected` 확인).
- **다른 문서의 번호 참조도 함께 갱신**: 이 파일 §4.1 2026-08-05 항목(`0013`→`0014`),
  `docs/HOME_STATS.md` §8(`0012`→`0013`). `docs/E2E_TEST_AND_BUGS.md` B-48 의 `0012_design_rule_overrides`
  언급은 **2026-08-04 원문 보존 기록**이라 손대지 않았다(당시 실측 그대로 남겨야 하는 이력).
- **검증**: `makemigrations --check --dry-run` → `No changes detected`. `showmigrations` → 단일
  체인, leaf 1개. 이후 처음으로 백엔드 테스트 실행 가능해짐 — 187건 중 184건 통과(실패 3건은
  마이그레이션과 무관한 선행 버그, 세션 시작 전 커밋에서도 동일하게 실패함을 별도 워크트리로 확인).

### 추가 변경 이력 (2026-08-06 — 요청 목적 'MAP 삭제/수정' + 기타 목적 '연구소 제품')

- **개요**: 요청 목적에 `MAP 삭제/수정` 을, 기타 목적에 `연구소 제품` 을 추가했다. 계획·인터뷰
  과정과 결재 경로 다이어그램은 `docs/map_delete_edit_mockup.html`(mock 계획서, 확정본 v2) 참조.

- **연구소 제품** — `Only MAP` 전용 기타 목적. 결재 경로는 바꾸지 않는다(**Only MAP 경로 그대로**,
  PL→R→후결자). 선택 시 기존 C가문(`only_prodc=Yes`) 후결자 메커니즘을 그대로 켤 뿐이다 — 새로
  만든 결재 로직은 없다.
  - `index.tsx`: 파생 플래그 `isLabProduct`/`requiresPostApprover`(= C가문 **또는** 연구소 제품)
    신설. 후결자 관련 조건 3곳(저장 payload·상신 차단·UI 노출)을 `only_prodc==='Yes'` 단일 비교에서
    이 플래그로 교체.
  - `Step1.tsx`: 기타 목적 버튼 잠금을 항목별로 분리(`otherPurposeDisabled`) — `연구소 제품`은
    `Only MAP` 일 때만 열리고 다른 목적에서는 이것만 잠긴다(나머지 6개는 반대).
  - `Only MAP` 을 해제하면 확인 모달 후 `연구소 제품`·지정한 후결자를 함께 초기화한다
    (`applyLeaveMapOnlyScope`). `연구소 제품`만 껐다 켜도 후결자는 함께 초기화된다.
  - **백엔드**: `RequestDocument.requires_post_approver()`(C가문 또는 연구소 제품) 신설,
    `_validate_post_approvers`·`remove_post_approver` 두 곳 모두 이 헬퍼로 판정(후자는 처음엔
    누락했다가 발견해 별도 수정 — `docs/APPROVAL.md` §6-9·Case O 참조).

- **MAP 삭제/수정** — `Only MAP` 과 동일하게 MAP 정보만 작성한다(Step1 부가 항목·J/O/Backbone
  잠금·초기화, 결재 경로는 다름 — `docs/APPROVAL.md` **Case O**).
  - `constants.ts`: `MAP_DELETE_EDIT_PURPOSE`·`MAP_TYPE_EDIT_REQ`·`MAP_TYPE_DELETE_REQ`
    (`isMapDeleteEditType`) 신설. ⚠️ 과거 '완성된 MAP 변경' 기능이 쓰다 2026-08-05 삭제된
    `map_type='EDIT'` 값은 레거시 문서와 섞이므로 재사용하지 않고 `EDIT_REQ`를 썼다.
  - `index.tsx`: `applyOnlyMap()` → `applyMapOnlyScope(purpose)` 로 일반화해 `Only MAP`·
    `MAP 삭제/수정` 이 초기화 로직을 공유한다. `MAP 삭제/수정` 진입 시엔 `map_type` 을 비운다
    (`ADI` 와 달리 후보가 2개라 자동 고정할 수 없어 STEP2 에서 직접 고른다). `validate(2)` 에
    이유 모드 조기 분기 추가 — 숨긴 항목은 검증도 건너뛰고 이유 필수만 본다(HTML 태그를 걷어내고
    판정, 이미지만 있어도 통과).
  - `StepMap.tsx`: `map_type` 버튼 4개(`NEW`/`CLONE`/`EXISTING`/`ADI`) → 6개(`수정`/`삭제` 추가).
    `MAP 삭제/수정` 목적일 때만 `수정`/`삭제` 가 열리고 나머지 4개가 잠기며(그 반대도 성립),
    `ADI` 의 "표시 전용 잠금" 패턴을 그대로 따른다. `수정`/`삭제` 선택 시 **아래 MAP 블록 전체를
    렌더하지 않는다**(잠금이 아니라 숨김) — 원본 위치·REV·C가문·지도편차·예외구역·X표시·Inter·
    Map Option 이 전부 사라지고 이유 입력칸만 남는다.
  - **이유 입력칸**: 새 컴포넌트를 만들지 않고 기존 `RichTextEditor`(Tiptap, 공지·가이드·VOC 3곳
    에서 이미 사용 중)를 재사용했다. 글·이미지 붙여넣기가 이미 구현돼 있어(`uploadImageAPI.upload()`)
    요구사항을 그대로 만족한다. 고정 높이(320px) `div` 로 감싸 내용이 길어져도 **칸 내부에서만
    스크롤**된다(에디터가 이미 `flex:1`+`overflowY:auto` 구조라 컴포넌트 자체는 수정 불필요).
    저장 필드는 `detail.map_change_reason`(HTML 문자열, 수정·삭제 공용 — 전환 시 값 유지, 라벨만
    바뀐다). ⚠️ C가문 지도편차 사유인 기존 `map_reason` 과는 **별개 필드**다.
  - `PagedDetailView.tsx`: MAP 정보 섹션에 이유 카드 추가(수정/삭제일 때만, 라벨 분기). 렌더는
    공지·가이드·VOC 와 동일하게 `dangerouslySetInnerHTML` — **sanitize 없음**(기존 관행과 동일
    수준의 위험이며 이번에 새로 생기거나 해소되지도 않았다).
  - **결재 경로**: PL 전원 합의 직후 **P·R·J·O 병렬 생성**(E·후결자 없음, 고정 후결자도 안 붙는
    유일한 경로). 상세는 `docs/APPROVAL.md` **Case O**.

- **저장 구조**: 전부 `additional_notes` JSON 하위(`request_purpose`/`other_purpose`/`map_type`/
  `map_change_reason`)라 **마이그레이션 없음**.

- **i18n**: `request.map_type_edit_req`·`map_type_delete_req`·`map_change_reason_edit`·
  `map_change_reason_delete`·`map_change_reason_help`·`map_change_reason_placeholder`·
  `map_delete_edit_confirm_title`·`map_delete_edit_confirm_msg`·`map_only_leave_confirm_title`·
  `map_only_leave_confirm_msg`·`lab_product_only_map_hint` 11키 ko/en 동시 추가. 기존
  `post_approver_help`/`post_approver_required` 문구도 연구소 제품을 언급하도록 함께 수정.

- **테스트**: 프론트 `approvalTable.test.ts`(신규, 7건 — 결재현황 목록의 R 표시 회귀·신규 시나리오),
  백엔드 `MapDeleteEditRouteTest`(7건)·`LabProductPostApproverTest`(5건, 후결자 제거 가드 재현
  포함). 전체 프론트 74건 / 백엔드 188건(실패 3건은 무관한 선행 버그) 통과.

- **작업 중 발견해 함께 고친 버그 3건**(요청 범위 밖이었으나 이 기능이 드러낸 결함이라 즉시 수정
  — 상세는 `docs/APPROVAL.md` §6-9·Case O):
  1. 결재현황 목록이 병렬 구성원이 된 R 을 표시하지 않던 문제(`approvalTable.ts` `path0` 추가).
  2. 결재 상세 후결자(RA) 행이 이 경로에서 '대기'로 영구 표시되던 문제(`PagedDetailView.tsx`).
  3. `remove-post-approver` 최소인원 가드가 연구소 제품을 놓치던 문제(`views.py`).

### 추가 변경 이력 (2026-08-05 — 기타 목적 '완성된 MAP 변경' 기능 삭제)

- **개요**: 결재 완료된 요청서의 MAP 정보만 불러와 수정·재상신하고 승인 시 원본에 되반영하던
  기타 목적 `완성된 MAP 변경`을 **프런트·백엔드·i18n·문서에서 완전히 제거**했다.
  테스트 기간 중이라 이 목적으로 상신된 의뢰서가 없어 **데이터 마이그레이션은 하지 않았다.**

- **프런트**
  - `constants.ts`: `OPTION_OTHER_PURPOSE` 에서 옵션 제거(7 → 6개), `OTHER_PURPOSE_MAP_CHANGE`·`MAP_DETAIL_KEYS` 삭제.
  - `index.tsx`: 전용 state 6개(`mapChangeDocId`/`mapChangeDocLabel`/reset·leave 확인/`pendingSwitchOp`/`mapChangeBaseline`)와
    핸들러 8개(`applyMapChangeMode`·`handleMapChangeApply`·`exitMapChangeMode` 등), `ConfirmModal` 2개 삭제.
    파생 플래그 `isMapChangeMode`·`isMapOnlyScope` 제거 → 사용처는 **`isOnlyMap` 으로 환원**.
    `buildEnrichedForm` 의 baseline 단일 history 분기와 `detail.map_change_source_id` 저장 제거.
  - `Step1.tsx`: 대상 요청서 검색 툴바·'적용' 버튼 삭제, 기타 목적 버튼의 단독 전용 진입/전환 분기 제거,
    `disableFlowBb` 별칭 삭제 후 13곳을 `disableOptional` 로 치환.
  - `StepMap.tsx`: `map_type` 값 **`EDIT` 삭제**(버튼 5 → 4개: `NEW`/`CLONE`/`EXISTING`/`ADI`).
    `disabled` 계산은 ADI 잠금만 남겨 단순화했다.
  - `PagedDetailView.tsx`: 변경 이력의 `완성 후 수정 n회차` 라벨 제거 → `n차 제출` / `현재 (최신)` 로 환원.
  - `types/index.ts`: `DetailFormState.map_change_source_id`·`map_edit_round`, `HistorySnapshot.map_edit_round` 삭제.
  - i18n **12키** ko/en 동시 삭제(`map_type_edit`, `map_edit_round_*`, `map_change_*`).
    ⚠️ 지도 편차 `map_change`(변경 있음/없음) 계열은 **별개 기능이라 그대로 유지**한다.

- **백엔드**
  - `models.py`: `MAP_CHANGE_PURPOSE`·`MAP_APPLY_KEYS` 상수, `is_map_change()`·`map_change_source_id()` 헬퍼 삭제.
  - `views.py`: `approve_step` 승인 후처리 훅과 `_apply_map_change_to_source()`(78줄) 삭제.
  - `mailer.py`: `map_apply_failed` 라벨·테마·이력 링크 대상·본문 분기·`enqueue_map_apply_failed()` 삭제.
    기존에 적재된 레거시 행은 `_build_message` 의 `else` 폴백이 `[알림]` 제목으로 처리한다.
  - `MailNotification.EVENT_CHOICES` 에서 `map_apply_failed` 제거 → **마이그레이션 `0014_alter_mailnotification_event_type`**
    (2026-08-06 마이그레이션 재정렬로 번호가 `0013`→`0014`로 바뀌었다 — 아래 2026-08-06 이력 참조).
    `choices` 변경뿐이라 **테이블 스키마는 바뀌지 않지만 배포 시 `migrate` 는 실행해야 한다.**
    (`0012_alter_mailnotification_event_type`(재정렬 전 `0011`)은 이미 적용된 이력이라 삭제하지 않았다.)
  - `tests.py`: `MapChangeApplyTest`(6건) 삭제 → 백엔드 테스트 167건 → **161건**.

- **결재 경로 영향 없음**: 라우팅은 `request_purpose` 만 쓰므로 `Only MAP` 단축 경로(`is_only_map()`)와
  일반 경로 모두 그대로다.

### 추가 변경 이력 (2026-08-03 — C가문 제품 해당 위치 게이트 + ONLY 스코프 + 리전별 지도편차)

- **개요**: C가문(`only_prodc='Yes'`) 영역을 ① **제품 해당 위치 게이트** → ② **ONLY 북쪽/ONLY 남쪽 스코프** →
  ③ **리전별 지도편차 개별 선택** → ④ **X표시 자동 `수정`** 순으로 재구성했다.
  백엔드는 `MAP_APPLY_KEYS` 한 줄만 바뀌고 **마이그레이션은 없다**(`additional_notes` JSON).
  (`MAP_APPLY_KEYS` 는 2026-08-05 '완성된 MAP 변경' 삭제와 함께 없어졌다 — `prodc_scope` 저장 자체는 그대로다.)

#### ① 영속 필드 `prodc_scope` 신설 (`prodcCopyRegion` 이관)

| | 이전 | 이후 |
|---|---|---|
| 저장 위치 | `useState<CRegion \| null>` (**저장 안 됨**) | `detail.prodc_scope` (`additional_notes` JSON) |
| 값 | `top`/`middle`/`bottom`/`null` | `''`/`top`/`middle`/`bottom`/`only_top`/`only_bottom` |

- 기존에는 UI state 라 **임시저장·재상신·편집 로드 시 선택이 사라졌다**. 스코프가 필수 검증을 좌우하므로 영속화가 필수였다(동시 해소).
- `MAP_DETAIL_KEYS`(프론트)·`MAP_APPLY_KEYS`(백엔드)에 **동시 추가**. ※ 두 상수는 2026-08-05 삭제됨.
- **레거시 백필**(`inferProdcScope`, `constants.ts`): 값이 없는 옛 문서는 편집 로드 시 저장값으로 역추론한다 —
  북·남 둘 다 있으면 `'top'`, 한쪽만 있으면 그쪽 `only_*`, 아무것도 없으면 `''`.
  백필하지 않으면 기존 C가문 문서가 게이트에 걸려 입력이 잠겨 보인다. (`북/중/남` 셋은 잠금·필수 규칙이 동일해 어느 값으로 백필되든 동작이 같다)

#### ② 게이트 + ONLY 스코프

- **게이트**: `prodc_scope`가 `''`이면 C가문 하위 3개 영역(**판별 정보 북/중/남 · 지도편차 북/남 · X표시 이미지 북/남**)을 전부 잠근다.
  라디오 아래 안내문(`request.prodc_scope_first`) 노출, `validate()` step2 에 `prodc_scope` required 추가.
  **게이트 밖**(잠그지 않음): 예외구역·Inter·Map Option·REV·map_type·원본 위치 — C가문과 무관한 항목들.
- **파생 판정**(`index.tsx`): `prodcScopeSet` / `prodcRegionOff(region)` / `prodcLocked(region)` / `regionHasMapChange(region)` / `anyRegionMapChange`.
  `prodcLocked = isMapRegistered || !prodcScopeSet || prodcRegionOff(region)` 하나로 세 잠금 사유를 합친다.
- **스코프 전환**(`handleProdcScopeSelect` → `applyProdcScope`): 지울 입력이 있으면 **확인 모달**(`prodc_scope_change_*`)을 거친다.
  적용은 **단일 `setDetail`**로 원자 처리 — 이전 주 리전 초기화 → 죽는 리전의 `prodc_*`·`map_value_*`·`mshot_image_copy_*` 초기화 → 주 리전에 메인 라인·조합법 복사.
  ⚠️ **제품(`prodc_{r}_product`)만은 `setDetail` 밖에서 `handleProdcProcessChange` 호출 뒤에 `handleDetailSet` 으로 넣는다** —
  그 핸들러가 리전 제품을 `''`로 비우므로 순서가 바뀌면 복사한 값이 지워진다(기존 핸들러의 호출 순서와 동일한 이유).

#### ③ 리전별 지도편차 고정 해제

- `map_change_top`/`map_change_bottom`은 타입·`INITIAL_DETAIL`(`'변경 있음'`)·화이트리스트에 **이미 있었으나 UI 가 한 번도 쓰지 않던 필드**였다
  (셀렉트가 `disabled value="변경 있음"` 하드코딩). 이제 실제 셀렉트로 연결돼 처음으로 살아난다.
- `handleRegionMapChangeChange`(신규): `변경 없음` 전환 시 그 리전 X/Y 초기화, 양쪽 다 `변경 없음`이면 공용 `map_reason`도 초기화.
- **기존 문서 호환**: 저장된 값이 전부 `'변경 있음'`이라 화면·검증 결과가 종전과 동일하다.

#### ④ X표시(M-shot) 자동 전환

- C가문을 **Yes 로 바꾸는 순간** `mshot_change='수정'`으로 자동 설정한다. **`handleOnlyProdcChange`의 사용자 상호작용 경로 한 곳에만** 건다 —
  편집 로드·프리필에 걸면 저장된 `mshot_change`가 덮어써져 기존 문서가 훼손된다.
- **No 로 되돌리면** `mshot_change`를 `'없음'`으로 복구하고 이미지 3종(`mshot_image_copy`·`_top`·`_bottom`)도 초기화한다
  (C가문을 되돌린 뒤 원하지 않은 X표시 정보가 저장되는 것을 막기 위함).

#### 최종 잠금·필수 매트릭스

| `prodc_scope` | 북쪽행 | 중간행 | 남쪽행 | 지도편차 북 | 지도편차 남 | 상호검증 | 이미지 북 | 이미지 남 |
|---|---|---|---|---|---|---|---|---|
| `''` (게이트) | 잠금 | 잠금 | 잠금 | 잠금 | 잠금 | 스킵 | 잠금 | 잠금 |
| `top`/`middle`/`bottom` | 필수 | 선택 | 필수 | 선택가능 | 선택가능 | **조건부** | 필수 | 필수 |
| `only_top` | 필수 | 잠금 | 잠금 | 선택가능 | 잠금 | 스킵 | 필수 | 잠금 |
| `only_bottom` | 잠금 | 잠금 | 필수 | 잠금 | 선택가능 | 스킵 | 잠금 | 필수 |

- **잠금 = 회색 비활성 + 값 초기화 + 필수(`*`) 표기 제거**. 죽은 리전은 `validate()`에서도 제외된다.
- **상호검증**(X 절대값 동일·부호 반대, Y 동일)은 **북·남이 모두 살아있고 모두 `변경 있음`일 때만** 실행한다.
  ONLY 스코프이거나 한쪽이 `변경 없음`이면 비교 대상 자체가 없다.
- `map_reason`은 `anyRegionMapChange`(한 리전이라도 `변경 있음`)일 때만 필수.
- CLONE/EXISTING 은 위와 무관하게 전 행이 잠긴다(단 `Only C가문 제품` 셀렉트·`REV 여부`는 선택 가능 — 아래 2026-08-02 이력).

#### 상세보기(`PagedDetailView`)

- `buildProdcInfo()` 맨 앞에 `[제품 해당 위치] ONLY 북쪽` 행 추가.
- C가문 MAP 칩을 **리전별 `변경 없음`/`변경 있음` 표기**로 바꾸고, 노출 조건을 `map_change_*` 존재까지 확장해
  **양쪽 다 `변경 없음`이어도 칩이 뜨도록** 했다(기존에는 X 값이 있어야만 표시).
- `prodcChanged` 키 배열·`buildProdcRows` 이력 표에 `prodc_scope` 추가.

#### i18n (ko/en 동시)

`request.prodc_only_top` · `prodc_only_bottom` · `prodc_scope_first` · `prodc_scope_change_title` · `prodc_scope_change_msg`

#### 남은 이슈

- **가이드 데모 미갱신**: `components/guideDemos/Step2CfamilyDemo.tsx`(전체 가이드의 C가문 애니메이션 데모)는 여전히
  `북쪽/중간/남쪽` 3지선다만 보여준다. ONLY 스코프·게이트가 반영돼 있지 않아 실제 화면과 다르다. 이번 범위 밖.

### 추가 변경 이력 (2026-08-02 — StepMap: EDIT 버튼 잠금 + REV 독립 + CLONE/EXISTING 잠금 범위 재정의)

- **개요**: StepMap(위저드 2단계)의 세 가지 입력 제어를 조정했다. ① `EDIT` 버튼을 '완성된 MAP 변경' 모드 전용으로 잠그고,
  ② `REV 여부`를 `Only C가문 제품`에서 완전히 분리해 그 **위**의 독립 항목으로 올렸으며,
  ③ CLONE/EXISTING 일괄 잠금에서 `REV 여부`와 `Only C가문 제품` 셀렉트를 **잠금 대상에서 제외**했다.
  백엔드·마이그레이션·i18n 신규 키 변경은 **없다**.

- **① EDIT 버튼 활성 조건 반전**: ⚠️ **폐기됨** — `map_type='EDIT'` 는 2026-08-05 '완성된 MAP 변경' 기능과 함께 삭제됐다.
  현재 `map_type` 버튼은 `NEW`/`CLONE`/`EXISTING`/`ADI` 4개다.

- **② REV 여부 독립**(`StepMap.tsx`·`index.tsx`): REV 블록(`rev_yn`·Layer 드래그 선택·GDS·추가 항목 표)을
  `{isProdc && (...)}` 래퍼 밖으로 꺼내 `Only C가문 제품` **위**에 독립 `full-width` 섹션으로 배치했다. props·state 변경 없음.
  - `handleOnlyProdcChange`(index.tsx)에서 **C가문 No 전환 시 REV 초기화(`rev_yn`/`rev_entries`/`revLayersSelected`/`revGds`)를 제거**했다.
    이제 REV 는 `REV 여부`를 `NO` 로 바꿀 때만 초기화된다.
  - **유지되는 REV 초기화 경로**: 메인 라인 변경 effect(R-6)와 `handleMapTypeChangeConfirm`(map_type 전환 시 MAP 전체 초기화).
    둘 다 J-layer 가 통째로 재생성되는 경로라 REV 만 남기면 고아 데이터가 된다.
  - **결재 상세/이력조회 동반 수정**(`PagedDetailView.tsx`): REV 블록이 C가문 블록 안에 중첩돼 `isProdc && revYn` 조건이었던 것을
    **독립 블록 + `revYn` 조건**으로 분리했다. 이 수정이 없으면 `C가문 No + REV YES` 문서의 REV 가 결재 화면에서 보이지 않는다.
    이동하면서 불필요하던 `(detail as any)` 캐스팅 2곳을 제거했다(`detail` 은 이미 `Partial<DetailFormState>`).

- **③ CLONE/EXISTING 잠금 범위 재정의**: `isMapRegistered`(= CLONE·EXISTING) 일괄 잠금을 아래처럼 나눴다.

| 항목 | 이전 | 변경 후 |
|------|------|---------|
| `REV 여부` 버튼 + 하위 전체 | 잠금 | **선택 가능** (YES 시 기존 기능 그대로) |
| `Only C가문 제품` 셀렉트 | 잠금 | **선택 가능** |
| 제품 해당 위치 라디오 3개 | 잠금 없음 | **잠금 추가** |
| ProdcRow 북/중/남 (사용여부·라인·조합법·제품) | 잠금 없음 | **잠금 추가** |
| 지도편차 북/남 X·Y·사유, 예외구역, X표시, Inter, Map Option | 잠금 | 잠금 유지 |

  - 즉 **C가문 Yes 를 고를 수는 있으나 Yes 로 펼쳐지는 하위 입력은 전부 잠긴다.**
  - `ProdcRow.tsx` 에 optional prop `disabled?: boolean` 신설(미지정 시 기존 동작) → 내부 `<select>`·`AutocompleteInput`·`FormSelect` 로 전달.
  - 공용 `FormSelect.tsx` 에도 optional `disabled?: boolean` 을 추가했다(미지정 시 기존 동작이라 다른 사용처 무영향).
  - **검증(`validate()` step 2) 수정 없음**: C가문 필수 검증이 이미 `if (!isMapRegistered)` 블록 안에 있어 "잠금 = 검증 제외"가 그대로 성립한다.

- **알려진 제약(의도된 현행 유지)**: REV Layer 후보(`availableRevLayers`)는 J-layer 표(`jayerRows`)에서 뽑는다.
  `Only MAP` 모드는 J/O 표를 강제로 비우므로 **후보가 0개**가 되어 REV 항목을 새로 추가할 수 없다(불러온 항목 삭제만 가능).
  이 모드에서는 REV Layer 를 쓸 일이 없다는 판단으로 직접 입력은 도입하지 않았다.

### 추가 변경 이력 (2026-08-12 — 참조 요청서 '없음' + 변경전/변경후 직접 입력)

- **개요**: 참조 요청서가 **없을 수도 있다**는 요구에 맞춰 STEP1 참조 블록에 **있음/없음 라디오**를 넣고,
  변경전/변경후 표를 **직접 입력·엑셀 붙여넣기로 채울 수 있게** 했다. 기획·화면은 `docs/merge_manual_input_plan.html`(동작 데모 포함) 참조.
  **백엔드·마이그레이션 변경 없음**(값은 모두 `additional_notes` JSON).

- **모드**(`detail.merge_ref_mode` = `'ref' | 'none'`, `detail.merge_applied`):
  - `ref` — 기존 그대로. 참조 문서를 고르고 `Merge` → 3-way 반영 + `computeBeforeAfter` 로 비교 표 생성.
  - `none` — `Merge` 를 누르면 **참조 = 없음 으로 확정**(입력란에 `없음` 표시·라디오 잠금)되고 변경전/변경후 표가
    **양쪽 미등록 1행**으로 열린다. 확인 모달·3-way 반영·`mergeSnapshot` 은 없고 **J/O 표(STEP2·3)와 연동되지 않는다**.
    짝지을 참조가 없으므로 BEFORE/AFTER 매핑 표(①)는 감춘다(`BeforeAfterPanel` 의 `manualOnly`).
  - **모드 전환은 항상 확인 모달**(`merge_mode_change_*`)을 거치고, 확인해야 **초기화 + 전환**이 함께 일어난다.
    취소하면 라디오도 원래 값 그대로다. 확인 시 스냅샷이 있으면 J/O 를 Merge 직전으로 되돌린다(`rollbackMergeSnapshot`).
  - **버튼 이름은 기존 `Merge` 유지**(표 ① 의 확정 버튼 `적용` 과 이름이 겹치지 않도록).

- **표 직접 입력**(`BeforeAfterPanel`): **자동 생성된 짝을 포함해 모든 행**을 편집한다.
  - 입력 대상은 `process_id`/`SP`/`SD`/`PP` **4칸**(`MERGE_MANUAL_FIELDS`). `layer` 는 컬럼을 유지하되 **읽기 전용 `—`**.
  - **미등록**: 새 행은 양쪽 미등록으로 시작한다. 미등록 셀을 클릭하면 입력 칸으로 바뀌고, 4칸을 모두 비운 채 포커스를 벗어나면
    다시 미등록(`null`)으로 접힌다. `✕`(행 삭제) 옆의 **`↺`** 로 그 행을 양쪽 미등록으로 되돌린다.
  - **붙여넣기**: 커서 위치와 무관하게 **항상 그 쪽 첫 칸(`process_id`)부터** 채운다(`parseMergePasteRows`).
    5열 이상은 앞 4열만 쓰고, 4열 미만이면 채운 칸만 반영한다. 행이 모자라면 새 행을 만들어 **행 수가 양쪽 함께** 늘어난다
    (한 행 = 변경전+변경후 한 쌍이라 행 수 동기화는 구조적으로 보장된다).
  - **구분**(J-ayer/O-ayer): 행마다 드롭다운으로 고른다. 새 행 기본값은 `MERGE_DEFAULT_TABLE`(J), 직전 행의 구분을 따라간다.
  - **판정**: 사용자가 고르지 않고 `deriveMergeKind` 가 미등록 여부로 계산한다 — 변경전 미등록 `추가` / 변경후 미등록 `삭제` /
    양쪽 값 있음 `변경` / 양쪽 미등록 `미작성`(`empty`, 게이트가 막는다).
  - **값 비교 강조**: 양쪽에 값이 있는 행만 컬럼끼리 대조해 다른 칸을 강조한다(기존 `.ba-cell-changed` 규칙, 입력 즉시 갱신).

- **게이트 추가**(`addBaGateError`, `validateMergePairs`): 기존 `AFTER 미매핑 0` 에 더해
  **① 미등록이 아닌 쪽은 4칸 필수**(`ba_gate_manual_incomplete`) **② 양쪽 미등록인 빈 행 0건**(`ba_gate_manual_blank_row`)
  **③ `none` 모드는 유효 행 1건 이상**(`ba_gate_manual_empty`). `layer` 는 수기 대상이 아니라 검사하지 않는다. 임시저장은 여전히 차단하지 않는다.

- **저장 필드**: `MergePair.id`(행 식별자) 추가 — 자동 생성 짝은 출처 id 로 만든 **결정적 값**(`autoPairId`)이라
  `computeBeforeAfter` 의 순수성이 유지된다. 구버전 문서는 로드 시 `id`(`genId`)·`kind`·`merge_ref_mode`(`'ref'`)·
  `merge_applied`(참조 문서 id 유무)로 백필한다.

- **상세 페이지**: `MergePairsTable` 은 읽기 전용 그대로이되 판정을 저장값 대신 `deriveMergeKind` 로 계산해 작성 화면과 항상 일치시킨다.
  전 행 편집이 가능해졌으므로 `ba_detail_note` 를 **'작성자 편집 반영'** 으로 바꿨다(기존 'Merge 시점 기준').

- **i18n**(ko/en 동시 15개): `merge_mode_ref`·`merge_mode_none`·`merge_ref_none`·`merge_none_done`·`merge_mode_change_title/confirm`,
  `ba_kind_empty`·`ba_add_row`·`ba_reset_row`·`ba_cell_edit_hint`·`ba_paste_hint`·`ba_gate_manual_empty/incomplete/blank_row`, `ba_detail_note` 문구 변경.

- **테스트**: `helpers.test.ts` 에 26건 추가(`isMergeSideEmpty`/`normalizeMergeSide`/`deriveMergeKind`/`parseMergePasteRows`/
  `emptyMergePair`/`validateMergePairs`) → 파일 84건 통과, 프론트 전체 **145건 통과**. 백엔드 279건 통과(변경 없음).
  `draftRoundTrip.test.tsx` 픽스처를 신규 `merge_pairs` 형태(행 id·판정·모드 포함)로 갱신했다.

- **알려진 제약**: ① `none` 모드의 값은 J/O 표와 연동되지 않는다(의도 — 기록 전용).
  ② 자동 생성 행도 편집 가능해져 `merge_pairs` 는 더 이상 'Merge 시점 스냅샷'이 아니다(문구를 함께 바꿨다).
  ③ 3-way `computeLayerMerge` 는 이번에도 손대지 않았다.

### 추가 변경 이력 (2026-08-04 — BEFORE/AFTER 완전 일치 선소진 + 행 단위 선택 표시)

- **개요**: 참조 요청서 Merge 의 BEFORE/AFTER 비교에서 **완전 일치 짝이 모호 판정에 휩쓸려 미매칭으로 뜨던 문제**를 고치고,
  매핑 표의 행 선택 표시를 bb 매핑과 동일한 **행 단위 테두리**로 바꿨다. **백엔드·마이그레이션·i18n 키 변경 없음.**

- **① 완전 일치 선소진**(`helpers.ts` `computeBeforeAfter`):
  - **증상**: A=[X], B=[Y, Z] 에서 X 와 Y 는 5개 값(`process_id`/`sp`/`sd`/`pp`/`layerid`)이 모두 같고,
    Z 는 X 와 `process_id`·`layerid` 만 같고 `sp`/`sd`/`pp` 중 하나가 다른 경우.
    세 행이 같은 그룹 키(`process_id + layerid`)로 묶여 "A 1행·B 2행 → 모호" 분기에 걸려 **X·Y·Z 가 전부 BEFORE/AFTER 표로** 밀려났다.
    완전 일치를 제외하는 `baSame` 검사가 `a.length === 1 && b.length === 1` 일 때만 돌았기 때문이다.
  - **수정**: 그룹 판정 **전에** 5개 값이 모두 같은 A↔B 짝을 먼저 소진한다(`sameCount += 1`, 어느 표에도 싣지 않음).
    남은 행에만 기존 4개 분기(자동 1:1 `changed` / `added` / `deleted` / 모호→미매칭)를 적용한다.
    위 예시는 X↔Y 가 '변경 없음'으로 빠지고 **Z 만 `BEFORE=미등록`(`added`) 으로 자동 확정**되어 BEFORE/AFTER 표가 비고 게이트를 통과한다.
  - **한 A 행은 한 B 행만 소진한다** — 소진된 A 행을 남은 B 행과 다시 짝지어 복제하지 않는다.
    재사용이 필요하면 BEFORE/AFTER 표에서 사용자가 직접 1:N 매핑한다(기존 동작 유지).
  - 완전 일치가 1단계로 이관되어 1:1 분기 안의 `baSame` 검사는 제거했다(그 시점엔 반드시 '변경'이다).
  - **3-way `computeLayerMerge` 는 손대지 않았다** — 비교 키가 다른 별개 계산이다(위 2026-08-03 항목 참조).

- **② 행 단위 선택 표시**(`styles/global.css` `.ba-pick*`):
  - **증상**: `.ba-pick-selected td { box-shadow: inset 2px 0 0 var(--accent) }` 가 **각 `td` 마다** 왼쪽 2px 파란 막대를 그려
    선택한 행에 칼럼 개수만큼 세로선이 생겼다.
  - **수정**: 배경·테두리를 `tr` 로 올려 bb 매핑(`.bb-jayer-selected`)과 동일하게 `outline: 1px solid var(--accent)` 한 줄로 감싼다.
    `.ba-pick:hover`(특이도 0,2,0)에 지지 않도록 `.ba-pick.ba-pick-selected` 로 특이도를 맞추고 뒤에 배치했다.
    `outline-offset: -1px` 은 `.ba-pane-scroll`(`overflow: auto`)에서 테두리가 잘리지 않게 한다.
  - `BeforeAfterPanel.tsx` 는 이미 `tr` 에 클래스를 주고 있어 **수정 없음**(CSS 만 변경).

- **테스트**: `helpers.test.ts` 에 `computeBeforeAfter` **4건 추가**
  (사용자 시나리오 X/Y/Z · 완전 일치 제외 후 1:1 `changed` · 완전 일치 제외 후 잔여만 미매칭 · A 1행이 동일 B 2행을 모두 소진하지 않음).

### 추가 변경 이력 (2026-08-04 — ADI CD 변경: 변경전/변경후 스텝 표)

- **개요**: `기타 목적 > ADI CD 변경`은 특정 제품의 ADI CD 스텝 개수를 늘리거나(10→13) 줄이거나(10→7) 전부 삭제하는 요청에 쓰는데,
  변경 전/후 스텝 정보를 기록할 곳이 없었다. **변경전/변경후 2컬럼 표(`STEP_ID`/`STEP_DESC`)**를 STEP1에 추가했다.
  이 목적은 **단독 전용이 아니다** — 다른 기타 목적과 함께 선택할 수 있다. **백엔드·마이그레이션 변경 없음**
  (`detail`은 `additional_notes` JSON 문자열로 저장되고, 결재 라우팅은 `request_purpose`만 사용한다).

- **저장 필드**(`DetailFormState`): `adi_cd_before`/`adi_cd_after`(`AdiCdStep[]`, `{ id, step_id, step_desc }`) · `adi_cd_delete_all`(boolean).
  구버전 문서는 로드 시 `[]`/`false`로 백필한다.

- **진입/해제**(`index.tsx`): 기타 목적 버튼에서 `ADI CD 변경`을 켜면 `handleSelectAdiCdPurpose`가 양쪽 표에 빈 5행
  템플릿을 깐다(`ADI_CD_TEMPLATE_ROWS`). 재클릭(해제)은 표에 값이 있으면 `ConfirmModal` 확인 후 초기화(`exitAdiCd`),
  없으면 바로 해제한다.
  ~~`detail.map_type`을 `'ADI'`로 자동 고정하고, 해제 시 `'ADI'`였을 때만 되돌리던 동작~~ → **2026-08-13 제거**
  (아래 "StepMap 잠금 제거" 항목 참조).

- **StepMap 잠금 — 2026-08-13 제거**: `map_type` 4버튼(`NEW`/`CLONE`/`EXISTING`/`MAP 삭제`)을 `detail.map_type==='ADI'`
  동안 전부 비활성화하고 안내 문구(`map_type_adi_fixed`)를 띄우던 동작을 완전히 삭제했다. `ADI_CD_MAP_TYPE` 상수·
  i18n 키(`map_type_adi_fixed`) 및 이미 미사용 상태였던 `map_type_adi`도 함께 제거했다(잔여 코드 정리).
  이제 `ADI CD 변경`을 선택해도 map_type 은 건드리지 않으므로, 사용자가 NEW/CLONE/EXISTING/MAP 삭제 중 실제
  map_type 을 StepMap 에서 직접 골라야 한다.

- **붙여넣기 파싱**(`helpers.ts`, 순수 함수 — `parseClipboardTable`/`detectAdiCdHeader`/`decideAdiCdPaste`/`buildAdiCdRows`/`validateAdiCdRows`):
  입력은 `text/plain`(엑셀 TSV). 인용 인식 TSV 분해 → 위에서부터 최대 5행 안에서 `STEP_ID`/`STEP_DESC` 헤더 탐색
  (공백·언더스코어·대소문자 정규화, 열 순서 무관) → 헤더 행 아래 두 열만 취해 `.trim()`, 두 값 모두 빈 행은 드롭 →
  500행 초과·결과 0행은 거부. 표에 이미 값이 있으면 `ConfirmModal` 확인 후 전체 교체(`AdiCdPanel`은 원문 텍스트만
  올려보내고, 파싱·모달 판정·적용은 상태를 소유한 `index.tsx`가 한다).

- **컬럼 매핑 모달**(`AdiCdColumnMapModal.tsx`, 신규): 2열+헤더 인식 성공만 모달 없이 즉시 적용, 그 외(3열 이상 또는
  헤더 인식 실패)는 모달을 띄운다. 인식된 열이 있으면 미리 선택해 두고, 헤더 인식 실패 시 "첫 행을 헤더로 제외"
  체크박스는 꺼진 채로 시작한다(헤더 여부 판단을 사람에게 맡긴다). `STEP_ID`/`STEP_DESC` 헤더 라벨은 의뢰자가
  엑셀 원본과 대조해야 하므로 **번역하지 않는다**.

- **표 UI**(`AdiCdPanel.tsx`, 신규): 좌 변경전/우 변경후, 셀 단위 편집(빈 2컬럼 템플릿에서 시작), 행 추가/삭제,
  오류 셀 하이라이트(`validateAdiCdRows`를 그대로 재사용 — 게이트가 보는 값과 항상 같다). 변경후 상단 "전체 삭제"
  토글은 켜면 AFTER를 비우고 비활성화하며, **변경전에 유효 행이 없으면 선택할 수 없다**(삭제할 대상이 없으므로).

- **게이트**(`addAdiCdGateError`, `addBaGateError`와 동일 패턴 — `validate(1)`·`validate(5)` 양쪽에서 호출):
  ADI CD가 켜져 있으면 다른 목적과 함께 선택해도 항상 적용된다. BEFORE/AFTER 각각 독립 검사(AFTER는 전체 삭제 시
  검사 제외) — ① 유효 행 1개 이상 ② 불완전 행(한쪽만 채움) 0개 ③ `STEP_ID` 중복 0개. 중복·불완전은 붙여넣기를
  거부하지 않고 표에 남겨 셀을 오류 표시한 뒤 게이트에서만 막는다(그 자리에서 고칠 수 있게).

- **필수 입력 우회 — 2026-08-13 완전 제거**: `ADI CD 변경`만 단독 선택했을 때(`isAdiCdOnly`) STEP4(Partial Shot·
  O-ayer st/new_or_copy·O-ayer 차용 필수)를 건너뛰던 우회를 없앴다(`validate()`의 `if (currentStep === 4 &&
  !isOnlyMap && !isAdiCdOnly)` → `!isOnlyMap`만 남김, `isAdiCdOnly` 변수 자체도 삭제). Backbone 조합 영역
  (`bb_entries`) 몫은 이미 2026-08-12 에 제거되어 있었으므로(§4.1 해당 항목), 이번 제거로 **ADI CD 관련 STEP 필수
  입력 우회는 전부 사라졌다** — ADI CD 단독이어도 다른 목적과 동일하게 정상 검증을 받는다.
  O-ayer 표를 비워 두면(행 없음) `findEmptyStNocViolations`가 빈 배열에 위반이 없다고 자연히 판정하므로, 별도
  예외 로직 없이 "표가 비었으면 검사 대상이 없다"는 일반 규칙만으로 동일한 결과를 얻는다.

- **`scrollToFirstError` 조건 동기화 — 참고(과거 이슈)**: `partialShotMissing` 계산식은 `validate(4)`의 조건과
  항상 같아야 했다(2026-08 초 `!isAdiCdOnly` 누락으로 존재하지 않는 오류 때문에 탭이 잘못 전환된 적이 있다).
  이번 제거로 두 식 모두 `!isMapOnlyScope`만 남아 다시 동일해졌다 — 앞으로 `validate(4)`의 조건을 바꾸면 이
  계산식도 함께 바꿀 것.

- **저장 페이로드는 비우지 않는다**(`isMapOnlyScope` 에 ADI CD 를 넣지 않는다): `jayerRows` 는 프론트 표시용이
  아니라 백엔드 로직의 입력값이다 — `models.py has_ppid_plel()` 이 이 값으로 **E(MASK) 결재 단계 생성 여부**를
  정하고, `views.py _validate_jayer_bb_mapping()` 이 프론트 STEP5 와 **같은 Bb 매핑 규칙을 서버에서 이중 검증**한다.
  `[]` 로 비우면 둘 다 무력화되어, "J-layer 에 조회된 행이 있으면 Bb 매핑을 끝내고 상신한다"는 규칙이 깨진다.

- **문서 제목**: `MAP(${map_type})` 조립(`index.tsx`)에 실제 선택한 map_type이 들어간다.
  ~~자동 고정으로 `'ADI'`가 그대로 들어가던 동작~~ → **2026-08-13 제거**(위 "StepMap 잠금 제거" 항목 참조) —
  이제 ADI CD 변경 문서도 NEW/CLONE/EXISTING/MAP 삭제 중 사용자가 고른 값이 그대로 제목에 들어간다.

- **상세 페이지**(`PagedDetailView.tsx`): `MergePairsTable` 패턴으로 `AdiCdStepsTable`을 추가했다. 변경전/변경후 중
  하나라도 채워진 행이 있거나 전체 삭제가 켜져 있을 때만 STEP1 페이지에 카드로 노출한다.

- **i18n**: `request.adi_cd_*` 20개 + `request.map_type_adi`를 ko/en 동시 추가.

- **테스트**: `helpers.test.ts`에 `parseClipboardTable`·`detectAdiCdHeader`·`decideAdiCdPaste`·`buildAdiCdRows`·
  `validateAdiCdRows` 26건 추가. 전체 63건 통과. `npx tsc --noEmit` 전체 에러 24개로 이번 변경 전과 동일(신규 0).

### 추가 변경 이력 (2026-08-03 — 참조 요청서 Merge 3개 목적 공용화 + BEFORE/AFTER 비교)

- **개요**: 참조 요청서 Merge 를 `Layer 추가/삭제` 전용에서 **`STEPSEQ 변경`·`Overlay 변경` 까지 공용**으로 넓히고,
  A(참조)와 B(작성 중)의 차이를 **BEFORE/AFTER 매핑 표 + 변경전/변경후 표**로 보여주고 문서에 저장한다.
  기획·화면 설계는 `docs/merge_before_after_mockup.html`(클릭 가능한 mock 계획서) 참조. **백엔드·마이그레이션 변경 없음.**

- **노출 조건**: `MERGE_ENABLED_PURPOSES = ['Layer 추가/삭제','STEPSEQ 변경','Overlay 변경']`(`constants.ts`).
  `isMergePurposeSelected()` 로 판정해 **여러 개를 골라도 블록은 1개만** 노출한다(참조 요청서는 의뢰서당 1건이므로).
  3개를 모두 해제하면 참조·비교 상태를 비운다(J/O 표는 되돌리지 않는다 — 되돌리려면 '재선택').

- **`computeBeforeAfter(refJ, refO, curJ, curO)` 신설**(`helpers.ts`): `{ pairs, unmatchedBefore, unmatchedAfter, sameCount }` 를 돌려주는 **순수 함수**.
  비교 키는 **`process_id + layerid`** 이며(3-way 의 `computeLayerMerge` 키와 **의도적으로 다르다**), 그룹 단위로 판정한다.

| 그룹 안 A 행 수 | B 행 수 | 처리 | 가는 곳 |
|---|---|---|---|
| 1 | 1 | 5개 값(`process_id`/`sp`/`sd`/`pp`/`layerid`)이 모두 같으면 **제외**, 하나라도 다르면 자동 1:1 (`changed`) | 변경전/변경후 |
| N(≥1) | 0 | 각 행을 `AFTER=미등록` 과 자동 짝 (`deleted`) | 변경전/변경후 |
| 0 | N(≥1) | 각 행을 `BEFORE=미등록` 과 자동 짝 (`added`) | 변경전/변경후 |
| 둘 다 ≥1 이고 한쪽이라도 ≥2 | | **자동 매칭 안 함** — 사용자가 직접 매핑 | BEFORE/AFTER |

  - 비활성(`disabled`) 행과 `layerid` 가 빈 행은 비교 대상에서 제외한다. J-ayer 는 J-ayer 끼리만 비교·매핑한다.
  - 미매칭 행 id 는 `J_<rowId>` / `O_<rowId>` 로 접두사를 붙여 두 표 사이의 id 충돌을 막는다.

- **매핑 UI**(`components/BeforeAfterPanel.tsx`, STEP 1 인라인): BEFORE/AFTER 각 표의 첫 행은 항상 `미등록`(횟수 제한 없음).
  **양쪽 한 행씩 선택하면 `적용` 으로 즉시 확정**(스테이징 단계 없음)되고, `BEFORE 행은 목록에 남아 여러 번 재사용(1:N)`,
  AFTER 행만 목록에서 빠진다. 확정 표의 `✕` 로 해제하면 **BEFORE·AFTER 양쪽이 각자의 표로 복귀**하며,
  재사용 중이라 이미 목록에 있는 행은 중복 추가하지 않는다.

- **게이트**: `AFTER 미매핑 잔여 0` 이어야 다음 STEP 이동·상신이 가능하다(`addBaGateError` → `validate(1)`·`validate(5)`).
  **BEFORE 잔여는 허용**하며(3-way 가 이미 `layer삭제` 행으로 처리), **임시저장은 차단하지 않는다.**

- **재선택(영구 잠금 폐지)**: Merge 후에도 `재선택` 버튼으로 되돌릴 수 있다.
  `handleMergeConfirm` 이 3-way 반영 **직전**의 J/O 를 `mergeSnapshot` 에 담고, 저장 시 **`additional_notes.mergeSnapshot`**(detail 형제 키)로 남긴다
  → **임시저장 후 재진입·재상신 이후에도 J/O 완전 롤백**. 롤백으로 사라진 행에 걸린 bb 매핑·스테이징도 함께 정리한다.
  `mergeSnapshot` 은 detail 바깥이라 상세 페이지의 변경 이력 diff(detail 기준)에 잡히지 않는다.
  **정리 시점**: 재선택 완료 · 조리법(`process_id`) 변경 · Merge 목적 전체 해제 → `null`.

- **저장 필드**(`DetailFormState`): `merge_pairs`(확정 짝) · `merge_unmatched_before` · `merge_unmatched_after`.
  구버전 문서는 로드 시 `?? []` 로 백필한다. `merge_ref_doc_id`/`merge_ref_doc_label` 은 기존 그대로 쓴다.

- **상세 페이지**: `PagedDetailView` 의 `MergePairsTable` — `merge_pairs` 가 있을 때만 STEP 1 페이지에 카드로 노출.
  값은 **Merge 시점 스냅샷**이므로 제목 옆에 그 사실을 표기한다(Merge 이후 J/O 를 수동 편집하면 실제 표와 달라질 수 있다).

- **i18n**: `request.ba_*` 27개 + `merge_reselect*` 4개 + `toast_merge_reselect` 를 ko/en 동시 추가.
  영구 잠금 폐지에 맞춰 `merge_confirm_once_warning`·`merge_already_done` 문구를 '재선택으로 변경 가능'으로 고쳤다.

- **테스트**: `helpers.test.ts` 에 `computeBeforeAfter` **12건** 추가(자동 1:1·미등록 자동 짝·모호 그룹 미매칭·A3:B0·`layerid` 빈 행·비활성 행·J/O 독립·공백 정규화·멱등·빈 표). 전체 **32건 통과**.

- **알려진 제약**: ① `merge_pairs` 는 Merge 시점 기록이라 이후 J/O 수동 편집과 어긋날 수 있다(의도).
  ② `mergeSnapshot` 저장으로 `additional_notes` 가 커진다(J/O 행 수만큼, 대략 1.6~2배). `TextField`(MySQL `longtext`)라 한계는 없지만
  **목록 API 가 `additional_notes` 를 통째로 내려주므로** 문서가 쌓이면 목록 응답이 무거워질 수 있다(목록 직렬화 제외는 별도 과제).
  ③ 3-way `computeLayerMerge` 는 이번 범위에서 **손대지 않았다** — 키에 `layerid` 가 빠진 기존 이슈(아래 2026-08-02 항목)도 그대로다.

### 추가 변경 이력 (2026-08-02 — Layer 추가/삭제 Merge 3-way 판정 + 참조 1건 제한)

- **개요**: `Layer 추가/삭제` Merge 를 기획 의도대로 **3-way 판정**으로 재구현하고, 참조 요청서를 **의뢰서당 1건**으로 제한했다.
  참조 요청서를 A, 작성 중인 의뢰서를 B 라 할 때 J-layer 는 J-layer 끼리, O-layer 는 O-layer 끼리 **독립 비교**한다.

| 구분 | 조건 | `col_st` | `col_new_or_copy` |
|------|------|----------|-------------------|
| ① 신규 | **B 에만** 있음 | `O` | `신규` |
| ② layer 삭제 | **A 에만** 있음 → B 표에 행 추가 | `X` | `layer삭제` |
| ③ 기등록 | A·B **양쪽** 존재 | `X` | `기등록` |

- **"존재" 정의(핵심)**: `!disabled && new_or_copy !== 'layer삭제'`. `layer삭제` 는 그 시점에 **이미 지워진 layer** 이므로 **부재**로 본다.
  따라서 A 에서 `layer삭제` 인 layer 가 B 에 있으면 "A 엔 없던 것이 B 에 생김" → **①(신규)** 이 된다. A·B 양쪽에 대칭 적용한다.
- **`computeLayerMerge(curRows, refRows)` 신설**(`helpers.ts`): `{ merged, stats }` 를 돌려주는 **순수 함수**. 확인 모달의 미리보기와 실제 반영이
  **같은 함수 한 번의 계산**에서 나오므로 숫자와 표 결과가 구조적으로 어긋날 수 없다(기존에는 `makeKey`·매칭 로직이 두 핸들러에 복붙돼 있었다).
  - 비교 키 = `process_id||sp||sd||pp` (`layerid` 미포함, 각 값 `trim()` 정규화). 운영 데이터상 이 4개로 행이 유일하게 식별된다.
  - 비활성 행·이미 `layer삭제` 인 행은 **건드리지 않는다**.
  - ② 행 추가 시 **비활성이 아닌 모든 행(= `layer삭제` 포함)의 키**와 대조해 중복 행을 만들지 않는다.
  - ② 행은 `loaded:true`(원본 컬럼 읽기전용) + `disabled:false` 로 넣는다 — 필터에 걸려 숨겨지면 상신 저장에서 빠져 삭제 정보가 유실되기 때문.
  - `sortOrder` 는 `base + index` 로 부여(기존 `Date.now()` 는 같은 밀리초에 전부 동일값이 됐다).
- **참조 요청서 1건 제한**: `DetailFormState` 에 `merge_ref_doc_id: number | null` · `merge_ref_doc_label: string` 추가.
  Merge 완료 시 기록하고, 값이 있으면 **참조 선택 입력과 Merge 버튼을 모두 영구 잠근다**(`Step1.tsx` `isMergeDone`).
  `additional_notes.detail` 에 저장되므로 **임시저장 후 재진입·재상신에도 잠금이 유지**된다. 필드 도입 전 문서는 로드 시 `null`/`''` 로 백필한다.
  **DB 스키마·마이그레이션 변경 없음**(JSON 칼럼).
- **J↔O 동기화는 Merge 시점에 의도적으로 우회한다**: Merge 결과는 오직 A 기준이어야 하므로 `handleMergeConfirm` 은 `handleJayerChange` 를 거치지 않고
  `setJayerRows`/`setOayerRows` 를 직접 호출한다. Merge **이후** 수동 편집은 기존 J↔O 동기화 규칙(위 "J↔O 동기화" 항목)을 그대로 따른다.
- **i18n**: `toast_merge_complete`·`merge_confirm_counts` 를 3-way 로 교체하고 `merge_confirm_once_warning`·`merge_already_done` 추가(ko/en 동시).
- **상수화**: `NOC_NEW`·`NOC_BORROW`·`NOC_REGISTERED`·`NOC_LAYER_DELETE`·`ST_O`·`ST_X`(`constants.ts`). `isNocSpecial` 도 이 상수를 쓰도록 정리.
- **테스트**: `helpers.test.ts` 에 `computeLayerMerge` 12건 추가(①②③·A/B 의 `layer삭제` 부재 처리·중복 방지·비활성 행·공백 정규화·`sortOrder`·멱등성·빈 표·복합 시나리오).
- **남은 이슈**: B 의 **비활성** 행과 키가 같은 A 행은 여전히 ② 로 추가되어 표에 나란히 보인다(비활성 행은 상신 저장에서 제외되므로 최종 문서에는 남지 않는다).
  Merge 를 **되돌리는 기능은 없다** — 확인 모달의 경고로만 안내한다.

### 추가 변경 이력 (2026-08-02 — Layer 추가/삭제 Merge 하드코딩 i18n 이관)

- **개요**: `Layer 추가/삭제` 참조 요청서 Merge 기능에만 남아 있던 하드코딩 문자열을 `request.merge_*` 키로 이관했다. 동작 변경 없음(문구 출력 경로만 변경).
- **i18n 키 추가(ko/en 동시)**: `merge_ref_doc`(참조 요청서 라벨)·`merge_ref_placeholder`·`merge_ref_load_fail`(참조 문서 로드 실패 토스트)·`merge_button`(Merge 버튼)·`merge_confirm_title`(Merge 확인 모달 제목)·`merge_confirm_counts`(기등록/미매칭 건수 안내)·`merge_confirm_proceed`.
- **적용 위치**: `Step1.tsx` 참조 요청서 `AutocompleteInput`의 `label`/`placeholder`·Merge 버튼 라벨, `index.tsx`의 `handleRefDocSelect` 실패 토스트·Merge 확인 모달(제목·건수·진행 문구).
- **`Trans` 최초 도입**: 건수 안내는 숫자만 `<b>`로 강조하는 기존 UI를 유지해야 해 `react-i18next`의 `Trans`(`components={[<span />, <b />, <span />, <b />]}`)로 렌더링한다. 코드베이스에서 `Trans` 사용은 이 지점이 처음이며, 나머지 문자열은 기존 관례대로 `t()`를 쓴다.
- **미해결(별도 과제)**: Merge 매칭 키(`process_id||sp||sd||pp`)에 `layerid`가 빠져 있고 `Set` 중복 제거로 집계되어, **모달의 미매칭 건수가 실제보다 적게 나오고 해당 행이 병합에서도 누락**된다. 또한 `handleMergeConfirm`은 `setJayerRows`/`setOayerRows`를 직접 호출해 **J↔O `st`/`new_or_copy` 동기화(4.1 J↔O 동기화 항목)를 우회**한다. 이번 변경 범위 밖.

### 추가 변경 이력 (2026-07-31 — CLONE 원본 Part ID 8자리 코드 정리 + 대문자 자동 변환)

- **원본 Part ID 옵션을 "_" 앞 8자리 코드로 정리**: StepMap의 원본 위치/Part ID 블록(`map_type === 'CLONE'` 전용)에서, 원본 Part ID 후보 목록을 내려주는 백엔드 `form_options_mapname`(`backend/api/views.py`)이 `MapName.partid` 원본 값을 그대로 내려주던 것을, `partid.split('_')[0]`(첫 "_" 앞부분)만 추출 → **길이가 정확히 8자리(순수 문자 수 기준)인 값만** 필터링 → 중복 제거 → 정렬해서 반환하도록 수정.
- **직접 입력 시 대문자 자동 변환 + 8자리 제한**: 공용 컴포넌트 `AutocompleteInput`(`frontend/src/components/AutocompleteInput.tsx`)에 optional prop `uppercase`·`maxLength`를 추가(미지정 시 기존 동작 그대로라 다른 사용처는 영향 없음). `StepMap.tsx`의 원본 Part ID `AutocompleteInput`에 `uppercase maxLength={8}`을 적용해, 드롭다운 선택이 아니라 사용자가 직접 타이핑할 때 영문이 자동으로 대문자로 변환되고 최대 8자까지만 입력할 수 있다.

### 추가 변경 이력 (2026-07-30 — INTER 섹션 IN 적용 O/X + Xs/Ys/XYs/없음 필수 선택 그룹 추가)

- **개요**: `StepMap`의 `Inter`(3번) 항목에서 `YES` 선택 시 기존 `inter_xs`/`inter_ys`(적용/미적용 독립 토글, 필수 아님) 버튼을 제거하고, 그 자리에 아래 두 버튼 그룹을 추가했다.
  - **IN 적용 O / IN 적용 X** — 신규 필드 `in_apply: 'O' | 'X' | ''`. 클릭 시 토글이 아니라 클릭값으로 즉시 교체(다른 버튼은 자동 비활성) — `map_type` 버튼과 동일한 단일선택 동작(버튼 스타일은 이후 `map-type-btn`으로 재변경됨, 아래 2026-07-31 이력 참조).
  - **Xs / Ys / XYs / 없음** — 신규 필드 `inter_select: 'xs' | 'ys' | 'xys' | 'none' | ''`. 동일한 단일선택 버튼 방식. i18n 키 `map_opt_inter_xs`/`_ys`는 기존 키 재사용, `_xys`/`_none`은 신규 추가.
  - 두 그룹은 **서로 완전히 독립**적으로 동작(값 연동 없음).
- **검증**: `index.tsx`의 `validate()` step 2(`!isMapRegistered`) 블록에 `detail.inter === 'YES'`일 때 `in_apply`·`inter_select` 각각 미선택 시 `request.required` 에러 추가(기존 `map_reason`/`ea_value`와 동일 패턴). 즉 `IN 적용 O/X` 중 1개, `Xs/Ys/XYs/없음` 중 1개가 항상 필수.
- **NO 전환 시 즉시 초기화**: `Inter`를 `NO`로 바꾸면 확인 모달 없이 `inter_xs`/`inter_ys`(레거시)와 함께 `in_apply`/`inter_select`도 곧바로 `''`로 리셋되어, 화면에 보이지 않는 값이 실수로 저장되는 것을 방지한다. `handleMapTypeChangeConfirm` 등 MAP 필드 일괄 초기화 경로(2곳)에도 동일 리셋을 추가했다.
- **하위 호환**: 기존 `inter_xs`/`inter_ys` 필드·i18n 키(`approval.inter_xs_applied`/`_ys_applied`)는 삭제하지 않고 그대로 둔다. `PagedDetailView`는 `in_apply`가 있는(신규 작성) 문서는 새 값으로, 없는(레거시) 문서는 기존 `inter_xs`/`inter_ys` 배지로 표시한다.
- **화이트리스트 동기화**: 프론트 `MAP_DETAIL_KEYS`(`constants.ts`)와 백엔드 `RequestDocument.MAP_APPLY_KEYS`(`models.py`)에 `in_apply`·`inter_select` 동시 추가. `detail`은 `additional_notes` JSON 저장이라 마이그레이션 불필요. ※ 두 상수는 2026-08-05 삭제됨(`in_apply`·`inter_select` 저장은 그대로).

### 추가 변경 이력 (2026-07-31 — StepMap 버튼 스타일 통일 + 상세보기 INTER 표시 개선)

- **버튼 스타일 `map-type-btn` 통일**: 위 IN 적용 O/X·Xs/Ys/XYs/없음 2개 그룹과 기존 **Map Option(10개 토글)** 이 쓰던 `map-option-btn`(채워진 배경 활성 스타일)을 `map-type-btn`(외곽선 강조 활성 스타일, MAP 요청 목적 버튼과 동일)으로 통일했다. 이로써 `map-option-btn`을 쓰는 곳이 없어져 `global.css`에서 해당 클래스 정의를 삭제했다.
- **인라인 스타일 토글 버튼도 `map-type-btn`으로 통일**: `StepMap`의 **REV Layer 드래그 다중선택 버튼**, `Step3`의 **TBV/TLV SD 선택 버튼**이 각각 하드코딩된 인라인 스타일(파란 배경 활성)을 쓰고 있던 것을 `map-type-btn` 클래스로 교체했다. **스타일만 변경**했고 드래그 다중선택·단일선택 동작 로직은 그대로다.
- **상세보기 INTER 블록 상시 노출 + "없음" 표시**: `PagedDetailView`의 MAP 탭에서 `Inter`(3번) 블록이 기존에는 `inter === 'YES'`일 때만 렌더링되던 것을 **항상 렌더링**하도록 바꾸고, `NO`일 때는 Map Option 블록과 동일하게 회색 `없음` 텍스트를 표시한다. `YES`일 때 표시 로직(신규 `in_apply`/`inter_select` vs 레거시 `inter_xs`/`inter_ys` 배지)은 기존과 동일하다.

### 추가 변경 이력 (2026-07 — Validation System 대상/비대상)

- **저장 위치**: `additional_notes` JSON 의 `detail` 하위. 모델 필드가 아니므로 마이그레이션이 없다.

| 키 | 값 | 설명 |
|---|---|---|
| `validation_system` | `'YES'`(대상) / `'NO'`(비대상) / `'NA'`(해당없음) | 현재 유효값. **판정 주체는 상신자 하나** — 상신 시 정하고, 결재 중에도 상신자 본인만 바꾼다. MASK(E) 팀은 확인 후 합의만 한다 |
| `validation_system_submitted` | `'YES'` / `'NO'` / `'NA'` | 상신·재상신 시점의 상신자 값. 이후 상신자가 결재 중에 바꿔도 유지돼 '상신 시 판단'과 '현재 값'의 차이를 남긴다. 임시저장에는 기록하지 않는다 |
| `validation_system_changed_by` | 문자열 | 마지막으로 값을 바꾼 사람(이름 또는 loginid). 상신 시점에는 기록되지 않고, 결재 중 변경 시에만 남는다 |
| `validation_system_changed_at` | ISO 8601 문자열 | 마지막 변경 시각 |

- **3상태의 의미**: 판정 키워드(`plel`)가 J-layer 에 **하나도 없으면** 판정 자체가 성립하지 않으므로 `'NA'`(해당없음)이고, 이때는 **E(MASK) 단계도 결재 경로에 생성되지 않는다**(`docs/APPROVAL.md` Case E). 키워드가 있으면 자동 판정은 `'YES'`(대상)이며, 상신자가 토글로 `'NO'`(비대상)를 고를 수 있다 — 그 판단이 맞는지 검증하는 것이 MASK(E) 단계의 역할이다. 즉 `'NO'` 는 자동 판정으로는 나오지 않는다.
- **자동 판정**: `autoValidationSystem()`(`RequestPage/helpers.ts`) — 활성(비-disabled) J-layer 행의 `pp` 에 키워드가 하나라도 있으면 `'YES'`, 아니면 `'NA'`. 판정 단일 소스는 이 프론트 함수이며, 백엔드는 저장된 값을 그대로 신뢰한다. 다만 **E 단계 생성 여부만은** 백엔드 `RequestDocument.has_ppid_plel()` 이 저장된 `jayerRows` 를 직접 스캔해 결정한다(상신 시 disabled 행은 저장에서 제외되므로 두 판정 기준은 일치한다).
- **상신 UI**: 위저드 3단계(J-layer) 표 상단 토글. J-layer 가 바뀌면 자동 판정으로 값이 갱신되지만, 상신자가 토글을 직접 누르면 이후에는 J-layer 를 고쳐도 자동 갱신하지 않는다. **단 키워드가 전부 사라지면** 수동 설정 이력과 무관하게 `'NA'` 로 되돌아가고 토글이 비활성(희미 + '해당없음' 표기)된다 — 그러지 않으면 저장값은 `'NO'` 인데 E 단계는 생기지 않는 불일치가 남는다.
- **상신자 변경 (결재 진행 중)**: `POST /api/documents/<id>/validation-system/` — body `{"value": "YES"|"NO"}`. 인가는 **상신자 본인 또는 MASTER**. 수정 창은 `status ∈ {under_review, pause}` 이면서 **E(MASK) 단계가 통과되기 전**까지 열린다(백엔드 `_stage_reviewers_complete(doc,'E',round)` 가 판정 — E 담당자 합의 + **EV 중 1명** 합의(OR)로 닫힌다). 값 변경 시 `validation_system_changed_by/at` 이 함께 기록되고, `validation_system_submitted` 는 바뀌지 않는다.
  - **되감지 않는다 (2026-08-06)**: E 담당자가 이미 합의한 뒤 값이 실제로 달라져도 `E`/`EV` step 의 `action` 은 그대로다. 변경 사실만 E step `comment` 에 `[값 변경 …]` note 로 덧붙는다(`backend/api/views.py` `_note_validation_system_change`). `EV` step 도 삭제되지 않으므로, 아직 아무도 합의하지 않았다면 이후 합의하는 검토자가 **바뀐 값을 보고** 판단한다. 응답에 `rewound` 필드는 없다. ⚠️ E 담당자 본인의 재확인은 강제되지 않는다 — 되감기가 만들던 잠금·이력 소실보다 낫다고 판단해 의도적으로 택한 트레이드오프이며, 그래서 `comment` note 가 유일한 감사 추적이다(`docs/APPROVAL.md` 2026-08 항목 참고).
- **MASK 는 값을 바꾸지 않는다**: `approve-step` 의 `validation_system` 수용은 제거됐다. MASK 가 이견이면 `reject-step` 이 **수정 요청**으로 동작한다(§`docs/APPROVAL.md`).
- **레거시 문서**: 두 키가 없는 문서는 저장된 `jayerRows` 로 그때그때 폴백 판정해 보여준다(위저드 J-layer 단계·MASK 담당자 합의 모달·상세보기 J-layer 탭 공통).
- **사내 용어 교체 (⚠️ 여기 한 곳만 고친다)**: 저장소에 커밋된 `Validation System` 은 **가명**이다. 사내 정식 용어로 바꿀 때는 `frontend/src/locales/ko.json` 과 `en.json` 의 **`request.validation_system` 값 한 줄씩**만 고치면 된다. 작성 3단계 J-layer 표 상단 라벨, 상세보기 J-layer 탭 라벨, 전체 가이드 결재 경로 주석(`approval.route_diagram.note_e`)이 모두 따라 바뀐다 — 뒤의 두 문구는 값 안에서 i18next 중첩 참조 `$t(request.validation_system)` 로 이 키를 가리키기 때문이다.
  - **다른 문구에 용어를 직접 쓰지 말 것.** 새 문구가 필요하면 반드시 `$t(request.validation_system)` 으로 참조한다. 하드코딩하면 `frontend/src/locales/terminology.test.ts` 가 실패한다.
  - **변수·상수·키 이름(`validation_system`, `VS_TARGET`, `autoValidationSystem` 등)은 가명 그대로 둔다.** 사용자에게 보이지 않는다.
  - **`plel` 은 가명이 아니라 실제 사내 값**이라 교체 대상이 아니다(`VALIDATION_KEYWORD`, `RequestDocument.VALIDATION_KEYWORD`).
  - 백엔드 `views.py` 의 400 에러 메시지 `'유효하지 않은 Validation System 값입니다.'` 는 i18n 밖이라 자동 반영되지 않는다. UI 가 `YES`/`NO` 만 보내므로 요청을 직접 위조할 때만 노출되는 방어 메시지다.

### 추가 변경 이력 (2026-07 — O-layer 정보 탭 입력 잠금)

- **O-layer 정보 탭(Partial Shot·TBV/TLV) 잠금**: `Step3.tsx`에 `oayerInfoLocked` prop 추가(`index.tsx`에서 `isOnlyMap`으로 계산). Partial Shot O/X 토글, TBV/TLV 두께 토글, SD 선택 버튼, 비고 X/Y/사용여부 입력·행 추가/삭제, TBV/TLV 항목 추가/삭제 버튼 전체에 `disabled` 적용.
  > 도입 당시에는 `Only MAP`·`완성된 MAP 변경` 두 모드가 대상이었으나, 후자는 2026-08-05 삭제되어 현재는 `Only MAP` 전용이다.

### 추가 변경 이력 (2026-07 — 재상신 변경이력 표시 개선)

- 상세 보기(`PagedDetailView`)의 재상신 변경 강조를 4가지로 확장. 상세는 `docs/APPROVAL.md` §7 참조.
  - **엠샷/생산정보/REV 블록**: 빨간 테두리 + **'이력 확인'** 버튼(이전/현재 비교 모달) 추가.
  - **J/O/BB 표 이력**: 세로 3열 → **원본 표 형식 가로 비교**(변경 전/후 2행, 바뀐 셀 강조).
  - **O-ayer 정보탭**(Partial Shot·TBV/TLV): 누락돼 있던 변경 강조·이력 확인·탭 배지 추가.
  - **n회차 이력**: `FieldHistoryModal`에 회차별 변경(최초/변경됨/변경 없음) 열 추가. `history[]` 누적 구조는 불변.

### 추가 변경 이력 (2026-08 — 엠샷 이력 모달 이미지 표시)

- 「엠샷 변경 이력」 모달의 첨부 이미지 행이 **파일 경로 문자열**(`mshot_images/mshot_….png`)로 보이던 것을 **썸네일 이미지**로 바꿨다. 대상은 `mshot_image_copy` / `_top` / `_bottom` 3종.
  - `PagedDetailView.tsx`의 `DiffRow` 에 선택적 `kind?: 'text' | 'image'` 추가. `buildMshotRows` 의 이미지 행에만 `kind: 'image'` 를 부여하므로 **생산정보·REV 이력 모달은 종전과 동일한 텍스트 표시**다.
  - `FieldGroupHistoryModal` 은 `kind === 'image'` 이고 값이 있을 때만 `<img src={/media/<경로>}>` 를 그린다. 값이 비면(신규 첨부의 '변경 전', 삭제의 '변경 후') 기존과 같이 `-` 로 둔다 — 빈 `src` 로 깨진 이미지가 뜨는 것을 막는다.
  - 썸네일 크기 상수: `DIFF_THUMB_MAX_WIDTH=220` / `DIFF_THUMB_MAX_HEIGHT=150` (블록 본체의 300×200 보다 작게 두어 변경 전·후가 한 화면에 들어온다). 경로 prefix 는 `MEDIA_URL_PREFIX='/media/'`.
  - 테두리 색은 표의 기존 색 규칙을 따른다 — 변경 전 `#dc3545`, 변경 후 `#155724`. 확대(클릭) 동작은 없다.

### 추가 변경 이력 (2026-08 — 이력 확인 모드 이원화)

상세 보기의 '이력 확인'이 **화면에 따라 다르게 동작**한다. `PagedDetailView` 의 `historyMode` prop 하나로 갈리며, `HistoryPage`(승인 완료 문서 전용, `status=approved`)에서만 `true` 다. `ApprovalPage`는 넘기지 않으므로 기본 `false`.

| | 결재 진행 중 (`ApprovalPage`) | 이력 조회 (`HistoryPage`) |
|---|---|---|
| 강조·버튼 조건 | **직전 회차와 다를 때만** | **전 회차 중 한 번이라도 변경** |
| 모달 내용 | **변경 전 / 변경 후만** | **회차별 전체**(1차·2차·…·현재) |

- 대상은 9곳 전부 — 칩 14종 / O-layer 정보탭 3종 / 엠샷 / 생산정보 / REV / 지도 옵션 / J-ayer·O-ayer·뼈찜 표 행.
- **진행 중 통일**: 종전에 칩·O-layer 정보탭만 회차별 표(`FieldHistoryModal`)로 뜨던 것을 전/후 2열로 바꿔 나머지와 맞췄다. `FieldHistoryModal` 이 `historyMode=false` 면 `FieldGroupHistoryModal` 로 위임한다.
- **회차 축**: `roundSnaps: RoundSnapshot[]` = `history[]` + 현재값을 한 배열로 묶은 것. 이력 UI 전부가 이 배열 하나를 공유한다(결재 경로 섹션의 `rounds`(회차 번호 배열)와 다른 값이라 이름을 구분했다).
- **판정 함수**: `computeEverChangedFields`(인접 회차 diff 합집합) / `computeTableEverChanged`(행 단위). 값이 되돌아온 필드(A→B→A)도 이력 조회에서는 잡힌다.
- **회차별 모달 3종 추가**: `FieldGroupRoundHistoryModal`(행=항목, 열=회차 · 이미지 셀은 썸네일) / `RowRoundHistoryModal`(표 행: 행=회차, 열=필드) / 지도 옵션은 회차별 태그 목록.
- **표 행 매칭**: `matchPrevRows` — 강조 판정(`computeTableDiff`)과 회차별 모달(`buildRowTimeline`)이 **같은 함수**를 쓰므로 판정과 내용이 어긋나지 않는다. 세 단계를 순서대로 시도한다.
  1. **id** — 손대지 않은 행. 회차 간 겹치는 id 가 **하나도 없으면**(표가 통째로 재생성된 경우) 위치(index) 폴백.
  2. **`sourceJayerRowId`** — bb 행 전용. **(2026-08 추가)** J-ayer 행을 고치면 매핑된 bb 행이 삭제되고(`unmapJayerRows`), 다시 지정하면 **새 id 로 만들어져 배열 끝에 붙는다**(`handleApplyMappings` → `makeBbRow`). id 로는 짝을 못 찾지만 **어느 J-ayer 행에서 왔는지**는 남으므로 그 값으로 이전 지정을 찾는다. 한 J 행에 bb 행이 여럿이면 **등장 순서대로** 짝짓는다.
     - `entryId` 는 키로 쓰지 **않는다** — 지정이 바뀌면 그 값 자체가 바뀌어 짝이 깨진다.
     - 이 덕분에 **같은 외부 데이터를 다시 고른 재지정은 변경으로 잡히지 않고**, 다른 데이터를 골랐을 때만 이전 지정과 비교돼 강조된다. (종전에는 id 가 달라져 무조건 "새 행"으로 잡히고, 그러면서도 버튼은 안 떠 **빨갛기만 하고 눌러볼 수 없는 행**이 남았다.)
  3. 짝이 없으면 **이번 회차에 새로 생긴 행**(J-ayer 신규 행에서 온 bb, 수기 추가 행 등)이다. 이때도 모달을 열 수 있고 **변경 전 = `(없음)`** 으로 보여준다(`RowDiffModal.prevRow` 가 `null` 허용). 표 3종 공통 동작이다.
- **이력 버튼 노출**: `canOpenRowHistory` 는 **이전 회차가 있으면**(`rounds.length > 1`) 띄운다. 종전처럼 "직전 회차에 짝이 있을 때"로 막지 않으므로, 강조만 되고 눌러볼 수 없는 행이 남지 않는다.
- **블록 빌더 시그니처 변경**: `buildMshotRows(prev, cur)` → `buildMshotItems(d)` (생산정보·REV 동일). 한 회차만 받는 순수 함수라 전/후 표와 회차별 표가 같은 함수를 공유한다. 전/후 표는 `toDiffRows` 로 조립한다.
- 전체 가이드 투어는 `ApprovalPage` 기준(`open-rowdiff`)이므로 종전 전/후 모달 그대로다.

### 추가 변경 이력 (2026-08 — 이력 누락·오탐 3건 수정)

**1. 흐름도(flow_chart) 이력 신설** — 그동안 이력 UI 가 아예 없어 값이 바뀌어도 표시되지 않았다.
- 섹션 카드에 빨간 테두리 + '이력 확인'(`flowChanged = changedFields.has('flow_chart')`).
- **블록 단위**로 표 전체를 구간별로 쌓아 보여준다(`renderFlowHistory`) — 진행 중은 `변경 전`/`변경 후`, 이력 조회는 회차별. 흐름도는 행 추가·삭제가 잦아 행끼리 짝지어 비교하면 늘고 준 것을 놓치기 때문에 행 단위를 쓰지 않는다.

**2. 표로 입력한 항목을 이력에서도 표로** — REV `Layer / GDS`, O-ayer 정보탭 `TBV/TLV` 가 `G1: L1,L2` / `[3] (1,2:O)` 같은 한 줄 문자열로 눌려 있었다.
- `DiffItem`/`DiffRow` 에 `kind: 'table'` 과 `DiffTable { headers, rows }` 추가. `buildRevTable`(GDS·Layer) / `buildTbvtlvTable`(SD 선택·No·X·Y·사용여부)이 원본 입력 표와 같은 열 구성을 만든다.
- `DiffMiniTable` 이 렌더하며 **다른 쪽과 값이 다른 셀만 강조**한다(진행 중: 전=빨강/후=초록, 이력 조회: 직전 회차 대비 빨강). 상대 쪽에 없는 행은 행 전체가 강조된다. 셀 강조가 있으므로 그 행에는 행 전체 배경색을 입히지 않는다.
- TBV/TLV 는 `FieldHistoryModal` 경로라 `buildTable` prop 으로 주입한다. 구버전(자유 입력 `note`) 저장분은 좌표 행이 없어 SD 칸에 `SD (note)` 형태로 함께 적어 값을 잃지 않는다.

**3. J/O/BB 표 변경 오탐 제거 [동작 변경]** — 아무것도 고치지 않아도 이력이 뜨던 문제.
- 원인: `rowContentSig` 가 `id·sortOrder·disabled·sourceJayerRowId` 만 빼고 **나머지 전 필드**를 비교했다. 화면에 없는 `loaded`·`manuallyDisabled`·`entryId`·`entryIdx` 가 포함됐는데, 이 값들은 재상신 편집 로드 때 시스템이 재계산·백필한다(`RequestPage/index.tsx:855-877`).
- 수정: **비교 기준 = 이력 모달의 표시 컬럼**. 컬럼 정의를 모듈 상수 `JAYER_DIFF_FIELDS` / `OAYER_DIFF_FIELDS` / `BB_DIFF_FIELDS` 로 올리고, `rowContentSig(row, fields)` · `computeTableDiff(cur, prev, fields)` · `computeTableEverChanged(..., fields)` 가 이를 받는다. 표 컴포넌트는 `toDiffFields(defs, t)` 로 같은 정의에서 라벨을 만든다.
- 정의가 한 곳이라 **행 타입에 새 내부 필드가 추가돼도 오탐이 재발하지 않는다**(종전 제외 목록 방식은 갱신을 빠뜨리면 그대로 버그였다).
- J-ayer 이력 모달의 `Layer` 컬럼은 원본 표 헤더에 없지만 **유지**한다 — 비교 기준이므로 빼면 `layerid` 변경이 이력에서 사라진다.

### 추가 변경 이력 (2026-07 — 조건부 필드 초기화 + REV i18n)

- **조건부 섹션 '해제' 시 하위 값 초기화(감사 R-2~R-6)**: 숨겨진 채 state 에 남아 backend 에 잘못 저장되던 값들을 비운다. `index.tsx` 핸들러 + `StepMap` select 연결.
  - `handleOnlyProdcChange`(C가문 No): REV·상/중/하판·지도편차(prodc)·prodc 옵션·`prodcCopyRegion` 초기화.
  - `handleMapChangeChange`(`변경 없음`): `map_value_x/y`·`map_reason` 초기화.
  - `handleEaChangeChange`(`변경 없음`): `ea_value` 초기화.
  - `handleMshotChangeChange`(없음·삭제): `mshot_image_copy/top/bottom` 초기화(다중 붙여넣기는 원래 마지막 1개만 저장).
  - **메인 라인 변경 effect(R-6)**: `prodc_*`·`prodc_middle_use`·지도편차·`rev_yn/rev_entries`·`prodcCopyRegion`·리전 옵션까지 함께 초기화.
- **REV 하드코딩 i18n 이관**: `REV 여부`·`GDS version`·`Layer / GDS version`·`GDS version 입력`·`모든 Layer가 추가되었습니다.`·`+ 추가`·`삭제`(표) → `request.rev_*` / `common.delete` 키(ko/en 동시).

### 추가 변경 이력 (2026-07 — MAP(C가문) 입력 UX 수정)

- **C가문 '적용 위치' 중앙 선택 시 자동 사용**: `handleProdcRegionSelect` 에서 중앙(middle) 라디오 선택 시 `prodc_middle_use='사용'` 으로 바꿔 행이 펼쳐지고 데이터가 채워지도록 했다(다른 위치로 전환 시 '미사용' 복원). 기존에는 중앙 선택 시 데이터는 복사되나 사용여부가 '미사용'이라 `ProdcRow` 가 셀렉트를 숨겨 보이지 않았다.
- **C가문 리전별 드롭다운이 각 리전 라인 기준으로 동작**: 이전에는 prodc top/middle/bottom 의 조합법·제품 옵션이 Step1 메인 `detail.line` 로만 로드돼 라인이 고정된 것처럼 보였다. 리전별 조합법 옵션 상태(`top/middle/bottomProcessOptions`)와 `prodc_{region}_line` 변경 effect 를 추가하고, `handleProdcProcessChange` 가 해당 리전 라인 기준으로 제품을 조회하도록 바꿨다(`handleProdcLineChange` 로 라인 직접 변경 시 하위 초기화). `ProdcRow` 는 리전별 `processOptions` 와 `onLineChange` 를 받는다.
- **REV Layer 드래그 다중 선택 + 표 확대**: `StepMap` 의 REV Layer 버튼을 마우스 드래그로 지나가며 일괄 선택/해제하도록 했다(첫 버튼에서 add/remove 모드 결정, 클릭 개별 토글 유지). 추가 항목 표는 인라인 12px 소형에서 앱 공용 `.table`(`.table-wrapper`) 스타일로 교체해 크기·디자인을 통일했다.
- **MAP 변경 X/Y 정렬 + X 부호 검증 0 예외**: C가문 지도편차 행의 위치 라벨에 있던 `marginBottom:4` 인라인을 제거해 X/Y 입력이 동일선상에 정렬되도록 했다(`.form-group` gap 6px 로 통일). 검증에서 X_top/X_bottom 은 절대값이 같고 **0이 아닐 때만** 부호가 서로 반대여야 하도록 바꿔(`xTop !== 0 && Math.sign(...)===...`), 0/0 은 Y처럼 허용된다.

### 추가 변경 이력 (2026-07 — J/O-ayer 차용 행 필수값)

- **new_or_copy='차용' 행은 product_name·step 필수**: J-ayer(Step3)·O-ayer(Step4) 표는 원래 행 단위 필수값 검증을 두지 않았으나, `차용`으로 지정한 활성(`!disabled`) 행만 예외로 `product_name`·`step`을 반드시 채우도록 했다. 순수 헬퍼 `findNocBorrowViolations`(`helpers.ts`)가 위반 행 id를 반환.
  - **검증 시점**: J-ayer는 step3→4 전환 시(`handleNextStep`), O-ayer는 step4→5 전환 시, 그리고 최종 상신(step5)에도 동일 검사를 반복(초안 복원 등으로 단계를 건너뛰는 경로 대비 안전망). 모든 모드(신규/재상신/재개)에 동일 적용.
  - **`handleNextStep` 검증 누락 수정**: 기존엔 step 1/2/4만 `validate()`를 호출해 J-ayer(step3)는 아예 검증되지 않던 상태였다. step 3도 트리거 조건에 추가.
  - **에러 표시**: 흐름도 `flow_step_${row.id}_${field}` 패턴과 동일하게 행별 `jayer_noc_${id}_product_name`/`_step`(O-ayer는 `oayer_noc_*`) 키로 **해당 셀에 빨간 테두리**를 표시한다. 표 상단 고정 문구는 **두지 않고**(토스트와 중복이라 제거), 안내는 토스트(`jayer_noc_required`/`oayer_noc_required`, count 보간) 하나로만 한다.
  - **문제 셀로 자동 스크롤**: 문제 있는 `product_name`/`step` `<input>`에 스크롤 타겟 마커 클래스 `field-error-target`을 부여하고, `scrollToFirstError`가 `.form-error` 외에 이 클래스도 인식하도록 확장했다. 다른 `.form-error` 필드(예: 필수 입력 required)는 기존처럼 `field-error-flash`(노란 깜빡임)까지 재생하지만, 표 셀 타겟(`field-error-target`)은 **깜빡임 없이** `scrollIntoView`(중앙 정렬) + 포커스만 수행한다.
  - **`scrollToFirstError` O-ayer 탭 전환 수정**: O-ayer 표 에러가 있을 때는 Partial Shot이 있는 'info' 탭으로 강제 전환하지 않도록 조건 추가(표는 'table' 탭에 있으므로). `errors` state 는 setErrors 직후 이 함수 안에서는 아직 갱신 전이라(스테일 클로저), `oayerRows`/`detail.partial_shot` 원본 값으로 직접 재계산해 판단한다.

### 추가 변경 이력 (2026-07 — MAP/예외구역 숫자 입력 + TBV/TLV 개편)

- **MAP X/Y·예외구역 값 숫자 전용 입력**: `map_value_x`/`map_value_y`(일반 + C가문 상/하판, 총 6개) · `ea_value`에 `sanitizeSignedDecimal`(`helpers.ts`, 부호 맨 앞 1개·소수점 1개만 허용) 적용. `StepMap.tsx`에서 `handleDetailChange` 대신 `handleDetailSet`으로 교체 호출, `inputMode="decimal"` 힌트 추가.
- **상세뷰 단위 표시**: 결재현황/이력조회 공용 `PagedDetailView.tsx`에서 MAP X/Y 값 뒤에 `um`, 예외구역 값 뒤에 `mm`을 붙여 표시(C가문 상/하판 포함). 저장값 자체는 순수 숫자 문자열이고 단위는 표시 시점에만 접미.
- **TBV/TLV 두께 버튼화**: 자유 텍스트 입력 → Partial Shot과 동일한 `map-type-btn` 2버튼 토글(`request.tbvtlv_thickness_10`="10.0um", `_15`="15.0um", ko/en 동시 등록 — 하드코딩 없음).
- **TBV/TLV 비고 → X/Y 좌표 표**: 자유 텍스트(`note`) 입력을 No/X/Y/사용여부(O·X) 표로 전면 교체.
  - 타입: `DetailFormState.tbvtlv_entries`를 `{sds, note?, noteRows?}[]`로 확장(`TbvtlvNoteRow` 신규, `types/index.ts`). `note`는 과거 저장분 하위 호환 전용 — 신규 작성은 `noteRows`만 채운다. 백엔드는 스키마 없는 JSON 저장이라 마이그레이션 불필요.
  - **엑셀 붙여넣기**(`handleTbvtlvCoordPaste`, `Step3.tsx`): X 또는 Y 칸에 붙여넣으면, 탭으로 2열(X,Y)이면 두 칸에 동시에, 1열이면 붙여넣은 칸만 채운다. 줄바꿈으로 여러 행이면 기존 행 수를 넘는 만큼 자동으로 행 생성.
  - No 컬럼은 자동 순번(입력 불가)이며 **배경색 없음**(다른 셀과 동일 톤). 사용 여부는 단순 표시용 O/X 드롭다운(검증에 영향 없음).
  - `+ 행 추가`/행별 `삭제`로 수동 조정 가능. `+ 추가` 클릭 시 현재 SD+표 세트가 확정되어 아래 "추가된 항목"에 **가로로 나란히(줄바꿈) 읽기전용**으로 쌓이고, 입력 영역은 다음 항목을 위해 1행짜리로 초기화된다(SD 선택 스코프 — 항목마다 독립된 표).
  - `PagedDetailView.tsx`도 동일 톤·가로 배치로 항목별 표를 렌더. `noteRows`가 없는 과거 저장분은 표 대신 기존처럼 텍스트 한 줄로 표시(데이터 손실 없음).

### 추가 변경 이력 (2026-07 — 결재 중단/재개)

- **중단(PAUSE) 문서 재개**: `status == 'pause'` 문서를 `/request` 로 편집(editDocId) 시, 편집 로드에서 `editDocStatus` 를 기록하고 `isResumeMode` 로 분기한다. 상신 모달·STEP5 버튼 라벨이 '재개'(`approval.resume`)로 바뀌고, 지정 PL 선택 UI·필수 검증을 건너뛴다(재개는 멈춘 단계부터 이어지므로 지정 PL 불필요). `handleSubmit` 은 문서 상태가 pause 면 update 후 `documentsAPI.resume` 를 호출한다(상신/재상신 대신). 상세는 `docs/APPROVAL.md` Case M 참조.

### 추가 변경 이력 (2026-07-01)

- **상신 모달에 통보처(Notifier) 다중 지정 추가**: 지정 PL 아래에 "통보처" 필드를 추가해 **결재 권한 없이 메일 통보만 받을 인원을 여러 명** 지정할 수 있다(선택).
  - 후보는 전체 사용자(role 무관, 본인 제외). 검색→선택→칩(태그) 방식이며 `detail.notifiers = [{loginid, name}]`에 저장된다(`additional_notes` JSON, 마이그레이션 불필요).
  - 이메일 stale 방지를 위해 **이메일은 저장하지 않고** 발송 시점에 `loginid`로 조회한다.
  - 메일: **상신·재상신 시**(`notify_submitted`), **결재 완료 시**(`notify_approved`) 통보처 전원에게 발송. 결재 경로 상세 탭에는 **의뢰자 다음 '통보처' 행**으로 표시(결재 경로에는 미포함, 2026-07 위치 이동·이메일 병기). 상세는 `docs/APPROVAL.md`·`docs/MAIL.md` 참조.

- **주소록(통보처 프리셋) 저장/불러오기 (2026-07 추가)**: 통보처로 자주 쓰는 사람 묶음을 주소록으로 저장해 상신 시 재사용한다.
  - 모델 `AddressBook`(owner 전용, `members` JSON `[{loginid, name}]`, 마이그레이션 `0003`), API `/api/address-books/`(owner 스코프 CRUD).
  - 저장 시 서버가 **실존 사용자만 정규화**(dead loginid 제외, name 최신화)하고, 조회 시 최신 `name`·`mail`·`has_mail`을 join해 내려준다.
  - 상신 모달 통보처 블록: **'통보처 불러오기'**(선택 시 현재 통보처를 그 주소록으로 **덮어쓰기**, 기존 목록 있으면 확인 모달) / **'통보처로 저장'**(드롭다운에서 기존 주소록 선택=덮어쓰기 확인, 새 이름=신규 생성).
  - 저장 포맷이 `detail.notifiers`와 동일하므로 **발송 로직 변경 없음** — 불러온 통보처 전원이 그대로 메일 대상이 된다.
  - **무이메일 경고**: 통보처 중 이메일 미등록자가 있으면 통보처 블록에 인라인 경고를 표시(발송 시 자동 제외되므로 누락 인지용).
  - 별도 관리 화면 `/address-book`("주소록 관리", Navbar 링크): 주소록 생성·이름변경·구성원 추가/삭제·삭제. 본인 것만 조회/수정.

- **통보처에 '나만의 그룹' 일괄 추가 (2026-08 추가)**: 상신 모달 통보처 블록의 `👥 그룹 불러오기`
  로 **내가 속한 그룹**(권한 관리에서 만든 나만의 그룹)을 골라 멤버 전원을 통보처에 넣는다.
  - 주소록('불러오기' = 현재 통보처를 **덮어쓰기**)과 달리 그룹은 **추가(append)** 한다.
    여러 그룹을 겹쳐 담을 수 있어야 하기 때문이며, 이미 담긴 사람과 **본인**은 건너뛴다.
  - 후보 목록은 기존 `/api/user-groups/` 응답을 그대로 쓴다(`members` 에 `loginid`·`name`·`mail` 포함)
    → **백엔드 변경 없음**. 이메일 미등록 멤버는 주소록과 동일한 경고 토스트로 알린다.
  - i18n: `request.notifier_group_btn` / `_search_placeholder` / `_empty_list` / `_loaded` / `_none_added` (ko·en).
  - ⚠️ 통보처 **검색** 후보는 종전대로 PL 로 한정되지만, 그룹 불러오기는 그룹 멤버(역할 무관)를 그대로 넣는다.

- **임시저장 공유 그룹 지정 (2026-08 추가)**: 임시저장 문서를 **내가 속한 그룹 1개**에만 공유한다.
  지정된 그룹 멤버는 그 임시저장을 조회·수정·상신할 수 있고, 지정하지 않으면 작성자 본인과
  MASTER 만 볼 수 있다. 지정 위치는 **결재 현황**(`/approval`)의 임시저장 행이며,
  규칙·API·권한표는 `docs/APPROVAL.md` §9 참조.
  - 그룹원이 이어서 수정·상신해도 **의뢰자는 최초 작성자**로 유지된다(`docs/APPROVAL.md` §9-3).

- **수정·재상신 시 검토자(지정 PL) 프리필 (2026-07)**: 반려 후 수정·재상신 화면 진입 시, 통보처처럼 **이전에 지정했던 검토자(지정 PL)가 상신 모달에 미리 채워진다**(수정 가능). 편집 로드 `useEffect`에서 `doc.approval_steps`의 최신 회차 `agent='PL'` step assignee를 `designees`로 복원한다. 상세는 `docs/APPROVAL.md` Case I 참조.

### 추가 변경 이력 (2026-06-25)

- **Step 5(Backbone) 자동채움을 "남은 원본 행" 기준으로 통일 + 덮어쓰기 로직 제거**: 자동채움 대상·범위 UI가 일부는 전체 활성 J-layer 행, 일부는 미매핑 행 기준으로 섞여 있어, 이미 채워진 layer가 다시 채워지며 **다른 BB 제품의 행을 덮어쓰는 버그**가 있었다. 이를 다음과 같이 정리:
  - `buildAutoFillRows`(index.tsx): 대상 행을 `!disabled && !mappedJayerRowIds.has(id)`(원본 목록에 남은 행)로 제한. 이미 매핑된 행은 후보에서 제외되어 재채움이 발생하지 않는다.
  - `handleOpenAutoFillPanel`(index.tsx): 기본 범위 시드 layer도 미매핑 행 기준으로 산출.
  - **덮어쓰기/충돌 처리 제거**: 자동채움이 남은 행만 다루므로 기존 bb 행과 겹칠 수 없다 → `handleApplyAutoFill`은 항상 append. 충돌 판정/상태(`bbConflictState`·`bbPartialAddConfirm`·`bbPartialAddRowsRef`)·확인 모달 2개·`applyBbRowChanges`의 replace/remove 분기를 제거(append 전용으로 단순화). 미사용 i18n 키 `bb_overwrite_confirm_with_layers`·`bb_partial_add_confirm`(ko/en) 삭제.
  - **범위 Layer 입력을 입력+선택(콤보박스)으로**: `Step4.tsx`의 시작/종료 Layer `<select>` → `AutocompleteInput`으로 교체(직접 타이핑 + 남은 layer 후보 필터). 후보(`remainingLayerOptions`)는 미매핑 행 기준. 제품 칸은 `bb_entries`와 정확히 일치해야 매칭되므로 `<select>` 유지.
  - 자동채움 결과 0건 시 안내문구를 "자동채움할 남은 원본 행이 없습니다."(info)로 정리.

- **bb_name(Ref.PART ID)을 `[라인] 제품` 형식으로 + 자동채움 제품 선택을 인덱스 기반으로**: 결과표 `bb_name`이 제품명만 들어가던 것을 `[location] product` 형식(`formatBbName` 헬퍼, 라인 없으면 제품만)으로 채운다. 자동채움·수동매핑 양쪽 적용.
  - `ExternalBbDataItem`에 `location?` 추가, `Step4.tsx` `currentTabData`에 `location` 전달 → 수동매핑(`handleApplyMappings`)이 `formatBbName(ext.location, ext.bb_name)`로 채움. (우측 외부 데이터 패널의 "Ref.PART ID" 표시·검색은 제품명만 그대로 유지)
  - **라인만 다른 동일 제품명 구분 버그 수정**: 자동채움 범위의 제품 `<select>` value가 제품명뿐이라 라인만 다른 동일 제품을 구분하지 못하고 `findIndex(product)`로 항상 첫 항목만 잡던 문제를 인덱스 기반으로 교체. `BbAutoFillRange.productId` → `entryIdx`(항목 인덱스 문자열), `<option value={entryIdx}>`, `buildAutoFillRows`가 `detail.bb_entries[Number(entryIdx)]`를 직접 사용. 시드값(`handleOpenAutoFillPanel`/`handleAddRange`)도 인덱스로 변경. 이로써 `[LineA] BB제품1`·`[LineB] BB제품1`이 외부데이터·라벨 모두 정확히 구분된다.

- **외부 데이터 탭별 색상 → bb 정보 Ref.PART ID에 적용**: 뼈찜 외부 데이터 탭이 **2개 이상일 때만** 탭별 파스텔 색(`utils/bbTabColors.ts` `BB_TAB_COLORS` 8색 순환)을 부여한다.
  - 색칠 대상은 **외부 데이터 탭 버튼** + **결과표/상세보기의 Ref.PART ID 셀 한 칸**뿐(행 전체는 칠하지 않음).
  - 활성 탭은 고유색을 유지한 채 **accent 링(inset 2px)+굵게+살짝 진하게**로 클릭 상태를 명확히 표시(탭 1개일 땐 기존 `bb-tab-active` 동작 유지).
  - 행이 어느 탭에서 왔는지 `BbTableRow.entryIdx`(+`ExternalBbDataItem.entryIdx`)에 기록·저장 → **결재 상세보기·이력조회**(`PagedDetailView`의 `BbTable`, `tabCount` prop)에서도 같은 색을 재현. 자동채움은 `range.entryIdx`, 수동매핑은 `ext.entryIdx` 기준.
  - 기존 저장 문서(`entryIdx` 없음)·수동 `+행 추가` 행은 색 없이 표시(안전).

- **불러온(loaded) 행의 원본 컬럼 읽기전용 잠금**: 자동채움(JOB FILE/OVL)·참조요청서 병합으로 "불러온" J/O 행의 `process_id·sp·sd·layerid·pp`(`LOADED_LOCK_COLS`)를 읽기전용으로 잠가, 다른 값(st 등) 편집·엑셀식 붙여넣기·Delete로 인해 원본 값이 바뀌지 않도록 한다. **수동 `+행 추가` 행은 전 컬럼 편집 허용.**
  - 행에 `loaded?: boolean` 추가(`JayerRow`/`OayerRow`). 자동채움·병합 행에 `loaded:true` 저장(영속). 재상신/지정PL 수정 로드 시 신규 작성과 동일하게 잠금 재현.
  - 옛 문서(`loaded` 없음)는 **Update 날짜 유무**로 보정(`loaded = r.loaded ?? !!r.updated`): Update 날짜는 백엔드 자동채움에서만 채워지고 사용자가 못 넣으므로 수동 행을 오인 잠금하지 않는다.
  - `useCellSelection`을 셀 단위 잠금(`isCellLocked(row,col)`)으로 확장 — 붙여넣기/Delete/연동 콜백에서 잠긴 셀만 건너뜀(선택 하이라이트는 허용, 쓰기만 차단). 미전달 시 기존 행 단위(disabled/기등록) 동작.
  - Step2/Step3: 잠금 5개 컬럼 `readOnly`에 `|| row.loaded` 추가(배경 흰색 유지, `disabled` 미부여). Update 컬럼 배경을 회색→흰색·읽기전용. layerid `readOnly`에 `row.disabled`도 포함(기존 비활성 행 Layer 편집 가능 버그 동시 수정).

- **의뢰자(requester) 최초 작성자 고정**: 검토자(지정 PL)가 "수정 후 재상신"하면 의뢰자 표시값이 검토자로 바뀌던 문제 수정.
  - 백엔드: `RequestDocumentSerializer.update`에서 `requester_name/email/department`를 pop해 업데이트 시 변경 차단(생성은 그대로). `requester` FK는 기존에도 `perform_update`가 안 건드려 보존됨.
  - 프론트: 편집/지정PL 로드 시 원본 requester를 `originalRequesterRef`에 보관 → `buildEnrichedForm`이 편집/지정PL 모드에선 원본 requester 사용(신규는 현재 사용자).

- **J-layer 행 변경 시 Backbone 매핑 동기화**: 매핑된 J행을 **수정·붙여넣기·Delete·비활성화**하면 매핑을 해제(`unmapJayerRows`)한다.
  > **(2026-08 변경)** 수정·붙여넣기·Delete 는 **`BB_MIRRORED_COLS`(`process_id`·`sp`·`sd`)가 실제로 바뀔 때만** 해제한다.
  > bb 행이 J-ayer 에서 복사해 가는 값이 이 셋뿐이고 나머지는 외부 데이터에서 오므로, `st`·`new_or_copy` 같은
  > 컬럼 변경까지 해제하면 bb 내용이 그대로인데도 재선택만 강요됐다. 불러온(loaded) 행에서는 이 셋이
  > `LOADED_LOCK_COLS` 로 모두 잠겨 있어 **사실상 해제되지 않고**, 수동 추가 행에서만 해제가 일어나
  > bb 표의 값이 J-ayer 와 어긋나는 것을 막는다. 비활성화(`handleJayerBulkDisable`)는 종전대로 항상 해제한다
  > (비활성 행은 원본 목록에도 안 떠 주인 없는 bb 행이 남기 때문).
  - 비활성화: bb 정보에서 제거(비활성이라 원본목록에도 안 뜸), 복원 시 원본목록 복귀.
  - 수정/붙여넣기/Delete: bb 행 제거 + **원본 데이터 목록에 재노출**(재매핑 가능). 상신 검증으로 재매핑 강제.
  - `useCellSelection`에 `onAfterClear` 콜백 추가(Delete 통지). `handleJayerBulkDisable`·`handleJayerChange`·`handleJayerAfterPaste`·Delete 전 경로 연결.
  - **라인/조합법/조리법(process_id) 변경 시**: J/O가 새 id로 재생성되므로 `bbRows`·`mappedJayerRowIds`·`stagedMappings`·`selectedJayerRowId`를 초기화(고아 bb 방지). 편집/투어 로드는 `isLoadingEditRef` 가드로 보존.

- **J/O 표 셀 드래그 시 글자 텍스트 선택 방지**: 셀을 드래그 선택할 때 브라우저 기본 텍스트 선택(파란 글자 배경)이 함께 생기던 문제 수정. `useCellSelection`에 `isDragging` 상태 추가 — 드래그가 다른 셀로 확장되는 순간(`onCellMouseEnter`) 켜고 `getSelection().removeAllRanges()`로 기존 선택 제거, `mouseup`에 해제. Step2/Step3 표 `userSelect`를 `cellSel.isDragging || (행 드래그) ? 'none'`로. 단일 클릭/더블클릭 편집·input 내 텍스트 선택은 영향 없음(드래그 아닐 때만 평소대로).

- **J↔O 동기화: 비활성·기등록·layer삭제 완전 격리 + 특수값 처리**: 동기화 참여 조건을 **"활성(`!disabled`) && new_or_copy가 기등록/layer삭제 아님"**으로 정의(헬퍼 `isNocSpecial`). 참여행끼리만 `layerid` 기준으로 `st`·`new_or_copy`가 송수신된다.
  - 비활성·기등록·layer삭제 행은 **송신·수신 모두 차단**(셀편집·일괄 전체O/X/신규/차용/초기화·붙여넣기 전부). 비활성 행 값이 일괄로 바뀌던 버그 수정.
  - **특수값 비전파**: new_or_copy를 기등록/layer삭제로 바꿔도 그 값은 다른 행에 전파되지 않는다.
  - **기등록/layer삭제 선택 시 `st` 자동 'X'**: new_or_copy를 기등록/layer삭제로 설정(드롭다운/붙여넣기)하면 그 행의 st를 'X'로 함께 설정(그 행에만, 전파 없음).
  - **bb 원본 데이터 목록·자동채움·검증에서 제외**: 기등록·layer삭제·비활성 행은 Step4 좌측 목록·`remainingLayerOptions`·"N행 조회됨" 카운터·`buildAutoFillRows`·`handleOpenAutoFillPanel`·`validate(5)` 매핑 필수에서 모두 제외.
  - 정상 행끼리의 같은-layer 동기화(같은 표 전파 포함)는 그대로 유지.

### 추가 변경 이력 (2026-06-23)

- **col_st 'O (혼용)' 옵션 제거**: Step3(J-layer)·Step4(O-layer)의 col_st 드롭다운에서 `'O (혼용)'` 선택지를 제거. `Step2.tsx`·`Step3.tsx`의 `ST_OPTIONS` 배열 및 `stCellColor.ts`의 색상 매핑(`'#FFE0EC'`) 삭제. 기존 DB에 저장된 `'O (혼용)'` 값은 보존되며, 상세보기에서 텍스트는 그대로 표시되나 셀 배경색은 적용되지 않는다.

### 추가 변경 이력 (2026-06-16)

- **Only MAP — O-layer partial_shot 검증 우회**: Only MAP 모드(`isOnlyMap`)일 때 Step 4 진행 시 `partial_shot` 필수 입력 검증을 건너뜀(`validate()` 내 `currentStep === 4 && !isOnlyMap` 조건 추가).
- **J↔O col_st·col_new_or_copy 양방향 동기화**: `layerid`(col_layer) 값이 동일한 J-layer 행과 O-layer 행 사이에서 `st`·`new_or_copy` 값을 자동 반영. 개별 셀 편집(`handleJayerChange`/`handleOayerChange`)과 일괄 버튼(`handleJayer/OayerSetAll`·`handleJayer/OayerResetField`) 모두 적용. `new_or_copy === '기등록'` 행은 덮어쓰지 않으며, `layerid`가 빈 행은 동기화 제외.
- **col_st·col_new_or_copy 드롭다운 잘림 방지**: `AutocompleteInput`에서 `dropdownDirection="up"` 시 `createPortal` + `position: fixed`로 렌더해 `.wizard-table-wrapper`의 overflow 클리핑을 우회. 열린 상태에서 scroll 이벤트로 위치를 갱신. `dropdownDirection="down"` 분기(Step1·StepMap 등)는 기존 동작 무변경.

- **Step1 요청 목적 'Only MAP'**: 기존 `'MAP 변경'` 옵션을 `'Only MAP'`로 변경(라벨·DB 저장값 동시 변경 — `OPTION_REQUEST_PURPOSE`). 선택 시 **초기화 확인 모달**(`only_map_confirm_*` i18n) 노출 후 확인하면 *기타 목적·흐름도·특이사항·Backbone(`bb_entries`)·참조 요청서*를 초기화하고 입력을 비활성화한다(Step1 `disableOptional = !canSelectPurpose || isOnlyMap`). ※ 2026-08-11 변경: *특이사항(`change_purpose_note`)* 은 **초기화만 되고 입력은 가능**하다(§4.1 2026-08-11 항목 참조). **유지(편집 가능)**: 라인·조합법·제품 이름·조리법·고객/업체명·요구 사항·실제 생산 진행 날짜. 검증에서는 Only MAP일 때 **Backbone 필수 검증만 우회**한다.
- **StepMap MAP 목적 변경 초기화 범위**: `handleMapTypeChangeConfirm`이 더 이상 `INITIAL_DETAIL` 전체로 초기화하지 않고, **StepMap 필드(원본·C가문·지도편차·예외구역·X표시·Map Option·REV)만** 초기화한다. Step1/3/4/5 데이터(`bb_entries`·`partial_shot`·`tbvtlv_*` 등)는 보존된다.
- **원본 위치/제품 CLONE 전용**: StepMap의 원본 위치/Part ID 블록은 `map_type === 'CLONE'`일 때만 표시된다.
- **Map Option 11번 추가**: `hpkglabelheight`(i18n `map_opt_hpkglabelheight`, ko `11번`/en `11`). `types`·`INITIAL_DETAIL`·`StepMap`·`PagedDetailView`·`handleReset`·MAP 목적 변경 초기화에 반영. `detail`은 `additional_notes`에 JSON 저장되므로 백엔드 마이그레이션 불필요.

### 추가 변경 이력 (2026-06-14)

- **가이드 배지(GuideBadge) 클릭 범위 수정**: 가이드 배지가 `<label className="form-label">` 안에 위치한 경우(요청 목적·기타 목적·흐름도·고객/업체명 등), 배지가 `<button>`이라 label의 "연결된 컨트롤"이 되어 **label(행) 아무 곳이나 클릭해도 슬라이드 가이드가 열리는** 문제가 있었다. `GuideBadge`를 labelable이 아닌 `<span role="button" tabIndex={0}>`(키보드 Enter/Space 지원, `onClick`에 `stopPropagation`)으로 변경하여 **배지를 직접 클릭할 때만** 가이드가 열리도록 수정(`index.tsx`의 `GuideBadge` 정의 1곳 변경으로 모든 Step에 적용).
- **Only MAP 결재 경로 단축(백엔드)**: 요청 목적이 `Only MAP`인 의뢰서는 결재 경로를 **R 단계까지만** 진행한다. R 합의 시 P/O/E 단계를 생성하지 않고 곧바로 `approved`가 된다. 모델에 `RequestDocument.ONLY_MAP_PURPOSE` 상수와 `is_only_map()` 헬퍼를 추가하고, `views.py`의 `approve_step` R 분기에서 분기 처리한다. 상세는 `docs/APPROVAL.md` Case E 참조.
- **요청 목적·기타 목적 옵션 추가**: 요청 목적(`OPTION_REQUEST_PURPOSE`)에 `기타`, 기타 목적(`OPTION_OTHER_PURPOSE`)에 `Short loop`를 추가. 두 옵션 모두 특수 로직(`Only MAP`·`Layer 추가/삭제`) 없이 일반 선택값으로 동작하며, 값 자체가 DB 저장값이다(`constants.ts`).

### 추가 변경 이력 (2026-06-13)

- **초기화 모달은 "기존 선택을 바꿀 때만" 노출**: `handleMapTypeSelect`는 `detail.map_type`이 이미 선택돼 있을 때만(CLONE/EXISTING 전환) 초기화 모달을 띄운다. 첫 선택(map_type이 빈 값)은 초기화할 것이 없으므로 모달 없이 바로 적용. `handleRequestPurposeSelect`도 동일하게, 기존 목적이 있을 때 Only MAP으로 바꾸면 모달, 첫 선택이면 바로 적용. (필드 값 비교는 하지 않고 "선택 여부"만 판단)
- **Only MAP 적용 로직 분리·확장**: 기존 `handleOnlyMapConfirm` 본문을 `applyOnlyMap()` 헬퍼로 분리(모달 확인·첫 선택 양쪽에서 호출). Only MAP은 StepMap 정보까지만 필요하므로, 기존 초기화 항목에 더해 **J-layer/O-layer 표(`jayerRows`/`oayerRows` → 빈 기본 행)·Backbone(`bbRows`)·외부데이터(`bbExternalData`)·매핑 상태(`mappedJayerRowIds`/`stagedMappings`/`selectedJayerRowId`)·체크 상태·O-layer 정보 탭(`partial_shot`/`tbvtlv_thickness`/`tbvtlv_entries`)**을 비운다.
- **매핑 적용 시 col_bb_layer 채움**: `handleApplyMappings`에서 `bb_step`을 빈 값으로 두던 것을 자동 채움(`buildAutoFillRows`)과 동일하게 외부 데이터의 `layerid`(`ext.layerid`)로 채운다.
- **J/O 필터 인라인 수정**: `FilterManageModal`에 `onEdit` prop과 수정 모드(저장된 필터 '수정' 버튼 → 폼에 로드 → '수정 적용'/'수정 취소') 추가. index.tsx의 `onEdit` 콜백은 `filterSets` 갱신·localStorage 저장과 함께, 수정된 필터가 활성 상태면 `calcDisabled`로 행 비활성 상태를 즉시 재계산한다(삭제 핸들러와 동일 패턴).
- **검증 실패 시 첫 오류 필드로 스크롤·강조**: `handleNextStep`/`handleSubmitClick`이 토스트만 띄우고 상단으로 스크롤하던 것을 `scrollToFirstError()`로 교체. DOM의 첫 `.form-error` 필드(`.form-group` 컨테이너)로 `scrollIntoView({block:'center'})` 후 `field-error-flash`(global.css)로 1.5초 강조하고 첫 입력요소에 포커스한다. O-layer(step 4)의 `partial_shot` 오류는 'info' 탭(`setOayerInfoTab('info')`)으로 전환 후 표시한다. Backbone(step 5)의 `jayer_mapping` 오류는 `Step4`에 `errors` prop을 추가해 `.form-error`로 인라인 노출(스크롤 앵커). 검증은 항상 현재 step 기준이라 첫 오류 필드는 현재 화면 안에 있다(탭 전환만 필요).

## 5. 검증 방법
```bash
# 타입체크 (2026-08-06 실측 24개 = 정상. 작업 직전 실측값과 같으면 신규 0)
cd frontend && npx tsc --noEmit 2>&1 | grep -c "error TS"

# 테스트 (2026-08-06 실측: 2 suites / 67건 — helpers.test.ts 63건 + terminology.test.ts 4건)
cd frontend && CI=true npx react-scripts test --watchAll=false --passWithNoTests

# ⚠️ 프로덕션 빌드는 pre-existing TS2345 로 실패한다(§4). 통과 여부로 회귀를 판단하지 말 것.
cd frontend && CI=true npx react-scripts build

# 개발 서버 확인 경로
http://localhost:10011  → /request
```
