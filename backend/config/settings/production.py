from .base import *

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
