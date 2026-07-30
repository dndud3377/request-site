# MASK(E) 2차 검토자 필수 지정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MASK 팀 결재(단계 `E`) 담당자가 '검토 완료'(합의)를 누를 때 **2차 검토자(`EV`)를 1명 이상 반드시 지정**하게 강제한다. 지정 없이는 E 단계를 넘길 수 없다.

**배경:** Validation System 도입(`docs/superpowers/plans/2026-07-30-validation-system.md`)으로 E 단계가 항상 생성되도록 바뀌었고, MASK 결재는 2단계 절차로 정의됐다 — ① 팀원 1명이 '검토중으로 전환'(claim)해 선점, ② 그 사람이 검토를 마치고 '검토 완료'를 누를 때 **다른 MASK 팀원 1명 이상을 2차 검토자로 지정**, ③ 2차 검토자까지 합의하면 E 단계 통과. 현재 ①과 ③의 게이트(`_stage_reviewers_complete`)는 구현돼 있으나 **②의 "1명 이상 필수"가 강제되지 않아**, 검토자 없이 담당자 합의만으로 E 단계가 통과된다. 이 계획은 그 구멍만 막는다.

**Architecture:** 새 엔드포인트도 새 모델 필드도 없다. 기존 `approve-step` 요청(`agent='E'`)의 `reviewer_loginids` 를 **필수 입력으로 승격**한다. 백엔드가 최종 방어선(400)이고, 프론트는 '합의' 버튼 비활성 + 안내 문구로 애초에 못 누르게 한다. **최종 승인 판정 로직(`_stage_reviewers_complete`)은 건드리지 않는다** — 이유는 아래 "하위호환" 참조.

**Tech Stack:** React 18.2 + TypeScript 4.9.5 (strict) / Django 4.2.13 + DRF 3.15.1 / MySQL 8.0 / react-i18next 14.1.0 / Jest (react-scripts 내장)

**선행 작업:** PR #336 (`feat/validation-system` → `main`). 이 계획은 그 브랜치 위에서 시작한다.

---

## Global Constraints

- **작업 브랜치:** `feat/validation-system` (커밋 `5f28e8b`) 을 base 로 새 브랜치를 딴다. PR #336 이 먼저 머지되면 `main` 기준으로 리베이스한다.
- **이 repo 는 마스킹된 코드베이스다.** 비즈니스 용어는 코드에서 중립 키로 쓰고, 실제 사내 용어는 `frontend/src/locales/ko.json` 값에만 둔다.
- ⚠️ **Bash 출력이 마스킹 훅에 의해 재작성될 수 있다.** 필드명·키워드는 반드시 **Read 도구로 파일 원문을 확인**한 뒤 코드에 반영한다. `grep` 결과만 믿지 않는다.
- ⚠️ **`@transaction.atomic` 은 예외에만 롤백한다.** `return Response(400)` 은 롤백되지 않는다. **검증은 반드시 어떤 쓰기보다 먼저** 수행한다(이 계획의 Task 1 핵심).
- **i18n (규칙 G):** 모든 화면 문구는 i18n 을 통한다. `ko.json` / `en.json` 에 **같은 키를 반드시 동시에** 추가한다. 하드코딩 금지.
- **타입 (규칙 I):** TypeScript `any` 금지. 매직 스트링은 상수로 분리. `console.log`·dead code 금지.
- **범위 (규칙 H):** **P 단계(`PV` 검토자)는 지금까지대로 선택 사항이다 — 절대 함께 바꾸지 않는다.** 이 계획에 없는 리팩토링을 하지 않는다.
- **커밋 (규칙 E):** "파일별 개별 커밋"은 **빌드가 깨지지 않는 최소 단위**로 해석한다(`ko.json`+`en.json` 은 한 커밋).
- **커밋 메시지 말미에 다음 줄을 넣는다:**
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  ```

### 하위호환 — 소급 적용하지 않는다 (중요)

`_stage_reviewers_complete()` (`backend/api/views.py:1076`) 는 "검토자가 하나도 없으면 담당자 합의만으로 완료"라는 하위호환 규칙을 갖고 있다. **이 규칙을 그대로 둔다.**

바꾸면 안 되는 이유: 이 배포 이전에 **이미 검토자 없이 E 담당자 합의를 마친 진행 중 문서**들이 있다. 그 문서들의 E 단계는 `approved` 이고 `EV` step 은 0개다. 여기서 "EV 0개면 미완료"로 판정을 바꾸면, 그 문서들은 **지정할 담당자가 없는 채로 영구히 승인되지 못한다**(E 단계가 이미 approved 라 다시 검토자를 지정할 경로가 없다).

따라서 새 규칙은 **"앞으로 일어나는 E 합의"에만** 적용된다. 이는 Validation System 작업에서 Codex 가 지적한 "소급 미적용" 문제와 같은 종류지만, 여기서는 **소급이 문서를 망가뜨리는 쪽**이라 반대 결론을 택한다. 이 판단을 Task 1 의 주석과 `docs/APPROVAL.md` 에 남긴다.

### 로컬 테스트 환경 (사내망·`.env.dev` 없이 백엔드 테스트 돌리기)

이 저장소의 dev docker 스택은 `.env.dev` 와 사내망이 있어야 뜬다. 둘 다 없는 환경에서는 아래처럼 임시 컨테이너를 만들어 sqlite 로 `api.tests` 를 돌린다. **이 파일들은 저장소에 커밋하지 않는다** — SDD 워크스페이스(`.superpowers/sdd/<plan-basename>/`, git-ignored)에 둔다.

1. 워크스페이스에 `sdd_test_settings.py`:
   ```python
   """SDD 로컬 검증 전용 설정 — sqlite 로 backend 테스트를 돌리기 위한 임시 오버라이드.
   사내 MySQL/.env.dev 없이 api.tests 를 실행하려는 목적이며 repo 에 커밋하지 않는다."""
   from config.settings.base import *  # noqa: F401,F403

   DATABASES = {
       'default': {
           'ENGINE': 'django.db.backends.sqlite3',
           'NAME': ':memory:',
       }
   }
   ```
2. 워크스페이스에 `datacenterquery.py` (사내 전용 패키지 스텁 — import 만 만족시키고 실제 호출되면 실패시켜, 테스트가 몰래 스텁에 의존하지 않게 한다):
   ```python
   """SDD 로컬 검증 전용 스텁 — 사내 전용 패키지 datacenterquery 의 import 만 만족시킨다.
   실제 호출되면 즉시 실패하게 두어, 테스트가 몰래 이 스텁에 의존하지 않게 한다."""


   def _unavailable(*args, **kwargs):
       raise RuntimeError('datacenterquery is stubbed for local SDD test runs')


   login = _unavailable
   getData = _unavailable
   getTokenTime = _unavailable
   ```
3. 컨테이너 기동 (`<repo>` 는 이 워크트리 절대경로, `<ws>` 는 위 두 파일이 있는 워크스페이스 절대경로):
   ```bash
   docker run -d --name reqsite_sdd_test2 -w /app \
     -v <repo>/backend:/app -v <ws>:/sdd \
     python:3.11-slim sleep infinity
   docker exec reqsite_sdd_test2 pip install -q -r /app/requirements.txt mozilla-django-oidc
   ```
   `mozilla-django-oidc` 는 `requirements.txt` 에 없지만 `settings/base.py` 가 import 하므로 따로 설치해야 한다.
4. 테스트 실행:
   ```bash
   docker exec reqsite_sdd_test2 sh -lc \
     'cd /app && PYTHONPATH=/sdd DJANGO_SETTINGS_MODULE=sdd_test_settings python manage.py test api'
   ```

이 경로로 돌린 결과에는 항상 환경 기인 실패 3건이 섞인다(Task 4 참조). 사내 환경 검증은 사용자 몫이다.

### 알려진 운영 제약

`_create_reviewers()` 는 **담당자 본인을 검토자로 지정하는 것을 금지**한다(`views.py:819`). 따라서 **`TE_E` 역할 사용자가 1명뿐이면 E 단계를 넘길 수 없게 된다.** 이는 의도된 제약(2인 확인 절차)이므로 코드로 우회하지 않는다. 대신 프론트에서 "지정 가능한 검토자가 없다"는 안내를 띄우고(Task 2), 문서에 운영 요건으로 적는다(Task 3).

---

## 검토했다가 기각한 대안

다시 제안하지 말 것. 각각 기각 사유가 확정돼 있다.

| 대안 | 기각 사유 |
|---|---|
| `_stage_reviewers_complete()` 를 "EV 0개면 미완료"로 바꿔 **소급 강제** | 이미 검토자 없이 E 합의를 마친 기존 문서가 **영구히 승인 불가**가 된다(E 단계가 `approved` 라 검토자를 지정할 경로가 없다). 위 "하위호환" 참조. |
| 백필 커맨드로 기존 문서에 EV step 소급 생성 | **누구를 2차 검토자로 지정할지 시스템이 알 수 없다.** 임의 지정은 결재 이력을 왜곡한다. |
| "2차 검토자 지정" 전용 API 신설 | 현재 UX 는 검토자 지정과 담당자 합의를 **요청 한 번**으로 처리한다(`_create_reviewers`). 엔드포인트를 늘리면 그 설계를 깨고 범위만 커진다. |
| 프론트에서만 막기(백엔드 무변경) | API 직접 호출로 우회 가능. 백엔드가 최종 방어선이어야 한다. |
| 백엔드만 막고 프론트 무변경(400 토스트로 안내) | 누를 수 있는 버튼을 눌렀는데 실패하는 UX. 버튼 비활성 + 사전 안내가 낫다. |
| `_create_reviewers()` 내부에서 "0명이면 에러" 검증 | 그 시점은 **쓰기 경로 한가운데**다. `@transaction.atomic` 은 예외에만 롤백하므로 400 반환이 부분 커밋을 남긴다 — Validation System 작업(`docs/superpowers/plans/2026-07-30-validation-system.md` Task 4)에서 실제로 발생해 커밋 `ab5a5d7` 로 고친 버그다. 검증은 쓰기 이전에 한다. |
| P 단계(`PV`)도 함께 필수화 | 요청 범위 밖(규칙 H). P 검토자는 지금까지대로 선택 사항이다. |

## File Structure

**수정 (백엔드)**
- `backend/api/views.py` — `approve_step` 에 E 전용 필수 검증 추가 (쓰기 이전 위치)
- `backend/api/tests.py` — 신규 테스트 5건

**수정 (프론트엔드)**
- `frontend/src/pages/ApprovalPage.tsx` — E 단계일 때 '합의' 버튼 비활성 + 안내 문구
- `frontend/src/locales/ko.json`, `frontend/src/locales/en.json` — 신규 키 2개

**수정 (문서)**
- `docs/APPROVAL.md` — Case G / Case K-3 갱신
- `docs/E2E_TEST_AND_BUGS.md` — 시나리오 항목 추가

**신규 없음. 마이그레이션 없음.**

---

## Task 1: 백엔드 — E 합의 시 2차 검토자 필수 검증

**파일:** `backend/api/views.py`, `backend/api/tests.py`

### 1-1. 검증 추가

`approve_step` (`views.py:430`) 안, **Validation System 화이트리스트 검사 직후 / `if agent in ('P', 'E'):` 검토자 생성 블록 직전**에 삽입한다. 이 위치가 중요하다 — 이 지점까지는 아직 어떤 쓰기도 없어서 400 반환이 부분 커밋을 남기지 않는다.

현재 코드 (`views.py:491-500` 부근):

```python
        validation_system = request.data.get('validation_system')
        if agent == 'E' and validation_system is not None and validation_system not in self.VALIDATION_SYSTEM_VALUES:
            return Response(
                {'error': '유효하지 않은 Validation System 값입니다.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # P/E 담당자 합의 시 함께 지정된 검토자(PV/EV) 생성 — ...
        if agent in ('P', 'E'):
```

두 블록 **사이에** 삽입:

```python
        # E(MASK) 담당자 합의에는 2차 검토자(EV) 지정이 필수다 — MASK 검증은 2인 확인 절차라서
        # 담당자 혼자 합의로 단계를 넘길 수 없다. (P 단계의 PV 는 지금까지대로 선택 사항이다.)
        #
        # 여기(어떤 쓰기보다 먼저)에서 걸러야 한다 — @transaction.atomic 은 예외에만 롤백하므로
        # 검토자 생성이나 값 반영 이후에 400 을 반환하면 그 쓰기가 커밋된 채 응답만 실패한다.
        #
        # 이 규칙은 앞으로의 합의에만 적용된다. 이미 검토자 없이 E 합의를 마친 기존 문서는
        # _stage_reviewers_complete() 의 하위호환 분기로 그대로 승인될 수 있어야 한다
        # (E 단계가 이미 approved 라 검토자를 지정할 경로가 없어, 소급 적용하면 영구 정지된다).
        if agent == 'E':
            requested_reviewers = [
                str(lid or '').strip() for lid in (request.data.get('reviewer_loginids') or [])
            ]
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
- 이 검증은 `agent == 'E'` 에만 건다. `agent == 'EV'`(2차 검토자 본인의 합의)에는 걸지 않는다 — 그때는 이미 EV step 이 존재한다.
- `has_existing_reviewer` 를 함께 보는 이유: 방어적. 어떤 경로로든 이미 EV step 이 만들어져 있다면 요청에 `reviewer_loginids` 가 없어도 통과시킨다.
- 검토자의 **유효성**(팀 소속·본인 지정 금지·중복)은 기존 `_create_reviewers()` 가 이미 생성 전에 전부 검증하고 error 문자열을 반환한다. **중복 검증하지 않는다.**

### 1-2. 테스트

`backend/api/tests.py` 의 `PEStageReviewerFlowTest` (`tests.py:789`) 에 추가한다. 이 클래스에는 `_advance_to_parallel(plel=False)` 헬퍼가 있어 실제 API 로 P/O/E pending 상태까지 만들 수 있다. E 단계는 `claim_step` 으로 선점한 뒤 `approve-step` 을 호출하는 흐름을 기존 테스트에서 그대로 참고한다.

- [ ] `test_e_approve_without_reviewer_is_rejected`
      — E 선점 후 `reviewer_loginids` 없이 `approve-step`(agent='E') → **400**.
      `ApprovalStep` 의 E step 이 여전히 `pending` 이고, EV step 이 0개이며, 문서 status 가 `under_review` 그대로인지 함께 단언한다.
- [ ] `test_e_approve_with_empty_reviewer_list_is_rejected`
      — `reviewer_loginids: []` 및 `reviewer_loginids: ['  ']`(공백만) → **400**.
- [ ] `test_e_approve_without_reviewer_does_not_apply_validation_system`
      — `validation_system: 'YES'` + 검토자 없음 → 400 이고, 문서 `additional_notes` 의 `detail.validation_system` 이 **바뀌지 않았는지** 단언(부분 커밋 방지 회귀 테스트).
- [ ] `test_e_approve_with_reviewer_succeeds`
      — 검토자 1명 지정 → 200, EV step 1개 생성, E step `approved`.
- [ ] `test_p_approve_without_reviewer_still_allowed`
      — P 단계는 검토자 없이 합의해도 **200** (범위 밖임을 고정하는 회귀 테스트).
- [ ] `test_legacy_e_approved_without_reviewer_still_completes`
      — ORM 으로 E step 을 `approved` + EV 0개 상태로 만든 문서에서, 남은 J/O/RA 합의로 문서가 `approved` 까지 가는지 확인(하위호환 유지 회귀 테스트).

### 검증

```bash
docker exec -it <backend> python manage.py test api.tests.PEStageReviewerFlowTest -v 2
```

**성공 기준:** 신규 6건 포함 전부 통과. 기존 `PEStageReviewerFlowTest` 테스트 중 **검토자 없이 E 를 합의하던 것이 있으면 그 테스트가 깨진다** — 깨진 테스트는 새 규칙에 맞게 `reviewer_loginids` 를 넘기도록 고치고, 무엇을 왜 고쳤는지 보고한다. **테스트를 삭제하거나 단언을 약화시키지 않는다.**

---

## Task 2: 프론트엔드 — 검토자 미지정 시 '합의' 버튼 비활성 + 안내

**파일:** `frontend/src/pages/ApprovalPage.tsx`, `frontend/src/locales/ko.json`, `frontend/src/locales/en.json`

### 2-1. i18n 키 (ko/en 동시 추가)

`approval` 하위에 2개 추가한다. 값은 아래를 그대로 쓴다.

`ko.json`:
```json
"reviewer_required_hint": "2차 검토자를 1명 이상 지정해야 합의할 수 있습니다.",
"reviewer_required_empty": "지정 가능한 2차 검토자가 없습니다. 관리자에게 문의하세요."
```

`en.json`:
```json
"reviewer_required_hint": "Select at least one second reviewer to approve.",
"reviewer_required_empty": "No second reviewer is available. Please contact an administrator."
```

### 2-2. 판정값과 버튼 비활성

`frontend/src/pages/ApprovalPage.tsx` 의 렌더 IIFE 안, `reviewerPickStep` / `existingReviewerLoginids` 계산부(`frontend/src/pages/ApprovalPage.tsx:1123-1129`) 바로 아래에 판정값을 만든다. **라인 번호는 선행 작업 시점 기준이므로, 반드시 Read 로 해당 식별자를 찾아 실제 위치를 확인한 뒤 삽입한다.**

```tsx
          // MASK(E) 는 2차 검토자 1명 이상 지정이 필수다 — 아직 아무도 없으면 '합의'를 막는다.
          // (P 단계의 검토자는 선택 사항이라 이 판정에서 제외된다.)
          const needsReviewerPick = reviewerPickStep?.agent === 'E'
            && reviewerSelectedIds.length === 0
            && existingReviewerLoginids.length === 0;
```

'합의' 버튼(`frontend/src/pages/ApprovalPage.tsx:1637-1643`, `onClick={() => triggerAgree(actableStep.agent)}` 인 쪽 — PL 단계용 버튼이 아니다)에 반영:

```tsx
                  <button
                    className="btn btn-primary"
                    disabled={processing || needsReviewerPick}
                    onClick={() => triggerAgree(actableStep.agent)}
                  >
                    {t('approval.agree')}
                  </button>
```

**'반려' 버튼은 건드리지 않는다** — 검토자 없이도 반려는 가능해야 한다.

### 2-3. 안내 문구

검토자 선택 UI 블록(`frontend/src/pages/ApprovalPage.tsx:1567` 의 `{reviewerPickStep && (` 로 시작하는 블록) 안, 드롭다운 `</div>` 아래에 렌더한다. 후보 목록 로딩이 끝났는데 지정 가능한 사람이 0명이면 다른 문구를 띄운다:

```tsx
                      {needsReviewerPick && (
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                          {!loadingMembers && reviewerCandidates.length === 0
                            ? t('approval.reviewer_required_empty')
                            : t('approval.reviewer_required_hint')}
                        </span>
                      )}
```

**주의:**
- `reviewerCandidates` 는 드롭다운을 처음 열 때 로드된다(`frontend/src/pages/ApprovalPage.tsx:1593` 부근의 `if (!reviewerDropdownOpen && reviewerCandidates.length === 0 && !loadingMembers)`). 열기 전에는 빈 배열이므로 `loadingMembers` 만으로는 "후보 0명"을 확정할 수 없다. 위 조건은 **드롭다운을 한 번도 안 열었을 때도 `reviewer_required_hint` 를 띄우는 쪽으로 기운다** — 그게 맞는 동작이다(안내가 먼저, 없음 판정은 나중).
- 인라인 style 사용은 이 파일의 기존 관례를 따른 것이다. 새 CSS 클래스를 만들지 않는다.
- `handleConfirmAction` 은 **수정하지 않는다** — 버튼 비활성으로 이미 막히고, 서버 400 은 기존 에러 토스트 경로를 그대로 탄다.

### 검증

```bash
cd frontend && npx tsc --noEmit
```

**성공 기준:** 오류 개수가 base 커밋과 **동일**할 것. 이 저장소는 base 에서 이미 28건의 tsc 오류가 있다(누락 i18n 키 + `Set` 이터레이션). **새로 늘어난 오류가 0이면 통과**다. base 개수를 먼저 측정한 뒤 비교한다.

---

## Task 3: 문서 최신화 (규칙 C-4)

**파일:** `docs/APPROVAL.md`, `docs/E2E_TEST_AND_BUGS.md`

- [ ] `docs/APPROVAL.md` **Case K-3** (`:165`, "P/E 검토자 지정") — E 는 검토자 지정이 **필수**, P 는 선택임을 명시. 검증 위치(쓰기 이전)와 그 이유(부분 커밋 방지)를 한 줄로 남긴다.
- [ ] `docs/APPROVAL.md` **Case G** (`:111`, 최종 합의) — `_stage_reviewers_complete` 의 "검토자 없으면 담당자 합의만으로 완료" 하위호환 분기를 **일부러 남겼다**는 것과 그 이유(이미 검토자 없이 합의된 기존 문서가 영구 정지되지 않도록)를 적는다.
- [ ] `docs/APPROVAL.md` — **운영 요건**: `TE_E` 역할 사용자가 **2명 이상**이어야 E 단계를 넘길 수 있다(담당자 본인은 검토자로 지정 불가).
- [ ] `docs/E2E_TEST_AND_BUGS.md` — E 합의 시 검토자 필수 시나리오를 표에 추가한다. 기존 항목 번호 체계를 따른다.

**하지 말 것:** `docs/FIX_PROGRESS.md` 는 날짜가 박힌 완료 이력 로그다. 건드리지 않는다.

### 검증

```bash
# 1) E 검토자를 '선택'으로 서술한 잔존 표현이 없는지 (있으면 해당 줄을 고친다)
grep -rn "검토자" docs/APPROVAL.md docs/E2E_TEST_AND_BUGS.md

# 2) 새 규칙이 실제로 문서에 들어갔는지
grep -rn "2차 검토자" docs/APPROVAL.md docs/E2E_TEST_AND_BUGS.md
```

**성공 기준:** (2)가 최소 3곳(Case K-3 / Case G 하위호환 / 운영 요건)에서 매치되고, (1)의 결과 중 **E 단계 검토자를 선택 사항으로 읽히게 쓴 문장이 0건**일 것. `P` 단계 검토자를 선택으로 서술한 문장은 그대로 두는 것이 맞다.

---

## Task 4: 전체 검증 (규칙 C)

- [ ] 백엔드 전체: `docker exec -it <backend> python manage.py test api`
      — **성공 기준:** 실패가 기존 베이스라인을 넘지 않을 것. 로컬(사내망 밖) 환경에서는 3건이 환경 이슈로 실패한다: `HybridImmediateSendTest.test_enqueue_schedules_immediate_send_on_commit`(sqlite `on_commit`), `ExternalApiKeyAccessTest.test_wrong_key_returns_401`(미설정 API 키), `MessageBuildingTest.test_broadcast_subject_has_no_name_prefix`(라벨 마스킹). **이 3건 외 실패가 있으면 회귀다.**
- [ ] 프론트 테스트: `cd frontend && npm test -- --watchAll=false --passWithNoTests`
- [ ] `cd frontend && npx tsc --noEmit` — base 대비 **증가 0**
- [ ] i18n 키 ko/en 병렬 확인 — 신규 2개 키가 양쪽에 모두 있을 것
- [ ] `console.log` / dead code 잔존 0

### 수동 브라우저 시나리오 (규칙 C-2-1) — 사용자가 실행

프론트 렌더 테스트 인프라가 없으므로 **이 시나리오가 검증의 핵심**이다.

**A. E 담당자가 검토자 없이 합의 시도 (핵심)**
1. `TE_E` 역할 계정(예: MASK 팀원 1)으로 로그인 → **결재 현황**
2. 병렬 단계 진행 중인 의뢰서 행 클릭 → 상세 모달
3. E 단계에서 **'검토중으로 전환'** 클릭 → 본인이 선점됨
4. 검토자를 **아무도 고르지 않은 상태**에서 하단을 본다
   - ✅ **성공:** '합의' 버튼이 **비활성(회색)** 이고, 검토자 드롭다운 옆에 "2차 검토자를 1명 이상 지정해야 합의할 수 있습니다." 문구가 보인다
   - ❌ **실패 신호:** '합의' 버튼이 눌리거나, 눌러서 모달이 뜨고 진행됨
5. '반려' 버튼은 **여전히 활성**이어야 한다

**B. 검토자 지정 후 합의**
1. A 상태에서 검토자 드롭다운 열기 → MASK 팀원 2를 클릭해 추가
   - ✅ 칩(태그)이 생기고 '합의' 버튼이 **활성화**되며 안내 문구가 사라진다
2. '합의' 클릭 → Validation System 확정 토글 + 코멘트 모달 → 확인
   - ✅ **성공:** '결재 경로' 탭에 **검토자(EV) 단계가 대기로 추가**되고, E 담당자 단계는 합의로 바뀐다

**C. 2차 검토자 본인이 합의**
1. MASK 팀원 2 계정으로 로그인 → 같은 의뢰서 → '합의'
   - ✅ **성공:** 검토자 지정 UI 없이 바로 합의 가능(EV 단계에는 이 규칙이 걸리지 않아야 한다)
   - ✅ J·O·RA 도 모두 합의된 상태라면 문서가 **승인됨**으로 전이

**D. P 단계는 영향 없음 (회귀 확인)**
1. `TE_P` 계정 → 같은 문서의 P 단계 선점 → 검토자 **선택하지 않고** '합의'
   - ✅ **성공:** 버튼이 활성이고 합의가 정상 처리된다
   - ❌ **실패 신호:** P 단계에서도 버튼이 비활성 → 범위 침범이므로 즉시 되돌린다

**E. 기존 문서 하위호환 (회귀 확인)**
1. 배포 이전에 **검토자 없이 E 합의가 끝난** 진행 중 문서를 찾는다(없으면 생략)
2. 남은 단계(J/O/RA)를 합의
   - ✅ **성공:** 문서가 정상적으로 **승인됨**으로 전이 (E 검토자가 없다는 이유로 막히지 않는다)
   - ❌ **실패 신호:** 모든 단계가 합의됐는데 `under_review` 에 머무름 → 소급 적용 사고

---

## 잠재 이슈 / 주의사항 (규칙 C-3)

- **마이그레이션 없음.** 모델 변경이 없다.
- **`TE_E` 1인 조직에서 E 단계 봉쇄.** 위 "알려진 운영 제약" 참조. 배포 전 `TE_E` 역할 사용자가 2명 이상인지 확인한다.
- **기존 백엔드 테스트가 깨질 수 있다.** 검토자 없이 E 를 합의하던 기존 테스트가 있으면 400 을 받게 된다. 단언을 약화시키지 말고 새 규칙에 맞게 요청을 고친다.
- **`E2E_TEST_AND_BUGS.md` 의 기존 E 관련 시나리오**도 검토자 없이 합의하는 절차로 적혀 있으면 함께 고친다.
