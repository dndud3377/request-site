# MAIL — 결재 알림 메일 (DXHUB)

> 작성일: 2026-06-12
> 목적: 결재 단계 도착·반려·완료 시 DXHUB 메일 API 로 알림을 보내는 기능의 동작을 기록한다.

- 발송 모듈: `backend/api/mailer.py`
- 큐 모델: `backend/api/models.py` `MailNotification`
- 큐 처리 잡: `backend/api/scheduler.py` `process_mail_queue` (1분 주기)
- 수동 발송 커맨드: `python manage.py process_mail_queue`
- 전이 연동: `backend/api/views.py` (각 결재 액션)

---

## 1. 아키텍처 (영속 큐 + 재시도)

```
결재 전이(상신/합의/반려/완료)
   └─ enqueue_*()  → MailNotification(status='pending') INSERT  (결재 트랜잭션 안)
                                  │
APScheduler 1분 주기 ─ process_mail_queue() ─ DXHUB API 발송
   성공 → status='sent'
   실패 → attempts += 1, 재시도 (max_attempts=5 도달 시 status='failed')
```

- **적재(enqueue)는 기존 결재 트랜잭션 안에서 INSERT 만 수행**한다. 외부 HTTP 가
  없으므로 문서 행 락(`select_for_update`)을 오래 점유하지 않고, 결재가 롤백되면
  메일 적재도 함께 롤백되어 일관성이 보장된다.
- **발송은 백그라운드**에서 분리 수행한다. DB 에 영속되므로 서버 재시작에도
  재시도 상태가 보존된다(가장 견고). 외부 API 장애가 결재 흐름에 영향을 주지 않는다.
- 동시 발송 방지: `process_mail_queue` 는 `max_instances=1`, 각 행은
  `select_for_update(skip_locked=True)` 로 점유 후 처리한다.

---

## 2. 수신자 규칙 (`mailer.resolve_*`)

| 이벤트 | 도착 단계 | 수신자 |
|--------|----------|--------|
| stage_arrival | PL 검토 | 지정 PL 1명(`designated_pl.mail`) |
| stage_arrival | R / P / J | 담당자 지정 시 그 1명, **미지정 시 단계별 고정 주소** |
| stage_arrival | O / E | 해당 역할(`TE_O`/`TE_E`) **팀 전원** |
| rejected | (반려) | 요청서 작성자 1명(`requester_email`) |
| approved | (완료) | 작성자가 속한 **모든 그룹**(`member_groups`)의 멤버 전원(중복 제거) |

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

dev 는 `SKIP_SCHEDULER=true` 라 APScheduler 가 뜨지 않는다. 큐를 수동으로 비워 검증한다.

```bash
docker exec -it <backend_container> python manage.py process_mail_queue
```

- `MAIL_REDIRECT_TO=wooyoung7.oh@company.com` 설정 시 모든 메일이 해당 주소로 발송된다.
- 적재/발송 상태는 Django Admin 의 **결재 알림 메일** 목록에서 확인할 수 있다.

---

## 6. 테스트

```bash
docker exec -it <backend_container> python manage.py test api.tests
```

`api/tests.py` — 수신자 해석(단계별/리다이렉트), 큐 적재, 발송 성공·재시도·중복방지
(외부 호출 mock).

---

*메일 로직이 바뀌면 이 문서를 반드시 함께 갱신한다.*
