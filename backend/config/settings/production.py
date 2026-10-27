from django.core.exceptions import ImproperlyConfigured

from .base import *

# claude 수정 (2026-10-27): 고정 후결자는 모든 의뢰서(MAP 삭제·ADI CD 변경 제외)에 반드시 들어가야 한다 —
# 비어 있으면 후결 단계가 조용히 사라지므로(B-04) 기동하지 않는다.
if not POST_APPROVER_LOGINID.strip():
    raise ImproperlyConfigured(
        'POST_APPROVER_LOGINID(고정 후결자 loginid)가 비어 있습니다. .env 에 반드시 설정해야 합니다.'
    )

SECURE_SSL_REDIRECT = True
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_HSTS_SECONDS = 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True

# claude 수정 (2026-10-23): /media/ 파일 전송을 nginx internal 경로에 맡긴다 (api.views.serve_media 가 인증 후 X-Accel-Redirect, B-34)
# nginx/nginx.conf 의 `location /protected-media/ { internal; ... }` 와 값이 같아야 한다.
MEDIA_X_ACCEL_PREFIX = '/protected-media/'
