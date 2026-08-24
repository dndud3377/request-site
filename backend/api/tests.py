"""결재 알림 메일(mailer) 단위 테스트

외부 DXHUB API 호출은 모두 mock 처리한다.
"""
from unittest.mock import patch

from django.test import TestCase, override_settings
from django.utils import timezone

from . import mailer
from . import design_rule_stats
from .models import (
    ApprovalStep, DocumentReviewItem, DocumentReviewItemReviewer, MailNotification,
    Line, PauseRequest, RejectionSnapshot, RequestDocument, ReviewItemMaster, UserGroup,
    UserProfile, WithdrawRequest,
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

    def test_j_unassigned_broadcasts_to_whole_team(self):
        """(2026-08) 미배정 J 는 고정 주소가 아니라 TE_J 팀 전원에게 간다(R/P 와 동일 규칙).

        J 가 R 합의 시점의 독립 병렬 단계가 되면서 팀원 누구나 선점·합의하게 됐는데, 대표
        주소 1곳으로만 보내면 팀원 개개인이 자기 차례를 알 수 없다.
        """
        UserProfile.objects.create(loginid='j1', mail='j1@company.com', role='TE_J')
        UserProfile.objects.create(loginid='j2', mail='j2@company.com', role='TE_J')
        step = ApprovalStep.objects.create(document=self.doc, agent='J')
        self.assertEqual(
            sorted(mailer.resolve_stage_recipients(self.doc, 'J', step)),
            ['j1@company.com', 'j2@company.com'],
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
        UserProfile.objects.create(loginid='j1', mail='j1@company.com', role='TE_J')
        step = ApprovalStep.objects.create(document=self.doc, agent='J')
        noti = mailer.enqueue_stage_arrival(self.doc, 'J', step)
        self.assertIsNotNone(noti)
        self.assertEqual(noti.status, 'pending')
        self.assertEqual(noti.recipients, ['j1@company.com'])

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
        # (2026-08) plel 이 아니면 E 는 거치지 않지만, 행 자체는 남기고 '해당없음'으로 표시한다
        # — 웹 결재현황 그리드와 같은 규칙. 예전에는 행을 아예 만들지 않아 왜 없는지 알 수 없었다.
        self.assertEqual(by_label['E'], 'na')

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
        rows = mailer._route_rows(doc)
        by_label = {label: status for label, _n, status, _c in rows}
        # (2026-08) 거치지 않는 단계도 행은 남기고 '해당없음'으로 표시한다(웹 그리드와 동일).
        for excluded in ('P', 'J', 'O', 'E'):
            self.assertEqual(by_label[excluded], 'na')
        self.assertEqual(by_label['R'], 'waiting')

    @override_settings(POST_APPROVER_LOGINID='fixedpa')
    def test_post_approver_rows_split_fixed_and_extra(self):
        """후결자 행 라벨은 고정(R)과 추가후결자로 갈린다 — 웹 그리드의 두 칸과 같은 구분."""
        fixed = UserProfile.objects.create(loginid='fixedpa', mail='fix@c.com', role='TE_R')
        extra = UserProfile.objects.create(loginid='extrapa', mail='ext@c.com', role='PL')
        ApprovalStep.objects.create(document=self.doc, agent='RA', round=1, action='pending',
                                    assignee=fixed, assignee_name='정고정')
        ApprovalStep.objects.create(document=self.doc, agent='RA', round=1, action='pending',
                                    assignee=extra, assignee_name='이순신')

        by_name = {name: label for label, name, _s, _c in mailer._route_rows(self.doc)}
        self.assertEqual(by_name['정고정'], mailer.POST_APPROVER_FIXED_LABEL)
        self.assertEqual(by_name['이순신'], mailer.POST_APPROVER_EXTRA_LABEL)

    def test_map_delete_edit_marks_absent_stages_as_na(self):
        """MAP 삭제 은 E·후결자를 만들지 않는다 — 행을 지우지 않고 해당없음으로 남긴다."""
        import json
        doc = RequestDocument.objects.create(
            title='mde', requester=self.requester, requester_name='요청자',
            requester_email='req@c.com', requester_department='dept', product_name='PROD-1',
            additional_notes=json.dumps(
                {'detail': {'request_purpose': 'MAP 삭제'}, 'jayerRows': []}
            ),
        )
        ApprovalStep.objects.create(document=doc, agent='R', round=1, action='pending')
        by_label = {label: status for label, _n, status, _c in mailer._route_rows(doc)}
        self.assertEqual(by_label['E'], 'na')
        self.assertEqual(by_label['후결자'], 'na')
        # 이 경로에 실제로 있는 단계는 해당없음이 아니다
        self.assertEqual(by_label['P'], 'waiting')

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

    def test_disabled_row_excluded_even_when_unmapped(self):
        """2026-08: 비활성 행도 상신 시 저장에 남으므로, 매핑 없이도 통과해야 한다."""
        doc = self._make_doc_with_jayer([
            {'id': 'j1', 'process_id': 'P1', 'new_or_copy': '신규', 'disabled': True},
        ])
        self.assertIsNone(self._view._validate_bb_mapping(doc))


class HasPpidPlelTest(TestCase):
    """RequestDocument.has_ppid_plel — E(MASK) 단계 생성 판정 (2026-08부터 비활성 행도 저장되므로
    여기서 직접 걸러야 한다).
    """

    def setUp(self):
        import json
        self._json = json
        self.requester = UserProfile.objects.create(
            loginid='req2', mail='req2@company.com', role='NONE'
        )

    def _make_doc_with_jayer(self, jayer_rows):
        doc = _make_document(self.requester)
        doc.additional_notes = self._json.dumps({'jayerRows': jayer_rows})
        doc.save()
        return doc

    def test_active_plel_row_is_target(self):
        doc = self._make_doc_with_jayer([{'id': 'j1', 'pp': 'PLEL01', 'disabled': False}])
        self.assertTrue(doc.has_ppid_plel())

    def test_disabled_plel_row_is_not_target(self):
        doc = self._make_doc_with_jayer([{'id': 'j1', 'pp': 'PLEL01', 'disabled': True}])
        self.assertFalse(doc.has_ppid_plel())

    def test_disabled_plel_row_with_other_active_non_plel_row(self):
        doc = self._make_doc_with_jayer([
            {'id': 'j1', 'pp': 'PLEL01', 'disabled': True},
            {'id': 'j2', 'pp': 'NORMAL', 'disabled': False},
        ])
        self.assertFalse(doc.has_ppid_plel())


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

    def _advance_to_parallel(self, plel=False, other_purpose=None):
        """draft → 제출 → PL 합의 → R 지정·합의 를 실제 API로 거쳐 P/O[/E] pending 상태로 만든다."""
        inner = {} if other_purpose is None else {'other_purpose': other_purpose}
        detail = {'detail': inner, 'jayerRows': ([{'pp': 'PLEL'}] if plel else [])}
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

    def test_p_no_reviewers_completes_stage_immediately_backward_compat(self):
        """검토자를 지정하지 않으면 담당자 합의만으로 P 단계가 완료된다(하위호환).

        (2026-08) 완료 여부를 'J 생성'으로 확인하던 것을 완료 통보 적재로 바꿨다 —
        J 는 이제 R 합의 시점부터 병렬로 존재하므로 P 완료의 지표가 될 수 없다.
        """
        doc = self._advance_to_parallel()
        self.client.force_authenticate(user=self.p_owner)
        r = self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': 'P'}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        r = self.client.post(f'/api/documents/{doc.id}/approve-step/', {'agent': 'P', 'comment': ''}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(
            MailNotification.objects.filter(document=doc, event_type='notify_p_completed').exists()
        )

    def test_j_created_in_parallel_at_r_approval(self):
        """(2026-08) J 는 P 를 기다리지 않고 R 합의 시점에 O/E 와 함께 생성된다."""
        doc = self._advance_to_parallel()
        j_step = ApprovalStep.objects.filter(document=doc, agent='J', round=1).first()
        self.assertIsNotNone(j_step, 'J 는 R 합의 즉시 병렬 단계로 생성돼야 한다')
        self.assertEqual(j_step.action, 'pending')
        self.assertTrue(j_step.is_parallel)
        self.assertIsNone(j_step.assignee, '검토중(claim) 방식이라 생성 시점엔 미배정이다')
        # P 는 아직 pending — J 가 P 완료와 무관하게 존재한다는 뜻이다.
        self.assertEqual(
            ApprovalStep.objects.get(document=doc, agent='P', round=1).action, 'pending'
        )

    def test_j_due_date_matches_o_and_e(self):
        """(2026-08) J 의 기한은 P(4영업일)가 아니라 O/E 와 동일한 6영업일이다."""
        doc = self._advance_to_parallel(plel=True)
        steps = {s.agent: s for s in ApprovalStep.objects.filter(document=doc, round=1)}
        self.assertEqual(steps['J'].due_date, steps['O'].due_date)
        self.assertEqual(steps['J'].due_date, steps['E'].due_date)
        self.assertNotEqual(steps['J'].due_date, steps['P'].due_date,
                            'P 는 4영업일 그대로라 J 와 같을 수 없다')

    def test_j_stage_arrival_mail_sent_at_r_approval(self):
        """(2026-08) J 도착 메일이 P 완료 시점이 아니라 R 합의 시점에 TE_J 팀 전원에게 적재된다.

        MailNotification 에 agent 필드가 없어 본문 문구로 J 메일을 식별한다.
        """
        doc = self._advance_to_parallel()
        noti = MailNotification.objects.filter(
            document=doc, event_type='stage_arrival',
            contents__contains='J 단계 결재가 도착했습니다.',
        ).first()
        self.assertIsNotNone(noti, 'R 합의 시점(= P 가 아직 pending)에 J 도착 메일이 적재돼야 한다')
        self.assertIn(self.j_user.mail, noti.recipients,
                      '미배정 J 는 고정 주소가 아니라 TE_J 팀 전원에게 가야 한다')
        self.assertEqual(
            ApprovalStep.objects.get(document=doc, agent='P', round=1).action, 'pending',
            'P 는 아직 진행 중인데 J 메일이 이미 나갔다는 것이 이 테스트의 핵심이다',
        )

    def test_j_unassigned_arrival_has_no_hardcoded_fallback_address(self):
        """(2026-08) 폐지한 고정 주소(user_J@company.com)로는 더 이상 발송되지 않는다."""
        doc = self._advance_to_parallel()
        for noti in MailNotification.objects.filter(document=doc):
            self.assertNotIn('user_J@company.com', noti.recipients)

    def test_j_arrival_after_claim_goes_to_that_assignee_only(self):
        """J 가 이미 선점된 상태에서 도착 메일을 만들면 그 담당자 1명에게만 간다(P/R 과 동일 규칙)."""
        doc = self._advance_to_parallel()
        self.client.force_authenticate(user=self.j_user)
        r = self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': 'J'}, format='json')
        self.assertEqual(r.status_code, 200, r.content)

        j_step = ApprovalStep.objects.get(document=doc, agent='J', round=1)
        self.assertEqual(
            mailer.resolve_stage_recipients(doc, 'J', j_step), [self.j_user.mail]
        )

    def test_p_completion_notifies_te_o_and_te_j(self):
        doc = self._advance_to_parallel()
        self.client.force_authenticate(user=self.p_owner)
        self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': 'P'}, format='json')
        r = self.client.post(f'/api/documents/{doc.id}/approve-step/', {'agent': 'P', 'comment': ''}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        noti = MailNotification.objects.filter(document=doc, event_type='notify_p_completed').first()
        self.assertIsNotNone(noti)
        self.assertIn(self.o_user.mail, noti.recipients)
        # (2026-08) 폐지된 notify_p_arrival 대신 TE_J 도 이 완료 통보를 받는다.
        self.assertIn(self.j_user.mail, noti.recipients)
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

    def test_p_stage_completes_only_after_owner_and_all_reviewers_approve(self):
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
        # 담당자만 합의된 상태 — 검토자 미합의라 P 단계는 아직 완료가 아니다(완료 통보 없음)
        self.assertFalse(
            MailNotification.objects.filter(document=doc, event_type='notify_p_completed').exists()
        )

        self.client.force_authenticate(user=self.p_reviewer)
        r = self.client.post(f'/api/documents/{doc.id}/approve-step/', {'agent': 'PV', 'comment': ''}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(
            MailNotification.objects.filter(document=doc, event_type='notify_p_completed').exists()
        )

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

    # ----- 검토중(claim) 취소 -----

    def test_unclaim_returns_step_to_unassigned(self):
        """선점자 본인이 취소하면 assignee 가 비워져 다시 대기중(미배정)으로 돌아간다."""
        doc = self._advance_to_parallel()
        self.client.force_authenticate(user=self.p_owner)
        self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': 'P'}, format='json')
        p_step = ApprovalStep.objects.get(document=doc, agent='P', round=1)
        self.assertEqual(p_step.assignee_id, self.p_owner.id)

        r = self.client.post(f'/api/documents/{doc.id}/unclaim-step/', {'agent': 'P'}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        p_step.refresh_from_db()
        self.assertIsNone(p_step.assignee)
        self.assertEqual(p_step.assignee_name, '')
        self.assertEqual(p_step.action, 'pending')

    def test_unclaim_allows_reclaim_by_other_team_member(self):
        """취소 후엔 같은 팀 다른 사람이 다시 검토중을 눌러 선점할 수 있다."""
        doc = self._advance_to_parallel()
        self.client.force_authenticate(user=self.p_owner)
        self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': 'P'}, format='json')
        self.client.post(f'/api/documents/{doc.id}/unclaim-step/', {'agent': 'P'}, format='json')

        self.client.force_authenticate(user=self.p_outsider)
        r = self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': 'P'}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        p_step = ApprovalStep.objects.get(document=doc, agent='P', round=1)
        self.assertEqual(p_step.assignee_id, self.p_outsider.id)

    def test_unclaim_denied_for_other_team_member(self):
        """선점자 본인이 아닌 같은 팀 동료는 취소할 수 없다(403)."""
        doc = self._advance_to_parallel()
        self.client.force_authenticate(user=self.p_owner)
        self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': 'P'}, format='json')

        self.client.force_authenticate(user=self.p_outsider)
        r = self.client.post(f'/api/documents/{doc.id}/unclaim-step/', {'agent': 'P'}, format='json')
        self.assertEqual(r.status_code, 403)
        p_step = ApprovalStep.objects.get(document=doc, agent='P', round=1)
        self.assertEqual(p_step.assignee_id, self.p_owner.id, '취소가 거부됐으니 선점 상태가 유지돼야 한다')

    def test_unclaim_denied_when_not_claimed(self):
        """아직 아무도 선점하지 않은 단계는 취소할 것이 없으므로 400 이다."""
        doc = self._advance_to_parallel()
        self.client.force_authenticate(user=self.p_owner)
        r = self.client.post(f'/api/documents/{doc.id}/unclaim-step/', {'agent': 'P'}, format='json')
        self.assertEqual(r.status_code, 400)

    def test_unclaim_blocked_during_active_withdraw_request(self):
        """철회 요청 확인 대기 중에는 unclaim-step 도 동결된다(claim-step 과 동일 가드, _blocked_progress_response)."""
        from .models import WithdrawRequest

        doc = self._advance_to_parallel()
        self.client.force_authenticate(user=self.p_owner)
        self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': 'P'}, format='json')
        p_step = ApprovalStep.objects.get(document=doc, agent='P', round=1)

        WithdrawRequest.objects.create(
            document=doc, requester=self.requester, requester_name='요청자',
            reason='확인 필요', round=1, state='requested', target_step_ids=[p_step.id],
        )

        r = self.client.post(f'/api/documents/{doc.id}/unclaim-step/', {'agent': 'P'}, format='json')
        self.assertEqual(r.status_code, 400)
        p_step.refresh_from_db()
        self.assertEqual(p_step.assignee_id, self.p_owner.id, '동결 중에는 선점 상태가 그대로여야 한다')

    def test_unclaim_leaves_review_item_reviewers_intact(self):
        """J 선점 중 지정한 검토 항목 검토자는 취소해도 그대로 남는다(합의 여부와 무관하게 보존)."""
        from .models import DocumentReviewItem, DocumentReviewItemReviewer, ReviewItemMaster

        doc = self._advance_to_parallel()
        master = ReviewItemMaster.objects.create(title='항목1', is_active=True)
        item = DocumentReviewItem.objects.create(document=doc, master=master, title='항목1')

        self.client.force_authenticate(user=self.j_user)
        self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': 'J'}, format='json')
        DocumentReviewItemReviewer.objects.create(
            item=item, user=self.j_user, loginid=self.j_user.loginid, name=self.j_user.loginid, confirmed=False,
        )

        r = self.client.post(f'/api/documents/{doc.id}/unclaim-step/', {'agent': 'J'}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(
            DocumentReviewItemReviewer.objects.filter(item=item, user=self.j_user).exists(),
            '취소는 선점(assignee)만 되돌릴 뿐, 이미 지정된 검토자 기록을 지우지 않는다',
        )

    def test_p_reviewer_mail_shows_owner_as_approved_not_reviewing(self):
        """담당자 합의 + 검토자 지정을 한 요청으로 처리할 때, 검토자에게 가는 메일의
        결재 경로 카드에서 담당자(P) 행은 '검토중'이 아니라 '완료'로 표시돼야 한다.
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
        # (2026-08) 경로 카드의 approved 라벨은 '합의' → '완료' 로 바뀌었다(웹 그리드와 통일).
        self.assertIn('완료', p_row_html)
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
        # (2026-08) J 는 R 합의 시점에 이미 만들어져 있으므로 '미생성' 이 아니라 '진행 불가' 를 본다 —
        # 반려 문서는 _blocked_progress_response 가드로 잔여 pending 단계를 처리할 수 없다(§6-8).
        self.assertEqual(
            ApprovalStep.objects.get(document=doc, agent='J', round=1).action, 'pending'
        )
        self.client.force_authenticate(user=self.j_user)
        r = self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': 'J'}, format='json')
        self.assertEqual(r.status_code, 400, '반려된 문서의 잔여 J 단계는 진행할 수 없어야 한다')

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
        # (2026-08) 경로 카드의 approved 라벨은 '합의' → '완료' 로 바뀌었다(웹 그리드와 통일).
        self.assertIn('완료', e_row_html)
        self.assertNotIn('검토중', e_row_html)

    def test_e_reviewer_gate_blocks_final_approval_until_all_agree(self):
        """EV 는 AND — 검토자 중 1명만 합의해서는 최종 승인이 막히고, 전원 합의해야 통과한다."""
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

        # 검토자(EV) 중 1명만 합의 — 나머지가 남아 있으면 아직 최종 승인이 아니다
        self.client.force_authenticate(user=self.e_reviewer)
        r = self.client.post(f'/api/documents/{doc.id}/approve-step/', {'agent': 'EV', 'comment': ''}, format='json')
        self.assertEqual(r.status_code, 200, r.content)

        doc.refresh_from_db()
        self.assertEqual(doc.status, 'under_review', '검토자가 아직 한 명 남아 있으면 승인되면 안 된다')

        # 남은 검토자도 합의 → 전원 합의로 최종 승인
        self.client.force_authenticate(user=self.e_reviewer2)
        r = self.client.post(f'/api/documents/{doc.id}/approve-step/', {'agent': 'EV', 'comment': ''}, format='json')
        self.assertEqual(r.status_code, 200, r.content)

        doc.refresh_from_db()
        self.assertEqual(doc.status, 'approved')

    # ----- (2026-08) J 병렬 분리 후 최종 승인 판정에 P 가 포함된다 -----

    def test_general_route_approved_when_p_is_last(self):
        """J·O 를 먼저 끝내고 P 를 마지막에 합의해도 문서가 승인된다.

        J 분리 전에는 P 뒤에 항상 J 가 있어 P 가 마지막이 될 수 없었고, 그래서 P/PV 합의는
        최종 승인 판정을 돌리지 않았다. 그 상태로 J 만 분리하면 이 문서가 under_review 에
        영구 정지한다 — 판정 트리거에 P/PV 를 넣은 이유다.
        """
        doc = self._advance_to_parallel()
        self.client.force_authenticate(user=self.j_user)
        self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': 'J'}, format='json')
        r = self.client.post(f'/api/documents/{doc.id}/approve-step/', {'agent': 'J', 'comment': ''}, format='json')
        self.assertEqual(r.status_code, 200, r.content)

        self.client.force_authenticate(user=self.o_user)
        self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': 'O'}, format='json')
        r = self.client.post(f'/api/documents/{doc.id}/approve-step/', {'agent': 'O', 'comment': ''}, format='json')
        self.assertEqual(r.status_code, 200, r.content)

        doc.refresh_from_db()
        self.assertEqual(doc.status, 'under_review', 'P 가 남아 있으면 아직 승인이 아니다')

        self.client.force_authenticate(user=self.p_owner)
        self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': 'P'}, format='json')
        r = self.client.post(f'/api/documents/{doc.id}/approve-step/', {'agent': 'P', 'comment': ''}, format='json')
        self.assertEqual(r.status_code, 200, r.content)

        doc.refresh_from_db()
        self.assertEqual(doc.status, 'approved', 'P 가 마지막이어도 최종 승인돼야 한다')

    def test_general_route_not_approved_while_p_pending(self):
        """P 가 미완료면 J·O 가 모두 합의돼도 승인되지 않는다(P 를 판정 조건에 넣은 효과)."""
        doc = self._advance_to_parallel()
        for user, agent in ((self.j_user, 'J'), (self.o_user, 'O')):
            self.client.force_authenticate(user=user)
            self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': agent}, format='json')
            r = self.client.post(f'/api/documents/{doc.id}/approve-step/', {'agent': agent, 'comment': ''}, format='json')
            self.assertEqual(r.status_code, 200, r.content)

        doc.refresh_from_db()
        self.assertEqual(doc.status, 'under_review')
        self.assertEqual(ApprovalStep.objects.get(document=doc, agent='P', round=1).action, 'pending')

    # ----- 기타 목적 'Overlay 변경' 단독: 일반 경로에서 J 를 뺀다 -----

    def test_j_step_not_created_when_other_purpose_is_overlay_only(self):
        """기타 목적이 'Overlay 변경' 하나뿐이면 R 합의 시 J 단계를 만들지 않는다."""
        doc = self._advance_to_parallel(other_purpose=[RequestDocument.OTHER_PURPOSE_OVERLAY])
        self.assertFalse(
            ApprovalStep.objects.filter(document=doc, agent='J', round=1).exists(),
            "'Overlay 변경' 단독 문서에는 J 단계가 생성되지 않아야 한다",
        )
        # 나머지 병렬 단계는 그대로다.
        self.assertTrue(ApprovalStep.objects.filter(document=doc, agent='P', round=1).exists())
        self.assertTrue(ApprovalStep.objects.filter(document=doc, agent='O', round=1).exists())

    def test_j_step_created_when_overlay_selected_with_others(self):
        """다른 기타 목적을 함께 골랐으면 J 단계는 그대로 생성된다."""
        doc = self._advance_to_parallel(
            other_purpose=[RequestDocument.OTHER_PURPOSE_OVERLAY, 'STEPSEQ 변경']
        )
        self.assertTrue(
            ApprovalStep.objects.filter(document=doc, agent='J', round=1).exists(),
            '기타 목적이 2개 이상이면 J 를 빼지 않는다',
        )

    def test_overlay_only_document_approved_without_j(self):
        """J 없는 문서도 P·O 합의만으로 최종 승인된다(under_review 영구 정지 회귀 방지).

        최종 판정의 j_approved 는 원래 `len(j_steps) > 0` 을 요구해, J 를 만들지 않으면
        나머지가 모두 합의돼도 영원히 False 가 된다 — skip_j_stage 분기가 그 정지를 막는다.
        """
        doc = self._advance_to_parallel(other_purpose=[RequestDocument.OTHER_PURPOSE_OVERLAY])

        self.client.force_authenticate(user=self.o_user)
        self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': 'O'}, format='json')
        r = self.client.post(f'/api/documents/{doc.id}/approve-step/', {'agent': 'O', 'comment': ''}, format='json')
        self.assertEqual(r.status_code, 200, r.content)

        doc.refresh_from_db()
        self.assertEqual(doc.status, 'under_review', 'P 가 남아 있으면 아직 승인이 아니다')

        self.client.force_authenticate(user=self.p_owner)
        self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': 'P'}, format='json')
        r = self.client.post(f'/api/documents/{doc.id}/approve-step/', {'agent': 'P', 'comment': ''}, format='json')
        self.assertEqual(r.status_code, 200, r.content)

        doc.refresh_from_db()
        self.assertEqual(doc.status, 'approved', 'J 가 없는 경로도 P·O 합의로 승인돼야 한다')

    def test_general_route_not_approved_while_p_reviewer_pending(self):
        """P 담당자만 합의하고 검토자(PV)가 남아 있으면 J·O 가 끝나도 승인되지 않는다."""
        doc = self._advance_to_parallel()
        self.client.force_authenticate(user=self.p_owner)
        self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': 'P'}, format='json')
        r = self.client.post(f'/api/documents/{doc.id}/approve-step/', {
            'agent': 'P', 'comment': '', 'reviewer_loginids': [self.p_reviewer.loginid],
        }, format='json')
        self.assertEqual(r.status_code, 200, r.content)

        for user, agent in ((self.j_user, 'J'), (self.o_user, 'O')):
            self.client.force_authenticate(user=user)
            self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': agent}, format='json')
            self.client.post(f'/api/documents/{doc.id}/approve-step/', {'agent': agent, 'comment': ''}, format='json')

        doc.refresh_from_db()
        self.assertEqual(doc.status, 'under_review', 'PV 가 남아 있으면 승인되면 안 된다')

        self.client.force_authenticate(user=self.p_reviewer)
        r = self.client.post(f'/api/documents/{doc.id}/approve-step/', {'agent': 'PV', 'comment': ''}, format='json')
        self.assertEqual(r.status_code, 200, r.content)

        doc.refresh_from_db()
        self.assertEqual(doc.status, 'approved', 'PV 까지 합의하면 최종 승인된다')

    def test_j_can_be_approved_before_p(self):
        """J 는 P 완료를 기다리지 않고 곧바로 선점·합의할 수 있다(순차 가드가 없어야 한다)."""
        doc = self._advance_to_parallel()
        self.client.force_authenticate(user=self.j_user)
        r = self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': 'J'}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        r = self.client.post(f'/api/documents/{doc.id}/approve-step/', {'agent': 'J', 'comment': ''}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(
            ApprovalStep.objects.get(document=doc, agent='J', round=1).action, 'approved'
        )

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

        EV 는 지정된 검토자 전원이 합의해야 단계가 끝나므로(AND), 아직 합의하지 않은
        검토자가 있다면 그 사람이 바뀐 값을 보고 판단한다.
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
        """E 담당자 합의·검토자 일부 합의만으로는 수정 창이 닫히지 않고, 전원 합의해야 닫힌다.

        _stage_reviewers_complete 가 EV 도 P/PV 와 동일하게 AND 로 판정하므로(2026-08),
        게이트도 '지정된 검토자 전원이 합의한 시점' 에 닫힌다.
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

        # 검토자 1명만 합의 — 아직 한 명이 남아 있으므로 창은 계속 열려 있다.
        self.client.force_authenticate(user=self.e_reviewer)
        r = self.client.post(f'/api/documents/{doc.id}/approve-step/', {'agent': 'EV', 'comment': ''}, format='json')
        self.assertEqual(r.status_code, 200, r.content)

        self.client.force_authenticate(user=self.requester)
        r = self.client.post(f'/api/documents/{doc.id}/validation-system/', {'value': 'NO'}, format='json')
        self.assertEqual(r.status_code, 200, r.content)  # 검토자가 아직 한 명 남아 있으면 수정 창이 닫히면 안 된다

        # 남은 검토자도 합의하면 MASK 검증이 끝난 것이므로 창이 닫힌다.
        self.client.force_authenticate(user=self.e_reviewer2)
        r = self.client.post(f'/api/documents/{doc.id}/approve-step/', {'agent': 'EV', 'comment': ''}, format='json')
        self.assertEqual(r.status_code, 200, r.content)

        self.client.force_authenticate(user=self.requester)
        r = self.client.post(f'/api/documents/{doc.id}/validation-system/', {'value': 'YES'}, format='json')
        self.assertEqual(r.status_code, 400, r.content)
        self.assertEqual(self._get_detail(doc)['validation_system'], 'NO')

    # ----- EV(2차 검토자) 전원 합의(AND) -----

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

    def test_ev_all_reviewers_required_to_complete_e_stage(self):
        """EV 2명 중 1명만 합의해서는 E 단계가 끝나지 않고, 전원 합의해야 문서가 최종 승인된다(AND)."""
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
        self.assertEqual(doc.status, 'under_review', '검토자 1명만 합의했으면 아직 최종 승인이 아니다')

        self.client.force_authenticate(user=self.e_reviewer2)
        r = self.client.post(f'/api/documents/{doc.id}/approve-step/', {'agent': 'EV', 'comment': ''}, format='json')
        self.assertEqual(r.status_code, 200, r.content)

        doc.refresh_from_db()
        self.assertEqual(doc.status, 'approved', '검토자 전원 합의로 E 단계가 완료된다')

    def test_ev_remaining_step_stays_pending_after_one_approves(self):
        """(2026-08) EV 1명이 합의해도 나머지 검토자는 자동으로 닫히지 않고 pending 그대로 남는다 — 각자 직접 합의해야 한다."""
        doc = self._advance_to_parallel(plel=True)
        self.assertEqual(
            self._approve_e(doc, reviewers=[self.e_reviewer.loginid, self.e_reviewer2.loginid]).status_code, 200
        )

        self.client.force_authenticate(user=self.e_reviewer)
        r = self.client.post(f'/api/documents/{doc.id}/approve-step/', {'agent': 'EV', 'comment': ''}, format='json')
        self.assertEqual(r.status_code, 200, r.content)

        remaining = ApprovalStep.objects.get(
            document=doc, agent='EV', round=1, assignee__loginid=self.e_reviewer2.loginid
        )
        self.assertEqual(remaining.action, 'pending', '전원 합의(AND)이므로 나머지 검토자를 자동으로 닫으면 안 된다')
        self.assertIsNone(remaining.acted_at)
        self.assertEqual(
            ApprovalStep.objects.get(
                document=doc, agent='EV', round=1, assignee__loginid=self.e_reviewer.loginid
            ).action,
            'approved',
            '합의한 검토자는 그대로 approved 다',
        )

    def test_ev_skip_is_not_applied_to_pv(self):
        """P 검토자(PV)는 원래부터 AND — 1명 합의로는 완료되지 않고 나머지도 pending 이다(EV도 2026-08부터 동일 규칙)."""
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
            MailNotification.objects.filter(document=doc, event_type='notify_p_completed').exists(),
            'PV 가 OR 로 새어 나가면 검토자 1명 합의로 P 단계가 완료 처리된다',
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

    def test_validation_system_blocked_after_all_ev_approval(self):
        """EV 1명만 합의했을 땐 값 수정 창이 열려 있고, 전원 합의해야 닫힌다(400)."""
        doc = self._advance_to_parallel(plel=True)
        self._set_detail(doc, {'validation_system': 'NO'})
        self.assertEqual(
            self._approve_e(doc, reviewers=[self.e_reviewer.loginid, self.e_reviewer2.loginid]).status_code, 200
        )
        self.client.force_authenticate(user=self.e_reviewer)
        self.client.post(f'/api/documents/{doc.id}/approve-step/', {'agent': 'EV', 'comment': ''}, format='json')

        self.client.force_authenticate(user=self.requester)
        r = self.client.post(f'/api/documents/{doc.id}/validation-system/', {'value': 'YES'}, format='json')
        self.assertEqual(r.status_code, 200, r.content)  # 검토자가 아직 한 명 남아 있으면 수정 창이 닫히면 안 된다

        self.client.force_authenticate(user=self.e_reviewer2)
        self.client.post(f'/api/documents/{doc.id}/approve-step/', {'agent': 'EV', 'comment': ''}, format='json')

        self.client.force_authenticate(user=self.requester)
        r = self.client.post(f'/api/documents/{doc.id}/validation-system/', {'value': 'NO'}, format='json')
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
    """'MAP 삭제' 전용 결재 경로 — PL 합의 후 P·R·J·O 병렬, E·RA 미생성.

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
                         'plel 이 있어도 MAP 삭제 경로에는 E 를 만들지 않는다')
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


class WithdrawFlowTest(TestCase):
    """철회 = '요청 → 현재 단계 전원 확인 → 완전 삭제' (2026-08 개편).

    - draft 는 확인 없이 즉시 삭제(사유 선택), approved 는 MASTER 만
    - rejected 는 철회 불가(400) — 수정 후 재상신해야 한다
    - under_review/submitted 는 사유 필수 + 철회 요청 생성 → 전원 확인 시 삭제
    - 확인 대기 중에는 결재 동결, 요청자만 취소 가능, 대상 단계는 거부 가능
    """

    def setUp(self):
        from rest_framework.test import APIClient
        self.client = APIClient()

        self.author = UserProfile.objects.create(
            loginid='wd_author', mail='wd_a@c.com', role='PL', username='의뢰자'
        )
        self.pl = UserProfile.objects.create(loginid='wd_pl', mail='wd_pl@c.com', role='PL', username='지정PL')
        self.rfg = UserProfile.objects.create(loginid='wd_r', mail='wd_r@c.com', role='TE_R', username='R담당')
        self.rfg2 = UserProfile.objects.create(loginid='wd_r2', mail='wd_r2@c.com', role='TE_R', username='R팀원')
        self.job = UserProfile.objects.create(loginid='wd_j', mail='wd_j@c.com', role='TE_J', username='J팀원')
        self.outsider = UserProfile.objects.create(loginid='wd_out', mail='wd_o@c.com', role='NONE')
        self.master = UserProfile.objects.create(loginid='wd_master', mail='wd_m@c.com', role='MASTER')

    def _doc(self, status='under_review'):
        return RequestDocument.objects.create(
            title=f'wd-{status}',
            requester=self.author,
            requester_name='의뢰자', requester_email='wd_a@c.com', requester_department='d',
            product_name='p', status=status, designated_pl=self.pl,
        )

    def _step(self, doc, agent, action='pending', assignee=None, round=1):
        return ApprovalStep.objects.create(
            document=doc, agent=agent, action=action, round=round,
            assignee=assignee, assignee_name=(assignee.username if assignee else ''),
        )

    def _post(self, user, doc, path, payload=None):
        self.client.force_authenticate(user=user)
        return self.client.post(f'/api/documents/{doc.id}/{path}/', payload or {}, format='json')

    def _exists(self, doc):
        return RequestDocument.objects.filter(pk=doc.pk).exists()

    def _events(self):
        return list(MailNotification.objects.values_list('event_type', flat=True))

    # ----- 인가 / 상태 가드 -----
    def test_outsider_cannot_withdraw(self):
        doc = self._doc()
        self._step(doc, 'R', assignee=self.rfg)
        res = self._post(self.outsider, doc, 'withdraw', {'reason': 'x'})
        self.assertEqual(res.status_code, 403)
        self.assertTrue(self._exists(doc))

    def test_paused_document_cannot_be_withdrawn(self):
        """중단 문서는 재개한 뒤 철회해야 한다."""
        doc = self._doc('pause')
        res = self._post(self.author, doc, 'withdraw', {'reason': 'x'})
        self.assertEqual(res.status_code, 400)
        self.assertTrue(self._exists(doc))

    def test_reason_required_for_in_progress_document(self):
        doc = self._doc()
        self._step(doc, 'R', assignee=self.rfg)
        res = self._post(self.author, doc, 'withdraw', {'reason': '   '})
        self.assertEqual(res.status_code, 400)
        self.assertFalse(WithdrawRequest.objects.filter(document=doc).exists())

    def test_in_progress_document_without_pending_step_is_rejected(self):
        """진행 중인데 pending 단계가 없으면 확인받을 상대가 없다 → 400."""
        doc = self._doc()
        self._step(doc, 'R', action='approved', assignee=self.rfg)
        res = self._post(self.author, doc, 'withdraw', {'reason': '사유'})
        self.assertEqual(res.status_code, 400)
        self.assertTrue(self._exists(doc))

    def test_duplicate_request_is_blocked(self):
        doc = self._doc()
        self._step(doc, 'R', assignee=self.rfg)
        self.assertEqual(self._post(self.author, doc, 'withdraw', {'reason': '1'}).status_code, 200)
        res = self._post(self.author, doc, 'withdraw', {'reason': '2'})
        self.assertEqual(res.status_code, 400)
        self.assertEqual(WithdrawRequest.objects.filter(document=doc).count(), 1)

    # ----- 즉시 삭제 경로 -----
    def test_draft_is_deleted_immediately(self):
        doc = self._doc('draft')
        res = self._post(self.author, doc, 'withdraw', {'reason': ''})
        self.assertEqual(res.status_code, 200, res.content)
        self.assertTrue(res.data['deleted'])
        self.assertFalse(self._exists(doc))

    def test_rejected_cannot_be_withdrawn(self):
        """반려 문서는 철회할 수 없다(2026-08) — 수정 후 재상신해야 한다."""
        doc = self._doc('rejected')
        self._step(doc, 'R', action='rejected', assignee=self.rfg)
        res = self._post(self.author, doc, 'withdraw', {'reason': '재작성'})
        self.assertEqual(res.status_code, 400)
        self.assertTrue(self._exists(doc))

    def test_approved_is_master_only(self):
        doc = self._doc('approved')
        self.assertEqual(self._post(self.author, doc, 'withdraw', {'reason': 'x'}).status_code, 403)
        self.assertTrue(self._exists(doc))
        self.assertEqual(self._post(self.master, doc, 'withdraw', {'reason': 'x'}).status_code, 200)
        self.assertFalse(self._exists(doc))

    # ----- 요청 → 확인 → 삭제 -----
    def test_request_creates_pending_withdraw_and_mails_target_only(self):
        """철회 요청 메일은 확인 대상 단계에만 간다(통보처 제외)."""
        doc = self._doc()
        r_step = self._step(doc, 'R', assignee=self.rfg)
        res = self._post(self.author, doc, 'withdraw', {'reason': '스펙 변경'})
        self.assertEqual(res.status_code, 200, res.content)
        self.assertFalse(res.data['deleted'])
        self.assertTrue(self._exists(doc))

        wr = WithdrawRequest.objects.get(document=doc)
        self.assertEqual(wr.state, 'requested')
        self.assertEqual(wr.target_step_ids, [r_step.id])

        noti = MailNotification.objects.get(event_type='withdraw_requested')
        self.assertEqual(noti.recipients, ['wd_r@c.com'])
        self.assertIn('스펙 변경', noti.contents)

    def test_partial_confirm_keeps_document(self):
        """병렬 단계 중 하나만 확인하면 아직 삭제되지 않는다."""
        doc = self._doc()
        r_step = self._step(doc, 'R', assignee=self.rfg)
        j_step = self._step(doc, 'J', assignee=self.job)
        self._post(self.author, doc, 'withdraw', {'reason': '사유'})

        res = self._post(self.rfg, doc, 'confirm-withdraw', {'agent': 'R'})
        self.assertEqual(res.status_code, 200, res.content)
        self.assertFalse(res.data['deleted'])
        self.assertTrue(self._exists(doc))

        wr = WithdrawRequest.objects.get(document=doc)
        self.assertEqual(wr.confirmed_step_ids, [r_step.id])
        self.assertIn(j_step.id, wr.target_step_ids)

    def test_all_confirm_deletes_document_and_mails_completed(self):
        doc = self._doc()
        self._step(doc, 'R', assignee=self.rfg)
        self._step(doc, 'J', assignee=self.job)
        self._post(self.author, doc, 'withdraw', {'reason': '사유'})

        self._post(self.rfg, doc, 'confirm-withdraw', {'agent': 'R'})
        res = self._post(self.job, doc, 'confirm-withdraw', {'agent': 'J'})
        self.assertEqual(res.status_code, 200, res.content)
        self.assertTrue(res.data['deleted'])
        self.assertFalse(self._exists(doc))
        # 문서가 사라져도 결재 단계·철회 요청까지 CASCADE 로 정리된다(이력 미보존)
        self.assertFalse(ApprovalStep.objects.filter(document_id=doc.id).exists())
        self.assertFalse(WithdrawRequest.objects.filter(document_id=doc.id).exists())
        self.assertIn('withdraw_completed', self._events())

    def test_unassigned_step_can_be_confirmed_by_team_member(self):
        """담당자 미배정 단계는 같은 팀 누구나 1명이 확인하면 그 단계는 확인 완료."""
        doc = self._doc()
        self._step(doc, 'R')  # 미배정
        self._post(self.author, doc, 'withdraw', {'reason': '사유'})
        res = self._post(self.rfg2, doc, 'confirm-withdraw', {'agent': 'R'})
        self.assertEqual(res.status_code, 200, res.content)
        self.assertTrue(res.data['deleted'])
        self.assertFalse(self._exists(doc))

    def test_unassigned_step_mails_whole_team(self):
        doc = self._doc()
        self._step(doc, 'R')
        self._post(self.author, doc, 'withdraw', {'reason': '사유'})
        noti = MailNotification.objects.get(event_type='withdraw_requested')
        self.assertCountEqual(noti.recipients, ['wd_r@c.com', 'wd_r2@c.com'])

    def test_other_team_cannot_confirm(self):
        doc = self._doc()
        self._step(doc, 'R', assignee=self.rfg)
        self._post(self.author, doc, 'withdraw', {'reason': '사유'})
        res = self._post(self.job, doc, 'confirm-withdraw', {'agent': 'R'})
        self.assertEqual(res.status_code, 403)
        self.assertTrue(self._exists(doc))

    # ----- 거부 / 취소 -----
    def test_target_step_can_reject_withdraw(self):
        doc = self._doc()
        self._step(doc, 'R', assignee=self.rfg)
        self._post(self.author, doc, 'withdraw', {'reason': '사유'})

        res = self._post(self.rfg, doc, 'reject-withdraw')
        self.assertEqual(res.status_code, 200, res.content)
        self.assertTrue(self._exists(doc))
        self.assertEqual(WithdrawRequest.objects.get(document=doc).state, 'rejected')
        noti = MailNotification.objects.get(event_type='withdraw_rejected')
        self.assertIn('wd_a@c.com', noti.recipients)

    def test_requester_can_cancel_before_confirm(self):
        doc = self._doc()
        self._step(doc, 'R', assignee=self.rfg)
        self._post(self.author, doc, 'withdraw', {'reason': '잘못 눌렀다'})

        res = self._post(self.author, doc, 'cancel-withdraw')
        self.assertEqual(res.status_code, 200, res.content)
        self.assertTrue(self._exists(doc))
        self.assertEqual(WithdrawRequest.objects.get(document=doc).state, 'cancelled')
        noti = MailNotification.objects.get(event_type='withdraw_cancelled')
        self.assertEqual(noti.recipients, ['wd_r@c.com'])

    def test_non_requester_cannot_cancel(self):
        doc = self._doc()
        self._step(doc, 'R', assignee=self.rfg)
        self._post(self.author, doc, 'withdraw', {'reason': '사유'})
        res = self._post(self.rfg, doc, 'cancel-withdraw')
        self.assertEqual(res.status_code, 403)
        self.assertEqual(WithdrawRequest.objects.get(document=doc).state, 'requested')

    def test_withdraw_button_returns_after_cancel(self):
        """취소하면 다시 철회를 요청할 수 있다."""
        doc = self._doc()
        self._step(doc, 'R', assignee=self.rfg)
        self._post(self.author, doc, 'withdraw', {'reason': '1'})
        self._post(self.author, doc, 'cancel-withdraw')
        res = self._post(self.author, doc, 'withdraw', {'reason': '2'})
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(WithdrawRequest.objects.filter(document=doc, state='requested').count(), 1)

    # ----- 결재 동결 -----
    def test_approval_is_frozen_while_withdraw_pending(self):
        doc = self._doc()
        self._step(doc, 'R', assignee=self.rfg)
        self._post(self.author, doc, 'withdraw', {'reason': '사유'})

        res = self._post(self.rfg, doc, 'approve-step', {'agent': 'R', 'comment': ''})
        self.assertEqual(res.status_code, 400)
        self.assertEqual(ApprovalStep.objects.get(document=doc, agent='R').action, 'pending')

    def test_approval_resumes_after_reject(self):
        doc = self._doc()
        self._step(doc, 'R', assignee=self.rfg)
        self._post(self.author, doc, 'withdraw', {'reason': '사유'})
        self._post(self.rfg, doc, 'reject-withdraw')

        res = self._post(self.rfg, doc, 'approve-step', {'agent': 'R', 'comment': ''})
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(ApprovalStep.objects.get(document=doc, agent='R').action, 'approved')

    # ----- 철회 완료 메일 수신자 -----
    def test_completed_mail_covers_only_reached_teams(self):
        """R 단계까지만 진행된 문서는 TE_R 에게만 통보된다(TE_J 등 미도달 팀 제외)."""
        doc = self._doc()
        self._step(doc, 'PL', action='approved', assignee=self.pl)
        self._step(doc, 'R', assignee=self.rfg)
        self._post(self.author, doc, 'withdraw', {'reason': '사유'})
        self._post(self.rfg, doc, 'confirm-withdraw', {'agent': 'R'})

        noti = MailNotification.objects.get(event_type='withdraw_completed')
        self.assertIn('wd_r@c.com', noti.recipients)    # 도달한 팀
        self.assertIn('wd_r2@c.com', noti.recipients)   # 도달한 팀 전원
        self.assertIn('wd_pl@c.com', noti.recipients)   # 지정 PL
        self.assertIn('wd_a@c.com', noti.recipients)    # 작성자
        self.assertNotIn('wd_j@c.com', noti.recipients)  # 아직 열리지 않은 J 팀

    def test_completed_mail_includes_reached_parallel_teams(self):
        """J 단계가 열린 뒤라면 TE_J 도 통보 대상이다."""
        doc = self._doc()
        self._step(doc, 'R', action='approved', assignee=self.rfg)
        self._step(doc, 'J', assignee=self.job)
        self._post(self.author, doc, 'withdraw', {'reason': '사유'})
        self._post(self.job, doc, 'confirm-withdraw', {'agent': 'J'})

        noti = MailNotification.objects.get(event_type='withdraw_completed')
        self.assertIn('wd_j@c.com', noti.recipients)
        self.assertIn('wd_r@c.com', noti.recipients)

    def test_completed_mail_has_no_dead_deeplink(self):
        """문서가 삭제되므로 상세 딥링크 버튼을 싣지 않는다."""
        doc = self._doc('draft')
        self._post(self.author, doc, 'withdraw', {'reason': '사유'})
        noti = MailNotification.objects.get(event_type='withdraw_completed')
        self.assertNotIn(f'/approval?id={doc.id}', noti.contents)

    # ----- MASTER 는 제약 없이 즉시 삭제(2026-08) -----
    def test_master_can_withdraw_rejected_immediately(self):
        """MASTER 는 반려 문서도(다른 사용자는 400) 사유 없이 즉시 삭제한다."""
        doc = self._doc('rejected')
        self._step(doc, 'R', action='rejected', assignee=self.rfg)
        res = self._post(self.master, doc, 'withdraw', {})
        self.assertEqual(res.status_code, 200, res.content)
        self.assertTrue(res.data['deleted'])
        self.assertFalse(self._exists(doc))

    def test_master_can_withdraw_paused_immediately(self):
        """MASTER 는 중단 문서도(다른 사용자는 400) 사유 없이 즉시 삭제한다."""
        doc = self._doc('pause')
        res = self._post(self.master, doc, 'withdraw', {})
        self.assertEqual(res.status_code, 200, res.content)
        self.assertTrue(res.data['deleted'])
        self.assertFalse(self._exists(doc))

    def test_master_withdraw_of_in_progress_document_is_immediate_not_a_request(self):
        """MASTER 는 진행 중(under_review) 문서도 확인 절차 없이 바로 삭제한다(요청 생성 아님)."""
        doc = self._doc()
        self._step(doc, 'R', assignee=self.rfg)
        res = self._post(self.master, doc, 'withdraw', {})
        self.assertEqual(res.status_code, 200, res.content)
        self.assertTrue(res.data['deleted'])
        self.assertFalse(self._exists(doc))
        self.assertFalse(WithdrawRequest.objects.filter(document_id=doc.id).exists())

    def test_master_withdraw_skips_completed_mail(self):
        """MASTER 의 제약 없는 즉시삭제는 완료 메일을 보내지 않는다(서버 로그만 남는다)."""
        doc = self._doc()
        self._step(doc, 'R', assignee=self.rfg)
        res = self._post(self.master, doc, 'withdraw', {})
        self.assertEqual(res.status_code, 200, res.content)
        self.assertNotIn('withdraw_completed', self._events())

    def test_master_withdraw_bypasses_existing_pending_request(self):
        """이미 철회 요청(확인 대기)이 있어도 MASTER 는 곧바로 삭제할 수 있다."""
        doc = self._doc()
        self._step(doc, 'R', assignee=self.rfg)
        self._post(self.author, doc, 'withdraw', {'reason': '사유'})
        self.assertTrue(WithdrawRequest.objects.filter(document=doc, state='requested').exists())

        res = self._post(self.master, doc, 'withdraw', {})
        self.assertEqual(res.status_code, 200, res.content)
        self.assertTrue(res.data['deleted'])
        self.assertFalse(self._exists(doc))


class PauseFlowTest(TestCase):
    """중단(PAUSE) = '요청 → 현재 단계 전원 확인 → pause 전이' (2026-08: 거부·동결 강화).

    - 확인 대기(requested) 동안 결재 동결(승인/반려/지정/검토중/검토중취소 모두 400) —
      예전엔 status가 실제로 'pause'로 바뀐 뒤에만 막혀서, 확인을 기다리는 사이 대상 단계가
      검토중·합의까지 진행될 수 있었다(2026-08 수정 전 버그, WithdrawFlowTest 의 동결 테스트와 대칭).
    - 대상 단계 중 하나만 거부해도 요청 전체가 무효화되고 결재는 그대로 이어진다(reject-pause, 신규).
    - 전원 확인 시 status → pause 로 전이하고, 그 뒤로도 동결이 유지된다.
    """

    def setUp(self):
        from rest_framework.test import APIClient
        self.client = APIClient()

        self.author = UserProfile.objects.create(
            loginid='ps_author', mail='ps_a@c.com', role='PL', username='의뢰자'
        )
        self.pl = UserProfile.objects.create(loginid='ps_pl', mail='ps_pl@c.com', role='PL', username='지정PL')
        self.rfg = UserProfile.objects.create(loginid='ps_r', mail='ps_r@c.com', role='TE_R', username='R담당')
        self.job = UserProfile.objects.create(loginid='ps_j', mail='ps_j@c.com', role='TE_J', username='J팀원')
        self.outsider = UserProfile.objects.create(loginid='ps_out', mail='ps_o@c.com', role='NONE')

    def _doc(self, status='under_review'):
        return RequestDocument.objects.create(
            title=f'ps-{status}',
            requester=self.author,
            requester_name='의뢰자', requester_email='ps_a@c.com', requester_department='d',
            product_name='p', status=status, designated_pl=self.pl,
        )

    def _step(self, doc, agent, action='pending', assignee=None, round=1):
        return ApprovalStep.objects.create(
            document=doc, agent=agent, action=action, round=round,
            assignee=assignee, assignee_name=(assignee.username if assignee else ''),
        )

    def _post(self, user, doc, path, payload=None):
        self.client.force_authenticate(user=user)
        return self.client.post(f'/api/documents/{doc.id}/{path}/', payload or {}, format='json')

    # ----- 동결: 확인 대기 중엔 결재 진행 액션이 전부 막힌다 -----
    def test_approval_is_frozen_while_pause_requested(self):
        doc = self._doc()
        r_step = self._step(doc, 'R', assignee=self.rfg)
        self._step(doc, 'J', assignee=self.job)
        self._post(self.author, doc, 'request-pause', {'reason': '사양 재검토'})

        res = self._post(self.rfg, doc, 'approve-step', {'agent': 'R', 'comment': ''})
        self.assertEqual(res.status_code, 400, res.content)
        r_step.refresh_from_db()
        self.assertEqual(r_step.action, 'pending')

    def test_claim_is_frozen_while_pause_requested(self):
        """검토중(claim) 선점도 확인 대기 중엔 막힌다 — 안 막으면 그 사이 새로 선점해 합의까지 갈 수 있다."""
        doc = self._doc()
        self._step(doc, 'R', assignee=self.rfg)
        j_step = self._step(doc, 'J')  # 미배정
        self._post(self.author, doc, 'request-pause', {'reason': '사양 재검토'})

        res = self._post(self.job, doc, 'claim-step', {'agent': 'J'})
        self.assertEqual(res.status_code, 400, res.content)
        j_step.refresh_from_db()
        self.assertIsNone(j_step.assignee)

    def test_frozen_document_can_still_confirm_pause(self):
        """동결 중에도 확인(confirm-pause) 자체는 막히면 안 된다 — 확인은 동결 대상 액션이 아니다."""
        doc = self._doc()
        self._step(doc, 'R', assignee=self.rfg)
        self._post(self.author, doc, 'request-pause', {'reason': '사유'})
        res = self._post(self.rfg, doc, 'confirm-pause', {'agent': 'R'})
        self.assertEqual(res.status_code, 200, res.content)

    def test_partial_confirm_keeps_frozen(self):
        """병렬 단계 중 하나만 확인해도 아직 pause 확정 전이라 동결이 유지된다."""
        doc = self._doc()
        self._step(doc, 'R', assignee=self.rfg)
        self._step(doc, 'J', assignee=self.job)
        self._post(self.author, doc, 'request-pause', {'reason': '사유'})
        self._post(self.rfg, doc, 'confirm-pause', {'agent': 'R'})

        doc.refresh_from_db()
        self.assertEqual(doc.status, 'under_review')
        res = self._post(self.job, doc, 'approve-step', {'agent': 'J', 'comment': ''})
        self.assertEqual(res.status_code, 400, res.content)

    def test_all_confirm_transitions_to_pause_and_stays_frozen(self):
        doc = self._doc()
        r_step = self._step(doc, 'R', assignee=self.rfg)
        self._post(self.author, doc, 'request-pause', {'reason': '사유'})
        res = self._post(self.rfg, doc, 'confirm-pause', {'agent': 'R'})
        self.assertEqual(res.status_code, 200, res.content)
        doc.refresh_from_db()
        self.assertEqual(doc.status, 'pause')

        res = self._post(self.rfg, doc, 'approve-step', {'agent': 'R', 'comment': ''})
        self.assertEqual(res.status_code, 400, res.content)
        r_step.refresh_from_db()
        self.assertEqual(r_step.action, 'pending')

    # ----- 거부(reject-pause, 2026-08 추가) -----
    def test_target_step_can_reject_pause(self):
        doc = self._doc()
        self._step(doc, 'R', assignee=self.rfg)
        self._post(self.author, doc, 'request-pause', {'reason': '사유'})

        res = self._post(self.rfg, doc, 'reject-pause')
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(PauseRequest.objects.get(document=doc).state, 'rejected')
        doc.refresh_from_db()
        self.assertEqual(doc.status, 'under_review')

    def test_approval_resumes_after_pause_rejected(self):
        doc = self._doc()
        self._step(doc, 'R', assignee=self.rfg)
        self._post(self.author, doc, 'request-pause', {'reason': '사유'})
        self._post(self.rfg, doc, 'reject-pause')

        res = self._post(self.rfg, doc, 'approve-step', {'agent': 'R', 'comment': ''})
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(ApprovalStep.objects.get(document=doc, agent='R').action, 'approved')

    def test_one_of_parallel_targets_rejecting_invalidates_whole_request(self):
        """병렬 대상 중 R이 이미 확인했어도 J가 거부하면 요청 전체가 무효화된다."""
        doc = self._doc()
        self._step(doc, 'R', assignee=self.rfg)
        self._step(doc, 'J', assignee=self.job)
        self._post(self.author, doc, 'request-pause', {'reason': '사유'})
        self._post(self.rfg, doc, 'confirm-pause', {'agent': 'R'})

        res = self._post(self.job, doc, 'reject-pause')
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(PauseRequest.objects.get(document=doc).state, 'rejected')

        # 거부로 무효화됐으니 R도 다시 정상적으로 합의를 진행할 수 있어야 한다(이미 했던 확인은 무효).
        res = self._post(self.rfg, doc, 'approve-step', {'agent': 'R', 'comment': ''})
        self.assertEqual(res.status_code, 200, res.content)

    def test_outsider_cannot_reject_pause(self):
        doc = self._doc()
        self._step(doc, 'R', assignee=self.rfg)
        self._post(self.author, doc, 'request-pause', {'reason': '사유'})

        res = self._post(self.outsider, doc, 'reject-pause')
        self.assertEqual(res.status_code, 403)
        self.assertEqual(PauseRequest.objects.get(document=doc).state, 'requested')

    def test_reject_pause_without_active_request_is_400(self):
        doc = self._doc()
        self._step(doc, 'R', assignee=self.rfg)
        res = self._post(self.rfg, doc, 'reject-pause')
        self.assertEqual(res.status_code, 400)

    def test_pause_button_returns_after_reject(self):
        """거부되면 작성자가 다시 중단을 요청할 수 있다."""
        doc = self._doc()
        self._step(doc, 'R', assignee=self.rfg)
        self._post(self.author, doc, 'request-pause', {'reason': '1'})
        self._post(self.rfg, doc, 'reject-pause')
        res = self._post(self.author, doc, 'request-pause', {'reason': '2'})
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(PauseRequest.objects.filter(document=doc, state='requested').count(), 1)


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


class ReviewItemSyncTest(TestCase):
    """J 단계 검토 항목 — 마스터 목록 ↔ 문서 사본 동기화 (review_items.py).

    확정 정책(2026-08):
    - 채우기는 **J 단계가 생성되는 시점**에만 한다(J 를 거치지 않는 경로는 채우지 않는다).
    - 항목 추가·제목수정·삭제는 마스터와 '결재 진행 중 + 현재 회차 J 단계 pending' 문서에 전파된다.
    - 결재가 끝난 문서는 전파 대상이 아니다(그 시점 목록으로 굳는다).
    - 삭제 전파는 이미 확인한 검토자가 있는 문서를 건너뛴다.
    - 재상신하면 항목·검토자는 남고 확인 상태만 초기화되며, 새 J 단계에서 마스터를 따라잡는다.

    결재 경로는 'MAP 삭제'(PL 합의 직후 P·R·J·O 병렬 생성)을 쓴다 — J 단계에
    가장 짧게 도달하는 실제 경로다.
    """

    def setUp(self):
        import json
        from rest_framework.test import APIClient
        self._json = json
        self.client = APIClient()
        self.requester = UserProfile.objects.create(loginid='ri_req', mail='rireq@c.com', role='NONE')
        self.pl_user = UserProfile.objects.create(loginid='ri_pl', mail='ripl@c.com', role='PL')
        self.r_user = UserProfile.objects.create(loginid='ri_r', mail='rir@c.com', role='TE_R')
        self.p_user = UserProfile.objects.create(loginid='ri_p', mail='rip@c.com', role='TE_P')
        self.j_user = UserProfile.objects.create(loginid='ri_j', username='이재이', mail='rij@c.com', role='TE_J')
        self.j_user2 = UserProfile.objects.create(loginid='ri_j2', username='김검토', mail='rij2@c.com', role='TE_J')
        self.o_user = UserProfile.objects.create(loginid='ri_o', mail='rio@c.com', role='TE_O')

    # ----- 흐름 헬퍼 -----
    def _doc_at_j(self, title='ri'):
        """'MAP 삭제' 문서를 만들어 상신 → PL 합의까지 진행(= J 단계 pending 생성)."""
        doc = RequestDocument.objects.create(
            title=title, requester=self.requester, requester_name='요청자',
            requester_email='rireq@c.com', requester_department='dept',
            product_name='PROD-1', status='draft',
            additional_notes=self._json.dumps({
                'detail': {'request_purpose': RequestDocument.MAP_DELETE_EDIT_PURPOSE},
                'jayerRows': [],
            }),
        )
        self.client.force_authenticate(user=self.requester)
        r = self.client.post(f'/api/documents/{doc.id}/submit/',
                             {'designated_pl_loginid': self.pl_user.loginid}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        self.client.force_authenticate(user=self.pl_user)
        r = self.client.post(f'/api/documents/{doc.id}/peer-approve/', {}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        doc.refresh_from_db()
        self.assertTrue(
            ApprovalStep.objects.filter(document=doc, agent='J', action='pending').exists(),
            'J 단계가 생성돼야 이 테스트가 성립한다',
        )
        return doc

    def _claim_j(self, doc, user=None):
        self.client.force_authenticate(user=user or self.j_user)
        r = self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': 'J'}, format='json')
        self.assertEqual(r.status_code, 200, r.content)

    def _finish(self, doc):
        """P·R·J·O 를 모두 합의시켜 문서를 완료(approved) 상태로 만든다."""
        for agent, user in (('R', self.r_user), ('J', self.j_user), ('O', self.o_user), ('P', self.p_user)):
            self.client.force_authenticate(user=user)
            if agent == 'R':
                self.client.post(f'/api/documents/{doc.id}/assign-step/', {
                    'agent': agent, 'assignee_loginid': user.loginid, 'assignee_name': user.loginid,
                }, format='json')
            else:
                self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': agent}, format='json')
            r = self.client.post(f'/api/documents/{doc.id}/approve-step/',
                                 {'agent': agent, 'comment': ''}, format='json')
            self.assertEqual(r.status_code, 200, r.content)
        doc.refresh_from_db()
        self.assertEqual(doc.status, 'approved')
        return doc

    def _add_item(self, doc, title, user=None):
        self.client.force_authenticate(user=user or self.j_user)
        return self.client.post(f'/api/documents/{doc.id}/review-item-add/',
                                {'title': title}, format='json')

    def _titles(self, doc):
        return list(DocumentReviewItem.objects.filter(document=doc).values_list('title', flat=True))

    # ----- 채우기 시점 -----
    def test_j_stage_creation_fills_from_master(self):
        """J 단계가 열리는 순간 마스터의 활성 항목이 제목만 복사된다(검토자는 빈 상태)."""
        ReviewItemMaster.objects.create(title='항목1')
        ReviewItemMaster.objects.create(title='항목2')
        ReviewItemMaster.objects.create(title='지워진 항목', is_active=False)

        doc = self._doc_at_j()
        self.assertEqual(self._titles(doc), ['항목1', '항목2'],
                         '비활성 항목은 복사되지 않아야 한다')
        self.assertFalse(
            DocumentReviewItemReviewer.objects.filter(item__document=doc).exists(),
            '검토자는 상속되지 않는다 — 문서마다 새로 지정한다',
        )

    def test_only_map_route_without_j_stage_is_not_filled(self):
        """J 단계를 거치지 않는 문서에는 검토 항목을 채우지 않는다."""
        ReviewItemMaster.objects.create(title='항목1')
        doc = RequestDocument.objects.create(
            title='onlymap', requester=self.requester, requester_name='요청자',
            requester_email='rireq@c.com', requester_department='dept',
            product_name='PROD-1', status='draft',
            additional_notes=self._json.dumps({
                'detail': {'request_purpose': RequestDocument.ONLY_MAP_PURPOSE}, 'jayerRows': [],
            }),
        )
        self.client.force_authenticate(user=self.requester)
        self.client.post(f'/api/documents/{doc.id}/submit/',
                         {'designated_pl_loginid': self.pl_user.loginid}, format='json')
        self.client.force_authenticate(user=self.pl_user)
        self.client.post(f'/api/documents/{doc.id}/peer-approve/', {}, format='json')
        self.assertFalse(ApprovalStep.objects.filter(document=doc, agent='J').exists())
        self.assertEqual(self._titles(doc), [])

    # ----- 전파 (사용자 시나리오 A·B·C·D) -----
    def test_add_propagates_to_in_progress_documents_only(self):
        """C 에서 추가한 항목이 결재 중인 A·D 에는 들어가고, 완료된 B 에는 들어가지 않는다."""
        doc_a = self._doc_at_j('A')
        doc_b = self._finish(self._doc_at_j('B'))
        doc_c = self._doc_at_j('C')
        doc_d = self._doc_at_j('D')

        self._claim_j(doc_c)
        r = self._add_item(doc_c, '차용 Layer 정합성 확인')
        self.assertEqual(r.status_code, 200, r.content)

        self.assertEqual(self._titles(doc_c), ['차용 Layer 정합성 확인'])
        self.assertEqual(self._titles(doc_a), ['차용 Layer 정합성 확인'], 'A(결재중)에도 적용돼야 한다')
        self.assertEqual(self._titles(doc_d), ['차용 Layer 정합성 확인'], 'D(결재중)에도 적용돼야 한다')
        self.assertEqual(self._titles(doc_b), [], 'B(결재완료)는 그 시점 목록으로 굳는다')
        self.assertEqual(ReviewItemMaster.objects.filter(is_active=True).count(), 1,
                         '마스터에도 등록돼야 한다')

    def test_rename_propagates_to_master_and_in_progress_documents(self):
        doc_a = self._doc_at_j('A')
        doc_b = self._finish(self._doc_at_j('B'))
        doc_c = self._doc_at_j('C')
        self._claim_j(doc_c)
        self._add_item(doc_c, '원래 제목')
        # B 는 완료 문서지만 사본을 갖고 있는 상태를 만들어, 이름 변경이 닿지 않음을 확인한다.
        DocumentReviewItem.objects.create(
            document=doc_b, master=ReviewItemMaster.objects.get(title='원래 제목'), title='원래 제목',
        )

        item = DocumentReviewItem.objects.get(document=doc_c)
        r = self.client.post(f'/api/documents/{doc_c.id}/review-item-rename/',
                             {'item_id': item.id, 'title': '바뀐 제목'}, format='json')
        self.assertEqual(r.status_code, 200, r.content)

        self.assertEqual(self._titles(doc_c), ['바뀐 제목'])
        self.assertEqual(self._titles(doc_a), ['바뀐 제목'])
        self.assertEqual(self._titles(doc_b), ['원래 제목'], '완료 문서는 자기 시점 제목을 보존한다')
        self.assertEqual(ReviewItemMaster.objects.get(pk=item.master_id).title, '바뀐 제목')

    def test_delete_propagates_but_keeps_copies_with_confirmed_reviewer(self):
        """삭제는 마스터 비활성 + 전파, 단 이미 확인한 검토자가 있는 다른 문서 사본은 남긴다."""
        doc_a = self._doc_at_j('A')
        doc_c = self._doc_at_j('C')
        doc_d = self._doc_at_j('D')
        self._claim_j(doc_c)
        self._add_item(doc_c, '삭제될 항목')

        # A 에서는 검토자가 이미 확인을 마친 상태로 만든다.
        self._claim_j(doc_a, self.j_user2)
        item_a = DocumentReviewItem.objects.get(document=doc_a)
        self.client.force_authenticate(user=self.j_user2)
        r = self.client.post(f'/api/documents/{doc_a.id}/review-item-reviewer-add/',
                             {'item_id': item_a.id, 'loginid': self.j_user2.loginid}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        r = self.client.post(f'/api/documents/{doc_a.id}/review-item-confirm/',
                             {'item_id': item_a.id, 'confirmed': True}, format='json')
        self.assertEqual(r.status_code, 200, r.content)

        item_c = DocumentReviewItem.objects.get(document=doc_c)
        self.client.force_authenticate(user=self.j_user)
        r = self.client.post(f'/api/documents/{doc_c.id}/review-item-delete/',
                             {'item_id': item_c.id}, format='json')
        self.assertEqual(r.status_code, 200, r.content)

        self.assertEqual(self._titles(doc_c), [], '지시한 원본 문서에서는 삭제된다')
        self.assertEqual(self._titles(doc_d), [], '확인 기록이 없는 문서에서도 삭제된다')
        self.assertEqual(self._titles(doc_a), ['삭제될 항목'],
                         '확인 기록이 있는 문서에서는 남긴다')
        self.assertFalse(ReviewItemMaster.objects.get(title='삭제될 항목').is_active)

    def test_rejected_document_catches_up_when_j_reopens(self):
        """반려된 A 는 재상신으로 J 가 다시 열릴 때, 그동안 D 에 추가된 항목을 따라잡는다."""
        doc_a = self._doc_at_j('A')
        doc_d = self._doc_at_j('D')

        # A 에 항목 하나를 만들어 검토자 확인까지 마친 뒤 J 에서 반려한다.
        self._claim_j(doc_a)
        self._add_item(doc_a, '기존 항목')
        item_a = DocumentReviewItem.objects.get(document=doc_a, title='기존 항목')
        self.client.post(f'/api/documents/{doc_a.id}/review-item-reviewer-add/',
                         {'item_id': item_a.id, 'loginid': self.j_user.loginid}, format='json')
        self.client.post(f'/api/documents/{doc_a.id}/review-item-confirm/',
                         {'item_id': item_a.id, 'confirmed': True}, format='json')
        r = self.client.post(f'/api/documents/{doc_a.id}/reject-step/',
                             {'agent': 'J', 'comment': '반려'}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        doc_a.refresh_from_db()
        self.assertEqual(doc_a.status, 'rejected')

        # A 가 반려돼 있는 동안 D 에서 새 항목을 추가한다 → A 는 전파 대상이 아니다.
        self._claim_j(doc_d, self.j_user2)
        self._add_item(doc_d, '나중에 추가된 항목', user=self.j_user2)
        self.assertEqual(self._titles(doc_a), ['기존 항목'], '반려 문서에는 전파되지 않는다')

        # A 재상신 → PL 합의 → 새 회차 J 생성 시점에 마스터를 따라잡는다.
        self.client.force_authenticate(user=self.requester)
        r = self.client.post(f'/api/documents/{doc_a.id}/resubmit/',
                             {'designated_pl_loginid': self.pl_user.loginid}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        self.client.force_authenticate(user=self.pl_user)
        r = self.client.post(f'/api/documents/{doc_a.id}/peer-approve/', {}, format='json')
        self.assertEqual(r.status_code, 200, r.content)

        self.assertEqual(sorted(self._titles(doc_a)), ['기존 항목', '나중에 추가된 항목'])
        reviewer = DocumentReviewItemReviewer.objects.get(item__document=doc_a, loginid=self.j_user.loginid)
        self.assertFalse(reviewer.confirmed, '재상신 시 확인 상태만 초기화된다')
        self.assertIsNone(reviewer.confirmed_at)

    # ----- 인가 -----
    def test_edit_requires_claimed_and_unapproved_j_stage(self):
        doc = self._doc_at_j()

        r = self._add_item(doc, '선점 전')
        self.assertEqual(r.status_code, 403, '검토중 선점 전에는 읽기 전용이다')

        self._claim_j(doc)
        r = self._add_item(doc, '선점 후')
        self.assertEqual(r.status_code, 200, r.content)

        r = self._add_item(doc, 'O 팀 시도', user=self.o_user)
        self.assertEqual(r.status_code, 403, 'J 권한이 없으면 편집할 수 없다')

        self.client.force_authenticate(user=self.j_user)
        self.client.post(f'/api/documents/{doc.id}/approve-step/',
                         {'agent': 'J', 'comment': ''}, format='json')
        r = self._add_item(doc, '합의 후')
        self.assertEqual(r.status_code, 403, 'J 합의 후에는 검토 항목이 잠긴다')

    def test_confirmed_reviewer_cannot_be_removed(self):
        doc = self._doc_at_j()
        self._claim_j(doc)
        self._add_item(doc, '항목')
        item = DocumentReviewItem.objects.get(document=doc)

        self.client.post(f'/api/documents/{doc.id}/review-item-reviewer-add/',
                         {'item_id': item.id, 'loginid': self.j_user2.loginid}, format='json')
        r = self.client.post(f'/api/documents/{doc.id}/review-item-reviewer-remove/',
                             {'item_id': item.id, 'loginid': self.j_user2.loginid}, format='json')
        self.assertEqual(r.status_code, 200, '확인 전에는 해제할 수 있다')

        self.client.post(f'/api/documents/{doc.id}/review-item-reviewer-add/',
                         {'item_id': item.id, 'loginid': self.j_user2.loginid}, format='json')
        self.client.force_authenticate(user=self.j_user2)
        self.client.post(f'/api/documents/{doc.id}/review-item-confirm/',
                         {'item_id': item.id, 'confirmed': True}, format='json')
        self.client.force_authenticate(user=self.j_user)
        r = self.client.post(f'/api/documents/{doc.id}/review-item-reviewer-remove/',
                             {'item_id': item.id, 'loginid': self.j_user2.loginid}, format='json')
        self.assertEqual(r.status_code, 400, '확인한 검토자는 해제할 수 없다')

    def test_only_assigned_reviewer_can_confirm(self):
        doc = self._doc_at_j()
        self._claim_j(doc)
        self._add_item(doc, '항목')
        item = DocumentReviewItem.objects.get(document=doc)

        self.client.force_authenticate(user=self.j_user2)
        r = self.client.post(f'/api/documents/{doc.id}/review-item-confirm/',
                             {'item_id': item.id, 'confirmed': True}, format='json')
        self.assertEqual(r.status_code, 403, '검토자로 지정되지 않았으면 확인할 수 없다')

    def test_item_of_another_document_is_rejected(self):
        """다른 문서의 항목 id 를 보내도 이 문서에서 처리되지 않는다."""
        doc_c = self._doc_at_j('C')
        doc_d = self._doc_at_j('D')
        self._claim_j(doc_c)
        self._add_item(doc_c, '항목')
        self._claim_j(doc_d, self.j_user2)
        item_c = DocumentReviewItem.objects.get(document=doc_c)

        self.client.force_authenticate(user=self.j_user2)
        r = self.client.post(f'/api/documents/{doc_d.id}/review-item-rename/',
                             {'item_id': item_c.id, 'title': 'x'}, format='json')
        self.assertEqual(r.status_code, 400)

    # ----- 목록 필드 (결재 현황 MY 탭 조건) -----
    def test_my_pending_review_items_counts_only_my_unconfirmed(self):
        doc = self._doc_at_j()
        self._claim_j(doc)
        self._add_item(doc, '항목1')
        self._add_item(doc, '항목2')
        item1, item2 = DocumentReviewItem.objects.filter(document=doc).order_by('id')
        for item in (item1, item2):
            self.client.post(f'/api/documents/{doc.id}/review-item-reviewer-add/',
                             {'item_id': item.id, 'loginid': self.j_user2.loginid}, format='json')

        self.client.force_authenticate(user=self.j_user2)
        rows = {d['id']: d for d in self.client.get('/api/documents/').json()}
        self.assertEqual(rows[doc.id]['my_pending_review_items'], 2)

        self.client.post(f'/api/documents/{doc.id}/review-item-confirm/',
                         {'item_id': item1.id, 'confirmed': True}, format='json')
        rows = {d['id']: d for d in self.client.get('/api/documents/').json()}
        self.assertEqual(rows[doc.id]['my_pending_review_items'], 1)

        self.client.force_authenticate(user=self.o_user)
        rows = {d['id']: d for d in self.client.get('/api/documents/').json()}
        self.assertEqual(rows[doc.id]['my_pending_review_items'], 0,
                         '검토자로 지정되지 않은 사용자에게는 0 이어야 한다')


class RejectionSnapshotTest(TestCase):
    """반려 이력(RejectionSnapshot) 적재 — 이력 조회 '반려' 탭의 데이터 원본.

    반려는 문서 status 만 바꾸고 재상신하면 되돌아가므로, 반려 시점이 별도 테이블에
    남는지(그리고 이후 문서 변경에 흔들리지 않는지)를 실제 API 흐름으로 확인한다.
    """

    def setUp(self):
        import json
        from rest_framework.test import APIClient
        self._json = json
        self.client = APIClient()

        self.requester = UserProfile.objects.create(loginid='req', mail='req@c.com', role='NONE')
        self.pl_user = UserProfile.objects.create(loginid='pl1', mail='pl1@c.com', role='PL')
        self.r_user = UserProfile.objects.create(loginid='r1', mail='r1@c.com', role='TE_R')
        self.e_user = UserProfile.objects.create(loginid='e1', mail='e1@c.com', role='TE_E')
        self.master = UserProfile.objects.create(loginid='m1', mail='m1@c.com', role='MASTER')

    # ----- 헬퍼 -----

    def _make_doc(self, detail=None, jayer_rows=None):
        payload = {'detail': detail or {}, 'jayerRows': jayer_rows or []}
        return RequestDocument.objects.create(
            title='라인1(신규)_MAP(NEW)_요청서', requester=self.requester, requester_name='요청자',
            requester_email='req@c.com', requester_department='개발팀',
            product_name='PROD-1', status='draft',
            additional_notes=self._json.dumps(payload, ensure_ascii=False),
        )

    def _submit(self, doc):
        self.client.force_authenticate(user=self.requester)
        r = self.client.post(f'/api/documents/{doc.id}/submit/',
                             {'designated_pl_loginid': self.pl_user.loginid}, format='json')
        self.assertEqual(r.status_code, 200, r.content)

    def _resubmit(self, doc):
        self.client.force_authenticate(user=self.requester)
        r = self.client.post(f'/api/documents/{doc.id}/resubmit/',
                             {'designated_pl_loginid': self.pl_user.loginid}, format='json')
        self.assertEqual(r.status_code, 200, r.content)

    def _advance_to_r(self, doc):
        """제출 → PL 합의 → R 담당자 지정 까지. R 단계가 pending 인 상태로 둔다."""
        self.client.force_authenticate(user=self.pl_user)
        r = self.client.post(f'/api/documents/{doc.id}/peer-approve/', {}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        self.client.force_authenticate(user=self.r_user)
        r = self.client.post(f'/api/documents/{doc.id}/assign-step/', {
            'agent': 'R', 'assignee_loginid': self.r_user.loginid, 'assignee_name': 'r1',
        }, format='json')
        self.assertEqual(r.status_code, 200, r.content)

    def _reject_at_r(self, doc, comment='R 반려 사유'):
        self.client.force_authenticate(user=self.r_user)
        r = self.client.post(f'/api/documents/{doc.id}/reject-step/',
                             {'agent': 'R', 'comment': comment}, format='json')
        self.assertEqual(r.status_code, 200, r.content)

    # ----- 적재 -----

    def test_reject_step_creates_snapshot(self):
        doc = self._make_doc(detail={'line': '라인1'})
        self._submit(doc)
        self._advance_to_r(doc)
        self._reject_at_r(doc)

        snaps = RejectionSnapshot.objects.all()
        self.assertEqual(snaps.count(), 1)
        snap = snaps.first()
        self.assertEqual(snap.source_document_id, doc.id)
        self.assertEqual(snap.title, doc.title)
        self.assertEqual(snap.product_name, 'PROD-1')
        self.assertEqual(snap.requester_name, '요청자')
        self.assertEqual(snap.requester_department, '개발팀')
        self.assertEqual(snap.rejected_agent, 'R')
        self.assertEqual(snap.rejected_by_loginid, 'r1')
        self.assertEqual(snap.reject_comment, 'R 반려 사유')
        self.assertEqual(snap.round, 1)
        self.assertIsNotNone(snap.rejected_at)
        self.assertEqual(snap.get_detail().get('detail', {}).get('line'), '라인1')

    def test_snapshot_keeps_rejected_step_in_approval_steps_json(self):
        """결재 경로 탭을 반려 당시로 재현할 수 있도록, 단계 JSON 에 반려 표시가 담겨야 한다."""
        doc = self._make_doc()
        self._submit(doc)
        self._advance_to_r(doc)
        self._reject_at_r(doc)

        steps = self._json.loads(RejectionSnapshot.objects.first().approval_steps)
        rejected = [s for s in steps if s['action'] == 'rejected']
        self.assertEqual(len(rejected), 1)
        self.assertEqual(rejected[0]['agent'], 'R')
        self.assertEqual(rejected[0]['assignee_loginid'], 'r1')

    def test_peer_reject_creates_snapshot(self):
        """지정 PL 반려도 동일하게 적재된다."""
        doc = self._make_doc()
        self._submit(doc)
        self.client.force_authenticate(user=self.pl_user)
        r = self.client.post(f'/api/documents/{doc.id}/peer-reject/',
                             {'comment': 'PL 반려'}, format='json')
        self.assertEqual(r.status_code, 200, r.content)

        snap = RejectionSnapshot.objects.get()
        self.assertEqual(snap.rejected_agent, 'PL')
        self.assertEqual(snap.rejected_by_loginid, 'pl1')
        self.assertEqual(snap.reject_comment, 'PL 반려')

    def test_three_rejections_accumulate_three_rows(self):
        """3번 반려되면 3행. 회차도 1/2/3 으로 쌓인다."""
        doc = self._make_doc()
        self._submit(doc)
        for _ in range(3):
            self._advance_to_r(doc)
            self._reject_at_r(doc)
            doc.refresh_from_db()
            self.assertEqual(doc.status, 'rejected')
            self._resubmit(doc)

        self.assertEqual(RejectionSnapshot.objects.count(), 3)
        self.assertEqual(
            list(RejectionSnapshot.objects.order_by('round').values_list('round', flat=True)),
            [1, 2, 3],
        )

    def test_snapshot_is_frozen_after_document_changes(self):
        """재상신하며 내용을 바꿔도 이미 적재된 스냅샷은 반려 당시 그대로여야 한다."""
        doc = self._make_doc(detail={'line': '라인1', 'process_id': 'BEFORE'})
        self._submit(doc)
        self._advance_to_r(doc)
        self._reject_at_r(doc)

        doc.refresh_from_db()
        doc.title = '수정된 제목'
        doc.additional_notes = self._json.dumps(
            {'detail': {'line': '라인5', 'process_id': 'AFTER'}, 'jayerRows': []}, ensure_ascii=False
        )
        doc.save()

        snap = RejectionSnapshot.objects.get()
        self.assertEqual(snap.title, '라인1(신규)_MAP(NEW)_요청서')
        self.assertEqual(snap.get_detail()['detail']['process_id'], 'BEFORE')
        self.assertEqual(snap.get_detail()['detail']['line'], '라인1')

    def test_mask_revision_request_does_not_create_snapshot(self):
        """E(MASK)의 '수정 요청'은 반려가 아니다 — 문서 status 도 스냅샷도 바뀌지 않는다."""
        doc = self._make_doc(jayer_rows=[{'pp': 'PLEL'}])
        self._submit(doc)
        self._advance_to_r(doc)
        self.client.force_authenticate(user=self.r_user)
        r = self.client.post(f'/api/documents/{doc.id}/approve-step/',
                             {'agent': 'R', 'comment': ''}, format='json')
        self.assertEqual(r.status_code, 200, r.content)

        self.client.force_authenticate(user=self.e_user)
        r = self.client.post(f'/api/documents/{doc.id}/claim-step/', {'agent': 'E'}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        r = self.client.post(f'/api/documents/{doc.id}/reject-step/',
                             {'agent': 'E', 'comment': '수정해주세요'}, format='json')
        self.assertEqual(r.status_code, 200, r.content)

        doc.refresh_from_db()
        self.assertEqual(doc.status, 'under_review')
        self.assertEqual(RejectionSnapshot.objects.count(), 0)

    def test_snapshot_survives_document_deletion(self):
        """원본 문서를 지워도 이력은 남는다(document 만 끊기고 source_document_id 는 유지)."""
        doc = self._make_doc()
        self._submit(doc)
        self._advance_to_r(doc)
        self._reject_at_r(doc)
        doc_id = doc.id

        self.client.force_authenticate(user=self.master)
        r = self.client.post(f'/api/documents/{doc_id}/delete/', {}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        self.assertFalse(RequestDocument.objects.filter(id=doc_id).exists())

        snap = RejectionSnapshot.objects.get()
        self.assertIsNone(snap.document_id)
        self.assertEqual(snap.source_document_id, doc_id)
        self.assertEqual(snap.title, '라인1(신규)_MAP(NEW)_요청서')

    # ----- API -----

    def test_list_api_returns_newest_first(self):
        doc = self._make_doc()
        self._submit(doc)
        for _ in range(2):
            self._advance_to_r(doc)
            self._reject_at_r(doc)
            doc.refresh_from_db()
            self._resubmit(doc)

        self.client.force_authenticate(user=self.requester)
        res = self.client.get('/api/rejection-snapshots/')
        self.assertEqual(res.status_code, 200, res.content)
        rows = res.json()
        self.assertEqual(len(rows), 2)
        self.assertEqual([row['round'] for row in rows], [2, 1], '반려일 최신순이어야 한다')
        self.assertIsInstance(rows[0]['approval_steps'], list,
                             'approval_steps 는 문자열이 아니라 배열로 내려가야 한다')

    def test_list_api_supports_search(self):
        doc = self._make_doc()
        self._submit(doc)
        self._advance_to_r(doc)
        self._reject_at_r(doc)

        self.client.force_authenticate(user=self.requester)
        self.assertEqual(len(self.client.get('/api/rejection-snapshots/?search=PROD-1').json()), 1)
        self.assertEqual(len(self.client.get('/api/rejection-snapshots/?search=없는제품').json()), 0)

    def test_delete_allowed_for_master_only(self):
        doc = self._make_doc()
        self._submit(doc)
        self._advance_to_r(doc)
        self._reject_at_r(doc)
        snap_id = RejectionSnapshot.objects.get().id

        self.client.force_authenticate(user=self.requester)
        res = self.client.delete(f'/api/rejection-snapshots/{snap_id}/')
        self.assertEqual(res.status_code, 403)
        self.assertTrue(RejectionSnapshot.objects.filter(id=snap_id).exists())

        self.client.force_authenticate(user=self.master)
        res = self.client.delete(f'/api/rejection-snapshots/{snap_id}/')
        self.assertEqual(res.status_code, 204, res.content)
        self.assertFalse(RejectionSnapshot.objects.filter(id=snap_id).exists())

    def test_snapshot_cannot_be_created_through_api(self):
        """적재는 반려 API 에서만 일어난다 — 직접 POST 는 허용하지 않는다."""
        self.client.force_authenticate(user=self.master)
        res = self.client.post('/api/rejection-snapshots/', {'title': 'x'}, format='json')
        self.assertEqual(res.status_code, 405)


class MailLineFilterTest(TestCase):
    """라인별 메일 수신 설정(receive_all_mail / mail_lines) 필터 검증.

    '전체 받기'가 켜져 있으면(기본값) 전부 받고, 끈 뒤 고른 라인의 메일만 받는다.
    """

    def setUp(self):
        import json
        self.line1 = Line.objects.create(name='라인1', order=1)
        self.line3 = Line.objects.create(name='라인3', order=3)
        self.requester = UserProfile.objects.create(
            loginid='mlf_req', mail='mlf_req@company.com', role='NONE'
        )
        self.doc = _make_document(self.requester)
        self.doc.additional_notes = json.dumps({'detail': {'line': '라인1'}})
        self.doc.save()

    def _make_j(self, loginid, lines, receive_all=False):
        """TE_J 사용자 생성. 기본은 '전체 받기'를 끄고 지정한 라인만 받는 상태."""
        user = UserProfile.objects.create(
            loginid=loginid, mail=f'{loginid}@company.com', role='TE_J',
            receive_all_mail=receive_all,
        )
        user.mail_lines.set(lines)
        return user

    def test_team_broadcast_excludes_user_who_turned_line_off(self):
        """팀 전체 발송에서 라인1을 끈 사람만 빠진다."""
        self._make_j('mlf_j_on', [self.line1, self.line3])
        self._make_j('mlf_j_off', [self.line3])
        step = ApprovalStep.objects.create(document=self.doc, agent='J')
        recipients = mailer.resolve_stage_recipients(self.doc, 'J', step)
        self.assertIn('mlf_j_on@company.com', recipients)
        self.assertNotIn('mlf_j_off@company.com', recipients)

    def test_assigned_user_with_line_off_gets_no_mail(self):
        """담당자로 지정돼 있어도 그 라인을 껐으면 메일이 나가지 않는다."""
        user = self._make_j('mlf_j_assigned', [self.line3])
        step = ApprovalStep.objects.create(document=self.doc, agent='J', assignee=user)
        self.assertEqual(mailer.resolve_stage_recipients(self.doc, 'J', step), [])
        self.assertIsNone(mailer.enqueue_stage_arrival(self.doc, 'J', step))

    def test_pl_role_is_not_filtered(self):
        """PL 은 라인 설정 대상이 아니라 mail_lines 가 비어 있어도 그대로 받는다."""
        pl = UserProfile.objects.create(loginid='mlf_pl', mail='mlf_pl@company.com', role='PL')
        step = ApprovalStep.objects.create(document=self.doc, agent='PL', assignee=pl)
        self.assertEqual(
            mailer.resolve_stage_recipients(self.doc, 'PL', step), ['mlf_pl@company.com']
        )

    def test_document_without_line_is_not_filtered(self):
        """라인 값이 없는 의뢰서는 필터가 성립하지 않아 전원 수신한다."""
        self._make_j('mlf_j_noline', [])
        doc = _make_document(self.requester)  # additional_notes 없음 → detail.line 없음
        step = ApprovalStep.objects.create(document=doc, agent='J')
        self.assertIn('mlf_j_noline@company.com', mailer.resolve_stage_recipients(doc, 'J', step))

    def test_notifier_recipients_are_filtered(self):
        """통보처로 지정된 사람도 라인을 껐으면 통보 메일을 받지 않는다."""
        import json
        self._make_j('mlf_noti_on', [self.line1])
        self._make_j('mlf_noti_off', [self.line3])
        self.doc.additional_notes = json.dumps({'detail': {
            'line': '라인1',
            'notifiers': [{'loginid': 'mlf_noti_on'}, {'loginid': 'mlf_noti_off'}],
        }})
        self.doc.save()
        recipients = mailer.resolve_notifier_recipients(self.doc)
        self.assertIn('mlf_noti_on@company.com', recipients)
        self.assertNotIn('mlf_noti_off@company.com', recipients)

    def test_reject_recipients_are_filtered(self):
        """반려 메일(잔여 결재선 팀 브로드캐스트)도 필터를 탄다."""
        self._make_j('mlf_rej_on', [self.line1])
        self._make_j('mlf_rej_off', [self.line3])
        ApprovalStep.objects.create(document=self.doc, agent='R', round=1, action='rejected')
        recipients = mailer.resolve_reject_recipients(self.doc)
        self.assertIn('mlf_rej_on@company.com', recipients)
        self.assertNotIn('mlf_rej_off@company.com', recipients)

    def test_voc_mail_is_not_filtered(self):
        """VOC 등록 메일은 MASTER 전원에게 가며, 라인 개념이 없어 필터를 타지 않는다."""
        master = UserProfile.objects.create(
            loginid='mlf_master', mail='mlf_master@company.com', role='MASTER'
        )
        master.mail_lines.set([self.line3])  # 라인1을 껐지만 VOC 메일은 그대로 받는다
        self.assertEqual(
            mailer._resolve_voc_master_recipients(), ['mlf_master@company.com']
        )

    def test_shared_address_is_kept_when_someone_still_receives(self):
        """같은 주소를 쓰는 사람 중 한 명이라도 받아야 하면 주소를 빼지 않는다."""
        keep = UserProfile.objects.create(
            loginid='mlf_share_on', mail='shared@company.com', role='TE_J',
            receive_all_mail=False,
        )
        keep.mail_lines.set([self.line1])
        drop = UserProfile.objects.create(
            loginid='mlf_share_off', mail='shared@company.com', role='TE_J',
            receive_all_mail=False,
        )
        drop.mail_lines.set([self.line3])
        step = ApprovalStep.objects.create(document=self.doc, agent='J')
        self.assertIn('shared@company.com', mailer.resolve_stage_recipients(self.doc, 'J', step))


class MailLinesApiTest(TestCase):
    """PATCH /api/users/{id}/mail-lines/ 권한·검증 규칙."""

    def setUp(self):
        from rest_framework.test import APIClient
        self.client = APIClient()
        self.line1 = Line.objects.create(name='라인1', order=1)
        self.line3 = Line.objects.create(name='라인3', order=3)
        self.owner = UserProfile.objects.create(
            loginid='mla_owner', mail='mla_owner@company.com', role='TE_J',
            receive_all_mail=False,
        )
        self.owner.mail_lines.set([self.line1, self.line3])
        self.other = UserProfile.objects.create(
            loginid='mla_other', mail='mla_other@company.com', role='TE_J'
        )
        self.master = UserProfile.objects.create(
            loginid='mla_master', mail='mla_master@company.com', role='MASTER'
        )
        self.pl = UserProfile.objects.create(
            loginid='mla_pl', mail='mla_pl@company.com', role='PL'
        )

    def _patch(self, user_id, lines):
        return self.client.patch(
            f'/api/users/{user_id}/mail-lines/',
            {'receive_all': False, 'lines': lines}, format='json',
        )

    def test_owner_can_update_own_lines(self):
        self.client.force_authenticate(user=self.owner)
        res = self._patch(self.owner.id, ['라인3'])
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json()['mail_lines'], ['라인3'])
        self.assertEqual(
            list(self.owner.mail_lines.values_list('name', flat=True)), ['라인3']
        )

    def test_empty_list_turns_all_lines_off(self):
        self.client.force_authenticate(user=self.owner)
        res = self._patch(self.owner.id, [])
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(self.owner.mail_lines.count(), 0)

    def test_other_user_cannot_update(self):
        self.client.force_authenticate(user=self.other)
        self.assertEqual(self._patch(self.owner.id, []).status_code, 403)

    def test_master_can_update_anyone(self):
        self.client.force_authenticate(user=self.master)
        res = self._patch(self.owner.id, ['라인1'])
        self.assertEqual(res.status_code, 200, res.content)

    def test_pl_role_is_rejected(self):
        self.client.force_authenticate(user=self.pl)
        self.assertEqual(self._patch(self.pl.id, ['라인1']).status_code, 400)

    def test_unknown_line_is_rejected(self):
        self.client.force_authenticate(user=self.owner)
        self.assertEqual(self._patch(self.owner.id, ['라인9']).status_code, 400)

    def test_invalid_payload_is_rejected(self):
        self.client.force_authenticate(user=self.owner)
        res = self.client.patch(
            f'/api/users/{self.owner.id}/mail-lines/', {'lines': '라인1'}, format='json'
        )
        self.assertEqual(res.status_code, 400)


class ReceiveAllMailTest(TestCase):
    """'전체 받기'(receive_all_mail) 동작 검증 — 기본값이자 라인 필터를 무력화하는 상태."""

    def setUp(self):
        import json
        from rest_framework.test import APIClient
        self.client = APIClient()
        self.line1 = Line.objects.create(name='라인1', order=1)
        self.line3 = Line.objects.create(name='라인3', order=3)
        self.requester = UserProfile.objects.create(
            loginid='ram_req', mail='ram_req@company.com', role='NONE'
        )
        self.doc = _make_document(self.requester)
        self.doc.additional_notes = json.dumps({'detail': {'line': '라인1'}})
        self.doc.save()

    def test_new_user_defaults_to_receive_all(self):
        """새 사용자는 라인을 하나도 고르지 않아도 전체 받기 상태로 시작한다."""
        user = UserProfile.objects.create(
            loginid='ram_new', mail='ram_new@company.com', role='TE_J'
        )
        self.assertTrue(user.receive_all_mail)
        self.assertEqual(user.mail_lines.count(), 0)
        step = ApprovalStep.objects.create(document=self.doc, agent='J')
        self.assertIn('ram_new@company.com', mailer.resolve_stage_recipients(self.doc, 'J', step))

    def test_receive_all_user_gets_mail_for_any_line(self):
        """전체 받기 사용자는 어느 라인의 의뢰서든 받는다."""
        import json
        user = UserProfile.objects.create(
            loginid='ram_all', mail='ram_all@company.com', role='TE_J', receive_all_mail=True
        )
        user.mail_lines.set([self.line3])  # 남아 있어도 전체 받기가 우선한다
        for line in ('라인1', '라인3', '라인5'):
            self.doc.additional_notes = json.dumps({'detail': {'line': line}})
            self.doc.save()
            step = ApprovalStep.objects.create(document=self.doc, agent='J')
            self.assertIn(
                'ram_all@company.com', mailer.resolve_stage_recipients(self.doc, 'J', step),
                f'{line} 의뢰서에서 전체 받기 사용자가 빠졌다',
            )

    def test_api_receive_all_clears_selected_lines(self):
        """전체 받기를 켜면 개별 라인 선택은 비워진다."""
        user = UserProfile.objects.create(
            loginid='ram_api', mail='ram_api@company.com', role='TE_J', receive_all_mail=False
        )
        user.mail_lines.set([self.line1])
        self.client.force_authenticate(user=user)
        res = self.client.patch(
            f'/api/users/{user.id}/mail-lines/', {'receive_all': True}, format='json'
        )
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json(), {'id': user.id, 'receive_all_mail': True, 'mail_lines': []})
        user.refresh_from_db()
        self.assertTrue(user.receive_all_mail)
        self.assertEqual(user.mail_lines.count(), 0)

    def test_api_selecting_lines_turns_receive_all_off(self):
        """라인을 고르면 전체 받기가 해제된다."""
        user = UserProfile.objects.create(
            loginid='ram_api2', mail='ram_api2@company.com', role='TE_J'
        )
        self.client.force_authenticate(user=user)
        res = self.client.patch(
            f'/api/users/{user.id}/mail-lines/',
            {'receive_all': False, 'lines': ['라인1']}, format='json',
        )
        self.assertEqual(res.status_code, 200, res.content)
        user.refresh_from_db()
        self.assertFalse(user.receive_all_mail)
        self.assertEqual(list(user.mail_lines.values_list('name', flat=True)), ['라인1'])

    def test_api_rejects_non_boolean_receive_all(self):
        user = UserProfile.objects.create(
            loginid='ram_api3', mail='ram_api3@company.com', role='TE_J'
        )
        self.client.force_authenticate(user=user)
        res = self.client.patch(
            f'/api/users/{user.id}/mail-lines/', {'receive_all': 'yes'}, format='json'
        )
        self.assertEqual(res.status_code, 400)


class SalesAgreerStageTests(TestCase):
    """영업/기술지원 합의자(SA) — PL 검토와 병렬인 결재 단계.

    - 상신 시 PL 단계와 같은 회차에 병렬로 생성된다.
    - PL 전원 + SA 전원이 합의해야 다음 단계(R)가 열린다(어느 쪽이 먼저 끝나든 무관).
    - 지정하지 않으면 SA 단계 자체가 없고, PL 만으로 진행된다('해당없음').
    - 예외 구역 값을 기본값과 다르게 바꾼 의뢰서는 지정(또는 미지정 사유)이 필수다.
    - SA 반려는 PL 반려와 동일하게 문서를 즉시 반려한다.
    """

    def setUp(self):
        import json
        from rest_framework.test import APIClient
        self._json = json
        self.client = APIClient()
        self.requester = UserProfile.objects.create(loginid='sreq', mail='sreq@c.com', role='NONE')
        self.pl_user = UserProfile.objects.create(loginid='spl', mail='spl@c.com', role='PL')
        self.sa_user = UserProfile.objects.create(loginid='ssa', mail='ssa@c.com', role='PL')
        self.sa_user2 = UserProfile.objects.create(loginid='ssa2', mail='ssa2@c.com', role='PL')
        self.not_pl = UserProfile.objects.create(loginid='snp', mail='snp@c.com', role='TE_R')

    def _make_doc(self, detail_extra=None):
        detail = {'request_purpose': '신규'}
        detail.update(detail_extra or {})
        return RequestDocument.objects.create(
            title='sa-doc', requester=self.requester, requester_name='요청자',
            requester_email='sreq@c.com', requester_department='dept',
            product_name='PROD-1', status='draft',
            additional_notes=self._json.dumps({'detail': detail, 'jayerRows': []}),
        )

    def _agreers(self, *users):
        return [{'loginid': u.loginid, 'name': u.loginid} for u in users]

    def _submit(self, doc):
        self.client.force_authenticate(user=self.requester)
        return self.client.post(f'/api/documents/{doc.id}/submit/',
                                {'designated_pl_loginid': self.pl_user.loginid}, format='json')

    # ---- 단계 생성 ----

    def test_sa_steps_created_in_parallel_with_pl(self):
        """지정한 합의자 수만큼 SA 단계가 PL 과 같은 회차에 병렬로 생성된다."""
        doc = self._make_doc({'sales_agreers': self._agreers(self.sa_user, self.sa_user2)})
        self.assertEqual(self._submit(doc).status_code, 200)
        sa_steps = list(ApprovalStep.objects.filter(document=doc, agent='SA', round=1))
        self.assertEqual(len(sa_steps), 2)
        for st in sa_steps:
            self.assertTrue(st.is_parallel, 'SA 는 PL 과 병렬인 단계여야 한다')
            self.assertEqual(st.action, 'pending')
        self.assertEqual(
            {s.assignee.loginid for s in sa_steps}, {'ssa', 'ssa2'}
        )

    def test_no_sa_steps_when_not_designated(self):
        """합의자를 지정하지 않으면 SA 단계를 만들지 않는다(화면에서 '해당없음')."""
        doc = self._make_doc()
        self.assertEqual(self._submit(doc).status_code, 200)
        self.assertFalse(ApprovalStep.objects.filter(document=doc, agent='SA').exists())

    def test_non_pl_user_rejected_as_agreer(self):
        """PL 권한자가 아닌 사람은 합의자로 지정할 수 없다."""
        doc = self._make_doc({'sales_agreers': self._agreers(self.not_pl)})
        res = self._submit(doc)
        self.assertEqual(res.status_code, 400)
        self.assertIn('영업/기술지원 합의자', res.json()['error'])

    # ---- 진행 판정 ----

    def test_r_not_created_until_sa_also_approves(self):
        """PL 이 먼저 합의해도 SA 가 남아 있으면 R 단계가 열리지 않는다."""
        doc = self._make_doc({'sales_agreers': self._agreers(self.sa_user)})
        self.assertEqual(self._submit(doc).status_code, 200)

        self.client.force_authenticate(user=self.pl_user)
        self.assertEqual(self.client.post(f'/api/documents/{doc.id}/peer-approve/', {},
                                          format='json').status_code, 200)
        self.assertFalse(ApprovalStep.objects.filter(document=doc, agent='R').exists(),
                         'SA 합의 전에는 R 이 생기면 안 된다')

        self.client.force_authenticate(user=self.sa_user)
        self.assertEqual(self.client.post(f'/api/documents/{doc.id}/sales-agree/', {},
                                          format='json').status_code, 200)
        self.assertTrue(ApprovalStep.objects.filter(document=doc, agent='R', round=1).exists(),
                        'PL·SA 전원 합의 시 R 이 열려야 한다')

    def test_sa_first_then_pl_also_opens_r(self):
        """순서가 반대여도(SA 먼저) 마지막 합의 시점에 R 이 열린다 — 병렬이므로."""
        doc = self._make_doc({'sales_agreers': self._agreers(self.sa_user)})
        self.assertEqual(self._submit(doc).status_code, 200)

        self.client.force_authenticate(user=self.sa_user)
        self.assertEqual(self.client.post(f'/api/documents/{doc.id}/sales-agree/', {},
                                          format='json').status_code, 200)
        self.assertFalse(ApprovalStep.objects.filter(document=doc, agent='R').exists())

        self.client.force_authenticate(user=self.pl_user)
        self.assertEqual(self.client.post(f'/api/documents/{doc.id}/peer-approve/', {},
                                          format='json').status_code, 200)
        self.assertTrue(ApprovalStep.objects.filter(document=doc, agent='R', round=1).exists())

    def test_all_sa_must_approve(self):
        """합의자가 여럿이면 전원 합의해야 한다(AND)."""
        doc = self._make_doc({'sales_agreers': self._agreers(self.sa_user, self.sa_user2)})
        self.assertEqual(self._submit(doc).status_code, 200)
        self.client.force_authenticate(user=self.pl_user)
        self.client.post(f'/api/documents/{doc.id}/peer-approve/', {}, format='json')
        self.client.force_authenticate(user=self.sa_user)
        self.client.post(f'/api/documents/{doc.id}/sales-agree/', {}, format='json')
        self.assertFalse(ApprovalStep.objects.filter(document=doc, agent='R').exists(),
                         '합의자 1명이 남았으면 아직 진행하지 않는다')
        self.client.force_authenticate(user=self.sa_user2)
        self.client.post(f'/api/documents/{doc.id}/sales-agree/', {}, format='json')
        self.assertTrue(ApprovalStep.objects.filter(document=doc, agent='R', round=1).exists())

    def test_other_user_cannot_agree(self):
        """본인 SA 단계가 없는 사람은 합의할 수 없다."""
        doc = self._make_doc({'sales_agreers': self._agreers(self.sa_user)})
        self.assertEqual(self._submit(doc).status_code, 200)
        self.client.force_authenticate(user=self.sa_user2)
        res = self.client.post(f'/api/documents/{doc.id}/sales-agree/', {}, format='json')
        self.assertEqual(res.status_code, 400)

    # ---- 반려 ----

    def test_sa_reject_rejects_document(self):
        """합의자 반려는 PL 반려와 동일하게 문서를 즉시 반려한다."""
        doc = self._make_doc({'sales_agreers': self._agreers(self.sa_user)})
        self.assertEqual(self._submit(doc).status_code, 200)
        self.client.force_authenticate(user=self.sa_user)
        res = self.client.post(f'/api/documents/{doc.id}/sales-reject/',
                               {'comment': '검토 필요'}, format='json')
        self.assertEqual(res.status_code, 200, res.content)
        doc.refresh_from_db()
        self.assertEqual(doc.status, 'rejected')
        self.assertEqual(
            ApprovalStep.objects.get(document=doc, agent='SA', round=1).action, 'rejected'
        )

    # ---- 필수 지정 판정 (예외 구역) ----

    def test_required_when_ea_value_differs_from_default(self):
        """예외 구역 값을 기본값(300)과 다르게 바꾸면 합의자 지정이 필수다."""
        doc = self._make_doc({'ea_change': '변경 있음', 'ea_value': '350'})
        res = self._submit(doc)
        self.assertEqual(res.status_code, 400)
        self.assertIn('영업/기술지원 합의자', res.json()['error'])

    def test_not_required_when_ea_value_is_default(self):
        """'변경 있음'이어도 값이 기본값 그대로면 필수가 아니다."""
        doc = self._make_doc({'ea_change': '변경 있음', 'ea_value': '300'})
        self.assertEqual(self._submit(doc).status_code, 200)

    def test_not_required_when_no_change(self):
        """'변경 없음'이면 필수가 아니다."""
        doc = self._make_doc({'ea_change': '변경 없음', 'ea_value': '300'})
        self.assertEqual(self._submit(doc).status_code, 200)

    def test_prodc_default_is_500(self):
        """C가문(only_prodc=Yes)의 기본값은 500 이라, 500 은 필수 조건에 걸리지 않는다."""
        base = {'ea_change': '변경 있음', 'only_prodc': 'Yes', 'post_approvers': [
            {'loginid': self.sa_user.loginid, 'name': 'x'}]}
        ok_doc = self._make_doc(dict(base, ea_value='500'))
        self.assertEqual(self._submit(ok_doc).status_code, 200)

        ng_doc = self._make_doc(dict(base, ea_value='300'))
        res = self._submit(ng_doc)
        self.assertEqual(res.status_code, 400, 'C가문에서 300 은 기본값이 아니라 합의 대상이다')
        self.assertIn('영업/기술지원 합의자', res.json()['error'])

    def test_none_reason_satisfies_requirement(self):
        """지정하지 않는 사유를 남기면 합의자 없이도 상신할 수 있다."""
        doc = self._make_doc({
            'ea_change': '변경 있음', 'ea_value': '350',
            'sales_agreer_none_reason': '영업 협의 완료(메일 참조)',
        })
        self.assertEqual(self._submit(doc).status_code, 200)
        self.assertFalse(ApprovalStep.objects.filter(document=doc, agent='SA').exists())

    # ---- 재상신 ----

    def test_resubmit_recreates_sa_steps_in_new_round(self):
        """재상신하면 새 회차에 SA 단계가 다시 만들어지고 이전 회차는 이력으로 남는다."""
        doc = self._make_doc({'sales_agreers': self._agreers(self.sa_user)})
        self.assertEqual(self._submit(doc).status_code, 200)
        self.client.force_authenticate(user=self.sa_user)
        self.client.post(f'/api/documents/{doc.id}/sales-reject/', {'comment': 'x'}, format='json')
        doc.refresh_from_db()
        self.assertEqual(doc.status, 'rejected')

        self.client.force_authenticate(user=self.requester)
        res = self.client.post(f'/api/documents/{doc.id}/resubmit/',
                               {'designated_pl_loginid': self.pl_user.loginid}, format='json')
        self.assertEqual(res.status_code, 200, res.content)
        self.assertTrue(
            ApprovalStep.objects.filter(document=doc, agent='SA', round=2, action='pending').exists()
        )
        self.assertEqual(
            ApprovalStep.objects.get(document=doc, agent='SA', round=1).action, 'rejected'
        )


class DirectHistoryRegisterTest(TestCase):
    """MASTER 의 '이력 바로 등록'(POST /documents/{id}/direct-approve/) 검증.

    결재 경로를 타지 않고 draft → approved 로 바로 넘어가며, 상신일·결재 완료일을
    요청자가 직접 지정한다.
    """

    def setUp(self):
        from rest_framework.test import APIClient
        import json
        self._json = json
        self.client = APIClient()
        self.master = UserProfile.objects.create(loginid='master', mail='m@c.com', role='MASTER')
        self.requester = UserProfile.objects.create(loginid='req', mail='req@c.com', role='NONE')

    def _make_doc(self, status='draft', notes=None):
        return RequestDocument.objects.create(
            title='doc', requester=self.requester, requester_name='요청자',
            requester_email='req@c.com', requester_department='dept',
            product_name='PROD-1', status=status,
            additional_notes=self._json.dumps(notes or {'detail': {}, 'jayerRows': [], 'bbRows': []}),
        )

    def _post(self, doc, submitted='2026-08-01', approved='2026-08-05'):
        return self.client.post(
            f'/api/documents/{doc.id}/direct-approve/',
            {'submitted_at': submitted, 'approved_at': approved},
            format='json',
        )

    def test_master_registers_document_directly(self):
        doc = self._make_doc()
        self.client.force_authenticate(user=self.master)
        res = self._post(doc)
        self.assertEqual(res.status_code, 200, res.content)

        doc.refresh_from_db()
        self.assertEqual(doc.status, 'approved')
        self.assertEqual(timezone.localtime(doc.submitted_at).date().isoformat(), '2026-08-01')

    def test_creates_single_approved_step_with_given_date(self):
        doc = self._make_doc()
        self.client.force_authenticate(user=self.master)
        self.assertEqual(self._post(doc).status_code, 200)

        steps = ApprovalStep.objects.filter(document=doc)
        self.assertEqual(steps.count(), 1, '완료 기록 1행만 남는다')
        step = steps.first()
        self.assertEqual(step.action, 'approved')
        self.assertEqual(timezone.localtime(step.acted_at).date().isoformat(), '2026-08-05')
        self.assertEqual(step.assignee_id, self.master.id, '등록한 MASTER 가 담당자로 남는다')
        self.assertEqual(step.round, 1)

    def test_no_pending_step_is_created(self):
        doc = self._make_doc()
        self.client.force_authenticate(user=self.master)
        self.assertEqual(self._post(doc).status_code, 200)
        self.assertFalse(
            ApprovalStep.objects.filter(document=doc, action='pending').exists(),
            '결재 대기 단계가 생기면 결재 경로를 타게 된다',
        )

    def test_no_mail_is_enqueued(self):
        doc = self._make_doc()
        self.client.force_authenticate(user=self.master)
        self.assertEqual(self._post(doc).status_code, 200)
        self.assertEqual(MailNotification.objects.filter(document=doc).count(), 0)

    def test_non_master_is_forbidden(self):
        doc = self._make_doc()
        self.client.force_authenticate(user=self.requester)
        res = self._post(doc)
        self.assertEqual(res.status_code, 403, res.content)
        doc.refresh_from_db()
        self.assertEqual(doc.status, 'draft')

    def test_non_draft_document_is_rejected(self):
        doc = self._make_doc(status='under_review')
        self.client.force_authenticate(user=self.master)
        self.assertEqual(self._post(doc).status_code, 400)

    def test_invalid_date_is_rejected(self):
        doc = self._make_doc()
        self.client.force_authenticate(user=self.master)
        self.assertEqual(self._post(doc, submitted='2026/08/01').status_code, 400)
        self.assertEqual(self._post(doc, approved='').status_code, 400)
        doc.refresh_from_db()
        self.assertEqual(doc.status, 'draft')

    def test_approved_date_before_submitted_date_is_rejected(self):
        doc = self._make_doc()
        self.client.force_authenticate(user=self.master)
        res = self._post(doc, submitted='2026-08-05', approved='2026-08-01')
        self.assertEqual(res.status_code, 400, res.content)

    def test_unmapped_bb_row_is_rejected(self):
        """문서 내용 검증(Backbone 매핑)은 상신과 동일하게 적용된다."""
        doc = self._make_doc(notes={
            'detail': {},
            'jayerRows': [{'id': 'j1', 'process_id': 'P1', 'new_or_copy': '신규'}],
            'bbRows': [],
        })
        self.client.force_authenticate(user=self.master)
        self.assertEqual(self._post(doc).status_code, 400)


class DcqTokenSettleRetryTest(TestCase):
    """DCQ 로그인 직후 "이전 토큰" 오류 완화책(2026-08 추가) 검증.

    - dcq_login_with_retry(): 로그인 성공 직후 DCQ_LOGIN_SETTLE_DELAY_SEC 만큼 대기한다.
    - get_dcq_token_info(): getTokenTime() 실패 시 DCQ_TOKEN_INFO_RETRY_DELAY_SEC 간격으로
      DCQ_TOKEN_INFO_MAX_RETRIES 회까지 재시도한다.
    실제로 sleep 하면 테스트가 느려지므로 utils.time.sleep 은 항상 mock 으로 대체한다.
    """

    def setUp(self):
        from . import utils
        self.utils = utils
        patcher = patch.object(utils, 'get_dcq_credentials', return_value=('dcqid', ['pw']))
        patcher.start()
        self.addCleanup(patcher.stop)
        sleep_patcher = patch.object(utils.time, 'sleep')
        self.mock_sleep = sleep_patcher.start()
        self.addCleanup(sleep_patcher.stop)

    def test_login_success_waits_settle_delay_once(self):
        with patch.object(self.utils, 'cq_login', return_value=True):
            self.assertTrue(self.utils.dcq_login_with_retry())
        self.mock_sleep.assert_called_once_with(self.utils.DCQ_LOGIN_SETTLE_DELAY_SEC)

    def test_login_failure_does_not_wait(self):
        with patch.object(self.utils, 'cq_login', return_value=False):
            self.assertFalse(self.utils.dcq_login_with_retry())
        self.mock_sleep.assert_not_called()

    def test_token_info_retries_then_succeeds(self):
        with patch.object(
            self.utils.dcq, 'getTokenTime', create=True,
            side_effect=[Exception('token mismatch'), Exception('token mismatch'), {'expires': '21:00'}],
        ) as mock_get:
            result = self.utils.get_dcq_token_info('dcqid')
        self.assertEqual(result, {'expires': '21:00'})
        self.assertEqual(mock_get.call_count, 3)
        self.assertEqual(self.mock_sleep.call_count, 2)
        self.mock_sleep.assert_called_with(self.utils.DCQ_TOKEN_INFO_RETRY_DELAY_SEC)

    def test_token_info_gives_up_after_max_retries(self):
        with patch.object(
            self.utils.dcq, 'getTokenTime', create=True,
            side_effect=Exception('token mismatch'),
        ) as mock_get:
            result = self.utils.get_dcq_token_info('dcqid')
        self.assertIsNone(result)
        self.assertEqual(mock_get.call_count, self.utils.DCQ_TOKEN_INFO_MAX_RETRIES + 1)
        self.assertEqual(self.mock_sleep.call_count, self.utils.DCQ_TOKEN_INFO_MAX_RETRIES)
