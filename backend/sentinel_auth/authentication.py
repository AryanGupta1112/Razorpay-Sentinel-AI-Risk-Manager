from __future__ import annotations

from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed

from .models import SessionToken


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

        return session.user, token
