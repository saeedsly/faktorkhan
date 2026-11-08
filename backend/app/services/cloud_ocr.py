"""کلاینت سرویس ابری OCR — کاملاً سمت سرور.

قواعد امنیتی این ماژول:
  * توکن فقط از پایگاه داده (رمزنگاری‌شده) خوانده می‌شود.
  * توکن هرگز در پاسخ API، لاگ یا پیام خطا ظاهر نمی‌شود.
  * آدرس درگاه فقط از متغیر محیطی خوانده می‌شود و در رابط کاربری نمایش داده نمی‌شود.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import httpx

from ..config import settings
from ..database import session_scope
from . import gateway
from ..models import AppSetting
from ..security import decrypt_secret, encrypt_secret

log = logging.getLogger("faktorkhan.cloud")

TOKEN_KEY = "cloud_token"
MIME = {
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".bmp": "image/bmp",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    ".mp4": "video/mp4",
    ".ogg": "audio/ogg",
    ".flac": "audio/flac",
    ".3gp": "video/3gpp",
    ".mpeg": "video/mpeg",
}
IMAGE_OR_PDF = {".pdf", ".jpg", ".jpeg", ".png", ".bmp"}
AUDIO_VIDEO = {".mp3", ".wav", ".mpeg", ".mp4", ".ogg", ".3gp", ".flac", ".m4a"}


class CloudError(Exception):
    """خطای سرویس ابری با پیام فارسی و بدون افشای اطلاعات حساس."""

    def __init__(self, message: str, code: str = "CloudError"):
        super().__init__(message)
        self.message = message
        self.code = code


ERRORS: dict[str, str] = {
    "FileCorrupted": "فایل ارسالی خراب، غیرمجاز یا رمزدار است.",
    "NoEnoughCredit": "اعتبار سرویس ابری کافی نیست. لطفاً اعتبار پنل ابری را شارژ کنید.",
    "UploadFailed": "خطا در بارگذاری فایل به سرویس ابری.",
    "UnkwonURL": "لینک ارسالی معتبر نیست یا قابل دانلود نیست.",
    "UnknowURL": "لینک ارسالی معتبر نیست یا قابل دانلود نیست.",
    "UnknowMethod": "روش تبدیل انتخاب‌شده برای این فایل مجاز نیست.",
    "TokenNotFound": "فایل با توکن ارسالی یافت نشد.",
    "MethodNotAllowed": "این روش تبدیل برای فایل انتخاب‌شده مجاز نیست.",
    "FileDeletedFromServer": "فایل از سرور ابری حذف شده است.",
    "ConvertError": "خطا در تبدیل فایل در سرویس ابری.",
    "Data Not Found Yet": "خروجی آماده نشده است؛ کمی بعد دوباره بررسی کنید.",
    "IPError": "آی‌پی سرور مجاز به استفاده از سرویس ابری نیست.",
    "NotEnoughCredit": "اعتبار سرویس ابری کافی نیست.",
}


def _scrub(text: str, token: str) -> str:
    """حذف هر ردی از توکن در متن‌های خروجی/خطا."""
    if not text:
        return ""
    clean = text
    if token:
        clean = clean.replace(token, "«مخفی»")
        if len(token) > 6:
            clean = clean.replace(token[:6], "«مخفی»")
    return clean[:600]


def gateway_configured() -> bool:
    """درگاه همیشه در دسترس است؛ فقط در نصب ناقص false می‌شود."""
    return gateway.gateway_configured()


def gateway_display() -> dict:
    """وضعیت درگاه برای پنل مدیریت — بدون افشای آدرس یا نام دامنه."""
    url = gateway.gateway_url()
    return {
        "ready": gateway.gateway_configured(),
        "custom": bool((settings.CLOUD_OCR_GATEWAY or "").strip()),
        "secure": url.startswith("https://"),
        "host_hint": "•••••" if url else "",
    }


# ------------------------------------------------------------ توکن
def get_setting(key: str, default: str = "") -> str:
    with session_scope() as db:
        row = db.query(AppSetting).filter(AppSetting.key == key).first()
        return row.value if row else default


def save_cloud_token(token: str, actor_id: int | None = None) -> None:
    token = (token or "").strip()
    with session_scope() as db:
        row = db.query(AppSetting).filter(AppSetting.key == TOKEN_KEY).first()
        if row:
            row.value = encrypt_secret(token)
            row.is_secret = True
        else:
            db.add(AppSetting(key=TOKEN_KEY, value=encrypt_secret(token), is_secret=True))
    log.info("cloud token updated by user %s", actor_id)


def cloud_token() -> str:
    """توکن ابری (رمزگشایی‌شده) — فقط برای استفاده داخلی."""
    encrypted = get_setting(TOKEN_KEY, "")
    token = decrypt_secret(encrypted) if encrypted else ""
    if not token:
        token = settings.CLOUD_OCR_SEED_TOKEN
        if token:
            save_cloud_token(token)
    return token


def token_state() -> dict:
    """وضعیت توکن برای نمایش در پنل مدیریت — بدون افشای مقدار."""
    token = cloud_token()
    return {
        "configured": bool(token),
        "length": len(token),
        "hint": ("•" * 10 + token[-4:]) if len(token) > 4 else "",
        "gateway_ready": gateway_configured(),
        "modified": get_setting("cloud_token_updated", ""),
    }


# ------------------------------------------------------------ ارتباط
def _call(payload: dict[str, Any], files: dict | None = None, timeout: int | None = None) -> dict:
    if not gateway_configured():
        raise CloudError("سرویس ابری روی این سرور پیکربندی نشده است.", "NotConfigured")
    token = cloud_token()
    if not token:
        raise CloudError("توکن سرویس ابری تنظیم نشده است. از پنل مدیریت آن را ثبت کنید.", "NoToken")

    payload = {k: v for k, v in payload.items() if v not in (None, "")}
    payload["token"] = token
    try:
        with httpx.Client(timeout=timeout or settings.CLOUD_OCR_TIMEOUT, verify=settings.CLOUD_OCR_VERIFY_TLS) as client:
            response = client.post(gateway.gateway_url(), data=payload, files=files)
    except httpx.TimeoutException:
        raise CloudError("سرویس ابری پاسخ نداد (اتمام زمان). دوباره تلاش کنید.", "Timeout")
    except httpx.HTTPError as exc:
        raise CloudError(f"ارتباط با سرویس ابری برقرار نشد: {_scrub(type(exc).__name__, token)}", "Network")

    raw = _scrub(response.text, token)
    if response.status_code == 404:
        raise CloudError("درخواست نامعتبر است (کد ۴۰۴).", "404")
    if response.status_code == 500:
        raise CloudError("خطا در سرور سرویس ابری (کد ۵۰۰).", "500")
    try:
        data = response.json()
    except ValueError:
        raise CloudError(f"پاسخ نامعتبر از سرویس ابری: {raw[:160]}", "BadResponse")
    if not isinstance(data, dict):
        raise CloudError("پاسخ سرویس ابری قابل تفسیر نیست.", "BadResponse")

    status = str(data.get("Status", "")).strip()
    if status in ERRORS:
        raise CloudError(ERRORS[status], status)
    if status.lower() in {"error", "failed"}:
        raise CloudError(_scrub(str(data.get("Message") or raw), token), status or "Error")
    data["_status"] = status
    return data


# ------------------------------------------------------------ عملیات
def add_file(path: Path, file_name: str | None = None) -> dict:
    suffix = path.suffix.lower()
    if suffix not in IMAGE_OR_PDF and suffix not in AUDIO_VIDEO:
        raise CloudError("قالب فایل پشتیبانی نمی‌شود. تصویر، PDF یا فایل صوتی/تصویری ارسال کنید.", "BadType")
    name = file_name or path.name
    with open(path, "rb") as fh:
        files = {"filehandle": (name, fh, "multipart/form-data")}
        data = _call({"command": "addfile"}, files=files)
    return _normalize_add(data, suffix)


def add_file_link(link: str) -> dict:
    if not link.lower().startswith(("http://", "https://")):
        raise CloudError("لینک باید با http یا https شروع شود.", "BadLink")
    data = _call({"command": "addfile", "filelink": link})
    return _normalize_add(data, Path(link.split("?")[0]).suffix.lower())


def _normalize_add(data: dict, suffix: str) -> dict:
    return {
        "file_token": str(data.get("FileToken") or data.get("Filetoken") or ""),
        "pages": int(str(data.get("PageCount") or 0).split(".")[0] or 0),
        "duration": int(str(data.get("FileDuration") or 0).split(".")[0] or 0),
        "methods": [int(m) for m in str(data.get("ConvertMethods") or "").split(",") if m.strip().isdigit()],
        "kind": "media" if suffix in AUDIO_VIDEO else "document",
        "raw": {k: v for k, v in data.items() if not k.startswith("_")},
    }


def convert(file_token: str, method: int = 4, output: str = "txtrawjson") -> dict:
    payload = {
        "command": "convert",
        "filetoken": file_token,
        "method": method,
    }
    if output:
        payload["output"] = output
    data = _call(payload, timeout=settings.CLOUD_OCR_TIMEOUT)
    return {
        "status": str(data.get("Status", "")),
        "download": str(data.get("FileToDownload") or data.get(" FileToDownload ") or "").strip(),
        "raw": {k: v for k, v in data.items() if not k.startswith("_")},
    }


def convert_audio(file_token: str, language: str = "fa") -> dict:
    data = _call({"command": "convert", "filetoken": file_token, "language": language or "fa"})
    return {"status": str(data.get("Status", ""))}


def check_convert(file_token: str) -> dict:
    data = _call({"command": "checkconvert", "filetoken": file_token})
    progress_raw = str(data.get("Progress") or "0")
    digits = "".join(ch for ch in progress_raw if ch.isdigit() or ch == ".")
    try:
        progress = int(float(digits or 0))
    except ValueError:
        progress = 0
    return {
        "status": str(data.get("Status", "")),
        "progress": max(0, min(progress, 100)),
        "output": str(data.get("Output") or ""),
    }


def cancel_convert(file_token: str) -> dict:
    data = _call({"command": "cancelconvert", "filetoken": file_token})
    return {"status": str(data.get("Status", ""))}


def delete_file(file_token: str) -> dict:
    data = _call({"command": "deletefile", "filetoken": file_token})
    return {"status": str(data.get("Status", ""))}


def check_credit() -> dict:
    data = _call({"command": "checkcredit"})
    return {
        "ocr_credit": int(float(str(data.get("OCRCredit") or 0) or 0)),
        "audio_credit": int(float(str(data.get("AudioTranscribeCredit") or 0) or 0)),
        "status": str(data.get("Status", "")),
    }


def download(url: str, dest: Path) -> Path:
    """دانلود خروجی تبدیل از سرویس ابری روی سرور (بدون افشای لینک به کاربر)."""
    if not url.lower().startswith(("http://", "https://")):
        raise CloudError("لینک خروجی معتبر نیست.", "BadLink")
    try:
        with httpx.Client(timeout=settings.CLOUD_OCR_TIMEOUT, follow_redirects=True,
                          verify=settings.CLOUD_OCR_VERIFY_TLS) as client:
            with client.stream("GET", url) as response:
                response.raise_for_status()
                dest.parent.mkdir(parents=True, exist_ok=True)
                with open(dest, "wb") as fh:
                    for chunk in response.iter_bytes(65536):
                        fh.write(chunk)
    except httpx.HTTPError as exc:
        raise CloudError(f"دانلود خروجی ناموفق بود ({type(exc).__name__}).", "Download")
    return dest
