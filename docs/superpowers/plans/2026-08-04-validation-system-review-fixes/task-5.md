# Task 5: [HIGH] E/EV 합의가 수정요청·되감기 이력을 지우지 않게 한다

**작업 디렉터리:** `/Users/mac_wb/codespace/request-site/.claude/worktrees/bridge-cse_01Ueeczx2qjGTBUApYUboKsd` (브랜치 `woobin`). 메인 워크트리가 아니다. 아래 모든 상대 경로는 이 디렉터리 기준이다.

**선행 조건:** Task 0·2·3·4가 끝나 있어야 한다. 이 태스크가 건드리는 `backend/api/views.py` 구간(502-506행)은 앞 태스크와 겹치지 않지만, `backend/api/tests.py`에는 Task 4가 추가한 메서드 **뒤에** 테스트를 붙이므로 순서를 지킨다.

---

## 문제

`approve_step`(`backend/api/views.py:504`)이 `step.comment = comment`로 **덮어쓴다.** 그런데 '수정 요청'(`backend/api/views.py:704`)과 '되감기'(`backend/api/views.py:1430`)의 사유가 바로 그 `ApprovalStep.comment`에 쌓인다. `ApprovalStep` 모델에는 이력 전용 필드가 없어서(`backend/api/models.py:228`) 여기가 유일한 저장소다.

**실패 시나리오:** MASK가 수정 요청("대상으로 보입니다")을 보낸다 → `e_step.comment`에 `[수정 요청 …] 대상으로 보입니다`가 기록된다 → 상신자가 값을 바꾸면 `[재검토 …] NO → YES (변경: 홍길동)`가 덧붙는다 → E 담당자가 **빈 코멘트로 합의**한다 → `step.comment = ''` → **수정 요청과 되감기의 흔적이 전부 사라진다.**

이건 설계 결정 Q6("이력 보존을 위해 EV step을 삭제하지 않는다")와 Q3("status를 안 건드리고 코멘트로 남긴다")을 실행 시점에 무효화한다. 2026-08-03에 작성된 기존 테스트 10건 중 이걸 잡는 게 없다.

**기각한 대안 — 모든 agent에 적용한다:** 이력이 쌓이는 곳은 E/EV step뿐이다. `comment`를 덮어쓰는 다른 지점(`backend/api/views.py:711` non-E/EV 반려, `1263` `_advance_after_pl`, `1307` `peer_reject`)은 전부 E/EV를 밟지 않으므로 건드릴 필요가 없다. 다른 단계의 동작을 바꾸면 회귀 위험만 늘어난다(규칙 H).

**기각한 대안 — 이력 전용 저장소를 만든다:** 설계 결정 Q7이 "값이 `YES`/`NO` 둘뿐이라 전체 이력 배열은 과하다"며 이미 기각했다. trail을 지울 수 있는 경로가 `views.py:504` 하나뿐임을 확인했으므로(재상신은 `round+1`로 이전 회차 step을 보존한다), 그 하나를 막으면 Q7의 근거가 실제로 성립한다. 마이그레이션도 불필요하다.

**왜 마커를 붙이는가:** 마커 없이 이어 붙이면 `[수정 요청 08-03 10:12] 대상으로 보입니다` 다음 줄의 텍스트가 누가 언제 쓴 건지 구분되지 않는다. 기존 이력 항목들이 전부 `[라벨 시각]` 형식이므로 같은 형식을 따른다. 누적된 여러 줄은 결재 경로 탭에서 `whiteSpace: 'pre-wrap'`으로 정상 렌더된다(`frontend/src/components/PagedDetailView.tsx:1771`).

---

**Files:**
- Modify: `backend/api/views.py:502-506`
- Test: `backend/api/tests.py` — 기존 `PEStageReviewerFlowTest` 클래스(`backend/api/tests.py:812`) 내부

**Interfaces:**
- Consumes: 없음
- Produces: 없음 (`approve_step`의 응답 형태는 그대로다)

---

- [ ] **Step 1: 실패하는 테스트를 먼저 쓴다**

Task 4가 추가한 `test_reviewer_added_on_reapproval_is_created` **바로 뒤**에 추가한다.

```python
    def test_e_approval_preserves_revision_request_history(self):
        """E 가 빈 코멘트로 최종 합의해도 수정 요청 이력이 지워지지 않는다.

        ApprovalStep 에 이력 전용 필드가 없어 comment 가 유일한 저장소다.
        여기를 덮어쓰면 설계 결정 Q3/Q6(이력 보존)이 실행 시점에 무효화된다.
        """
        doc = self._advance_to_parallel(plel=True)
        self.client.force_authenticate(user=self.e_owner)
        self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': 'E'}, format='json')
        r = self.client.post(
            f'/api/documents/{doc.id}/reject-step/',
            {'agent': 'E', 'comment': '대상으로 보입니다'}, format='json',
        )
        self.assertEqual(r.status_code, 200, r.content)

        # 같은 담당자가 빈 코멘트로 합의한다(step 은 이미 선점 상태다).
        r = self.client.post(
            f'/api/documents/{doc.id}/approve-step/',
            {'agent': 'E', 'comment': ''}, format='json',
        )
        self.assertEqual(r.status_code, 200, r.content)

        e_step = ApprovalStep.objects.get(document=doc, agent='E', round=1)
        self.assertEqual(e_step.action, 'approved')
        self.assertIn('수정 요청', e_step.comment, '합의가 수정 요청 이력을 지워서는 안 된다')
        self.assertIn('대상으로 보입니다', e_step.comment)

    def test_e_approval_appends_comment_to_existing_history(self):
        """E 가 코멘트를 달고 합의하면 기존 이력 아래에 마커와 함께 덧붙는다."""
        doc = self._advance_to_parallel(plel=True)
        self.client.force_authenticate(user=self.e_owner)
        self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': 'E'}, format='json')
        self.client.post(
            f'/api/documents/{doc.id}/reject-step/',
            {'agent': 'E', 'comment': '대상으로 보입니다'}, format='json',
        )
        r = self.client.post(
            f'/api/documents/{doc.id}/approve-step/',
            {'agent': 'E', 'comment': '수정 확인했습니다'}, format='json',
        )
        self.assertEqual(r.status_code, 200, r.content)

        e_step = ApprovalStep.objects.get(document=doc, agent='E', round=1)
        self.assertIn('수정 요청', e_step.comment)
        self.assertIn('[합의 ', e_step.comment)
        self.assertIn('수정 확인했습니다', e_step.comment)

    def test_non_mask_approval_still_overwrites_comment(self):
        """E/EV 가 아닌 단계의 합의는 기존대로 comment 를 덮어쓴다(회귀 방지)."""
        doc = self._advance_to_parallel(plel=True)
        self.client.force_authenticate(user=self.o_user)
        self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': 'O'}, format='json')
        r = self.client.post(
            f'/api/documents/{doc.id}/approve-step/',
            {'agent': 'O', 'comment': '확인'}, format='json',
        )
        self.assertEqual(r.status_code, 200, r.content)

        o_step = ApprovalStep.objects.get(document=doc, agent='O', round=1)
        self.assertEqual(o_step.comment, '확인', '다른 단계의 comment 처리는 바뀌지 않는다')
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

```bash
docker exec -it request_backend_dev python manage.py test api.tests.PEStageReviewerFlowTest.test_e_approval_preserves_revision_request_history api.tests.PEStageReviewerFlowTest.test_e_approval_appends_comment_to_existing_history api.tests.PEStageReviewerFlowTest.test_non_mask_approval_still_overwrites_comment -v 2
```

기대: 앞의 두 개 **FAIL**(현재는 `comment`가 덮어써져 `'수정 요청'`이 사라진다), 세 번째 **PASS**(회귀 방지용). 실행할 수 없으면 미실행이라고 기록한다.

- [ ] **Step 3: E/EV만 누적하도록 고친다**

`backend/api/views.py:502-506`을 바꾼다.

바꾸기 전:
```python
        step.action = 'approved'
        step.acted_at = timezone.now()
        step.comment = comment
        if not step.assignee_name:
            step.assignee_name = request.data.get('approver_name', '')
```

바꾼 뒤:
```python
        step.action = 'approved'
        step.acted_at = timezone.now()
        # E/EV 의 comment 는 '수정 요청'(reject_step)과 '되감기'(_rewind_e_stage) 이력이
        # 쌓이는 유일한 저장소다 — ApprovalStep 에 이력 전용 필드가 없다. 덮어쓰면
        # 설계 결정(이력 보존)이 최종 합의 시점에 통째로 무효화되므로 덧붙인다.
        if step.agent in ('E', 'EV') and step.comment:
            if comment:
                stamp = timezone.now().strftime('%Y-%m-%d %H:%M')
                step.comment = f'{step.comment}\n[합의 {stamp}] {comment}'
        else:
            step.comment = comment
        if not step.assignee_name:
            step.assignee_name = request.data.get('approver_name', '')
```

동작 정리 — 세 갈래다:

| 조건 | 결과 |
|---|---|
| E/EV이고 기존 comment가 있고 새 comment도 있다 | `기존\n[합의 시각] 새것` |
| E/EV이고 기존 comment가 있는데 새 comment가 비었다 | **기존 그대로 둔다** (빈 문자열로 지우지 않는다) |
| 그 외 (E/EV가 아니거나 기존 comment가 없다) | 기존과 동일하게 `step.comment = comment` |

- [ ] **Step 4: 테스트를 다시 돌려 통과를 확인한다**

```bash
docker exec -it request_backend_dev python manage.py test api.tests.PEStageReviewerFlowTest -v 2
```

기대: 신규 3건 PASS + 기존 전부 PASS. 특히 `test_e_reject_becomes_revision_request`와 `test_change_after_e_approval_rewinds_only_e_stage`가 통과해야 한다.

- [ ] **Step 5: 커밋**

```bash
git add backend/api/views.py backend/api/tests.py
git commit -m "fix: E/EV 합의가 수정요청·되감기 이력을 덮어쓰지 않는다

ApprovalStep 에 이력 전용 필드가 없어 comment 가 유일한 저장소인데,
approve_step 이 이를 통째로 대입해 E 최종 합의 시 이력이 전소됐다.
E/EV 단계에 한해 기존 comment 아래에 [합의 시각] 마커와 함께 덧붙이고,
그 외 단계의 동작은 그대로 둔다."
```
