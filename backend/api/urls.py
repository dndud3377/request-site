from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    RequestDocumentViewSet, VOCViewSet, LineViewSet, AdminNoticeViewSet,
)
from .auth_views import login_view, me_view

router = DefaultRouter()
router.register(r'documents', RequestDocumentViewSet, basename='document')
router.register(r'voc', VOCViewSet, basename='voc')
router.register(r'lines', LineViewSet, basename='line')
router.register(r'notices', AdminNoticeViewSet, basename='notice')

urlpatterns = [
    path('', include(router.urls)),
    path('auth/login/', login_view),
    path('auth/me/', me_view),
]
