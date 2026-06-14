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
| `status` | `draft`(임시저장) / `submitted`(미사용) / `under_review`(검토중) / `approved`(승인) / `rejected`(반려). 기본값 `draft` |
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
```

핵심: **PL → R → (P → J) ∥ (O [+E])**. R 합의 후 두 경로(path1=P→J, path2=O[+E])가 **병렬** 진행되고, J·O·(E) 가 **모두** 합의돼야 문서가 `approved`가 된다.

### Case A — 상신 (`submit`, `views.py:100`)
- 조건: `status == 'draft'`, **지정 PL 필수**(role='PL'인 사용자, **본인 지정 불가**), `_validate_bb_mapping` 통과.
- 동작: `status → under_review`, `submitted_at` 기록, 기존 step 전체 삭제 후 `agent='PL', round=1` pending 생성.
- ⚠️ `_validate_bb_mapping`(`views.py:81`): "활성 + `process_id` 있는 J-layer 행은 모두 Bb 매핑 필수". **단 `additional_notes` JSON 파싱 실패 시 검증을 건너뛴다(통과 처리)** — 의도 확인 필요.

### Case B — PL 검토 합의 (`peer_approve`, `views.py:368`)
- 권한: **MASTER 또는 해당 PL 단계의 assignee 본인만**(`views.py:379`).
- 동작: PL step `approved` → `agent='R'` pending 생성, `status=under_review`.

### Case C — PL 검토 반려 (`peer_reject`, `views.py:396`)
- 권한: MASTER 또는 assignee 본인.
- 동작: PL step `rejected`, `status → rejected`.

### Case D — PL 수정 후 상신 (`peer_submit`, `views.py:421`)
- 권한: MASTER 또는 assignee 본인. 문서 내용은 사전에 `/request` 화면에서 수정·update됨.
- 동작: 합의와 동일(R 생성)하되 comment 앞에 `[수정 후 상신]` 태그.

### Case E — R 합의 (`approve_step` agent='R', `views.py:250`)
- 동작: R `approved` → **P(due: R당일 포함 4영업일), O(due: 6영업일, 병렬)** 동시 생성.
  추가로 `has_ppid_plel()`이 참이면 **E**(due: 6영업일, 병렬)도 생성.
- `has_ppid_plel()`(`models.py:106`): J-layer 행 중 `pp` 값에 `plel`(대소문자 무관) 포함이 하나라도 있으면 E 단계 생성.

### Case F — P 합의 (`approve_step` agent='P', `views.py:272`)
- 동작: P `approved` → **J(due: P당일 포함 4영업일)** 생성. (path1은 P→J 순차)

### Case G — J / O / E 최종 합의 (`approve_step` agent in J/O/E, `views.py:284`)
- 동작: J·O·(E 있으면 E)가 **모두** `approved`일 때만 `status → approved`. 그 전엔 `under_review` 유지.
- ✅ 동시성: 두 결재자가 거의 동시에 마지막 합의를 눌러도 문서 행 락(`select_for_update`)으로
  직렬화되어 approved 전이가 누락되지 않는다(2026-06 수정).

### Case H — 단계 반려 (`reject_step`, `views.py:312`)
- 동작: 어느 단계든 해당 step `rejected`, `status → rejected`(즉시).

### Case I — 재상신 (`resubmit`, `views.py:145`)
- 조건: `status == 'rejected'`, 지정 PL 필수(본인 불가), bb 매핑 통과.
- 동작: `status → under_review`, **max(round)+1**로 새 PL pending 생성. 이전 round step은 이력으로 보존.

### Case J — 철회 (`withdraw`, `views.py:189`)
- 조건: status가 under_review/rejected/submitted.
- 동작: `status → draft`, `submitted_at=None`, **현재 문서의 모든 step 삭제**.
- ✅ 권한: MASTER / 의뢰자 PL 본인 / 지정 PL 본인 / **의뢰자가 멤버인 '나만의 그룹'의 멤버**
  만 가능(`_can_withdraw`, 2026-06 추가). 그 외 호출은 403. 그룹 판정은
  `requester.member_groups` 기준(approved 메일 수신자 규칙과 동일).

### Case K — 담당자 지정 (`assign_step`, `views.py:331` 부근)
- 동작: 현재 회차의 해당 agent pending step에 assignee 지정.
- ✅ 권한: 프론트 `canUserAssign`과 동일(`_can_assign_step`, 2026-06 추가) —
  MASTER / 같은 팀(역할↔agent 일치) + 미지정일 때만. PL·O·E 단계는 지정 불가.
  또한 `agent`는 `R·P·J·O·E`만 허용(`agent='PL'`로 지정 PL을 덮어쓰는 우회 차단).

### Case L — 지정 PL 변경 (`change_designee`)
- 권한: **의뢰자 본인 또는 MASTER만**. 현재 회차 PL step의 assignee 교체.

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
- **PL 검토 pending**: "PL 검토(담당자명)" 단일 행, 기한 없음.
- **R 미합의**: R 단계 단일 행(담당자 유무로 상태 결정).
- **R 합의 후(병렬)**: 한 의뢰서를 **2행**으로 분리 표시 — path1(P/J), path2(O[/E]). rowSpan으로 좌측 공통열 병합.
  - path1 단계 텍스트: 현재 pending인 P 또는 J. 둘 다 끝나면 "결재완료".
  - path2 단계 텍스트: pending인 O/E를 ` / `로 연결. 끝나면 "결재완료".

### 3.4 상태 배지 (`getDisplayStatus` / `resolvePathStatus`)
- pending step에 `assignee_loginid`가 없으면 **`unassigned`**, 있으면 `under_review`.
- **O/E는 담당자 지정 개념이 없어** unassigned 판정에서 제외(항상 해당 팀이 처리).

### 3.5 완료 예정일
- **현재 단계 완료예정**: 해당 pending step의 `due_date`(영업일, `getDueDateDisplay`로 지남/오늘/일반 색상).
- **최종 완료예정**(`getFinalCompletionDate`): R 합의 후 max(path1End, path2End).
  - path1End = J.due, J 없으면 P.due + 4일(추정).
  - path2End = max(O.due, E.due).
  - ⚠️ path1 추정치는 영업일이 아닌 단순 +4 **달력일**이라 백엔드 실제 J due(영업일)와 다를 수 있음.

### 3.6 상세 모달 + 액션 (행 클릭 → 모달)
모달 footer는 **본인이 처리 가능한 pending step**을 찾아 버튼을 조건부 렌더한다.

| 액션 | 버튼 노출 조건(프론트) | 호출 API |
|------|----------------------|----------|
| 합의 / 반려 (R·P·J·O·E) | `canUserAgree`가 참 | `approveStep` / `rejectStep` |
| PL 합의 / 반려 / **수정 후 상신** | PL 검토 단계 + 본인 | `peerApprove` / `peerReject` / `/request`로 이동(peerSubmit) |
| 담당자 지정 | `canUserAssign`가 참 | `assignStep` |
| 지정자 변경 | PL/MASTER | `changeDesignee` |
| 철회 | PL/MASTER | `withdraw`(임시저장으로) 또는 `delete`(삭제) 선택 |
| 수정 후 재상신 | rejected/draft | `/request`로 이동(editDocId) |

처리 중 `processing`으로 버튼 비활성화(더블클릭 방지), 결과는 토스트로 안내, 실패 시 `common.process_error`.

### 3.7 결재 가능 판정 (`ApprovalFlow.tsx`)
- `canUserAgree`: MASTER 항상 / PL은 자기 PL단계 assignee일 때 / **TE_O·TE_E는 자기 agent pending이면 무조건** / 나머지(R·P·J)는 assignee 본인.
- `canUserAssign`: PL단계·O·E는 지정 불필요. 나머지는 같은 팀 + pending + 담당자 미지정일 때.

---

## 4. API 엔드포인트 (모두 `POST /documents/{id}/...`)

| 액션 | URL | 핵심 payload |
|------|-----|------|
| 상신 | `submit/` | `designated_pl_loginid` |
| 재상신 | `resubmit/` | `designated_pl_loginid` |
| 철회 | `withdraw/` | - |
| 합의 | `approve-step/` | `agent`, `comment`, `approver_name` |
| 반려 | `reject-step/` | `agent`, `comment` |
| 담당자 지정 | `assign-step/` | `agent`, `assignee_loginid`, `assignee_name` |
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
| `submit`/`resubmit` | stage_arrival(PL) | 지정 PL 1명 |
| `peer_approve`/`peer_submit` | stage_arrival(R) | TE_R 미지정 시 고정 주소 |
| `approve_step`(R) | stage_arrival(P·O[·E]) | P 고정 주소 / O·E 팀 전원 |
| `approve_step`(P) | stage_arrival(J) | TE_J 미지정 시 고정 주소 |
| `approve_step`(J·O·E 전부 합의) | approved | 작성자가 속한 모든 그룹 멤버 전원 |
| `reject_step`/`peer_reject` | rejected | 요청서 작성자 1명 |

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
2. **TE_O/TE_E는 담당자 지정 없이 같은 팀 누구나 합의 가능** — 누가 처리할지 비결정적(먼저 누른 사람).
3. **`_validate_bb_mapping`이 JSON 파싱 실패 시 통과 처리** — 손상된 데이터가 검증을 우회.
4. **`additional_notes`가 JSONField가 아닌 TextField** — 깨진 JSON 저장 시 `get_detail()`이
   조용히 `{}` 반환(silent 유실 가능).
5. **최종 완료예정 path1 추정치가 달력일 +4**(영업일 아님) — 표시값 부정확 가능.
6. **하드코딩 한국어 다수**(규칙 G 위반): '지정자가 변경되었습니다.'(`:435`),
   '의뢰서가 삭제되었습니다.'(`:488`) 등 — i18n 이관 필요.

---

## 7. 상세 보기(PagedDetailView) 변경 이력

- **(2026-06-13) 원본 라인/Part ID는 MAP 정보 섹션에만 표시**: 기존에는 `source_line`/`source_partid`가 '상세 정보' 섹션(`section_detail`)과 'MAP 정보' 섹션(`section_map`, `map_type === 'CLONE'`) 두 곳에 중복 노출됐다. '상세 정보' 쪽 블록을 제거하여 **MAP 정보 섹션(CLONE)에서만** 보이도록 한다. MAP 섹션 노출 조건은 `showMap = isR || isO || isP`이므로 순수 TE_J/TE_E 역할에는 원본 정보가 표시되지 않는다(MAP 정보 성격상 의도된 동작).
- 각 step에서 작성한 내용은 상세 보기에서 별도 페이지/섹션으로 분리 렌더된다: J-layer→`job_li`, O-layer→`ovl_li`(table/info 탭, info 탭에 `partial_shot`·TBV·TLV), Backbone→`bb`, MAP 변경 내용→`section_map`.

---

*결재 로직/화면이 바뀌면 이 문서를 반드시 함께 갱신한다.*
