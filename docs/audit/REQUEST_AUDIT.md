# REQUEST_AUDIT — 의뢰서 작성 페이지 기능·버그 점검

> 대상: `frontend/src/pages/RequestPage/` (RequestPage, 5단계 위저드)
> 작성일: 2026-06-29 · 작업 브랜치: `claude/page-features-bug-audit-cte7ln`
> 목적: 의뢰서 작성 페이지의 **기능 인벤토리**와 **버그·오류·잠재오류**를 한곳에 정리해,
> 사용자가 읽고 수정 여부를 판단한다. 판단 결과(수정완료 / 의도된동작)를 각 항목에 기록해
> **추후 재점검 시 같은 항목을 다시 오류로 오인하지 않도록** 누적한다.

---

## 0. 이 문서 사용법 (필독)

### 0.1 항목 양식
```
### [R-NN] 제목
- 위치: 파일:라인 (함수/핸들러)
- 기능: 무엇을 하는 코드인지
- 증상/의심: 버그·오류·잠재오류 내용
- 재현/근거: 어떤 조건에서 발생하는지
- 심각도: 🔴치명 / 🟠높음 / 🟡보통 / ⚪경미
- 상태: 🔍점검필요 / 🐞버그확정 / ✅수정완료 / 🟢의도된동작(정상)
- 결정/메모: (사용자 판단 후 기록)
```

### 0.2 상태 규칙
- **🟢의도된동작** 또는 **✅수정완료** 로 표시된 항목은 **다음 점검에서 재검토 대상에서 제외**한다.
- 사용자가 "이건 의도한 동작" 이라고 하면 → 상태를 `🟢의도된동작`으로 바꾸고 `결정/메모`에 이유를 적는다.
- 수정을 진행하면 → 상태를 `✅수정완료`로 바꾸고 커밋 해시/요약을 `결정/메모`에 적는다.

### 0.3 점검 범위 표기
- ✅ 정독 완료: `index.tsx`, `constants.ts`, `helpers.ts`, 메인 렌더 구조
- ⏳ 후속 정독 예정: `Step1/StepMap/Step2/Step3/Step4.tsx` 내부 JSX·`FilterManageModal`·`ProdcRow`·`useCellSelection` 훅 (이번 1차는 메인 로직 중심)

---

## 1. 기능 인벤토리 (단계별)

### Step 1 — 기본정보 (`Step1.tsx`)
- 요청 목적 선택(`신규/차용/신규+차용/Only MAP/기타`) — Only MAP 선택 시 초기화 모달
- 기타 목적(`Layer 추가/삭제` 등) — Layer 추가/삭제 선택 시 참조 요청서 병합 UI 노출
- 라인 → 조합법 → 제품이름 → 조리법 4단 연쇄 드롭다운(상위 변경 시 하위 초기화 + API fetch)
- 고객/업체명, 요구 사항(특이사항)
- 흐름도(flow_chart) 다중 행 추가/삭제 + 행별 위치/제품/조리법/layer fetch
- Backbone 조합(bb_entries) 다중 행 추가/삭제 + 외부 데이터 사전 조회 토스트
- 실제 생산 진행 날짜(production_date)
- 참조 요청서 선택 → Merge(기등록 표시 + 미매칭 행 추가)

### Step 2 — MAP (`StepMap.tsx`)
- MAP 요청 목적(`NEW/EXISTING/CLONE`) — 전환 시 StepMap 필드 초기화 모달
- CLONE 시 원본 위치/Part ID 블록
- 지도 편차(map_change) X/Y/사유, C가문(only_prodc) 북/중/남 PRODC
- 예외구역(ea_change), M-shot(X표시) 이미지 붙여넣기(추가/수정/삭제)
- Map Option 11종 토글, REV(rev_entries) layer 선택

### Step 3 — J-layer 표 (`Step2.tsx`)
- 엑셀식 셀 선택/복사/붙여넣기(useCellSelection), 행 추가, 체크/드래그 체크
- 일괄 st/new_or_copy 설정·초기화, 선택 비활성화/복원
- product_name → 바코드 후보 조회 → step/item_id 자동 매칭
- 필터셋(localStorage) 기반 행 비활성화, SP 정렬
- J↔O / J→J 동기화(st·new_or_copy), 매핑 해제 연동

### Step 4 — O-layer 표 + 정보 탭 (`Step3.tsx`)
- J-layer와 대칭 구조(바코드 자동매칭 제외)
- partial_shot 필수 선택(Only MAP 시 우회), TBV/TLV 두께·entries
- TBV/TLV 미입력 경고 모달

### Step 5 — Backbone (`Step4.tsx`)
- 외부 데이터 탭(bb_entries별), 탭별 색상
- 자동채움(범위 layer + entry 선택), 수동 매핑(원본행 선택 → 외부데이터 스테이징 → 적용)
- 결과표 편집/정렬/행추가/일괄삭제, 초기화
- 상신 검증: 활성·process_id 있는 J-layer 행은 전부 매핑 필수

### 가로지르는 기능
- 임시저장(handleSaveDraft) / 20분 유휴 자동저장(useIdleTimer) / 상신(handleSubmit)
- 반려 재상신(editDocId) / 지정 PL 수정 후 상신(peerReviewDocId) / 전체 가이드 투어(embed=tour)
- 옵션 fetch effect 다수, 검증(validate) 단계별, 첫 오류 스크롤(scrollToFirstError)

---

## 2. 발견 항목 (점검 결과)

> 아래 항목은 **코드 정독으로 도출한 의심/잠재 이슈**다. 실제 동작·의도와 다를 수 있으므로
> 각 항목을 읽고 `상태`를 확정해 주세요(🟢의도된동작 / 🐞버그확정 / ✅수정완료).

### [R-01] bb_entries 중간 삭제 시 인덱스 기반 데이터 정합성 깨짐
- 위치: `index.tsx` `handleBbEntryDelete` (1660), 인덱스 키 Record들(`BbProductOptions`/`BbProductidOptions`/`bbExternalData`/`bbSearchQueries`), `buildAutoFillRows`(1806)·`handleApplyMappings`(1729)의 `entryIdx`
- 기능: Backbone 조합 행(bb_entries)을 인덱스로 관리. 외부 데이터 탭·탭 색상·자동채움 대상이 모두 `entryIdx`(배열 인덱스)에 묶임.
- 증상/의심: 중간 항목을 삭제하면 뒤 항목들의 인덱스가 한 칸씩 당겨지는데, ① 인덱스 키 Record(`bbExternalData` 등)는 재조회로 보정되지만 마지막 키가 잔존하고, ② **이미 결과표에 채워진 bb 행의 `entryIdx`는 옛 인덱스 그대로** 남아 탭 색상·매칭이 다른 제품과 어긋날 수 있음.
- 재현/근거: bb_entries 3개(0,1,2)에서 자동채움/매핑으로 bb 행 생성 후 0번 항목 삭제 → 남은 행의 `entryIdx`(1,2)가 가리키는 제품이 바뀜.
- 심각도: 🟠높음
- 상태: 🔍점검필요
- 결정/메모:

### [R-02] product_name 빠른 변경 시 바코드 자동매칭 stale-fetch 경합
- 위치: `index.tsx` `handleJayerChange`(1202~1212), `handleJayerAfterPaste`(1219~)
- 기능: product_name 입력 시 `getBarcodeOptions` 비동기 조회 후 step 기준으로 item_id 자동 매칭.
- 증상/의심: 요청 취소/순서 보장이 없어, product_name을 빠르게 바꾸면 **이전 요청 응답이 나중에 도착해** 현재 product와 다른 후보로 item_id가 덮어써질 수 있음.
- 재현/근거: 같은 셀에서 A→B 연속 입력, A 응답이 B보다 늦게 도착하는 네트워크 상황.
- 심각도: 🟡보통
- 상태: 🔍점검필요
- 결정/메모:

### [R-03] sortOrder = Date.now() 동일값 — 정렬 안정성 의존
- 위치: `constants.ts` `makeJayerRow/makeOayerRow/makeBbRow/makeRow`(sortOrder: Date.now()), 자동채움/병합 push(`mergeConfirm`)
- 기능: 행 순서를 `sortOrder` 오름차순으로 저장(`buildEnrichedForm` 1154~1155).
- 증상/의심: `jobFileData.map(...)`처럼 한 번에 생성되는 행들은 `Date.now()`가 모두 같은 값 → `a.sortOrder - b.sortOrder`가 0이라 **삽입 순서(엔진의 안정 정렬)에 의존**. 병합 push 행도 동일 ms면 같은 값. 대부분 동작하지만 명시적 순번이 아니라 취약.
- 재현/근거: 자동채움 다수 행 + SP 정렬 토글 반복 시 순서 흔들릴 여지.
- 심각도: ⚪경미
- 상태: 🔍점검필요
- 결정/메모:

### [R-04] bb_entries process_id 변경 시 외부 데이터 이중 fetch
- 위치: `index.tsx` `handleBbEntryChange`(1637~1650) + `useEffect [detail.bb_entries]`(451~462)
- 기능: process_id 입력 시 토스트용으로 `getBbExternalData` 1회 호출, 동시에 bb_entries 변경 effect가 전체 항목 데이터를 다시 호출.
- 증상/의심: 같은 데이터를 **두 번 조회**(토스트 전용 + 실제 로드). 네트워크 낭비 + 토스트와 실제 표시가 미세하게 어긋날 수 있음.
- 심각도: ⚪경미
- 상태: 🔍점검필요
- 결정/메모:

### [R-05] bb_entries 편집 시 활성 탭이 항상 0으로 리셋
- 위치: `index.tsx` `useEffect [detail.bb_entries]`(456~459) `setActiveBbTab(0)`
- 기능: 외부 데이터 재로드 후 첫 탭을 활성화.
- 증상/의심: Step5에서 2번 탭을 보다가 bb_entries 중 한 항목을 수정하면 **탭이 0번으로 튐**(편집 중 UX 끊김). 의도일 수 있음.
- 심각도: ⚪경미
- 상태: 🔍점검필요
- 결정/메모:

### [R-06] 하드코딩 한글 문자열·토스트 다수 (i18n 규칙 G 위반)
- 위치: `index.tsx` 곳곳 — 이미지 업로드 토스트(873,876), `'요청서 데이터 로드 실패'`(1566), `'수정 후 상신되었습니다'`(2368), `'재상신되었습니다'`(2377), `오류 발생:`(2388), `'Backbone 데이터가 N행...'`(1865), `'자동채움할 남은 원본 행이 없습니다'`(1871), 필터 삭제 토스트(1936,1952), 매핑/초기화 토스트(1884), Merge 모달 문구(2704~2727), `'검색 결과 없음'`(2826), 버튼 `'다음 →'`/`'← 이전'`/제목 `'의뢰서 수정·재상신'`(2434~2435) 등
- 기능: 사용자 노출 텍스트.
- 증상/의심: CLAUDE.md 규칙 G(모든 텍스트 i18n) 위반. ko/en 키로 이관 필요. (REQUEST.md §4에 일부 기록됨)
- 심각도: 🟡보통
- 상태: 🔍점검필요
- 결정/메모:

### [R-07] console.error 디버그 코드 잔존 (규칙 I 위반)
- 위치: `index.tsx` `handleImagePaste`(875), `fetchJobFileLayerAndPopulateJayer`(1101), `fetchOvlLayerAndPopulateOayer`(1129), `documentsAPI.getApproved().catch(console.error)`(255)
- 증상/의심: CLAUDE.md 규칙 I(디버그 코드 금지) 위반. 운영 콘솔 노출.
- 심각도: ⚪경미
- 상태: 🔍점검필요
- 결정/메모:

### [R-08] 잘못된/오해 소지 주석
- 위치: `index.tsx` 1068 `// ===== Date Format Helper =====` 바로 아래가 `handleFlowDeleteRow`(날짜 헬퍼 아님)
- 증상/의심: 주석과 실제 코드 불일치(섹션 헤더 위치 오류). 가독성/유지보수 혼란.
- 심각도: ⚪경미
- 상태: 🔍점검필요
- 결정/메모:

### [R-09] 반려 재상신 경로에서 update 2회 호출
- 위치: `index.tsx` `handleSubmit`(2352~2384)
- 기능: 상신 시 먼저 `buildEnrichedForm(note,false)`로 create/update → 이후 rejected면 `buildEnrichedForm(note,true)`(history 포함)로 **다시 update** + resubmit.
- 증상/의심: rejected 분기에서 동일 문서를 연속 2번 update(첫 번째는 history 없는 버전, 두 번째가 덮어씀). 첫 update가 불필요·낭비이며, 그 사이 실패 시 history 누락 상태가 남을 수 있음.
- 심각도: 🟡보통
- 상태: 🔍점검필요
- 결정/메모:

### [R-10] additional_notes 깨진 JSON에 대한 침묵 처리
- 위치: `index.tsx` 편집 로드(480~538), `handleRefDocSelect`(1560) — `JSON.parse(... ?? '{}')` try/catch 후 무시
- 기능: 상세는 `additional_notes`(TextField)에 JSON 문자열로 저장(JSONField 아님).
- 증상/의심: 파싱 실패 시 `catch {}`로 조용히 무시 → 편집 모드에서 데이터가 안 불러와졌는데 사용자에게 알림 없음(빈 폼으로 보임). FIX_PROGRESS.md에도 동일 위험 기록됨.
- 심각도: 🟡보통
- 상태: 🔍점검필요
- 결정/메모:

### [R-11] 매핑 스테이징 후 J행 비활성화 시 스테이징 소실
- 위치: `index.tsx` `handleApplyMappings`(1730~1731) — `!jr.disabled && stagedMappings[jr.id]`
- 기능: 외부 데이터를 J행에 스테이징 후 "적용"하면 bb 행 생성.
- 증상/의심: 스테이징만 해둔 J행이 적용 전에 비활성화되면, 적용 시 `!jr.disabled` 필터로 **조용히 누락**(staging도 정리 안 됨). 사용자는 매핑했다고 생각하지만 결과표에 안 들어감.
- 심각도: 🟡보통
- 상태: 🔍점검필요
- 결정/메모:

### [R-12] flow_chart 옵션 Record 인덱스 키 잔존
- 위치: `index.tsx` `FlowProductOptions/FlowProcessIdOptions/FlowLayerIdOptions` (idx 키), `handleFlowDeleteRow`(1069)
- 증상/의심: 흐름도 행 삭제 시 인덱스 Record의 마지막 키가 잔존(잘못된 행에 옵션이 매칭될 잠재). R-01의 흐름도판 — 영향은 작음(옵션은 dep 변경 시 재조회).
- 심각도: ⚪경미
- 상태: 🔍점검필요
- 결정/메모:

### [R-13] MAP 등록형(EXISTING/CLONE) 시 Step2 변경값 검증 전면 우회
- 위치: `index.tsx` `validate(2)` `if (!isMapRegistered) { ... }`(1994~2088)
- 기능: map_type이 EXISTING/CLONE이면 지도편차·예외구역·C가문·X표시 필수 검증을 **통째로 건너뜀**.
- 증상/의심: 등록형에서 사용자가 "변경 있음"을 골라도 X/Y/사유가 비어도 통과. 의도(등록형은 MAP 변경 입력 불필요)일 가능성이 높으나 확인 필요.
- 심각도: 🟡보통
- 상태: 🔍점검필요
- 결정/메모:

### [R-14] 첫 오류 스크롤이 step 5 매핑 오류를 못 잡을 여지
- 위치: `index.tsx` `scrollToFirstError`(2210), `validate(5)` `jayer_mapping`(2106)
- 기능: `.form-error` 첫 요소로 스크롤. step5 매핑 오류는 Step4에 `errors` prop으로 인라인 표시(REQUEST.md 기록).
- 증상/의심: Step4에서 `errors.jayer_mapping`을 `.form-error` 클래스로 렌더하는지 ⏳후속 확인 필요(미렌더면 스크롤이 상단으로만 감).
- 심각도: ⚪경미
- 상태: 🔍점검필요(Step4.tsx 정독 시 확정)
- 결정/메모:

---

## 3. 의도된 동작 / 정상 확인 (재검토 제외 목록)

> 아래는 코드상 "오류처럼 보이나 의도된 설계"로 이미 문서화되었거나 합리적으로 판단되는 항목.
> 사용자가 추가로 "의도됨"으로 확정한 항목도 여기로 옮긴다.

- 🟢 **상신 시 활성·process_id 있는 J행 전부 Bb 매핑 필수** — 의도된 규칙(REQUEST.md / FIX_PROGRESS.md 기록).
- 🟢 **J/O 행 단위 필수값 검증 없음** — 행은 선택사항, step5 매핑 규칙으로 간접 검증(`validate` 주석 2091).
- 🟢 **Only MAP 시 J/O/Backbone/partial_shot 초기화·검증 우회** — 의도(REQUEST.md 변경이력).
- 🟢 **불러온(loaded) 행의 원본 5컬럼 읽기전용 잠금** — 의도(REQUEST.md 2026-06-25).
- 🟢 **의뢰자(requester) 최초 작성자 고정** — 의도(REQUEST.md, 백엔드 serializer pop).
- 🟢 **상세를 additional_notes에 JSON 문자열로 저장(JSONField 아님)** — 기존 설계(FIX_PROGRESS.md). ※ R-10의 침묵 처리만 별개 검토.

*(여기에 사용자 확정 항목을 누적)*

---

## 4. 검증 방법
```bash
# 타입체크 (기존 베이스라인 error 47개 = 정상)
cd frontend && npx tsc --noEmit 2>&1 | grep -c "error TS"

# 테스트
cd frontend && CI=true npx react-scripts test --watchAll=false --passWithNoTests

# 확인 경로
http://localhost:10011  → /request
```

---

## 5. 변경 이력
- 2026-06-29: 1차 작성 — 의뢰서 페이지 메인 로직(index.tsx/constants/helpers) 정독 후 기능 인벤토리 + 발견 R-01~R-14 기록.
