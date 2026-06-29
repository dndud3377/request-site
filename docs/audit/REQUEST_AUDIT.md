# REQUEST_AUDIT — 의뢰서 작성 페이지 기능·버그 점검

> 대상: `frontend/src/pages/RequestPage/` (RequestPage, 5단계 위저드)
> 작성일: 2026-06-29 · 보완: 2026-06-29(2차, 전 컴포넌트 정독) · 작업 브랜치: `claude/page-features-bug-audit-cte7ln`
>
> **진행 방식 (사용자 확정):**
> 1. 페이지마다 **모든 기능을 전수 카탈로그화**한다(PART A). 통합이 아니라 **페이지 단위**로 한다.
> 2. 그 페이지의 **버그·오류·잠재오류를 별도 도출**한다(PART B). 각 버그는 어느 기능(F-ID)에 속하는지 연결한다.
> 3. 사용자가 PART B를 확인하며 수정한다. 수정/의도 확정 결과를 각 항목에 기록해 **재점검 시 재오인 방지**한다.

---

## 0. 문서 규약 (모든 페이지 공통 템플릿)

### 0.1 기능 항목(PART A) 양식
```
#### [F-N.M] 기능명
- 위치: 파일:라인 (컴포넌트/핸들러)
- 동작: 사용자 관점에서 무엇을 하는지 + 핵심 분기
- 상태/핸들러: 관련 state·핸들러·API
- 비고: 조건부 노출/비활성/특이 규칙
```

### 0.2 버그 항목(PART B) 양식
```
### [R-NN] 제목  (관련 기능: F-N.M)
- 위치: 파일:라인 (함수)
- 증상/의심 · 재현/근거 · 심각도 · 상태 · 결정/메모
```
- 심각도: 🔴치명 / 🟠높음 / 🟡보통 / ⚪경미
- 상태: 🔍점검필요 / 🐞버그확정 / ✅수정완료 / 🟢의도된동작(정상)

### 0.3 상태 규칙 (중요)
- **🟢의도된동작 / ✅수정완료** 항목은 **다음 점검에서 재검토 제외**한다.
- 사용자가 "의도한 동작"이라 하면 → 상태 `🟢의도된동작` + `결정/메모`에 이유.
- 수정 진행 시 → 상태 `✅수정완료` + `결정/메모`에 커밋 요약.

### 0.4 정독 범위
- ✅ 완료: `index.tsx`, `constants.ts`, `helpers.ts`, `Step1/StepMap/Step2/Step3/Step4.tsx`
- ⏳ 후속: `ProdcRow.tsx`, `MshotImageUpload.tsx`, `FilterManageModal.tsx`, `WizardIndicator.tsx`, 공용 훅 `useCellSelection`, 공용 컴포넌트 `AutocompleteInput`/`FormSelect`, 백엔드 `documentsAPI`/serializer (필요 시 확장)

---

# PART A. 기능 전수 카탈로그

> 단계 매핑(REQUEST.md 기준): step1=Step1, step2=StepMap, step3=Step2(J-layer), step4=Step3(O-layer), step5=Step4(Backbone)

## A-1. Step 1 — 기본정보 (`components/Step1.tsx`)

#### [F-1.1] 라인 / 조합법 / 제품이름 / 조리법 4단 연쇄 선택
- 위치: `Step1.tsx:94-134`; effects `index.tsx:301-357`
- 동작: 라인 선택 → 조합법 fetch, 조합법 → 제품이름 fetch, 제품이름 → 조리법 fetch. 상위 변경 시 하위 값·옵션 초기화.
- 상태/핸들러: `detail.line/process_selection/partid_selection/process_id`; `handleDetailChange`/`handleDetailSet`; `linesAPI.list`, `formOptionsAPI.getProcesses/getProducts/getProcessId`; `isLoadingEditRef` 가드.
- 비고: 라인은 `FormSelect`(select), 나머지는 `AutocompleteInput`(타이핑+필터).

#### [F-1.2] 입력 게이트(4개 선택 전 나머지 잠금)
- 위치: `Step1.tsx:76-82,137-141`
- 동작: 4개 모두 선택돼야 `canSelectPurpose=true` → 그 전엔 목적/흐름도/Backbone/고객/날짜 비활성 + 안내문구. Only MAP이면 `disableOptional`로 선택적 항목 잠금.

#### [F-1.3] 요청 목적 버튼군
- 위치: `Step1.tsx:144-163`; `index.tsx:891-941`
- 동작: `신규/차용/신규+차용/Only MAP/기타`. Only MAP 선택 시(기존 목적 있을 때) 초기화 확인 모달 → `applyOnlyMap`(흐름도·기타목적·특이사항·Backbone·참조요청서·J/O/Bb·partial_shot/TBV 초기화).
- 상태/핸들러: `detail.request_purpose`; `handleRequestPurposeSelect`; `onlyMapConfirm` 모달.

#### [F-1.4] 기타 목적 버튼군
- 위치: `Step1.tsx:166-183`
- 동작: `Layer 추가/삭제 / STEPSEQ 변경 / 공법 추가/변경 / Overlay,ADI CD 추가/삭제/변경 / Short loop` 토글(재클릭 해제).
- 상태: `detail.other_purpose`.

#### [F-1.5] 참조 요청서 선택 + Merge (기타목적=Layer 추가/삭제 시)
- 위치: `Step1.tsx:186-212`; `index.tsx:1549-1628`
- 동작: 승인 문서 중 선택 → 해당 문서 J/O 행 로드 → Merge 클릭 시 매칭/미매칭 통계 모달 → 확인 시 활성 매칭행 `기등록·st=X` 처리 + 미매칭 ref행 추가(loaded:true).
- 상태/핸들러: `approvedDocs`, `refDocId/refDocLabel/refJayerRows/refOayerRows`, `mergeStats`; `handleRefDocSelect/handleMergeClick/handleMergeConfirm`.

#### [F-1.6] 흐름도(flow_chart) 다중 행
- 위치: `Step1.tsx:215-293`; effects `index.tsx:400-436`; `handleFlow*`
- 동작: 행별 라인/제품/조리법/진행Layer(step_from~step_to) 입력, 행 추가/삭제(최소 1행). 라인→제품, 라인+제품→조리법, 라인+조리법→Layer 옵션 fetch.
- 상태: `detail.flow_chart`; `FlowProductOptions/FlowProcessIdOptions/FlowLayerIdOptions`(idx 키).

#### [F-1.7] 변경 목적/특이사항 메모
- 위치: `Step1.tsx:295-305`; `detail.change_purpose_note`.

#### [F-1.8] Backbone 조합 영역(bb_entries) 다중 행 *(필수)*
- 위치: `Step1.tsx:309-372`; `handleBbEntry*` `index.tsx:1631-1665`; effects `387-398,438-462`
- 동작: 행별 라인/Part ID(product)/조리법(process_id) 입력, 추가/삭제(최소 1행). 라인→제품, 라인+제품→조리법 옵션 fetch. process_id 입력 시 외부데이터 사전조회 토스트. `bb_entries` 변경 시 외부데이터 전체 재로드(Step5 탭).
- 상태: `detail.bb_entries`, `BbProductOptions/BbProductidOptions`(idx 키), `bbExternalData`.
- 비고: 검증 필수(Only MAP 시 우회). **행 key=배열 인덱스**(F-1.8 / R-01 참조).

#### [F-1.9] 고객/업체명 · 요구 사항
- 위치: `Step1.tsx:374-396`; `detail.customer_name/customer_requirement`.
- 비고: 요구 사항 비어 있으면 다음 단계 시 special-care 확인 모달(F-X.5).

#### [F-1.10] 실제 생산 진행 날짜
- 위치: `Step1.tsx:398-409`; `productionDate`(별도 state, `production_date`로 저장).

## A-2. Step 2 — MAP (`components/StepMap.tsx`)

#### [F-2.1] 초기화 버튼
- 위치: `StepMap.tsx:79-81`; `handleReset` `index.tsx:2263-2317`
- 동작: StepMap 필드(원본·지도편차·C가문·예외·X표시·MapOption·REV·partial/TBV)만 초기화. Step1 식별정보·Bb는 보존.

#### [F-2.2] MAP 요청 목적 (NEW/CLONE/EXISTING)
- 위치: `StepMap.tsx:86-107`; `handleMapTypeSelect`/`handleMapTypeChangeConfirm` `index.tsx:943-1010`
- 동작: 기존 선택을 CLONE/EXISTING로 바꿀 때만 초기화 모달. EXISTING/CLONE(`isMapRegistered`)이면 하위 MAP 입력 전반 비활성.

#### [F-2.3] 원본 위치/Part ID (CLONE 전용)
- 위치: `StepMap.tsx:110-139`; effect `index.tsx:319-328`
- 동작: `source_line` 선택 → `getMapNames`로 `source_partid` 후보 fetch.

#### [F-2.4] Only C가문(only_prodc) + 리전 복사 + PRODC 북/중/남
- 위치: `StepMap.tsx:142-182`; `handleProdcRegionSelect/handleProdcProcessChange` `index.tsx:1013-1051`; `ProdcRow`
- 동작: Yes 선택 시 북/중/남 PRODC 입력. 적용 리전 라디오로 현재 라인/조합법/제품을 해당 리전에 복사. No 전환 시 REV 초기화.

#### [F-2.5] REV 여부 (C가문 Yes 시)
- 위치: `StepMap.tsx:184-319`
- 동작: YES 시 활성 J-layer Layer 멀티선택 + GDS version 입력 → `rev_entries` 추가/삭제. 후보 Layer는 `availableRevLayers`(활성 jayer Layer − 이미 사용).
- 상태: `detail.rev_yn/rev_entries`, `revLayersSelected/revGds`.

#### [F-2.6] 지도 편차
- 위치: `StepMap.tsx:324-391`; 검증 `index.tsx:1994-2048`
- 동작: 일반 모드(map_change 없음/있음 → X/Y/사유) vs C가문 모드(북/남 X/Y + 사유, X 부호반대·절대값동일·Y동일 검증).

#### [F-2.7] 예외 구역
- 위치: `StepMap.tsx:393-408`; `ea_change/ea_value`(변경 있음 시 값 필수).

#### [F-2.8] X표시(M-shot) 변경
- 위치: `StepMap.tsx:410-463`; `MshotImageUpload`; `handleImagePaste` `index.tsx:858-883`
- 동작: 없음/추가/수정/삭제. 삭제 시 "특정 제품 삭제 필요" 경고. 추가·수정 시 이미지 붙여넣기(C가문이면 북/남 2개). 붙여넣기 → `uploadImageAPI.upload` → 경로 저장.

#### [F-2.9] Map Option 11종 토글
- 위치: `StepMap.tsx:465-505`
- 동작: photo_backside/eds_backside/inter/tsv/rf/fullchip/split/st/ecc/labelsideshot/hpkglabelheight 적용/미적용 토글. `additional_notes` JSON 저장(DB 마이그레이션 불필요).

## A-3. Step 3 — J-layer 표 (`components/Step2.tsx`)

#### [F-3.1] 활성/전체 카운터 — `Step2.tsx:84-86`
#### [F-3.2] 일괄 st·new_or_copy 설정/초기화 툴바
- 위치: `Step2.tsx:89-109`; `handleJayerSetAll/ResetField` `index.tsx:1344-1362`
- 동작: 전체O/X/초기화, 전체신규/차용/초기화. **참여행(활성·비특수)만** 적용 + 같은 layer O행 동기화.
#### [F-3.3] STEP(SP) 정렬 토글 — `Step2.tsx:101-108`, 렌더 `72-75`(`jayerSortBySp`).
#### [F-3.4] 필터셋 토글 + "+필터" 모달
- 위치: `Step2.tsx:110-128`; `FilterManageModal`; `calcDisabled`/`handleFilter*Delete*`
- 동작: localStorage 필터셋(키워드 sp/sd/pp)으로 행 비활성화 토글. 모달에서 생성/수정/삭제/전체삭제.
#### [F-3.5] 엑셀식 셀 선택/복사/붙여넣기
- 위치: `Step2.tsx:130-185`; `useCellSelection`; `handleJayerAfterPaste` `index.tsx:1216-1281`
- 동작: 드래그/Ctrl 다중선택, 붙여넣기 후 자동채움·바코드·동기화. 셀 단위 잠금 `isLayerCellLocked`(비활성·기등록 전체, loaded는 5컬럼).
#### [F-3.6] 행 체크/전체체크(indeterminate)/드래그 체크 — `Step2.tsx:150-198`; `handleJayerCheckAll/CheckToggle/DragStart/DragEnter`.
#### [F-3.7] 행 추가 / 선택 비활성화 / 복원 — `Step2.tsx:249-261`; `handleJayerAddRow/BulkDisable/BulkRestore`.
#### [F-3.8] 셀 편집(10컬럼) — `Step2.tsx:199-241`; `handleJayerChange`. product_name 변경 시 item_id 초기화·step 자동(layer값).
#### [F-3.9] 바코드 자동매칭 — `index.tsx:1202-1213`; `getBarcodeOptions`→`autoMatchItemId`(정확히 1개 매칭 시 자동), `jayerBarcodeCache`.
#### [F-3.10] 기등록/layer삭제 특수값 처리 — `isNocSpecial`; 선택 시 st='X' 자동, 동기화 송수신 제외, bb 목록/검증 제외.
#### [F-3.11] 행 시각화/잠금 — loaded 5컬럼 readonly, 기등록 회색 전체잠금, pp에 'plel' 포함 시 노랑 배경.
#### [F-3.12] Backbone 매핑 연동 — `row-mapped` 표시; 수정/붙여넣기/Delete/비활성화 시 `unmapIfMapped`로 매핑 해제·원본 복귀.

## A-4. Step 4 — O-layer 표 + 정보 탭 (`components/Step3.tsx`)

#### [F-4.1] O-layer 표 — J-layer와 대칭(F-3.1~3.8,3.10~3.12). **바코드/item_id 컬럼 없음**, J↔O 동기화는 `handleOayer*`.
#### [F-4.2] 탭 전환(목록/정보) + 정보 데이터 점 표시 — `Step3.tsx:116-147`(`oayerInfoTab`, `infoHasData`).
#### [F-4.3] Partial Shot 계측 필요(O/X) *(필수, Only MAP 우회)* — `Step3.tsx:306-330`; 검증 `index.tsx:2094-2099`.
#### [F-4.4] TBV/TLV 입력 — `Step3.tsx:332-465`
- 동작: O-layer sd에 TBV/TLV 포함 행이 있을 때만 노출. 두께 입력 + SD 단일선택 + 비고 → `tbvtlv_entries` 추가/삭제.
- 상태: `detail.tbvtlv_thickness/tbvtlv_entries`, `tbvtlvSdsSelected/tbvtlvNote`(컴포넌트 입력 임시값).
- 비고: 다음 단계 시 TBV/TLV 행 있는데 미입력이면 경고 모달(F-X.5).

## A-5. Step 5 — Backbone (`components/Step4.tsx`)

#### [F-5.1] 자동채움 진입 + "N행 조회됨" — `Step4.tsx:137-154`; `handleOpenAutoFillPanel`. 외부데이터 전무 시 버튼 비활성.
#### [F-5.2] 자동채움 패널(Layer 범위 + 제품)
- 위치: `Step4.tsx:156-249`; `buildAutoFillRows`/`handleApplyAutoFill` `index.tsx:1806-1875`
- 동작: 범위(시작~종료 Layer) + 제품(`entryIdx` select) 다중 추가 → 적용 시 미매핑·범위내·외부데이터 매칭 행을 결과표에 append. 후보 Layer=미매핑 활성 행(`remainingLayerOptions`).
#### [F-5.3] 좌측 원본 데이터 목록 — `Step4.tsx:252-316`. 미매핑·활성·비특수 J행만, 클릭 시 `selectedJayerRowId` 선택.
#### [F-5.4] 우측 외부 데이터(탭별) + 검색 + 스테이징
- 위치: `Step4.tsx:318-417`; `handleStageMapping`; `bbSearchQueries`; `bbTabColor`(2탭↑ 색상).
- 동작: bb_entries별 탭, 행 클릭 시 선택 원본행에 스테이징.
#### [F-5.5] 스테이징 미리보기/취소/적용 — `Step4.tsx:298-308,420-437`; `handleClearStaging/handleApplyMappings`.
#### [F-5.6] 결과표(bb 정보) — `Step4.tsx:439-529`; `handleBbChange/SortBbRows/BbAddRow/BbBulkDelete/ResetBbRows`. 전체체크, SEQ 정렬, 행추가, 선택 원복(원본 복귀), 초기화. Ref.PART ID 셀 탭색(entryIdx).
#### [F-5.7] 상신 매핑 검증 — `index.tsx:2101-2109`. 활성·process_id 있는 비특수 J행 전부 매핑돼야 상신 가능.

## A-6. 가로지르는 기능

#### [F-X.1] 임시저장 — `handleSaveDraft` `index.tsx:2164-2183`. isDraft=true(비활성 행 포함 저장), `isPersistingRef` 가드.
#### [F-X.2] 20분 유휴 자동저장 — `useIdleTimer(handleIdleAutoSave, 20분)` `index.tsx:2185-2206`. 식별정보 4개 있을 때만, persisting 중이면 skip.
#### [F-X.3] 상신/재상신/지정PL 수정상신 — `handleSubmitClick`→지정자 선택 모달→`handleSubmit` `index.tsx:2319-2393`. status에 따라 `submit/resubmit/peerSubmit`. 지정자 드롭다운 검색(`plUserOptions`).
#### [F-X.4] 진입 모드 — 신규 / 반려 재상신(`editDocId`) / 지정PL(`peerReviewDocId`) / 투어(`embed=tour`). 편집 로드 `index.tsx:474-541`, 의뢰자 원본 고정(`originalRequesterRef`).
#### [F-X.5] 단계 이동·검증·첫 오류 스크롤 — `handleNextStep/PrevStep`, `validate`, `scrollToFirstError` `index.tsx:2208-2261`. special-care/TBV 경고 모달.
#### [F-X.6] 가이드 배지·슬라이드 패널 — `GuideBadge`/`toggleSlidePanel`/`GuideSlidePanel`.

---

# PART B. 버그·오류 점검

> 코드 정독으로 도출한 의심/잠재 이슈. 각 항목 `상태`를 확정해 주세요.

### [R-01] bb_entries 중간 삭제 시 인덱스 정합성 깨짐  (관련: F-1.8, F-5.2, F-5.4, F-5.6)
- 위치: `index.tsx:1660` `handleBbEntryDelete`; `Step1.tsx:317`(`key={idx}`); 인덱스 키 Record들; `buildAutoFillRows`/`handleApplyMappings`의 `entryIdx`; `Step4.tsx:509`(셀 색)
- 증상/의심: bb_entries를 인덱스로 관리(행 key·옵션 Record·외부데이터 탭·결과표 `entryIdx`·탭색). 중간 항목 삭제 시 ① 이미 만들어진 bb 행의 `entryIdx`가 옛 인덱스로 남아 **제품·탭색이 어긋나고**, ② React key=인덱스라 입력 포커스/값이 잘못된 행에 붙을 수 있음.
- 재현/근거: bb_entries 3개로 자동채움/매핑 후 0번 삭제 → 남은 결과행이 가리키는 제품 변경.
- 심각도: 🟠높음 · 상태: 🔍점검필요 · 결정/메모:

### [R-02] product_name 빠른 변경 시 바코드 자동매칭 stale-fetch 경합  (관련: F-3.9)
- 위치: `index.tsx:1202-1213,1219-1239`
- 증상/의심: `getBarcodeOptions` 요청 취소·순서보장 없음 → 늦게 온 이전 응답이 현재 product의 item_id를 덮어쓸 수 있음.
- 심각도: 🟡보통 · 상태: 🔍점검필요 · 결정/메모:

### [R-03] sortOrder=Date.now() 동일값 — 정렬 안정성 의존  (관련: F-1.6, F-3.x, F-5.6)
- 위치: `constants.ts`(make*Row), 병합 push `index.tsx:1604,1621`
- 증상/의심: 한 번에 생성되는 행들의 `sortOrder`가 같은 ms 값 → `a.sortOrder-b.sortOrder=0`, 삽입순서(엔진 안정정렬)에 의존. 명시적 순번 아님.
- 심각도: ⚪경미 · 상태: 🔍점검필요 · 결정/메모:

### [R-04] bb_entries process_id 변경 시 외부데이터 이중 fetch  (관련: F-1.8)
- 위치: `index.tsx:1637-1650` + effect `451-462`
- 증상/의심: 토스트용 1회 + bb_entries 변경 effect 1회 = 동일 데이터 2회 조회.
- 심각도: ⚪경미 · 상태: 🔍점검필요 · 결정/메모:

### [R-05] bb_entries 편집 시 활성 탭 항상 0으로 리셋  (관련: F-1.8, F-5.4)
- 위치: `index.tsx:456-459` `setActiveBbTab(0)`
- 증상/의심: Step5에서 2번 탭 보던 중 bb_entries 수정 시 탭이 0번으로 튐.
- 심각도: ⚪경미 · 상태: 🔍점검필요 · 결정/메모:

### [R-06] 하드코딩 한글 문자열·토스트 다수 (i18n 규칙 G 위반)  (관련: 전 기능)
- 위치: `index.tsx`(이미지/병합/상신/필터/매핑/모달/버튼/제목 다수), `Step1~Step4/StepMap`(안내문·플레이스홀더·"활성/전체"·"+행 추가"·"선택 비활성화"·"STEP 정렬"·"범위 추가"·"특정 제품 삭제 필요"·"검색어 입력"·"데이터 로드 중..." 등)
- 증상/의심: CLAUDE.md 규칙 G 위반. ko/en 키 이관 필요(REQUEST.md §4에 일부 기록).
- 심각도: 🟡보통 · 상태: 🔍점검필요 · 결정/메모:

### [R-07] console.error 디버그 코드 잔존 (규칙 I 위반)  (관련: F-1.1, F-1.8, F-2.8, F-3.x)
- 위치: `index.tsx:255,875,1101,1129`
- 심각도: ⚪경미 · 상태: 🔍점검필요 · 결정/메모:

### [R-08] 잘못된 섹션 주석  (관련: F-1.6)
- 위치: `index.tsx:1068` `// ===== Date Format Helper =====` 아래가 `handleFlowDeleteRow`
- 심각도: ⚪경미 · 상태: 🔍점검필요 · 결정/메모:

### [R-09] 반려 재상신 경로에서 update 2회 호출  (관련: F-X.3)
- 위치: `index.tsx:2352-2384`
- 증상/의심: rejected 분기에서 history 없는 버전으로 update 후 history 버전으로 다시 update. 첫 update 불필요·중간 실패 시 history 누락 위험.
- 심각도: 🟡보통 · 상태: 🔍점검필요 · 결정/메모:

### [R-10] additional_notes 깨진 JSON 침묵 처리  (관련: F-X.4, F-1.5)
- 위치: `index.tsx:480-538`(편집 로드 `catch {}`), `1560-1567`(참조 로드)
- 증상/의심: 파싱 실패 시 조용히 무시 → 편집 모드에서 데이터 미로드인데 사용자 알림 없이 빈 폼으로 보임.
- 심각도: 🟡보통 · 상태: 🔍점검필요 · 결정/메모:

### [R-11] 스테이징 후 J행 비활성화 시 매핑 소실  (관련: F-5.5)
- 위치: `index.tsx:1730-1731` `!jr.disabled && stagedMappings[jr.id]`
- 증상/의심: 스테이징만 해둔 J행이 적용 전 비활성화되면 적용 시 조용히 누락(staging 정리도 안 됨).
- 심각도: 🟡보통 · 상태: 🔍점검필요 · 결정/메모:

### [R-12] flow_chart 옵션 Record 인덱스 키 잔존  (관련: F-1.6)
- 위치: `FlowProductOptions/FlowProcessIdOptions/FlowLayerIdOptions`(idx 키), `handleFlowDeleteRow`
- 증상/의심: 행 삭제 시 인덱스 Record 마지막 키 잔존(영향 작음, 옵션은 dep 변경 시 재조회). R-01의 흐름도판이나 entryIdx 영속 문제는 없음.
- 심각도: ⚪경미 · 상태: 🔍점검필요 · 결정/메모:

### [R-13] MAP 등록형(EXISTING/CLONE) 시 Step2 변경값 검증 전면 우회  (관련: F-2.2, F-2.6~2.8)
- 위치: `index.tsx:1994` `if (!isMapRegistered) { ... }`
- 증상/의심: 등록형이면 지도편차·예외·C가문·X표시 필수 검증을 통째로 건너뜀. 단, StepMap에서 해당 입력이 모두 `disabled=isMapRegistered`라 입력 자체가 막혀 **일관성은 있음**(의도 가능성 높음, 확인 필요).
- 심각도: 🟡보통 · 상태: 🔍점검필요 · 결정/메모:

### [R-14] step5 매핑 오류 스크롤 — 인라인 렌더 확인  (관련: F-5.7, F-X.5)
- 위치: `scrollToFirstError` `index.tsx:2210`; `Step4.tsx:131-135`(`errors.jayer_mapping`을 `.form-error`로 렌더)
- 증상/의심: ✅ Step4가 `.form-error`로 인라인 렌더함을 확인 → 스크롤 정상 동작 예상. (기존 우려 해소, 동작 확인만 권장)
- 심각도: ⚪경미 · 상태: 🟢의도된동작(코드상 정상) · 결정/메모: Step4.tsx:131-135에서 인라인 렌더 확인됨.

### [R-15] 모든 원본행 매핑 시 좌측 목록 빈 화면(안내 없음)  (관련: F-5.3)
- 위치: `Step4.tsx:259-261,273-276`
- 증상/의심: 좌측 빈상태 안내는 "활성·비특수 행 0개"일 때만. **행은 있으나 전부 매핑**이면 tbody가 비어 안내 없이 빈 표만 보임(매핑 완료 안내 부재).
- 심각도: ⚪경미 · 상태: 🔍점검필요 · 결정/메모:

### [R-16] TBV/TLV 입력 임시값(tbvtlvNote/tbvtlvSdsSelected) 미저장·미초기화  (관련: F-4.4)
- 위치: `Step3.tsx:399-424`; 부모 state `index.tsx:229-230`
- 증상/의심: "추가" 전 입력한 비고/SD 선택은 detail에 미반영. 탭 이동·임시저장 시 손실되며, 단계 이탈 후 복귀해도 입력칸에 남아 혼동 가능(초기화 시점 없음).
- 심각도: ⚪경미 · 상태: 🔍점검필요 · 결정/메모:

### [R-17] 자동채움 패널 제품 select에 제품 미입력 항목도 표시  (관련: F-5.2)
- 위치: `Step4.tsx:204-208`(`detail.bb_entries` 전체 옵션) vs `buildAutoFillRows`(`!entry.product` 시 무시)
- 증상/의심: `[라인] `(제품 빈) 옵션이 선택지에 노출 → 선택해도 결과 0행, 사용자 혼동.
- 심각도: ⚪경미 · 상태: 🔍점검필요 · 결정/메모:

### [R-18] 외부데이터 탭 색상/결과표 색상 — bb_entries 변경 시 entryIdx 영속 불일치  (관련: F-5.4, F-5.6, R-01 연계)
- 위치: `Step4.tsx:328-348,509`; `bbTabColor(idx)` vs 저장된 `row.entryIdx`
- 증상/의심: 탭색은 **현재 인덱스**(`idx`), 결과표색은 **저장된 entryIdx**. bb_entries 순서변경/삭제 시 둘이 어긋남(R-01과 동일 뿌리). 단독으로도 "탭색≠결과표색" 혼동.
- 심각도: 🟡보통 · 상태: 🔍점검필요 · 결정/메모:

---

# PART C. 의도된 동작 / 정상 (재검토 제외)

- 🟢 상신 시 활성·process_id J행 전부 Bb 매핑 필수 — 의도(REQUEST.md/FIX_PROGRESS.md).
- 🟢 J/O 행 단위 필수값 검증 없음(행은 선택, step5 매핑으로 간접검증) — `validate` 주석.
- 🟢 Only MAP 시 J/O/Backbone/partial_shot 초기화·검증 우회 — 의도.
- 🟢 loaded 행 5컬럼 읽기전용 잠금, 수동행은 전 컬럼 편집 — 의도.
- 🟢 기등록/layer삭제 행 동기화·bb목록·검증 제외 + st 자동 X — 의도.
- 🟢 의뢰자 최초 작성자 고정 — 의도(백엔드 serializer pop).
- 🟢 상세를 additional_notes JSON 문자열로 저장 — 기존 설계(※ R-10 침묵처리만 별개).
- 🟢 R-14 step5 매핑 오류 인라인 렌더 — 코드상 정상.

*(사용자 확정 항목을 여기에 누적)*

---

# 검증 방법
```bash
cd frontend && npx tsc --noEmit 2>&1 | grep -c "error TS"   # 베이스라인 47개=정상
cd frontend && CI=true npx react-scripts test --watchAll=false --passWithNoTests
# 확인 경로: http://localhost:10011 → /request
```

# 변경 이력
- 2026-06-29(1차): 메인 로직 정독 후 발견 R-01~R-14 기록.
- 2026-06-29(2차): 전 Step 컴포넌트 정독 → 기능 전수 카탈로그(PART A, F-1.1~F-X.6) 신설, 버그를 PART B로 분리·기능 연결, R-15~R-18 추가, R-14 정상 확정.
