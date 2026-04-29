"""
Development User Switching Middleware.
개발 환경에서 HTTP 헤더 (X-Dev-User) 로 사용자를 전환하며 테스트
"""
from django.conf import settings
from django.contrib.auth import get_user_model
from django.utils.deprecation import MiddlewareMixin
import logging

logger = logging.getLogger(__name__)
User = get_user_model()


class DevUserMiddleware(MiddlewareMixin):
    """
    개발용 유저 전환 미들웨어
    
    사용법:
    - 프론트엔드가 요청 헤더에 X-Dev-User 추가
    - 예: X-Dev-User: RM
    - 미들웨어가 해당 사용자로 임시 인증
    
    주의: 운영용에서는 절대 사용 안 됨 (settings.DEBUG=True 일 때만 동작)
    """
    
    def process_request(self, request):
        """
        요청 처리 전 헤더에서 X-Dev-User 확인
        
        Args:
            request: Django request 객체
        """
        # 개발 환경인지 확인
        if not getattr(settings, 'DEBUG', False):
            return None
        
        # 헤더에서 X-Dev-User 읽기
        dev_user = request.headers.get('X-Dev-User')
        
        if not dev_user:
            return None
        
        # Mock 사용자 목록에서 찾기 (백엔드에서 import)
        from apps.auth.backends.dev import MOCK_USERS
        
        mock_user_data = None
        for user_data in MOCK_USERS:
            if user_data['username'] == dev_user:
                mock_user_data = user_data
                break
        
        if not mock_user_data:
            logger.warning(f"[DevUserMiddleware] User not found: {dev_user}")
            return None
        
        # Django User 조회 또는 생성
        try:
            user = User.objects.get(username=dev_user)
            # 기존 사용자 정보 업데이트
            user.display_name = mock_user_data['name']
            user.department = mock_user_data['department']
            user.role = mock_user_data['role']
            user.email = mock_user_data['email']
            user.save()
        except User.DoesNotExist:
            # 새 사용자 생성
            user = User.objects.create_user(
                username=dev_user,
                email=mock_user_data['email'],
                password='',
                display_name=mock_user_data['name'],
                department=mock_user_data['department'],
                role=mock_user_data['role'],
            )
            logger.info(f"[DevUserMiddleware] Created user: {dev_user}")
        
        # request.user 에 설정
        request.user = user
        logger.debug(f"[DevUserMiddleware] Switched to user: {dev_user} (role={mock_user_data['role']})")
        
        return None
