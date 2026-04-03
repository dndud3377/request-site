from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    RequestDocumentViewSet, VOCViewSet, LineViewSet,
    form_options_combinations, form_options_products, form_options_process_id,
)
from .auth_views import login_view, me_view

router = DefaultRouter()
router.register(r'documents', RequestDocumentViewSet, basename='document')
router.register(r'voc', VOCViewSet, basename='voc')
router.register(r'lines', LineViewSet, basename='line')

urlpatterns = [
    path('', include(router.urls)),
    path('auth/login/', login_view),
    path('auth/me/', me_view),
    path('form-options/combinations/', form_options_combinations),
    path('form-options/products/', form_options_products),
    path('form-options/process-id/', form_options_process_id),
]
