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

    def test_rpj_unassigned_uses_fixed_fallback(self):
        for agent, expected in [
            ('R', 'user_R@company.com'),
            ('P', 'user_P@company.com'),
            ('J', 'user_J@company.com'),
        ]:
            step = ApprovalStep.objects.create(document=self.doc, agent=agent)
            self.assertEqual(
                mailer.resolve_stage_recipients(self.doc, agent, step),
                [expected],
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

    def test_reject_recipient_is_requester(self):
        self.assertEqual(
            mailer.resolve_reject_recipients(self.doc),
            ['req@company.com'],
        )

    def test_approved_recipients_span_all_groups(self):
        m1 = UserProfile.objects.create(loginid='m1', mail='m1@company.com')
        m2 = UserProfile.objects.create(loginid='m2', mail='m2@company.com')
        g1 = UserGroup.objects.create(name='g1', creator=self.requester)
        g1.members.add(self.requester, m1)
        g2 = UserGroup.objects.create(name='g2', creator=m2)
        g2.members.add(self.requester, m2)
        self.assertEqual(
            sorted(mailer.resolve_approved_recipients(self.doc)),
            ['m1@company.com', 'm2@company.com', 'req@company.com'],
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


class EnqueueTest(TestCase):
    def setUp(self):
        self.requester = UserProfile.objects.create(
            loginid='req', mail='req@company.com', role='NONE'
        )
        self.doc = _make_document(self.requester)

    def test_enqueue_creates_pending_row(self):
        step = ApprovalStep.objects.create(document=self.doc, agent='R')
        noti = mailer.enqueue_stage_arrival(self.doc, 'R', step)
        self.assertIsNotNone(noti)
        self.assertEqual(noti.status, 'pending')
        self.assertEqual(noti.recipients, ['user_R@company.com'])

    def test_enqueue_skips_when_no_recipient(self):
        self.doc.requester_email = ''
        self.doc.save()
        noti = mailer.enqueue_rejected(self.doc)
        self.assertIsNone(noti)
        self.assertEqual(MailNotification.objects.count(), 0)


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
