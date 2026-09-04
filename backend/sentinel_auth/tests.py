from datetime import timedelta
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from .models import EmailVerificationRequest, PasswordResetRequest, SentinelRole, SessionToken
from .services import (
    AuthServiceError,
    authenticate_user,
    delete_user,
    provision_user,
    resolve_session,
    send_sentinel_email,
)


class EmailDeliveryTests(TestCase):
    @override_settings(
        DEBUG=False,
        EMAIL_BACKEND="django.core.mail.backends.console.EmailBackend",
    )
    def test_console_email_backend_is_rejected_in_production(self):
        with self.assertRaises(AuthServiceError) as raised:
            send_sentinel_email("Verification", "Code 123456", "analyst@example.com")

        self.assertEqual(raised.exception.code, "EMAIL_DELIVERY_NOT_CONFIGURED")


@override_settings(SENTINEL_REQUIRE_VERIFICATION_FOR_NON_ADMINS=True)
class EmailVerificationEnforcementTests(TestCase):
    def setUp(self):
        from django.contrib.auth import get_user_model

        self.user_model = get_user_model()

    def test_provisioned_platform_admin_must_verify_before_login(self):
        result = provision_user(
            username="new_admin",
            email="new-admin@example.com",
            password="NewAdmin!2026",
            role=SentinelRole.PLATFORM_ADMIN,
            merchant_scope_ids=[],
        )

        self.assertFalse(result["user"]["emailVerified"])
        with self.assertRaises(AuthServiceError) as raised:
            authenticate_user("new_admin", "NewAdmin!2026")

        self.assertEqual(raised.exception.code, "VERIFICATION_REQUIRED")

    def test_recovery_superuser_can_login_without_separate_verification(self):
        self.user_model.objects.create_superuser(
            username="recovery_admin",
            email="recovery@example.com",
            password="RecoveryAdmin!2026",
        )

        result = authenticate_user("recovery_admin", "RecoveryAdmin!2026")

        self.assertEqual(result["user"]["role"], SentinelRole.PLATFORM_ADMIN)

    def test_session_is_revoked_when_verification_is_removed(self):
        user = self.user_model.objects.create_user(
            username="verified_operator",
            email="verified@example.com",
            password="VerifiedOperator!2026",
            role=SentinelRole.FRAUD_OPS_ANALYST,
            email_verified=True,
        )
        login = authenticate_user("verified_operator", "VerifiedOperator!2026")
        user.email_verified = False
        user.save(update_fields=["email_verified", "updated_at"])

        with self.assertRaises(AuthServiceError) as raised:
            resolve_session(login["token"])

        self.assertEqual(raised.exception.code, "VERIFICATION_REQUIRED")
        self.assertIsNotNone(SessionToken.objects.get(id=login["sessionId"]).revoked_at)

    def test_django_authentication_rejects_a_stale_unverified_token(self):
        user = self.user_model.objects.create_user(
            username="stale_admin",
            email="stale-admin@example.com",
            password="StaleAdmin!2026",
            role=SentinelRole.PLATFORM_ADMIN,
            email_verified=True,
        )
        session, token = SessionToken.issue(user)
        user.email_verified = False
        user.save(update_fields=["email_verified", "updated_at"])

        response = APIClient().get("/api/users", HTTP_AUTHORIZATION=f"Token {token}")

        self.assertIn(response.status_code, {401, 403})
        session.refresh_from_db()
        self.assertIsNotNone(session.revoked_at)


class DeleteUserServiceTests(TestCase):
    def setUp(self):
        from django.contrib.auth import get_user_model

        user_model = get_user_model()
        self.admin = user_model.objects.create_superuser(
            username="platform_admin",
            email="admin@example.com",
            password="SentinelAdmin!2026",
        )
        self.operator = user_model.objects.create_user(
            username="fraud_operator",
            email="operator@example.com",
            password="FraudOperator!2026",
            role=SentinelRole.FRAUD_OPS_ANALYST,
            email_verified=True,
        )

    def test_delete_user_removes_account_and_related_auth_records(self):
        SessionToken.objects.create(
            key="session-token",
            user=self.operator,
            expires_at=timezone.now() + timedelta(hours=1),
        )
        EmailVerificationRequest.objects.create(
            request_id="verify-request",
            user=self.operator,
            code="123456",
            expires_at=timezone.now() + timedelta(minutes=10),
        )
        PasswordResetRequest.objects.create(
            request_id="reset-request",
            user=self.operator,
            code="654321",
            expires_at=timezone.now() + timedelta(minutes=10),
        )

        result = delete_user(user_id=str(self.operator.id), actor_user_id=str(self.admin.id))

        self.assertTrue(result["ok"])
        self.assertEqual(result["user"]["username"], "fraud_operator")
        self.assertFalse(type(self.operator).objects.filter(id=self.operator.id).exists())
        self.assertFalse(SessionToken.objects.filter(user_id=self.operator.id).exists())
        self.assertFalse(EmailVerificationRequest.objects.filter(user_id=self.operator.id).exists())
        self.assertFalse(PasswordResetRequest.objects.filter(user_id=self.operator.id).exists())

    def test_delete_user_rejects_current_account(self):
        with self.assertRaises(AuthServiceError) as raised:
            delete_user(user_id=str(self.admin.id), actor_user_id=str(self.admin.id))

        self.assertEqual(raised.exception.code, "CANNOT_DELETE_SELF")

    def test_delete_user_preserves_final_platform_admin(self):
        with self.assertRaises(AuthServiceError) as raised:
            delete_user(user_id=str(self.admin.id), actor_user_id=str(self.operator.id))

        self.assertEqual(raised.exception.code, "LAST_PLATFORM_ADMIN")
        self.assertTrue(type(self.admin).objects.filter(id=self.admin.id).exists())

    def test_delete_user_returns_not_found_for_malformed_id(self):
        with self.assertRaises(AuthServiceError) as raised:
            delete_user(user_id="missing-user", actor_user_id=str(self.admin.id))

        self.assertEqual(raised.exception.status, 404)
        self.assertEqual(raised.exception.code, "USER_NOT_FOUND")
