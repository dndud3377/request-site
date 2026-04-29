"""
Cookie 기반 JWT 인증 클래스
"""
from django.conf import settings
from django.contrib.auth import get_user_model
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed
import jwt
from jwt.exceptions import ExpiredSignatureError, InvalidTokenError
import logging

logger = logging.getLogger(__name__)


class CookieJWTAuthentication(BaseAuthentication):
    """
    HttpOnly Cookie에 저장된 JWT를 사용하여 인증하는 클래스
    """
    keyword = 'Bearer'
    
    def authenticate(self, request):
        # Cookie 에서 토큰 가져오기
        token = request.COOKIES.get('access_token')
        
        logger.info(f"[Auth] Cookie token exists: {bool(token)}")
        
        if not token:
            return None  # 인증 안 함
        
        return self.authenticate_token(token)
    
    def authenticate_token(self, token):
        service_jwt_secret = getattr(settings, 'SERVICE_JWT_SECRET_KEY', '')
        service_jwt_algorithm = getattr(settings, 'SERVICE_JWT_ALGORITHM', 'HS256')
        
        if not service_jwt_secret:
            logger.error("[Auth] SERVICE_JWT_SECRET_KEY is not configured")
            raise AuthenticationFailed('JWT 시크릿 키가 설정되지 않았습니다.')
        
        try:
            # 토큰 디코딩 (서명 검증)
            payload = jwt.decode(
                token,
                service_jwt_secret,
                algorithms=[service_jwt_algorithm],
                options={'verify_exp': True}
            )
            
            # 사용자 조회
            User = get_user_model()
            username = payload.get('username')
            
            logger.info(f"[Auth] Token payload username: {username}")
            
            if not username:
                raise AuthenticationFailed('Invalid token payload')
            
            try:
                user = User.objects.get(username=username)
                logger.info(f"[Auth] User found: {user.username}, id: {user.id}")
            except User.DoesNotExist:
                logger.error(f"[Auth] User not found: {username}")
                # 사용자가 없으면 Cookie를 삭제하고 None 반환 (SSO 로그인 시도)
                from django.http import HttpResponse
                response = HttpResponse(status=401)
                response.delete_cookie('access_token')
                response.delete_cookie('refresh_token')
                # 인증 실패를 나타내는 special return
                return None
            
            return (user, token)
            
        except ExpiredSignatureError:
            raise AuthenticationFailed('토큰이 만료되었습니다.')
        except InvalidTokenError as e:
            raise AuthenticationFailed(f'유효하지 않은 토큰입니다: {str(e)}')
        except Exception as e:
            logger.error(f"[Auth] Token authentication error: {e}")
            raise AuthenticationFailed(f'인증 오류가 발생했습니다: {str(e)}')
