"""
⚠️ MASKING 처리된 파일

이 파일에 포함된 비즈니스 용어는 {{ko.json}} 키로 마스킹되어 있습니다.
원래 용어를 확인하려면 다음 파일을 참조하세요:
- frontend/src/locales/ko.json
"""
import json
from django.db import models
from django.contrib.auth import get_user_model

User = get_user_model()


class RequestDocument(models.Model):
    """의뢰서 모델 - 프론트엔드 RequestDocument 타입과 1:1 매핑"""

    STATUS_CHOICES = [
        ('draft', '임시저장'),
        ('submitted', '상신됨'),
        ('under_review', '검토중'),
        ('approved', '승인됨'),
        ('rejected', '반려됨'),
    ]

    title = models.CharField(max_length=300, verbose_name='의뢰서 제목')
    requester = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='requests', verbose_name='의뢰자'
    )
    requester_name = models.CharField(max_length=100, verbose_name='의뢰자 이름')
    requester_email = models.EmailField(verbose_name='의뢰자 이메일')
    requester_department = models.CharField(max_length=100, verbose_name='부서')
    product_name = models.CharField(max_length=200, verbose_name='{{request.partid_selection}}')
    reference_materials = models.TextField(blank=True, verbose_name='참고 자료')
    # 상세 폼 데이터를 JSON 문자열로 저장 (detail.e_lps 등 포함)
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

    def has_ppid_plel(self):
        detail = self.get_detail()
        jayer_rows = detail.get('jayerRows', [])
        for row in jayer_rows:
            pp = row.get('pp', '')
            if 'plel' in pp.lower():  # 대소문자 구분 없음
                return True
        return False


class ApprovalStep(models.Model):
    """결재 단계 - 프론트엔드 ApprovalStepFrontend 타입과 1:1 매핑"""

    AGENT_CHOICES = [
        ('R', '{{agent_R}}'),
        ('J', '{{agent_J}}'),
        ('O', '{{agent_O}}'),
        ('E', '{{agent_E}}'),
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
        max_length=10, choices=ACTION_CHOICES, default='checking', verbose_name='결재 결과'
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


class Line(models.Model):
    """{{request.line}} 마스터 데이터"""
    name = models.CharField(max_length=50, unique=True, verbose_name='{{request.line}} 이름')
    order = models.PositiveSmallIntegerField(default=0, verbose_name='정렬 순서')
    is_active = models.BooleanField(default=True, verbose_name='활성 여부')

    class Meta:
        verbose_name = '{{request.line}}'
        verbose_name_plural = '{{request.line}} 목록'
        ordering = ['order', 'name']

    def __str__(self):
        return self.name


class ProcessProduct(models.Model):
    """외부 DB 에서 1 시간마다 동기화되는 {{request.process_selection}}-{{request.partid_selection}} 캐시"""
    line = models.CharField(max_length=50, verbose_name='{{request.line}}')
    process = models.CharField(max_length=200, verbose_name='{{request.process_selection}}')
    product_name = models.CharField(max_length=200, verbose_name='{{request.partid_selection}}')
    last_synced = models.DateTimeField(auto_now=True, verbose_name='동기화 시각')

    class Meta:
        verbose_name = '{{request.process_selection}}-{{request.partid_selection}} 캐시'
        verbose_name_plural = '{{request.process_selection}}-{{request.partid_selection}} 캐시 목록'
        indexes = [
            models.Index(fields=['line']),
            models.Index(fields=['line', 'process']),
        ]

    def __str__(self):
        return f"{self.line} / {self.process} / {self.product_name}"


class ProductProcessId(models.Model):
    """외부 DB 에서 1 시간마다 동기화되는 {{request.partid_selection}}-{{request.process_id}} 캐시"""
    line = models.CharField(max_length=50, verbose_name='{{request.line}}')
    product_name = models.CharField(max_length=200, verbose_name='{{request.partid_selection}}')
    process_id = models.CharField(max_length=200, verbose_name='{{request.process_id}}')
    last_synced = models.DateTimeField(auto_now=True, verbose_name='동기화 시각')

    class Meta:
        verbose_name = '{{request.partid_selection}}-{{request.process_id}} 캐시'
        verbose_name_plural = '{{request.partid_selection}}-{{request.process_id}} 캐시 목록'
        indexes = [
            models.Index(fields=['line']),
            models.Index(fields=['line', 'product_name']),
        ]

    def __str__(self):
        return f"{self.line} / {self.product_name} / {self.process_id}"


class VOC(models.Model):
    """VOC (Voice of Customer) 모델"""

    CATEGORY_CHOICES = [
        ('inquiry', '문의'),
        ('error_report', '오류 신고'),
        ('feature_request', '기능 제안'),
        ('task_request', '작업 요청'),
    ]

    STATUS_CHOICES = [
        ('checking', '확인중'),
        ('completed', '완료'),
        ('rejected', '거부'),
    ]

    title = models.CharField(max_length=200, verbose_name='제목')
    category = models.CharField(max_length=20, choices=CATEGORY_CHOICES, verbose_name='유형')
    submitter_name = models.CharField(max_length=100, verbose_name='제출자')
    submitter_email = models.EmailField(verbose_name='이메일')
    content = models.TextField(verbose_name='내용')
    response = models.TextField(blank=True, verbose_name='답변')
    status = models.CharField(
        max_length=20, choices=STATUS_CHOICES, default='checking', verbose_name='상태'
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='접수일')
    responded_at = models.DateTimeField(null=True, blank=True, verbose_name='답변일')

    class Meta:
        verbose_name = 'VOC'
        verbose_name_plural = 'VOC 목록'
        ordering = ['-created_at']

    def __str__(self):
        return f"[{self.status}] {self.title}"


class AdminNotice(models.Model):
    """관리팀 공지사항"""

    TEMPLATE_CHOICES = [
        ('notice', 'Notice'),
        ('release_note', 'Release Note'),
    ]

    template = models.CharField(max_length=20, choices=TEMPLATE_CHOICES, verbose_name='템플릿')
    date = models.DateField(verbose_name='날짜')
    title = models.CharField(max_length=200, verbose_name='제목')
    content = models.TextField(blank=True, verbose_name='내용')  # Notice 타입 전용
    items = models.JSONField(default=list, verbose_name='항목')   # Release Note 전용

    created_at = models.DateTimeField(auto_now_add=True, verbose_name='작성일')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='수정일')

    class Meta:
        verbose_name = '공지사항'
        verbose_name_plural = '공지사항 목록'
        ordering = ['-date', '-created_at']

    def __str__(self):
        return f"[{self.template}] {self.title} ({self.date})"

class PhotoStepS1(models.Model):
    """line1 라인 {{request.col_step}} 정보 (스케줄러 동기화)"""
    processid = models.CharField(max_length=200, verbose_name='{{request.process_id}} ID')
    stepseq = models.CharField(max_length=200, verbose_name='{{request.col_step}}SEQ')
    descript = models.CharField(max_length=200, verbose_name='{{request.process_selection}}명')
    recipeid = models.CharField(max_length=200, verbose_name='Recipe ID')
    areaname = models.CharField(max_length=50, verbose_name='영역명')
    eqptype = models.CharField(max_length=50, verbose_name='장비 타입')
    layerid = models.CharField(max_length=200, blank=True, verbose_name='레이어 ID')
    updated = models.CharField(max_length=50, blank=True, verbose_name='업데이트')
    last_synced = models.DateTimeField(auto_now=True, verbose_name='동기화 시각')

    class Meta:
        verbose_name = 'line1 {{request.col_step}} 정보'
        verbose_name_plural = 'line1 {{request.col_step}} 정보 목록'
        indexes = [
            models.Index(fields=['processid'], name='api_pstep_line1_processid_idx'),
            models.Index(fields=['processid', 'eqptype'], name='api_pstep_line1_prcid_eqp_idx'),
        ]

    def __str__(self):
        return f"line1 / {self.processid} / {self.stepseq} / {self.descript} / {self.eqptype}"


class PhotoStepS3(models.Model):
    """line3 라인 {{request.col_step}} 정보 (스케줄러 동기화)"""
    processid = models.CharField(max_length=200, verbose_name='{{request.process_id}} ID')
    stepseq = models.CharField(max_length=200, verbose_name='{{request.col_step}}SEQ')
    descript = models.CharField(max_length=200, verbose_name='{{request.process_selection}}명')
    recipeid = models.CharField(max_length=200, verbose_name='Recipe ID')
    areaname = models.CharField(max_length=50, verbose_name='영역명')
    eqptype = models.CharField(max_length=50, verbose_name='장비 타입')
    layerid = models.CharField(max_length=200, blank=True, verbose_name='레이어 ID')
    updated = models.CharField(max_length=50, blank=True, verbose_name='업데이트')
    last_synced = models.DateTimeField(auto_now=True, verbose_name='동기화 시각')

    class Meta:
        verbose_name = 'line3 {{request.col_step}} 정보'
        verbose_name_plural = 'line3 {{request.col_step}} 정보 목록'
        indexes = [
            models.Index(fields=['processid'], name='api_pstep_line3_processid_idx'),
            models.Index(fields=['processid', 'eqptype'], name='api_pstep_line3_prcid_eqp_idx'),
        ]

    def __str__(self):
        return f"line3 / {self.processid} / {self.stepseq} / {self.descript} / {self.eqptype}"


class PhotoStepS4(models.Model):
    """line4 라인 {{request.col_step}} 정보 (스케줄러 동기화)"""
    processid = models.CharField(max_length=200, verbose_name='{{request.process_id}} ID')
    stepseq = models.CharField(max_length=200, verbose_name='{{request.col_step}}SEQ')
    descript = models.CharField(max_length=200, verbose_name='{{request.process_selection}}명')
    recipeid = models.CharField(max_length=200, verbose_name='Recipe ID')
    areaname = models.CharField(max_length=50, verbose_name='영역명')
    eqptype = models.CharField(max_length=50, verbose_name='장비 타입')
    layerid = models.CharField(max_length=200, blank=True, verbose_name='레이어 ID')
    updated = models.CharField(max_length=50, blank=True, verbose_name='업데이트')
    last_synced = models.DateTimeField(auto_now=True, verbose_name='동기화 시각')

    class Meta:
        verbose_name = 'line4 {{request.col_step}} 정보'
        verbose_name_plural = 'line4 {{request.col_step}} 정보 목록'
        indexes = [
            models.Index(fields=['processid'], name='api_pstep_line4_processid_idx'),
            models.Index(fields=['processid', 'eqptype'], name='api_pstep_line4_prcid_eqp_idx'),
        ]

    def __str__(self):
        return f"line4 / {self.processid} / {self.stepseq} / {self.descript} / {self.eqptype}"


class PhotoStepS5(models.Model):
    """line5 라인 {{request.col_step}} 정보 (스케줄러 동기화)"""
    processid = models.CharField(max_length=200, verbose_name='{{request.process_id}} ID')
    stepseq = models.CharField(max_length=200, verbose_name='{{request.col_step}}SEQ')
    descript = models.CharField(max_length=200, verbose_name='{{request.process_selection}}명')
    recipeid = models.CharField(max_length=200, verbose_name='Recipe ID')
    areaname = models.CharField(max_length=50, verbose_name='영역명')
    eqptype = models.CharField(max_length=50, verbose_name='장비 타입')
    layerid = models.CharField(max_length=200, blank=True, verbose_name='레이어 ID')
    updated = models.CharField(max_length=50, blank=True, verbose_name='업데이트')
    last_synced = models.DateTimeField(auto_now=True, verbose_name='동기화 시각')

    class Meta:
        verbose_name = 'line5 {{request.col_step}} 정보'
        verbose_name_plural = 'line5 {{request.col_step}} 정보 목록'
        indexes = [
            models.Index(fields=['processid'], name='api_pstep_line5_processid_idx'),
            models.Index(fields=['processid', 'eqptype'], name='api_pstep_line5_prcid_eqp_idx'),
        ]

    def __str__(self):
        return f"line5 / {self.processid} / {self.stepseq} / {self.descript} / {self.eqptype}"




class VocHistory(models.Model):
    """VOC 처리 이력 - 프론트엔드 VocHistory 타입과 1:1 매핑"""

    ACTION_CHOICES = [
        ('checking', '확인중'),
        ('completed', '완료'),
        ('rejected', '거부'),
    ]

    voc = models.ForeignKey(
        VOC, on_delete=models.CASCADE,
        related_name='histories', verbose_name='VOC'
    )
    action = models.CharField(
        max_length=20, choices=ACTION_CHOICES, default='checking', verbose_name='처리 결과'
    )
    acted_at = models.DateTimeField(auto_now_add=True, verbose_name='처리일시')
    comment = models.TextField(blank=True, verbose_name='의견')
    assignee = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='assigned_voc_histories', verbose_name='담당자'
    )
    assignee_name = models.CharField(max_length=100, blank=True, verbose_name='담당자 이름')

    class Meta:
        verbose_name = 'VOC 처리 이력'
        verbose_name_plural = 'VOC 처리 이력 목록'
        ordering = ['-acted_at']
        indexes = [
            models.Index(fields=['voc'], name='api_vochist_voc_idx'),
            models.Index(fields=['action'], name='api_vochist_action_idx'),
        ]

    def __str__(self):
        return f"VOC #{self.voc.id} - {self.action} ({self.acted_at})"
