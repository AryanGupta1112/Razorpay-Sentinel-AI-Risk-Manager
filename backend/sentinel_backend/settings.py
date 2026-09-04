from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import urlparse


BASE_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BASE_DIR.parent
RUNTIME_DIR = Path(os.getenv("SENTINEL_RUNTIME_DIR", REPO_ROOT / ".runtime"))


def load_env_file(file_path: Path) -> None:
    if not file_path.exists():
      return

    for raw_line in file_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_env_file(REPO_ROOT / ".env.local")
load_env_file(BASE_DIR / ".env")


def env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.lower() in {"1", "true", "yes", "on"}


def env_list(name: str, default: list[str]) -> list[str]:
    value = os.getenv(name)
    if not value:
        return default
    return [item.strip() for item in value.split(",") if item.strip()]


def postgres_database_config() -> dict[str, object] | None:
    database_url = os.getenv("DATABASE_URL") or os.getenv("DJANGO_DATABASE_URL")

    if not database_url:
        return None

    parsed = urlparse(database_url)
    if parsed.scheme not in {"postgres", "postgresql"}:
        raise ValueError("DATABASE_URL must use a postgres or postgresql scheme.")

    return {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": parsed.path.removeprefix("/") or "postgres",
        "USER": parsed.username or "",
        "PASSWORD": parsed.password or "",
        "HOST": parsed.hostname or "127.0.0.1",
        "PORT": parsed.port or 5432,
        "CONN_MAX_AGE": int(os.getenv("DJANGO_DB_CONN_MAX_AGE", "60")),
        "OPTIONS": {
            "sslmode": os.getenv("DJANGO_DB_SSLMODE", "prefer"),
        },
    }


SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "sentinel-dev-secret-key")
DEBUG = env_bool("DJANGO_DEBUG", True)
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", ["127.0.0.1", "localhost"])


INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "sentinel_auth",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "sentinel_backend.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "sentinel_backend.wsgi.application"
ASGI_APPLICATION = "sentinel_backend.asgi.application"


postgres_config = postgres_database_config()
if postgres_config is None:
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)

DATABASES = {
    "default": postgres_config
    or {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": os.getenv("DJANGO_SQLITE_PATH", str(RUNTIME_DIR / "django.sqlite3")),
    }
}


AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]


LANGUAGE_CODE = "en-us"
TIME_ZONE = "Asia/Kolkata"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
AUTH_USER_MODEL = "sentinel_auth.SentinelUser"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "sentinel_auth.authentication.SentinelTokenAuthentication",
    ],
    "UNAUTHENTICATED_USER": None,
}

SENTINEL_AUTH_COOKIE_NAME = os.getenv("AUTH_COOKIE_NAME", "sentinel_session")
SENTINEL_TOKEN_TTL_HOURS = int(os.getenv("DJANGO_AUTH_TOKEN_TTL_HOURS", "168"))
SENTINEL_CODE_TTL_MINUTES = int(os.getenv("DJANGO_AUTH_CODE_TTL_MINUTES", "30"))
SENTINEL_REQUIRE_VERIFICATION_FOR_NON_ADMINS = (
    True
    if not DEBUG
    else env_bool("AUTH_REQUIRE_VERIFICATION_FOR_NON_ADMINS", True)
)
SENTINEL_EXPOSE_DEBUG_CODES = env_bool("AUTH_EXPOSE_CODES", DEBUG)

EMAIL_BACKEND = (
    "django.core.mail.backends.smtp.EmailBackend"
    if os.getenv("DJANGO_EMAIL_HOST_USER") and os.getenv("DJANGO_EMAIL_HOST_PASSWORD")
    else "django.core.mail.backends.console.EmailBackend"
)
EMAIL_HOST = os.getenv("DJANGO_EMAIL_HOST", "smtp.gmail.com")
EMAIL_PORT = int(os.getenv("DJANGO_EMAIL_PORT", "587"))
EMAIL_USE_TLS = env_bool("DJANGO_EMAIL_USE_TLS", True)
EMAIL_HOST_USER = os.getenv("DJANGO_EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.getenv("DJANGO_EMAIL_HOST_PASSWORD", "")
EMAIL_TIMEOUT = int(os.getenv("DJANGO_EMAIL_TIMEOUT_SECONDS", "10"))
DEFAULT_FROM_EMAIL = os.getenv("DJANGO_EMAIL_FROM", EMAIL_HOST_USER or "sentinel@example.local")
RESEND_API_KEY = os.getenv("RESEND_API_KEY", "").strip()
RESEND_API_URL = os.getenv("RESEND_API_URL", "https://api.resend.com/emails").strip()
RESEND_FROM_EMAIL = os.getenv("RESEND_FROM_EMAIL", DEFAULT_FROM_EMAIL).strip()

REDIS_URL = os.getenv("REDIS_URL", "").strip()
CACHES = (
    {
        "default": {
            "BACKEND": "django_redis.cache.RedisCache",
            "LOCATION": REDIS_URL,
            "OPTIONS": {
                "CLIENT_CLASS": "django_redis.client.DefaultClient",
                "IGNORE_EXCEPTIONS": True,
            },
            "TIMEOUT": int(os.getenv("DJANGO_CACHE_TTL_SECONDS", "300")),
            "KEY_PREFIX": "sentinel-django",
        }
    }
    if REDIS_URL
    else {
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            "LOCATION": "sentinel-local-cache",
            "TIMEOUT": int(os.getenv("DJANGO_CACHE_TTL_SECONDS", "300")),
        }
    }
)
