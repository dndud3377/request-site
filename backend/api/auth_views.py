from django.contrib.auth import login, logout, get_user_model
from django.conf import settings
from django.views.decorators.csrf import csrf_exempt
from django.utils.decorators import method_decorator
from django.http import HttpResponseRedirect, HttpResponse
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework import status
from datetime import datetime, timedelta
import hmac
import logging
import jwt
import json
import uuid
from jwt.exceptions import ExpiredSignatureError, InvalidTokenError, PyJWKClientError

User = get_user_model()

logger = logging.getLogger(__name__)

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
    # loginid 만 신뢰한다. preferred_username/sub 로 대체하면 엉뚱한 계정이 조용히 생성된다.
    login_id = claims.get(OIDC_LOGIN_ID_CLAIM)
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


# 로그인 시작 → 콜백 사이에 state·nonce 를 브라우저에 묶어 두는 쿠키.
# ADFS form_post 는 cross-site POST 라 SameSite=Lax 쿠키가 따라오지 않으므로 None(+Secure) 이어야 한다.
OIDC_STATE_COOKIE_NAME = 'oidc_auth_state'
OIDC_STATE_LIFETIME = timedelta(minutes=10)
OIDC_STATE_COOKIE_SAMESITE = 'None'

# id_token 검증: ADFS 와 서버 간 시계 오차 허용치, 필수 클레임
OIDC_CLOCK_LEEWAY_SECONDS = 60
OIDC_ID_TOKEN_ALGORITHMS = ['RS256']
OIDC_REQUIRED_CLAIMS = ['exp', 'iat', 'iss', 'aud', 'nonce']
OIDC_LOGIN_ID_CLAIM = 'loginid'

# 모드와 무관하게 콜백이 노출되므로, 하나라도 비면 검증을 건너뛰지 않고 로그인을 차단한다(fail-closed).
OIDC_REQUIRED_SETTINGS = ['OIDC_OP_ISSUER', 'OIDC_RP_CLIENT_ID', 'OIDC_OP_JWKS_ENDPOINT']

_jwks_clients = {}


def get_jwks_client(jwks_uri):
    """
    JWKS 엔드포인트별 PyJWKClient 를 재사용한다.
    클라이언트가 키 목록을 캐시하고, 모르는 kid 가 오면 다시 받아오므로 ADFS 인증서 교체에도 대응한다.
    """
    client = _jwks_clients.get(jwks_uri)
    if client is None:
        client = jwt.PyJWKClient(jwks_uri)
        _jwks_clients[jwks_uri] = client
    return client


def same_value(received, expected):
    """타이밍 공격에 안전하게 비교한다. 비ASCII·비문자열 입력도 500 없이 불일치로 처리한다."""
    return hmac.compare_digest(str(received).encode(), str(expected).encode())


def missing_oidc_settings():
    """비어 있는 필수 OIDC 설정 이름 목록을 반환한다."""
    return [name for name in OIDC_REQUIRED_SETTINGS if not getattr(settings, name, '')]


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
@permission_classes([AllowAny])
def oidc_login_init(request):
    """
    GET /api/auth/oidc/login/
    ADFS로 리다이렉트하기 위한 초기화 엔드포인트
    response_mode=form_post, response_type=id_token 사용

    state·nonce 를 서명해 HttpOnly 쿠키(OIDC_STATE_COOKIE_NAME)에 담는다.
    콜백에서 이 쿠키와 form 의 state, id_token 의 nonce 를 비교해 로그인 CSRF·토큰 주입을 막는다.
    """
    state_val = str(uuid.uuid4())
    nonce_val = str(uuid.uuid4())

    state_cookie = jwt.encode(
        {
            'state': state_val,
            'nonce': nonce_val,
            'exp': datetime.utcnow() + OIDC_STATE_LIFETIME,
        },
        settings.SECRET_KEY,
        algorithm='HS256',
    )
    
    # ADFS 인증 URL 생성
    idp_url = getattr(settings, 'OIDC_OP_AUTHORIZATION_ENDPOINT', '')
    client_id = getattr(settings, 'OIDC_RP_CLIENT_ID', '')
    callback_url = getattr(settings, 'OIDC_CALLBACK_BASE_URL', '')
    
    # Redirect URI를 프론트엔드 콜백 페이지로 설정 (form_post 모드)
    redirect_uri = f"{callback_url}/oidc-callback"
    
    # OIDC 인증 파라미터
    auth_param = f"?client_id={client_id}"
    auth_param += f"&redirect_uri={redirect_uri}"
    auth_param += "&response_mode=form_post"
    auth_param += "&response_type=id_token"
    auth_param += "&scope=openid+profile"
    auth_param += f"&nonce={nonce_val}"
    auth_param += f"&state={state_val}"
    
    auth_url_with_params = f"{idp_url}{auth_param}"
    
    logger.info(f"[OIDC] Login init - redirect_uri: {redirect_uri}, nonce: {nonce_val}")
    
    response = Response({'redirect_url': auth_url_with_params})
    response.set_cookie(
        key=OIDC_STATE_COOKIE_NAME,
        value=state_cookie,
        httponly=True,
        secure=True,
        samesite=OIDC_STATE_COOKIE_SAMESITE,
        max_age=OIDC_STATE_LIFETIME.total_seconds(),
        path='/',
    )
    return response


@api_view(['POST'])
@permission_classes([AllowAny])
@csrf_exempt
def oidc_callback(request):
    """
    POST /api/auth/oidc/callback/
    ADFS로부터 반환된 인증 처리 (response_mode=form_post)
    id_token을 직접 검증하여 사용자 인증
    """
    from django.contrib.auth import get_user_model
    import requests
    
    User = get_user_model()
    
    missing = missing_oidc_settings()
    if missing:
        logger.error(f"[OIDC] Login blocked - required settings are empty: {', '.join(missing)}")
        return Response(
            {'error': 'SSO 설정이 누락되어 로그인할 수 없습니다.'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )

    # form_post (application/x-www-form-urlencoded) 또는 JSON 형식 지원
    id_token_val = request.POST.get('id_token') or request.data.get('id_token')
    state_val = request.POST.get('state') or request.data.get('state') or ''
    
    if not id_token_val:
        logger.error("[OIDC] No id_token received")
        return Response(
            {'error': 'ID 토큰이 없습니다.'},
            status=status.HTTP_400_BAD_REQUEST
        )

    # 이 브라우저가 시작한 로그인인지 확인 (state 쿠키 ↔ form state)
    state_cookie = request.COOKIES.get(OIDC_STATE_COOKIE_NAME)
    if not state_cookie:
        logger.error("[OIDC] State cookie missing - login was not started from this browser or expired")
        return Response(
            {'error': '로그인 요청 정보가 없거나 만료되었습니다. 다시 로그인해 주세요.'},
            status=status.HTTP_400_BAD_REQUEST
        )
    try:
        saved_state = jwt.decode(state_cookie, settings.SECRET_KEY, algorithms=['HS256'])
    except InvalidTokenError as e:
        logger.error(f"[OIDC] State cookie invalid: {e}")
        return Response(
            {'error': '로그인 요청 정보가 없거나 만료되었습니다. 다시 로그인해 주세요.'},
            status=status.HTTP_400_BAD_REQUEST
        )
    if not same_value(state_val, saved_state.get('state', '')):
        logger.error("[OIDC] State mismatch")
        return Response(
            {'error': '로그인 요청 정보가 일치하지 않습니다. 다시 로그인해 주세요.'},
            status=status.HTTP_400_BAD_REQUEST
        )

    # ADFS JWKS 에서 id_token 헤더의 kid 에 맞는 서명 키를 찾는다
    try:
        signing_key = get_jwks_client(settings.OIDC_OP_JWKS_ENDPOINT).get_signing_key_from_jwt(id_token_val)
    except (PyJWKClientError, InvalidTokenError) as e:
        logger.error(f"[OIDC] Signing key lookup failed (JWKS): {e}")
        return Response(
            {'error': '인증 토큰이 유효하지 않습니다.'},
            status=status.HTTP_401_UNAUTHORIZED
        )

    # 서명·만료·발급자(iss)·대상(aud) 검증
    try:
        decoded = jwt.decode(
            id_token_val,
            key=signing_key.key,
            algorithms=OIDC_ID_TOKEN_ALGORITHMS,
            audience=settings.OIDC_RP_CLIENT_ID,
            issuer=settings.OIDC_OP_ISSUER,
            leeway=OIDC_CLOCK_LEEWAY_SECONDS,
            options={'require': OIDC_REQUIRED_CLAIMS},
        )
    except InvalidTokenError as e:
        logger.error(f"[OIDC] Invalid ID token: {e}")
        return Response(
            {'error': '인증 토큰이 유효하지 않습니다.'},
            status=status.HTTP_401_UNAUTHORIZED
        )

    # 로그인 시작 때 보낸 nonce 로 발급된 토큰인지 확인 (토큰 재사용·주입 방지)
    if not same_value(decoded.get('nonce', ''), saved_state.get('nonce', '')):
        logger.error("[OIDC] Nonce mismatch")
        return Response(
            {'error': '로그인 요청 정보가 일치하지 않습니다. 다시 로그인해 주세요.'},
            status=status.HTTP_400_BAD_REQUEST
        )

    if not decoded.get(OIDC_LOGIN_ID_CLAIM):
        logger.error(f"[OIDC] Required claim '{OIDC_LOGIN_ID_CLAIM}' missing in id_token")
        return Response(
            {'error': '인증 토큰에 로그인 ID가 없습니다.'},
            status=status.HTTP_400_BAD_REQUEST
        )
    
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
    
    # 서비스 토큰의 username 은 DB 의 loginid 와 같아야 CookieJWTAuthentication 이 사용자를 찾는다
    username = user.loginid
    
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

    # state·nonce 는 1회용
    response.delete_cookie(OIDC_STATE_COOKIE_NAME, path='/', samesite=OIDC_STATE_COOKIE_SAMESITE)
    
    return response


@api_view(['POST'])
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


