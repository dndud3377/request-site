from django.urls import path, include
from django.conf import settings

from api.views import serve_media

# claude 수정 (2026-10-23): Django admin 경로 제거 — 사용하지 않고 구조적으로 사용 불가(사용자 확인)인데 외부에 로그인 화면만 노출됐다
urlpatterns = [
    path('api/', include('api.urls')),
    # claude 수정 (2026-10-23): /media/ 를 static()(DEBUG 전용·무인증) 대신 인증 뷰로 서빙한다 (B-34)
    path(f"{settings.MEDIA_URL.strip('/')}/<path:path>", serve_media, name='serve-media'),
]
