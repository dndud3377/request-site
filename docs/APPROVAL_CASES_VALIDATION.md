# APPROVAL_CASES_VALIDATION — 제품담당자 상신 시 결재 경우의 수 · 검증 지시서

> 작성일: 2026-08-13
> 대상 독자: **이 저장소를 처음 보는 다른 AI(검증자)**
> 목적: 제품담당자(PL)가 의뢰서를 상신했을 때 발생할 수 있는 **결재 경우의 수를 빠짐없이 열거**하고,
> 각 경우가 실제 구현과 일치하는지 **코드 대조 + 테스트 실행**으로 검증하게 한다.
> 기준 문서: `docs/APPROVAL.md`(구현 서술) / 기준 코드: `backend/api/views.py`, `backend/api/models.py`
>
> ⚠️ 이 문서는 **검증 대상 명세**다. 여기에 적힌 "기대 동작"은 `docs/APPROVAL.md` 와 코드를 읽어 정리한
> 것이며, **그 자체가 정답 보증서가 아니다.** 검증자는 각 케이스마다 코드에서 사실을 확인해야 하고,
> 문서와 코드가 어긋나면 **고치지 말고 §8 형식으로 보고**한다(프로젝트 규칙 K).

---

## 0. 전제와 용어

| 용어 | 뜻 |
|---|---|
| **제품담당자** | `UserProfile.role == 'PL'`. 의뢰서를 **작성·상신**하고, 결재선에서 `PL`(검토)·`SA`(영업/기술지원 합의자)·`RA`(추가 후결자)로 참여한다. 상신 모달의 동료 PL·후결자·통보처 후보는 모두 PL 만 노출된다(`docs/APPROVAL.md` Case N 후속). |
| **TE_\*** | 검토·합의를 맡는 실무 팀 역할. `TE_R`→agent `R`/`RV`/`RA`(고정), `TE_P`→`P`/`PV`, `TE_J`→`J`, `TE_O`→`O`, `TE_E`→`E`/`EV`. (`models.py:28` ROLE_CHOICES / `models.py:260` AGENT_CHOICES) |
| **MASTER** | 모든 단계를 대신 처리할 수 있는 관리자 역할. 모든 권한 케이스의 예외 축이다. |
| **단계(step)** | `ApprovalStep` 1행 = 결재선 1칸이자 이력. `round`(회차)로 재상신을 구분하고, 화면은 항상 `max(round)`만 본다. |
| **claim(검토중)** | `J·O·E·P` 는 지정이 아니라 팀원이 스스로 선점한다(`views.py:202` `_CLAIM_AGENTS`, `claim_step` `views.py:1215`). |
| **검토자** | `RV`(R 단계) / `PV`(P 단계) / `EV`(E 단계). 담당자 합의 **후에만** 처리 가능(순차 가드). |

**결재 진행의 대전제** — 결재 액션(`approve_step`/`reject_step`/`assign_step`/`claim_step`)은
`status == 'under_review'` 인 문서에서만 가능하다. `pause`, 철회 요청 확인 대기 중, 이미 종료된 문서
(`approved`/`rejected`)는 400 으로 막힌다(`views.py:173` `_blocked_progress_response`).

---

## 1. 경우의 수를 만드는 변수(축)

상신 1건의 결재 진행은 아래 축들의 조합으로 결정된다. **검증자는 각 축의 판정 함수가
문서 서술과 같은지 먼저 확인**하고, 그 다음 §3 케이스를 검증한다.

| # | 축 | 값 | 판정 위치 | 결재선에 미치는 영향 |
|---|---|---|---|---|
| A1 | 요청 목적 | 일반 / `Only MAP` / `MAP 삭제` | `models.py:158` `is_only_map()`, `models.py:167` `is_map_delete_edit()` | 경로 자체가 갈린다 |
| A2 | 기타 목적 `Overlay 변경` **단독** | 예 / 아니오 | `models.py` `skip_j_stage()` | 일반 경로에서 **J 단계 미생성** |
| A3 | J-layer `pp` 에 `plel` 포함 | 예 / 아니오 | `has_ppid_plel()`, 상수 `VALIDATION_KEYWORD`(`models.py:108`) | **E(MASK) 단계 생성 여부** |
| A4 | 지정 PL 수 | 1명 / 2명 이상 | `views.py:1684` `_resolve_designated_pls` | PL step N개, **전원 합의** 필요 |
| A5 | 영업/기술지원 합의자(SA) | 0명 / 1명 이상 (+ 필수 여부) | `models.py` `requires_sales_agreer()`, `views.py:350` `_resolve_sales_agreers` | PL 과 **병렬**, 전원 합의해야 다음 단계 |
| A6 | R 검토자(RV) | 없음 / 1명 | `assign_step`(`views.py:1089`) | R 담당자 합의 후 RV 합의까지 기다림 |
| A7 | P 검토자(PV) | 0명 / N명 (**선택**) | `approve_step` 의 `reviewer_loginids`(`views.py:893`) | P 완료 = 담당자 + PV 전원(AND) |
| A8 | E 검토자(EV) | **1명 이상 필수**(신규 합의) | `views.py:871~885` | 비어 있으면 **400** |
| A9 | 후결자(RA) | 고정 1명(`POST_APPROVER_LOGINID`) + 추가 0~N | `views.py:1540` `_get_post_approver_users` → `mailer.post_approver_users` | 병렬 종단 경로 |
| A10 | 추가 후결자 필수 대상 | C가문(`only_prodc=Yes`) 또는 기타목적 `연구소 제품` | `models.py:177` `requires_post_approver()` | 상신 시 1명 이상 필수 |
| A11 | 진행 중 이벤트 | 없음 / 중단(pause) / 철회 요청 | Case M / Case J | 결재 **동결** 또는 문서 삭제 |
| A12 | 종단 트리거 | 마지막으로 합의한 단계가 무엇인가 | `views.py:961~1001` | **판정 트리거 누락 시 문서가 영구 정지** |

> ⚠️ **A1 값 확인 필요**: 코드 상수는 `MAP_DELETE_EDIT_PURPOSE = 'MAP 삭제'`(`models.py:91`)인데
> `docs/APPROVAL.md` 본문(Case O)은 값이 `'MAP 삭제/수정'` 이라고 적고 있다. §8-1 참조.

---

## 2. 결재선 유형 (경로 조합) — 상신 직후 확정되는 골격

제품담당자가 상신하면 아래 6가지 결재선 골격 중 하나로 진행된다(SA 유무를 곱하면 12가지).

| ID | 조건 | 결재선 | 종단 조건 |
|---|---|---|---|
| **RT-1** | 일반 + J 있음 + E 있음(plel) | `PL(+SA) → R(+RV) → P(+PV) ∥ J ∥ O ∥ E(+EV) ∥ RA` | P·J·O·E·RA 전부 |
| **RT-2** | 일반 + J 있음 + E 없음(plel 없음) | `PL(+SA) → R(+RV) → P(+PV) ∥ J ∥ O ∥ RA` | P·J·O·RA |
| **RT-3** | 일반 + `Overlay 변경` 단독(J 없음) + E 있음 | `PL(+SA) → R(+RV) → P(+PV) ∥ O ∥ E(+EV) ∥ RA` | P·O·E·RA (`j_approved`는 True 고정) |
| **RT-4** | 일반 + `Overlay 변경` 단독 + E 없음 | `PL(+SA) → R(+RV) → P(+PV) ∥ O ∥ RA` | P·O·RA |
| **RT-5** | `Only MAP` | `PL(+SA) → R(+RV) → RA` | RA 전원 (**RA 0명이면 R 합의 즉시 approved**) |
| **RT-6** | `MAP 삭제` | `PL(+SA) → P(+PV) ∥ R(+RV) ∥ J ∥ O` | 네 단계 전부. **E·RA 없음** |

근거: `views.py:1625` `_advance_to_parallel`, `views.py:1582` `_create_map_delete_edit_parallel`,
`views.py:1715` `_open_stage_after_pl`.

**골격 경우의 수 계산**
```
결재선 골격 6 (RT-1~6)
 × SA 지정 유무 2
 × 지정 PL 1명 / 2명 이상 2
 = 24 가지 (상신 시점에 결정되는 조합)
```
여기에 진행 중 변수(RV 0/1, PV 0/N, EV 1/N, RA 고정+추가, 마지막 합의 단계, 반려 지점,
중단·철회 개입)가 곱해진다. §3 은 이 곱집합을 **동작이 갈리는 지점 기준으로 압축한 케이스 목록**이다.

---

## 3. 검증 케이스 목록

각 행의 의미:
- **전제**: 그 상태를 만들기 위해 필요한 준비.
- **트리거**: 호출할 API 또는 화면 조작.
- **기대 결과**: 검증자가 확인해야 할 사실(문서 status / step 상태 / 응답 코드).
- **근거**: 확인할 코드 위치. 반드시 **직접 읽어** 기대 결과와 일치하는지 본다.
- **기존 테스트**: `backend/api/tests.py` 의 테스트명. 있으면 그 테스트를 **실제로 실행**해 통과를 확인한다.
  비어 있으면 §5-3 절차로 재현 테스트를 새로 작성해 확인한다.

### 3.1 그룹 S — 상신 (제품담당자의 행위)

| ID | 전제 | 트리거 | 기대 결과 | 근거 | 기존 테스트 |
|---|---|---|---|---|---|
| S-01 | draft, 지정 PL 1명 | `submit/` | `status=under_review`, `submitted_at` 기록, `PL` pending step 1개(round=1) | `views.py:395` | `PlSubmitMailTest.test_submit_pl_mail_subject_has_name_prefix` |
| S-02 | draft, 지정 PL 2명 이상 | `submit/` | PL pending step **N개** 생성, `designated_pl` FK 에는 **첫 번째**만 | `views.py:1684` | — |
| S-03 | 지정 PL 목록이 비어 있음 | `submit/` | 400 `동료 PL을 지정해주세요.` | `views.py:1701` | — |
| S-04 | 지정 대상이 role≠PL | `submit/` | 400 `유효하지 않은 PL 사용자입니다` | `views.py:1707` | — |
| S-05 | 자기 자신을 지정 PL 로 | `submit/` | 400 `본인을 지정할 수 없습니다.` | `views.py:1710` | — |
| S-06 | 활성 J-layer 행에 `process_id` 있는데 Bb 미매핑 | `submit/` | 400(상신 차단) | `views.py:309` `_validate_bb_mapping` | `BbMappingValidationTest.test_normal_unmapped_row_still_blocks_submit` |
| S-07 | `additional_notes` JSON 파싱 실패 | `submit/` | ⚠️ **검증을 건너뛰고 통과**한다(문서상 '의도 확인 필요' 항목) | `views.py:309` | — |
| S-08 | `requires_post_approver()` 참(C가문 또는 연구소 제품) + 추가 후결자 0명 | `submit/` | 400(후결자 필수) | `views.py:338` `_validate_post_approvers` | `LabProductPostApproverTest.test_lab_product_requires_post_approver` / `test_cfamily_still_requires_post_approver` |
| S-09 | `requires_sales_agreer()` 참 + SA 0명 + 미지정 사유 없음 | `submit/` | 상신 거절(프론트·백엔드 양쪽 차단) | `models.py` `requires_sales_agreer`, `views.py:371` `_validate_sales_agreers` | — |
| S-10 | SA 대상이 role≠PL | `submit/` | 400 | `views.py:350` `_resolve_sales_agreers` | — |
| S-11 | SA 지정 있음 | `submit/` | `agent='SA', is_parallel=True` step 이 **PL 과 같은 회차**에 인원수만큼 생성 | `views.py:385` | — |
| S-12 | SA 지정 없음 | `submit/` | SA step 을 **만들지 않는다**(화면·메일 모두 '해당없음') | `views.py:385` | — |
| S-13 | 이미 `under_review` 인 문서 | `submit/` | 상신 불가(조건은 `status=='draft'`) | `views.py:395` | — |
| S-14 | MASTER + draft | `direct-approve/` | 결재선을 타지 않고 `draft → approved`(pending step 없음, 메일 없음) | `views.py:525` | — |

### 3.2 그룹 L — PL 검토 · SA 합의 (PL 과 SA 는 병렬)

| ID | 전제 | 트리거 | 기대 결과 | 근거 | 기존 테스트 |
|---|---|---|---|---|---|
| L-01 | PL 1명, SA 없음 | `peer-approve/` | PL step approved → **다음 단계 생성**(일반=R, `MAP 삭제`=P·R·J·O) | `views.py:1728`, `1715` | `MapDeleteEditRouteTest.test_pl_approval_creates_four_parallel_steps` |
| L-02 | PL 2명, 1명만 합의 | `peer-approve/` | `under_review` 유지, **R 미생성** | `views.py:1742` `_pl_stage_complete` | — |
| L-03 | PL 2명 전원 합의 | 2번째 `peer-approve/` | 다음 단계 생성 | 〃 | — |
| L-04 | PL 2명 중 1명 반려 | `peer-reject/` | 즉시 `status=rejected`(나머지 PL 대기 여부 무관) | `views.py:1769` | — |
| L-05 | PL 전원 합의, SA 미합의 | — | 다음 단계 **미생성**(SA 대기) | `views.py:1520` `_all_sales_agreers_approved` | — |
| L-06 | SA 전원 합의, PL 미합의 | — | 다음 단계 미생성 | `views.py:1531` | — |
| L-07 | PL·SA 모두 합의(마지막이 SA) | `sales-agree/` | 그 시점에 다음 단계 생성 | `views.py:1795` | — |
| L-08 | SA 1명 반려 | `sales-reject/` | **문서 즉시 반려**(PL 반려와 동일) | `views.py:1812` | — |
| L-09 | SA step 이 아예 없음 | PL 전원 합의 | `_all_sales_agreers_approved` 가 **True**(기다릴 대상 없음) | `views.py:1520` | — |
| L-10 | 제3자(다른 PL·타 역할)가 호출 | `peer-approve/` | 400/403 (MASTER 또는 본인 step 만) | `views.py:1479` `_get_caller_pl_step` | — |
| L-11 | PL 이 문서를 수정한 뒤 상신 | `peer-submit/` | 본인 step approved(comment 앞 `[수정 후 상신]`), 이후 L-01 과 동일 | `views.py:1837` | — |
| L-12 | 의뢰자 또는 MASTER | `change-designee/` | 현재 회차 **첫 pending PL step** 의 assignee 교체 + 새 PL 에게 도착 메일. ⚠️ 다중 PL 중 특정인 스왑은 미지원 | Case L | `PlSubmitMailTest.test_change_designee_sends_mail_to_new_pl_only` |

### 3.3 그룹 R — R(RFG) 단계와 병렬 전환

| ID | 전제 | 트리거 | 기대 결과 | 근거 | 기존 테스트 |
|---|---|---|---|---|---|
| R-01 | R pending, 미배정, TE_R 팀원 | `assign-step/`(agent=R) | 담당자 지정 성공. 검토자(RV)도 같은 요청에서 함께 지정 가능 | `views.py:1089`, `views.py:227` | — |
| R-02 | R 이 이미 배정됨 | `assign-step/` | 403 (미배정일 때만 지정 가능) | `views.py:227` | — |
| R-03 | agent=`PL`/`J`/`O`/`E`/`P` 로 지정 시도 | `assign-step/` | 거절(PL 은 화이트리스트 밖, claim 단계는 항상 403) | `views.py:237` | — |
| R-04 | RV 없음 + R 합의 | `approve-step/`(R) | 즉시 `_advance_to_parallel` → 병렬 단계 생성 | `views.py:946~955` | — |
| R-05 | RV 있음 + R 합의 | `approve-step/`(R) | 병렬 **미생성**, RV 에게 도착 메일, `under_review` 유지 | `views.py:948~953` | — |
| R-06 | RV 가 R 합의 전에 처리 시도 | `approve-step/`(RV) | 400 `담당자 합의가 먼저 필요합니다.` | `views.py:850~853` | — |
| R-07 | RV 합의 | `approve-step/`(RV) | 병렬 단계 생성 | `views.py:957~959` | — |
| R-08 | 일반 + plel 없음 | R(또는 RV) 합의 | **E step 미생성** | `views.py:1667` | `PEStageReviewerFlowTest.test_e_step_not_created_without_plel` |
| R-09 | 일반 + plel 있음 | 〃 | E step 생성(6영업일) | 〃 | `test_e_step_created_with_plel` |
| R-10 | 일반 + `Overlay 변경` 단독 | 〃 | **J step 미생성**, 검토항목 `fill_from_master` 도 건너뜀 | `views.py:1657` | `test_j_step_not_created_when_other_purpose_is_overlay_only` |
| R-11 | 일반 + `Overlay 변경` + 다른 기타목적 함께 | 〃 | J step **생성**됨 | 〃 | `test_j_step_created_when_overlay_selected_with_others` |
| R-12 | 일반 경로 | 〃 | P=4영업일, J·O·E=6영업일, RA=6영업일 | `views.py:1639~1671` | `test_j_due_date_matches_o_and_e` |
| R-13 | 일반 경로 | 〃 | J 도착 메일이 **이 시점**에 발송, 미배정이면 **TE_J 팀 전원** | `views.py:1661` | `test_j_stage_arrival_mail_sent_at_r_approval`, `test_j_unassigned_arrival_has_no_hardcoded_fallback_address` |
| R-14 | `Only MAP` + 후결자 1명 이상 | R 합의 | P/J/O/E 미생성, **RA 만 생성**, `under_review` | `views.py:1642` | `test_e_step_not_created_for_only_map` |
| R-15 | `Only MAP` + 후결자 0명(고정 미설정 + 비대상) | R 합의 | **즉시 `approved`** | `views.py:1643~1644` | — |
| R-16 | `MAP 삭제` | PL 합의 | P·R·J·O 4단계가 **동시에** pending(공통 6영업일), **E·RA 없음** | `views.py:1582` | `MapDeleteEditRouteTest.test_no_e_and_no_post_approver_steps` |

### 3.4 그룹 C — 검토중(claim) 선점

| ID | 전제 | 트리거 | 기대 결과 | 근거 | 기존 테스트 |
|---|---|---|---|---|---|
| C-01 | J/O/E/P pending + 미배정 + 같은 팀 | `claim-step/` | 호출자가 assignee 로 고정(취소·재클릭 불가) | `views.py:1215`, `244` | — |
| C-02 | 이미 선점된 단계 | `claim-step/` | **409** | Case K-2 | — |
| C-03 | 다른 팀 사용자 | `claim-step/` | 403 | `views.py:244` | — |
| C-04 | agent 가 `R`/`RA`/`PL` | `claim-step/` | 400(허용은 J·O·E·P 만) | `views.py:1226` | — |
| C-05 | 선점 완료 후 **같은 팀 다른 사람**이 합의 | `approve-step/` | 허용됨(팀 공동 합의). 표시 담당자명은 **선점자** 유지 | `views.py:209` `_can_act_on_step` | `test_p_reviewer_loginids_allowed_for_same_team_after_claim` |
| C-06 | 선점 전에 합의 시도 | `approve-step/` | 403 | 〃 | `test_p_reviewer_loginids_denied_before_claim` |

### 3.5 그룹 P/E — 담당자 + 검토자(PV/EV)

| ID | 전제 | 트리거 | 기대 결과 | 근거 | 기존 테스트 |
|---|---|---|---|---|---|
| PE-01 | P 선점 후 검토자 없이 합의 | `approve-step/`(P, `reviewer_loginids` 없음) | **허용** — P 단계 즉시 완료(선택 사항) | `views.py:893` | `test_p_approve_without_reviewer_still_allowed`, `test_p_no_reviewers_completes_stage_immediately_backward_compat` |
| PE-02 | P 합의 + PV 2명 지정 | 〃(배열 2개) | 요청 **한 번**으로 PV step 2개 생성 + P approved | `views.py:1195` `_create_reviewers` | `test_all_designated_reviewers_are_created` |
| PE-03 | PV 1명만 합의 | `approve-step/`(PV) | P 단계 **미완료** → 최종 승인 안 됨 | `views.py:1548` `_stage_reviewers_complete` | `test_p_stage_completes_only_after_owner_and_all_reviewers_approve`, `test_general_route_not_approved_while_p_reviewer_pending` |
| PE-04 | PV 가 P 합의 전에 처리 | `approve-step/`(PV) | 400 `담당자 합의가 먼저 필요합니다.` | `views.py:856~860` | `test_p_reviewer_cannot_act_before_owner_approves` |
| PE-05 | 담당자가 자신을 검토자로 지정 | `approve-step/` | 400 | `views.py:1155` `_validate_reviewers` | `test_p_reviewer_self_designation_rejected` |
| PE-06 | 타 팀 사람을 검토자로 지정 | 〃 | 400 | 〃 | `test_p_reviewer_loginids_denied_for_other_team` |
| PE-07 | PV 가 반려 | `reject-step/`(PV) | 문서 즉시 `rejected` | `views.py:1016` | `test_p_reviewer_rejection_rejects_whole_document` |
| PE-08 | **E 합의에 검토자 미지정** | `approve-step/`(E, 빈 배열/누락) | **400** `2차 검토자를 1명 이상 지정해야 합니다.` + **아무 쓰기도 발생하지 않음** | `views.py:871~885` | `test_e_approve_without_reviewer_is_rejected`, `test_e_approve_with_empty_reviewer_list_is_rejected` |
| PE-09 | E 합의 + EV 지정 | 〃 | E approved + EV step 생성 | 〃 | `test_e_approve_with_reviewer_succeeds` |
| PE-10 | EV 2명 중 1명만 합의 | `approve-step/`(EV) | E 단계 미완료, 남은 EV 는 **pending 유지**(`skip` 자동 처리 없음) | `views.py:926~928`, `1548` | `test_ev_all_reviewers_required_to_complete_e_stage`, `test_ev_remaining_step_stays_pending_after_one_approves` |
| PE-11 | 레거시: 검토자 없이 E 가 이미 approved | 나머지 단계 합의 | 하위호환 분기로 **최종 승인까지 진행** | `views.py:1566~1567` | `test_legacy_e_approved_without_reviewer_still_completes` |
| PE-12 | 레거시: EV step 이 살아 있는 상태에서 E 재합의 | `approve-step/`(E, 검토자 없이) | **통과**(살아있는 EV 를 지정으로 간주) | `views.py:878~881` | `test_e_approve_passes_when_legacy_ev_step_exists` |
| PE-13 | E/EV 에 기존 comment(수정요청·Validation 변경 이력) 존재 | `approve-step/`(E) | 기존 comment 를 **덮어쓰지 않고 덧붙임** | `views.py:907~912` | `test_e_approval_preserves_revision_request_history`, `test_e_approval_appends_comment_to_existing_history` |
| PE-14 | P 단계 완료(담당자+PV 전원) | 〃 | TE_O·TE_J 에 완료 통보 1회 | `views.py:1570` | `test_p_completion_notifies_te_o_and_te_j` |

### 3.6 그룹 F — 최종 승인 판정 (**A12: 마지막 합의자가 누구냐**로 갈리는 축)

이 그룹이 이 문서의 핵심이다. 판정은 `approve_step` 안에서만 돌고, **트리거 agent 목록**과
**판정 조건**이 따로 있어 둘 중 하나만 빠져도 문서가 `under_review` 에 영구 정지하거나
미완료 단계를 남긴 채 승인된다.

| ID | 경로 | 마지막 합의 단계 | 기대 결과 | 근거 | 기존 테스트 |
|---|---|---|---|---|---|
| F-01 | RT-1 | J | approved | `views.py:961~1001` | — |
| F-02 | RT-1 | O | approved | 〃 | — |
| F-03 | RT-1 | EV(마지막 검토자) | approved | 〃 | `test_e_reviewer_gate_blocks_final_approval_until_all_agree` |
| F-04 | RT-1 | RA | approved | 〃 | — |
| F-05 | RT-1 | **P**(또는 PV) | approved — J 분리 이후 P 가 마지막일 수 있다 | `views.py:961~968` | `test_general_route_approved_when_p_is_last` |
| F-06 | RT-1 | P 미완료인데 J·O·E·RA 완료 | **approved 아님**(`under_review`) | `views.py:995` `p_ok` | `test_general_route_not_approved_while_p_pending` |
| F-07 | RT-1 | J 를 P 보다 먼저 합의 | 순서 무관, 정상 진행 | 〃 | `test_j_can_be_approved_before_p` |
| F-08 | RT-3/RT-4 (J 없음) | 나머지 전부 | approved (`j_approved=True` 고정) | `views.py:987~990` | `test_overlay_only_document_approved_without_j` |
| F-09 | RT-2 (E 없음) | 나머지 전부 | approved (`e_ok = not e_exists`) | `views.py:997` | — |
| F-10 | RT-5 (`Only MAP`) | RA 전원 | approved. **RA step 이 0개면 승인되지 않는다**(`len(ra_steps) > 0` 필요) | `views.py:980~982` | — |
| F-11 | RT-6 (`MAP 삭제`) | P 가 마지막 | approved | `views.py:933~944`, `1609` | `MapDeleteEditRouteTest.test_approved_when_p_is_last` |
| F-12 | RT-6 | R 이 마지막 | approved | 〃 | `test_approved_when_r_is_last` |
| F-13 | RT-6 | P 의 PV 미합의 | approved 아님 | `views.py:1621` | `test_p_reviewer_blocks_final_approval` |
| F-14 | 추가 후결자 여러 명 | 일부만 합의 | approved 아님(RA 전원 필요) | `views.py:978` | — |
| F-15 | 승인 확정 시 | — | `enqueue_approved` + `enqueue_notify_approved` 2종 발송, 수신자는 **현재 회차 참여자 전원** | `views.py:1005~1007` | `RecipientResolutionTest.test_approved_recipients_are_current_round_participants` |

### 3.7 그룹 X — 반려와 재상신

| ID | 전제 | 트리거 | 기대 결과 | 근거 | 기존 테스트 |
|---|---|---|---|---|---|
| X-01 | 어느 단계든 | `reject-step/` | 해당 step `rejected` + 문서 즉시 `rejected` | `views.py:1016` | — |
| X-02 | 반려 후 잔여 pending step | `approve-step/`/`claim-step/` 등 | **400**(진행 차단) — 반려 문서가 되살아나지 않는다 | `views.py:173` | — |
| X-03 | 반려 메일 | `reject-step/` | 작성자 + 현재 회차 기합의자 + **미합의 단계 담당 팀 전원**(반려자 제외) | `mailer` §3.1 | `test_reject_recipients_r_reject_covers_whole_remaining_line`, `test_reject_recipients_j_reject_includes_pending_parallel_team` |
| X-04 | `Only MAP` 문서 반려 | 〃 | 경로에 없는 단계(P/J/O/E)는 수신자에서 제외 | 〃 | `test_reject_recipients_only_map_excludes_stages_not_on_route` |
| X-05 | `rejected` 문서 | `resubmit/` | `under_review` + **max(round)+1** 로 PL step 신규 생성, 이전 회차는 이력 보존 | Case I | `test_resubmit_pl_mail_subject_has_name_prefix` |
| X-06 | 재상신 회차 | 〃 | SA step 도 새 회차에 다시 생성 | `views.py:458` | — |
| X-07 | 재상신 시 경로 판정 | 〃 | `skip_j_stage()` 등 판정은 **단계 생성 시점** — 새 회차부터 새 규칙 적용 | Case G 주석 | — |
| X-08 | 이전 회차의 잔여 pending step | 목록 필터 | '내 차례'·단계 탭에 **잡히지 않는다**(현재 회차 + `under_review` 만) | `hasActivePendingStep` (`frontend/src/utils/approvalTable.ts`) | `approvalTable.test.ts` |
| X-09 | `E` 단계 반려 | `reject-step/`(E) | ⚠️ E 는 '수정 요청'으로 동작(일반 반려와 다름) — 실제 코드로 확인할 것 | `views.py:1016` | `test_e_reject_becomes_revision_request`, `test_non_mask_reject_still_rejects_document` |

### 3.8 그룹 M — 중단(PAUSE)

| ID | 전제 | 트리거 | 기대 결과 | 근거 | 기존 테스트 |
|---|---|---|---|---|---|
| M-01 | 작성자 + `under_review` + 사유 입력 | `request-pause/` | `PauseRequest(requested)` 생성, 상태 뱃지는 그대로, 목록에 '중단 요청중' 칩 | `views.py:1258` | — |
| M-02 | 사유 없음 | 〃 | 400 | 〃 | — |
| M-03 | 병렬 단계 중 일부만 확인 | `confirm-pause/` | `under_review` 유지(target 전원 확인 필요) | `views.py:1298` | — |
| M-04 | target 전원 확인 | 〃 | `status=pause` | 〃 | — |
| M-05 | `pause` 상태 | `approve-step/` 등 | **400**(결재 동결) | `views.py:173` | — |
| M-06 | 작성자 + `pause` | `resume/` | `under_review` 복귀, **멈춘 단계 그대로**(회차 신규 생성 없음) | `views.py:1348` | — |
| M-07 | 재개 | 〃 | pending 단계 `due_date` 가 **멈춘 달력일수만큼** 뒤로 밀림 | 〃 | — |
| M-08 | 요청중 상태에서 결재가 진행됨 | `approve-step/` | 기존 중단 요청 자동 `cancelled` | `views.py:283` `_cancel_active_pause_requests` | — |
| M-09 | `pause` 문서 | `withdraw/` | 400 — 재개 후 철회 | Case J 표 | `WithdrawFlowTest.test_paused_document_cannot_be_withdrawn` |

### 3.9 그룹 W — 철회 (⚠️ 문서 **삭제**)

| ID | 전제 | 트리거 | 기대 결과 | 근거 | 기존 테스트 |
|---|---|---|---|---|---|
| W-01 | `draft` | `withdraw/` | 확인 없이 **즉시 삭제**, `deleted=true` | Case J | `test_draft_is_deleted_immediately` |
| W-02 | `rejected` | 〃 | 즉시 삭제 | 〃 | `test_rejected_is_deleted_immediately` |
| W-03 | `approved` | 〃 | **MASTER 만** 삭제, 그 외 403 | 〃 | `test_approved_is_master_only` |
| W-04 | `under_review` + 사유 | 〃 | 철회 **요청** 생성(삭제 아님), `target_step_ids` 기록 | 〃 | `test_request_creates_pending_withdraw_and_mails_target_only` |
| W-05 | 사유 없이 진행 중 문서 | 〃 | 400 | 〃 | `test_reason_required_for_in_progress_document` |
| W-06 | 활성 요청이 이미 있음 | 〃 | 400(문서당 1건) | 〃 | `test_duplicate_request_is_blocked` |
| W-07 | 병렬 target 중 일부만 확인 | `confirm-withdraw/` | 문서 유지 | 〃 | `test_partial_confirm_keeps_document` |
| W-08 | target 전원 확인 | 〃 | 완료 메일 적재 후 **문서 삭제**(ApprovalStep CASCADE) | 〃 | `test_all_confirm_deletes_document_and_mails_completed` |
| W-09 | 미배정 단계 | 〃 | 같은 팀 누구나 1명이 확인 가능 | `views.py:260` `_can_confirm_pause` | `test_unassigned_step_can_be_confirmed_by_team_member` |
| W-10 | 다른 팀 | 〃 | 403 | 〃 | `test_other_team_cannot_confirm` |
| W-11 | 단계 하나가 거부 | `reject-withdraw/` | 요청 전체 무효화, 결재 계속 | Case J | `test_target_step_can_reject_withdraw` |
| W-12 | 요청자 본인 | `cancel-withdraw/` | 요청 취소 | 〃 | `test_requester_can_cancel_before_confirm` |
| W-13 | 요청자가 아닌 사람 | 〃 | 403 | 〃 | `test_non_requester_cannot_cancel` |
| W-14 | 확인 대기 중 | `approve-step/` | 400(결재 동결) | `views.py:173` | `test_approval_is_frozen_while_withdraw_pending` |
| W-15 | 거부·취소 후 | 〃 | 결재 재개 가능 | 〃 | `test_approval_resumes_after_reject` |

### 3.10 그룹 A — 인가(권한) 가드

| ID | 케이스 | 기대 결과 | 근거 | 기존 테스트 |
|---|---|---|---|---|
| A-01 | 담당자가 아닌 사용자의 `approve-step/` | 403 | `views.py:209` | — |
| A-02 | MASTER 는 모든 단계 처리 가능 | 200 | `views.py:209`, `827~838` | — |
| A-03 | `RA`/`PV`/`EV` 합의는 **본인 assignee step 만** 조회 | 타인 step 처리 불가 | `views.py:827~838` | — |
| A-04 | `J`/`O`/`E`/`P` 는 assignee 필터 없이 조회 후 `_can_act_on_step` 로 인가 | 같은 팀 공동 합의 | `views.py:839~847` | — |
| A-05 | 후결자 추가/제거 권한 | 작성자(FK 없으면 이메일 폴백) 또는 MASTER, 병렬 진입 후 | `views.py:1985` | `PostApproverManagementTest.*` |
| A-06 | 고정 후결자 제거 시도 | 400(항상 제외) | 〃 | `test_remove_post_approver_rejects_fixed_loginid` |
| A-07 | 이미 합의한 RA 제거 | 400 | 〃 | `test_remove_post_approver_denied_after_approved` |
| A-08 | `Only MAP` 문서에서 후결자 총원 0 만들기 | 400 | 〃 | — |
| A-09 | `requires_post_approver()` 대상에서 추가 후결자 0 만들기 | 400 | 〃 | `test_lab_product_last_additional_post_approver_cannot_be_removed`, `test_remove_post_approver_blocks_last_additional_for_c_family` |
| A-10 | 일반 문서에서 추가 후결자 0 만들기 | 허용 | 〃 | `test_remove_post_approver_allows_zero_for_normal_doc` |

### 3.11 그룹 N — 동시성

| ID | 케이스 | 기대 결과 | 근거 |
|---|---|---|---|
| N-01 | 마지막 병렬 합의 2건이 거의 동시 | 문서 행 `select_for_update` 로 직렬화, `approved` 전이 누락 없음 | `views.py:816` |
| N-02 | PL 2명이 동시에 마지막 합의 | R 단계 **중복/누락 없음** | `views.py:1735~1744`, `1722` |
| N-03 | `MAP 삭제` 병렬 생성이 두 번 호출 | 이미 존재하면 재생성하지 않음 | `views.py:1593~1596` |
| N-04 | 합의와 반려가 동시 | 직렬화되어 한쪽만 반영 | `views.py:1026` |

---

## 4. 케이스 총수 (검증자가 채워야 할 표의 크기)

```
§3 케이스 합계
 S(14) + L(12) + R(16) + C(6) + PE(14) + F(15) + X(9) + M(9) + W(15) + A(10) + N(4) = 124 케이스
```
이 124건은 §2 의 24가지 골격 조합을 **동작이 갈리는 지점만 남겨 압축**한 것이다.
검증자는 **124건 전부에 PASS / FAIL / UNVERIFIED 중 하나를 붙여야 한다**(§6).

---

## 5. 검증 절차 (반드시 이 순서)

### 5-1. 사전 읽기
1. `CLAUDE.md`(프로젝트 규칙 — 특히 규칙 C·K·H)
2. `docs/APPROVAL.md` 전체
3. `backend/api/views.py` 의 `RequestDocumentViewSet`, `backend/api/models.py` 의 `RequestDocument`/`ApprovalStep`

### 5-2. 테스트 환경 구성 및 전체 테스트 실행 (Docker·MySQL 없이도 된다)
"환경이 없어서 못 돌렸다"로 넘어가지 않는다. 아래를 **실제로 실행**하고 출력 원문을 보고에 붙인다.

```bash
SP=/tmp/e2e
mkdir -p $SP/stubs && python3 -m venv $SP/venv

$SP/venv/bin/pip install -q \
  Django==4.2.13 djangorestframework==3.15.1 django-cors-headers==4.3.1 \
  djangorestframework-simplejwt==5.3.1 Pillow==10.3.0 python-dotenv==1.0.1 \
  django-filter==24.2 django-apscheduler==0.6.2 pandas==2.2.2 sqlalchemy==2.0.30 \
  requests==2.31.0 pymysql==1.1.1 mozilla-django-oidc PyJWT

cat > $SP/stubs/datacenterquery.py <<'EOF'
def login(*a, **k):   raise RuntimeError('stub: 테스트에서 호출되면 안 된다')
def getData(*a, **k): raise RuntimeError('stub: 테스트에서 호출되면 안 된다')
EOF

cat > $SP/stubs/test_settings.py <<'EOF'
from config.settings.base import *
DEBUG = True
DATABASES = {'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'}}
EOF

cd backend && PYTHONPATH=$SP/stubs DJANGO_SETTINGS_MODULE=test_settings \
  $SP/venv/bin/python manage.py test api
```
- `staticfiles.W004` 경고 1건은 무해하다.
- 개별 테스트 실행 예:
  `... manage.py test api.tests.PEStageReviewerFlowTest.test_general_route_approved_when_p_is_last`
- 배경·원본 절차는 `docs/E2E_TEST_AND_BUGS.md` §1.4.1.

### 5-3. 케이스별 검증 방법
각 케이스는 **아래 3단계를 모두** 거친다.

1. **코드 대조** — '근거' 열의 파일:라인을 직접 읽고, 기대 결과와 일치하는지 판정한다.
   라인 번호는 이 문서 작성 시점 기준이므로 어긋나면 **함수명으로 다시 찾는다**.
2. **기존 테스트 실행** — '기존 테스트' 열이 채워져 있으면 그 테스트를 실제로 돌려 통과를 확인하고,
   **출력 원문**을 근거로 남긴다.
3. **재현 테스트 작성**(기존 테스트가 없는 케이스) — 임시 재현 테스트는 **프로젝트 밖**
   `$SP/stubs/verify_xxx.py` 에 두고 `manage.py test verify_xxx` 로 실행한다.
   `backend/api/tests.py` 를 오염시키지 않는다.

> **확인하지 않은 것을 단정하지 않는다.** "안 된다 / 없다 / 불가능하다" 는 직접 실행해 확인한 뒤에만
> 쓴다. 확인 못 한 것은 `UNVERIFIED` 로 두고 **무엇을 시도했고 어디서 막혔는지** 적는다.

### 5-4. 프론트 검증(선택)
그리드·필터 표시 케이스(X-08 등)는 `frontend/src/utils/approvalTable.ts` 와 `approvalTable.test.ts`,
타입 체크로 확인한다.
```bash
cd frontend && npm test -- --watchAll=false --passWithNoTests
cd frontend && npx tsc --noEmit 2>&1 | grep -c "error TS"
```

### 5-5. 화면 수동 검증 시나리오 (자동 테스트로 덮이지 않는 부분)
`http://localhost:10011` 기준. 역할별 계정으로 각각 확인한다.

1. **일반 경로 정상 흐름(RT-1)**
   PL 로그인 → `/request` 에서 의뢰서 작성(J-layer `pp` 에 `plel` 포함) → 상신 모달에서 동료 PL 2명·통보처 지정 → 상신
   → **기대**: `/approval` 목록에 문서가 뜨고 현재 단계가 `검토(이름1 / 이름2)`.
   → 동료 PL 1명만 합의 → **기대**: 여전히 `검토(남은 이름)`, RFG 로 넘어가지 않음.
   → 나머지 PL 합의 → **기대**: 현재 단계가 `RFG(...)` 로 바뀜.
   → TE_R 로그인 → 행 클릭 → '담당자 지정'(검토자 없음) → '합의'
   → **기대**: 현재 단계 칸이 **3행 2열 그리드**로 바뀌고 PHPSI/JOB/OVL/MASK/후결자 칸이 보인다.
2. **검토중 선점 경쟁(C-02)**
   TE_J 두 계정으로 같은 문서의 '검토중' 버튼을 연달아 클릭 → **기대**: 두 번째는 실패(이미 배정),
   검토중 버튼은 선점 즉시 사라진다.
3. **E 검토자 필수(PE-08)**
   TE_E 로그인 → MASK 단계 '검토중' → 검토자 드롭다운을 **비운 채** '합의' 클릭
   → **기대**: `2차 검토자를 1명 이상 지정해야 합니다.` 오류 토스트, 단계는 여전히 검토중.
   (실패 신호: 오류가 떴는데도 새로고침 후 MASK 가 '완료'로 바뀌어 있으면 부분 커밋 버그다.)
4. **반려 후 잔여 단계 차단(X-02)**
   TE_O 가 반려 → 다른 병렬 단계 담당자(TE_J)로 로그인 → 그 문서의 합의 버튼 클릭 시도
   → **기대**: 400 오류 안내. 문서 상태 뱃지는 `반려` 유지(다시 검토중으로 돌아가면 버그).
5. **중단 → 재개(M-05~M-07)**
   작성자 → '중단 요청'(사유 입력) → 현재 단계 담당자 전원 '중단 확인'
   → **기대**: 상태 `중단`, 목록 '최종 완료예정' 칸이 회색 `중단`, 6칸이 전부 `PAUSE`.
   → 작성자 `/request` 편집 후 '재개' → **기대**: 멈췄던 단계 그대로 재개되고 기한이 뒤로 밀린다.
6. **철회 확정(W-08)** ⚠️ 문서가 삭제되므로 **테스트 문서로만** 수행한다.
   진행 중 문서에서 '철회'(사유) → 현재 단계 전원 '철회 확인'
   → **기대**: 목록에서 문서가 사라진다(복구 불가).
7. **결재 경로 탭 표시**
   상세 모달 → '결재 경로' 탭 → **기대**: 경로에 없는 단계(plel 없으면 MASK, `Overlay 변경` 단독이면 JOB,
   `MAP 삭제` 면 후결자)가 `대기`가 아니라 **`해당없음`** 으로 보인다.

---

## 6. 보고 형식 (검증자가 제출할 결과물)

### 6-1. 케이스 결과표 (124행 전부)
| ID | 판정 | 근거(실행 출력 / 코드 인용) | 비고 |
|---|---|---|---|
| S-01 | PASS / FAIL / UNVERIFIED | `test_... ok` 또는 `views.py:395` 인용 | |

- **PASS**: 코드 대조 + 실행으로 기대 동작을 확인함.
- **FAIL**: 기대와 다른 동작을 **실행 출력으로 확인**함. → §6-3 형식으로 별도 보고.
- **UNVERIFIED**: 확인하지 못함. **무엇을 시도했고 어떤 에러로 막혔는지** 반드시 함께 적는다.

### 6-2. 실행 요약
- 전체 테스트 실행 명령과 결과 원문(`Ran N tests ... OK/FAILED`).
- 새로 작성한 재현 테스트 파일 경로와 그 출력.

### 6-3. 발견 보고 (FAIL 또는 문서·코드 불일치)
**발견해도 고치지 않는다.** 아래 형식으로 보고하고 사용자의 결정을 기다린다(프로젝트 규칙 K).
```
🛑 발견 보고
발견: [무엇이 잘못됐는지 한 문장]
위치: [파일:라인]
근거: [코드 인용 / 실행 출력 원문]
영향: [고치지 않으면 실제로 무슨 일이 생기는지]
선택지: 1) 지금 고친다 — 범위: …  2) 다르게 고친다 — …  3) 지금은 기록만 남긴다
추천: [하나만, 이유 한 줄]
어떻게 할까요?
```

---

## 7. 검증 시 빠지기 쉬운 함정

1. **회차(round)를 안 본다** — 모든 판정은 `max(round)` 기준이다. 재상신 문서의 이전 회차 pending step을
   현재 단계로 착각하지 말 것(`views.py:305` `_max_round`).
2. **트리거와 조건을 혼동한다** — 최종 승인은 `agent in ('P','PV','J','O','E','EV','RA')` 합의에서만 판정된다.
   `R`·`RV` 합의는 병렬 전환만 하고, `MAP 삭제` 경로는 **별도 분기**(`views.py:933`)로 판정한다.
3. **"없으면 True" 규칙** — `SA 없음`, `E 없음`, `RA 없음`, `검토자 없음`, `J 없음(skip)` 은 모두
   "기다릴 대상이 없다 = 통과"다. 단 **`Only MAP` 의 RA 만은 예외로 `len(ra_steps) > 0` 을 요구**한다
   (`views.py:982`). 이 비대칭을 확인 없이 같다고 적지 말 것.
4. **반려는 pending step 을 지우지 않는다** — 잔여 pending 은 이력으로 남는 게 설계다. 상태 가드로 막는다.
5. **철회는 되돌릴 수 없다** — 확인 완료 = 문서 삭제. 검증 시 실 데이터로 시도하지 말 것.
6. **E 의 400 은 쓰기 이전에 나야 한다** — `@transaction.atomic` 은 예외에만 롤백하므로, 쓰기 후 400을
   반환하면 부분 커밋이 남는다. PE-08 검증 시 **응답 코드뿐 아니라 DB 상태까지** 확인한다.
7. **라인 번호는 흔들린다** — 이 문서의 `views.py:NNN` 은 작성 시점 기준이다. 어긋나면 함수명으로 찾는다.

---

## 8. 검증자가 반드시 확인할 문서·코드 불일치 의심 항목

아래는 이 문서를 만들며 발견한 것이다. **판단하지 말고 사실 확인만 하고 §6-3 형식으로 보고**한다.

1. **`MAP 삭제` 목적 문자열** — 코드는 `MAP_DELETE_EDIT_PURPOSE = 'MAP 삭제'`(`models.py:91`, 주석에
   "2026-08 '수정'이 빠지면서 저장값이 예전 `'MAP 삭제/수정'` 에서 바뀌었다"고 적혀 있다). 반면
   `docs/APPROVAL.md` Case O 본문은 값이 `'MAP 삭제/수정'` 이라고 서술한다. **어느 쪽이 현행인지**
   프론트 `frontend/src/pages/RequestPage/constants.ts` 의 `MAP_DELETE_EDIT_PURPOSE` 와 함께 확인한다.
   (구버전 문서가 DB에 `'MAP 삭제/수정'` 로 저장돼 있다면 그 문서들이 어느 경로를 타는지도 확인 대상이다.)
2. **S-07 `_validate_bb_mapping` 의 JSON 파싱 실패 통과** — `docs/APPROVAL.md` Case A 가 스스로
   "의도 확인 필요"로 표시한 항목이다. 현재도 그대로인지 확인한다.
3. **L-12 `change_designee` 의 다중 PL 미대응** — 첫 pending PL step 만 교체된다고 서술돼 있다.
   다중 PL 문서에서 실제로 어떤 step 이 바뀌는지 확인한다.
4. **E 단계 반려의 의미(X-09)** — 테스트명이 `test_e_reject_becomes_revision_request` 로,
   다른 단계의 반려와 동작이 다를 수 있다. `reject_step` 의 E 분기를 읽고 §3.7 X-01 서술과
   충돌하는지 확인한다.

---

## 9. 이 문서를 넘겨받은 AI 에게 (요약 지시)

1. `CLAUDE.md` → `docs/APPROVAL.md` → 이 문서 순으로 읽는다.
2. §5-2 로 테스트 환경을 만들고 **전체 테스트를 먼저 돌려** 기준선을 확보한다.
3. §3 의 124 케이스를 **전부** §5-3 3단계로 검증한다. 건너뛴 것은 `UNVERIFIED` 로 남기고 이유를 적는다.
4. 결과는 §6 형식으로 제출한다. 실행 출력 원문을 반드시 첨부한다.
5. **버그를 발견해도 고치지 않는다.** §6-3 형식으로 보고하고 사용자의 결정을 기다린다.
6. 이 문서와 코드가 다르면 **코드가 사실**이다. 문서를 고치는 것도 사용자 승인 후에 한다.
