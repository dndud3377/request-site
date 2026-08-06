# MAIL — 결재 알림 메일 (DXHUB)

> 작성일: 2026-06-12
> 목적: 결재 단계 도착·반려·완료 시 DXHUB 메일 API 로 알림을 보내는 기능의 동작을 기록한다.

- 발송 모듈: `backend/api/mailer.py`
- 큐 모델: `backend/api/models.py` `MailNotification`
- 큐 처리 잡: `backend/api/scheduler.py` `process_mail_queue` (1분 주기)
- 수동 발송 커맨드: `python manage.py process_mail_queue`
- 전이 연동: `backend/api/views.py` (각 결재 액션)

### PL/R 단계 점검 중 추가된 항목 (2026-07)
단계별 메일 발송 로직을 처음부터 다시 점검하며 발견·보완한 항목들. 상세는 각 절 참고.
1. **PL 상신 메일 개인화** — `submit`/`resubmit` 시 지정 PL 각각에게 가는 메일 제목에 R 담당자 지정과 동일하게 `[이름님]` 접두어를 붙임(§3 표, §3 "제목·본문 규칙").
2. **PL 반려 시 미합의자 포함** — 다중 PL 지정 중 1명이 반려하면, 아직 합의/반려하지 않은 나머지 지정 PL(pending)에게도 반려 메일을 보냄(§3 표 `rejected` 행).
3. **지정 PL 변경 시 메일 발송** — `change-designee`로 지정자를 교체하면 새 지정자에게 상신 때와 동일한 개인화 메일을 보냄(기존엔 무메일이었음, §4 표).
4. **반려 수신자를 "잔여 결재선" 기준으로 개편** — PL 을 제외한 어느 단계에서 반려되든, 작성자·기합의자에 더해 **아직 합의를 마치지 않은 결재선 단계의 담당 팀 전원**(반려자 본인 제외)에게 반려 메일을 보냄. 정적 단계 순서표가 아니라 문서의 실제 상태로 판정해 병렬 단계 누락이 없다(§3.1).
5. **메일 본문에 결재 경로 카드 추가** — 모든 결재 메일에 **현재 회차의 결재 경로 + 단계별 의견**을 실어, 웹에 들어가지 않아도 진행 상황과 반려 사유를 메일에서 바로 확인할 수 있게 함(§3 "결재 경로 카드").

### RA 제목 분기 + P 단계 통보 (2026-08)
1. **RA(후결자) 제목 분기** — 고정 후결자(`settings.POST_APPROVER_LOGINID`)는 기존대로 `[후결 요청] {제목}`, 그 외 추가 후결자(C가문)는 다른 개인 지정 메일과 동일한 `[이름님] [결재 요청] {제목}` 형식으로 분리(§3 표, §3 "제목·본문 규칙").
2. **`stage_arrival` 제목 접미사 삭제** — 모든 단계의 메일 제목에서 `- {단계라벨}` 접미사를 제거. 단계 구분은 본문 KPI 카드로만 표시.
3. **P 단계 도착/완료 통보 신설** — P 단계가 생성되면 `notify_p_arrival`로 TE_J 팀 전원에게, P 단계(담당자+검토자) 합의가 모두 끝나면 `notify_p_completed`로 TE_O 팀 전원에게 참고용 통보 메일을 발송(§3 표, §4 표).

---

## 1. 아키텍처 (하이브리드: 즉시 발송 + 영속 큐 재시도)

```
결재 전이(상신/합의/반려/완료)
   └─ enqueue_*()  → MailNotification(status='pending') INSERT  (결재 트랜잭션 안)
                   └─ transaction.on_commit 등록
커밋 성공 ─ 데몬 스레드 _send_now_async() ─ 즉시 1회 발송  ← 거의 실시간
   성공 → status='sent'
   실패 → pending 유지
                                  │ (즉시 발송 실패분 / 누락분)
APScheduler 1분 주기 ─ process_mail_queue() ─ DXHUB API 발송  ← 안전망
   성공 → status='sent'
   실패 → attempts += 1, 재시도 (max_attempts=5 도달 시 status='failed')
```

- **적재(enqueue)는 기존 결재 트랜잭션 안에서 INSERT 만 수행**한다. 외부 HTTP 가
  없으므로 문서 행 락(`select_for_update`)을 오래 점유하지 않고, 결재가 롤백되면
  메일 적재도 함께 롤백되어 일관성이 보장된다.
- **즉시 발송**: 커밋 직후 `transaction.on_commit` → 데몬 스레드에서 1회 발송한다.
  평상시 거의 실시간으로 나가며, 데몬 스레드라 외부 지연이 결재 응답을 막지 않는다.
  on_commit 콜백은 예외를 전파하지 않아(`_send_now_async`) 결재 응답을 깨지 않는다.
- **재시도 안전망**: 즉시 발송이 실패하면 행은 `pending` 으로 남고, `process_mail_queue`
  잡(1분 주기)이 `max_attempts`(5) 회까지 재시도한다. DB 영속이라 서버 재시작에도
  재시도 상태가 보존된다. 외부 API 장애가 결재 흐름에 영향을 주지 않는다.
- **중복 발송 방지**: 즉시 스레드와 큐 잡이 겹쳐도 각 행은 `select_for_update(skip_locked=True)`
  + `status='pending'` 필터로 한쪽만 처리한다. `process_mail_queue` 는 `max_instances=1`.

---

## 2. VOC 알림 메일 (2026-06-23 추가)

### 2.1 이벤트 및 수신자

| 이벤트 | 트리거 | 수신자 |
|--------|--------|--------|
| `voc_created` | POST /api/voc/ (신규 등록) | `VOC_MASTER_EMAIL` 고정 주소 |
| `voc_comment` | POST /api/voc/{id}/comment/ | VOC 제출자(`submitter_email`) + 기존 댓글 작성자(`author_email`) - 본인 제외 |

### 2.2 환경 변수

| 변수 | 의미 | 예시 |
|------|------|------|
| `VOC_MASTER_EMAIL` | VOC 등록 알림 고정 수신자 (쉼표로 여러 명 가능). 비우면 발송 안 함. | `master@company.com` |

> `MAIL_REDIRECT_TO` 가 설정된 개발 환경에서는 VOC 알림도 동일하게 해당 주소로 강제 발송된다.

### 2.3 메일 링크

VOC 메일 본문에는 `FRONTEND_URL/voc?id={voc_id}` 형태의 직접 링크가 포함된다.
링크 클릭 시 VOCPage가 열리며 해당 VOC 상세 모달이 자동으로 펼쳐진다 (`?id` query param 처리).

### 2.4 재시도 / 큐

결재 알림과 동일한 `MailNotification` 큐 사용. `max_attempts=5`, 1분 주기 재시도.
`document` FK는 `null`로 적재된다.

---

## 3. 결재 알림 수신자 규칙 (`mailer.resolve_*`)

| 이벤트 | 도착 단계 | 수신자 |
|--------|----------|--------|
| stage_arrival | PL 검토 | 지정 PL **전원**(각 PL step의 `assignee.mail`, 다중 지정 시 각각 발송, 제목에 `[이름님]`, 2026-07 추가) |
| stage_arrival | R | 담당자 지정 시 그 1명(제목에 `[이름님]`), **미지정(도착 시점)이면 TE_R 팀 전원** |
| stage_arrival | RV(검토자) | 담당자 합의로 검토자 차례가 된 시점에 그 1명(제목에 `[이름님]`) |
| stage_arrival | RA(후결자) | 병렬 진행 시작 시 후결자 각각에게 개별 발송. **고정 후결자**(`settings.POST_APPROVER_LOGINID`)는 제목 `[후결 요청]` 고정, **그 외(C가문 추가 후결자)**는 다른 개인 지정 메일과 동일하게 `[이름님] [결재 요청] {제목}` 형식(2026-08 변경) |
| stage_arrival | P | 담당자(claim) 지정 시 그 1명, 미지정 시 TE_P **팀 전원** |
| stage_arrival | PV/EV(검토자, 2026-07) | `approve-step/`(agent P/E)에 `reviewer_loginids`를 함께 보낼 때 지정된 검토자 각각에게 개별 발송(제목에 `[이름님]`) — RV와 동일하게 담당자 합의와 같은 시점(같은 요청)에 발송된다 |
| stage_arrival | J | 담당자(claim) 지정 시 그 1명, 미지정(도착 시점)이면 고정 주소 |
| stage_arrival | O / E | 해당 역할(`TE_O`/`TE_E`) **팀 전원** |
| revision_requested | MASK(E/EV) 담당자가 '수정 요청'을 누를 때 | **요청서 작성자 본인만**. 대상/비대상을 바꿀 수 있는 유일한 주체이기 때문. 결재 상태는 되돌아가지 않는다 |
| rejected | (반려) | 요청서 작성자 **+ 현재(최종) 회차에서 이미 합의했던 전원**(중복 제거) **+ 아래 반려 단계별 추가분**. 상세는 §3.1 참고 |
| approved | (완료) | **현재(최종) 회차 결재 경로에 참여했던 전원**(assignee 배정된 모든 단계, 중복 제거) — 2026-07부터 "작성자 그룹 멤버" 방식에서 변경 |
| notify_submitted | (상신·재상신) | **통보처 전원**(`detail.notifiers`) |
| notify_approved | (완료) | **통보처 전원**(`detail.notifiers`) |
| notify_p_arrival | (P 단계 도착, 2026-08 추가) | **TE_J 팀 전원** — 결재 권한과 무관한 참고 통보. P 단계 생성 시점(`_advance_to_parallel`)에 `stage_arrival`(P)과 같이 발송 |
| notify_p_completed | (P 단계 완료, 2026-08 추가) | **TE_O 팀 전원** — 결재 권한과 무관한 참고 통보. P 담당자+검토자(PV) 전원 합의가 끝나 J가 생성되는 시점(`_advance_after_p_review`)에 발송 |

### 3.1 반려(rejected) 수신자 상세 — 잔여 결재선 기준 (2026-07 개편)

반려 메일은 **항상** `작성자 + 현재 회차에서 이미 합의했던 전원`을 포함하고, 반려된 단계에 따라 아래를 더한다.

| 반려 단계 | 추가 수신자 |
|---|---|
| PL | 같은 회차의 아직 합의/반려하지 않은 **나머지 지정 PL(pending)**. PL 은 팀 브로드캐스트 대상이 아니라 지정된 당사자만 챙긴다. |
| 그 외 전부(R·RV·P·PV·O·E·EV·J·RA) | **아직 합의를 마치지 않은 결재선 단계의 담당 팀 전원**(`_remaining_stage_emails`). **반려한 본인은 제외**. |

**"잔여 결재선" 판정 방식** — '이후 단계'를 정적인 순서표로 정의하지 않고 **문서의 실제 상태**로 판정한다:

```
결재선(라우팅) 전체  −  이미 approved 된 단계  =  아직 합의를 마치지 않은 단계
                                                  (pending / 반려된 본인 / 아직 생성 안 된 미래 단계)
```

- **결재선(라우팅)**: 일반 문서 `R·RV·P·PV·O·E·EV·J·RA` / Only MAP 문서 `R·RV·RA`(P/O/E/J 없음). `E`계열은 `has_ppid_plel()`인 의뢰서에만 포함된다. PL 은 위 표대로 별도 규칙이라 이 라우팅에서 제외한다.
- **검토자(RV/PV/EV)**: 지정됐을 때만 생성되는 선택 단계라, 해당 step 이 실제로 없으면 결재선에 없는 것으로 본다. 이들은 각각 담당자와 같은 팀(`TE_R`/`TE_P`/`TE_E`) 소속이므로 팀 조회 한 번에 함께 잡히고, 기존 dedup 으로 **중복 발송되지 않는다**.
- **후결자(RA)**: 역할(role)로 판별되지 않으므로 팀 조회 대신 `post_approver_users()`(고정 후결자 + C가문 추가 후결자)로 예정자 전원을 구한다. 결재 단계 생성(`views`)과 같은 함수를 공유한다.

**이 방식의 이점**
- 병렬 단계(P·O·E·RA)가 서로 다른 속도로 진행돼도 누락이 없다. 예: **J 반려 시점에 O 가 아직 pending 이면 `TE_O` 팀 전원이 포함**된다(정적 순서표 방식에서는 J 가 O 보다 뒤 단계라 빠지던 케이스).
- **이미 일을 마친 팀에는 팀 전체 메일이 나가지 않는다.** 예: P 반려 시 O 가 이미 합의를 마쳤다면 `TE_O` 팀 전체가 아니라 **그 합의자 본인만** 기합의자 규칙으로 포함된다.

### 제목·본문 규칙 (2026-08 개편)
- **모든 메일 제목에 요청서 제목이 포함**된다(`_build_message`).
- **`stage_arrival` 제목은 모든 단계 공통으로 `{name_prefix}[결재 요청] {제목}` 형식**(2026-08부터 단계 접미사 `- {단계라벨}` 삭제). 단계 구분은 본문 KPI 카드의 "결재 단계" 타일로만 표시한다.
- **개인 지정 메일의 제목**은 맨 앞에 `[{이름}님] `이 붙는다(`recipient_name` 인자) — **지정 PL 전원**(`submit`/`resubmit` 시점) + **R 담당자**(`assign-step/`으로 지정된 순간) + **검토자 전원(RV/PV/EV)** + **추가 후결자(RA, 2026-08 추가)**가 대상이다.
  ⚠️ **P/O/E는 도착 시점에 항상 미배정 상태**(검토중 방식이라 `_advance_to_parallel`이 담당자 없이 단계를 만든 뒤 그 자리에서 곧바로 팀 전체에 발송하고, 나중에 누가 검토중을 눌러도 그 시점엔 메일이 다시 나가지 않는다)라 **P/O/E 본인 도착 메일은 개인화 대상이 아무도 없고 항상 팀 전원 브로드캐스트**다. R도 지정 전(도착 시점) 팀 전원 브로드캐스트인 것은 동일.
- **후결자(RA) 메일 제목**: 고정 후결자(`settings.POST_APPROVER_LOGINID`)는 `[후결 요청] {제목}` 고정 형식, 그 외(추가 후결자)는 위 공통 규칙대로 `[이름님] [결재 요청] {제목}` (2026-08 변경 — `mailer._is_fixed_post_approver()`가 `step.assignee.loginid`를 설정값과 비교해 판별).
- **본문 링크는 해당 문서 상세로 딥링크**된다(`_detail_link`): 진행 중 이벤트(`stage_arrival`/`rejected`/`revision_requested`/`notify_submitted`)는 `{FRONTEND_URL}/approval?id={문서ID}`, 완료 관련 이벤트(`approved`/`notify_approved`)는 `{FRONTEND_URL}/history?id={문서ID}`(완료 문서는 결재현황 목록에서 빠지므로). 프론트(`ApprovalPage.tsx`/`HistoryPage.tsx`)가 `?id=` 쿼리를 감지해 목록과 무관하게 그 문서를 직접 조회 후 상세 모달을 자동으로 연다.

### 본문 디자인 — 히어로 헤더 + KPI 카드 (2026-07 개편)
- 본문 HTML은 `_render_hero_kpi_email()`(공통 템플릿) + `_kpi_grid()`(2x2 타일)로 렌더링되며, 모든 이벤트 타입(`stage_arrival`/`rejected`/`revision_requested`/`approved`/`notify_submitted`/`notify_approved`/`notify_p_arrival`/`notify_p_completed`)이 이 템플릿을 공유한다.
- 구성: 솔리드 컬러 히어로(시스템명 + 이벤트 안내 문구) → 흰 카드(의뢰서 제목 + KPI 타일 4개: 결재 단계/의뢰자/상신일/생산 진행일) → **결재 경로 카드**(2026-07 추가, 아래 참고) → 특이사항(`reference_materials`) 카드 → CTA 버튼 → 푸터. 카드 바깥은 연한 색조 배경.
- **이벤트별 색상 테마**(`EVENT_THEME`): 히어로/버튼/카드 테두리/KPI 타일 배경을 이벤트 타입에 따라 통일된 팔레트로 분기한다.
  - `stage_arrival`: 블루 `#2563eb → #3b82f6`
  - `rejected`: 레드 `#dc2626 → #ef4444`
  - `approved`: 그린 `#16a34a → #22c55e`
  - `notify_submitted`/`notify_approved`/`notify_p_arrival`/`notify_p_completed`: 퍼플 `#7c3aed → #8b5cf6`
  - `EVENT_THEME`에 없는 이벤트 타입은 `stage_arrival`(블루) 테마로 대체된다.
- **결재 단계** 타일: `stage_arrival`은 `AGENT_LABEL`, 그 외 이벤트는 `EVENT_STATUS_LABEL`(반려/승인 완료/상신 통보/결재 완료 통보/P 단계 도착 통보/P 단계 완료 통보)을 표시한다.
- **생산 진행일**(`document.production_date`)과 **특이사항**(`document.reference_materials`, 상신 화면의 "특이사항" 입력값)은 값이 없으면 `-`로 표시한다.
- 사용자 입력이 들어가는 값(제목·의뢰자·특이사항)은 전부 `django.utils.html.escape()`로 이스케이프한다.
- Outlook 호환을 위해 `<table role="presentation">` 기반 레이아웃 + `bgcolor` 폴백 + `<!--[if mso]>` 조건부 주석을 사용한다(플렉스박스/그리드 미사용).
- VOC 메일(`_build_voc_message`)은 이번 개편 범위에서 제외 — 기존 `<p>` 기반 포맷 유지.

### 결재 경로 카드 (2026-07 추가)

메일만 보고도 누가 이미 합의했는지·왜 반려됐는지 알 수 있도록, 본문에 **현재(최종) 회차의 결재 경로**와 **단계별 의견**을 함께 싣는다. `_route_rows()`(데이터) + `_render_route_card()`(렌더) → `_render_hero_kpi_email()`이 KPI 카드와 특이사항 카드 사이에 삽입한다.

- **적용 범위**: 모든 결재 메일(`stage_arrival`/`rejected`/`approved`/`notify_submitted`/`notify_approved`). 공통 템플릿에 들어가므로 이벤트별 분기가 없다. 단계가 하나도 없으면(`_route_rows`가 빈 목록) 카드 자체를 넣지 않는다.
- **회차**: **현재(최종) 회차만.** 재상신 문서라도 이전 회차 이력·코멘트는 싣지 않는다. 카드 라벨에 `결재 경로 · N회차`로 회차를 명시한다.
- **표시 순서**(`ROUTE_DISPLAY_ORDER`): `PL → R → RV → RA → P → PV → J → O → E → EV`. 웹 '결재 경로' 탭과 같은 순서(검토자는 담당 단계 바로 뒤, 후결자는 R 다음)다. 다중 지정 PL 처럼 같은 단계가 여러 행이면 생성 순서(`id`)대로 모두 표시한다.
- **표시 항목**: 단계명 · 담당자 이름 · 상태 배지 (+ 코멘트). 처리일시·이메일·완료기한은 메일 폭(600px)을 고려해 넣지 않는다.
- **상태 판정**(`ROUTE_STATUS_STYLE`) — 상태 색은 의미를 담고 있어 `EVENT_THEME`과 무관하게 고정한다(웹 결재 경로 탭과 같은 팔레트).

  | 표시 | 조건 | 색 |
  |---|---|---|
  | 합의 | `action='approved'` | `#059669` |
  | 반려 | `action='rejected'` | `#dc2626` |
  | 검토중 | `action='pending'` + assignee 있음 | `#d97706` |
  | 대기 | `action='pending'` + 미배정, 또는 **step 미생성(예정)** | `#8794a6` |
  | 건너뜀 | `action='skip'` (EV OR 마감 — 다른 검토자가 먼저 합의) | `#8794a6` |

- **경로에서 빠지는 단계**: Only MAP 의뢰서의 `P·O·E·J`, `has_ppid_plel()`이 아닌 의뢰서의 `E·EV`는 행 자체를 만들지 않는다(라우팅은 반려 수신자 산출과 같은 `ROUTE_AGENTS_*` 상수를 재사용). 검토자(`RV/PV/EV`)는 지정됐을 때만 생성되는 선택 단계라 **step 이 없으면 '대기' 행도 만들지 않는다**(지정되지 않은 검토자를 예정 단계로 오해하지 않도록).
- **담당자 미지정**: `assignee_name`이 비면 `담당자 미지정`(`ROUTE_UNASSIGNED_LABEL`)으로 표시한다. 무배정 상태로 팀 전체에 브로드캐스트되는 P·O·E·J 도착 메일에서 자주 나타난다.
- **코멘트**: 코멘트가 있는 단계만 담당자 이름 아래에 인용 스타일로 붙인다(합의 의견·반려 사유·`[수정 후 상신]` 태그 전부). `ROUTE_COMMENT_MAX_LEN`(300자) 초과분은 잘라내고 `…`를 붙여 긴 사유가 본문을 밀어내지 않게 한다. 줄바꿈은 `white-space:pre-wrap`으로 살린다.
- **보안**: 단계명·담당자명·코멘트 모두 `escape()` 처리한다. Outlook 호환을 위해 `<table>`로만 조판하고 flex/grid를 쓰지 않는다.
- ⚠️ **운영 영향**: 지금까지 코멘트는 웹 '결재 경로' 탭에서만 보였으나, 이제 메일 수신자 전원(반려 메일이면 §3.1의 잔여 결재선 팀 전체)이 다른 사람의 합의 의견까지 함께 받는다. 코멘트에 민감한 내용을 적는 관행이 있다면 사전 안내가 필요하다.
- ✅ **(2026-07 해결) P/E 검토자(PV/EV) 메일에서 담당자 상태가 '검토중'으로 잘못 찍히던 버그**: P/E는 담당자 합의와 검토자(PV/EV) 지정을 한 요청(`approve-step/`)으로 함께 처리하는데(§ 위 표, `views.py _create_reviewers`), 기존 코드는 **검토자 step 생성 + 메일 적재(`enqueue_stage_arrival`)를 담당자 step의 `action='approved'` 저장보다 먼저** 실행했다. `_route_rows()`는 메일 적재 시점에 DB를 다시 조회하므로, 그 순간 담당자 step이 아직 `pending`으로 남아 있어 검토자에게 가는 메일의 결재 경로 카드에 담당자가 `검토중`으로(실제로는 이미 합의했는데도) 표시됐다. 담당자 step 저장 → 검토자 생성+메일 적재 순서로 바꿔 해결(`views.py approve_step`/`_validate_reviewers`/`_create_reviewers`). 검토자 유효성 검증은 여전히 담당자 저장 **전에** 수행해, 기존처럼 검증 실패 시 아무 것도 바뀌지 않는 안전장치는 그대로 유지했다.

### 통보처(Notifier) 알림 (2026-07 추가)
- **통보자**는 결재 권한이 없고, **상신·재상신 시**(`notify_submitted`)와 **결재 완료 시**(`notify_approved`) 메일만 받는다.
- 최초 상신 시 상신 모달에서 다중 지정하며 `additional_notes` JSON의 `detail.notifiers = [{loginid, name}]`에 저장된다.
- 수신자 해석(`resolve_notifier_recipients`): 저장된 `loginid`로 **발송 시점에** `UserProfile.mail`을 조회한다(이메일 stale 방지 — 이메일은 저장하지 않음). `.distinct()`로 **중복 제거**(같은 사람 중복 지정 시 1회만), `.exclude(mail='')`로 **이메일 미등록자는 제외**된다.
- 발송 연결: `views.submit`/`resubmit` → `enqueue_notify_submitted`, `approve_step` 최종 승인(Only-MAP R·J/O/E 전원) → `enqueue_notify_approved`.
- 통보처는 결재 경로에 포함되지 않으며, 상세 '결재 경로' 탭에 **별도 '통보처' 행**으로만 표시된다.
- **주소록(2026-07)**: 상신 모달의 '통보처 불러오기'는 주소록(`AddressBook`) 구성원을 `detail.notifiers`에 채우는 것뿐이라 발송 로직은 동일하다. 이메일 미등록자는 위 `.exclude(mail='')`로 자동 제외되므로, 상신 화면에서 인라인 경고로 미리 안내한다.

- 단계 → 역할 매핑: `AGENT_ROLE_MAP` (PL→PL, R→TE_R, P→TE_P, J→TE_J, O→TE_O, E→TE_E). 무배정 단계 도착 시 팀 브로드캐스트(`_team_emails`)뿐 아니라, R/RV 반려 시 `TE_R` 팀 전원 포함(2026-07 추가)에도 동일하게 쓰인다.
- J 미지정 고정 주소: `UNASSIGNED_FALLBACK` = `user_J@company.com` (R은 2026-07부터 팀 전원 브로드캐스트로 전환되어 고정 주소 사용 안 함)
- 이메일이 빈(`mail=''`) 사용자는 수신 대상에서 제외된다.
- `MAIL_REDIRECT_TO` 가 설정되면 위 결과를 무시하고 **전원 그 주소로 강제**(개발/검증용).

---

## 4. 결재 액션별 메일 발송 여부 총정리 (2026-07 정리)

`backend/api/views.py`의 모든 결재 관련 액션을 기준으로, 실제로 메일이 나가는지/안 나가는지를
전수 점검한 표. ✅=항상 발송 / 🟡=조건부(완료 시점에만) 발송 / ❌=현재 발송 안 함.

| 액션(엔드포인트) | 발송 | 내용 |
|---|:---:|---|
| `submit` / `resubmit` (상신·재상신) | ✅ | 지정 PL **전원**에게 stage_arrival(제목에 `[이름님]`, 2026-07 추가) + 통보처 전원에게 notify_submitted |
| `withdraw` (철회) | ❌ | 알림 없음 |
| `delete` (삭제) | ❌ | 알림 없음 |
| `approve-step` agent=R (담당자 합의) | ✅ | 검토자(RV)가 지정돼 있으면 RV에게, 없으면 병렬 전환되며 P·O·E·[RA 각각]에게 동시 발송(Only MAP 이고 후결자도 없으면 그 자리에서 즉시 approved 메일). **P 단계가 생성되면 TE_J에게 notify_p_arrival도 함께 발송(2026-08 추가)** |
| `approve-step` agent=RV (검토자 합의) | ✅ | 병렬 전환되며 P·O·E·[RA 각각]에게 동시 발송. **P 단계 생성 시 TE_J notify_p_arrival도 동일하게 발송** |
| `approve-step` agent=P/PV (PHPSI 담당자·검토자 합의) | 🟡 | 지정된 검토자(PV) **전원**까지 합의가 끝나야 **J에게** 발송(+**TE_O에게 notify_p_completed 동시 발송, 2026-08 추가**). 검토자가 아직 남아 있으면 이 합의 자체는 무메일(대신 아래 행처럼 검토자 지정 시 즉시 발송됨) |
| `approve-step` P/E 합의 + `reviewer_loginids`(검토자 지정) | ✅ | 지정된 검토자(PV/EV) **각각**에게 즉시(담당자 합의와 **같은 요청**으로 처리되므로 같은 순간 발송) |
| `approve-step` agent=J/O/E/EV/RA (병렬 경로 합의) | 🟡 | 이 합의로 **문서 전체가 approved 로 전이될 때만** approved(결재 경로 참여 전원) + notify_approved(통보처) 발송. 다른 경로가 아직 안 끝났으면 이 개별 합의는 **무메일**(침묵 — 예: J는 합의됐는데 O가 아직이면 알림 없음) |
| `reject-step` (어느 단계든 반려, PL 제외) | ✅ | rejected: 작성자 + 현재 회차 기합의자 전원 **+ 아직 합의를 마치지 않은 결재선 단계의 담당 팀 전원**(반려자 본인 제외, 2026-07 개편). §3.1 참고 |
| `assign-step` agent=R (담당자 지정) | ✅ | 지정된 R 담당자에게 발송. **같이 고른 검토자(RV)는 이 시점엔 무메일**(R 담당자가 합의하는 시점에 발송됨) |
| `claim-step` (검토중 선점, J/O/E/P) | ❌ | 선점(검토중 클릭) 자체는 알림 없음 |
| `request-pause` / `confirm-pause` / `resume` / `cancel-pause` (결재 중단 전 구간) | ❌ | 전 구간 알림 없음(기존에 알려진 범위 밖 항목) |
| `peer-approve` (PL 합의) | 🟡 | 지정 PL **전원**이 합의해야 R 생성 + R에게 발송. 아직 미합의 PL이 있으면 이 합의는 무메일 |
| `peer-reject` (PL 반려) | ✅ | rejected: 작성자 + 현재 회차 기합의자 전원 **+ 같은 회차의 미합의(pending) 나머지 지정 PL**(2026-07 추가) |
| `peer-submit` (PL 수정 후 상신) | 🟡 | `peer-approve`와 동일 조건 |
| `change-designee` (지정 PL 변경) | ✅ | 새로 지정된 PL에게 상신 시와 동일한 stage_arrival 발송(제목에 `[이름님]`, 2026-07 추가). 기존 지정자에게는 알림 없음 |
| `add-post-approver` (후결자 추가, 2026-07) | ✅ | 추가된 후결자에게 즉시 stage_arrival 발송(생성 시점과 동일). 고정 후결자와 중복 지정이 API에서 차단되므로 **이 경로는 항상 추가 후결자 형식**(`[이름님] [결재 요청] {제목}`, 2026-08 변경) |
| `remove-post-approver` (후결자 제거, 2026-07) | ❌ | 제거되는 후결자에게 별도 알림 없음(요청 범위 밖) |
| VOC 등록 / 댓글 | ✅ | §2 참고 |

⚠️ **잠재 확인 포인트**(현재 구현상 의도적인지 재확인 필요): `claim-step`·`remove-post-approver`·PAUSE 전 구간은
담당자/검토자가 바뀌거나 빠지는데도 메일이 전혀 나가지 않는다
(`change-designee`는 2026-07부터 새 지정자에게 발송되도록 해결됨, 후결자 추가도 동일하게 해결됨).

---

## 5. 환경 변수 (.env)

| 변수 | 의미 | 예시 |
|------|------|------|
| `DXHUB_MAIL_URL` | DXHUB 호스트 (뒤에 `/api/public/gateway/mail/send` 자동 부착) | `https://dxhub-host` |
| `DXHUB_API_KEY` | `X-API-Key` 헤더 값 | `(비밀)` |
| `FRONTEND_URL` | 메일 본문 링크용 웹 주소 (`/approval` 자동 부착) | dev `http://localhost:10011` / 운영 `https://...:10010` |
| `MAIL_REDIRECT_TO` | 설정 시 모든 메일을 이 주소로 강제 | dev `wooyoung7.oh@company.com` / 운영 공란 |

> ⚠️ `DXHUB_API_KEY` 등 비밀값은 **실제 `.env` 파일에만** 넣는다(코드/예시 파일 하드코딩 금지).
> `.env` 는 `.gitignore` 에 포함되어 커밋되지 않는다.

---

## 6. DXHUB 호출 (`_send_via_dxhub`)

```
POST {DXHUB_MAIL_URL}/api/public/gateway/mail/send
headers: { "X-API-Key": DXHUB_API_KEY }
json:    { "to": [...], "subject": "...", "contents": "<p>...</p>" }
verify=False, timeout=10
```

- 사내 self-signed 인증서 대응으로 `verify=False`(경고 억제). 4xx/5xx 시 예외 →
  재시도 대상이 된다.

---

## 7. 개발 환경 검증

dev 에서도 결재를 진행하면 **커밋 직후 즉시 발송**(하이브리드)되므로 거의 실시간으로
메일이 나간다(on_commit 은 스케줄러와 무관하게 동작). 추가로 `SKIP_SCHEDULER=true`
환경에서도 외부 DB 가 필요 없는 **메일 큐 발송 잡(재시도 안전망)은 자동 실행**된다
(`apps.py` → `scheduler.start_mail_only`, 1분 주기).

즉시 발송 실패분을 바로 재시도하거나 수동으로 큐를 비우려면:

```bash
docker exec -it <backend_container> python manage.py process_mail_queue
```

- `MAIL_REDIRECT_TO=wooyoung7.oh@company.com` 설정 시 모든 메일이 해당 주소로 발송된다.
- 적재/발송 상태는 Django Admin 의 **결재 알림 메일** 목록에서 확인할 수 있다.

> 스케줄러 동작 정리: SKIP_SCHEDULER=true → DCQ 동기화 OFF / 메일 발송 ON.
> SKIP_SCHEDULER 미설정(운영) → 둘 다 ON.

---

## 8. 테스트

```bash
docker exec -it <backend_container> python manage.py test api.tests
```

`api/tests.py` — 수신자 해석(단계별/리다이렉트), 큐 적재, 발송 성공·재시도·중복방지
(외부 호출 mock).

---

*메일 로직이 바뀌면 이 문서를 반드시 함께 갱신한다.*
