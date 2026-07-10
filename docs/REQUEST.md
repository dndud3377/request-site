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
- `tsc --noEmit` 기준 전체 47개 error 존재 — i18n `t()` 의 strict 키 타입 + `Set` 순회(es5 target). CRA(Babel) 빌드는 통과하므로 런타임 영향 없음.
- 하드코딩 한글 문자열 다수 잔존 (예: `MshotImageUpload` 의 "Ctrl+V 로 이미지를 붙여넣으세요", `Step2~Step4`/`StepMap` 의 "활성/전체", "STEP 정렬", "+ 행 추가", "선택 비활성화", "범위 추가", "특정 제품 삭제 필요", `FilterManageModal` 의 "저장된 필터/새 필터 만들기/전체 삭제/닫기/키워드 입력 후 Enter" 등). CLAUDE.md 규칙 G(i18n) 위반이나, 분리 시 동작 보존 위해 원문 그대로 이동. 추후 `request.*` 키로 일괄 이관 필요.

---

## 4.1 기능 변경 이력 (2026-06)

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
# 타입체크 (전체 error 47개 = 정상)
cd frontend && npx tsc --noEmit 2>&1 | grep -c "error TS"

# 테스트 (현재 테스트 파일 없음 → passWithNoTests)
cd frontend && CI=true npx react-scripts test --watchAll=false --passWithNoTests

# 개발 서버 확인 경로
http://localhost:10011  → /request
```
