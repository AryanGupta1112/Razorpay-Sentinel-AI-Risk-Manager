from __future__ import annotations

from django.utils import timezone
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed

from .models import SessionToken
from .services import requires_email_verification


class SentinelTokenAuthentication(BaseAuthentication):
    def authenticate(self, request):
        header = request.headers.get("Authorization", "")
        token = None

        if header.startswith("Token "):
            token = header.removeprefix("Token ").strip()
        elif header.startswith("Bearer "):
            token = header.removeprefix("Bearer ").strip()
        else:
            token = request.COOKIES.get("sentinel_session")

        if not token:
            return None

        session = SessionToken.objects.select_related("user").filter(key=token, revoked_at__isnull=True).first()
        if not session or not session.is_active():
            raise AuthenticationFailed("Invalid or expired session token.")

        if requires_email_verification(session.user):
            session.revoked_at = timezone.now()
            session.save(update_fields=["revoked_at", "updated_at"])
            raise AuthenticationFailed("Email verification is required before access.")

        return session.user, token
