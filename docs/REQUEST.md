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
├── index.tsx                       # 메인 컴포넌트 (현재 ~2,028줄) — 상태·핸들러·effect·조립
├── constants.ts                    # 상수·팩토리·초기 상태 (외부 state 비의존)
├── helpers.ts                      # 순수 헬퍼 (formatUpdatedDate/shouldDisableRow/calcDisabled/emptyDraftWords)
└── components/
    ├── ProdcRow.tsx                # PRODC 북/중/남 공통 행 (REGION_LABEL_KEY 동봉)
    ├── MshotImageUpload.tsx        # M-shot 이미지 붙여넣기 영역 (자기완결)
    ├── WizardIndicator.tsx         # 상단 단계 인디케이터 (자기완결)
    ├── FilterManageModal.tsx       # J/O 필터 관리 모달 (공유 — jayer↔oayer props 매개변수화)
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

## 3. 리팩토링 진행 현황 & 향후 방향

| 단계 | 내용 | 상태 | index.tsx |
|------|------|------|-----------|
| 1차 | 독립 단위 분리(상수·팩토리·ProdcRow/Mshot/Wizard) | ✅ | 4,083 → 3,795 |
| 2차 | 5개 Step 컴포넌트 분리(renderStepN → StepN) | ✅ | 3,795 → 2,242 |
| 3차 | 순수 헬퍼(helpers.ts) + 공유 필터 모달(FilterManageModal) 분리 | ✅ | 2,242 → 2,028 |

### 3.1 커스텀 훅으로 핸들러 추출 — ⛔ 검증 결과 비권장

원래 계획했던 `useJayer`/`useOayer`/`useBbTable` 분리를 **코드로 검증한 결과, 도메인이 분리 불가능**하여 진행하지 않기로 결정했다(2026-06). 근거:

- **Jayer ↔ Bb 교차 쓰기**: `handleJayerBulkDisable` 이 `setSelectedJayerRowId`·`setStagedMappings`(Bb 매핑 state)를 변경.
- **Bb ↔ Jayer 교차 읽기/쓰기**: `handleApplyMappings`·`buildAutoFillRows` 가 `jayerRows`·`detail.bb_entries`·`bbExternalData` 를 읽고 `setMappedJayerRowIds`(jayer 결합)를 씀.
- **16개 effect 의 연쇄 동기화**: 대부분 `detail.*` 에 키를 두고 옵션 캐시 + `setDetail` 연쇄 초기화 + jayer/oayer 행 채우기를 교차 수행. 전부 `eslint-disable react-hooks/exhaustive-deps` 로 **의존성 배열을 의도적으로 부분 지정**, 공유 `isLoadingEditRef` 가드 ref 사용.

→ 훅으로 옮기면 (1) 주입 의존성이 도메인당 15~30개로 폭증해 복잡도가 오히려 증가하고, (2) **state 소유권 이동이 클로저 캡처·effect 실행 타이밍을 바꿔 `tsc` 가 못 잡는 런타임 버그**(stale closure / effect 순서)를 유발할 수 있다. "기존 기능 무손상 최우선" 원칙과 충돌하므로 **현 상태(2,028줄)를 합리적 종료점으로 인정**한다.

> 굳이 추가로 줄여야 한다면: 남은 confirm/merge/submit 모달(8~28줄, 이미 공용 `ConfirmModal`/`Modal` 기반)을 컴포넌트화할 수 있으나 props 주입 오버헤드 대비 이득이 적다. 훅 추출이 정말 필요해지면 **도메인이 아니라 응집된 한 덩어리**(예: 옵션-fetch effect 묶음)부터, 광범위한 수동 회귀 테스트를 동반해 시도할 것.

### 3.2 분리 작업 진행 원칙 (필수 — 후속 작업 시에도 동일)
- 한 번에 한 단위씩, **파일별 개별 커밋** (CLAUDE.md 규칙 E).
- **state 소유권은 index.tsx 에 유지**, JSX·순수 함수만 이동(props 주입). 이것이 `tsc` 로 완전 검증 가능한 안전 패턴.
- 각 단계마다 검증: `npx tsc --noEmit` 의 전체 error 개수가 **베이스라인(47개)과 동일**한지 확인. 47개는 모두 기존 i18n strict 키 타이핑 / es5 target `Set` 순회 관련 pre-existing(파일만 이동, 총수 불변 = 신규 0 증명). 신규 `TS2304/2305/2307/2552/6133`(미정의·import·미사용) 발생 시 즉시 수정.
- 동작 동일성이 핵심. 로직/문구 변경 금지(요청 시에만).

---

## 4. 알려진 pre-existing 이슈 (이번 리팩토링 무관)
- `tsc --noEmit` 기준 전체 **24개** error 존재(2026-08-02 실측) — i18n `t()` 의 strict 키 타입 + `Set` 순회(es5 target).
  아래 §3.2·§5 에 적힌 **베이스라인 47개는 옛 값**이므로, 후속 작업에서는 "작업 직전 실측값과 동일한지"로 판단할 것.
- ⚠️ `npx react-scripts build` 는 **현재 실패한다**(`Navbar.tsx:227` 의 `t('profile.name')` — i18n strict 키 타입 TS2345).
  이번 변경 이전 커밋에서도 동일하게 실패하는 pre-existing 이슈다. "CRA 빌드는 통과한다"는 과거 기술은 더 이상 사실이 아니다.
- 하드코딩 한글 문자열 다수 잔존 (예: `MshotImageUpload` 의 "Ctrl+V 로 이미지를 붙여넣으세요", `Step2~Step4`/`StepMap` 의 "활성/전체", "STEP 정렬", "+ 행 추가", "선택 비활성화", "범위 추가", "특정 제품 삭제 필요", `FilterManageModal` 의 "저장된 필터/새 필터 만들기/전체 삭제/닫기/키워드 입력 후 Enter" 등). CLAUDE.md 규칙 G(i18n) 위반이나, 분리 시 동작 보존 위해 원문 그대로 이동. 추후 `request.*` 키로 일괄 이관 필요.

---

## 4.1 기능 변경 이력 (2026-06)

### 추가 변경 이력 (2026-08-03 — C가문 제품 해당 위치 게이트 + ONLY 스코프 + 리전별 지도편차)

- **개요**: C가문(`only_prodc='Yes'`) 영역을 ① **제품 해당 위치 게이트** → ② **ONLY 북쪽/ONLY 남쪽 스코프** →
  ③ **리전별 지도편차 개별 선택** → ④ **X표시 자동 `수정`** 순으로 재구성했다.
  백엔드는 `MAP_APPLY_KEYS` 한 줄만 바뀌고 **마이그레이션은 없다**(`additional_notes` JSON).

#### ① 영속 필드 `prodc_scope` 신설 (`prodcCopyRegion` 이관)

| | 이전 | 이후 |
|---|---|---|
| 저장 위치 | `useState<CRegion \| null>` (**저장 안 됨**) | `detail.prodc_scope` (`additional_notes` JSON) |
| 값 | `top`/`middle`/`bottom`/`null` | `''`/`top`/`middle`/`bottom`/`only_top`/`only_bottom` |

- 기존에는 UI state 라 **임시저장·재상신·편집 로드 시 선택이 사라졌다**. 스코프가 필수 검증을 좌우하므로 영속화가 필수였다(동시 해소).
- `MAP_DETAIL_KEYS`(프론트)·`MAP_APPLY_KEYS`(백엔드)에 **동시 추가**.
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
  백엔드·마이그레이션·i18n 신규 키 변경은 **없다**(`MAP_DETAIL_KEYS`/`MAP_APPLY_KEYS`도 키 추가·삭제 없음).

- **① EDIT 버튼 활성 조건 반전**(`StepMap.tsx`): `disabled={isMapChangeMode && val !== 'EDIT'}` →
  `disabled={val === 'EDIT' ? !isMapChangeMode : isMapChangeMode}`.
  일반 상황에서는 `EDIT` 만 비활성이고, '완성된 MAP 변경' 진입 시에만 `EDIT` 이 활성 + 나머지 3개가 잠긴다(기존 동작 유지).
  값 자체는 여전히 `applyMapChangeMode` 가 `map_type='EDIT'` 로 자동 설정하므로 이 버튼은 사실상 상태 표시용이다.

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
  `Only MAP`·`완성된 MAP 변경` 모드는 J/O 표를 강제로 비우므로 **후보가 0개**가 되어 REV 항목을 새로 추가할 수 없다(불러온 항목 삭제만 가능).
  두 모드에서는 REV Layer 를 쓸 일이 없다는 판단으로 직접 입력은 도입하지 않았다.

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
- **화이트리스트 동기화**: 프론트 `MAP_DETAIL_KEYS`(`constants.ts`)와 백엔드 `RequestDocument.MAP_APPLY_KEYS`(`models.py`)에 `in_apply`·`inter_select` 동시 추가. `detail`은 `additional_notes` JSON 저장이라 마이그레이션 불필요.

### 추가 변경 이력 (2026-07-31 — StepMap 버튼 스타일 통일 + 상세보기 INTER 표시 개선)

- **버튼 스타일 `map-type-btn` 통일**: 위 IN 적용 O/X·Xs/Ys/XYs/없음 2개 그룹과 기존 **Map Option(10개 토글)** 이 쓰던 `map-option-btn`(채워진 배경 활성 스타일)을 `map-type-btn`(외곽선 강조 활성 스타일, MAP 요청 목적 버튼과 동일)으로 통일했다. 이로써 `map-option-btn`을 쓰는 곳이 없어져 `global.css`에서 해당 클래스 정의를 삭제했다.
- **인라인 스타일 토글 버튼도 `map-type-btn`으로 통일**: `StepMap`의 **REV Layer 드래그 다중선택 버튼**, `Step3`의 **TBV/TLV SD 선택 버튼**이 각각 하드코딩된 인라인 스타일(파란 배경 활성)을 쓰고 있던 것을 `map-type-btn` 클래스로 교체했다. **스타일만 변경**했고 드래그 다중선택·단일선택 동작 로직은 그대로다.
- **상세보기 INTER 블록 상시 노출 + "없음" 표시**: `PagedDetailView`의 MAP 탭에서 `Inter`(3번) 블록이 기존에는 `inter === 'YES'`일 때만 렌더링되던 것을 **항상 렌더링**하도록 바꾸고, `NO`일 때는 Map Option 블록과 동일하게 회색 `없음` 텍스트를 표시한다. `YES`일 때 표시 로직(신규 `in_apply`/`inter_select` vs 레거시 `inter_xs`/`inter_ys` 배지)은 기존과 동일하다.

### 추가 변경 이력 (2026-07 — Validation System 대상/비대상)

- **저장 위치**: `additional_notes` JSON 의 `detail` 하위. 모델 필드가 아니므로 마이그레이션이 없다.

| 키 | 값 | 설명 |
|---|---|---|
| `validation_system` | `'YES'`(대상) / `'NO'`(비대상) | 현재 유효값. 상신 시 상신자가 확정하고, 결재 과정에서 MASK(E) 팀이 최종 확정한다 |
| `validation_system_submitted` | `'YES'` / `'NO'` | 상신·재상신 시점의 상신자 값. MASK 가 값을 바꿔도 유지돼 두 판단의 차이를 남긴다. 임시저장에는 기록하지 않는다 |

- **자동 판정**: 활성(비-disabled) J-layer 행의 `pp` 에 판정 키워드가 하나라도 있으면 대상(`isValidationTarget()`, `RequestPage/helpers.ts`). 판정 단일 소스는 이 프론트 함수이며, 백엔드는 판정을 재계산하지 않고 저장된 값을 그대로 신뢰한다.
- **상신 UI**: 위저드 3단계(J-layer) 표 상단 토글. J-layer 가 바뀌면 자동 판정으로 값이 갱신되지만, 상신자가 토글을 직접 누르면 이후에는 J-layer 를 고쳐도 자동 갱신하지 않는다.
- **MASK 확정**: `POST /api/documents/<id>/approve-step/` 의 기존 optional body 필드 `validation_system` 으로 처리한다(별도 엔드포인트 신설 없음). `agent='E'` 일 때만 반영되며(다른 agent 값이면 무시), `'YES'|'NO'` 외 값은 400. 이 값 검증은 검토자(EV) 생성보다 먼저 실행돼 부분 커밋을 막는다. `validation_system_submitted` 는 이 요청으로 바뀌지 않는다.
- **레거시 문서**: 두 키가 없는 문서는 저장된 `jayerRows` 로 그때그때 폴백 판정해 보여준다(위저드 J-layer 단계·MASK 담당자 합의 모달·상세보기 J-layer 탭 공통).

### 추가 변경 이력 (2026-07 — 완성된 MAP 변경: 대상 프리필·J/O/B 제거·승인 시 원본 반영)

- **대상 요청서 검색 프리필**(`applyMapChangeMode`): 모드 진입 시 `mapChangeDocLabel`에 `detail.partid_selection`을 채워 검색어로 쓴다. 문서 제목에 제품명이 포함되므로 그대로 필터가 된다. `mapChangeDocId`는 `null` 유지 — 사용자가 목록에서 실제 문서를 골라야 '적용'이 활성화된다. 프리필은 **진입 시 1회만**(이후 검색어 편집 중일 수 있어 partid 변경에 재동기화하지 않음).
- **J/O/B layer 완전 제거 (Only MAP 동일)**: 두 모드 공통 파생 플래그 `isMapOnlyScope = isOnlyMap || isMapChangeMode` 신설.
  - **자동채움 차단**: 라인/조리법 변경 effect에서 `fetchJobFileLayerAndPopulateJayer`/`fetchOvlLayerAndPopulateOayer` 호출 대신 J/O를 빈 행으로 유지하고 return. (판정은 이 effect보다 아래에서 선언되는 `isOnlyMap`/`isMapChangeMode` 대신 `detail`로 직접 계산 — TDZ 회피)
  - **상신·임시저장 강제 비움**(`buildEnrichedForm`): `jayerRows`/`oayerRows`/`bbRows`를 빈 배열로 저장. 백엔드 `_validate_bb_mapping`은 `process_id`가 있는 행만 검사하므로 상신은 정상 통과한다.
- **`Only MAP` 매직 스트링 상수화**: `constants.ts`에 `ONLY_MAP_PURPOSE` 추가(백엔드 `RequestDocument.ONLY_MAP_PURPOSE`와 동일 값), `isOnlyMap`·`handleRequestPurposeSelect`·`applyOnlyMap`에서 사용.
- **결재 완료 시 원본 요청서에 MAP 반영**(신규):
  - **대상 식별**: 상신 시 `detail.map_change_source_id = mapChangeDocId` 저장(`isMapChangeMode`일 때만).
  - **반영 시점**: `views.py` `approve_step`에서 `new_status == 'approved'`가 되는 **공통 합류점** 1곳(`_apply_map_change_to_source`). `approve_step` 최종 판정 경로와 `_advance_to_parallel` 즉시승인 경로가 모두 이 지점을 지나므로 훅은 한 곳으로 충분하다.
  - **반영 범위**: `RequestDocument.MAP_APPLY_KEYS` — 프론트 `MAP_DETAIL_KEYS`와 같은 목록이되 **`map_type` 제외**(원본의 NEW/CLONE/EXISTING 정체성과 제목 표기 유지). ⚠️ 프론트 `MAP_DETAIL_KEYS` 수정 시 이 백엔드 상수도 함께 갱신해야 한다. 클라이언트가 임의 키를 원본에 쓰지 못하도록 **화이트리스트는 백엔드에 정의**한다.
  - **변경 이력**: 원본 `history[]`에 **수정 직전 스냅샷 1건만** append하고 새 값은 문서 본체(`detail`)에 둔다. 스냅샷의 `jayerRows`/`oayerRows`/`bbRows`는 **원본의 현재 값을 그대로 복사**한다 — 빈 배열로 두면 `PagedDetailView`의 `computeTableDiff(표, prevSnap.표)`가 전 행을 '변경됨'으로 오탐한다. 이 구조 덕에 기존 `changedFields = diff(현재, 직전 스냅샷)` 로직이 **바뀐 MAP 필드만 정확히 강조**한다.
  - **회차 표기**: 원본 `detail.map_edit_round = n` 저장. 2회차부터는 밀려나는 스냅샷에 `HistorySnapshot.map_edit_round = n-1`을 기록해 이력 표에서 `n차 제출` 대신 **`완성 후 수정 n회차`** 로 표시하고, 마지막 행은 `현재 (완성 후 수정 n회차)`로 표기한다. 서버는 **번호만** 기록하고 표시 문구는 프론트 i18n(`map_edit_round_label`/`map_edit_round_current`)이 만든다(규칙 G).

```
[1회차 반영 후]                    [2회차 반영 후]
1차 제출            X=1.0          1차 제출              X=1.0
현재(완성 후 수정 1회차) X=2.5        완성 후 수정 1회차      X=2.5
                                  현재(완성 후 수정 2회차) X=3.0
```

  - **실패 처리**: 원본 없음·상태가 approved 아님·JSON 오류 시 **예외를 밖으로 던지지 않는다**(승인 트랜잭션 롤백 방지). 서버 로그를 남기고 `mailer.enqueue_map_apply_failed(document)`로 **작성자에게만** 메일 통보. `MailNotification.EVENT_CHOICES`에 `map_apply_failed` 추가 → **마이그레이션 `0011_alter_mailnotification_event_type`** 필요.
  - **테스트**: `api/tests.py` `MapChangeApplyTest` 6건(반영·map_type 유지·스냅샷 표 복사·2회차 회차 기록·비대상 문서 no-op·실패 시 메일 적재).

### 추가 변경 이력 (2026-07 — Only MAP·완성된 MAP 변경 입력 잠금 통일 + map_type EDIT 개명)

- **완성된 MAP 변경에도 흐름도/특이사항/Backbone 입력 잠금 적용**: `Step1.tsx`에 `disableFlowBb = disableOptional || isMapChangeMode` 신설, 흐름도(flow_chart) 행 전체·특이사항(change_purpose_note)·Backbone(bb_entries) 행 전체에만 적용. 기타목적 버튼 행·`Layer 추가/삭제` 참조요청서 Merge·완성된 MAP 변경 검색/적용 툴바는 기존 `disableOptional` 그대로 유지(전환·조회 경로 보존 목적 — 여기까지 잠그면 대상 문서 검색/적용이나 다른 목적으로의 전환 자체가 막힘).
- **O-layer 정보 탭(Partial Shot·TBV/TLV) 잠금**: `Step3.tsx`에 `oayerInfoLocked` prop 추가(`index.tsx`에서 `isOnlyMap || isMapChangeMode`로 계산). Partial Shot O/X 토글, TBV/TLV 두께 토글, SD 선택 버튼, 비고 X/Y/사용여부 입력·행 추가/삭제, TBV/TLV 항목 추가/삭제 버튼 전체에 `disabled` 적용 — Only MAP·완성된 MAP 변경 두 모드 모두 대상.
- **`map_type` 값 `FIX` → `EDIT` 개명**: 완성된 MAP 변경 전용 map_type 값의 표시/저장값을 `FIX`에서 `EDIT`으로 변경(`StepMap.tsx` 버튼 배열·비교 조건, `index.tsx`의 `applyMapChangeMode`/`handleMapChangeApply`). i18n 키도 `map_type_fix`→`map_type_edit`(ko/en 동시, 표시 텍스트 `EDIT`)로 변경. `map_type`은 `additional_notes` JSON에 스키마 없이 저장되므로 백엔드·마이그레이션 영향 없음(기존 저장된 문서의 `FIX` 값은 과거 이력에 그대로 남고 신규 저장부터 `EDIT` 적용).

### 추가 변경 이력 (2026-07 — 재상신 변경이력 표시 개선)

- 상세 보기(`PagedDetailView`)의 재상신 변경 강조를 4가지로 확장. 상세는 `docs/APPROVAL.md` §7 참조.
  - **엠샷/생산정보/REV 블록**: 빨간 테두리 + **'이력 확인'** 버튼(이전/현재 비교 모달) 추가.
  - **J/O/BB 표 이력**: 세로 3열 → **원본 표 형식 가로 비교**(변경 전/후 2행, 바뀐 셀 강조).
  - **O-ayer 정보탭**(Partial Shot·TBV/TLV): 누락돼 있던 변경 강조·이력 확인·탭 배지 추가.
  - **n회차 이력**: `FieldHistoryModal`에 회차별 변경(최초/변경됨/변경 없음) 열 추가. `history[]` 누적 구조는 불변.

### 추가 변경 이력 (2026-07 — 기타 목적 '완성된 MAP 변경' 추가)

- **개요**: 이미 결재 완료된 요청서의 **MAP 정보만** 불러와 수정·재상신하기 위한 기타 목적 단독 항목. `Layer 추가/삭제`의 참조 요청서 검색 UI를 재사용하되 Merge(표 병합) 대신 **StepMap 필드만 프리필**한다. 백엔드·마이그레이션 변경 없음(결재 라우팅은 `request_purpose`만 사용).
  - **옵션·상수**(`constants.ts`): `OPTION_OTHER_PURPOSE`에 `'완성된 MAP 변경'` 추가. `OTHER_PURPOSE_MAP_CHANGE` 상수, 프리필/이력 비교 대상인 `MAP_DETAIL_KEYS`(map_type·지도편차·예외구역·prodc·mshot·Map Option·REV·원본위치 등 MAP 관련 키) 신규 export.
  - **단독 선택 + 전체 초기화 + 요청 목적 자동 '기타'**(`Step1.tsx`·`index.tsx`): 다른 기타 목적과 공존 불가. 진입 시 `handleSelectMapChangePurpose` → 입력이 있으면 `ConfirmModal`(`map_change_reset_*`)로 확인 후 `applyMapChangeMode`가 **요청 목적을 `기타`로 자동 설정**하고, **기본정보(라인·조합법·제품·조리법·고객/요구사항·통보처)는 유지**하며 나머지 STEP(흐름도·특이사항·Backbone·MAP·J/O-layer·매핑)을 초기화하고 `map_type='FIX'` 고정. 기존 `applyOnlyMap` 패턴 준용.
  - **다른 목적으로 전환/해제**: 완성된 MAP 변경을 켠 뒤에도 다른 목적 클릭(전환) 또는 재클릭(해제)으로 빠져나올 수 있다. `handleLeaveMapChange`→불러온/수정 MAP이 있으면 `ConfirmModal`(`map_change_leave_*`), 없으면 바로 `exitMapChangeMode`(MAP 키 전체 초기화 → FIX 해제, `other_purpose`를 전환 대상만/빈 배열로).
  - **map_type FIX**(`StepMap.tsx`): `map_type` 버튼에 `FIX`(i18n `map_type_fix`) 추가. `isMapChangeMode`일 때 FIX 외 버튼 `disabled`로 고정. `isMapRegistered`(EXISTING·CLONE)에는 미포함하므로 FIX에서 MAP 입력은 **편집·검증이 NEW와 동일하게 열린다**(별도 disable 수정 불필요).
  - **검색 툴바 + '적용' 버튼**(`Step1.tsx`): 완성된 MAP 변경 검색 툴바는 `Layer 추가/삭제`의 Merge 버튼처럼 **요청서 선택(`handleMapChangeDocPick`) 후 '적용' 버튼(`handleMapChangeApply`)** 을 눌러야 프리필된다(선택만으로 프리필 안 함). 두 검색 툴바 크기를 `maxWidth: 920`(기존 대비 2배)으로 통일.
  - **MAP 프리필**(`handleMapChangeApply`): 선택 문서 `additional_notes.detail`에서 `MAP_DETAIL_KEYS`만 현재 detail에 병합(`map_type='FIX'` 유지). 라인/prodc 변경 effect가 프리필값을 지우지 않도록 `isLoadingEditRef` 가드 사용(편집 로드와 동일).
  - **다른 STEP 필수 검증 우회 (Only MAP 동일)**: 요청 목적이 `기타`라 `isOnlyMap`은 false이므로, `validate()`의 Only MAP 우회 지점(Backbone 조합영역 step1, Partial Shot step4)에 `|| isMapChangeMode` 조건을 추가해 **MAP 외 필수 입력을 무시**한다. 기본정보(라인·조합법·제품·조리법)와 MAP 필수(X/Y·사유 등)는 그대로 검증.
  - **상신 시 변경 이력(diff)**: 프리필 직후 detail을 `mapChangeBaseline`(완전 격리 복제)으로 저장하고, `buildEnrichedForm`이 이 모드에서 `history=[{detail: baseline, 표: []}]`를 **결정적 단일 항목**으로 기록(append 아님). 상세뷰(`PagedDetailView`)의 기존 `computeDetailDiff`가 원본 MAP↔수정 MAP만 강조(기본정보·표는 양쪽 동일 → 노이즈 없음). **Draft 왕복 보존**: 편집 로드 시 `history[0].detail`에서 baseline 복원.
  - **i18n**: `map_type_fix`·`map_change_target`·`map_change_placeholder`·`map_change_apply`·`map_change_loaded`·`map_change_load_fail`·`map_change_reset_title/msg`·`map_change_leave_title/msg` (ko/en 동시).

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
# 타입체크 (2026-08-03 실측 24개 = 정상. 작업 직전 실측값과 같으면 신규 0)
cd frontend && npx tsc --noEmit 2>&1 | grep -c "error TS"

# 테스트 (helpers.test.ts 32건)
cd frontend && CI=true npx react-scripts test --watchAll=false --passWithNoTests

# 개발 서버 확인 경로
http://localhost:10011  → /request
```
