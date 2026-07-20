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
from django.db.models import Q, Max, Min
from .models import (
    RequestDocument, ApprovalStep, PauseRequest, VOC, VocComment, Line, ProcessProduct, ProductProcessId, AdminNotice,
    PhotoStepS1, PhotoStepS3, PhotoStepS4, PhotoStepS5, VocHistory, ProductBarcode, Guide, UserGroup,
    MapName, AddressBook,
)
from .utils import LINE_TO_LINEID_MAP
from . import mailer
from . import doc_permissions
from .authentication import ExternalApiKeyAuthentication
from .serializers import (
    RequestDocumentSerializer, RequestDocumentListSerializer, ExternalRequestDocumentSerializer,
    VOCSerializer, VocCommentSerializer, LineSerializer, AdminNoticeSerializer, VocHistorySerializer,
    UserSerializer, GuideSerializer, UserGroupSerializer, UserGroupMemberSerializer, AddressBookSerializer,
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


class HasExternalApiKey(BasePermission):
    """ExternalApiKeyAuthentication 이 X-API-Key 검증에 성공했을 때만 허용.

    로그인 계정 인증이 아니므로 request.user.is_authenticated 를 보지 않고,
    request.successful_authenticator 가 ExternalApiKeyAuthentication 인지로 판단한다.
    """

    def has_permission(self, request, view):
        return isinstance(request.successful_authenticator, ExternalApiKeyAuthentication)


class GuideWritePermission(BasePermission):
    """가이드 CRUD 인가.

    - 읽기(GET): IsAuthenticatedOrMasterDelete 와 동일(운영=인증 필요, 개발=허용) — 조회는 전원 제한 없음.
    - 작성/수정(POST·PUT·PATCH): 인증 필요 + PL 역할은 불가(가이드는 PL이 참고하는 대상이지 작성 주체가 아님).
    - 삭제(DELETE): MASTER만(기존과 동일).
    """

    def has_permission(self, request, view):
        if request.method == 'DELETE':
            return bool(request.user and request.user.is_authenticated and request.user.role == 'MASTER')
        if request.method in ('POST', 'PUT', 'PATCH'):
            return bool(
                request.user and request.user.is_authenticated and request.user.role != 'PL'
            )
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

    def get_queryset(self):
        """임시저장(draft) 문서는 작성자 본인 + 작성자와 그룹을 공유하는 멤버 + MASTER 에게만 노출.

        그 외 상태(상신/반려/완료)는 종전대로 전원에게 노출한다.
        '나만의 그룹' = 사용자가 멤버로 속한 모든 UserGroup. 같은 그룹에 속한 사용자끼리는
        서로의 draft 를 볼 수 있다.
        """
        qs = super().get_queryset()
        user = self.request.user
        # 비인증(개발 모드 등) 또는 MASTER 는 전체 조회
        if not getattr(user, 'is_authenticated', False) or getattr(user, 'role', None) == 'MASTER':
            return qs
        my_group_ids = user.member_groups.values_list('id', flat=True)
        comember_ids = list(
            User.objects.filter(member_groups__in=my_group_ids).values_list('id', flat=True)
        )
        return qs.filter(
            ~Q(status='draft') | Q(requester=user) | Q(requester_id__in=comember_ids)
        )

    def get_serializer_class(self):
        if self.action == 'list':
            return RequestDocumentListSerializer
        return RequestDocumentSerializer

    # ===== 결재 액션 서버측 인가 (프론트 ApprovalFlow 와 동일 규칙) =====
    # 프론트의 canUserAgree / canUserAssign 은 UI 가드일 뿐이라 API 직접 호출 시
    # 우회되던 문제(APPROVAL.md §6-1)를 막기 위해 서버에서도 동일 규칙을 강제한다.

    # 역할 → 담당 agent 매핑 (프론트 ROLE_TO_AGENT 와 동일)
    _ROLE_TO_AGENT = {'TE_R': 'R', 'TE_P': 'P', 'TE_J': 'J', 'TE_O': 'O', 'TE_E': 'E'}

    # 검토중(claim) 방식으로 전환된 단계 — 담당자 지정 대신 담당 역할 누구나 스스로 선점한다.
    _CLAIM_AGENTS = ('J', 'O', 'E')

    def _can_act_on_step(self, user, step):
        """합의/반려 인가 (canUserAgree 동일).

        - MASTER: 항상 허용
        - J/O/E(검토중): 누군가 검토중으로 선점(assignee 존재)하면 같은 팀(역할↔agent) 누구나 합의/반려
        - 그 외(PL/R/RV/P/RA): 해당 step 의 assignee 본인만 (지정으로 배정됨)
        """
        role = getattr(user, 'role', '')
        if role == 'MASTER':
            return True
        if step.agent in self._CLAIM_AGENTS:
            # 아직 검토중 선점 전이면 불가(먼저 검토중 필요), 선점 후엔 같은 팀 누구나
            if not step.assignee_id:
                return False
            return self._ROLE_TO_AGENT.get(role) == step.agent
        caller_loginid = getattr(user, 'loginid', '')
        return bool(caller_loginid and step.assignee and step.assignee.loginid == caller_loginid)

    def _can_assign_step(self, user, step):
        """담당자 지정(지정하기) 인가 (canUserAssign 동일 + MASTER 허용).

        - MASTER: 항상 허용
        - PL 단계 / J·O·E(검토중 방식): 지정하기 개념 없음 → 불가
        - R·P: 같은 팀(역할↔agent 일치) + 아직 미지정일 때만
        """
        role = getattr(user, 'role', '')
        if role == 'MASTER':
            return True
        if step.agent == 'PL' or step.agent in self._CLAIM_AGENTS:
            return False
        return (
            self._ROLE_TO_AGENT.get(role) == step.agent
            and not step.assignee_id
        )

    def _can_claim_step(self, user, step):
        """검토중(claim) 인가.

        - MASTER: claim 불필요(바로 합의 가능)하나 편의상 허용
        - J/O/E: 같은 팀(역할↔agent 일치) + pending + 아직 미배정일 때만
        - 그 외 단계(PL/R/P): 검토중 방식 아님 → 불가
        """
        if step.agent not in self._CLAIM_AGENTS:
            return False
        if step.action != 'pending' or step.assignee_id:
            return False
        role = getattr(user, 'role', '')
        if role == 'MASTER':
            return True
        return self._ROLE_TO_AGENT.get(role) == step.agent

    def _can_confirm_pause(self, user, step):
        """중단 요청 '확인' 인가.

        - MASTER: 항상 허용
        - 담당자(assignee)가 있는 단계: 그 담당자 본인만 (PL·R·P·검토중 선점된 J/O/E)
        - 담당자 미배정 단계: 같은 팀(역할↔agent 일치) 누구나
        """
        role = getattr(user, 'role', '')
        if role == 'MASTER':
            return True
        caller_loginid = getattr(user, 'loginid', '')
        if not caller_loginid:
            return False
        if step.assignee_id:
            return bool(step.assignee and step.assignee.loginid == caller_loginid)
        return self._ROLE_TO_AGENT.get(role) == step.agent

    def _active_pause_request(self, document):
        """문서의 활성(요청/확정) 중단 요청. 없으면 None."""
        return PauseRequest.objects.filter(
            document=document, state__in=('requested', 'confirmed')
        ).order_by('-created_at').first()

    def _cancel_active_pause_requests(self, document):
        """진행 중(requested)인 중단 요청을 취소 처리한다.

        결재가 정상 진행(합의/반려)되어 단계가 넘어가면 기존 중단 요청은 무효가 된다.
        """
        PauseRequest.objects.filter(
            document=document, state='requested'
        ).update(state='cancelled')

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

    def _validate_post_approvers(self, document):
        """C가문(only_prodc=YES) 문서는 상신 시 추가 후결자(detail.post_approvers)를
        1명 이상 지정해야 한다. 문제 있으면 error 문자열, 없으면 None.
        (고정 후결자 1명은 별도로 항상 포함되므로 여기서는 추가분만 검증한다.)"""
        detail = document.get_detail().get('detail', {}) or {}
        if detail.get('only_prodc') == 'Yes':
            valid = [p for p in (detail.get('post_approvers') or [])
                     if str((p or {}).get('loginid', '') or '').strip()]
            if not valid:
                return 'C가문 제품은 후결자를 1명 이상 지정해야 합니다.'
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

        pl_users, err = self._resolve_designated_pls(request)
        if err:
            return Response({'error': err}, status=status.HTTP_400_BAD_REQUEST)

        err = self._validate_bb_mapping(document)
        if err:
            return Response({'error': err}, status=status.HTTP_400_BAD_REQUEST)

        err = self._validate_post_approvers(document)
        if err:
            return Response({'error': err}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            document.status = 'under_review'
            document.submitted_at = document.submitted_at or timezone.now()
            # 대표 PL(첫 번째)만 designated_pl FK 에 기록(표시/하위호환용)
            rep = pl_users[0]
            document.designated_pl = rep
            document.designated_pl_name = rep.username or rep.loginid
            document.save()

            # 지정 PL 전원에 대해 pending PL 단계를 생성(전원 합의 필요)
            ApprovalStep.objects.filter(document=document).delete()
            for u in pl_users:
                pl_step = ApprovalStep.objects.create(
                    document=document, agent='PL', action='pending', round=1,
                    assignee=u, assignee_name=(u.username or u.loginid),
                )
                mailer.enqueue_stage_arrival(document, 'PL', pl_step)
            mailer.enqueue_notify_submitted(document)

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

        pl_users, err = self._resolve_designated_pls(request)
        if err:
            return Response({'error': err}, status=status.HTTP_400_BAD_REQUEST)

        err = self._validate_bb_mapping(document)
        if err:
            return Response({'error': err}, status=status.HTTP_400_BAD_REQUEST)

        err = self._validate_post_approvers(document)
        if err:
            return Response({'error': err}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            document.status = 'under_review'
            rep = pl_users[0]
            document.designated_pl = rep
            document.designated_pl_name = rep.username or rep.loginid
            document.save()

            # 새 회차에 지정 PL 전원의 pending 단계를 생성(이전 회차는 이력 보존)
            new_round = self._max_round(document, default=0) + 1
            for u in pl_users:
                pl_step = ApprovalStep.objects.create(
                    document=document, agent='PL', action='pending', round=new_round,
                    assignee=u, assignee_name=(u.username or u.loginid),
                )
                mailer.enqueue_stage_arrival(document, 'PL', pl_step)
            mailer.enqueue_notify_submitted(document)

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

        if agent not in ('R', 'RV', 'P', 'J', 'O', 'E', 'RA'):
            return Response({'error': '유효하지 않은 에이전트입니다.'}, status=status.HTTP_400_BAD_REQUEST)

        # 동시 합의 lost-update 방지: 문서 행을 잠가 같은 문서의 상태전이를 직렬화한다.
        # (J/O/E/RA 병렬 단계를 두 결재자가 거의 동시에 마지막으로 합의할 때, 둘 다 '미완료'로
        #  읽어 approved 전이가 누락되던 문제를 막는다.)
        document = RequestDocument.objects.select_for_update().get(pk=document.pk)

        if document.status == 'pause':
            return Response({'error': '중단된 문서입니다. 작성자가 재개해야 결재를 진행할 수 있습니다.'}, status=status.HTTP_400_BAD_REQUEST)

        max_round = self._max_round(document)

        # 잠근 뒤 최신 커밋본을 읽기 위해 locking read 사용
        # RA(후결자) 다중 담당자: 호출자의 assignee 단계만 조회.
        # J/O/E(검토중)는 회차당 단일 단계이므로 assignee 필터 없이 조회 → 같은 팀 누구나 합의(인가는 _can_act_on_step).
        if agent == 'RA':
            role = getattr(request.user, 'role', '')
            caller_loginid = getattr(request.user, 'loginid', '')
            if role == 'MASTER':
                step = ApprovalStep.objects.select_for_update().filter(
                    document=document, agent=agent, action='pending', round=max_round
                ).first()
            else:
                step = ApprovalStep.objects.select_for_update().filter(
                    document=document, agent=agent, action='pending', round=max_round,
                    assignee__loginid=caller_loginid
                ).first()
        else:
            step = ApprovalStep.objects.select_for_update().filter(
                document=document, agent=agent, action='pending', round=max_round
            ).first()
        if not step:
            return Response({'error': f'AGENT {agent}의 대기 중인 단계가 없습니다.'}, status=status.HTTP_400_BAD_REQUEST)

        if not self._can_act_on_step(request.user, step):
            return Response({'error': '권한이 없습니다.'}, status=status.HTTP_403_FORBIDDEN)

        # RV(검토자)는 담당자(R) 합의 후에만 처리 가능(순차 진행)
        if agent == 'RV':
            r_step = ApprovalStep.objects.filter(document=document, agent='R', round=max_round).first()
            if not r_step or r_step.action != 'approved':
                return Response({'error': '담당자 합의가 먼저 필요합니다.'}, status=status.HTTP_400_BAD_REQUEST)

        step.action = 'approved'
        step.acted_at = timezone.now()
        step.comment = comment
        if not step.assignee_name:
            step.assignee_name = request.data.get('approver_name', '')
        step.save()

        # 결재가 진행되어 단계가 넘어가면 진행 중이던 중단 요청은 무효 처리
        self._cancel_active_pause_requests(document)

        new_status = document.status
        current_round = step.round

        if agent == 'R':
            # 담당자 합의 → 검토자(RV)가 있으면 대기(검토자 차례 — 지금 메일 발송), 없으면 병렬 단계로 전환
            rv_step = ApprovalStep.objects.filter(
                document=document, agent='RV', action='pending', round=current_round
            ).first()
            if rv_step:
                mailer.enqueue_stage_arrival(document, 'RV', rv_step, recipient_name=rv_step.assignee_name)
                new_status = 'under_review'
            else:
                new_status = self._advance_to_parallel(document, step, current_round)

        elif agent == 'RV':
            # 검토자 합의 → 병렬 단계로 전환
            new_status = self._advance_to_parallel(document, step, current_round)

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

        elif agent in ('J', 'O', 'E', 'RA'):
            # J + O + [E] + 후결자(RA) 모두 합의 시 최종 승인.
            # (Only MAP 은 P/O/E 없이 후결자만 종단 경로)
            j_steps = list(ApprovalStep.objects.select_for_update().filter(document=document, agent='J', round=current_round))
            o_step = ApprovalStep.objects.select_for_update().filter(document=document, agent='O', round=current_round).order_by('-id').first()
            e_step = ApprovalStep.objects.select_for_update().filter(document=document, agent='E', round=current_round).order_by('-id').first()
            ra_steps = list(ApprovalStep.objects.select_for_update().filter(document=document, agent='RA', round=current_round))

            # 후결자: 존재하는 RA 전원 합의 (없으면 해당 경로 없음으로 간주 → True)
            ra_ok = (len(ra_steps) == 0) or all(s.action == 'approved' for s in ra_steps)

            if document.is_only_map():
                # Only MAP: 후결자(RA)만 종단 경로 — RA 전원 합의 시 최종 승인
                all_approved = len(ra_steps) > 0 and ra_ok
            else:
                j_approved = len(j_steps) > 0 and all(s.action == 'approved' for s in j_steps)
                o_approved = o_step and o_step.action == 'approved'
                e_ok = (e_step is None) or (e_step.action == 'approved')
                all_approved = j_approved and o_approved and e_ok and ra_ok
            if all_approved:
                new_status = 'approved'

        document.status = new_status
        document.save()

        if new_status == 'approved':
            mailer.enqueue_approved(document)
            mailer.enqueue_notify_approved(document)

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

        if agent not in ('R', 'RV', 'P', 'J', 'O', 'E', 'RA'):
            return Response({'error': '유효하지 않은 에이전트입니다.'}, status=status.HTTP_400_BAD_REQUEST)

        # 문서 행을 잠가 합의(approve_step)와 반려가 동시에 같은 문서를 전이시키는 경쟁을 직렬화한다.
        document = RequestDocument.objects.select_for_update().get(pk=document.pk)

        if document.status == 'pause':
            return Response({'error': '중단된 문서입니다. 작성자가 재개해야 결재를 진행할 수 있습니다.'}, status=status.HTTP_400_BAD_REQUEST)

        max_round = self._max_round(document)

        # RA(후결자) 다중 담당자: 호출자의 assignee 단계만 조회.
        # J/O/E(검토중)는 회차당 단일 단계이므로 assignee 필터 없이 조회 → 같은 팀 누구나 반려(인가는 _can_act_on_step).
        if agent == 'RA':
            role = getattr(request.user, 'role', '')
            caller_loginid = getattr(request.user, 'loginid', '')
            if role == 'MASTER':
                step = ApprovalStep.objects.select_for_update().filter(
                    document=document, agent=agent, action='pending', round=max_round
                ).first()
            else:
                step = ApprovalStep.objects.select_for_update().filter(
                    document=document, agent=agent, action='pending', round=max_round,
                    assignee__loginid=caller_loginid
                ).first()
        else:
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

        # 반려로 회차가 종료되면 진행 중이던 중단 요청은 무효 처리
        self._cancel_active_pause_requests(document)

        document.status = 'rejected'
        document.save()

        mailer.enqueue_rejected(document)

        return Response({'message': '반려되었습니다.', 'status': 'rejected'})

    @action(detail=True, methods=['post'], url_path='assign-step')
    @transaction.atomic
    def assign_step(self, request, pk=None):
        """에이전트 단계 담당자 지정.

        R(RFG) 단계는 담당자(assignee_loginid, 필수)와 함께 검토자(reviewer_loginid, 선택)를
        함께 지정할 수 있다. 검토자를 지정하면 RV(검토자) 단계를 생성해 '담당자 → 검토자'
        순서로 진행한다('검토자 없음' 이면 RV 미생성 → 담당자 합의 즉시 다음 단계).
        """
        document = self.get_object()
        agent = request.data.get('agent')
        assignee_loginid = request.data.get('assignee_loginid')
        assignee_name = request.data.get('assignee_name', '')
        reviewer_loginid = str(request.data.get('reviewer_loginid', '') or '').strip()

        # agent 화이트리스트: 'PL' 등으로 지정 PL 단계를 덮어써 change_designee 권한검증을
        # 우회하는 것을 차단한다(PL 지정 변경은 change_designee 전용).
        if agent not in ('R', 'P', 'J', 'O', 'E'):
            return Response({'error': '유효하지 않은 에이전트입니다.'}, status=status.HTTP_400_BAD_REQUEST)

        if document.status == 'pause':
            return Response({'error': '중단된 문서입니다. 작성자가 재개해야 결재를 진행할 수 있습니다.'}, status=status.HTTP_400_BAD_REQUEST)

        max_round = self._max_round(document)

        # 단일 담당자 지정 (R·P 전용 — J/O/E 는 검토중(claim) 방식)
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

        # R 담당자 지정 메일은 제목에 이름을 붙인다("[이름님] ..."). 그 외(P)는 기존과 동일.
        mailer.enqueue_stage_arrival(document, agent, step, recipient_name=(step.assignee_name if agent == 'R' else None))

        # R(RFG 담당자) 지정 시 검토자(RV) 도 함께 지정 — '담당자 → 검토자' 순서로 진행
        if agent == 'R':
            ApprovalStep.objects.filter(
                document=document, agent='RV', action='pending', round=max_round
            ).delete()
            if reviewer_loginid:
                if reviewer_loginid == (assignee_loginid or ''):
                    return Response({'error': '담당자와 검토자는 서로 달라야 합니다.'}, status=status.HTTP_400_BAD_REQUEST)
                try:
                    reviewer_user = User.objects.get(loginid=reviewer_loginid, role='TE_R')
                except User.DoesNotExist:
                    return Response({'error': '유효하지 않은 검토자입니다(RFG 팀이어야 합니다).'}, status=status.HTTP_400_BAD_REQUEST)
                ApprovalStep.objects.create(
                    document=document, agent='RV', action='pending', round=max_round,
                    assignee=reviewer_user, assignee_name=(reviewer_user.username or reviewer_user.loginid),
                )

        return Response({'message': '담당자가 지정되었습니다.'})

    @action(detail=True, methods=['post'], url_path='claim-step')
    @transaction.atomic
    def claim_step(self, request, pk=None):
        """검토중(claim) — J/O/E 단계를 담당 역할 사용자가 스스로 선점한다.

        먼저 누른 1명이 해당 단계의 assignee 로 고정되며(취소·재클릭 불가),
        이후 그 사용자만 합의/반려할 수 있다. 동시 선점 경합은 문서 행을 잠가 직렬화한다.
        """
        document = self.get_object()
        agent = request.data.get('agent')

        if agent not in self._CLAIM_AGENTS:
            return Response({'error': '유효하지 않은 에이전트입니다.'}, status=status.HTTP_400_BAD_REQUEST)

        # 동시 선점 경합 방지: 문서 행을 잠가 같은 단계의 중복 배정을 막는다.
        document = RequestDocument.objects.select_for_update().get(pk=document.pk)

        if document.status == 'pause':
            return Response({'error': '중단된 문서입니다. 작성자가 재개해야 결재를 진행할 수 있습니다.'}, status=status.HTTP_400_BAD_REQUEST)

        max_round = self._max_round(document)

        step = ApprovalStep.objects.select_for_update().filter(
            document=document, agent=agent, action='pending', round=max_round
        ).first()
        if not step:
            return Response({'error': '해당 단계를 찾을 수 없습니다.'}, status=status.HTTP_400_BAD_REQUEST)

        if step.assignee_id:
            return Response({'error': '이미 다른 담당자가 검토 중입니다.'}, status=status.HTTP_409_CONFLICT)

        if not self._can_claim_step(request.user, step):
            return Response({'error': '권한이 없습니다.'}, status=status.HTTP_403_FORBIDDEN)

        step.assignee = request.user
        step.assignee_name = getattr(request.user, 'username', '') or getattr(request.user, 'loginid', '')
        step.save()

        return Response({'message': '검토를 시작했습니다.'})

    @action(detail=True, methods=['post'], url_path='request-pause')
    @transaction.atomic
    def request_pause(self, request, pk=None):
        """중단 요청: 작성자가 진행 중(under_review) 결재의 중단을 요청한다(사유 필수).

        요청 시점의 현재(pending) 결재 단계 id 를 target 으로 기록하고, 그 단계 팀 전원이
        '중단 확인'하면 문서가 pause 로 전이된다. 상태 뱃지는 확인 완료 전까지 그대로 유지된다.
        """
        document = self.get_object()
        document = RequestDocument.objects.select_for_update().get(pk=document.pk)

        reason = (request.data.get('reason') or '').strip()
        if not reason:
            return Response({'error': '중단 사유를 입력해주세요.'}, status=status.HTTP_400_BAD_REQUEST)

        if not doc_permissions.can_request_pause(request.user, document):
            return Response({'error': '중단 요청 권한이 없거나, 이미 진행 중인 중단 요청이 있습니다.'}, status=status.HTTP_403_FORBIDDEN)

        max_round = self._max_round(document)
        pending = list(ApprovalStep.objects.filter(
            document=document, action='pending', round=max_round
        ))
        if not pending:
            return Response({'error': '진행 중인 결재 단계가 없습니다.'}, status=status.HTTP_400_BAD_REQUEST)

        PauseRequest.objects.create(
            document=document,
            requester=request.user if getattr(request.user, 'loginid', '') else None,
            requester_name=getattr(request.user, 'username', '') or getattr(request.user, 'loginid', ''),
            reason=reason,
            round=max_round,
            target_step_ids=[s.id for s in pending],
            confirmed_step_ids=[],
        )

        return Response({
            'message': '중단 요청이 접수되었습니다. 현재 단계 팀의 확인을 기다립니다.',
            'document': RequestDocumentSerializer(document, context={'request': request}).data,
        })

    @action(detail=True, methods=['post'], url_path='confirm-pause')
    @transaction.atomic
    def confirm_pause(self, request, pk=None):
        """중단 확인: 현재 단계 담당자/팀이 중단 요청을 확인한다.

        요청 시점의 pending 단계 '전원'이 확인하면 문서가 pause 로 전이된다(병렬 단계 대응).
        """
        document = self.get_object()
        document = RequestDocument.objects.select_for_update().get(pk=document.pk)

        pr = self._active_pause_request(document)
        if not pr or pr.state != 'requested':
            return Response({'error': '진행 중인 중단 요청이 없습니다.'}, status=status.HTTP_400_BAD_REQUEST)

        agent = request.data.get('agent')
        max_round = self._max_round(document)

        # 호출자가 확인할 수 있는, target 에 포함된 현재 회차 pending 단계를 찾는다.
        candidates = ApprovalStep.objects.select_for_update().filter(
            document=document, agent=agent, action='pending',
            round=max_round, id__in=pr.target_step_ids,
        )
        step = next((s for s in candidates if self._can_confirm_pause(request.user, s)), None)
        if not step:
            return Response({'error': '확인 권한이 없습니다.'}, status=status.HTTP_403_FORBIDDEN)

        confirmed = list(pr.confirmed_step_ids or [])
        if step.id not in confirmed:
            confirmed.append(step.id)
        pr.confirmed_step_ids = confirmed

        # target 전원 확인 완료 시 pause 전이
        all_confirmed = set(pr.target_step_ids or []).issubset(set(confirmed))
        if all_confirmed:
            pr.state = 'confirmed'
            pr.confirmed_at = timezone.now()
            pr.save()
            document.status = 'pause'
            document.save()
            msg = '중단이 확정되었습니다.'
        else:
            pr.save()
            msg = '확인했습니다. 다른 단계의 확인을 기다립니다.'

        return Response({
            'message': msg,
            'status': document.status,
            'document': RequestDocumentSerializer(document, context={'request': request}).data,
        })

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def resume(self, request, pk=None):
        """재개: 작성자가 중단(pause) 문서를 재개한다 → under_review.

        멈춘 시점의 pending 단계를 그대로 되살려 그 단계부터 결재가 이어진다
        (처음 PL 검토로 돌아가거나 회차를 새로 만들지 않는다). 문서 내용 수정은
        사전에 /request 화면에서 update 된다.
        """
        document = self.get_object()
        # select_for_update 는 트랜잭션 안에서만 사용 가능하므로 메서드 전체를 atomic 으로 감싼다.
        document = RequestDocument.objects.select_for_update().get(pk=document.pk)

        if not doc_permissions.can_resume(request.user, document):
            return Response({'error': '재개 권한이 없습니다.'}, status=status.HTTP_403_FORBIDDEN)
        if document.status != 'pause':
            return Response({'error': '중단된 문서만 재개할 수 있습니다.'}, status=status.HTTP_400_BAD_REQUEST)

        # 멈춘 기간(중단 확정~재개)만큼 현재 pending 단계의 마감 기한을 미뤄, 중단 동안
        # 남은 기한이 깎이지 않게 한다(감사 #1). 달력일 기준으로 밀어 남은 여유를 보존한다.
        import datetime
        pr = PauseRequest.objects.filter(
            document=document, state='confirmed'
        ).order_by('-created_at').first()
        if pr and pr.confirmed_at:
            paused_days = (timezone.now().date() - pr.confirmed_at.date()).days
            if paused_days > 0:
                max_round = self._max_round(document)
                for step in ApprovalStep.objects.filter(
                    document=document, action='pending', round=max_round
                ).exclude(due_date__isnull=True):
                    step.due_date = step.due_date + datetime.timedelta(days=paused_days)
                    step.save(update_fields=['due_date'])

        document.status = 'under_review'
        document.save()
        PauseRequest.objects.filter(
            document=document, state='confirmed'
        ).update(state='resumed')

        return Response({
            'message': '결재를 재개했습니다. 멈춘 단계부터 이어집니다.',
            'status': 'under_review',
            'document': RequestDocumentSerializer(document, context={'request': request}).data,
        })

    @action(detail=True, methods=['post'], url_path='cancel-pause')
    @transaction.atomic
    def cancel_pause(self, request, pk=None):
        """중단 요청 취소: 확인 완료 전(requested) 요청을 작성자/MASTER 가 철회한다."""
        document = self.get_object()
        document = RequestDocument.objects.select_for_update().get(pk=document.pk)

        role = getattr(request.user, 'role', '')
        if role != 'MASTER' and not doc_permissions.is_requester(request.user, document):
            return Response({'error': '권한이 없습니다.'}, status=status.HTTP_403_FORBIDDEN)

        updated = PauseRequest.objects.filter(
            document=document, state='requested'
        ).update(state='cancelled')
        if not updated:
            return Response({'error': '취소할 중단 요청이 없습니다.'}, status=status.HTTP_400_BAD_REQUEST)

        return Response({
            'message': '중단 요청을 취소했습니다.',
            'document': RequestDocumentSerializer(document, context={'request': request}).data,
        })

    def _get_pending_pl_step(self, document):
        """현재 회차의 pending PL 단계 반환(첫 번째). 없으면 None."""
        max_round = self._max_round(document)
        return ApprovalStep.objects.filter(
            document=document, agent='PL', action='pending', round=max_round
        ).first()

    def _get_caller_pl_step(self, document, user):
        """호출자가 처리할 현재 회차 pending PL 단계.

        다중 PL 검토를 지원한다(전원 합의). MASTER 는 첫 pending PL 단계,
        그 외에는 본인이 담당(assignee)인 pending PL 단계를 반환한다. 없으면 None.
        """
        max_round = self._max_round(document)
        qs = ApprovalStep.objects.filter(
            document=document, agent='PL', action='pending', round=max_round
        )
        role = getattr(user, 'role', '')
        if role == 'MASTER':
            return qs.first()
        caller_loginid = getattr(user, 'loginid', '')
        if not caller_loginid:
            return None
        return qs.filter(assignee__loginid=caller_loginid).first()

    def _all_pl_approved(self, document, round_no):
        """해당 회차의 PL 단계 전원이 approved 인지(다중 PL 전원 합의 판정)."""
        pl_steps = list(ApprovalStep.objects.filter(
            document=document, agent='PL', round=round_no
        ))
        return len(pl_steps) > 0 and all(s.action == 'approved' for s in pl_steps)

    def _get_post_approver_users(self, document):
        """후결자(RA) User 목록 = 고정 1명(settings.POST_APPROVER_LOGINID)
        + C가문(only_prodc=YES) 추가 후결자(detail.post_approvers). loginid 중복 제거."""
        from django.conf import settings
        users = []
        seen = set()
        fixed_lid = (getattr(settings, 'POST_APPROVER_LOGINID', '') or '').strip()
        if fixed_lid:
            u = User.objects.filter(loginid=fixed_lid).first()
            if u:
                users.append(u)
                seen.add(u.loginid)
        detail = document.get_detail().get('detail', {}) or {}
        for pa in (detail.get('post_approvers') or []):
            lid = str((pa or {}).get('loginid', '') or '').strip()
            if lid and lid not in seen:
                u = User.objects.filter(loginid=lid).first()
                if u:
                    users.append(u)
                    seen.add(lid)
        return users

    def _advance_to_parallel(self, document, step, round_no):
        """R단계(담당자[→검토자]) 완료 후 병렬 단계 생성 → 반환할 새 status.

        - Only MAP: P/O/E 없이 후결자(RA)만 생성(후결자 전원 합의 시 최종 승인).
          후결자가 하나도 없으면(고정 미설정 + 비 C가문) 기존처럼 즉시 승인한다.
        - 일반: P(4영업일)·O(6영업일 병렬)·[E(plel 시 6영업일)] + 후결자(RA, 6영업일 병렬) 생성.
        """
        from .utils import calculate_business_due_date
        import datetime
        base_date = step.acted_at.date() if step.acted_at else datetime.date.today()
        ra_due = calculate_business_due_date(base_date, 6)
        post_users = self._get_post_approver_users(document)

        if document.is_only_map():
            if not post_users:
                return 'approved'
        else:
            p_due = calculate_business_due_date(base_date, 4)
            o_due = calculate_business_due_date(base_date, 6)
            p_step = ApprovalStep.objects.create(
                document=document, agent='P', action='pending', round=round_no, due_date=p_due,
            )
            o_step = ApprovalStep.objects.create(
                document=document, agent='O', action='pending', is_parallel=True, round=round_no, due_date=o_due,
            )
            mailer.enqueue_stage_arrival(document, 'P', p_step)
            mailer.enqueue_stage_arrival(document, 'O', o_step)
            if document.has_ppid_plel():
                e_step = ApprovalStep.objects.create(
                    document=document, agent='E', action='pending', is_parallel=True, round=round_no, due_date=o_due,
                )
                mailer.enqueue_stage_arrival(document, 'E', e_step)

        # 후결자(RA) 병렬 생성 — 고정 1명 + C가문 추가. 각자에게 "[후결 요청]" 메일 발송.
        for u in post_users:
            ra_step = ApprovalStep.objects.create(
                document=document, agent='RA', action='pending', is_parallel=True,
                round=round_no, due_date=ra_due,
                assignee=u, assignee_name=(u.username or u.loginid),
            )
            mailer.enqueue_stage_arrival(document, 'RA', ra_step)
        return 'under_review'

    def _resolve_designated_pls(self, request):
        """요청에서 지정 PL 목록을 파싱·검증해 (User 리스트, error) 를 반환한다.

        다중 지정(`designated_pl_loginids` 배열)을 우선하고, 없으면 단일
        (`designated_pl_loginid`) 을 1개 배열로 호환 처리한다. 각 대상은
        role='PL' 이어야 하고 본인은 지정할 수 없다. error 가 None 이 아니면 실패.
        """
        loginids = request.data.get('designated_pl_loginids')
        if not isinstance(loginids, list):
            single = str(request.data.get('designated_pl_loginid', '') or '').strip()
            loginids = [single] if single else []
        # 공백 제거 + 중복 제거(순서 보존)
        cleaned = []
        for lid in loginids:
            lid = str(lid or '').strip()
            if lid and lid not in cleaned:
                cleaned.append(lid)
        if not cleaned:
            return None, '동료 PL을 지정해주세요.'
        caller_loginid = getattr(request.user, 'loginid', '')
        pl_users = []
        for lid in cleaned:
            try:
                u = User.objects.get(loginid=lid, role='PL')
            except User.DoesNotExist:
                return None, f'유효하지 않은 PL 사용자입니다: {lid}'
            if caller_loginid and lid == caller_loginid:
                return None, '본인을 지정할 수 없습니다.'
            pl_users.append(u)
        return pl_users, None

    def _advance_after_pl(self, document, step, comment):
        """PL 단계 합의 처리 공용: 본인 단계 approved 후 전원 합의 시 R 생성.

        다중 PL 전원 합의를 지원한다. 문서 행 락으로 동시 합의 시 R 중복/누락을
        방지한다. 전원 합의면 R 생성 후 True, 아직 대기자가 있으면 False 를 반환한다.
        """
        with transaction.atomic():
            RequestDocument.objects.select_for_update().get(pk=document.pk)
            step.action = 'approved'
            step.acted_at = timezone.now()
            step.comment = comment
            step.save()

            if self._all_pl_approved(document, step.round):
                # 전원 합의 → R 생성(중복 방지: 이미 있으면 재생성하지 않음)
                if not ApprovalStep.objects.filter(document=document, agent='R', round=step.round).exists():
                    r_step = ApprovalStep.objects.create(
                        document=document, agent='R', action='pending', round=step.round,
                    )
                    mailer.enqueue_stage_arrival(document, 'R', r_step)
                document.status = 'under_review'
                document.save(update_fields=['status'])
                return True

            document.status = 'under_review'
            document.save(update_fields=['status'])
            return False

    @action(detail=True, methods=['post'], url_path='peer-approve')
    def peer_approve(self, request, pk=None):
        """지정 PL 합의: 본인 PL 단계 approved → 전원 합의 시 R 단계 생성(다중 PL)"""
        document = self.get_object()
        step = self._get_caller_pl_step(document, request.user)
        if not step:
            return Response({'error': '대기 중인 본인 PL 검토 단계가 없습니다.'}, status=status.HTTP_400_BAD_REQUEST)

        comment = request.data.get('comment', '')
        all_done = self._advance_after_pl(document, step, comment)
        msg = ('전원 합의되어 R 단계로 진행합니다.' if all_done
               else '합의되었습니다. 다른 지정 PL의 합의를 기다립니다.')
        return Response({'message': msg, 'status': 'under_review'})

    @action(detail=True, methods=['post'], url_path='peer-reject')
    def peer_reject(self, request, pk=None):
        """지정 PL 반려: 본인 PL 단계 rejected → 문서 즉시 반려(다중 PL 중 1명이라도 반려 시)"""
        document = self.get_object()
        step = self._get_caller_pl_step(document, request.user)
        if not step:
            return Response({'error': '대기 중인 본인 PL 검토 단계가 없습니다.'}, status=status.HTTP_400_BAD_REQUEST)

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
        """지정 PL 수정 후 상신: 문서는 이미 update됨. 본인 PL 단계 approved(태그) → 전원 합의 시 R 생성"""
        document = self.get_object()
        step = self._get_caller_pl_step(document, request.user)
        if not step:
            return Response({'error': '대기 중인 본인 PL 검토 단계가 없습니다.'}, status=status.HTTP_400_BAD_REQUEST)

        comment = request.data.get('comment', '')
        tagged = f'[수정 후 상신] {comment}'.strip()
        all_done = self._advance_after_pl(document, step, tagged)
        msg = ('수정 후 상신되었습니다. 전원 합의되어 R 단계로 진행합니다.' if all_done
               else '수정 후 상신되었습니다. 다른 지정 PL의 합의를 기다립니다.')
        return Response({'message': msg, 'status': 'under_review'})

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

    @action(detail=True, methods=['post'], url_path='change-post-approver')
    @transaction.atomic
    def change_post_approver(self, request, pk=None):
        """후결자 변경: C가문 추가 후결자(RA)를 작성자(또는 MASTER)가 결재 중 교체.

        고정 후결자(settings.POST_APPROVER_LOGINID)는 변경 불가. 아직 합의하지 않은
        pending RA 단계의 담당자를 다른 PL 로 스왑한다. detail.post_approvers 도 갱신.
        """
        from django.conf import settings
        document = self.get_object()
        document = RequestDocument.objects.select_for_update().get(pk=document.pk)
        user_role = getattr(request.user, 'role', '')
        caller_loginid = getattr(request.user, 'loginid', '')
        is_requester = bool(document.requester and document.requester.loginid == caller_loginid)
        if user_role != 'MASTER' and not is_requester:
            return Response({'error': '권한이 없습니다.'}, status=status.HTTP_403_FORBIDDEN)

        old_loginid = str(request.data.get('old_loginid', '') or '').strip()
        new_loginid = str(request.data.get('new_loginid', '') or '').strip()
        if not old_loginid or not new_loginid:
            return Response({'error': '기존/새 후결자 loginid를 입력해주세요.'}, status=status.HTTP_400_BAD_REQUEST)

        fixed_lid = (getattr(settings, 'POST_APPROVER_LOGINID', '') or '').strip()
        if old_loginid == fixed_lid:
            return Response({'error': '고정 후결자는 변경할 수 없습니다.'}, status=status.HTTP_400_BAD_REQUEST)
        if new_loginid == fixed_lid:
            return Response({'error': '고정 후결자와 중복 지정할 수 없습니다.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            new_user = User.objects.get(loginid=new_loginid, role='PL')
        except User.DoesNotExist:
            return Response({'error': '유효하지 않은 후결자입니다(PL 이어야 합니다).'}, status=status.HTTP_400_BAD_REQUEST)

        max_round = self._max_round(document)
        # 이미 다른 후결자로 지정돼 있으면 중복 방지
        if ApprovalStep.objects.filter(document=document, agent='RA', round=max_round,
                                       assignee__loginid=new_loginid).exists():
            return Response({'error': '이미 후결자로 지정된 사용자입니다.'}, status=status.HTTP_400_BAD_REQUEST)

        ra_step = ApprovalStep.objects.filter(
            document=document, agent='RA', action='pending', round=max_round,
            assignee__loginid=old_loginid,
        ).first()
        if not ra_step:
            return Response({'error': '변경 가능한(미합의) 후결자 단계를 찾을 수 없습니다.'}, status=status.HTTP_400_BAD_REQUEST)

        ra_step.assignee = new_user
        ra_step.assignee_name = new_user.username or new_loginid
        ra_step.save()

        # detail.post_approvers 갱신(재상신/일관성 대비)
        import json
        try:
            data = json.loads(document.additional_notes or '{}')
            detail = data.get('detail', {}) or {}
            pas = detail.get('post_approvers') or []
            for pa in pas:
                if str((pa or {}).get('loginid', '') or '').strip() == old_loginid:
                    pa['loginid'] = new_loginid
                    pa['name'] = ra_step.assignee_name
            detail['post_approvers'] = pas
            data['detail'] = detail
            document.additional_notes = json.dumps(data, ensure_ascii=False)
            document.save(update_fields=['additional_notes'])
        except (json.JSONDecodeError, TypeError):
            pass

        return Response({'message': '후결자가 변경되었습니다.',
                         'document': RequestDocumentSerializer(document, context={'request': request}).data})

    def _unique_title(self, base_title, exclude_id=None):
        """중복 제목 처리: 같은 제목이 있으면 _2, _3, ... suffix 를 붙여 반환.

        title 컬럼 max_length 를 절대 넘지 않도록 방어적으로 자른다(suffix 포함).
        긴 라인/조합법/제품 이름으로 자동 생성 제목이 한도를 초과해 저장이 실패하던
        문제를 막는다(감사 §4-1).
        """
        title_max = RequestDocument._meta.get_field('title').max_length
        base_title = base_title[:title_max]

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
        suffix = f"_{next_num}"
        # suffix 를 붙여도 컬럼 한도를 넘지 않도록 base 를 잘라낸다
        trimmed_base = base_title[:title_max - len(suffix)]
        return f"{trimmed_base}{suffix}"

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


class ExternalRequestDocumentViewSet(viewsets.ReadOnlyModelViewSet):
    """외부 시스템용 고정 API Key 읽기 전용 조회.

    /api/external/v1/documents/ — 로그인 계정과 무관하게 X-API-Key 헤더 하나로 접근한다.
    내부 결재 액션(submit/approve-step/delete 등)이 있는 RequestDocumentViewSet 과는
    완전히 분리된 클래스라 실수로도 쓰기 액션이 노출되지 않는다. draft 포함 전체 상태를 반환한다
    (내부용 get_queryset() 의 draft 접근 제한과 달리 API Key 소지자는 전체를 조회할 수 있음 — 의도된 동작).
    """
    queryset = RequestDocument.objects.select_related('requester', 'designated_pl').all()
    serializer_class = ExternalRequestDocumentSerializer
    authentication_classes = [ExternalApiKeyAuthentication]
    permission_classes = [HasExternalApiKey]
    pagination_class = None
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['status', 'product_name']
    search_fields = ['title', 'product_name', 'requester_name', 'requester_department']
    ordering_fields = ['created_at', 'submitted_at']
    ordering = ['-created_at']


class VOCViewSet(viewsets.ModelViewSet):
    queryset = VOC.objects.all()
    serializer_class = VOCSerializer
    permission_classes = [IsAuthenticatedOrMasterDelete]
    pagination_class = None  # 목록 전체 반환(앱 컨벤션). 전역 PAGE_SIZE=20 적용 방지.
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ['category', 'status', 'submitter_user_id']
    search_fields = ['title', 'submitter_name', 'content']
    ordering = ['-created_at']

    def perform_create(self, serializer):
        voc = serializer.save()
        mailer.enqueue_voc_created(voc)

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
        commenter_email = getattr(request.user, 'mail', '') or ''
        commenter_name = getattr(request.user, 'username', '') or ''
        data = {**request.data, 'voc': voc.id}
        serializer = VocCommentSerializer(data=data)
        serializer.is_valid(raise_exception=True)
        serializer.save(author_email=commenter_email)
        mailer.enqueue_voc_comment(voc, commenter_email, commenter_name=commenter_name)
        return Response(VOCSerializer(voc).data)


class LineViewSet(viewsets.ReadOnlyModelViewSet):
    """{{request.line}} 마스터 데이터 (읽기 전용)"""
    queryset = Line.objects.filter(is_active=True)
    serializer_class = LineSerializer
    permission_classes = [IsAuthenticatedInProd]
    pagination_class = None


class AdminNoticeViewSet(viewsets.ModelViewSet):
    """공지사항 (읽기: 모두, 쓰기: MASTER 전용)"""
    queryset = AdminNotice.objects.order_by('-date', '-created_at')
    serializer_class = AdminNoticeSerializer
    permission_classes = [IsMasterOrReadOnly]
    pagination_class = None
    filter_backends = []

    @action(detail=False, methods=['get'])
    def latest(self, request):
        """가장 최근에 수정된 공지 1개 반환 (Navbar 배지 판별용)"""
        notice = AdminNotice.objects.order_by('-updated_at').first()
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


def _natural_key(s: str) -> list:
    """'{문자}{숫자}' 패턴(예: A1, B10)을 숫자 인식 오름차순으로 정렬하기 위한 키."""
    return [int(c) if c.isdigit() else c.lower() for c in re.split(r'(\d+)', s or '')]


@require_GET
def form_options_layer_ids(request):
    """line + process → unique layerid list sorted by min stepseq (natural order)"""
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
        rows = (
            model.objects.filter(eqptype='PMAINF', processid=process)
            .exclude(layerid='').exclude(layerid=None)
            .values('layerid')
            .annotate(min_seq=Min('stepseq'))
        )
        sorted_rows = sorted(rows, key=lambda r: _natural_key(r['min_seq']))
        return JsonResponse({'options': [r['layerid'] for r in sorted_rows]})
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

        # 역할 배정 시각 갱신('최근 추가순' 정렬용). NONE(역할 회수)이면 초기화한다.
        assigned_at = timezone.now() if role != 'NONE' else None
        User.objects.filter(pk=user.pk).update(role=role, role_assigned_at=assigned_at)
        user.refresh_from_db()

        payload = {
            'id': user.id,
            'loginid': user.loginid,
            'name': user.username or '',
            'deptname': user.deptname or '',
            'role': role,
            'mail': user.mail or '',
            'role_assigned_at': user.role_assigned_at.isoformat() if user.role_assigned_at else None,
        }
        broadcaster.broadcast('user_updated', payload)

        return Response(payload)
    
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
    permission_classes = [GuideWritePermission]
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


class AddressBookViewSet(viewsets.ModelViewSet):
    """주소록 ViewSet — 통보처로 쓸 사람 묶음을 본인만 CRUD.

    - 조회/수정/삭제 모두 owner=본인 스코프 (타인 주소록 접근 불가)
    - 상신 모달의 '통보처 불러오기'가 이 목록을 읽어 통보처(detail.notifiers)에 채운다.
    """
    serializer_class = AddressBookSerializer
    permission_classes = [IsAuthenticatedInProd]
    pagination_class = None

    def get_queryset(self):
        if not self.request.user.is_authenticated:
            return AddressBook.objects.none()
        return AddressBook.objects.filter(owner=self.request.user)

    def get_object(self):
        from django.shortcuts import get_object_or_404
        if not self.request.user.is_authenticated:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied()
        return get_object_or_404(
            AddressBook.objects.filter(owner=self.request.user),
            pk=self.kwargs['pk']
        )

    def update(self, request, *args, **kwargs):
        kwargs['partial'] = True
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        self.get_object().delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
