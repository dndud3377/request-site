from django.contrib import admin
from .models import UserProfile, RequestDocument, ApprovalStep, VOC, Line, AdminNotice


class ApprovalStepInline(admin.TabularInline):
    model = ApprovalStep
    extra = 0
    fields = ['agent', 'action', 'is_parallel', 'assignee_name', 'comment', 'acted_at']
    readonly_fields = ['acted_at']


@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    list_display = ['display_name', 'role', 'department', 'user']
    list_filter = ['role']


@admin.register(RequestDocument)
class RequestDocumentAdmin(admin.ModelAdmin):
    list_display = ['title', 'requester_name', 'product_name', 'status', 'created_at']
    list_filter = ['status']
    search_fields = ['title', 'product_name', 'requester_name']
    inlines = [ApprovalStepInline]
    readonly_fields = ['created_at', 'updated_at', 'submitted_at']


@admin.register(ApprovalStep)
class ApprovalStepAdmin(admin.ModelAdmin):
    list_display = ['document', 'agent', 'action', 'is_parallel', 'assignee_name', 'acted_at']
    list_filter = ['agent', 'action']


@admin.register(VOC)
class VOCAdmin(admin.ModelAdmin):
    list_display = ['title', 'category', 'submitter_name', 'status', 'created_at']
    list_filter = ['category', 'status']
    search_fields = ['title', 'submitter_name']


@admin.register(Line)
class LineAdmin(admin.ModelAdmin):
    list_display = ['name', 'order', 'is_active']
    list_editable = ['order', 'is_active']
    ordering = ['order', 'name']


@admin.register(AdminNotice)
class AdminNoticeAdmin(admin.ModelAdmin):
    list_display = ['title', 'template', 'date', 'created_at']
    list_filter = ['template', 'date']
    ordering = ['-date', '-created_at']
