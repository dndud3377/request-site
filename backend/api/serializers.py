from rest_framework import serializers
from .models import RequestDocument, ApprovalStep, VOC, RFG


class ApprovalStepSerializer(serializers.ModelSerializer):
    class Meta:
        model = ApprovalStep
        fields = '__all__'
        read_only_fields = ['document']


class RequestDocumentSerializer(serializers.ModelSerializer):
    approval_steps = ApprovalStepSerializer(many=True, read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    product_type_display = serializers.CharField(source='get_product_type_display', read_only=True)
    map_type_display = serializers.CharField(source='get_map_type_display', read_only=True)

    class Meta:
        model = RequestDocument
        fields = '__all__'
        read_only_fields = ['created_at', 'updated_at', 'submitted_at', 'status']


class RequestDocumentListSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    product_type_display = serializers.CharField(source='get_product_type_display', read_only=True)

    class Meta:
        model = RequestDocument
        fields = [
            'id', 'title', 'requester_name', 'requester_department',
            'product_name', 'product_type', 'product_type_display',
            'status', 'status_display', 'priority',
            'created_at', 'submitted_at', 'deadline'
        ]


class VOCSerializer(serializers.ModelSerializer):
    category_display = serializers.CharField(source='get_category_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)

    class Meta:
        model = VOC
        fields = '__all__'
        read_only_fields = ['created_at', 'responded_at', 'status']


class RFGSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source='get_status_display', read_only=True)

    class Meta:
        model = RFG
        fields = '__all__'
        read_only_fields = ['created_at', 'status']
