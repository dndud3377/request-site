# MASK(E) 2차 검토자 필수 지정 + 되감기 시 검토자 초기화 Implementation Plan

> **For agentic workers:** 이 계획은 task 단위로 구현한다. 단계는 체크박스(`- [ ]`)로 추적한다.

**작성일:** 2026-08-05
**Base:** `woobin` = `origin/main` (`a235384`)

---

## 이 문서와 2026-07-30 계획의 관계

`docs/superpowers/plans/2026-07-30-mask-second-reviewer-required.md` 가 같은 주제를 이미 계획했으나 **구현되지 않았다**(체크박스 전부 미완료, 2026-08-05 브라우저 재현으로 미구현 확인). 이 문서가 그 계획을 **대체**한다.

바뀐 점 — 그 계획 이후 `_rewind_e_stage`(2026-08-04, Validation System 되감기)가 추가되면서 **되감기 시 검토자 지정을 초기화한다**는 요구사항이 새로 생겼다. 이것이 이번 범위에 추가됐다.

이어받는 것 — 2026-07-30 문서의 **"검토했다가 기각한 대안" 표는 그대로 유효하다.** 다시 제안하지 말 것. 특히:
- `_stage_reviewers_complete()`를 "EV 0개면 미완료"로 바꿔 **소급 강제** → 기존 문서가 영구 승인 불가
- 백필 커맨드로 EV step 소급 생성 → 누구를 지정할지 시스템이 알 수 없음
- "2차 검토자 지정" 전용 API 신설 → 한 번의 합의로 처리하는 기존 UX를 깸
- 프론트만 / 백엔드만 막기 → 각각 우회 가능 / 나쁜 UX
- `_create_reviewers()` 내부 검증 → 쓰기 경로 한가운데라 부분 커밋 발생
- P 단계(`PV`)도 함께 필수화 → 요청 범위 밖

---

## Goal

MASK(E) 담당자가 합의할 때 **2차 검토자(EV)를 1명 이상 반드시 지정**하게 하고, 상신자가 Validation System 값을 바꿔 E 단계가 되감길 때 **기존 검토자 지정을 초기화**한다.

## 배경 — 사용자 요청 3건 중 이것만 실제 작업 대상

2026-08-05 세션에서 요청 3건을 조사한 결과:

| 요청 | 결론 |
|---|---|
| 1. 상신자 본인만 Validation System 전환 가능 | **이미 구현됨** — 브라우저 E2E 확인 완료. 코드 변경 없음 |
| 2. 마스크팀은 전환 불가 | **이미 구현됨** — UI에 토글 없음 + API 403 확인. 코드 변경 없음 |
| 3. 검토자 미지정 시 합의 차단 | **미구현 — 이 계획의 대상** |

1·2번 확인 근거는 아래 "부록 A".

## Architecture

새 엔드포인트·새 모델 필드·마이그레이션 **없다**. 기존 `approve-step` 요청(`agent='E'`)의 `reviewer_loginids`를 **필수 입력으로 승격**한다. 백엔드가 최종 방어선(400)이고, 프론트는 버튼 비활성 + 안내로 애초에 못 누르게 한다. 되감기는 `_rewind_e_stage`에서 EV step을 **삭제**하도록 바꾼다.

**`_stage_reviewers_complete()`의 하위호환 분기는 건드리지 않는다** — 이미 검토자 없이 E 합의를 마친 기존 문서가 영구 정지되지 않아야 하기 때문(2026-07-30 문서 "하위호환" 절 참조).

## Tech Stack

React 18.2 + TypeScript 4.9.5(strict) / Django 4.2.13 + DRF 3.15.1 / MySQL 8.0 / react-i18next 14.1.0

---

## 확정된 결정 (2026-08-05 사용자 인터뷰)

| # | 질문 | 결정 |
|---|---|---|
| Q2 | 검토자 필수화 범위 | **E(마스크)만.** P 단계는 지금대로 선택 사항 |
| Q3 | 마스크팀 담당자 1명뿐인 상황이 있나 | **없음.** 후보 0명 예외 경로 불필요 |
| Q4 | 서버에서도 막을지 | **프론트 + 서버 둘 다.** `approve_step`에서 400 |
| — | 되감기 시 기존 검토자 처리 | **초기화(EV step 삭제).** 재합의 시 검토자를 다시 지정 |
| — | 되감기 이력·메일 처리 | **고려하지 않는다** — 해제 사실을 comment에 남기지 않고, 해제된 검토자에게 취소 메일도 보내지 않는다 |
| — | 배포 시점에 이미 되감긴 기존 문서 | **ⓑ 조건 한 줄로 자동 흡수** — 기존 EV step이 있으면 `reviewer_loginids` 없이도 통과 |

### 되감기 초기화가 필요한 이유 (반드시 세트로 구현)

`_rewind_e_stage`(`views.py:1457`)는 현재 EV step을 **삭제하지 않고 `action`만 `pending`으로 되돌린다**(지정 이력 보존 목적, `views.py:1462`).

이 상태에서 "검토자 미지정이면 합의 금지"만 넣으면 **문서가 잠긴다**:

1. E 담당자가 김E를 검토자로 지정하고 합의 → EV step 생성
2. 상신자가 Validation System 변경 → E와 EV가 `pending`으로 되감김, **EV step은 살아남음**
3. E 담당자가 재합의하러 들어옴 → 화면의 `reviewerSelectedIds`는 빈 배열
4. 드롭다운 후보에서 김E는 **제외됨**(`ApprovalPage.tsx:1616` — 기존 검토자 제외 필터)
5. → 고를 사람도 없고, 안 고르면 합의도 못 함 = **영구 잠금**

되감기 시 EV를 삭제하면 김E가 후보에 다시 나타나므로 이 잠금이 발생하지 않는다.

---

## Global Constraints

- **범위(규칙 H):** P 단계(`PV`)·R 단계(`RV`)는 **절대 함께 바꾸지 않는다.** EV(검토자 본인의 합의)에도 이 규칙을 걸지 않는다.
- ⚠️ **`@transaction.atomic`은 예외에만 롤백한다.** `return Response(400)`은 롤백되지 않는다. **검증은 반드시 어떤 쓰기보다 먼저** 수행한다.
- **i18n(규칙 G):** `ko.json` / `en.json`에 **같은 키를 반드시 동시에** 추가한다. 하드코딩 금지.
- **타입(규칙 I):** `any` 금지. 매직 스트링은 상수로. `console.log`·dead code 금지.
- **커밋(규칙 E):** 빌드가 깨지지 않는 최소 단위로 파일별 커밋(`ko.json`+`en.json`은 한 커밋).
- 커밋 메시지 말미:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  ```

---

## File Structure

**수정 (백엔드)**
- `backend/api/views.py` — `approve_step`에 E 전용 필수 검증 추가(쓰기 이전 위치) + `_rewind_e_stage`에서 EV step 삭제
- `backend/api/tests.py` — 신규 테스트

**수정 (프론트엔드)**
- `frontend/src/pages/ApprovalPage.tsx` — E 단계일 때 합의 버튼 비활성 + 안내 문구
- `frontend/src/locales/ko.json`, `frontend/src/locales/en.json` — 신규 키 1개

**수정 (문서)**
- `docs/APPROVAL.md` — Case G / Case K-3 갱신

**신규 파일 없음. 마이그레이션 없음.**

---

## Task 1: 백엔드 — E 합의 시 2차 검토자 필수 검증

**파일:** `backend/api/views.py`

### 1-1. 검증 위치

`approve_step`(`views.py:452`) 안, **`if agent in ('P', 'E'):` 검토자 생성 블록 직전**(`views.py:510` 부근)에 삽입한다. 이 지점까지는 아직 어떤 쓰기도 없어서 400 반환이 부분 커밋을 남기지 않는다.

- [ ] 삽입할 검증:

```python
        # E(MASK) 담당자 합의에는 2차 검토자(EV) 지정이 필수다 — MASK 검증은 2인 확인 절차라서
        # 담당자 혼자 합의로 단계를 넘길 수 없다. (P 단계의 PV 는 지금까지대로 선택 사항이다.)
        #
        # 여기(어떤 쓰기보다 먼저)에서 걸러야 한다 — @transaction.atomic 은 예외에만 롤백하므로
        # 검토자 생성 이후에 400 을 반환하면 그 쓰기가 커밋된 채 응답만 실패한다.
        #
        # 이 규칙은 앞으로의 합의에만 적용된다. 이미 검토자 없이 E 합의를 마친 기존 문서는
        # _stage_reviewers_complete() 의 하위호환 분기로 그대로 승인될 수 있어야 한다
        # (E 단계가 이미 approved 라 검토자를 지정할 경로가 없어, 소급 적용하면 영구 정지된다).
        if agent == 'E':
            requested_reviewers = [
                str(lid or '').strip() for lid in (request.data.get('reviewer_loginids') or [])
            ]
            # 이 배포 이전에 되감겨(구 _rewind_e_stage) EV step 이 살아남은 문서를 흡수한다.
            # 새 로직에서는 되감기가 EV 를 삭제하므로 이 분기는 기존 문서에만 걸린다.
            has_existing_reviewer = ApprovalStep.objects.filter(
                document=document, agent='EV', round=max_round
            ).exists()
            if not any(requested_reviewers) and not has_existing_reviewer:
                return Response(
                    {'error': '2차 검토자를 1명 이상 지정해야 합니다.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
```

**주의:**
- `agent == 'E'` 에만 건다. `agent == 'EV'`(검토자 본인의 합의)에는 걸지 않는다.
- 검토자의 **유효성**(팀 소속·본인 지정 금지·중복)은 기존 `_validate_reviewers()`(`views.py:822`)가 이미 쓰기 전에 전부 검증한다. **중복 검증하지 않는다.**

### 1-2. 되감기 시 EV 초기화

`_rewind_e_stage`(`views.py:1457`)에서 EV step을 되돌리는 대신 **삭제**한다.

- [ ] 현재 코드(`views.py:1484-1487`)의 EV 루프를 삭제로 교체:

```python
        _append(e_step)
        # 값이 바뀌었으니 MASK 검증을 처음부터 다시 한다 — 검토자 선정도 그 '처음'에 포함된다.
        # step 을 남겨 두면(구 동작) 그 검토자가 재지정 후보에서 제외된 채 남아,
        # '검토자 필수' 규칙과 맞물려 담당자가 아무도 고를 수 없는 잠금이 된다.
        ApprovalStep.objects.filter(
            document=document, agent='EV', round=round_no
        ).delete()
        return True
```

**주의:**
- 삭제 대상은 그 회차 EV **전부**다(`approved`만이 아니라 `pending`도). 구 로직은 `action='approved'`만 되돌렸지만, 초기화는 상태와 무관해야 재지정이 깨끗하다.
- docstring의 "EV step 은 삭제하지 않고 action 만 되돌려 지정 이력을 보존하고" 문장을 새 동작에 맞게 고친다.
- 해제 사실을 comment에 남기지 않는다(사용자 결정).

### 1-3. 테스트

`backend/api/tests.py`의 `PEStageReviewerFlowTest`(`tests.py:819`)에 추가한다. `_advance_to_parallel(plel=True)` 헬퍼로 E pending 상태를 만들 수 있고, `_approve_e(doc, reviewers=...)`(`tests.py:1144`)가 선점+합의를 처리한다.

- [ ] `test_e_approve_without_reviewer_is_rejected`
      — E 선점 후 `reviewer_loginids` 없이 `approve-step`(agent='E') → **400**.
      E step이 여전히 `pending`, EV step 0개, 문서 status `under_review` 그대로인지 함께 단언.
- [ ] `test_e_approve_with_empty_reviewer_list_is_rejected`
      — `reviewer_loginids: []` 및 `['  ']`(공백만) → **400**.
- [ ] `test_e_approve_with_reviewer_succeeds`
      — 검토자 1명 지정 → 200, EV step 1개 생성, E step `approved`.
- [ ] `test_p_approve_without_reviewer_still_allowed`
      — P 단계는 검토자 없이 합의해도 **200** (범위 밖임을 고정하는 회귀 테스트).
- [ ] `test_rewind_deletes_ev_steps`
      — 검토자 지정 후 E 합의 → 상신자가 `validation-system` 변경 → **EV step이 0개**이고 E step은 `pending`인지 단언.
- [ ] `test_e_reapprove_after_rewind_requires_reviewer_again`
      — 되감긴 뒤 `reviewer_loginids` 없이 재합의 → **400**, 같은 검토자를 다시 지정하면 **200**.
- [ ] `test_e_approve_passes_when_legacy_ev_step_exists`
      — ORM으로 E `pending` + EV step 1개인 상태를 만든 뒤 `reviewer_loginids` 없이 합의 → **200**(ⓑ 흡수 분기 회귀 테스트).
- [ ] `test_legacy_e_approved_without_reviewer_still_completes`
      — E step이 `approved` + EV 0개인 문서에서 남은 J/O/RA 합의로 문서가 `approved`까지 가는지(하위호환 유지 회귀 테스트).

### 1-4. Task 1 완료 판정

```bash
cd /Users/mac_wb/codespace/request-site/backend && \
  PYTHONPATH=/tmp/e2e/stubs DJANGO_SETTINGS_MODULE=test_settings \
  /tmp/e2e/venv/bin/python manage.py test api.tests.PEStageReviewerFlowTest -v 2
```

**성공 기준:** 신규 전부 통과, 이 클래스에서 실패 0건. 기존 `PEStageReviewerFlowTest` 중 **검토자 없이 E를 합의하던 테스트가 있으면 깨진다** — 새 규칙에 맞게 `reviewer_loginids`를 넘기도록 고치고 무엇을 왜 고쳤는지 보고한다. **테스트를 삭제하거나 단언을 약화시키지 않는다.**

---

## Task 2: 프론트엔드 — 검토자 미지정 시 합의 버튼 비활성 + 안내

**파일:** `frontend/src/pages/ApprovalPage.tsx`, `frontend/src/locales/ko.json`, `frontend/src/locales/en.json`

### 2-1. i18n 키 (ko/en 동시 추가)

`approval` 하위에 1개 추가한다.

- [ ] `ko.json`:
```json
"reviewer_required_hint": "2차 검토자를 1명 이상 지정해야 합의할 수 있습니다."
```
- [ ] `en.json`:
```json
"reviewer_required_hint": "Select at least one second reviewer to approve."
```

> 2026-07-30 계획에 있던 `reviewer_required_empty`("지정 가능한 검토자가 없습니다")는 **넣지 않는다** — Q3에서 마스크팀 1인 상황이 없음이 확인돼 죽은 코드가 된다.

### 2-2. 판정값

`reviewerPickStep` / `existingReviewerLoginids` 계산부(`ApprovalPage.tsx:1126-1132`) 바로 아래에 삽입한다. **라인 번호는 참고값이므로 Read로 식별자를 찾아 실제 위치를 확인한 뒤 삽입한다.**

- [ ] 판정값 추가:

```tsx
          // MASK(E) 는 2차 검토자 1명 이상 지정이 필수다 — 아직 아무도 없으면 '합의'를 막는다.
          // (P 단계의 검토자는 선택 사항이라 이 판정에서 제외된다.)
          // existingReviewerLoginids 를 함께 보는 이유: 이 배포 이전에 되감겨 EV step 이
          // 살아남은 문서에서, 후보에서 제외된 그 검토자 때문에 잠기지 않게 한다.
          const needsReviewerPick = reviewerPickStep?.agent === 'E'
            && reviewerSelectedIds.length === 0
            && existingReviewerLoginids.length === 0;
```

### 2-3. 합의 버튼

'일반 단계 액션'의 합의 버튼(`ApprovalPage.tsx:1640-1646`, `onClick={() => triggerAgree(actableStep.agent)}` 쪽 — PL 단계용 버튼이 아니다)에 반영한다.

- [ ] 버튼 수정:

```tsx
                  <button
                    className="btn btn-primary"
                    disabled={processing || needsReviewerPick}
                    onClick={() => triggerAgree(actableStep.agent)}
                  >
                    {t('approval.agree')}
                  </button>
```

**'수정 요청'(반려) 버튼은 건드리지 않는다** — 검토자 없이도 반려는 가능해야 한다.

### 2-4. 안내 문구

검토자 선택 UI 블록(`ApprovalPage.tsx:1570`의 `{reviewerPickStep && (`) 안, 드롭다운 `</div>` 아래에 렌더한다.

- [ ] 문구 추가:

```tsx
                      {needsReviewerPick && (
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                          {t('approval.reviewer_required_hint')}
                        </span>
                      )}
```

**주의:**
- 인라인 style은 이 파일의 기존 관례다. 새 CSS 클래스를 만들지 않는다.
- `handleConfirmAction`은 **수정하지 않는다** — 버튼 비활성으로 막히고, 서버 400은 기존 에러 토스트 경로를 탄다.

### 2-5. Task 2 완료 판정

```bash
# base 를 먼저 측정한다 (변경 전 stash 하거나 origin/main 체크아웃 상태에서)
cd /Users/mac_wb/codespace/request-site/frontend && npx tsc --noEmit 2>&1 | grep -c "error TS"
# 변경 후 같은 명령 → 두 숫자가 같아야 통과 (base 는 2026-08-05 기준 20건 이상)

# i18n 키가 양쪽에 다 들어갔는지
grep -c "reviewer_required_hint" src/locales/ko.json src/locales/en.json   # 둘 다 1
```

**성공 기준:** tsc 오류 **증가 0**, i18n 키가 `ko.json`/`en.json` 양쪽에 각 1건.

---

## Task 3: 문서 최신화 (규칙 C-4)

**파일:** `docs/APPROVAL.md`

- [ ] **Case K-3**(`docs/APPROVAL.md:174`, "P/E 검토자 지정") — E는 검토자 지정이 **필수**, P는 선택임을 명시. 검증 위치(쓰기 이전)와 이유(부분 커밋 방지)를 한 줄로 남긴다.
- [ ] **Case G**(`docs/APPROVAL.md:116`, 최종 합의) — `_stage_reviewers_complete`의 "검토자 없으면 담당자 합의만으로 완료" 하위호환 분기를 **일부러 남겼다**는 것과 그 이유를 적는다.
- [ ] **Validation System 되감기 서술** — 되감기 시 EV step이 **삭제**되어 검토자를 다시 지정해야 한다는 것과, 그것이 '검토자 필수' 규칙과 세트인 이유를 적는다.
- [ ] **운영 요건** — `TE_E` 역할 사용자가 **2명 이상**이어야 E 단계를 넘길 수 있다(담당자 본인은 검토자로 지정 불가).

**하지 말 것:** `docs/FIX_PROGRESS.md`는 날짜가 박힌 완료 이력 로그다. 건드리지 않는다.

### 검증

```bash
grep -rn "검토자" docs/APPROVAL.md          # E 를 '선택'으로 읽히게 쓴 문장이 0건이어야
grep -rn "2차 검토자" docs/APPROVAL.md      # 최소 3곳 매치
```

---

## Task 4: 전체 검증 (규칙 C)

- [ ] 백엔드 전체 테스트 — 아래 "로컬 테스트 환경" 참조
      **성공 기준:** 실패가 기존 베이스라인(3건)을 넘지 않을 것
- [ ] 프론트 테스트: `cd frontend && npm test -- --watchAll=false --passWithNoTests`
- [ ] `cd frontend && npx tsc --noEmit 2>&1 | grep -c "error TS"` — **base 대비 증가 0**
      ⚠️ base에 이미 20건 이상의 오류가 있다(누락 i18n 키 + `Set` 이터레이션). **먼저 base를 측정한 뒤 비교한다.**
- [ ] i18n 키 ko/en 병렬 확인 — 신규 키가 양쪽에 모두 있을 것
- [ ] `console.log` / dead code 잔존 0

### 알려진 베이스라인 실패 3건 (회귀 아님)

로컬(사내망 밖)에서 항상 실패한다. **이 3건 외 실패가 있으면 회귀다.**

- `HybridImmediateSendTest.test_enqueue_schedules_immediate_send_on_commit` (sqlite `on_commit`)
- `ExternalApiKeyAccessTest.test_wrong_key_returns_401` (미설정 API 키)
- `MessageBuildingTest.test_broadcast_subject_has_no_name_prefix` (라벨 마스킹)

---

## 로컬 테스트·개발 환경 (사내 Docker 이미지 없이 동작 — 2026-08-05 실행 검증 완료)

CLAUDE.md 규칙 C-1의 절차로 venv를 만들고, 브라우저 확인까지 가능한 개발 서버를 띄운다. **모든 임시 파일은 프로젝트 밖(`/tmp/e2e`)에 둔다.**

### 준비 (최초 1회)

CLAUDE.md 규칙 C-1의 pip 목록으로 `/tmp/e2e/venv` 생성 후, `/tmp/e2e/stubs/`에 아래를 둔다.

`datacenterquery.py` — 사내 모듈 스텁 (규칙 C-1과 동일)

`dev_settings.py`:
```python
from config.settings.base import *

DEBUG = True
AUTH_MODE = 'dev'
ALLOWED_HOSTS = ['*']
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': '/tmp/e2e/dev.sqlite3',
        'OPTIONS': {'timeout': 30},
    }
}
CORS_ALLOW_ALL_ORIGINS = True
EMAIL_BACKEND = 'django.core.mail.backends.locmem.EmailBackend'
```

`run_dev.py` — 런처:
```python
import os
import sys

sys.path.insert(0, '/Users/mac_wb/codespace/request-site/backend')
os.chdir('/Users/mac_wb/codespace/request-site/backend')

import django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'dev_settings')
django.setup()

# sqlite 는 스레드 동시 쓰기에서 'database is locked' 가 난다(운영 MySQL 에는 없는 제약).
from api import mailer
mailer._send_now_async = lambda *a, **k: None

from django.core.management import execute_from_command_line
execute_from_command_line(['manage.py', 'runserver', '0.0.0.0:8000', '--noreload'])
```

### 기동

```bash
# 백엔드 (:8000 — CRA package.json 의 proxy 대상)
PYTHONPATH=/tmp/e2e/stubs DJANGO_SETTINGS_MODULE=dev_settings \
  /tmp/e2e/venv/bin/python /tmp/e2e/stubs/run_dev.py

# 프론트 (:10011) — TS 에러 오버레이가 클릭을 가로막으므로 두 플래그 필수
cd frontend && BROWSER=none PORT=10011 REACT_APP_AUTH_MODE=dev \
  TSC_COMPILE_ON_ERROR=true ESLINT_NO_DEV_ERRORS=true npm start
```

### 시드

`/tmp/e2e/stubs/seed_e2e.py` — plel 문서를 E pending까지 진행시킨다. **loginid는 `AuthContext.tsx:26 MOCK_USERS`의 username과 일치해야 한다**(dev 사용자 전환이 그 목록만 사용).

- 상신자 `pl_user`(김의뢰) / 지정 PL `pl_designee` / R `agent_r1`
- 마스크팀 담당자 `agent_e1`(정이이), 검토자 후보 `agent_e2`(김E)·`agent_e3`(이E)
- 문서: `status='under_review'`, `PL/R approved`, `P/O/E pending`, `jayerRows=[{'pp':'PLEL'}]`

`/tmp/e2e/stubs/seed_e2e.py` 전문 (`/tmp`는 초기화될 수 있으므로 여기 보존한다):

```python
import json

from rest_framework.test import APIClient

from api.models import RequestDocument, ApprovalStep, UserProfile
from api import mailer

# sqlite 스레드 동시 쓰기 잠금 회피 (운영 MySQL 에는 없는 제약)
mailer._send_now_async = lambda *a, **k: None

ApprovalStep.objects.all().delete()
RequestDocument.objects.all().delete()
UserProfile.objects.all().delete()

USERS = [
    ('pl_user', '김의뢰', 'PL'),        # 상신자 역할로 사용
    ('agent_r1', '이검토', 'TE_R'),
    ('agent_p1', '원이', 'TE_P'),
    ('agent_j1', '박제이', 'TE_J'),
    ('agent_o1', '최오이', 'TE_O'),
    ('agent_e1', '정이이', 'TE_E'),     # 마스크팀 담당자
    ('agent_e2', '김E', 'TE_E'),        # 마스크팀 검토자 후보
    ('agent_e3', '이E', 'TE_E'),
    ('master', '관리자', 'MASTER'),
    ('pl_designee', 'PL지정자', 'PL'),  # MOCK_USERS 에 없는 지정 PL
]
users = {
    loginid: UserProfile.objects.create(
        loginid=loginid, mail=f'{loginid}@company.com', username=name,
        deptname='테스트부서', role=role,
    )
    for loginid, name, role in USERS
}

client = APIClient()
REQUESTER = 'pl_user'

detail = {
    'detail': {'validation_system': 'NO', 'validation_system_submitted': 'NO'},
    'jayerRows': [{'pp': 'PLEL', 'layer': 'M1'}],
}
doc = RequestDocument.objects.create(
    title='E2E 검증용 의뢰서 (plel/Validation System)',
    requester=users[REQUESTER], requester_name='김의뢰',
    requester_email='pl_user@company.com', requester_department='테스트부서',
    product_name='PROD-E2E-1', status='draft',
    additional_notes=json.dumps(detail, ensure_ascii=False),
)

client.force_authenticate(user=users[REQUESTER])
print('submit:', client.post(f'/api/documents/{doc.id}/submit/',
                             {'designated_pl_loginid': 'pl_designee'}, format='json').status_code)

client.force_authenticate(user=users['pl_designee'])
print('PL approve:', client.post(f'/api/documents/{doc.id}/peer-approve/', {}, format='json').status_code)

client.force_authenticate(user=users['agent_r1'])
print('R assign:', client.post(f'/api/documents/{doc.id}/assign-step/',
                               {'agent': 'R', 'assignee_loginid': 'agent_r1',
                                'assignee_name': '이검토'}, format='json').status_code)
print('R approve:', client.post(f'/api/documents/{doc.id}/approve-step/',
                                {'agent': 'R', 'comment': ''}, format='json').status_code)

doc.refresh_from_db()
print('doc id =', doc.id, '/ status =', doc.status)
print('steps:', [(s.agent, s.action, s.round) for s in doc.approval_steps.all()])
```

실행:
```bash
cd /Users/mac_wb/codespace/request-site/backend && \
  PYTHONPATH=/tmp/e2e/stubs DJANGO_SETTINGS_MODULE=dev_settings \
  /tmp/e2e/venv/bin/python manage.py shell < /tmp/e2e/stubs/seed_e2e.py
```

**기대 출력:** 네 요청 모두 `200`, `steps: [('PL','approved',1), ('R','approved',1), ('P','pending',1), ('O','pending',1), ('E','pending',1)]`

### 겪은 함정

| 증상 | 원인 / 해결 |
|---|---|
| `database is locked` | `mailer._send_now_async`가 `on_commit`에서 스레드를 띄워 sqlite 동시 쓰기. 런처·시드에서 no-op 몽키패치 |
| 클릭이 안 먹힘 | CRA TS 에러 오버레이 iframe이 가로챔. `TSC_COMPILE_ON_ERROR=true ESLINT_NO_DEV_ERRORS=true` |
| `No module named 'config'` | 런처에서 `sys.path.insert` + `os.chdir` 필요 |
| dev 사용자 전환이 안 됨 | 백엔드 시드 loginid를 `MOCK_USERS.username`과 맞출 것 |

---

## 수동 브라우저 시나리오 (규칙 C-2-1)

프론트 렌더 테스트 인프라가 없으므로 **이 시나리오가 검증의 핵심**이다. 모두 **결재 현황 → 의뢰서 행 클릭 → 모달**에서 시작한다.

### A. E 담당자가 검토자 없이 합의 시도 (핵심)

1. `agent_e1`(정이이)로 전환 → 결재 현황 → 의뢰서 클릭
2. **'검토중'** 클릭 → 본인이 선점
3. 검토자를 **아무도 고르지 않은 상태**에서 하단을 본다
   - ✅ **성공:** '합의' 버튼이 **비활성(회색)** 이고, 검토자 드롭다운 옆에 "2차 검토자를 1명 이상 지정해야 합의할 수 있습니다." 문구가 보인다
   - ❌ **실패 신호:** '합의' 버튼이 눌리거나, 눌러서 코멘트 모달이 뜬다
4. **'수정 요청'** 버튼은 **여전히 활성**이어야 한다

### B. 검토자 지정 후 합의

1. A 상태에서 '검토자 선택' 드롭다운 → 김E 클릭
   - ✅ 칩(태그)이 생기고 '합의' 버튼이 **활성화**되며 안내 문구가 사라진다
2. '합의' 클릭 → 코멘트 모달 → 확인
   - ✅ **성공:** '결재 경로' 탭에 **검토자(EV) 단계가 대기로 추가**되고, E 담당자 단계는 합의로 바뀐다

### C. 되감기 후 재지정 (이번 변경의 핵심)

1. B 완료 상태에서 `pl_user`(김의뢰, 상신자)로 전환
2. 같은 의뢰서 → **J-ayer 정보** 탭 → Validation System 토글을 반대 값으로 클릭
   - ✅ "재검토로 되돌렸습니다" 류의 토스트
3. `agent_e1`(정이이)로 전환 → 같은 의뢰서 → '결재 경로' 탭
   - ✅ **성공:** **EV(김E) 행이 사라져 있다**
   - ❌ **실패 신호:** EV 행이 '대기'로 남아 있다 → 되감기 초기화 미적용
4. E 단계에서 '검토자 선택' 드롭다운을 연다
   - ✅ **성공:** **김E가 후보 목록에 다시 나타난다**
   - ❌ **실패 신호:** 목록이 비었거나 김E가 없다 → 이 상태면 문서가 잠긴 것이므로 즉시 중단하고 보고
5. 김E를 다시 고르고 '합의'
   - ✅ **성공:** 정상 처리되고 EV 단계가 다시 생성된다

### D. 2차 검토자 본인이 합의 (범위 확인)

1. `agent_e2`(김E)로 전환 → 같은 의뢰서 → '합의'
   - ✅ **성공:** 검토자 지정 UI 없이 바로 합의 가능 (EV 단계에는 이 규칙이 걸리지 않아야 한다)

### E. P 단계는 영향 없음 (회귀 확인)

1. `agent_p1`(원이)로 전환 → 같은 문서의 P 단계 '검토중' 선점 → 검토자 **선택하지 않고** '합의'
   - ✅ **성공:** 버튼이 활성이고 합의가 정상 처리된다
   - ❌ **실패 신호:** P 단계에서도 버튼이 비활성 → **범위 침범이므로 즉시 되돌린다**

### F. API 우회 차단 (서버 방어선)

브라우저 콘솔에서 `agent_e1` 로그인 상태로:
```js
await fetch('/api/documents/<id>/approve-step/', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json',
             'Authorization': `Bearer ${localStorage.getItem('access_token')}` },
  body: JSON.stringify({ agent: 'E', comment: '' }),
}).then(r => r.status)
```
- ✅ **성공:** `400`
- ❌ **실패 신호:** `200` → 서버 검증 미적용

---

## 잠재 이슈 / 주의사항 (규칙 C-3)

- **마이그레이션 없음.** 모델 변경이 없다.
- **`TE_E` 1인 조직에서 E 단계 봉쇄.** Q3에서 "그런 경우 없음"을 확인받았으나, 배포 전 `TE_E` 역할 사용자가 2명 이상인지 재확인한다.
- **기존 백엔드 테스트가 깨질 수 있다.** 검토자 없이 E를 합의하던 테스트는 400을 받게 된다. 단언을 약화시키지 말고 요청을 고친다.
- **되감기 초기화와 검토자 필수는 반드시 함께 배포한다.** 한쪽만 나가면 되감긴 문서가 잠긴다.
- **`docs/E2E_TEST_AND_BUGS.md`의 기존 E 시나리오**가 검토자 없이 합의하는 절차로 적혀 있으면 함께 고친다.

---

## 부록 A — 1·2번이 이미 구현돼 있다는 근거 (2026-08-05 E2E 확인)

이번 계획에서 **코드를 건드리지 않는** 이유다.

**1번 (상신자만 전환 가능)**
- `ApprovalPage.tsx:496` `canEditValidationSystem` — 상신자 본인 또는 MASTER만 `true`
- `PagedDetailView.tsx:741` `vsEditable = canEditValidationSystem && !!onValidationSystemChange && hasPlel`
- `views.py:1084` `update_validation_system` — `is_requester` 아니면 403
- 브라우저: 상신자로 J-ayer 정보 탭 → 토글 활성 → '대상' 클릭 → DB 반영 확인
  ```
  {'validation_system': 'YES', 'validation_system_submitted': 'NO',
   'validation_system_changed_by': '김의뢰', 'validation_system_changed_at': '2026-08-05T01:31:11'}
  ```

**2번 (마스크팀은 전환 불가)**
- 마스크팀(정이이/TE_E) 전환 시 `토글존재: false`, 읽기 전용 `ValidationSystemBadge('대상')`만 노출
- `POST /api/documents/2/validation-system/` → **403 `{"error":"권한이 없습니다."}`**
- 마스크팀도 "상신 시 비대상 → 현재 대상 · 김의뢰 변경" 안내는 볼 수 있다

---

## 부록 B — 이번 조사에서 발견한 별개 이슈 (규칙 K, 이 계획 범위 밖)

사용자에게 보고했고 **처리 방향 미정**이다. 이 계획에서 고치지 않는다.

| 발견 | 근거 | 상태 |
|---|---|---|
| 백엔드 테스트 3건 실패 | 위 "알려진 베이스라인 실패" 참조 | `.env` 부재 등 환경 차이 가능성 — **확인하지 못했음** |
| 프론트 TS 컴파일 에러 20건+ | i18n 키 타입 불일치 9건(`Navbar.tsx:227,231,235`, `GuidePage.tsx:216`, `Step2.tsx:124-132`, `Step3.tsx:201-209`), `downlevelIteration` 8건(`PagedDetailView.tsx:520`, `Step4.tsx:128`, `RequestPage/index.tsx:2102,2802,3364,3365`), null 할당 2건(`VOCPage.tsx:149,202`) | 프로덕션 빌드 영향 **확인하지 못했음** |

둘 다 `main`(`a235384`)에 이미 있던 것이다.
