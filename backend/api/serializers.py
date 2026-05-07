from rest_framework import serializers
from django.contrib.auth import get_user_model
from .models import RequestDocument, ApprovalStep, VOC, VocComment, Line, AdminNotice, VocHistory

User = get_user_model()


class UserSerializer(serializers.ModelSerializer):
    name = serializers.CharField(source='username', allow_blank=True, required=False)

    class Meta:
        model = User
        fields = ['id', 'loginid', 'name', 'mail', 'role', 'deptname']

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
    assignee_id = serializers.SerializerMethodField()

    class Meta:
        model = ApprovalStep
        fields = ['id', 'agent', 'action', 'acted_at', 'comment', 'is_parallel', 'assignee_id', 'assignee_name']

    def get_assignee_id(self, obj):
        return obj.assignee_id


class RequestDocumentSerializer(serializers.ModelSerializer):
    approval_steps = ApprovalStepSerializer(many=True, read_only=True)

    class Meta:
        model = RequestDocument
        fields = [
            'id', 'title', 'requester_name', 'requester_email', 'requester_department',
            'product_name', 'reference_materials', 'additional_notes',
            'status', 'created_at', 'updated_at', 'submitted_at', 'approval_steps',
        ]
        read_only_fields = ['status', 'created_at', 'updated_at', 'submitted_at']


class RequestDocumentListSerializer(serializers.ModelSerializer):
    approval_steps = ApprovalStepSerializer(many=True, read_only=True)

    class Meta:
        model = RequestDocument
        fields = [
            'id', 'title', 'requester_name', 'requester_department',
            'product_name', 'status', 'created_at', 'submitted_at', 'additional_notes', 'approval_steps',
        ]


class VocCommentSerializer(serializers.ModelSerializer):
    class Meta:
        model = VocComment
        fields = ['id', 'voc', 'author_name', 'author_role', 'is_submitter', 'content', 'is_reject_reason', 'created_at']
        read_only_fields = ['id', 'created_at']


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
