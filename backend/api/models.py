"""
⚠️ MASKING 처리된 파일

이 파일에 포함된 비즈니스 용어는 {{ko.json}} 키로 마스킹되어 있습니다.
원래 용어를 확인하려면 다음 파일을 참조하세요:
- frontend/src/locales/ko.json
"""
import json
from django.db import models
from django.contrib.auth import get_user_model
from django.contrib.auth.models import AbstractBaseUser, BaseUserManager


class UserProfileManager(BaseUserManager):
    def create_user(self, loginid, password=None, **extra_fields):
        if not loginid:
            raise ValueError('loginid는 필수입니다.')
        user = self.model(loginid=loginid, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, loginid, password=None, **extra_fields):
        return self.create_user(loginid, password, **extra_fields)


class UserProfile(AbstractBaseUser):
    ROLE_CHOICES = [
        ('NONE', 'NONE'), ('PL', 'PL'), ('TE_R', 'TE_R'), ('TE_P', 'TE_P'),
        ('TE_J', 'TE_J'), ('TE_O', 'TE_O'), ('TE_E', 'TE_E'), ('MASTER', 'MASTER'),
    ]
    loginid  = models.CharField(max_length=150, unique=True, verbose_name='로그인 ID')
    mail     = models.EmailField(blank=True, default='', verbose_name='이메일')
    username = models.CharField(max_length=150, blank=True, default='', verbose_name='표시 이름')
    deptname = models.CharField(max_length=200, blank=True, default='', verbose_name='부서명')
    role     = models.CharField(max_length=10, choices=ROLE_CHOICES, default='NONE', verbose_name='역할')
    # password, last_login → AbstractBaseUser 자동 포함

    USERNAME_FIELD = 'loginid'
    REQUIRED_FIELDS = []
    objects = UserProfileManager()

    class Meta:
        verbose_name = '사용자'
        verbose_name_plural = '사용자 목록'

    def __str__(self):
        return f"{self.loginid} ({self.username})"


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
    production_date = models.DateField(null=True, blank=True, verbose_name='실제 생산 진행 날짜')
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


class Holiday(models.Model):
    """대한민국 공휴일 캐시 (스케줄러 동기화)"""
    date_name = models.CharField(max_length=100, verbose_name='공휴일명')
    isholiday = models.CharField(max_length=1, verbose_name='공휴일 여부')
    act_date = models.DateField(unique=True, verbose_name='날짜')

    class Meta:
        verbose_name = '공휴일'
        verbose_name_plural = '공휴일 목록'
        indexes = [models.Index(fields=['act_date'], name='api_holiday_act_date_idx')]

    def __str__(self):
        return f"{self.act_date} ({self.date_name})"


class ApprovalStep(models.Model):
    """결재 단계 - 프론트엔드 ApprovalStepFrontend 타입과 1:1 매핑"""

    AGENT_CHOICES = [
        ('R', '{{agent_R}}'),
        ('P', '{{agent_P}}'),
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
    round = models.PositiveSmallIntegerField(default=1, verbose_name='상신 회차')
    created_at = models.DateTimeField(auto_now_add=True, null=True, blank=True, verbose_name='생성일시')
    due_date = models.DateField(null=True, blank=True, verbose_name='완료 기한')

    class Meta:
        verbose_name = '결재 단계'
        verbose_name_plural = '결재 단계 목록'
        ordering = ['round', 'id']

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
    submitter_user_id = models.IntegerField(null=True, blank=True, verbose_name='제출자 ID')
    page = models.CharField(max_length=20, blank=True, default='', verbose_name='관련 페이지')
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


class VocComment(models.Model):
    """VOC 댓글"""
    voc = models.ForeignKey(VOC, on_delete=models.CASCADE, related_name='comments', verbose_name='VOC')
    author_name = models.CharField(max_length=100, verbose_name='작성자')
    author_role = models.CharField(max_length=20, verbose_name='역할')
    is_submitter = models.BooleanField(default=False, verbose_name='제출자 여부')
    content = models.TextField(verbose_name='내용')
    is_reject_reason = models.BooleanField(default=False, verbose_name='반려 사유 여부')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='작성일시')

    class Meta:
        verbose_name = 'VOC 댓글'
        verbose_name_plural = 'VOC 댓글 목록'
        ordering = ['created_at']

    def __str__(self):
        return f"[{self.voc_id}] {self.author_name}: {self.content[:30]}"


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

class Guide(models.Model):
    """의뢰서 작성 가이드"""

    GUIDE_TYPE_CHOICES = [
        ('feature', '기능 가이드'),
        ('info', '정보 가이드'),
    ]

    guide_type = models.CharField(max_length=10, choices=GUIDE_TYPE_CHOICES, default='info', verbose_name='가이드 유형')
    feature_key = models.CharField(max_length=100, null=True, blank=True, unique=True, verbose_name='기능 키')
    title = models.CharField(max_length=200, verbose_name='제목')
    content = models.TextField(verbose_name='내용 (HTML)')
    author_name = models.CharField(max_length=100, verbose_name='작성자 이름')
    author_role = models.CharField(max_length=20, verbose_name='작성자 역할')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='작성일')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='수정일')

    class Meta:
        verbose_name = '가이드'
        verbose_name_plural = '가이드 목록'
        ordering = ['-created_at']

    def __str__(self):
        return f"[{self.guide_type}] {self.title}"


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




class ProductBarcode(models.Model):
    """외부 DB 에서 1시간마다 동기화되는 바코드-품목 캐시"""
    n7mto_date = models.CharField(max_length=200, null=True, blank=True, verbose_name='MTO Date')
    n7cancel_date = models.CharField(max_length=200, null=True, blank=True, verbose_name='Cancel Date')
    n7cancel_ok = models.CharField(max_length=200, null=True, blank=True, verbose_name='Cancel OK')
    n7c_layer_num = models.CharField(max_length=200, verbose_name='Layer Num')
    n7prod_code = models.CharField(max_length=200, verbose_name='Product Code')
    n7barcode = models.CharField(max_length=200, verbose_name='Barcode')
    last_synced = models.DateTimeField(auto_now=True, verbose_name='동기화 시각')

    class Meta:
        verbose_name = '바코드-품목 캐시'
        verbose_name_plural = '바코드-품목 캐시 목록'

    def __str__(self):
        return f"{self.n7prod_code} / {self.n7mto_date} / {self.n7c_layer_num}"


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
