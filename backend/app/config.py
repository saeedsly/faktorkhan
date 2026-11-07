"""
فاکتورخوان — پیکربندی مرکزی برنامه
=====================================
تمام تنظیمات حساس (کلیدها، آدرس درگاه ابری) فقط از محیط خوانده می‌شوند و
هرگز به سمت مرورگر یا خروجی برنامه ارسال نمی‌شوند.
"""
from __future__ import annotations

import os
import secrets
from functools import lru_cache
from pathlib import Path

# ---------------------------------------------------------------- مسیرها
BASE_DIR = Path(__file__).resolve().parent.parent.parent      # ریشه پروژه
BACKEND_DIR = BASE_DIR / "backend"
FRONTEND_DIR = BASE_DIR / "frontend"


def _load_dotenv() -> None:
    """بارگذاری ساده فایل .env بدون وابستگی بیرونی."""
    for candidate in (BASE_DIR / ".env", BACKEND_DIR / ".env", Path.cwd() / ".env"):
        if not candidate.is_file():
            continue
        for raw in candidate.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value


_load_dotenv()


def _bool(name: str, default: bool = False) -> bool:
    return os.getenv(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}


def _int(name: str, default: int) -> int:
    try:
        return int(str(os.getenv(name, default)).strip())
    except (TypeError, ValueError):
        return default


class Settings:
    """تنظیمات برنامه."""

    # --- هویت برنامه -------------------------------------------------
    APP_NAME: str = os.getenv("APP_NAME", "فاکتورخوان")
    APP_VERSION: str = "1.0.0"
    APP_EDITION: str = os.getenv("APP_EDITION", "Professional")
    APP_ENV: str = os.getenv("APP_ENV", "production")

    # --- امنیت -------------------------------------------------------
    SECRET_KEY: str = os.getenv("SECRET_KEY", "")
    ENCRYPTION_KEY: str = os.getenv("ENCRYPTION_KEY", "")
    JWT_ALGORITHM: str = "HS256"
    TOKEN_TTL_HOURS: int = _int("TOKEN_TTL_HOURS", 24 * 7)
    MAX_LOGIN_ATTEMPTS: int = _int("MAX_LOGIN_ATTEMPTS", 7)
    LOCK_MINUTES: int = _int("LOCK_MINUTES", 15)

    # --- پایگاه داده -------------------------------------------------
    # پیش‌فرض: SQLite برای حالت نصب لوکال/ویندوز
    # نمونه MySQL: mysql+pymysql://user:pass@127.0.0.1:3306/faktorkhan?charset=utf8mb4
    DATABASE_URL: str = os.getenv("DATABASE_URL", "")
    SQL_ECHO: bool = _bool("SQL_ECHO", False)
    DB_POOL_SIZE: int = _int("DB_POOL_SIZE", 10)
    DB_MAX_OVERFLOW: int = _int("DB_MAX_OVERFLOW", 20)

    # --- ذخیره‌سازی ---------------------------------------------------
    DATA_DIR: Path = Path(os.getenv("DATA_DIR", str(BASE_DIR / "storage")))
    MAX_UPLOAD_MB: int = _int("MAX_UPLOAD_MB", 25)

    # --- سرویس ابری (فقط سمت سرور) -----------------------------------
    # آدرس درگاه ابری؛ هیچ‌گاه در رابط کاربری یا پاسخ API نمایش داده نمی‌شود.
    CLOUD_OCR_GATEWAY: str = os.getenv("CLOUD_OCR_GATEWAY", "").strip()
    CLOUD_OCR_TIMEOUT: int = _int("CLOUD_OCR_TIMEOUT", 180)
    CLOUD_OCR_SEED_TOKEN: str = os.getenv("CLOUD_OCR_SEED_TOKEN", "").strip()
    CLOUD_OCR_VERIFY_TLS: bool = _bool("CLOUD_OCR_VERIFY_TLS", True)

    # --- ثبت‌نام و اشتراک ---------------------------------------------
    ALLOW_REGISTRATION: bool = _bool("ALLOW_REGISTRATION", True)
    REQUIRE_LICENSE: bool = _bool("REQUIRE_LICENSE", True)
    TRIAL_DAYS: int = _int("TRIAL_DAYS", 14)
    TRIAL_PAGES: int = _int("TRIAL_PAGES", 50)

    # --- مالک سیستم (اولین اجرا) -------------------------------------
    OWNER_NAME: str = os.getenv("OWNER_NAME", "سعید سالاری")
    OWNER_EMAIL: str = os.getenv("OWNER_EMAIL", "owner@localhost")
    OWNER_PASSWORD: str = os.getenv("OWNER_PASSWORD", "")

    # --- CORS --------------------------------------------------------
    CORS_ORIGINS: str = os.getenv("CORS_ORIGINS", "*")

    # --- اجرا --------------------------------------------------------
    HOST: str = os.getenv("HOST", "0.0.0.0")
    PORT: int = _int("PORT", 8000)

    @property
    def storage_uploads(self) -> Path:
        return self.DATA_DIR / "uploads"

    @property
    def storage_exports(self) -> Path:
        return self.DATA_DIR / "exports"


settings = Settings()

# ---------------------------------------------------------------- آماده‌سازی
for _p in (settings.DATA_DIR, settings.storage_uploads, settings.storage_exports):
    _p.mkdir(parents=True, exist_ok=True)


def _persisted_secret(filename: str) -> str:
    """کلید پایدار در پوشه داده (برای نصب‌های لوکال بدون .env)."""
    path = settings.DATA_DIR / filename
    if path.is_file():
        return path.read_text(encoding="utf-8").strip()
    value = secrets.token_urlsafe(48)
    try:
        path.write_text(value, encoding="utf-8")
        os.chmod(path, 0o600)
    except OSError:
        pass
    return value


# در نبود متغیر محیطی، کلید در پوشه داده ساخته و پایدار می‌شود
if not settings.SECRET_KEY:
    settings.SECRET_KEY = _persisted_secret(".secret_key")
if not settings.ENCRYPTION_KEY:
    settings.ENCRYPTION_KEY = _persisted_secret(".encryption_key")

if not settings.DATABASE_URL:
    settings.DATABASE_URL = f"sqlite:///{(settings.DATA_DIR / 'faktorkhan.db').as_posix()}"


@lru_cache(maxsize=1)
def app_meta() -> dict:
    """اطلاعات عمومی برنامه (بدون هیچ داده حساس)."""
    return {
        "name": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "edition": settings.APP_EDITION,
        "owner": settings.OWNER_NAME,
        "registration_open": settings.ALLOW_REGISTRATION,
        "license_required": settings.REQUIRE_LICENSE,
        "trial_days": settings.TRIAL_DAYS,
        "trial_pages": settings.TRIAL_PAGES,
        "cloud_configured": bool(settings.CLOUD_OCR_GATEWAY),
        "max_upload_mb": settings.MAX_UPLOAD_MB,
    }
