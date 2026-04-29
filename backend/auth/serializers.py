"""
Auth app serializers for authentication-related operations.
"""
from rest_framework import serializers
from django.contrib.auth import get_user_model

User = get_user_model()


class UserSerializer(serializers.ModelSerializer):
    """사용자 시리얼라이저 (auth_user 기반)"""
    loginid = serializers.CharField(source='username', read_only=True)
    name = serializers.CharField(source='display_name', allow_blank=True, required=False)
    # auth_user 에 직접 추가된 필드 (Django ORM 이 인식하지 못하므로 명시적 정의)
    role = serializers.CharField(max_length=10, required=False)
    department = serializers.CharField(max_length=200, required=False, allow_blank=True)
    
    class Meta:
        model = User
        fields = ['id', 'loginid', 'name', 'email', 'role', 'department']
    
    def create(self, validated_data):
        # login_id 로 사용자 조회 또는 생성
        loginid = self.context.get('loginid')
        if not loginid:
            raise serializers.ValidationError({'loginid': 'loginid is required'})
        
        user, created = User.objects.get_or_create(
            username=loginid,
            defaults={
                'email': '',
                'is_active': True,
                'role': validated_data.get('role', 'NONE'),
                'department': validated_data.get('department', ''),
                'display_name': validated_data.get('name', ''),
            }
        )
        
        if not created:
            # 기존 사용자 업데이트
            user.role = validated_data.get('role', user.role)
            user.department = validated_data.get('department', user.department)
            if validated_data.get('name'):
                user.display_name = validated_data.get('name')
            user.save()
        
        return user
    
    def to_representation(self, instance):
        """User 인스턴스를 딕셔너리로 변환 (role, department, display_name 포함)"""
        ret = super().to_representation(instance)
        # Django ORM 이 role 필드를 인식하지 못하므로 DB 에서 직접 읽기
        from django.db import connection
        with connection.cursor() as cursor:
            cursor.execute(
                'SELECT role, department, display_name FROM auth_user WHERE id = %s',
                [instance.id]
            )
            row = cursor.fetchone()
            if row:
                ret['role'] = row[0] or 'NONE'
                ret['department'] = row[1] or ''
                ret['name'] = row[2] or instance.username
        return ret
