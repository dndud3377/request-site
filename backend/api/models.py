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

    # 라인별 메일 수신 설정(mail_lines)을 적용받는 역할. PL·NONE 은 설정 대상이 아니며
    # 라인과 무관하게 기존대로 메일을 받는다(권한 관리 화면에서도 칸을 그리지 않는다).
    MAIL_LINE_FILTER_ROLES = ('TE_R', 'TE_P', 'TE_J', 'TE_O', 'TE_E', 'MASTER')
    loginid  = models.CharField(max_length=150, unique=True, verbose_name='로그인 ID')
    mail     = models.EmailField(blank=True, default='', verbose_name='이메일')
    username = models.CharField(max_length=150, blank=True, default='', verbose_name='표시 이름')
    deptname = models.CharField(max_length=200, blank=True, default='', verbose_name='부서명')
    role     = models.CharField(max_length=10, choices=ROLE_CHOICES, default='NONE', verbose_name='역할')
    # 역할이 마지막으로 배정된 시각(권한 관리에서 '최근 추가순' 정렬용). NONE→역할 배정 시 갱신.
    role_assigned_at = models.DateTimeField(null=True, blank=True, verbose_name='역할 배정 시각')
    # 의뢰서 메일을 받을 라인 목록(권한 관리 '이메일 설정' 컬럼).
    # 의뢰서의 detail.line 이 여기 없으면 그 사람에게는 메일을 보내지 않는다(mailer._filter_by_mail_lines).
    # ⚠️ 빈 집합은 '미설정'이 아니라 '본인이 전부 껐다 = 메일 0통'을 뜻한다.
    #    그래서 사용자 생성 시점에 항상 활성 라인 전체를 채워 넣는다(assign_default_mail_lines).
    mail_lines = models.ManyToManyField(
        'Line', blank=True, related_name='subscribers', verbose_name='메일 수신 라인'
    )
    # password, last_login → AbstractBaseUser 자동 포함

    USERNAME_FIELD = 'loginid'
    REQUIRED_FIELDS = []
    objects = UserProfileManager()

    class Meta:
        verbose_name = '사용자'
        verbose_name_plural = '사용자 목록'

    def __str__(self):
        return f"{self.loginid} ({self.username})"

    def uses_mail_line_filter(self):
        """이 사용자의 메일에 라인 수신 설정을 적용해야 하는가."""
        return self.role in self.MAIL_LINE_FILTER_ROLES


User = get_user_model()


class RequestDocument(models.Model):
    """의뢰서 모델 - 프론트엔드 RequestDocument 타입과 1:1 매핑"""

    STATUS_CHOICES = [
        ('draft', '임시저장'),
        ('submitted', '상신됨'),
        ('under_review', '검토중'),
        ('pause', '중단'),
        ('approved', '승인됨'),
        ('rejected', '반려됨'),
    ]

    # 요청 목적 'Only MAP' 값 (결재 경로를 R 단계까지만 진행)
    ONLY_MAP_PURPOSE = 'Only MAP'

    # 요청 목적 'MAP 삭제/수정' 값 (PL 합의 후 P·R·J·O 를 병렬로 진행)
    # 프론트엔드 `RequestPage/constants.ts` 의 MAP_DELETE_EDIT_PURPOSE 와 같은 값이어야 한다.
    MAP_DELETE_EDIT_PURPOSE = 'MAP 삭제/수정'

    # 기타 목적 '연구소 제품' — C가문과 마찬가지로 상신 시 후결자 지정이 필수다.
    OTHER_PURPOSE_LAB = '연구소 제품'

    # J-layer 행의 pp 에 이 키워드가 있으면 E(MASK) 단계가 결재 경로에 포함된다(대소문자 무관).
    # 프론트엔드 `RequestPage/constants.ts` 의 VALIDATION_KEYWORD 와 같은 값이어야 한다.
    VALIDATION_KEYWORD = 'plel'

    title = models.CharField(max_length=600, verbose_name='의뢰서 제목')
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
    designated_pl = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='designated_reviews', verbose_name='지정 PL'
    )
    designated_pl_name = models.CharField(max_length=100, blank=True, verbose_name='지정 PL 이름')
    # 임시저장(draft) 공유 대상 그룹. 작성자가 자기가 속한 그룹 중 **하나**를 지정한다.
    # null 이면 아무에게도 공유하지 않는다(작성자 본인과 MASTER 만 조회 가능).
    # 그룹이 삭제되면 SET_NULL 로 공유가 끊기고 문서 자체는 남는다.
    shared_group = models.ForeignKey(
        'UserGroup', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='shared_documents', verbose_name='임시저장 공유 그룹'
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

    def is_only_map(self):
        """요청 목적이 'Only MAP' 인지 여부.

        Only MAP 의뢰서는 결재 경로를 R 단계까지만 진행하고, R 합의 시 바로 승인된다.
        request_purpose 는 additional_notes JSON 의 `detail` 하위에 저장된다.
        """
        inner_detail = self.get_detail().get('detail', {})
        return inner_detail.get('request_purpose') == self.ONLY_MAP_PURPOSE

    def is_map_delete_edit(self):
        """요청 목적이 'MAP 삭제/수정' 인지 여부.

        이 의뢰서는 MAP 의 수정/삭제 이유만 담으므로 결재 경로가 다르다 —
        PL 합의 직후 P·R·J·O 를 병렬로 만들고, 네 단계 전원 합의 시 승인한다.
        E(MASK)와 후결자(RA)는 생성하지 않는다(고정 후결자도 붙지 않는 유일한 경로).
        """
        inner_detail = self.get_detail().get('detail', {})
        return inner_detail.get('request_purpose') == self.MAP_DELETE_EDIT_PURPOSE

    def requires_post_approver(self):
        """상신 시 후결자 지정이 필수인가 — C가문(only_prodc=YES) 또는 기타 목적 '연구소 제품'.

        결재 경로·후결자 생성 로직은 그대로이고 '필수 판정 조건'만 넓힌 것이다.
        프론트엔드의 requiresPostApprover 와 같은 기준이어야 한다.
        """
        inner_detail = self.get_detail().get('detail', {}) or {}
        if inner_detail.get('only_prodc') == 'Yes':
            return True
        other = inner_detail.get('other_purpose') or []
        if isinstance(other, str):
            other = [other]
        return self.OTHER_PURPOSE_LAB in other

    def has_ppid_plel(self):
        """J-layer 행의 pp 중 하나라도 판정 키워드(plel)를 포함하는지 여부.

        참이면 E(MASK) 단계가 결재 경로에 포함된다 — MASK 팀이 Validation System
        대상/비대상 판정이 맞는지 검증한다. 거짓이면(키워드가 아예 없으면) 판정
        자체가 성립하지 않으므로('해당없음') E 단계를 생성하지 않는다.
        jayerRows 는 additional_notes JSON 최상위에 저장되며, 상신 시 비활성
        (disabled) 행은 저장에서 제외되므로 여기서 따로 거르지 않는다.
        """
        jayer_rows = self.get_detail().get('jayerRows', [])
        for row in jayer_rows:
            pp = row.get('pp', '') or ''
            if self.VALIDATION_KEYWORD in pp.lower():
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
        ('PL', '검토'),
        ('R', '{{agent_R}}'),      # RFG 담당자
        ('RV', '검토자'),           # RFG 검토자(담당자 다음, 선택)
        ('P', '{{agent_P}}'),
        ('PV', '검토자'),           # P 검토자(담당자가 지정, 다중 가능)
        ('J', '{{agent_J}}'),
        ('O', '{{agent_O}}'),
        ('E', '{{agent_E}}'),
        ('EV', '검토자'),           # E 검토자(담당자가 지정, 다중 가능)
        ('RA', '후결자'),           # 후결자(R단계 이후 병렬)
    ]

    ACTION_CHOICES = [
        ('pending', '대기'),
        ('approved', '합의'),
        ('rejected', '반려'),
        # (2026-08 이전) EV(2차 검토자)가 1명만 합의해도 단계가 끝나던 시절(OR)엔 남은 EV를
        # 이 값으로 닫았다. 지금은 EV도 전원 합의(AND)로 바뀌어 새로 생기지 않지만, 그 시절
        # 문서의 이력(누가 지정됐고 왜 판단하지 않았는지)을 보존하기 위해 선택지는 유지한다.
        ('skip', '건너뜀'),
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


class PauseRequest(models.Model):
    """결재 중단(PAUSE) 요청.

    작성자가 진행 중(under_review) 결재에 대해 중단을 요청하면 생성되고,
    요청 시점의 현재(pending) 결재 단계 팀이 '전원' 확인하면 문서 상태가 pause 로 전이된다.
    작성자가 수정 후 재개(resume)하면 멈춘 단계부터 결재가 이어진다.

    한 문서에 활성 요청(state=requested/confirmed)은 1건만 존재한다.
    확인 현황은 target_step_ids(요청 시점 pending 단계 id) 대비 confirmed_step_ids 로 추적한다.
    """

    STATE_CHOICES = [
        ('requested', '요청됨'),      # 확인 대기 (문서는 아직 under_review)
        ('confirmed', '중단됨'),      # 전원 확인 → 문서 pause
        ('cancelled', '취소됨'),      # 결재 진행/작성자 취소로 무효화
        ('resumed', '재개됨'),        # 작성자가 재개
    ]

    document = models.ForeignKey(
        RequestDocument, on_delete=models.CASCADE,
        related_name='pause_requests', verbose_name='의뢰서'
    )
    requester = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='pause_requests', verbose_name='요청자'
    )
    requester_name = models.CharField(max_length=100, blank=True, verbose_name='요청자 이름')
    reason = models.TextField(verbose_name='중단 사유')
    round = models.PositiveSmallIntegerField(default=1, verbose_name='요청 회차')
    state = models.CharField(
        max_length=10, choices=STATE_CHOICES, default='requested', verbose_name='상태'
    )
    # 요청 시점의 현재(pending) 결재 단계 id 목록 — 이 단계 팀 전원이 확인해야 PAUSE 확정
    target_step_ids = models.JSONField(default=list, verbose_name='대상 단계 id')
    # '중단 확인'을 누른 단계 id 목록
    confirmed_step_ids = models.JSONField(default=list, verbose_name='확인된 단계 id')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='요청일시')
    confirmed_at = models.DateTimeField(null=True, blank=True, verbose_name='중단 확정일시')

    class Meta:
        verbose_name = '중단 요청'
        verbose_name_plural = '중단 요청 목록'
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.document.title} - 중단({self.state})"

    def is_active(self):
        """확인 대기 또는 중단 확정 상태(진행 중인 요청)."""
        return self.state in ('requested', 'confirmed')


class WithdrawRequest(models.Model):
    """의뢰서 철회 요청.

    진행 중(under_review/submitted) 의뢰서의 철회는 즉시 처리되지 않는다. 의뢰자가 사유와
    함께 철회를 요청하면 생성되고, 요청 시점의 현재(pending) 결재 단계가 '전원' 확인해야
    철회가 확정된다. 확정되는 순간 **의뢰서가 완전히 삭제**된다(복구 불가).

    확인 대기(requested) 동안에는 결재가 동결되며, 이 구간에서만 요청자가 취소(cancelled)할
    수 있다. 대상 단계가 거부(rejected)하면 요청이 무효화되고 결재가 그대로 이어진다.

    한 문서에 활성 요청(state=requested)은 1건만 존재한다. 확인 현황은
    target_step_ids(요청 시점 pending 단계 id) 대비 confirmed_step_ids 로 추적한다.

    ⚠️ 철회가 확정되면 문서가 삭제되므로 이 레코드도 CASCADE 로 함께 사라진다 —
    'confirmed' 상태는 저장되지 않으며, 철회 이력은 서버 로그(`[WITHDRAW_DOCUMENT]`)에만
    남는다(2026-08 결정: 이력 보존 불필요).
    """

    STATE_CHOICES = [
        ('requested', '요청됨'),      # 확인 대기 (결재 동결)
        ('rejected', '거부됨'),       # 대상 단계가 거부 → 결재 계속
        ('cancelled', '취소됨'),      # 요청자가 취소 → 결재 계속
    ]

    document = models.ForeignKey(
        RequestDocument, on_delete=models.CASCADE,
        related_name='withdraw_requests', verbose_name='의뢰서'
    )
    requester = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='withdraw_requests', verbose_name='요청자'
    )
    requester_name = models.CharField(max_length=100, blank=True, verbose_name='요청자 이름')
    reason = models.TextField(verbose_name='철회 사유')
    round = models.PositiveSmallIntegerField(default=1, verbose_name='요청 회차')
    state = models.CharField(
        max_length=10, choices=STATE_CHOICES, default='requested', verbose_name='상태'
    )
    # 요청 시점의 현재(pending) 결재 단계 id 목록 — 이 단계 전원이 확인해야 철회 확정
    target_step_ids = models.JSONField(default=list, verbose_name='대상 단계 id')
    # '철회 확인'을 누른 단계 id 목록
    confirmed_step_ids = models.JSONField(default=list, verbose_name='확인된 단계 id')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='요청일시')
    resolved_at = models.DateTimeField(null=True, blank=True, verbose_name='거부·취소일시')

    class Meta:
        verbose_name = '철회 요청'
        verbose_name_plural = '철회 요청 목록'
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.document.title} - 철회({self.state})"

    def is_active(self):
        """확인 대기 상태(결재가 동결된 진행 중 요청)."""
        return self.state == 'requested'


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


def assign_default_mail_lines(user):
    """새로 만들어진 사용자에게 활성 라인 전체를 메일 수신 라인으로 채운다.

    빈 집합은 '본인이 전부 껐다 = 메일 0통'을 뜻하므로(UserProfile.mail_lines 주석),
    '아직 설정하지 않은 사용자'가 빈 집합으로 남지 않도록 생성 시점에 기본값을 준다.
    이미 설정이 있는 사용자는 건드리지 않는다.
    """
    if user.mail_lines.exists():
        return
    user.mail_lines.set(Line.objects.filter(is_active=True))


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


class DesignRule(models.Model):
    """외부 DB 에서 매일 1회 동기화되는 공정-디자인룰 캐시"""
    process = models.CharField(max_length=200, verbose_name='공정')
    design_rule = models.CharField(max_length=200, verbose_name='디자인룰')
    last_synced = models.DateTimeField(auto_now=True, verbose_name='동기화 시각')

    class Meta:
        verbose_name = '공정-디자인룰 캐시'
        verbose_name_plural = '공정-디자인룰 캐시 목록'
        indexes = [models.Index(fields=['process'], name='api_designrule_process_idx')]

    def __str__(self):
        return f"{self.process} / {self.design_rule}"


class ProcessDesignRuleOverride(models.Model):
    """{{request.process_selection}} 단위 디자인룰 수동 매핑 (MASTER 전용).

    `DesignRule` 마스터에 없거나 서로 다른 디자인룰 2개 이상에 걸려 판정이 모호한
    {{request.process_selection}} 을 MASTER 가 직접 하나의 디자인룰로 확정한다.
    한 번 등록하면 같은 {{request.process_selection}} 을 쓴 과거·미래 의뢰서에 모두 적용된다.

    ⚠️ 스케줄러(`sync_design_rule`)는 `api_designrule` 을 DELETE 후 재적재하므로,
    수동 매핑은 반드시 이 별도 테이블에 보관해야 동기화 후에도 살아남는다.
    """
    process = models.CharField(
        max_length=200, unique=True, verbose_name='{{request.process_selection}}'
    )
    design_rule = models.CharField(max_length=200, verbose_name='디자인룰')
    created_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='process_design_rule_overrides', verbose_name='등록자'
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='등록일시')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='수정일시')

    class Meta:
        verbose_name = '{{request.process_selection}}-디자인룰 수동 매핑'
        verbose_name_plural = '{{request.process_selection}}-디자인룰 수동 매핑 목록'
        ordering = ['process']

    def __str__(self):
        return f"{self.process} → {self.design_rule}"


class DocumentDesignRuleOverride(models.Model):
    """의뢰서 단위 디자인룰 수동 매핑 (MASTER 전용).

    {{request.process_selection}} 단위 매핑으로 정리되지 않는 예외 의뢰서를 하나씩 지정한다.
    판정 우선순위상 `ProcessDesignRuleOverride` 보다 **우선**한다
    (상세는 docs/HOME_STATS.md 참조).
    """
    document = models.OneToOneField(
        RequestDocument, on_delete=models.CASCADE,
        related_name='design_rule_override', verbose_name='의뢰서'
    )
    design_rule = models.CharField(max_length=200, verbose_name='디자인룰')
    created_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='document_design_rule_overrides', verbose_name='등록자'
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='등록일시')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='수정일시')

    class Meta:
        verbose_name = '의뢰서-디자인룰 수동 매핑'
        verbose_name_plural = '의뢰서-디자인룰 수동 매핑 목록'
        ordering = ['-updated_at']

    def __str__(self):
        return f"[{self.document_id}] → {self.design_rule}"


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
    ]

    title = models.CharField(max_length=200, verbose_name='제목')
    category = models.CharField(max_length=20, choices=CATEGORY_CHOICES, verbose_name='유형')
    # 제출자 식별은 의뢰서(RequestDocument.requester)와 동일한 방식을 따른다 —
    # FK 를 진실의 원천으로 두고 등록 시 서버가 request.user 로 확정하며(views.VOCViewSet),
    # 본인 판정은 id 가 아니라 loginid 로 한다(doc_permissions.is_voc_submitter).
    submitter = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='vocs', verbose_name='제출자'
    )
    submitter_name = models.CharField(max_length=100, verbose_name='제출자')
    submitter_email = models.EmailField(verbose_name='이메일')
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
    author_email = models.EmailField(blank=True, default='', verbose_name='작성자 이메일')
    is_submitter = models.BooleanField(default=False, verbose_name='제출자 여부')
    content = models.TextField(verbose_name='내용')
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




class MapName(models.Model):
    """외부 DB 에서 1시간마다 동기화되는 라인별 partid 캐시"""
    lineid = models.CharField(max_length=50, verbose_name='라인 ID')
    partid = models.CharField(max_length=200, verbose_name='Part ID')
    last_synced = models.DateTimeField(auto_now=True, verbose_name='동기화 시각')

    class Meta:
        verbose_name = 'MAP 이름 캐시'
        verbose_name_plural = 'MAP 이름 캐시 목록'
        indexes = [
            models.Index(fields=['lineid'], name='api_mapname_lineid_idx'),
        ]

    def __str__(self):
        return f"{self.lineid} / {self.partid}"


class ProductBarcode(models.Model):
    """외부 DB 에서 1시간마다 동기화되는 바코드-품목 캐시"""
    n7mto_date = models.CharField(max_length=200, null=True, blank=True, verbose_name='MTO Date')
    n7cancel_date = models.CharField(max_length=200, null=True, blank=True, verbose_name='Cancel Date')
    n7cancel_ok = models.CharField(max_length=200, null=True, blank=True, verbose_name='Cancel OK')
    n7c_layer_num = models.CharField(max_length=200, verbose_name='Layer Num')
    n7prod_code = models.CharField(max_length=200, verbose_name='Product Code')
    n7barcode = models.CharField(max_length=200, verbose_name='Barcode')
    n7material_spec = models.CharField(max_length=500, null=True, blank=True, verbose_name='Material Spec')
    last_synced = models.DateTimeField(auto_now=True, verbose_name='동기화 시각')

    class Meta:
        verbose_name = '바코드-품목 캐시'
        verbose_name_plural = '바코드-품목 캐시 목록'

    def __str__(self):
        return f"{self.n7prod_code} / {self.n7mto_date} / {self.n7c_layer_num}"


class UserGroup(models.Model):
    """나만의 그룹 — 같은 역할 사용자 묶음 (멤버만 조회·관리 가능).

    쓰임새는 두 가지다. 그룹 자체가 메일 발송 대상이 되지는 **않는다**.
    - 상신 모달의 통보처: 그룹을 골라 멤버 전원을 통보처(detail.notifiers)에 한 번에 추가
    - 임시저장 공유: 작성자가 문서마다 그룹 1개를 지정하면(RequestDocument.shared_group)
      그 그룹 멤버만 해당 draft 를 조회·수정·상신할 수 있다
    """
    name       = models.CharField(max_length=100, verbose_name='그룹 이름')
    creator    = models.ForeignKey(
        'UserProfile', on_delete=models.CASCADE,
        related_name='created_groups', verbose_name='생성자'
    )
    members    = models.ManyToManyField(
        'UserProfile', related_name='member_groups',
        blank=True, verbose_name='그룹 멤버'
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='생성일')

    class Meta:
        unique_together = ('creator', 'name')
        verbose_name = '나만의 그룹'
        verbose_name_plural = '나만의 그룹 목록'
        ordering = ['-created_at']

    def __str__(self):
        return f"[{self.creator.loginid}] {self.name}"


class AddressBook(models.Model):
    """주소록 — 통보처로 자주 쓰는 사람 묶음을 이름 붙여 저장(본인 전용).

    상신 모달에서 '통보처 불러오기'로 members 를 detail.notifiers 에 채워넣는다.
    members 는 통보처(detail.notifiers)와 동일한 [{loginid, name}] 포맷의 JSON 문자열로
    저장해, 발송 로직(resolve_notifier_recipients)이 그대로 재사용되도록 한다.
    """
    owner      = models.ForeignKey(
        'UserProfile', on_delete=models.CASCADE,
        related_name='address_books', verbose_name='소유자'
    )
    name       = models.CharField(max_length=100, verbose_name='주소록 이름')
    members    = models.TextField(
        default='[]', blank=True,
        verbose_name='구성원 목록(JSON: [{loginid, name}])'
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='생성일')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='수정일')

    class Meta:
        unique_together = ('owner', 'name')
        verbose_name = '주소록'
        verbose_name_plural = '주소록 목록'
        ordering = ['-updated_at']

    def __str__(self):
        return f"[{self.owner.loginid}] {self.name}"

    def get_members(self):
        """members JSON 을 파싱해 [{loginid, name}] 리스트로 반환. 손상 시 빈 리스트."""
        import json
        try:
            data = json.loads(self.members or '[]')
            return data if isinstance(data, list) else []
        except (ValueError, TypeError):
            return []


class MailNotification(models.Model):
    """결재 알림 메일 발송 큐 (영속 outbox)

    각 결재 전이 시점에 행을 적재(enqueue)하고, APScheduler 잡
    `process_mail_queue` 가 주기적으로 DXHUB 메일 API 로 발송한다.
    발송 실패 시 `attempts` 를 누적하며 `max_attempts` 회까지 재시도한다.
    DB 에 영속되므로 서버 재시작에도 재시도 상태가 보존된다.
    """

    EVENT_CHOICES = [
        ('stage_arrival', '단계 도착'),
        ('rejected', '반려'),
        ('approved', '승인 완료'),
        ('notify_submitted', '상신 통보(통보처)'),
        ('notify_approved', '결재 완료 통보(통보처)'),
        # 철회 (2026-08) — event_type 은 max_length=20 이므로 아래 키 길이를 넘기지 않는다.
        ('withdraw_requested', '철회 요청'),
        ('withdraw_completed', '철회 완료'),
        ('withdraw_rejected', '철회 거부'),
        ('withdraw_cancelled', '철회 요청 취소'),
        ('voc_created', 'VOC 등록'),
        ('voc_comment', 'VOC 댓글'),
    ]

    STATUS_CHOICES = [
        ('pending', '대기'),
        ('sent', '발송 완료'),
        ('failed', '발송 실패'),
    ]

    document = models.ForeignKey(
        RequestDocument, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='mail_notifications', verbose_name='의뢰서'
    )
    event_type = models.CharField(
        max_length=20, choices=EVENT_CHOICES, verbose_name='이벤트 유형'
    )
    recipients = models.JSONField(default=list, verbose_name='수신자 이메일 목록')
    subject = models.CharField(max_length=500, verbose_name='제목')
    contents = models.TextField(verbose_name='본문(HTML)')
    status = models.CharField(
        max_length=10, choices=STATUS_CHOICES, default='pending', verbose_name='상태'
    )
    attempts = models.PositiveSmallIntegerField(default=0, verbose_name='시도 횟수')
    max_attempts = models.PositiveSmallIntegerField(default=5, verbose_name='최대 시도 횟수')
    last_error = models.TextField(blank=True, verbose_name='마지막 에러')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='적재일시')
    sent_at = models.DateTimeField(null=True, blank=True, verbose_name='발송일시')

    class Meta:
        verbose_name = '결재 알림 메일'
        verbose_name_plural = '결재 알림 메일 목록'
        ordering = ['created_at']
        indexes = [
            models.Index(fields=['status'], name='api_mailnoti_status_idx'),
        ]

    def __str__(self):
        return f"[{self.status}] {self.event_type} → {self.recipients}"


class VocHistory(models.Model):
    """VOC 처리 이력 - 프론트엔드 VocHistory 타입과 1:1 매핑"""

    ACTION_CHOICES = [
        ('checking', '확인중'),
        ('completed', '완료'),
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


class ReviewItemMaster(models.Model):
    """{{agent_J}} 검토 항목 마스터 목록 — 전역 1개, 상신 시 문서로 복사되는 원본.

    - 문서 상세에서 항목을 추가·수정·삭제하면 이 마스터에도 그대로 반영된다.
    - 삭제는 행을 지우지 않고 is_active=False 로 남긴다. 이미 복사돼 검토가 진행된
      문서 사본(DocumentReviewItem)이 어느 마스터 항목에서 왔는지를 잃지 않기 위해서다.
    - 검토자는 마스터에 두지 않는다. 상속되는 것은 **제목뿐**이며 검토자는 문서마다
      새로 지정한다.
    """

    title = models.CharField(max_length=300, verbose_name='항목 제목')
    is_active = models.BooleanField(default=True, verbose_name='활성 여부')
    created_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='created_review_items', verbose_name='최초 등록자'
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='생성일시')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='수정일시')

    class Meta:
        verbose_name = '검토 항목 마스터'
        verbose_name_plural = '검토 항목 마스터 목록'
        ordering = ['id']

    def __str__(self):
        return f"{'' if self.is_active else '[삭제] '}{self.title}"


class DocumentReviewItem(models.Model):
    """의뢰서에 복사된 검토 항목 (마스터 항목 1건의 문서별 사본).

    상신·재상신 시 마스터의 활성 항목이 여기로 복사되고, 그 뒤 결재가 진행 중인
    동안에는 마스터 변경(추가·제목 수정·삭제)이 이 사본에도 전파된다. 결재가 끝난
    문서는 전파 대상에서 빠져 그 시점 목록으로 굳는다.

    title 을 마스터와 따로 갖는 이유: 전파 대상에서 빠진 문서가 이후 마스터 제목이
    바뀌어도 자기 시점의 제목을 그대로 보존해야 하기 때문이다.
    """

    document = models.ForeignKey(
        RequestDocument, on_delete=models.CASCADE,
        related_name='review_items', verbose_name='의뢰서'
    )
    master = models.ForeignKey(
        ReviewItemMaster, on_delete=models.CASCADE,
        related_name='copies', verbose_name='마스터 항목'
    )
    title = models.CharField(max_length=300, verbose_name='항목 제목(사본)')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='생성일시')

    class Meta:
        unique_together = ('document', 'master')
        verbose_name = '의뢰서 검토 항목'
        verbose_name_plural = '의뢰서 검토 항목 목록'
        ordering = ['id']

    def __str__(self):
        return f"{self.document.title} - {self.title}"

    def is_done(self):
        """검토자가 1명 이상이고 전원이 확인했는가."""
        reviewers = list(self.reviewers.all())
        return bool(reviewers) and all(r.confirmed for r in reviewers)


class DocumentReviewItemReviewer(models.Model):
    """검토 항목별 검토자와 확인 상태.

    - {{agent_J}} 권한자가 항목마다 지정한다. 결재선(ApprovalStep)에는 나타나지 않으므로
      결재 경로·상태 배지에는 영향을 주지 않는다.
    - 확인(confirmed)한 검토자는 지정 해제할 수 없다(기록 보존).
    - 재상신 시 지정은 남기고 confirmed 만 초기화한다.
    """

    item = models.ForeignKey(
        DocumentReviewItem, on_delete=models.CASCADE,
        related_name='reviewers', verbose_name='검토 항목'
    )
    user = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='review_item_assignments', verbose_name='검토자'
    )
    # 사용자 계정이 지워져도 누가 검토자였는지는 남겨야 하므로 표시값을 함께 저장한다.
    loginid = models.CharField(max_length=150, verbose_name='검토자 로그인 ID')
    name = models.CharField(max_length=100, blank=True, verbose_name='검토자 이름')
    confirmed = models.BooleanField(default=False, verbose_name='확인 여부')
    confirmed_at = models.DateTimeField(null=True, blank=True, verbose_name='확인일시')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='지정일시')

    class Meta:
        unique_together = ('item', 'loginid')
        verbose_name = '검토 항목 검토자'
        verbose_name_plural = '검토 항목 검토자 목록'
        ordering = ['id']

    def __str__(self):
        return f"{self.item.title} - {self.loginid}{' ✓' if self.confirmed else ''}"


class RejectionSnapshot(models.Model):
    """반려 시점의 의뢰서를 통째로 얼려 보관하는 이력.

    반려는 문서의 status 만 rejected 로 바꾸고, 재상신하면 같은 레코드가 under_review 로
    되돌아간다. 그래서 문서만으로는 "언제 무슨 내용으로 반려됐는지"가 남지 않는다.
    이 모델은 반려가 일어나는 순간의 폼 내용(additional_notes)과 결재 단계(approval_steps)를
    복사해 두어, 이후 재상신·승인으로 문서가 바뀌어도 그 시점을 그대로 다시 볼 수 있게 한다.

    - 회차마다 1행씩 쌓인다(3번 반려 = 3행).
    - 원본 문서가 삭제돼도 이력은 남긴다(document 는 SET_NULL, source_document_id 로 추적).
    - {{agent_E}}(MASK)의 '수정 요청'은 문서 status 를 바꾸지 않는 별개 동작이라 여기에 쌓이지 않는다.
    """

    document = models.ForeignKey(
        RequestDocument, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='rejection_snapshots', verbose_name='의뢰서'
    )
    # 문서가 삭제돼 document 링크가 끊긴 뒤에도 어떤 문서였는지 추적하기 위한 원본 id.
    source_document_id = models.IntegerField(verbose_name='원본 의뢰서 ID')

    # ===== 목록 표시용 복사본 (문서가 바뀌거나 삭제돼도 반려 당시 값을 유지한다) =====
    title = models.CharField(max_length=600, verbose_name='의뢰서 제목')
    product_name = models.CharField(max_length=200, verbose_name='{{request.partid_selection}}')
    requester_name = models.CharField(max_length=100, verbose_name='의뢰자 이름')
    requester_department = models.CharField(max_length=100, blank=True, verbose_name='부서')
    requester_loginid = models.CharField(max_length=150, blank=True, verbose_name='의뢰자 로그인 ID')
    submitted_at = models.DateTimeField(null=True, blank=True, verbose_name='상신일')

    # ===== 상세 재현용 스냅샷 =====
    # 반려 시점 상세 폼·표 전체 JSON (RequestDocument.additional_notes 원문 복사)
    additional_notes = models.TextField(blank=True, verbose_name='상세 정보(JSON)')
    # 반려 시점 결재 단계 전체 JSON 배열 (ApprovalStepSerializer 와 같은 형태)
    approval_steps = models.TextField(blank=True, verbose_name='결재 단계(JSON)')

    # ===== 반려 메타 =====
    round = models.PositiveSmallIntegerField(default=1, verbose_name='반려된 회차')
    rejected_at = models.DateTimeField(verbose_name='반려일시')
    rejected_agent = models.CharField(max_length=2, blank=True, verbose_name='반려 단계')
    rejected_by_name = models.CharField(max_length=100, blank=True, verbose_name='반려자 이름')
    rejected_by_loginid = models.CharField(max_length=150, blank=True, verbose_name='반려자 로그인 ID')
    reject_comment = models.TextField(blank=True, verbose_name='반려 사유')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='적재일시')

    class Meta:
        verbose_name = '반려 이력'
        verbose_name_plural = '반려 이력 목록'
        ordering = ['-rejected_at', '-id']
        indexes = [
            models.Index(fields=['-rejected_at']),
            models.Index(fields=['source_document_id']),
        ]

    def __str__(self):
        return f"[반려 {self.round}회차] {self.title}"

    def get_detail(self):
        """additional_notes JSON 파싱 (RequestDocument.get_detail 과 동일 규약)"""
        try:
            return json.loads(self.additional_notes or '{}')
        except (json.JSONDecodeError, TypeError):
            return {}
