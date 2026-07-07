from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    RequestDocumentViewSet, VOCViewSet, LineViewSet, AdminNoticeViewSet, VocHistoryViewSet,
    UserViewSet, GuideViewSet, UserGroupViewSet, AddressBookViewSet,
    health_check, upload_image, upload_video, user_events,
    form_options_process, form_options_products, form_options_process_id,
    form_options_job_file_layer, form_options_ovl_layer, form_options_bb_external,
    form_options_layer_ids, form_options_barcode, form_options_mapname,
)
from .auth_views import me_view, refresh_token_view, oidc_login_init, oidc_callback, oidc_logout
from .auth_views_dev import dev_login_view

router = DefaultRouter()
router.register(r'documents', RequestDocumentViewSet, basename='document')
router.register(r'voc', VOCViewSet, basename='voc')
router.register(r'voc-histories', VocHistoryViewSet, basename='voc-history')
router.register(r'lines', LineViewSet, basename='line')
router.register(r'notices', AdminNoticeViewSet, basename='notice')
router.register(r'users', UserViewSet, basename='user')
router.register(r'guides', GuideViewSet, basename='guide')
router.register(r'user-groups', UserGroupViewSet, basename='user-group')
router.register(r'address-books', AddressBookViewSet, basename='address-book')

urlpatterns = [
    path('users/events/', user_events, name='user-events'),
    path('', include(router.urls)),
    path('health/', health_check),
    path('upload-image/', upload_image),
    path('upload-video/', upload_video),
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
    path('form-options/layer-ids/', form_options_layer_ids),
    path('form-options/barcode/', form_options_barcode),
    path('form-options/map-names/', form_options_mapname),
]
