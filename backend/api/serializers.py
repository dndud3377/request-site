from rest_framework import serializers
from django.contrib.auth import get_user_model
from .models import (
    RequestDocument, ApprovalStep, VOC, VocComment, Line, AdminNotice, VocHistory, Guide, UserGroup, AddressBook,
    ProcessDesignRuleOverride, DocumentDesignRuleOverride, DocumentReviewItem, DocumentReviewItemReviewer,
    RejectionSnapshot, ADDRESS_BOOK_MAIL_DOMAIN,
)
from . import doc_permissions
from . import design_rule_stats

User = get_user_model()


class DocPermFieldsMixin(serializers.Serializer):
    """RequestDocument 직렬화에 현재 요청자 기준 권한 플래그를 추가한다.
    프론트가 수정/철회 버튼을 정확히(그룹 멤버 포함) 노출하기 위해 사용한다."""
    can_edit = serializers.SerializerMethodField()
    can_withdraw = serializers.SerializerMethodField()
    can_request_pause = serializers.SerializerMethodField()
    can_resume = serializers.SerializerMethodField()
    pause_request = serializers.SerializerMethodField()
    withdraw_request = serializers.SerializerMethodField()
    post_approver_fixed_loginid = serializers.SerializerMethodField()
    requester_loginid = serializers.SerializerMethodField()
    shared_group_name = serializers.CharField(source='shared_group.name', read_only=True, default=None)

    def _perm_user(self):
        request = self.context.get('request')
        return getattr(request, 'user', None) if request else None

    def _my_group_ids(self):
        # 목록 직렬화 시 호출자가 속한 그룹 id 를 1회만 계산해 문서별 쿼리를 피한다.
        cached = getattr(self, '_cached_group_ids', None)
        if cached is None:
            user = self._perm_user()
            cached = doc_permissions.my_group_ids_for(user) if user else set()
            self._cached_group_ids = cached
        return cached

    def get_requester_loginid(self, obj):
        return obj.requester.loginid if obj.requester_id else None

    def get_can_edit(self, obj):
        user = self._perm_user()
        return bool(user and doc_permissions.can_edit(user, obj, self._my_group_ids()))

    def get_can_withdraw(self, obj):
        user = self._perm_user()
        return bool(user and doc_permissions.can_withdraw(user, obj, self._my_group_ids()))

    def get_can_request_pause(self, obj):
        user = self._perm_user()
        return bool(user and doc_permissions.can_request_pause(user, obj))

    def get_can_resume(self, obj):
        user = self._perm_user()
        return bool(user and doc_permissions.can_resume(user, obj))

    def get_post_approver_fixed_loginid(self, obj):
        """고정 후결자(.env) loginid — 프론트가 '🔒 고정' 표시·변경 잠금에 사용."""
        from django.conf import settings
        return (getattr(settings, 'POST_APPROVER_LOGINID', '') or '').strip() or None

    def get_pause_request(self, obj):
        """활성(요청/확정) 중단 요청 정보. 없으면 None.

        프론트가 중단 요청 배너·확인 현황·재개 버튼을 렌더하는 데 사용한다.
        """
        pr = next(
            (p for p in obj.pause_requests.all() if p.state in ('requested', 'confirmed')),
            None,
        )
        if not pr:
            return None
        return {
            'id': pr.id,
            'state': pr.state,
            'reason': pr.reason,
            'requester_loginid': pr.requester.loginid if pr.requester_id else None,
            'requester_name': pr.requester_name,
            'round': pr.round,
            'target_step_ids': pr.target_step_ids or [],
            'confirmed_step_ids': pr.confirmed_step_ids or [],
            'created_at': pr.created_at,
        }

    def get_withdraw_request(self, obj):
        """확인 대기(requested) 중인 철회 요청 정보. 없으면 None.

        프론트가 철회 요청 배너·확인 현황·확인/거부/취소 버튼을 렌더하는 데 사용한다.
        거부·취소된 요청은 결재가 그대로 이어지므로 내려보내지 않는다.
        """
        wr = next(
            (w for w in obj.withdraw_requests.all() if w.state == 'requested'),
            None,
        )
        if not wr:
            return None
        return {
            'id': wr.id,
            'state': wr.state,
            'reason': wr.reason,
            'requester_loginid': wr.requester.loginid if wr.requester_id else None,
            'requester_name': wr.requester_name,
            'round': wr.round,
            'target_step_ids': wr.target_step_ids or [],
            'confirmed_step_ids': wr.confirmed_step_ids or [],
            'created_at': wr.created_at,
        }


class UserSerializer(serializers.ModelSerializer):
    name = serializers.CharField(source='username', allow_blank=True, required=False)
    # 라인별 메일 수신 설정(권한 관리 '이메일 설정' 컬럼). 라인 '이름' 배열로 내려준다.
    # 변경은 이 직렬화기가 아니라 전용 엔드포인트(users/{id}/mail-lines/)로만 한다.
    mail_lines = serializers.SlugRelatedField(
        many=True, read_only=True, slug_field='name',
    )

    class Meta:
        model = User
        fields = [
            'id', 'loginid', 'name', 'mail', 'role', 'deptname', 'role_assigned_at',
            'receive_all_mail', 'mail_lines', 'receive_voc_mail',
        ]
        read_only_fields = ['role_assigned_at', 'receive_all_mail', 'mail_lines', 'receive_voc_mail']

    def create(self, validated_data):
        loginid = self.context.get('loginid')
        if not loginid:
            raise serializers.ValidationError({'loginid': 'loginid is required'})

        user, created = User.objects.get_or_create(
            loginid=loginid,
            defaults={
                'mail': '',
                'role': validated_data.get('role', 'NONE'),
                'deptname': validated_data.get('deptname', ''),
                'username': validated_data.get('username', ''),
            }
        )

        if not created:
            user.role = validated_data.get('role', user.role)
            user.deptname = validated_data.get('deptname', user.deptname)
            if validated_data.get('username'):
                user.username = validated_data.get('username')
            user.save()

        return user


class ApprovalStepSerializer(serializers.ModelSerializer):
    assignee_loginid = serializers.SerializerMethodField()
    assignee_mail = serializers.SerializerMethodField()

    class Meta:
        model = ApprovalStep
        fields = ['id', 'agent', 'action', 'acted_at', 'comment', 'is_parallel', 'assignee_loginid', 'assignee_name', 'assignee_mail', 'round', 'created_at', 'due_date']

    def get_assignee_loginid(self, obj):
        return obj.assignee.loginid if obj.assignee else None

    def get_assignee_mail(self, obj):
        return obj.assignee.mail if obj.assignee else None


class DocumentReviewItemReviewerSerializer(serializers.ModelSerializer):
    """검토 항목의 검토자 1명. 결재선(ApprovalStep)과 무관하므로 결재 경로에는 쓰이지 않는다."""

    class Meta:
        model = DocumentReviewItemReviewer
        fields = ['id', 'loginid', 'name', 'confirmed', 'confirmed_at']


class DocumentReviewItemSerializer(serializers.ModelSerializer):
    reviewers = DocumentReviewItemReviewerSerializer(many=True, read_only=True)
    is_done = serializers.BooleanField(read_only=True)

    class Meta:
        model = DocumentReviewItem
        fields = ['id', 'title', 'reviewers', 'is_done', 'created_at']


class RequestDocumentSerializer(DocPermFieldsMixin, serializers.ModelSerializer):
    approval_steps = ApprovalStepSerializer(many=True, read_only=True)
    review_items = DocumentReviewItemSerializer(many=True, read_only=True)
    designated_pl_loginid = serializers.SerializerMethodField()
    notifier_mails = serializers.SerializerMethodField()

    class Meta:
        model = RequestDocument
        fields = [
            'id', 'title', 'requester_name', 'requester_email', 'requester_department',
            'product_name', 'reference_materials', 'additional_notes',
            'status', 'production_date', 'created_at', 'updated_at', 'submitted_at',
            'designated_pl_loginid', 'designated_pl_name', 'approval_steps',
            'requester_loginid', 'can_edit', 'can_withdraw', 'notifier_mails',
            'can_request_pause', 'can_resume', 'pause_request', 'withdraw_request',
            'post_approver_fixed_loginid',
            'shared_group', 'shared_group_name', 'review_items',
        ]
        # shared_group 은 전체 저장(PUT/PATCH)에 값이 빠져 초기화되는 일이 없도록 read-only 로 두고,
        # 변경은 전용 액션 POST documents/{id}/set-shared-group/ 으로만 한다.
        read_only_fields = ['status', 'created_at', 'updated_at', 'submitted_at',
                            'designated_pl_loginid', 'designated_pl_name', 'shared_group']

    def get_designated_pl_loginid(self, obj):
        return obj.designated_pl.loginid if obj.designated_pl else None

    def get_notifier_mails(self, obj):
        """통보처(detail.notifiers) loginid → mail 매핑. 결재 경로 탭에서 이름 옆 이메일 표시용."""
        import json
        try:
            data = json.loads(obj.additional_notes or '{}')
            notifiers = (data.get('detail') or {}).get('notifiers') or []
            loginids = [n.get('loginid') for n in notifiers if n.get('loginid')]
            if not loginids:
                return {}
            users = User.objects.filter(loginid__in=loginids).values('loginid', 'mail')
            return {u['loginid']: u['mail'] for u in users}
        except Exception:
            return {}

    def update(self, instance, validated_data):
        # 의뢰자 표시 정보는 최초 작성자로 고정한다.
        # 검토자(지정 PL)의 수정 후 재상신 등 업데이트 시 의뢰자가 바뀌지 않도록 차단.
        for field in ('requester_name', 'requester_email', 'requester_department'):
            validated_data.pop(field, None)
        return super().update(instance, validated_data)


class RequestDocumentListSerializer(DocPermFieldsMixin, serializers.ModelSerializer):
    approval_steps = ApprovalStepSerializer(many=True, read_only=True)
    designated_pl_loginid = serializers.SerializerMethodField()
    my_pending_review_items = serializers.SerializerMethodField()

    class Meta:
        model = RequestDocument
        fields = [
            'id', 'title', 'requester_name', 'requester_department',
            'product_name', 'status', 'production_date', 'created_at', 'submitted_at',
            'additional_notes', 'designated_pl_loginid', 'designated_pl_name', 'approval_steps',
            'requester_loginid', 'can_edit', 'can_withdraw',
            'can_request_pause', 'can_resume', 'pause_request', 'withdraw_request',
            'post_approver_fixed_loginid',
            'shared_group', 'shared_group_name', 'my_pending_review_items',
        ]
        read_only_fields = ['shared_group']

    def get_designated_pl_loginid(self, obj):
        return obj.designated_pl.loginid if obj.designated_pl else None

    def get_my_pending_review_items(self, obj):
        """호출자가 검토자로 지정됐지만 아직 확인하지 않은 검토 항목 수.

        결재 현황 MY 탭 노출 조건에 쓰인다(목록에 항목 전체를 실어 보내지 않기 위해
        개수만 준다). 문서 상태·J 단계 조건은 프론트가 approval_steps 로 함께 본다.
        """
        loginid = getattr(self._perm_user(), 'loginid', '')
        if not loginid:
            return 0
        return sum(
            1 for item in obj.review_items.all()
            if any(r.loginid == loginid and not r.confirmed for r in item.reviewers.all())
        )


class DynamicFieldsSerializerMixin:
    """생성 시 `fields`(문자열 이터러블)를 넘기면 그 필드만 남기고 나머지는 제거한다.

    `fields` 를 넘기지 않으면(None) 기존과 동일하게 Meta.fields 전체를 반환한다
    (하위 호환 유지 — 호출자가 옵트인할 때만 응답 필드를 축소).
    """

    def __init__(self, *args, **kwargs):
        requested_fields = kwargs.pop('fields', None)
        super().__init__(*args, **kwargs)
        if requested_fields is not None:
            allowed = set(requested_fields)
            for field_name in set(self.fields) - allowed:
                self.fields.pop(field_name)


class ExternalRequestDocumentSerializer(DynamicFieldsSerializerMixin, serializers.ModelSerializer):
    """외부 API Key 인증 전용 조회(read-only) serializer.

    additional_notes(위저드 상세 JSON) 포함 전체 필드를 노출한다. 로그인 사용자
    컨텍스트에 의존하는 권한 플래그(can_edit/can_withdraw 등, DocPermFieldsMixin)는
    외부 요청에는 의미가 없으므로 포함하지 않는다.

    `fields` 쿼리파라미터(뷰에서 전달)로 응답 필드를 호출자가 선택할 수 있다.
    """
    approval_steps = ApprovalStepSerializer(many=True, read_only=True)
    requester_loginid = serializers.SerializerMethodField()
    designated_pl_loginid = serializers.SerializerMethodField()

    class Meta:
        model = RequestDocument
        fields = [
            'id', 'title', 'requester_name', 'requester_email', 'requester_department',
            'requester_loginid', 'product_name', 'reference_materials', 'additional_notes',
            'status', 'production_date', 'created_at', 'updated_at', 'submitted_at',
            'designated_pl_loginid', 'designated_pl_name', 'approval_steps',
        ]
        read_only_fields = fields

    def get_requester_loginid(self, obj):
        return obj.requester.loginid if obj.requester_id else None

    def get_designated_pl_loginid(self, obj):
        return obj.designated_pl.loginid if obj.designated_pl else None


class VocCommentSerializer(serializers.ModelSerializer):
    class Meta:
        model = VocComment
        fields = ['id', 'voc', 'author_name', 'author_role', 'author_email', 'is_submitter', 'content', 'created_at']
        read_only_fields = ['id', 'created_at', 'author_email']


class VOCSerializer(serializers.ModelSerializer):
    comments = VocCommentSerializer(many=True, read_only=True)
    # 프론트는 이 값으로 "내 VOC" 를 판정한다 — id 가 아니라 loginid 로 비교해야
    # 개발 모드의 목 사용자 id 와 DB id 가 어긋나도 판정이 어긋나지 않는다.
    submitter_loginid = serializers.SerializerMethodField()

    class Meta:
        model = VOC
        fields = '__all__'
        # submitter 는 등록 시 서버가 request.user 로 확정한다(VOCViewSet.perform_create).
        read_only_fields = ['created_at', 'responded_at', 'status', 'submitter']

    def get_submitter_loginid(self, obj):
        return obj.submitter.loginid if obj.submitter_id else ''


class LineSerializer(serializers.ModelSerializer):
    class Meta:
        model = Line
        fields = ['id', 'name', 'order']


class AdminNoticeSerializer(serializers.ModelSerializer):
    class Meta:
        model = AdminNotice
        fields = ['id', 'template', 'date', 'title', 'content', 'items',
                  'created_at', 'updated_at']
        read_only_fields = ['id', 'created_at', 'updated_at']


class VocHistorySerializer(serializers.ModelSerializer):
    assignee_id = serializers.SerializerMethodField()

    class Meta:
        model = VocHistory
        fields = ['id', 'voc', 'action', 'acted_at', 'comment', 'assignee_id', 'assignee_name']

    def get_assignee_id(self, obj):
        return obj.assignee_id


class GuideSerializer(serializers.ModelSerializer):
    class Meta:
        model = Guide
        fields = ['id', 'guide_type', 'feature_key', 'title', 'content', 'author_name', 'author_role', 'created_at', 'updated_at']
        read_only_fields = ['id', 'created_at', 'updated_at', 'author_name', 'author_role']


class UserGroupMemberSerializer(serializers.ModelSerializer):
    name = serializers.CharField(source='username', read_only=True)

    class Meta:
        model = User
        fields = ['id', 'loginid', 'name', 'mail', 'deptname', 'role']
        read_only_fields = ['id', 'loginid', 'name', 'mail', 'deptname', 'role']


class UserGroupSerializer(serializers.ModelSerializer):
    creator_loginid = serializers.CharField(source='creator.loginid', read_only=True)
    members         = UserGroupMemberSerializer(many=True, read_only=True)

    class Meta:
        model  = UserGroup
        fields = ['id', 'name', 'creator_loginid', 'members', 'created_at']
        read_only_fields = ['id', 'creator_loginid', 'members', 'created_at']

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('그룹 이름을 입력해주세요.')
        request = self.context.get('request')
        if request:
            qs = UserGroup.objects.filter(creator=request.user, name=value)
            if self.instance:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError('같은 이름의 그룹이 이미 존재합니다.')
        return value


class AddressBookSerializer(serializers.ModelSerializer):
    """주소록 직렬화.

    - 읽기: 저장된 members(loginid, name)를 그대로 신뢰해 내려준다. 로컬 User 테이블과
      대조하지 않는다 — 실존 여부 판정 기준이 사이트 가입 여부가 아니라 외부 검증(추가
      시점의 resolve_employee_by_loginid, views.py AddressBookViewSet.add_members)이기
      때문이다. mail 은 조회하지 않고 loginid 로 규칙 생성한다(ADDRESS_BOOK_MAIL_DOMAIN).
    - 쓰기: members_input 은 rename/구성원 삭제 흐름에서만 쓰이며 중복 제거만 한다
      (실존 검증은 하지 않음 — 검증은 add_members 액션에서 "신규" loginid 에만 1회 수행).
    """
    members       = serializers.SerializerMethodField()
    members_input = serializers.ListField(child=serializers.DictField(), write_only=True, required=False)
    member_count  = serializers.SerializerMethodField()

    class Meta:
        model  = AddressBook
        fields = ['id', 'name', 'members', 'members_input', 'member_count', 'created_at', 'updated_at']
        read_only_fields = ['id', 'created_at', 'updated_at']

    def _enriched(self, obj):
        raw = obj.get_members()
        result, seen = [], set()
        for m in raw:
            if not isinstance(m, dict):
                continue
            lid = m.get('loginid')
            if not lid or lid in seen:
                continue
            seen.add(lid)
            result.append({
                'loginid': lid,
                'name': m.get('name') or lid,
                'mail': f'{lid}@{ADDRESS_BOOK_MAIL_DOMAIN}',
                'has_mail': True,
            })
        return result

    def get_members(self, obj):
        return self._enriched(obj)

    def get_member_count(self, obj):
        return len(self._enriched(obj))

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('주소록 이름을 입력해주세요.')
        request = self.context.get('request')
        if request:
            qs = AddressBook.objects.filter(owner=request.user, name=value)
            if self.instance:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError('같은 이름의 주소록이 이미 존재합니다.')
        return value

    def _normalize_members(self, members_input):
        """중복만 제거해 그대로 저장한다. 실존 검증은 하지 않는다(AddressBookViewSet.add_members 전용)."""
        import json
        norm, seen = [], set()
        for m in members_input:
            lid = m.get('loginid') if isinstance(m, dict) else None
            if not lid or lid in seen:
                continue
            seen.add(lid)
            norm.append({'loginid': lid, 'name': (m.get('name') or lid)})
        return json.dumps(norm, ensure_ascii=False)

    def create(self, validated_data):
        members_input = validated_data.pop('members_input', [])
        validated_data['owner'] = self.context['request'].user
        validated_data['members'] = self._normalize_members(members_input)
        return super().create(validated_data)

    def update(self, instance, validated_data):
        members_input = validated_data.pop('members_input', None)
        if members_input is not None:
            instance.members = self._normalize_members(members_input)
        return super().update(instance, validated_data)


class ProcessDesignRuleOverrideSerializer(serializers.ModelSerializer):
    """{{request.process_selection}} 단위 디자인룰 수동 매핑 (MASTER 전용)."""

    # unique 제약의 기본 UniqueValidator 를 끈다 — create() 의 upsert 가 돌기 전에
    # 400 을 내버려 '다시 지정'이 막히기 때문. 중복은 update_or_create 가 처리한다.
    process = serializers.CharField(max_length=200, validators=[])
    created_by_name = serializers.CharField(source='created_by.username', read_only=True, default='')
    design_rule_label = serializers.SerializerMethodField()

    class Meta:
        model = ProcessDesignRuleOverride
        fields = ['id', 'process', 'design_rule', 'design_rule_label',
                  'created_by_name', 'created_at', 'updated_at']
        read_only_fields = ['created_by_name', 'created_at', 'updated_at']

    def get_design_rule_label(self, obj):
        """차트와 동일한 나노 표시. 숫자가 아니면 원본 값을 그대로 보여준다."""
        return design_rule_stats._to_nano_label(obj.design_rule) or obj.design_rule

    def validate_process(self, value):
        value = (value or '').strip()
        if not value:
            raise serializers.ValidationError('조합법을 입력해주세요.')
        return value

    def validate_design_rule(self, value):
        value = (value or '').strip()
        if not value:
            raise serializers.ValidationError('디자인룰을 입력해주세요.')
        return value

    def create(self, validated_data):
        """같은 조합법이 이미 있으면 새로 만들지 않고 디자인룰만 교체한다.

        `process` 가 unique 라 재등록 시 400 이 나는데, 분류 모달에서는
        '다시 지정'이 자연스러운 조작이므로 upsert 로 처리한다.
        """
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        obj, _created = ProcessDesignRuleOverride.objects.update_or_create(
            process=validated_data['process'],
            defaults={
                'design_rule': validated_data['design_rule'],
                'created_by': user if getattr(user, 'is_authenticated', False) else None,
            },
        )
        return obj


class DocumentDesignRuleOverrideSerializer(serializers.ModelSerializer):
    """의뢰서 단위 디자인룰 수동 매핑 (MASTER 전용). 조합법 매핑보다 우선한다."""

    # OneToOne 기본 UniqueValidator 를 끈다 — 위와 같은 이유로 재지정을 허용한다.
    document = serializers.PrimaryKeyRelatedField(
        queryset=RequestDocument.objects.all(), validators=[]
    )
    document_title = serializers.CharField(source='document.title', read_only=True, default='')
    created_by_name = serializers.CharField(source='created_by.username', read_only=True, default='')
    design_rule_label = serializers.SerializerMethodField()

    class Meta:
        model = DocumentDesignRuleOverride
        fields = ['id', 'document', 'document_title', 'design_rule', 'design_rule_label',
                  'created_by_name', 'created_at', 'updated_at']
        read_only_fields = ['document_title', 'created_by_name', 'created_at', 'updated_at']

    def get_design_rule_label(self, obj):
        """차트와 동일한 나노 표시. 숫자가 아니면 원본 값을 그대로 보여준다."""
        return design_rule_stats._to_nano_label(obj.design_rule) or obj.design_rule

    def validate_design_rule(self, value):
        value = (value or '').strip()
        if not value:
            raise serializers.ValidationError('디자인룰을 입력해주세요.')
        return value

    def create(self, validated_data):
        """의뢰서당 1건(OneToOne)이므로 재지정은 교체로 처리한다."""
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        obj, _created = DocumentDesignRuleOverride.objects.update_or_create(
            document=validated_data['document'],
            defaults={
                'design_rule': validated_data['design_rule'],
                'created_by': user if getattr(user, 'is_authenticated', False) else None,
            },
        )
        return obj


class RejectionSnapshotSerializer(serializers.ModelSerializer):
    """반려 이력 1건. 프론트 RejectionSnapshot 타입과 1:1 매핑.

    approval_steps 는 DB 에 JSON 문자열로 보관하지만, 프론트가 문서 응답과 똑같이
    다룰 수 있도록 배열로 풀어서 내려준다(문자열이 깨져 있으면 빈 배열).
    """

    approval_steps = serializers.SerializerMethodField()

    class Meta:
        model = RejectionSnapshot
        fields = [
            'id', 'source_document_id', 'title', 'product_name',
            'requester_name', 'requester_department', 'requester_loginid',
            'submitted_at', 'additional_notes', 'approval_steps',
            'round', 'rejected_at', 'rejected_agent',
            'rejected_by_name', 'rejected_by_loginid', 'reject_comment',
        ]

    def get_approval_steps(self, obj):
        import json
        try:
            steps = json.loads(obj.approval_steps or '[]')
        except (json.JSONDecodeError, TypeError):
            return []
        return steps if isinstance(steps, list) else []
