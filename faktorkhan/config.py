"""تنظیمات централь اپلیکیشن فاکتورخان.

همه مقادیر ثابت برنامه (مسیرها، تنظیمات OCR، لایسنس و ...) در اینجا conglomerate شده‌اند.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

# --------------------------------------------------------------------------- #
# شناسایی برنامه
# --------------------------------------------------------------------------- #
APP_NAME = "فاکتورخوان"
APP_VERSION = "1.0.0"
APP_COMPANY = "فاکتورخوان سیستم‌ها"

# --------------------------------------------------------------------------- #
# مسیرهای فایلسیستم
# --------------------------------------------------------------------------- #
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
LOGS_DIR = BASE_DIR / "logs"
EXPORT_DIR = BASE_DIR / "exports"
LICENSE_DIR = BASE_DIR / "license_files"
ASSETS_DIR = BASE_DIR / "assets"
DB_PATH = DATA_DIR / "faktorkhan.db"

for _directory in (DATA_DIR, LOGS_DIR, EXPORT_DIR, LICENSE_DIR):
    _directory.mkdir(parents=True, exist_ok=True)

# --------------------------------------------------------------------------- #
# کلیدهای امنیتی لایسنس (در محیط تولید حتماً تغییر یابند)
# --------------------------------------------------------------------------- #
LICENSE_MASTER_SECRET = "faktorkhan-license-master-secret-change-in-production"
LICENSE_APP_SECRET = "faktorkhan-license-signing-secret-change-in-production"
LICENSE_GRACE_DAYS = 7  # روزمه مهلت پس از انقضا قبل از قفل شدن کامل

# --------------------------------------------------------------------------- #
# تنظیمات OCR و تصویر
# --------------------------------------------------------------------------- #
SUPPORTED_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".webp"}
OCR_UPSCALE_FACTOR = 2.0
DEFAULT_OCR_BACKEND = "auto"  # auto | tesseract | easyocr | none

# --------------------------------------------------------------------------- #
# ارز و localization
# --------------------------------------------------------------------------- #
DEFAULT_CURRENCY = "تومان"
LOCALE = "fa_IR"

# --------------------------------------------------------------------------- #
# تنظیمات کاربر
# --------------------------------------------------------------------------- #
@dataclass
class AppSettings:
    theme: str = "dark"
    ocr_backend: str = DEFAULT_OCR_BACKEND
    auto_export_excel: bool = True
    default_export_directory: str = str(EXPORT_DIR)
    keep_ocr_history: bool = True
    currency: str = DEFAULT_CURRENCY
    language: str = "fa"
