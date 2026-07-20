import json
import os
from datetime import timedelta
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

# settings/base.py 기준: config/settings/base.py → parent×3 = backend/
BASE_DIR = Path(__file__).resolve().parent.parent.parent

SECRET_KEY = os.environ.get('DJANGO_SECRET_KEY', 'django-insecure-change-me-in-production')

DEBUG = os.environ.get('DEBUG', 'False') == 'True'

ALLOWED_HOSTS = os.environ.get('ALLOWED_HOSTS', 'localhost,127.0.0.1').split(',')

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'rest_framework',
    'rest_framework_simplejwt',
    'corsheaders',
    'django_filters',
    'django_apscheduler',
    'mozilla_django_oidc',
    'api.apps.ApiConfig',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.mysql',
        'NAME': os.environ.get('MYSQL_DB', 'requestdb'),
        'USER': os.environ.get('MYSQL_USER', 'requestuser'),
        'PASSWORD': os.environ.get('MYSQL_PASSWORD', 'requestpass'),
        'HOST': os.environ.get('MYSQL_HOST', 'db'),
        'PORT': os.environ.get('MYSQL_PORT', '3306'),
        'OPTIONS': {
            'charset': 'utf8mb4',
            'init_command': "SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci",
        },
    }
}

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

LANGUAGE_CODE = 'ko-kr'
TIME_ZONE = 'Asia/Seoul'
USE_I18N = True
USE_TZ = True

STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
STATICFILES_DIRS = [BASE_DIR / 'static']

MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'

# 업로드 용량 제한 (가이드 동영상 50MB 허용, 폼 데이터 여유분 포함)
DATA_UPLOAD_MAX_MEMORY_SIZE = 55 * 1024 * 1024  # 55MB

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

AUTH_USER_MODEL = 'api.UserProfile'

REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'api.authentication.CookieJWTAuthentication',
        'rest_framework_simplejwt.authentication.JWTAuthentication',
    ],
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.IsAuthenticatedOrReadOnly',
    ],
    'DEFAULT_FILTER_BACKENDS': [
        'django_filters.rest_framework.DjangoFilterBackend',
        'rest_framework.filters.SearchFilter',
        'rest_framework.filters.OrderingFilter',
    ],
    'DEFAULT_PAGINATION_CLASS': 'rest_framework.pagination.PageNumberPagination',
    'PAGE_SIZE': 20,
}

CORS_ALLOWED_ORIGINS = os.environ.get(
    'CORS_ALLOWED_ORIGINS',
    'https://localhost:10010,https://127.0.0.1:10010,https://localhost:3000,https://127.0.0.1:3000,https://cc.company.net:10010'
).split(',')

CORS_ALLOW_CREDENTIALS = True

EMAIL_BACKEND = 'django.core.mail.backends.smtp.EmailBackend'
EMAIL_HOST = os.environ.get('EMAIL_HOST', 'smtp.gmail.com')
EMAIL_PORT = int(os.environ.get('EMAIL_PORT', '587'))
EMAIL_USE_TLS = os.environ.get('EMAIL_USE_TLS', 'True') == 'True'
EMAIL_HOST_USER = os.environ.get('EMAIL_HOST_USER', '')
EMAIL_HOST_PASSWORD = os.environ.get('EMAIL_HOST_PASSWORD', '')
DEFAULT_FROM_EMAIL = os.environ.get('DEFAULT_FROM_EMAIL', 'noreply@project.com')

EXTERNAL_DB_HOST = os.environ.get('EXTERNAL_DB_HOST', '')
EXTERNAL_DB_PORT = os.environ.get('EXTERNAL_DB_PORT', '3306')
EXTERNAL_DB_USER = os.environ.get('EXTERNAL_DB_USER', '')
EXTERNAL_DB_PASSWORD = os.environ.get('EXTERNAL_DB_PASSWORD', '')

APPROVAL_EMAIL_LIST = os.environ.get('APPROVAL_EMAIL_LIST', '').split(',')

# 고정 후결자(RFG 팀) loginid — 모든 의뢰서에 항상 후결자로 포함된다.
# C가문(only_prodc=YES) 문서는 이 고정 후결자에 더해 상신 시 지정한 PL(들)이 추가된다.
POST_APPROVER_LOGINID = os.environ.get('POST_APPROVER_LOGINID', '')

# DXHUB 메일 API (결재 알림 발송)
DXHUB_MAIL_URL = os.environ.get('DXHUB_MAIL_URL', '')
DXHUB_API_KEY = os.environ.get('DXHUB_API_KEY', '')
# 메일 본문에 포함할 웹 서비스 주소 (개발 http://localhost:10011 / 운영 https://...:10010)
FRONTEND_URL = os.environ.get('FRONTEND_URL', 'http://localhost:10011')
# 설정 시 모든 결재 알림 메일을 이 주소로 강제 발송 (개발/검증용). 비우면 실제 수신자에게 발송.
MAIL_REDIRECT_TO = os.environ.get('MAIL_REDIRECT_TO', '')
# VOC 신규 등록 시 알림을 받을 고정 수신자 주소 (MASTER 담당자). 비우면 발송 안 함.
VOC_MASTER_EMAIL = os.environ.get('VOC_MASTER_EMAIL', '')

# ---------------------------------------------------------------------------
# P 단계 라인별 고정 수신자 (담당자 미지정 시 사용)
# ---------------------------------------------------------------------------
# P 단계에 담당자가 아직 지정되지 않았을 때, 요청서의 "라인" 값에 따라
# 서로 다른 고정 주소로 메일을 보내기 위한 설정이다.
#
# [수신자 변경 방법]
#   .env 파일의 P_LINE_FALLBACK 값을 JSON 문자열로 수정하면 된다 (재배포 불필요).
#   - 키(key)   : 요청서의 라인 이름 (요청서 제목/상세의 라인 값과 정확히 일치해야 함, 예: "S1")
#   - 값(value) : 수신 이메일. 한 라인에 여러 명이면 콤마(,)로 구분한다.
#
# [예시]  (라인당 1명 또는 여러 명 혼용 가능)
#   P_LINE_FALLBACK={"S1":"s1user@company.com","S2":"s2user@company.com","S3":"s3user@company.com","S4":"s4user@company.com","S5":"s5a@company.com,s5b@company.com"}
#
# [동작 규칙]
#   - 요청서 라인이 키에 있으면 → 해당 라인 수신자에게만 발송
#   - 요청서 라인이 키에 없거나 라인 정보가 비어 있으면 → 등록된 모든 라인 수신자에게 발송
#   - JSON 파싱 실패 시 → 빈 설정({})으로 처리(수신자 없음)
try:
    P_LINE_FALLBACK = json.loads(os.environ.get('P_LINE_FALLBACK', '') or '{}')
    if not isinstance(P_LINE_FALLBACK, dict):
        P_LINE_FALLBACK = {}
except (json.JSONDecodeError, TypeError):
    P_LINE_FALLBACK = {}

SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(hours=12),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=7),
    'ROTATE_REFRESH_TOKENS': True,
    'BLACKLIST_AFTER_ROTATION': True,
}

# ============================================
# ADFS OIDC SSO 설정
# ============================================
OIDC_RP_CLIENT_ID = os.environ.get('OIDC_RP_CLIENT_ID', '')
OIDC_RP_CLIENT_SECRET = os.environ.get('OIDC_RP_CLIENT_SECRET', '')

OIDC_OP_AUTHORIZATION_ENDPOINT = os.environ.get('OIDC_OP_AUTHORIZATION_ENDPOINT', '')
OIDC_OP_TOKEN_ENDPOINT = os.environ.get('OIDC_OP_TOKEN_ENDPOINT', '')
OIDC_OP_USER_ENDPOINT = os.environ.get('OIDC_OP_USER_ENDPOINT', '')
OIDC_OP_JWKS_ENDPOINT = os.environ.get('OIDC_OP_JWKS_ENDPOINT', '')
OIDC_OP_LOGOUT_ENDPOINT = os.environ.get('OIDC_OP_LOGOUT_ENDPOINT', '')

OIDC_RP_SIGN_ALGORITHM = os.environ.get('OIDC_RP_SIGN_ALGORITHM', 'RS256')
OIDC_CALLBACK_BASE_URL = os.environ.get('OIDC_CALLBACK_BASE_URL', 'http://localhost:8000')

OIDC_CERT_FILE_PATH = os.environ.get('OIDC_CERT_FILE_PATH', str(BASE_DIR / 'api' / 'certs'))
OIDC_CERT_FILE_NAME = os.environ.get('OIDC_CERT_FILE_NAME', 'company-dev.net.cer')

# ============================================
# 서비스용 JWT 설정
# ============================================
SERVICE_JWT_SECRET_KEY = os.environ.get('SERVICE_JWT_SECRET_KEY', '')
SERVICE_JWT_ALGORITHM = os.environ.get('SERVICE_JWT_ALGORITHM', 'HS256')
SERVICE_JWT_ACCESS_TOKEN_LIFETIME = timedelta(hours=12)
SERVICE_JWT_REFRESH_TOKEN_LIFETIME = timedelta(days=7)

# Auth Mode (dev: 개발용 드롭다운, sso: 운영용 OIDC)
AUTH_MODE = os.environ.get('AUTH_MODE', 'sso')

# ============================================
# 외부 조회용 고정 API Key (읽기 전용 /api/external/ 접근)
# ============================================
EXTERNAL_API_KEY = os.environ.get('EXTERNAL_API_KEY', '')

SESSION_COOKIE_HTTPONLY = True
CSRF_USE_SESSIONS = True

LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {
        'verbose': {
            'format': '{levelname} {asctime} {module} {message}',
            'style': '{',
        },
    },
    'handlers': {
        'console': {
            'level': 'INFO',
            'class': 'logging.StreamHandler',
            'formatter': 'verbose',
        },
    },
    'root': {
        'handlers': ['console'],
        'level': 'INFO',
    },
    'loggers': {
        'api.auth_views': {
            'handlers': ['console'],
            'level': 'INFO',
            'propagate': False,
        },
    },
}
