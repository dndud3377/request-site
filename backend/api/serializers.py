from rest_framework import serializers
from .models import RequestDocument, ApprovalStep, VOC, Line


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
    class Meta:
        model = RequestDocument
        fields = [
            'id', 'title', 'requester_name', 'requester_department',
            'product_name', 'status', 'created_at', 'submitted_at',
        ]


class VOCSerializer(serializers.ModelSerializer):
    class Meta:
        model = VOC
        fields = '__all__'
        read_only_fields = ['created_at', 'responded_at', 'status']


class LineSerializer(serializers.ModelSerializer):
    class Meta:
        model = Line
        fields = ['id', 'name', 'order']
