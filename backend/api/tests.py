"""결재 알림 메일(mailer) 단위 테스트

외부 DXHUB API 호출은 모두 mock 처리한다.
"""
from unittest.mock import patch

from django.test import TestCase, override_settings

from . import mailer
from . import design_rule_stats
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

    def test_reject_recipients_include_pending_pl_when_pl_rejects(self):
        # 다중 PL 지정: PL A 합의, PL B 반려, PL C 아직 미합의(pending)
        pl_a = UserProfile.objects.create(loginid='pla', mail='pla@company.com', role='PL')
        pl_c = UserProfile.objects.create(loginid='plc', mail='plc@company.com', role='PL')
        ApprovalStep.objects.create(
            document=self.doc, agent='PL', round=1, action='approved', assignee=pl_a,
        )
        ApprovalStep.objects.create(
            document=self.doc, agent='PL', round=1, action='rejected',
        )
        ApprovalStep.objects.create(
            document=self.doc, agent='PL', round=1, action='pending', assignee=pl_c,
        )
        self.assertEqual(
            sorted(mailer.resolve_reject_recipients(self.doc)),
            ['pla@company.com', 'plc@company.com', 'req@company.com'],
        )

    def test_reject_recipients_pl_pending_excluded_when_non_pl_step_rejects(self):
        # PL이 아닌 단계(R)가 반려된 경우, 다른 미합의 PL은 포함되지 않는다(기존 동작 유지)
        pl_pending = UserProfile.objects.create(loginid='pld', mail='pld@company.com', role='PL')
        ApprovalStep.objects.create(document=self.doc, agent='PL', round=1, action='pending', assignee=pl_pending)
        ApprovalStep.objects.create(document=self.doc, agent='R', round=1, action='rejected')
        self.assertEqual(
            mailer.resolve_reject_recipients(self.doc),
            ['req@company.com'],
        )

    def test_reject_recipients_r_reject_covers_whole_remaining_line(self):
        # R 담당자 반려 → 아직 합의 전인 결재선(R·P·O·J) 팀 전원. 반려자 본인은 제외.
        pl_a = UserProfile.objects.create(loginid='pla2', mail='pla2@company.com', role='PL')
        r_owner = UserProfile.objects.create(loginid='rown', mail='rown@company.com', role='TE_R')
        UserProfile.objects.create(loginid='rteam2', mail='rteam2@company.com', role='TE_R')
        UserProfile.objects.create(loginid='p1', mail='p1@company.com', role='TE_P')
        UserProfile.objects.create(loginid='o1', mail='o1@company.com', role='TE_O')
        UserProfile.objects.create(loginid='j1', mail='j1@company.com', role='TE_J')
        ApprovalStep.objects.create(document=self.doc, agent='PL', round=1, action='approved', assignee=pl_a)
        ApprovalStep.objects.create(document=self.doc, agent='R', round=1, action='rejected', assignee=r_owner)
        self.assertEqual(
            sorted(mailer.resolve_reject_recipients(self.doc)),
            [
                'j1@company.com', 'o1@company.com', 'p1@company.com',
                'pla2@company.com', 'req@company.com', 'rteam2@company.com',
            ],
        )

    def test_reject_recipients_rv_reject_dedups_team_member_who_already_approved(self):
        # RV(검토자) 반려 → RV 도 TE_R 소속이라 팀 조회로 함께 잡힌다.
        # 이미 합의한 R 담당자는 중복 없이 1회만, 반려한 RV 본인은 제외.
        r_owner = UserProfile.objects.create(loginid='rown2', mail='rown2@company.com', role='TE_R')
        rv_user = UserProfile.objects.create(loginid='rv1', mail='rv1@company.com', role='TE_R')
        UserProfile.objects.create(loginid='rteam3', mail='rteam3@company.com', role='TE_R')
        UserProfile.objects.create(loginid='p2', mail='p2@company.com', role='TE_P')
        UserProfile.objects.create(loginid='j2', mail='j2@company.com', role='TE_J')
        ApprovalStep.objects.create(document=self.doc, agent='R', round=1, action='approved', assignee=r_owner)
        ApprovalStep.objects.create(document=self.doc, agent='RV', round=1, action='rejected', assignee=rv_user)
        recipients = mailer.resolve_reject_recipients(self.doc)
        self.assertEqual(len(recipients), len(set(recipients)), '중복 수신자가 없어야 한다')
        self.assertEqual(
            sorted(recipients),
            ['j2@company.com', 'p2@company.com', 'req@company.com',
             'rown2@company.com', 'rteam3@company.com'],
        )

    def test_reject_recipients_skip_team_broadcast_for_already_approved_stage(self):
        # P 반려 시 이미 합의를 마친 단계(R·O)는 팀 전체 발송 대상이 아니다.
        # 그 단계 합의자 본인만 기합의자 규칙으로 포함된다.
        r_owner = UserProfile.objects.create(loginid='rown3', mail='rown3@company.com', role='TE_R')
        p_owner = UserProfile.objects.create(loginid='powner', mail='powner@company.com', role='TE_P')
        UserProfile.objects.create(loginid='pteam2', mail='pteam2@company.com', role='TE_P')
        o_approver = UserProfile.objects.create(loginid='oapp', mail='oapp@company.com', role='TE_O')
        UserProfile.objects.create(loginid='oteam2', mail='oteam2@company.com', role='TE_O')
        UserProfile.objects.create(loginid='j3', mail='j3@company.com', role='TE_J')
        ApprovalStep.objects.create(document=self.doc, agent='R', round=1, action='approved', assignee=r_owner)
        ApprovalStep.objects.create(document=self.doc, agent='O', round=1, action='approved', assignee=o_approver)
        ApprovalStep.objects.create(document=self.doc, agent='P', round=1, action='rejected', assignee=p_owner)
        recipients = sorted(mailer.resolve_reject_recipients(self.doc))
        self.assertEqual(
            recipients,
            ['j3@company.com', 'oapp@company.com', 'pteam2@company.com',
             'req@company.com', 'rown3@company.com'],
        )
        self.assertNotIn('oteam2@company.com', recipients, '합의를 마친 O 팀은 팀 전체 발송 대상이 아니다')

    def test_reject_recipients_j_reject_includes_pending_parallel_team(self):
        # J 반려 시점에 병렬 단계 O 가 아직 pending 이면 TE_O 팀 전원도 포함된다
        # (정적 단계 순서가 아니라 '아직 합의 안 끝난 단계' 기준이라 누락되지 않는다).
        r_owner = UserProfile.objects.create(loginid='rown4', mail='rown4@company.com', role='TE_R')
        p_owner = UserProfile.objects.create(loginid='powner2', mail='powner2@company.com', role='TE_P')
        UserProfile.objects.create(loginid='o4a', mail='o4a@company.com', role='TE_O')
        UserProfile.objects.create(loginid='o4b', mail='o4b@company.com', role='TE_O')
        j_owner = UserProfile.objects.create(loginid='jown', mail='jown@company.com', role='TE_J')
        UserProfile.objects.create(loginid='jteam2', mail='jteam2@company.com', role='TE_J')
        ApprovalStep.objects.create(document=self.doc, agent='R', round=1, action='approved', assignee=r_owner)
        ApprovalStep.objects.create(document=self.doc, agent='P', round=1, action='approved', assignee=p_owner)
        ApprovalStep.objects.create(document=self.doc, agent='O', round=1, action='pending')
        ApprovalStep.objects.create(document=self.doc, agent='J', round=1, action='rejected', assignee=j_owner)
        self.assertEqual(
            sorted(mailer.resolve_reject_recipients(self.doc)),
            ['jteam2@company.com', 'o4a@company.com', 'o4b@company.com',
             'powner2@company.com', 'req@company.com', 'rown4@company.com'],
        )

    def test_reject_recipients_only_map_excludes_stages_not_on_route(self):
        # Only MAP 의뢰서는 P/O/E/J 를 거치지 않으므로 그 팀들은 대상이 아니다.
        import json
        doc = RequestDocument.objects.create(
            title='onlymap', requester=self.requester, requester_name='요청자',
            requester_email='req@company.com', requester_department='개발팀',
            product_name='PROD-1',
            additional_notes=json.dumps({'detail': {'request_purpose': 'Only MAP'}, 'jayerRows': []}),
        )
        r_owner = UserProfile.objects.create(loginid='r5', mail='r5@company.com', role='TE_R')
        UserProfile.objects.create(loginid='r5b', mail='r5b@company.com', role='TE_R')
        UserProfile.objects.create(loginid='p5', mail='p5@company.com', role='TE_P')
        UserProfile.objects.create(loginid='j5', mail='j5@company.com', role='TE_J')
        ApprovalStep.objects.create(document=doc, agent='R', round=1, action='rejected', assignee=r_owner)
        self.assertEqual(
            sorted(mailer.resolve_reject_recipients(doc)),
            ['r5b@company.com', 'req@company.com'],
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


class PlSubmitMailTest(TestCase):
    """PL 상신(submit/resubmit) 시 지정 PL 메일 제목에 R 담당자 지정과 동일하게
    이름 접두어("[이름님] ")가 붙는지 검증한다."""

    def setUp(self):
        from rest_framework.test import APIClient
        import json
        self._json = json
        self.client = APIClient()
        self.requester = UserProfile.objects.create(loginid='req', mail='req@c.com', role='NONE')
        self.pl_a = UserProfile.objects.create(loginid='pla', mail='pla@c.com', role='PL')
        self.pl_b = UserProfile.objects.create(loginid='plb', mail='plb@c.com', role='PL')

    def _make_draft(self, status='draft'):
        return RequestDocument.objects.create(
            title='doc', requester=self.requester, requester_name='요청자',
            requester_email='req@c.com', requester_department='dept',
            product_name='PROD-1', status=status,
            additional_notes=self._json.dumps({'detail': {}, 'jayerRows': []}),
        )

    def test_submit_pl_mail_subject_has_name_prefix(self):
        doc = self._make_draft('draft')
        self.client.force_authenticate(user=self.requester)
        r = self.client.post(f'/api/documents/{doc.id}/submit/', {
            'designated_pl_loginids': [self.pl_a.loginid, self.pl_b.loginid],
        }, format='json')
        self.assertEqual(r.status_code, 200, r.content)

        notis = MailNotification.objects.filter(document=doc, event_type='stage_arrival').order_by('id')
        self.assertEqual(notis.count(), 2)
        self.assertEqual(notis[0].recipients, ['pla@c.com'])
        self.assertTrue(notis[0].subject.startswith('[pla님] '), notis[0].subject)
        self.assertEqual(notis[1].recipients, ['plb@c.com'])
        self.assertTrue(notis[1].subject.startswith('[plb님] '), notis[1].subject)

    def test_resubmit_pl_mail_subject_has_name_prefix(self):
        doc = self._make_draft('rejected')
        self.client.force_authenticate(user=self.requester)
        r = self.client.post(f'/api/documents/{doc.id}/resubmit/', {
            'designated_pl_loginids': [self.pl_a.loginid],
        }, format='json')
        self.assertEqual(r.status_code, 200, r.content)

        noti = MailNotification.objects.filter(document=doc, event_type='stage_arrival').latest('id')
        self.assertTrue(noti.subject.startswith('[pla님] '), noti.subject)

    def test_change_designee_sends_mail_to_new_pl_only(self):
        doc = self._make_draft('draft')
        self.client.force_authenticate(user=self.requester)
        r = self.client.post(f'/api/documents/{doc.id}/submit/', {
            'designated_pl_loginids': [self.pl_a.loginid],
        }, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        MailNotification.objects.all().delete()  # 상신 시 발송분 제거하고 지정자 변경분만 확인

        r = self.client.post(f'/api/documents/{doc.id}/change-designee/', {
            'designated_pl_loginid': self.pl_b.loginid,
        }, format='json')
        self.assertEqual(r.status_code, 200, r.content)

        notis = MailNotification.objects.filter(document=doc, event_type='stage_arrival')
        self.assertEqual(notis.count(), 1)
        self.assertEqual(notis[0].recipients, ['plb@c.com'])
        self.assertTrue(notis[0].subject.startswith('[plb님] '), notis[0].subject)


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


class RouteCardTest(TestCase):
    """메일 본문 '결재 경로' 카드(_route_rows / _render_route_card)."""

    def setUp(self):
        self.requester = UserProfile.objects.create(
            loginid='req', mail='req@company.com', role='NONE'
        )
        self.doc = _make_document(self.requester)

    def _statuses(self, rows):
        return [(label, status) for label, _name, status, _c in rows]

    def test_rows_cover_status_variants_and_pending_future_stage(self):
        pl = UserProfile.objects.create(loginid='pl9', mail='pl9@c.com', role='PL')
        r = UserProfile.objects.create(loginid='r9', mail='r9@c.com', role='TE_R')
        o = UserProfile.objects.create(loginid='o9', mail='o9@c.com', role='TE_O')
        ApprovalStep.objects.create(document=self.doc, agent='PL', round=1, action='approved',
                                    assignee=pl, assignee_name='피엘구')
        ApprovalStep.objects.create(document=self.doc, agent='R', round=1, action='rejected',
                                    assignee=r, assignee_name='알구')
        ApprovalStep.objects.create(document=self.doc, agent='O', round=1, action='pending',
                                    assignee=o, assignee_name='오구')
        ApprovalStep.objects.create(document=self.doc, agent='P', round=1, action='pending')

        rows = mailer._route_rows(self.doc)
        by_label = dict(self._statuses(rows))
        self.assertEqual(by_label['PL 검토'], 'approved')
        self.assertEqual(by_label['R'], 'rejected')
        self.assertEqual(by_label['O'], 'reviewing')      # pending + 담당자 있음
        self.assertEqual(by_label['P'], 'waiting')        # pending + 미배정
        self.assertEqual(by_label['J'], 'waiting')        # step 미생성(예정)
        self.assertNotIn('E', by_label, 'plel 이 아니면 E 는 경로에 넣지 않는다')

    def test_rows_include_e_stage_when_plel(self):
        """plel 인 의뢰서는 E 단계가 아직 생성 전이어도 경로에 '대기' 행으로 실린다."""
        import json
        self.doc.additional_notes = json.dumps({'jayerRows': [{'pp': 'PLEL'}]})
        self.doc.save(update_fields=['additional_notes'])
        ApprovalStep.objects.create(document=self.doc, agent='PL', round=1, action='approved')

        by_label = dict(self._statuses(mailer._route_rows(self.doc)))
        self.assertEqual(by_label['E'], 'waiting')  # step 미생성(예정)

    def test_rows_only_include_current_round(self):
        old = UserProfile.objects.create(loginid='old9', mail='old9@c.com', role='PL')
        new = UserProfile.objects.create(loginid='new9', mail='new9@c.com', role='PL')
        ApprovalStep.objects.create(document=self.doc, agent='PL', round=1, action='rejected',
                                    assignee=old, assignee_name='이전회차', comment='이전 회차 반려 사유')
        ApprovalStep.objects.create(document=self.doc, agent='PL', round=2, action='pending',
                                    assignee=new, assignee_name='현재회차')

        names = [name for _l, name, _s, _c in mailer._route_rows(self.doc)]
        self.assertIn('현재회차', names)
        self.assertNotIn('이전회차', names)

        html = mailer._render_route_card(self.doc, mailer.EVENT_THEME['rejected'])
        self.assertIn('2회차', html)
        self.assertNotIn('이전 회차 반려 사유', html)

    def test_only_map_route_excludes_p_o_e_j(self):
        import json
        doc = RequestDocument.objects.create(
            title='onlymap', requester=self.requester, requester_name='요청자',
            requester_email='req@c.com', requester_department='dept', product_name='PROD-1',
            additional_notes=json.dumps({'detail': {'request_purpose': 'Only MAP'}, 'jayerRows': []}),
        )
        ApprovalStep.objects.create(document=doc, agent='R', round=1, action='pending')
        labels = [label for label, _n, _s, _c in mailer._route_rows(doc)]
        for excluded in ('P', 'J', 'O', 'E'):
            self.assertNotIn(excluded, labels)
        self.assertIn('R', labels)

    def test_card_renders_comment_and_omits_empty_one(self):
        r = UserProfile.objects.create(loginid='r10', mail='r10@c.com', role='TE_R')
        o = UserProfile.objects.create(loginid='o10', mail='o10@c.com', role='TE_O')
        ApprovalStep.objects.create(document=self.doc, agent='R', round=1, action='approved',
                                    assignee=r, assignee_name='알텐', comment='바코드 매핑 확인 완료')
        ApprovalStep.objects.create(document=self.doc, agent='O', round=1, action='approved',
                                    assignee=o, assignee_name='오텐', comment='')

        html = mailer._render_route_card(self.doc, mailer.EVENT_THEME['approved'])
        self.assertIn('바코드 매핑 확인 완료', html)
        self.assertEqual(html.count('border-left:2px solid'), 1,
                         '코멘트가 없는 단계는 코멘트 줄을 만들지 않는다')
        self.assertIn(mailer.ROUTE_UNASSIGNED_LABEL, html, '미배정 단계는 미지정으로 표기된다')

    def test_card_escapes_user_input(self):
        evil = UserProfile.objects.create(loginid='evil', mail='evil@c.com', role='TE_R')
        ApprovalStep.objects.create(
            document=self.doc, agent='R', round=1, action='rejected', assignee=evil,
            assignee_name='<script>alert(1)</script>',
            comment='<img src=x onerror="alert(2)">',
        )
        html = mailer._render_route_card(self.doc, mailer.EVENT_THEME['rejected'])
        # 태그가 태그로 살아나지 않아야 한다(문자열 자체는 이스케이프된 형태로 남는다)
        self.assertNotIn('<script>', html)
        self.assertNotIn('<img', html)
        self.assertIn('&lt;script&gt;alert(1)&lt;/script&gt;', html)
        self.assertIn('&lt;img src=x onerror=&quot;alert(2)&quot;&gt;', html)

    def test_card_truncates_long_comment(self):
        r = UserProfile.objects.create(loginid='r11', mail='r11@c.com', role='TE_R')
        ApprovalStep.objects.create(document=self.doc, agent='R', round=1, action='rejected',
                                    assignee=r, assignee_name='알', comment='가' * 500)
        html = mailer._render_route_card(self.doc, mailer.EVENT_THEME['rejected'])
        self.assertIn('가' * mailer.ROUTE_COMMENT_MAX_LEN + '…', html)
        self.assertNotIn('가' * (mailer.ROUTE_COMMENT_MAX_LEN + 1), html)

    def test_no_card_when_no_steps(self):
        self.assertEqual(mailer._route_rows(self.doc), [])
        self.assertEqual(mailer._render_route_card(self.doc, mailer.EVENT_THEME['rejected']), '')

    @override_settings(FRONTEND_URL='https://example.com')
    def test_route_card_included_in_all_event_mails(self):
        r = UserProfile.objects.create(loginid='r12', mail='r12@c.com', role='TE_R')
        ApprovalStep.objects.create(document=self.doc, agent='R', round=1, action='approved',
                                    assignee=r, assignee_name='알열둘', comment='확인 완료')
        for event_type in ('stage_arrival', 'rejected', 'approved', 'notify_submitted', 'notify_approved'):
            _, contents = mailer._build_message(event_type, self.doc, agent='R')
            self.assertIn('결재 경로', contents, f'{event_type} 메일에 경로 카드가 있어야 한다')
            self.assertIn('알열둘', contents)
            self.assertIn('확인 완료', contents)


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

    def test_e_step_not_created_without_plel(self):
        """판정 키워드가 아예 없으면(=해당없음) E(MASK) 단계를 생성하지 않는다."""
        doc = self._advance_to_parallel(plel=False)
        self.assertFalse(
            ApprovalStep.objects.filter(document=doc, agent='E', round=1).exists(),
            'plel 이 없으면 MASK 가 검증할 대상이 없으므로 E 는 생성되지 않아야 한다',
        )

    def test_e_step_created_with_plel(self):
        """판정 키워드가 하나라도 있으면 E(MASK) 단계를 생성한다."""
        doc = self._advance_to_parallel(plel=True)
        self.assertTrue(
            ApprovalStep.objects.filter(document=doc, agent='E', round=1).exists(),
            'plel 이 있으면 E 는 병렬 단계로 생성되어야 한다',
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
        r = self.client.post(f'/api/documents/{doc.id}/submit/',
                             {'designated_pl_loginid': self.pl_user.loginid}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        self.client.force_authenticate(user=self.pl_user)
        r = self.client.post(f'/api/documents/{doc.id}/peer-approve/', {}, format='json')
        self.assertEqual(r.status_code, 200, r.content)

        # PL 합의만으로는 R 단계가 생성될 뿐 병렬 단계(_advance_to_parallel)에는
        # 진입하지 않으므로, R 담당자 지정·합의까지 실제로 거쳐야 Only MAP 분기가
        # 검증된다(브리프 원안은 R 합의를 생략해 이 분기를 타지 않는 채로 통과했다).
        self.client.force_authenticate(user=self.r_user)
        r = self.client.post(f'/api/documents/{doc.id}/assign-step/', {
            'agent': 'R', 'assignee_loginid': self.r_user.loginid, 'assignee_name': self.r_user.loginid,
        }, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        r = self.client.post(f'/api/documents/{doc.id}/approve-step/', {'agent': 'R', 'comment': ''}, format='json')
        self.assertEqual(r.status_code, 200, r.content)

        self.assertFalse(ApprovalStep.objects.filter(document=doc, agent='E').exists())

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

    def test_p_reviewer_mail_shows_owner_as_approved_not_reviewing(self):
        """담당자 합의 + 검토자 지정을 한 요청으로 처리할 때, 검토자에게 가는 메일의
        결재 경로 카드에서 담당자(P) 행은 '검토중'이 아니라 '합의'로 표시돼야 한다.
        (담당자 승인 저장 전에 검토자 메일을 만들면 담당자가 아직 pending 으로 읽혀 버그가 난다.)
        """
        import re

        doc = self._advance_to_parallel()
        self.client.force_authenticate(user=self.p_owner)
        self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': 'P'}, format='json')
        r = self.client.post(f'/api/documents/{doc.id}/approve-step/', {
            'agent': 'P', 'comment': '', 'reviewer_loginids': [self.p_reviewer.loginid],
        }, format='json')
        self.assertEqual(r.status_code, 200, r.content)

        # route rows 자체(현재 커밋본 기준)가 이미 담당자를 합의로 읽어야 한다.
        rows = {label: st for label, _name, st, _c in mailer._route_rows(doc)}
        self.assertEqual(rows['P'], 'approved')

        # 검토자(PV)에게 실제로 적재된 메일 본문에서 P 행만 뽑아 상태를 확인한다
        # (본문은 enqueue 시점에 이미 고정된 HTML — 담당자 저장 전에 만들어지면 검토중으로 굳어버린다).
        noti = MailNotification.objects.filter(
            document=doc, event_type='stage_arrival', recipients=[self.p_reviewer.mail]
        ).latest('id')
        p_row_match = re.search(r'<tr>(?:(?!</tr>).)*?>P</td>(?:(?!</tr>).)*?</tr>', noti.contents, re.S)
        self.assertIsNotNone(p_row_match, 'P 행이 메일 본문에 있어야 한다')
        p_row_html = p_row_match.group(0)
        self.assertIn('합의', p_row_html)
        self.assertNotIn('검토중', p_row_html)

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

    def test_e_reviewer_mail_shows_owner_as_approved_not_reviewing(self):
        """P 단계와 동일한 버그가 E 단계(EV 검토자)에도 있었다 — 회귀 확인."""
        import re

        doc = self._advance_to_parallel(plel=True)
        self.client.force_authenticate(user=self.e_owner)
        self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': 'E'}, format='json')
        r = self.client.post(f'/api/documents/{doc.id}/approve-step/', {
            'agent': 'E', 'comment': '', 'reviewer_loginids': [self.e_reviewer.loginid],
        }, format='json')
        self.assertEqual(r.status_code, 200, r.content)

        rows = {label: st for label, _name, st, _c in mailer._route_rows(doc)}
        self.assertEqual(rows['E'], 'approved')

        noti = MailNotification.objects.filter(
            document=doc, event_type='stage_arrival', recipients=[self.e_reviewer.mail]
        ).latest('id')
        e_row_match = re.search(r'<tr>(?:(?!</tr>).)*?>E</td>(?:(?!</tr>).)*?</tr>', noti.contents, re.S)
        self.assertIsNotNone(e_row_match, 'E 행이 메일 본문에 있어야 한다')
        e_row_html = e_row_match.group(0)
        self.assertIn('합의', e_row_html)
        self.assertNotIn('검토중', e_row_html)

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

    # ----- E(MASK) 합의 시 Validation System 확정값 -----

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

    def test_invalid_validation_system_with_reviewers_creates_no_ev_step(self):
        """유효한 reviewer_loginids 와 함께 온 잘못된 validation_system 은 400 이고,

        EV 검토자 단계도 생성되지 않아야 한다(값 검증이 검토자 생성보다 먼저 실행되어
        부분 커밋이 없어야 함을 확인).
        """
        doc = self._advance_to_parallel(plel=True)
        self.client.force_authenticate(user=self.e_owner)
        self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': 'E'}, format='json')
        r = self.client.post(
            f'/api/documents/{doc.id}/approve-step/',
            {
                'agent': 'E', 'comment': '',
                'reviewer_loginids': [self.e_reviewer.loginid],
                'validation_system': 'MAYBE',
            }, format='json',
        )
        self.assertEqual(r.status_code, 400, r.content)
        self.assertFalse(
            ApprovalStep.objects.filter(document=doc, agent='EV', round=1).exists(),
            '값 검증 실패 시 검토자(EV) 단계도 생성되지 않아야 한다',
        )


class MapChangeApplyTest(TestCase):
    """'완성된 MAP 변경' 승인 시 원본(대상) 요청서 반영 + 변경 이력 기록 검증.

    - 반영 범위는 MAP_APPLY_KEYS 뿐이며 map_type 은 제외된다(원본 정체성 유지).
    - 원본 history 에는 '수정 직전' 스냅샷 1건이 append 되고, 표(J/O/bb)는
      이번 반영으로 바뀌지 않으므로 원본 값이 그대로 복사돼야 한다.
    - 실패(원본 없음/미승인)해도 예외 없이 작성자 실패 메일만 적재한다.
    """

    def setUp(self):
        import json
        from .views import RequestDocumentViewSet
        self._json = json
        self._view = RequestDocumentViewSet()
        self.requester = UserProfile.objects.create(
            loginid='req', mail='req@company.com', role='NONE'
        )

    def _make_source(self, detail_extra=None, history=None, status='approved'):
        doc = _make_document(self.requester)
        doc.status = status
        doc.additional_notes = self._json.dumps({
            'detail': dict({
                'map_type': 'NEW',
                'map_change': '변경 없음',
                'map_value_x': '1.0',
                'request_purpose': '신규',
            }, **(detail_extra or {})),
            'jayerRows': [{'id': 'j1', 'sp': 'S1'}],
            'oayerRows': [{'id': 'o1', 'sp': 'S1'}],
            'bbRows': [{'id': 'b1'}],
            'history': history if history is not None else [],
        }, ensure_ascii=False)
        doc.save()
        return doc

    def _make_map_change_doc(self, source_id, map_value_x='2.5'):
        doc = _make_document(self.requester)
        doc.additional_notes = self._json.dumps({
            'detail': {
                'request_purpose': '기타',
                'other_purpose': [RequestDocument.MAP_CHANGE_PURPOSE],
                'map_change_source_id': source_id,
                'map_type': 'EDIT',
                'map_change': '변경 있음',
                'map_value_x': map_value_x,
            },
            'jayerRows': [],
            'oayerRows': [],
            'bbRows': [],
            'history': [],
        }, ensure_ascii=False)
        doc.save()
        return doc

    def _source_notes(self, source):
        source.refresh_from_db()
        return self._json.loads(source.additional_notes)

    def test_map_values_applied_and_map_type_preserved(self):
        source = self._make_source()
        doc = self._make_map_change_doc(source.id)

        self._view._apply_map_change_to_source(doc)

        detail = self._source_notes(source)['detail']
        self.assertEqual(detail['map_value_x'], '2.5')
        self.assertEqual(detail['map_change'], '변경 있음')
        # map_type 은 반영 대상에서 제외 — 원본의 NEW 가 유지돼야 한다
        self.assertEqual(detail['map_type'], 'NEW')
        # MAP 외 키는 건드리지 않는다
        self.assertEqual(detail['request_purpose'], '신규')
        self.assertEqual(detail['map_edit_round'], 1)

    def test_first_apply_pushes_snapshot_with_tables_copied(self):
        source = self._make_source()
        doc = self._make_map_change_doc(source.id)

        self._view._apply_map_change_to_source(doc)

        notes = self._source_notes(source)
        self.assertEqual(len(notes['history']), 1)
        snap = notes['history'][0]
        # 수정 직전 값이 보존돼야 한다
        self.assertEqual(snap['detail']['map_value_x'], '1.0')
        # 1회차는 기본 'n차 제출' 라벨이므로 회차 표시가 없어야 한다
        self.assertNotIn('map_edit_round', snap)
        # 표는 원본 값이 그대로 복사돼야 한다(빈 배열이면 상세 화면 diff 가 전 행을 오탐)
        self.assertEqual(snap['jayerRows'], [{'id': 'j1', 'sp': 'S1'}])
        self.assertEqual(snap['oayerRows'], [{'id': 'o1', 'sp': 'S1'}])
        self.assertEqual(snap['bbRows'], [{'id': 'b1'}])

    def test_second_apply_marks_previous_round(self):
        source = self._make_source()
        self._view._apply_map_change_to_source(self._make_map_change_doc(source.id, '2.5'))
        source.refresh_from_db()
        self._view._apply_map_change_to_source(self._make_map_change_doc(source.id, '3.0'))

        notes = self._source_notes(source)
        self.assertEqual(len(notes['history']), 2)
        # 2회차 반영으로 밀려난 스냅샷 = 1회차 결과 → '완성 후 수정 1회차'로 표시된다
        self.assertEqual(notes['history'][1]['map_edit_round'], 1)
        self.assertEqual(notes['history'][1]['detail']['map_value_x'], '2.5')
        self.assertEqual(notes['detail']['map_value_x'], '3.0')
        self.assertEqual(notes['detail']['map_edit_round'], 2)

    def test_non_map_change_document_is_noop(self):
        source = self._make_source()
        doc = _make_document(self.requester)
        doc.additional_notes = self._json.dumps({
            'detail': {'request_purpose': '신규', 'other_purpose': []},
        }, ensure_ascii=False)
        doc.save()

        self._view._apply_map_change_to_source(doc)

        notes = self._source_notes(source)
        self.assertEqual(notes['history'], [])
        self.assertEqual(notes['detail']['map_value_x'], '1.0')

    def test_missing_source_enqueues_failure_mail_without_raising(self):
        doc = self._make_map_change_doc(999999)

        self._view._apply_map_change_to_source(doc)

        noti = MailNotification.objects.filter(event_type='map_apply_failed')
        self.assertEqual(noti.count(), 1)
        self.assertEqual(noti.first().recipients, ['req@company.com'])

    def test_source_not_approved_enqueues_failure_mail(self):
        source = self._make_source(status='under_review')
        doc = self._make_map_change_doc(source.id)

        self._view._apply_map_change_to_source(doc)

        self.assertEqual(
            MailNotification.objects.filter(event_type='map_apply_failed').count(), 1
        )
        # 원본은 변경되지 않아야 한다
        self.assertEqual(self._source_notes(source)['detail']['map_value_x'], '1.0')


@override_settings(POST_APPROVER_LOGINID='fixedpa')
class PostApproverManagementTest(TestCase):
    """후결자 추가(add-post-approver)/제거(remove-post-approver) 권한·보호 규칙 검증."""

    def setUp(self):
        import json
        from rest_framework.test import APIClient
        self._json = json
        self.client = APIClient()

        self.requester = UserProfile.objects.create(loginid='req', mail='req@c.com', role='NONE')
        self.pl_user = UserProfile.objects.create(loginid='pl1', mail='pl1@c.com', role='PL')
        self.r_user = UserProfile.objects.create(loginid='r1', mail='r1@c.com', role='TE_R')
        self.fixed_pa = UserProfile.objects.create(loginid='fixedpa', mail='fixedpa@c.com', role='TE_R')
        self.extra_pl1 = UserProfile.objects.create(loginid='epl1', mail='epl1@c.com', role='PL')
        self.extra_pl2 = UserProfile.objects.create(loginid='epl2', mail='epl2@c.com', role='PL')
        self.outsider = UserProfile.objects.create(loginid='out1', mail='out1@c.com', role='PL')
        self.master = UserProfile.objects.create(loginid='master1', mail='m1@c.com', role='MASTER')

    def _advance_to_parallel(self, only_prodc=False, post_approvers=None):
        detail = {
            'detail': {'only_prodc': 'Yes' if only_prodc else 'No', 'post_approvers': post_approvers or []},
            'jayerRows': [],
        }
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

    def _doc_before_r_approved(self):
        """R 합의 전(PL 검토 단계) 상태 — 병렬 진입 전 추가 차단 테스트용."""
        doc = RequestDocument.objects.create(
            title='doc-pre-r', requester=self.requester, requester_name='요청자',
            requester_email='req@c.com', requester_department='dept',
            product_name='PROD-1', status='draft',
            additional_notes=self._json.dumps({'detail': {}, 'jayerRows': []}),
        )
        self.client.force_authenticate(user=self.requester)
        r = self.client.post(f'/api/documents/{doc.id}/submit/', {'designated_pl_loginid': self.pl_user.loginid}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        doc.refresh_from_db()
        return doc

    # ----- 추가 -----

    def test_add_post_approver_success_sends_mail(self):
        doc = self._advance_to_parallel()
        MailNotification.objects.all().delete()
        self.client.force_authenticate(user=self.requester)
        r = self.client.post(f'/api/documents/{doc.id}/add-post-approver/', {'loginid': self.extra_pl1.loginid}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(
            ApprovalStep.objects.filter(document=doc, agent='RA', assignee__loginid=self.extra_pl1.loginid).exists()
        )
        noti = MailNotification.objects.filter(document=doc, event_type='stage_arrival').first()
        self.assertIsNotNone(noti)
        self.assertIn(self.extra_pl1.mail, noti.recipients)

    def test_add_post_approver_allowed_for_master(self):
        doc = self._advance_to_parallel()
        self.client.force_authenticate(user=self.master)
        r = self.client.post(f'/api/documents/{doc.id}/add-post-approver/', {'loginid': self.extra_pl1.loginid}, format='json')
        self.assertEqual(r.status_code, 200, r.content)

    def test_add_post_approver_denied_for_outsider(self):
        doc = self._advance_to_parallel()
        self.client.force_authenticate(user=self.outsider)
        r = self.client.post(f'/api/documents/{doc.id}/add-post-approver/', {'loginid': self.extra_pl1.loginid}, format='json')
        self.assertEqual(r.status_code, 403)

    def test_add_post_approver_rejects_fixed_loginid(self):
        doc = self._advance_to_parallel()
        self.client.force_authenticate(user=self.requester)
        r = self.client.post(f'/api/documents/{doc.id}/add-post-approver/', {'loginid': self.fixed_pa.loginid}, format='json')
        self.assertEqual(r.status_code, 400)

    def test_add_post_approver_denied_before_r_approved(self):
        doc = self._doc_before_r_approved()
        self.client.force_authenticate(user=self.requester)
        r = self.client.post(f'/api/documents/{doc.id}/add-post-approver/', {'loginid': self.extra_pl1.loginid}, format='json')
        self.assertEqual(r.status_code, 400)

    def test_add_and_remove_post_approver_success_for_legacy_requester_without_fk(self):
        """requester FK가 비어 있는(예: SET_NULL로 탈퇴 등) 레거시 문서도 이메일 폴백으로
        실제 상신자를 인식해야 한다."""
        doc = self._advance_to_parallel()
        # requester FK만 제거하고 이메일은 유지 — doc_permissions.is_requester 의 이메일
        # 폴백 경로를 검증한다(레거시 문서/사용자 탈퇴 등으로 FK가 비는 케이스와 동일).
        doc.requester = None
        doc.save()

        self.client.force_authenticate(user=self.requester)
        r = self.client.post(f'/api/documents/{doc.id}/add-post-approver/', {'loginid': self.extra_pl1.loginid}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        r = self.client.post(f'/api/documents/{doc.id}/remove-post-approver/', {'loginid': self.extra_pl1.loginid}, format='json')
        self.assertEqual(r.status_code, 200, r.content)

    def test_add_post_approver_rejects_duplicate(self):
        doc = self._advance_to_parallel(only_prodc=True, post_approvers=[{'loginid': self.extra_pl1.loginid, 'name': self.extra_pl1.loginid}])
        self.client.force_authenticate(user=self.requester)
        r = self.client.post(f'/api/documents/{doc.id}/add-post-approver/', {'loginid': self.extra_pl1.loginid}, format='json')
        self.assertEqual(r.status_code, 400)

    # ----- 제거 -----

    def test_remove_post_approver_success(self):
        doc = self._advance_to_parallel(only_prodc=True, post_approvers=[{'loginid': self.extra_pl1.loginid, 'name': self.extra_pl1.loginid}])
        self.client.force_authenticate(user=self.requester)
        # C가문 최소 1인 규칙에 걸리지 않도록 먼저 2번째 추가 후결자를 더한다.
        r = self.client.post(f'/api/documents/{doc.id}/add-post-approver/', {'loginid': self.extra_pl2.loginid}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        r = self.client.post(f'/api/documents/{doc.id}/remove-post-approver/', {'loginid': self.extra_pl1.loginid}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        self.assertFalse(
            ApprovalStep.objects.filter(document=doc, agent='RA', assignee__loginid=self.extra_pl1.loginid).exists()
        )

    def test_remove_post_approver_allowed_for_master(self):
        doc = self._advance_to_parallel(only_prodc=True, post_approvers=[
            {'loginid': self.extra_pl1.loginid, 'name': self.extra_pl1.loginid},
            {'loginid': self.extra_pl2.loginid, 'name': self.extra_pl2.loginid},
        ])
        self.client.force_authenticate(user=self.master)
        r = self.client.post(f'/api/documents/{doc.id}/remove-post-approver/', {'loginid': self.extra_pl1.loginid}, format='json')
        self.assertEqual(r.status_code, 200, r.content)

    def test_remove_post_approver_denied_for_outsider(self):
        doc = self._advance_to_parallel(only_prodc=True, post_approvers=[
            {'loginid': self.extra_pl1.loginid, 'name': self.extra_pl1.loginid},
            {'loginid': self.extra_pl2.loginid, 'name': self.extra_pl2.loginid},
        ])
        self.client.force_authenticate(user=self.outsider)
        r = self.client.post(f'/api/documents/{doc.id}/remove-post-approver/', {'loginid': self.extra_pl1.loginid}, format='json')
        self.assertEqual(r.status_code, 403)

    def test_remove_post_approver_rejects_fixed_loginid(self):
        doc = self._advance_to_parallel()
        self.client.force_authenticate(user=self.requester)
        r = self.client.post(f'/api/documents/{doc.id}/remove-post-approver/', {'loginid': self.fixed_pa.loginid}, format='json')
        self.assertEqual(r.status_code, 400)

    def test_remove_post_approver_denied_after_approved(self):
        doc = self._advance_to_parallel(only_prodc=True, post_approvers=[
            {'loginid': self.extra_pl1.loginid, 'name': self.extra_pl1.loginid},
            {'loginid': self.extra_pl2.loginid, 'name': self.extra_pl2.loginid},
        ])
        self.client.force_authenticate(user=self.extra_pl1)
        r = self.client.post(f'/api/documents/{doc.id}/approve-step/', {'agent': 'RA', 'comment': ''}, format='json')
        self.assertEqual(r.status_code, 200, r.content)

        self.client.force_authenticate(user=self.requester)
        r = self.client.post(f'/api/documents/{doc.id}/remove-post-approver/', {'loginid': self.extra_pl1.loginid}, format='json')
        self.assertEqual(r.status_code, 400)

    def test_remove_post_approver_blocks_last_additional_for_c_family(self):
        doc = self._advance_to_parallel(only_prodc=True, post_approvers=[{'loginid': self.extra_pl1.loginid, 'name': self.extra_pl1.loginid}])
        self.client.force_authenticate(user=self.requester)
        # 고정 후결자가 있어도 C가문은 "추가" 후결자가 최소 1명이어야 하므로 막혀야 한다.
        r = self.client.post(f'/api/documents/{doc.id}/remove-post-approver/', {'loginid': self.extra_pl1.loginid}, format='json')
        self.assertEqual(r.status_code, 400)

    @override_settings(POST_APPROVER_LOGINID='')
    def test_remove_post_approver_allows_zero_for_normal_doc(self):
        doc = self._advance_to_parallel()
        self.client.force_authenticate(user=self.requester)
        add = self.client.post(f'/api/documents/{doc.id}/add-post-approver/', {'loginid': self.extra_pl1.loginid}, format='json')
        self.assertEqual(add.status_code, 200, add.content)
        r = self.client.post(f'/api/documents/{doc.id}/remove-post-approver/', {'loginid': self.extra_pl1.loginid}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        self.assertFalse(ApprovalStep.objects.filter(document=doc, agent='RA').exists())


@override_settings(AUTH_MODE='sso')
class DocumentDeleteAuthTest(TestCase):
    """의뢰서 삭제 인가 (B-01).

    - approved : MASTER 만
    - 그 외(draft/under_review/rejected/pause) : 철회 가능 범위
      (의뢰자 / 지정 PL / 의뢰자 그룹멤버 / MASTER)
    - REST `DELETE /documents/{id}/` 는 405 로 차단하고 `POST delete/` 로 일원화
    """

    def setUp(self):
        from rest_framework.test import APIClient
        self.client = APIClient()

        self.author = UserProfile.objects.create(loginid='del_author', mail='a@c.com', role='PL')
        self.member = UserProfile.objects.create(loginid='del_member', mail='m@c.com', role='PL')
        self.designee = UserProfile.objects.create(loginid='del_pl', mail='p@c.com', role='PL')
        self.outsider = UserProfile.objects.create(loginid='del_out', mail='o@c.com', role='PL')
        self.norole = UserProfile.objects.create(loginid='del_none', mail='n@c.com', role='NONE')
        self.master = UserProfile.objects.create(loginid='del_master', mail='ms@c.com', role='MASTER')

        group = UserGroup.objects.create(name='del_team', creator=self.author)
        group.members.add(self.author, self.member)

    def _doc(self, status='under_review', requester=None, designated_pl=None):
        return RequestDocument.objects.create(
            title=f'del-{status}',
            requester=self.author if requester is None else requester,
            requester_name='작성자', requester_email='a@c.com', requester_department='d',
            product_name='p', status=status, designated_pl=designated_pl,
        )

    def _post_delete(self, user, doc):
        self.client.force_authenticate(user=user)
        return self.client.post(f'/api/documents/{doc.id}/delete/')

    def _exists(self, doc):
        return RequestDocument.objects.filter(pk=doc.pk).exists()

    # ----- 차단 -----
    def test_outsider_cannot_delete(self):
        doc = self._doc()
        res = self._post_delete(self.outsider, doc)
        self.assertEqual(res.status_code, 403)
        self.assertTrue(self._exists(doc))

    def test_norole_user_cannot_delete(self):
        doc = self._doc()
        res = self._post_delete(self.norole, doc)
        self.assertEqual(res.status_code, 403)
        self.assertTrue(self._exists(doc))

    def test_non_master_cannot_delete_approved(self):
        """결재 완료본은 작성자 본인이어도 지울 수 없다(이력 보존)."""
        doc = self._doc('approved')
        res = self._post_delete(self.author, doc)
        self.assertEqual(res.status_code, 403)
        self.assertTrue(self._exists(doc))

    def test_rest_delete_is_blocked_with_405(self):
        """REST DELETE 는 권한이 있어도 405 — 삭제 경로는 POST delete/ 하나뿐."""
        doc = self._doc()
        self.client.force_authenticate(user=self.master)
        res = self.client.delete(f'/api/documents/{doc.id}/')
        self.assertEqual(res.status_code, 405)
        self.assertTrue(self._exists(doc))

    def test_405_allow_header_excludes_delete(self):
        """405 응답의 Allow 에 DELETE 가 없어야 한다(RFC 9110 — Allow 는 '허용' 목록).

        destroy 를 오버라이드해 405 를 반환하면 Allow 에 DELETE 가 남아 모순이 생기므로,
        http_method_names 에서 제외하는 방식을 쓴다. 이 테스트가 그 방식을 고정한다.
        """
        doc = self._doc()
        self.client.force_authenticate(user=self.master)
        res = self.client.delete(f'/api/documents/{doc.id}/')
        allow = res.headers.get('Allow', '')
        self.assertNotIn('DELETE', allow, f'Allow 에 DELETE 가 남아 있다: {allow!r}')
        self.assertIn('GET', allow)
        self.assertIn('PATCH', allow)

    def test_other_methods_still_work(self):
        """delete 액션 이름이 HTTP DELETE 와 겹치므로, 다른 라우팅이 깨지지 않았는지 확인."""
        doc = self._doc('draft')
        self.client.force_authenticate(user=self.author)
        self.assertEqual(self.client.get(f'/api/documents/{doc.id}/').status_code, 200)
        self.assertEqual(
            self.client.patch(f'/api/documents/{doc.id}/', {'title': 'x'}, format='json').status_code,
            200,
        )
        self.assertEqual(self.client.get('/api/documents/').status_code, 200)

    def test_rest_delete_blocked_for_outsider_on_approved(self):
        """B-01 원본 재현 케이스: 무관한 사용자의 승인문서 REST DELETE."""
        doc = self._doc('approved')
        self.client.force_authenticate(user=self.norole)
        res = self.client.delete(f'/api/documents/{doc.id}/')
        self.assertEqual(res.status_code, 405)
        self.assertTrue(self._exists(doc))

    # ----- 허용 -----
    def test_author_can_delete_own_document(self):
        doc = self._doc()
        res = self._post_delete(self.author, doc)
        self.assertEqual(res.status_code, 200, res.content)
        self.assertFalse(self._exists(doc))

    def test_designated_pl_can_delete(self):
        doc = self._doc(designated_pl=self.designee)
        res = self._post_delete(self.designee, doc)
        self.assertEqual(res.status_code, 200, res.content)
        self.assertFalse(self._exists(doc))

    def test_group_member_can_delete(self):
        doc = self._doc()
        res = self._post_delete(self.member, doc)
        self.assertEqual(res.status_code, 200, res.content)
        self.assertFalse(self._exists(doc))

    def test_master_can_delete_approved(self):
        doc = self._doc('approved')
        res = self._post_delete(self.master, doc)
        self.assertEqual(res.status_code, 200, res.content)
        self.assertFalse(self._exists(doc))

    def test_author_can_delete_paused_document(self):
        """중단(pause) 문서도 철회 범위와 동일하게 작성자가 삭제할 수 있다(정책 확정)."""
        doc = self._doc('pause')
        res = self._post_delete(self.author, doc)
        self.assertEqual(res.status_code, 200, res.content)
        self.assertFalse(self._exists(doc))

    def test_legacy_document_without_requester_fk_is_deletable_by_author(self):
        """requester FK 가 비어 있는 레거시 문서는 이메일 폴백으로 작성자를 판별한다."""
        doc = self._doc()
        doc.requester = None
        doc.save(update_fields=['requester'])
        res = self._post_delete(self.author, doc)
        self.assertEqual(res.status_code, 200, res.content)
        self.assertFalse(self._exists(doc))

    def test_delete_cascades_approval_steps(self):
        """삭제 시 결재 단계도 함께 사라진다(복구 불가 — 로그로만 추적)."""
        doc = self._doc()
        ApprovalStep.objects.create(document=doc, agent='PL', action='pending', round=1, assignee=self.designee)
        res = self._post_delete(self.master, doc)
        self.assertEqual(res.status_code, 200, res.content)
        self.assertFalse(ApprovalStep.objects.filter(document_id=doc.id).exists())


# ─── 연간 디자인룰 통계 ────────────────────────────────────────────────────────

class AnnualDesignRuleStatsTest(TestCase):
    """홈 화면 연간 디자인룰 그래프 집계 규칙 (design_rule_stats)."""

    def setUp(self):
        from .models import DesignRule
        self.author = UserProfile.objects.create(loginid='drauthor', mail='dr@c.com', role='NONE')
        # 조합법 P1 → 0.1(100나노) (단일), P2 → 0.2(200나노) (단일), PAMB → 2개(모호)
        DesignRule.objects.create(process='P1', design_rule='0.1')
        DesignRule.objects.create(process='P2', design_rule='0.2')
        DesignRule.objects.create(process='PAMB', design_rule='0.3')
        DesignRule.objects.create(process='PAMB', design_rule='0.4')

    def _doc(self, *, process, purpose, year, status='approved', month=6, submitted=True):
        """지정 연도에 상신된 의뢰서 1건 생성."""
        import json
        from datetime import datetime
        from django.utils import timezone as tz
        doc = RequestDocument.objects.create(
            title=f'{process}-{purpose}-{year}', requester=self.author, requester_name='a',
            requester_email='dr@c.com', requester_department='d', product_name='p',
            status=status,
            additional_notes=json.dumps(
                {'detail': {'process_selection': process, 'request_purpose': purpose}},
                ensure_ascii=False,
            ),
        )
        if submitted:
            stamp = tz.make_aware(datetime(year, month, 1, 12, 0), tz.get_current_timezone())
            RequestDocument.objects.filter(pk=doc.pk).update(submitted_at=stamp)
            doc.refresh_from_db()
        return doc

    def _bucket(self, data, key):
        for b in data['buckets']:
            if b['key'] == key:
                return b
        return None

    def test_counts_group_by_design_rule_and_purpose(self):
        """조합법이 같은 디자인룰에 매핑되면 한 막대로 모이고, 목적별로 쪼개진다."""
        self._doc(process='P1', purpose='신규', year=2025)
        self._doc(process='P1', purpose='신규', year=2025)
        self._doc(process='P1', purpose='차용', year=2025)

        data = design_rule_stats.annual_stats(2025)
        bucket = self._bucket(data, '0.1')
        self.assertEqual(bucket['count'], 3)
        self.assertEqual(bucket['purposes']['신규'], 2)
        self.assertEqual(bucket['purposes']['차용'], 1)
        self.assertEqual(bucket['purposes']['기타'], 0)

    def test_bucket_label_shows_nano_while_key_stays_raw(self):
        """key는 원본 값을 유지하고, 화면 표시용 label만 나노로 변환된다."""
        self._doc(process='P1', purpose='신규', year=2025)
        data = design_rule_stats.annual_stats(2025)
        bucket = self._bucket(data, '0.1')
        self.assertIsNotNone(bucket)
        self.assertEqual(bucket['label'], '100나노')

    def test_only_approved_documents_are_counted(self):
        """승인 외 상태(임시저장·상신됨·반려)는 집계에서 빠진다."""
        self._doc(process='P1', purpose='신규', year=2025)
        for state in ('draft', 'submitted', 'under_review', 'rejected', 'pause'):
            self._doc(process='P1', purpose='신규', year=2025, status=state)

        data = design_rule_stats.annual_stats(2025)
        self.assertEqual(self._bucket(data, '0.1')['count'], 1)

    def test_documents_without_submitted_at_are_ignored(self):
        """상신일이 없으면 연도를 정할 수 없으므로 제외한다."""
        self._doc(process='P1', purpose='신규', year=2025, submitted=False)
        data = design_rule_stats.annual_stats(2025)
        self.assertEqual(data['total'], 0)

    def test_year_boundary_uses_local_time(self):
        """연말·연초 경계가 Asia/Seoul 기준으로 갈린다."""
        from datetime import datetime
        from django.utils import timezone as tz
        doc = self._doc(process='P1', purpose='신규', year=2025)
        # 2025-12-31 23:30 KST → 2025년으로 집계돼야 한다(UTC 로는 2025-12-31 14:30).
        stamp = tz.make_aware(datetime(2025, 12, 31, 23, 30), tz.get_current_timezone())
        RequestDocument.objects.filter(pk=doc.pk).update(submitted_at=stamp)

        self.assertEqual(design_rule_stats.annual_stats(2025)['total'], 1)
        self.assertEqual(design_rule_stats.annual_stats(2026)['total'], 0)

    def test_ambiguous_process_falls_into_unclassified(self):
        """한 조합법이 디자인룰 2개에 걸리면 미분류로 간다."""
        self._doc(process='PAMB', purpose='신규', year=2025)
        data = design_rule_stats.annual_stats(2025)
        self.assertIsNone(self._bucket(data, '0.3'))
        self.assertEqual(self._bucket(data, design_rule_stats.UNCLASSIFIED_KEY)['count'], 1)

    def test_non_numeric_resolved_process_value_falls_into_unclassified(self):
        """조합법이 매칭됐어도 그 값이 숫자가 아니면 미분류로 처리한다."""
        from .models import DesignRule
        DesignRule.objects.create(process='PTEXT', design_rule='TEXT-A')
        self._doc(process='PTEXT', purpose='신규', year=2025)

        data = design_rule_stats.annual_stats(2025)
        self.assertIsNone(self._bucket(data, 'TEXT-A'))
        self.assertEqual(self._bucket(data, design_rule_stats.UNCLASSIFIED_KEY)['count'], 1)

    def test_non_numeric_document_override_falls_into_unclassified(self):
        """의뢰서 단위 override 값이 숫자가 아니면 미분류로 처리한다."""
        from .models import DocumentDesignRuleOverride
        doc = self._doc(process='P1', purpose='신규', year=2025)
        DocumentDesignRuleOverride.objects.create(document=doc, design_rule='TEXT-B')

        data = design_rule_stats.annual_stats(2025)
        self.assertIsNone(self._bucket(data, 'TEXT-B'))
        self.assertIsNone(self._bucket(data, '0.1'))
        self.assertEqual(self._bucket(data, design_rule_stats.UNCLASSIFIED_KEY)['count'], 1)

    def test_unknown_and_empty_process_fall_into_unclassified(self):
        """마스터에 없는 조합법과 빈 조합법도 미분류."""
        self._doc(process='UNKNOWN', purpose='신규', year=2025)
        self._doc(process='', purpose='차용', year=2025)
        data = design_rule_stats.annual_stats(2025)
        self.assertEqual(self._bucket(data, design_rule_stats.UNCLASSIFIED_KEY)['count'], 2)

    def test_unclassified_bucket_always_present_even_when_empty(self):
        """미분류가 0건이어도 버킷은 유지된다."""
        self._doc(process='P1', purpose='신규', year=2025)
        data = design_rule_stats.annual_stats(2025)
        self.assertIsNotNone(self._bucket(data, design_rule_stats.UNCLASSIFIED_KEY))
        self.assertEqual(self._bucket(data, design_rule_stats.UNCLASSIFIED_KEY)['count'], 0)

    def test_process_override_resolves_unclassified(self):
        """조합법 수동 매핑이 마스터에 없는 조합법을 확정시킨다."""
        from .models import ProcessDesignRuleOverride
        self._doc(process='UNKNOWN', purpose='신규', year=2025)
        ProcessDesignRuleOverride.objects.create(process='UNKNOWN', design_rule='0.9')

        data = design_rule_stats.annual_stats(2025)
        self.assertEqual(self._bucket(data, '0.9')['count'], 1)
        self.assertEqual(self._bucket(data, design_rule_stats.UNCLASSIFIED_KEY)['count'], 0)

    def test_process_override_wins_over_master(self):
        """조합법 수동 매핑은 마스터 단일 매칭도 덮어쓴다."""
        from .models import ProcessDesignRuleOverride
        self._doc(process='P1', purpose='신규', year=2025)
        ProcessDesignRuleOverride.objects.create(process='P1', design_rule='0.11')

        data = design_rule_stats.annual_stats(2025)
        self.assertIsNone(self._bucket(data, '0.1'))
        self.assertEqual(self._bucket(data, '0.11')['count'], 1)

    def test_process_override_resolves_ambiguous_process(self):
        """모호했던 조합법도 수동 매핑이 있으면 확정된다."""
        from .models import ProcessDesignRuleOverride
        self._doc(process='PAMB', purpose='신규', year=2025)
        ProcessDesignRuleOverride.objects.create(process='PAMB', design_rule='0.3')

        data = design_rule_stats.annual_stats(2025)
        self.assertEqual(self._bucket(data, '0.3')['count'], 1)
        self.assertEqual(self._bucket(data, design_rule_stats.UNCLASSIFIED_KEY)['count'], 0)

    def test_document_override_wins_over_process_override(self):
        """의뢰서 단위 매핑이 조합법 단위 매핑보다 우선한다."""
        from .models import ProcessDesignRuleOverride, DocumentDesignRuleOverride
        doc = self._doc(process='P1', purpose='신규', year=2025)
        ProcessDesignRuleOverride.objects.create(process='P1', design_rule='0.12')
        DocumentDesignRuleOverride.objects.create(document=doc, design_rule='0.13')

        data = design_rule_stats.annual_stats(2025)
        self.assertIsNone(self._bucket(data, '0.12'))
        self.assertEqual(self._bucket(data, '0.13')['count'], 1)

    def test_top_n_folds_remainder_into_etc(self):
        """상위 N 밖 디자인룰은 '기타'로 합산되고, 미분류와는 섞이지 않는다."""
        from .models import DesignRule
        for i in range(4):
            DesignRule.objects.create(process=f'PX{i}', design_rule=f'0.5{i}')
            for _ in range(i + 1):     # 0.50=1건 … 0.53=4건
                self._doc(process=f'PX{i}', purpose='신규', year=2025)
        self._doc(process='UNKNOWN', purpose='신규', year=2025)   # 미분류 1건

        data = design_rule_stats.annual_stats(2025, top_n=2)
        keys = [b['key'] for b in data['buckets']]
        # 건수 내림차순 상위 2개(0.53=4, 0.52=3) + 기타 + 미분류
        self.assertEqual(keys, ['0.53', '0.52', design_rule_stats.ETC_KEY,
                                design_rule_stats.UNCLASSIFIED_KEY])
        etc = self._bucket(data, design_rule_stats.ETC_KEY)
        self.assertEqual(etc['count'], 3)          # 0.51(2) + 0.50(1)
        self.assertEqual(etc['member_count'], 2)
        self.assertEqual(self._bucket(data, design_rule_stats.UNCLASSIFIED_KEY)['count'], 1)

    def test_top_n_none_returns_every_rule_without_etc(self):
        """top_n=None(전체)이면 기타 버킷 없이 전부 개별로 나온다."""
        self._doc(process='P1', purpose='신규', year=2025)
        self._doc(process='P2', purpose='신규', year=2025)

        data = design_rule_stats.annual_stats(2025, top_n=None)
        self.assertIsNone(self._bucket(data, design_rule_stats.ETC_KEY))
        self.assertEqual(self._bucket(data, '0.1')['count'], 1)
        self.assertEqual(self._bucket(data, '0.2')['count'], 1)

    def test_top_n_ranks_by_base_year_not_compare_year(self):
        """상위 선정 기준은 비교 연도가 아니라 기준 연도 건수다."""
        self._doc(process='P1', purpose='신규', year=2025)          # 기준 1건
        for _ in range(5):
            self._doc(process='P2', purpose='신규', year=2024)      # 비교 연도만 5건

        data = design_rule_stats.annual_stats(2025, compare_year=2024, top_n=1)
        self.assertEqual(data['buckets'][0]['key'], '0.1')

    def test_delta_up_and_down(self):
        """증감률 부호와 상태."""
        for _ in range(3):
            self._doc(process='P1', purpose='신규', year=2025)
        for _ in range(2):
            self._doc(process='P1', purpose='신규', year=2024)

        data = design_rule_stats.annual_stats(2025, compare_year=2024)
        bucket = self._bucket(data, '0.1')
        self.assertEqual(bucket['compare_count'], 2)
        self.assertEqual(bucket['delta_pct'], 50.0)
        self.assertEqual(bucket['delta_state'], design_rule_stats.DELTA_UP)

    def test_delta_new_when_compare_is_zero(self):
        """비교 연도 0건이면 0으로 나누지 않고 'new' 상태로 구분한다."""
        self._doc(process='P1', purpose='신규', year=2025)
        self._doc(process='P2', purpose='신규', year=2024)   # 비교 연도 데이터 존재

        data = design_rule_stats.annual_stats(2025, compare_year=2024)
        bucket = self._bucket(data, '0.1')
        self.assertIsNone(bucket['delta_pct'])
        self.assertEqual(bucket['delta_state'], design_rule_stats.DELTA_NEW)

    def test_no_compare_year_leaves_compare_fields_null(self):
        """비교 연도가 없으면 비교 필드는 모두 null."""
        self._doc(process='P1', purpose='신규', year=2025)
        data = design_rule_stats.annual_stats(2025)
        bucket = self._bucket(data, '0.1')
        self.assertIsNone(bucket['compare_count'])
        self.assertIsNone(bucket['compare_purposes'])
        self.assertIsNone(bucket['delta_pct'])
        self.assertIsNone(data['compare_total'])

    def test_unknown_purpose_normalizes_to_etc(self):
        """정해진 5종 밖 목적값은 '기타'로 모은다."""
        self._doc(process='P1', purpose='정체불명', year=2025)
        self._doc(process='P1', purpose='', year=2025)
        data = design_rule_stats.annual_stats(2025)
        self.assertEqual(self._bucket(data, '0.1')['purposes']['기타'], 2)

    def test_corrupt_additional_notes_does_not_crash(self):
        """JSON 이 깨진 의뢰서는 미분류로 흘려보내고 예외를 내지 않는다."""
        doc = self._doc(process='P1', purpose='신규', year=2025)
        RequestDocument.objects.filter(pk=doc.pk).update(additional_notes='{not json')

        data = design_rule_stats.annual_stats(2025)
        self.assertEqual(self._bucket(data, design_rule_stats.UNCLASSIFIED_KEY)['count'], 1)

    def test_available_years_lists_only_years_with_approved_docs(self):
        self._doc(process='P1', purpose='신규', year=2023)
        self._doc(process='P1', purpose='신규', year=2025)
        self.assertEqual(design_rule_stats.available_years(), [2023, 2025])

    def test_unclassified_targets_reports_reason_and_candidates(self):
        """분류 모달 데이터 — 사유와 모호한 경우의 후보 디자인룰."""
        self._doc(process='PAMB', purpose='신규', year=2025)
        self._doc(process='UNKNOWN', purpose='신규', year=2025)
        self._doc(process='', purpose='신규', year=2025)

        targets = design_rule_stats.unclassified_targets()
        by_process = {p['process']: p for p in targets['processes']}
        self.assertEqual(by_process['PAMB']['reason'], design_rule_stats.REASON_AMBIGUOUS)
        self.assertEqual(by_process['PAMB']['candidates'], ['0.3', '0.4'])
        self.assertEqual(by_process['UNKNOWN']['reason'], design_rule_stats.REASON_MISSING)
        # 조합법이 빈 건은 조합법 매핑으로 해결할 수 없어 문서 목록에만 잡힌다
        self.assertNotIn('', by_process)
        reasons = {d['reason'] for d in targets['documents']}
        self.assertIn(design_rule_stats.REASON_EMPTY, reasons)

    def test_unclassified_targets_flags_non_numeric_reason(self):
        """매칭은 됐지만 비숫자인 값은 조합법/의뢰서 목록에 non_numeric 사유로 뜬다."""
        from .models import DesignRule, DocumentDesignRuleOverride
        DesignRule.objects.create(process='PTEXT', design_rule='TEXT-A')
        self._doc(process='PTEXT', purpose='신규', year=2025)
        doc2 = self._doc(process='P1', purpose='신규', year=2025)
        DocumentDesignRuleOverride.objects.create(document=doc2, design_rule='TEXT-B')

        targets = design_rule_stats.unclassified_targets()
        by_process = {p['process']: p for p in targets['processes']}
        self.assertEqual(by_process['PTEXT']['reason'], design_rule_stats.REASON_NON_NUMERIC)

        doc2_entry = next(d for d in targets['documents'] if d['id'] == doc2.id)
        self.assertEqual(doc2_entry['reason'], design_rule_stats.REASON_NON_NUMERIC)

    def test_design_rule_options_returns_numeric_only_sorted_value_label_pairs(self):
        """옵션은 숫자로 변환되는 값만, 나노값 오름차순 {value,label} 로 나온다."""
        from .models import DesignRule
        DesignRule.objects.create(process='PTEXT', design_rule='TEXT-A')  # 비숫자 — 후보 제외
        DesignRule.objects.create(process='PBIG', design_rule='1')        # 1000나노

        options = design_rule_stats.design_rule_options()
        values = [o['value'] for o in options]
        self.assertNotIn('TEXT-A', values)
        self.assertIn('0.1', values)
        # 나노값 기준 오름차순 — 0.1(100나노) 이 1(1000나노) 보다 앞에 와야 한다
        self.assertLess(values.index('0.1'), values.index('1'))
        entry = next(o for o in options if o['value'] == '0.1')
        self.assertEqual(entry['label'], '100나노')


class AnnualDesignRuleStatsApiTest(TestCase):
    """연간 통계 API 엔드포인트 — 파라미터 파싱과 매핑 쓰기 인가."""

    def setUp(self):
        from rest_framework.test import APIClient
        from .models import DesignRule
        self.client = APIClient()
        self.author = UserProfile.objects.create(loginid='apiauthor', mail='api@c.com', role='NONE')
        self.master = UserProfile.objects.create(loginid='apimaster', mail='m@c.com', role='MASTER')
        DesignRule.objects.create(process='P1', design_rule='R1')
        # 운영 모드에선 조회도 인증이 필요하다 — 기본은 일반 사용자로 로그인해 둔다.
        self.client.force_authenticate(user=self.author)

    def _doc(self, year):
        import json
        from datetime import datetime
        from django.utils import timezone as tz
        doc = RequestDocument.objects.create(
            title=f'doc-{year}', requester=self.author, requester_name='a',
            requester_email='api@c.com', requester_department='d', product_name='p',
            status='approved',
            additional_notes=json.dumps(
                {'detail': {'process_selection': 'P1', 'request_purpose': '신규'}}, ensure_ascii=False
            ),
        )
        stamp = tz.make_aware(datetime(year, 6, 1, 12, 0), tz.get_current_timezone())
        RequestDocument.objects.filter(pk=doc.pk).update(submitted_at=stamp)
        return doc

    def test_empty_state_when_no_approved_documents(self):
        res = self.client.get('/api/documents/annual-design-rule-stats/')
        self.assertEqual(res.status_code, 200)
        data = res.json()['data']
        self.assertEqual(data['available_years'], [])
        self.assertEqual(data['buckets'], [])
        self.assertIsNone(data['year'])

    def test_defaults_to_latest_year(self):
        self._doc(2024)
        self._doc(2026)
        res = self.client.get('/api/documents/annual-design-rule-stats/')
        self.assertEqual(res.json()['data']['year'], 2026)

    def test_compare_equal_to_year_is_dropped(self):
        """같은 연도끼리 비교하면 비교가 무의미하므로 무시한다."""
        self._doc(2026)
        res = self.client.get('/api/documents/annual-design-rule-stats/?year=2026&compare=2026')
        self.assertIsNone(res.json()['data']['compare_year'])

    def test_invalid_params_fall_back_to_defaults(self):
        self._doc(2026)
        res = self.client.get('/api/documents/annual-design-rule-stats/?year=abc&top=xyz')
        data = res.json()['data']
        self.assertEqual(data['year'], 2026)
        self.assertEqual(data['top'], design_rule_stats.DEFAULT_TOP_N)

    def test_top_all_returns_none(self):
        self._doc(2026)
        res = self.client.get('/api/documents/annual-design-rule-stats/?top=all')
        self.assertIsNone(res.json()['data']['top'])

    def test_top_is_clamped_to_max(self):
        self._doc(2026)
        res = self.client.get('/api/documents/annual-design-rule-stats/?top=999')
        self.assertEqual(res.json()['data']['top'], design_rule_stats.MAX_TOP_N)

    def test_non_master_cannot_create_process_override(self):
        self.client.force_authenticate(user=self.author)
        res = self.client.post('/api/design-rule-processes/',
                               {'process': 'PX', 'design_rule': 'RX'}, format='json')
        self.assertEqual(res.status_code, 403)

    def test_master_can_create_process_override(self):
        self.client.force_authenticate(user=self.master)
        res = self.client.post('/api/design-rule-processes/',
                               {'process': 'PX', 'design_rule': 'RX'}, format='json')
        self.assertEqual(res.status_code, 201)

    def test_reposting_same_process_updates_instead_of_409(self):
        """분류 모달에서 '다시 지정'이 자연스럽도록 upsert 로 처리한다."""
        from .models import ProcessDesignRuleOverride
        self.client.force_authenticate(user=self.master)
        self.client.post('/api/design-rule-processes/',
                         {'process': 'PX', 'design_rule': 'RX'}, format='json')
        res = self.client.post('/api/design-rule-processes/',
                               {'process': 'PX', 'design_rule': 'RY'}, format='json')
        self.assertEqual(res.status_code, 201)
        self.assertEqual(ProcessDesignRuleOverride.objects.filter(process='PX').count(), 1)
        self.assertEqual(ProcessDesignRuleOverride.objects.get(process='PX').design_rule, 'RY')

    def test_master_can_reassign_document_override(self):
        from .models import DocumentDesignRuleOverride
        doc = self._doc(2026)
        self.client.force_authenticate(user=self.master)
        self.client.post('/api/design-rule-documents/',
                         {'document': doc.id, 'design_rule': 'RA'}, format='json')
        res = self.client.post('/api/design-rule-documents/',
                               {'document': doc.id, 'design_rule': 'RB'}, format='json')
        self.assertEqual(res.status_code, 201)
        self.assertEqual(DocumentDesignRuleOverride.objects.filter(document=doc).count(), 1)
        self.assertEqual(DocumentDesignRuleOverride.objects.get(document=doc).design_rule, 'RB')

    def test_unclassified_endpoint_returns_targets(self):
        self._doc(2026)
        from .models import DesignRule
        DesignRule.objects.filter(process='P1').delete()   # P1 을 미분류로 만든다
        res = self.client.get('/api/design-rule-processes/unclassified/')
        self.assertEqual(res.status_code, 200)
        data = res.json()['data']
        self.assertEqual([p['process'] for p in data['processes']], ['P1'])
