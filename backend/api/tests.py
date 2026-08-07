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
    """임시저장(draft) 문서는 작성자 본인 + 지정된 공유 그룹 멤버 + MASTER 에게만 보인다."""

    def setUp(self):
        from rest_framework.test import APIRequestFactory
        from .views import RequestDocumentViewSet
        self._factory = APIRequestFactory()
        self._view_cls = RequestDocumentViewSet

        self.author = UserProfile.objects.create(loginid='author', mail='a@c.com', role='NONE')
        self.member = UserProfile.objects.create(loginid='member', mail='m@c.com', role='NONE')
        self.other_member = UserProfile.objects.create(loginid='other', mail='ot@c.com', role='NONE')
        self.outsider = UserProfile.objects.create(loginid='out', mail='o@c.com', role='NONE')
        self.master = UserProfile.objects.create(loginid='master', mail='ms@c.com', role='MASTER')

        self.group = UserGroup.objects.create(name='team', creator=self.author)
        self.group.members.add(self.author, self.member)
        # 작성자가 속한 '다른' 그룹 — 공유 대상으로 지정하지 않았으므로 보이면 안 된다.
        self.other_group = UserGroup.objects.create(name='team2', creator=self.author)
        self.other_group.members.add(self.author, self.other_member)

        self.draft = RequestDocument.objects.create(
            title='draft doc', requester=self.author, requester_name='a',
            requester_email='a@c.com', requester_department='d', product_name='p',
            status='draft', shared_group=self.group,
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

    def test_shared_group_member_sees_draft(self):
        self.assertIn(self.draft.id, self._visible_ids(self.member))

    def test_member_of_other_group_cannot_see_draft(self):
        """작성자와 그룹을 공유해도 그 문서의 공유 그룹이 아니면 보이지 않는다."""
        ids = self._visible_ids(self.other_member)
        self.assertNotIn(self.draft.id, ids)
        self.assertIn(self.submitted.id, ids)

    def test_unshared_draft_is_author_only(self):
        """공유 그룹 미지정 draft 는 작성자 본인과 MASTER 만 본다."""
        self.draft.shared_group = None
        self.draft.save(update_fields=['shared_group'])
        self.assertIn(self.draft.id, self._visible_ids(self.author))
        self.assertIn(self.draft.id, self._visible_ids(self.master))
        self.assertNotIn(self.draft.id, self._visible_ids(self.member))

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
    def test_ra_fixed_post_approver_subject_is_post_approver_request(self):
        subject, _ = mailer._build_message(
            'stage_arrival', self.doc, agent='RA', recipient_name='홍길동', is_fixed_post_approver=True,
        )
        self.assertEqual(subject, f'[후결 요청] {self.doc.title}')

    @override_settings(FRONTEND_URL='https://example.com')
    def test_ra_additional_post_approver_subject_matches_other_stages(self):
        subject, _ = mailer._build_message(
            'stage_arrival', self.doc, agent='RA', recipient_name='홍길동', is_fixed_post_approver=False,
        )
        self.assertEqual(subject, f'[홍길동님] [결재 요청] {self.doc.title}')

    @override_settings(FRONTEND_URL='https://example.com')
    def test_personal_assignment_subject_has_name_prefix(self):
        subject, _ = mailer._build_message('stage_arrival', self.doc, agent='R', recipient_name='홍길동')
        self.assertTrue(subject.startswith('[홍길동님] '))
        self.assertIn(self.doc.title, subject)

    @override_settings(FRONTEND_URL='https://example.com')
    def test_broadcast_subject_has_no_name_prefix(self):
        subject, _ = mailer._build_message('stage_arrival', self.doc, agent='R')
        # 이름 접두어("[홍길동님] ")만 없어야 한다. 단계 라벨 "[결재 요청]" 은 브로드캐스트에도 붙는다.
        self.assertEqual(subject, f'[결재 요청] {self.doc.title}')

    @override_settings(FRONTEND_URL='https://example.com')
    def test_stage_arrival_subject_has_no_stage_suffix(self):
        subject, _ = mailer._build_message('stage_arrival', self.doc, agent='R', recipient_name='홍길동')
        self.assertEqual(subject, f'[홍길동님] [결재 요청] {self.doc.title}')

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
        # R 단계 미배정 도착은 TE_R 팀 전원에게 발송된다. 팀원이 없으면 수신자 0명이라
        # _enqueue 가 적재를 건너뛰므로(None 반환) 즉시 발송 예약 자체가 검증되지 않는다.
        UserProfile.objects.create(loginid='te_r', mail='ter@company.com', role='TE_R')
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
        self.e_reviewer2 = UserProfile.objects.create(loginid='e3', mail='e3@c.com', role='TE_E')

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

    def test_p_arrival_notifies_te_j(self):
        doc = self._advance_to_parallel()
        noti = MailNotification.objects.filter(document=doc, event_type='notify_p_arrival').first()
        self.assertIsNotNone(noti)
        self.assertIn(self.j_user.mail, noti.recipients)
        self.assertEqual(noti.subject, f'[P 도착 통보] {doc.title}')

    def test_p_completion_notifies_te_o(self):
        doc = self._advance_to_parallel()
        self.client.force_authenticate(user=self.p_owner)
        self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': 'P'}, format='json')
        r = self.client.post(f'/api/documents/{doc.id}/approve-step/', {'agent': 'P', 'comment': ''}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        noti = MailNotification.objects.filter(document=doc, event_type='notify_p_completed').first()
        self.assertIsNotNone(noti)
        self.assertIn(self.o_user.mail, noti.recipients)
        self.assertEqual(noti.subject, f'[P 완료 통보] {doc.title}')

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

    def test_e_reviewer_gate_blocks_final_approval_until_any_agrees(self):
        """EV 는 OR — 아무도 합의하지 않으면 최종 승인이 막히고, 1명이 합의하면 통과한다."""
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

        # path2: E 담당자 합의 + 검토자 2명 지정(동시) — 아무도 합의하지 않아 아직 최종 승인 아님
        self.client.force_authenticate(user=self.e_owner)
        self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': 'E'}, format='json')
        r = self.client.post(f'/api/documents/{doc.id}/approve-step/', {
            'agent': 'E', 'comment': '',
            'reviewer_loginids': [self.e_reviewer.loginid, self.e_reviewer2.loginid],
        }, format='json')
        self.assertEqual(r.status_code, 200, r.content)

        doc.refresh_from_db()
        self.assertEqual(doc.status, 'under_review')

        # 검토자(EV) 중 1명 합의 → 나머지가 남아 있어도 최종 승인
        self.client.force_authenticate(user=self.e_reviewer)
        r = self.client.post(f'/api/documents/{doc.id}/approve-step/', {'agent': 'EV', 'comment': ''}, format='json')
        self.assertEqual(r.status_code, 200, r.content)

        doc.refresh_from_db()
        self.assertEqual(doc.status, 'approved')

    # ----- Validation System: 판정 주체는 상신자 하나 -----

    def _get_detail(self, doc):
        doc.refresh_from_db()
        return self._json.loads(doc.additional_notes or '{}').get('detail', {})

    def _set_detail(self, doc, detail):
        notes = self._json.loads(doc.additional_notes)
        notes['detail'] = detail
        doc.additional_notes = self._json.dumps(notes)
        doc.save()

    def _approve_e(self, doc, reviewers=None):
        """E 담당자가 선점 후 합의한다. reviewers 를 주면 EV 2차 검토자를 함께 지정한다."""
        self.client.force_authenticate(user=self.e_owner)
        self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': 'E'}, format='json')
        body = {'agent': 'E', 'comment': '확인함'}
        if reviewers:
            body['reviewer_loginids'] = reviewers
        return self.client.post(f'/api/documents/{doc.id}/approve-step/', body, format='json')

    def test_requester_updates_validation_system(self):
        """상신자는 진행 중 문서의 대상/비대상을 바꿀 수 있고, 변경 주체·시각이 기록된다."""
        doc = self._advance_to_parallel(plel=True)
        self._set_detail(doc, {'validation_system': 'NO', 'validation_system_submitted': 'NO'})

        self.client.force_authenticate(user=self.requester)
        r = self.client.post(f'/api/documents/{doc.id}/validation-system/', {'value': 'YES'}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(
            ApprovalStep.objects.get(document=doc, agent='E', round=1).action, 'pending',
            'E 합의 전이므로 E 단계는 대기 그대로다',
        )

        detail = self._get_detail(doc)
        self.assertEqual(detail['validation_system'], 'YES')
        self.assertEqual(detail['validation_system_submitted'], 'NO',
                         '상신 시점 값은 이후 변경으로 바뀌지 않는다')
        self.assertTrue(detail.get('validation_system_changed_by'))
        self.assertTrue(detail.get('validation_system_changed_at'))

    def test_non_requester_cannot_update_validation_system(self):
        """상신자(또는 MASTER)가 아니면 값을 바꿀 수 없다 — MASK 도 마찬가지다."""
        doc = self._advance_to_parallel(plel=True)
        self._set_detail(doc, {'validation_system': 'NO'})

        self.client.force_authenticate(user=self.e_owner)
        r = self.client.post(f'/api/documents/{doc.id}/validation-system/', {'value': 'YES'}, format='json')
        self.assertEqual(r.status_code, 403, r.content)
        self.assertEqual(self._get_detail(doc)['validation_system'], 'NO')

    def test_invalid_validation_system_value_rejected(self):
        """허용되지 않는 값은 400 이다."""
        doc = self._advance_to_parallel(plel=True)
        self.client.force_authenticate(user=self.requester)
        r = self.client.post(f'/api/documents/{doc.id}/validation-system/', {'value': 'MAYBE'}, format='json')
        self.assertEqual(r.status_code, 400, r.content)

    def test_approve_step_ignores_validation_system(self):
        """E 합의 요청에 값을 실어 보내도 더 이상 반영되지 않는다(판정 주체는 상신자다)."""
        doc = self._advance_to_parallel(plel=True)
        self._set_detail(doc, {'validation_system': 'YES'})

        self.client.force_authenticate(user=self.e_owner)
        self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': 'E'}, format='json')
        r = self.client.post(
            f'/api/documents/{doc.id}/approve-step/',
            {'agent': 'E', 'comment': '', 'validation_system': 'NO',
             'reviewer_loginids': [self.e_reviewer.loginid]}, format='json',
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(self._get_detail(doc)['validation_system'], 'YES')

    def test_validation_system_change_does_not_rewind_e(self):
        """E 담당자 합의 뒤 값이 바뀌어도 되감지 않는다 — comment 에 note 만 덧붙는다.

        (2026-08-06) EV 는 1명만 합의해도 단계가 끝나므로(OR), 아직 아무도 합의하지
        않았다면 이후 합의하는 검토자가 바뀐 값을 보고 판단한다.
        """
        doc = self._advance_to_parallel(plel=True)
        self._set_detail(doc, {'validation_system': 'NO', 'validation_system_submitted': 'NO'})
        r = self._approve_e(doc, reviewers=[self.e_reviewer.loginid])
        self.assertEqual(r.status_code, 200, r.content)

        self.client.force_authenticate(user=self.requester)
        r = self.client.post(f'/api/documents/{doc.id}/validation-system/', {'value': 'YES'}, format='json')
        self.assertEqual(r.status_code, 200, r.content)

        e_step = ApprovalStep.objects.get(document=doc, agent='E', round=1)
        self.assertEqual(e_step.action, 'approved', '값이 바뀌어도 E 합의를 되감지 않는다')
        self.assertIn('[값 변경', e_step.comment, '변경 사실은 감사 이력으로 남아야 한다')
        self.assertIsNotNone(e_step.acted_at, '합의 시각은 그대로다')
        self.assertTrue(
            ApprovalStep.objects.filter(document=doc, agent='EV', round=1).exists(),
            'EV step 은 삭제되지 않는다 — 남은 검토자가 바뀐 값을 보고 판단한다',
        )
        doc.refresh_from_db()
        self.assertEqual(doc.status, 'under_review')
        self.assertFalse(
            ApprovalStep.objects.filter(document=doc, round=2).exists(),
            '반려와 달리 새 회차를 만들지 않는다',
        )

    def test_same_value_is_not_a_change(self):
        """같은 값으로 다시 저장하면 변경이 아니므로 note 도 남지 않는다."""
        doc = self._advance_to_parallel(plel=True)
        self._set_detail(doc, {'validation_system': 'NO'})
        self.assertEqual(self._approve_e(doc, reviewers=[self.e_reviewer.loginid]).status_code, 200)

        self.client.force_authenticate(user=self.requester)
        r = self.client.post(f'/api/documents/{doc.id}/validation-system/', {'value': 'NO'}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.data['message'], '변경 사항이 없습니다.')
        e_step = ApprovalStep.objects.get(document=doc, agent='E', round=1)
        self.assertEqual(e_step.action, 'approved')
        self.assertNotIn('[값 변경', e_step.comment)

    def test_broken_detail_json_does_not_record_change(self):
        """additional_notes 가 깨져 저장에 실패하면 500 이고, 변경 note 도 남기지 않는다."""
        doc = self._advance_to_parallel(plel=True)
        self._set_detail(doc, {'validation_system': 'NO'})
        self.assertEqual(self._approve_e(doc, reviewers=[self.e_reviewer.loginid]).status_code, 200)

        # 저장을 실패시키기 위해 additional_notes 를 깨뜨린다.
        # _set_detail 은 json.loads 를 쓰므로 여기서는 쓸 수 없다.
        doc.additional_notes = '{"detail": broken'
        doc.save(update_fields=['additional_notes'])

        # 읽기도 실패하므로 previous 는 레거시 기본값('YES')으로 정규화된다.
        # 저장 경로를 타려면 그와 다른 값을 보내야 한다.
        self.client.force_authenticate(user=self.requester)
        r = self.client.post(f'/api/documents/{doc.id}/validation-system/', {'value': 'NO'}, format='json')
        self.assertEqual(r.status_code, 500, r.content)

        e_step = ApprovalStep.objects.get(document=doc, agent='E', round=1)
        self.assertEqual(e_step.action, 'approved', '저장이 실패했으면 상태를 건드려서는 안 된다')
        self.assertNotIn('[값 변경', e_step.comment, '저장이 실패했으면 변경 note 도 남기지 않는다')

    def test_legacy_doc_clicking_displayed_value_is_not_a_change(self):
        """저장값이 없는 레거시 문서에서 화면에 보이는 값('대상')을 그대로 클릭하면 변경이 아니다.

        상세보기(PagedDetailView 의 vsCurrent 폴백)가 키 없는 문서를 '대상'으로 표시하므로,
        백엔드도 같은 기준으로 비교해야 사용자가 '바꾸지 않았는데 이력이 남았다'를 겪지 않는다.
        """
        doc = self._advance_to_parallel(plel=True)
        # _set_detail 을 호출하지 않는다 → detail 은 {} 이고 validation_system 키가 없다.
        self.assertEqual(self._approve_e(doc, reviewers=[self.e_reviewer.loginid]).status_code, 200)

        self.client.force_authenticate(user=self.requester)
        r = self.client.post(f'/api/documents/{doc.id}/validation-system/', {'value': 'YES'}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.data['message'], '변경 사항이 없습니다.', '보이는 값과 같으므로 변경이 아니다')

        e_step = ApprovalStep.objects.get(document=doc, agent='E', round=1)
        self.assertEqual(e_step.action, 'approved')
        self.assertNotIn('[값 변경', e_step.comment)

    def test_legacy_doc_real_change_is_recorded(self):
        """레거시 폴백을 적용해도 진짜 변경('비대상' 선택)은 그대로 이력에 남는다."""
        doc = self._advance_to_parallel(plel=True)
        self.assertEqual(self._approve_e(doc, reviewers=[self.e_reviewer.loginid]).status_code, 200)

        self.client.force_authenticate(user=self.requester)
        r = self.client.post(f'/api/documents/{doc.id}/validation-system/', {'value': 'NO'}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(self._get_detail(doc)['validation_system'], 'NO')
        e_step = ApprovalStep.objects.get(document=doc, agent='E', round=1)
        self.assertEqual(e_step.action, 'approved', '되감지 않는다')
        self.assertIn('[값 변경', e_step.comment)

    def test_all_designated_reviewers_are_created(self):
        """E 합의 시 검토자를 여러 명 지정하면 전원의 EV step 이 실제로 생성된다.

        (되감기 제거 전에는 '되감긴 뒤 재합의하며 검토자 추가' 경로로 이 사실을 확인했다.
        되감기가 사라져 재합의 경로가 없으므로 최초 지정 경로로 같은 사실을 지킨다.)
        """
        doc = self._advance_to_parallel(plel=True)
        self._set_detail(doc, {'validation_system': 'NO'})
        r = self._approve_e(doc, reviewers=[self.e_reviewer.loginid, self.e_reviewer2.loginid])
        self.assertEqual(r.status_code, 200, r.content)

        for reviewer in (self.e_reviewer, self.e_reviewer2):
            self.assertTrue(
                ApprovalStep.objects.filter(
                    document=doc, agent='EV', round=1, assignee__loginid=reviewer.loginid
                ).exists(),
                '지정한 검토자의 EV step 이 조용히 버려져서는 안 된다',
            )

    # ----- E 합의 시 2차 검토자 필수 -----

    def test_e_approve_without_reviewer_is_rejected(self):
        """E 담당자가 검토자를 지정하지 않고 합의하면 400 이고, 아무 것도 커밋되지 않는다."""
        doc = self._advance_to_parallel(plel=True)
        self.client.force_authenticate(user=self.e_owner)
        self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': 'E'}, format='json')
        r = self.client.post(
            f'/api/documents/{doc.id}/approve-step/',
            {'agent': 'E', 'comment': ''}, format='json',
        )
        self.assertEqual(r.status_code, 400, r.content)

        e_step = ApprovalStep.objects.get(document=doc, agent='E', round=1)
        self.assertEqual(e_step.action, 'pending')
        self.assertFalse(ApprovalStep.objects.filter(document=doc, agent='EV', round=1).exists())
        doc.refresh_from_db()
        self.assertEqual(doc.status, 'under_review')

    def test_e_approve_with_empty_reviewer_list_is_rejected(self):
        """빈 목록이나 공백뿐인 loginid 는 '지정 없음'과 동일하게 취급해 400 이다."""
        doc = self._advance_to_parallel(plel=True)
        self.client.force_authenticate(user=self.e_owner)
        self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': 'E'}, format='json')

        r = self.client.post(
            f'/api/documents/{doc.id}/approve-step/',
            {'agent': 'E', 'comment': '', 'reviewer_loginids': []}, format='json',
        )
        self.assertEqual(r.status_code, 400, r.content)

        r = self.client.post(
            f'/api/documents/{doc.id}/approve-step/',
            {'agent': 'E', 'comment': '', 'reviewer_loginids': ['  ']}, format='json',
        )
        self.assertEqual(r.status_code, 400, r.content)

    def test_e_approve_with_reviewer_succeeds(self):
        """검토자를 1명 지정하면 200 이고 EV step 이 생성된다."""
        doc = self._advance_to_parallel(plel=True)
        r = self._approve_e(doc, reviewers=[self.e_reviewer.loginid])
        self.assertEqual(r.status_code, 200, r.content)

        e_step = ApprovalStep.objects.get(document=doc, agent='E', round=1)
        self.assertEqual(e_step.action, 'approved')
        self.assertTrue(
            ApprovalStep.objects.filter(document=doc, agent='EV', round=1).exists()
        )

    def test_p_approve_without_reviewer_still_allowed(self):
        """P 단계는 이번 변경의 범위 밖이다 — 검토자 없이 합의해도 여전히 200."""
        doc = self._advance_to_parallel(plel=True)
        self.client.force_authenticate(user=self.p_owner)
        self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': 'P'}, format='json')
        r = self.client.post(
            f'/api/documents/{doc.id}/approve-step/',
            {'agent': 'P', 'comment': ''}, format='json',
        )
        self.assertEqual(r.status_code, 200, r.content)

    def test_validation_system_change_keeps_ev_steps(self):
        """값 변경은 EV step 을 삭제하지 않는다(구 되감기 동작 제거 회귀)."""
        doc = self._advance_to_parallel(plel=True)
        self._set_detail(doc, {'validation_system': 'NO'})
        self.assertEqual(
            self._approve_e(doc, reviewers=[self.e_reviewer.loginid, self.e_reviewer2.loginid]).status_code, 200
        )
        self.assertEqual(ApprovalStep.objects.filter(document=doc, agent='EV', round=1).count(), 2)

        self.client.force_authenticate(user=self.requester)
        r = self.client.post(f'/api/documents/{doc.id}/validation-system/', {'value': 'YES'}, format='json')
        self.assertEqual(r.status_code, 200, r.content)

        ev_steps = ApprovalStep.objects.filter(document=doc, agent='EV', round=1)
        self.assertEqual(ev_steps.count(), 2, '검토자 step 이 사라지면 아무도 판단할 수 없게 된다')
        self.assertTrue(all(s.action == 'pending' for s in ev_steps))
        self.assertEqual(ApprovalStep.objects.get(document=doc, agent='E', round=1).action, 'approved')

    def test_e_cannot_be_reapproved_after_validation_system_change(self):
        """값이 바뀌어도 E 는 approved 그대로라 재합의 경로 자체가 없다.

        E 담당자 본인의 재확인이 강제되지 않는다는 뜻이며, 이 트레이드오프는
        되감기가 만들던 잠금·이력 소실보다 낫다고 판단해 의도적으로 택한 것이다.
        """
        doc = self._advance_to_parallel(plel=True)
        self._set_detail(doc, {'validation_system': 'NO'})
        self.assertEqual(self._approve_e(doc, reviewers=[self.e_reviewer.loginid]).status_code, 200)

        self.client.force_authenticate(user=self.requester)
        r = self.client.post(f'/api/documents/{doc.id}/validation-system/', {'value': 'YES'}, format='json')
        self.assertEqual(r.status_code, 200, r.content)

        self.client.force_authenticate(user=self.e_owner)
        r = self.client.post(
            f'/api/documents/{doc.id}/approve-step/',
            {'agent': 'E', 'comment': '', 'reviewer_loginids': [self.e_reviewer.loginid]}, format='json',
        )
        self.assertEqual(r.status_code, 400, r.content)
        self.assertEqual(ApprovalStep.objects.get(document=doc, agent='E', round=1).action, 'approved')

    def test_e_approve_passes_when_legacy_ev_step_exists(self):
        """이 배포 이전에 되감겨 EV step 이 살아남은 문서는 reviewer_loginids 없이도 통과한다."""
        doc = self._advance_to_parallel(plel=True)
        self.client.force_authenticate(user=self.e_owner)
        self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': 'E'}, format='json')
        e_step = ApprovalStep.objects.get(document=doc, agent='E', round=1)
        # ORM으로 구 동작(EV step 이 되감겨도 살아남는) 상태를 재현한다.
        ApprovalStep.objects.create(
            document=doc, agent='EV', round=1, action='pending', assignee=self.e_reviewer,
        )

        r = self.client.post(
            f'/api/documents/{doc.id}/approve-step/',
            {'agent': 'E', 'comment': ''}, format='json',
        )
        self.assertEqual(r.status_code, 200, r.content)
        e_step.refresh_from_db()
        self.assertEqual(e_step.action, 'approved')

    def test_legacy_e_approved_without_reviewer_still_completes(self):
        """E 가 이미 검토자 없이 approved 된 기존 문서는 남은 합의만으로 최종 승인까지 간다.

        최종 승인 여부는 J/O/E/EV/RA 합의가 들어올 때마다 그 시점 상태로 재계산되므로
        (별도 시그널이 없다), E 는 마지막 합의(O) 이전에 ORM으로 미리 approved 처리해 둔다.
        """
        doc = self._advance_to_parallel(plel=True)

        self.client.force_authenticate(user=self.p_owner)
        self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': 'P'}, format='json')
        self.client.post(f'/api/documents/{doc.id}/approve-step/', {'agent': 'P', 'comment': ''}, format='json')

        # E 는 ORM으로 직접 승인 처리 — 배포 이전에 검토자 없이 합의를 마친 기존 문서를 재현한다.
        e_step = ApprovalStep.objects.get(document=doc, agent='E', round=1)
        e_step.action = 'approved'
        e_step.assignee = self.e_owner
        e_step.save()

        self.client.force_authenticate(user=self.j_user)
        self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': 'J'}, format='json')
        self.client.post(f'/api/documents/{doc.id}/approve-step/', {'agent': 'J', 'comment': ''}, format='json')
        self.client.force_authenticate(user=self.o_user)
        self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': 'O'}, format='json')
        self.client.post(f'/api/documents/{doc.id}/approve-step/', {'agent': 'O', 'comment': ''}, format='json')

        doc.refresh_from_db()
        self.assertEqual(doc.status, 'approved', '검토자 없이 approved 된 기존 E 단계도 최종 승인을 막지 않아야 한다')

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
            {'agent': 'E', 'comment': '', 'reviewer_loginids': [self.e_reviewer.loginid]}, format='json',
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
            {'agent': 'E', 'comment': '수정 확인했습니다',
             'reviewer_loginids': [self.e_reviewer.loginid]}, format='json',
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

    def test_update_blocked_after_e_stage_complete(self):
        """E 담당자 합의만으로는 수정 창이 닫히지 않고, EV 1명이 합의하면 닫힌다.

        _stage_reviewers_complete 가 EV 를 OR 로 판정하므로(2026-08-06) 게이트도
        '검토자 중 1명이 합의한 시점' 에 닫힌다.
        """
        doc = self._advance_to_parallel(plel=True)
        self._set_detail(doc, {'validation_system': 'NO'})
        self.assertEqual(
            self._approve_e(doc, reviewers=[self.e_reviewer.loginid, self.e_reviewer2.loginid]).status_code, 200
        )

        # 담당자만 합의한 상태 — 검토자가 아직 아무도 판단하지 않았으므로 창은 열려 있다.
        self.client.force_authenticate(user=self.requester)
        r = self.client.post(f'/api/documents/{doc.id}/validation-system/', {'value': 'YES'}, format='json')
        self.assertEqual(r.status_code, 200, r.content)

        # 검토자 1명이 합의하면 MASK 검증이 끝난 것이므로 창이 닫힌다.
        self.client.force_authenticate(user=self.e_reviewer)
        r = self.client.post(f'/api/documents/{doc.id}/approve-step/', {'agent': 'EV', 'comment': ''}, format='json')
        self.assertEqual(r.status_code, 200, r.content)

        self.client.force_authenticate(user=self.requester)
        r = self.client.post(f'/api/documents/{doc.id}/validation-system/', {'value': 'NO'}, format='json')
        self.assertEqual(r.status_code, 400, r.content)
        self.assertEqual(self._get_detail(doc)['validation_system'], 'YES')

    # ----- EV(2차 검토자) OR 합의 + 남은 검토자 skip 마감 -----

    def _approve_j_o(self, doc):
        """J·O 를 합의 처리해 최종 승인 판정이 E/EV 만 남도록 만든다."""
        self.client.force_authenticate(user=self.p_owner)
        self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': 'P'}, format='json')
        self.client.post(f'/api/documents/{doc.id}/approve-step/', {'agent': 'P', 'comment': ''}, format='json')
        self.client.force_authenticate(user=self.j_user)
        self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': 'J'}, format='json')
        self.client.post(f'/api/documents/{doc.id}/approve-step/', {'agent': 'J', 'comment': ''}, format='json')
        self.client.force_authenticate(user=self.o_user)
        self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': 'O'}, format='json')
        self.client.post(f'/api/documents/{doc.id}/approve-step/', {'agent': 'O', 'comment': ''}, format='json')

    def test_ev_single_approval_completes_e_stage(self):
        """EV 2명 중 1명만 합의해도 E 단계가 끝나 문서가 최종 승인된다(OR)."""
        doc = self._advance_to_parallel(plel=True)
        self._approve_j_o(doc)
        self.assertEqual(
            self._approve_e(doc, reviewers=[self.e_reviewer.loginid, self.e_reviewer2.loginid]).status_code, 200
        )
        doc.refresh_from_db()
        self.assertEqual(doc.status, 'under_review', '검토자가 아무도 합의하지 않았으면 아직 아니다')

        self.client.force_authenticate(user=self.e_reviewer)
        r = self.client.post(f'/api/documents/{doc.id}/approve-step/', {'agent': 'EV', 'comment': ''}, format='json')
        self.assertEqual(r.status_code, 200, r.content)

        doc.refresh_from_db()
        self.assertEqual(doc.status, 'approved', '검토자 1명 합의로 E 단계가 완료된다')

    def test_ev_remaining_steps_are_skipped(self):
        """EV 1명이 합의하면 같은 회차의 남은 EV step 은 skip 으로 닫힌다."""
        doc = self._advance_to_parallel(plel=True)
        self.assertEqual(
            self._approve_e(doc, reviewers=[self.e_reviewer.loginid, self.e_reviewer2.loginid]).status_code, 200
        )

        self.client.force_authenticate(user=self.e_reviewer)
        r = self.client.post(f'/api/documents/{doc.id}/approve-step/', {'agent': 'EV', 'comment': ''}, format='json')
        self.assertEqual(r.status_code, 200, r.content)

        skipped = ApprovalStep.objects.get(
            document=doc, agent='EV', round=1, assignee__loginid=self.e_reviewer2.loginid
        )
        self.assertEqual(skipped.action, 'skip', 'pending 으로 두면 결재 경로에 검토중으로 영구 표시된다')
        self.assertIsNotNone(skipped.acted_at, '마감 시각이 있어야 이력으로 읽힌다')
        self.assertEqual(
            ApprovalStep.objects.get(
                document=doc, agent='EV', round=1, assignee__loginid=self.e_reviewer.loginid
            ).action,
            'approved',
            '합의한 검토자는 그대로 approved 다',
        )

    def test_ev_skip_is_not_applied_to_pv(self):
        """P 검토자(PV)는 여전히 AND — 1명 합의로는 완료되지 않고 나머지도 pending 이다."""
        doc = self._advance_to_parallel(plel=True)
        self.client.force_authenticate(user=self.p_owner)
        self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': 'P'}, format='json')
        r = self.client.post(f'/api/documents/{doc.id}/approve-step/', {
            'agent': 'P', 'comment': '',
            'reviewer_loginids': [self.p_reviewer.loginid, self.p_outsider.loginid],
        }, format='json')
        self.assertEqual(r.status_code, 200, r.content)

        self.client.force_authenticate(user=self.p_reviewer)
        r = self.client.post(f'/api/documents/{doc.id}/approve-step/', {'agent': 'PV', 'comment': ''}, format='json')
        self.assertEqual(r.status_code, 200, r.content)

        self.assertFalse(
            ApprovalStep.objects.filter(document=doc, agent='J', round=1).exists(),
            'PV 가 OR 로 새어 나가면 검토자 1명 합의로 J 가 생성된다',
        )
        self.assertEqual(
            ApprovalStep.objects.get(
                document=doc, agent='PV', round=1, assignee__loginid=self.p_outsider.loginid
            ).action,
            'pending',
            'PV 는 skip 마감 대상이 아니다',
        )

    def test_stage_reviewers_complete_with_no_reviewers_is_true(self):
        """검토자가 0명이면 담당자 합의만으로 완료다(하위호환 가드).

        이 가드를 빼면 any() 가 False 를 돌려줘, 검토자 없이 E 합의를 마친 레거시
        문서가 영구 잠긴다(검토자를 지정할 경로가 없다).
        """
        from .views import RequestDocumentViewSet

        doc = self._advance_to_parallel(plel=True)
        e_step = ApprovalStep.objects.get(document=doc, agent='E', round=1)
        e_step.action = 'approved'
        e_step.assignee = self.e_owner
        e_step.save()
        self.assertFalse(ApprovalStep.objects.filter(document=doc, agent='EV', round=1).exists())

        self.assertTrue(RequestDocumentViewSet()._stage_reviewers_complete(doc, 'E', 1))

    def test_validation_system_blocked_after_any_ev_approval(self):
        """EV 1명이 합의하면 그 시점에 값 수정 창이 닫힌다(400)."""
        doc = self._advance_to_parallel(plel=True)
        self._set_detail(doc, {'validation_system': 'NO'})
        self.assertEqual(
            self._approve_e(doc, reviewers=[self.e_reviewer.loginid, self.e_reviewer2.loginid]).status_code, 200
        )
        self.client.force_authenticate(user=self.e_reviewer)
        self.client.post(f'/api/documents/{doc.id}/approve-step/', {'agent': 'EV', 'comment': ''}, format='json')

        self.client.force_authenticate(user=self.requester)
        r = self.client.post(f'/api/documents/{doc.id}/validation-system/', {'value': 'YES'}, format='json')
        self.assertEqual(r.status_code, 400, r.content)
        self.assertEqual(r.data['error'], 'MASK 검토가 끝난 의뢰서는 변경할 수 없습니다.')

    def test_validation_system_change_preserves_ev_comment(self):
        """값 변경이 EV 의 수정 요청 이력을 지우지 않는다(구 되감기 F1 회귀).

        되감기는 EV step 을 통째로 지워, 그 검토자가 남긴 수정 요청이 사라졌다.
        """
        doc = self._advance_to_parallel(plel=True)
        self._set_detail(doc, {'validation_system': 'NO'})
        self.assertEqual(self._approve_e(doc, reviewers=[self.e_reviewer.loginid]).status_code, 200)

        self.client.force_authenticate(user=self.e_reviewer)
        r = self.client.post(
            f'/api/documents/{doc.id}/reject-step/',
            {'agent': 'EV', 'comment': '레이어 확인 필요'}, format='json',
        )
        self.assertEqual(r.status_code, 200, r.content)

        self.client.force_authenticate(user=self.requester)
        r = self.client.post(f'/api/documents/{doc.id}/validation-system/', {'value': 'YES'}, format='json')
        self.assertEqual(r.status_code, 200, r.content)

        ev_step = ApprovalStep.objects.get(document=doc, agent='EV', round=1)
        self.assertIn('레이어 확인 필요', ev_step.comment, '검토자의 수정 요청 이력이 사라져서는 안 된다')

    def test_pause_target_ev_survives_validation_system_change(self):
        """pause 대상 EV step 이 값 변경 후에도 남아 있다(구 되감기 F2 회귀).

        되감기가 이 step 을 지우면 확인할 단계가 사라져 중단 요청이 영원히 확정되지 않는다.
        """
        from .models import PauseRequest

        doc = self._advance_to_parallel(plel=True)
        self._set_detail(doc, {'validation_system': 'NO'})
        self.assertEqual(self._approve_e(doc, reviewers=[self.e_reviewer.loginid]).status_code, 200)
        ev_step = ApprovalStep.objects.get(document=doc, agent='EV', round=1)

        pause = PauseRequest.objects.create(
            document=doc, requester=self.requester, requester_name='요청자',
            reason='수정 필요', round=1, state='requested', target_step_ids=[ev_step.id],
        )

        self.client.force_authenticate(user=self.requester)
        r = self.client.post(f'/api/documents/{doc.id}/validation-system/', {'value': 'YES'}, format='json')
        self.assertEqual(r.status_code, 200, r.content)

        self.assertTrue(
            ApprovalStep.objects.filter(id__in=pause.target_step_ids).exists(),
            '중단 확인 대상 step 이 사라지면 문서가 고착된다',
        )

    # ----- MASK 는 반려하지 않고 '수정 요청'만 한다 -----

    def test_e_reject_becomes_revision_request(self):
        """E 반려는 결재를 되돌리지 않고 상신자에게 수정 요청 메일만 보낸다."""
        doc = self._advance_to_parallel(plel=True)
        self.client.force_authenticate(user=self.e_owner)
        self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': 'E'}, format='json')
        r = self.client.post(
            f'/api/documents/{doc.id}/reject-step/',
            {'agent': 'E', 'comment': '대상으로 보입니다'}, format='json',
        )
        self.assertEqual(r.status_code, 200, r.content)

        doc.refresh_from_db()
        self.assertEqual(doc.status, 'under_review', '수정 요청은 문서를 반려 상태로 만들지 않는다')
        e_step = ApprovalStep.objects.get(document=doc, agent='E', round=1)
        self.assertEqual(e_step.action, 'pending', '단계도 대기 그대로다')
        self.assertIn('수정 요청', e_step.comment)
        self.assertFalse(
            ApprovalStep.objects.filter(document=doc, round=2).exists(),
            '새 회차를 만들지 않는다',
        )
        self.assertTrue(
            MailNotification.objects.filter(document=doc, event_type='revision_requested').exists(),
            '상신자에게 수정 요청 메일이 적재되어야 한다',
        )

    def test_non_mask_reject_still_rejects_document(self):
        """E/EV 가 아닌 단계의 반려는 기존대로 문서를 반려 처리한다(회귀 방지)."""
        doc = self._advance_to_parallel(plel=True)
        self.client.force_authenticate(user=self.o_user)
        self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': 'O'}, format='json')
        r = self.client.post(
            f'/api/documents/{doc.id}/reject-step/', {'agent': 'O', 'comment': 'x'}, format='json',
        )
        self.assertEqual(r.status_code, 200, r.content)
        doc.refresh_from_db()
        self.assertEqual(doc.status, 'rejected')


@override_settings(POST_APPROVER_LOGINID='fixedpa')
class MapDeleteEditRouteTest(TestCase):
    """'MAP 삭제/수정' 전용 결재 경로 — PL 합의 후 P·R·J·O 병렬, E·RA 미생성.

    기존 일반 경로/Only MAP 경로는 건드리지 않고 새 분기만 탄다는 것을 함께 확인한다.
    """

    def setUp(self):
        import json
        from rest_framework.test import APIClient
        self._json = json
        self.client = APIClient()
        self.requester = UserProfile.objects.create(loginid='mreq', mail='mreq@c.com', role='NONE')
        self.pl_user = UserProfile.objects.create(loginid='mpl', mail='mpl@c.com', role='PL')
        self.r_user = UserProfile.objects.create(loginid='mr', mail='mr@c.com', role='TE_R')
        self.p_user = UserProfile.objects.create(loginid='mp', mail='mp@c.com', role='TE_P')
        self.p_reviewer = UserProfile.objects.create(loginid='mp2', mail='mp2@c.com', role='TE_P')
        self.j_user = UserProfile.objects.create(loginid='mj', mail='mj@c.com', role='TE_J')
        self.o_user = UserProfile.objects.create(loginid='mo', mail='mo@c.com', role='TE_O')
        UserProfile.objects.create(loginid='fixedpa', mail='fpa@c.com', role='TE_R')

    def _make_doc(self, purpose=None, detail_extra=None, jayer_rows=None):
        detail = {'request_purpose': purpose or RequestDocument.MAP_DELETE_EDIT_PURPOSE}
        detail.update(detail_extra or {})
        return RequestDocument.objects.create(
            title='mde', requester=self.requester, requester_name='요청자',
            requester_email='mreq@c.com', requester_department='dept',
            product_name='PROD-1', status='draft',
            additional_notes=self._json.dumps({'detail': detail, 'jayerRows': jayer_rows or []}),
        )

    def _submit_and_pl_approve(self, doc):
        self.client.force_authenticate(user=self.requester)
        r = self.client.post(f'/api/documents/{doc.id}/submit/',
                             {'designated_pl_loginid': self.pl_user.loginid}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        self.client.force_authenticate(user=self.pl_user)
        r = self.client.post(f'/api/documents/{doc.id}/peer-approve/', {}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        doc.refresh_from_db()
        return doc

    def _assign_and_approve(self, doc, agent, user):
        """R 은 assign-step(지정하기), P/J/O 는 claim-step(검토중 선점) 방식이다 — 실제 API 규칙과 동일."""
        self.client.force_authenticate(user=user)
        if agent == 'R':
            r = self.client.post(f'/api/documents/{doc.id}/assign-step/', {
                'agent': agent, 'assignee_loginid': user.loginid, 'assignee_name': user.loginid,
            }, format='json')
        else:
            r = self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': agent}, format='json')
        self.assertIn(r.status_code, (200, 400), r.content)
        r = self.client.post(f'/api/documents/{doc.id}/approve-step/',
                             {'agent': agent, 'comment': ''}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        doc.refresh_from_db()
        return r

    def test_pl_approval_creates_four_parallel_steps(self):
        """PL 합의 직후 P·R·J·O 가 한꺼번에 병렬로 생성된다(J 가 P 를 기다리지 않는다)."""
        doc = self._submit_and_pl_approve(self._make_doc())
        agents = set(ApprovalStep.objects.filter(document=doc, round=1)
                     .exclude(agent='PL').values_list('agent', flat=True))
        self.assertEqual(agents, {'P', 'R', 'J', 'O'}, f'실제 생성된 단계: {agents}')
        for a in ('P', 'R', 'J', 'O'):
            st = ApprovalStep.objects.get(document=doc, agent=a, round=1)
            self.assertTrue(st.is_parallel, f'{a} 는 병렬 단계여야 한다')

    def test_no_e_and_no_post_approver_steps(self):
        """E(MASK)와 후결자(RA)는 생성하지 않는다 — 고정 후결자도 붙지 않는다."""
        doc = self._submit_and_pl_approve(self._make_doc(jayer_rows=[{'pp': 'PLEL'}]))
        self.assertFalse(ApprovalStep.objects.filter(document=doc, agent='E', round=1).exists(),
                         'plel 이 있어도 MAP 삭제/수정 경로에는 E 를 만들지 않는다')
        self.assertFalse(ApprovalStep.objects.filter(document=doc, agent='RA', round=1).exists(),
                         '고정 후결자가 설정돼 있어도 RA 를 만들지 않는다')

    def test_approved_when_p_is_last(self):
        """P 가 마지막 합의자여도 최종 승인된다(일반 경로는 P 로 승인 판정을 하지 않는다)."""
        doc = self._submit_and_pl_approve(self._make_doc())
        for agent, user in (('R', self.r_user), ('J', self.j_user), ('O', self.o_user)):
            self._assign_and_approve(doc, agent, user)
        self.assertEqual(doc.status, 'under_review', '아직 P 가 남아 승인되면 안 된다')
        self._assign_and_approve(doc, 'P', self.p_user)
        self.assertEqual(doc.status, 'approved', 'P 합의로 네 단계가 모두 끝나면 승인돼야 한다')

    def test_approved_when_r_is_last(self):
        """R 이 마지막 합의자여도 최종 승인된다(R 은 관문이 아니라 병렬 구성원이다)."""
        doc = self._submit_and_pl_approve(self._make_doc())
        for agent, user in (('P', self.p_user), ('J', self.j_user), ('O', self.o_user)):
            self._assign_and_approve(doc, agent, user)
        self.assertEqual(doc.status, 'under_review', '아직 R 이 남아 승인되면 안 된다')
        self._assign_and_approve(doc, 'R', self.r_user)
        self.assertEqual(doc.status, 'approved', 'R 합의로 네 단계가 모두 끝나면 승인돼야 한다')

    def test_p_reviewer_blocks_final_approval(self):
        """P 검토자(PV)가 지정돼 있으면 그 합의까지 끝나야 승인된다(검토자 기능 유지)."""
        doc = self._submit_and_pl_approve(self._make_doc())
        for agent, user in (('R', self.r_user), ('J', self.j_user), ('O', self.o_user)):
            self._assign_and_approve(doc, agent, user)
        self.client.force_authenticate(user=self.p_user)
        r = self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': 'P'}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        # P 는 담당자 본인이 합의와 동시에 reviewer_loginids 로 검토자(PV, 다중)를 지정한다.
        r = self.client.post(f'/api/documents/{doc.id}/approve-step/', {
            'agent': 'P', 'comment': '', 'reviewer_loginids': [self.p_reviewer.loginid],
        }, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        doc.refresh_from_db()
        self.assertEqual(doc.status, 'under_review', 'PV 가 남아 있으면 아직 승인되면 안 된다')

        self.client.force_authenticate(user=self.p_reviewer)
        r = self.client.post(f'/api/documents/{doc.id}/approve-step/',
                             {'agent': 'PV', 'comment': ''}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        doc.refresh_from_db()
        self.assertEqual(doc.status, 'approved', 'PV 합의로 P 단계가 끝나면 승인돼야 한다')

    def test_route_agents_exclude_e_and_ra(self):
        """메일 경로 카드·반려 수신자용 결재선에 E/EV/RA 가 포함되지 않는다."""
        from api import mailer
        doc = self._make_doc()
        self.assertEqual(mailer.route_agents_for(doc), mailer.ROUTE_AGENTS_MAP_DELETE_EDIT)
        self.assertNotIn('RA', mailer.route_agents_for(doc))
        self.assertNotIn('E', mailer.route_agents_for(doc))
        # 기존 두 경로는 그대로여야 한다.
        only_map = self._make_doc(purpose=RequestDocument.ONLY_MAP_PURPOSE)
        self.assertEqual(mailer.route_agents_for(only_map), mailer.ROUTE_AGENTS_ONLY_MAP)
        normal = self._make_doc(purpose='신규')
        self.assertEqual(mailer.route_agents_for(normal), mailer.ROUTE_AGENTS_DEFAULT)

    def test_normal_purpose_still_uses_gate_route(self):
        """일반 목적은 기존대로 PL 합의 시 R 만 생성된다(회귀 방지)."""
        doc = self._submit_and_pl_approve(self._make_doc(purpose='신규'))
        agents = set(ApprovalStep.objects.filter(document=doc, round=1)
                     .exclude(agent='PL').values_list('agent', flat=True))
        self.assertEqual(agents, {'R'}, f'일반 목적은 R 만 생겨야 한다. 실제: {agents}')


class LabProductPostApproverTest(TestCase):
    """'연구소 제품' 도 C가문과 동일하게 상신 시 후결자 지정이 필수다."""

    def setUp(self):
        import json
        from rest_framework.test import APIClient
        self._json = json
        self.client = APIClient()
        self.requester = UserProfile.objects.create(loginid='lreq', mail='lreq@c.com', role='NONE')
        self.pl_user = UserProfile.objects.create(loginid='lpl', mail='lpl@c.com', role='PL')
        self.r_user = UserProfile.objects.create(loginid='lr1', mail='lr1@c.com', role='TE_R')

    def _doc(self, detail):
        return RequestDocument.objects.create(
            title='lab', requester=self.requester, requester_name='요청자',
            requester_email='lreq@c.com', requester_department='dept',
            product_name='PROD-1', status='draft',
            additional_notes=self._json.dumps({'detail': detail, 'jayerRows': []}),
        )

    def _submit(self, doc):
        self.client.force_authenticate(user=self.requester)
        return self.client.post(f'/api/documents/{doc.id}/submit/',
                                {'designated_pl_loginid': self.pl_user.loginid}, format='json')

    def test_lab_product_requires_post_approver(self):
        doc = self._doc({'request_purpose': RequestDocument.ONLY_MAP_PURPOSE,
                         'other_purpose': [RequestDocument.OTHER_PURPOSE_LAB],
                         'post_approvers': []})
        self.assertTrue(doc.requires_post_approver())
        r = self._submit(doc)
        self.assertEqual(r.status_code, 400, r.content)

    def test_lab_product_with_post_approver_passes(self):
        doc = self._doc({'request_purpose': RequestDocument.ONLY_MAP_PURPOSE,
                         'other_purpose': [RequestDocument.OTHER_PURPOSE_LAB],
                         'post_approvers': [{'loginid': 'lpl', 'name': 'lpl'}]})
        r = self._submit(doc)
        self.assertEqual(r.status_code, 200, r.content)

    def test_cfamily_still_requires_post_approver(self):
        """기존 C가문 규칙은 그대로다(회귀 방지)."""
        doc = self._doc({'request_purpose': '신규', 'only_prodc': 'Yes', 'post_approvers': []})
        self.assertTrue(doc.requires_post_approver())
        self.assertEqual(self._submit(doc).status_code, 400)

    @override_settings(POST_APPROVER_LOGINID='labfixedpa')
    def test_lab_product_last_additional_post_approver_cannot_be_removed(self):
        """상신 시 강제한 '후결자 최소 1명'을 결재 진행 중 remove-post-approver 로

        무력화할 수 없어야 한다 — only_prodc 만 보던 예전 가드는 연구소 제품을
        놓쳐 마지막 1명까지 제거가 허용됐었다(재현·수정 확인)."""
        UserProfile.objects.create(loginid='labfixedpa', mail='lfpa@c.com', role='TE_R')
        doc = self._doc({'request_purpose': RequestDocument.ONLY_MAP_PURPOSE,
                         'other_purpose': [RequestDocument.OTHER_PURPOSE_LAB],
                         'post_approvers': [{'loginid': 'lpl', 'name': 'lpl'}]})
        r = self._submit(doc)
        self.assertEqual(r.status_code, 200, r.content)

        # PL 합의 → R 지정·합의까지 실제로 거쳐야 RA(후결자, 고정+lpl) 단계가 생성된다.
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
        self.assertTrue(
            ApprovalStep.objects.filter(document=doc, agent='RA', assignee__loginid='lpl').exists(),
            '사전 조건: lpl 이 추가 후결자로 등록돼 있어야 한다',
        )

        self.client.force_authenticate(user=self.requester)
        r = self.client.post(f'/api/documents/{doc.id}/remove-post-approver/',
                             {'loginid': 'lpl'}, format='json')
        self.assertEqual(r.status_code, 400, r.content)
        self.assertIn('연구소 제품', r.json().get('error', ''))

    def test_plain_document_does_not_require(self):
        doc = self._doc({'request_purpose': '신규', 'other_purpose': ['FirstA 변경']})
        self.assertFalse(doc.requires_post_approver())
        self.assertEqual(self._submit(doc).status_code, 200)


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
        self.assertEqual(noti.subject, f'[{self.extra_pl1.loginid}님] [결재 요청] {doc.title}')

    def test_initial_ra_subjects_differ_between_fixed_and_additional(self):
        doc = self._advance_to_parallel(only_prodc=True, post_approvers=[
            {'loginid': self.extra_pl1.loginid, 'name': self.extra_pl1.loginid},
        ])
        notis = {
            tuple(n.recipients)[0]: n.subject
            for n in MailNotification.objects.filter(document=doc, event_type='stage_arrival')
            if n.recipients
        }
        self.assertEqual(notis[self.fixed_pa.mail], f'[후결 요청] {doc.title}')
        self.assertEqual(notis[self.extra_pl1.mail], f'[{self.extra_pl1.loginid}님] [결재 요청] {doc.title}')

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
    - 그 외(draft/under_review/rejected/pause) : 의뢰자 / 지정 PL / MASTER
      (공유 그룹 멤버는 수정·상신은 되어도 삭제는 불가 — 2026-08 정책)
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

        self.group = UserGroup.objects.create(name='del_team', creator=self.author)
        self.group.members.add(self.author, self.member)

    def _doc(self, status='under_review', requester=None, designated_pl=None):
        return RequestDocument.objects.create(
            title=f'del-{status}',
            requester=self.author if requester is None else requester,
            requester_name='작성자', requester_email='a@c.com', requester_department='d',
            product_name='p', status=status, designated_pl=designated_pl,
            shared_group=self.group,
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

    def test_shared_group_member_cannot_delete(self):
        """공유 그룹 멤버는 수정·상신은 되어도 삭제는 불가(2026-08 정책)."""
        doc = self._doc()
        res = self._post_delete(self.member, doc)
        self.assertEqual(res.status_code, 403, res.content)
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


@override_settings(AUTH_MODE='sso')
class SharedGroupDraftTest(TestCase):
    """임시저장 공유 그룹(RequestDocument.shared_group).

    - 공유 대상은 작성자가 고른 그룹 **1개**. 미지정이면 작성자 본인·MASTER 만 접근.
    - 공유 그룹 멤버: 수정 / 임시저장 / 상신 가능, 삭제·공유대상 변경 불가.
    - 그룹원이 수정·상신해도 의뢰자는 최초 작성자로 유지된다.
    """

    def setUp(self):
        from rest_framework.test import APIClient
        import json
        self._json = json
        self.client = APIClient()

        self.author = UserProfile.objects.create(
            loginid='sg_author', username='작성자A', mail='a@c.com',
            deptname='개발팀', role='PL',
        )
        self.member = UserProfile.objects.create(
            loginid='sg_member', username='그룹원B', mail='m@c.com',
            deptname='품질팀', role='PL',
        )
        self.other_member = UserProfile.objects.create(loginid='sg_other', mail='ot@c.com', role='PL')
        self.outsider = UserProfile.objects.create(loginid='sg_out', mail='o@c.com', role='PL')
        self.master = UserProfile.objects.create(loginid='sg_master', mail='ms@c.com', role='MASTER')
        self.pl = UserProfile.objects.create(loginid='sg_pl', mail='pl@c.com', role='PL')

        self.group = UserGroup.objects.create(name='공유팀', creator=self.author)
        self.group.members.add(self.author, self.member)
        # 작성자가 속한 다른 그룹 — 이 문서의 공유 대상은 아니다.
        self.other_group = UserGroup.objects.create(name='다른팀', creator=self.author)
        self.other_group.members.add(self.author, self.other_member)
        # 작성자가 속하지 않은 남의 그룹
        self.foreign_group = UserGroup.objects.create(name='남의팀', creator=self.outsider)
        self.foreign_group.members.add(self.outsider)

    def _draft(self, shared_group=None, status='draft'):
        return RequestDocument.objects.create(
            title='공유 대상 의뢰서', requester=self.author, requester_name='작성자A',
            requester_email='a@c.com', requester_department='개발팀', product_name='PROD-1',
            status=status, shared_group=shared_group,
            additional_notes=self._json.dumps({'detail': {}, 'jayerRows': []}),
        )

    # ----- 공유 그룹 지정 액션 -----
    def test_author_can_set_and_clear_shared_group(self):
        doc = self._draft()
        self.client.force_authenticate(user=self.author)
        r = self.client.post(f'/api/documents/{doc.id}/set-shared-group/',
                             {'group_id': self.group.id}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        doc.refresh_from_db()
        self.assertEqual(doc.shared_group_id, self.group.id)
        self.assertEqual(r.json()['document']['shared_group_name'], '공유팀')

        r = self.client.post(f'/api/documents/{doc.id}/set-shared-group/',
                             {'group_id': None}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        doc.refresh_from_db()
        self.assertIsNone(doc.shared_group_id)

    def test_cannot_share_to_group_i_am_not_member_of(self):
        doc = self._draft()
        self.client.force_authenticate(user=self.author)
        r = self.client.post(f'/api/documents/{doc.id}/set-shared-group/',
                             {'group_id': self.foreign_group.id}, format='json')
        self.assertEqual(r.status_code, 400, r.content)
        doc.refresh_from_db()
        self.assertIsNone(doc.shared_group_id)

    def test_shared_group_member_cannot_change_shared_group(self):
        """멤버는 문서를 수정할 수는 있어도 공유 범위는 바꾸지 못한다."""
        doc = self._draft(self.group)
        self.client.force_authenticate(user=self.member)
        r = self.client.post(f'/api/documents/{doc.id}/set-shared-group/',
                             {'group_id': None}, format='json')
        self.assertEqual(r.status_code, 403, r.content)
        doc.refresh_from_db()
        self.assertEqual(doc.shared_group_id, self.group.id)

    def test_shared_group_is_read_only_on_patch(self):
        """전체 저장(PATCH)에는 shared_group 이 딸려가지 않는다(초기화 방지)."""
        doc = self._draft(self.group)
        self.client.force_authenticate(user=self.author)
        r = self.client.patch(f'/api/documents/{doc.id}/',
                              {'shared_group': None, 'title': '제목변경'}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        doc.refresh_from_db()
        self.assertEqual(doc.shared_group_id, self.group.id)

    # ----- 수정 / 상신 인가 -----
    def test_shared_group_member_can_edit_draft(self):
        doc = self._draft(self.group)
        self.client.force_authenticate(user=self.member)
        r = self.client.patch(f'/api/documents/{doc.id}/', {'title': 'B가 수정'}, format='json')
        self.assertEqual(r.status_code, 200, r.content)

    def test_non_shared_group_member_cannot_edit_draft(self):
        """작성자와 다른 그룹을 공유할 뿐인 사용자는 수정할 수 없다.

        조회 스코프(get_queryset)에서 이미 빠지므로 403 이 아니라 404 다
        — 문서의 존재 자체를 노출하지 않는 편이 낫다.
        """
        doc = self._draft(self.group)
        self.client.force_authenticate(user=self.other_member)
        r = self.client.patch(f'/api/documents/{doc.id}/', {'title': 'x'}, format='json')
        self.assertEqual(r.status_code, 404, r.content)
        doc.refresh_from_db()
        self.assertEqual(doc.title, '공유 대상 의뢰서')

    def test_unshared_draft_cannot_be_edited_by_group_member(self):
        doc = self._draft(None)
        self.client.force_authenticate(user=self.member)
        r = self.client.patch(f'/api/documents/{doc.id}/', {'title': 'x'}, format='json')
        self.assertEqual(r.status_code, 404, r.content)
        doc.refresh_from_db()
        self.assertEqual(doc.title, '공유 대상 의뢰서')

    def test_shared_group_member_can_submit(self):
        doc = self._draft(self.group)
        self.client.force_authenticate(user=self.member)
        r = self.client.post(f'/api/documents/{doc.id}/submit/',
                             {'designated_pl_loginids': [self.pl.loginid]}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        doc.refresh_from_db()
        self.assertEqual(doc.status, 'under_review')

    def test_outsider_cannot_submit_unshared_draft(self):
        """조회 스코프를 통과하더라도(MASTER 아님) 상신은 인가로 막힌다."""
        doc = self._draft(None)
        self.client.force_authenticate(user=self.outsider)
        r = self.client.post(f'/api/documents/{doc.id}/submit/',
                             {'designated_pl_loginids': [self.pl.loginid]}, format='json')
        self.assertIn(r.status_code, (403, 404), r.content)
        doc.refresh_from_db()
        self.assertEqual(doc.status, 'draft')

    # ----- 의뢰자 고정 -----
    def test_requester_unchanged_when_group_member_edits_and_submits(self):
        """B(그룹원)가 A의 임시저장을 수정·상신해도 의뢰자는 A로 남는다."""
        doc = self._draft(self.group)
        self.client.force_authenticate(user=self.member)

        r = self.client.patch(f'/api/documents/{doc.id}/', {
            'title': 'B가 이어서 작성',
            'requester_name': '그룹원B',
            'requester_email': 'm@c.com',
            'requester_department': '품질팀',
        }, format='json')
        self.assertEqual(r.status_code, 200, r.content)

        r = self.client.post(f'/api/documents/{doc.id}/submit/',
                             {'designated_pl_loginids': [self.pl.loginid]}, format='json')
        self.assertEqual(r.status_code, 200, r.content)

        doc.refresh_from_db()
        self.assertEqual(doc.requester_id, self.author.id)
        self.assertEqual(doc.requester_name, '작성자A')
        self.assertEqual(doc.requester_email, 'a@c.com')
        self.assertEqual(doc.requester_department, '개발팀')

    def test_requester_unchanged_on_resubmit_by_group_member(self):
        doc = self._draft(self.group, status='rejected')
        self.client.force_authenticate(user=self.member)
        r = self.client.patch(f'/api/documents/{doc.id}/',
                              {'requester_name': '그룹원B'}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        r = self.client.post(f'/api/documents/{doc.id}/resubmit/',
                             {'designated_pl_loginids': [self.pl.loginid]}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        doc.refresh_from_db()
        self.assertEqual(doc.requester_id, self.author.id)
        self.assertEqual(doc.requester_name, '작성자A')
