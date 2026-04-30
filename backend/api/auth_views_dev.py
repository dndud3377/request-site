from django.contrib.auth import get_user_model
from django.conf import settings
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework import status
from rest_framework_simplejwt.tokens import RefreshToken
import logging

from .auth_views import user_to_dict

User = get_user_model()

logger = logging.getLogger(__name__)


@api_view(['POST'])
@permission_classes([AllowAny])
def dev_login_view(request):
    """
    POST /api/auth/dev-login/
    { username } → { access, refresh, user }

    AUTH_MODE=dev 환경에서만 동작. password 없이 username만으로 로그인.
    운영(AUTH_MODE=sso)에서 호출 시 403 반환.
    """
    if settings.AUTH_MODE != 'dev':
        return Response({'error': 'Not available in this environment'}, status=status.HTTP_403_FORBIDDEN)

    username = request.data.get('username', '').strip()
    if not username:
        return Response({'error': 'username을 입력해주세요.'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        user = User.objects.get(username=username)
    except User.DoesNotExist:
        return Response({'error': f'사용자를 찾을 수 없습니다: {username}'}, status=status.HTTP_404_NOT_FOUND)

    refresh = RefreshToken.for_user(user)
    logger.info(f"[DEV] Dev login: {username} ({getattr(user, 'role', 'NONE')})")
    return Response({
        'access': str(refresh.access_token),
        'refresh': str(refresh),
        'user': user_to_dict(user),
    })
