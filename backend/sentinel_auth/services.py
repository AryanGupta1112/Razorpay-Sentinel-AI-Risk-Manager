from __future__ import annotations

import secrets
from datetime import timedelta
from typing import Iterable

from django.conf import settings
from django.contrib.auth import authenticate, get_user_model
from django.core.exceptions import ValidationError
from django.core.mail import send_mail
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from .models import EmailVerificationRequest, PasswordResetRequest, SentinelRole, SessionToken


User = get_user_model()


class AuthServiceError(Exception):
    def __init__(self, message: str, status: int, code: str, details: dict | None = None):
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code
        self.details = details or {}


def role_label(role: str) -> str:
    if role == SentinelRole.PLATFORM_ADMIN:
        return "Platform Admin"
    if role == SentinelRole.RISK_LEAD:
        return "Risk Lead"
    if role == SentinelRole.FRAUD_OPS_ANALYST:
        return "Fraud Ops Analyst"
    return "Merchant Risk Analyst"


def capabilities_for_role(role: str) -> dict[str, bool]:
    return {
        "canReviewAlerts": True,
        "canManageMerchantOverrides": role
        in {SentinelRole.PLATFORM_ADMIN, SentinelRole.RISK_LEAD, SentinelRole.MERCHANT_RISK_ANALYST},
        "canUseCopilot": role != SentinelRole.MERCHANT_RISK_ANALYST,
        "canAccessControlRoom": role != SentinelRole.MERCHANT_RISK_ANALYST,
        "canAccessSimulator": role != SentinelRole.MERCHANT_RISK_ANALYST,
        "canEditSimulator": role in {SentinelRole.PLATFORM_ADMIN, SentinelRole.RISK_LEAD},
        "canPromotePolicy": role in {SentinelRole.PLATFORM_ADMIN, SentinelRole.RISK_LEAD},
        "canAdminUsers": role == SentinelRole.PLATFORM_ADMIN,
        "canManageSystem": role == SentinelRole.PLATFORM_ADMIN,
    }


def normalize_scope_ids(scope_ids: Iterable[str] | None) -> list[str]:
    return [scope_id.strip().upper() for scope_id in (scope_ids or []) if scope_id and scope_id.strip()]


def serialize_user(user) -> dict:
    effective_role = str(SentinelRole.PLATFORM_ADMIN if user.is_superuser else user.role)
    return {
        "id": str(user.id),
        "username": user.username,
        "email": user.email,
        "role": effective_role,
        "roleLabel": role_label(effective_role),
        "emailVerified": user.email_verified,
        "isSuperuser": user.is_superuser,
        "merchantScopeIds": normalize_scope_ids(user.merchant_scope_ids),
        "createdAt": user.created_at.isoformat(),
        "updatedAt": user.updated_at.isoformat(),
        "lastLoginAt": user.last_login.isoformat() if user.last_login else None,
        "capabilities": capabilities_for_role(effective_role),
    }


def requires_email_verification(user) -> bool:
    if not settings.SENTINEL_REQUIRE_VERIFICATION_FOR_NON_ADMINS:
        return False
    if user.is_superuser:
        return False
    return not user.email_verified


def generate_code() -> str:
    return f"{secrets.randbelow(900000) + 100000:06d}"


def send_sentinel_email(subject: str, body: str, recipient: str) -> None:
    if not settings.DEBUG and settings.EMAIL_BACKEND.endswith("console.EmailBackend"):
        raise AuthServiceError(
            "Email delivery is not configured for this environment.",
            503,
            "EMAIL_DELIVERY_NOT_CONFIGURED",
        )

    try:
        send_mail(subject, body, settings.DEFAULT_FROM_EMAIL, [recipient], fail_silently=False)
    except Exception as error:
        raise AuthServiceError(
            "The verification email could not be delivered. Please try again shortly.",
            503,
            "EMAIL_DELIVERY_FAILED",
        ) from error


@transaction.atomic
def authenticate_user(username: str, password: str) -> dict:
    user = authenticate(username=username.strip().lower(), password=password)
    if not user:
        raise AuthServiceError("Invalid username or password.", 401, "INVALID_CREDENTIALS")

    if requires_email_verification(user):
        raise AuthServiceError(
            "Email verification is required before login.",
            403,
            "VERIFICATION_REQUIRED",
            {"verificationRequired": True, "username": user.username},
        )

    session, raw_token = SessionToken.issue(user)
    user.last_login = timezone.now()
    user.save(update_fields=["last_login", "updated_at"])

    return {
      "ok": True,
      "token": raw_token,
      "sessionId": str(session.id),
      "expiresAt": session.expires_at.isoformat(),
      "user": serialize_user(user),
    }


def resolve_session(raw_token: str | None):
    if not raw_token:
        raise AuthServiceError("Authentication required.", 401, "UNAUTHENTICATED")

    session = (
        SessionToken.objects.select_related("user")
        .filter(key=raw_token, revoked_at__isnull=True)
        .first()
    )
    if not session or session.expires_at <= timezone.now():
        raise AuthServiceError("Authentication required.", 401, "UNAUTHENTICATED")

    if requires_email_verification(session.user):
        session.revoked_at = timezone.now()
        session.save(update_fields=["revoked_at", "updated_at"])
        raise AuthServiceError(
            "Email verification is required before login.",
            403,
            "VERIFICATION_REQUIRED",
            {"verificationRequired": True, "username": session.user.username},
        )

    return {
        "sessionId": str(session.id),
        "expiresAt": session.expires_at.isoformat(),
        "user": serialize_user(session.user),
    }


@transaction.atomic
def revoke_session(raw_token: str | None) -> None:
    if not raw_token:
        return
    SessionToken.objects.filter(key=raw_token, revoked_at__isnull=True).update(
        revoked_at=timezone.now(),
        updated_at=timezone.now(),
    )


@transaction.atomic
def create_verification_request(username: str) -> dict:
    user = User.objects.filter(username=username.strip().lower()).first()
    if not user:
        raise AuthServiceError("Account not found.", 404, "ACCOUNT_NOT_FOUND")
    if not user.email:
        raise AuthServiceError("This account does not have an email address.", 409, "EMAIL_MISSING")
    if user.email_verified:
        return {"ok": True, "status": "already_verified"}

    request = EmailVerificationRequest.objects.create(
        request_id=f"verify_{secrets.token_hex(12)}",
        user=user,
        code=generate_code(),
        expires_at=timezone.now() + timedelta(minutes=settings.SENTINEL_CODE_TTL_MINUTES),
    )
    send_sentinel_email(
        "Sentinel verification code",
        f"Your Sentinel verification code is {request.code}. It expires in {settings.SENTINEL_CODE_TTL_MINUTES} minutes.",
        user.email,
    )
    payload = {
        "ok": True,
        "status": "sent",
        "requestId": request.request_id,
        "expiresAt": request.expires_at.isoformat(),
    }
    if settings.SENTINEL_EXPOSE_DEBUG_CODES:
        payload["devCode"] = request.code
    return payload


@transaction.atomic
def confirm_verification_request(username: str, request_id: str, code: str) -> dict:
    user = User.objects.filter(username=username.strip().lower()).first()
    if not user:
        raise AuthServiceError("Account not found.", 404, "ACCOUNT_NOT_FOUND")
    request = EmailVerificationRequest.objects.filter(request_id=request_id, user=user).first()
    if not request:
        raise AuthServiceError("Verification request not found.", 404, "REQUEST_NOT_FOUND")
    if request.used_at:
        raise AuthServiceError("This verification code has already been used.", 409, "REQUEST_USED")
    if request.expires_at <= timezone.now():
        raise AuthServiceError("This verification code has expired.", 409, "REQUEST_EXPIRED")
    if request.code != code.strip():
        raise AuthServiceError("Incorrect verification code.", 400, "INVALID_CODE")

    request.used_at = timezone.now()
    request.save(update_fields=["used_at"])
    user.email_verified = True
    user.save(update_fields=["email_verified", "updated_at"])
    return {"ok": True, "user": serialize_user(user)}


@transaction.atomic
def create_password_reset_request(username: str) -> dict:
    user = User.objects.filter(username=username.strip().lower()).first()
    if not user:
        raise AuthServiceError("Account not found.", 404, "ACCOUNT_NOT_FOUND")
    if not user.email:
        raise AuthServiceError("This account does not have an email address.", 409, "EMAIL_MISSING")
    if not user.email_verified:
        raise AuthServiceError("Verify the email before requesting a password reset.", 409, "EMAIL_NOT_VERIFIED")

    request = PasswordResetRequest.objects.create(
        request_id=f"reset_{secrets.token_hex(12)}",
        user=user,
        code=generate_code(),
        expires_at=timezone.now() + timedelta(minutes=settings.SENTINEL_CODE_TTL_MINUTES),
    )
    send_sentinel_email(
        "Sentinel password reset code",
        f"Your Sentinel reset code is {request.code}. It expires in {settings.SENTINEL_CODE_TTL_MINUTES} minutes.",
        user.email,
    )
    payload = {
        "ok": True,
        "requestId": request.request_id,
        "expiresAt": request.expires_at.isoformat(),
    }
    if settings.SENTINEL_EXPOSE_DEBUG_CODES:
        payload["devCode"] = request.code
    return payload


@transaction.atomic
def confirm_password_reset(request_id: str, code: str, new_password: str) -> dict:
    if len(new_password) < 8:
        raise AuthServiceError("Password must be at least 8 characters long.", 400, "WEAK_PASSWORD")

    request = PasswordResetRequest.objects.select_related("user").filter(request_id=request_id).first()
    if not request:
        raise AuthServiceError("Password reset request not found.", 404, "REQUEST_NOT_FOUND")
    if request.used_at:
        raise AuthServiceError("This password reset code has already been used.", 409, "REQUEST_USED")
    if request.expires_at <= timezone.now():
        raise AuthServiceError("This password reset code has expired.", 409, "REQUEST_EXPIRED")
    if request.code != code.strip():
        raise AuthServiceError("Incorrect reset code.", 400, "INVALID_CODE")

    user = request.user
    request.used_at = timezone.now()
    request.save(update_fields=["used_at"])
    user.set_password(new_password)
    user.save(update_fields=["password", "updated_at"])
    SessionToken.objects.filter(user=user, revoked_at__isnull=True).update(
        revoked_at=timezone.now(),
        updated_at=timezone.now(),
    )
    return {"ok": True, "user": serialize_user(user)}


def list_users() -> list[dict]:
    return [serialize_user(user) for user in User.objects.order_by("username")]


@transaction.atomic
def provision_user(
    *,
    username: str,
    email: str,
    password: str,
    role: str,
    merchant_scope_ids: list[str] | None,
) -> dict:
    normalized_username = username.strip().lower()
    normalized_email = email.strip().lower()
    if not normalized_username or not normalized_email or not password.strip():
        raise AuthServiceError("Username, email, password, and role are required.", 400, "INVALID_INPUT")
    if role not in {choice for choice, _label in SentinelRole.choices}:
        raise AuthServiceError("Invalid role selected.", 400, "INVALID_ROLE")
    if len(password.strip()) < 8:
        raise AuthServiceError("Password must be at least 8 characters long.", 400, "WEAK_PASSWORD")
    if User.objects.filter(username=normalized_username).exists():
        raise AuthServiceError("A user with that username already exists.", 409, "USERNAME_CONFLICT")
    if User.objects.filter(email=normalized_email).exists():
        raise AuthServiceError("A user with that email already exists.", 409, "EMAIL_CONFLICT")

    user = User.objects.create_user(
        username=normalized_username,
        email=normalized_email,
        password=password.strip(),
        role=role,
        email_verified=False,
        merchant_scope_ids=normalize_scope_ids(merchant_scope_ids),
    )
    return {"ok": True, "user": serialize_user(user)}


@transaction.atomic
def update_user(
    *,
    user_id: str,
    username: str,
    email: str,
    role: str,
    merchant_scope_ids: list[str] | None,
    password: str | None,
) -> dict:
    normalized_username = username.strip().lower()
    normalized_email = email.strip().lower()
    if not user_id or not normalized_username or not normalized_email:
        raise AuthServiceError("User id, username, email, and role are required.", 400, "INVALID_INPUT")
    if role not in {choice for choice, _label in SentinelRole.choices}:
        raise AuthServiceError("Invalid role selected.", 400, "INVALID_ROLE")

    user = User.objects.filter(id=user_id).first()
    if not user:
        raise AuthServiceError("User not found.", 404, "USER_NOT_FOUND")

    if User.objects.exclude(id=user.id).filter(username=normalized_username).exists():
        raise AuthServiceError("A user with that username already exists.", 409, "USERNAME_CONFLICT")
    if User.objects.exclude(id=user.id).filter(email=normalized_email).exists():
        raise AuthServiceError("A user with that email already exists.", 409, "EMAIL_CONFLICT")

    next_scope_ids = normalize_scope_ids(merchant_scope_ids) if role == SentinelRole.MERCHANT_RISK_ANALYST else []
    next_is_superuser = bool(user.is_superuser and role == SentinelRole.PLATFORM_ADMIN)
    next_email_verified = True if next_is_superuser else bool(user.email_verified)
    password_value = (password or "").strip()
    if password_value and len(password_value) < 8:
        raise AuthServiceError("Password must be at least 8 characters long.", 400, "WEAK_PASSWORD")

    access_changed = (
        str(user.role) != role
        or bool(user.is_superuser) != next_is_superuser
        or bool(user.email_verified) != next_email_verified
        or normalize_scope_ids(user.merchant_scope_ids) != next_scope_ids
    )

    user.username = normalized_username
    user.email = normalized_email
    user.role = role
    user.is_superuser = next_is_superuser
    user.email_verified = next_email_verified
    user.merchant_scope_ids = next_scope_ids
    user.save(
        update_fields=[
            "username",
            "email",
            "role",
            "is_superuser",
            "email_verified",
            "merchant_scope_ids",
            "updated_at",
        ]
    )

    if password_value:
        user.set_password(password_value)
        user.save(update_fields=["password", "updated_at"])

    if access_changed or password_value:
        SessionToken.objects.filter(user=user, revoked_at__isnull=True).update(
            revoked_at=timezone.now(),
            updated_at=timezone.now(),
        )

    return {"ok": True, "user": serialize_user(user)}


@transaction.atomic
def delete_user(*, user_id: str, actor_user_id: str) -> dict:
    if not user_id:
        raise AuthServiceError("User id is required.", 400, "INVALID_INPUT")

    try:
        normalized_user_id = User._meta.pk.to_python(user_id)
    except (TypeError, ValueError, ValidationError) as error:
        raise AuthServiceError("User not found.", 404, "USER_NOT_FOUND") from error

    user = User.objects.select_for_update().filter(id=normalized_user_id).first()
    if not user:
        raise AuthServiceError("User not found.", 404, "USER_NOT_FOUND")
    if str(user.id) == str(actor_user_id):
        raise AuthServiceError(
            "You cannot delete the account you are currently using.",
            409,
            "CANNOT_DELETE_SELF",
        )

    is_platform_admin = user.is_superuser or user.role == SentinelRole.PLATFORM_ADMIN
    platform_admin_ids = list(
        User.objects.select_for_update()
        .filter(Q(is_superuser=True) | Q(role=SentinelRole.PLATFORM_ADMIN))
        .values_list("id", flat=True)
    )
    if is_platform_admin and len(platform_admin_ids) <= 1:
        raise AuthServiceError(
            "The final Platform Admin account cannot be deleted.",
            409,
            "LAST_PLATFORM_ADMIN",
        )

    deleted_user = serialize_user(user)
    user.delete()
    return {"ok": True, "user": deleted_user}
