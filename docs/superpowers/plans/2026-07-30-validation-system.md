# Validation System 대상/비대상 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 의뢰서의 Validation System 대상/비대상을 시스템이 자동 판정해 표시하고, 상신자가 크로스체크한 뒤 MASK 팀(결재 단계 `E`)이 결재 과정에서 최종 확정하게 한다.

**Architecture:** 값은 `RequestDocument.additional_notes` JSON 의 `detail` 하위에 `validation_system` / `validation_system_submitted` 두 키로 저장한다 — **모델 필드 추가도, 마이그레이션도 없다**. 판정 규칙은 프론트 순수 함수 `isValidationTarget()` 하나로 단일화한다. MASK 팀 결재 단계(`E`)는 대상/비대상과 무관하게 **항상 생성**되도록 백엔드를 바꾸고, MASK 의 값 확정은 새 엔드포인트 없이 기존 `approve-step` 요청에 optional 필드를 얹어 처리한다.

**Tech Stack:** React 18.2 + TypeScript 4.9.5 (strict) / Django 4.2.13 + DRF 3.15.1 / MySQL 8.0 / react-i18next 14.1.0 / Jest (react-scripts 내장)

**설계 스펙:** `docs/superpowers/specs/2026-07-30-validation-system-design.md` — 결정 배경과 근거는 전부 여기에 있다.

## Global Constraints

- **작업 브랜치:** `worktree-bridge-cse_01TA99Xg3CrYsrMCumaLnKtw` (베이스 `origin/woobin` @ `51bb3b0`). 머지 대상은 `main` 이 아니라 **`woobin`**.
- **이 repo 는 마스킹된 코드베이스다.** 비즈니스 용어는 코드에서 중립적 키로 쓰고, 실제 사내 용어는 `frontend/src/locales/ko.json` 값에만 둔다. 새 코드도 이 관례를 따른다 — 코드에는 `validation_system`, 화면 문구는 i18n 키.
- ⚠️ **Bash 출력이 마스킹 훅에 의해 재작성될 수 있다.** 이전 세션에서 `grep` 출력의 `plel` 이 `n` 으로 바뀌어 나와 없는 버그를 의심한 사례가 있다. **필드명·키워드는 반드시 Read 도구로 파일 원문을 확인**한 뒤 코드에 반영한다. `rg`/`grep` 결과만 믿지 않는다.
- **i18n (규칙 G):** 모든 화면 문구는 i18n 을 통한다. `ko.json` / `en.json` 에 **같은 키를 반드시 동시에** 추가한다. 하드코딩 금지.
- **타입 (규칙 I):** TypeScript `any` 금지. 매직 스트링·숫자는 상수로 분리한다. `console.log`·주석 처리된 dead code 를 남기지 않는다.
- **범위 (규칙 H):** 이 계획에 없는 리팩토링을 하지 않는다. 기존 코드의 하드코딩 한글(`활성 n / 전체 n` 등)이나 기존 `any` 사용은 **손대지 않는다** — 이번 범위 밖이다.
- **커밋 (규칙 E):** "파일별 개별 커밋"은 **빌드가 깨지지 않는 최소 단위**로 해석한다. 함께여야 컴파일되거나 규칙상 동시 수정이 강제되는 파일(`ko.json`+`en.json`, 타입 정의+첫 사용처)은 한 커밋으로 묶는다.
- **값 리터럴:** 대상 = `'YES'`, 비대상 = `'NO'`. 판정 키워드 = `'plel'` (대소문자 무관 비교).
- **커밋 메시지 말미에 다음 줄을 넣는다:**
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  ```

## File Structure

**신규 생성**
- `frontend/src/pages/RequestPage/helpers.test.ts` — 판정 순수 함수의 단위 테스트. 이 repo 최초의 프론트 테스트 파일이다.

**수정 (백엔드)**
- `backend/api/models.py` — `has_ppid_plel()` 삭제
- `backend/api/views.py` — E 단계 무조건 생성, `approve-step` 에 `validation_system` 수용
- `backend/api/mailer.py` — E/EV 제외 분기 2곳 삭제
- `backend/api/tests.py` — 기존 단언 수정 + 신규 테스트

**수정 (프론트엔드)**
- `frontend/src/pages/RequestPage/constants.ts` — 판정 상수 4개, `INITIAL_DETAIL` 초기값
- `frontend/src/pages/RequestPage/helpers.ts` — 판정 순수 함수 2개
- `frontend/src/types/index.ts` — `DetailFormState` 필드 2개
- `frontend/src/pages/RequestPage/index.tsx` — 자동 갱신 effect, `vsManuallySet`, 저장 로직, Step2 props 전달
- `frontend/src/pages/RequestPage/components/Step2.tsx` — 토글 UI + 셀 하이라이트 상수화
- `frontend/src/pages/RequestPage/components/Step3.tsx` — 셀 하이라이트 상수화
- `frontend/src/components/PagedDetailView.tsx` — 표시·폴백·병기, `hasPlel` 제거, 셀 하이라이트 상수화 4곳
- `frontend/src/components/ApprovalRouteDiagram.tsx` — 상단 주석 문구
- `frontend/src/api/client.ts` — `approveStep` 인자
- `frontend/src/pages/ApprovalPage.tsx` — MASK 확정 토글
- `frontend/src/locales/ko.json`, `frontend/src/locales/en.json` — 신규 키 + 기존 문구 수정

**수정 (문서)**
- `docs/APPROVAL.md`, `docs/MAIL.md`, `docs/REQUEST.md`

---

### Task 1: 판정 상수와 순수 함수

프론트 전체가 공유할 **단일 판정 소스**를 만든다. 이후 모든 태스크가 여기에 의존한다.

**Files:**
- Modify: `frontend/src/pages/RequestPage/constants.ts` (파일 상단 상수 구역)
- Modify: `frontend/src/pages/RequestPage/helpers.ts` (파일 끝에 추가)
- Test: `frontend/src/pages/RequestPage/helpers.test.ts` (신규)

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces:
  - `VALIDATION_KEYWORD: string` — `'plel'`
  - `VS_TARGET: 'YES'`, `VS_NONTARGET: 'NO'`
  - `VALIDATION_CELL_COLOR: string` — `'#fff9c4'`
  - `isValidationKeywordRow(pp: string | undefined): boolean`
  - `isValidationTarget(rows: { disabled?: boolean; pp?: string }[]): boolean`

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`frontend/src/pages/RequestPage/helpers.test.ts` 를 새로 만든다.

```ts
import { isValidationKeywordRow, isValidationTarget } from './helpers';

describe('isValidationKeywordRow', () => {
  it('pp 가 판정 키워드를 포함하면 true', () => {
    expect(isValidationKeywordRow('PLEL')).toBe(true);
    expect(isValidationKeywordRow('xx-plel-01')).toBe(true);
  });

  it('대소문자를 구분하지 않는다', () => {
    expect(isValidationKeywordRow('PlEl')).toBe(true);
  });

  it('키워드가 없거나 값이 비어 있으면 false', () => {
    expect(isValidationKeywordRow('ABC')).toBe(false);
    expect(isValidationKeywordRow('')).toBe(false);
    expect(isValidationKeywordRow(undefined)).toBe(false);
  });
});

describe('isValidationTarget', () => {
  it('활성 행 중 하나라도 키워드를 포함하면 대상', () => {
    expect(isValidationTarget([{ pp: 'ABC' }, { pp: 'PLEL' }])).toBe(true);
  });

  it('비활성 행은 판정에서 제외한다', () => {
    expect(isValidationTarget([{ pp: 'PLEL', disabled: true }])).toBe(false);
  });

  it('활성 행에 키워드가 없으면 비대상', () => {
    expect(isValidationTarget([{ pp: 'ABC' }, { pp: 'DEF', disabled: true }])).toBe(false);
  });

  it('빈 배열이면 비대상', () => {
    expect(isValidationTarget([])).toBe(false);
  });

  it('pp 가 없는 행도 안전하게 처리한다', () => {
    expect(isValidationTarget([{}, { pp: undefined }])).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

```bash
cd frontend && CI=true npx react-scripts test --testPathPattern=helpers.test
```

Expected: FAIL — `isValidationKeywordRow` / `isValidationTarget` 를 `./helpers` 에서 찾을 수 없다는 에러.

- [ ] **Step 3: 상수를 추가한다**

`frontend/src/pages/RequestPage/constants.ts` — 기존 `ST_CELL_COLOR` 선언 바로 아래(파일 상단 상수 구역)에 넣는다.

```ts
// ===== Validation System 대상 판정 =====
/** 판정 키워드 — J-layer 행의 pp 값에 포함되면 그 행은 대상 근거가 된다(대소문자 무관) */
export const VALIDATION_KEYWORD = 'plel';
/** detail.validation_system 에 저장되는 값 */
export const VS_TARGET = 'YES';
export const VS_NONTARGET = 'NO';
/** 판정 키워드를 포함한 pp 셀 배경색 */
export const VALIDATION_CELL_COLOR = '#fff9c4';
```

- [ ] **Step 4: 순수 함수를 추가한다**

`frontend/src/pages/RequestPage/helpers.ts` 의 **맨 끝**에 추가하고, 파일 첫 줄 import 를 다음과 같이 고친다.

```ts
import { FilterSet } from '../../types';
import { VALIDATION_KEYWORD } from './constants';
```

```ts
/** 행 단위: 이 행의 pp 가 판정 키워드를 포함하는가 (셀 하이라이트·문서 판정 공용) */
export const isValidationKeywordRow = (pp: string | undefined): boolean =>
  !!pp && pp.toLowerCase().includes(VALIDATION_KEYWORD);

/**
 * 문서 단위: 활성 J-layer 행 중 하나라도 판정 키워드를 포함하면 Validation System 대상.
 * 비활성(disabled) 행은 상신 시 저장에서 제외되므로 판정에서도 제외한다.
 */
export const isValidationTarget = (
  rows: { disabled?: boolean; pp?: string }[]
): boolean => rows.some((r) => !r.disabled && isValidationKeywordRow(r.pp));
```

- [ ] **Step 5: 테스트가 통과하는지 확인한다**

```bash
cd frontend && CI=true npx react-scripts test --testPathPattern=helpers.test
```

Expected: PASS — 8 tests passed.

- [ ] **Step 6: 커밋한다**

```bash
git add frontend/src/pages/RequestPage/constants.ts frontend/src/pages/RequestPage/helpers.ts frontend/src/pages/RequestPage/helpers.test.ts
git commit -m "$(cat <<'EOF'
feat(request): add Validation System 판정 상수·순수 함수

- VALIDATION_KEYWORD / VS_TARGET / VS_NONTARGET / VALIDATION_CELL_COLOR 상수화
- isValidationKeywordRow(행 단위) / isValidationTarget(문서 단위, 활성 행만)
- 단위 테스트 추가

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 기존 pp 셀 하이라이트 6곳 상수화

`pp` 셀 노란 배경 판정이 JSX 인라인으로 6곳에 중복돼 있다. **동작은 그대로 두고** Task 1 의 함수·상수로 치환한다. 이 태스크는 화면 결과가 바뀌지 않아야 한다.

**Files:**
- Modify: `frontend/src/pages/RequestPage/components/Step2.tsx:206`
- Modify: `frontend/src/pages/RequestPage/components/Step3.tsx:300`
- Modify: `frontend/src/components/PagedDetailView.tsx:265, 328, 542, 574`

**Interfaces:**
- Consumes: `isValidationKeywordRow`, `VALIDATION_CELL_COLOR` (Task 1)
- Produces: 없음 (내부 정리)

- [ ] **Step 1: `Step2.tsx` 의 pp 셀을 치환한다**

파일 상단 import 를 고친다.

```ts
import { ST_CELL_COLOR, VALIDATION_CELL_COLOR } from '../constants';
import { isValidationKeywordRow } from '../helpers';
```

206행 `<td {...cellProps('pp', ...)}>` 안의 `style` 을 바꾼다.

변경 전:
```tsx
style={{ backgroundColor: isRegistered ? regBg : row.pp?.toLowerCase().includes('plel') ? '#fff9c4' : undefined }}
```

변경 후:
```tsx
style={{ backgroundColor: isRegistered ? regBg : isValidationKeywordRow(row.pp) ? VALIDATION_CELL_COLOR : undefined }}
```

- [ ] **Step 2: `Step3.tsx` 의 pp 셀을 치환한다**

import 를 `Step2.tsx` 와 같은 형태로 고치고, 300행의 `style` 을 Step 1 과 동일한 형태로 바꾼다. `handleOayerChange` 등 나머지는 손대지 않는다.

- [ ] **Step 3: `PagedDetailView.tsx` 표 2곳을 치환한다**

파일 상단 import 에 추가한다 (기존 `ST_CELL_COLOR` import 구문에 합친다).

```ts
import { ST_CELL_COLOR, VALIDATION_CELL_COLOR } from '../pages/RequestPage/constants';
import { isValidationKeywordRow } from '../pages/RequestPage/helpers';
```

265행(J-layer 표 `JayerTable`)과 328행(O-layer 표 `OayerTable`)에서 각각:

변경 전:
```tsx
<td style={{ backgroundColor: reg ? rb : r.pp?.toLowerCase().includes('plel') ? '#fff9c4' : undefined }}>{r.pp}</td>
```

변경 후:
```tsx
<td style={{ backgroundColor: reg ? rb : isValidationKeywordRow(r.pp) ? VALIDATION_CELL_COLOR : undefined }}>{r.pp}</td>
```

- [ ] **Step 4: `PagedDetailView.tsx` 엑셀 내보내기 2곳을 치환한다**

542행 (`exportJayer`, pp = col 5):

변경 전:
```ts
if (col === 5) applyFill(cell, r.pp?.toLowerCase().includes('plel') ? '#fff9c4' : undefined);
```

변경 후:
```ts
if (col === 5) applyFill(cell, isValidationKeywordRow(r.pp) ? VALIDATION_CELL_COLOR : undefined);
```

574행 (`exportOayer`, pp = col 6):

변경 전:
```ts
if (col === 6) applyFill(cell, r.pp?.toLowerCase().includes('plel') ? '#fff9c4' : undefined);
```

변경 후:
```ts
if (col === 6) applyFill(cell, isValidationKeywordRow(r.pp) ? VALIDATION_CELL_COLOR : undefined);
```

- [ ] **Step 5: 남은 하드코딩이 없는지 확인한다**

```bash
cd frontend && grep -rn "toLowerCase().includes('plel')" src/ ; grep -rn "'#fff9c4'" src/
```

Expected: 두 명령 모두 **출력 없음**. 출력이 있으면 놓친 곳이니 치환한다.
(⚠️ 이 grep 출력은 마스킹 훅으로 재작성될 수 있다. 결과가 이상하면 해당 파일을 Read 로 직접 확인한다.)

- [ ] **Step 6: 타입 체크와 테스트를 돌린다**

```bash
cd frontend && npx tsc --noEmit && CI=true npx react-scripts test --watchAll=false --passWithNoTests
```

Expected: 타입 에러 없음, 기존 테스트 PASS.

- [ ] **Step 7: 커밋한다**

```bash
git add frontend/src/pages/RequestPage/components/Step2.tsx frontend/src/pages/RequestPage/components/Step3.tsx frontend/src/components/PagedDetailView.tsx
git commit -m "$(cat <<'EOF'
refactor(request): pp 셀 하이라이트 판정 6곳을 공용 함수로 통일

인라인 중복 판정을 isValidationKeywordRow / VALIDATION_CELL_COLOR 로 치환.
화면 동작은 동일하다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 백엔드 — E(MASK) 단계 무조건 생성

MASK 팀은 "대상이 맞는지 확인"하는 검증 주체이므로 대상/비대상과 무관하게 항상 결재선에 포함된다. Only MAP 문서는 지금처럼 제외한다.

**Files:**
- Modify: `backend/api/views.py:1099`(docstring), `1121-1125`
- Modify: `backend/api/mailer.py:344-346`, `476`(docstring), `485-486`
- Modify: `backend/api/models.py:161-168` (삭제)
- Test: `backend/api/tests.py:596`, `812-814`, 신규 테스트

**Interfaces:**
- Consumes: 없음
- Produces: R 합의 후 일반 문서에는 `ApprovalStep(agent='E', is_parallel=True, round=N)` 이 **항상** 존재한다. Only MAP 문서에는 여전히 없다.

- [ ] **Step 1: 백엔드 테스트 컨테이너명을 확인한다**

```bash
docker ps --format '{{.Names}}\t{{.Image}}'
```

Expected: backend 컨테이너 이름을 확인한다. 이후 스텝의 `<backend>` 를 실제 이름으로 바꿔 쓴다.
컨테이너가 떠 있지 않으면 `docker compose -f docker-compose.dev.yml up -d` 로 띄운다.

- [ ] **Step 2: 기존 단언을 반전하고 신규 테스트를 추가한다**

`backend/api/tests.py:596` 을 바꾼다.

변경 전:
```python
        self.assertNotIn('E', by_label, 'plel 이 아니면 E 는 경로에 넣지 않는다')
```

변경 후:
```python
        self.assertIn('E', by_label, 'E(MASK)는 대상/비대상과 무관하게 항상 경로에 포함된다')
        self.assertEqual(by_label['E'], 'waiting')  # step 미생성(예정)
```

이어서 `_advance_to_parallel` 헬퍼를 쓰는 테스트 클래스(`tests.py:812` 부근)에 아래 테스트 2개를 추가한다.

```python
    def test_e_step_created_even_without_plel(self):
        """대상 판정 키워드가 없어도 E(MASK) 단계는 항상 생성된다."""
        doc = self._advance_to_parallel(plel=False)
        self.assertTrue(
            ApprovalStep.objects.filter(document=doc, agent='E', round=1).exists(),
            'E 는 대상/비대상과 무관하게 생성되어야 한다',
        )

    def test_e_step_not_created_for_only_map(self):
        """Only MAP 문서에는 여전히 E 단계가 생기지 않는다."""
        doc = RequestDocument.objects.create(
            title='onlymap', requester=self.requester, requester_name='요청자',
            requester_email='req@c.com', requester_department='dept',
            product_name='PROD-1', status='draft',
            additional_notes=self._json.dumps(
                {'detail': {'request_purpose': RequestDocument.ONLY_MAP_PURPOSE}, 'jayerRows': []}
            ),
        )
        self.client.force_authenticate(user=self.requester)
        self.client.post(f'/api/documents/{doc.id}/submit/',
                         {'designated_pl_loginid': self.pl_user.loginid}, format='json')
        self.client.force_authenticate(user=self.pl_user)
        self.client.post(f'/api/documents/{doc.id}/peer-approve/', {}, format='json')
        self.assertFalse(ApprovalStep.objects.filter(document=doc, agent='E').exists())
```

- [ ] **Step 3: 테스트가 실패하는지 확인한다**

```bash
docker exec -it <backend> python manage.py test api.tests -v 2
```

Expected: FAIL — `test_e_step_created_even_without_plel` 이 "E 는 대상/비대상과 무관하게 생성되어야 한다" 로 실패하고, `tests.py:596` 이 있는 테스트도 `assertIn('E', ...)` 에서 실패한다.

- [ ] **Step 4: `views.py` 의 E 생성 조건을 제거한다**

`backend/api/views.py:1121-1125`.

변경 전:
```python
            if document.has_ppid_plel():
                e_step = ApprovalStep.objects.create(
                    document=document, agent='E', action='pending', is_parallel=True, round=round_no, due_date=o_due,
                )
                mailer.enqueue_stage_arrival(document, 'E', e_step)
```

변경 후:
```python
            # E(MASK)는 대상/비대상 판정을 검증하는 단계라 항상 생성한다(Only MAP 제외).
            e_step = ApprovalStep.objects.create(
                document=document, agent='E', action='pending', is_parallel=True, round=round_no, due_date=o_due,
            )
            mailer.enqueue_stage_arrival(document, 'E', e_step)
```

같은 함수 docstring(`views.py:1099`)도 고친다.

변경 전:
```python
        - 일반: P(4영업일)·O(6영업일 병렬)·[E(plel 시 6영업일)] + 후결자(RA, 6영업일 병렬) 생성.
```

변경 후:
```python
        - 일반: P(4영업일)·O(6영업일 병렬)·E(6영업일 병렬) + 후결자(RA, 6영업일 병렬) 생성.
```

- [ ] **Step 5: `mailer.py` 의 E 제외 분기 2곳을 제거한다**

`backend/api/mailer.py:344-346` — 아래 3줄을 **통째로 삭제**한다.

```python
        if agent == 'E' and not document.has_ppid_plel():
            # E 는 plel 인 의뢰서에만 생성된다.
            continue
```

`backend/api/mailer.py:485-486` — 아래 2줄을 **통째로 삭제**한다.

```python
    if not document.has_ppid_plel():
        route -= {'E', 'EV'}
```

같은 함수 docstring(`mailer.py:476`)도 고친다.

변경 전:
```python
    채워, 앞으로 남은 결재가 몇 단계인지 보이게 한다. Only MAP 이거나 plel 이 아닌
    의뢰서에서 아예 거치지 않는 단계는 행 자체를 만들지 않는다.
```

변경 후:
```python
    채워, 앞으로 남은 결재가 몇 단계인지 보이게 한다. Only MAP 의뢰서처럼 아예
    거치지 않는 단계는 행 자체를 만들지 않는다.
```

- [ ] **Step 6: `models.py` 의 `has_ppid_plel()` 를 삭제한다**

`backend/api/models.py:161-168` 의 메서드 정의 전체를 삭제한다. 참조처가 0 이 되었으므로 dead code 다(규칙 I).

삭제 대상:
```python
    def has_ppid_plel(self):
        detail = self.get_detail()
        jayer_rows = detail.get('jayerRows', [])
        for row in jayer_rows:
            pp = row.get('pp', '')
            if 'plel' in pp.lower():  # 대소문자 구분 없음
                return True
        return False
```

- [ ] **Step 7: 참조가 남아 있지 않은지 확인한다**

```bash
grep -rn "has_ppid_plel" backend/
```

Expected: **출력 없음**. (`docs/` 는 Task 9 에서 처리한다.)

- [ ] **Step 8: 테스트가 통과하는지 확인한다**

```bash
docker exec -it <backend> python manage.py test api.tests -v 2
```

Expected: PASS — 신규 2개 포함 전체 통과. 실패하는 기존 테스트가 더 있으면 "E 는 항상 생성된다" 전제에 맞게 기대값을 고친다.

- [ ] **Step 9: 커밋한다**

```bash
git add backend/api/views.py backend/api/mailer.py backend/api/models.py backend/api/tests.py
git commit -m "$(cat <<'EOF'
feat(approval): E(MASK) 단계를 대상/비대상과 무관하게 항상 생성

MASK 팀은 Validation System 대상 판정이 맞는지 검증하는 주체이므로
결재선에 항상 포함된다. Only MAP 문서는 기존대로 제외한다.

- views: E step 생성의 has_ppid_plel 조건 제거
- mailer: 반려 수신자·결재경로 카드의 E/EV 제외 분기 제거
- models: 참조처가 0이 된 has_ppid_plel() 삭제
- tests: 기존 단언 반전 + Only MAP 제외 회귀 테스트 추가

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 백엔드 — `approve-step` 에 MASK 확정값 수용

새 엔드포인트를 만들지 않는다. `views.py:490` 에 이미 있는 "P/E 담당자 합의 요청 한 번으로 담당자 합의 + 검토자 지정을 함께 처리" 패턴과 같은 자리에 얹는다.

**Files:**
- Modify: `backend/api/views.py:488-496` (P/E 블록 바로 뒤)
- Test: `backend/api/tests.py` (Task 3 에서 쓴 클래스에 이어서)

**Interfaces:**
- Consumes: Task 3 의 "E 는 항상 생성된다"
- Produces: `POST /api/documents/<id>/approve-step/` 이 `agent='E'` 일 때 optional body 필드 `validation_system: 'YES'|'NO'` 를 받아 `detail.validation_system` 을 덮어쓴다. `detail.validation_system_submitted` 는 건드리지 않는다. 잘못된 값은 400.

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`backend/api/tests.py` 의 E 단계 테스트 클래스에 추가한다.

```python
    def _get_detail(self, doc):
        doc.refresh_from_db()
        return self._json.loads(doc.additional_notes or '{}').get('detail', {})

    def test_e_approve_updates_validation_system(self):
        """MASK(E) 합의 시 보낸 validation_system 이 detail 에 반영된다."""
        doc = self._advance_to_parallel(plel=True)
        notes = self._json.loads(doc.additional_notes)
        notes['detail'] = {'validation_system': 'YES', 'validation_system_submitted': 'YES'}
        doc.additional_notes = self._json.dumps(notes)
        doc.save()

        self.client.force_authenticate(user=self.e_owner)
        self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': 'E'}, format='json')
        r = self.client.post(
            f'/api/documents/{doc.id}/approve-step/',
            {'agent': 'E', 'comment': '', 'validation_system': 'NO'}, format='json',
        )
        self.assertEqual(r.status_code, 200, r.content)

        detail = self._get_detail(doc)
        self.assertEqual(detail['validation_system'], 'NO')
        self.assertEqual(detail['validation_system_submitted'], 'YES',
                         '상신 시점 값은 MASK 수정으로 바뀌지 않는다')

    def test_validation_system_ignored_for_other_agents(self):
        """E 가 아닌 단계에서 보낸 validation_system 은 무시한다."""
        doc = self._advance_to_parallel(plel=True)
        notes = self._json.loads(doc.additional_notes)
        notes['detail'] = {'validation_system': 'YES'}
        doc.additional_notes = self._json.dumps(notes)
        doc.save()

        self.client.force_authenticate(user=self.o_user)
        self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': 'O'}, format='json')
        r = self.client.post(
            f'/api/documents/{doc.id}/approve-step/',
            {'agent': 'O', 'comment': '', 'validation_system': 'NO'}, format='json',
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(self._get_detail(doc)['validation_system'], 'YES')

    def test_invalid_validation_system_rejected(self):
        """허용되지 않는 값은 400 이다."""
        doc = self._advance_to_parallel(plel=True)
        self.client.force_authenticate(user=self.e_owner)
        self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': 'E'}, format='json')
        r = self.client.post(
            f'/api/documents/{doc.id}/approve-step/',
            {'agent': 'E', 'comment': '', 'validation_system': 'MAYBE'}, format='json',
        )
        self.assertEqual(r.status_code, 400, r.content)
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

```bash
docker exec -it <backend> python manage.py test api.tests -v 2
```

Expected: FAIL — `test_e_approve_updates_validation_system` 은 `detail['validation_system']` 이 여전히 `'YES'`, `test_invalid_validation_system_rejected` 는 400 대신 200.

- [ ] **Step 3: 값 검증 상수와 반영 헬퍼를 추가한다**

`backend/api/views.py` 의 ViewSet 클래스 안, `_sync_post_approvers_detail` 근처에 헬퍼를 추가한다.

```python
    # Validation System 대상/비대상 값 (프론트 constants.ts 의 VS_TARGET/VS_NONTARGET 과 동일)
    VALIDATION_SYSTEM_VALUES = ('YES', 'NO')

    def _set_validation_system(self, document, value):
        """detail.validation_system 만 덮어쓴다.

        validation_system_submitted(상신 시점 상신자 값)는 건드리지 않는다.
        JSON 파싱 실패 시 조용히 건너뛴다(_sync_post_approvers_detail 과 같은 정책).
        """
        import json
        try:
            data = json.loads(document.additional_notes or '{}')
            detail = data.get('detail', {}) or {}
            detail['validation_system'] = value
            data['detail'] = detail
            document.additional_notes = json.dumps(data, ensure_ascii=False)
            document.save(update_fields=['additional_notes'])
        except (json.JSONDecodeError, TypeError):
            pass
```

- [ ] **Step 4: `approve_step` 에서 값을 수용한다**

`backend/api/views.py:488-496` 의 P/E 검토자 블록 **바로 뒤**, `step.action = 'approved'` (498행) **앞**에 넣는다.

```python
        # E(MASK) 합의 시 Validation System 대상/비대상 확정값을 함께 받는다.
        # 별도 엔드포인트 없이 이 합의 요청 한 번으로 처리한다(위 검토자 지정과 같은 패턴).
        # 인가는 위의 _can_act_on_step 통과가 곧 'E 단계를 처리할 수 있는가'이므로 추가 검사가 없다.
        validation_system = request.data.get('validation_system')
        if agent == 'E' and validation_system is not None:
            if validation_system not in self.VALIDATION_SYSTEM_VALUES:
                return Response(
                    {'error': '유효하지 않은 Validation System 값입니다.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            self._set_validation_system(document, validation_system)
```

- [ ] **Step 5: 테스트가 통과하는지 확인한다**

```bash
docker exec -it <backend> python manage.py test api.tests -v 2
```

Expected: PASS — 전체 통과.

- [ ] **Step 6: 커밋한다**

```bash
git add backend/api/views.py backend/api/tests.py
git commit -m "$(cat <<'EOF'
feat(approval): approve-step 에서 MASK(E) 의 Validation System 확정값 수용

새 엔드포인트 없이 기존 합의 요청에 optional validation_system 을 얹는다.
agent='E' 일 때만 반영하고, 상신 시점 값(validation_system_submitted)은 보존한다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: 타입·초기값·저장 로직

프론트가 값을 실제로 저장하기 시작한다. UI 는 아직 없다.

**Files:**
- Modify: `frontend/src/types/index.ts:320` 부근 (`DetailFormState`)
- Modify: `frontend/src/pages/RequestPage/constants.ts:122` (`INITIAL_DETAIL`)
- Modify: `frontend/src/pages/RequestPage/index.tsx:2884-2889` (`buildEnrichedForm`)

**Interfaces:**
- Consumes: `VS_NONTARGET` (Task 1)
- Produces:
  - `DetailFormState.validation_system: 'YES' | 'NO'`
  - `DetailFormState.validation_system_submitted?: 'YES' | 'NO'`
  - 상신·재상신 시 `validation_system_submitted` 가 `validation_system` 값으로 기록된다. 임시저장 시에는 기록되지 않는다.

- [ ] **Step 1: `DetailFormState` 에 필드를 추가한다**

`frontend/src/types/index.ts` — `map_edit_round?: number;`(326행) 바로 아래, 인터페이스 닫는 `}` 앞에 넣는다.

```ts
  // Validation System 대상('YES')/비대상('NO'). 상신 시 자동 판정값을 기본으로 상신자가 확정하고,
  // 결재 과정에서 MASK(E) 팀이 최종 확정한다.
  validation_system: ValidationSystemValue;
  // 상신·재상신 시점의 상신자 값. MASK 가 값을 바꿔도 이 값은 유지돼 두 판단의 차이를 남긴다.
  validation_system_submitted?: ValidationSystemValue;
```

같은 파일에 타입 별칭을 추가한다 (`DetailFormState` 인터페이스 **바로 위**).

```ts
/** Validation System 대상 여부 — 'YES'(대상) | 'NO'(비대상) */
export type ValidationSystemValue = 'YES' | 'NO';
```

- [ ] **Step 2: `INITIAL_DETAIL` 에 초기값을 넣는다**

`frontend/src/pages/RequestPage/constants.ts:122` 의 `INITIAL_DETAIL` 객체 **끝**에 추가한다. 신규 의뢰서는 J-layer 가 비어 있으므로 비대상으로 시작한다.

```ts
  validation_system: VS_NONTARGET,
```

`VS_NONTARGET` 은 같은 파일 위쪽(Task 1)에 선언돼 있으므로 import 가 필요 없다.
`INITIAL_DETAIL` 을 스프레드하는 `constants.ts:208` 의 객체는 자동으로 값을 물려받으므로 손대지 않는다.

- [ ] **Step 3: 상신 시 `validation_system_submitted` 를 기록한다**

`frontend/src/pages/RequestPage/index.tsx:2884-2889` 의 `detail:` 블록을 고친다.

변경 전:
```ts
        detail: {
          ...detail,
          post_approvers: detail.only_prodc === 'Yes' ? postApprovers : [],
          // 완성된 MAP 변경: 승인 시 서버가 원본 요청서에 MAP 값을 반영할 수 있도록 대상 문서 id 를 저장
          ...(isMapChangeMode && mapChangeDocId !== null ? { map_change_source_id: mapChangeDocId } : {}),
        },
```

변경 후:
```ts
        detail: {
          ...detail,
          post_approvers: detail.only_prodc === 'Yes' ? postApprovers : [],
          // 완성된 MAP 변경: 승인 시 서버가 원본 요청서에 MAP 값을 반영할 수 있도록 대상 문서 id 를 저장
          ...(isMapChangeMode && mapChangeDocId !== null ? { map_change_source_id: mapChangeDocId } : {}),
          // 상신·재상신 시점의 상신자 판단을 고정 기록한다(임시저장에는 남기지 않는다).
          // 이후 MASK(E)가 detail.validation_system 을 바꿔도 이 값은 유지된다.
          ...(isDraft ? {} : { validation_system_submitted: detail.validation_system }),
        },
```

- [ ] **Step 4: 타입 체크를 돌린다**

```bash
cd frontend && npx tsc --noEmit
```

Expected: 에러 없음. `DetailFormState` 를 만드는 다른 곳(`makeTourDetail` 등)에서 필수 필드 누락 에러가 나면 그 객체에도 `validation_system: VS_NONTARGET` 을 추가한다.

- [ ] **Step 5: 커밋한다**

```bash
git add frontend/src/types/index.ts frontend/src/pages/RequestPage/constants.ts frontend/src/pages/RequestPage/index.tsx
git commit -m "$(cat <<'EOF'
feat(request): detail 에 validation_system 저장 필드 추가

- ValidationSystemValue 타입 + DetailFormState 필드 2개
- INITIAL_DETAIL 기본값 '비대상'
- 상신·재상신 시 validation_system_submitted 를 고정 기록(임시저장 제외)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: 상신 화면 토글 (`Step2.tsx` + `index.tsx`)

상신자가 자동 판정을 보고 크로스체크한다. `Step2.tsx` 는 순수 표현 컴포넌트이므로 상태는 `index.tsx` 에 둔다.

**Files:**
- Modify: `frontend/src/pages/RequestPage/index.tsx` (state, effect, props 전달)
- Modify: `frontend/src/pages/RequestPage/components/Step2.tsx:9-40`(props), `81-89`(헤더)
- Modify: `frontend/src/locales/ko.json`, `frontend/src/locales/en.json`

**Interfaces:**
- Consumes: `isValidationTarget`, `VS_TARGET`, `VS_NONTARGET` (Task 1), `DetailFormState.validation_system` (Task 5)
- Produces: `Step2Props` 에 `validationSystem: ValidationSystemValue`, `onValidationSystemChange: (v: ValidationSystemValue) => void`, `autoValidationSystem: ValidationSystemValue`

- [ ] **Step 1: i18n 키를 ko/en 동시에 추가한다**

`frontend/src/locales/ko.json` 의 `request` 객체 안:

```json
    "validation_system": "Validation System",
    "validation_system_target": "대상",
    "validation_system_nontarget": "비대상",
    "validation_system_auto": "자동 판정: {{value}}",
```

`frontend/src/locales/en.json` 의 `request` 객체 안 (**같은 키 4개를 반드시 함께**):

```json
    "validation_system": "Validation System",
    "validation_system_target": "Target",
    "validation_system_nontarget": "Non-target",
    "validation_system_auto": "Auto: {{value}}",
```

- [ ] **Step 2: `index.tsx` 에 수동 수정 플래그와 자동 갱신 effect 를 추가한다**

`frontend/src/pages/RequestPage/index.tsx:151` 의 `const [jayerRows, setJayerRows] = useState<JayerRow[]>(...)` **바로 아래**에 추가한다. (`detail` 은 150행, `jayerRows` 는 151행에 선언돼 있다.)

```ts
  // Validation System: 상신자가 토글을 직접 건드렸는지. true 면 J-layer 변경에도 자동 갱신하지 않는다.
  // 세션 로컬 상태라 detail 에 넣지 않고 저장도 하지 않는다.
  const [vsManuallySet, setVsManuallySet] = useState(false);
```

import 에 `isValidationTarget` 과 `VS_TARGET` / `VS_NONTARGET` 을 추가한다 (기존 `./helpers` / `./constants` import 구문에 합친다). `useEffect` 는 `index.tsx:1` 에서 이미 import 돼 있다.

바로 위에서 추가한 `vsManuallySet` 선언 **다음 줄**에 effect 를 넣는다.

```ts
  // J-layer 가 바뀌면 Validation System 대상 여부를 자동 갱신한다.
  // 상신자가 토글을 직접 바꾼 뒤에는(vsManuallySet) 자동 갱신하지 않는다.
  useEffect(() => {
    if (vsManuallySet) return;
    const auto = isValidationTarget(jayerRows) ? VS_TARGET : VS_NONTARGET;
    setDetail((prev) => (prev.validation_system === auto ? prev : { ...prev, validation_system: auto }));
  }, [jayerRows, vsManuallySet]);
```

- [ ] **Step 3: 저장된 문서를 불러올 때 자동 갱신을 끈다**

`frontend/src/pages/RequestPage/index.tsx:720` — `if (parsed.detail) {` 블록(715행) 안, `setDetail({ ...parsed.detail, ... })` 호출 **바로 다음 줄**에 추가한다.

```ts
          // 불러온 문서의 값은 이미 확정된 판단이므로 자동 갱신으로 덮어쓰지 않는다.
          setVsManuallySet(true);
```

들여쓰기는 같은 블록의 `setPostApprovers(...)`(721행)와 맞춘다(공백 10칸).

- [ ] **Step 4: `Step2` 에 props 를 넘긴다**

`frontend/src/pages/RequestPage/index.tsx:3330` 의 `<Step2` 호출부, 기존 props 목록에 추가한다.

```tsx
        validationSystem={detail.validation_system}
        autoValidationSystem={isValidationTarget(jayerRows) ? VS_TARGET : VS_NONTARGET}
        onValidationSystemChange={(v) => {
          setVsManuallySet(true);
          setDetail((prev) => ({ ...prev, validation_system: v }));
        }}
```

- [ ] **Step 5: `Step2.tsx` 의 props 타입을 넓힌다**

`frontend/src/pages/RequestPage/components/Step2.tsx:9` 의 `interface Step2Props` 에 추가한다.

```ts
  validationSystem: ValidationSystemValue;
  autoValidationSystem: ValidationSystemValue;
  onValidationSystemChange: (value: ValidationSystemValue) => void;
```

import 를 고친다.

```ts
import { JayerRow, FilterSet, GuideFeatureKey, ValidationSystemValue } from '../../../types';
import { ST_CELL_COLOR, VALIDATION_CELL_COLOR, VS_TARGET, VS_NONTARGET } from '../constants';
```

구조분해 인자 목록(45-72행)에도 세 이름을 추가한다.

- [ ] **Step 6: 토글 UI 를 그린다**

`Step2.tsx:86-88` 의 `활성 n / 전체 n` 을 감싼 `<span>` **앞**에 토글을 넣는다. 기존 `활성 / 전체` 표기는 **그대로 둔다**(범위 밖).

변경 전:
```tsx
        <span style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-muted)' }}>
          활성 {jayerRows.filter(r => !r.disabled).length} / 전체 {jayerRows.length}
        </span>
```

변경 후:
```tsx
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
              {t('request.validation_system')}
            </span>
            <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
              {([
                { value: VS_TARGET, label: t('request.validation_system_target') },
                { value: VS_NONTARGET, label: t('request.validation_system_nontarget') },
              ] as const).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onValidationSystemChange(opt.value)}
                  style={{
                    border: 'none',
                    padding: '3px 12px',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    background: validationSystem === opt.value ? 'var(--primary)' : 'transparent',
                    color: validationSystem === opt.value ? '#fff' : 'var(--text-muted)',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {validationSystem !== autoValidationSystem && (
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                {t('request.validation_system_auto', {
                  value: autoValidationSystem === VS_TARGET
                    ? t('request.validation_system_target')
                    : t('request.validation_system_nontarget'),
                })}
              </span>
            )}
          </span>
          <span style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-muted)' }}>
            활성 {jayerRows.filter(r => !r.disabled).length} / 전체 {jayerRows.length}
          </span>
        </span>
```

- [ ] **Step 7: 타입 체크와 테스트를 돌린다**

```bash
cd frontend && npx tsc --noEmit && CI=true npx react-scripts test --watchAll=false --passWithNoTests
```

Expected: 에러 없음, 테스트 PASS.

- [ ] **Step 8: i18n 키가 ko/en 양쪽에 다 있는지 확인한다**

```bash
cd frontend && python3 -c "
import json
ko=json.load(open('src/locales/ko.json'))['request']
en=json.load(open('src/locales/en.json'))['request']
keys=[k for k in ko if k.startswith('validation_system')]
print('ko:',sorted(keys))
print('en:',sorted(k for k in en if k.startswith('validation_system')))
print('MISSING in en:', sorted(set(keys)-set(en)))
"
```

Expected: `MISSING in en: []`

- [ ] **Step 9: 커밋한다**

```bash
git add frontend/src/locales/ko.json frontend/src/locales/en.json
git commit -m "$(cat <<'EOF'
feat(i18n): Validation System 상신 화면 문구 추가 (ko/en)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"

git add frontend/src/pages/RequestPage/index.tsx frontend/src/pages/RequestPage/components/Step2.tsx
git commit -m "$(cat <<'EOF'
feat(request): J-layer 표 상단에 Validation System 대상/비대상 토글

- J-layer 변경 시 자동 판정으로 갱신, 상신자가 직접 바꾸면 자동 갱신 중단
- 저장 문서를 불러오면 확정값 유지
- 자동 판정과 선택이 다르면 자동 판정값을 함께 안내

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: 결재 화면 MASK 확정 토글 (`client.ts` + `ApprovalPage.tsx`)

MASK(TE_E) 담당자가 합의 모달에서 값을 확정한다.

**Files:**
- Modify: `frontend/src/api/client.ts:236-252`
- Modify: `frontend/src/pages/ApprovalPage.tsx:113`(state), `505-524`(호출), `903-938`(모달)
- Modify: `frontend/src/locales/ko.json`, `frontend/src/locales/en.json`

**Interfaces:**
- Consumes: Task 4 의 `approve-step` 필드, `ValidationSystemValue` (Task 5), `VS_TARGET`/`VS_NONTARGET` (Task 1)
- Produces: `approveStep(docId, agent, comment?, approverName?, reviewerLoginids?, validationSystem?)`

- [ ] **Step 1: i18n 키를 ko/en 동시에 추가한다**

`frontend/src/locales/ko.json` 의 `approval` 객체 안:

```json
    "validation_system_confirm": "Validation System 확정",
```

`frontend/src/locales/en.json` 의 `approval` 객체 안:

```json
    "validation_system_confirm": "Confirm Validation System",
```

- [ ] **Step 2: `client.ts` 의 `approveStep` 에 인자를 추가한다**

변경 전:
```ts
const approveStep = async (
  docId: number,
  agent: AgentType,
  comment?: string,
  approverName?: string,
  reviewerLoginids?: string[]
) => {
  const data = await post<{ message: string; status: string }>(
    `/documents/${docId}/approve-step/`,
    {
      agent, comment: comment ?? '', approver_name: approverName ?? '',
      // P/E 담당자 합의 시 검토자(PV/EV, 다중)를 함께 지정 — 별도 API 없이 한 번에 처리
      ...((agent === 'P' || agent === 'E') && reviewerLoginids?.length ? { reviewer_loginids: reviewerLoginids } : {}),
```

변경 후:
```ts
const approveStep = async (
  docId: number,
  agent: AgentType,
  comment?: string,
  approverName?: string,
  reviewerLoginids?: string[],
  validationSystem?: ValidationSystemValue
) => {
  const data = await post<{ message: string; status: string }>(
    `/documents/${docId}/approve-step/`,
    {
      agent, comment: comment ?? '', approver_name: approverName ?? '',
      // P/E 담당자 합의 시 검토자(PV/EV, 다중)를 함께 지정 — 별도 API 없이 한 번에 처리
      ...((agent === 'P' || agent === 'E') && reviewerLoginids?.length ? { reviewer_loginids: reviewerLoginids } : {}),
      // E(MASK) 합의 시 Validation System 확정값을 함께 전달 — 같은 요청 한 번으로 처리
      ...(agent === 'E' && validationSystem ? { validation_system: validationSystem } : {}),
```

`client.ts` 의 타입 import 에 `ValidationSystemValue` 를 추가한다.

- [ ] **Step 3: `ApprovalPage.tsx` 에 확정값 state 를 추가한다**

`ApprovalPage.tsx:113` 의 `reviewerSelectedIds` state 바로 아래에 추가한다.

```ts
  // MASK(E) 합의 시 확정할 Validation System 값. 모달을 열 때 문서의 현재 값으로 초기화한다.
  const [validationSystemInput, setValidationSystemInput] = useState<ValidationSystemValue>(VS_NONTARGET);
```

import 를 추가한다.

```ts
import { ValidationSystemValue } from '../types';
import { VS_TARGET, VS_NONTARGET } from './RequestPage/constants';
```

- [ ] **Step 4: 합의 모달을 열 때 현재 값으로 초기화한다**

`frontend/src/pages/ApprovalPage.tsx:491` 의 `// 합의/반려 버튼 클릭 → comment 모달 열기` 주석 **바로 위**에 헬퍼를 추가한다. `RequestDocument` 타입은 74행에서 이미 쓰고 있으므로 import 가 돼 있다.

```ts
  // 문서의 현재 Validation System 값. 키가 없는 레거시 문서는 저장된 J-layer 로 폴백 판정한다.
  const readValidationSystem = (doc: RequestDocument): ValidationSystemValue => {
    try {
      const parsed = JSON.parse(doc.additional_notes ?? '{}');
      const saved = parsed?.detail?.validation_system;
      if (saved === VS_TARGET || saved === VS_NONTARGET) return saved;
      return isValidationTarget(parsed?.jayerRows ?? []) ? VS_TARGET : VS_NONTARGET;
    } catch {
      return VS_NONTARGET;
    }
  };
```

import 에 `isValidationTarget` 을 추가한다 (`./RequestPage/helpers`).

`ApprovalPage.tsx:492-496` 의 `triggerAgree` 를 고친다. `triggerReject`(498-502)는 **손대지 않는다** — 반려에는 확정값이 필요 없다.

변경 전:
```ts
  const triggerAgree = (agent: AgentType, isPeer = false) => {
    setPendingAction({ type: 'agree', agent, isPeer });
    setCommentInput('');
    setCommentModalOpen(true);
  };
```

변경 후:
```ts
  const triggerAgree = (agent: AgentType, isPeer = false) => {
    setPendingAction({ type: 'agree', agent, isPeer });
    setCommentInput('');
    // MASK(E) 합의 모달의 토글은 문서의 현재 값에서 시작한다.
    if (selected) setValidationSystemInput(readValidationSystem(selected));
    setCommentModalOpen(true);
  };
```

- [ ] **Step 5: 합의 요청에 값을 실어 보낸다**

`ApprovalPage.tsx:522-523`.

변경 전:
```ts
        const reviewerLoginids = REVIEW_AGENT_OF[pendingAction.agent] ? reviewerSelectedIds : undefined;
        await documentsAPI.approveStep(selected.id, pendingAction.agent, commentInput || undefined, currentUser.name, reviewerLoginids);
```

변경 후:
```ts
        const reviewerLoginids = REVIEW_AGENT_OF[pendingAction.agent] ? reviewerSelectedIds : undefined;
        const validationSystem = pendingAction.agent === 'E' ? validationSystemInput : undefined;
        await documentsAPI.approveStep(selected.id, pendingAction.agent, commentInput || undefined, currentUser.name, reviewerLoginids, validationSystem);
```

- [ ] **Step 6: 모달에 토글을 그린다**

`ApprovalPage.tsx:925` 의 `<div>` 안, 코멘트 안내 `<p>` **앞**에 넣는다.

```tsx
            {pendingAction.agent === 'E' && pendingAction.type === 'agree' && (
              <div style={{ marginBottom: 14, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
                <p style={{ marginBottom: 6, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                  {t('approval.validation_system_confirm')}
                </p>
                <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
                  {([
                    { value: VS_TARGET, label: t('request.validation_system_target') },
                    { value: VS_NONTARGET, label: t('request.validation_system_nontarget') },
                  ] as const).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setValidationSystemInput(opt.value)}
                      style={{
                        border: 'none',
                        padding: '5px 16px',
                        fontSize: '0.85rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        background: validationSystemInput === opt.value ? 'var(--primary)' : 'transparent',
                        color: validationSystemInput === opt.value ? '#fff' : 'var(--text-muted)',
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
```

- [ ] **Step 7: 타입 체크와 테스트를 돌린다**

```bash
cd frontend && npx tsc --noEmit && CI=true npx react-scripts test --watchAll=false --passWithNoTests
```

Expected: 에러 없음, 테스트 PASS.

- [ ] **Step 8: 커밋한다**

```bash
git add frontend/src/locales/ko.json frontend/src/locales/en.json
git commit -m "$(cat <<'EOF'
feat(i18n): MASK 확정 토글 문구 추가 (ko/en)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"

git add frontend/src/api/client.ts frontend/src/pages/ApprovalPage.tsx
git commit -m "$(cat <<'EOF'
feat(approval): MASK(E) 합의 모달에서 Validation System 확정

- approveStep 에 validationSystem 인자 추가 (agent='E' 일 때만 전송)
- 모달을 열 때 문서 현재 값으로 초기화, 레거시 문서는 J-layer 폴백 판정

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: 상세보기 표시 + `hasPlel` 제거

결재자가 보는 화면에 결론을 드러내고, E 단계를 조건부로 감추던 로직을 걷어낸다.

**Files:**
- Modify: `frontend/src/components/PagedDetailView.tsx:1240-1255`(J-layer 탭), `1434-1439`, `1520-1522`, `1664`
- Modify: `frontend/src/components/ApprovalRouteDiagram.tsx:7`
- Modify: `frontend/src/locales/ko.json`, `frontend/src/locales/en.json`

**Interfaces:**
- Consumes: `isValidationTarget`, `VS_TARGET`, `VS_NONTARGET` (Task 1)
- Produces: 없음 (표시 전용)

- [ ] **Step 1: i18n 키를 ko/en 동시에 추가·수정한다**

`frontend/src/locales/ko.json` 의 `request` 객체 안 **추가**:

```json
    "validation_system_changed": "상신 시 {{from}} → 확정 {{to}}",
```

`frontend/src/locales/en.json` 의 `request` 객체 안 **추가**:

```json
    "validation_system_changed": "Submitted {{from}} → Confirmed {{to}}",
```

기존 문구 **수정** — `ko.json` 의 `approval.route_diagram.note_e`:

변경 전: `"EUV(E) 단계는 plel(노란 셀) 항목이 있는 경우에만 진행됩니다."`
변경 후: `"EUV(E) 단계는 항상 진행되며, Validation System 대상/비대상 판정이 맞는지 확인합니다."`

`en.json` 의 같은 키:

변경 전: `"The EUV (E) stage runs only when plel (yellow cell) items are present."`
변경 후: `"The EUV (E) stage always runs and verifies whether the Validation System classification is correct."`

`ko.json` 의 `guide.tour.steps.route.description` — 끝의 `(E는 plel 존재 시, Only MAP 의뢰는 R까지)` 를 `(Only MAP 의뢰는 R까지)` 로 바꾼다. `en.json` 의 같은 키에서도 `E only when plel exists; ` 부분을 제거한다.

- [ ] **Step 2: J-layer 탭 표 위에 값을 표시한다**

`frontend/src/components/PagedDetailView.tsx:1240-1255` 의 `showJayer` 블록을 고친다. 먼저 `mapEditRound` 선언(617행) **바로 아래**에 표시값을 계산해 둔다. 이 지점이면 `detail`(481행, 타입 `Partial<DetailFormState>`)과 `jayer`(482행)가 이미 채워져 있다.

```ts
  // Validation System 표시값. detail 키가 없는 레거시 문서는 저장된 J-layer 로 폴백 판정한다.
  const vsCurrent: ValidationSystemValue =
    (detail.validation_system === VS_TARGET || detail.validation_system === VS_NONTARGET)
      ? detail.validation_system
      : (isValidationTarget(jayer) ? VS_TARGET : VS_NONTARGET);
  const vsSubmitted = detail.validation_system_submitted;
  const vsLabel = (v: ValidationSystemValue) =>
    v === VS_TARGET ? t('request.validation_system_target') : t('request.validation_system_nontarget');
```

`ValidationSystemValue` 를 타입 import 에 추가한다 (`DetailFormState` 를 가져오는 기존 구문에 합친다).

그리고 `<JayerTable ... />`(1252행) **바로 앞**에 표시를 넣는다.

```tsx
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
              {t('request.validation_system')}
            </span>
            <span style={{
              fontSize: '0.82rem',
              fontWeight: 700,
              padding: '2px 10px',
              borderRadius: 4,
              background: vsCurrent === VS_TARGET ? 'var(--primary)' : 'var(--border)',
              color: vsCurrent === VS_TARGET ? '#fff' : 'var(--text-secondary)',
            }}>
              {vsLabel(vsCurrent)}
            </span>
            {vsSubmitted && vsSubmitted !== vsCurrent && (
              <span style={{ fontSize: '0.75rem', color: 'var(--danger)' }}>
                {t('request.validation_system_changed', { from: vsLabel(vsSubmitted), to: vsLabel(vsCurrent) })}
              </span>
            )}
          </div>
```

import 에 `VS_TARGET`, `VS_NONTARGET`, `isValidationTarget` 을 추가한다 (Task 2 에서 만든 import 구문에 합친다).

- [ ] **Step 3: `hasPlel` 정의와 사용처를 제거한다**

`PagedDetailView.tsx:1434-1439` 의 `hasPlel` 선언 블록 전체를 삭제한다.

1520-1522 행:

변경 전:
```ts
    if (agent === 'E' && !hasPlel) {
      return [{ status: 'na', label: t('approval.step_na') }];
    }
    if (isOnlyMap && ['P', 'J', 'O', 'E'].includes(agent)) {
```

변경 후 (`isOnlyMap` 분기는 **유지**):
```ts
    if (isOnlyMap && ['P', 'J', 'O', 'E'].includes(agent)) {
```

1664행:

변경 전:
```tsx
              {(key === 'E' && !hasPlel) || (isOnlyMap && ['P', 'J', 'O', 'E'].includes(key)) ? (
```

변경 후:
```tsx
              {isOnlyMap && ['P', 'J', 'O', 'E'].includes(key) ? (
```

- [ ] **Step 4: `ApprovalRouteDiagram.tsx` 의 주석을 고친다**

7행:

변경 전:
```
 * E(EUV)는 plel 존재 시에만, Only MAP 의뢰는 R까지만 진행한다는 조건을 주석으로 안내한다.
```

변경 후:
```
 * Only MAP 의뢰는 R까지만 진행한다는 조건을 주석으로 안내한다.
```

렌더링(56행 `<Box label={agent('E')} dim />`)은 이미 조건 없이 그리므로 **손대지 않는다**.

- [ ] **Step 5: `hasPlel` 이 남아 있지 않은지 확인한다**

```bash
cd frontend && grep -rn "hasPlel" src/
```

Expected: **출력 없음**.

- [ ] **Step 6: 타입 체크·테스트·빌드를 돌린다**

```bash
cd frontend && npx tsc --noEmit && CI=true npx react-scripts test --watchAll=false --passWithNoTests && npm run build
```

Expected: 전부 성공. `npm run build` 까지 통과해야 배포 가능 상태다.

- [ ] **Step 7: 커밋한다**

```bash
git add frontend/src/locales/ko.json frontend/src/locales/en.json
git commit -m "$(cat <<'EOF'
feat(i18n): 상세보기 병기 문구 추가 + E 조건부 안내 문구 수정 (ko/en)

E 단계가 항상 진행되도록 바뀌어 route_diagram.note_e 와
guide.tour.steps.route.description 의 조건 서술을 수정한다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"

git add frontend/src/components/PagedDetailView.tsx frontend/src/components/ApprovalRouteDiagram.tsx
git commit -m "$(cat <<'EOF'
feat(detail): J-layer 탭에 Validation System 표시 + E 조건부 로직 제거

- detail.validation_system 우선, 없으면 저장된 J-layer 로 폴백 판정
- 상신 시 값과 확정값이 다르면 병기 표시
- 결재 경로에서 E 를 감추던 hasPlel 게이트 제거(Only MAP 분기는 유지)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: 문서 최신화 (규칙 C-4)

**Files:**
- Modify: `docs/APPROVAL.md:92-93`
- Modify: `docs/MAIL.md:113, 160`
- Modify: `docs/REQUEST.md` (detail 구조 절)

**Interfaces:**
- Consumes: Task 3·4·6·7·8 의 최종 동작
- Produces: 없음

- [ ] **Step 1: `docs/APPROVAL.md` 를 고친다**

92-93행.

변경 전:
```
  추가로 `has_ppid_plel()`이 참이면 **E**(due: 6영업일, 병렬)도 생성.
- `has_ppid_plel()`(`models.py:106`): J-layer 행 중 `pp` 값에 `plel`(대소문자 무관) 포함이 하나라도 있으면 E 단계 생성.
```

변경 후:
```
  추가로 **E**(due: 6영업일, 병렬)도 항상 생성한다.
- **E(MASK) 생성 조건(2026-07 변경)**: 이전에는 J-layer `pp` 에 `plel` 이 있을 때만 생성했으나, MASK 팀이 Validation System 대상/비대상 판정 자체를 검증하는 주체이므로 **대상/비대상과 무관하게 항상 생성**한다. Only MAP 의뢰서는 기존대로 P/O/E/J 없이 R→RA 로 끝난다. 판정 조건 함수 `has_ppid_plel()` 은 삭제됐다.
```

- [ ] **Step 2: `docs/MAIL.md` 를 고친다**

113행 — `` `E`계열은 `has_ppid_plel()`인 의뢰서에만 포함된다. `` 문장을 삭제하고, 라우팅 서술을 `일반 문서 R·RV·P·PV·O·E·EV·J·RA / Only MAP 문서 R·RV·RA(P/O/E/J 없음)` 로만 남긴다.

160행 — `` `has_ppid_plel()`이 아닌 의뢰서의 `E·EV`는 `` 부분을 삭제하고, "Only MAP 의뢰서의 `P·O·E·J` 는 행 자체를 만들지 않는다" 로만 남긴다.

- [ ] **Step 3: `docs/REQUEST.md` 에 detail 키를 문서화한다**

detail 구조를 설명하는 절에 다음을 추가한다.

```markdown
### Validation System 대상/비대상 (2026-07 추가)

`additional_notes` JSON 의 `detail` 하위에 저장한다. 모델 필드가 아니므로 마이그레이션이 없다.

| 키 | 값 | 설명 |
|---|---|---|
| `validation_system` | `'YES'`(대상) / `'NO'`(비대상) | 현재 유효값. 상신 시 상신자가 확정하고, 결재 과정에서 MASK(E) 팀이 최종 확정한다 |
| `validation_system_submitted` | `'YES'` / `'NO'` | 상신·재상신 시점의 상신자 값. MASK 가 값을 바꿔도 유지돼 두 판단의 차이를 남긴다. 임시저장에는 기록하지 않는다 |

- **자동 판정**: 활성 J-layer 행의 `pp` 에 판정 키워드가 하나라도 있으면 대상 (`isValidationTarget()`, `RequestPage/helpers.ts`).
- **상신 UI**: 위저드 3단계(J-layer) 표 상단 토글. 상신자가 직접 바꾸면 이후 J-layer 를 고쳐도 자동 갱신하지 않는다.
- **MASK 확정**: `POST /api/documents/<id>/approve-step/` 의 optional 필드 `validation_system` (`agent='E'` 일 때만 유효, `'YES'|'NO'` 외 값은 400).
- **레거시 문서**: 두 키가 없으면 저장된 `jayerRows` 로 그때그때 폴백 판정해 표시한다.
```

- [ ] **Step 4: 커밋한다**

```bash
git add docs/APPROVAL.md docs/MAIL.md docs/REQUEST.md
git commit -m "$(cat <<'EOF'
docs: E 단계 무조건 생성 + Validation System detail 키 반영

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: 전체 검증과 수동 시나리오 확인 (규칙 C)

프론트에 통합 테스트가 없으므로 **수동 브라우저 검증이 검증의 핵심**이다(규칙 C-2-1).

**Files:** 없음 (검증만)

- [ ] **Step 1: 백엔드 전체 테스트를 돌린다**

```bash
docker exec -it <backend> python manage.py test
```

Expected: 전체 PASS. 실패가 있으면 고치고 재실행 결과까지 보고한다.

- [ ] **Step 2: 프론트 타입 체크·테스트·빌드를 돌린다**

```bash
cd frontend && npx tsc --noEmit && CI=true npx react-scripts test --watchAll=false --passWithNoTests && npm run build
```

Expected: 전부 성공.

- [ ] **Step 3: 잔여 하드코딩·dead code 를 확인한다**

```bash
grep -rn "has_ppid_plel" backend/ frontend/src/
cd frontend && grep -rn "toLowerCase().includes('plel')" src/ ; grep -rn "'#fff9c4'" src/ ; grep -rn "hasPlel" src/ ; grep -rn "console.log" src/pages/RequestPage src/pages/ApprovalPage.tsx src/components/PagedDetailView.tsx
```

Expected: 전부 **출력 없음**.
(⚠️ 마스킹 훅 때문에 grep 출력이 재작성될 수 있다. 의심스러우면 Read 로 원문을 확인한다.)

- [ ] **Step 4: 수동 시나리오 A — 상신자 자동 판정과 크로스체크**

1. `http://localhost:10011` 접속 → 일반 사용자로 로그인
2. 의뢰서 작성 → 위저드 **3단계(J-layer)** 로 이동
3. 표에 행을 추가하고 `pp` 열에 판정 키워드가 **없는** 값을 넣는다
4. 표 상단 토글이 **비대상**으로 표시되는지 확인 — ✅ 성공 판정
5. 어떤 행의 `pp` 를 판정 키워드가 포함된 값으로 고친다
6. 셀이 **노랗게** 바뀌고 토글이 **자동으로 대상**으로 넘어가는지 확인 — ✅ 성공 판정
   - ❌ 실패 신호: 셀만 노래지고 토글이 안 바뀌면 자동 갱신 effect 의 의존성 배열을 확인한다
7. 토글을 **비대상**으로 직접 누른다 → 옆에 `자동 판정: 대상` 안내가 뜨는지 확인 — ✅ 성공 판정
8. 다시 `pp` 값을 바꿔본다 → 토글이 **비대상 그대로** 유지되는지 확인 (수동 변경 후 자동 갱신 중단) — ✅ 성공 판정
9. 그 행을 '선택 비활성화' 한다 → 활성 행에 키워드가 없어져도 토글은 그대로 (이미 수동) — ✅ 성공 판정

- [ ] **Step 5: 수동 시나리오 B — 상신 후 결재 경로에 MASK 팀이 보이는가**

1. 시나리오 A 의 의뢰서를 **비대상 상태로 상신**한다 (판정 키워드가 없는 J-layer 로)
2. 지정 PL 로그인 → 검토 합의
3. `TE_R` 역할로 로그인 → 담당자 지정 후 합의
4. **결재 현황 → 해당 의뢰서 행 클릭 → '결재 경로' 탭** 진입
5. **EUV(E) 단계가 '해당 없음'이 아니라 실제 대기 단계로 표시**되는지 확인 — ✅ 성공 판정 (이번 변경의 핵심)
   - ❌ 실패 신호: `해당 없음` 으로 보이면 `hasPlel` 제거가 덜 된 것이다
6. `TE_E` 계정으로 메일이 발송됐는지(또는 `MailNotification` 레코드가 생겼는지) 확인

- [ ] **Step 6: 수동 시나리오 C — MASK 팀의 확정**

1. `TE_E` 역할로 로그인 → 결재 현황에서 해당 의뢰서 진입
2. **'검토중'을 눌러 단계를 맡는다**
3. **'합의'** 클릭 → 모달 상단에 **`Validation System 확정` 토글**이 뜨는지 확인 — ✅ 성공 판정
   - ❌ 실패 신호: O·J 등 다른 단계에서 합의할 때도 토글이 보이면 `agent === 'E'` 조건이 빠진 것이다
4. 토글 초기값이 **상신자가 정한 값(비대상)** 으로 맞춰져 있는지 확인 — ✅ 성공 판정
5. **대상**으로 바꾸고 합의한다
6. **의뢰서 상세 → J-layer 탭** 진입 → 표 위에 **`Validation System  대상`** 배지와 그 옆에 **`상신 시 비대상 → 확정 대상`** 이 빨간 글씨로 함께 뜨는지 확인 — ✅ 성공 판정

- [ ] **Step 7: 수동 시나리오 D — 레거시 문서 폴백**

1. 이번 변경 **이전에 상신된 기존 의뢰서**(`detail.validation_system` 키가 없는 문서)를 결재 현황에서 연다
2. **J-layer 탭** 진입
3. 표 위 배지가 **저장된 J-layer 내용에 맞게** 대상/비대상으로 뜨는지 확인 (노란 `pp` 셀이 있으면 대상) — ✅ 성공 판정
4. 병기 표시(`상신 시 … → 확정 …`)는 **뜨지 않아야** 한다 (`validation_system_submitted` 가 없으므로) — ✅ 성공 판정
5. 이 문서의 '결재 경로' 탭에서 E 단계가 어떻게 보이는지 확인한다. **소급 생성을 하지 않기로 했으므로**, 이미 병렬 단계까지 진행된 기존 문서에 E step 이 없는 것은 정상이다

- [ ] **Step 8: 수동 시나리오 E — Only MAP 회귀 확인**

1. 새 의뢰서 작성 시 **요청 목적을 'Only MAP'** 으로 선택하고 상신한다
2. R 단계까지 합의한다
3. **'결재 경로' 탭**에서 `P·J·O·E` 가 전부 **'해당 없음'** 으로 표시되는지 확인 — ✅ 성공 판정
   - ❌ 실패 신호: E 만 대기 단계로 뜨면 `is_only_map()` 분기가 깨진 것이다

- [ ] **Step 9: 언어 전환 확인 (규칙 G)**

1. 화면 우측 상단에서 **언어를 English 로 전환**한다
2. 위저드 3단계 토글이 `Target` / `Non-target` 으로, 결재 모달이 `Confirm Validation System` 으로 나오는지 확인 — ✅ 성공 판정
   - ❌ 실패 신호: 한글이 그대로 남아 있거나 `request.validation_system_target` 같은 **키 자체가 화면에 노출**되면 `en.json` 에 키가 빠진 것이다

---

## 검토했다가 기각한 대안

이미 검토하고 버린 선택지다. **다시 제안하지 말 것** — 각 항목의 기각 사유가 여전히 유효하다.

| 대안 | 기각 사유 |
|---|---|
| `RequestDocument` 에 모델 필드 + 마이그레이션 추가 | `detail` JSON 에 넣으면 마이그레이션이 0 이고, 기존 detail 저장·복원·변경이력(`computeDetailDiff`) 기계를 그대로 재사용한다. 나중에 통계 집계가 필요해지면 그때 컬럼으로 승격하면 된다 |
| MASK 값 수정용 신규 엔드포인트(`set-validation-system` 등) | `views.py:490` 에 "P/E 합의 요청 한 번으로 검토자 지정까지 함께 처리" 하는 선례가 이미 있다. 같은 자리에 optional 필드로 얹는 편이 코드베이스 관례에 맞고, 권한 체크(`_can_act_on_step`)·`@transaction.atomic`·`select_for_update()` 를 그대로 재사용한다 |
| MASK 는 값을 못 고치고 반려만 하게 하기 | 사용자가 "MASK 가 값을 수정 가능" 을 명시적으로 선택했다 |
| E 단계를 조건부로 유지하고 표시 기능만 추가 | 최초 설계안이었으나 기각됐다. MASK 는 "이 제품이 정말 대상이 맞는가 / 비대상이 맞는가" 를 확인하는 검증 주체이므로, **비대상으로 판정된 문서야말로 검증이 필요**하다. 조건부로 두면 검증이 필요한 문서가 MASK 에게 가지 않는다 |
| Only MAP 문서에도 E 단계 추가 | Only MAP 문서는 `jayerRows`·`oayerRows` 를 빈 배열로 저장하므로 판정 근거 데이터 자체가 없다. MASK 가 판단할 재료가 없는 문서를 받게 된다 |
| 기존 진행 중 문서에 E step 소급 생성 | 마감일 기준일과 메일 발송 처리를 따로 정해야 하고, 운영 중 문서의 상태를 일괄 변경하는 리스크가 크다. 배포 후 R 단계를 통과하는 문서부터 적용한다 |
| 백엔드에서 대상/비대상을 자동 재계산 | 판정 규칙이 프론트·백엔드 두 곳에 생겨 언젠가 어긋난다. 판정은 프론트 `isValidationTarget()` 단일 소스가 하고, 백엔드는 저장된 값을 그대로 신뢰한다 |
| `has_ppid_plel()` 을 개명해 유지 | 참조처가 0 이 된다. 남기면 다음 사람이 "E 는 여전히 조건부" 로 오해한다(규칙 I: dead code 금지) |
| 기존 pp 하이라이트 6곳을 손대지 않기 | 사용자가 "프론트 6곳 전부 상수화" 를 선택했다. 판정 키워드가 8곳에 흩어지는 것을 막는다 |
| 프론트 테스트 없이 수동 검증만 | 순수 함수 2개는 Jest 로 싸게 검증할 수 있다. `@testing-library/*` 와 react-scripts 의 Jest 가 이미 설치돼 있어 설정 비용이 0 이다. 컴포넌트 렌더 테스트는 인프라가 없어 도입하지 않는다 |

## 알려진 제약과 주의사항

- **기존 진행 문서에는 E 단계가 소급 생성되지 않는다.** 배포 시점에 이미 병렬 단계까지 간 문서는 MASK 결재 없이 종결된다. 배포 직후 한동안 문서마다 결재 경로가 달라 보이는 것은 의도된 동작이다.
- **운영 영향이 크다.** E 단계가 모든 일반 문서에 생기므로 MASK 팀 결재 물량이 늘고, 반려 메일 수신자에도 MASK 팀이 항상 포함된다. **배포 전 팀 공지가 필요하다.**
- **MASK 팀이 결재를 받은 뒤 어떤 규칙으로 작업하는지는 이번 범위 밖이다.** 별도 논의 사항.
- **실제 사내 용어가 미확정이다.** 현재는 가명 `Validation System` / `대상` / `비대상` 으로 들어간다. 확정되면 `ko.json` / `en.json` 값만 바꾸면 된다 — 키 구조는 그대로다.
- **`frontend/src/pages/RequestPage/helpers.test.ts` 는 이 repo 최초의 프론트 테스트 파일이다.** `@testing-library/*` 와 react-scripts 의 Jest 는 이미 설치돼 있어 별도 설정이 필요 없다. 순수 함수만 테스트하므로 `setupTests.ts` 도 필요 없다.
