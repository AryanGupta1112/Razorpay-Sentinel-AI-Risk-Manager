from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from sentinel_auth.models import SentinelRole


User = get_user_model()


SEEDED_USERS = [
    {
        "username": "platform_admin",
        "email": "platform.admin@sentinel.local",
        "password": "SentinelAdmin!2026",
        "role": SentinelRole.PLATFORM_ADMIN,
        "email_verified": True,
        "is_staff": True,
        "is_superuser": True,
        "merchant_scope_ids": [],
    },
    {
        "username": "risk_lead",
        "email": "risk.lead@sentinel.local",
        "password": "RiskLead!2026",
        "role": SentinelRole.RISK_LEAD,
        "email_verified": False,
        "is_staff": False,
        "is_superuser": False,
        "merchant_scope_ids": [],
    },
    {
        "username": "fraud_ops",
        "email": "fraud.ops@sentinel.local",
        "password": "FraudOps!2026",
        "role": SentinelRole.FRAUD_OPS_ANALYST,
        "email_verified": False,
        "is_staff": False,
        "is_superuser": False,
        "merchant_scope_ids": [],
    },
    {
        "username": "merchant_risk",
        "email": "merchant.risk@sentinel.local",
        "password": "MerchantRisk!2026",
        "role": SentinelRole.MERCHANT_RISK_ANALYST,
        "email_verified": False,
        "is_staff": False,
        "is_superuser": False,
        "merchant_scope_ids": ["M_QUICKBASKET", "M_VYRA"],
    },
]


class Command(BaseCommand):
    help = "Seed the Sentinel demo users used by the Next frontend."

    def handle(self, *_args, **_options):
        for entry in SEEDED_USERS:
            user, created = User.objects.get_or_create(
                username=entry["username"],
                defaults={
                    "email": entry["email"],
                    "role": entry["role"],
                    "email_verified": entry["email_verified"],
                    "is_staff": entry["is_staff"],
                    "is_superuser": entry["is_superuser"],
                    "merchant_scope_ids": entry["merchant_scope_ids"],
                },
            )
            user.email = entry["email"]
            user.role = entry["role"]
            user.email_verified = entry["email_verified"]
            user.is_staff = entry["is_staff"]
            user.is_superuser = entry["is_superuser"]
            user.merchant_scope_ids = entry["merchant_scope_ids"]
            user.set_password(entry["password"])
            user.save()
            verb = "Created" if created else "Updated"
            self.stdout.write(self.style.SUCCESS(f"{verb} {user.username}"))
