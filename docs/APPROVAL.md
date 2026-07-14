# APPROVAL — 결재 현황 페이지 (ApprovalPage)

> 작성일: 2026-06-11
> 목적: 결재(전자결재) 기능의 **실제 구현 동작**을 case별로 상세히 기록한다.
> 의도와 구현이 일치하는지 검증할 때 이 문서를 기준으로 확인한다.
> (⚠️ 표시는 "의도 확인이 필요"하거나 "현재 미구현/취약"한 부분이다.)

- 프론트 라우트: `/approval`
- 진입 컴포넌트: `frontend/src/pages/ApprovalPage.tsx`
- 결재 판정 헬퍼: `frontend/src/components/ApprovalFlow.tsx`
- 상세 보기: `frontend/src/components/PagedDetailView.tsx`
- 백엔드: `backend/api/views.py` (`RequestDocumentViewSet`의 @action들), `backend/api/models.py`

---

## 1. 데이터 모델

### 1.1 RequestDocument (의뢰서)
`backend/api/models.py:54~113`

| 필드 | 의미 |
|------|------|
| `status` | `draft`(임시저장) / `submitted`(미사용) / `under_review`(검토중) / `pause`(중단) / `approved`(승인) / `rejected`(반려). 기본값 `draft` |
| `additional_notes` | **상세 폼 전체를 JSON 문자열로 저장**(TextField). J-layer/O-layer/Bb/detail 모두 여기에 들어감 |
| `designated_pl` / `designated_pl_name` | 상신 시 지정한 검토 PL |
| `submitted_at` | 최초 상신 시각 |
| `requester_*` | 의뢰자 이름/이메일/부서 |

> ⚠️ `submitted` status는 STATUS_CHOICES에 있으나 실제로 생성되지 않는 **데드 값**(상신 시 바로 `under_review`로 감).

### 1.2 ApprovalStep (결재선 = 결재이력)
`backend/api/models.py:131~175`. RequestDocument에 FK(`related_name='approval_steps'`, CASCADE).

| 필드 | 의미 |
|------|------|
| `agent` | `PL`(검토) / `R` / `P` / `J` / `O` / `E` |
| `action` | `pending`(대기) / `approved`(합의) / `rejected`(반려) |
| `assignee` / `assignee_name` | 담당자 |
| `round` | **상신 회차**(재상신 시 +1). 화면은 항상 max(round)만 표시 |
| `is_parallel` | 병렬 단계 여부(O/E에 사용) |
| `due_date` | 완료 예정일(영업일 계산) |
| `acted_at` / `comment` | 처리 시각 / 의견 |

> 별도 "이력 테이블"은 없다. ApprovalStep 자체가 결재선이자 이력이며, `round`로 회차를
> 구분하고 `acted_at`/`comment`로 처리 내역을 남긴다.

---

## 2. 결재 흐름 전체 (case별)

```
draft ──(상신)──▶ PL 검토 ──(합의)──▶ R ──(합의)──▶ ┌─ P ─(합의)─▶ J ─┐
                     │                              │                 ├─▶ 모두 합의 시 approved
                     │                              └─ O [, E] ───────┘
                     └─(반려)─▶ rejected ──(재상신, round+1)──▶ PL 검토 …

어느 단계든 반려 → rejected

[Only MAP 의뢰서] draft ─▶ PL 검토 ─(합의)─▶ R ─(합의)─▶ approved   (P/O/E 단계 없음)
```

핵심: **PL → R → (P → J) ∥ (O [+E])**. R 합의 후 두 경로(path1=P→J, path2=O[+E])가 **병렬** 진행되고, J·O·(E) 가 **모두** 합의돼야 문서가 `approved`가 된다.

> **예외 — 요청 목적 'Only MAP'**: `RequestDocument.is_only_map()`이 참이면 결재 경로를
> **R 단계까지만** 진행한다. R 합의 시 P/O/E 단계를 생성하지 않고 곧바로 `approved`가 된다.
> 판정값 `request_purpose`는 `additional_notes` JSON의 `detail` 하위에 저장된다
> (상수 `RequestDocument.ONLY_MAP_PURPOSE = 'Only MAP'`).

### Case A — 상신 (`submit`)
- 조건: `status == 'draft'`, **지정 PL 필수**(role='PL'인 사용자, **본인 지정 불가**), `_validate_bb_mapping` 통과.
- ✅ **다중 지정 PL(2026-07)**: payload `designated_pl_loginids: [...]`(배열, 단일 `designated_pl_loginid` 도 호환). 지정 PL **전원**에 대해 `agent='PL', round=1` pending step을 각각 생성한다(`_resolve_designated_pls`로 파싱·검증). `document.designated_pl` FK 에는 **대표(첫 번째)** 만 기록(표시/하위호환용).
- 동작: `status → under_review`, `submitted_at` 기록, 기존 step 전체 삭제 후 PL step N개 생성. 통보처(있으면) 상신 메일 발송.
- ⚠️ `_validate_bb_mapping`: "활성 + `process_id` 있는 J-layer 행은 모두 Bb 매핑 필수". **단 `additional_notes` JSON 파싱 실패 시 검증을 건너뛴다(통과 처리)** — 의도 확인 필요.

### Case B — PL 검토 합의 (`peer_approve`)
- 권한: **MASTER 또는 해당 PL 단계의 assignee 본인만**(`_get_caller_pl_step`가 호출자 담당 pending PL step을 찾음).
- ✅ **다중 PL 전원 합의(2026-07)**: 본인 PL step만 `approved` 처리 후, 현재 회차 **PL step 전원이 approved** 일 때만 `agent='R'` pending 생성(`_advance_after_pl`, 문서 행 `select_for_update` 락으로 R 중복/누락 방지). 아직 미합의 PL이 있으면 `under_review` 유지(R 미생성).

### Case C — PL 검토 반려 (`peer_reject`)
- 권한: MASTER 또는 assignee 본인.
- 동작: 본인 PL step `rejected` → `status → rejected`(**다중 PL 중 1명이라도 반려하면 즉시 반려**).

### Case D — PL 수정 후 상신 (`peer_submit`)
- 권한: MASTER 또는 (현재 회차 pending PL step) assignee 본인. 문서 내용은 사전에 `/request` 화면에서 수정·update됨(`can_edit` under_review 분기가 pending PL 담당자 전원 허용).
- 동작: 본인 PL step `approved`(comment 앞 `[수정 후 상신]` 태그) → Case B와 동일하게 **전원 합의 시에만** R 생성.

### Case E — R 합의 (`approve_step` agent='R', `views.py:250`)
- 동작: R `approved` → **P(due: R당일 포함 4영업일), O(due: 6영업일, 병렬)** 동시 생성.
  추가로 `has_ppid_plel()`이 참이면 **E**(due: 6영업일, 병렬)도 생성.
- `has_ppid_plel()`(`models.py:106`): J-layer 행 중 `pp` 값에 `plel`(대소문자 무관) 포함이 하나라도 있으면 E 단계 생성.
- **Only MAP 예외**: `document.is_only_map()`이 참이면 P/O/E를 **생성하지 않고** `status → approved`로
  바로 전이한다(R 합의 = 최종 승인). 승인 메일(`enqueue_approved`)이 발송된다.

### Case F — P 합의 (`approve_step` agent='P', `views.py:272`)
- 동작: P `approved` → **J(due: P당일 포함 4영업일)** 생성. (path1은 P→J 순차)

### Case G — J / O / E 최종 합의 (`approve_step` agent in J/O/E, `views.py:284`)
- 동작: J·O·(E 있으면 E)가 **모두** `approved`일 때만 `status → approved`. 그 전엔 `under_review` 유지.
- ✅ **검토중(claim) 방식(2026-07)**: J·O·E는 지정하기 없이 **담당 팀원 누구나 '검토중'을 눌러 스스로 선점**한다.
  먼저 누른 1명이 assignee로 고정(취소·재클릭 불가)되고, **그 담당자만** 합의/반려할 수 있다(`_can_act_on_step`).
- J 합의/반려 시 **본인 담당 step만 처리**: `assignee__loginid=caller_loginid` 필터로 해당 J step을 조회한다 (MASTER는 첫 번째 pending step).
  최종 판정은 `all(s.action == 'approved' for s in j_steps)`로, 검토중 방식에서는 J step이 1개이므로 그 1명의 합의로 완료된다.
  (과거 다중 배정된 J 문서는 하위호환으로 전원 합의 로직이 그대로 적용된다.)
- ✅ 동시성: 두 결재자가 거의 동시에 마지막 합의를 눌러도 문서 행 락(`select_for_update`)으로
  직렬화되어 approved 전이가 누락되지 않는다(2026-06 수정).

### Case H — 단계 반려 (`reject_step`, `views.py:312`)
- 동작: 어느 단계든 해당 step `rejected`, `status → rejected`(즉시).

### Case I — 재상신 (`resubmit`)
- 조건: `status == 'rejected'`, 지정 PL 필수(본인 불가), bb 매핑 통과.
- 동작: `status → under_review`, **max(round)+1**로 새 PL pending 생성. 이전 round step은 이력으로 보존.
- ✅ **다중 지정 PL(2026-07)**: Case A와 동일하게 `designated_pl_loginids` 배열을 받아 새 회차에 PL step **전원**을 생성한다(전원 합의).
- ✅ **검토자 프리필(2026-07)**: 수정·재상신 화면 진입 시 이전 회차에 지정했던 PL 담당자를 상신 모달의 검토자(designees)에 **미리 채운다**(통보처처럼). `doc.approval_steps` 중 최신 회차 `agent='PL'` step의 assignee로 복원하며, **수정(추가/삭제) 가능**하다. 구현: `RequestPage` 편집 로드 `useEffect`.

### Case J — 철회 (`withdraw`, `views.py:189`)
- 조건: status가 under_review/rejected/submitted.
- 동작: `status → draft`, `submitted_at=None`, **현재 문서의 모든 step 삭제**.
- ✅ 권한: MASTER / 의뢰자 PL 본인 / 지정 PL 본인 / **의뢰자가 멤버인 '나만의 그룹'의 멤버**
  만 가능(`_can_withdraw`, 2026-06 추가). 그 외 호출은 403. 그룹 판정은
  `requester.member_groups` 기준(approved 메일 수신자 규칙과 동일).

### Case K — 담당자 지정 (`assign_step`, `views.py:331` 부근) — **R·P 전용**
- 동작: 현재 회차의 해당 agent pending step에 assignee 지정.
- ✅ 권한: 프론트 `canUserAssign`과 동일(`_can_assign_step`) —
  MASTER / 같은 팀(역할↔agent 일치) + 미지정일 때만. **PL·J·O·E 단계는 지정 불가**(J/O/E는 검토중 방식).
  또한 `agent`는 `R·P·J·O·E`만 허용(`agent='PL'`로 지정 PL을 덮어쓰는 우회 차단).

### Case K-2 — 검토중 선점 (`claim_step`, 2026-07) — **J·O·E 전용**
- 동작: 현재 회차의 해당 J/O/E pending step에 **요청자 본인을 assignee로 고정**(취소·재클릭 불가).
- ✅ 권한(`_can_claim_step`): MASTER / 같은 팀(역할↔agent 일치) + pending + 미배정일 때만. `agent`는 `J·O·E`만 허용.
- ✅ 동시성: 문서 행 락(`select_for_update`)으로 중복 선점을 막고, 이미 배정된 경우 `409`를 반환한다.
  프론트 UI: "추가" 버튼으로 여러 명을 목록에 쌓은 뒤 "확인" 클릭 시 `assignStepMultiJ` API 호출.
  권한: `TE_J` 또는 `MASTER`.

### Case L — 지정 PL 변경 (`change_designee`)
- 권한: **의뢰자 본인 또는 MASTER만**. 현재 회차 PL step의 assignee 교체.
- ⚠️ **다중 PL 미대응(보류)**: 현재는 `_get_pending_pl_step`(첫 pending PL step, = 대표)만 1:1 교체한다. 다중 PL 중 특정 담당자 지정 스왑은 후속 작업으로 보류(2026-07).

### Case M — 결재 중단(PAUSE) 요청·확인·재개 (2026-07)

진행 중(under_review) 결재를 작성자가 **중단 요청** → 현재 단계 팀이 **확인** → 문서 `pause` 전이 → 작성자가 **수정 후 재개** 하는 흐름. 모델 `PauseRequest`(`models.py`), 마이그레이션 `0006`.

- **중단 요청 (`request_pause`)**: 작성자 본인(또는 MASTER) + `status == 'under_review'` + **활성 중단요청 없음**일 때. **사유(reason) 필수**. 요청 시점의 현재(pending) 결재 단계 id 를 `target_step_ids` 로 기록한다. 상태 뱃지는 **확인 완료 전까지 그대로 유지**(검토중), 목록 현재단계 칸에 '중단 요청중' 칩만 표시.
- **중단 확인 (`confirm_pause`)**: 현재 단계 담당자(assignee) 본인, 미배정 단계면 같은 팀(역할↔agent 일치), + MASTER (`_can_confirm_pause`). 병렬(P/J ∥ O/E)이면 **target 단계 전원**이 확인해야 최종 `pause` 전이(`confirmed_step_ids` 누적, `set(target) ⊆ set(confirmed)` 시 확정). 그 전엔 under_review 유지.
- **재개 (`resume`)**: 작성자 본인(또는 MASTER) + `status == 'pause'`. `pause → under_review` 로 되돌리고 **멈춘 시점의 pending 단계를 그대로 유지**해 그 단계부터 이어간다(회차 새로 만들지 않음, 이미 합의된 병렬 경로 유지). 문서 내용은 사전에 `/request` 편집(update)에서 저장되며, 재개 시 지정 PL 재선택 불필요(`RequestPage` 가 pause 문서 편집 시 상신 대신 `resume` 호출).
  - ✅ **마감 기한 연장(2026-07)**: 재개 시 **멈춘 기간(중단 확정 `confirmed_at` ~ 재개일, 달력일)만큼** 현재 회차 pending 단계의 `due_date` 를 뒤로 민다. 중단 동안 남은 기한이 깎이지 않는다.
  - ✅ **목록 표시**: PAUSE 동안 결재현황/홈 목록의 '현재 단계 완료예정'·'최종 완료예정' 칸은 날짜 대신 **`중단`**(회색)으로 표시한다(기한이 지난 것처럼 빨갛게 보이지 않도록). `ApprovalPage`·`HomePage` 공통.
- **요청 취소 (`cancel_pause`)**: 확인 완료 전(`requested`) 요청을 작성자/MASTER 가 철회(`cancelled`).
- **자동 취소**: 요청중(requested) 상태에서 결재가 정상 진행(합의 `approve_step`/반려 `reject_step`)되어 단계가 넘어가면 기존 요청을 `cancelled` 처리(`_cancel_active_pause_requests`).
- **동결**: `status == 'pause'` 동안 `approve_step`/`reject_step`/`assign_step`/`claim_step` 은 400 으로 차단. 작성자의 재개만 가능.
- **인가/수정**: `doc_permissions.can_edit` 에 pause=작성자 본인 허용, `can_request_pause`/`can_resume` 헬퍼 추가. 시리얼라이저가 `can_request_pause`/`can_resume`/`pause_request`(state·reason·target/confirmed step ids) 를 내려줘 프론트가 버튼·배너·확인현황을 렌더한다.
- ⚠️ 메일 알림(중단요청/확인/재개)은 이번 범위에 **미포함**.

### Case N — R단계 개편: 담당자 → 검토자 → 후결자(병렬) (2026-07)

RFG(R) 단계를 **담당자(1명) → 검토자(0~1명) → 후결자(병렬)** 로 재구성했다.
신규 agent: `RV`(검토자), `RA`(후결자). 마이그레이션 `0008`.

- **담당자(R)**: PL 전원 합의 후 생성되는 기존 R 단계(RFG 팀 1명). **지정하기**로 지정.
- **검토자(RV)**: 지정하기에서 담당자와 **함께** 지정(선택 — '검토자 없음' 가능, RFG 팀). 지정 시 `RV` 단계 생성(`assign_step` 확장, `reviewer_loginid`). 담당자 합의 **후에만** 처리 가능(`approve_step` 순차 가드).
- **전환(병렬)**: 담당자(검토자 있으면 검토자까지) 합의 시 `_advance_to_parallel` → **P(4영업일)·O(6영업일)·[E(plel)] + 후결자(RA, 6영업일 병렬)** 생성.
  - **Only MAP**: P/O/E 없이 **후결자(RA)만** 생성 → 후결자 전원 합의 시 최종 승인. (후결자 미설정 시 즉시 승인)
- **후결자(RA)**: **고정 1명**(`settings.POST_APPROVER_LOGINID`, `.env`, RFG 팀) + **C가문(only_prodc=YES) 추가 후결자**(상신 모달에서 PL 중 지정, `detail.post_approvers`). 최소 1명 필수(`_validate_post_approvers`). 고정은 PL 후보 목록에 안 뜸(TE_R 이라 자동 제외).
- **최종 승인**: `J + O[+E] + 후결자(RA) 전원` 합의(Only MAP 은 RA 만). `approve_step` 최종 판정에 RA 포함.
- **후결자 변경**: 작성자(또는 MASTER)가 결재 중 **C가문 추가 후결자(미합의 RA)** 를 교체(`change_post_approver`). **고정 후결자는 변경 불가**.
- **표시**: 결재현황/홈 현재단계 — 담당자(단계명 **RFG** 그대로 표기)→검토자 순차, 병렬은 경로1(P/J)·경로2(O[/E])·**경로3(후결자(이름))** 로 최대 3행. 상세 '결재 경로' 탭은 **R 다음에 검토자(지정 시)·후결자** 행을 표시.
- ⚠️ **`.env` 설정 필요**: `POST_APPROVER_LOGINID=<RFG팀 loginid>`. `settings/base.py` 에서 읽음(규칙 D 사전 고지·동의). ⚠️ RV/RA 알림 메일은 범위 밖.

#### Case N 후속 수정 (2026-07)
- **결재현황 라벨**: 담당자(R) 단계는 `담당자`가 아니라 **원래 단계명 `RFG`(agent_R)** 로 표기(`approvalTable.ts stageLabel`). RV=검토자, RA=후결자는 유지.
- **후결자 표시**: 경로3(RA)를 `후결자 (0/1)` 카운트 → **`후결자(미합의자 이름)`** 로 변경(다른 단계와 동일한 `라벨(이름)` 형식).
- **검토자(RV) 지정 UI**: plain `<select>` → **담당자 지정과 동일한 커스텀 드롭다운**(`assign-dropdown`). 맨 위 '검토자 없음' 포함, 담당자로 고른 사람 제외.
- **상신 검색 통일**: 동료 PL 지정·**후결자·통보처** 세 검색을 **PL(제품담당자)만 + 포커스/클릭 시 목록 표시**(포털 드롭다운)로 통일. 통보처 후보를 전체 사용자 → **PL만**으로 제한(`usersAPI.list('PL')`).
- **검토자 지정 라벨 제거**: 지정하기 시 검토자 드롭다운 위 '검토자' 라벨 span 삭제(드롭다운 자체가 '검토자 없음' placeholder 로 구분).
- **검토중(J/O/E) 팀 공동 합의**: 검토중으로 **선점(assignee 존재)** 되면 **같은 팀(역할↔agent) 누구나 합의/반려** 가능(`_can_act_on_step`/`canUserAgree`). 선점 전에는 먼저 검토중 필요. 검토중 버튼은 선점 즉시 숨김(`canUserClaim`=assignee 있으면 false). `approve_step`/`reject_step`에서 J를 assignee 필터 밖으로(회차당 단일), **RA(후결자)만** assignee 필터 유지. ⚠️ 표시되는 담당자명은 **선점자**(검토를 시작한 사람)이며, 다른 팀원이 합의해도 이름은 선점자로 남는다(감사기록은 `acted_at`/comment).
- **결재경로 검토자 통합**: 상세 '결재 경로' 탭에서 검토자(RV) **별도 행 제거** → **R단계 행에 회차별 `합의자(R) + 검토자(RV, 지정 시)`** 함께 표시(`StepDisplayInfo.roleLabel`, i18n `approval.role_agreer`).

### 영업일 계산 (`utils.py:158` `calculate_business_due_date`)
- start_date(당일 포함) 기준 n번째 영업일. 주말 + `Holiday(isholiday='Y')` 제외.

---

## 3. 화면 기능 (ApprovalPage.tsx)

### 3.1 목록
- `documentsAPI.list()` 조회 후 **`approved` 제외**(`:320`)하고 표시(승인 완료건은 이력 페이지로).
- 컬럼: 제목 / 제품명 / 의뢰자 / **현재 단계** / 현재 단계 완료예정 / 최종 완료예정 / 양산일.
- 상태: `loading → error → empty → table` 4분기(2026-06 error 분기 추가). 실패 시 재시도 버튼.

### 3.2 필터 탭 (`applyClientFilter`, 클라이언트 측)
- 전체 / 내 차례(my) / agent별(R·P·J·O·E) / 임시저장(draft) / 반려(rejected).

### 3.3 현재 단계 표시 (`getDocTableRows`, `:120`)
- **PL 검토 pending**: "PL 검토(담당자명)" 단일 행, 기한 없음. **다중 PL이면 아직 미합의한 담당자명을 ` / `로 연결** 표시.
- **R 미합의**: R 단계 단일 행(담당자 유무로 상태 결정).
- **R 합의 후(병렬)**: 한 의뢰서를 **2행**으로 분리 표시 — path1(P/J), path2(O[/E]). rowSpan으로 좌측 공통열 병합.
  - path1 단계 텍스트: 현재 pending인 P(담당자명) 또는 **J**. **J는 검토중 방식이라 담당자 이름을 표시하지 않는다**. 둘 다 끝나면 "결재완료".
  - path1 done 조건: P pending 없음 AND J pending step 0개(= 합의 완료).
  - path2 단계 텍스트: pending인 O/E를 ` / `로 연결(검토중 담당자명 표시). 끝나면 "결재완료".

### 3.4 상태 배지 (`resolvePathStatus`)
- pending step에 `assignee_loginid`가 없으면 **`unassigned`(라벨: 대기중)**, 있으면 `under_review`(검토중).
- J·O·E도 검토중 방식으로 전환되어, 선점 전에는 **대기중**, 선점 후에는 **검토중**으로 표시된다.
- **중단(pause)**: `getDocTableRows` 가 pause 문서를 단일 행으로 렌더해 **`pause` 뱃지(라벨 'PAUSE') + 멈춘 현재 단계 텍스트**(예: `PAUSE JOB`)를 함께 표시한다. 중단 '요청중'(확정 전)에는 뱃지는 검토중 그대로 두고 현재단계 칸에 '중단 요청중' 칩만 붙인다(`.pause-req-chip`). 목록에 '중단' 필터 탭 추가.

### 3.5 완료 예정일
- **현재 단계 완료예정**: 해당 pending step의 `due_date`(영업일, `getDueDateDisplay`로 지남/오늘/일반 색상).
- **최종 완료예정**(`getFinalCompletionDate`): R 합의 후 max(path1End, path2End).
  - path1End = J.due, J 없으면 P.due + 4일(추정).
  - path2End = max(O.due, E.due).
  - ⚠️ path1 추정치는 영업일이 아닌 단순 +4 **달력일**이라 백엔드 실제 J due(영업일)와 다를 수 있음.

### 3.6 상세 모달 + 액션 (행 클릭 → 모달)
상세 모달은 `size="xl"` (max-width 1400px)을 사용한다 (2026-06 확대).
모달 footer는 **본인이 처리 가능한 pending step**을 찾아 버튼을 조건부 렌더한다.

| 액션 | 버튼 노출 조건(프론트) | 호출 API |
|------|----------------------|----------|
| 합의 / 반려 (R·P·J·O·E) | `canUserAgree`가 참 | `approveStep` / `rejectStep` |
| PL 합의 / 반려 / **수정 후 상신** | PL 검토 단계 + 본인 | `peerApprove` / `peerReject` / `/request`로 이동(peerSubmit) |
| 담당자 지정 (R·P) | `canUserAssign`가 참 | `assignStep` |
| 검토중 (J·O·E) | `canUserClaim`가 참 | `claimStep` |
| 지정자 변경 | PL/MASTER | `changeDesignee` |
| 철회 | PL/MASTER | `withdraw`(임시저장으로) 또는 `delete`(삭제) 선택 |
| 수정 후 재상신 | rejected/draft | `/request`로 이동(editDocId) |
| 중단 요청 | 작성자·under_review (`can_request_pause`) | 사유 입력 모달 → `requestPause` |
| 중단 확인 | 현재 pending 단계 담당자/팀+MASTER (요청중) | `confirmPause` |
| 중단 요청 취소 | 작성자 (요청중) | `cancelPause` |
| 재개 | 작성자·pause (`can_resume`) | `/request`로 이동(editDocId) → `resume` |

처리 중 `processing`으로 버튼 비활성화(더블클릭 방지), 결과는 토스트로 안내, 실패 시 `common.process_error`.

### 3.7 결재 가능 판정 (`ApprovalFlow.tsx`)
- `canUserAgree`: MASTER 항상 / PL은 자기 PL단계 assignee일 때 / 나머지(R·P·J·O·E)는 assignee 본인(R·P는 지정, J·O·E는 검토중 선점으로 배정됨).
- `canUserAssign`: **R·P 전용** — 같은 팀 + pending + 담당자 미지정일 때. PL·J·O·E는 지정 불가.
- `canUserClaim`: **J·O·E 전용** — 같은 팀 + pending + 미배정일 때 '검토중'으로 선점 가능.

---

## 4. API 엔드포인트 (모두 `POST /documents/{id}/...`)

| 액션 | URL | 핵심 payload |
|------|-----|------|
| 상신 | `submit/` | `designated_pl_loginid` |
| 재상신 | `resubmit/` | `designated_pl_loginid` |
| 철회 | `withdraw/` | - |
| 합의 | `approve-step/` | `agent`, `comment`, `approver_name` |
| 반려 | `reject-step/` | `agent`, `comment` |
| 담당자 지정 (R·P) | `assign-step/` | `agent`, `assignee_loginid`, `assignee_name` |
| 검토중 선점 (J·O·E) | `claim-step/` | `agent` |
| 중단 요청 | `request-pause/` | `reason`(필수) |
| 중단 확인 | `confirm-pause/` | `agent` |
| 재개 | `resume/` | - (pause → under_review) |
| 중단 요청 취소 | `cancel-pause/` | - |
| PL 합의/반려/수정후상신 | `peer-approve/` `peer-reject/` `peer-submit/` | `comment` |
| 지정자 변경 | `change-designee/` | (의뢰자/MASTER) |
| 삭제 | DELETE `documents/{id}/` | approved는 MASTER만 |

---

## 4.1 결재 알림 메일 (DXHUB) — 2026-06 추가

각 전이 시점에 해당 단계 권한자/작성자/그룹멤버에게 알림 메일을 보낸다.
적재(enqueue)는 결재 트랜잭션 안에서 수행되고, 커밋 직후 즉시 1회 발송(거의 실시간)하며,
실패분은 백그라운드 큐(`MailNotification` + APScheduler `process_mail_queue`, 1분 주기)가
최대 5회 재시도한다(하이브리드).

| 전이(액션) | 메일 이벤트 | 수신자 |
|-----------|-----------|--------|
| `submit`/`resubmit` | stage_arrival(PL) | 지정 PL **전원**(각 PL step별 발송) |
| `peer_approve`/`peer_submit` | stage_arrival(R) | TE_R 미지정 시 고정 주소 |
| `approve_step`(R) | stage_arrival(P·O[·E]) | P 고정 주소 / O·E 팀 전원 |
| `approve_step`(P) | stage_arrival(J) | TE_J 미지정 시 고정 주소 |
| `approve_step`(J·O·E 전부 합의) | approved | 작성자가 속한 모든 그룹 멤버 전원 |
| `reject_step`/`peer_reject` | rejected | 요청서 작성자 1명 |
| `submit`/`resubmit` | notify_submitted | **통보처 전원**(`detail.notifiers`) |
| `approve_step`(최종 승인) | notify_approved | **통보처 전원**(`detail.notifiers`) |

> **통보처(Notifier)**: 결재 권한 없이 **상신·결재완료** 시점에만 메일을 받는 인원. 최초 상신 모달에서 다중 지정하며 `detail.notifiers=[{loginid,name}]`에 저장(이메일은 발송 시점 조회). 결재 경로에는 포함되지 않으며, 상세 '결재 경로' 탭에서 **의뢰자 바로 다음**에 '통보처' 행으로 표시된다(2026-07 위치 이동). 표시 시 이름 옆에 이메일도 보이며, 통보처 이메일은 `RequestDocumentSerializer.notifier_mails`(loginid→mail)로 내려온다.

> **결재 경로 이메일 표시(2026-07)**: '결재 경로' 탭의 의뢰자·결재자·통보처는 **이름 옆에 이메일**을 함께 표시한다. 의뢰자=`requester_email`, 결재자=`ApprovalStepSerializer.assignee_mail`, 통보처=`notifier_mails`. (모델 변경·마이그레이션 없음)

> 상세 규칙·환경변수·검증 방법은 `docs/MAIL.md` 참조.

## 5. 안정성 / 동시성 (2026-06 현황)

- ✅ 상태전이 액션(submit/resubmit/withdraw/approve_step/reject_step/peer_*)은
  `transaction.atomic`으로 묶여 부분 저장(문서만 전이되고 step 누락)이 방지된다.
- ✅ approve_step/reject_step은 문서 행 `select_for_update` 락으로 동시 합의 lost-update를 방지한다.
- ✅ 프론트는 `processing`/`submitting`으로 더블클릭을 막는다.

---

## 6. ⚠️ 의도 확인이 필요한 / 알려진 취약점

검증·확인 대상(현재 구현이 의도와 맞는지 사용자 확인 필요):

1. ✅ **(2026-06 해결) 일반 단계(R·P·J·O·E) 합의/반려 + 담당자지정 + 철회 백엔드 인가 추가**
   — `approve_step`/`reject_step`(`_can_act_on_step`), `assign_step`(`_can_assign_step`),
   `withdraw`(`_can_withdraw`)에 서버측 인가를 추가해 API 직접 호출 우회를 차단했다.
   규칙은 프론트 `canUserAgree`/`canUserAssign`과 1:1 일치(철회는 Case J 규칙).

   ✅ **(2026-06 추가) 문서 수정(`update`/PATCH) 인가 + `requester` FK 설정** (`doc_permissions.can_edit`)
   — 그동안 `PATCH /documents/{id}/` 가 로그인만 하면 누구나 어떤 상태의 문서든 덮어쓸 수 있었다.
   상태별 인가를 추가: draft=작성자 / rejected=철회범위(의뢰자·지정PL·의뢰자 그룹멤버) /
   under_review=PL 검토 pending 시 지정 PL / approved=MASTER. 실패 시 403.
   또한 `perform_create` 에서 `requester=request.user` 를 설정한다 — 그 전엔 `requester` FK 가
   항상 null 이라 철회·`change_designee`·승인 알림 메일의 "의뢰자/그룹" 판정이 동작하지 않았다.
   (레거시 null 문서는 의뢰자 이메일로 보조 판별.)

   ✅ **(2026-06) 프론트 수정/철회 버튼**: 시리얼라이저가 요청자 기준 `can_edit`/`can_withdraw`
   플래그를 내려주고, `ApprovalPage` 가 그 플래그로 버튼을 노출한다(그룹 멤버 포함 정확 노출,
   권한 없는 사용자 헛클릭 403 제거).
2. ✅ **(2026-07 해결) J·O·E 검토중(claim) 방식 전환** — 지정하기 없이 담당 팀원이 '검토중'으로 선점(취소 불가) 후 그 담당자만 합의/반려. 먼저 누른 1명으로 담당이 확정된다.
3. **`_validate_bb_mapping`이 JSON 파싱 실패 시 통과 처리** — 손상된 데이터가 검증을 우회.
4. **`additional_notes`가 JSONField가 아닌 TextField** — 깨진 JSON 저장 시 `get_detail()`이
   조용히 `{}` 반환(silent 유실 가능).
5. **최종 완료예정 path1 추정치가 달력일 +4**(영업일 아님) — 표시값 부정확 가능.
6. **하드코딩 한국어 다수**(규칙 G 위반): '지정자가 변경되었습니다.'(`:435`),
   '의뢰서가 삭제되었습니다.'(`:488`) 등 — i18n 이관 필요.

---

## 7. 상세 보기(PagedDetailView) 변경 이력

- **(2026-07) INTER 표시 = 글자 코멘트**: INTER 섹션은 `inter === 'YES'` **일 때만** 노출하며, YES/NO 값 태그·버튼식 태그 없이 **글자**로 표시한다 — `INTER 적용`, Xs 적용 시 `Xs 적용`, Ys 적용 시 `Ys 적용`(` / ` 연결). Xs/Ys 는 선택 안 할 수 있으므로 적용된 것만 붙는다. (i18n: `approval.inter_applied`/`inter_xs_applied`/`inter_ys_applied`)
- **(2026-07) REV 여부 표 = 카드형(B)**: 상세보기 REV 표를 accent 좌측 rail 카드 + **Layer pill** 형태로 교체해 눈에 띄게 했다. 하드코딩 문자열(`REV 여부`·`GDS version`·`Layer / GDS version` 등)은 `request.rev_*` i18n 키로 이관.
- **(2026-07) Inter·Map Option 을 각각 별도 섹션 박스로**: `map_opt_inter`(YES 시 Xs/Ys 포함)와 `map_option_title`(옵션 태그) 블록을 map/mshot 등 다른 항목과 동일한 `chipBase` 박스(rowStyle) 로 감싸 **두 개의 독립 섹션**으로 표시한다. 기존에는 맨 div 로 렌더돼 다른 섹션과 디자인이 달랐다. (INTER 표기는 위 항목으로 다시 변경됨)
- **(2026-07) 고객/업체명 단독 표시 시 전체 폭·가운데 정렬**: '요구 사항'이 비어 있으면 '고객/업체명' Chip 을 전체 폭(`chipFull`) + 텍스트 가운데 정렬로 표시한다(둘 다 있으면 기존 좌측 2열 레이아웃 유지).
- **(2026-07) 결재 현황 테이블 계산 헬퍼 공용화**: `getDocTableRows`·`getDueDateDisplay`·`getFinalCompletionDate`·`resolvePathStatus` 등을 `frontend/src/utils/approvalTable.ts` 로 이동해 **홈 화면 '최근 의뢰 현황'과 결재 현황이 동일한 표**(현재 단계 뱃지·병렬 2행 분기 포함)를 쓰도록 했다. 홈에서 '검토중'으로 뜨고 결재 현황에서 '대기중'으로 뜨던 불일치를 해소한다. `ApprovalPage`·`HomePage` 가 이 헬퍼를 공유한다.
- **(2026-07) 모든 팀 상세 탭 전체 개방**: 역할 게이팅 플래그(`isP/isR/isJ/isO/isE`)를 **모두 `true`로 고정**하여, 모든 역할(PL·TE_R·TE_P·TE_J·TE_O·TE_E·MASTER)이 상세 보기의 **6개 탭 전부**(의뢰 상세 / MAP 정보 / J-ayer / O-ayer / 뼈찜 / 결재 경로)와 탭 내부 섹션을 **동일하게** 볼 수 있다. 이로써 아래 2026-06-13 항목의 "MAP은 순수 TE_J/TE_E 미표시" 제한도 해제된다(상세 내용은 결재 권한과 무관한 표시 영역).
- **(2026-06-13, 위 2026-07 개방으로 상위 완화됨) 원본 라인/Part ID는 MAP 정보 섹션에만 표시**: 기존에는 `source_line`/`source_partid`가 '상세 정보' 섹션(`section_detail`)과 'MAP 정보' 섹션(`section_map`, `map_type === 'CLONE'`) 두 곳에 중복 노출됐다. '상세 정보' 쪽 블록을 제거하여 **MAP 정보 섹션(CLONE)에서만** 보이도록 한다.
- 각 step에서 작성한 내용은 상세 보기에서 별도 페이지/섹션으로 분리 렌더된다: J-layer→`job_li`, O-layer→`ovl_li`(table/info 탭, info 탭에 `partial_shot`·TBV·TLV), Backbone→`bb`, MAP 변경 내용→`section_map`.
- **(2026-06-22)** J-ayer `📊 export` 버튼에 `data-tour="export-jayer"`, 결재 경로 탭 카드에 `data-tour="approval-route-tab"`을 부여했다(전체 가이드 투어 강조용, 실제 동작 변경 없음).
- **(2026-06-23)** 재상신 변경 이력 강조용으로 J-ayer 변경 행의 '이력 확인' 버튼에 `data-tour="jayer-hist-btn"`을 부여했다(투어에서 변경 전/후 비교 모달 시연용, 실제 동작 변경 없음).

---

## 8. 전체 가이드(투어) 모드

`/approval?embed=tour` 진입 시 실데이터 API 대신 샘플 시드(`frontend/src/pages/approvalTourSeed.ts`)로 결재 현황을 시연한다(평상시 동작 무영향).

- **시드**: 문서 3건 — A(R 합의 후 병렬 진행, 목록 2행 분기, **재상신 이력 1건 포함** → 상세에서 변경 필드·행 강조) / B(PL 검토 중, 단일 행) / C(R 담당자 지정 대기, 단일 행). `MY`(내 결재) 필터는 사용자 역할과 무관하게 `TOUR_APPROVAL_MY_IDS`(A·C)로 고정한다. 지정하기 시연용 샘플 팀원은 `TOUR_ASSIGN_MEMBERS`.
  - 문서 A 병렬 상태: 경로1은 **P 검토중 / J 대기**(P→J 순차라 J 단계는 아직 미생성), 경로2는 **O 검토중**(담당자 지정). P·J 동시 검토중으로 보이지 않게 한다.
- **결재 경로 다이어그램**: `frontend/src/components/ApprovalRouteDiagram.tsx`. **전체 가이드의 첫 단계(독립 컴포넌트)로 분리**되어, 결재현황 페이지(iframe)에는 더 이상 렌더하지 않는다. 최종 경로 `제품담당자→검토→RFG→[경로1 PHPSI→JOB]∥[경로2 OVL(+EUV)]→완료`와 조건(E는 plel 시·Only MAP은 R까지·반려 시 처음 PL 검토부터 새 회차로 재상신하거나 철회)을 안내한다. 박스는 약어(code) 없이 **이름(label)만** 표시하며, 완료 박스만 현재처럼 `✓ + 완료`를 유지한다.
- **지정하기 시연(실제 기능과 동일)**: 운영 지정 UI를 **커스텀 드롭다운(버튼→후보 목록→항목 클릭)+확인/취소**로 통일했고, 투어도 동일 UI를 쓴다. `open-assign`이 커서로 각 요소를 **실제 클릭**(지정하기→드롭다운 펼침→첫 후보 선택→확인). '확인' onClick은 `handleAssign`을 호출하며, 투어 모드에서는 `handleAssign`/`handleLoadTeamMembers`가 API 대신 **로컬 상태로 담당자를 배정**(샘플 `TOUR_ASSIGN_MEMBERS`)하고 토스트(`approval.assign_success`)를 띄운다. 배정 후 `assignee_loginid`가 채워져 지정 UI가 사라진다(실제 동작과 동일). 캡션은 **상단(topCaption)**으로 띄워 하단 footer 지정 UI를 가리지 않는다.
- **명령 수신**(부모 모달 → iframe `postMessage`): `tour-reset` · `my-filter`/`all-filter` · `open-detail`(대표 문서 A 제목 클릭→상세) · `open-assign`(문서 C 상세→지정하기→드롭다운→후보→확인까지 실제 배정) · `open-rowdiff`(문서 A J-ayer '이력 확인'→변경 전/후 모달) · `page-jayer`/`page-route`(상세 탭 이동, MASTER 기준 인덱스 2/5) · `pause`/`resume`.
- **`data-tour` 앵커**(투어 전용): `approval-stage`(현재 단계 컬럼·문서 A 행) · `assign-btn`(지정하기 버튼) · `assign-select`(드롭다운 버튼) · `assign-option`(첫 후보 항목) · `assign-confirm`(확인 버튼) · `jayer-hist-btn`(이력 확인 버튼).
- **시연 순서**: 소개 → MY 필터 → 현재 단계·메일 발송 안내(목록 컬럼) → 지정하기(문서 C, 실제 드롭다운→후보→확인 배정까지) → 제목 클릭(커서)으로 상세(문서 A) 열기 → 결재 경로 탭(팀별·회차별 이력) → J-ayer export 안내 → 재상신 변경 행 강조 → 이력 확인 모달. (큰 결재 경로 다이어그램은 별도 첫 단계로 분리.) export 설명은 J-ayer만 한다.
- 상세 모달은 투어에서 `PagedDetailView`에 `role="MASTER"`를 넘겨 모든 페이지가 보이도록 한다.
- **권한관리 단계**는 iframe이 아니라 컴포넌트형 데모(`PermissionUserGroupDemo`)로 전체 가이드에 포함된다 — 자세한 내용은 `docs/전체가이드.md`의 "컴포넌트형 단계 공통 / 권한관리" 참고.

---

## 9. 임시저장(draft) 그룹 가시성

임시저장(`status='draft'`) 문서는 **작성자 본인 + 작성자와 그룹을 공유하는 멤버 + MASTER** 에게만 보인다. 그 외 상태(상신/반려/완료)는 종전대로 전원에게 노출된다.

- 구현: `RequestDocumentViewSet.get_queryset`(`backend/api/views.py`).
  ```python
  qs.filter(~Q(status='draft') | Q(requester=user) | Q(requester_id__in=comember_ids))
  ```
  - `comember_ids` = 사용자가 멤버로 속한 모든 `UserGroup`(`user.member_groups`)의 멤버 id 집합(본인 포함).
  - MASTER 및 비인증(개발 모드)은 전체 조회.
- '나만의 그룹' 기준: 사용자가 **멤버로 속한 모든 그룹**(creator가 만든 그룹 + 남이 추가해준 그룹). 같은 그룹에 속한 사용자끼리 서로의 draft 를 볼 수 있다.
- 테스트: `backend/api/tests.py::DraftVisibilityTest`(작성자·그룹멤버·외부인·MASTER 가시성).
- 결재현황 페이지의 '임시저장' 필터(`status === 'draft'`)는 그대로이며, 백엔드 필터로 인해 그룹 멤버에게만 해당 draft가 내려온다.

---

*결재 로직/화면이 바뀌면 이 문서를 반드시 함께 갱신한다.*
