# APPROVAL_CASES_VALIDATION — 제품담당자 상신 시 결재 경우의 수 · 전수 목록 + 검증 지시서

> 작성일: 2026-08-13 (2026-08-14 보강: 전수 열거·개발환경 러너 연동·코드 대조 결과 반영)
> 대상 독자: **이 저장소를 처음 보는 다른 AI(검증자)**
> 목적: 제품담당자(PL)가 의뢰서를 상신했을 때 나올 수 있는 **경우의 수를 빠짐없이 적어 두고**,
> 그것을 **개발환경에서 그대로 실행**해 구현과 일치하는지 확인하게 한다.
>
> 기준 문서 `docs/APPROVAL.md` / 기준 코드 `backend/api/views.py`·`backend/api/models.py`
> 실행 도구 **`scripts/approval_cases/`** (개발환경 HTTP 러너, 실제 DB 값으로 상신)
>
> ⚠️ 여기 적힌 "기대 동작"은 코드와 문서를 대조해 정리한 것이다. 검증자는 각 케이스를
> **실행 결과로** 확인하고, 어긋나면 **고치지 말고 §9 형식으로 보고**한다(프로젝트 규칙 K).

---

## 0. 전제와 용어

| 용어 | 뜻 |
|---|---|
| **제품담당자** | `UserProfile.role == 'PL'`. 의뢰서를 **작성·상신**하고, 결재선에서는 `PL`(검토)·`SA`(영업/기술지원 합의자)·`RA`(추가 후결자)로 참여한다. 상신 모달의 동료 PL·후결자·통보처 후보는 모두 PL 만 노출된다. |
| **TE_\*** | 검토·합의를 맡는 실무 팀. `TE_R`→`R`/`RV`/`RA`(고정), `TE_P`→`P`/`PV`, `TE_J`→`J`, `TE_O`→`O`, `TE_E`→`E`/`EV`. (`models.py:28`, `models.py:260`) |
| **MASTER** | 모든 단계를 대신 처리할 수 있는 관리자. 모든 권한 케이스의 예외 축이다. |
| **단계(step)** | `ApprovalStep` 1행 = 결재선 1칸이자 이력. `round`(회차)로 재상신을 구분하고 화면은 항상 `max(round)`만 본다. |
| **claim(검토중)** | `J·O·E·P` 는 지정이 아니라 팀원이 스스로 선점한다(`views.py:202` `_CLAIM_AGENTS`). |
| **검토자** | `RV`(R) / `PV`(P) / `EV`(E). 담당자 합의 **후에만** 처리 가능(순차 가드). |

**결재 진행의 대전제** — 결재 액션(`approve_step`/`reject_step`/`assign_step`/`claim_step`)은
`status == 'under_review'` 인 문서에서만 가능하다. `pause`, 철회 요청 확인 대기, 이미 종료된 문서
(`approved`/`rejected`)는 400 으로 막힌다(`views.py:173` `_blocked_progress_response`).

---

## 1. 경우의 수를 만드는 변수(축)

| # | 축 | 값 | 판정 위치 | 결재선에 미치는 영향 |
|---|---|---|---|---|
| A1 | 요청 목적 | 일반(신규/차용/신규+차용/기타) / `Only MAP` / `MAP 삭제` | `models.py:158` `is_only_map()`, `models.py:167` `is_map_delete_edit()` | 경로 자체가 갈린다 |
| A2 | 기타 목적 `Overlay 변경` **단독** | 예 / 아니오 | `models.py` `skip_j_stage()` | 일반 경로에서 **J 미생성** |
| A3 | J-layer `pp` 에 `plel` | 있음 / 없음 | `has_ppid_plel()` (`VALIDATION_KEYWORD='plel'`) | **E(MASK) 생성 여부** |
| A4 | 지정 PL 수 | 1명 / 2명 이상 | `views.py:1684` `_resolve_designated_pls` | PL step N개, **전원 합의** |
| A5 | 영업/기술지원 합의자(SA) | 0명 / N명 (+필수 여부) | `requires_sales_agreer()`, `views.py:350` | PL 과 **병렬**, 전원 합의해야 다음 |
| A6 | R 검토자(RV) | 없음 / 1명 | `assign_step`(`views.py:1089`) | R 합의 후 RV 까지 기다림 |
| A7 | P 검토자(PV) | 0명 / N명(**선택**) | `approve_step` `reviewer_loginids` | P 완료 = 담당자 + PV 전원(AND) |
| A8 | E 검토자(EV) | **1명 이상 필수** | `views.py:871~885` | 비어 있으면 **400** |
| A9 | 후결자(RA) | 고정 1명(`POST_APPROVER_LOGINID`) + 추가 0~N | `views.py:1540` | 병렬 종단 경로 |
| A10 | 추가 후결자 필수 | C가문(`only_prodc=Yes`) 또는 `연구소 제품` | `models.py:177` `requires_post_approver()` | 상신 시 1명 이상 필수 |
| A11 | 진행 중 이벤트 | 없음 / 중단(pause) / 철회 요청 | Case M / Case J | 결재 **동결** 또는 문서 삭제 |
| A12 | 종단 트리거 | 마지막 합의 단계가 무엇인가 | `views.py:961~1001`, `933~944` | 트리거 누락 시 문서 **영구 정지** |
| A13 | 반려 주체 | PL / SA / R·RV / P·PV / J / O / **E·EV(예외)** / RA | `reject_step`, `peer_reject`, `sales_reject` | E·EV 만 '수정 요청'이라 상태를 바꾸지 않는다 |

---

## 2. 경우의 수 전수 열거

### 2.1 결재선 골격 6종

| ID | 조건 | 결재선 | 종단 조건 |
|---|---|---|---|
| **RT-1** | 일반 + J 있음 + E 있음(plel) | `PL(+SA) → R(+RV) → P(+PV) ∥ J ∥ O ∥ E(+EV) ∥ RA` | P·J·O·E·RA 전부 |
| **RT-2** | 일반 + J 있음 + E 없음 | `PL(+SA) → R(+RV) → P(+PV) ∥ J ∥ O ∥ RA` | P·J·O·RA |
| **RT-3** | 일반 + `Overlay 변경` 단독 + E 있음 | `PL(+SA) → R(+RV) → P(+PV) ∥ O ∥ E(+EV) ∥ RA` | P·O·E·RA (`j_approved` 고정 True) |
| **RT-4** | 일반 + `Overlay 변경` 단독 + E 없음 | `PL(+SA) → R(+RV) → P(+PV) ∥ O ∥ RA` | P·O·RA |
| **RT-5** | `Only MAP` | `PL(+SA) → R(+RV) → RA` | RA 전원(**0명이면 R 합의 즉시 approved**) |
| **RT-6** | `MAP 삭제` | `PL(+SA) → P(+PV) ∥ R(+RV) ∥ J ∥ O` | 네 단계 전부. **E·RA 없음** |

근거: `views.py:1625` `_advance_to_parallel`, `views.py:1582` `_create_map_delete_edit_parallel`,
`views.py:1715` `_open_stage_after_pl`.

### 2.2 상신 시점에 확정되는 조합 24가지 (골격 × SA × 지정 PL 수)

| ID | 골격 | SA | 지정 PL | 상신 직후 만들어지는 step | 러너 |
|---|---|---|---|---|---|
| RC-01 | RT-1 | 없음 | 1명 | `PL×1` | S-01 |
| RC-02 | RT-1 | 없음 | 2명 | `PL×2` | S-02 |
| RC-03 | RT-1 | 있음 | 1명 | `PL×1 + SA×N` | S-11 |
| RC-04 | RT-1 | 있음 | 2명 | `PL×2 + SA×N` | S-11/S-02 조합 |
| RC-05~08 | RT-2 | 위 4조합과 동일 | | | R-08 |
| RC-09~12 | RT-3 | 〃 | | | R-10 + R-09 |
| RC-13~16 | RT-4 | 〃 | | | R-10 |
| RC-17~20 | RT-5 | 〃 | | | R-14 |
| RC-21~24 | RT-6 | 〃 | | | R-16 |

> SA·지정 PL 수는 **PL 단계 내부 조합**이라 골격마다 같은 방식으로 되풀이된다. 그래서
> 러너는 조합 24개를 전부 돌리지 않고 **골격 6종 × PL 단계 조합(§3.2 L 그룹)** 으로 나눠 검증한다.
> 조합을 개별로 보고 싶으면 `--case` 로 해당 케이스를 조합해 실행한다.

### 2.3 종단(최종 승인) 순열 — "누가 마지막이냐" 21가지

병렬 단계는 순서가 없으므로, **마지막 합의자가 누구인지**가 판정 트리거를 결정한다.

| 골격 | 병렬 구성원 | 마지막이 될 수 있는 단계 | 경우 수 | 러너 |
|---|---|---|---|---|
| RT-1 | P(+PV)·J·O·E(+EV)·RA | P / PV / J / O / E·EV / RA | 5 | F-01~F-05 |
| RT-2 | P·J·O·RA | P / J / O / RA | 4 | F-09, F-07 |
| RT-3 | P·O·E·RA | P / O / E / RA | 4 | F-08 |
| RT-4 | P·O·RA | P / O / RA | 3 | F-08(E 제외형) |
| RT-5 | RA | RA | 1 | F-10 |
| RT-6 | P·R·J·O | P / R / J / O | 4 | F-11, F-12 |
| | | **합계** | **21** | |

**미완료 상태에서 승인되면 안 되는 조합**(음성 케이스): 각 골격마다 "한 단계만 남겨 두고 전부 합의"
→ `under_review` 유지여야 한다. 러너 F-06(P 미완료)·PE-03(PV 미완료)·F-13(MAP 삭제 PV)·F-14(RA 일부).

### 2.4 반려 지점 열거 — 8가지 + 예외 1

| 반려 주체 | API | 결과 | 러너 |
|---|---|---|---|
| PL(지정 PL 중 1명) | `peer-reject/` | 즉시 `rejected` | L-04 |
| SA | `sales-reject/` | 즉시 `rejected` | L-08 |
| R / RV | `reject-step/` | 즉시 `rejected` | X-01 계열 |
| P / PV | 〃 | 즉시 `rejected` | PE-07 |
| J | 〃 | 즉시 `rejected` | X-01 계열 |
| O | 〃 | 즉시 `rejected` | X-01 |
| RA | 〃 | 즉시 `rejected` | — |
| **E / EV** | 〃 | ⚠️ **반려가 아니라 '수정 요청'** — step `action`·`document.status`·`round` 모두 그대로, 사유만 comment 에 덧붙이고 `revision_requested` 메일 발송 (`views.py:1057~1066`) | X-09 |

반려 후: 잔여 pending step 은 **이력으로 남고**(`_blocked_progress_response` 가 진행을 막는다),
재상신하면 `max(round)+1` 로 새 회차가 생긴다.

### 2.5 진행 중 이벤트 열거

| 이벤트 | 분기 | 러너 |
|---|---|---|
| 중단 요청 → 일부 확인 | `under_review` 유지 | M-03 |
| 중단 요청 → target 전원 확인 | `pause`, 결재 동결 | M-04, M-05 |
| 중단 → 재개 | `under_review`, 멈춘 단계 유지 + 기한 연장 | M-06, M-07 |
| 중단 요청중 결재 진행 | 요청 자동 취소 | M-08 |
| 철회(draft/rejected) | 즉시 삭제 | W-01, W-02 |
| 철회(approved) | MASTER 만 삭제 | W-03 |
| 철회(진행 중) → 전원 확인 | **문서 삭제**(복구 불가) | W-08 |
| 철회 요청 → 거부/취소 | 결재 재개 | W-11, W-12, W-15 |
| 철회 확인 대기 | 결재 동결 | W-14 |

### 2.6 전체 경우의 수 요약

```
상신 조합 24 (§2.2)
 + 종단 순열 21 (§2.3)
 + 반려 지점 9 (§2.4)
 + 진행 중 이벤트 9 (§2.5)
 + 권한·인가·동시성 분기 (§3.10, §3.11)
→ 동작이 갈리는 지점으로 압축한 실행 케이스 124건 (§3)
```

---

## 3. 검증 케이스 124건 (러너 케이스 ID 와 1:1)

각 케이스는 `python3 -m scripts.approval_cases.run_cases --case <ID>` 로 **개별 실행**된다.
표의 "기대 결과"가 러너의 판정 기준이고, "근거"는 코드 대조 지점이다.

### 3.1 그룹 S — 상신 (14건)

| ID | 전제 | 트리거 | 기대 결과 | 근거 | 기존 테스트 |
|---|---|---|---|---|---|
| S-01 | draft, 지정 PL 1명 | `submit/` | `under_review`, `submitted_at` 기록, `PL` pending 1개 | `views.py:395` | `PlSubmitMailTest.test_submit_pl_mail_subject_has_name_prefix` |
| S-02 | 지정 PL 2명 | 〃 | PL step **2개**, `designated_pl` 은 첫 번째 | `views.py:1684` | — |
| S-03 | 지정 PL 없음 | 〃 | 400 `동료 PL을 지정해주세요.` | `views.py:1701` | — |
| S-04 | role≠PL 지정 | 〃 | 400 `유효하지 않은 PL 사용자입니다` | `views.py:1707` | — |
| S-05 | 본인 지정 | 〃 | 400 `본인을 지정할 수 없습니다.` | `views.py:1710` | — |
| S-06 | Bb 미매핑 | 〃 | 400 | `views.py:309` | `BbMappingValidationTest.test_normal_unmapped_row_still_blocks_submit` |
| S-07 | `additional_notes` JSON 깨짐 | 〃 | ⚠️ **검증을 건너뛰고 상신됨**(현행) | `views.py:309` | — |
| S-08 | C가문/연구소 제품 + 추가 후결자 0 | 〃 | 400 | `views.py:338` | `LabProductPostApproverTest.*` |
| S-09 | 예외구역 변경 + SA 0 + 사유 없음 | 〃 | 400 / 사유 있으면 200 | `views.py:371` | — |
| S-10 | role≠PL 을 SA 로 | 〃 | 400 | `views.py:350` | — |
| S-11 | SA 지정 | 〃 | `SA` step 이 PL 과 **같은 회차**에 생성 | `views.py:385` | — |
| S-12 | SA 미지정 | 〃 | SA step 없음(화면 '해당없음') | 〃 | — |
| S-13 | 이미 `under_review` | 〃 | 400(draft 만 상신 가능) | `views.py:401` | — |
| S-14 | MASTER + draft | `direct-approve/` | 결재선 없이 `approved`, pending step 0 | `views.py:525` | — |

> 추가 인가 규칙(문서 보충분): 상신·재상신은 **작성자 / 문서 공유 그룹 멤버 / MASTER** 만 가능(`_can_edit`).

### 3.2 그룹 L — PL 검토 · SA 합의 (12건)

| ID | 전제 | 트리거 | 기대 결과 | 근거 |
|---|---|---|---|---|
| L-01 | PL 1명 | `peer-approve/` | 다음 단계 생성(일반=R, `MAP 삭제`=P·R·J·O) | `views.py:1728`, `1715` |
| L-02 | PL 2명 중 1명 | 〃 | `under_review` 유지, R 미생성 | `views.py:1742` |
| L-03 | PL 2명 전원 | 〃 | R 생성 | 〃 |
| L-04 | PL 2명 중 1명 반려 | `peer-reject/` | 즉시 `rejected` | `views.py:1769` |
| L-05 | PL 전원 + SA 미합의 | — | 다음 단계 미생성 | `views.py:1520` |
| L-06 | SA 합의 + PL 미합의 | — | 다음 단계 미생성 | `views.py:1531` |
| L-07 | SA 가 마지막 | `sales-agree/` | 그 시점에 다음 단계 생성 | `views.py:1795` |
| L-08 | SA 반려 | `sales-reject/` | 문서 즉시 `rejected` | `views.py:1812` |
| L-09 | SA step 없음 | PL 전원 합의 | `_all_sales_agreers_approved`=True | `views.py:1520` |
| L-10 | 제3자 호출 | `peer-approve/` | 400/403 | `views.py:1479` |
| L-11 | 수정 후 상신 | `peer-submit/` | 본인 step approved(`[수정 후 상신]` 태그) | `views.py:1837` |
| L-12 | 의뢰자/MASTER | `change-designee/` | 현재 회차 **첫** pending PL step assignee 교체 ⚠️ 다중 PL 스왑 미지원 | `views.py:1856` |

### 3.3 그룹 R — R 단계와 병렬 전환 (16건)

| ID | 전제 | 기대 결과 | 근거 |
|---|---|---|---|
| R-01 | R 미배정 + TE_R | 담당자 지정 성공(검토자 동시 지정 가능) | `views.py:1089`, `227` |
| R-02 | 이미 배정됨 | 403 | `views.py:227` |
| R-03 | agent=PL / J | 400 / 403 (claim 단계는 지정 불가) | `views.py:1104`, `237` |
| R-04 | RV 없음 + R 합의 | 병렬 단계 생성 | `views.py:946~955` |
| R-05 | RV 있음 + R 합의 | 병렬 미생성, RV pending 유지 | `views.py:948~953` |
| R-06 | RV 가 먼저 처리 | 400 `담당자 합의가 먼저 필요합니다.` | `views.py:850` |
| R-07 | RV 합의 | 병렬 생성 | `views.py:957` |
| R-08 | plel 없음 | **E 미생성** | `views.py:1667` |
| R-09 | plel 있음 | E 생성 | 〃 |
| R-10 | `Overlay 변경` 단독 | **J 미생성**(검토항목 채우기도 건너뜀) | `views.py:1657` |
| R-11 | `Overlay 변경` + 다른 목적 | J 생성 | 〃 |
| R-12 | 일반 경로 | P=4영업일 < J=O=6영업일 | `views.py:1639~1671` |
| R-13 | 일반 경로 | J 도착 메일이 R 합의 시점, 미배정이면 TE_J 전원 | `views.py:1661` |
| R-14 | `Only MAP` + RA 있음 | P/J/O/E 없음, RA 만, `under_review` | `views.py:1642` |
| R-15 | `Only MAP` + RA 0명 | **즉시 approved** | `views.py:1643` |
| R-16 | `MAP 삭제` | PL 합의 직후 P·R·J·O 병렬, E·RA 없음 | `views.py:1582` |

### 3.4 그룹 C — 검토중(claim) 6건

| ID | 케이스 | 기대 결과 | 근거 |
|---|---|---|---|
| C-01 | J/O/E/P 선점 | 호출자가 assignee 로 고정(2026-08부터 선점자 본인/MASTER 는 `unclaim-step/`으로 취소 가능 — `views.py:1222`, `_can_unclaim_step`) | `views.py:1215`, `244` |
| C-02 | 이미 선점된 단계 | **409** | `views.py:1243` |
| C-03 | 다른 팀 | 403 | `views.py:244` |
| C-04 | agent=R | 400 | `views.py:1226` |
| C-05 | 선점 후 같은 팀 다른 사람 합의 | 허용(표시 담당자는 선점자 유지) | `views.py:209` |
| C-06 | 선점 전 합의 | 403 | 〃 |

### 3.5 그룹 PE — P/E 담당자·검토자 14건

| ID | 케이스 | 기대 결과 | 근거 |
|---|---|---|---|
| PE-01 | P 검토자 없이 합의 | 단계 즉시 완료(선택 사항) | `views.py:1566` |
| PE-02 | P 합의 + PV 2명 | 한 번의 요청으로 PV 2개 생성 | `views.py:1195` |
| PE-03 | PV 일부만 합의 | P 미완료 → 최종 승인 안 됨 | `views.py:1548` |
| PE-04 | PV 선처리 | 400 | `views.py:856` |
| PE-05 | 본인을 검토자로 | 400 | `views.py:1155` |
| PE-06 | 타 팀을 검토자로 | 400 | 〃 |
| PE-07 | PV 반려 | 문서 `rejected` | `views.py:1016` |
| PE-08 | **E 합의에 검토자 없음** | **400** + 아무 쓰기도 없음 | `views.py:871~885` |
| PE-09 | E 합의 + EV 지정 | E approved, EV pending 생성 | 〃 |
| PE-10 | EV 2명 중 1명 합의 | 남은 EV **pending 유지**(skip 없음) | `views.py:926` |
| PE-11 | 레거시(검토자 없이 E approved) | 최종 승인까지 진행 | `views.py:1566` |
| PE-12 | 레거시(EV 살아있음) | 검토자 없이도 통과 | `views.py:878` |
| PE-13 | E comment 이력 존재 | 덮어쓰지 않고 덧붙임 | `views.py:907` |
| PE-14 | P 완료 | TE_O·TE_J 완료 통보 | `views.py:1570` |

### 3.6 그룹 F — 최종 승인 판정 15건 (§2.3 종단 순열)

| ID | 골격 | 마지막 | 기대 | 근거 |
|---|---|---|---|---|
| F-01 | RT-1 | J | approved | `views.py:961~1001` |
| F-02 | RT-1 | O | approved | 〃 |
| F-03 | RT-1 | E(EV) | approved | 〃 |
| F-04 | RT-1 | RA | approved | 〃 |
| F-05 | RT-1 | **P** | approved (J 분리 이후 회귀 지점) | `views.py:961~968` |
| F-06 | RT-1 | P 미완료 | **approved 아님** | `views.py:995` |
| F-07 | RT-2 | J→P 순 | 순서 무관 진행 | 〃 |
| F-08 | RT-3/4 | O | approved(`j_approved` 고정) | `views.py:987` |
| F-09 | RT-2 | J | approved(`e_ok = not e_exists`) | `views.py:997` |
| F-10 | RT-5 | RA | approved(**RA 0개면 판정 자체가 False**) | `views.py:980` |
| F-11 | RT-6 | P | approved | `views.py:933`, `1609` |
| F-12 | RT-6 | R | approved | 〃 |
| F-13 | RT-6 | PV 미합의 | approved 아님 | `views.py:1621` |
| F-14 | 추가 후결자 | 일부만 합의 | approved 아님 | `views.py:978` |
| F-15 | 승인 시 | approved·notify_approved 메일 | `views.py:1005` |

### 3.7 그룹 X — 반려·재상신 9건

| ID | 케이스 | 기대 결과 | 근거 |
|---|---|---|---|
| X-01 | 병렬 단계 반려 | 즉시 `rejected` | `views.py:1016` |
| X-02 | 반려 후 잔여 단계 처리 | 400, 문서는 `rejected` 유지 | `views.py:173` |
| X-03 | 반려 메일 | 작성자+기합의자+미합의 팀 전원 | `mailer` §3.1 |
| X-04 | Only MAP 반려 메일 | 경로 밖 단계 제외 | 〃 |
| X-05 | 재상신 | `max(round)+1`, 이전 회차 보존 | Case I |
| X-06 | 재상신 | SA step 도 새 회차 재생성 | `views.py:458` |
| X-07 | 재상신 전 목적 변경 | **새 회차부터** 새 경로 규칙 적용 | Case G 주석 |
| X-08 | 이전 회차 잔여 pending | '내 차례'에 안 잡힘 | `utils/approvalTable.ts` |
| X-09 | **E/EV 반려** | ⚠️ 반려가 아니라 **수정 요청** — 상태·회차 불변, comment 에 `[수정 요청 …]` 추가, `revision_requested` 메일 | `views.py:1057~1066` |

### 3.8 그룹 M — 중단(PAUSE) 9건 / 3.9 그룹 W — 철회 15건

| ID | 케이스 | 기대 결과 |
|---|---|---|
| M-01 | 중단 요청 | `PauseRequest(requested)`, 상태는 `under_review` |
| M-02 | 사유 없음 | 400 |
| M-03 | 일부만 확인 | `under_review` 유지 |
| M-04 | target 전원 확인 | `pause` |
| M-05 | pause 중 결재 | 400 |
| M-06 | 재개 | `under_review`, 멈춘 단계 그대로 |
| M-07 | 재개 | 기한이 멈춘 달력일수만큼 연장 |
| M-08 | 요청중 결재 진행 | 요청 자동 `cancelled` |
| M-09 | pause 문서 철회 | 400 |
| W-01 | draft 철회 | 즉시 삭제(`deleted=true`) |
| W-02 | rejected 철회 | 즉시 삭제 |
| W-03 | approved 철회 | MASTER 만, 그 외 403 |
| W-04 | 진행 중 철회 | 요청만 생성 |
| W-05 | 사유 없음 | 400 |
| W-06 | 중복 요청 | 400 |
| W-07 | 일부 확인 | 문서 유지 |
| W-08 | 전원 확인 | **문서 삭제**(step CASCADE) |
| W-09 | 미배정 단계 | 같은 팀 1명이 확인 가능 |
| W-10 | 다른 팀 | 403 |
| W-11 | 한 단계 거부 | 요청 전체 무효 |
| W-12 | 요청자 취소 | 취소됨 |
| W-13 | 타인 취소 | 400/403 |
| W-14 | 확인 대기 중 결재 | 400 |
| W-15 | 거부 후 | 결재 재개 |

### 3.10 그룹 A — 인가 10건

| ID | 케이스 | 기대 결과 | 근거 |
|---|---|---|---|
| A-01 | 담당자 아닌 사용자 합의 | 403 | `views.py:209` |
| A-02 | MASTER | 모든 단계 처리 가능 | `views.py:209`, `827` |
| A-03 | RA/PV/EV | 본인 assignee step 만 | `views.py:827~838` |
| A-04 | J/O/E/P | 팀 공동 합의(assignee 필터 없음) | `views.py:839~847` |
| A-05 | 후결자 추가 | 작성자/MASTER + 병렬 진입 후 | `views.py:1985` |
| A-06 | 고정 후결자 제거 | 거절 | 〃 |
| A-07 | 합의한 RA 제거 | 400 | 〃 |
| A-08 | Only MAP 총원 0 | 400 | 〃 |
| A-09 | C가문/연구소 추가분 0 | 400 | 〃 |
| A-10 | 일반 문서 추가분 0 | 허용 | 〃 |

### 3.11 그룹 N — 동시성 4건

| ID | 케이스 | 기대 결과 | 근거 |
|---|---|---|---|
| N-01 | 마지막 병렬 합의 2건 동시 | approved 전이 누락 없음 | `views.py:816` |
| N-02 | PL 2명 동시 합의 | R 중복/누락 없음 | `views.py:1735`, `1722` |
| N-03 | `MAP 삭제` 병렬 생성 경합 | 단계 중복 생성 없음 | `views.py:1593` |
| N-04 | 합의·반려 동시 | 직렬화되어 한쪽만 반영 | `views.py:1026` |

---

## 4. 개발환경에서 실행하기 (러너)

### 4-0. 실행 방식 — **개발용 사이트의 Django REST API 직접 호출**

케이스별 의뢰서는 화면 조작이나 모의 객체 없이 **개발용 사이트의 REST API 를 직접 호출해
실제로 상신**한다. 즉 한 케이스는 아래 엔드포인트를 실제 순서대로 탄다.

```
POST /api/auth/dev-login/            ← 개발용 계정 로그인(JWT 발급)
POST /api/documents/                 ← 의뢰서 생성(draft)
POST /api/documents/{id}/submit/     ← 상신 (지정 PL·SA 포함)
POST /api/documents/{id}/peer-approve/ · sales-agree/
POST /api/documents/{id}/assign-step/ · claim-step/
POST /api/documents/{id}/approve-step/ · reject-step/
POST /api/documents/{id}/request-pause/ · confirm-pause/ · resume/
POST /api/documents/{id}/withdraw/ · confirm-withdraw/ …
GET  /api/documents/{id}/            ← 결과 검증(status·approval_steps)
```

- **모든 케이스가 실제 문서를 만들고 실제로 상신한다.** 검증은 API 응답과 문서 조회 결과로 한다.
- 서버측 인가(`_can_act_on_step` 등)와 경로 분기가 **우회 없이** 그대로 적용된다.
- 생성된 문서는 삭제하지 않으므로 `/approval` 화면에서 그대로 이어서 확인할 수 있다.

### 4-1. 준비
1. 개발환경이 떠 있을 것(`docker-compose.dev.yml`, 화면 `http://localhost:10011`).
2. **`AUTH_MODE=dev`** — 러너는 `POST /api/auth/dev-login/` 으로 역할별 계정에 로그인한다.
3. **`@company.com` 개발용 계정으로만 상신·결재한다.**
   - 시드 생성: `docker exec -it request_backend_dev python manage.py create_users`
     → `pl_user`~`pl_user6`(PL), `agent_r1~3`, `agent_p1~3`, `agent_j1~3`, `agent_o1~3`,
     `agent_e1~3`, `master` — **전부 `@company.com`**.
   - 러너는 `GET /api/users/?role=<역할>` 결과에서 **메일이 `@company.com` 으로 끝나는 계정만**
     골라 쓴다(실사용자 계정으로 의뢰서·결재 이력이 남지 않게 하기 위해서다).
     의뢰서의 `requester_email`·`requester_department` 도 그 계정의 실제 값이 들어간다.
   - 도메인이 다르면 `--mail-domain '@other.com'`, 필터를 끄려면 `--allow-any-account`
     (권장하지 않음 — 실사용자 이름으로 문서가 남는다).
4. 역할 계정 권장 인원: `PL` 3+, `TE_R` 2, `TE_P` 3, `TE_J` 2, `TE_O` 2, **`TE_E` 3**, `MASTER` 1.
   부족하면 해당 케이스가 사유와 함께 `SKIP` 된다.
5. 메일은 서버 설정을 그대로 따른다(`MAIL_REDIRECT_TO` 가 설정돼 있으면 전부 그 주소로 간다).

### 4-2. 실행
```bash
python3 -m scripts.approval_cases.run_cases --list                  # 124건 목록
python3 -m scripts.approval_cases.run_cases                         # 전체
python3 -m scripts.approval_cases.run_cases --group F --group PE    # 그룹만
python3 -m scripts.approval_cases.run_cases --case F-05 --case X-09 # 개별
python3 -m scripts.approval_cases.run_cases --report /tmp/result.md # 결과 표 저장
python3 -m scripts.approval_cases.run_cases --mail-domain '@other.com'  # 계정 도메인이 다를 때
```
종료 코드 `0`=실패 없음 / `1`=FAIL·ERROR 있음 / `2`=환경 준비 실패.
실행 머리에 어떤 계정으로 도는지(`[사용자] 개발용 계정만(@company.com)`)와 역할별 인원이 출력된다.

### 4-3. 상신 값은 전부 실제 DB 값이다
러너는 화면과 **같은 form-options API 를 같은 순서로** 호출해 조합을 찾는다.
```
/api/lines/ → /api/form-options/processes/ → products/ → process-id/ → job-file-layer/
```
- J-layer 행의 `pp` 는 화면과 동일하게 `recipeid` 로 채운다(`RequestPage/index.tsx`
  `fetchJobFileLayerAndPopulateJayer`). E(MASK) 케이스는 **`pp` 에 `plel` 이 든 실제 행**이 있는
  조합을 찾아 쓰고, 없으면 SKIP 한다.
- 제목도 화면과 같은 규칙으로 만들어진다:
  `{라인}({목적})_MAP({map_type})_{조합법}_{제품}_{process_id}_요청서_{YYMMDD}`.
  **테스트 표식을 붙이지 않으므로** 목록에서 실제 의뢰서와 같은 모습으로 보인다.
- **생성한 문서는 지우지 않는다** — 화면에서 목록·현재 단계 그리드·결재 경로 탭까지 확인한다.

### 4-4. 러너가 확인할 수 없는 것(구조적 SKIP)
| 케이스 | 이유 | 대신 확인 |
|---|---|---|
| R-13, PE-14, F-15, X-03, X-04 | 메일 수신자 산출은 API 로 관측 불가 | `RecipientResolutionTest` |
| PE-11, PE-12 | 레거시 데이터 상태를 새 문서로 만들 수 없다 | 백엔드 테스트 |
| M-07 | 중단·재개가 같은 날이면 연장분 0일 | 백엔드 테스트 |
| X-08 | 프론트 계산 | `approvalTable.test.ts` |
| R-15, A-08 등 | 환경 설정(`POST_APPROVER_LOGINID`)에 따라 전제가 성립하지 않을 수 있음 | 설정을 바꿔 재실행 |

---

## 5. 백엔드 테스트도 함께 돌린다 (Docker 없이 가능)

러너는 "개발환경 실제 동작"을, 백엔드 테스트는 "레거시·메일·동시성"을 덮는다. **둘 다** 돌린다.

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
`staticfiles.W004` 경고 1건은 무해하다. 상세는 `docs/E2E_TEST_AND_BUGS.md` §1.4.1.
새 재현 테스트는 **프로젝트 밖**(`$SP/stubs/verify_xxx.py`)에 두고 `manage.py test verify_xxx` 로 돌린다.

---

## 6. 화면 수동 검증 시나리오

러너가 만든 문서를 `http://localhost:10011` 에서 눈으로 확인한다.

1. **제목·목록 표시** — `/approval` 진입 → 러너가 만든 의뢰서 행 확인
   → **기대**: 제목이 `라인(목적)_MAP(NEW)_조합법_제품_processid_요청서_YYMMDD` 형태로,
   내가 화면에서 작성했을 때와 **같은 모양**이다. 제품명·의뢰자·양산일 칸이 채워져 있다.
2. **PL 단계 그리드** — 상신 직후 문서의 '현재 단계' 칸
   → **기대**: 1열 2줄(1줄=지정 PL, 2줄=영업·기술지원 합의자). SA 미지정 문서는 2줄이 `해당없음`.
3. **병렬 그리드 6칸** — R 합의 후
   → **기대**: `PHPSI / 후결자 / JOB / MASK / OVL / 추가후결자` 6칸이 각자 뱃지(`대기중`/`검토중`/`완료`/`해당없음`).
   plel 없는 문서는 MASK 가 `해당없음`, `Overlay 변경` 단독은 JOB 이 `해당없음`, `MAP 삭제` 는
   MASK·추가후결자가 `해당없음` 이고 2열 1행이 `RFG`.
4. **E 검토자 필수(PE-08)** — TE_E 로그인 → MASK '검토중' → 검토자 비운 채 '합의'
   → **기대**: `2차 검토자를 1명 이상 지정해야 합니다.` 오류. 새로고침해도 MASK 는 여전히 검토중.
   (실패 신호: 오류가 떴는데 MASK 가 '완료'로 바뀌어 있으면 부분 커밋 버그다.)
5. **E 반려는 수정 요청(X-09)** — TE_E 로 MASK 단계에서 '반려'
   → **기대**: 문서 상태 뱃지가 **`반려`로 바뀌지 않고** 검토중 그대로이며, 상신자에게 수정 요청
   메일이 간다. 상세 '결재 경로' 탭 MASK 행 의견에 `[수정 요청 …]` 이 쌓인다.
6. **반려 후 잔여 단계 차단(X-02)** — TE_O 가 반려 → TE_J 로 로그인해 같은 문서 합의 시도
   → **기대**: 400 안내, 상태 뱃지는 `반려` 유지.
7. **중단 → 재개(M-04~M-06)** — 작성자 '중단 요청'(사유) → 현재 단계 담당자 전원 '중단 확인'
   → **기대**: 6칸이 전부 `PAUSE`, '최종 완료예정' 칸이 회색 `중단`. 재개하면 멈춘 단계부터 이어진다.
8. **철회 확정(W-08)** ⚠️ 문서가 삭제된다 — 러너가 만든 문서로만 수행
   → **기대**: 전원 확인 즉시 목록에서 사라진다.

---

## 7. 검증 시 빠지기 쉬운 함정

1. **회차(round)를 안 본다** — 모든 판정은 `max(round)` 기준(`views.py:305`).
2. **트리거와 조건은 다르다** — 최종 승인은 `agent in ('P','PV','J','O','E','EV','RA')` 합의에서만
   판정된다. `R`·`RV` 는 병렬 전환만 하고, `MAP 삭제` 는 **별도 분기**(`views.py:933`)로 판정한다.
3. **"없으면 통과" 규칙** — SA 없음 / E 없음 / RA 없음 / 검토자 없음 / J 없음(skip)은 전부 통과.
   단 **`Only MAP` 의 RA 만은 `len(ra_steps) > 0` 을 요구**한다(`views.py:982`). 이 비대칭을 뭉뚱그리지 말 것.
4. **E/EV 반려는 반려가 아니다** — '수정 요청'이라 상태가 그대로다. §2.4·X-09.
5. **반려는 pending step 을 지우지 않는다** — 잔여 pending 은 이력이고, 진행은 상태 가드로 막는다.
6. **철회는 되돌릴 수 없다** — 확인 완료 = 문서 삭제. 실 데이터로 시도하지 말 것.
7. **E 의 400 은 쓰기 이전에** 나야 한다(`@transaction.atomic` 은 예외에만 롤백). 응답 코드뿐 아니라
   **DB 상태까지** 확인한다.
8. **라인 번호는 흔들린다** — 이 문서의 `views.py:NNN` 은 작성 시점 기준. 어긋나면 함수명으로 찾는다.

---

## 8. 코드 대조로 확인된 사실 (2026-08-14)

이 절은 **이미 확인이 끝난 항목**이다. 검증자는 재확인만 하면 된다.

| # | 항목 | 확인 결과 | 조치 |
|---|---|---|---|
| 1 | `MAP 삭제` 목적 문자열 | 코드 `models.py:91` = `'MAP 삭제'`, 프론트 `constants.ts:42` = `'MAP 삭제'` — **문서만 `'MAP 삭제/수정'`으로 낡아 있었다** | `docs/APPROVAL.md` 정정 완료 |
| 2 | J 합의/반려의 assignee 필터 | 코드는 `RA`/`PV`/`EV` 만 필터, `J`·`O`·`E`·`P` 는 필터 없이 조회 후 인가(`views.py:827~847`) — 문서 Case G 서술이 낡아 있었다 | `docs/APPROVAL.md` 정정 완료 |
| 3 | `assignStepMultiJ` API | 프론트 전체 검색 **0건** — 존재하지 않는 API 를 문서가 설명하고 있었다 | `docs/APPROVAL.md` 서술 삭제 |
| 4 | E/EV 반려 | `views.py:1057~1066` — 상태·회차를 바꾸지 않는 '수정 요청'. Case H 는 "어느 단계든 rejected" 라고만 적혀 있었다 | Case H 에 예외 명시 |
| 5 | 상신 payload | `designated_pl_loginids`(배열) 우선 + 단일 호환 — API 표는 단일만 적고 있었다 | API 표 정정 |
| 6 | 상신 인가 | `_can_edit`(작성자/공유 그룹/MASTER) 로 403 — 문서에 없었다 | Case A 보충 |

### 8-1. 아직 남은 불일치 — **코드 쪽**이라 손대지 않았다 (규칙 K 보고 대상)

| # | 위치 | 내용 | 영향 |
|---|---|---|---|
| A | `backend/api/views.py` `update_validation_system` docstring | "수정 창은 … **EV 중 1명이 합의하기 전까지**(E 단계 완료 판정이 **OR** 이므로)" — 2026-08 에 EV 가 AND 로 바뀌어 실제 게이트는 `_stage_reviewers_complete`(전원 합의)다 | 주석만 낡음. 읽는 사람이 OR 로 오해할 수 있다 |
| B | `backend/api/views.py` `assign_step` 주석 | "단일 담당자 지정 (**R·P 전용** — J/O/E 는 검토중 방식)" — `P` 는 `_CLAIM_AGENTS` 라 `_can_assign_step` 이 항상 403 이므로 실질 **R 전용**이다 | 주석만 낡음 |
| C | `docs/APPROVAL.md` Case A | `_validate_bb_mapping` 이 JSON 파싱 실패 시 **검증을 건너뛴다**(S-07 로 실행 확인 가능) | 깨진 문서가 상신될 수 있다. 문서가 스스로 "의도 확인 필요"로 표시한 항목 |

> A·B 는 **코드 주석 수정**이라 이번 문서 작업 범위 밖으로 두었다. 고칠지 여부는 사용자가 정한다.

---

## 9. 보고 형식

### 9-1. 케이스 결과표(124행)
러너의 `--report` 출력을 그대로 붙이고, SKIP 은 사유까지 남긴다.

| ID | 판정 | 근거(실행 출력) | 비고 |
|---|---|---|---|
| S-01 | PASS/FAIL/SKIP/ERROR | `doc=123 title=…` | |

- **PASS**: 러너 통과 + (필요하면) 코드 대조까지 확인.
- **FAIL**: 기대와 다른 동작을 **실행 출력으로** 확인. → 9-2 형식으로 보고.
- **SKIP**: 전제 미충족. **통과로 적지 않는다.** 사유를 그대로 남긴다.
- **ERROR**: 통신 실패·러너 예외. 원인까지 적는다.

### 9-2. 발견 보고 (규칙 K)
```
🛑 발견 보고
발견: [무엇이 잘못됐는지 한 문장]
위치: [파일:라인 / 케이스 ID]
근거: [실행 출력 원문 / 코드 인용]
영향: [고치지 않으면 실제로 무슨 일이 생기는지]
선택지: 1) 지금 고친다 — 범위: …  2) 다르게 고친다 — …  3) 기록만 남긴다
추천: [하나만, 이유 한 줄]
어떻게 할까요?
```

---

## 10. 이 문서를 넘겨받은 AI 에게 (요약 지시)

1. `CLAUDE.md` → `docs/APPROVAL.md` → 이 문서 순으로 읽는다.
2. §5 로 백엔드 전체 테스트를 돌려 기준선을 잡는다.
3. §4 러너로 **124건을 전부** 실행하고 `--report` 로 결과를 남긴다.
4. FAIL·SKIP 은 §9 형식으로 보고한다. **SKIP 을 통과로 바꿔 적지 않는다.**
5. §6 수동 시나리오로 화면 표시를 확인한다(러너가 만든 문서를 그대로 쓴다).
6. **버그를 발견해도 고치지 않는다.** §9-2 로 보고하고 사용자의 결정을 기다린다.
7. 이 문서와 코드가 다르면 **코드가 사실**이다. 문서 수정도 사용자 승인 후에 한다.
