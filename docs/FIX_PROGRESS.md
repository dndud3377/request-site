# FIX_PROGRESS — 의뢰서/결재/이력 오류 수정 진행 기록

> 작업 브랜치: `claude/adoring-cori-an1o34`
> 최초 작성일: 2026-06-11
> 목적: 의뢰서 작성 / 결재 현황 / 이력 조회 페이지의 오류를 점검·수정하는 작업의
> 진행 상황과 검증 방법을 한 곳에 기록한다. (컨텍스트 압축 대비 — CLAUDE.md 규칙 F)

---

## 0. 작업 배경 (사용자 요청 6개 조건)

1. 의뢰서 작성 페이지 기능 파악 → 의도대로인지 확인
2. 의뢰서 작성 시 안정성·오류 위험 점검
3. 작성 data가 결재 현황/이력 조회에 잘 보이고 backend에도 잘 저장되는지 확인
4. 결재 현황 case별 진행 흐름 확인
5. DB가 제대로 축적되는지 확인
6. **상신이 실패하는 경우가 있으면 안 된다** — 상신 실패 경로 제거

### 확정된 결정 사항
- 우선순위: **전부 순차 진행** (상신 → 검증 → error 순)
- "상신 시 J-layer 활성 행 전체 Bb 매핑 필수" 규칙 → **의도된 규칙, 유지**(수정 대상 아님)
- 진행 방식: **항목별 계획 승인 후 진행**, 파일별 개별 커밋 (규칙 E)

### 핵심 사실(분석으로 확정)
- J/O-layer/Bb 등 모든 상세는 별도 테이블이 아니라
  `RequestDocument.additional_notes`(TextField)에 **JSON 문자열**로 저장됨
  (JSONField 아님 → 깨진 JSON도 DB는 받고 `get_detail()`이 조용히 `{}` 반환).
- 결재 흐름: `draft → under_review → approved | rejected`,
  결재선 = `PL검토 → R → (P→J) ∥ (O [+E]) → 모두 합의 시 approved`.
- 백엔드에 `ATOMIC_REQUESTS` 미설정 → ORM 쓰기가 건별 autocommit.
- 결재 흐름 문서(`docs/APPROVAL.md`)는 **현재 없음** → 모든 항목 완료 후 신규 작성 예정.

---

## 1. 진행 상태 요약

| 항목 | 내용 | 상태 |
|------|------|------|
| 항목 1 | 상신 실패 방지 (race + 트랜잭션) | ✅ 완료 (코드/푸시), ⏳ docker 검증 대기 |
| 항목 2 | step 검증 dead code 정리 (빈 TODO 블록 제거) | ✅ 완료 |
| 항목 3 | 결재/이력 조회 error 상태 처리 (규칙 J) | ✅ 완료 |
| 후보1 | J/O/E 동시 합의 lost-update 방지 (`select_for_update`) | ✅ 완료 |
| 후보3 | `HistoryPage.handleDelete` 삭제 실패 토스트 표시 | ✅ 완료 |
| 후보2 | `additional_notes` JSON 손상 방어 / silent 유실 방지 | ⬜ 설명만 (미수정) |
| 문서 | `docs/APPROVAL.md` 신규 작성 (결재 기능 상세) | ✅ 완료 |

---

## 2. [항목 1] 상신 실패 방지 — 완료 내역

### 무엇을 고쳤나

**커밋 1 — `1641b14`** `frontend/src/pages/RequestPage/index.tsx`
- `isPersistingRef = useRef(false)` 가드 추가.
- `handleSaveDraft` / `handleIdleAutoSave` / `handleSubmit` 진입 시 ref가 이미
  `true`면 즉시 return, 시작 시 `true`, `finally`에서 `false`.
- (주의) `handleSubmit`은 "지정자 필수" 조기 return **이후**에 ref를 점유하도록 배치 →
  조기 return 시 ref 누수 없음.
- 해결: 신규 작성(savedId 없음) 중 20분 유휴 자동저장과 상신이 겹쳐 양쪽이 각각
  `documentsAPI.create()`를 호출 → **의뢰서 2건 중복 생성**되던 race 차단.

**커밋 2 — `af22f13`** `backend/api/views.py`
- `from django.db import connection, transaction` (transaction 추가).
- 상태전이 액션의 다중 DB 쓰기를 트랜잭션으로 묶음:
  - 쓰기 구간만 `with transaction.atomic():` — `submit`, `resubmit`, `withdraw`,
    `reject_step`, `peer_approve`, `peer_reject`, `peer_submit`
  - 분기가 많은 `approve_step`은 메서드 레벨 `@transaction.atomic` 데코레이터로 전체 래핑
    (검증 실패 early-return은 commit할 쓰기가 없어 무해).
- 검증 실패 400 응답 경로는 트랜잭션 밖에 유지 → 동작 변화 없음.
- 해결: `document.save()` 후 `ApprovalStep` 생성 실패 시 전체 롤백 →
  "under_review인데 결재단계 없음" 같은 불일치(영구 멈춤) 방지.

### 동작 변화 (happy path는 불변, 실패 케이스만 개선)
- 정상 상신: 변화 없음.
- 상신 중 결재단계 생성 실패: (전)반쪽 깨진 문서 영구 멈춤 → (후)롤백·재시도 가능.
- 신규 작성 중 자동저장+상신 동시: (전)2건 생성 → (후)1건.
- R 합의 시 P/O/E 일부만 생성 실패: (전)병렬 path 안 열림 → (후)롤백·재시도.

### 알려진 한계(이번 범위 밖)
- 트랜잭션은 **부분 저장**만 막음. J/O/E 동시 합의 시 **lost-update**
  (둘 다 미완료로 읽어 approved 못 됨)는 `select_for_update` 필요 → 후보 항목.

### 검증 방법
- 프론트(완료): `cd frontend && npx tsc --noEmit` → 신규 에러 0
  (남는 2건은 `tsconfig.json` target=ES5 / moduleResolution deprecation 경고, 기존 이슈).
- 백엔드(대기, **docker 필요** — 현재 세션엔 Django 미설치):
  ```bash
  docker exec -it <backend_container> python manage.py check
  docker exec -it <backend_container> python manage.py test api
  ```
- 수동 회귀 시나리오(`http://localhost:10011`):
  1. 신규 작성 → 임시저장 → 상신: 정상 1건, 결재현황 노출.
  2. 반려된 문서 → 재상신: round+1 PL 단계 생성, 상태 under_review.
  3. (가능하면) 상신 직후 결재현황/이력에 즉시 반영 확인.

---

## 2-2. [항목 2] step 검증 dead code 정리 — 완료 내역

### 정정 사항
- 앞서 보고한 "렌더 step ↔ validate 인덱스 불일치"는 **오류였음**. `validate(currentStep)`은
  파일명(Step2/Step3)이 아니라 `step` **상태값**으로 분기하고 렌더도 같은 상태로 컴포넌트를
  고르므로 내용이 정확히 대응한다(1=기본정보, 2=MAP, 3=J-layer, 4=O-layer+partial, 5=Bb).
- `WizardIndicator`는 클릭 점프가 없는 순수 표시용 → 이동은 next/prev 순차. step 5 도달 =
  step 1·2·4 검증 통과를 의미. 따라서 위저드는 정상 작동하며 추가 재검증 불필요.

### 결정 사항
- J-layer(step3)·O-layer(step4 행) 행 단위 필수값 검증: **추가 안 함**(행은 선택사항이 의도).
  상신 시 step 5의 "활성+process_id J-layer 행 Bb 매핑 필수"로 간접 검증.
- 상신 직전 전체 단계 재검증: **추가 안 함**(순차 이동으로 이미 보장).

### 무엇을 고쳤나
**커밋 — `frontend/src/pages/RequestPage/index.tsx`** (`validate` 함수)
- 빈 `if (currentStep === 3) { /* TODO */ }` 제거.
- 중복된 빈 `if (currentStep === 4) { /* TODO */ }` 제거(진짜 partial_shot 검증 블록은 유지).
- 의도를 설명하는 주석 2줄 추가(향후 TODO 재삽입 방지).
- 동작 변화 0 (빈 블록은 런타임 무동작이었음).

### 검증
- `cd frontend && npx tsc --noEmit` → 신규 에러 0 (tsconfig deprecation 2건만 잔존, 기존 이슈).

---

## 2-3. [항목 3] 결재/이력 조회 error 상태 처리 — 완료 내역

### 문제
- `ApprovalPage.tsx`/`HistoryPage.tsx`가 목록 조회 실패를 `.catch(()=>setDocs([]))`로
  빈 배열 처리 → 네트워크/401/500 등 실패가 "데이터 없음(empty)"과 구분 안 됨(규칙 J 위반).

### 무엇을 고쳤나
- **커밋 ① i18n** (`locales/ko.json`+`en.json`): `common.load_error` 추가
  ("목록을 불러오지 못했습니다." / "Failed to load the list."). 재시도 라벨은 기존 `common.retry` 재사용.
- **커밋 ② `ApprovalPage.tsx`**: `error` state 추가, `fetchDocs` 시작 시 `setError(false)`·catch에서
  `setError(true)`. 렌더를 `loading→error→empty→table`로 확장, error 시 메시지+재시도 버튼.
- **커밋 ③ `HistoryPage.tsx`**: 동일 패턴 적용.

### 동작 변화
- error=false(정상/빈 값) 경로는 **동작 100% 동일**. 실패 시에만 ⚠️ + 재시도 버튼 노출.
- 재조회마다 `setError(false)`로 초기화되어 에러 플래그가 박히지 않음.

### 검증
- `npx tsc --noEmit` → 신규 에러 0. ko/en `load_error` 동기화 확인.

### 범위 밖(후속 후보)
- `HistoryPage.handleDelete`의 silent catch(삭제 mutation, toast 인프라 부재) — 별도 항목.

---

## 2-4. 2차 요청(7개 항목) 진행 내역

조사: 4개 에이전트로 데이터흐름/DB, 중복·deadcode, 내용작성 UI, J/O테이블·기등록 정밀 분석.
결정: 항목2=안전한 통일만 / 항목4=전부(release_note 포함) / 항목5(2)=마지막 별도 / 항목1·7=현행 유지(검증만).

| 항목 | 내용 | 상태 |
|------|------|------|
| 1·7 | 데이터 전달/이미지/비활성화/DB 검증 | ✅ 검증완료(아래 결론), 코드변경 없음(현행 유지) |
| 6 | 기등록(new_or_copy) 잠금 해제 — 셀렉트에서 isRegistered 제거 | ✅ 완료(Step2/Step3) |
| 5(1) | J/O 표 No 행번호 열 추가 | ✅ 완료(Step2/Step3) |
| 5(3) | 체크박스 단일클릭 이중토글 버그 — dragStart 시작행 토글 제거 | ✅ 완료(index.tsx) |
| 3 | dead code 제거 — isBbSorted, console.log 3곳, 백엔드 [DEBUG] | ✅ 완료 |
| 2 | 안전한 통일 — formatDate(util), ST_CELL_COLOR(util), 백엔드 _max_round | ✅ 완료 |
| 4 | 내용작성 UI 통일 → RichTextEditor (VOC 본문, 공지 notice 본문) | ✅ 완료 (release_note는 구조 유지로 제외) |
| 5(2) | 엑셀식 복사-붙여넣기 (useCellSelection 훅, J/O 표) | ✅ 완료 |

### 항목 1·7 검증 결론
- 이미지: base64 아님, 서버 경로(`mshot_images/uuid`)만 저장 → `/media/` prefix로 표시. **온전히 전달.**
- 비활성화 행: **상신 시 JSON에서 제외 → DB 저장 안 됨**(임시저장 시만 포함). **확인 완료.**
- case별(C가문/mshot/history) 키 일치, 온전.
- (참고) draft 상세보기에서 비활성 행이 보이는 표시 불일치는 **현행 유지**로 결정.

---

## 2-5. 3차 요청(J/O 표 추가 개선 6건) 진행 내역

인터뷰로 구체화 후 진행. 결정: 항목4 자동채움 값은 st가 아니라 **layer**, 빈 칸일 때만;
항목5는 Step3에 **col_layer** 추가(st는 이미 존재); 항목4는 **Step2·Step3 모두** 적용.

| # | 내용 | 상태 |
|---|------|------|
| 1 | 셀 선택 표시 → 연한 파란 배경(반투명 inset, 엑셀식) | ✅ 완료(Step2/Step3) |
| 2 | 표 밖 클릭 시 선택 해제 (containerRef + document mousedown) | ✅ 완료(useCellSelection) |
| 3 | Delete 키로 선택 셀 값 비우기(포커스 표 안일 때, 잠긴 셀 제외) | ✅ 완료(useCellSelection) |
| 4 | product_name 채우면 step=layer 자동(빈 칸만, layer 없으면 무동작) — **J/O 모두** | ✅ 완료(index.tsx) |
| 5 | Step3에 col_layer 열 추가(sd↔pp), 타입/팩토리/표시/붙여넣기 대상 | ✅ 완료(types/constants/Step3/PagedDetailView) |
| 6 | Step3 layer 자동채움(OVL 데이터 layerid 매핑, 백엔드 무변경) | ✅ 완료(index.tsx) |

검증: `tsc --noEmit` 신규 에러 0. (이 환경은 react-scripts test 러너가 typescript 모듈
해석 실패로 실행 불가 — 테스트 파일 없음, 타입 검증으로 대체)

---

## 3. 다음 작업 예정 (순서)

1. **[항목 2] step 검증 정합성** — 다음 계획 제시 예정.
2. **[항목 3] 결재/이력 error 상태 처리** — `fetchDocs` / HistoryPage의
   `.catch(()=>setDocs([]))`로 에러가 empty와 구분 안 되는 문제(규칙 J).
3. (후보 검토) lost-update 동시성, JSON 손상 방어.
4. **문서화** — `docs/APPROVAL.md` 신규 작성 + 관련 docs 최신화.

---

*이 파일은 작업 진행에 따라 계속 갱신한다.*
