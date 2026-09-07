# MAP_COMPLETION_MAIL — POP3 완료 알림 메일 ↔ MAP 목적 'NEW' 매칭

> 작성일: 2026-09-02
> 목적: POP3 메일함으로 도착하는 '완료 알림' 메일 제목을 결재현황의 MAP 목적 'NEW' 요청서와
> 자동으로 매칭해, 화면에 완료 확인 뱃지를 띄우는 기능의 동작을 기록한다.

- 매칭 로직: `backend/api/pop3_mail.py`
- 스케줄러 등록: `backend/api/scheduler.py` (`check_map_completion_mail`, 10분 주기)
- 신규 필드: `backend/api/models.py` `RequestDocument.mail_completion_matched` /
  `RequestDocument.is_map_type_new()`
- 프론트 표시: `frontend/src/pages/ApprovalPage.tsx`(결재현황) / `frontend/src/pages/HomePage.tsx`
  ('나의 의뢰 현황' 미리보기) — MAP 목적 컬럼에 뱃지 추가
- 테스트: `backend/api/tests.py` `MapCompletionMailMatchTest`

---

## 1. 무엇을, 왜

운영팀 메일함에 `[Smart] ... 완료 알림` 형태의 제목으로 생산/처리 완료 통보 메일이 도착한다.
이 메일 제목에는 대상 제품명(product_name)이 포함된다. 결재현황에 올라온 **MAP 목적이
'NEW'인 상신 문서** 중 이 제목에 자기 product_name이 포함된 것이 있으면, 그 문서가 실제로
완료됐다는 뜻이므로 화면에서 바로 알아볼 수 있도록 MAP 목적 컬럼에 완료 뱃지를 붙인다.

이 기능은 결재 상태(status)나 결재 경로에 관여하지 않는다 — **순수하게 화면 뱃지 하나만
켜는** 참고용 표시다.

## 2. 매칭 대상 문서

```
status in ('submitted', 'under_review', 'pause')     # draft·rejected·approved 제외
AND is_map_type_new()  == True                        # detail.map_type == 'NEW'
AND mail_completion_matched == False                   # 한 번 매칭되면 다시 확인 안 함
AND product_name != ''                                 # 빈 값은 항상 매칭 후보에서 제외
```

- `approved`(완료) 문서는 애초에 결재현황 목록에서 빠지므로 대상에서 제외했다(ApprovalPage.tsx
  `fetchDocs`가 `status !== 'approved'`로 이미 필터링, `docs/APPROVAL.md` §3.1 참고).
- `draft`(임시저장)·`rejected`(반려)는 아직/더 이상 진행 중인 문서가 아니므로 제외했다.
- `map_type`은 `additional_notes` JSON의 `detail.map_type`에 저장되는 값(`'NEW'`/`'CLONE'`/
  `'EXISTING'`/MAP삭제 전용 `'삭제'`)이라 DB 컬럼으로 직접 필터링할 수 없다 — Python 쪽에서
  후보 문서마다 `RequestDocument.is_map_type_new()`로 판정한다.

## 3. 메일 조회 (POP3)

`pop3_mail.fetch_completion_mail_subjects()`:

1. `.env`의 `MAIL_POP3_HOST` / `MAIL_POP3_USER` / `MAIL_POP3_PASSWORD`로 `poplib.POP3_SSL` 접속.
   셋 중 하나라도 없으면 경고 로그만 남기고 그 주기를 건너뛴다(기존 DCQ/RTDB 자격증명 조회
   함수와 동일한 관용구, `utils.get_dcq_credentials()` 참고).
2. 메일함 **전체**를 매 주기 다시 조회한다(단순함 우선 — 마지막 처리 지점 이후만 조회하는
   워터마크 방식은 두지 않았다). 본문은 필요 없으므로 `RETR` 대신 `TOP <n> 0`으로 **헤더만**
   받아온다.
3. `Subject` 헤더를 디코드해 `subject.startswith('[Smart]') and '완료 알림' in subject` 인
   것만 리스트로 모은다.
4. 예외가 나거나 접속 정보가 없으면 빈 리스트를 반환한다 — 이 경우 `check_map_completion_mail()`은
   그 주기를 조용히 건너뛴다(문서 매칭 시도 자체를 하지 않는다).
5. `finally`에서 항상 `server.quit()`으로 연결을 정리한다.

⚠️ **메일함이 매우 커지면(수천~수만 건) 10분마다 전체를 재조회**하므로 조회 시간이 늘어날 수
있다. 운영 중 체감되면 마지막 처리 지점(UIDL) 이후만 조회하는 방식으로 바꾸는 걸 검토한다.

## 4. 매칭 (순수 DB 로직)

`pop3_mail.match_map_completion_mail(subjects: list[str]) -> int`:

- §2의 후보 문서를 조회하고, 각 문서의 `product_name`이 `subjects` 중 **하나라도 부분 문자열로
  포함**되면 매칭으로 본다(`doc.product_name in subject`).
- 매칭되면 `mail_completion_matched = True`로 저장(`update_fields=['mail_completion_matched']`)하고
  로그를 남긴다. 이후 주기부터는 §2 조건(`mail_completion_matched == False`)에 의해 이 문서를
  다시 확인하지 않는다.
- POP3 I/O와 분리된 순수 함수라 실제 메일 서버 없이 문자열 리스트만으로 단위 테스트할 수 있다
  (`tests.py` `MapCompletionMailMatchTest`).

⚠️ **부분 문자열 매칭의 한계**: `product_name`이 짧거나 다른 제품명의 일부와 겹치면(예:
`"A1"`이 `"A12"`의 일부인 경우) 무관한 메일과 우연히 매칭될 수 있다. 실제 메일 제목 포맷을
운영하며 오탐이 발견되면 매칭 조건을 더 엄격하게(예: 구분자 기준 정확히 일치) 조정한다.

## 5. 스케줄러 등록

- `check_map_completion_mail` (10분 주기) — `backend/api/scheduler.py` `start()`에 등록.
- `HEAVY_SYNC_JOB_IDS`(외부 시스템에 붙는 무거운 동기화 잡 목록)에 포함되어 있어, 개발 환경
  (`SKIP_SCHEDULER=true`, `start_mail_only()`)에서는 **실행되지 않는다** — RTDB/DCQ 동기화
  잡들과 동일한 취급이다(`docs/SCHEDULER.md` 참고).
- 접속 실패 시 RTDB/DCQ처럼 별도 실패 알림 메일을 보내지 않는다 — 로그만 남기고 다음 주기를
  기다린다(이 기능 범위 밖).

## 6. 화면 표시

`ApprovalPage.tsx`(결재현황)와 `HomePage.tsx`('나의 의뢰 현황' 미리보기)의 **MAP 목적** 컬럼에,
`doc.mail_completion_matched === true`이면 텍스트 옆에 전용 뱃지(`badge-mail-complete`, 보라색,
`global.css`)를 붙인다. 문구는 `approval.map_mail_complete_badge`(ko: "완료" / en: "Complete"),
툴팁은 `approval.map_mail_complete_badge_tooltip`.

- 기존 문서 상태 뱃지(`StatusBadge`, `.badge-approved` 등)와 **혼동하지 않도록 별도 색상**을
  쓴다 — 이 뱃지는 결재 승인 여부와 무관하게, 완료 알림 메일에서 제품명을 확인했다는 뜻이다.
- 값은 목록 API 응답(`RequestDocumentListSerializer`)에 이미 포함돼 있으므로 프론트에서 별도
  조회가 필요 없다. `mail_completion_matched`는 읽기 전용(서버 스케줄러만 갱신) — API로 값을
  직접 바꿀 수 없다.

## 7. 환경 변수 (.env)

| 변수 | 의미 | 예시 |
|------|------|------|
| `MAIL_POP3_HOST` | POP3(SSL) 서버 호스트 | `pop.company.com` |
| `MAIL_POP3_USER` | 메일 계정 | `smart-notify@company.com` |
| `MAIL_POP3_PASSWORD` | 메일 계정 비밀번호 | `(비밀)` |

> ⚠️ 비밀값은 **실제 `.env` 파일에만** 넣는다(코드/예시 파일 하드코딩 금지). `.env`는
> `.gitignore`에 포함되어 커밋되지 않는다. 셋 중 하나라도 비어 있으면 이 기능은 조용히
> 아무 것도 하지 않는다(로그 경고만 남는다) — 결재 흐름 자체에는 영향이 없다.

## 8. 수동 검증 시나리오

실제 POP3 서버 접속은 이 원격 개발 환경에서 확인할 수 없으므로, 매칭 로직 자체는 §9의 자동
테스트로 검증했다. 화면 표시는 아래처럼 DB에 플래그를 직접 심어 확인한다.

1. **뱃지가 뜨는지 확인**
   1. MAP 목적이 'NEW'인 상신 문서(예: `product_name='PROD-1'`, `status='under_review'`) 1건을
      준비한다.
   2. Django shell 또는 admin에서 그 문서의 `mail_completion_matched`를 `True`로 바꾼다.
   3. 결재현황(`/approval`) 화면으로 이동 → 해당 문서 행의 **MAP 목적** 칸을 확인한다.
      → **기대 결과**: "NEW" 옆에 보라색 "완료" 뱃지가 붙어 있어야 한다. 마우스를 올리면
      "완료 알림 메일에서 이 제품명을 확인했습니다" 툴팁이 보여야 한다.
   4. 홈(`/`) 화면 '나의 의뢰 현황'에도 같은 문서가 뜨는 경우, 같은 칸에 동일한 뱃지가 보여야
      한다(내가 작성한 문서 또는 내 차례인 문서일 때만 노출).
2. **완료(approved)·반려(rejected)·임시저장(draft) 문서는 뱃지 대상이 아님**
   1. 위 세 상태의 문서에 `mail_completion_matched=True`를 심어도(테스트 목적으로만),
      결재현황 목록 자체가 approved를 이미 제외하고 보여주므로 실질적으로 뱃지가 노출되지
      않는다. → **실패로 보이는 신호**: 반려/임시저장 문서 목록에 이 뱃지가 보인다면 스케줄러
      매칭 대상 필터(§2)가 깨진 것이다.
3. **스케줄러 잡 등록 확인**(운영/스테이징, `.env` 3개 변수 설정 후)
   1. `scheduler` 서비스 로그에서 `check_map_completion_mail` 잡이 10분 주기로 등록·실행되는지
      확인한다(`docs/SCHEDULER.md` 로그 문구 참고).
   2. POP3 메일함에 `[Smart] PROD-1 완료 알림` 같은 제목의 메일이 있고, `product_name='PROD-1'`인
      MAP 목적 'NEW' 상신 문서가 있으면, 다음 주기 이후 결재현황에서 뱃지가 자동으로 붙는지
      확인한다.

## 9. 테스트

```bash
docker exec -it <backend_container> python manage.py test api.tests.MapCompletionMailMatchTest
```

`MapCompletionMailMatchTest` — 매칭/미매칭, 이미 매칭된 문서 재확인 안 함, MAP 목적이 'NEW'가
아닌 문서 제외, draft·rejected 상태 제외, 빈 제목 목록 조기 반환을 검증한다(POP3 접속 없이
순수 DB 로직만 테스트, 외부 서버 mock 불필요).

---

*이 기능이 바뀌면 이 문서와 `docs/SCHEDULER.md`(등록 잡 표) · `docs/APPROVAL.md`(MAP 목적
컬럼 설명)를 반드시 함께 갱신한다.*
