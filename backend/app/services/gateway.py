"""آدرس درگاه سرویس ابری — متمرکز و مبهم‌سازی‌شده.

قاعدهٔ محصول: نام و دامنهٔ شرکت سرویس‌دهنده نباید در فایل‌های متنی، رابط کاربری یا
پاسخ‌های API دیده شود. بنابراین آدرس رسمی درگاه به‌صورت مبهم (XOR + Base64) در
همین یک ماژول نگه‌داری می‌شود و فقط از طریق تابع `gateway_url()` در دسترس است.

ترتیب اولویت:
  1) مقدار `CLOUD_OCR_GATEWAY` در فایل `.env` (اگر مشتری/نماینده آدرس دیگری داشت)
  2) آدرس پیش‌فرض درون برنامه

هیچ‌کدام از این مقادیر به مرورگر ارسال نمی‌شود؛ فقط شمارهٔ وضعیت («پیکربندی‌شده»)
به پنل مدیریت می‌رسد.
"""
from __future__ import annotations

import base64
import os

from ..config import settings

# آدرس پیش‌فرض درگاه (مبهم‌سازی‌شده با XOR + Base64 — NOT برای نمایش).
_PARTS = ("Mi4uKilgdXUtLS10Pzg1", "NXQzKHU7KjN1NTkodT0/", "Li07Iw==")
_KEY = 0x5A


def _decode() -> str:
    raw = base64.b64decode("".join(_PARTS))
    return bytes(b ^ _KEY for b in raw).decode("utf-8", "ignore")


def gateway_url() -> str:
    """آدرس فعال درگاه؛ خالی یعنی سرویس ابری در دسترس نیست."""
    explicit = (settings.CLOUD_OCR_GATEWAY or "").strip()
    if explicit:
        return explicit
    return _decode()


def gateway_configured() -> bool:
    """آیا درگاه قابل استفاده است؟ (همیشه true مگر نصب ناقص باشد)"""
    url = gateway_url()
    return url.startswith(("http://", "https://"))


def gateway_ready_for_env() -> bool:
    """برای نمایش در `.env`: مقدار CLOUD_OCR_GATEWAY خالی است ولی درگاه درون‌برنامه فعال است."""
    return not (settings.CLOUD_OCR_GATEWAY or "").strip() and gateway_configured()


def env_url_example() -> str:
    """نمونهٔ آدرس برای مستندات (بدون نام برند)."""
    return "https://HOST-OF-SERVICE/api/endpoint"


def total_timeout(default: int = 180) -> int:
    try:
        return int(os.getenv("CLOUD_OCR_TIMEOUT", default))
    except (TypeError, ValueError):
        return default
