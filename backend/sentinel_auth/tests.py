from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from .models import EmailVerificationRequest, PasswordResetRequest, SentinelRole, SessionToken
from .services import AuthServiceError, delete_user


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
