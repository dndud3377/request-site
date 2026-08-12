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
| `agent` | `PL`(검토) / `R` / `RV`(검토자) / `P` / `PV`(검토자, 2026-07) / `J` / `O` / `E` / `EV`(검토자, 2026-07) / `RA`(후결자) |
| `action` | `pending`(대기) / `approved`(합의) / `rejected`(반려) / `skip`(건너뜀, EV 전용) |
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
draft ──(상신)──▶ PL 검토 ──(합의)──▶ R ──(합의)──▶ ┌─ P[검토중,+검토자PV] ─────────────────┐
                     │                              ├─ J[검토중] ───────────────────────────┤
                     │                              ├─ O, E[검토중,+검토자EV] ─────────────┤─▶ 모두 합의 시 approved
                     │                              └─ RA(후결자) ─────────────────────────┘
                     └─(반려)─▶ rejected ──(재상신, round+1)──▶ PL 검토 …

어느 단계든 반려 → rejected

[Only MAP 의뢰서] draft ─▶ PL 검토 ─(합의)─▶ R ─(합의)─▶ approved   (P/O/E 단계 없음, 후결자(RA)만 종단)

[MAP 삭제/수정 의뢰서] draft ─▶ PL 검토 ─(합의)─▶ ┌─ P[검토중,+검토자PV] ─┐
                                                  ├─ R[+검토자RV]        ├─▶ 네 단계 모두 합의 시 approved
                                                  ├─ J[검토중]           │
                                                  └─ O[검토중]           ┘
                                                  (E·후결자(RA) 없음 — R 은 관문이 아니라 병렬 구성원, 2026-08)
```

핵심: **PL → R → (P[→검토자 PV]) ∥ (J) ∥ (O, E[→검토자 EV]) ∥ (RA)**. R 합의 후 네 경로가 **병렬** 진행된다.

> **(2026-08) J 단계 분리**: 예전에는 `P → J` 순차였다(P 담당자+검토자 전원 합의 시점에 J 를 생성).
> 이제 J 는 R 합의 시점에 P·O·E·RA 와 **함께 생성되는 독립 병렬 단계**이며, 기한도
> P(4영업일)가 아니라 **O/E 와 동일한 6영업일**이다. 이 변경으로 **P 가 마지막 합의자가 될 수
> 있게 되어**, 최종 승인 판정 트리거에 `P`/`PV` 를 추가하고 판정 조건에도 P 완료를 명시했다
> (예전에는 "J 가 존재한다 = P 가 끝났다" 였기에 P 를 생략했다). 적용 범위는 **일반 경로만**이며
> Only MAP(J 없음)·MAP 삭제/수정(원래부터 J 병렬)은 그대로다.
P/E는 (2026-07부터) O/J와 동일하게 **검토중(claim) 방식**이며, 선점한 담당자가 다중 검토자(PV/EV)를 추가 지정할 수 있다 —
완료 판정은 **E/EV·P/PV 모두 담당자 + 지정된 검토자 전원 합의(AND)** 로 동일하다(2026-08 이전엔 EV만
1명 합의로 끝나는 OR 이었고 남은 EV 는 `skip` 으로 닫혔으나, 지정한 검토자 전원의 확인이 필요하다는
요구사항에 맞춰 P/PV 와 같은 규칙으로 통일했다 — `skip` 값 자체는 그 이전 문서의 이력으로만 남는다).
검토자가 0명이면 양쪽 모두 담당자 합의만으로 완료된다(하위호환).
P는 검토자가 없으면 담당자 합의만으로 완료되지만,
**E는 2026-08부터 검토자 지정이 필수**다(비어 있으면 400 — 기존 문서를 위한 하위호환 예외는 Case G 참고).
최종적으로 J·O·(E, 있으면 검토자까지) 가 **모두** 합의돼야 문서가 `approved`가 된다.

> **예외 — 요청 목적 'Only MAP'**: `RequestDocument.is_only_map()`이 참이면 결재 경로를
> **R 단계까지만** 진행한다. R 합의 시 P/O/E 단계를 생성하지 않고 곧바로 `approved`가 된다.
> 판정값 `request_purpose`는 `additional_notes` JSON의 `detail` 하위에 저장된다
> (상수 `RequestDocument.ONLY_MAP_PURPOSE = 'Only MAP'`).

> **예외 — 요청 목적 'MAP 삭제/수정' (2026-08)**: `RequestDocument.is_map_delete_edit()`이
> 참이면 PL 전원 합의 직후 **P·R·J·O 를 한 번에 병렬 생성**한다(`ROUTE_AGENTS_MAP_DELETE_EDIT`
> = `P·PV·R·RV·J·O`). E(MASK)와 후결자(RA)는 만들지 않는다 — **모든 문서가 받던 고정 후결자
> 조차 이 경로에는 붙지 않는 유일한 예외**다. 상세는 아래 **Case O** 참조.

> **예외 — 기타 목적 'Overlay 변경' 단독 (2026-08)**: `RequestDocument.skip_j_stage()`가 참이면
> **일반 경로에서 J 단계를 아예 만들지 않는다**(`PL → R → P ∥ O ∥ [E] ∥ RA`). 판정은
> `detail.other_purpose` 가 **정확히 `['Overlay 변경']` 한 개**일 때만 참이다 — 다른 기타 목적을
> 함께 골랐으면(예: `Overlay 변경 + STEPSEQ 변경`) 그 목적의 검토가 남아 있으므로 J 를 유지한다
> (상수 `RequestDocument.OTHER_PURPOSE_OVERLAY`, 프론트 `RequestPage/constants.ts` 의
> `OTHER_PURPOSE_OVERLAY` 와 같은 값). 구버전 문서의 문자열 저장도 배열로 정규화해 처리한다.
> - **적용 범위는 일반 경로만**이다. `MAP 삭제/수정`은 P·R·J·O 가 한 묶음의 병렬이라 제외하고
>   (`skip_j_stage()`가 `is_map_delete_edit()`이면 곧바로 거짓), `Only MAP`은 원래 J 가 없다.
> - **최종 승인 판정**: `j_approved` 는 원래 `len(j_steps) > 0` 을 요구해, J 를 만들지 않으면
>   나머지 단계가 모두 합의돼도 판정이 영원히 거짓이 되어 문서가 `under_review` 에 영구 정지한다.
>   그래서 `skip_j_stage()` 인 문서는 `j_approved = True` 로 둔다(Case G).
> - **검토 항목**: J 단계 전용 기능이므로 이 문서는 `fill_from_master()` 로 채우지 않는다
>   (J step 이 없으면 `review_items.is_stage_open()` 이 항상 거짓이라 화면도 닫힌다).
> - **메일**: `mailer.ROUTE_AGENTS_NO_J` — 반려 시 잔여 결재선 수신자와 '결재 경로' 카드에서
>   J 가 함께 빠진다. **결재 상세 '결재 경로' 탭**은 J 행을 `해당없음`으로 표시한다
>   (E·RA 와 같은 na 분기 — 없으면 '대기'로 영구 표시된다). 결재현황 목록 그리드의 J 칸은
>   step 이 없으면 자동으로 `해당없음` 이 되어 별도 처리가 없다.
> - 테스트: `test_j_step_not_created_when_other_purpose_is_overlay_only`,
>   `test_j_step_created_when_overlay_selected_with_others`,
>   `test_overlay_only_document_approved_without_j`
> - ⚠️ 판정은 **단계 생성 시점**에 이뤄진다 — 이미 J step 이 생성된 기존 문서는 영향이 없고,
>   재상신(round+1)하면 새 회차부터 규칙이 적용된다.

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
- 동작: R `approved` → **P(due: R당일 포함 4영업일), J(due: 6영업일, 병렬), O(due: 6영업일, 병렬)** 동시 생성.
  추가로 **E**(due: 6영업일, 병렬)는 `plel` 인 의뢰서에만 생성한다.
- ✅ **(2026-08) 기타 목적 'Overlay 변경' 단독이면 J 를 생성하지 않는다**(`document.skip_j_stage()`).
  J 도착 메일과 검토 항목 채우기(`fill_from_master`)도 함께 건너뛴다 — 위 예외 항목 참조.
- ✅ **(2026-08) J 도 이 시점에 생성**된다(예전엔 P 완료 후 생성). J 도착 메일(`stage_arrival(J)`)도
  여기서 발송되며, 수신자도 **미배정 시 TE_J 팀 전원**으로 바뀌었다(예전엔 고정 주소 1곳).
  J 가 팀원 누구나 선점하는 병렬 단계가 됐는데 대표 주소로만 보내면 자기 차례를 알 수 없다.
- **E(MASK) 생성 조건**: `document.has_ppid_plel()` — 저장된 J-layer 행의 `pp` 에 판정 키워드
  `plel`(대소문자 무관)이 **하나라도 있으면** E 단계를 생성한다. 하나도 없으면 Validation System
  판정이 `NA`(해당없음)라 MASK 가 검증할 대상 자체가 없으므로 E 단계를 만들지 않고, 메일 결재
  경로 카드와 상세보기 결재 경로에서도 E/EV 행을 표시하지 않는다. 대상/비대상 값 자체는
  E 단계가 생성된 문서에서 MASK 담당자가 확정한다(`docs/REQUEST.md` 참조).
  Only MAP 의뢰서는 P/O/E/J 없이 R→RA 로 끝난다.
- **Only MAP 예외**: `document.is_only_map()`이 참이면 P/O/E를 **생성하지 않고** `status → approved`로
  바로 전이한다(R 합의 = 최종 승인). 승인 메일(`enqueue_approved`)이 발송된다.

### Case F — P 합의 (`approve_step` agent='P'/'PV', `views.py:504`)
- ✅ **P 검토중 + 다중 검토자(2026-07)**: P도 J·O·E와 동일하게 **지정하기가 아닌 검토중(claim) 방식**으로 전환됐다
  (`_CLAIM_AGENTS`에 `P` 포함). R 합의로 생성된 P pending step은 담당 팀원(TE_P) 누구나 `claim_step`으로 선점한다.
- ✅ **검토자 지정 = 담당자 합의와 한 번에 처리(2026-07, R 담당자지정과 동일한 UX)**: 별도 지정 API 없이,
  담당자(선점자와 같은 팀 누구나)가 `approve-step/`(agent='P') 요청에 `reviewer_loginids`(배열)를 함께 보내면
  그 요청 **한 번**으로 검토자(PV) pending step 생성 + 담당자 단계 합의가 같이 처리된다(`_create_reviewers`, 순서:
  검증 전부 통과해야 생성 → 담당자 단계 approved 저장). 화면에서는 "검토자 드롭다운에서 클릭해 고른 뒤 '합의' 버튼"
  으로 나타난다(R의 담당자 지정 화면에서 검토자를 함께 고르는 것과 동일한 패턴).
- 동작: P(담당자) `approved` → 지정된 검토자(PV)가 있으면 **검토자 전원 합의까지** 기다렸다가,
  담당자+검토자 **전원 합의 완료 시점**에 P 단계가 완료된다. 완료 시 TE_O·TE_J 에 완료 통보
  (`notify_p_completed`)만 보낸다(`_notify_after_p_review`).
- ✅ **(2026-08) J 생성 책임 이동**: 예전에는 이 시점에 J(due: P 합의일 포함 4영업일)를 생성했으나,
  J 가 병렬 단계로 분리되면서 생성은 `_advance_to_parallel`(R 합의 시점)로 옮겼다. 그래서 이 함수는
  `_advance_after_p_review` → **`_notify_after_p_review`** 로 개명했고 통보만 남았다.
- ✅ **(2026-08) P 완료가 최종 승인 조건**: P(+PV) 완료는 이제 `approve_step` 최종 판정의
  독립 조건(`p_ok`)이며, P/PV 합의 자체가 판정을 트리거한다(P 가 마지막일 수 있으므로).
- PV(검토자)는 **담당자(P) 합의 후에만** 처리 가능(순차 진행, R단계 RV와 동일한 가드).
- 어느 쪽(담당자 또는 검토자 중 누구든)이 반려해도 즉시 `status → rejected`.

### Case G — P / J / O / E 최종 합의 (`approve_step` agent in P/PV/J/O/E/EV/RA, `views.py:509`)
- 동작: **P(담당자+PV 전원)**·J·O·(E 있으면 **E 담당자 + EV 전원**)·(RA 있으면 RA 전원)가 **모두**
  `approved`일 때만 `status → approved`. 그 전엔 `under_review` 유지.
- ✅ **(2026-08) J 를 뺀 문서(`skip_j_stage()`)는 `j_approved` 를 참으로 둔다** — J step 이 없으면
  기본 판정(`len(j_steps) > 0`)이 영원히 거짓이라 문서가 `under_review` 에 영구 정지한다.
- ✅ **(2026-08) 판정 트리거·조건에 P/PV 포함**: J 분리로 P 가 마지막 합의자가 될 수 있게 됐다.
  트리거에서 빠지면 P 가 마지막일 때 아무도 판정을 돌리지 않아 문서가 `under_review` 에 영구 정지하고,
  조건에서 빠지면 P 미완료인데도 J·O·E·RA 만으로 승인돼 버린다 — 둘 다 필요하다.
  (테스트: `test_general_route_approved_when_p_is_last`, `test_general_route_not_approved_while_p_pending`)
- ✅ **검토중(claim) 방식(2026-07)**: J·O·E는 지정하기 없이 **담당 팀원 누구나 '검토중'을 눌러 스스로 선점**한다.
  먼저 누른 1명이 assignee로 고정(취소·재클릭 불가)되고, **그 담당자만** 합의/반려할 수 있다(`_can_act_on_step`).
- ✅ **E 검토중 + 다중 검토자(2026-07)**: E도 P와 동일하게 검토중 선점 후, `approve-step/`(agent='E')에
  `reviewer_loginids`를 함께 보내 담당자 합의와 동시에 검토자(EV, 다중 가능)를 지정한다(별도 지정 API 없음, Case F 참고).
  최종 승인 판정 시 E는 **담당자 합의 + EV 전원 합의**(`_stage_reviewers_complete`, AND — 2026-08부터 P/PV와 동일한
  규칙. 그 이전엔 EV 중 1명만 합의하면 끝나는 OR 이었고 나머지는 `approve_step`이 `skip`으로 자동으로 닫았으나,
  지정한 검토자 전원의 확인이 필요하다는 요구사항에 맞춰 제거했다. 이미 그 시절에 닫힌 `skip` 이력은 그대로 둔다)를 요구한다.
  EV도 **담당자(E) 합의 후에만** 처리 가능(순차 가드).
- ✅ **(2026-08) E 는 2차 검토자 지정이 필수**: MASK 검증은 2인 확인 절차라서 담당자 혼자 합의로
  단계를 넘길 수 없다(P 는 지금대로 검토자 선택 사항, Case K-3 참고). `reviewer_loginids`가 비어
  있으면 `approve-step`이 **400**을 반환한다 — 검증은 담당자 단계를 `approved`로 저장하기 **이전**에
  수행한다(`@transaction.atomic`은 예외에만 롤백되므로, 쓰기 이후 400을 반환하면 그 쓰기가 커밋된
  채 응답만 실패하는 부분 커밋이 생긴다). **예외**: ⓐ 이미 검토자 없이 E 합의를 마친 기존 문서는
  `_stage_reviewers_complete()`의 하위호환 분기(검토자가 하나도 없으면 담당자 합의만으로 완료)로
  그대로 최종 승인까지 갈 수 있다 — E 가 이미 `approved`라 검토자를 지정할 경로가 없으므로 소급
  강제하면 영구 정지된다. ⓑ 되감기가 있던 배포에서 E 가 `pending` 으로 되감긴 뒤 EV step 이 살아남은
  레거시 문서는 `reviewer_loginids` 없이도 통과한다(살아있는 EV step 존재를 지정으로 간주).
  되감기를 없앤 뒤로는 같은 회차에서 E 가 다시 합의되는 경로가 없어 이 예외는 그 레거시 문서에만 걸린다.
- J 합의/반려 시 **본인 담당 step만 처리**: `assignee__loginid=caller_loginid` 필터로 해당 J step을 조회한다 (MASTER는 첫 번째 pending step).
  최종 판정은 `all(s.action == 'approved' for s in j_steps)`로, 검토중 방식에서는 J step이 1개이므로 그 1명의 합의로 완료된다.
  (과거 다중 배정된 J 문서는 하위호환으로 전원 합의 로직이 그대로 적용된다.)
- ✅ 동시성: 두 결재자가 거의 동시에 마지막 합의를 눌러도 문서 행 락(`select_for_update`)으로
  직렬화되어 approved 전이가 누락되지 않는다(2026-06 수정).

> **승인 완료 후처리(2026-08-05 기준)**: `new_status == 'approved'`가 되는 공통 지점에서는
> 승인 메일(`enqueue_approved`)과 통보처 메일(`enqueue_notify_approved`)만 적재한다.
> 2026-07 에 있던 '완성된 MAP 변경' 원본 반영 훅(`_apply_map_change_to_source`)은
> **기능과 함께 2026-08-05 삭제**됐다(상세는 `docs/REQUEST.md` 삭제 이력 참조).

### Case H — 단계 반려 (`reject_step`, `views.py:312`)
- 동작: 어느 단계든 해당 step `rejected`, `status → rejected`(즉시).
- ✅ **(2026-08) 반려 후 잔여 pending 단계 처리 차단**: 반려는 문서 `status`만 바꾸고 **잔여
  `pending` step 은 이력으로 그대로 남긴다**(설계상 의도). 예전엔 결재 액션들이 문서 상태를
  확인하지 않아 그 잔여 단계를 계속 처리할 수 있었다. 이제 `_blocked_progress_response`
  가드로 **`status == 'under_review'` 인 문서만** 결재를 진행할 수 있다(§6-8 참조).
- **메일(2026-07 개편)**: 작성자·기합의자 전원에 더해 **아직 합의를 마치지 않은 결재선 단계의 담당 팀 전원**에게 반려 메일이 간다(반려자 본인 제외). '이후 단계'를 정적 순서표가 아니라 문서의 실제 상태(`결재선 − 이미 approved 된 단계`)로 판정해, 병렬 단계(P·O·E·RA)가 서로 다른 속도로 진행돼도 누락되지 않는다. 상세는 `docs/MAIL.md` §3.1.

### Case I — 재상신 (`resubmit`)
- 조건: `status == 'rejected'`, 지정 PL 필수(본인 불가), bb 매핑 통과.
- 동작: `status → under_review`, **max(round)+1**로 새 PL pending 생성. 이전 round step은 이력으로 보존.
- ✅ **다중 지정 PL(2026-07)**: Case A와 동일하게 `designated_pl_loginids` 배열을 받아 새 회차에 PL step **전원**을 생성한다(전원 합의).
- ✅ **검토자 프리필(2026-07)**: 수정·재상신 화면 진입 시 이전 회차에 지정했던 PL 담당자를 상신 모달의 검토자(designees)에 **미리 채운다**(통보처처럼). `doc.approval_steps` 중 최신 회차 `agent='PL'` step의 assignee로 복원하며, **수정(추가/삭제) 가능**하다. 구현: `RequestPage` 편집 로드 `useEffect`.

### Case J — 철회 (`withdraw` / `confirm-withdraw` / `reject-withdraw` / `cancel-withdraw`, 2026-08 전면 개편)

⚠️ **철회는 더 이상 임시저장(draft)으로 되돌리는 동작이 아니다.** 철회가 확정되면 의뢰서를
**완전히 삭제**한다(복구 불가). 진행 중인 결재는 현재 단계의 **확인**을 받아야 철회된다.
모델 `WithdrawRequest`(`models.py`), 마이그레이션 `0020`.

- ✅ 권한(요청 자격): MASTER / 의뢰자 PL 본인 / 지정 PL 본인 / **문서에 지정된 공유 그룹
  (`shared_group`)의 멤버**(`can_withdraw`). 그 외 호출은 403.
  **(2026-08)** 판정 기준을 "의뢰자와 아무 그룹이나 공유" → "문서의 공유 그룹 멤버"로 변경했다(§9 참조).

**문서 상태별 분기 (`withdraw`)**

| 상태 | 동작 | 사유 |
|---|---|---|
| `draft` | 확인 없이 **즉시 삭제** (결재선이 없다) | 선택 |
| `rejected` | 확인 없이 **즉시 삭제** (결재선이 종료됐다) | 선택 |
| `approved` | **MASTER 만** 즉시 삭제, 그 외 403 (결재 완료본 = 이력, `can_delete` 와 같은 기준) | 선택 |
| `under_review` / `submitted` | **철회 요청 생성** → 현재 단계 전원 확인 시 삭제 | **필수** |
| `pause` | 400 — 재개한 뒤 철회한다 | - |

응답의 `deleted`(bool)로 "이미 삭제됨"과 "요청만 접수됨"을 구분한다.

**요청 → 확인 → 삭제**

- **철회 요청**: 요청 시점의 현재(pending) 결재 단계 id 를 `target_step_ids` 로 기록한다.
  한 문서에 활성 요청(`state='requested'`)은 1건뿐이다. 상태 뱃지는 그대로 유지되고,
  목록 현재단계 칸에 '철회 요청중' 칩만 붙는다.
- **철회 확인 (`confirm_withdraw`)**: 인가는 **중단 확인과 같은 규칙**(`_can_confirm_pause`)이다 —
  담당자(assignee)가 있는 단계는 그 담당자 본인, 미배정 단계는 같은 팀(역할↔agent 일치) 누구나
  1명, MASTER 는 항상. 병렬 단계면 **target 단계 전원**이 확인해야 확정된다
  (`confirmed_step_ids` 누적, `set(target) ⊆ set(confirmed)`).
  확정되는 순간 완료 메일을 적재한 뒤 `document.delete()` 를 호출한다.
- **철회 거부 (`reject_withdraw`)**: 확인할 수 있는 사람이면 거부도 할 수 있다. 단계 **하나만
  거부해도** 요청 전체가 `rejected` 로 무효화되고 결재가 그대로 이어진다.
- **요청 취소 (`cancel_withdraw`)**: **요청자 본인**(문서 작성자가 아니다 —
  `can_cancel_withdraw`)/MASTER 가 확인 완료 전에만 거둬들인다(`cancelled`).
  ⚠️ 확정 이후에는 문서가 이미 삭제돼 되돌릴 수 없다 — **되돌릴 수 있는 구간은 확인 대기 중뿐**이다.
- **동결**: 확인 대기(`requested`) 동안 `approve_step`/`reject_step`/`assign_step`/`claim_step` 이
  400 으로 차단된다(`_blocked_progress_response`). 확인 도중 단계가 넘어가면 대상 단계가 끝나
  확인이 영영 완료되지 않기 때문이다. 거부·취소되면 즉시 풀린다.
- ⚠️ **철회 이력은 남지 않는다**(2026-08 결정). 문서 삭제 시 `ApprovalStep`·`WithdrawRequest` 가
  CASCADE 로 함께 사라지고, 누가 왜 철회했는지는 서버 로그
  `[WITHDRAW_DOCUMENT] user=… doc=… reason=…` 에만 남는다.
- **메일**: 요청/완료/거부/취소 4종이 발송된다. 수신자 규칙은 `docs/MAIL.md` §3.2.
- 테스트: `backend/api/tests.py::WithdrawFlowTest`

### Case K — 담당자 지정 (`assign_step`, `views.py:331` 부근) — **R 전용**
- 동작: 현재 회차의 해당 agent pending step에 assignee 지정.
- ✅ 권한: 프론트 `canUserAssign`과 동일(`_can_assign_step`) —
  MASTER / 같은 팀(역할↔agent 일치) + 미지정일 때만. **PL·J·O·E·P 단계는 지정 불가**(J/O/E/P는 검토중 방식, ⚠️ 2026-07 P 포함으로 변경).
  또한 `agent`는 `R·P·J·O·E`만 허용(`agent='PL'`로 지정 PL을 덮어쓰는 우회 차단. `P`는 화이트리스트엔 남아 있으나 `_can_assign_step`이 항상 403 반환).

### Case K-2 — 검토중 선점 (`claim_step`, 2026-07, **P 2026-07 추가**) — **J·O·E·P 전용**
- 동작: 현재 회차의 해당 J/O/E/P pending step에 **요청자 본인을 assignee로 고정**(취소·재클릭 불가).
- ✅ 권한(`_can_claim_step`): MASTER / 같은 팀(역할↔agent 일치) + pending + 미배정일 때만. `agent`는 `J·O·E·P`만 허용.
- ✅ 동시성: 문서 행 락(`select_for_update`)으로 중복 선점을 막고, 이미 배정된 경우 `409`를 반환한다.
  프론트 UI: "추가" 버튼으로 여러 명을 목록에 쌓은 뒤 "확인" 클릭 시 `assignStepMultiJ` API 호출.
  권한: `TE_J` 또는 `MASTER`.

### Case K-3 — P/E 검토자 지정 (`approve_step`의 `reviewer_loginids`, 2026-07) — **P·E 전용, 다중 검토자**
- ⚠️ **별도 지정 API 없음**: R 담당자 지정(`assign_step`이 담당자+검토자를 한 번에 받는 것)과 동일한 UX를
  맞추기 위해, P/E는 **검토자 지정 전용 엔드포인트를 두지 않고** `approve-step/`(agent='P' 또는 'E') 요청에
  선택적 필드 `reviewer_loginids`(배열)를 함께 실어 보낸다. 이 요청 **한 번**으로
  검토자(PV/EV) pending step 생성과 담당자 단계 합의가 같이 처리된다 — 순서는
  `_validate_reviewers`(DB 쓰기 없는 검증) → `step.action='approved'` 저장 →
  `_create_reviewers`(실제 생성 + 검토자 메일 발송)이다(2026-07 수정, 검증 실패 시
  여전히 아무 것도 생성/변경되지 않음). ✅ **(2026-07 해결) 검토자 메일의 담당자 상태 오표시** —
  예전엔 검토자 생성(+메일 발송)이 담당자 승인 저장보다 먼저 실행돼, 검토자에게 가는 메일의
  결재 경로 카드에서 이미 합의한 담당자가 '검토중'으로 잘못 표시됐다(`docs/MAIL.md` §"결재 경로 카드" 참고).
- 동작: 검토중(K-2)으로 P/E를 선점한 뒤, **합의 가능한 사람 누구나**(선점자 포함 같은 팀 전원 —
  `_can_act_on_step`과 동일 조건, R의 "지정한 사람만"보다 넓음) 합의 시 검토자를 함께 지정할 수 있다.
  같은 팀(TE_P/TE_E) 인원이어야 하고, 담당자 본인은 검토자로 지정할 수 없다.
- 화면: 검토중 상태에서 '합의' 버튼 옆에 R 담당자 지정과 동일한 스타일의 검토자 드롭다운이 노출된다.
  드롭다운에서 이름을 클릭하면 **바로 선택 칩으로 추가**되고(별도 '추가'/'확인' 버튼 없음), 드롭다운을 다시 열어
  계속 추가할 수 있다. 이 상태에서 **'합의' 버튼을 누르면** 선택된 검토자 지정 + 담당자 합의가 함께 처리되며,
  '반려'를 누르면 선택 내용은 버려지고 그냥 반려된다.
  ⚠️ 지정 취소/변경 기능은 이번 범위에 없다(후속 작업으로 보류) — 한 번 지정된 검토자는 이후 요청으로 제거할 수 없다.
- 완료 조건: **E/EV·P/PV 모두 담당자 + 지정된 검토자 전원 합의(AND)** 다(Case F/G 참고, `_stage_reviewers_complete`).
  (2026-08 이전엔 E/EV만 1명 합의로 끝나는 OR 이었고 남은 EV 는 `skip` 으로 닫혔다 — §7 "EV 를 OR → AND 로 재전환" 항목 참고)
  검토자가 하나도 없으면 담당자 합의만으로 즉시 완료 — **P는 지금도
  이 경로가 정상**(선택 사항)이고, **E는 2026-08부터 검토자 지정이 필수**라 새 합의로는 이 경로에
  도달할 수 없다(위 Case G 참고). 이 하위호환 분기 자체는 남겨 뒀다 — 배포 이전에 검토자 없이
  E 합의를 마친 기존 문서를 영구 정지시키지 않기 위해서다.
- ⚠️ **운영 요건(E)**: `TE_E` 역할 사용자가 **2명 이상**이어야 한 명이 담당자로 선점한 뒤 다른 한
  명을 2차 검토자로 지정할 수 있다(담당자 본인은 검토자로 지정 불가). 1명뿐이면 E 단계가 막힌다.

### Case L — 지정 PL 변경 (`change_designee`)
- 권한: **의뢰자 본인 또는 MASTER만**. 현재 회차 PL step의 assignee 교체.
- ⚠️ **다중 PL 미대응(보류)**: 현재는 `_get_pending_pl_step`(첫 pending PL step, = 대표)만 1:1 교체한다. 다중 PL 중 특정 담당자 지정 스왑은 후속 작업으로 보류(2026-07).
- **메일(2026-07 추가)**: 새로 지정된 PL에게 상신 때와 동일한 stage_arrival 메일(제목 `[이름님] [결재 요청] ...`)이 즉시 발송된다. 기존 지정자에게는 별도 알림 없음.

### Case M — 결재 중단(PAUSE) 요청·확인·재개 (2026-07)

진행 중(under_review) 결재를 작성자가 **중단 요청** → 현재 단계 팀이 **확인** → 문서 `pause` 전이 → 작성자가 **수정 후 재개** 하는 흐름. 모델 `PauseRequest`(`models.py`), 마이그레이션 `0006`.

- **중단 요청 (`request_pause`)**: 작성자 본인(또는 MASTER) + `status == 'under_review'` + **활성 중단요청 없음**일 때. **사유(reason) 필수**. 요청 시점의 현재(pending) 결재 단계 id 를 `target_step_ids` 로 기록한다. 상태 뱃지는 **확인 완료 전까지 그대로 유지**(검토중), 목록 현재단계 칸에 '중단 요청중' 칩만 표시.
- **중단 확인 (`confirm_pause`)**: 현재 단계 담당자(assignee) 본인, 미배정 단계면 같은 팀(역할↔agent 일치), + MASTER (`_can_confirm_pause`). 병렬(P/J ∥ O/E)이면 **target 단계 전원**이 확인해야 최종 `pause` 전이(`confirmed_step_ids` 누적, `set(target) ⊆ set(confirmed)` 시 확정). 그 전엔 under_review 유지.
- **재개 (`resume`)**: 작성자 본인(또는 MASTER) + `status == 'pause'`. `pause → under_review` 로 되돌리고 **멈춘 시점의 pending 단계를 그대로 유지**해 그 단계부터 이어간다(회차 새로 만들지 않음, 이미 합의된 병렬 경로 유지). 문서 내용은 사전에 `/request` 편집(update)에서 저장되며, 재개 시 지정 PL 재선택 불필요(`RequestPage` 가 pause 문서 편집 시 상신 대신 `resume` 호출).
  - ✅ **마감 기한 연장(2026-07)**: 재개 시 **멈춘 기간(중단 확정 `confirmed_at` ~ 재개일, 달력일)만큼** 현재 회차 pending 단계의 `due_date` 를 뒤로 민다. 중단 동안 남은 기한이 깎이지 않는다.
  - ✅ **목록 표시**: PAUSE 동안 결재현황/홈 목록의 '최종 완료예정' 칸은 날짜 대신 **`중단`**(회색)으로 표시한다(기한이 지난 것처럼 빨갛게 보이지 않도록). `ApprovalPage`·`HomePage` 공통. **(2026-08)** '현재 단계 완료예정' 컬럼 자체가 사라졌고(§3.5), 병렬 단계 중단은 그리드 6칸을 전부 `PAUSE` 뱃지로 덮는다(§3.3.2).
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
- **전환(병렬)**: 담당자(검토자 있으면 검토자까지) 합의 시 `_advance_to_parallel` → **P(4영업일)·O(6영업일)·E(6영업일, 병렬, `plel` 시에만) + 후결자(RA, 6영업일 병렬)** 생성.
  - **Only MAP**: P/O/E 없이 **후결자(RA)만** 생성 → 후결자 전원 합의 시 최종 승인. (후결자 미설정 시 즉시 승인)
- **후결자(RA)**: **고정 1명**(`settings.POST_APPROVER_LOGINID`, `.env`, RFG 팀) + **추가 후결자**(상신 모달에서 PL 중 지정, `detail.post_approvers`). 추가 후결자가 필수인 대상은
  `RequestDocument.requires_post_approver()`(C가문 `only_prodc=YES` **또는** 기타 목적 `연구소 제품`, 2026-08 확장) 로 판정하며 최소 1명 필수(`_validate_post_approvers`). 고정은 PL 후보 목록에 안 뜸(TE_R 이라 자동 제외).
  - **연구소 제품(2026-08)**: 요청 목적이 `Only MAP` 일 때만 선택 가능한 기타 목적이다(그 외 목적에서는 버튼 잠금).
    선택 시 결재 경로 자체는 바뀌지 않는다 — **Only MAP 경로(PL→R→RA) 그대로**이고, `requires_post_approver()` 가
    참이 되어 상신 모달에 후결자 입력이 열리고 필수가 될 뿐이다(기존 C가문 메커니즘 재사용, 신규 로직 없음).
- **최종 승인**: `J + O + E + 후결자(RA) 전원` 합의(Only MAP 은 RA 만). `approve_step` 최종 판정에 RA 포함.
- ✅ **후결자 추가/제거(2026-07 개편)**: 기존 1:1 스왑(`change_post_approver`) 대신 **추가**(`add-post-approver/`)와
  **제거**(`remove-post-approver/`) 두 액션으로 분리했다. 작성자 또는 **MASTER**(프론트 노출도 동일하게 확대)가
  R 합의 이후(병렬 단계 진입 후) 언제든 사용 가능. 작성자 판정은 `_can_manage_post_approver`가
  `doc_permissions.is_requester`(FK + `requester_email` 폴백, `can_withdraw`/`can_edit`와 동일 규칙)를
  재사용한다 — 예전엔 FK만 확인해 `requester` FK가 비어 있는 문서(탈퇴 등으로 FK가 `SET_NULL` 된 경우 포함)의
  실제 작성자가 403을 받는 버그가 있었다(2026-07 수정). **역할 검증 없음**(고정 후결자=TE_R, 추가 후결자=보통 PL로
  원래도 역할이 섞여 있어 단일 역할 강제가 무의미 — 2026-07 정책). **고정 후결자는 추가/제거 대상에서 항상 제외**되고
  화면엔 잠금 칩으로만 표시(제거 버튼 없음). **이미 합의(approved)한 RA는 제거 불가**. 최소 인원 가드는 두 가지를
  독립적으로 적용한다 — **Only MAP** 문서는 후결자(고정 포함 총원)가 유일한 종단 경로라 **총원 0명**을 막고,
  **`requires_post_approver()` 대상(C가문·연구소 제품)** 문서는 상신 시 "추가 후결자 1명 이상" 필수였던 것과
  일관되게 **고정을 제외한 추가 후결자 0명**을 막는다(둘 다 아니면 일반 문서는 0명까지 제거 가능). 추가 시 새 후결자에게
  즉시 `[후결 요청]` 메일 발송(`_create_reviewers`가 아니라 `add_post_approver`에서 직접 `enqueue_stage_arrival`).
  `detail.post_approvers` 도 추가/제거마다 동기화(재상신 프리필 대비).
- **표시**: 결재현황/홈 현재단계 — 담당자(단계명 **RFG** 그대로 표기)→검토자 순차, 병렬은 경로1(P/J)·경로2(O/E)·**경로3(후결자(이름))** 로 최대 3행. 상세 '결재 경로' 탭은 **R 다음에 검토자(지정 시)·후결자** 행을 표시.
- ⚠️ **`.env` 설정 필요**: `POST_APPROVER_LOGINID=<RFG팀 loginid>`. `settings/base.py` 에서 읽음(규칙 D 사전 고지·동의). ⚠️ RV/RA 알림 메일은 범위 밖.

#### Case N 후속 수정 (2026-07)
- **결재현황 라벨**: 담당자(R) 단계는 `담당자`가 아니라 **원래 단계명 `RFG`(agent_R)** 로 표기(`approvalTable.ts stageLabel`). RV=검토자, RA=후결자는 유지.
- **후결자 표시**: 경로3(RA)를 `후결자 (0/1)` 카운트 → **`후결자(미합의자 이름)`** 로 변경(다른 단계와 동일한 `라벨(이름)` 형식).
- **검토자(RV) 지정 UI**: plain `<select>` → **담당자 지정과 동일한 커스텀 드롭다운**(`assign-dropdown`). 맨 위 '검토자 없음' 포함, 담당자로 고른 사람 제외.
- **상신 검색 통일**: 동료 PL 지정·**후결자·통보처** 세 검색을 **PL(제품담당자)만 + 포커스/클릭 시 목록 표시**(포털 드롭다운)로 통일. 통보처 후보를 전체 사용자 → **PL만**으로 제한(`usersAPI.list('PL')`).
- **검토자 지정 라벨 제거**: 지정하기 시 검토자 드롭다운 위 '검토자' 라벨 span 삭제(드롭다운 자체가 '검토자 없음' placeholder 로 구분).
- **검토중(J/O/E) 팀 공동 합의**: 검토중으로 **선점(assignee 존재)** 되면 **같은 팀(역할↔agent) 누구나 합의/반려** 가능(`_can_act_on_step`/`canUserAgree`). 선점 전에는 먼저 검토중 필요. 검토중 버튼은 선점 즉시 숨김(`canUserClaim`=assignee 있으면 false). `approve_step`/`reject_step`에서 J를 assignee 필터 밖으로(회차당 단일), **RA(후결자)만** assignee 필터 유지. ⚠️ 표시되는 담당자명은 **선점자**(검토를 시작한 사람)이며, 다른 팀원이 합의해도 이름은 선점자로 남는다(감사기록은 `acted_at`/comment).
- **결재경로 검토자 통합**: 상세 '결재 경로' 탭에서 검토자(RV) **별도 행 제거** → **R단계 행에 회차별 `합의자(R) + 검토자(RV, 지정 시)`** 함께 표시(`StepDisplayInfo.roleLabel`, i18n `approval.role_agreer`).

### Case O — 요청 목적 'MAP 삭제/수정': P·R·J·O 병렬 경로 (2026-08)

MAP 정보만 수정/삭제하는 의뢰서 전용 경로. 판정: `RequestDocument.is_map_delete_edit()`
(`request_purpose == RequestDocument.MAP_DELETE_EDIT_PURPOSE`, 값 `'MAP 삭제/수정'`).
작성 화면은 `docs/REQUEST.md`, 화면·경로 설계 원본은 `docs/map_delete_edit_mockup.html` 참조.

- **상신까지는 동일**: `submit`(지정 PL) → `peer_approve`(PL 전원 합의)까지 다른 경로와 완전히 같다.
- **PL 전원 합의 직후 4단계 동시 생성**(`_advance_after_pl` → `_create_map_delete_edit_parallel`):
  **P·R·J·O 를 한 번에 병렬**(`is_parallel=True`, 공통 기한 6영업일)로 만든다. **E(MASK)와
  후결자(RA)는 만들지 않는다** — 이 경로가 유일하게 **고정 후결자조차 붙지 않는** 문서 유형이다.
  결재선 상수 `mailer.ROUTE_AGENTS_MAP_DELETE_EDIT = ('P','PV','R','RV','J','O')`
  (`mailer.route_agents_for(document)` 로 세 경로가 공통 판정).
- **R 이 관문이 아니라 병렬 구성원**: 다른 모든 경로는 R 합의가 있어야 병렬 단계가 열리므로 병렬
  진입 시점엔 R 이 항상 이미 끝나 있다. 이 경로만 R 이 P·J·O 와 **동시에** pending 이며, 네 단계
  중 아무 순서로나 끝날 수 있다(`test_approved_when_p_is_last`/`test_approved_when_r_is_last` 로 검증).
- **검토자(PV/RV)는 그대로**: P/R 각각 담당자 합의 시 지정된 검토자까지 전원 합의해야 그 단계가
  끝난다(`_stage_reviewers_complete`, 기존 로직 재사용). J/O 는 기존과 동일하게 검토중(claim) 방식.
- **최종 승인 판정**(`approve_step` 최우선 분기, `_map_delete_edit_all_approved`):
  P·R·J·O **네 단계 모두** 완료(담당자+검토자)일 때만 `approved`. 일반 경로의 최종 판정은
  `agent in ('J','O','E','EV','RA')` 합의 시에만 돌고 `P`/`R` 합의는 판정을 트리거하지 않으므로
  (P 는 J 생성만, R 은 병렬 전환만 함), **이 경로 전용으로 판정 분기를 따로 추가**했다 — 없으면
  네 단계가 다 끝나도 문서가 `under_review` 에 멈춘다.
- **연구소 제품과는 무관**: `연구소 제품`은 `Only MAP` 전용 기타 목적이라(Case N) 이 경로와는
  동시에 선택될 수 없다 — `MAP 삭제/수정` 문서는 기타 목적 전체가 잠긴다(`docs/REQUEST.md`).

#### 화면 표시 버그 2건 + 수정 (2026-08)

R 이 병렬 구성원으로 남아 있는 상황은 이 경로가 생기기 전엔 존재한 적이 없어서, 기존 화면
코드 두 곳이 그 경우를 다뤄본 적이 없었다. 배포 전에 발견해 함께 고쳤다.

- **결재현황 목록에 R 이 안 보이던 문제**(`frontend/src/utils/approvalTable.ts`):
  `getDocTableRows`/`getFinalCompletionDate` 는 병렬 시작 판정을 `P/O/E/RA` 존재로만 했다.
  기존 경로는 이 시점에 R 이 항상 이미 `approved` 라 문제가 없었지만, 이 경로는 R 이 마지막까지
  남을 수 있어 **P/O 가 끝나면 목록이 "다 끝난 것"처럼 보였다**(문서 상태는 여전히 `under_review`).
  `path0`(R+RV) 행을 P/O/RA 와 같은 패턴으로 추가했다 — **R+RV 가 이미 끝났으면 행을 만들지 않아**
  기존 경로 화면은 그대로다(`approvalTable.test.ts` 로 회귀 고정). 완료예정일 계산도 R 의 기한을
  후보에 포함했다.
- **결재 상세 후결자(RA) 행이 '대기'로 영구 표시되던 문제**(`components/PagedDetailView.tsx`):
  이 컴포넌트는 모든 문서에 RA 가 최소 1명(고정) 있다고 전제해 "RA 가 아예 없는 문서"를
  다뤄본 적이 없었다. `isMapDeleteEdit` 판정을 추가해, `E`가 `!hasPlel` 일 때 쓰는 것과 같은
  `해당없음`(na) 분기를 RA 에도 걸었다.

#### 후결자 최소인원 가드 누락 수정 (2026-08)

`remove-post-approver`(Case N)의 최소인원 가드가 `detail.get('only_prodc')=='Yes'` 를 직접
비교하고 있어, 상신 시엔 `requires_post_approver()`(C가문 **또는** 연구소 제품)로 후결자 1명
이상을 강제해 놓고도 **결재 진행 중엔 연구소 제품 문서의 마지막 추가 후결자를 제거할 수 있었다**
(고정 후결자만 남는 상태로 상신 검증이 무력화됨 — Only MAP 의 "총원 0명 금지" 가드는 고정
후결자가 있으면 걸리지 않아 이 경우를 막지 못한다). `requires_post_approver()` 재사용으로 수정.
재현·수정 확인은 `LabProductPostApproverTest.test_lab_product_last_additional_post_approver_cannot_be_removed`
(수정 전 코드로 되돌려 실제 200이 나옴을 먼저 확인한 뒤 수정).

### 영업일 계산 (`utils.py:158` `calculate_business_due_date`)
- start_date(당일 포함) 기준 n번째 영업일. 주말 + `Holiday(isholiday='Y')` 제외.

---

## 3. 화면 기능 (ApprovalPage.tsx)

### 3.1 목록
- `documentsAPI.list()` 조회 후 **`approved` 제외**(`:320`)하고 표시(승인 완료건은 이력 페이지로).
- 컬럼: 제목 / 제품명 / 의뢰자 / **현재 단계** / 최종 완료예정 / 양산일.
  ✅ **(2026-08) '현재 단계 완료예정' 컬럼 삭제** — 단계별 기한을 없애고 최종 완료예정 하나만 둔다(§3.5).
- **문서 1건 = 표 1행**. ✅ **(2026-08)** 병렬 단계에서 경로별로 행을 쪼개던 rowSpan 표시가 없어지고,
  '현재 단계' 칸 안의 3행 2열 그리드가 6개 경로를 한 번에 보여준다(§3.3.2).
- 상태: `loading → error → empty → table` 4분기(2026-06 error 분기 추가). 실패 시 재시도 버튼.

### 3.2 필터 탭 (`applyClientFilter`, 클라이언트 측)
- 전체 / 내 차례(my) / agent별(R·P·J·O·E) / 임시저장(draft) / 반려(rejected).
- ✅ **(2026-08) '내 차례'·agent별 필터 판정 기준**: 공용 헬퍼 `hasActivePendingStep` 로 통일해
  **진행 중(`under_review`) 문서의 현재 회차 pending 단계만** 대상으로 본다. 예전엔 상태·회차를
  보지 않아 ① 반려 문서의 잔여 pending 단계 ② 재상신으로 회차가 올라간 뒤 남은 **이전 회차**
  pending 단계 때문에 이미 끝난 문서가 계속 '내 차례'·단계 탭에 잡혔다(탭 카운트도 동일 적용).
- ✅ **(2026-08) '내 차례'에 검토 항목 조건 OR 추가**: `hasMyPendingReviewItem` — 진행 중 + 현재 회차
  J 단계가 pending + **내가 검토자인 미확인 검토 항목이 1건 이상**이면 담당자가 아니어도 MY 에 뜬다.
  판정값은 목록 응답의 `my_pending_review_items`(개수)다. §10 참조.
- ✅ **(2026-08) MY 판정을 `utils/approvalTable.isMyDocument` 로 공용화** — 홈 '나의 의뢰 현황'이
  같은 판정을 쓴다(§11). 이때 **PL 분기를 pending 단계 기준으로 바꿨다**:
  | | 예전 | 지금 |
  |---|---|---|
  | PL | 작성자(이름) OR `designated_pl_loginid` OR PL step 존재 | 작성자(이름) OR **내가 담당인 현재 회차 pending 단계** |
  - **추가 후결자(RA)로 지정된 PL 이 잡힌다** — 예전엔 PL step 만 봐서 후결자로만 참여한 문서가 빠졌다.
  - **이미 합의를 마친 문서는 빠진다** — `designated_pl_loginid` 는 문서 필드라 합의 여부를 보지 않아
    끝난 문서가 계속 남아 있었다.
  - 그 대신 **반려·임시저장 문서에서 '내가 지정 PL' 이라는 이유만으로 뜨던 건은 빠진다**
    (`hasActivePendingStep` 이 `under_review` 만 본다). 반려는 별도 탭이 있고, 위 "MY 판정은 진행 중
    문서만" 원칙과도 일치한다. **내가 작성한 문서는 상태와 무관하게 계속 뜬다.**
- ✅ **(2026-08) `?filter=my` 쿼리 파라미터**로 진입하면 MY 탭이 열린 상태로 시작한다
  (홈 '나의 의뢰 현황'의 '전체 보기'가 이 경로로 온다). 새로고침·링크 공유에도 탭이 유지된다.

### 3.2.1 목록 정렬 (2026-07, `sortedDocs`)
우선순위: **양산일 정렬(켜짐) > 단계별 필터(진입 순서) > 기본(상신 오래된 순)**.
- **기본**: `submitted_at` 오름차순(오래된 상신 먼저). `submitted_at` 없는 draft는 `created_at` 대체.
- **단계별 필터(agent_R/P/J/O/E) 활성 시**: 기본을 대체 — 현재 회차의 해당 agent `pending` `ApprovalStep.created_at` 오름차순(그 단계로 먼저 넘어온 문서가 위).
- **양산일(`col_production_date`) 헤더 클릭 3단 토글**: 오름차순→내림차순→원래 상태. 미입력(`production_date` 없음) 행은 방향 무관 **항상 맨 아래**. 켜져 있으면 **필터 탭과 무관하게** 양산일 기준이 우선(단계별 필터의 진입 순서보다 앞섬).
- 필터 탭(`filter`)을 바꾸면 양산일 정렬은 자동으로 원래 상태로 리셋(`useEffect([filter])`).
- 모두 클라이언트 측 정렬(`docs` → `sortedDocs`), 백엔드/정렬 파라미터 변경 없음 — 필요한 필드(`submitted_at`/`created_at`/`production_date`/`approval_steps[].created_at`)는 이미 목록 응답에 포함.

### 3.3 현재 단계 표시 (`getDocTableRows`)

✅ **(2026-08) 병렬 합의 단계는 3행 2열 그리드로 개편**됐다. 그 이전 구간(PL·RFG·RV)과
반려 문서는 **기존 단일 행 표시 그대로**다. 문서 1건은 이제 **항상 표 1행**이며, 경로별 행 분리와
rowSpan 병합은 사라졌다(`getDocTableRows` 는 언제나 길이 1 배열을 반환한다).

#### 3.3.1 단일 행 (병렬 이전 · 반려 · 병렬 이전 중단) — 변경 없음
분기 우선순위 그대로다.
- **중단(pause)**: 병렬 이전이면 `PAUSE` 뱃지 + 멈춘 단계명(예: `PAUSE RFG`). 병렬 이후는 3.3.2 참조.
- **반려(rejected)**: 반려된 단계의 `라벨(이름)`(여러 단계면 ` / `, 없으면 `-`) + `rejected` 뱃지.
  반려 후에도 잔여 `pending` step 이 남기 때문에, 이 분기가 없으면 아래 분기가 그 잔여 단계를
  진행 중으로 오판한다(§6-8).
- **PL 검토 pending**: `검토(담당자명)`. 다중 PL 이면 아직 미합의한 담당자명을 ` / `로 연결.
- **R → RV 순차**: R 단계 pending 이면 `RFG(이름)`, R 합의 후 RV 가 남아도 **`RFG(검토자이름)`**.
  ✅ **(2026-08)** 검토자 단계에서 라벨이 `검토자(...)` 로 바뀌던 것을 없앴다 — 담당자든 검토자든
  같은 R 단계이므로 단계명을 유지한다(그리드의 PHPSI/MASK 규칙과 동일). 반려 표시에도 함께 적용된다.

#### 3.3.2 3행 2열 그리드 (병렬 합의 단계) — 2026-08 신설
`P/O/E/RA` 중 하나라도 현재 회차에 있으면 그리드로 그린다. 칸 배치는 **고정**이며
`StageCell[]`(길이 6, `GRID_SLOT_ORDER` 순서)로 내려온다. 렌더는 `components/StageGrid.tsx`.

```
[뱃지] PHPSI        [뱃지] 후결자          ← 2열 1행은 고정 후결자(POST_APPROVER_LOGINID)
[뱃지] JOB          [뱃지] MASK
[뱃지] OVL          [뱃지] 추가후결자      ← PL 이 상신 모달에서 지정한 후결자
```

- **뱃지가 단계명 왼쪽**에 온다("대기중 PHPSI"). 뱃지 폭은 CSS 로 고정해 단계명을 세로 정렬한다.
- **뱃지 4종** — `해당없음`(경로 밖) / `대기중`(미선점) / `검토중`(진행 중) / `완료`.
  색은 기존 상태뱃지 클래스를 재사용하고 `해당없음`만 `.badge-na` 를 새로 뒀다.
- **경로에 없는 단계도 칸이 사라지지 않고 `해당없음`으로 남는다** — 이 개편의 핵심이다.
  판정은 "현재 회차에 그 단계 step 이 있는가"다(그리드는 병렬 진입 후에만 그려지므로
  이 시점엔 해당 문서의 단계가 모두 생성돼 있다).
  - plel 없는 문서 → MASK 가 `해당없음`
  - 추가 후결자 미지정 → 추가후결자가 `해당없음`
  - Only MAP → PHPSI·JOB·OVL·MASK 가 모두 `해당없음`(후결자만 진행)
  - MAP 삭제/수정 → MASK·추가후결자가 `해당없음`
- **고정/추가 후결자 분리**는 목록 응답의 `post_approver_fixed_loginid` 로 한다
  (RA step 의 `assignee_loginid` 와 비교). 설정이 비어 있으면 전부 추가 후결자로 본다.
- ✅ **(2026-08) 고정 후결자 칸의 라벨은 `후결자` 가 아니라 `RFG`** 다 — 고정 후결자는 `.env`
  `POST_APPROVER_LOGINID` 로 지정하는 **RFG 팀 1명**이기 때문이다(Case N). 일반 경로 그리드에는
  RFG 담당자 칸이 따로 없어 이름이 겹치지 않는다. 추가 후결자 칸은 `추가후결자` 그대로다.
  ⚠️ 그 결과 **2열 1행의 `RFG` 라벨이 문서 유형에 따라 다른 사람을 가리킨다** — 일반·Only MAP 경로는
  고정 후결자, MAP 삭제/수정 경로는 R 담당자다. 두 경로가 동시에 나타날 수 없어 혼동은 없다.
- **MAP 삭제/수정 예외**: 이 경로는 후결자를 아예 만들지 않고 대신 R 이 P·J·O 와 동시에 도는
  병렬 구성원이라, 비는 **2열 1행(고정 후결자 자리)에 `RFG` 를 넣는다**.
  ⚠️ 이 칸만 검토자(RV)를 지정해도 **담당자 이름을 그대로 유지**한다(아래 이름 규칙의 유일한 예외).

**이름 표시 규칙**
| 상태 | 이름 |
|------|------|
| `해당없음` / `대기중` / `완료` | **표시하지 않음** |
| `검토중` (담당자 단계) | `단계명(담당자명)`. 단 **JOB·OVL 은 표시하지 않는다**(검토중 방식이라 진행 중 이름을 감추는 기존 비대칭 규칙 유지) |
| `검토중` (담당자 합의 후 검토자 대기) | **단계명은 그대로 두고 이름만 미합의 검토자로** 교체 — `PHPSI(최민수 / 정검토)`. '검토자' 라는 라벨로 바뀌지 않는다 |
| 여러 명 중 일부만 합의 | **미합의자만** 표시 |

> ⚠️ **완료 단계의 결재자 이름은 목록에서 보이지 않는다.** 예전에는 완료 시 참여자 전원의
> `라벨(이름)`을 나열했지만, 지금은 `완료` 뱃지만 남는다(§3.3 이름 규칙). 누가 결재했는지는
> 상세 모달 '결재 경로' 탭에서 확인한다. JOB·OVL 은 진행 중 숨김 + 완료 시 숨김이 겹쳐
> **목록에서 이름이 한 번도 표시되지 않는다.**

> ⚠️ **후결자(RA)는 `대기중` 을 거치지 않는다.** J·O·E·P 는 검토중(claim) 방식이라 선점 전에
> 담당자가 없지만, 후결자는 단계 생성 시점에 이미 assignee 가 확정돼 있어 병렬 진입 직후부터
> `검토중` 이다(현행 동작과 동일). `대기중` 은 '담당자 미배정'이라는 뜻으로만 쓴다.

**중단(PAUSE) 표시**
- **확정(`status == 'pause'`)**: 6칸을 **전부 `PAUSE` 뱃지로 덮고 이름을 지운다**(해당없음 칸 포함).
- **요청중(확정 전)**: 뱃지는 원래 상태 그대로 두고, `pause_request.target_step_ids` 에 걸린
  **해당 단계 칸에만** `⏸ 중단 요청중` 칩을 붙인다(예전에는 행 맨 앞에 문서당 1개였다).

> **폐기**: 경로2 상태점(`StageDots`, `.dot-ind`)은 6칸 뱃지가 같은 일을 하므로 삭제했다.

### 3.4 상태 배지
- **단일 행**(병렬 이전·반려·중단): pending step 에 `assignee_loginid`가 없으면 `unassigned`(라벨: 대기중),
  있으면 `under_review`(검토중). `StatusBadge` 가 렌더한다.
- **그리드 행**: 대표 뱃지가 없고 **6칸이 각자 뱃지를 갖는다**(§3.3.2). `StageGrid` 가 렌더한다.
- PV/EV(검토자)는 지정 즉시 assignee 가 확정되므로 pending 이면 항상 검토중이다.
  단 **EV 가 `skip`이면 '건너뜀' 회색 배지**로 표시된다(`PagedDetailView.stepToInfo` 의 `skipped`) —
  EV가 P/PV와 동일한 전원 합의(AND)로 바뀐 뒤로는 새로 생기지 않고, 그 이전(OR 시절) 문서에만 남은 이력이다.

### 3.5 완료 예정일

✅ **(2026-08) '현재 단계 완료예정' 컬럼 삭제.** 결재현황·홈 목록에서 **단계별 기한을 더 이상
표시하지 않고**, **'최종 완료예정' 한 칸만** 남긴다. 상세 모달 '결재 경로' 탭의 `완료예정: MM/DD`
표기도 함께 제거했다(검토자 표시 구조는 그대로).
- 컬럼 단위 삭제라 **PL·RFG 단계 행에서도 날짜가 사라진다**(행별로 남길 수 없음).
- 함께 정리된 것: `getDueDateDisplay()`, `DocTableRow.dueDate`, `.due-date-*` CSS,
  i18n `col_current_stage_completion`·`due_date_undecided`·`col_due_date`.
- **`ApprovalStep.due_date` 자체는 남는다** — 아래 최종 완료예정 계산에 계속 쓰이고 백엔드도 무변경이다.

**최종 완료예정**(`getFinalCompletionDate`): 병렬 진입 후 max(path0End, path1End, path2End, path3End).
그 전에는 `-`, 반려 문서도 `-`, 중단 문서는 `중단`(회색).
- path0End = max(R.due, RV.due) — MAP 삭제/수정 에서 R 이 병렬 구성원인 경우를 위한 후보.
- path1End = **P.due**.
- path2End = **max(J.due, O.due, E.due)**.
- path3End = max(RA.due).

### 3.6 상세 모달 + 액션 (행 클릭 → 모달)
상세 모달은 `size="xl"` (max-width 1400px)을 사용한다 (2026-06 확대).
모달 footer는 **본인이 처리 가능한 pending step**을 찾아 버튼을 조건부 렌더한다.

| 액션 | 버튼 노출 조건(프론트) | 호출 API |
|------|----------------------|----------|
| 합의 / 반려 (R·RV·P·PV·J·O·E·EV·RA) | `canUserAgree`가 참 | `approveStep` / `rejectStep` |
| PL 합의 / 반려 / **수정 후 상신** | PL 검토 단계 + 본인 | `peerApprove` / `peerReject` / `/request`로 이동(peerSubmit) |
| 담당자 지정 (R) | `canUserAssign`가 참 | `assignStep` |
| 검토중 (J·O·E·P, 2026-07 P 포함) | `canUserClaim`가 참 | `claimStep` |
| 검토자 선택 후 합의 (P·E, 2026-07, 다중) | `canUserPickReviewers`가 참(=`canUserAgree`와 동일 조건) — 별도 액션 없이 `approveStep`에 `reviewer_loginids` 동봉 | `approveStep`(agent P/E) |
| 지정자 변경 | PL/MASTER | `changeDesignee` |
| 후결자 추가/제거 (2026-07) | 작성자/MASTER + under_review + 병렬 진입 후 | `addPostApprover` / `removePostApprover` |
| 철회 | `can_withdraw` + 철회 요청중이 아닐 때 | 사유 입력 모달 → `withdraw`(진행 중이면 철회 요청, 그 외 즉시 삭제) |
| 철회 확인 / 거부 | 현재 pending 단계 담당자/팀+MASTER (요청중) | `confirmWithdraw` / `rejectWithdraw` |
| 철회 요청 취소 | 철회 요청자 본인/MASTER (요청중) | `cancelWithdraw` |
| 수정 후 재상신 | rejected/draft | `/request`로 이동(editDocId) |
| 중단 요청 | 작성자·under_review (`can_request_pause`) | 사유 입력 모달 → `requestPause` |
| 중단 확인 | 현재 pending 단계 담당자/팀+MASTER (요청중) | `confirmPause` |
| 중단 요청 취소 | 작성자 (요청중) | `cancelPause` |
| 재개 | 작성자·pause (`can_resume`) | `/request`로 이동(editDocId) → `resume` |

처리 중 `processing`으로 버튼 비활성화(더블클릭 방지), 결과는 토스트로 안내, 실패 시 `common.process_error`.

### 3.7 결재 가능 판정 (`ApprovalFlow.tsx`)
- `canUserAgree`: MASTER 항상 / PL은 자기 PL단계 assignee일 때 / 나머지(R·RV·P·PV·J·O·E·EV·RA)는 assignee 본인(R은 지정, J·O·E·P는 검토중 선점, RV·PV·EV·RA는 지정으로 배정됨).
  단, RV/PV/EV는 각각 담당자(R/P/E) 합의 후에만 실제 처리 가능(프론트는 `ApprovalPage.tsx` 호출부에서 `mainStepApproved` 게이트로 actable 대상에서 제외).
- `canUserAssign`: **R 전용**(2026-07, P 제외) — 같은 팀 + pending + 담당자 미지정일 때. PL·J·O·E·P는 지정 불가.
- `canUserClaim`: **J·O·E·P 전용**(2026-07 P 추가) — 같은 팀 + pending + 미배정일 때 '검토중'으로 선점 가능.
- `canUserPickReviewers`(2026-07 신설, `REVIEW_AGENT_OF`에 agent가 있을 때만): **P·E 전용** — 조건이 `canUserAgree`와
  동일하다(별도 지정 권한이 아니라 "이 단계에 합의할 수 있는 사람이면 그 합의 요청에 검토자를 함께 실을 수 있다"는
  UI 노출 조건일 뿐). `ApprovalPage.tsx`는 `actableStep`이 P/E일 때만 검토자 드롭다운을 렌더한다.

---

## 4. API 엔드포인트 (모두 `POST /documents/{id}/...`)

| 액션 | URL | 핵심 payload |
|------|-----|------|
| 상신 | `submit/` | `designated_pl_loginid` |
| 재상신 | `resubmit/` | `designated_pl_loginid` |
| 철회 | `withdraw/` | `reason`(진행 중 문서는 필수) |
| 철회 확인 | `confirm-withdraw/` | `agent` |
| 철회 거부 | `reject-withdraw/` | - |
| 철회 요청 취소 | `cancel-withdraw/` | - |
| 합의 | `approve-step/` | `agent`, `comment`, `approver_name`, (P/E만) `reviewer_loginids`(배열, 담당자 합의와 검토자 지정을 한 번에 처리 — P는 선택, **E는 필수(2026-08, 비어 있으면 400)**) |
| 반려 | `reject-step/` | `agent`, `comment` |
| 담당자 지정 (R) | `assign-step/` | `agent`, `assignee_loginid`, `assignee_name` |
| 검토중 선점 (J·O·E·P) | `claim-step/` | `agent` |
| 중단 요청 | `request-pause/` | `reason`(필수) |
| 중단 확인 | `confirm-pause/` | `agent` |
| 재개 | `resume/` | - (pause → under_review) |
| 중단 요청 취소 | `cancel-pause/` | - |
| PL 합의/반려/수정후상신 | `peer-approve/` `peer-reject/` `peer-submit/` | `comment` |
| 지정자 변경 | `change-designee/` | (의뢰자/MASTER) |
| 후결자 추가 (2026-07) | `add-post-approver/` | `loginid` |
| 후결자 제거 (2026-07) | `remove-post-approver/` | `loginid` |
| 검토 항목 추가 (2026-08) | `review-item-add/` | `title` |
| 검토 항목 제목 수정 (2026-08) | `review-item-rename/` | `item_id`, `title` |
| 검토 항목 삭제 (2026-08) | `review-item-delete/` | `item_id` |
| 항목 검토자 지정 (2026-08) | `review-item-reviewer-add/` | `item_id`, `loginid` |
| 항목 검토자 해제 (2026-08) | `review-item-reviewer-remove/` | `item_id`, `loginid` |
| 항목 확인/확인취소 (2026-08) | `review-item-confirm/` | `item_id`, `confirmed` |
| 삭제 | DELETE `documents/{id}/` | approved는 MASTER만 |

---

## 4.1 결재 알림 메일 (DXHUB) — 2026-06 추가

각 전이 시점에 해당 단계 권한자·작성자·결재 참여자·통보처에게 알림 메일을 보낸다.
(**나만의 그룹은 메일 발송 대상 기준이 아니다** — 그룹은 통보처 일괄 추가와 임시저장 공유에만 쓰인다. §9 참조.)
적재(enqueue)는 결재 트랜잭션 안에서 수행되고, 커밋 직후 즉시 1회 발송(거의 실시간)하며,
실패분은 백그라운드 큐(`MailNotification` + APScheduler `process_mail_queue`, 1분 주기)가
최대 5회 재시도한다(하이브리드).

| 전이(액션) | 메일 이벤트 | 수신자 |
|-----------|-----------|--------|
| `submit`/`resubmit` | stage_arrival(PL) | 지정 PL **전원**(각 PL step별 발송, 제목에 `[이름님]`, 2026-07 추가) |
| `peer_approve`/`peer_submit` | stage_arrival(R) | TE_R 미지정 시 고정 주소 |
| `approve_step`(R) | stage_arrival(P·**J**·O·E) | 미배정 시 **P·J·O·E 모두 팀 전원**. **(2026-08)** J 도착 메일이 P 완료 시점에서 이 시점으로 앞당겨졌고, 수신자도 고정 주소 1곳 → TE_J 팀 전원으로 바뀌었다 |
| `approve_step`(P/E 합의 시 `reviewer_loginids` 동봉, 2026-07) | stage_arrival(PV/EV) | 지정된 검토자 **각 1명**(담당자 합의와 같은 요청에서 즉시 개인화 메일 발송) |
| `approve_step`(J·O·E[+검토자 전원]·RA[전원] 모두 합의) | approved | **현재(최종) 회차 결재 경로에 참여했던 전원**(중복 제거). 2026-07부터 '작성자 그룹 멤버' 방식에서 변경 — `mailer.resolve_approved_recipients` |
| `reject_step` (R·RV·P·PV·O·E·EV·J·RA 반려) | rejected | 작성자 + 현재 회차 기합의자 전원 + **아직 합의를 마치지 않은 결재선 단계의 담당 팀 전원**(반려자 본인 제외, 2026-07 개편 — `docs/MAIL.md` §3.1) |
| `peer_reject`(PL 반려) | rejected | 작성자 + 현재 회차 기합의자 전원 + 같은 회차 미합의(pending) 나머지 지정 PL(2026-07 추가) |
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
5. ✅ **(2026-08 해결) 최종 완료예정 path1 추정치가 달력일 +4**(영업일 아님) — J 병렬 분리로 J 의
   실제 `due_date` 가 R 합의 시점부터 존재하게 되어 추정 로직 자체를 삭제했다(§3.5).
6. **하드코딩 한국어 다수**(규칙 G 위반): '지정자가 변경되었습니다.'(`:435`),
   '의뢰서가 삭제되었습니다.'(`:488`) 등 — i18n 이관 필요.
7. ✅ **(2026-07 해결) P·E 검토중(claim) 전환 + 다중 검토자(PV/EV)** — P·E도 지정하기 대신 검토중 방식으로 바꾸고,
   담당자 합의(`approve-step/`)에 `reviewer_loginids`를 함께 실어 보내면 그 요청 한 번으로 검토자를 여러 명
   지정할 수 있게 했다(R 담당자 지정이 담당자+검토자를 한 번에 받는 것과 동일한 UX — 별도 지정 API 없음).
   완료 판정은 `_stage_reviewers_complete` 가 하며 **E/EV·P/PV 모두 AND(전원 합의)** 다
   (한때 E/EV 만 OR(1명)이던 시기가 있었다 — §7 "EV OR 합의" 항목과 그 뒤 "EV AND 로 재전환" 항목 참고).
   검토자 없으면 기존과 동일하게 담당자 합의만으로 완료.
   ⚠️ **검토자 지정 변경/취소 기능은 범위 밖** — 한 번 지정된 검토자는 API로 제거할 수 없다(후속 작업으로 보류).
   ⚠️ **R과의 차이**: R의 검토자(RV)는 "지정한 그 사람"만 지정할 수 있지만(assign_step 자체가 R 담당자
   지정 화면에서만 노출), P/E는 검토중 방식이라 **선점 후엔 같은 팀 누구나** 합의 가능하므로 검토자 지정도
   담당자 본인이 아닌 같은 팀 다른 사람이 대신 할 수 있다(`_can_act_on_step` 조건과 동일).
8. ✅ **(2026-08 해결) 반려된 문서의 잔여 pending 단계가 '진행 중'으로 취급되던 문제**
   — 반려는 문서 `status`만 `rejected`로 바꾸고 잔여 `pending` step 은 이력으로 남기는데,
   프론트·백엔드 여러 곳이 **문서 상태를 확인하지 않고 "pending step 이 있으면 진행 중"** 으로만
   판단하고 있었다. 재상신 시 남는 **이전 회차** pending step 도 같은 문제를 일으켰다.
   - **백엔드(`_blocked_progress_response`)**: `approve_step`·`reject_step`·`assign_step`·`claim_step`
     이 `pause` 만 막고 `rejected` 는 통과시켰고, `peer_approve`·`peer_reject`·`peer_submit` 은
     상태 가드가 아예 없었다. 이제 **`under_review` 인 문서만** 결재를 진행할 수 있다.
     이로써 아래 두 **상태 되살아남(부활)** 이 차단된다.
     - 병렬 단계에서 O/E 가 반려한 뒤 잔여 P·PV 단계를 합의하면 `approve_step` 의
       `new_status = 'under_review'` 가 문서를 `rejected → under_review` 로 되돌리고
       `_advance_after_p_review` 가 J 단계까지 새로 만들었다 → 결국 반려가 무효화됐다.
     - 다중 PL 중 1명이 반려한 뒤 다른 PL 이 합의하면 `_advance_after_pl` 의 무조건
       `status = 'under_review'` 저장으로 문서가 되살아나는데, `_all_pl_approved` 는 반려자
       때문에 False 라 **R 도 생성되지 않아** 진행도 재상신(`status != 'rejected'`)도 불가능한
       문서가 됐다. → 해당 무조건 저장을 제거(이중 방어).
   - **프론트 표시(`approvalTable.ts`)**: `getDocTableRows` 에 `rejected` 최우선 분기 추가(§3.3).
     R 단계 반려 시 함께 지정돼 있던 검토자(RV) 단계가 pending 으로 남아 **'검토자(이름)' + '검토중'**
     으로 표시되며 다음 단계로 넘어간 것처럼 보이던 것이 이 버그의 최초 증상이다. 결재현황과
     홈 '최근 의뢰 현황'이 이 헬퍼를 공유하므로 두 화면 모두 고쳐진다.
   - **프론트 액션 버튼(`ApprovalPage.tsx`)**: 상세 모달 `pendingSteps` 에 `under_review` + 현재 회차
     조건 추가 — 예전엔 반려된 문서를 열어도 잔여 pending 단계에 대해 **합의/반려/검토중/지정하기
     버튼이 그대로 노출**됐고(위 백엔드 부활 버그를 실제로 클릭할 수 있는 경로였다),
     `canUserAgree`/`canUserClaim`/`canUserAssign` 은 step 만 보고 문서 상태·회차를 보지 않는다.
   - **프론트 목록 필터**: `hasActivePendingStep` 헬퍼로 통일(§3.2).
9. ✅ **(2026-08 해결) 'MAP 삭제/수정' 경로 도입으로 새로 드러난 화면·백엔드 결함 3건** — 상세는 Case O 참조.
   - 결재현황 목록(`approvalTable.ts`)이 병렬 구성원이 된 R 을 어디에도 표시하지 않던 문제 → `path0` 행 추가.
   - 결재 상세 RA 행이 이 경로에서 '대기'로 영구 표시되던 문제 → `isMapDeleteEdit` na 분기 추가.
   - `remove-post-approver` 최소인원 가드가 `only_prodc` 만 봐서 연구소 제품 문서는 마지막 후결자
     제거가 막히지 않던 문제 → `requires_post_approver()` 재사용으로 수정.
   앞의 두 화면 버그는 "R 이 병렬 진입 시점에 아직 안 끝나 있는" 상황을 처음 만들어낸 이 경로가
   드러낸 것이지 이 경로만의 문제가 아니다 — 기존 두 경로는 그 시점에 R 이 항상 이미 끝나 있어
   증상이 나타난 적이 없었을 뿐이다.

---

## 7. 상세 보기(PagedDetailView) 변경 이력

- **(2026-08) 'MAP 삭제/수정' 이유 카드 + RA 행 '해당없음' 처리**: '결재 경로' 탭 위쪽에
  MAP 정보 섹션(`section_map`)의 STEP1 페이지에 수정/삭제 이유 카드를 추가했다(본문은
  `RichTextEditor` 가 만든 HTML — 공지·가이드·VOC 와 동일하게 `dangerouslySetInnerHTML` 로
  렌더, 변경 시 빨간 테두리). '결재 경로' 탭의 후결자(RA) 행은 이 경로에서 항상 없으므로
  `isMapDeleteEdit` 판정으로 '해당없음'(na) 표시한다(§6-9, Case O 참조).
- **(2026-08) 합성 값 항목의 '이력 확인' 비교 불가 버그 수정**: `FieldHistoryModal` 은 과거 회차 값을 `snap.detail[fieldKey]` **단일 필드**로만 만들고 현재 행만 칩의 **합성 문자열**을 그대로 썼다. 그래서 지도 편차처럼 여러 필드를 합쳐 보여주는 항목은 `초기: 변경있음` / `현재: 변경있음 / X: 555um / Y: 444um` 처럼 **형식이 달라 값 비교가 불가능**했다.
  - `FieldHistoryModal` · `Chip` 에 `buildValue?: (d: Partial<DetailFormState>) => string` 을 추가했다. 넘기면 **회차 스냅샷과 현재 값을 모두 같은 함수**로 만들어 형식이 일치한다(`fieldKey` 는 단일 필드 항목 전용으로 선택 인자화).
  - 칩 표시값과 이력 값을 한 함수로 공유하도록 생성기를 분리했다 — `buildPurposeValue`(의뢰 목적 + `other_purpose`) / `buildMapValue`(지도 편차: C가문 상·하판 리전별 + 일반, X·Y·사유 포함) / `buildEaValue`(EA 변경 + 값) / `buildBbValue`(뼈찜 항목 목록).
  - `buildMapValue` 는 C가문 여부를 **현재 문서가 아니라 각 스냅샷 자신의 `only_prodc`** 로 판별한다(회차 중간에 C가문 Yes/No 가 바뀐 문서도 그 회차 형식대로 보인다).
  - 저장값 판정 문자열은 상수화했다(`MAP_NO_CHANGE = '변경 없음'`, `PRODC_YES = 'Yes'`). 표시 문구 자체는 위 2026-07 항목의 관례대로 하드코딩 유지.
- **(2026-08) Validation System 판정 주체를 상신자로 단일화**: 대상/비대상을 정하는 주체는 **상신자 하나**다. MASK(E) 합의 모달의 확정 토글을 제거하고(`approve-step` 의 `validation_system` 수용도 삭제), 결재현황 상세보기 J-layer 탭에 **상신자 본인에게만** 활성화되는 토글을 뒀다(`POST /documents/<id>/validation-system/`). 수정 창은 상신 직후부터 **지정된 EV 전원이 합의하기 전**까지(AND 재전환 이후 기준 — 아래 항목 참고). E 담당자 합의 후 값이 바뀌어도 **되감지 않고**, 값 변경 사실을 E step `comment` 에 note 로 남긴다.
- **(2026-08) EV OR 합의 + 남은 검토자 skip 마감**: `_stage_reviewers_complete` 는 **EV 만 `any()`(OR)** 로 판정한다 —
  MASK 검증은 담당자 판단을 한 사람이 더 확인하면 충분하다는 것이 원래 의도였고, 구현이 AND 로 되어 있던 것을
  바로잡았다. **P/PV 는 AND 그대로**다(범위 밖). EV 1명이 합의하면 같은 회차의 남은 `pending` EV step 은
  `action='skip'`(건너뜀) + `acted_at` 으로 닫는다 — `pending` 으로 두면 결재 경로에 '검토중' 으로 영구 표시되고,
  그 검토자가 뒤늦게 누르면 이미 승인된 문서를 다시 건드린다. step 을 **삭제하지 않는 이유**는 누가 검토자로
  지정됐었는지와 왜 판단하지 않았는지가 감사 추적에 필요해서다. **skip 알림 메일은 보내지 않는다.**
  ⚠️ `if not reviewer_steps: return True` 하위호환 가드는 **필수**다 — `all()` 은 빈 목록에 True 를 주지만
  `any()` 는 False 라, 이 가드가 없으면 검토자 없이 E 합의를 마친 레거시 문서가 **영구 잠긴다**(검토자를 지정할 경로가 없다).
- **(2026-08) EV 를 OR → AND 로 재전환**: 바로 위 항목의 OR(1명 합의)이 실제 요구사항과 달랐다 —
  지정한 검토자 **전원**이 합의해야 완료라는 결정에 따라 `_stage_reviewers_complete` 의 EV 전용
  `any()` 분기를 없애고 P/PV 와 동일한 `all()` 로 통일했다. 함께 걷어낸 것: EV 1명 합의 시 남은
  `pending` EV step 을 자동으로 `skip` 처리하던 로직(`approve_step` 583~597행 부근) — AND 에서는
  각자 직접 합의해야 하므로 자동 마감이 있으면 안 된다. **`skip` 값 자체는 선택지에서 지우지 않았다**
  — 이 재전환 이전(OR 시절) 문서에 이미 남아있는 `skip` 이력을 보존해야 하고, 프론트(`PagedDetailView`)의
  '건너뜀' 배지 표시도 그 이력을 계속 읽어야 하기 때문이다. 다만 이 배포 이후로는 새로 `skip` 이
  생성되지 않는다. 영향받은 곳: 위 Validation System 수정 창 게이트("EV 1명 합의 후 닫힘" →
  "EV 전원 합의 후 닫힘"), 상세 결재 경로 표시, 프론트 `approvalTable.ts` 의 경로2 상태점(2026-08 그리드 개편으로 폐기, §3.3.2).
  배포 안전성: 진행 중이던 문서도 별도 마이그레이션 없이 판정 함수만 바뀌므로 자연스럽게
  "남은 검토자도 합의해야 완료"로 동작한다(이미 완료·승인된 문서는 되돌리지 않는다).
- **(2026-08) 되감기 제거 — 값 변경은 감사 note 만 남긴다**: 구 동작(E/EV `action` 을 `pending` 으로 리셋 + 그 회차
  EV step 전체 삭제)을 **완전히 제거**했다. 함수도 개명했다(`backend/api/views.py` `_rewind_e_stage` →
  `_note_validation_system_change`). 이제 E step `comment` 에 `[값 변경 YYYY-MM-DD HH:MM] 상신자가 …` note 를
  덧붙이는 것이 전부이며, 응답의 `rewound` 필드도 제거했다(프론트 토스트는 단일 문구).
  되감기를 없앤 이유는 그것이 만들던 **잠금·이력 소실**이다 — EV step 삭제가 그 검토자의 수정 요청 `comment` 를
  통째로 지웠고(F1), pause 확인 대상 EV step 을 지워 중단 요청이 영원히 확정되지 않는 고착을 만들었다(F2).
  ⚠️ **의도적 트레이드오프**: E 담당자 본인은 값이 바뀌어도 재확인을 강제당하지 않는다. EV 중 누군가가
  (바뀐 값 기준으로) 합의하면 그걸로 단계가 끝난다. 위 잠금·이력 소실과 재작업 비용이 이 리스크보다 크다고
  판단해 **사용자가 명시적으로 수용한 리스크**다. 그래서 `comment` note 가 유일한 감사 추적이며 반드시 남긴다.
  **OR 전환과 되감기 제거는 반드시 함께 배포한다** — 되감기만 없애고 AND 를 남기면, 값이 바뀐 뒤 EV 전원이
  합의해야 하는데 아무도 재검토 신호를 못 받는 최악의 조합이 된다.
- **(2026-08) MASK(E/EV) 반려 → '수정 요청'**: E/EV 단계의 `reject-step` 은 `document.status` 와 `round` 를 건드리지 않고 사유를 step `comment` 에 덧붙인 뒤 상신자에게 `revision_requested` 메일만 보낸다. E 가 결재선 마지막 병렬 블록에 있어 반려 시 PL 부터 전 단계를 재결재해야 하는 비용이 과했기 때문이다. **E/EV 가 아닌 단계의 반려는 기존 동작 그대로다.**
- **(2026-08) 대상/비대상 UI 가 흰 배경에 사라지던 버그 수정**: 정의된 적 없는 `var(--primary)` 를 배경으로 쓰고 있어(미정의 커스텀 속성 → `background` 가 초기값 `transparent` 로 계산) **선택된 항목이 흰 배경에 흰 글씨**로 찍혔다. 사용처 3곳을 모두 제거하고 문서 상태 badge(`.badge-*`)와 같은 관용구의 `.vs-badge` / `.vs-toggle` 로 재작성했다(대상=warning, 비대상=info, 해당없음=회색). 공용 컴포넌트는 `frontend/src/components/ValidationSystem.tsx`.

- **(2026-07) INTER 표시 = 글자 코멘트**: INTER 섹션은 `inter === 'YES'` **일 때만** 노출하며, YES/NO 값 태그·버튼식 태그 없이 **글자**로 표시한다 — `INTER 적용`, Xs 적용 시 `Xs 적용`, Ys 적용 시 `Ys 적용`(` / ` 연결). Xs/Ys 는 선택 안 할 수 있으므로 적용된 것만 붙는다. (i18n: `approval.inter_applied`/`inter_xs_applied`/`inter_ys_applied`)
- **(2026-07) REV 여부 표 = 카드형(B)**: 상세보기 REV 표를 accent 좌측 rail 카드 + **Layer pill** 형태로 교체해 눈에 띄게 했다. 하드코딩 문자열(`REV 여부`·`GDS version`·`Layer / GDS version` 등)은 `request.rev_*` i18n 키로 이관.
- **(2026-07) Inter·Map Option 을 각각 별도 섹션 박스로**: `map_opt_inter`(YES 시 Xs/Ys 포함)와 `map_option_title`(옵션 태그) 블록을 map/mshot 등 다른 항목과 동일한 `chipBase` 박스(rowStyle) 로 감싸 **두 개의 독립 섹션**으로 표시한다. 기존에는 맨 div 로 렌더돼 다른 섹션과 디자인이 달랐다. (INTER 표기는 위 항목으로 다시 변경됨)
- **(2026-07) 고객/업체명 단독 표시 시 전체 폭·가운데 정렬**: '요구 사항'이 비어 있으면 '고객/업체명' Chip 을 전체 폭(`chipFull`) + 텍스트 가운데 정렬로 표시한다(둘 다 있으면 기존 좌측 2열 레이아웃 유지).
- **(2026-07) 결재 현황 테이블 계산 헬퍼 공용화**: `getDocTableRows`·`getFinalCompletionDate` 등을 `frontend/src/utils/approvalTable.ts` 로 이동해 **홈 화면 '최근 의뢰 현황'과 결재 현황이 동일한 표**를 쓰도록 했다. 홈에서 '검토중'으로 뜨고 결재 현황에서 '대기중'으로 뜨던 불일치를 해소한다. `ApprovalPage`·`HomePage` 가 이 헬퍼를 공유한다. **(2026-08)** 병렬 단계 2행 분기가 3행 2열 그리드로 바뀌고 `getDueDateDisplay` 는 컬럼과 함께 삭제됐다(§3.3.2·§3.5) — 두 화면 모두 같이 적용된다.
- **(2026-07) 모든 팀 상세 탭 전체 개방**: 역할 게이팅 플래그(`isP/isR/isJ/isO/isE`)를 **모두 `true`로 고정**하여, 모든 역할(PL·TE_R·TE_P·TE_J·TE_O·TE_E·MASTER)이 상세 보기의 **6개 탭 전부**(의뢰 상세 / MAP 정보 / J-ayer / O-ayer / 뼈찜 / 결재 경로)와 탭 내부 섹션을 **동일하게** 볼 수 있다. 이로써 아래 2026-06-13 항목의 "MAP은 순수 TE_J/TE_E 미표시" 제한도 해제된다(상세 내용은 결재 권한과 무관한 표시 영역).
- **(2026-06-13, 위 2026-07 개방으로 상위 완화됨) 원본 라인/Part ID는 MAP 정보 섹션에만 표시**: 기존에는 `source_line`/`source_partid`가 '상세 정보' 섹션(`section_detail`)과 'MAP 정보' 섹션(`section_map`, `map_type === 'CLONE'`) 두 곳에 중복 노출됐다. '상세 정보' 쪽 블록을 제거하여 **MAP 정보 섹션(CLONE)에서만** 보이도록 한다.
- 각 step에서 작성한 내용은 상세 보기에서 별도 페이지/섹션으로 분리 렌더된다: J-layer→`job_li`, O-layer→`ovl_li`(table/info 탭, info 탭에 `partial_shot`·TBV·TLV), Backbone→`bb`, MAP 변경 내용→`section_map`.
- **(2026-06-22)** J-ayer `📊 export` 버튼에 `data-tour="export-jayer"`, 결재 경로 탭 카드에 `data-tour="approval-route-tab"`을 부여했다(전체 가이드 투어 강조용, 실제 동작 변경 없음).
- **(2026-07) P/E단계 검토자(PV/EV) 결재 경로 표시**: R단계와 동일한 패턴으로, P/E 행에 **담당자(합의자) + 지정된 검토자(PV/EV, 있을 때만)**를 함께 표시한다(`getStepDisplays`, `roleLabel`). 검토자가 없으면 기존과 동일하게 담당자 행만 보인다.
- **(2026-07) 결재현황 목록 O 이름 비표시 + 완료 시 전원 이름 표시**: `approvalTable.ts`. O를 J와 동일하게 검토중 진행 중엔 담당자 이름을 가리도록 통일(이전엔 O만 이름이 보여 P/E·O/J 규칙이 뒤섞여 있었음). 대신 경로1/경로2/경로3이 **완료된 시점**엔 진행 중 가려뒀던 이름(J·O 포함)까지 모두 드러내 실제 결재자 전원을 `라벨(이름) / 라벨(이름) ...` 형식으로 보여준다(`namedApprovers`) — 이전엔 완료 시 그냥 "결재완료"만 표시해 배지와 텍스트가 중복이었다.
- **(2026-06-23)** 재상신 변경 이력 강조용으로 J-ayer 변경 행의 '이력 확인' 버튼에 `data-tour="jayer-hist-btn"`을 부여했다(투어에서 변경 전/후 비교 모달 시연용, 실제 동작 변경 없음).
- **(2026-07) 재상신 변경이력 표시 개선(4종)**: 반려 후 재상신 시 직전 스냅샷(`history[history.length-1]`) 대비 변경분을 표시하는 로직을 확장했다. 비교 기준·저장 구조(`additional_notes.history[]` 누적)는 그대로다.
  - **블록 이력 확인 추가**: 기존에 **빨간 테두리만** 있던 **엠샷 / 생산정보(C가문) / REV** 블록에 우상단 **'이력 확인'** 버튼을 붙였다. 클릭 시 `FieldGroupHistoryModal`(항목 / 변경 전 / 변경 후 세로 표)로 이전·현재 값을 비교한다. 값 포맷은 `buildMshotRows`/`buildProdcRows`/`buildRevRows`(모듈 순수 함수)로 생성한다.
  - **표 이력 가로형 전환**: J-ayer / O-ayer / 뼈찜(BB) 행 '이력 확인' 모달(`RowDiffModal`)을 **세로 3열 → 원본 표 형식 가로형**으로 바꿨다. 헤더=원본 컬럼(필드), 본문 2행(**변경 전 / 변경 후**), 바뀐 셀만 색·배경 강조. 열이 많으면 가로 스크롤(`overflow-x:auto`). `DiffField.format?`로 셀 포맷 주입 가능.
  - **O-ayer 정보탭 이력 적용**: 그동안 강조가 **누락**돼 있던 `ovl_li`의 **info 탭**(`partial_shot`·`tbvtlv_thickness`·`tbvtlv_entries`)에 변경 시 **빨간 테두리 + 이력 확인**(`FieldHistoryModal`, 항목별)을 추가했다. 탭 버튼 배지는 **변경 시 빨강 점**, 미변경·데이터 있음은 기존 초록 점.
  - **n회차 이력 가독성**: `FieldHistoryModal`에 **회차별 변경 열**(`최초`/`변경됨`/`변경 없음`)을 추가해, 예컨대 1회차 무변경·2회차 변경이 한눈에 보인다. 스칼라 외 값(예: `tbvtlv_entries`)은 `format` 콜백으로 문자열화한다.
  - **하드코딩 문자열**: 이 화면의 변경이력 라벨(변경 전/후·이력 확인·회차 등)은 기존 파일 관례대로 하드코딩 유지(별도 i18n 이관은 후속 과제).
- **(2026-08) 이력 확인 모드 이원화**: 같은 상세 화면이라도 **결재 진행 중**과 **이력 조회**의 이력 UI 동작이 갈린다. `PagedDetailView` 의 `historyMode` prop 으로 분기하며, 이 페이지(`ApprovalPage`)는 넘기지 않으므로 **항상 진행 중 동작**이다.
  - **진행 중(이 페이지)**: 9곳 전부 **직전 회차와 다를 때만** 빨간 테두리·'이력 확인'이 뜨고, 모달은 **변경 전/후만** 보여준다. 종전에 칩·O-ayer 정보탭만 회차별 표로 뜨던 것을 전/후로 통일했다.
  - **이력 조회(`HistoryPage`)**: **한 번이라도 바뀌었으면** 표시되고, 모달이 **회차별 전체**로 나온다. 값이 되돌아온 항목(A→B→A)도 진행 중에는 표시되지 않지만 이력 조회에서는 잡힌다.
  - 투어(`open-rowdiff`)는 이 페이지 기준이므로 J-ayer 변경 전/후 모달 시연이 그대로 유지된다.
  - 상세 구현(회차 축 `roundSnaps`, `computeEverChangedFields`/`computeTableEverChanged`, 회차별 모달 3종, 표 행 매칭 규칙)은 `docs/REQUEST.md` 의 2026-08 항목 참조.

---

## 8. 전체 가이드(투어) 모드

`/approval?embed=tour` 진입 시 실데이터 API 대신 샘플 시드(`frontend/src/pages/approvalTourSeed.ts`)로 결재 현황을 시연한다(평상시 동작 무영향).

- **시드**: 문서 3건 — A(R 합의 후 병렬 진행, 목록 2행 분기, **재상신 이력 1건 포함** → 상세에서 변경 필드·행 강조) / B(PL 검토 중, 단일 행) / C(R 담당자 지정 대기, 단일 행). `MY`(내 결재) 필터는 사용자 역할과 무관하게 `TOUR_APPROVAL_MY_IDS`(A·C)로 고정한다. 지정하기 시연용 샘플 팀원은 `TOUR_ASSIGN_MEMBERS`.
  - 문서 A 병렬 상태: 경로1은 **P 검토중 / J 대기**(P→J 순차라 J 단계는 아직 미생성), 경로2는 **O 검토중**(담당자 지정). P·J 동시 검토중으로 보이지 않게 한다.
- **결재 경로 다이어그램**: `frontend/src/components/ApprovalRouteDiagram.tsx`. **전체 가이드의 첫 단계(독립 컴포넌트)로 분리**되어, 결재현황 페이지(iframe)에는 더 이상 렌더하지 않는다. 최종 경로 `제품담당자→검토→RFG→[경로1 PHPSI]∥[경로2 JOB]∥[경로3 OVL(+EUV)]∥[후결자]→완료`(2026-08 J 분리 반영)와 조건(EUV(E) 단계는 plel 존재 시에만 진행되며 Validation System 대상/비대상 판정을 확인·Only MAP은 R까지·반려 시 처음 PL 검토부터 새 회차로 재상신하거나 철회)을 안내한다. 박스는 약어(code) 없이 **이름(label)만** 표시하며, 완료 박스만 현재처럼 `✓ + 완료`를 유지한다.
- **지정하기 시연(실제 기능과 동일)**: 운영 지정 UI를 **커스텀 드롭다운(버튼→후보 목록→항목 클릭)+확인/취소**로 통일했고, 투어도 동일 UI를 쓴다. `open-assign`이 커서로 각 요소를 **실제 클릭**(지정하기→드롭다운 펼침→첫 후보 선택→확인). '확인' onClick은 `handleAssign`을 호출하며, 투어 모드에서는 `handleAssign`/`handleLoadTeamMembers`가 API 대신 **로컬 상태로 담당자를 배정**(샘플 `TOUR_ASSIGN_MEMBERS`)하고 토스트(`approval.assign_success`)를 띄운다. 배정 후 `assignee_loginid`가 채워져 지정 UI가 사라진다(실제 동작과 동일). 캡션은 **상단(topCaption)**으로 띄워 하단 footer 지정 UI를 가리지 않는다.
- **명령 수신**(부모 모달 → iframe `postMessage`): `tour-reset` · `my-filter`/`all-filter` · `open-detail`(대표 문서 A 제목 클릭→상세) · `open-assign`(문서 C 상세→지정하기→드롭다운→후보→확인까지 실제 배정) · `open-rowdiff`(문서 A J-ayer '이력 확인'→변경 전/후 모달) · `page-jayer`/`page-route`(상세 탭 이동, MASTER 기준 인덱스 2/5) · `pause`/`resume`.
- **`data-tour` 앵커**(투어 전용): `approval-stage`(현재 단계 컬럼·문서 A 행) · `assign-btn`(지정하기 버튼) · `assign-select`(드롭다운 버튼) · `assign-option`(첫 후보 항목) · `assign-confirm`(확인 버튼) · `jayer-hist-btn`(이력 확인 버튼).
- **시연 순서**: 소개 → MY 필터 → 현재 단계·메일 발송 안내(목록 컬럼) → 지정하기(문서 C, 실제 드롭다운→후보→확인 배정까지) → 제목 클릭(커서)으로 상세(문서 A) 열기 → 결재 경로 탭(팀별·회차별 이력) → J-ayer export 안내 → 재상신 변경 행 강조 → 이력 확인 모달. (큰 결재 경로 다이어그램은 별도 첫 단계로 분리.) export 설명은 J-ayer만 한다.
- 상세 모달은 투어에서 `PagedDetailView`에 `role="MASTER"`를 넘겨 모든 페이지가 보이도록 한다.
- **권한관리 단계**는 iframe이 아니라 컴포넌트형 데모(`PermissionUserGroupDemo`)로 전체 가이드에 포함된다 — 자세한 내용은 `docs/전체가이드.md`의 "컴포넌트형 단계 공통 / 권한관리" 참고.

---

## 9. 임시저장(draft) 공유 그룹

임시저장(`status='draft'`) 문서는 **작성자 본인 + 문서에 지정된 공유 그룹의 멤버 + MASTER** 에게만
보인다. 그 외 상태(상신/반려/완료)는 종전대로 전원에게 노출된다.

### 9-1. 공유 대상은 '그룹 1개' (2026-08 정책 변경)

예전에는 "작성자와 **아무 그룹이나** 공유하면 볼 수 있다"였다. 그래서 그룹을 3개 가진
사용자의 임시저장은 **세 그룹 전원**에게 노출됐다. 이제 작성자가 문서마다 그룹 하나를
지정해야 하고, 지정하지 않으면 아무에게도 공유되지 않는다.

- 필드: `RequestDocument.shared_group` (FK → `UserGroup`, null 허용, `SET_NULL`, 마이그레이션 `0016`)
- 지정 UI: **결재 현황 → 임시저장 행(또는 상세 모달) → `👥 그룹 지정`** → 내가 속한 그룹 중 1개 선택 / '공유 안 함'
- 지정 API: `POST /api/documents/{id}/set-shared-group/` body `{"group_id": <id>|null}`
  - 인가: **의뢰자 본인 또는 MASTER 만**. 공유 그룹 멤버는 문서를 수정·상신할 수는 있어도 공유 범위는 못 바꾼다.
  - 지정 가능한 그룹은 **호출자가 멤버인 그룹**뿐(남의 그룹에 문서를 밀어 넣을 수 없다).
  - serializer 에서 `shared_group` 은 **read-only** — 전체 저장(PUT/PATCH)에 값이 빠져 공유가 초기화되는 것을 막는다.
- 조회 구현: `RequestDocumentViewSet.get_queryset`(`backend/api/views.py`)
  ```python
  qs.filter(~Q(status='draft') | Q(requester=user) | Q(shared_group_id__in=my_group_ids))
  ```
  - `my_group_ids` = 호출자가 멤버인 `UserGroup` id 집합(`user.member_groups`).
  - MASTER 및 비인증(개발 모드)은 전체 조회.

### 9-2. 공유 그룹 멤버가 할 수 있는 것

| 동작 | 공유 그룹 멤버 | 근거 |
|---|---|---|
| 조회 | ✅ | `get_queryset` |
| 수정 · 임시저장 | ✅ | `can_edit`(draft 분기) |
| 상신 · 재상신 | ✅ | `submit`/`resubmit` 의 `can_edit` 인가 |
| 철회(요청·즉시삭제) | ✅ | `can_withdraw` — 확정 시 문서가 삭제된다(Case J) |
| **삭제** | ❌ | `can_delete` — 의뢰자 / 지정 PL / MASTER 만 |
| **공유 그룹 변경** | ❌ | `set_shared_group` — 의뢰자 / MASTER 만 |

### 9-3. 의뢰자는 최초 작성자로 고정

그룹원 B가 A의 임시저장을 수정·상신해도 **의뢰자는 A** 다.
- 백엔드: `RequestDocumentSerializer.update` 가 `requester_name/_email/_department` 를 무시하고,
  `requester` FK 는 `perform_create` 에서만 설정되므로 수정 시 바뀌지 않는다.
- 프론트: `RequestPage` 가 편집 모드 진입 시 원본 의뢰자를 `originalRequesterRef` 에 보관해 그대로 다시 보낸다.

- 테스트: `backend/api/tests.py::DraftVisibilityTest`, `::SharedGroupDraftTest`
- ⚠️ 마이그레이션 시 기존 draft 는 전부 `shared_group=null` → **작성자 본인·MASTER 에게만** 보이게 된다
  (데이터 손실은 없고 노출 범위만 좁아진다). 계속 공유하려면 작성자가 다시 지정해야 한다.

---

## 10. J 단계 검토 항목 (2026-08)

의뢰 상세 모달 **'J-ayer 정보' 탭 안의 서브탭**(`JOB Layer 목록` / `검토 항목`)이다.
결재선(`ApprovalStep`)과는 완전히 분리돼 있어 **결재 경로 탭·결재 현황 목록·상태 배지에는
전혀 나타나지 않는다.** 항목이 모두 완료돼도 J 단계가 자동 합의되지 않고, 반대로 항목이
남아 있어도 합의할 수 있다.

### 10-1. 데이터 모델

| 모델 | 역할 |
|------|------|
| `ReviewItemMaster` | 전역 마스터 목록. 삭제는 행 삭제가 아니라 `is_active=False` (사본의 출처 보존) |
| `DocumentReviewItem` | 문서별 사본. `title` 을 따로 보관해 **박제된 문서가 자기 시점 제목을 유지**한다 |
| `DocumentReviewItemReviewer` | 항목별 검토자와 확인 상태(`confirmed`, `confirmed_at`) |

마이그레이션: `0018_reviewitemmaster_documentreviewitem_and_more.py`

### 10-2. 동기화 정책 (단일 소스: `backend/api/review_items.py`)

1. **채우기 시점** — 문서에 **J 단계가 생성되는 순간** 마스터의 활성 항목을 복사한다(제목만,
   검토자는 빈 상태). 연결 지점은 J 단계를 만드는 두 곳뿐이다 —
   `_advance_to_parallel`(일반 경로: R 합의 시점, J 가 병렬 단계로 생성될 때) /
   `_create_map_delete_edit_parallel`('MAP 삭제/수정': PL 합의 직후).
   → **J 단계를 거치지 않는 경로(Only MAP 등)에는 항목이 생기지 않는다.**
2. **전파** — 어느 문서에서든 항목을 추가·제목수정·삭제하면 마스터에 반영하고, 같은 변경을
   **전파 대상 문서**에도 적용한다. 전파 대상 = `status ∈ (under_review, pause)` **AND**
   현재 회차에 pending 인 J 단계가 있는 문서.
3. **삭제 전파 예외** — 다른 문서에서 이미 확인(`confirmed`)한 검토자가 있는 사본은 남긴다(기록 보존).
   삭제를 지시한 원본 문서의 사본은 확인 기록과 무관하게 지운다.
4. **박제** — 결재가 끝난 문서는 전파 대상에서 빠져 그 시점 목록으로 굳는다.
5. **재상신** — 항목·검토자 지정은 그대로 두고 **확인 상태만 초기화**(`reset_confirmations`)한 뒤,
   새 회차 J 단계가 열릴 때 마스터를 다시 따라잡는다. 즉 반려돼 있는 동안 다른 문서에서 추가된
   항목이 이때 들어온다.

> ⚠️ '현재 회차' 판정에 `MAX(round)` 중첩 서브쿼리를 쓰면 안 된다. 중첩 서브쿼리 안의 `OuterRef` 는
> 가장 가까운 바깥 쿼리(`ApprovalStep`)에 묶여 `U0.document_id = V0.id` 라는 잘못된 상관식이 만들어지고
> 대상이 **항상 0건**이 된다. `sync_target_documents` 는 "더 큰 round 의 단계가 없다"로 판정한다.

### 10-3. 인가

| 동작 | 조건 |
|------|------|
| 서브탭 노출 | 역할이 `TE_J` 또는 `MASTER` |
| 항목 추가·제목수정·삭제 / 검토자 지정·해제 | 위 + 문서가 진행 중 + **현재 회차 J 단계가 '검토중'으로 선점(assignee 존재)** + 합의 전 |
| 확인 / 확인취소 | 위 단계 조건 + **그 항목의 검토자 본인** |
| 확인한 검토자 지정 해제 | ❌ 불가(400) — 검토 기록 보존 |

선점 전에는 읽기 전용, J 합의 후에는 잠긴다. 반려 문서도 읽기 전용이다.

### 10-4. 화면

- 결재 현황 상세: 편집 가능(위 인가 조건에 따름). 서브탭 점 — 미완료 있으면 🔴, 전부 완료면 🟢, 0건이면 없음.
- 이력 조회 상세: **읽기 전용**. 목록 응답에는 항목이 없어 `openDetail` 이 상세를 한 번 더 받아 연다.
- 컴포넌트: `frontend/src/components/ReviewItems.tsx` (상태·핸들러는 호출부가 소유)

### 10-5. 테스트

`backend/api/tests.py::ReviewItemSyncTest` (11건) — A(결재중)·B(완료)·C(원본)·D(결재중) 전파,
반려 문서의 재상신 따라잡기, 확인 기록이 있는 사본의 삭제 보존, 상태별 인가, MY 탭 개수 필드.

---

*결재 로직/화면이 바뀌면 이 문서를 반드시 함께 갱신한다.*

---

## 11. 홈 '나의 의뢰 현황' (2026-08)

홈 화면의 **'최근 의뢰 현황'을 '나의 의뢰 현황'으로 개편**했다. 화면: `frontend/src/pages/HomePage.tsx`.

- **위치**: 연간 제품별(디자인룰) 의뢰 현황 차트 **위**로 올렸다(예전엔 차트 아래).
- **대상 판정**: 결재현황 **MY 탭과 같은 판정**을 쓴다 — `utils/approvalTable.isMyDocument`
  (§3.2 참조. MASTER=전체 / PL=작성자 또는 내 pending 단계 / TE_*=내 pending 단계 또는 미확인 검토 항목).
  두 화면이 같은 헬퍼를 쓰므로 홈과 결재현황 MY 탭의 목록이 어긋나지 않는다.
- **표시 규칙**: 완료(`approved`)건 제외 → **상신 오래된 순**(`submittedSortKey`, 결재현황 기본 정렬과 동일)
  → **최대 5건**(`MY_REQUESTS_LIMIT`).
- **표**: 결재현황과 동일한 컬럼·그리드(§3.3). 현재 단계 칸도 같은 `getDocTableRows`/`StageGrid` 를 쓴다.
- **'전체 보기 →'**: `/approval?filter=my` 로 이동해 **MY 탭이 열린 상태**로 결재현황을 연다.
- **빈 상태**: 0건이면 섹션을 숨기지 않고 `home.my_requests_empty` 안내를 보여준다.
- **역할 없는 사용자(`NONE`)**: 섹션 전체를 노출하지 않는다(연간 차트와 동일).
- i18n: `home.my_requests_title` / `home.my_requests_empty` (`home.recent_title` 은 제거).
