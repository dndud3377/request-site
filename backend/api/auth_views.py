from django.contrib.auth import login, logout, get_user_model
from django.conf import settings
from django.views.decorators.csrf import csrf_exempt
from django.utils.decorators import method_decorator
from django.http import HttpResponseRedirect, HttpResponse
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework import status
from datetime import datetime, timedelta
import logging
import os
import jwt
import json
import hmac
import uuid
from jwt.exceptions import ExpiredSignatureError, InvalidTokenError
from cryptography import x509
from cryptography.hazmat.backends import default_backend

User = get_user_model()

logger = logging.getLogger(__name__)

# OIDC 로그인 요청(nonce/state)을 브라우저에 묶어 두는 HttpOnly 쿠키.
# form_post 는 ADFS 에서 넘어오는 cross-site POST 이므로 SameSite=Lax 쿠키는 전달되지 않는다 → SameSite=None; Secure.
# 콜백이 nginx 의 /oidc-callback 으로 들어오므로(브라우저가 보는 경로) path 는 '/' 로 둔다.
OIDC_STATE_COOKIE = 'oidc_state'
OIDC_STATE_COOKIE_MAX_AGE = 600  # 10분
OIDC_STATE_TOKEN_TYPE = 'oidc_state'
OIDC_STATE_ALGORITHM = 'HS256'

# id_token 검증: exp/iss/aud 는 반드시 있어야 하고, nbf/iat 는 있으면 검증한다. 서버 간 시계 오차 허용(초).
OIDC_ID_TOKEN_ALGORITHMS = ['RS256']
OIDC_ID_TOKEN_REQUIRED_CLAIMS = ['exp', 'iss', 'aud']
OIDC_ID_TOKEN_LEEWAY_SECONDS = 60

from .sse import broadcaster as _user_broadcaster


def user_to_dict(user):
    """User 객체를 프론트엔드 사용자 정보로 변환"""
    return {
        'id': user.id,
        'username': user.loginid,
        'name': user.username or user.loginid,
        'role': user.role or 'NONE',
        'department': user.deptname,
        'email': user.mail,
    }


def create_or_update_user_from_oidc(claims):
    """
    OIDC 클레임에서 사용자 정보를 추출하여 Django User 생성/업데이트
    """
    # ADFS 클레임 필드 (대소문자 모두 확인)
    # ADFS가 클레임 필드명을 소문자로 반환하므로 소문자 우선
    login_id = claims.get('loginid') or claims.get('LoginId') or claims.get('preferred_username') or claims.get('sub')
    email = claims.get('mail') or claims.get('Mail') or claims.get('email') or claims.get('upn')
    user_name = claims.get('username') or claims.get('Username') or claims.get('name', '')
    dept_name = claims.get('deptname') or claims.get('DeptName', '')
    
    if not login_id:
        logger.error("[OIDC] No login_id found in claims")
        return None
    
    user, created = User.objects.get_or_create(
        loginid=login_id,
        defaults={
            'mail': email or '',
            'role': 'NONE',
        }
    )

    if not created:
        user.mail = email or user.mail

    user.deptname = dept_name or ''
    user.username = user_name or ''
    user.save()
    
    logger.info(f"[OIDC] User {'created' if created else 'updated'}: {login_id}")

    if created:
        _user_broadcaster.broadcast('user_added', {
            'id': user.id,
            'loginid': user.loginid,
            'name': user.username or '',
            'deptname': user.deptname or '',
            'role': 'NONE',
            'mail': user.mail or '',
        })

    return user


def get_adfs_public_key():
    """
    ADFS 인증서 파일에서 공개키를 로드합니다.
    """
    cert_path = getattr(settings, 'OIDC_CERT_FILE_PATH', '')
    cert_file = getattr(settings, 'OIDC_CERT_FILE_NAME', 'company.net.cer')
    
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


def _set_oidc_state_cookie(response, value, max_age=OIDC_STATE_COOKIE_MAX_AGE):
    """oidc_state 쿠키를 설정한다. 삭제는 value='' / max_age=0 (SameSite=None 은 Secure 여야 브라우저가 받는다)."""
    response.set_cookie(
        key=OIDC_STATE_COOKIE,
        value=value,
        httponly=True,
        secure=True,
        samesite='None',
        max_age=max_age,
        path='/',
    )


def _is_valid_oidc_state(request, posted_state, id_token_nonce):
    """
    oidc_state 쿠키(로그인 시작 시 발급)와 콜백으로 돌아온 state / id_token.nonce 가 모두 일치하는지 확인한다.
    쿠키·state·nonce 중 하나라도 없거나 다르면 False (fail-closed).
    """
    cookie_val = request.COOKIES.get(OIDC_STATE_COOKIE)
    if not cookie_val:
        logger.error("[OIDC] oidc_state cookie missing")
        return False

    try:
        saved = jwt.decode(
            cookie_val,
            settings.SECRET_KEY,
            algorithms=[OIDC_STATE_ALGORITHM],
            options={'require': ['exp']},
        )
    except InvalidTokenError as e:
        logger.error(f"[OIDC] oidc_state cookie invalid: {e}")
        return False

    saved_state = saved.get('state')
    saved_nonce = saved.get('nonce')
    if saved.get('typ') != OIDC_STATE_TOKEN_TYPE or not saved_state or not saved_nonce:
        logger.error("[OIDC] oidc_state cookie payload invalid")
        return False

    if not posted_state or not hmac.compare_digest(str(posted_state), str(saved_state)):
        logger.error("[OIDC] state mismatch")
        return False

    if not id_token_nonce or not hmac.compare_digest(str(id_token_nonce), str(saved_nonce)):
        logger.error("[OIDC] nonce mismatch or missing in id_token")
        return False

    return True


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def me_view(request):
    """
    GET /api/auth/me/
    Authorization: Bearer <token> → { user }
    """
    return Response({'user': user_to_dict(request.user)})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def refresh_token_view(request):
    """
    POST /api/auth/refresh/
    새로운 access_token 발급 (슬라이딩 윈도우 방식)
    
    요청: Cookie에 refresh_token이 있어야 함
    응답: 새로운 access_token (Cookie에 저장)
    """
    # Cookie에서 refresh_token 가져오기
    refresh_token = request.COOKIES.get('refresh_token')
    
    if not refresh_token:
        return Response(
            {'error': '리프레시 토큰이 없습니다.'},
            status=status.HTTP_401_UNAUTHORIZED
        )
    
    service_jwt_secret = getattr(settings, 'SERVICE_JWT_SECRET_KEY', '')
    service_jwt_algorithm = getattr(settings, 'SERVICE_JWT_ALGORITHM', 'HS256')
    access_token_lifetime = getattr(settings, 'SERVICE_JWT_ACCESS_TOKEN_LIFETIME', timedelta(hours=12))
    
    try:
        # refresh_token 검증
        payload = jwt.decode(
            refresh_token,
            service_jwt_secret,
            algorithms=[service_jwt_algorithm],
            options={'verify_exp': True}
        )
        
        # type 확인
        if payload.get('type') != 'refresh':
            return Response(
                {'error': '유효하지 않은 토큰입니다.'},
                status=status.HTTP_401_UNAUTHORIZED
            )
        
        # 사용자 조회
        User = get_user_model()
        username = payload.get('username')
        
        try:
            user = User.objects.get(loginid=username)
        except User.DoesNotExist:
            return Response(
                {'error': '사용자를 찾을 수 없습니다.'},
                status=status.HTTP_401_UNAUTHORIZED
            )
        
        # 새로운 access_token 생성
        token_payload = {
            'sub': payload.get('sub', ''),
            'username': username,
            'email': payload.get('email', ''),
            'name': payload.get('name', ''),
            'given_name': payload.get('given_name', ''),
            'family_name': payload.get('family_name', ''),
            'department': payload.get('department', ''),
            'company': payload.get('company', ''),
            'source': 'internal-auth',
            'iat': datetime.utcnow(),
            'exp': datetime.utcnow() + access_token_lifetime,
        }
        
        new_access_token = jwt.encode(token_payload, service_jwt_secret, algorithm=service_jwt_algorithm)
        
        # 응답 생성 및 Cookie 설정
        response = Response({
            'success': True,
            'user': user_to_dict(user),
        })
        
        response.set_cookie(
            key='access_token',
            value=new_access_token,
            httponly=True,
            secure=True,
            samesite='Lax',
            max_age=access_token_lifetime.total_seconds(),
            path='/',
        )
        
        logger.info(f"[Auth] Token refreshed for user: {username}")
        return response
        
    except ExpiredSignatureError:
        return Response(
            {'error': '리프레시 토큰이 만료되었습니다. 다시 로그인해 주세요.'},
            status=status.HTTP_401_UNAUTHORIZED
        )
    except InvalidTokenError as e:
        logger.error(f"[Auth] Invalid refresh token: {e}")
        return Response(
            {'error': '유효하지 않은 토큰입니다.'},
            status=status.HTTP_401_UNAUTHORIZED
        )


# ============================================
# OIDC SSO 로그인 관련 Views (샘플 코드 기반)
# ============================================

@api_view(['GET'])
@authentication_classes([])  # 만료/잔존 쿠키가 있어도 로그인을 시작할 수 있어야 한다
@permission_classes([AllowAny])
def oidc_login_init(request):
    """
    GET /api/auth/oidc/login/
    ADFS로 리다이렉트하기 위한 초기화 엔드포인트
    response_mode=form_post, response_type=code+id_token 사용

    CSRF(Login CSRF) 방지: nonce/state 를 서명한 HttpOnly 쿠키(oidc_state)로 브라우저에 묶고,
    콜백에서 id_token.nonce / state 와 대조한다.
    """
    nonce_val = str(uuid.uuid4())
    state_val = str(uuid.uuid4())

    state_payload = {
        'typ': OIDC_STATE_TOKEN_TYPE,
        'nonce': nonce_val,
        'state': state_val,
        'exp': datetime.utcnow() + timedelta(seconds=OIDC_STATE_COOKIE_MAX_AGE),
    }
    state_jwt = jwt.encode(state_payload, settings.SECRET_KEY, algorithm=OIDC_STATE_ALGORITHM)
    
    # ADFS 인증 URL 생성
    idp_url = getattr(settings, 'OIDC_OP_AUTHORIZATION_ENDPOINT', '')
    client_id = getattr(settings, 'OIDC_RP_CLIENT_ID', '')
    callback_url = getattr(settings, 'OIDC_CALLBACK_BASE_URL', '')
    
    # Redirect URI: nginx 가 /oidc-callback 을 백엔드 콜백으로 전달한다 (form_post 모드)
    redirect_uri = f"{callback_url}/oidc-callback"
    
    # OIDC 인증 파라미터
    auth_param = f"?client_id={client_id}"
    auth_param += f"&redirect_uri={redirect_uri}"
    auth_param += "&response_mode=form_post"
    auth_param += "&response_type=code+id_token"
    auth_param += "&scope=openid+profile"
    auth_param += f"&nonce={nonce_val}"
    auth_param += f"&state={state_val}"
    
    auth_url_with_params = f"{idp_url}{auth_param}"
    
    logger.info(f"[OIDC] Login init - redirect_uri: {redirect_uri}")
    
    response = Response({'redirect_url': auth_url_with_params})
    _set_oidc_state_cookie(response, state_jwt)
    return response


@api_view(['POST'])
@authentication_classes([])  # ADFS 에서 넘어오는 요청 — 기존 쿠키로 인증하지 않는다
@permission_classes([AllowAny])
@csrf_exempt
def oidc_callback(request):
    """
    POST /api/auth/oidc/callback/
    ADFS로부터 반환된 인증 처리 (response_mode=form_post)
    id_token을 직접 검증하여 사용자 인증. oidc_state 쿠키는 성공/실패와 무관하게 1회용으로 삭제한다.
    """
    response = _process_oidc_callback(request)
    _set_oidc_state_cookie(response, '', max_age=0)
    return response


def _process_oidc_callback(request):
    """oidc_callback 본 처리. 검증 실패 시 Response 를 반환한다."""
    from django.contrib.auth import get_user_model
    import requests
    
    User = get_user_model()
    
    # form_post (application/x-www-form-urlencoded) 또는 JSON 형식 지원
    id_token_val = request.POST.get('id_token') or request.data.get('id_token')
    auth_code = request.POST.get('code') or request.data.get('code')
    
    posted_state = request.POST.get('state') or request.data.get('state')
    
    if not id_token_val:
        logger.error("[OIDC] No id_token received")
        return Response(
            {'error': 'ID 토큰이 없습니다.'},
            status=status.HTTP_400_BAD_REQUEST
        )
    
    # ADFS 인증서로 ID 토큰 서명 검증 (먼저 검증하고 nonce 추출)
    if not getattr(settings, 'OIDC_ISSUER', '') or not getattr(settings, 'OIDC_RP_CLIENT_ID', ''):
        logger.error("[OIDC] OIDC_ISSUER / OIDC_RP_CLIENT_ID is not configured")
        return Response(
            {'error': 'OIDC 설정이 올바르지 않습니다.'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )

    public_key = get_adfs_public_key()
    
    if not public_key:
        return Response(
            {'error': '인증서 로드 실패'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )
    
    # ID 토큰 디코딩 및 서명 검증
    b_token = id_token_val.encode()
    
    try:
        decoded_id_token = jwt.decode(
            b_token,
            public_key,
            algorithms=OIDC_ID_TOKEN_ALGORITHMS,
            audience=settings.OIDC_RP_CLIENT_ID,
            issuer=settings.OIDC_ISSUER,
            leeway=OIDC_ID_TOKEN_LEEWAY_SECONDS,
            options={'require': OIDC_ID_TOKEN_REQUIRED_CLAIMS},
        )
    except InvalidTokenError as e:
        logger.error(f"[OIDC] Invalid ID token: {e}")
        return Response(
            {'error': '인증 토큰이 유효하지 않습니다.'},
            status=status.HTTP_401_UNAUTHORIZED
        )
    
    # 로그인 요청과 묶인 nonce/state 검증 (쿠키·state·nonce 중 하나라도 없거나 다르면 거부)
    if not _is_valid_oidc_state(request, posted_state, decoded_id_token.get('nonce')):
        return Response(
            {'error': '잘못된 로그인 요청입니다. 다시 로그인해 주세요.'},
            status=status.HTTP_400_BAD_REQUEST
        )
    
    # id_token의 decoded 내용을 사용 (이미 위에서 검증됨)
    decoded = decoded_id_token
    
    # ADFS 클레임 필드 매핑 (필드명: 설명) - 소문자 우선
    CLAIM_FIELDS = [
            ('sub', '토큰 Subject'),
            ('iss', '토큰 Issuer'),
            ('aud', '토큰 Audience'),
            ('exp', '만료 시간'),
            ('iat', '발급 시간'),
            ('nonce', 'Nonce'),
            # 소문자 클레임 (ADFS가 소문자로 반환)
            ('loginid', '로그인 ID'),
            ('username', '표시이름'),
            ('mail', '메일'),
            ('upn', 'UPN'),
            ('deptname', '부서명'),
            ('deptname_en', '영문 부서명'),
            ('username_en', '영어 이름'),
            ('busname', '사업장 이름'),
            ('grdname_en', '영문 직급'),
            ('surname', '성'),
            ('givenname', '이름'),
            # 대문자 클레임 (예비)
            ('LoginId', '로그인 ID (대문자)'),
            ('Username', '표시이름 (대문자)'),
            ('Mail', '메일 (대문자)'),
            ('DeptName', '부서명 (대문자)'),
            ('Surname', '성 (대문자)'),
            ('GivenName', '이름 (대문자)'),
        ]

    logger.info("[OIDC] ===== Token Claims Detail =====")
    for key, desc in CLAIM_FIELDS:
        value = decoded.get(key)
        if value is not None:
            # 리스트나 복잡한 객체는 문자열로 변환
            if isinstance(value, (list, dict)):
                value_str = json.dumps(value, ensure_ascii=False)
            else:
                value_str = str(value)
            logger.info(f"[OIDC] {desc} ({key}): {value_str}")
        else:
            logger.info(f"[OIDC] {desc} ({key}): (없음)")

    # 알 수 없는 클레임이 있으면 추가 출력
    known_keys = [f[0] for f in CLAIM_FIELDS]
    unknown_keys = set(decoded.keys()) - set(known_keys)
    if unknown_keys:
        logger.info(f"[OIDC] Unknown claims keys: {list(unknown_keys)}")
    
    # 사용자 생성/업데이트
    user = create_or_update_user_from_oidc(decoded)
    
    if not user:
        return Response(
            {'error': '사용자 생성에 실패했습니다.'},
            status=status.HTTP_400_BAD_REQUEST
        )
    
    # Django 세션 로그인
    user.backend = 'django.contrib.auth.backends.ModelBackend'
    login(request, user)
    
    # ============================================
    # 서비스용 JWT 토큰 생성 (id_token 클레임 기반)
    # ============================================
    service_jwt_secret = getattr(settings, 'SERVICE_JWT_SECRET_KEY', '')
    service_jwt_algorithm = getattr(settings, 'SERVICE_JWT_ALGORITHM', 'HS256')
    access_token_lifetime = getattr(settings, 'SERVICE_JWT_ACCESS_TOKEN_LIFETIME', timedelta(hours=12))
    refresh_token_lifetime = getattr(settings, 'SERVICE_JWT_REFRESH_TOKEN_LIFETIME', timedelta(days=7))
    
    if not service_jwt_secret:
        logger.error("[OIDC] SERVICE_JWT_SECRET_KEY is not configured")
        return Response(
            {'error': 'JWT 시크릿 키가 설정되지 않았습니다.'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )
    
    # id_token 클레임에서 사용자 정보 추출 (대소문자 구분)
    # loginid (소문자), LoginId (대문자), preferred_username, sub 순서로 확인
    username = decoded.get('loginid') or decoded.get('LoginId') or decoded.get('preferred_username') or decoded.get('sub', '')
    
    # base64 디코딩이 필요한 경우 (sub가 base64인 경우)
    import base64
    try:
        if username and '=' in username:
            # base64로 인코딩된 경우 디코딩 시도
            decoded_username = base64.b64decode(username).decode('utf-8')
            if decoded_username:
                username = decoded_username
    except Exception:
        pass  # 디코딩 실패 시 원본 사용
    
    token_payload = {
        'sub': decoded.get('sub', ''),
        'username': username,
        'email': decoded.get('mail') or decoded.get('Mail') or decoded.get('email') or decoded.get('upn', ''),
        'name': decoded.get('username') or decoded.get('Username') or decoded.get('name', ''),
        'given_name': decoded.get('givenname') or decoded.get('GivenName', ''),
        'family_name': decoded.get('surname') or decoded.get('Surname', ''),
        'department': decoded.get('deptname') or decoded.get('DeptName', ''),
        'company': decoded.get('compname') or decoded.get('CompName', ''),
        'source': 'internal-auth',  # 내부 인증 소스 표시
        'iat': datetime.utcnow(),
        'exp': datetime.utcnow() + access_token_lifetime,
    }
    
    # 서비스용 access_token 생성 (HS256)
    service_access_token = jwt.encode(token_payload, service_jwt_secret, algorithm=service_jwt_algorithm)
    
    # refresh_token_payload
    refresh_payload = {
        'sub': decoded.get('sub', ''),
        'username': username,
        'type': 'refresh',
        'iat': datetime.utcnow(),
        'exp': datetime.utcnow() + refresh_token_lifetime,
    }
    service_refresh_token = jwt.encode(refresh_payload, service_jwt_secret, algorithm=service_jwt_algorithm)
    
    logger.info(f"[OIDC] Login success: {user.loginid}, service token created")
    
    # ============================================
    # HttpOnly Cookie에 토큰 저장
    # ============================================
    callback_base_url = getattr(settings, 'OIDC_CALLBACK_BASE_URL', '')
    frontend_url = f"{callback_base_url}/"
    
    # JSON 요청인지 form_post 요청인지 확인
    # JSON 요청인 경우 (프론트엔드에서 전송), JSON 응답 반환
    # form_post인 경우 (ADFS에서 직접 전송), 리다이렉트 응답 반환
    is_json_request = request.content_type and 'application/json' in request.content_type
    
    if is_json_request:
        # JSON 응답 (프론트엔드에서 호출한 경우)
        response = Response({
            'success': True,
            'redirect_url': frontend_url,
            'user': user_to_dict(user),
        })
    else:
        # 리다이렉트 응답 (ADFS에서 직접 호출한 경우)
        response = HttpResponseRedirect(frontend_url)
    
    # Cookie 설정 (공통)
    response.set_cookie(
        key='access_token',
        value=service_access_token,
        httponly=True,
        secure=True,
        samesite='Lax',
        max_age=access_token_lifetime.total_seconds(),
        path='/',
    )
    
    response.set_cookie(
        key='refresh_token',
        value=service_refresh_token,
        httponly=True,
        secure=True,
        samesite='Lax',
        max_age=refresh_token_lifetime.total_seconds(),
        path='/',
    )
    
    return response


@api_view(['POST'])
@authentication_classes([])  # 잘못된/만료된 쿠키가 있어도 로그아웃(쿠키 삭제)은 가능해야 함
@permission_classes([AllowAny])  # AllowAny: 토큰이 없어도 로그아웃은 가능해야 함
def oidc_logout(request):
    """
    POST /api/auth/oidc/logout/
    ADFS 로그아웃 및 Django 세션 종료, Cookie 삭제
    """
    # Django 세션 로그아웃
    logout(request)
    
    # Cookie 삭제
    logout_url = getattr(settings, 'OIDC_OP_LOGOUT_ENDPOINT', '')
    
    response = Response({
        'message': '로그아웃되었습니다.',
        'logout_url': logout_url,
    })
    
    # Cookie 삭제 (max_age=0으로 설정)
    response.set_cookie(
        key='access_token',
        value='',
        httponly=True,
        secure=True,
        samesite='Lax',
        max_age=0,
        path='/',
    )
    
    response.set_cookie(
        key='refresh_token',
        value='',
        httponly=True,
        secure=True,
        samesite='Lax',
        max_age=0,
        path='/',
    )

    return response


