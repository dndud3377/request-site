# 백엔드 구현 명세 — 권한 관리 API

이 파일은 프론트엔드의 `/permissions` 페이지가 연동할 백엔드 API 구현 명세입니다.
Claude Code가 직접 구현하지 않으므로, 이 명세를 바탕으로 외부에서 구현하세요.

---

## 1. 모델 변경 (`api/models.py`)

`UserProfile` 모델에 `loginid` 필드를 추가합니다.

```python
# api/models.py
class UserProfile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile')
    loginid = models.CharField(max_length=100, blank=True, unique=True, null=True)
    # ... 기존 필드들
```

> **마이그레이션**: `python manage.py makemigrations && python manage.py migrate`

---

## 2. Serializer (`api/serializers.py`)

```python
from rest_framework import serializers
from django.contrib.auth.models import User
from .models import UserProfile

class UserListSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(source='user.id')
    loginid = serializers.CharField()
    name = serializers.CharField(source='display_name')   # 또는 user.get_full_name()
    department = serializers.CharField()
    role = serializers.CharField()
    email = serializers.EmailField(source='user.email', required=False)

    class Meta:
        model = UserProfile
        fields = ['id', 'loginid', 'name', 'department', 'role', 'email']
```

---

## 3. Permission 클래스 (`api/views.py` 또는 `api/permissions.py`)

```python
from rest_framework.permissions import BasePermission

class IsSameRoleOrMaster(BasePermission):
    """
    - MASTER: 모든 사용자에 대해 추가/삭제 가능
    - 그 외 역할: 자신의 역할과 동일한 사용자만 추가/삭제 가능
    - 조회(GET)는 인증된 모든 사용자 가능
    """

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        if request.method in ('GET', 'HEAD', 'OPTIONS'):
            return True
        profile = getattr(request.user, 'profile', None)
        if not profile:
            return False
        return True  # object-level에서 역할 검사

    def has_object_permission(self, request, view, obj):
        if request.method in ('GET', 'HEAD', 'OPTIONS'):
            return True
        requester_profile = getattr(request.user, 'profile', None)
        if not requester_profile:
            return False
        if requester_profile.role == 'MASTER':
            return True
        # obj는 UserProfile 인스턴스
        return obj.role == requester_profile.role
```

`POST` (생성) 시 역할 검사는 `perform_create`에서 처리합니다 (아래 ViewSet 참고).

---

## 4. ViewSet (`api/views.py`)

```python
from rest_framework import viewsets, status
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.contrib.auth.models import User
from .models import UserProfile
from .serializers import UserListSerializer
from .permissions import IsSameRoleOrMaster  # 또는 같은 파일에 정의

class UserManagementViewSet(viewsets.ModelViewSet):
    serializer_class = UserListSerializer
    permission_classes = [IsAuthenticated, IsSameRoleOrMaster]
    http_method_names = ['get', 'post', 'delete', 'head', 'options']

    def get_queryset(self):
        return UserProfile.objects.select_related('user').all()

    def create(self, request, *args, **kwargs):
        """
        POST /api/users/
        body: { loginid, name, department, role }
        """
        requester_profile = getattr(request.user, 'profile', None)
        target_role = request.data.get('role')

        # 역할 권한 검사
        if requester_profile and requester_profile.role != 'MASTER':
            if target_role != requester_profile.role:
                return Response(
                    {'detail': '자신의 역할과 동일한 사용자만 추가할 수 있습니다.'},
                    status=status.HTTP_403_FORBIDDEN,
                )

        loginid = request.data.get('loginid')
        name = request.data.get('name', '')
        department = request.data.get('department', '')

        if not loginid:
            return Response({'detail': 'loginid는 필수입니다.'}, status=status.HTTP_400_BAD_REQUEST)

        # Django User 생성 (OpenID이므로 비밀번호 불필요 — unusable password 설정)
        user = User.objects.create(username=loginid, email='')
        user.set_unusable_password()
        user.save()

        profile = UserProfile.objects.create(
            user=user,
            loginid=loginid,
            display_name=name,  # 실제 필드명에 맞게 수정
            department=department,
            role=target_role,
        )

        serializer = self.get_serializer(profile)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    def destroy(self, request, *args, **kwargs):
        """
        DELETE /api/users/{id}/
        """
        profile = self.get_object()  # has_object_permission 호출됨

        # 자기 자신은 삭제 불가
        if profile.user == request.user:
            return Response({'detail': '자기 자신은 삭제할 수 없습니다.'}, status=status.HTTP_400_BAD_REQUEST)

        profile.user.delete()  # cascade로 UserProfile도 삭제
        return Response(status=status.HTTP_204_NO_CONTENT)
```

---

## 5. URL 등록 (`api/urls.py`)

```python
from rest_framework.routers import DefaultRouter
from .views import UserManagementViewSet

router = DefaultRouter()
# ... 기존 라우터 등록들
router.register(r'users', UserManagementViewSet, basename='user')

urlpatterns = [
    path('', include(router.urls)),
    # ...
]
```

---

## 6. API 엔드포인트 요약

| Method | URL | 권한 | 설명 |
|--------|-----|------|------|
| GET | `/api/users/` | 인증된 모든 사용자 | 전체 사용자 목록 반환 |
| POST | `/api/users/` | 동일 역할 or MASTER | 사용자 생성 |
| DELETE | `/api/users/{id}/` | 동일 역할 or MASTER | 사용자 삭제 |

### GET `/api/users/` 응답 예시

```json
[
  {
    "id": 1,
    "loginid": "hong.gildong",
    "name": "홍길동",
    "department": "AGENT R팀",
    "role": "TE_R",
    "email": "hong@company.com"
  }
]
```

### POST `/api/users/` 요청 body

```json
{
  "loginid": "new.user",
  "name": "신규사용자",
  "department": "AGENT R팀",
  "role": "TE_R"
}
```

---

## 주의사항

- 응답은 배열(`[]`) 또는 DRF 기본 페이지네이션(`{ count, results }`) 중 하나여야 합니다.
  프론트엔드 `usersAPI.list()`는 두 형태 모두 처리합니다.
- 삭제 성공 시 `204 No Content` 반환
- 권한 위반 시 `403 Forbidden` 반환
- `loginid` 중복 시 `400 Bad Request` 반환 권장
