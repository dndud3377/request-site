# Task 6: 전체 검증과 보고

**작업 디렉터리:** `/Users/mac_wb/codespace/request-site/.claude/worktrees/bridge-cse_01Ueeczx2qjGTBUApYUboKsd` (브랜치 `woobin`). 메인 워크트리가 아니다. 아래 모든 상대 경로는 이 디렉터리 기준이다.

**선행 조건:** Task 0~5가 모두 끝나 있어야 한다.

**Files:**
- Modify: `docs/E2E_TEST_AND_BUGS.md` (Step 4에서 조건부)

**Interfaces:**
- Consumes: Task 1~5의 결과 전부
- Produces: 사용자에게 전달할 검증 보고

---

- [ ] **Step 1: 백엔드 테스트 전체 실행**

```bash
docker exec -it request_backend_dev python manage.py test api -v 2
```

기대: 전부 PASS.

실패가 있으면 **고치기 전에 그 실패가 이번 수정 때문인지 판별한다.** `git stash`로 Task 1~5를 잠시 되돌려 같은 테스트가 원래도 실패했는지 확인하는 게 가장 빠르다. 기존 실패면 건드리지 않고 보고만 한다(규칙 H).

컨테이너가 없으면 `00-overview.md`의 부록 A를 참고한다. 띄울 수 없으면 미실행이라고 기록한다.

- [ ] **Step 2: 프론트 타입 체크와 테스트**

```bash
cd frontend
npx tsc --noEmit
npm test -- --watchAll=false --passWithNoTests
```

기대: 타입 오류 0건, `terminology.test.ts` 포함 전부 PASS.

**주의:** `react-scripts test`는 Babel을 쓰므로 **타입 체크를 하지 않는다.** `npm test`가 통과해도 Task 1의 BLOCKER가 잡혔다는 증거가 되지 못한다. `npx tsc --noEmit`이 유일한 근거다.

- [ ] **Step 3: 실행하지 못한 것을 정직하게 정리한다**

환경이 없어 못 돌린 항목을 목록으로 만든다. **"통과 예상"이라고 쓰지 않는다.** 규칙 C-1은 결과 보고를 요구하며, 미실행은 미실행이다.

- [ ] **Step 4: 남은 리뷰 지적을 기록한다**

아래 부록 B의 MEDIUM 7건 · LOW 3건을 `docs/E2E_TEST_AND_BUGS.md`에 추가한다. 이 파일은 이미 미해결 버그 리포트를 모으는 곳이다. 항목별로 위치(`파일:라인`)와 증상 한 줄을 적는다.

```bash
git add docs/E2E_TEST_AND_BUGS.md
git commit -m "docs: Validation System 리뷰의 미해결 MEDIUM/LOW 10건 기록"
```

- [ ] **Step 5: 수동 검증 시나리오를 사용자에게 제시한다 (규칙 C-2-1)**

자동 테스트를 못 돌렸다면 이게 검증의 핵심이다. 아래 4개를 그대로 전달한다.

**① 상신자 — 빌드가 되는지부터 (Task 1)**
결재현황 페이지(`http://localhost:10011/approval`)를 연다 → 본인이 상신한 진행 중 의뢰서 클릭 → `J-layer` 탭.
**성공:** 표 위에 대상/비대상 토글이 보이고, 선택된 쪽이 **주황(대상) 또는 파랑(비대상) 꽉 찬 배경 + 흰 글씨**로 또렷하다.
**실패 신호:** 화면이 아예 안 뜨거나 콘솔에 컴파일 에러 → Task 1이 안 고쳐진 것이다. 토글이 흰 배경에 파묻혀 안 보이면 CSS가 반영되지 않은 것이다.

**② 레거시 문서 — 보이는 값을 눌러본다 (Task 3)**
이 기능 이전에 만들어진 plel 의뢰서를 찾는다(`detail`에 `validation_system` 키가 없는 문서). MASK 담당자가 이미 합의한 상태여야 한다 → 상신자로 로그인 → J-layer 탭에서 **이미 선택돼 보이는 '대상'을 그대로 클릭**.
**성공:** 토스트가 뜨더라도 `결재 경로` 탭의 E 단계가 **'합의' 그대로**다.
**실패 신호:** E가 '검토중'으로 되돌아가면 Task 3이 안 먹은 것이다.

**③ MASK — 이력이 남는지 (Task 5)**
TE_E로 로그인 → E 단계 문서 선점 → **'수정 요청'** 버튼으로 사유("대상으로 보입니다")를 보낸다 → 같은 문서를 **코멘트 없이 '합의'** 한다 → `결재 경로` 탭을 연다.
**성공:** E 단계 밑에 `"[수정 요청 08-04 10:12] 대상으로 보입니다"`가 **여전히 보인다.**
**실패 신호:** 코멘트 줄이 통째로 사라지면 Task 5가 안 먹은 것이다.
**참고:** '수정 요청' 버튼을 누르면 모달 제목이 아직 "반려"이고 확인 버튼이 빨간색이다. **알려진 문제(아래 MEDIUM #7)이며 이번 범위 밖**이다 — 버그로 보고하지 않아도 된다.

**④ MASK — 검토자 추가 (Task 4)**
TE_E(e1)로 E 단계를 검토자 e2 지정해 합의 → 상신자가 값을 뒤집어 되감기 발생 → TE_E가 다시 합의하면서 **검토자를 e2 + e3 두 명**으로 지정 → `결재 경로` 탭.
**성공:** 검토자 행에 **e2와 e3가 모두** 보인다.
**실패 신호:** e3가 없으면 Task 4의 가드가 남아 있는 것이다.

---

## 부록 B: 이번에 고치지 않는 리뷰 지적 10건

Step 4에서 `docs/E2E_TEST_AND_BUGS.md`에 옮겨 적을 목록이다.

### MEDIUM

| # | 위치 | 증상 |
|---|---|---|
| 6 | `backend/api/views.py:1409-1436` | `_rewind_e_stage`가 MASK 팀에 아무 알림도 보내지 않는다. 다른 모든 전이는 메일을 적재하는데 되감기만 조용하다. `claim_step`이 `assignee`를 남겨두므로 "내 결재" 목록에는 다시 뜬다 |
| 7 | `frontend/src/pages/ApprovalPage.tsx:943, 963, 970` | '수정 요청' 버튼을 누르면 모달 제목이 `approval.modal_reject_title`("… 반려"), 라벨이 "반려 이유 (선택)", 확인 버튼이 빨간 `btn-danger`다. 성공 토스트만 분기돼 있다 |
| 8 | `backend/api/views.py:701-707`, `backend/api/mailer.py:344-355, 703-709` | `enqueue_revision_requested(document)`가 comment를 받지 않아 **수정 사유가 메일 본문에 실리지 않는다.** 상신자는 결재 경로 탭을 직접 뒤져야 한다 |
| 9 | `frontend/src/pages/ApprovalPage.tsx:507-509` | 모든 실패를 `common.process_error`로 뭉갠다. 백엔드는 "MASK 검토가 끝난 의뢰서는 변경할 수 없습니다" 같은 구체적 사유를 준다 |
| 10 | `frontend/src/pages/ApprovalPage.tsx:488` | `isOwner`에 `requester_name` 폴백이 없다. 형제 검사(`:1126-1128`)와 백엔드 `doc_permissions.is_requester`(`backend/api/doc_permissions.py:26-29`)에는 있다. fail-closed라 손상은 없고 기능만 안 보인다 |
| 11 | `frontend/src/pages/ApprovalPage.tsx:498-510` | `processing` in-flight 가드가 없다(규칙 J). 연타하면 동시 POST가 나가고 토스트 순서가 뒤집힌다. `select_for_update`가 직렬화하므로 데이터 손상은 없다 |
| 12 | `frontend/src/pages/ApprovalPage.tsx:502-505` | 백엔드의 `"변경 사항이 없습니다"` 응답을 `rewound`만 보고 분기해 "값을 변경했습니다"로 표시한다 |

### LOW

| # | 위치 | 증상 |
|---|---|---|
| 13 | `backend/api/views.py:1377-1384` | `_get_validation_system`이 `(JSONDecodeError, TypeError)`만 잡는다. `json.loads('[]')`처럼 비-dict가 나오면 `data.get`에서 `AttributeError` → 500. 기존 `_set_validation_system`에도 있던 구멍이라 회귀는 아니다 |
| 14 | `docs/REQUEST.md:319, 322` | 레거시 문서 항목이 아직 "MASK 담당자 합의 모달"을 언급한다(그 모달은 삭제됐다). 용어 교체 항목의 "뒤의 두 문구"도 실제로는 한 개만 나열한다 |
| 15 | `backend/api/views.py:669-670` | 문서가 `pause` 상태면 MASK가 수정 요청을 보낼 수 없는데, 상신자는 `pause` 중에도 값을 바꿀 수 있다(`backend/api/views.py:1079`). 사소한 비대칭 |
