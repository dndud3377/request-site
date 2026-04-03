from django.utils import timezone
from django.http import JsonResponse
from django.views.decorators.http import require_GET
from rest_framework import viewsets, status, filters
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import AllowAny
from django_filters.rest_framework import DjangoFilterBackend
from django.db import connection


from django.http import JsonResponse
from django.views.decorators.http import require_GET

from .models import RequestDocument, ApprovalStep, VOC, Line, CombinationProduct, ProductCooking
from .serializers import (
    RequestDocumentSerializer, RequestDocumentListSerializer,
    VOCSerializer, LineSerializer,
)


class RequestDocumentViewSet(viewsets.ModelViewSet):
    queryset = RequestDocument.objects.all()
    permission_classes = [AllowAny]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['status']
    search_fields = ['title', 'product_name', 'requester_name', 'requester_department']
    ordering_fields = ['created_at', 'submitted_at']
    ordering = ['-created_at']

    def get_serializer_class(self):
        if self.action == 'list':
            return RequestDocumentListSerializer
        return RequestDocumentSerializer

    @action(detail=True, methods=['post'])
    def submit(self, request, pk=None):
        """상신: draft → under_review, AGENT R 단계 생성"""
        document = self.get_object()
        if document.status != 'draft':
            return Response(
                {'error': '임시저장 상태의 의뢰서만 상신할 수 있습니다.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        document.status = 'under_review'
        document.submitted_at = document.submitted_at or timezone.now()
        document.save()

        ApprovalStep.objects.filter(document=document).delete()
        ApprovalStep.objects.create(document=document, agent='R', action='pending')

        return Response({
            'message': '의뢰서가 성공적으로 상신되었습니다.',
            'email_sent': False,
            'document': RequestDocumentSerializer(document).data,
        })

    @action(detail=True, methods=['post'])
    def resubmit(self, request, pk=None):
        """재상신: rejected → under_review, 단계 초기화 후 AGENT R부터"""
        document = self.get_object()
        if document.status != 'rejected':
            return Response(
                {'error': '반려된 의뢰서만 재상신할 수 있습니다.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        document.status = 'under_review'
        document.save()

        ApprovalStep.objects.filter(document=document).delete()
        ApprovalStep.objects.create(document=document, agent='R', action='pending')

        return Response({
            'message': '재상신되었습니다.',
            'document': RequestDocumentSerializer(document).data,
        })

    @action(detail=True, methods=['post'])
    def withdraw(self, request, pk=None):
        """철회: under_review/rejected → draft, 단계 초기화"""
        document = self.get_object()
        if document.status not in ('under_review', 'rejected', 'submitted'):
            return Response(
                {'error': '철회할 수 없는 상태입니다.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        document.status = 'draft'
        document.submitted_at = None
        document.save()

        ApprovalStep.objects.filter(document=document).delete()

        return Response({'message': '철회되었습니다.'})

    @action(detail=True, methods=['post'], url_path='delete')
    def delete(self, request, pk=None):
        """의뢰서 삭제 (draft 상태만 가능)"""
        document = self.get_object()
        if document.status != 'draft':
            return Response(
                {'error': '임시저장 상태의 의뢰서만 삭제할 수 있습니다.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        document.delete()
        return Response({'message': '삭제되었습니다.'})

    @action(detail=True, methods=['post'], url_path='approve-step')
    def approve_step(self, request, pk=None):
        """에이전트 단계 합의 (mock.ts mockApproveStep 로직과 동일)"""
        document = self.get_object()
        agent = request.data.get('agent')
        comment = request.data.get('comment', '')

        if agent not in ('R', 'J', 'O', 'E'):
            return Response({'error': '유효하지 않은 에이전트입니다.'}, status=status.HTTP_400_BAD_REQUEST)

        step = ApprovalStep.objects.filter(
            document=document, agent=agent, action='pending'
        ).first()
        if not step:
            return Response({'error': f'AGENT {agent}의 대기 중인 단계가 없습니다.'}, status=status.HTTP_400_BAD_REQUEST)

        step.action = 'approved'
        step.acted_at = timezone.now()
        step.comment = comment
        step.save()

        new_status = document.status

        if agent == 'R':
            # R 합의 → J, O 병렬 단계 생성
            ApprovalStep.objects.create(document=document, agent='J', action='pending', is_parallel=True)
            ApprovalStep.objects.create(document=document, agent='O', action='pending', is_parallel=True)
            new_status = 'under_review'

        elif agent in ('J', 'O'):
            # J/O 모두 합의 시 다음 단계 결정
            j_step = ApprovalStep.objects.filter(document=document, agent='J').order_by('-id').first()
            o_step = ApprovalStep.objects.filter(document=document, agent='O').order_by('-id').first()
            both_approved = (
                j_step and j_step.action == 'approved' and
                o_step and o_step.action == 'approved'
            )
            if both_approved:
                if document.is_sugar_add():
                    ApprovalStep.objects.create(document=document, agent='E', action='pending')
                    new_status = 'under_review'
                else:
                    new_status = 'approved'

        elif agent == 'E':
            new_status = 'approved'

        document.status = new_status
        document.save()

        return Response({
            'message': '처리되었습니다.',
            'status': new_status,
        })

    @action(detail=True, methods=['post'], url_path='reject-step')
    def reject_step(self, request, pk=None):
        """에이전트 단계 반려"""
        document = self.get_object()
        agent = request.data.get('agent')
        comment = request.data.get('comment', '')

        if agent not in ('R', 'J', 'O', 'E'):
            return Response({'error': '유효하지 않은 에이전트입니다.'}, status=status.HTTP_400_BAD_REQUEST)

        step = ApprovalStep.objects.filter(
            document=document, agent=agent, action='pending'
        ).first()
        if not step:
            return Response({'error': f'AGENT {agent}의 대기 중인 단계가 없습니다.'}, status=status.HTTP_400_BAD_REQUEST)

        step.action = 'rejected'
        step.acted_at = timezone.now()
        step.comment = comment
        step.save()

        document.status = 'rejected'
        document.save()

        return Response({'message': '반려되었습니다.', 'status': 'rejected'})

    @action(detail=True, methods=['post'], url_path='assign-step')
    def assign_step(self, request, pk=None):
        """에이전트 단계 담당자 지정"""
        from django.contrib.auth.models import User

        document = self.get_object()
        agent = request.data.get('agent')
        assignee_id = request.data.get('assignee_id')
        assignee_name = request.data.get('assignee_name', '')

        step = ApprovalStep.objects.filter(
            document=document, agent=agent, action='pending'
        ).first()
        if not step:
            return Response({'error': '해당 단계를 찾을 수 없습니다.'}, status=status.HTTP_400_BAD_REQUEST)

        if assignee_id:
            try:
                assignee_user = User.objects.get(id=assignee_id)
                step.assignee = assignee_user
            except User.DoesNotExist:
                return Response({'error': '사용자를 찾을 수 없습니다.'}, status=status.HTTP_400_BAD_REQUEST)

        step.assignee_name = assignee_name
        step.save()

        return Response({'message': '담당자가 지정되었습니다.'})

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
    permission_classes = [AllowAny]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ['category', 'status']
    search_fields = ['title', 'submitter_name', 'content']
    ordering = ['-created_at']


class LineViewSet(viewsets.ReadOnlyModelViewSet):
    """라인 마스터 데이터 (읽기 전용)"""
    queryset = Line.objects.filter(is_active=True)
    serializer_class = LineSerializer
    permission_classes = [AllowAny]
    pagination_class = None


# @require_GET
# def form_options_combinations(request):
#     """라인 → 조합법 목록"""
#     # 파라미터: line (GET)
#     # 로직: CombinationProduct 모델에서 line 필터링 후 combination 목록 반환
#     # 반환값: JsonResponse({'options': ['조합법1', '조합법2', ...]})


# @require_GET
# def form_options_products(request):
#     """라인 + 조합법 → 제품이름 목록 (combination 은 선택 사항)"""
#     # 파라미터: line (GET), combination (GET, 선택)
#     # 로직: CombinationProduct 모델에서 line 필터링, combination 있으면 추가 필터링 후 product_name 목록 반환
#     # 반환값: JsonResponse({'options': ['제품1', '제품2', ...]})


# @require_GET
# def form_options_process_id(request):
#     """라인 + 제품이름 → 조리법 목록"""
#     # 파라미터: line (GET), product (GET)
#     # 로직: ProductCooking 모델에서 line, product_name 필터링 후 process_id 목록 반환
#     # 반환값: JsonResponse({'options': ['조리법1', '조리법2', ...]})


# [EXTERNAL] bigdata 서비스 참조 - scheduler.py 함수 사용
# @require_GET
# def form_options_step_info(request):
#     """big data 실시간 조회"""
#     # 파라미터: line (GET), process (GET)
#     # 로직:
#     #   1. big data로그인
#     #   2. big data 자격증명 가져오기
#     #   3. 라인별 테이블 매핑
#     #   4. big data 쿼리 실행
#     #   5. DataFrame을 dict 리스트로 변환
#     # 반환값: JsonResponse({'options': [{'processid': '...', 'step': '...', 'descript': '...', 'recipeid': '...'}, ...]})
