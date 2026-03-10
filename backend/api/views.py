from django.utils import timezone
from django.conf import settings
from django.core.mail import send_mail
from django.template.loader import render_to_string
from rest_framework import viewsets, status, filters
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import AllowAny
from django_filters.rest_framework import DjangoFilterBackend

from .models import RequestDocument, ApprovalStep, VOC, RFG
from .serializers import (
    RequestDocumentSerializer, RequestDocumentListSerializer,
    ApprovalStepSerializer, VOCSerializer, RFGSerializer
)


def send_submission_email(document):
    """의뢰서 상신 이메일 발송"""
    subject = f'[의뢰서 상신] {document.title} - {document.product_name}'
    recipients = [email for email in settings.APPROVAL_EMAIL_LIST if email]

    if not recipients:
        recipients = [document.requester_email]

    body = f"""
안녕하세요,

새로운 제품 소개 지도 의뢰서가 상신되었습니다.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ 의뢰서 정보
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

• 제목: {document.title}
• 의뢰자: {document.requester_name} ({document.requester_department})
• 이메일: {document.requester_email}
• 직책: {document.requester_position or '-'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ 제품 정보
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

• 제품명: {document.product_name}
• 제품 유형: {document.get_product_type_display()}
• 버전: {document.product_version or '-'}
• 지도 유형: {document.get_map_type_display()}
• 우선순위: {document.priority.upper()}
• 요청 완료일: {document.deadline or '-'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ 제품 설명
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{document.product_description}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ 주요 기능/특징
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{document.key_features}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ 추가 요청사항
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{document.additional_notes or '없음'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

상신일시: {document.submitted_at.strftime('%Y년 %m월 %d일 %H:%M') if document.submitted_at else '-'}

감사합니다.
제품 의뢰 시스템
    """

    try:
        send_mail(
            subject=subject,
            message=body,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=recipients,
            fail_silently=False,
        )
        return True
    except Exception as e:
        print(f"Email send failed: {e}")
        return False


class RequestDocumentViewSet(viewsets.ModelViewSet):
    queryset = RequestDocument.objects.all()
    permission_classes = [AllowAny]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['status', 'product_type', 'map_type', 'priority']
    search_fields = ['title', 'product_name', 'requester_name', 'requester_department']
    ordering_fields = ['created_at', 'submitted_at', 'deadline', 'priority']
    ordering = ['-created_at']

    def get_serializer_class(self):
        if self.action == 'list':
            return RequestDocumentListSerializer
        return RequestDocumentSerializer

    @action(detail=True, methods=['post'])
    def submit(self, request, pk=None):
        """의뢰서 상신"""
        document = self.get_object()
        if document.status != 'draft':
            return Response(
                {'error': '임시저장 상태의 의뢰서만 상신할 수 있습니다.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        document.status = 'submitted'
        document.submitted_at = timezone.now()
        document.save()

        email_sent = send_submission_email(document)

        return Response({
            'message': '의뢰서가 성공적으로 상신되었습니다.',
            'email_sent': email_sent,
            'document': RequestDocumentSerializer(document).data
        })

    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        """의뢰서 승인"""
        document = self.get_object()
        comment = request.data.get('comment', '')
        approver_name = request.data.get('approver_name', '')

        document.status = 'approved'
        document.save()

        step = ApprovalStep.objects.filter(
            document=document, action='pending'
        ).first()
        if step:
            step.action = 'approved'
            step.comment = comment
            step.acted_at = timezone.now()
            step.save()

        return Response({'message': '승인되었습니다.', 'status': document.status})

    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        """의뢰서 반려"""
        document = self.get_object()
        comment = request.data.get('comment', '')

        document.status = 'rejected'
        document.save()

        step = ApprovalStep.objects.filter(
            document=document, action='pending'
        ).first()
        if step:
            step.action = 'rejected'
            step.comment = comment
            step.acted_at = timezone.now()
            step.save()

        return Response({'message': '반려되었습니다.', 'status': document.status})

    @action(detail=False, methods=['get'])
    def stats(self, request):
        """통계 조회"""
        total = RequestDocument.objects.count()
        by_status = {}
        for status_key, _ in RequestDocument.STATUS_CHOICES:
            by_status[status_key] = RequestDocument.objects.filter(status=status_key).count()

        return Response({
            'total': total,
            'by_status': by_status,
        })


class ApprovalStepViewSet(viewsets.ModelViewSet):
    queryset = ApprovalStep.objects.all()
    serializer_class = ApprovalStepSerializer
    permission_classes = [AllowAny]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['document', 'action']


class VOCViewSet(viewsets.ModelViewSet):
    queryset = VOC.objects.all()
    serializer_class = VOCSerializer
    permission_classes = [AllowAny]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ['category', 'status']
    search_fields = ['title', 'submitter_name', 'content']
    ordering = ['-created_at']


class RFGViewSet(viewsets.ModelViewSet):
    queryset = RFG.objects.all()
    serializer_class = RFGSerializer
    permission_classes = [AllowAny]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ['status']
    search_fields = ['title', 'requester_name', 'product_name']
    ordering = ['-created_at']
