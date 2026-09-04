from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import EmailVerificationRequest, PasswordResetRequest, SentinelUser, SessionToken


@admin.register(SentinelUser)
class SentinelUserAdmin(UserAdmin):
    list_display = ("username", "email", "role", "email_verified", "is_superuser", "is_staff")
    list_filter = ("role", "email_verified", "is_staff", "is_superuser")
    fieldsets = UserAdmin.fieldsets + (
        ("Sentinel", {"fields": ("role", "email_verified", "merchant_scope_ids", "created_at", "updated_at")}),
    )
    readonly_fields = ("created_at", "updated_at", "last_login")


@admin.register(SessionToken)
class SessionTokenAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "created_at", "expires_at", "revoked_at")
    search_fields = ("user__username", "user__email", "key")
    readonly_fields = ("created_at", "updated_at")


@admin.register(EmailVerificationRequest)
class EmailVerificationRequestAdmin(admin.ModelAdmin):
    list_display = ("request_id", "user", "code", "created_at", "expires_at", "used_at")
    search_fields = ("request_id", "user__username", "user__email", "code")


@admin.register(PasswordResetRequest)
class PasswordResetRequestAdmin(admin.ModelAdmin):
    list_display = ("request_id", "user", "code", "created_at", "expires_at", "used_at")
    search_fields = ("request_id", "user__username", "user__email", "code")
