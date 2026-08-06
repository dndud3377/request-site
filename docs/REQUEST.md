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
    ├── BeforeAfterPanel.tsx        #   227줄  참조 요청서 Merge BEFORE/AFTER 매핑 패널 (step 1 인라인)
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
| Merge | `MERGE_ENABLED_PURPOSES`, `isMergePurposeSelected`, `MERGE_UNREGISTERED_ID` |
| ADI CD | `OTHER_PURPOSE_ADI_CD`, `ADI_CD_MAP_TYPE`, `ADI_CD_TEMPLATE_ROWS`, `ADI_CD_MAX_ROWS`, `ADI_CD_HEADER_SCAN_ROWS`, `ADI_CD_STEP_ID_LABEL`, `ADI_CD_STEP_DESC_LABEL` |
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
- **참조문서 병합**: `refDocId`, `refDocLabel`, `refJayerRows`, `refOayerRows`, `mergeConfirmOpen`, `mergePreview`, `mergeSnapshot`, `mergeReselectConfirm`
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

- **진입/해제**(`index.tsx`): 기타 목적 버튼에서 `ADI CD 변경`을 켜면 `handleSelectAdiCdPurpose`가 `detail.map_type`을
  `'ADI'`로 자동 고정하고 양쪽 표에 빈 5행 템플릿을 깐다(`ADI_CD_TEMPLATE_ROWS`). 재클릭(해제)은 표에 값이 있으면
  `ConfirmModal` 확인 후 초기화(`exitAdiCd`), 없으면 바로 해제한다. `map_type`은 해제 시 `'ADI'`였을 때만 되돌린다.

- **StepMap 잠금**(`StepMap.tsx`): `map_type` 4버튼 배열(`NEW`/`CLONE`/`EXISTING`/`EDIT`)에 `'ADI'`를 5번째로 추가하고
  **항상 비활성**(표시 전용 — 실제 선택은 Step1 버튼에서만) 처리했다. `detail.map_type==='ADI'`인 동안은 EDIT 잠금 패턴과
  동일하게 나머지 4개도 전부 잠근다.

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

- **필수 입력 우회**(`ADI CD 변경`만 단독 선택했을 때만 — 다른 목적과 함께면 미적용): 판정은 `isAdiCdOnly`
  (`other_purpose.length === 1 && other_purpose[0] === 'ADI CD 변경'`) 하나로 통일한다. 다른 기타 목적을 함께
  켜는 순간 `false` 로 뒤집혀 아래 우회가 **전부 해제**되고 원래 필수로 되돌아온다(중복 선택은 항상 가능하다).
  우회 대상은 **2곳뿐**이다:
  - `validate(1)`의 `if (!isOnlyMap && !isAdiCdOnly)` — **Backbone 조합 영역**(`bb_entries`)
    필수 검증. ADI CD 만 요청하는데 무관한 위치·제품·조리법 3칸을 채우거나 기본 행을 지워야만 STEP1 을 벗어날 수
    있던 문제를 없앤다. 검증만 끄고 **입력창은 잠그지 않으며**(회신: UI 는 유연하게), 사용자가 넣은 값은
    **거르지 않고 그대로 저장**한다.
  - `validate(4)`의 `if (currentStep === 4 && !isOnlyMap && !isAdiCdOnly)` — Partial Shot 등.
  나머지는 손대지 않았다 — `map_type` 필수 검증은 자동 고정으로 이미 통과하고, STEP2 조건부 필수
  (C가문·MAP 변경·IN 등)는 사용자가 StepMap 값을 바꾸지 않는 한(기본값이면 미발동) 자연히 통과하며, STEP3/5의
  J/O NOC·Backbone 매핑 검증은 건드리지 않았다(조건부 검증을 강제 우회하면 반쪽 모순 데이터가 결재로 올라간다).
  상신 모달의 지정 PL은 결재 경로를 정하는 값이라 ADI CD 단독이어도 여전히 필수다.

- **`scrollToFirstError` 조건 동기화**: `partialShotMissing` 계산식은 `validate(4)`의 우회 조건과 **반드시 같은
  판정**이어야 한다. `!isAdiCdOnly` 가 검증부에만 있고 이쪽에 빠져 있어, ADI CD 단독 + Partial Shot 미입력 상태에서
  STEP4 검증이 실패하면 **존재하지도 않는 오류 때문에 'OVL 정보' 탭으로 잘못 전환**되던 것을 고쳤다.
  두 식은 앞으로도 함께 바꿔야 한다.

- **저장 페이로드는 비우지 않는다**(`isMapOnlyScope` 에 ADI CD 를 넣지 않는다): `jayerRows` 는 프론트 표시용이
  아니라 백엔드 로직의 입력값이다 — `models.py has_ppid_plel()` 이 이 값으로 **E(MASK) 결재 단계 생성 여부**를
  정하고, `views.py _validate_jayer_bb_mapping()` 이 프론트 STEP5 와 **같은 Bb 매핑 규칙을 서버에서 이중 검증**한다.
  `[]` 로 비우면 둘 다 무력화되어, "J-layer 에 조회된 행이 있으면 Bb 매핑을 끝내고 상신한다"는 규칙이 깨진다.

- **문서 제목**: `MAP(${map_type})` 조립(`index.tsx`)에 `'ADI'`가 그대로 들어간다. 이 문자열을 파싱/필터링하는
  다른 코드는 없다(전체 검색 결과 이 한 곳뿐) — 목록·필터·검색에 영향 없음.

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

- **J-layer 행 변경 시 Backbone 매핑 동기화**: 매핑된 J행을 **수정(어떤 컬럼이든)·붙여넣기·Delete·비활성화**하면 매핑을 해제(`unmapJayerRows`)한다.
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

- **Step1 요청 목적 'Only MAP'**: 기존 `'MAP 변경'` 옵션을 `'Only MAP'`로 변경(라벨·DB 저장값 동시 변경 — `OPTION_REQUEST_PURPOSE`). 선택 시 **초기화 확인 모달**(`only_map_confirm_*` i18n) 노출 후 확인하면 *기타 목적·흐름도·특이사항·Backbone(`bb_entries`)·참조 요청서*를 초기화하고 입력을 비활성화한다(Step1 `disableOptional = !canSelectPurpose || isOnlyMap`). **유지(편집 가능)**: 라인·조합법·제품 이름·조리법·고객/업체명·요구 사항·실제 생산 진행 날짜. 검증에서는 Only MAP일 때 **Backbone 필수 검증만 우회**한다.
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
