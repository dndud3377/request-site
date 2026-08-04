# Task 3: [HIGH] 레거시 문서에서 보이는 값을 클릭하면 되감기지 않게 한다

**작업 디렉터리:** `/Users/mac_wb/codespace/request-site/.claude/worktrees/bridge-cse_01Ueeczx2qjGTBUApYUboKsd` (브랜치 `woobin`). 메인 워크트리가 아니다. 아래 모든 상대 경로는 이 디렉터리 기준이다.

**선행 조건:** **Task 2가 끝나 있어야 한다.** 둘 다 `backend/api/views.py`의 `update_validation_system` 같은 구간을 수정하며, Task 2가 `_set_validation_system`의 반환값을 도입한 뒤 이 태스크가 그 바로 위의 비교 로직을 바꾼다.

---

## 문제

상세보기는 `detail.validation_system`이 없는 레거시 문서를 **'대상'으로 표시**한다. `frontend/src/components/PagedDetailView.tsx:626-630`:

```tsx
  const vsCurrent: ValidationSystemValue = !hasPlel
    ? VS_NA
    : ((detail.validation_system === VS_TARGET || detail.validation_system === VS_NONTARGET)
      ? detail.validation_system
      : VS_TARGET);
```

그런데 백엔드 `_get_validation_system`(`backend/api/views.py:1377`)은 같은 문서에서 `None`을 돌려준다. 그래서 `previous(None) != value('YES')`가 성립하고, 실제 변경으로 처리되어 **E 단계가 되감긴다.**

**실패 시나리오:** 이 기능 이전에 만들어진 plel 문서 — `detail`에 `validation_system` 키가 없다. E 담당자가 이미 합의했고 EV 하나가 대기 중이다. 상신자가 J-layer 탭을 열면 '대상'이 선택된 것으로 보인다. 확인차 '대상'을 그대로 클릭한다 → E 단계가 `pending`으로 복귀하고 "MASK 검토가 재검토 상태로 돌아갔습니다" 토스트가 뜬다. **사용자 관점에서는 아무것도 바꾸지 않았다.**

**기각한 대안 — 프론트의 폴백을 없앤다:** 이 폴백은 이번 변경이 만든 게 아니라 `HEAD`(`0cd18a6`)에 이미 있던 기존 동작이다. 아래로 직접 확인할 수 있다:

```bash
git show HEAD:frontend/src/components/PagedDetailView.tsx | sed -n '620,632p'
```

기존 표시 규칙을 바꾸면 이 작업과 무관한 문서들의 표시가 달라지고 규칙 H(요청 범위 최소)에 어긋난다. **어긋난 쪽은 새로 생긴 백엔드 비교 로직이다.**

**기각한 대안 — 폼 기본값에 맞춘다:** `frontend/src/pages/RequestPage/constants.ts:236`의 폼 기본값은 `validation_system: VS_NONTARGET`(비대상)이라 위 폴백(`대상`)과 어긋나 있다. 그러나 **화면이 실제로 표시하는 값은 `VS_TARGET`**이다. 사용자가 보고 있는 것과 다른 기준으로 비교하면 같은 버그가 방향만 바뀌어 재발한다. 두 기본값의 불일치 자체는 둘 다 기존 코드이므로 이번 범위 밖이다.

---

**Files:**
- Modify: `backend/api/views.py:1374-1375`(상수 추가), `backend/api/views.py:1092-1094`(비교 로직)
- Test: `backend/api/tests.py` — 기존 `PEStageReviewerFlowTest` 클래스(`backend/api/tests.py:812`) 내부

**Interfaces:**
- Consumes: `_get_validation_system(document)`(Task 2에서 변경되지 않음), `VALIDATION_SYSTEM_VALUES = ('YES', 'NO')`(`backend/api/views.py:1375`)
- Produces: `VALIDATION_SYSTEM_LEGACY_DEFAULT = 'YES'` — 클래스 상수. 프론트 폴백과 같은 값이어야 한다.

---

- [ ] **Step 1: 실패하는 테스트를 먼저 쓴다**

`backend/api/tests.py`에서 Task 2가 추가한 `test_broken_detail_json_does_not_rewind` **바로 뒤**에 추가한다.

```python
    def test_legacy_doc_clicking_displayed_value_does_not_rewind(self):
        """저장값이 없는 레거시 문서에서 화면에 보이는 값('대상')을 그대로 클릭하면 되감지 않는다.

        상세보기(PagedDetailView 의 vsCurrent 폴백)가 키 없는 문서를 '대상'으로 표시하므로,
        백엔드도 같은 기준으로 비교해야 사용자가 '바꾸지 않았는데 되감겼다'를 겪지 않는다.
        """
        doc = self._advance_to_parallel(plel=True)
        # _set_detail 을 호출하지 않는다 → detail 은 {} 이고 validation_system 키가 없다.
        self.assertEqual(self._approve_e(doc, reviewers=[self.e_reviewer.loginid]).status_code, 200)

        self.client.force_authenticate(user=self.requester)
        r = self.client.post(f'/api/documents/{doc.id}/validation-system/', {'value': 'YES'}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        self.assertFalse(r.data['rewound'], '보이는 값과 같으므로 변경이 아니다')

        e_step = ApprovalStep.objects.get(document=doc, agent='E', round=1)
        self.assertEqual(e_step.action, 'approved')

    def test_legacy_doc_real_change_still_rewinds(self):
        """레거시 폴백을 적용해도 진짜 변경('비대상' 선택)은 그대로 되감는다."""
        doc = self._advance_to_parallel(plel=True)
        self.assertEqual(self._approve_e(doc, reviewers=[self.e_reviewer.loginid]).status_code, 200)

        self.client.force_authenticate(user=self.requester)
        r = self.client.post(f'/api/documents/{doc.id}/validation-system/', {'value': 'NO'}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(r.data['rewound'])

        self.assertEqual(self._get_detail(doc)['validation_system'], 'NO')
        e_step = ApprovalStep.objects.get(document=doc, agent='E', round=1)
        self.assertEqual(e_step.action, 'pending')
        self.assertIn('재검토', e_step.comment)
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

```bash
docker exec -it request_backend_dev python manage.py test api.tests.PEStageReviewerFlowTest.test_legacy_doc_clicking_displayed_value_does_not_rewind api.tests.PEStageReviewerFlowTest.test_legacy_doc_real_change_still_rewinds -v 2
```

기대: 첫 번째 **FAIL**(현재는 `rewound`가 `True`), 두 번째 **PASS**(현재도 되감긴다 — 회귀 방지용이다). 실행할 수 없으면 미실행이라고 기록한다.

- [ ] **Step 3: 상수를 추가한다**

`backend/api/views.py`의 `VALIDATION_SYSTEM_VALUES` 선언(1374-1375행) 바로 아래에 추가한다.

바꾸기 전:
```python
    # Validation System 대상/비대상 값 (프론트 constants.ts 의 VS_TARGET/VS_NONTARGET 과 동일)
    VALIDATION_SYSTEM_VALUES = ('YES', 'NO')
```

바꾼 뒤:
```python
    # Validation System 대상/비대상 값 (프론트 constants.ts 의 VS_TARGET/VS_NONTARGET 과 동일)
    VALIDATION_SYSTEM_VALUES = ('YES', 'NO')
    # 저장값이 없는 레거시 문서를 상세보기가 '대상'으로 표시한다
    # (PagedDetailView.tsx 의 vsCurrent 폴백). 변경 여부 판정을 화면과 같은 기준으로
    # 맞추기 위한 값이므로, 프론트 폴백을 바꾸면 이 값도 함께 바꿔야 한다.
    VALIDATION_SYSTEM_LEGACY_DEFAULT = 'YES'
```

- [ ] **Step 4: 비교 전에 정규화한다**

`backend/api/views.py:1092-1094`를 바꾼다.

바꾸기 전:
```python
        previous = self._get_validation_system(document)
        if previous == value:
            return Response({'message': '변경 사항이 없습니다.', 'rewound': False})
```

바꾼 뒤:
```python
        previous = self._get_validation_system(document)
        if previous not in self.VALIDATION_SYSTEM_VALUES:
            # 키가 없거나 값이 깨진 레거시 문서 — 상신자가 화면에서 보고 있는 값과
            # 같은 기준으로 비교해야 '보이는 값을 눌렀는데 되감겼다'가 발생하지 않는다.
            previous = self.VALIDATION_SYSTEM_LEGACY_DEFAULT
        if previous == value:
            return Response({'message': '변경 사항이 없습니다.', 'rewound': False})
```

정규화된 `previous`는 아래 `_rewind_e_stage(document, max_round, previous, value, actor)` 호출에도 그대로 넘어간다. 되감기 사유 문구가 `- → NO` 대신 `YES → NO`로 찍히므로 사용자가 본 것과 일치한다 — **의도된 것이다.**

- [ ] **Step 5: 테스트를 다시 돌려 통과를 확인한다**

```bash
docker exec -it request_backend_dev python manage.py test api.tests.PEStageReviewerFlowTest -v 2
```

기대: 신규 2건 PASS + 기존 전부 PASS. 특히 `test_requester_updates_validation_system`(`detail`에 `'NO'`를 명시적으로 넣고 `'YES'`로 바꾸는 테스트)이 여전히 통과해야 한다 — 저장값이 `VALIDATION_SYSTEM_VALUES`에 있으므로 정규화가 개입하지 않는다.

- [ ] **Step 6: 커밋**

```bash
git add backend/api/views.py backend/api/tests.py
git commit -m "fix: 레거시 문서에서 표시된 값을 클릭해도 E 단계를 되감지 않는다

상세보기는 validation_system 키가 없는 문서를 '대상'으로 표시하는데(기존 동작)
백엔드는 None 으로 읽어 '대상' 클릭을 실제 변경으로 처리하고 E 를 되감았다.
비교 전에 프론트와 같은 폴백을 적용한다."
```
