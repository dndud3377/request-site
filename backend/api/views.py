# ⚠️ MASKING 처리된 파일. 이 파일에 포함된 비즈니스 용어는 {{ko.json}} 키로 마스킹되어 있습니다. 원래 용어를 확인하려면 다음 파일을 참조하세요: frontend/src/locales/ko.json

from django.utils import timezone
from django.http import JsonResponse, StreamingHttpResponse
from django.views.decorators.http import require_GET, require_POST
from django.views.decorators.csrf import csrf_exempt
import queue as _queue_module
from .sse import broadcaster
from django.db import connections
from django.core.files.storage import default_storage
from django.core.files.base import ContentFile
from rest_framework import viewsets, status, filters
from rest_framework.decorators import action, api_view
from rest_framework.response import Response
from rest_framework.permissions import AllowAny, BasePermission, SAFE_METHODS
from django.conf import settings
from django_filters.rest_framework import DjangoFilterBackend
from django.db import connection, transaction
from django.contrib.auth import get_user_model
User = get_user_model()
from django.db.models import Q, Max
from .models import (
    RequestDocument, ApprovalStep, VOC, VocComment, Line, ProcessProduct, ProductProcessId, AdminNotice,
    PhotoStepS1, PhotoStepS3, PhotoStepS4, PhotoStepS5, VocHistory, ProductBarcode, Guide, UserGroup,
    MapName,
)
from .utils import LINE_TO_LINEID_MAP
from . import mailer
from . import doc_permissions
from .serializers import (
    RequestDocumentSerializer, RequestDocumentListSerializer,
    VOCSerializer, VocCommentSerializer, LineSerializer, AdminNoticeSerializer, VocHistorySerializer,
    UserSerializer, GuideSerializer, UserGroupSerializer, UserGroupMemberSerializer,
)
import uuid
import logging
import re


def _is_dev() -> bool:
    return getattr(settings, 'AUTH_MODE', 'sso') == 'dev'


class IsMasterOrReadOnly(BasePermission):
    """읽기: 운영=인증 필요, 개발=허용 / 쓰기: MASTER만"""

    def has_permission(self, request, view):
        if request.method in SAFE_METHODS:
            return _is_dev() or bool(request.user and request.user.is_authenticated)
        return bool(request.user and request.user.is_authenticated and request.user.role == 'MASTER')


class IsAuthenticatedInProd(BasePermission):
    """운영=인증 필요, 개발=허용"""

    def has_permission(self, request, view):
        return _is_dev() or bool(request.user and request.user.is_authenticated)


class IsAuthenticatedOrMasterDelete(BasePermission):
    """읽기·쓰기: 운영=인증 필요, 개발=허용 / 삭제: MASTER만 (개발·운영 동일)"""

    def has_permission(self, request, view):
        if request.method == 'DELETE':
            return bool(request.user and request.user.is_authenticated and request.user.role == 'MASTER')
        return _is_dev() or bool(request.user and request.user.is_authenticated)


class RequestDocumentViewSet(viewsets.ModelViewSet):
    queryset = RequestDocument.objects.select_related('requester', 'designated_pl').all()
    permission_classes = [IsAuthenticatedInProd]
    pagination_class = None  # 목록 전체 반환(앱 컨벤션). 전역 PAGE_SIZE=20 적용 방지.
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['status', 'product_name']
    search_fields = ['title', 'product_name', 'requester_name', 'requester_department']
    ordering_fields = ['created_at', 'submitted_at']
    ordering = ['-created_at']

    def get_serializer_class(self):
        if self.action == 'list':
            return RequestDocumentListSerializer
        return RequestDocumentSerializer

    # ===== 결재 액션 서버측 인가 (프론트 ApprovalFlow 와 동일 규칙) =====
    # 프론트의 canUserAgree / canUserAssign 은 UI 가드일 뿐이라 API 직접 호출 시
    # 우회되던 문제(APPROVAL.md §6-1)를 막기 위해 서버에서도 동일 규칙을 강제한다.

    # 역할 → 담당 agent 매핑 (프론트 ROLE_TO_AGENT 와 동일)
    _ROLE_TO_AGENT = {'TE_R': 'R', 'TE_P': 'P', 'TE_J': 'J', 'TE_O': 'O', 'TE_E': 'E'}

    def _can_act_on_step(self, user, step):
        """합의/반려 인가 (canUserAgree 동일).

        - MASTER: 항상 허용
        - TE_O/TE_E: 자기 agent(O/E) 단계면 담당자 지정 없이 허용
        - 그 외(R/P/J): 해당 step 의 assignee 본인만
        """
        role = getattr(user, 'role', '')
        if role == 'MASTER':
            return True
        if role in ('TE_O', 'TE_E') and step.agent == self._ROLE_TO_AGENT[role]:
            return True
        caller_loginid = getattr(user, 'loginid', '')
        return bool(caller_loginid and step.assignee and step.assignee.loginid == caller_loginid)

    def _can_assign_step(self, user, step):
        """담당자 지정 인가 (canUserAssign 동일 + MASTER 허용).

        - MASTER: 항상 허용
        - PL 단계 / TE_O / TE_E: 지정 개념 없음 → 불가
        - 그 외: 같은 팀(역할↔agent 일치) + 아직 미지정일 때만
        """
        role = getattr(user, 'role', '')
        if role == 'MASTER':
            return True
        if step.agent == 'PL' or role in ('TE_O', 'TE_E'):
            return False
        return (
            self._ROLE_TO_AGENT.get(role) == step.agent
            and not step.assignee_id
        )

    # 의뢰자/철회/수정 권한은 serializers 와 공유하기 위해 doc_permissions 모듈에 둔다.
    def _can_withdraw(self, user, document):
        return doc_permissions.can_withdraw(user, document)

    def _can_edit(self, user, document):
        return doc_permissions.can_edit(user, document)

    def _max_round(self, document, default=1):
        """문서의 현재 최대 결재 회차를 반환한다. 단계가 없으면 default."""
        return ApprovalStep.objects.filter(document=document).aggregate(Max('round'))['round__max'] or default

    def _validate_bb_mapping(self, document):
        """J-ayer 행 bb 매핑 검증. 문제 있으면 error 문자열 반환, 없으면 None."""
        import json
        try:
            detail = json.loads(document.additional_notes or '{}')
            jayer_rows = detail.get('jayerRows', [])
            bb_rows = detail.get('bbRows', [])
            mapped_jayer_ids = {
                bb.get('sourceJayerRowId')
                for bb in bb_rows
                if bb.get('sourceJayerRowId')
            }
            unmapped = [r for r in jayer_rows if r.get('process_id') and r.get('id') not in mapped_jayer_ids]
            if unmapped:
                return '모든 원본 데이터에 bb 을 매핑해야 상신할 수 있습니다.'
        except (json.JSONDecodeError, TypeError):
            pass
        return None

    @action(detail=True, methods=['post'])
    def submit(self, request, pk=None):
        """상신: draft → under_review, PL 검토 단계 생성 (지정 PL 필수)"""
        document = self.get_object()
        if document.status != 'draft':
            return Response(
                {'error': '임시저장 상태의 의뢰서만 상신할 수 있습니다.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        designated_pl_loginid = request.data.get('designated_pl_loginid', '').strip()
        if not designated_pl_loginid:
            return Response({'error': '동료 PL을 지정해주세요.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            designated_pl_user = User.objects.get(loginid=designated_pl_loginid, role='PL')
        except User.DoesNotExist:
            return Response({'error': '유효하지 않은 PL 사용자입니다.'}, status=status.HTTP_400_BAD_REQUEST)

        if designated_pl_user == request.user:
            return Response({'error': '본인을 지정할 수 없습니다.'}, status=status.HTTP_400_BAD_REQUEST)

        err = self._validate_bb_mapping(document)
        if err:
            return Response({'error': err}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            document.status = 'under_review'
            document.submitted_at = document.submitted_at or timezone.now()
            document.designated_pl = designated_pl_user
            document.designated_pl_name = designated_pl_user.username or designated_pl_loginid
            document.save()

            ApprovalStep.objects.filter(document=document).delete()
            pl_step = ApprovalStep.objects.create(
                document=document, agent='PL', action='pending', round=1,
                assignee=designated_pl_user,
                assignee_name=document.designated_pl_name,
            )
            mailer.enqueue_stage_arrival(document, 'PL', pl_step)

        return Response({
            'message': '의뢰서가 성공적으로 상신되었습니다.',
            'email_sent': False,
            'document': RequestDocumentSerializer(document).data,
        })

    @action(detail=True, methods=['post'])
    def resubmit(self, request, pk=None):
        """재상신: rejected → under_review, PL 검토 단계 생성 (지정 PL 필수)"""
        document = self.get_object()
        if document.status != 'rejected':
            return Response(
                {'error': '반려된 의뢰서만 재상신할 수 있습니다.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        designated_pl_loginid = request.data.get('designated_pl_loginid', '').strip()
        if not designated_pl_loginid:
            return Response({'error': '동료 PL을 지정해주세요.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            designated_pl_user = User.objects.get(loginid=designated_pl_loginid, role='PL')
        except User.DoesNotExist:
            return Response({'error': '유효하지 않은 PL 사용자입니다.'}, status=status.HTTP_400_BAD_REQUEST)

        if designated_pl_user == request.user:
            return Response({'error': '본인을 지정할 수 없습니다.'}, status=status.HTTP_400_BAD_REQUEST)

        err = self._validate_bb_mapping(document)
        if err:
            return Response({'error': err}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            document.status = 'under_review'
            document.designated_pl = designated_pl_user
            document.designated_pl_name = designated_pl_user.username or designated_pl_loginid
            document.save()

            max_round = self._max_round(document, default=0)
            pl_step = ApprovalStep.objects.create(
                document=document, agent='PL', action='pending', round=max_round + 1,
                assignee=designated_pl_user,
                assignee_name=document.designated_pl_name,
            )
            mailer.enqueue_stage_arrival(document, 'PL', pl_step)

        return Response({
            'message': '재상신되었습니다.',
            'document': RequestDocumentSerializer(document).data,
        })

    @action(detail=True, methods=['post'])
    def withdraw(self, request, pk=None):
        """철회: under_review/rejected → draft, 단계 초기화"""
        document = self.get_object()
        if not self._can_withdraw(request.user, document):
            return Response({'error': '권한이 없습니다.'}, status=status.HTTP_403_FORBIDDEN)
        if document.status not in ('under_review', 'rejected', 'submitted'):
            return Response(
                {'error': '철회할 수 없는 상태입니다.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        with transaction.atomic():
            document.status = 'draft'
            document.submitted_at = None
            document.save()

            ApprovalStep.objects.filter(document=document).delete()

        return Response({'message': '철회되었습니다.'})

    @action(detail=True, methods=['post'], url_path='delete')
    def delete(self, request, pk=None):
        """의뢰서 삭제 — approved 상태는 MASTER만, 나머지는 PL/MASTER"""
        document = self.get_object()
        user_role = getattr(request.user, 'role', '')
        if document.status == 'approved' and user_role != 'MASTER':
            return Response({'error': '결재 완료된 문서는 MASTER만 삭제할 수 있습니다.'}, status=status.HTTP_403_FORBIDDEN)
        document.delete()
        return Response({'message': '삭제되었습니다.'})

    @action(detail=True, methods=['post'], url_path='approve-step')
    @transaction.atomic
    def approve_step(self, request, pk=None):
        """에이전트 단계 합의 (mock.ts mockApproveStep 로직과 동일)"""
        document = self.get_object()
        agent = request.data.get('agent')
        comment = request.data.get('comment', '')

        if agent not in ('R', 'P', 'J', 'O', 'E'):
            return Response({'error': '유효하지 않은 에이전트입니다.'}, status=status.HTTP_400_BAD_REQUEST)

        # 동시 합의 lost-update 방지: 문서 행을 잠가 같은 문서의 상태전이를 직렬화한다.
        # (J/O/E 병렬 단계를 두 결재자가 거의 동시에 마지막으로 합의할 때, 둘 다 '미완료'로
        #  읽어 approved 전이가 누락되던 문제를 막는다.)
        document = RequestDocument.objects.select_for_update().get(pk=document.pk)

        max_round = self._max_round(document)

        # 잠근 뒤 최신 커밋본을 읽기 위해 locking read 사용
        step = ApprovalStep.objects.select_for_update().filter(
            document=document, agent=agent, action='pending', round=max_round
        ).first()
        if not step:
            return Response({'error': f'AGENT {agent}의 대기 중인 단계가 없습니다.'}, status=status.HTTP_400_BAD_REQUEST)

        if not self._can_act_on_step(request.user, step):
            return Response({'error': '권한이 없습니다.'}, status=status.HTTP_403_FORBIDDEN)

        step.action = 'approved'
        step.acted_at = timezone.now()
        step.comment = comment
        if not step.assignee_name:
            step.assignee_name = request.data.get('approver_name', '')
        step.save()

        new_status = document.status
        current_round = step.round

        if agent == 'R':
            if document.is_only_map():
                # Only MAP 의뢰서는 R 단계까지만 진행 → R 합의가 곧 최종 승인
                # (P/O/E 단계를 생성하지 않는다)
                new_status = 'approved'
            else:
                # R 합의 → P(due: R포함 4영업일), O(due: R포함 6영업일), [E if PLEL] 동시 생성
                from .utils import calculate_business_due_date
                import datetime
                r_date = step.acted_at.date() if step.acted_at else datetime.date.today()
                p_due = calculate_business_due_date(r_date, 4)
                o_due = calculate_business_due_date(r_date, 6)
                p_step = ApprovalStep.objects.create(
                    document=document, agent='P', action='pending',
                    round=current_round, due_date=p_due,
                )
                o_step = ApprovalStep.objects.create(
                    document=document, agent='O', action='pending',
                    is_parallel=True, round=current_round, due_date=o_due,
                )
                mailer.enqueue_stage_arrival(document, 'P', p_step)
                mailer.enqueue_stage_arrival(document, 'O', o_step)
                if document.has_ppid_plel():
                    e_step = ApprovalStep.objects.create(
                        document=document, agent='E', action='pending',
                        is_parallel=True, round=current_round, due_date=o_due,
                    )
                    mailer.enqueue_stage_arrival(document, 'E', e_step)
                new_status = 'under_review'

        elif agent == 'P':
            # P 합의 → J(due: P포함 4영업일) 생성
            from .utils import calculate_business_due_date
            import datetime
            p_date = step.acted_at.date() if step.acted_at else datetime.date.today()
            j_due = calculate_business_due_date(p_date, 4)
            j_step = ApprovalStep.objects.create(
                document=document, agent='J', action='pending',
                round=current_round, due_date=j_due,
            )
            mailer.enqueue_stage_arrival(document, 'J', j_step)
            new_status = 'under_review'

        elif agent in ('J', 'O', 'E'):
            # J + O + [E] 모두 합의 시 최종 승인
            j_step = ApprovalStep.objects.select_for_update().filter(document=document, agent='J', round=current_round).order_by('-id').first()
            o_step = ApprovalStep.objects.select_for_update().filter(document=document, agent='O', round=current_round).order_by('-id').first()
            e_step = ApprovalStep.objects.select_for_update().filter(document=document, agent='E', round=current_round).order_by('-id').first()
            j_approved = j_step and j_step.action == 'approved'
            o_approved = o_step and o_step.action == 'approved'
            if e_step:
                all_approved = j_approved and o_approved and e_step.action == 'approved'
            else:
                all_approved = j_approved and o_approved
            if all_approved:
                new_status = 'approved'

        document.status = new_status
        document.save()

        if new_status == 'approved':
            mailer.enqueue_approved(document)

        return Response({
            'message': '처리되었습니다.',
            'status': new_status,
        })

    @action(detail=True, methods=['post'], url_path='reject-step')
    @transaction.atomic
    def reject_step(self, request, pk=None):
        """에이전트 단계 반려"""
        document = self.get_object()
        agent = request.data.get('agent')
        comment = request.data.get('comment', '')

        if agent not in ('R', 'P', 'J', 'O', 'E'):
            return Response({'error': '유효하지 않은 에이전트입니다.'}, status=status.HTTP_400_BAD_REQUEST)

        # 문서 행을 잠가 합의(approve_step)와 반려가 동시에 같은 문서를 전이시키는 경쟁을 직렬화한다.
        document = RequestDocument.objects.select_for_update().get(pk=document.pk)

        max_round = self._max_round(document)

        step = ApprovalStep.objects.select_for_update().filter(
            document=document, agent=agent, action='pending', round=max_round
        ).first()
        if not step:
            return Response({'error': f'AGENT {agent}의 대기 중인 단계가 없습니다.'}, status=status.HTTP_400_BAD_REQUEST)

        if not self._can_act_on_step(request.user, step):
            return Response({'error': '권한이 없습니다.'}, status=status.HTTP_403_FORBIDDEN)

        step.action = 'rejected'
        step.acted_at = timezone.now()
        step.comment = comment
        step.save()

        document.status = 'rejected'
        document.save()

        mailer.enqueue_rejected(document)

        return Response({'message': '반려되었습니다.', 'status': 'rejected'})

    @action(detail=True, methods=['post'], url_path='assign-step')
    def assign_step(self, request, pk=None):
        """에이전트 단계 담당자 지정"""
        document = self.get_object()
        agent = request.data.get('agent')
        assignee_loginid = request.data.get('assignee_loginid')
        assignee_name = request.data.get('assignee_name', '')

        # agent 화이트리스트: 'PL' 등으로 지정 PL 단계를 덮어써 change_designee 권한검증을
        # 우회하는 것을 차단한다(PL 지정 변경은 change_designee 전용).
        if agent not in ('R', 'P', 'J', 'O', 'E'):
            return Response({'error': '유효하지 않은 에이전트입니다.'}, status=status.HTTP_400_BAD_REQUEST)

        max_round = self._max_round(document)

        step = ApprovalStep.objects.filter(
            document=document, agent=agent, action='pending', round=max_round
        ).first()
        if not step:
            return Response({'error': '해당 단계를 찾을 수 없습니다.'}, status=status.HTTP_400_BAD_REQUEST)

        if not self._can_assign_step(request.user, step):
            return Response({'error': '권한이 없습니다.'}, status=status.HTTP_403_FORBIDDEN)

        if assignee_loginid:
            try:
                assignee_user = User.objects.get(loginid=assignee_loginid)
                step.assignee = assignee_user
            except User.DoesNotExist:
                return Response({'error': '사용자를 찾을 수 없습니다.'}, status=status.HTTP_400_BAD_REQUEST)

        step.assignee_name = assignee_name
        step.save()

        mailer.enqueue_stage_arrival(document, agent, step)

        return Response({'message': '담당자가 지정되었습니다.'})

    def _get_pending_pl_step(self, document):
        """현재 회차의 pending PL 단계 반환. 없으면 None."""
        max_round = self._max_round(document)
        return ApprovalStep.objects.filter(
            document=document, agent='PL', action='pending', round=max_round
        ).first()

    @action(detail=True, methods=['post'], url_path='peer-approve')
    def peer_approve(self, request, pk=None):
        """지정 PL 합의: PL 단계 approved → R 단계 생성"""
        document = self.get_object()
        user_role = getattr(request.user, 'role', '')

        step = self._get_pending_pl_step(document)
        if not step:
            return Response({'error': '대기 중인 PL 검토 단계가 없습니다.'}, status=status.HTTP_400_BAD_REQUEST)

        caller_loginid = getattr(request.user, 'loginid', '')
        if user_role != 'MASTER' and (not step.assignee or step.assignee.loginid != caller_loginid):
            return Response({'error': '권한이 없습니다.'}, status=status.HTTP_403_FORBIDDEN)

        comment = request.data.get('comment', '')
        with transaction.atomic():
            step.action = 'approved'
            step.acted_at = timezone.now()
            step.comment = comment
            step.save()

            r_step = ApprovalStep.objects.create(
                document=document, agent='R', action='pending', round=step.round,
            )
            document.status = 'under_review'
            document.save()
            mailer.enqueue_stage_arrival(document, 'R', r_step)

        return Response({'message': '합의되었습니다. R 단계로 진행합니다.', 'status': 'under_review'})

    @action(detail=True, methods=['post'], url_path='peer-reject')
    def peer_reject(self, request, pk=None):
        """지정 PL 반려: PL 단계 rejected → 원 PL에게 반환"""
        document = self.get_object()
        user_role = getattr(request.user, 'role', '')

        step = self._get_pending_pl_step(document)
        if not step:
            return Response({'error': '대기 중인 PL 검토 단계가 없습니다.'}, status=status.HTTP_400_BAD_REQUEST)

        caller_loginid = getattr(request.user, 'loginid', '')
        if user_role != 'MASTER' and (not step.assignee or step.assignee.loginid != caller_loginid):
            return Response({'error': '권한이 없습니다.'}, status=status.HTTP_403_FORBIDDEN)

        comment = request.data.get('comment', '')
        with transaction.atomic():
            step.action = 'rejected'
            step.acted_at = timezone.now()
            step.comment = comment
            step.save()

            document.status = 'rejected'
            document.save()
            mailer.enqueue_rejected(document)

        return Response({'message': '반려되었습니다.', 'status': 'rejected'})

    @action(detail=True, methods=['post'], url_path='peer-submit')
    def peer_submit(self, request, pk=None):
        """지정 PL 수정 후 상신: 문서 내용은 이미 update됨, PL 단계 approved → R 단계 생성"""
        document = self.get_object()
        user_role = getattr(request.user, 'role', '')

        step = self._get_pending_pl_step(document)
        if not step:
            return Response({'error': '대기 중인 PL 검토 단계가 없습니다.'}, status=status.HTTP_400_BAD_REQUEST)

        caller_loginid = getattr(request.user, 'loginid', '')
        if user_role != 'MASTER' and (not step.assignee or step.assignee.loginid != caller_loginid):
            return Response({'error': '권한이 없습니다.'}, status=status.HTTP_403_FORBIDDEN)

        comment = request.data.get('comment', '')
        with transaction.atomic():
            step.action = 'approved'
            step.acted_at = timezone.now()
            step.comment = f'[수정 후 상신] {comment}'.strip()
            step.save()

            r_step = ApprovalStep.objects.create(
                document=document, agent='R', action='pending', round=step.round,
            )
            document.status = 'under_review'
            document.save()
            mailer.enqueue_stage_arrival(document, 'R', r_step)

        return Response({'message': '수정 후 상신되었습니다. R 단계로 진행합니다.', 'status': 'under_review'})

    @action(detail=True, methods=['post'], url_path='change-designee')
    def change_designee(self, request, pk=None):
        """지정자 변경: PL 단계 pending 동안 원 PL 또는 MASTER가 변경 가능"""
        document = self.get_object()
        user_role = getattr(request.user, 'role', '')
        caller_loginid = getattr(request.user, 'loginid', '')

        is_requester = (
            document.requester and document.requester.loginid == caller_loginid
        )
        if user_role != 'MASTER' and not is_requester:
            return Response({'error': '권한이 없습니다.'}, status=status.HTTP_403_FORBIDDEN)

        step = self._get_pending_pl_step(document)
        if not step:
            return Response({'error': '변경 가능한 PL 검토 단계가 없습니다.'}, status=status.HTTP_400_BAD_REQUEST)

        new_loginid = request.data.get('designated_pl_loginid', '').strip()
        if not new_loginid:
            return Response({'error': '새 지정 PL의 loginid를 입력해주세요.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            new_pl_user = User.objects.get(loginid=new_loginid, role='PL')
        except User.DoesNotExist:
            return Response({'error': '유효하지 않은 PL 사용자입니다.'}, status=status.HTTP_400_BAD_REQUEST)

        if new_pl_user.loginid == caller_loginid:
            return Response({'error': '본인을 지정할 수 없습니다.'}, status=status.HTTP_400_BAD_REQUEST)

        step.assignee = new_pl_user
        step.assignee_name = new_pl_user.username or new_loginid
        step.save()

        document.designated_pl = new_pl_user
        document.designated_pl_name = step.assignee_name
        document.save()

        return Response({'message': '지정자가 변경되었습니다.', 'document': RequestDocumentSerializer(document).data})

    def _unique_title(self, base_title, exclude_id=None):
        """중복 제목 처리: 같은 제목이 있으면 _2, _3, ... suffix 를 붙여 반환"""
        qs = RequestDocument.objects.all()
        if exclude_id is not None:
            qs = qs.exclude(id=exclude_id)

        if not qs.filter(title=base_title).exists():
            return base_title

        pattern = re.compile(r'^' + re.escape(base_title) + r'_(\d+)$')
        existing_numbers = []
        for title in qs.filter(title__startswith=base_title + '_').values_list('title', flat=True):
            m = pattern.match(title)
            if m:
                existing_numbers.append(int(m.group(1)))

        next_num = max(existing_numbers) + 1 if existing_numbers else 2
        return f"{base_title}_{next_num}"

    def perform_create(self, serializer):
        base_title = serializer.validated_data.get('title', '')
        user = self.request.user
        requester = user if getattr(user, 'is_authenticated', False) else None
        serializer.save(title=self._unique_title(base_title), requester=requester)

    def update(self, request, *args, **kwargs):
        """수정(PUT/PATCH) 인가: 상태별 권한이 없으면 403."""
        document = self.get_object()
        if not self._can_edit(request.user, document):
            return Response({'error': '권한이 없습니다.'}, status=status.HTTP_403_FORBIDDEN)
        return super().update(request, *args, **kwargs)

    def perform_update(self, serializer):
        base_title = serializer.validated_data.get('title', serializer.instance.title)
        serializer.save(title=self._unique_title(base_title, exclude_id=serializer.instance.id))

    @action(detail=False, methods=['get'])
    def stats(self, request):
        """상태별 통계"""
        total = RequestDocument.objects.count()
        by_status = {}
        for key, _ in RequestDocument.STATUS_CHOICES:
            by_status[key] = RequestDocument.objects.filter(status=key).count()

        return Response({'total': total, 'by_status': by_status})


class VOCViewSet(viewsets.ModelViewSet):
    queryset = VOC.objects.all()
    serializer_class = VOCSerializer
    permission_classes = [IsAuthenticatedOrMasterDelete]
    pagination_class = None  # 목록 전체 반환(앱 컨벤션). 전역 PAGE_SIZE=20 적용 방지.
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ['category', 'status', 'submitter_user_id']
    search_fields = ['title', 'submitter_name', 'content']
    ordering = ['-created_at']

    @action(detail=True, methods=['patch'], url_path='update-status')
    def update_status(self, request, pk=None):
        """VOC 상태 변경 — completed: 작성자 본인만, rejected: MASTER만"""
        voc = self.get_object()
        new_status = request.data.get('status')
        user_role = getattr(request.user, 'role', '')

        if new_status == 'completed':
            if voc.submitter_user_id != request.user.id:
                return Response(
                    {'error': '작성자 본인만 완료 처리할 수 있습니다.'},
                    status=status.HTTP_403_FORBIDDEN,
                )
        elif new_status == 'rejected':
            if user_role != 'MASTER':
                return Response(
                    {'error': 'MASTER만 반려 처리할 수 있습니다.'},
                    status=status.HTTP_403_FORBIDDEN,
                )
        else:
            return Response(
                {'error': '유효하지 않은 상태입니다.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        voc.status = new_status
        voc.save()
        return Response(VOCSerializer(voc).data)

    @action(detail=True, methods=['post'])
    def comment(self, request, pk=None):
        voc = self.get_object()
        data = {**request.data, 'voc': voc.id}
        serializer = VocCommentSerializer(data=data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(VOCSerializer(voc).data)


class LineViewSet(viewsets.ReadOnlyModelViewSet):
    """{{request.line}} 마스터 데이터 (읽기 전용)"""
    queryset = Line.objects.filter(is_active=True)
    serializer_class = LineSerializer
    permission_classes = [IsAuthenticatedInProd]
    pagination_class = None


class AdminNoticeViewSet(viewsets.ModelViewSet):
    """공지사항 (읽기: 모두, 쓰기: MASTER 전용)"""
    queryset = AdminNotice.objects.all()
    serializer_class = AdminNoticeSerializer
    permission_classes = [IsMasterOrReadOnly]
    pagination_class = None
    filter_backends = []

    @action(detail=False, methods=['get'])
    def latest(self, request):
        """최신 공지 1개 반환"""
        notice = AdminNotice.objects.first()
        if not notice:
            return Response(None)
        return Response(AdminNoticeSerializer(notice).data)

@require_GET
def health_check(request):
    """헬스체크 엔드포인트 - DB 연결 상태 확인"""
    try:
        conn = connections['default']
        conn.cursor()
        return JsonResponse({'status': 'healthy', 'db': 'connected'})
    except Exception as e:
        return JsonResponse({'status': 'unhealthy', 'db': 'disconnected', 'error': str(e)}, status=503)


@require_GET
def form_options_process(request):
    """{{request.line}} → {{request.process_selection}} 목록"""
    from .models import ProcessProduct as CP
    line = request.GET.get('line', '')
    if not line:
        return JsonResponse({'options': []})
    options = list(
        CP.objects
        .filter(line=line)
        .values_list('process', flat=True)
        .distinct()
        .order_by('process')
    )
    return JsonResponse({'options': options})


@require_GET
def form_options_products(request):
    """{{request.line}} + {{request.process_selection}} → {{request.partid_selection}} 목록 (process 은 선택 사항)"""
    line = request.GET.get('line', '')
    process = request.GET.get('process', None)  # None 으로 설정하여 파라미터 유무 확인
    if not line:
        return JsonResponse({'options': []})
    
    # process 파라미터가 있으면 필터링, 없으면 {{request.line}} 에 해당하는 모든 제품 반환
    queryset = ProcessProduct.objects.filter(line=line)
    if process is not None and process != '':
        queryset = queryset.filter(process=process)
    
    options = list(
        queryset
        .values_list('product_name', flat=True)
        .distinct()
        .order_by('product_name')
    )
    return JsonResponse({'options': options})

@require_GET
def form_options_process_id(request):
    """{{request.line}} + {{request.partid_selection}} → {{request.process_id}} 목록"""
    line = request.GET.get('line', '')
    product = request.GET.get('product', '')
    if not line or not product:
        return JsonResponse({'options': []})
    options = list(
        ProductProcessId.objects
        .filter(line=line, product_name=product)
        .values_list('process_id', flat=True)
        .distinct()
        .order_by('process_id')
    )
    return JsonResponse({'options': options})


@require_GET
def form_options_job_file_layer(request):
    """{{request.line}} + {{request.process_id}} → JOB FILE layer 정보 (eqptype='PMAINF')"""
    import logging
    logger = logging.getLogger(__name__)
    
    line = request.GET.get('line', '')
    process = request.GET.get('process', '')
    
    if not line or not process:
        return JsonResponse({'options': []})
    
    # {{request.line}} 별 모델 매핑
    model_map = {
        'line1': PhotoStepS1,
        'line3': PhotoStepS3,
        'line4': PhotoStepS4,
        'line5': PhotoStepS5,
    }

    model = model_map.get(line)
    if not model:
        logger.warning(f"[JOB_FILE_LAYER] 알 수 없는 {{request.line}}: {line}")
        return JsonResponse({'options': []})
    
    try:
        # eqptype='PMAINF' AND processid='{process}' 조건으로 조회
        # stepseq 오름차순 정렬
        queryset = model.objects.filter(
            eqptype='PMAINF',
            processid=process
        ).order_by('stepseq')
        
        options = []
        for item in queryset:
            options.append({
                'line': line,
                'process': process,
                'processid': item.processid,
                'stepseq': item.stepseq,
                'descript': item.descript,
                'recipeid': item.recipeid,
                'layerid': item.layerid or '',
                'updated': item.updated or '',
            })
        
        logger.info(f"[JOB_FILE_LAYER] {len(options)}건 조회 성공: {line}, {process}")
        return JsonResponse({'options': options})
        
    except Exception as e:
        logger.error(f"[JOB_FILE_LAYER] 조회 실패: {e}")
        return JsonResponse({'options': [], 'error': str(e)})


@require_GET
def form_options_ovl_layer(request):
    """{{request.line}} + {{request.process_id}} → OVL layer 정보 (eqptype='POVLAY')"""
    import logging
    logger = logging.getLogger(__name__)
    
    line = request.GET.get('line', '')
    process = request.GET.get('process', '')
    
    if not line or not process:
        return JsonResponse({'options': []})
    
    # {{request.line}} 별 모델 매핑
    model_map = {
        'line1': PhotoStepS1,
        'line3': PhotoStepS3,
        'line4': PhotoStepS4,
        'line5': PhotoStepS5,
    }
    
    model = model_map.get(line)
    if not model:
        logger.warning(f"[OVL_LAYER] 알 수 없는 {{request.line}}: {line}")
        return JsonResponse({'options': []})
    
    try:
        # eqptype='POVLAY' AND processid='{process}' 조건으로 조회
        # stepseq 오름차순 정렬
        queryset = model.objects.filter(
            eqptype='POVLAY',
            processid=process
        ).order_by('stepseq')
        
        options = []
        for item in queryset:
            options.append({
                'line': line,
                'process': process,
                'processid': item.processid,
                'stepseq': item.stepseq,
                'descript': item.descript,
                'recipeid': item.recipeid,
                'layerid': item.layerid or '',
                'updated': item.updated or '',
            })
        
        logger.info(f"[OVL_LAYER] {len(options)}건 조회 성공: {line}, {process}")
        return JsonResponse({'options': options})
        
    except Exception as e:
        logger.error(f"[OVL_LAYER] 조회 실패: {e}")
        return JsonResponse({'options': [], 'error': str(e)})


@csrf_exempt
@require_POST
def upload_image(request):
    """이미지 파일 업로드 API - mshot 이미지용"""
    logger = logging.getLogger(__name__)
    
    if 'image' not in request.FILES:
        return JsonResponse({'error': '이미지 파일이 없습니다'}, status=400)
    
    image = request.FILES['image']
    
    # 이미지 파일 검증
    if not image.content_type.startswith('image/'):
        return JsonResponse({'error': '이미지 파일만 업로드할 수 있습니다'}, status=400)
    
    # 파일 크기 제한 (2MB)
    max_size = 2 * 1024 * 1024  # 2MB
    if image.size > max_size:
        return JsonResponse({'error': '이미지 크기는 2MB 를 초과할 수 없습니다'}, status=400)
    
    # 파일명 생성 (UUID 사용)
    ext = image.name.split('.')[-1] if '.' in image.name else 'png'
    filename = f"mshot_{uuid.uuid4().hex}.{ext}"
    path = f"mshot_images/{filename}"
    
    try:
        # 파일 저장
        saved_path = default_storage.save(path, ContentFile(image.read()))
        file_url = default_storage.url(saved_path)
        
        logger.info(f"[UPLOAD_IMAGE] 이미지 업로드 성공: {saved_path}")
        
        return JsonResponse({
            'path': saved_path,
            'url': file_url,
            'original_name': image.name,
            'size': image.size
        })
    except Exception as e:
        logger.error(f"[UPLOAD_IMAGE] 이미지 업로드 실패: {e}")
        return JsonResponse({'error': f'업로드 실패: {str(e)}'}, status=500)


# 동영상 업로드 최대 크기 (50MB)
MAX_VIDEO_UPLOAD_SIZE = 50 * 1024 * 1024


@csrf_exempt
@require_POST
def upload_video(request):
    """동영상 파일 업로드 API - 가이드 동영상용"""
    logger = logging.getLogger(__name__)

    if 'video' not in request.FILES:
        return JsonResponse({'error': '동영상 파일이 없습니다'}, status=400)

    video = request.FILES['video']

    # 동영상 파일 검증
    if not video.content_type.startswith('video/'):
        return JsonResponse({'error': '동영상 파일만 업로드할 수 있습니다'}, status=400)

    # 파일 크기 제한 (50MB)
    if video.size > MAX_VIDEO_UPLOAD_SIZE:
        return JsonResponse({'error': '동영상 크기는 50MB 를 초과할 수 없습니다'}, status=400)

    # 파일명 생성 (UUID 사용)
    ext = video.name.split('.')[-1] if '.' in video.name else 'mp4'
    filename = f"guide_{uuid.uuid4().hex}.{ext}"
    path = f"guide_videos/{filename}"

    try:
        # 파일 저장
        saved_path = default_storage.save(path, ContentFile(video.read()))
        file_url = default_storage.url(saved_path)

        logger.info(f"[UPLOAD_VIDEO] 동영상 업로드 성공: {saved_path}")

        return JsonResponse({
            'path': saved_path,
            'url': file_url,
            'original_name': video.name,
            'size': video.size
        })
    except Exception as e:
        logger.error(f"[UPLOAD_VIDEO] 동영상 업로드 실패: {e}")
        return JsonResponse({'error': f'업로드 실패: {str(e)}'}, status=500)




class VocHistoryViewSet(viewsets.ModelViewSet):
    """VOC 처리 이력"""
    queryset = VocHistory.objects.all()
    serializer_class = VocHistorySerializer
    permission_classes = [IsAuthenticatedInProd]
    pagination_class = None  # 목록 전체 반환(앱 컨벤션). 전역 PAGE_SIZE=20 적용 방지.
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ['voc', 'action']
    ordering = ['-acted_at']

    @action(detail=False, methods=['get'])
    def by_voc(self, request):
        """특정 VOC 의 이력 목록 조회"""
        voc_id = request.query_params.get('voc_id')
        if not voc_id:
            return Response({'error': 'voc_id 가 필요합니다'}, status=status.HTTP_400_BAD_REQUEST)
        
        histories = VocHistory.objects.filter(voc_id=voc_id).order_by('acted_at')
        serializer = self.get_serializer(histories, many=True)
        return Response(serializer.data)


@require_GET
def form_options_bb_external(request):
    """bb 외부 데이터 - {{request.line}} + {{request.process_id}} → api_steps (eqptype='PMAINF')"""
    import logging
    logger = logging.getLogger(__name__)
    
    line = request.GET.get('location', '')
    product = request.GET.get('product', '')  # {{request.partid_selection}} (현재는 사용 안 함)
    process_id = request.GET.get('process_id', '')  # {{request.process_id}}
    
    if not line or not process_id:
        logger.warning(f"[BB_EXTERNAL] {{request.line}} 또는 {{request.process_id}} 누락: line={line}, process_id={process_id}")
        return JsonResponse({'options': []})
    
    # {{request.line}} 별 모델 매핑
    model_map = {
        'line1': PhotoStepS1,
        'line3': PhotoStepS3,
        'line4': PhotoStepS4,
        'line5': PhotoStepS5,
    }
    
    model = model_map.get(line)
    if not model:
        logger.warning(f"[BB_EXTERNAL] 알 수 없는 {{request.line}}: {line}")
        return JsonResponse({'options': []})
    
    try:
        # eqptype='PMAINF' AND processid='{process_id}' 조건으로 조회
        # stepseq 오름차순 정렬
        queryset = model.objects.filter(
            eqptype='PMAINF',
            processid=process_id
        ).order_by('stepseq')
        
        options = []
        for item in queryset:
            options.append({
                'processid': item.processid,
                'stepseq': item.stepseq,
                'descript': item.descript,
                'layerid': item.layerid or '',
            })
        
        logger.info(f"[BB_EXTERNAL] {len(options)}건 조회 성공: {line}, {process_id}")
        return JsonResponse({'options': options})

    except Exception as e:
        logger.error(f"[BB_EXTERNAL] 조회 실패: {e}")
        return JsonResponse({'options': [], 'error': str(e)})


@require_GET
def form_options_layer_ids(request):
    """line + process → unique sorted layerid list (eqptype='PMAINF')"""
    line = request.GET.get('line', '')
    process = request.GET.get('process', '')

    if not line or not process:
        return JsonResponse({'options': []})

    model_map = {
        'line1': PhotoStepS1,
        'line3': PhotoStepS3,
        'line4': PhotoStepS4,
        'line5': PhotoStepS5,
    }

    model = model_map.get(line)
    if not model:
        return JsonResponse({'options': []})

    try:
        layerids = (
            model.objects.filter(eqptype='PMAINF', processid=process)
            .exclude(layerid='').exclude(layerid=None)
            .values_list('layerid', flat=True)
            .distinct()
            .order_by('layerid')
        )
        return JsonResponse({'options': list(layerids)})
    except Exception as e:
        return JsonResponse({'options': []})


@require_GET
def form_options_barcode(request):
    """product_name → 유효한 바코드 옵션 목록 반환 (n7cancel_date, n7cancel_ok 없는 행만)"""
    product_name = request.GET.get('product_name', '')
    if not product_name:
        return JsonResponse({'options': []})

    try:
        qs = ProductBarcode.objects.filter(
            n7prod_code=product_name,
        ).filter(
            Q(n7cancel_date__isnull=True) | Q(n7cancel_date='')
        ).filter(
            Q(n7cancel_ok__isnull=True) | Q(n7cancel_ok='')
        )

        options = []
        for row in qs:
            spec = row.n7c_layer_num.split('_')[0]
            date = row.n7mto_date
            letters = ''.join(c for c in spec if c.isalpha())
            if letters:
                label = f"{row.n7barcode}_{letters} [{date}]" if date else f"{row.n7barcode}_{letters}"
            else:
                label = f"{row.n7barcode} [{date}]" if date else row.n7barcode
            options.append({
                'label': label,
                'spec': spec,
            })
        return JsonResponse({'options': options})
    except Exception as e:
        return JsonResponse({'options': []})


@require_GET
def form_options_mapname(request):
    """원본 위치(라인명) → partid 목록 반환"""
    line = request.GET.get('line', '')
    lineid = LINE_TO_LINEID_MAP.get(line)
    if not lineid:
        return JsonResponse({'options': []})

    options = list(
        MapName.objects.filter(lineid=lineid)
        .values_list('partid', flat=True)
        .distinct()
        .order_by('partid')
    )
    return JsonResponse({'options': options})


class UserViewSet(viewsets.ModelViewSet):
    """
    사용자 관리 ViewSet
    - list: 모든 사용자 목록 조회
    - create: login_id 로 사용자 생성 및 권한 부여
    - destroy: 사용자 삭제
    - for-assignment: 권한 부여 대상 사용자 목록
    - assign-role: 사용자에게 역할 부여 (MASTER: 모든 역할 변경 / 일반: NONE→자신의 역할만)
    """
    queryset = User.objects.all()
    serializer_class = UserSerializer
    permission_classes = [IsMasterOrReadOnly]
    pagination_class = None
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['loginid', 'username', 'deptname']
    ordering_fields = ['id', 'loginid']
    ordering = ['id']

    def get_permissions(self):
        if self.action in ('assign_role', 'destroy'):
            from rest_framework.permissions import IsAuthenticated
            return [IsAuthenticated()]
        return super().get_permissions()

    def get_serializer_class(self):
        return UserSerializer

    def get_queryset(self):
        role = self.request.query_params.get('role')
        if role:
            return User.objects.filter(role=role)
        return User.objects.all()

    @action(detail=False, methods=['get'], url_path='for-assignment')
    def for_assignment(self, request):
        """권한 부여 대상 사용자 목록
        - MASTER + role 파라미터: 해당 역할 제외한 전체 사용자
        - 그 외: NONE 사용자만
        """
        is_master = request.user.is_authenticated and request.user.role == 'MASTER'
        target_role = request.query_params.get('role')

        if is_master and target_role:
            users = User.objects.exclude(role=target_role).order_by('loginid')
        else:
            users = User.objects.filter(role='NONE').order_by('loginid')

        data = [{
            'id': u.id,
            'username': u.loginid,
            'display_name': u.username,
            'department': u.deptname,
            'email': u.mail,
            'current_role': u.role,
        } for u in users]
        return Response(data)

    @action(detail=True, methods=['post'], url_path='assign-role')
    def assign_role(self, request, pk=None):
        """사용자에게 역할 부여
        - MASTER: NONE 포함 모든 역할 변경 가능
        - 일반 사용자(PL/TE_*): 대상이 NONE이고 자신의 역할로만 부여 가능
        - NONE 사용자: 403
        """
        user = self.get_object()
        role = request.data.get('role')

        is_master = request.user.is_authenticated and request.user.role == 'MASTER'
        requester_role = getattr(request.user, 'role', None) if request.user.is_authenticated else None

        all_valid_roles = ['PL', 'TE_R', 'TE_P', 'TE_J', 'TE_O', 'TE_E', 'MASTER', 'NONE']
        assignable_roles = ['PL', 'TE_R', 'TE_P', 'TE_J', 'TE_O', 'TE_E']

        if role not in all_valid_roles:
            return Response({'error': '유효하지 않은 역할입니다.'}, status=status.HTTP_400_BAD_REQUEST)

        if not is_master:
            if requester_role not in assignable_roles:
                return Response({'error': '권한이 없습니다.'}, status=status.HTTP_403_FORBIDDEN)
            if user.role != 'NONE':
                return Response({'error': '권한 없는 사용자에게만 역할을 부여할 수 있습니다.'}, status=status.HTTP_403_FORBIDDEN)
            if role != requester_role:
                return Response({'error': '자신의 역할로만 부여할 수 있습니다.'}, status=status.HTTP_403_FORBIDDEN)

        User.objects.filter(pk=user.pk).update(role=role)
        user.refresh_from_db()

        broadcaster.broadcast('user_updated', {
            'id': user.id,
            'loginid': user.loginid,
            'name': user.username or '',
            'deptname': user.deptname or '',
            'role': role,
            'mail': user.mail or '',
        })

        return Response({
            'id': user.id,
            'loginid': user.loginid,
            'name': user.username or '',
            'deptname': user.deptname or '',
            'role': role,
            'mail': user.mail or '',
        })
    
    def create(self, request, *args, **kwargs):
        # login_id 를 context 로 전달
        loginid = request.data.get('loginid')
        if not loginid:
            return Response(
                {'loginid': 'loginid is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        serializer = self.get_serializer(data=request.data, context={'loginid': loginid})
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        return Response(serializer.data, status=status.HTTP_201_CREATED)
    
    def perform_create(self, serializer):
        serializer.save()
    
    def destroy(self, request, *args, **kwargs):
        try:
            user = self.get_object()
            caller = request.user
            caller_role = getattr(caller, 'role', '')
            target_role = getattr(user, 'role', '')

            if caller_role != 'MASTER':
                assignable_roles = ['PL', 'TE_R', 'TE_P', 'TE_J', 'TE_O', 'TE_E']
                if caller_role not in assignable_roles:
                    return Response({'error': '권한이 없습니다.'}, status=status.HTTP_403_FORBIDDEN)
                if caller.id == user.id:
                    return Response({'error': '자기 자신은 삭제할 수 없습니다.'}, status=status.HTTP_403_FORBIDDEN)
                if caller_role != target_role:
                    return Response({'error': '권한이 없습니다.'}, status=status.HTTP_403_FORBIDDEN)

            user_id = user.id
            user.delete()
            broadcaster.broadcast('user_deleted', {'id': user_id})
            return Response(status=status.HTTP_204_NO_CONTENT)
        except Exception as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )


@csrf_exempt
def user_events(request):
    """SSE endpoint: 사용자 권한 변경 실시간 스트림"""
    def event_stream():
        q = broadcaster.subscribe()
        try:
            yield ": connected\n\n"
            while True:
                try:
                    msg = q.get(timeout=30)
                    yield msg
                except _queue_module.Empty:
                    yield ": keepalive\n\n"
        finally:
            broadcaster.unsubscribe(q)

    response = StreamingHttpResponse(event_stream(), content_type='text/event-stream')
    response['Cache-Control'] = 'no-cache'
    response['X-Accel-Buffering'] = 'no'
    return response


class GuideViewSet(viewsets.ModelViewSet):
    """의뢰서 작성 가이드 CRUD"""
    serializer_class = GuideSerializer
    permission_classes = [IsAuthenticatedOrMasterDelete]
    pagination_class = None  # 목록 전체 반환(앱 컨벤션). 전역 PAGE_SIZE=20 적용 방지.

    def get_queryset(self):
        qs = Guide.objects.all()
        guide_type = self.request.query_params.get('guide_type')
        feature_key = self.request.query_params.get('feature_key')
        if guide_type:
            qs = qs.filter(guide_type=guide_type)
        if feature_key:
            qs = qs.filter(feature_key=feature_key)
        return qs

    def perform_create(self, serializer):
        serializer.save(
            author_name=self.request.user.username or self.request.user.loginid,
            author_role=self.request.user.role,
        )

    def perform_update(self, serializer):
        serializer.save()


class UserGroupViewSet(viewsets.ModelViewSet):
    """
    나만의 그룹 ViewSet
    - 현재 사용자가 멤버인 그룹만 조회 가능
    - 그룹 생성 시 creator가 자동으로 members에 추가됨
    - 멤버 추가/제거는 creator와 동일 role인 사용자만 허용
    - 모든 멤버가 그룹 관리 가능 (이름 변경, 멤버 추가/제거, 삭제)
    """
    serializer_class = UserGroupSerializer
    permission_classes = [IsAuthenticatedInProd]
    pagination_class = None

    def get_queryset(self):
        if not self.request.user.is_authenticated:
            return UserGroup.objects.none()
        return UserGroup.objects.filter(
            members=self.request.user
        ).select_related('creator').prefetch_related('members')

    def get_object(self):
        from django.shortcuts import get_object_or_404
        if not self.request.user.is_authenticated:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied()
        return get_object_or_404(
            UserGroup.objects.filter(members=self.request.user),
            pk=self.kwargs['pk']
        )

    def create(self, request, *args, **kwargs):
        if not request.user.is_authenticated or request.user.role == 'NONE':
            return Response(
                {'error': '역할이 없는 사용자는 그룹을 만들 수 없습니다.'},
                status=status.HTTP_403_FORBIDDEN
            )
        serializer = self.get_serializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        group = serializer.save(creator=request.user)
        group.members.add(request.user)
        return Response(UserGroupSerializer(group, context={'request': request}).data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        kwargs['partial'] = True
        return super().update(request, *args, **kwargs)

    def perform_update(self, serializer):
        serializer.save()

    def destroy(self, request, *args, **kwargs):
        group = self.get_object()
        group.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['get'], url_path='available-members')
    def available_members(self, request, pk=None):
        """creator와 동일 role이고 아직 멤버가 아닌 사용자 목록"""
        group = self.get_object()
        creator_role = group.creator.role
        current_member_ids = group.members.values_list('id', flat=True)
        candidates = User.objects.filter(role=creator_role).exclude(
            id__in=current_member_ids
        ).order_by('username', 'loginid')
        data = [
            {
                'id': u.id,
                'loginid': u.loginid,
                'name': u.username,
                'mail': u.mail,
                'deptname': u.deptname,
            }
            for u in candidates
        ]
        return Response(data)

    @action(detail=True, methods=['post'], url_path='add-member')
    def add_member(self, request, pk=None):
        """멤버 추가 — creator와 동일 role만 허용"""
        group = self.get_object()
        user_id = request.data.get('user_id')
        if not user_id:
            return Response({'error': 'user_id는 필수입니다.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            target = User.objects.get(pk=user_id)
        except User.DoesNotExist:
            return Response({'error': '사용자를 찾을 수 없습니다.'}, status=status.HTTP_404_NOT_FOUND)

        if target.role != group.creator.role:
            return Response(
                {'error': f'역할({group.creator.role})이 동일한 사용자만 추가할 수 있습니다.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        if group.members.filter(pk=target.pk).exists():
            return Response({'error': '이미 그룹 멤버입니다.'}, status=status.HTTP_400_BAD_REQUEST)

        group.members.add(target)
        return Response(UserGroupSerializer(group, context={'request': request}).data)

    @action(detail=True, methods=['post'], url_path='remove-member')
    def remove_member(self, request, pk=None):
        """멤버 제거 — 본인 탈퇴 및 타 멤버 내보내기 모두 허용"""
        group = self.get_object()
        user_id = request.data.get('user_id')
        if not user_id:
            return Response({'error': 'user_id는 필수입니다.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            target = User.objects.get(pk=user_id)
        except User.DoesNotExist:
            return Response({'error': '사용자를 찾을 수 없습니다.'}, status=status.HTTP_404_NOT_FOUND)

        if not group.members.filter(pk=target.pk).exists():
            return Response({'error': '그룹 멤버가 아닙니다.'}, status=status.HTTP_400_BAD_REQUEST)

        group.members.remove(target)
        return Response(UserGroupSerializer(group, context={'request': request}).data)
