from django.contrib.auth import authenticate
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework import status
from rest_framework_simplejwt.tokens import RefreshToken


def user_to_dict(user):
    """User 객체를 프론트엔드 MockUser 형식으로 변환"""
    profile = getattr(user, 'profile', None)
    return {
        'id': user.id,
        'username': user.username,
        'name': profile.display_name if profile else user.get_full_name() or user.username,
        'role': profile.role if profile else 'PL',
        'department': profile.department if profile else '',
        'email': user.email,
    }


@api_view(['POST'])
@permission_classes([AllowAny])
def login_view(request):
    """
    POST /api/auth/login/
    { username, password } → { access, refresh, user }
    """
    username = request.data.get('username', '').strip()
    password = request.data.get('password', '').strip()

    if not username or not password:
        return Response(
            {'error': '아이디와 비밀번호를 입력해주세요.'},
            status=status.HTTP_400_BAD_REQUEST
        )

    user = authenticate(request, username=username, password=password)
    if not user:
        return Response(
            {'error': '아이디 또는 비밀번호가 올바르지 않습니다.'},
            status=status.HTTP_401_UNAUTHORIZED
        )

    refresh = RefreshToken.for_user(user)
    return Response({
        'access': str(refresh.access_token),
        'refresh': str(refresh),
        'user': user_to_dict(user),
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def me_view(request):
    """
    GET /api/auth/me/
    Authorization: Bearer <token> → { user }
    """
    return Response({'user': user_to_dict(request.user)})
