"""
Accounts app URL configuration.
"""
from django.urls import path
from .views import (
    login_view, me_view, refresh_token_view,
    oidc_login_init, oidc_callback, oidc_logout,
    # Development only views
    dev_login_view, dev_users_list, dev_users_by_role,
)

urlpatterns = [
    # Production (SSO)
    path('login/', login_view),
    path('me/', me_view),
    path('refresh/', refresh_token_view),
    path('oidc/login/', oidc_login_init, name='oidc_login'),
    path('oidc/callback/', oidc_callback, name='oidc_callback'),
    path('oidc/logout/', oidc_logout, name='oidc_logout'),
    
    # Development only (Mock)
    path('dev/login/', dev_login_view, name='dev_login'),
    path('dev/users/', dev_users_list, name='dev_users'),
    path('dev/users/<str:role>/', dev_users_by_role, name='dev_users_by_role'),
]
