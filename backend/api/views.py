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
from rest_framework import viewsets, status, filters, mixins
from rest_framework.decorators import action, api_view
from rest_framework.response import Response
from rest_framework.permissions import AllowAny, BasePermission, SAFE_METHODS
from rest_framework.exceptions import ValidationError
from django.conf import settings
from django_filters.rest_framework import DjangoFilterBackend
from django.db import connection, transaction
from django.contrib.auth import get_user_model
User = get_user_model()
from django.db.models import Q, Max, Min, Exists, OuterRef
from .models import (
    RequestDocument, ApprovalStep, PauseRequest, WithdrawRequest, VOC, VocComment, Line, ProcessProduct,
    ProductProcessId, AdminNotice,
    PhotoStepS1, PhotoStepS3, PhotoStepS4, PhotoStepS5, VocHistory, ProductBarcode, Guide, UserGroup,
    MapName, AddressBook, ProcessDesignRuleOverride, DocumentDesignRuleOverride,
    DocumentReviewItem, DocumentReviewItemReviewer, RejectionSnapshot,
)
from .utils import LINE_TO_LINEID_MAP
from . import mailer
from . import doc_permissions
from . import design_rule_stats
from . import review_items as review_items_sync
from . import rejection_snapshots
from .authentication import ExternalApiKeyAuthentication
from .serializers import (
    RequestDocumentSerializer, RequestDocumentListSerializer, ExternalRequestDocumentSerializer,
    DocumentReviewItemSerializer,
    VOCSerializer, VocCommentSerializer, LineSerializer, AdminNoticeSerializer, VocHistorySerializer,
    UserSerializer, GuideSerializer, UserGroupSerializer, UserGroupMemberSerializer, AddressBookSerializer,
    ProcessDesignRuleOverrideSerializer, DocumentDesignRuleOverrideSerializer,
    RejectionSnapshotSerializer,
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
    # REST DELETE 미허용 — 삭제는 인가가 붙은 `POST documents/{id}/delete/` 로만 처리한다.
    # ModelViewSet 기본 destroy 는 인가 없이 어떤 상태의 문서든(결재 완료본 포함) 지울 수 있다.
    # destroy 를 오버라이드해 405 를 반환하는 방식은 Allow 헤더에 DELETE 가 남아
    # "허용한다고 광고하면서 405 를 주는" 모순이 생기므로, 메서드 목록에서 제외한다.
    # ⚠️ DestroyModelMixin 을 빼는 방식은 이 클래스에서 쓸 수 없다 — 아래 `delete` 액션의
    #    메서드명이 HTTP DELETE 와 겹쳐, 라우터 매핑이 사라지면 APIView.dispatch 가
    #    getattr(self, 'delete') 로 그 액션을 잡아 DELETE 요청이 그대로 실행된다.
    http_method_names = ['get', 'post', 'put', 'patch', 'head', 'options']
    # review_items__reviewers 프리페치: 목록 직렬화의 my_pending_review_items 가 문서마다
    # 항목·검토자를 다시 조회하지 않도록 한다.
    queryset = RequestDocument.objects.select_related('requester', 'designated_pl').prefetch_related(
        'review_items__reviewers'
    ).all()
    permission_classes = [IsAuthenticatedInProd]
    pagination_class = None  # 목록 전체 반환(앱 컨벤션). 전역 PAGE_SIZE=20 적용 방지.
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['status', 'product_name']
    search_fields = ['title', 'product_name', 'requester_name', 'requester_department']
    ordering_fields = ['created_at', 'submitted_at']
    ordering = ['-created_at']

    def get_queryset(self):
        """임시저장(draft) 문서는 작성자 본인 + 문서에 지정된 공유 그룹의 멤버 + MASTER 에게만 노출.

        그 외 상태(상신/반려/완료)는 종전대로 전원에게 노출한다.
        공유 대상은 작성자가 문서마다 고른 **그룹 1개**(shared_group)다. 지정하지 않은
        draft 는 작성자 본인과 MASTER 외에는 보이지 않는다.
        """
        qs = super().get_queryset()
        user = self.request.user
        # 비인증(개발 모드 등) 또는 MASTER 는 전체 조회
        if not getattr(user, 'is_authenticated', False) or getattr(user, 'role', None) == 'MASTER':
            return qs
        my_group_ids = list(user.member_groups.values_list('id', flat=True))
        return qs.filter(
            ~Q(status='draft') | Q(requester=user) | Q(shared_group_id__in=my_group_ids)
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

    def _blocked_progress_response(self, document):
        """결재를 진행할 수 없는 문서 상태면 400 Response, 진행 가능하면 None 을 반환한다.

        반려(reject_step/peer_reject)는 문서 status 만 rejected 로 바꾸고 잔여 pending step 은
        이력으로 그대로 남긴다. 그래서 상태를 확인하지 않으면 종료된 문서의 잔여 단계를 계속
        합의/반려/지정/선점할 수 있고, P·PV 합의와 _advance_after_pl 은 status 를 다시
        under_review 로 덮어써 **반려된 문서가 되살아난다**. 진행 중(under_review)인 문서만
        결재 액션을 허용해 이를 차단한다.
        """
        if document.status == 'pause':
            return Response(
                {'error': '중단된 문서입니다. 작성자가 재개해야 결재를 진행할 수 있습니다.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if document.status != 'under_review':
            return Response(
                {'error': '이미 종료되었거나 결재가 진행 중이 아닌 의뢰서입니다.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        # 철회 요청 확인 대기 중에는 결재를 동결한다 — 확인 도중 단계가 넘어가면 대상 단계
        # (target_step_ids)가 이미 끝나 버려 확인이 영영 완료되지 않는다.
        if self._active_withdraw_request(document):
            return Response(
                {'error': '철회 요청 확인 대기 중인 의뢰서입니다. 철회가 거부·취소되어야 결재를 진행할 수 있습니다.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return None

    # 검토중(claim) 방식으로 전환된 단계 — 담당자 지정 대신 담당 역할 누구나 스스로 선점한다.
    _CLAIM_AGENTS = ('J', 'O', 'E', 'P')

    # P/E 단계의 검토자 agent 코드 (담당자가 검토중 선점 후 지정, 다중 가능)
    _REVIEW_AGENT_OF = {'P': 'PV', 'E': 'EV'}
    # 검토자 agent → 지정 가능한 팀 역할
    _REVIEW_TEAM_ROLE = {'PV': 'TE_P', 'EV': 'TE_E'}

    def _can_act_on_step(self, user, step):
        """합의/반려 인가 (canUserAgree 동일).

        - MASTER: 항상 허용
        - J/O/E/P(검토중): 누군가 검토중으로 선점(assignee 존재)하면 같은 팀(역할↔agent) 누구나 합의/반려
        - 그 외(PL/R/RV/PV/EV/RA): 해당 step 의 assignee 본인만 (지정으로 배정됨)
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
        - PL 단계 / J·O·E·P(검토중 방식): 지정하기 개념 없음 → 불가
        - R: 같은 팀(역할↔agent 일치) + 아직 미지정일 때만
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
        - J/O/E/P: 같은 팀(역할↔agent 일치) + pending + 아직 미배정일 때만
        - 그 외 단계(PL/R/RV/PV/EV/RA): 검토중 방식 아님 → 불가
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
        - 담당자(assignee)가 있는 단계: 그 담당자 본인만 (PL·R·지정된 PV/EV/RA·검토중 선점된 J/O/E/P)
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

    def _active_withdraw_request(self, document):
        """문서의 확인 대기(requested) 철회 요청. 없으면 None."""
        return WithdrawRequest.objects.filter(
            document=document, state='requested'
        ).order_by('-created_at').first()

    # 의뢰자/철회/수정 권한은 serializers 와 공유하기 위해 doc_permissions 모듈에 둔다.
    def _can_withdraw(self, user, document):
        return doc_permissions.can_withdraw(user, document)

    def _can_edit(self, user, document):
        return doc_permissions.can_edit(user, document)

    def _max_round(self, document, default=1):
        """문서의 현재 최대 결재 회차를 반환한다. 단계가 없으면 default."""
        return ApprovalStep.objects.filter(document=document).aggregate(Max('round'))['round__max'] or default

    def _validate_bb_mapping(self, document):
        """J-ayer 행 bb 매핑 검증. 문제 있으면 error 문자열 반환, 없으면 None.

        기등록/layer삭제(new_or_copy) 행은 프론트(isNocSpecial, constants.ts)에서도
        매핑 대상·검증에서 제외하므로 여기서도 동일하게 제외해야 한다(R-19).
        """
        import json
        NOC_SPECIAL = ('기등록', 'layer삭제')
        try:
            detail = json.loads(document.additional_notes or '{}')
            jayer_rows = detail.get('jayerRows', [])
            bb_rows = detail.get('bbRows', [])
            mapped_jayer_ids = {
                bb.get('sourceJayerRowId')
                for bb in bb_rows
                if bb.get('sourceJayerRowId')
            }
            unmapped = [
                r for r in jayer_rows
                if r.get('process_id')
                and r.get('new_or_copy') not in NOC_SPECIAL
                and r.get('id') not in mapped_jayer_ids
            ]
            if unmapped:
                return '모든 원본 데이터에 bb 을 매핑해야 상신할 수 있습니다.'
        except (json.JSONDecodeError, TypeError):
            pass
        return None

    def _validate_post_approvers(self, document):
        """C가문(only_prodc=YES) 또는 '연구소 제품' 문서는 상신 시 추가 후결자
        (detail.post_approvers)를 1명 이상 지정해야 한다. 문제 있으면 error 문자열, 없으면 None.
        (고정 후결자 1명은 별도로 항상 포함되므로 여기서는 추가분만 검증한다.)"""
        detail = document.get_detail().get('detail', {}) or {}
        if document.requires_post_approver():
            valid = [p for p in (detail.get('post_approvers') or [])
                     if str((p or {}).get('loginid', '') or '').strip()]
            if not valid:
                return 'C가문 제품·연구소 제품은 후결자를 1명 이상 지정해야 합니다.'
        return None

    @action(detail=True, methods=['post'])
    def submit(self, request, pk=None):
        """상신: draft → under_review, PL 검토 단계 생성 (지정 PL 필수)

        인가는 수정 권한(can_edit)과 같다 — 작성자 본인, 문서 공유 그룹 멤버, MASTER.
        조회 스코프(get_queryset)만으로는 draft 를 볼 수 있는 사람이 곧 상신도 할 수 있게
        되므로 여기서 명시적으로 막는다.
        """
        document = self.get_object()
        if document.status != 'draft':
            return Response(
                {'error': '임시저장 상태의 의뢰서만 상신할 수 있습니다.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        if not self._can_edit(request.user, document):
            return Response({'error': '상신 권한이 없습니다.'}, status=status.HTTP_403_FORBIDDEN)

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
                mailer.enqueue_stage_arrival(document, 'PL', pl_step, recipient_name=pl_step.assignee_name)
            mailer.enqueue_notify_submitted(document)

        return Response({
            'message': '의뢰서가 성공적으로 상신되었습니다.',
            'email_sent': False,
            'document': RequestDocumentSerializer(document).data,
        })

    @action(detail=True, methods=['post'])
    def resubmit(self, request, pk=None):
        """재상신: rejected → under_review, PL 검토 단계 생성 (지정 PL 필수)

        인가는 수정 권한(can_edit)과 같다 — 반려 문서는 의뢰자/지정 PL/공유 그룹 멤버/MASTER.
        """
        document = self.get_object()
        if document.status != 'rejected':
            return Response(
                {'error': '반려된 의뢰서만 재상신할 수 있습니다.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        if not self._can_edit(request.user, document):
            return Response({'error': '재상신 권한이 없습니다.'}, status=status.HTTP_403_FORBIDDEN)

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

            # 검토 항목·검토자 지정은 그대로 두고 확인 상태만 초기화한다.
            # (새 회차 J 단계가 열릴 때 fill_from_master 로 마스터 최신본과 다시 맞춘다)
            review_items_sync.reset_confirmations(document)

            # 새 회차에 지정 PL 전원의 pending 단계를 생성(이전 회차는 이력 보존)
            new_round = self._max_round(document, default=0) + 1
            for u in pl_users:
                pl_step = ApprovalStep.objects.create(
                    document=document, agent='PL', action='pending', round=new_round,
                    assignee=u, assignee_name=(u.username or u.loginid),
                )
                mailer.enqueue_stage_arrival(document, 'PL', pl_step, recipient_name=pl_step.assignee_name)
            mailer.enqueue_notify_submitted(document)

        return Response({
            'message': '재상신되었습니다.',
            'document': RequestDocumentSerializer(document).data,
        })

    # 확인 절차 없이 즉시 삭제되는 문서 상태 — 결재선이 아직 없거나(draft) 이미 종료돼
    # (rejected/approved) '확인'을 받을 진행 중 단계가 존재하지 않는다.
    _WITHDRAW_IMMEDIATE_STATUSES = ('draft', 'rejected', 'approved')
    # 현재 단계 전원의 확인을 받아야 철회되는 상태
    _WITHDRAW_CONFIRM_STATUSES = ('under_review', 'submitted')

    def _delete_withdrawn_document(self, request, document, reason):
        """철회 확정 — 완료 메일을 먼저 적재한 뒤 문서를 완전히 삭제한다.

        메일 적재가 먼저여야 한다(`enqueue_withdraw_completed` 주석 참고). 삭제는 복구
        불가이고 ApprovalStep/WithdrawRequest 가 CASCADE 로 함께 사라지므로, 누가 왜
        철회했는지를 서버 로그에 남긴다(철회 이력 테이블은 두지 않는다 — 2026-08 결정).
        """
        mailer.enqueue_withdraw_completed(document, reason)
        logging.getLogger(__name__).warning(
            "[WITHDRAW_DOCUMENT] user=%s(role=%s) doc=%s status=%s title=%r reason=%r",
            getattr(request.user, 'loginid', '-') or '-',
            getattr(request.user, 'role', '-') or '-',
            document.pk, document.status, document.title, reason,
        )
        document.delete()

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def withdraw(self, request, pk=None):
        """철회: 문서 상태에 따라 즉시 삭제하거나 '철회 요청'을 생성한다.

        철회는 더 이상 임시저장(draft)으로 되돌리는 동작이 아니다 — 철회가 확정되면
        의뢰서를 **완전히 삭제**한다(2026-08 정책 변경, 복구 불가).

        - draft / rejected : 확인할 진행 중 단계가 없다 → 즉시 삭제
        - approved         : 결재 완료본이라 MASTER 만 즉시 삭제(`can_delete` 와 같은 기준)
        - under_review / submitted : 철회 요청 생성 → 현재 단계 전원 확인 시 삭제.
          이 경로만 **사유(reason) 필수**이고, 확인 대기 동안 결재가 동결된다.
        - pause            : 재개한 뒤 철회해야 한다(400).
        """
        document = self.get_object()
        document = RequestDocument.objects.select_for_update().get(pk=document.pk)

        if not self._can_withdraw(request.user, document):
            return Response({'error': '권한이 없습니다.'}, status=status.HTTP_403_FORBIDDEN)

        reason = (request.data.get('reason') or '').strip()

        if document.status in self._WITHDRAW_IMMEDIATE_STATUSES:
            # 결재 완료본은 이력이므로 임의 삭제를 막는다(delete 액션의 can_delete 와 동일 규칙).
            if document.status == 'approved' and getattr(request.user, 'role', '') != 'MASTER':
                return Response(
                    {'error': '결재가 완료된 의뢰서는 MASTER 만 철회할 수 있습니다.'},
                    status=status.HTTP_403_FORBIDDEN,
                )
            self._delete_withdrawn_document(request, document, reason)
            return Response({'message': '의뢰서가 철회되어 삭제되었습니다.', 'deleted': True})

        if document.status not in self._WITHDRAW_CONFIRM_STATUSES:
            return Response(
                {'error': '철회할 수 없는 상태입니다. 중단된 의뢰서는 재개한 뒤 철회해 주세요.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not reason:
            return Response({'error': '철회 사유를 입력해주세요.'}, status=status.HTTP_400_BAD_REQUEST)
        if self._active_withdraw_request(document):
            return Response(
                {'error': '이미 진행 중인 철회 요청이 있습니다.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        max_round = self._max_round(document)
        pending = list(ApprovalStep.objects.filter(
            document=document, action='pending', round=max_round
        ))
        if not pending:
            return Response(
                {'error': '진행 중인 결재 단계가 없습니다.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        wr = WithdrawRequest.objects.create(
            document=document,
            requester=request.user if getattr(request.user, 'loginid', '') else None,
            requester_name=getattr(request.user, 'username', '') or getattr(request.user, 'loginid', ''),
            reason=reason,
            round=max_round,
            target_step_ids=[s.id for s in pending],
            confirmed_step_ids=[],
        )
        mailer.enqueue_withdraw_requested(document, wr)

        return Response({
            'message': '철회 요청이 접수되었습니다. 현재 단계의 확인을 기다립니다.',
            'deleted': False,
            'document': RequestDocumentSerializer(document, context={'request': request}).data,
        })

    @action(detail=True, methods=['post'], url_path='confirm-withdraw')
    @transaction.atomic
    def confirm_withdraw(self, request, pk=None):
        """철회 확인: 현재 단계 담당자/팀이 철회 요청을 확인한다.

        요청 시점의 pending 단계 '전원'이 확인하면 그 순간 의뢰서가 **완전히 삭제**된다
        (병렬 단계 대응). 확인 인가는 중단 확인과 같은 규칙(`_can_confirm_pause`)이다 —
        담당자가 있는 단계는 그 담당자 본인, 미배정 단계는 같은 팀 누구나, MASTER 는 항상.
        """
        document = self.get_object()
        document = RequestDocument.objects.select_for_update().get(pk=document.pk)

        wr = self._active_withdraw_request(document)
        if not wr:
            return Response({'error': '진행 중인 철회 요청이 없습니다.'}, status=status.HTTP_400_BAD_REQUEST)

        agent = request.data.get('agent')
        max_round = self._max_round(document)

        candidates = ApprovalStep.objects.select_for_update().filter(
            document=document, agent=agent, action='pending',
            round=max_round, id__in=wr.target_step_ids,
        )
        step = next((s for s in candidates if self._can_confirm_pause(request.user, s)), None)
        if not step:
            return Response({'error': '확인 권한이 없습니다.'}, status=status.HTTP_403_FORBIDDEN)

        confirmed = list(wr.confirmed_step_ids or [])
        if step.id not in confirmed:
            confirmed.append(step.id)
        wr.confirmed_step_ids = confirmed

        if set(wr.target_step_ids or []).issubset(set(confirmed)):
            # 전원 확인 → 철회 확정. 문서와 함께 이 요청(wr)도 CASCADE 로 사라진다.
            self._delete_withdrawn_document(request, document, wr.reason)
            return Response({'message': '철회가 확정되어 의뢰서가 삭제되었습니다.', 'deleted': True})

        wr.save()
        return Response({
            'message': '확인했습니다. 다른 단계의 확인을 기다립니다.',
            'deleted': False,
            'document': RequestDocumentSerializer(document, context={'request': request}).data,
        })

    @action(detail=True, methods=['post'], url_path='reject-withdraw')
    @transaction.atomic
    def reject_withdraw(self, request, pk=None):
        """철회 거부: 확인 대상 단계가 철회 요청을 거부한다 → 결재가 그대로 이어진다.

        인가는 확인(confirm_withdraw)과 동일하다 — 확인할 수 있는 사람이 거부도 할 수 있다.
        단계 하나만 거부해도 요청 전체가 무효가 된다(전원 확인이 성립할 수 없으므로).
        """
        document = self.get_object()
        document = RequestDocument.objects.select_for_update().get(pk=document.pk)

        wr = self._active_withdraw_request(document)
        if not wr:
            return Response({'error': '진행 중인 철회 요청이 없습니다.'}, status=status.HTTP_400_BAD_REQUEST)

        max_round = self._max_round(document)
        candidates = ApprovalStep.objects.filter(
            document=document, action='pending', round=max_round, id__in=wr.target_step_ids,
        )
        if not any(self._can_confirm_pause(request.user, s) for s in candidates):
            return Response({'error': '거부 권한이 없습니다.'}, status=status.HTTP_403_FORBIDDEN)

        wr.state = 'rejected'
        wr.resolved_at = timezone.now()
        wr.save(update_fields=['state', 'resolved_at'])
        mailer.enqueue_withdraw_rejected(document, wr)

        return Response({
            'message': '철회 요청을 거부했습니다. 결재를 계속 진행할 수 있습니다.',
            'document': RequestDocumentSerializer(document, context={'request': request}).data,
        })

    @action(detail=True, methods=['post'], url_path='cancel-withdraw')
    @transaction.atomic
    def cancel_withdraw(self, request, pk=None):
        """철회 요청 취소: 확인 완료 전(requested) 요청을 요청자 본인/MASTER 가 거둬들인다.

        철회가 확정되면 의뢰서가 삭제돼 되돌릴 수 없으므로, 잘못 눌렀을 때 되돌릴 수 있는
        구간은 **확인 대기 중뿐**이다(2026-08 정책).
        """
        document = self.get_object()
        document = RequestDocument.objects.select_for_update().get(pk=document.pk)

        wr = self._active_withdraw_request(document)
        if not wr:
            return Response({'error': '취소할 철회 요청이 없습니다.'}, status=status.HTTP_400_BAD_REQUEST)
        if not doc_permissions.can_cancel_withdraw(request.user, wr):
            return Response({'error': '권한이 없습니다.'}, status=status.HTTP_403_FORBIDDEN)

        wr.state = 'cancelled'
        wr.resolved_at = timezone.now()
        wr.save(update_fields=['state', 'resolved_at'])
        mailer.enqueue_withdraw_cancelled(document, wr)

        return Response({
            'message': '철회 요청을 취소했습니다.',
            'document': RequestDocumentSerializer(document, context={'request': request}).data,
        })

    @action(detail=True, methods=['post'], url_path='delete')
    def delete(self, request, pk=None):
        """의뢰서 삭제.

        허용 대상은 `doc_permissions.can_delete` 가 판정한다 —
        결재 완료(approved)본은 MASTER 만, 그 외 상태는 철회 가능 범위와 동일하다.
        """
        document = self.get_object()
        if not doc_permissions.can_delete(request.user, document):
            return Response({'error': '삭제 권한이 없습니다.'}, status=status.HTTP_403_FORBIDDEN)

        # 삭제는 복구 불가 + ApprovalStep/PauseRequest 가 CASCADE 로 함께 사라지므로
        # 누가 무엇을 지웠는지 서버 로그에 남긴다(감사용).
        logging.getLogger(__name__).warning(
            "[DELETE_DOCUMENT] user=%s(role=%s) doc=%s status=%s title=%r",
            getattr(request.user, 'loginid', '-') or '-',
            getattr(request.user, 'role', '-') or '-',
            document.pk, document.status, document.title,
        )
        document.delete()
        return Response({'message': '삭제되었습니다.'})

    @action(detail=True, methods=['post'], url_path='approve-step')
    @transaction.atomic
    def approve_step(self, request, pk=None):
        """에이전트 단계 합의 (mock.ts mockApproveStep 로직과 동일)"""
        document = self.get_object()
        agent = request.data.get('agent')
        comment = request.data.get('comment', '')

        if agent not in ('R', 'RV', 'P', 'PV', 'J', 'O', 'E', 'EV', 'RA'):
            return Response({'error': '유효하지 않은 에이전트입니다.'}, status=status.HTTP_400_BAD_REQUEST)

        # 동시 합의 lost-update 방지: 문서 행을 잠가 같은 문서의 상태전이를 직렬화한다.
        # (J/O/E/RA 병렬 단계를 두 결재자가 거의 동시에 마지막으로 합의할 때, 둘 다 '미완료'로
        #  읽어 approved 전이가 누락되던 문제를 막는다.)
        document = RequestDocument.objects.select_for_update().get(pk=document.pk)

        blocked = self._blocked_progress_response(document)
        if blocked:
            return blocked

        max_round = self._max_round(document)

        # 잠근 뒤 최신 커밋본을 읽기 위해 locking read 사용
        # RA(후결자)/PV/EV(검토자) 다중 담당자: 호출자의 assignee 단계만 조회.
        # J/O/E/P(검토중)는 회차당 단일 단계이므로 assignee 필터 없이 조회 → 같은 팀 누구나 합의(인가는 _can_act_on_step).
        if agent in ('RA', 'PV', 'EV'):
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

        # PV/EV(검토자)는 담당자(P/E) 합의 후에만 처리 가능(순차 진행)
        if agent in ('PV', 'EV'):
            main_agent = 'P' if agent == 'PV' else 'E'
            main_step = ApprovalStep.objects.filter(document=document, agent=main_agent, round=max_round).first()
            if not main_step or main_step.action != 'approved':
                return Response({'error': '담당자 합의가 먼저 필요합니다.'}, status=status.HTTP_400_BAD_REQUEST)

        # E(MASK) 담당자 합의에는 2차 검토자(EV) 지정이 필수다 — MASK 검증은 2인 확인 절차라서
        # 담당자 혼자 합의로 단계를 넘길 수 없다. (P 단계의 PV 는 지금까지대로 선택 사항이다.)
        #
        # 여기(어떤 쓰기보다 먼저)에서 걸러야 한다 — @transaction.atomic 은 예외에만 롤백하므로
        # 검토자 생성 이후에 400 을 반환하면 그 쓰기가 커밋된 채 응답만 실패한다.
        #
        # 이 규칙은 앞으로의 합의에만 적용된다. 이미 검토자 없이 E 합의를 마친 기존 문서는
        # _stage_reviewers_complete() 의 하위호환 분기로 그대로 승인될 수 있어야 한다
        # (E 단계가 이미 approved 라 검토자를 지정할 경로가 없어, 소급 적용하면 영구 정지된다).
        if agent == 'E':
            requested_reviewers = [
                str(lid or '').strip() for lid in (request.data.get('reviewer_loginids') or [])
            ]
            # 되감기가 있던 배포에서 E 가 pending 으로 되감긴 뒤 EV step 이 살아남은
            # 레거시 문서를 흡수한다. 되감기를 없앤 뒤로는 같은 회차에서 E 가 다시 합의되는
            # 경로가 없어, 이 분기는 그 레거시 문서에만 걸린다.
            has_existing_reviewer = ApprovalStep.objects.filter(
                document=document, agent='EV', round=max_round
            ).exists()
            if not any(requested_reviewers) and not has_existing_reviewer:
                return Response(
                    {'error': '2차 검토자를 1명 이상 지정해야 합니다.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        # P/E 담당자 합의 시 함께 지정된 검토자(PV/EV) 생성 — 별도 지정 API 없이
        # 이 합의 요청 한 번으로 담당자 합의 + 검토자 지정이 함께 처리된다.
        # 검증은 담당자 단계를 승인 저장하기 전에 마쳐(문제가 있으면 아무 것도 만들지 않음),
        # 실제 생성(+검토자 메일 발송)은 담당자 승인 저장 이후에 한다 — 그래야 검토자에게 가는
        # 메일의 결재 경로 카드가 담당자 상태를 '검토중'이 아닌 '합의'로 정확히 읽는다.
        reviewer_users = []
        if agent in ('P', 'E'):
            review_loginids = request.data.get('reviewer_loginids')
            if review_loginids:
                caller_loginid = getattr(request.user, 'loginid', '')
                reviewer_users, err = self._validate_reviewers(document, step, review_loginids, caller_loginid, max_round)
                if err:
                    return Response({'error': err}, status=status.HTTP_400_BAD_REQUEST)

        step.action = 'approved'
        step.acted_at = timezone.now()
        # E/EV 의 comment 는 '수정 요청'(reject_step)과 'Validation System 값 변경'
        # (_note_validation_system_change) 이력이
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
        step.save()

        if reviewer_users:
            self._create_reviewers(document, step, reviewer_users, max_round)

        # 결재가 진행되어 단계가 넘어가면 진행 중이던 중단 요청은 무효 처리
        self._cancel_active_pause_requests(document)

        new_status = document.status
        current_round = step.round

        # (2026-08) EV 는 P/PV 와 동일하게 지정된 검토자 전원 합의(AND)로 바뀌어, 1명 합의로
        # 나머지를 자동 'skip' 처리하던 동작을 없앴다. 남은 검토자는 pending 상태로 남아
        # 각자 직접 합의해야 한다. 'skip' 값 자체는 그 이전(OR 시절) 문서의 이력으로만 남는다.

        # 'MAP 삭제/수정' 은 P·R·J·O 가 모두 병렬 구성원이라, 넷 중 무엇이 마지막이 되든
        # 여기서 최종 승인을 판정해야 한다. 아래 일반 경로 분기는 P·R 합의로는 승인 판정을
        # 하지 않으므로(P 는 J 생성만 함), 이 분기가 없으면 네 단계가 다 합의돼도 문서가 멈춘다.
        if document.is_map_delete_edit():
            if agent == 'R':
                # 담당자 합의 → 검토자(RV)가 있으면 그 차례를 알린다(단계는 아직 미완료).
                rv_step = ApprovalStep.objects.filter(
                    document=document, agent='RV', action='pending', round=current_round
                ).first()
                if rv_step:
                    mailer.enqueue_stage_arrival(document, 'RV', rv_step, recipient_name=rv_step.assignee_name)
            elif agent == 'P' and self._stage_reviewers_complete(document, 'P', current_round):
                # J 는 이미 병렬로 존재하므로 생성하지 않고, 완료 통보만 일반 경로와 동일하게 보낸다.
                mailer.enqueue_notify_p_completed(document)
            new_status = 'approved' if self._map_delete_edit_all_approved(document, current_round) else 'under_review'

        elif agent == 'R':
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

        elif agent in ('P', 'PV', 'J', 'O', 'E', 'EV', 'RA'):
            # (2026-08) J 가 P 뒤 순차 단계에서 병렬 단계로 분리되면서 P 도 마지막 합의자가 될 수
            # 있게 됐다. 그래서 P/PV 합의도 이 최종 판정 분기를 타야 한다 — 예전처럼 P 를 판정에서
            # 제외하면 P 가 마지막일 때 아무도 판정을 돌리지 않아 문서가 under_review 에 영구 정지한다.
            if agent in ('P', 'PV'):
                # P 담당자 + 지정된 검토자(PV) 전원 합의가 끝나면 완료 통보만 보낸다.
                # (J 는 R 합의 시점에 이미 병렬로 생성돼 있어 여기서 만들지 않는다)
                self._notify_after_p_review(document, current_round)

            # P + J + O + [E, 검토자(EV) 포함] + 후결자(RA) 모두 합의 시 최종 승인.
            # (Only MAP 은 P/O/E/J 없이 후결자만 종단 경로)
            j_steps = list(ApprovalStep.objects.select_for_update().filter(document=document, agent='J', round=current_round))
            o_step = ApprovalStep.objects.select_for_update().filter(document=document, agent='O', round=current_round).order_by('-id').first()
            e_exists = ApprovalStep.objects.select_for_update().filter(document=document, agent='E', round=current_round).exists()
            ra_steps = list(ApprovalStep.objects.select_for_update().filter(document=document, agent='RA', round=current_round))

            # 후결자: 존재하는 RA 전원 합의 (없으면 해당 경로 없음으로 간주 → True)
            ra_ok = (len(ra_steps) == 0) or all(s.action == 'approved' for s in ra_steps)

            if document.is_only_map():
                # Only MAP: 후결자(RA)만 종단 경로 — RA 전원 합의 시 최종 승인
                all_approved = len(ra_steps) > 0 and ra_ok
            else:
                # J 를 뺀 경로('Overlay 변경' 단독)는 J step 이 아예 없다. 아래 기본 판정은
                # len(j_steps) > 0 을 요구하므로, 이 분기가 없으면 나머지 단계가 모두 합의돼도
                # 판정이 영원히 False 가 되어 문서가 under_review 에 영구 정지한다.
                j_approved = (
                    True if document.skip_j_stage()
                    else (len(j_steps) > 0 and all(s.action == 'approved' for s in j_steps))
                )
                o_approved = o_step and o_step.action == 'approved'
                # P: 담당자 합의 + 지정된 검토자(PV) 전원 합의까지 끝나야 완료.
                # J 분리 전에는 "J 가 존재한다 = P 가 끝났다" 였기에 판정에서 생략했지만,
                # 이제 J 는 P 와 무관하게 R 합의 시점부터 존재하므로 명시적으로 확인해야 한다.
                p_ok = self._stage_reviewers_complete(document, 'P', current_round)
                # E: 담당자 합의 + 지정된 검토자(EV) 전원 합의까지 끝나야 완료
                e_ok = (not e_exists) or self._stage_reviewers_complete(document, 'E', current_round)
                all_approved = p_ok and j_approved and o_approved and e_ok and ra_ok
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

        if agent not in ('R', 'RV', 'P', 'PV', 'J', 'O', 'E', 'EV', 'RA'):
            return Response({'error': '유효하지 않은 에이전트입니다.'}, status=status.HTTP_400_BAD_REQUEST)

        # 문서 행을 잠가 합의(approve_step)와 반려가 동시에 같은 문서를 전이시키는 경쟁을 직렬화한다.
        document = RequestDocument.objects.select_for_update().get(pk=document.pk)

        blocked = self._blocked_progress_response(document)
        if blocked:
            return blocked

        max_round = self._max_round(document)

        # RA(후결자)/PV/EV(검토자) 다중 담당자: 호출자의 assignee 단계만 조회.
        # J/O/E/P(검토중)는 회차당 단일 단계이므로 assignee 필터 없이 조회 → 같은 팀 누구나 반려(인가는 _can_act_on_step).
        if agent in ('RA', 'PV', 'EV'):
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

        # MASK(E/EV)는 반려로 결재를 되돌리지 않는다 — 대상/비대상 판정 주체가 상신자 하나이므로,
        # 이견은 '수정 요청'으로 상신자에게 사유만 전달하고 결재 상태(status/round)는 그대로 둔다.
        # 되돌릴 게 없으니 PL 부터 전 단계를 재결재하는 반려의 비용이 발생하지 않는다.
        if agent in ('E', 'EV'):
            stamp = timezone.now().strftime('%Y-%m-%d %H:%M')
            entry = f'[수정 요청 {stamp}] {comment}'.strip()
            step.comment = f'{step.comment}\n{entry}'.strip() if step.comment else entry
            step.save(update_fields=['comment'])
            mailer.enqueue_revision_requested(document)
            return Response({'message': '수정 요청을 보냈습니다.', 'status': document.status})

        step.action = 'rejected'
        step.acted_at = timezone.now()
        step.comment = comment
        step.save()

        # 반려로 회차가 종료되면 진행 중이던 중단 요청은 무효 처리
        self._cancel_active_pause_requests(document)

        document.status = 'rejected'
        document.save()

        # 반려 시점을 이력 조회 '반려' 탭에 남긴다(재상신해도 사라지지 않는 별도 적재).
        rejection_snapshots.create_from_reject(document, step, request.user)

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

        blocked = self._blocked_progress_response(document)
        if blocked:
            return blocked

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

    def _validate_reviewers(self, document, step, review_loginids, caller_loginid, round_no):
        """P/E 담당자 합의 시 함께 지정할 검토자(PV/EV) loginid 목록을 검증한다(DB 쓰기 없음).

        담당자 단계를 승인 저장하기 전에 호출해, 문제가 있으면 아무 것도 만들거나 바꾸지 않고
        error 문자열만 반환한다. 실제 생성은 `_create_reviewers`(담당자 승인 저장 후 호출)가 한다.
        """
        review_agent = self._REVIEW_AGENT_OF.get(step.agent)
        if not review_agent or not review_loginids:
            return [], None
        team_role = self._REVIEW_TEAM_ROLE[review_agent]

        cleaned = []
        for lid in review_loginids:
            lid = str(lid or '').strip()
            if lid and lid not in cleaned:
                cleaned.append(lid)
        if not cleaned:
            return [], None

        existing_loginids = set(
            ApprovalStep.objects.filter(
                document=document, agent=review_agent, round=round_no
            ).exclude(assignee__isnull=True).values_list('assignee__loginid', flat=True)
        )

        to_create = []
        for lid in cleaned:
            if lid in existing_loginids:
                continue
            if lid == caller_loginid:
                return [], '담당자 본인은 검토자로 지정할 수 없습니다.'
            try:
                reviewer_user = User.objects.get(loginid=lid, role=team_role)
            except User.DoesNotExist:
                return [], f'유효하지 않은 검토자입니다: {lid}'
            to_create.append(reviewer_user)
            existing_loginids.add(lid)

        return to_create, None

    def _create_reviewers(self, document, step, reviewer_users, round_no):
        """검증된 검토자(PV/EV) pending step을 생성하고 개인화 메일을 발송한다.

        R 담당자 지정(assign_step)에서 검토자를 함께 고르는 것과 동일하게,
        P/E는 담당자 본인이 합의(approve-step) 시점에 검토자를 함께 지정한다
        (별도 지정 API 없이 한 번의 합의 클릭으로 담당자 합의 + 검토자 지정이 함께 처리됨).
        ⚠️ 반드시 담당자(P/E) 단계가 '합의'로 저장된 *이후*에 호출해야 한다 — 그래야 검토자에게
        가는 메일의 결재 경로 카드(`mailer._route_rows`)가 담당자 상태를 '검토중'이 아닌
        '합의'로 정확히 읽는다.
        """
        review_agent = self._REVIEW_AGENT_OF[step.agent]
        for reviewer_user in reviewer_users:
            rv_step = ApprovalStep.objects.create(
                document=document, agent=review_agent, action='pending', round=round_no,
                assignee=reviewer_user, assignee_name=(reviewer_user.username or reviewer_user.loginid),
            )
            mailer.enqueue_stage_arrival(document, review_agent, rv_step, recipient_name=rv_step.assignee_name)

    @action(detail=True, methods=['post'], url_path='claim-step')
    @transaction.atomic
    def claim_step(self, request, pk=None):
        """검토중(claim) — J/O/E/P 단계를 담당 역할 사용자가 스스로 선점한다.

        먼저 누른 1명이 해당 단계의 assignee 로 고정되며(취소·재클릭 불가),
        이후 그 사용자만 합의/반려할 수 있다. 동시 선점 경합은 문서 행을 잠가 직렬화한다.
        P/E 는 선점 후 담당자 본인이 approve-step/ 합의 요청에 reviewer_loginids 를 함께 보내
        검토자(PV/EV, 다중)를 합의와 동시에 지정할 수 있다(`_create_reviewers`).
        """
        document = self.get_object()
        agent = request.data.get('agent')

        if agent not in self._CLAIM_AGENTS:
            return Response({'error': '유효하지 않은 에이전트입니다.'}, status=status.HTTP_400_BAD_REQUEST)

        # 동시 선점 경합 방지: 문서 행을 잠가 같은 단계의 중복 배정을 막는다.
        document = RequestDocument.objects.select_for_update().get(pk=document.pk)

        blocked = self._blocked_progress_response(document)
        if blocked:
            return blocked

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

    @action(detail=True, methods=['post'], url_path='validation-system')
    @transaction.atomic
    def update_validation_system(self, request, pk=None):
        """진행 중 문서의 Validation System 대상/비대상을 상신자 본인이 변경한다.

        판정 주체는 상신자 하나다 — MASK(E) 팀은 확인 후 '합의'만 하고 값을 바꾸지 않는다.
        수정 창은 상신 직후부터 **EV(2차 검토자) 중 1명이 합의하기 전까지** 열려 있다
        (E 단계 완료 판정이 OR 이므로 그 시점에 게이트가 닫힌다).

        되감지 않는다 — 값 변경 사실은 E step comment 에 note 로만 남는다
        (_note_validation_system_change). 그래서 E 담당자 본인의 재확인은 강제되지 않는다.
        이 트레이드오프는 되감기가 만들던 잠금·이력 소실보다 낫다고 판단해 의도적으로 택했다.
        """
        document = self.get_object()
        document = RequestDocument.objects.select_for_update().get(pk=document.pk)

        value = request.data.get('value')
        if value not in self.VALIDATION_SYSTEM_VALUES:
            return Response(
                {'error': '유효하지 않은 Validation System 값입니다.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        role = getattr(request.user, 'role', '')
        if role != 'MASTER' and not doc_permissions.is_requester(request.user, document):
            return Response({'error': '권한이 없습니다.'}, status=status.HTTP_403_FORBIDDEN)

        if document.status not in ('under_review', 'pause'):
            return Response(
                {'error': '진행 중인 의뢰서만 변경할 수 있습니다.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        max_round = self._max_round(document)
        if self._stage_reviewers_complete(document, 'E', max_round):
            return Response(
                {'error': 'MASK 검토가 끝난 의뢰서는 변경할 수 없습니다.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        previous = self._get_validation_system(document)
        if previous not in self.VALIDATION_SYSTEM_VALUES:
            # 키가 없거나 값이 깨진 레거시 문서 — 상신자가 화면에서 보고 있는 값과
            # 같은 기준으로 비교해야 '보이는 값을 눌렀는데 되감겼다'가 발생하지 않는다.
            previous = self.VALIDATION_SYSTEM_LEGACY_DEFAULT
        if previous == value:
            return Response({'message': '변경 사항이 없습니다.'})

        actor = getattr(request.user, 'username', '') or getattr(request.user, 'loginid', '')
        if not self._set_validation_system(document, value, changed_by=actor):
            return Response(
                {'error': '의뢰서 데이터가 손상되어 값을 저장할 수 없습니다.'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        self._note_validation_system_change(document, max_round, previous, value, actor)

        return Response({'message': '변경했습니다.'})

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
        + C가문(only_prodc=YES) 추가 후결자(detail.post_approvers). loginid 중복 제거.

        반려 메일 수신자 산출(`mailer._remaining_stage_emails`)도 같은 규칙을 써야 하므로
        구현은 `mailer.post_approver_users` 에 두고 여기서는 위임한다."""
        return mailer.post_approver_users(document)

    def _stage_reviewers_complete(self, document, agent, round_no):
        """P/E 단계가 담당자 + 지정된 검토자(PV/EV) 합의로 끝났는지 여부.

        P/PV·E/EV 모두 **AND** — 지정된 검토자 전원이 합의해야 완료다(2026-08 변경 전에는
        EV만 OR 로 1명 합의 시 완료 처리하고 나머지를 자동 'skip' 했으나, 지정한 검토자
        전원의 확인이 필요하다는 요구사항에 맞춰 P/PV와 동일한 규칙으로 통일했다).

        검토자가 하나도 지정되지 않았으면 담당자 합의만으로 완료(하위호환).
        ⚠️ 이 가드를 빼면 안 된다 — 검토자 없이 E 합의를 마친 레거시 문서에는
        검토자를 지정할 경로가 없어, all() 이 False 를 돌려주면 영구 잠긴다.
        """
        main_step = ApprovalStep.objects.filter(document=document, agent=agent, round=round_no).first()
        if not main_step or main_step.action != 'approved':
            return False
        review_agent = self._REVIEW_AGENT_OF.get(agent)
        reviewer_steps = list(ApprovalStep.objects.filter(
            document=document, agent=review_agent, round=round_no
        ))
        if not reviewer_steps:
            return True
        return all(s.action == 'approved' for s in reviewer_steps)

    def _notify_after_p_review(self, document, round_no):
        """P 단계가 담당자+검토자(PV) 전원 합의로 완료된 시점에 완료 통보를 보낸다.

        아직 검토자 합의가 남아 있으면 아무 것도 하지 않는다(통보는 완료 시점에 1회만).

        (2026-08) 예전에는 이 시점에 J 단계를 생성했다. J 가 R 합의 시점의 병렬 단계로
        분리되면서 생성 책임은 `_advance_to_parallel` 로 옮겼고, 여기에는 통보만 남았다.
        """
        if not self._stage_reviewers_complete(document, 'P', round_no):
            return
        mailer.enqueue_notify_p_completed(document)

    def _create_map_delete_edit_parallel(self, document, round_no):
        """'MAP 삭제/수정': PL 합의 직후 P·R·J·O 를 병렬로 생성한다.

        기존 일반 경로와 다른 점 — 기존 코드는 건드리지 않고 이 분기만 새로 탄다.
        - R 이 병렬을 여는 관문이 아니라 병렬 구성원 중 하나다.
        - J 가 P 완료를 기다리지 않고 처음부터 존재한다.
        - E(MASK)와 후결자(RA)는 만들지 않는다 — 고정 후결자도 붙지 않는 유일한 경로다.
        검토자(PV/RV)는 기존과 동일하게 각 담당자가 지정하며, 단계 완료 판정도 그대로 쓴다.
        """
        from .utils import calculate_business_due_date
        import datetime
        if ApprovalStep.objects.filter(
            document=document, agent__in=('P', 'R', 'J', 'O'), round=round_no
        ).exists():
            return  # 동시 합의 중복 생성 방지
        due = calculate_business_due_date(datetime.date.today(), 6)
        for agent in ('P', 'R', 'J', 'O'):
            created = ApprovalStep.objects.create(
                document=document, agent=agent, action='pending',
                is_parallel=True, round=round_no, due_date=due,
            )
            mailer.enqueue_stage_arrival(document, agent, created)
        # 이 경로는 J 가 처음부터 존재한다 — 일반 경로와 같은 시점에 검토 항목을 채운다.
        review_items_sync.fill_from_master(document)
        # (2026-08) TE_J 참고 통보(notify_p_arrival)는 폐지했다 — 이 경로는 J 가 처음부터
        # 병렬이라 TE_J 가 위 stage_arrival(J) 결재 요청 메일을 이미 받는다(일반 경로와 동일).

    def _map_delete_edit_all_approved(self, document, round_no):
        """'MAP 삭제/수정' 최종 승인 판정 — P·R·J·O 네 단계가 모두 완료됐는가.

        각 단계는 담당자 + 지정된 검토자(PV/RV) 전원 합의로 완료된다
        (검토자가 없으면 담당자 합의만으로 완료 — _stage_reviewers_complete 와 동일 규칙).
        """
        for agent in ('P', 'R', 'J', 'O'):
            main = ApprovalStep.objects.select_for_update().filter(
                document=document, agent=agent, round=round_no,
            ).first()
            if not main or main.action != 'approved':
                return False
            if agent in ('P', 'R') and not self._stage_reviewers_complete(document, agent, round_no):
                return False
        return True

    def _advance_to_parallel(self, document, step, round_no):
        """R단계(담당자[→검토자]) 완료 후 병렬 단계 생성 → 반환할 새 status.

        - Only MAP: P/J/O/E 없이 후결자(RA)만 생성(후결자 전원 합의 시 최종 승인).
          후결자가 하나도 없으면(고정 미설정 + 비 C가문) 기존처럼 즉시 승인한다.
        - 일반: P(4영업일)·J(6영업일 병렬)·O(6영업일 병렬)·[E(plel 시 6영업일 병렬)]
          + 후결자(RA, 6영업일 병렬) 생성.

        (2026-08) J 는 예전에 P 완료 후 생성되는 순차 단계였다. 이제 P 와 무관한 병렬 단계로
        분리돼 여기서 함께 생성되며, 기한도 P(4영업일)가 아니라 O/E 와 같은 6영업일이다.
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
            # 기타 목적이 'Overlay 변경' 하나뿐이면 J 단계 자체를 만들지 않는다(경로에서 제외).
            if not document.skip_j_stage():
                j_step = ApprovalStep.objects.create(
                    document=document, agent='J', action='pending', is_parallel=True, round=round_no, due_date=o_due,
                )
                mailer.enqueue_stage_arrival(document, 'J', j_step)
                # 검토 항목은 J 단계가 열리는 이 시점에 마스터 최신본으로 채운다(review_items.py §1).
                # J 가 없는 문서는 다룰 단계가 없으므로 채우지 않는다.
                review_items_sync.fill_from_master(document)
            # E(MASK)는 판정 키워드(plel)가 있는 의뢰서에만 생성한다 — 키워드가 아예 없으면
            # Validation System 판정이 '해당없음'이라 MASK 가 검증할 대상 자체가 없다.
            if document.has_ppid_plel():
                e_step = ApprovalStep.objects.create(
                    document=document, agent='E', action='pending', is_parallel=True, round=round_no, due_date=o_due,
                )
                mailer.enqueue_stage_arrival(document, 'E', e_step)

        # 후결자(RA) 병렬 생성 — 고정 1명 + C가문 추가. 각자에게 개별 메일 발송
        # (고정 후결자는 "[후결 요청]", 그 외는 다른 단계와 동일한 형식 — mailer 에서 자동 분기).
        for u in post_users:
            ra_step = ApprovalStep.objects.create(
                document=document, agent='RA', action='pending', is_parallel=True,
                round=round_no, due_date=ra_due,
                assignee=u, assignee_name=(u.username or u.loginid),
            )
            mailer.enqueue_stage_arrival(document, 'RA', ra_step, recipient_name=ra_step.assignee_name)
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
                # 'MAP 삭제/수정' 은 R 이 관문이 아니라 병렬 구성원이므로 여기서 4단계를 한 번에 만든다.
                if document.is_map_delete_edit():
                    self._create_map_delete_edit_parallel(document, step.round)
                    return True
                # 전원 합의 → R 생성(중복 방지: 이미 있으면 재생성하지 않음)
                if not ApprovalStep.objects.filter(document=document, agent='R', round=step.round).exists():
                    r_step = ApprovalStep.objects.create(
                        document=document, agent='R', action='pending', round=step.round,
                    )
                    mailer.enqueue_stage_arrival(document, 'R', r_step)
                return True

            # 아직 미합의 PL 이 남았으면 문서 상태는 그대로 둔다. (호출부가 under_review 인
            # 문서만 넘겨주므로 여기서 status 를 덮어쓸 필요가 없다. 예전엔 무조건
            # under_review 를 저장해, 다른 PL 이 반려해 rejected 가 된 문서를 되살렸다.)
            return False

    @action(detail=True, methods=['post'], url_path='peer-approve')
    def peer_approve(self, request, pk=None):
        """지정 PL 합의: 본인 PL 단계 approved → 전원 합의 시 R 단계 생성(다중 PL)"""
        document = self.get_object()
        blocked = self._blocked_progress_response(document)
        if blocked:
            return blocked
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
        blocked = self._blocked_progress_response(document)
        if blocked:
            return blocked
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
            # 지정 PL 반려도 동일하게 이력 조회 '반려' 탭에 적재한다.
            rejection_snapshots.create_from_reject(document, step, request.user)
            mailer.enqueue_rejected(document)

        return Response({'message': '반려되었습니다.', 'status': 'rejected'})

    @action(detail=True, methods=['post'], url_path='peer-submit')
    def peer_submit(self, request, pk=None):
        """지정 PL 수정 후 상신: 문서는 이미 update됨. 본인 PL 단계 approved(태그) → 전원 합의 시 R 생성"""
        document = self.get_object()
        blocked = self._blocked_progress_response(document)
        if blocked:
            return blocked
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
    @transaction.atomic
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

        # 새로 지정된 PL에게 최초 상신과 동일한 결재 요청 메일 발송(이전 지정자에게는 안 감)
        mailer.enqueue_stage_arrival(document, 'PL', step, recipient_name=step.assignee_name)

        return Response({'message': '지정자가 변경되었습니다.', 'document': RequestDocumentSerializer(document).data})

    # Validation System 대상/비대상 값 (프론트 constants.ts 의 VS_TARGET/VS_NONTARGET 과 동일)
    VALIDATION_SYSTEM_VALUES = ('YES', 'NO')
    # 저장값이 없는 레거시 문서를 상세보기가 '대상'으로 표시한다
    # (PagedDetailView.tsx 의 vsCurrent 폴백). 변경 여부 판정을 화면과 같은 기준으로
    # 맞추기 위한 값이므로, 프론트 폴백을 바꾸면 이 값도 함께 바꿔야 한다.
    VALIDATION_SYSTEM_LEGACY_DEFAULT = 'YES'

    def _get_validation_system(self, document):
        """detail.validation_system 현재값. 키가 없거나 파싱 실패면 None."""
        import json
        try:
            data = json.loads(document.additional_notes or '{}')
            return (data.get('detail') or {}).get('validation_system')
        except (json.JSONDecodeError, TypeError):
            return None

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

    def _note_validation_system_change(self, document, round_no, previous, value, actor):
        """E 담당자가 이미 합의한 뒤 값이 바뀌면 그 사실을 E step comment 에 남긴다.

        되감지 않는다(2026-08-06 결정). EV 는 지정된 검토자 전원이 합의해야 단계가 끝나므로(AND),
        아직 합의하지 않은 검토자가 있다면 그 사람들이 바뀐 값을 보고 판단하게 된다.
        E 담당자 본인이 재확인하지 않는 리스크는 사용자가 명시적으로 수용했고, 그래서
        '언제 무엇이 어떻게 바뀌었는지' 를 남기는 이 note 가 유일한 감사 추적이다.

        ApprovalStep 에 이력 전용 필드가 없어 comment 가 저장소다.
        action 과 acted_at 은 건드리지 않는다. note 를 남겼으면 True.
        """
        e_step = ApprovalStep.objects.select_for_update().filter(
            document=document, agent='E', round=round_no
        ).first()
        if not e_step or e_step.action != 'approved':
            return False

        stamp = timezone.now().strftime('%Y-%m-%d %H:%M')
        note = (
            f'[값 변경 {stamp}] 상신자가 Validation System 을 '
            f'{previous or "-"} → {value} 로 변경 (변경: {actor})'
        )
        e_step.comment = f'{e_step.comment}\n{note}'.strip() if e_step.comment else note
        e_step.save(update_fields=['comment'])
        return True

    def _sync_post_approvers_detail(self, document, add=None, remove_loginid=None):
        """detail.post_approvers JSON을 add(dict, {loginid,name}) 추가 또는 remove_loginid 제거로 동기화한다.

        재상신 시 프리필/일관성 유지 목적. JSON 파싱 실패 시(손상 데이터) 조용히 건너뛴다
        (다른 곳의 관대한 파싱 처리와 동일한 정책).
        """
        import json
        try:
            data = json.loads(document.additional_notes or '{}')
            detail = data.get('detail', {}) or {}
            pas = detail.get('post_approvers') or []
            if remove_loginid:
                pas = [p for p in pas if str((p or {}).get('loginid', '') or '').strip() != remove_loginid]
            if add:
                pas.append(add)
            detail['post_approvers'] = pas
            data['detail'] = detail
            document.additional_notes = json.dumps(data, ensure_ascii=False)
            document.save(update_fields=['additional_notes'])
        except (json.JSONDecodeError, TypeError):
            pass

    def _can_manage_post_approver(self, user, document):
        role = getattr(user, 'role', '')
        if role == 'MASTER':
            return True
        return doc_permissions.is_requester(user, document)

    @action(detail=True, methods=['post'], url_path='add-post-approver')
    @transaction.atomic
    def add_post_approver(self, request, pk=None):
        """후결자 추가 — 작성자 또는 MASTER가 결재 진행 중 언제든 후결자를 추가한다.

        ⚠️ 역할 검증은 하지 않는다(고정 후결자는 TE_R, 추가 후결자는 보통 PL로 애초에
        역할이 섞여 있어 단일 역할 강제가 의미 없음 — 2026-07 정책).
        """
        from django.conf import settings
        document = self.get_object()
        document = RequestDocument.objects.select_for_update().get(pk=document.pk)
        if document.status != 'under_review':
            return Response({'error': '진행 중인 의뢰서만 후결자를 추가할 수 있습니다.'}, status=status.HTTP_400_BAD_REQUEST)
        if not self._can_manage_post_approver(request.user, document):
            return Response({'error': '권한이 없습니다.'}, status=status.HTTP_403_FORBIDDEN)

        new_loginid = str(request.data.get('loginid', '') or '').strip()
        if not new_loginid:
            return Response({'error': '추가할 후결자의 loginid를 입력해주세요.'}, status=status.HTTP_400_BAD_REQUEST)

        fixed_lid = (getattr(settings, 'POST_APPROVER_LOGINID', '') or '').strip()
        if new_loginid == fixed_lid:
            return Response({'error': '고정 후결자와 중복 지정할 수 없습니다.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            new_user = User.objects.get(loginid=new_loginid)
        except User.DoesNotExist:
            return Response({'error': '유효하지 않은 사용자입니다.'}, status=status.HTTP_400_BAD_REQUEST)

        max_round = self._max_round(document)
        if ApprovalStep.objects.filter(document=document, agent='RA', round=max_round,
                                       assignee__loginid=new_loginid).exists():
            return Response({'error': '이미 후결자로 지정된 사용자입니다.'}, status=status.HTTP_400_BAD_REQUEST)

        # 기한 산정: 같은 회차에 이미 RA가 있으면 그 기한을 맞추고, 없으면 R 합의일 기준 6영업일로 새로 계산
        sibling_ra = ApprovalStep.objects.filter(
            document=document, agent='RA', round=max_round
        ).exclude(due_date__isnull=True).order_by('-id').first()
        if sibling_ra:
            ra_due = sibling_ra.due_date
        else:
            r_step = ApprovalStep.objects.filter(document=document, agent='R', round=max_round, action='approved').first()
            if not r_step or not r_step.acted_at:
                return Response({'error': 'R 합의 이후에만 후결자를 추가할 수 있습니다.'}, status=status.HTTP_400_BAD_REQUEST)
            from .utils import calculate_business_due_date
            ra_due = calculate_business_due_date(r_step.acted_at.date(), 6)

        assignee_name = new_user.username or new_user.loginid
        ra_step = ApprovalStep.objects.create(
            document=document, agent='RA', action='pending', is_parallel=True,
            round=max_round, due_date=ra_due, assignee=new_user, assignee_name=assignee_name,
        )
        mailer.enqueue_stage_arrival(document, 'RA', ra_step, recipient_name=ra_step.assignee_name)
        self._sync_post_approvers_detail(document, add={'loginid': new_loginid, 'name': assignee_name})

        return Response({'message': '후결자가 추가되었습니다.',
                         'document': RequestDocumentSerializer(document, context={'request': request}).data})

    @action(detail=True, methods=['post'], url_path='remove-post-approver')
    @transaction.atomic
    def remove_post_approver(self, request, pk=None):
        """후결자 제거 — 아직 합의하지 않은(pending) 후결자만 뺄 수 있다.

        고정 후결자(settings.POST_APPROVER_LOGINID)는 제거 불가. Only MAP(후결자가 유일한
        종단 경로) 또는 requires_post_approver() 대상(C가문·연구소 제품, 상신 시 최소 1명이
        필수였음)인 문서는 마지막 남은 후결자를 제거할 수 없다 — 그 외 일반 문서는 0명까지 뺄 수 있다.
        """
        from django.conf import settings
        document = self.get_object()
        document = RequestDocument.objects.select_for_update().get(pk=document.pk)
        if document.status != 'under_review':
            return Response({'error': '진행 중인 의뢰서만 후결자를 제거할 수 있습니다.'}, status=status.HTTP_400_BAD_REQUEST)
        if not self._can_manage_post_approver(request.user, document):
            return Response({'error': '권한이 없습니다.'}, status=status.HTTP_403_FORBIDDEN)

        target_loginid = str(request.data.get('loginid', '') or '').strip()
        if not target_loginid:
            return Response({'error': '제거할 후결자의 loginid를 입력해주세요.'}, status=status.HTTP_400_BAD_REQUEST)

        fixed_lid = (getattr(settings, 'POST_APPROVER_LOGINID', '') or '').strip()
        if target_loginid == fixed_lid:
            return Response({'error': '고정 후결자는 제거할 수 없습니다.'}, status=status.HTTP_400_BAD_REQUEST)

        max_round = self._max_round(document)
        ra_step = ApprovalStep.objects.filter(
            document=document, agent='RA', action='pending', round=max_round,
            assignee__loginid=target_loginid,
        ).first()
        if not ra_step:
            return Response({'error': '제거 가능한(미합의) 후결자를 찾을 수 없습니다.'}, status=status.HTTP_400_BAD_REQUEST)

        # Only MAP: 후결자(고정 포함)가 유일한 종단 경로라 총원이 0이 되면 영영 승인될 수 없다.
        if document.is_only_map():
            remaining_total = ApprovalStep.objects.filter(
                document=document, agent='RA', round=max_round
            ).exclude(pk=ra_step.pk).count()
            if remaining_total == 0:
                return Response({'error': 'Only MAP 의뢰서는 최종 승인 경로인 후결자를 최소 1명 유지해야 합니다.'}, status=status.HTTP_400_BAD_REQUEST)
        # requires_post_approver(): 상신 시 "추가 후결자 1명 이상" 이 필수였던 대상(C가문·연구소
        # 제품)과 일관되게, 고정 후결자를 제외한 추가 후결자가 0명이 되는 제거는 막는다
        # (고정 후결자는 이 최소치에 포함되지 않음). 이전엔 only_prodc 만 직접 비교해 연구소
        # 제품 문서는 이 가드를 빠져나갔다(상신 검증은 통과시켜 놓고 진행 중엔 무력화됨).
        if document.requires_post_approver():
            remaining_additional = ApprovalStep.objects.filter(
                document=document, agent='RA', round=max_round
            ).exclude(pk=ra_step.pk).exclude(assignee__loginid=fixed_lid).count()
            if remaining_additional == 0:
                return Response({'error': 'C가문 제품·연구소 제품은 (고정 후결자 외) 후결자를 최소 1명 유지해야 합니다. 변경을 원하시면 1명 추가 후 삭제하시기 바랍니다.'}, status=status.HTTP_400_BAD_REQUEST)

        ra_step.delete()
        self._sync_post_approvers_detail(document, remove_loginid=target_loginid)

        return Response({'message': '후결자가 제거되었습니다.',
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

    @action(detail=True, methods=['post'], url_path='set-shared-group')
    def set_shared_group(self, request, pk=None):
        """임시저장 공유 그룹 지정/해제 — body `{"group_id": <id> | null}`.

        - 인가: 의뢰자 본인 또는 MASTER 만. 공유 그룹 멤버는 문서를 수정·상신할 수는 있어도
          공유 범위 자체는 바꿀 수 없다(2026-08 정책).
        - 지정할 수 있는 그룹은 **호출자가 멤버인 그룹**뿐이다. 남의 그룹에 내 문서를
          밀어 넣지 못하게 막는다.
        - PUT/PATCH 전체 저장에 값이 딸려와 초기화되지 않도록 serializer 에서는 read-only 이며,
          공유 대상 변경은 이 액션으로만 한다.
        """
        document = self.get_object()
        user = request.user
        if getattr(user, 'role', '') != 'MASTER' and not doc_permissions.is_requester(user, document):
            return Response({'error': '공유 그룹을 지정할 권한이 없습니다.'}, status=status.HTTP_403_FORBIDDEN)

        group_id = request.data.get('group_id', None)
        if group_id in (None, ''):
            document.shared_group = None
            document.save(update_fields=['shared_group'])
            return Response({'message': '공유 그룹 지정을 해제했습니다.',
                             'document': RequestDocumentSerializer(document, context={'request': request}).data})

        group = UserGroup.objects.filter(pk=group_id, members=user).first()
        if group is None:
            return Response({'error': '내가 속한 그룹만 공유 대상으로 지정할 수 있습니다.'},
                            status=status.HTTP_400_BAD_REQUEST)

        document.shared_group = group
        document.save(update_fields=['shared_group'])
        return Response({'message': f"‘{group.name}’ 그룹에 공유했습니다.",
                         'document': RequestDocumentSerializer(document, context={'request': request}).data})

    # ===== J 단계 검토 항목 (동기화 규칙은 review_items.py 단일 소스) =====

    def _review_items_response(self, document, request, message=''):
        """변경 후 문서의 검토 항목 최신 목록을 돌려준다(프론트가 그대로 갈아끼운다)."""
        items = DocumentReviewItem.objects.filter(document=document).prefetch_related('reviewers')
        payload = {'review_items': DocumentReviewItemSerializer(items, many=True).data}
        if message:
            payload['message'] = message
        return Response(payload)

    def _get_review_item(self, document, request):
        """body 의 item_id 로 이 문서의 검토 항목을 찾는다. (item, error_response) 반환."""
        item = DocumentReviewItem.objects.filter(
            document=document, pk=request.data.get('item_id'),
        ).first()
        if item is None:
            return None, Response({'error': '검토 항목을 찾을 수 없습니다.'},
                                  status=status.HTTP_400_BAD_REQUEST)
        return item, None

    def _guard_review_item_edit(self, request, document):
        """편집 인가 — J 권한자 + 검토중 선점 + 합의 전 + 진행 중 문서. 통과면 None."""
        if not review_items_sync.can_edit_items(request.user, document):
            return Response(
                {'error': '검토 항목을 편집할 수 없는 상태이거나 권한이 없습니다.'},
                status=status.HTTP_403_FORBIDDEN,
            )
        return None

    @action(detail=True, methods=['post'], url_path='review-item-add')
    @transaction.atomic
    def review_item_add(self, request, pk=None):
        """검토 항목 추가 — body `{"title": "..."}`.

        마스터에 등록되고, 결재 진행 중이면서 현재 회차 J 단계가 pending 인 다른 문서에도
        같은 항목이 추가된다(review_items.py §2).
        """
        document = self.get_object()
        blocked = self._guard_review_item_edit(request, document)
        if blocked:
            return blocked

        title = (request.data.get('title') or '').strip()
        if not title:
            return Response({'error': '항목 제목을 입력해 주세요.'}, status=status.HTTP_400_BAD_REQUEST)
        if len(title) > 300:
            return Response({'error': '항목 제목은 300자를 넘을 수 없습니다.'},
                            status=status.HTTP_400_BAD_REQUEST)

        review_items_sync.add_item(document, title, user=request.user)
        return self._review_items_response(document, request, '검토 항목을 추가했습니다.')

    @action(detail=True, methods=['post'], url_path='review-item-rename')
    @transaction.atomic
    def review_item_rename(self, request, pk=None):
        """검토 항목 제목 수정 — body `{"item_id": n, "title": "..."}`. 마스터·타 문서에 전파."""
        document = self.get_object()
        blocked = self._guard_review_item_edit(request, document)
        if blocked:
            return blocked

        item, err = self._get_review_item(document, request)
        if err:
            return err

        title = (request.data.get('title') or '').strip()
        if not title:
            return Response({'error': '항목 제목을 입력해 주세요.'}, status=status.HTTP_400_BAD_REQUEST)
        if len(title) > 300:
            return Response({'error': '항목 제목은 300자를 넘을 수 없습니다.'},
                            status=status.HTTP_400_BAD_REQUEST)

        review_items_sync.rename_item(item, title)
        return self._review_items_response(document, request, '항목 제목을 수정했습니다.')

    @action(detail=True, methods=['post'], url_path='review-item-delete')
    @transaction.atomic
    def review_item_delete(self, request, pk=None):
        """검토 항목 삭제 — body `{"item_id": n}`.

        마스터가 비활성화되고 전파 대상 문서의 사본도 지워진다. 단 다른 문서에서 이미
        확인한 검토자가 있는 사본은 기록 보존을 위해 남는다(review_items.py §3).
        """
        document = self.get_object()
        blocked = self._guard_review_item_edit(request, document)
        if blocked:
            return blocked

        item, err = self._get_review_item(document, request)
        if err:
            return err

        review_items_sync.delete_item(item)
        return self._review_items_response(document, request, '검토 항목을 삭제했습니다.')

    @action(detail=True, methods=['post'], url_path='review-item-reviewer-add')
    @transaction.atomic
    def review_item_reviewer_add(self, request, pk=None):
        """항목 검토자 지정 — body `{"item_id": n, "loginid": "..."}`.

        이 문서에만 적용된다(검토자는 마스터로 전파되지 않는다 — review_items.py 머리말).
        """
        document = self.get_object()
        blocked = self._guard_review_item_edit(request, document)
        if blocked:
            return blocked

        item, err = self._get_review_item(document, request)
        if err:
            return err

        loginid = (request.data.get('loginid') or '').strip()
        target = User.objects.filter(loginid=loginid).first()
        if target is None:
            return Response({'error': '사용자를 찾을 수 없습니다.'}, status=status.HTTP_400_BAD_REQUEST)
        if target.role not in review_items_sync.EDIT_ROLES:
            return Response({'error': '검토 항목의 검토자로 지정할 수 없는 역할입니다.'},
                            status=status.HTTP_400_BAD_REQUEST)

        DocumentReviewItemReviewer.objects.get_or_create(
            item=item, loginid=target.loginid,
            defaults={'user': target, 'name': target.username or target.loginid},
        )
        return self._review_items_response(document, request, '검토자를 지정했습니다.')

    @action(detail=True, methods=['post'], url_path='review-item-reviewer-remove')
    @transaction.atomic
    def review_item_reviewer_remove(self, request, pk=None):
        """항목 검토자 지정 해제 — body `{"item_id": n, "loginid": "..."}`.

        이미 확인(confirmed)한 검토자는 해제할 수 없다(검토 기록 보존).
        """
        document = self.get_object()
        blocked = self._guard_review_item_edit(request, document)
        if blocked:
            return blocked

        item, err = self._get_review_item(document, request)
        if err:
            return err

        reviewer = DocumentReviewItemReviewer.objects.filter(
            item=item, loginid=(request.data.get('loginid') or '').strip(),
        ).first()
        if reviewer is None:
            return Response({'error': '지정된 검토자가 아닙니다.'}, status=status.HTTP_400_BAD_REQUEST)
        if reviewer.confirmed:
            return Response({'error': '이미 확인한 검토자는 지정을 해제할 수 없습니다.'},
                            status=status.HTTP_400_BAD_REQUEST)

        reviewer.delete()
        return self._review_items_response(document, request, '검토자 지정을 해제했습니다.')

    @action(detail=True, methods=['post'], url_path='review-item-confirm')
    @transaction.atomic
    def review_item_confirm(self, request, pk=None):
        """검토자 본인의 확인 / 확인 취소 — body `{"item_id": n, "confirmed": true|false}`.

        항목이 모두 확인돼도 J 단계가 자동 합의되지는 않는다(합의는 담당자가 따로 누른다).
        """
        document = self.get_object()
        if not review_items_sync.can_confirm_items(document):
            return Response({'error': '지금은 확인할 수 없는 상태입니다.'},
                            status=status.HTTP_403_FORBIDDEN)

        item, err = self._get_review_item(document, request)
        if err:
            return err

        reviewer = DocumentReviewItemReviewer.objects.filter(
            item=item, loginid=getattr(request.user, 'loginid', ''),
        ).first()
        if reviewer is None:
            return Response({'error': '이 항목의 검토자가 아닙니다.'}, status=status.HTTP_403_FORBIDDEN)

        review_items_sync.confirm(reviewer, bool(request.data.get('confirmed', True)))
        return self._review_items_response(document, request)

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

    @action(detail=False, methods=['get'], url_path='annual-design-rule-stats')
    def annual_design_rule_stats(self, request):
        """홈 화면 연간 디자인룰별 의뢰 통계 (집계 규칙은 design_rule_stats 모듈 참조).

        쿼리파라미터
        - `year`   : 기준 연도. 생략 시 승인 건이 있는 가장 최근 연도.
        - `compare`: 비교 연도. 생략하면 비교 필드가 모두 null 로 내려간다.
        - `top`    : 상위 N개(1~30) 또는 `all`. 기본 10.
        """
        years = design_rule_stats.available_years()
        if not years:
            # 승인 건이 아예 없으면 빈 상태 — 프론트가 empty 안내를 띄운다.
            return Response({'data': {
                'year': None, 'compare_year': None, 'top': None,
                'available_years': [], 'purposes': list(design_rule_stats.REQUEST_PURPOSES),
                'buckets': [], 'total': 0, 'compare_total': None,
            }})

        year = self._parse_year(request.query_params.get('year'), default=years[-1])
        compare_year = self._parse_year(request.query_params.get('compare'), default=None)
        if compare_year == year:
            compare_year = None

        top_n = self._parse_top(request.query_params.get('top'))

        data = design_rule_stats.annual_stats(year, compare_year=compare_year, top_n=top_n)
        return Response({'data': data})

    @staticmethod
    def _parse_year(raw, default):
        """연도 파라미터 파싱. 숫자가 아니거나 범위를 벗어나면 기본값."""
        if raw in (None, ''):
            return default
        try:
            year = int(raw)
        except (TypeError, ValueError):
            return default
        # 상식적인 범위 밖 값은 무시한다(경계 datetime 생성 시 OverflowError 방지).
        return year if 1900 <= year <= 2999 else default

    @staticmethod
    def _parse_top(raw):
        """상위 N 파싱. `all` 이면 None(전체), 그 외는 1~MAX_TOP_N 로 클램프."""
        if raw in (None, ''):
            return design_rule_stats.DEFAULT_TOP_N
        if str(raw).lower() == 'all':
            return None
        try:
            top = int(raw)
        except (TypeError, ValueError):
            return design_rule_stats.DEFAULT_TOP_N
        return max(1, min(top, design_rule_stats.MAX_TOP_N))


class ProcessDesignRuleOverrideViewSet(viewsets.ModelViewSet):
    """{{request.process_selection}} 단위 디자인룰 수동 매핑 — 읽기는 로그인, 쓰기는 MASTER.

    `unclassified` 액션이 분류 모달에 필요한 대상 목록을 한 번에 내려준다.
    """
    queryset = ProcessDesignRuleOverride.objects.select_related('created_by').all()
    serializer_class = ProcessDesignRuleOverrideSerializer
    permission_classes = [IsMasterOrReadOnly]
    pagination_class = None

    @action(detail=False, methods=['get'])
    def unclassified(self, request):
        """미분류 대상(조합법·의뢰서)과 디자인룰 후보 목록.

        쿼리파라미터 `year` 가 있으면 해당 연도 승인 건만 대상으로 한다.
        """
        year = RequestDocumentViewSet._parse_year(request.query_params.get('year'), default=None)
        return Response({'data': design_rule_stats.unclassified_targets(year=year)})


class DocumentDesignRuleOverrideViewSet(viewsets.ModelViewSet):
    """의뢰서 단위 디자인룰 수동 매핑 — 읽기는 로그인, 쓰기는 MASTER."""
    queryset = DocumentDesignRuleOverride.objects.select_related('created_by', 'document').all()
    serializer_class = DocumentDesignRuleOverrideSerializer
    permission_classes = [IsMasterOrReadOnly]
    pagination_class = None


class RejectionSnapshotViewSet(mixins.DestroyModelMixin, viewsets.ReadOnlyModelViewSet):
    """반려 이력 조회 — 이력 조회 화면의 '반려' 탭 데이터.

    적재는 반려 API(`reject-step`/`peer-reject`)에서만 일어나므로 생성·수정 라우트는 두지 않는다.
    조회는 이력 조회에 들어올 수 있는 사람 전원, 삭제는 MASTER 만 가능하다
    (`IsAuthenticatedOrMasterDelete`). 원본 문서가 지워져도 이력은 남는다.
    """

    queryset = RejectionSnapshot.objects.all()
    serializer_class = RejectionSnapshotSerializer
    permission_classes = [IsAuthenticatedOrMasterDelete]
    pagination_class = None  # 목록 전체 반환(앱 컨벤션). 전역 PAGE_SIZE=20 적용 방지.
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['title', 'product_name', 'requester_name', 'requester_department']
    ordering_fields = ['rejected_at', 'submitted_at']
    ordering = ['-rejected_at']


class ExternalRequestDocumentViewSet(viewsets.ReadOnlyModelViewSet):
    """외부 시스템용 고정 API Key 읽기 전용 조회.

    /api/external/v1/documents/ — 로그인 계정과 무관하게 X-API-Key 헤더 하나로 접근한다.
    내부 결재 액션(submit/approve-step/delete 등)이 있는 RequestDocumentViewSet 과는
    완전히 분리된 클래스라 실수로도 쓰기 액션이 노출되지 않는다. draft 포함 전체 상태를 반환한다
    (내부용 get_queryset() 의 draft 접근 제한과 달리 API Key 소지자는 전체를 조회할 수 있음 — 의도된 동작).

    옵트인 쿼리파라미터(둘 다 미지정 시 기존과 동일하게 동작):
    - `p_approved=true` : 결재 회차(round) 상관없이 P단계가 한 번이라도 합의(approved)된
      적 있는 문서만 반환.
    - `fields=a,b,c` : 응답에 담을 필드를 호출자가 직접 선택(허용되지 않는 필드명은 400).
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

    def initial(self, request, *args, **kwargs):
        # 인증/권한 확인(super().initial) 통과 후에만 파라미터 형식을 검증한다.
        super().initial(request, *args, **kwargs)
        self._validate_query_params(request)

    def _validate_query_params(self, request):
        p_approved_param = request.query_params.get('p_approved')
        if p_approved_param is not None and p_approved_param.lower() not in ('true', 'false'):
            raise ValidationError({'p_approved': "'true' 또는 'false' 만 허용됩니다."})

        fields_param = request.query_params.get('fields')
        if fields_param:
            requested = {f.strip() for f in fields_param.split(',') if f.strip()}
            allowed = set(ExternalRequestDocumentSerializer.Meta.fields)
            invalid = requested - allowed
            if invalid:
                raise ValidationError({
                    'fields': f"허용되지 않는 필드입니다: {sorted(invalid)}. 허용 필드: {sorted(allowed)}",
                })

    def get_queryset(self):
        qs = super().get_queryset()
        p_approved_param = self.request.query_params.get('p_approved')
        if p_approved_param is not None and p_approved_param.lower() == 'true':
            p_step_approved = ApprovalStep.objects.filter(
                document=OuterRef('pk'), agent='P', action='approved',
            )
            qs = qs.filter(Exists(p_step_approved))
        return qs

    def get_serializer(self, *args, **kwargs):
        fields_param = self.request.query_params.get('fields')
        if fields_param:
            kwargs['fields'] = [f.strip() for f in fields_param.split(',') if f.strip()]
        return super().get_serializer(*args, **kwargs)

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())

        # 서버 로그 전용 — 호출자에게 보내는 HTTP 응답에는 포함하지 않는다.
        print(
            f"[ExternalAPI] product_name={request.query_params.get('product_name', '(전체)')!r} "
            f"p_approved={request.query_params.get('p_approved', '(미적용)')!r} "
            f"fields={request.query_params.get('fields', '(전체 필드)')!r} "
            f"-> {queryset.count()}건 매칭"
        )

        page = self.paginate_queryset(queryset)
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        serializer = self.get_serializer(queryset, many=True)
        return Response(serializer.data)


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
    """원본 위치(라인명) → partid 목록 반환("_" 앞 8자리 코드만, 중복 제거·정렬)"""
    line = request.GET.get('line', '')
    lineid = LINE_TO_LINEID_MAP.get(line)
    if not lineid:
        return JsonResponse({'options': []})

    raw_partids = (
        MapName.objects.filter(lineid=lineid)
        .values_list('partid', flat=True)
        .distinct()
    )
    codes = {p.split('_')[0] for p in raw_partids if len(p.split('_')[0]) == 8}
    options = sorted(codes)
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
