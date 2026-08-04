# Task 2: [HIGH] 저장 실패를 삼키지 않고 되감기를 막는다

**작업 디렉터리:** `/Users/mac_wb/codespace/request-site/.claude/worktrees/bridge-cse_01Ueeczx2qjGTBUApYUboKsd` (브랜치 `woobin`). 메인 워크트리가 아니다. 아래 모든 상대 경로는 이 디렉터리 기준이다.

**선행 조건:** Task 0(스냅샷 커밋)이 끝나 있어야 한다. **Task 3보다 먼저 실행한다** — 둘 다 `backend/api/views.py`의 `update_validation_system` 같은 구간을 수정한다.

---

## 문제

`_set_validation_system`(`backend/api/views.py:1386`)이 `except (json.JSONDecodeError, TypeError): pass`로 저장 실패를 조용히 삼킨다. 호출부(`backend/api/views.py:1097`)는 성공 여부를 모른 채 곧바로 `_rewind_e_stage`를 실행하고 `rewound: True`를 응답한다.

**실패 시나리오:** `additional_notes`가 유효한 JSON이 아닌 문서에서 상신자가 값을 바꾼다 → 저장은 no-op → 그런데 E 단계와 합의된 EV 단계가 전부 `pending`으로 되감긴다 → 응답은 `200 {"message":"변경했습니다.","rewound":true}` → 상신자는 "MASK 검토가 재검토 상태로 돌아갔습니다" 토스트를 보고, MASK는 다시 검토하는데, **저장된 값은 하나도 안 바뀌었다.**

**왜 500인가:** 실패 원인이 서버에 저장된 `additional_notes`의 손상이다. 클라이언트가 요청을 고쳐서 해결할 수 있는 문제가 아니므로 4xx가 아니다.

**기각한 대안 — 예외를 raise 한다:** `@transaction.atomic` 안이라 롤백은 깨끗하지만, 이 시점엔 아직 아무것도 쓰지 않아 롤백할 게 없다. `Response` 반환이 더 단순하고 응답 본문을 통제할 수 있다.

---

**Files:**
- Modify: `backend/api/views.py:1386-1404` (`_set_validation_system`), `backend/api/views.py:1096-1099` (호출부)
- Test: `backend/api/tests.py` — 기존 `PEStageReviewerFlowTest` 클래스(`backend/api/tests.py:812`) 내부. **새 클래스를 만들지 않는다** — 이 클래스의 `setUp` 픽스처(`self.requester`, `self.e_owner`, `self.e_reviewer`, `self.o_user`)와 `_advance_to_parallel` / `_set_detail` / `_get_detail` / `_approve_e` 헬퍼가 필요하다.

**Interfaces:**
- Consumes: 없음
- Produces: `_set_validation_system(document, value, changed_by=None) -> bool` — 저장 성공이면 `True`, `additional_notes` 파싱 실패로 저장하지 못했으면 `False`.

---

- [ ] **Step 1: 실패하는 테스트를 먼저 쓴다**

`backend/api/tests.py`의 `test_same_value_does_not_rewind` 메서드 **바로 뒤**(현재 1240행 근처, `test_update_blocked_after_e_stage_complete` 앞)에 추가한다.

```python
    def test_broken_detail_json_does_not_rewind(self):
        """additional_notes 가 깨져 저장에 실패하면 500 이고, E 단계를 되감지 않는다."""
        doc = self._advance_to_parallel(plel=True)
        self._set_detail(doc, {'validation_system': 'NO'})
        self.assertEqual(self._approve_e(doc, reviewers=[self.e_reviewer.loginid]).status_code, 200)

        # 저장을 실패시키기 위해 additional_notes 를 깨뜨린다.
        # _set_detail 은 json.loads 를 쓰므로 여기서는 쓸 수 없다.
        doc.additional_notes = '{"detail": broken'
        doc.save(update_fields=['additional_notes'])

        self.client.force_authenticate(user=self.requester)
        r = self.client.post(f'/api/documents/{doc.id}/validation-system/', {'value': 'YES'}, format='json')
        self.assertEqual(r.status_code, 500, r.content)

        e_step = ApprovalStep.objects.get(document=doc, agent='E', round=1)
        self.assertEqual(e_step.action, 'approved', '저장이 실패했으면 되감아서는 안 된다')
        self.assertNotIn('재검토', e_step.comment)
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

```bash
docker exec -it request_backend_dev python manage.py test api.tests.PEStageReviewerFlowTest.test_broken_detail_json_does_not_rewind -v 2
```

기대: **FAIL.** 현재 코드는 200을 반환하고 `e_step.action`이 `pending`이 되므로 `assertEqual(r.status_code, 500)`에서 `200 != 500`으로 깨진다.

**컨테이너가 없으면:** `00-overview.md`의 부록 A로 띄우거나, 띄울 수 없으면 **"미실행"이라고 기록하고** Step 3으로 간다.

- [ ] **Step 3: `_set_validation_system`이 성공 여부를 반환하게 한다**

`backend/api/views.py`의 `_set_validation_system` 전체를 교체한다(현재 1386-1404행).

바꾸기 전:
```python
    def _set_validation_system(self, document, value, changed_by=None):
        """detail.validation_system 을 덮어쓴다.

        changed_by 가 주어지면 마지막 변경 주체/시각도 함께 남긴다 — 판정 주체가
        상신자 하나이므로, 그 유일한 공급원의 변경을 추적할 지점이 필요하다.
        validation_system_submitted(상신 시점 상신자 값)는 건드리지 않는다.
        JSON 파싱 실패 시 조용히 건너뛴다(_sync_post_approvers_detail 과 같은 정책).
        """
        import json
        try:
            data = json.loads(document.additional_notes or '{}')
            detail = data.get('detail', {}) or {}
            detail['validation_system'] = value
            if changed_by is not None:
                detail['validation_system_changed_by'] = changed_by
                detail['validation_system_changed_at'] = timezone.now().isoformat()
            data['detail'] = detail
            document.additional_notes = json.dumps(data, ensure_ascii=False)
            document.save(update_fields=['additional_notes'])
        except (json.JSONDecodeError, TypeError):
            pass
```

바꾼 뒤:
```python
    def _set_validation_system(self, document, value, changed_by=None):
        """detail.validation_system 을 덮어쓴다. 저장했으면 True, 못 했으면 False.

        changed_by 가 주어지면 마지막 변경 주체/시각도 함께 남긴다 — 판정 주체가
        상신자 하나이므로, 그 유일한 공급원의 변경을 추적할 지점이 필요하다.
        validation_system_submitted(상신 시점 상신자 값)는 건드리지 않는다.
        파싱 실패를 조용히 삼키면 호출부가 '저장됐다'고 착각해 E 단계를 되감으므로
        (저장은 안 됐는데 MASK 재검토만 발생), 성공 여부를 반드시 돌려준다.
        """
        import json
        try:
            data = json.loads(document.additional_notes or '{}')
            detail = data.get('detail', {}) or {}
        except (json.JSONDecodeError, TypeError):
            return False
        detail['validation_system'] = value
        if changed_by is not None:
            detail['validation_system_changed_by'] = changed_by
            detail['validation_system_changed_at'] = timezone.now().isoformat()
        data['detail'] = detail
        document.additional_notes = json.dumps(data, ensure_ascii=False)
        document.save(update_fields=['additional_notes'])
        return True
```

- [ ] **Step 4: 호출부가 실패 시 중단하게 한다**

`backend/api/views.py:1096-1098`을 바꾼다.

바꾸기 전:
```python
        actor = getattr(request.user, 'username', '') or getattr(request.user, 'loginid', '')
        self._set_validation_system(document, value, changed_by=actor)
        rewound = self._rewind_e_stage(document, max_round, previous, value, actor)
```

바꾼 뒤:
```python
        actor = getattr(request.user, 'username', '') or getattr(request.user, 'loginid', '')
        if not self._set_validation_system(document, value, changed_by=actor):
            return Response(
                {'error': '의뢰서 데이터가 손상되어 값을 저장할 수 없습니다.'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        rewound = self._rewind_e_stage(document, max_round, previous, value, actor)
```

- [ ] **Step 5: 테스트를 다시 돌려 통과를 확인한다**

```bash
docker exec -it request_backend_dev python manage.py test api.tests.PEStageReviewerFlowTest -v 2
```

기대: 신규 `test_broken_detail_json_does_not_rewind` PASS + **기존 테스트 전부 PASS**(회귀 없음). 실행할 수 없으면 미실행이라고 기록한다.

- [ ] **Step 6: 커밋**

```bash
git add backend/api/views.py backend/api/tests.py
git commit -m "fix: Validation System 저장 실패 시 되감기를 실행하지 않는다

_set_validation_system 이 JSON 파싱 실패를 삼켜서, 값이 저장되지 않았는데도
E 단계가 재검토로 되감기고 응답은 rewound=true 였다. 성공 여부를 bool 로
돌려주고 실패하면 500 으로 중단한다."
```
