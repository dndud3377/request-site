import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.environ.get('DJANGO_SECRET_KEY', 'django-insecure-change-me-in-production')

DEBUG = os.environ.get('DEBUG', 'True') == 'True'

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

# 커스텀 User 모델 사용 (暂时不使用，恢复默认)
# AUTH_USER_MODEL = 'api.User'

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

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'api.authentication.CookieJWTAuthentication',  # Cookie 기반 JWT 인증 (우선)
        'rest_framework_simplejwt.authentication.JWTAuthentication',  # 기존 JWT (하위 호환)
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

# Email settings
EMAIL_BACKEND = 'django.core.mail.backends.smtp.EmailBackend'
EMAIL_HOST = os.environ.get('EMAIL_HOST', 'smtp.gmail.com')
EMAIL_PORT = int(os.environ.get('EMAIL_PORT', '587'))
EMAIL_USE_TLS = os.environ.get('EMAIL_USE_TLS', 'True') == 'True'
EMAIL_HOST_USER = os.environ.get('EMAIL_HOST_USER', '')
EMAIL_HOST_PASSWORD = os.environ.get('EMAIL_HOST_PASSWORD', '')
DEFAULT_FROM_EMAIL = os.environ.get('DEFAULT_FROM_EMAIL', 'noreply@project.com')

# External DB (form options sync)
EXTERNAL_DB_HOST = os.environ.get('EXTERNAL_DB_HOST', '')
EXTERNAL_DB_PORT = os.environ.get('EXTERNAL_DB_PORT', '3306')
EXTERNAL_DB_USER = os.environ.get('EXTERNAL_DB_USER', '')
EXTERNAL_DB_PASSWORD = os.environ.get('EXTERNAL_DB_PASSWORD', '')

# Approval email recipients
APPROVAL_EMAIL_LIST = os.environ.get('APPROVAL_EMAIL_LIST', '').split(',')

# JWT settings (SSO 전환 시 제거 예정)
from datetime import timedelta

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

# ADFS 인증서 경로 (ID 토큰 서명 검증용)
OIDC_CERT_FILE_PATH = os.environ.get('OIDC_CERT_FILE_PATH', str(BASE_DIR / 'api' / 'certs'))
OIDC_CERT_FILE_NAME = os.environ.get('OIDC_CERT_FILE_NAME', 'company-dev.net.cer')

# ============================================
# 서비스용 JWT 설정 (ADFS id_token 기반 별도 토큰 생성)
# ============================================
SERVICE_JWT_SECRET_KEY = os.environ.get('SERVICE_JWT_SECRET_KEY', '')
SERVICE_JWT_ALGORITHM = os.environ.get('SERVICE_JWT_ALGORITHM', 'HS256')
SERVICE_JWT_ACCESS_TOKEN_LIFETIME = timedelta(hours=1)  # 1 시간 (토큰 만료 시 자동 갱신 안 함, 로그아웃)
SERVICE_JWT_REFRESH_TOKEN_LIFETIME = timedelta(days=7)

# ============================================
# Auth Mode 설정 (개발용: mock, 운영용: sso)
# ============================================
AUTH_MODE = os.environ.get('AUTH_MODE', 'sso')  # 기본값: sso (운영용)

# Cookie 설정
SESSION_COOKIE_HTTPONLY = True
CSRF_USE_SESSIONS = True

# ============================================
# HTTPS 보안 설정
# ============================================
SECURE_SSL_REDIRECT = True  # HTTP → HTTPS 자동 리다이렉트
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')  # Nginx 프록시 헤더 신뢰
SESSION_COOKIE_SECURE = True  # 쿠키 HTTPS에서만 전송
CSRF_COOKIE_SECURE = True  # CSRF 토큰도 HTTPS에서만
SECURE_HSTS_SECONDS = 31536000  # 1년
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True

# ============================================
# 로깅 설정
# ============================================
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
