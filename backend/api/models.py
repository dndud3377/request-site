from django.db import models
from django.contrib.auth.models import User


class RequestDocument(models.Model):
    """제품 소개 지도 의뢰서 모델"""

    STATUS_CHOICES = [
        ('draft', 'Draft / 임시저장'),
        ('submitted', 'Submitted / 상신됨'),
        ('under_review', 'Under Review / 검토중'),
        ('approved', 'Approved / 승인됨'),
        ('rejected', 'Rejected / 반려됨'),
        ('revision_required', 'Revision Required / 수정요청'),
    ]

    PRODUCT_TYPE_CHOICES = [
        ('new', 'New Product / 신제품'),
        ('update', 'Product Update / 제품 업데이트'),
        ('add_feature', 'Feature Addition / 기능 추가'),
        ('change', 'Product Change / 제품 변경'),
    ]

    MAP_TYPE_CHOICES = [
        ('intro', 'Introduction Map / 소개 지도'),
        ('feature', 'Feature Map / 기능 지도'),
        ('comparison', 'Comparison Map / 비교 지도'),
        ('roadmap', 'Product Roadmap / 제품 로드맵'),
    ]

    # 기본 정보
    title = models.CharField(max_length=200, verbose_name='의뢰서 제목')
    requester = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='requests', verbose_name='의뢰자'
    )
    requester_name = models.CharField(max_length=100, verbose_name='의뢰자 이름')
    requester_email = models.EmailField(verbose_name='의뢰자 이메일')
    requester_department = models.CharField(max_length=100, verbose_name='부서')
    requester_position = models.CharField(max_length=100, blank=True, verbose_name='직책')

    # 제품 정보
    product_name = models.CharField(max_length=200, verbose_name='제품명')
    product_name_en = models.CharField(max_length=200, blank=True, verbose_name='제품명 (영문)')
    product_type = models.CharField(
        max_length=20, choices=PRODUCT_TYPE_CHOICES, verbose_name='제품 유형'
    )
    product_version = models.CharField(max_length=50, blank=True, verbose_name='버전')
    product_description = models.TextField(verbose_name='제품 설명')
    product_description_en = models.TextField(blank=True, verbose_name='제품 설명 (영문)')

    # 의뢰 상세
    map_type = models.CharField(
        max_length=20, choices=MAP_TYPE_CHOICES, verbose_name='지도 유형'
    )
    target_audience = models.TextField(verbose_name='대상 고객')
    key_features = models.TextField(verbose_name='주요 기능/특징')
    key_features_en = models.TextField(blank=True, verbose_name='주요 기능/특징 (영문)')
    changes_from_previous = models.TextField(blank=True, verbose_name='이전 버전 대비 변경사항')
    reference_materials = models.TextField(blank=True, verbose_name='참고 자료')
    deadline = models.DateField(null=True, blank=True, verbose_name='요청 완료일')
    priority = models.CharField(
        max_length=10,
        choices=[('low', 'Low'), ('medium', 'Medium'), ('high', 'High'), ('urgent', 'Urgent')],
        default='medium',
        verbose_name='우선순위'
    )
    additional_notes = models.TextField(blank=True, verbose_name='추가 요청사항')

    # 상태
    status = models.CharField(
        max_length=20, choices=STATUS_CHOICES, default='draft', verbose_name='상태'
    )

    # 타임스탬프
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='생성일')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='수정일')
    submitted_at = models.DateTimeField(null=True, blank=True, verbose_name='상신일')

    class Meta:
        verbose_name = '의뢰서'
        verbose_name_plural = '의뢰서 목록'
        ordering = ['-created_at']

    def __str__(self):
        return f"[{self.get_status_display()}] {self.title} - {self.requester_name}"


class ApprovalStep(models.Model):
    """결재 단계 모델"""

    ACTION_CHOICES = [
        ('pending', 'Pending / 대기'),
        ('approved', 'Approved / 승인'),
        ('rejected', 'Rejected / 반려'),
        ('revision', 'Revision Requested / 수정요청'),
    ]

    document = models.ForeignKey(
        RequestDocument, on_delete=models.CASCADE,
        related_name='approval_steps', verbose_name='의뢰서'
    )
    step_order = models.PositiveIntegerField(verbose_name='결재 순서')
    approver_name = models.CharField(max_length=100, verbose_name='결재자 이름')
    approver_email = models.EmailField(verbose_name='결재자 이메일')
    approver_position = models.CharField(max_length=100, verbose_name='결재자 직책')
    action = models.CharField(
        max_length=20, choices=ACTION_CHOICES, default='pending', verbose_name='결재 결과'
    )
    comment = models.TextField(blank=True, verbose_name='의견')
    acted_at = models.DateTimeField(null=True, blank=True, verbose_name='결재일시')

    class Meta:
        verbose_name = '결재 단계'
        verbose_name_plural = '결재 단계 목록'
        ordering = ['step_order']

    def __str__(self):
        return f"{self.document.title} - Step {self.step_order}: {self.approver_name}"


class VOC(models.Model):
    """VOC (Voice of Customer) 모델"""

    CATEGORY_CHOICES = [
        ('inquiry', 'Inquiry / 문의'),
        ('complaint', 'Complaint / 불만'),
        ('suggestion', 'Suggestion / 제안'),
        ('praise', 'Praise / 칭찬'),
    ]

    STATUS_CHOICES = [
        ('open', 'Open / 접수'),
        ('in_progress', 'In Progress / 처리중'),
        ('resolved', 'Resolved / 해결됨'),
        ('closed', 'Closed / 종료'),
    ]

    title = models.CharField(max_length=200, verbose_name='제목')
    category = models.CharField(max_length=20, choices=CATEGORY_CHOICES, verbose_name='유형')
    submitter_name = models.CharField(max_length=100, verbose_name='제출자')
    submitter_email = models.EmailField(verbose_name='이메일')
    content = models.TextField(verbose_name='내용')
    response = models.TextField(blank=True, verbose_name='답변')
    status = models.CharField(
        max_length=20, choices=STATUS_CHOICES, default='open', verbose_name='상태'
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='접수일')
    responded_at = models.DateTimeField(null=True, blank=True, verbose_name='답변일')

    class Meta:
        verbose_name = 'VOC'
        verbose_name_plural = 'VOC 목록'
        ordering = ['-created_at']

    def __str__(self):
        return f"[{self.get_status_display()}] {self.title}"


class RFG(models.Model):
    """RFG (Request For Guide) 모델"""

    STATUS_CHOICES = [
        ('open', 'Open / 접수'),
        ('in_progress', 'In Progress / 처리중'),
        ('resolved', 'Resolved / 완료'),
    ]

    title = models.CharField(max_length=200, verbose_name='요청 제목')
    requester_name = models.CharField(max_length=100, verbose_name='요청자')
    requester_email = models.EmailField(verbose_name='이메일')
    product_name = models.CharField(max_length=200, verbose_name='제품명')
    description = models.TextField(verbose_name='요청 내용')
    status = models.CharField(
        max_length=20, choices=STATUS_CHOICES, default='open', verbose_name='상태'
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='접수일')

    class Meta:
        verbose_name = 'RFG'
        verbose_name_plural = 'RFG 목록'
        ordering = ['-created_at']

    def __str__(self):
        return f"[{self.get_status_display()}] {self.title}"
