from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import RequestDocumentViewSet, ApprovalStepViewSet, VOCViewSet, RFGViewSet

router = DefaultRouter()
router.register(r'documents', RequestDocumentViewSet, basename='document')
router.register(r'approval-steps', ApprovalStepViewSet, basename='approval-step')
router.register(r'voc', VOCViewSet, basename='voc')
router.register(r'rfg', RFGViewSet, basename='rfg')

urlpatterns = [
    path('', include(router.urls)),
]
