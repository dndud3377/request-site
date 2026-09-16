"""
Cookie 기반 JWT 인증 클래스
"""
import hmac
from datetime import datetime, timezone as dt_timezone

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.models import AnonymousUser
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed
import jwt
from jwt.exceptions import ExpiredSignatureError, InvalidTokenError
import logging

logger = logging.getLogger(__name__)


def token_issued_after_logout(payload, user) -> bool:
    """토큰이 이 사용자의 마지막 로그아웃 **이후에** 발급됐는가.

    `UserProfile.tokens_valid_from` 이 비어 있으면(= 로그아웃한 적 없음) 항상 True.
    iat 가 없는 토큰은 판정할 수 없으므로 거부하지 않는다 - 이 검사는 로그아웃 무효화를
    위한 것이고, 서명·만료 검증은 호출부에서 이미 끝났다.
    """
    valid_from = getattr(user, 'tokens_valid_from', None)
    if not valid_from:
        return True
    iat = payload.get('iat')
    if iat is None:
        return True
    issued_at = datetime.fromtimestamp(int(iat), tz=dt_timezone.utc)
    return issued_at >= valid_from


class CookieJWTAuthentication(BaseAuthentication):
    """
    HttpOnly Cookie에 저장된 JWT를 사용하여 인증하는 클래스
    """
    keyword = 'Bearer'
    
    def authenticate(self, request):
        # Cookie 에서 토큰 가져오기
        token = request.COOKIES.get('access_token')

        # 요청마다 찍히던 INFO 로그는 DEBUG 로 낮춘다 - 운영 로그를 채우기만 하고
        # 남는 정보는 "쿠키가 있었는지" 뿐이다.
        logger.debug(f"[Auth] Cookie token exists: {bool(token)}")

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

            logger.debug(f"[Auth] Token payload username: {username}")

            if not username:
                raise AuthenticationFailed('Invalid token payload')
            
            try:
                user = User.objects.get(loginid=username)
                logger.debug(f"[Auth] User found: {user.loginid}, id: {user.id}")
            except User.DoesNotExist:
                logger.error(f"[Auth] User not found: {username}")
                # 사용자가 없으면 Cookie를 삭제하고 None 반환 (SSO 로그인 시도)
                from django.http import HttpResponse
                response = HttpResponse(status=401)
                response.delete_cookie('access_token')
                response.delete_cookie('refresh_token')
                # 인증 실패를 나타내는 special return
                return None

            # 로그아웃 이후에 발급된 토큰인지 확인한다.
            # 로그아웃은 쿠키만 지우므로, 이미 새어 나간 토큰은 이 검사가 없으면
            # access 12시간 / refresh 7일 동안 그대로 통한다(docs/SECURITY.md M-12).
            if not token_issued_after_logout(payload, user):
                raise AuthenticationFailed('로그아웃된 토큰입니다. 다시 로그인해 주세요.')

            return (user, token)

        except ExpiredSignatureError:
            raise AuthenticationFailed('토큰이 만료되었습니다.')
        except InvalidTokenError as e:
            # 예외 원문(어느 검증에서 걸렸는지)은 공격자에게 힌트가 되므로 응답에 싣지 않는다
            # (docs/SECURITY.md M-13). 상세는 로그로만 남긴다.
            logger.warning(f"[Auth] Invalid token: {e}")
            raise AuthenticationFailed('유효하지 않은 토큰입니다.')
        except AuthenticationFailed:
            raise
        except Exception as e:
            logger.error(f"[Auth] Token authentication error: {e}")
            raise AuthenticationFailed('인증 오류가 발생했습니다.')


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

    def authenticate_header(self, request):
        """401 응답에 실을 WWW-Authenticate 스킴.

        이 메서드가 없으면 DRF 는 AuthenticationFailed 를 **403** 으로 낮춰 응답한다
        (`rest_framework.views.exception_handler`). 잘못된 키는 "권한 없음"이 아니라
        "인증 실패"이므로 401 이 맞다.
        """
        return 'X-API-Key'
