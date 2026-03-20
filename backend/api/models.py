import json
from django.db import models
from django.contrib.auth.models import User


class UserProfile(models.Model):
    """사용자 역할 프로필"""

    ROLE_CHOICES = [
        ('PL', '제품 담당자'),
        ('TE_R', 'AGENT R팀'),
        ('TE_J', 'AGENT J팀'),
        ('TE_O', 'AGENT O팀'),
        ('TE_E', 'AGENT E팀'),
        ('MASTER', '관리자'),
    ]

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile')
    role = models.CharField(max_length=10, choices=ROLE_CHOICES)
    department = models.CharField(max_length=100, blank=True)
    display_name = models.CharField(max_length=100, blank=True)

    def __str__(self):
        return f"{self.display_name} ({self.role})"


class RequestDocument(models.Model):
    """의뢰서 모델 - 프론트엔드 RequestDocument 타입과 1:1 매핑"""

    STATUS_CHOICES = [
        ('draft', '임시저장'),
        ('submitted', '상신됨'),
        ('under_review', '검토중'),
        ('approved', '승인됨'),
        ('rejected', '반려됨'),
        ('revision_required', '수정요청'),
    ]

    title = models.CharField(max_length=300, verbose_name='의뢰서 제목')
    requester = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='requests', verbose_name='의뢰자'
    )
    requester_name = models.CharField(max_length=100, verbose_name='의뢰자 이름')
    requester_email = models.EmailField(verbose_name='의뢰자 이메일')
    requester_department = models.CharField(max_length=100, verbose_name='부서')
    product_name = models.CharField(max_length=200, verbose_name='제품명')
    reference_materials = models.TextField(blank=True, verbose_name='참고 자료')
    # 상세 폼 데이터를 JSON 문자열로 저장 (detail.sugar_add 등 포함)
    additional_notes = models.TextField(blank=True, verbose_name='추가 정보(JSON)')

    status = models.CharField(
        max_length=20, choices=STATUS_CHOICES, default='draft', verbose_name='상태'
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='생성일')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='수정일')
    submitted_at = models.DateTimeField(null=True, blank=True, verbose_name='상신일')

    class Meta:
        verbose_name = '의뢰서'
        verbose_name_plural = '의뢰서 목록'
        ordering = ['-created_at']

    def __str__(self):
        return f"[{self.status}] {self.title}"

    def get_detail(self):
        """additional_notes JSON 파싱"""
        try:
            return json.loads(self.additional_notes or '{}')
        except (json.JSONDecodeError, TypeError):
            return {}

    def is_sugar_add(self):
        """설탕 추가 여부 확인 (E단계 생성 조건)"""
        detail = self.get_detail()
        return detail.get('detail', {}).get('sugar_add') == '예'


class ApprovalStep(models.Model):
    """결재 단계 - 프론트엔드 ApprovalStepFrontend 타입과 1:1 매핑"""

    AGENT_CHOICES = [
        ('R', 'AGENT R'),
        ('J', 'AGENT J'),
        ('O', 'AGENT O'),
        ('E', 'AGENT E'),
    ]

    ACTION_CHOICES = [
        ('pending', '대기'),
        ('approved', '합의'),
        ('rejected', '반려'),
    ]

    document = models.ForeignKey(
        RequestDocument, on_delete=models.CASCADE,
        related_name='approval_steps', verbose_name='의뢰서'
    )
    agent = models.CharField(max_length=2, choices=AGENT_CHOICES, verbose_name='담당 에이전트')
    action = models.CharField(
        max_length=10, choices=ACTION_CHOICES, default='pending', verbose_name='결재 결과'
    )
    acted_at = models.DateTimeField(null=True, blank=True, verbose_name='처리일시')
    comment = models.TextField(blank=True, verbose_name='의견')
    is_parallel = models.BooleanField(default=False, verbose_name='병렬 처리 여부')
    assignee = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='assigned_steps', verbose_name='담당자'
    )
    assignee_name = models.CharField(max_length=100, blank=True, verbose_name='담당자 이름')

    class Meta:
        verbose_name = '결재 단계'
        verbose_name_plural = '결재 단계 목록'
        ordering = ['id']

    def __str__(self):
        return f"{self.document.title} - AGENT {self.agent}: {self.action}"


class VOC(models.Model):
    """VOC (Voice of Customer) 모델"""

    CATEGORY_CHOICES = [
        ('inquiry', '문의'),
        ('complaint', '불만'),
        ('suggestion', '제안'),
        ('praise', '칭찬'),
    ]

    STATUS_CHOICES = [
        ('open', '접수'),
        ('in_progress', '처리중'),
        ('resolved', '해결됨'),
        ('closed', '종료'),
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
        return f"[{self.status}] {self.title}"
