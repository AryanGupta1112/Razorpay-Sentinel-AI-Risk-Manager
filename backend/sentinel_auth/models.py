from __future__ import annotations

import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.models import AbstractUser
from django.db import models
from django.utils import timezone


class SentinelRole(models.TextChoices):
    PLATFORM_ADMIN = "platform_admin", "Platform Admin"
    RISK_LEAD = "risk_lead", "Risk Lead"
    FRAUD_OPS_ANALYST = "fraud_ops_analyst", "Fraud Ops Analyst"
    MERCHANT_RISK_ANALYST = "merchant_risk_analyst", "Merchant Risk Analyst"


class SentinelUser(AbstractUser):
    email = models.EmailField(unique=True)
    role = models.CharField(max_length=32, choices=SentinelRole.choices, default=SentinelRole.FRAUD_OPS_ANALYST)
    email_verified = models.BooleanField(default=False)
    merchant_scope_ids = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def save(self, *args, **kwargs):
        self.username = self.username.lower()
        self.email = self.email.lower()
        if self.is_superuser:
            self.role = SentinelRole.PLATFORM_ADMIN
            self.email_verified = True
        super().save(*args, **kwargs)


class SessionToken(models.Model):
    key = models.CharField(max_length=64, unique=True)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="session_tokens")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    @classmethod
    def issue(cls, user: SentinelUser) -> tuple["SessionToken", str]:
        raw_token = secrets.token_urlsafe(32)
        session = cls.objects.create(
            key=raw_token,
            user=user,
            expires_at=timezone.now() + timedelta(hours=settings.SENTINEL_TOKEN_TTL_HOURS),
        )
        return session, raw_token

    def is_active(self) -> bool:
        return self.revoked_at is None and self.expires_at > timezone.now()


class EmailVerificationRequest(models.Model):
    request_id = models.CharField(max_length=64, unique=True)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="verification_requests",
    )
    code = models.CharField(max_length=12, db_index=True)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=["user", "-created_at"]),
            models.Index(fields=["code"]),
            models.Index(fields=["request_id"]),
        ]
        ordering = ["-created_at"]


class PasswordResetRequest(models.Model):
    request_id = models.CharField(max_length=64, unique=True)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="password_reset_requests",
    )
    code = models.CharField(max_length=12, db_index=True)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=["user", "-created_at"]),
            models.Index(fields=["code"]),
            models.Index(fields=["request_id"]),
        ]
        ordering = ["-created_at"]
