from rest_framework import serializers
from django.contrib.auth import get_user_model
from .models import RequestDocument, ApprovalStep, VOC, VocComment, Line, AdminNotice, VocHistory, Guide, UserGroup, AddressBook
from . import doc_permissions

User = get_user_model()


class DocPermFieldsMixin(serializers.Serializer):
    """RequestDocument 직렬화에 현재 요청자 기준 권한 플래그를 추가한다.
    프론트가 수정/철회 버튼을 정확히(그룹 멤버 포함) 노출하기 위해 사용한다."""
    can_edit = serializers.SerializerMethodField()
    can_withdraw = serializers.SerializerMethodField()
    can_request_pause = serializers.SerializerMethodField()
    can_resume = serializers.SerializerMethodField()
    pause_request = serializers.SerializerMethodField()
    post_approver_fixed_loginid = serializers.SerializerMethodField()
    requester_loginid = serializers.SerializerMethodField()

    def _perm_user(self):
        request = self.context.get('request')
        return getattr(request, 'user', None) if request else None

    def _co_member_ids(self):
        # 목록 직렬화 시 호출자 그룹 동료를 1회만 계산해 문서별 쿼리를 피한다.
        cached = getattr(self, '_cached_co_ids', None)
        if cached is None:
            user = self._perm_user()
            cached = doc_permissions.co_member_ids_for(user) if user else set()
            self._cached_co_ids = cached
        return cached

    def get_requester_loginid(self, obj):
        return obj.requester.loginid if obj.requester_id else None

    def get_can_edit(self, obj):
        user = self._perm_user()
        return bool(user and doc_permissions.can_edit(user, obj, self._co_member_ids()))

    def get_can_withdraw(self, obj):
        user = self._perm_user()
        return bool(user and doc_permissions.can_withdraw(user, obj, self._co_member_ids()))

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


class UserSerializer(serializers.ModelSerializer):
    name = serializers.CharField(source='username', allow_blank=True, required=False)

    class Meta:
        model = User
        fields = ['id', 'loginid', 'name', 'mail', 'role', 'deptname', 'role_assigned_at']
        read_only_fields = ['role_assigned_at']

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


class RequestDocumentSerializer(DocPermFieldsMixin, serializers.ModelSerializer):
    approval_steps = ApprovalStepSerializer(many=True, read_only=True)
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
            'can_request_pause', 'can_resume', 'pause_request', 'post_approver_fixed_loginid',
        ]
        read_only_fields = ['status', 'created_at', 'updated_at', 'submitted_at',
                            'designated_pl_loginid', 'designated_pl_name']

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

    class Meta:
        model = RequestDocument
        fields = [
            'id', 'title', 'requester_name', 'requester_department',
            'product_name', 'status', 'production_date', 'created_at', 'submitted_at',
            'additional_notes', 'designated_pl_loginid', 'designated_pl_name', 'approval_steps',
            'requester_loginid', 'can_edit', 'can_withdraw',
            'can_request_pause', 'can_resume', 'pause_request', 'post_approver_fixed_loginid',
        ]

    def get_designated_pl_loginid(self, obj):
        return obj.designated_pl.loginid if obj.designated_pl else None


class VocCommentSerializer(serializers.ModelSerializer):
    class Meta:
        model = VocComment
        fields = ['id', 'voc', 'author_name', 'author_role', 'author_email', 'is_submitter', 'content', 'is_reject_reason', 'created_at']
        read_only_fields = ['id', 'created_at', 'author_email']


class VOCSerializer(serializers.ModelSerializer):
    comments = VocCommentSerializer(many=True, read_only=True)

    class Meta:
        model = VOC
        fields = '__all__'
        read_only_fields = ['created_at', 'responded_at', 'status']


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

    - 읽기: members 를 현재 UserProfile 과 join 해 최신 name·mail·has_mail 을 함께 내려준다.
      (실존하지 않는 loginid 는 자동 제외 → 발송 시 유령 대상 방지, has_mail=false 는 프론트 경고용.)
    - 쓰기: members_input 으로 [{loginid, name}] 을 받아 실존 사용자만 정규화해 저장한다.
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
        loginids = [m.get('loginid') for m in raw if isinstance(m, dict) and m.get('loginid')]
        users = {u.loginid: u for u in User.objects.filter(loginid__in=loginids)}
        result, seen = [], set()
        for lid in loginids:
            u = users.get(lid)
            if not u or lid in seen:
                continue
            seen.add(lid)
            result.append({
                'loginid': u.loginid,
                'name': u.username,
                'mail': u.mail or '',
                'has_mail': bool(u.mail),
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
        """실존 사용자만 남기고 중복 제거, name 은 현재 표시이름으로 정규화."""
        import json
        loginids = [m.get('loginid') for m in members_input if isinstance(m, dict) and m.get('loginid')]
        users = {u.loginid: u for u in User.objects.filter(loginid__in=loginids)}
        norm, seen = [], set()
        for m in members_input:
            lid = m.get('loginid') if isinstance(m, dict) else None
            if not lid or lid in seen or lid not in users:
                continue
            seen.add(lid)
            norm.append({'loginid': lid, 'name': users[lid].username})
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
