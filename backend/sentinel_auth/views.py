from __future__ import annotations

import json

from django.http import JsonResponse
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView

from .services import (
    AuthServiceError,
    authenticate_user,
    confirm_password_reset,
    confirm_verification_request,
    create_password_reset_request,
    create_verification_request,
    delete_user,
    list_users,
    provision_user,
    resolve_session,
    revoke_session,
    update_user,
)


def read_json(request) -> dict:
    if not request.body:
        return {}
    try:
        return json.loads(request.body.decode("utf-8"))
    except json.JSONDecodeError as error:
        raise AuthServiceError("Invalid JSON payload.", 400, "INVALID_INPUT") from error


def error_response(error: Exception) -> JsonResponse:
    if isinstance(error, AuthServiceError):
        payload = {"error": error.message, "code": error.code, **error.details}
        return JsonResponse(payload, status=error.status)
    return JsonResponse({"error": "Internal server error.", "code": "INTERNAL_ERROR"}, status=500)


class LoginView(APIView):
    authentication_classes = []
    permission_classes = []

    def post(self, request):
        try:
            body = read_json(request)
            if not body.get("username") or not body.get("password"):
                return JsonResponse(
                    {"error": "Username and password are required.", "code": "INVALID_INPUT"},
                    status=400,
                )
            return JsonResponse(authenticate_user(body["username"], body["password"]))
        except Exception as error:
            return error_response(error)


class LogoutView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        try:
            revoke_session(getattr(request, "auth", None))
            return JsonResponse({"ok": True})
        except Exception as error:
            return error_response(error)


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            return JsonResponse({"ok": True, **resolve_session(getattr(request, "auth", None))})
        except Exception as error:
            return error_response(error)


class ForgotPasswordView(APIView):
    authentication_classes = []
    permission_classes = []

    def post(self, request):
        try:
            body = read_json(request)
            if not body.get("username"):
                return JsonResponse({"error": "Username is required.", "code": "INVALID_INPUT"}, status=400)
            return JsonResponse(create_password_reset_request(body["username"]))
        except Exception as error:
            return error_response(error)


class ResetPasswordView(APIView):
    authentication_classes = []
    permission_classes = []

    def post(self, request):
        try:
            body = read_json(request)
            if not body.get("requestId") or not body.get("code") or not body.get("newPassword"):
                return JsonResponse(
                    {"error": "Request id, code, and new password are required.", "code": "INVALID_INPUT"},
                    status=400,
                )
            return JsonResponse(confirm_password_reset(body["requestId"], body["code"], body["newPassword"]))
        except Exception as error:
            return error_response(error)


class VerifySendView(APIView):
    authentication_classes = []
    permission_classes = []

    def post(self, request):
        try:
            body = read_json(request)
            if not body.get("username"):
                return JsonResponse({"error": "Username is required.", "code": "INVALID_INPUT"}, status=400)
            return JsonResponse(create_verification_request(body["username"]))
        except Exception as error:
            return error_response(error)


class VerifyConfirmView(APIView):
    authentication_classes = []
    permission_classes = []

    def post(self, request):
        try:
            body = read_json(request)
            if not body.get("username") or not body.get("requestId") or not body.get("code"):
                return JsonResponse(
                    {"error": "Request id, username, and code are required.", "code": "INVALID_INPUT"},
                    status=400,
                )
            return JsonResponse(
                confirm_verification_request(body["username"], body["requestId"], body["code"])
            )
        except Exception as error:
            return error_response(error)


class UsersView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            if not request.user.is_superuser and request.user.role != "platform_admin":
                raise AuthServiceError("You do not have access to that action.", 403, "FORBIDDEN")
            return JsonResponse({"ok": True, "users": list_users()})
        except Exception as error:
            return error_response(error)

    def post(self, request):
        try:
            if not request.user.is_superuser and request.user.role != "platform_admin":
                raise AuthServiceError("You do not have access to that action.", 403, "FORBIDDEN")

            body = read_json(request)
            return JsonResponse(
                provision_user(
                    username=body.get("username", ""),
                    email=body.get("email", ""),
                    password=body.get("password", ""),
                    role=body.get("role", ""),
                    email_verified=body.get("emailVerified") is True,
                    merchant_scope_ids=body.get("merchantScopeIds"),
                )
            )
        except Exception as error:
            return error_response(error)

    def patch(self, request):
        try:
            if not request.user.is_superuser and request.user.role != "platform_admin":
                raise AuthServiceError("You do not have access to that action.", 403, "FORBIDDEN")

            body = read_json(request)
            return JsonResponse(
                update_user(
                    user_id=body.get("userId", ""),
                    username=body.get("username", ""),
                    email=body.get("email", ""),
                    password=body.get("password"),
                    role=body.get("role", ""),
                    email_verified=body.get("emailVerified") is True,
                    merchant_scope_ids=body.get("merchantScopeIds"),
                )
            )
        except Exception as error:
            return error_response(error)

    def delete(self, request):
        try:
            if not request.user.is_superuser and request.user.role != "platform_admin":
                raise AuthServiceError("You do not have access to that action.", 403, "FORBIDDEN")

            body = read_json(request)
            return JsonResponse(
                delete_user(
                    user_id=body.get("userId", ""),
                    actor_user_id=str(request.user.id),
                )
            )
        except Exception as error:
            return error_response(error)
