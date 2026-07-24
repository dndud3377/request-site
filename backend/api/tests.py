"""결재 알림 메일(mailer) 단위 테스트

외부 DXHUB API 호출은 모두 mock 처리한다.
"""
from unittest.mock import patch

from django.test import TestCase, override_settings

from . import mailer
from .models import (
    ApprovalStep, MailNotification, RequestDocument, UserGroup, UserProfile,
)


def _make_document(requester):
    return RequestDocument.objects.create(
        title='테스트 의뢰서',
        requester=requester,
        requester_name='요청자',
        requester_email='req@company.com',
        requester_department='개발팀',
        product_name='PROD-1',
    )


class RecipientResolutionTest(TestCase):
    def setUp(self):
        self.requester = UserProfile.objects.create(
            loginid='req', mail='req@company.com', role='NONE'
        )
        self.doc = _make_document(self.requester)

    def test_pl_recipient_is_designated_pl(self):
        pl = UserProfile.objects.create(loginid='pl', mail='pl@company.com', role='PL')
        step = ApprovalStep.objects.create(
            document=self.doc, agent='PL', assignee=pl, assignee_name='pl'
        )
        self.assertEqual(
            mailer.resolve_stage_recipients(self.doc, 'PL', step),
            ['pl@company.com'],
        )

    def test_j_unassigned_uses_fixed_fallback(self):
        step = ApprovalStep.objects.create(document=self.doc, agent='J')
        self.assertEqual(
            mailer.resolve_stage_recipients(self.doc, 'J', step),
            ['user_J@company.com'],
        )

    def test_r_unassigned_broadcasts_to_whole_team(self):
        UserProfile.objects.create(loginid='r1', mail='r1@company.com', role='TE_R')
        UserProfile.objects.create(loginid='r2', mail='r2@company.com', role='TE_R')
        step = ApprovalStep.objects.create(document=self.doc, agent='R')
        self.assertEqual(
            sorted(mailer.resolve_stage_recipients(self.doc, 'R', step)),
            ['r1@company.com', 'r2@company.com'],
        )

    def test_p_unassigned_broadcasts_to_whole_team(self):
        UserProfile.objects.create(loginid='p1', mail='p1@company.com', role='TE_P')
        step = ApprovalStep.objects.create(document=self.doc, agent='P')
        self.assertEqual(
            mailer.resolve_stage_recipients(self.doc, 'P', step),
            ['p1@company.com'],
        )

    def test_rv_and_ra_recipient_is_assignee_only(self):
        pl = UserProfile.objects.create(loginid='pl2', mail='pl2@company.com', role='PL')
        step = ApprovalStep.objects.create(document=self.doc, agent='RV', assignee=pl)
        self.assertEqual(
            mailer.resolve_stage_recipients(self.doc, 'RV', step),
            ['pl2@company.com'],
        )
        # 아직 배정 전(assignee=None)이면 수신자 없음(팀 브로드캐스트 아님)
        unassigned_ra = ApprovalStep.objects.create(document=self.doc, agent='RA')
        self.assertEqual(
            mailer.resolve_stage_recipients(self.doc, 'RA', unassigned_ra),
            [],
        )

    def test_rpj_assigned_uses_assignee(self):
        te = UserProfile.objects.create(loginid='ter', mail='ter@company.com', role='TE_R')
        step = ApprovalStep.objects.create(document=self.doc, agent='R', assignee=te)
        self.assertEqual(
            mailer.resolve_stage_recipients(self.doc, 'R', step),
            ['ter@company.com'],
        )

    def test_oe_broadcast_to_whole_team(self):
        UserProfile.objects.create(loginid='o1', mail='o1@company.com', role='TE_O')
        UserProfile.objects.create(loginid='o2', mail='o2@company.com', role='TE_O')
        # 이메일이 없는 팀원은 제외된다
        UserProfile.objects.create(loginid='o3', mail='', role='TE_O')
        step = ApprovalStep.objects.create(document=self.doc, agent='O')
        self.assertEqual(
            sorted(mailer.resolve_stage_recipients(self.doc, 'O', step)),
            ['o1@company.com', 'o2@company.com'],
        )

    def test_reject_recipient_is_requester_only_when_no_approvals_yet(self):
        self.assertEqual(
            mailer.resolve_reject_recipients(self.doc),
            ['req@company.com'],
        )

    def test_reject_recipients_include_current_round_approvers(self):
        pl = UserProfile.objects.create(loginid='pl3', mail='pl3@company.com', role='PL')
        r = UserProfile.objects.create(loginid='r3', mail='r3@company.com', role='TE_R')
        ApprovalStep.objects.create(
            document=self.doc, agent='PL', round=1, action='approved', assignee=pl,
        )
        ApprovalStep.objects.create(
            document=self.doc, agent='R', round=1, action='approved', assignee=r,
        )
        # 아직 대기 중(반려당한 단계)인 것은 포함되지 않는다
        ApprovalStep.objects.create(document=self.doc, agent='P', round=1, action='pending')
        self.assertEqual(
            sorted(mailer.resolve_reject_recipients(self.doc)),
            ['pl3@company.com', 'r3@company.com', 'req@company.com'],
        )

    def test_approved_recipients_are_current_round_participants(self):
        # 이전 회차(반려됐던 회차) 참여자는 포함되지 않는다
        old = UserProfile.objects.create(loginid='old1', mail='old1@company.com', role='PL')
        ApprovalStep.objects.create(document=self.doc, agent='PL', round=1, action='rejected', assignee=old)

        pl = UserProfile.objects.create(loginid='pl4', mail='pl4@company.com', role='PL')
        r = UserProfile.objects.create(loginid='r4', mail='r4@company.com', role='TE_R')
        j = UserProfile.objects.create(loginid='j4', mail='j4@company.com', role='TE_J')
        ApprovalStep.objects.create(document=self.doc, agent='PL', round=2, action='approved', assignee=pl)
        ApprovalStep.objects.create(document=self.doc, agent='R', round=2, action='approved', assignee=r)
        ApprovalStep.objects.create(document=self.doc, agent='J', round=2, action='approved', assignee=j)
        self.assertEqual(
            sorted(mailer.resolve_approved_recipients(self.doc)),
            ['j4@company.com', 'pl4@company.com', 'r4@company.com'],
        )

    @override_settings(MAIL_REDIRECT_TO='dev@company.com')
    def test_redirect_overrides_all_recipients(self):
        UserProfile.objects.create(loginid='o1', mail='o1@company.com', role='TE_O')
        step = ApprovalStep.objects.create(document=self.doc, agent='O')
        self.assertEqual(
            mailer.resolve_stage_recipients(self.doc, 'O', step),
            ['dev@company.com'],
        )


class DraftVisibilityTest(TestCase):
    """임시저장(draft) 문서는 작성자 본인 + 그룹 공유 멤버 + MASTER 에게만 보인다."""

    def setUp(self):
        from rest_framework.test import APIRequestFactory
        from .views import RequestDocumentViewSet
        self._factory = APIRequestFactory()
        self._view_cls = RequestDocumentViewSet

        self.author = UserProfile.objects.create(loginid='author', mail='a@c.com', role='NONE')
        self.member = UserProfile.objects.create(loginid='member', mail='m@c.com', role='NONE')
        self.outsider = UserProfile.objects.create(loginid='out', mail='o@c.com', role='NONE')
        self.master = UserProfile.objects.create(loginid='master', mail='ms@c.com', role='MASTER')

        group = UserGroup.objects.create(name='team', creator=self.author)
        group.members.add(self.author, self.member)

        self.draft = RequestDocument.objects.create(
            title='draft doc', requester=self.author, requester_name='a',
            requester_email='a@c.com', requester_department='d', product_name='p',
            status='draft',
        )
        self.submitted = RequestDocument.objects.create(
            title='submitted doc', requester=self.author, requester_name='a',
            requester_email='a@c.com', requester_department='d', product_name='p',
            status='under_review',
        )

    def _visible_ids(self, user):
        view = self._view_cls()
        request = self._factory.get('/api/documents/')
        request.user = user
        view.request = request
        view.kwargs = {}
        view.format_kwarg = None
        return set(view.get_queryset().values_list('id', flat=True))

    def test_author_sees_own_draft(self):
        ids = self._visible_ids(self.author)
        self.assertIn(self.draft.id, ids)
        self.assertIn(self.submitted.id, ids)

    def test_group_member_sees_draft(self):
        self.assertIn(self.draft.id, self._visible_ids(self.member))

    def test_outsider_cannot_see_draft(self):
        ids = self._visible_ids(self.outsider)
        self.assertNotIn(self.draft.id, ids)
        # 비-draft 문서는 종전대로 보인다
        self.assertIn(self.submitted.id, ids)

    def test_master_sees_all_drafts(self):
        self.assertIn(self.draft.id, self._visible_ids(self.master))


@override_settings(EXTERNAL_API_KEY='test-external-key-123')
class ExternalApiKeyAccessTest(TestCase):
    """외부 API Key(read-only) 엔드포인트 — 인증/권한/노출 범위 검증."""

    def setUp(self):
        from rest_framework.test import APIClient
        self.client = APIClient()
        self.author = UserProfile.objects.create(loginid='author', mail='a@c.com', role='NONE')
        self.draft = RequestDocument.objects.create(
            title='draft doc', requester=self.author, requester_name='a',
            requester_email='a@c.com', requester_department='d', product_name='p',
            status='draft', additional_notes='{"detail": {"secret": "v"}}',
        )
        self.approved = RequestDocument.objects.create(
            title='approved doc', requester=self.author, requester_name='a',
            requester_email='a@c.com', requester_department='d', product_name='p',
            status='approved',
        )

    def test_missing_key_returns_401_or_403(self):
        res = self.client.get('/api/external/v1/documents/')
        self.assertIn(res.status_code, (401, 403))

    def test_wrong_key_returns_401(self):
        res = self.client.get('/api/external/v1/documents/', HTTP_X_API_KEY='wrong-key')
        self.assertEqual(res.status_code, 401)

    def test_correct_key_lists_all_statuses_including_draft(self):
        res = self.client.get('/api/external/v1/documents/', HTTP_X_API_KEY='test-external-key-123')
        self.assertEqual(res.status_code, 200)
        ids = {row['id'] for row in res.json()}
        self.assertIn(self.draft.id, ids)
        self.assertIn(self.approved.id, ids)

    def test_correct_key_returns_additional_notes(self):
        res = self.client.get(
            f'/api/external/v1/documents/{self.draft.id}/', HTTP_X_API_KEY='test-external-key-123'
        )
        self.assertEqual(res.status_code, 200)
        self.assertIn('secret', res.json()['additional_notes'])

    def test_write_methods_not_exposed(self):
        """ReadOnlyModelViewSet 이므로 POST/PATCH/DELETE 라우트 자체가 없어야 한다."""
        res = self.client.post(
            '/api/external/v1/documents/', {'title': 'x'}, HTTP_X_API_KEY='test-external-key-123'
        )
        self.assertEqual(res.status_code, 405)

    def test_internal_endpoint_unaffected_by_api_key_header(self):
        """내부 /api/documents/ 응답은 X-API-Key 헤더 유무와 무관하게 동일해야 한다(기존 인증 규칙 불변).
        AUTH_MODE(dev/sso)에 따라 실제 상태 코드가 달라질 수 있어 값 자체는 고정하지 않는다."""
        res_without = self.client.get('/api/documents/')
        res_with = self.client.get('/api/documents/', HTTP_X_API_KEY='test-external-key-123')
        self.assertEqual(res_without.status_code, res_with.status_code)

    def test_p_approved_true_filters_to_any_round_p_approval(self):
        """p_approved=true 는 회차(round) 상관없이 P단계가 한 번이라도 approved 였던 문서를 포함한다."""
        ApprovalStep.objects.create(document=self.approved, agent='P', action='approved', round=1)

        # 과거 회차에서 P 합의된 적 있으나(반려 후 재상신으로) 최신 회차는 아직 pending인 문서도 포함돼야 한다
        resubmitted = RequestDocument.objects.create(
            title='resubmitted doc', requester=self.author, requester_name='a',
            requester_email='a@c.com', requester_department='d', product_name='p',
            status='under_review',
        )
        ApprovalStep.objects.create(document=resubmitted, agent='P', action='approved', round=1)
        ApprovalStep.objects.create(document=resubmitted, agent='P', action='pending', round=2)

        res = self.client.get(
            '/api/external/v1/documents/?p_approved=true', HTTP_X_API_KEY='test-external-key-123'
        )
        self.assertEqual(res.status_code, 200)
        ids = {row['id'] for row in res.json()}
        self.assertIn(self.approved.id, ids)
        self.assertIn(resubmitted.id, ids)
        self.assertNotIn(self.draft.id, ids)  # P단계 이력 자체가 없음

    def test_p_approved_omitted_returns_everything(self):
        """p_approved 미지정 시 기존과 동일하게 P단계 이력과 무관하게 전부 반환된다(회귀)."""
        res = self.client.get('/api/external/v1/documents/', HTTP_X_API_KEY='test-external-key-123')
        ids = {row['id'] for row in res.json()}
        self.assertIn(self.draft.id, ids)

    def test_invalid_p_approved_value_returns_400(self):
        res = self.client.get(
            '/api/external/v1/documents/?p_approved=maybe', HTTP_X_API_KEY='test-external-key-123'
        )
        self.assertEqual(res.status_code, 400)

    def test_fields_param_restricts_response_fields(self):
        res = self.client.get(
            '/api/external/v1/documents/?fields=product_name,additional_notes',
            HTTP_X_API_KEY='test-external-key-123',
        )
        self.assertEqual(res.status_code, 200)
        row = res.json()[0]
        self.assertEqual(set(row.keys()), {'product_name', 'additional_notes'})

    def test_invalid_fields_param_returns_400(self):
        res = self.client.get(
            '/api/external/v1/documents/?fields=not_a_real_field',
            HTTP_X_API_KEY='test-external-key-123',
        )
        self.assertEqual(res.status_code, 400)


class EnqueueTest(TestCase):
    def setUp(self):
        self.requester = UserProfile.objects.create(
            loginid='req', mail='req@company.com', role='NONE'
        )
        self.doc = _make_document(self.requester)

    def test_enqueue_creates_pending_row(self):
        step = ApprovalStep.objects.create(document=self.doc, agent='J')
        noti = mailer.enqueue_stage_arrival(self.doc, 'J', step)
        self.assertIsNotNone(noti)
        self.assertEqual(noti.status, 'pending')
        self.assertEqual(noti.recipients, ['user_J@company.com'])

    def test_enqueue_skips_when_no_recipient(self):
        self.doc.requester_email = ''
        self.doc.save()
        noti = mailer.enqueue_rejected(self.doc)
        self.assertIsNone(noti)
        self.assertEqual(MailNotification.objects.count(), 0)


class MessageBuildingTest(TestCase):
    """제목/본문 생성(_build_message) — 제목의 문서 제목·이름 접두어, 딥링크 라우팅."""

    def setUp(self):
        self.requester = UserProfile.objects.create(
            loginid='req', mail='req@company.com', role='NONE'
        )
        self.doc = _make_document(self.requester)

    @override_settings(FRONTEND_URL='https://example.com')
    def test_subject_always_includes_document_title(self):
        for event_type in ('stage_arrival', 'rejected', 'approved', 'notify_submitted', 'notify_approved'):
            subject, _ = mailer._build_message(event_type, self.doc, agent='R')
            self.assertIn(self.doc.title, subject)

    @override_settings(FRONTEND_URL='https://example.com')
    def test_ra_subject_uses_post_approver_prefix_without_suffix(self):
        subject, _ = mailer._build_message('stage_arrival', self.doc, agent='RA')
        self.assertEqual(subject, f'[후결 요청] {self.doc.title}')

    @override_settings(FRONTEND_URL='https://example.com')
    def test_personal_assignment_subject_has_name_prefix(self):
        subject, _ = mailer._build_message('stage_arrival', self.doc, agent='R', recipient_name='홍길동')
        self.assertTrue(subject.startswith('[홍길동님] '))
        self.assertIn(self.doc.title, subject)

    @override_settings(FRONTEND_URL='https://example.com')
    def test_broadcast_subject_has_no_name_prefix(self):
        subject, _ = mailer._build_message('stage_arrival', self.doc, agent='R')
        self.assertFalse(subject.startswith('['), '팀 브로드캐스트 제목엔 이름 접두어가 없어야 한다')

    @override_settings(FRONTEND_URL='https://example.com')
    def test_in_progress_links_point_to_approval_page(self):
        for event_type in ('stage_arrival', 'rejected', 'notify_submitted'):
            _, contents = mailer._build_message(event_type, self.doc, agent='R')
            self.assertIn(f'https://example.com/approval?id={self.doc.id}', contents)

    @override_settings(FRONTEND_URL='https://example.com')
    def test_completion_links_point_to_history_page(self):
        for event_type in ('approved', 'notify_approved'):
            _, contents = mailer._build_message(event_type, self.doc)
            self.assertIn(f'https://example.com/history?id={self.doc.id}', contents)


class MailQueueProcessTest(TestCase):
    def _make_noti(self):
        return MailNotification.objects.create(
            event_type='rejected',
            recipients=['a@company.com'],
            subject='제목',
            contents='<p>본문</p>',
        )

    @patch('api.mailer._send_via_dxhub', return_value={'message': 'ok'})
    def test_success_marks_sent(self, mock_send):
        noti = self._make_noti()
        mailer.process_mail_queue()
        noti.refresh_from_db()
        self.assertEqual(noti.status, 'sent')
        self.assertIsNotNone(noti.sent_at)
        self.assertEqual(mock_send.call_count, 1)

    @patch('api.mailer._send_via_dxhub', side_effect=RuntimeError('boom'))
    def test_retry_until_failed_after_max_attempts(self, mock_send):
        noti = self._make_noti()  # max_attempts 기본 5
        for _ in range(5):
            mailer.process_mail_queue()
        noti.refresh_from_db()
        self.assertEqual(noti.attempts, 5)
        self.assertEqual(noti.status, 'failed')
        self.assertEqual(mock_send.call_count, 5)

    @patch('api.mailer._send_via_dxhub', return_value={'message': 'ok'})
    def test_sent_row_not_resent(self, mock_send):
        noti = self._make_noti()
        mailer.process_mail_queue()
        mailer.process_mail_queue()
        self.assertEqual(mock_send.call_count, 1)


class HybridImmediateSendTest(TestCase):
    """하이브리드: 적재 후 커밋 직후 즉시 발송이 예약되는지 검증."""

    def setUp(self):
        self.requester = UserProfile.objects.create(
            loginid='req', mail='req@company.com', role='NONE'
        )
        self.doc = _make_document(self.requester)

    @patch('api.mailer._send_now_async')
    def test_enqueue_schedules_immediate_send_on_commit(self, mock_async):
        with self.captureOnCommitCallbacks(execute=True):
            step = ApprovalStep.objects.create(document=self.doc, agent='R')
            noti = mailer.enqueue_stage_arrival(self.doc, 'R', step)
        mock_async.assert_called_once_with(noti.id)

    @patch('api.mailer._send_now_async')
    def test_no_immediate_send_when_no_recipient(self, mock_async):
        self.doc.requester_email = ''
        self.doc.save()
        with self.captureOnCommitCallbacks(execute=True):
            mailer.enqueue_rejected(self.doc)
        mock_async.assert_not_called()


class BbMappingValidationTest(TestCase):
    """_validate_bb_mapping — 상신 시 J-layer 행의 Backbone 매핑 필수 검증 (R-19).

    프론트(isNocSpecial, constants.ts)와 동일하게 new_or_copy가 기등록/layer삭제인
    행은 process_id가 있고 매핑이 안 되어 있어도 검증 대상에서 제외돼야 한다.
    """

    def setUp(self):
        import json
        from .views import RequestDocumentViewSet
        self._json = json
        self._view = RequestDocumentViewSet()
        self.requester = UserProfile.objects.create(
            loginid='req', mail='req@company.com', role='NONE'
        )

    def _make_doc_with_jayer(self, jayer_rows, bb_rows=None):
        doc = _make_document(self.requester)
        doc.additional_notes = self._json.dumps({
            'jayerRows': jayer_rows,
            'bbRows': bb_rows or [],
        })
        doc.save()
        return doc

    def test_noc_special_row_excluded_even_when_unmapped(self):
        doc = self._make_doc_with_jayer([
            {'id': 'j1', 'process_id': 'P1', 'new_or_copy': '기등록'},
            {'id': 'j2', 'process_id': 'P2', 'new_or_copy': 'layer삭제'},
        ])
        self.assertIsNone(self._view._validate_bb_mapping(doc))

    def test_normal_unmapped_row_still_blocks_submit(self):
        doc = self._make_doc_with_jayer([
            {'id': 'j1', 'process_id': 'P1', 'new_or_copy': '신규'},
        ])
        err = self._view._validate_bb_mapping(doc)
        self.assertIsNotNone(err)

    def test_mapped_normal_row_passes(self):
        doc = self._make_doc_with_jayer(
            [{'id': 'j1', 'process_id': 'P1', 'new_or_copy': '신규'}],
            bb_rows=[{'sourceJayerRowId': 'j1'}],
        )
        self.assertIsNone(self._view._validate_bb_mapping(doc))


@override_settings(POST_APPROVER_LOGINID='')
class PEStageReviewerFlowTest(TestCase):
    """P/E 단계 검토중(claim) 전환 + 다중 검토자(PV/EV) 지정·순차·게이트 검증.

    R 합의까지는 실제 API(제출→PL 합의→R 지정·합의)를 통해 진행시켜, 실제 흐름과
    동일한 조건에서 P/E 단계 신규 로직(검토자 지정/순서 가드/완료 게이트)을 검증한다.
    """

    def setUp(self):
        import json
        from rest_framework.test import APIClient
        self._json = json
        self.client = APIClient()

        self.requester = UserProfile.objects.create(loginid='req', mail='req@c.com', role='NONE')
        self.pl_user = UserProfile.objects.create(loginid='pl1', mail='pl1@c.com', role='PL')
        self.r_user = UserProfile.objects.create(loginid='r1', mail='r1@c.com', role='TE_R')
        self.p_owner = UserProfile.objects.create(loginid='p1', mail='p1@c.com', role='TE_P')
        self.p_reviewer = UserProfile.objects.create(loginid='p2', mail='p2@c.com', role='TE_P')
        self.p_outsider = UserProfile.objects.create(loginid='p3', mail='p3@c.com', role='TE_P')
        self.j_user = UserProfile.objects.create(loginid='j1', mail='j1@c.com', role='TE_J')
        self.o_user = UserProfile.objects.create(loginid='o1', mail='o1@c.com', role='TE_O')
        self.e_owner = UserProfile.objects.create(loginid='e1', mail='e1@c.com', role='TE_E')
        self.e_reviewer = UserProfile.objects.create(loginid='e2', mail='e2@c.com', role='TE_E')

    def _advance_to_parallel(self, plel=False):
        """draft → 제출 → PL 합의 → R 지정·합의 를 실제 API로 거쳐 P/O[/E] pending 상태로 만든다."""
        detail = {'detail': {}, 'jayerRows': ([{'pp': 'PLEL'}] if plel else [])}
        doc = RequestDocument.objects.create(
            title='doc', requester=self.requester, requester_name='요청자',
            requester_email='req@c.com', requester_department='dept',
            product_name='PROD-1', status='draft',
            additional_notes=self._json.dumps(detail),
        )
        self.client.force_authenticate(user=self.requester)
        r = self.client.post(f'/api/documents/{doc.id}/submit/', {'designated_pl_loginid': self.pl_user.loginid}, format='json')
        self.assertEqual(r.status_code, 200, r.content)

        self.client.force_authenticate(user=self.pl_user)
        r = self.client.post(f'/api/documents/{doc.id}/peer-approve/', {}, format='json')
        self.assertEqual(r.status_code, 200, r.content)

        self.client.force_authenticate(user=self.r_user)
        r = self.client.post(f'/api/documents/{doc.id}/assign-step/', {
            'agent': 'R', 'assignee_loginid': self.r_user.loginid, 'assignee_name': self.r_user.loginid,
        }, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        r = self.client.post(f'/api/documents/{doc.id}/approve-step/', {'agent': 'R', 'comment': ''}, format='json')
        self.assertEqual(r.status_code, 200, r.content)

        doc.refresh_from_db()
        return doc

    # ----- P 단계 -----

    def test_p_no_reviewers_creates_j_immediately_backward_compat(self):
        doc = self._advance_to_parallel()
        self.client.force_authenticate(user=self.p_owner)
        r = self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': 'P'}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        r = self.client.post(f'/api/documents/{doc.id}/approve-step/', {'agent': 'P', 'comment': ''}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(ApprovalStep.objects.filter(document=doc, agent='J', round=1).exists())

    def test_p_reviewer_loginids_denied_before_claim(self):
        doc = self._advance_to_parallel()
        # 아직 검토중 선점 전(assignee 없음) — 합의 자체가 assignee 본인만 가능하므로 403
        self.client.force_authenticate(user=self.p_owner)
        r = self.client.post(f'/api/documents/{doc.id}/approve-step/', {
            'agent': 'P', 'comment': '', 'reviewer_loginids': [self.p_reviewer.loginid],
        }, format='json')
        self.assertEqual(r.status_code, 403)

    def test_p_reviewer_loginids_allowed_for_same_team_after_claim(self):
        doc = self._advance_to_parallel()
        self.client.force_authenticate(user=self.p_owner)
        self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': 'P'}, format='json')

        # P는 J/O/E와 동일한 검토중 방식 — 선점 후엔 같은 팀(TE_P) 누구나 합의 가능(_can_act_on_step).
        # p_outsider도 같은 팀이므로 검토자 지정과 함께 합의할 수 있다.
        self.client.force_authenticate(user=self.p_outsider)
        r = self.client.post(f'/api/documents/{doc.id}/approve-step/', {
            'agent': 'P', 'comment': '', 'reviewer_loginids': [self.p_reviewer.loginid],
        }, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(
            ApprovalStep.objects.filter(document=doc, agent='PV', round=1, assignee__loginid=self.p_reviewer.loginid).exists()
        )

    def test_p_reviewer_loginids_denied_for_other_team(self):
        doc = self._advance_to_parallel()
        self.client.force_authenticate(user=self.p_owner)
        self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': 'P'}, format='json')

        # 완전히 다른 팀(TE_E)은 P 단계에 합의할 권한 자체가 없다
        self.client.force_authenticate(user=self.e_owner)
        r = self.client.post(f'/api/documents/{doc.id}/approve-step/', {
            'agent': 'P', 'comment': '', 'reviewer_loginids': [self.p_reviewer.loginid],
        }, format='json')
        self.assertEqual(r.status_code, 403)

    def test_p_reviewer_cannot_act_before_owner_approves(self):
        doc = self._advance_to_parallel()
        self.client.force_authenticate(user=self.p_owner)
        self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': 'P'}, format='json')

        # 아직 담당자가 합의(=검토자 지정)하지 않았으므로 PV 단계 자체가 없다
        self.client.force_authenticate(user=self.p_reviewer)
        r = self.client.post(f'/api/documents/{doc.id}/approve-step/', {'agent': 'PV', 'comment': ''}, format='json')
        self.assertEqual(r.status_code, 400)

    def test_p_j_created_only_after_owner_and_all_reviewers_approve(self):
        doc = self._advance_to_parallel()
        self.client.force_authenticate(user=self.p_owner)
        self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': 'P'}, format='json')

        # 담당자가 합의하면서 검토자를 함께 지정(한 번의 요청으로 담당자 합의 + 검토자 지정)
        r = self.client.post(f'/api/documents/{doc.id}/approve-step/', {
            'agent': 'P', 'comment': '', 'reviewer_loginids': [self.p_reviewer.loginid],
        }, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(
            ApprovalStep.objects.filter(document=doc, agent='PV', round=1, assignee__loginid=self.p_reviewer.loginid).exists()
        )
        # 담당자만 합의된 상태 — 검토자 미합의라 J 아직 생성되지 않음
        self.assertFalse(ApprovalStep.objects.filter(document=doc, agent='J', round=1).exists())

        self.client.force_authenticate(user=self.p_reviewer)
        r = self.client.post(f'/api/documents/{doc.id}/approve-step/', {'agent': 'PV', 'comment': ''}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(ApprovalStep.objects.filter(document=doc, agent='J', round=1).exists())

    def test_p_reviewer_self_designation_rejected(self):
        doc = self._advance_to_parallel()
        self.client.force_authenticate(user=self.p_owner)
        self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': 'P'}, format='json')
        r = self.client.post(f'/api/documents/{doc.id}/approve-step/', {
            'agent': 'P', 'comment': '', 'reviewer_loginids': [self.p_owner.loginid],
        }, format='json')
        self.assertEqual(r.status_code, 400)
        # 검증 실패 시 아무 것도 생성/변경되지 않아야 한다(담당자 단계도 여전히 pending)
        p_step = ApprovalStep.objects.get(document=doc, agent='P', round=1)
        self.assertEqual(p_step.action, 'pending')
        self.assertFalse(ApprovalStep.objects.filter(document=doc, agent='PV', round=1).exists())

    def test_p_reviewer_rejection_rejects_whole_document(self):
        doc = self._advance_to_parallel()
        self.client.force_authenticate(user=self.p_owner)
        self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': 'P'}, format='json')
        self.client.post(f'/api/documents/{doc.id}/approve-step/', {
            'agent': 'P', 'comment': '', 'reviewer_loginids': [self.p_reviewer.loginid],
        }, format='json')

        self.client.force_authenticate(user=self.p_reviewer)
        r = self.client.post(f'/api/documents/{doc.id}/reject-step/', {'agent': 'PV', 'comment': '문제 있음'}, format='json')
        self.assertEqual(r.status_code, 200, r.content)

        doc.refresh_from_db()
        self.assertEqual(doc.status, 'rejected')
        self.assertFalse(ApprovalStep.objects.filter(document=doc, agent='J', round=1).exists())

    # ----- E 단계(plel) + 최종 승인 게이트 -----

    def test_e_reviewer_gate_blocks_final_approval_until_all_agree(self):
        doc = self._advance_to_parallel(plel=True)
        self.assertTrue(ApprovalStep.objects.filter(document=doc, agent='E', round=1).exists())

        # path1: P(검토자 없음) → J
        self.client.force_authenticate(user=self.p_owner)
        self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': 'P'}, format='json')
        self.client.post(f'/api/documents/{doc.id}/approve-step/', {'agent': 'P', 'comment': ''}, format='json')
        self.client.force_authenticate(user=self.j_user)
        self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': 'J'}, format='json')
        r = self.client.post(f'/api/documents/{doc.id}/approve-step/', {'agent': 'J', 'comment': ''}, format='json')
        self.assertEqual(r.status_code, 200, r.content)

        # path2: O 합의
        self.client.force_authenticate(user=self.o_user)
        self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': 'O'}, format='json')
        r = self.client.post(f'/api/documents/{doc.id}/approve-step/', {'agent': 'O', 'comment': ''}, format='json')
        self.assertEqual(r.status_code, 200, r.content)

        # path2: E 담당자 합의 + 검토자 지정(동시) — 검토자 미합의라 아직 최종 승인 아님
        self.client.force_authenticate(user=self.e_owner)
        self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': 'E'}, format='json')
        r = self.client.post(f'/api/documents/{doc.id}/approve-step/', {
            'agent': 'E', 'comment': '', 'reviewer_loginids': [self.e_reviewer.loginid],
        }, format='json')
        self.assertEqual(r.status_code, 200, r.content)

        doc.refresh_from_db()
        self.assertEqual(doc.status, 'under_review')

        # 검토자(EV) 합의 → 이제서야 최종 승인
        self.client.force_authenticate(user=self.e_reviewer)
        r = self.client.post(f'/api/documents/{doc.id}/approve-step/', {'agent': 'EV', 'comment': ''}, format='json')
        self.assertEqual(r.status_code, 200, r.content)

        doc.refresh_from_db()
        self.assertEqual(doc.status, 'approved')
