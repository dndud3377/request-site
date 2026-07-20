"""
Cookie 기반 JWT 인증 클래스
"""
import hmac
from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.models import AnonymousUser
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
                user = User.objects.get(loginid=username)
                logger.info(f"[Auth] User found: {user.loginid}, id: {user.id}")
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


class ExternalApiKeyAuthentication(BaseAuthentication):
    """외부 읽기 전용 API용 고정 키 인증.

    요청 헤더 `X-API-Key` 값을 settings.EXTERNAL_API_KEY 와 상수시간 비교(hmac.compare_digest)한다.
    로그인 계정과 무관하므로 인증 성공 시 AnonymousUser 를 반환하고, 권한 판단은
    이 인증 성공 여부만 보는 별도 permission 클래스(views.HasExternalApiKey)에 위임한다.
    """

    def authenticate(self, request):
        provided = request.headers.get('X-API-Key', '')
        expected = getattr(settings, 'EXTERNAL_API_KEY', '')

        if not provided:
            return None  # 헤더 없음 → 인증 시도 안 함(permission 에서 403 처리)

        if not expected or not hmac.compare_digest(provided, expected):
            raise AuthenticationFailed('유효하지 않은 API Key입니다.')

        return (AnonymousUser(), None)
