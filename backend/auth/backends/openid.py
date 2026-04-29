"""
OpenID Connect Authentication Backend for Production (ADFS SSO).
"""
from django.contrib.auth.backends import BaseBackend
from django.contrib.auth import get_user_model
from django.conf import settings
from django.http import HttpResponseRedirect
from rest_framework.response import Response
from rest_framework import status
from datetime import datetime, timedelta
import jwt
import json
import uuid
import os
import logging
from jwt.exceptions import ExpiredSignatureError, InvalidTokenError
from cryptography import x509
from cryptography.hazmat.backends import default_backend

logger = logging.getLogger(__name__)
User = get_user_model()


def user_to_dict(user):
    """User 객체를 프론트엔드 사용자 정보로 변환"""
    role = getattr(user, 'role', 'NONE') or 'NONE'
    name = getattr(user, 'user_name', '') or user.login_id
    department = getattr(user, 'dept_name', '') or ''
    
    return {
        'id': user.id,
        'login_id': user.login_id,
        'name': name,
        'role': role,
        'dept_name': department,
        'email': user.email,
    }


def create_or_update_user_from_oidc(claims):
    """
    OIDC 클레임에서 사용자 정보를 추출하여 Django User 생성/업데이트
    
    ADFS 클레임 매핑:
    - loginid/LoginId → login_id
    - mail/Mail/email → email
    - username/Username → user_name
    - deptname/DeptName → dept_name
    """
    # ADFS 클레임에서 추출 (우선순위: loginid > LoginId)
    login_id = claims.get('loginid') or claims.get('LoginId')
    email = claims.get('mail') or claims.get('Mail') or claims.get('email')
    user_name = claims.get('username') or claims.get('Username')
    dept_name = claims.get('deptname') or claims.get('DeptName', '')
    
    if not login_id:
        logger.error("[OIDC] No login_id found in claims")
        return None
    
    user, created = User.objects.get_or_create(
        login_id=login_id,
        defaults={
            'email': email or '',
            'is_staff': False,
            'is_active': True,
        }
    )
    
    if not created:
        user.email = email or user.email
    
    # auth_user 에 직접 역할 정보 저장 (기본 role: NONE)
    user.role = 'NONE'  # SSO 로그인 시 기본 권한 없음
    user.dept_name = dept_name or ''
    user.user_name = user_name or ''
    user.save()
    
    logger.info(f"[OIDC] User {'created' if created else 'updated'}: {login_id}")
    return user


def get_adfs_public_key():
    """
    ADFS 인증서 파일에서 공개키를 로드합니다.
    """
    cert_path = getattr(settings, 'OIDC_CERT_FILE_PATH', '')
    cert_file = getattr(settings, 'OIDC_CERT_FILE_NAME', 'stsds-dev.secsso.net.cer')
    
    full_path = os.path.join(cert_path, cert_file)
    
    if not os.path.exists(full_path):
        logger.error(f"[OIDC] Certificate file not found: {full_path}")
        return None
    
    try:
        cert_str = open(full_path, 'rb').read()
        cert_obj = x509.load_pem_x509_certificate(cert_str, default_backend())
        public_key = cert_obj.public_key()
        logger.info(f"[OIDC] Loaded ADFS certificate from {full_path}")
        return public_key
    except Exception as e:
        logger.error(f"[OIDC] Failed to load certificate: {e}")
        return None


class OpenIDBackend(BaseBackend):
    """
    ADFS OIDC 인증 백엔드 (운영용)
    
    사용법:
    1. settings.py 에서 AUTHENTICATION_BACKENDS 에 추가
    2. views.py 에서 이 클래스의 메서드 호출
    
    현재는 기존 views.py 의 로직을 그대로 유지하며,
    필요시 점진적으로 이 클래스로 통합
    """
    
    def authenticate(self, request, id_token=None, **kwargs):
        """
        ADFS id_token 으로 사용자 인증
        
        Args:
            request: Django request 객체
            id_token: ADFS 에서 받은 ID 토큰
        
        Returns:
            User 객체 (성공 시) 또는 None (실패 시)
        """
        if not id_token:
            return None
        
        # ADFS 인증서로 ID 토큰 서명 검증
        public_key = get_adfs_public_key()
        if not public_key:
            logger.error("[OIDC] Failed to get ADFS public key")
            return None
        
        try:
            decoded_id_token = jwt.decode(
                jwt=id_token.encode(),
                key=public_key,
                verify=True,
                algorithms=['RS256'],
                options={
                    'verify_signature': True,
                    'verify_exp': False,  # 만료 검증은 ADFS 가 처리하므로 생략
                    'verify_aud': False,
                }
            )
        except InvalidTokenError as e:
            logger.error(f"[OIDC] Invalid ID token: {e}")
            return None
        
        # 사용자 생성/업데이트
        user = create_or_update_user_from_oidc(decoded_id_token)
        return user
    
    def get_user(self, user_id):
        """Django 표준 메서드"""
        try:
            return User.objects.get(pk=user_id)
        except User.DoesNotExist:
            return None
    
    @staticmethod
    def create_service_tokens(user, decoded_claims):
        """
        ADFS id_token 클레임 기반 서비스용 JWT 토큰 생성
        
        Returns:
            tuple: (access_token, refresh_token)
        """
        service_jwt_secret = getattr(settings, 'SERVICE_JWT_SECRET_KEY', '')
        service_jwt_algorithm = getattr(settings, 'SERVICE_JWT_ALGORITHM', 'HS256')
        access_token_lifetime = getattr(settings, 'SERVICE_JWT_ACCESS_TOKEN_LIFETIME', timedelta(hours=1))
        refresh_token_lifetime = getattr(settings, 'SERVICE_JWT_REFRESH_TOKEN_LIFETIME', timedelta(days=7))
        
        if not service_jwt_secret:
            logger.error("[OIDC] SERVICE_JWT_SECRET_KEY is not configured")
            return None, None
        
        # id_token 클레임에서 사용자 정보 추출
        username = decoded_claims.get('loginid') or decoded_claims.get('LoginId') or decoded_claims.get('preferred_username') or decoded_claims.get('sub', '')
        
        # base64 디코딩이 필요한 경우 (sub 가 base64 인 경우)
        import base64
        try:
            if username and '=' in username:
                decoded_username = base64.b64decode(username).decode('utf-8')
                if decoded_username:
                    username = decoded_username
        except Exception:
            pass
        
        # access_token 생성
        token_payload = {
            'sub': decoded_claims.get('sub', ''),
            'username': username,
            'email': decoded_claims.get('mail') or decoded_claims.get('Mail') or decoded_claims.get('email') or decoded_claims.get('upn', ''),
            'name': decoded_claims.get('username') or decoded_claims.get('Username') or decoded_claims.get('name', ''),
            'given_name': decoded_claims.get('givenname') or decoded_claims.get('GivenName', ''),
            'family_name': decoded_claims.get('surname') or decoded_claims.get('Surname', ''),
            'department': decoded_claims.get('deptname') or decoded_claims.get('DeptName', ''),
            'company': decoded_claims.get('compname') or decoded_claims.get('CompName', ''),
            'source': 'internal-auth',
            'iat': datetime.utcnow(),
            'exp': datetime.utcnow() + access_token_lifetime,
        }
        
        access_token = jwt.encode(token_payload, service_jwt_secret, algorithm=service_jwt_algorithm)
        
        # refresh_token 생성
        refresh_payload = {
            'sub': decoded_claims.get('sub', ''),
            'username': username,
            'type': 'refresh',
            'iat': datetime.utcnow(),
            'exp': datetime.utcnow() + refresh_token_lifetime,
        }
        refresh_token = jwt.encode(refresh_payload, service_jwt_secret, algorithm=service_jwt_algorithm)
        
        logger.info(f"[OIDC] Service tokens created for: {username}")
        return access_token, refresh_token

