# MAIL — 결재 알림 메일 (DXHUB)

> 작성일: 2026-06-12
> 목적: 결재 단계 도착·반려·완료 시 DXHUB 메일 API 로 알림을 보내는 기능의 동작을 기록한다.

- 발송 모듈: `backend/api/mailer.py`
- 큐 모델: `backend/api/models.py` `MailNotification`
- 큐 처리 잡: `backend/api/scheduler.py` `process_mail_queue` (1분 주기)
- 수동 발송 커맨드: `python manage.py process_mail_queue`
- 전이 연동: `backend/api/views.py` (각 결재 액션)

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
| stage_arrival | PL 검토 | 지정 PL **전원**(각 PL step의 `assignee.mail`, 다중 지정 시 각각 발송) |
| stage_arrival | R / P / J | 담당자 지정 시 그 1명, **미지정 시 단계별 고정 주소** |
| stage_arrival | O / E | 해당 역할(`TE_O`/`TE_E`) **팀 전원** |
| rejected | (반려) | 요청서 작성자 1명(`requester_email`) |
| approved | (완료) | 작성자가 속한 **모든 그룹**(`member_groups`)의 멤버 전원(중복 제거) |
| notify_submitted | (상신·재상신) | **통보처 전원**(`detail.notifiers`) |
| notify_approved | (완료) | **통보처 전원**(`detail.notifiers`) |

### 통보처(Notifier) 알림 (2026-07 추가)
- **통보자**는 결재 권한이 없고, **상신·재상신 시**(`notify_submitted`)와 **결재 완료 시**(`notify_approved`) 메일만 받는다.
- 최초 상신 시 상신 모달에서 다중 지정하며 `additional_notes` JSON의 `detail.notifiers = [{loginid, name}]`에 저장된다.
- 수신자 해석(`resolve_notifier_recipients`): 저장된 `loginid`로 **발송 시점에** `UserProfile.mail`을 조회한다(이메일 stale 방지 — 이메일은 저장하지 않음).
- 발송 연결: `views.submit`/`resubmit` → `enqueue_notify_submitted`, `approve_step` 최종 승인(Only-MAP R·J/O/E 전원) → `enqueue_notify_approved`.
- 통보처는 결재 경로에 포함되지 않으며, 상세 '결재 경로' 탭에 **별도 '통보처' 행**으로만 표시된다.

- 단계 → 역할 매핑: `AGENT_ROLE_MAP` (PL→PL, R→TE_R, P→TE_P, J→TE_J, O→TE_O, E→TE_E)
- R/P/J 미지정 고정 주소: `UNASSIGNED_FALLBACK`
  = `user_R@company.com` / `user_P@company.com` / `user_J@company.com`
- 이메일이 빈(`mail=''`) 사용자는 수신 대상에서 제외된다.
- `MAIL_REDIRECT_TO` 가 설정되면 위 결과를 무시하고 **전원 그 주소로 강제**(개발/검증용).

---

## 3. 환경 변수 (.env)

| 변수 | 의미 | 예시 |
|------|------|------|
| `DXHUB_MAIL_URL` | DXHUB 호스트 (뒤에 `/api/public/gateway/mail/send` 자동 부착) | `https://dxhub-host` |
| `DXHUB_API_KEY` | `X-API-Key` 헤더 값 | `(비밀)` |
| `FRONTEND_URL` | 메일 본문 링크용 웹 주소 (`/approval` 자동 부착) | dev `http://localhost:10011` / 운영 `https://...:10010` |
| `MAIL_REDIRECT_TO` | 설정 시 모든 메일을 이 주소로 강제 | dev `wooyoung7.oh@company.com` / 운영 공란 |

> ⚠️ `DXHUB_API_KEY` 등 비밀값은 **실제 `.env` 파일에만** 넣는다(코드/예시 파일 하드코딩 금지).
> `.env` 는 `.gitignore` 에 포함되어 커밋되지 않는다.

---

## 4. DXHUB 호출 (`_send_via_dxhub`)

```
POST {DXHUB_MAIL_URL}/api/public/gateway/mail/send
headers: { "X-API-Key": DXHUB_API_KEY }
json:    { "to": [...], "subject": "...", "contents": "<p>...</p>" }
verify=False, timeout=10
```

- 사내 self-signed 인증서 대응으로 `verify=False`(경고 억제). 4xx/5xx 시 예외 →
  재시도 대상이 된다.

---

## 5. 개발 환경 검증

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

## 6. 테스트

```bash
docker exec -it <backend_container> python manage.py test api.tests
```

`api/tests.py` — 수신자 해석(단계별/리다이렉트), 큐 적재, 발송 성공·재시도·중복방지
(외부 호출 mock).

---

*메일 로직이 바뀌면 이 문서를 반드시 함께 갱신한다.*
