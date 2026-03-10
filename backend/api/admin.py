from django.contrib import admin
from .models import RequestDocument, ApprovalStep, VOC, RFG


class ApprovalStepInline(admin.TabularInline):
    model = ApprovalStep
    extra = 0


@admin.register(RequestDocument)
class RequestDocumentAdmin(admin.ModelAdmin):
    list_display = ['title', 'requester_name', 'product_name', 'product_type', 'status', 'priority', 'created_at']
    list_filter = ['status', 'product_type', 'map_type', 'priority']
    search_fields = ['title', 'product_name', 'requester_name']
    inlines = [ApprovalStepInline]
    readonly_fields = ['created_at', 'updated_at', 'submitted_at']


@admin.register(ApprovalStep)
class ApprovalStepAdmin(admin.ModelAdmin):
    list_display = ['document', 'step_order', 'approver_name', 'action', 'acted_at']
    list_filter = ['action']


@admin.register(VOC)
class VOCAdmin(admin.ModelAdmin):
    list_display = ['title', 'category', 'submitter_name', 'status', 'created_at']
    list_filter = ['category', 'status']
    search_fields = ['title', 'submitter_name']


@admin.register(RFG)
class RFGAdmin(admin.ModelAdmin):
    list_display = ['title', 'requester_name', 'product_name', 'status', 'created_at']
    list_filter = ['status']
    search_fields = ['title', 'requester_name', 'product_name']
