# Task 4: [HIGH] `_create_reviewers`의 중복 가드를 되돌린다

**작업 디렉터리:** `/Users/mac_wb/codespace/request-site/.claude/worktrees/bridge-cse_01Ueeczx2qjGTBUApYUboKsd` (브랜치 `woobin`). 메인 워크트리가 아니다. 아래 모든 상대 경로는 이 디렉터리 기준이다.

**선행 조건:** Task 0·2·3이 끝나 있어야 한다. 이 태스크가 건드리는 `backend/api/views.py` 구간(841-847행)은 Task 2·3과 겹치지 않지만, `backend/api/tests.py`에는 Task 3이 추가한 메서드 **뒤에** 테스트를 붙이므로 순서를 지킨다.

---

## 문제

2026-08-03에 되감기 후 EV 중복 생성을 막으려고 `_create_reviewers`(`backend/api/views.py:842-847`)에 "그 회차에 검토자 step이 하나라도 있으면 통째로 return" 가드를 넣었다. **불필요했고 해롭다.**

**불필요한 이유:** `_validate_reviewers`(`backend/api/views.py:810-819`)가 **이미** 그 `(document, review_agent, round)`의 기존 검토자를 `existing_loginids`로 제외하고 `to_create`만 돌려준다. 중복 생성은 애초에 일어나지 않았다.

**해로운 이유:** 가드는 "이미 검토자가 하나라도 있으면 **새로 검증된 검토자 전원을 버린다**".

**실패 시나리오:** E가 검토자 `e2`를 지정하고 합의 → 상신자가 값을 바꿔 E가 되감김 → E 담당자가 다시 합의하면서 이번엔 `e3`도 추가로 지정 → `_validate_reviewers`는 `[e3]`을 정상 반환 → 그런데 가드가 `e2`의 step 존재를 보고 **return** → `e3`은 EV step도 메일도 못 받는데 API는 `200 "처리되었습니다."` → E 단계는 `e2` 혼자로 완료된다. P/PV도 `_create_reviewers`가 한 회차에 두 번 도달하면 같은 일이 벌어진다.

최초 P/E 흐름은 깨지지 않는다(그 시점엔 PV/EV 행이 없다). 회차는 `round_no`로 구분되므로 회차 간 흐름도 무관하다.

**기각한 대안 — 가드를 고쳐 쓴다:** `to_create`만 필터링하도록 조건을 좁히는 것은 `_validate_reviewers`가 이미 하는 일의 중복이다. 통째로 되돌리는 게 맞다.

---

**Files:**
- Modify: `backend/api/views.py:841-847` (가드 삭제)
- Test: `backend/api/tests.py` — 기존 `PEStageReviewerFlowTest` 클래스(`backend/api/tests.py:812`)의 `setUp`에 픽스처 1개 추가 + 테스트 1건 추가

**Interfaces:**
- Consumes: `_validate_reviewers`(변경 없음)
- Produces: `self.e_reviewer2` — `setUp`의 새 픽스처(`loginid='e3'`, `role='TE_E'`). 이후 태스크는 사용하지 않는다.

---

- [ ] **Step 1: 픽스처를 추가한다**

`backend/api/tests.py`의 `PEStageReviewerFlowTest.setUp`에서 `self.e_reviewer` 선언(834행) 바로 뒤에 한 줄 추가한다.

바꾸기 전:
```python
        self.e_reviewer = UserProfile.objects.create(loginid='e2', mail='e2@c.com', role='TE_E')
```

바꾼 뒤:
```python
        self.e_reviewer = UserProfile.objects.create(loginid='e2', mail='e2@c.com', role='TE_E')
        self.e_reviewer2 = UserProfile.objects.create(loginid='e3', mail='e3@c.com', role='TE_E')
```

- [ ] **Step 2: 실패하는 테스트를 먼저 쓴다**

Task 3이 추가한 `test_legacy_doc_real_change_still_rewinds` **바로 뒤**에 추가한다.

```python
    def test_reviewer_added_on_reapproval_is_created(self):
        """되감긴 뒤 재합의하며 검토자를 추가하면 그 검토자의 EV step 이 실제로 생성된다."""
        doc = self._advance_to_parallel(plel=True)
        self._set_detail(doc, {'validation_system': 'NO'})
        self.assertEqual(self._approve_e(doc, reviewers=[self.e_reviewer.loginid]).status_code, 200)

        # 상신자가 값을 바꿔 E 단계를 되감는다.
        self.client.force_authenticate(user=self.requester)
        r = self.client.post(f'/api/documents/{doc.id}/validation-system/', {'value': 'YES'}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(r.data['rewound'])

        # E 담당자가 검토자를 한 명 더 붙여 재합의한다(step 은 이미 선점 상태다).
        self.client.force_authenticate(user=self.e_owner)
        r = self.client.post(
            f'/api/documents/{doc.id}/approve-step/',
            {'agent': 'E', 'comment': '재확인함',
             'reviewer_loginids': [self.e_reviewer.loginid, self.e_reviewer2.loginid]},
            format='json',
        )
        self.assertEqual(r.status_code, 200, r.content)

        self.assertTrue(
            ApprovalStep.objects.filter(
                document=doc, agent='EV', round=1, assignee__loginid=self.e_reviewer2.loginid
            ).exists(),
            '새로 추가한 검토자의 EV step 이 조용히 버려져서는 안 된다',
        )
```

- [ ] **Step 3: 테스트를 돌려 실패를 확인한다**

```bash
docker exec -it request_backend_dev python manage.py test api.tests.PEStageReviewerFlowTest.test_reviewer_added_on_reapproval_is_created -v 2
```

기대: **FAIL** — `e3`의 EV step이 생성되지 않아 마지막 `assertTrue`가 깨진다. 실행할 수 없으면 미실행이라고 기록한다.

- [ ] **Step 4: 가드를 삭제한다**

`backend/api/views.py`에서 아래 6줄(주석 2줄 + 가드 4줄, 841-847행 부근)을 **삭제**한다.

삭제 대상:
```python
        # 되감기(_rewind_e_stage) 후 담당자가 다시 합의하면 그 회차 검토자 step 이 이미 존재한다.
        # 지정 이력을 보존하려고 남겨둔 것이므로 다시 만들지 않는다(같은 검토자가 바뀐 값을 재확인).
        if ApprovalStep.objects.filter(
            document=document, agent=review_agent, round=round_no
        ).exists():
            return
```

삭제 후 그 자리는 이렇게 이어져야 한다:
```python
        review_agent = self._REVIEW_AGENT_OF[step.agent]
        for reviewer_user in reviewer_users:
            rv_step = ApprovalStep.objects.create(
```

- [ ] **Step 5: 테스트를 다시 돌려 통과를 확인한다**

```bash
docker exec -it request_backend_dev python manage.py test api.tests.PEStageReviewerFlowTest -v 2
```

기대: 신규 PASS + 기존 전부 PASS. 특히 `test_change_after_e_approval_rewinds_only_e_stage`("EV 지정 이력은 삭제하지 않는다")가 여전히 통과해야 한다 — 되감기는 EV step을 삭제하지 않고 `action`만 되돌리므로, 같은 검토자를 다시 지정해도 `_validate_reviewers`가 걸러낸다.

- [ ] **Step 6: 커밋**

```bash
git add backend/api/views.py backend/api/tests.py
git commit -m "fix: _create_reviewers 중복 가드 제거 (신규 검토자가 버려지던 문제)

_validate_reviewers 가 이미 해당 회차의 기존 검토자를 제외하고 to_create 만
돌려주므로 중복 생성은 일어나지 않았다. 추가된 가드는 회차에 검토자 step 이
하나라도 있으면 새로 검증된 검토자를 전원 버려서, 되감기 후 재합의하며
검토자를 추가할 때 그 검토자가 조용히 사라졌다."
```
