from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    RequestDocumentViewSet, VOCViewSet, LineViewSet, AdminNoticeViewSet, VocHistoryViewSet,
    UserViewSet,
    health_check, upload_image,
    form_options_process, form_options_products, form_options_process_id,
    form_options_job_file_layer, form_options_ovl_layer, form_options_bb_external,
)
from .auth_views import login_view, me_view, refresh_token_view, oidc_login_init, oidc_callback, oidc_logout, dev_login_view

router = DefaultRouter()
router.register(r'documents', RequestDocumentViewSet, basename='document')
router.register(r'voc', VOCViewSet, basename='voc')
router.register(r'voc-histories', VocHistoryViewSet, basename='voc-history')
router.register(r'lines', LineViewSet, basename='line')
router.register(r'notices', AdminNoticeViewSet, basename='notice')
router.register(r'users', UserViewSet, basename='user')

urlpatterns = [
    path('', include(router.urls)),
    path('health/', health_check),
    path('upload-image/', upload_image),
    path('auth/login/', login_view),
    path('auth/dev-login/', dev_login_view),
    path('auth/me/', me_view),
    path('auth/refresh/', refresh_token_view),
    # OIDC SSO 로그인 (form_post 모드)
    path('auth/oidc/login/', oidc_login_init, name='oidc_login'),
    path('auth/oidc/callback/', oidc_callback, name='oidc_callback'),
    path('auth/oidc/logout/', oidc_logout, name='oidc_logout'),
    path('form-options/processes/', form_options_process),
    path('form-options/products/', form_options_products),
    path('form-options/process-id/', form_options_process_id),
    path('form-options/job-file-layer/', form_options_job_file_layer),
    path('form-options/ovl-layer/', form_options_ovl_layer),
    path('form-options/bb-external/', form_options_bb_external),
]
