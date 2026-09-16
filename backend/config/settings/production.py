"""운영 설정.

개발(development.py)과 달리 **비밀값이 비어 있으면 기동 자체를 실패시킨다.**
예전에는 base.py 의 기본값(`django-insecure-...`)으로 조용히 떠서, .env 에 값이
빠져도 아무도 알아채지 못한 채 공개된 키로 세션과 OIDC nonce 를 서명했다
(docs/SECURITY.md H-8).
"""
import os

from django.core.exceptions import ImproperlyConfigured

from .base import *

# ===== 비밀값 fail-closed 검사 =====
# 여기서 막지 않으면 "설정 누락"이 "조용한 취약점"이 된다.
if not os.environ.get('DJANGO_SECRET_KEY'):
    raise ImproperlyConfigured(
        '운영 환경에는 DJANGO_SECRET_KEY 가 반드시 필요합니다. .env 에 값을 설정하세요. '
        '(생성 예: python -c "import secrets; print(secrets.token_urlsafe(50))")'
    )

if not os.environ.get('SERVICE_JWT_SECRET_KEY'):
    raise ImproperlyConfigured(
        '운영 환경에는 SERVICE_JWT_SECRET_KEY 가 반드시 필요합니다. .env 에 값을 설정하세요.'
    )

if DEBUG:
    raise ImproperlyConfigured('운영 환경에서는 DEBUG 를 켤 수 없습니다. .env 의 DEBUG 를 False 로 두세요.')

SECURE_SSL_REDIRECT = True
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_HSTS_SECONDS = 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True

# 브라우저 측 방어(nginx 헤더와 중복되더라도, nginx 를 거치지 않는 경로까지 덮기 위해 둔다).
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = 'same-origin'
X_FRAME_OPTIONS = 'DENY'
