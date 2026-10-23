from django.contrib import admin
from django.urls import path, include
from django.conf import settings

from api.views import serve_media

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include('api.urls')),
    # claude 수정 (2026-10-23): /media/ 를 static()(DEBUG 전용·무인증) 대신 인증 뷰로 서빙한다 (B-34)
    path(f"{settings.MEDIA_URL.strip('/')}/<path:path>", serve_media, name='serve-media'),
]
