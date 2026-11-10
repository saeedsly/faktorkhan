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
    # سرویس با این وضعیت می‌گوید «پارامتری از درخواست را قبول نکردم».
    # نسخهٔ قبلی این را نمی‌شناخت، پس پیام واقعی سرویس دور ریخته می‌شد و
    # کاربر یک جملهٔ مبهم («لینک خروجی نداد») می‌دید.
    "InvalidParams": "سرویس ابری پارامترهای درخواست را نپذیرفت.",
    "InvalidParameter": "سرویس ابری پارامترهای درخواست را نپذیرفت.",
    "BadRequest": "درخواست به سرویس ابری ناقص یا نامعتبر بود.",
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
    # «Data Not Found Yet» در مستندات جزو خطاها فهرست شده، ولی در عمل یعنی
    # «هنوز آماده نیست». کشتن کار با این پیام، اعتبار کاربر را هدر می‌دهد.
    if status.lower().replace(" ", "") in {"datanotfoundyet", "notready", "notfoundyet"}:
        data["_status"] = status
        data["_pending"] = True
        return data
    if status in ERRORS:
        # پیام خودِ سرویس را هم اضافه کن (مثلاً «method is required») —
        # بدون آن، کاربر و پشتیبان هر دو در تاریکی می‌مانند.
        service_msg = _scrub(str(data.get("Message") or data.get("message") or data.get("Error") or ""), token)
        message = ERRORS[status]
        if service_msg and service_msg.lower() not in message:
            message = f"{message} (پاسخ سرویس: {service_msg})"
        # برای InvalidParams بگو کدام پارامترها فرستاده شد تا عیب‌یابی ممکن باشد
        if status.lower().startswith("invalid") or status.lower() == "badrequest":
            sent = ", ".join(sorted(k for k in payload if k != "token"))
            message += f" — پارامترهای ارسالی: {sent}"
        raise CloudError(message, status)
    if status.lower() in {"error", "failed"}:
        raise CloudError(_scrub(str(data.get("Message") or raw), token), status or "Error")
    data["_status"] = status
    return data


# ------------------------------------------------------------ عملیات
MIME_BY_SUFFIX = {
    ".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".png": "image/png", ".bmp": "image/bmp", ".tif": "image/tiff", ".tiff": "image/tiff",
    ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4",
    ".mp4": "video/mp4", ".ogg": "audio/ogg", ".flac": "audio/flac", ".3gp": "video/3gpp",
}


def add_file(path: Path, file_name: str | None = None) -> dict:
    """ثبت فایل در سرویس ابری.

    نکتهٔ مهم: نوع فایل باید MIME واقعی باشد (image/jpeg و ...)، نه
    «multipart/form-data». ارسال نوع اشتباه باعث می‌شود برخی سرورها فایل را
    قبول نکنند و توکن برنگردانند.
    """
    suffix = path.suffix.lower()
    if suffix not in IMAGE_OR_PDF and suffix not in AUDIO_VIDEO:
        raise CloudError("قالب فایل پشتیبانی نمی‌شود. تصویر، PDF یا فایل صوتی/تصویری ارسال کنید.", "BadType")
    name = file_name or path.name
    mime = MIME_BY_SUFFIX.get(suffix, "application/octet-stream")
    with open(path, "rb") as fh:
        files = {"filehandle": (name, fh, mime)}
        data = _call({"command": "addfile"}, files=files)
    result = _normalize_add(data, suffix)
    if not result["file_token"]:
        status = str(data.get("Status") or "").strip()
        keys = ", ".join(k for k in data if not k.startswith("_")) or "هیچ"
        raise CloudError(
            f"سرویس ابری توکن فایل را برنگرداند (وضعیت: {status or 'خالی'} — کلیدهای پاسخ: {keys}).",
            "NoFileToken",
        )
    return result


def add_file_link(link: str) -> dict:
    if not link.lower().startswith(("http://", "https://")):
        raise CloudError("لینک باید با http یا https شروع شود.", "BadLink")
    data = _call({"command": "addfile", "filelink": link})
    return _normalize_add(data, Path(link.split("?")[0]).suffix.lower())


def _find_key(data: dict, names: tuple[str, ...]) -> str:
    """نگه‌داری سازگاری: همان pick_key با تحمل نویسه‌های اضافی."""
    return pick_key(data, names)


def _normalize_add(data: dict, suffix: str) -> dict:
    return {
        "file_token": _find_key(data, ("FileToken", "Filetoken", "filetoken", "fileToken", "File_Token")),
        "pages": int(str(data.get("PageCount") or 0).split(".")[0] or 0),
        "duration": int(str(data.get("FileDuration") or 0).split(".")[0] or 0),
        "methods": [int(m) for m in str(data.get("ConvertMethods") or "").split(",") if m.strip().isdigit()],
        "kind": "media" if suffix in AUDIO_VIDEO else "document",
        "raw": {k: v for k, v in data.items() if not k.startswith("_")},
    }


def _norm_key(text: str) -> str:
    """کلید را برای تطبیق نرم نرمال می‌کند: فاصله/زیرخط/خط تیره/حروف بزرگ نادیده."""
    return "".join(ch for ch in str(text).lower() if ch not in " \t\r\n_-")


def pick_key(data: dict, candidates: tuple[str, ...]) -> str:
    """خواندن یک کلید از پاسخ با تحمل نویسه‌های اضافی.

    سرویس واقعی کلید لینک را با فاصله در دو طرف برمی‌گرداند:
        { "Status": "Done", " FileToDownload ": "https://…/Output.docx" }
    تطبیق دقیق شکست می‌خورد، لینک پیدا نمی‌شود، خروجی خالی می‌ماند و
    اعتبار مصرف‌شده هدر می‌رود. این تابع همان کاری را می‌کند که نسخهٔ PHP
    می‌کرد و کار می‌رفت.
    """
    if not isinstance(data, dict):
        return ""
    # ۱) تطبیق دقیق
    for name in candidates:
        value = data.get(name)
        if isinstance(value, (str, int, float)) and str(value).strip():
            return str(value).strip()
    # ۲) تطبیق نرم روی کلیدهای همین سطح
    wanted = {_norm_key(c) for c in candidates}
    for key, value in data.items():
        if not isinstance(value, (str, int, float)):
            continue
        if _norm_key(key) in wanted and str(value).strip():
            return str(value).strip()
    # ۳) جست‌وجوی بازگشتی در پاسخ‌های تودرتو
    for value in data.values():
        if isinstance(value, dict):
            found = pick_key(value, candidates)
            if found:
                return found
    return ""


DOWNLOAD_KEYS = ("FileToDownload", "FileToDownloadUrl", "DownloadUrl", "OutputFile", "FileUrl")


# ترتیب تلاش دوباره وقتی سرویس «InvalidParams» می‌دهد.
# منطق: هر بار یک پارامتر «ریسک‌دار» کمتر می‌فرستیم. اول با همه‌چیز، بعد
# بدون output (چون به روش وابسته است)، بعد با روش ۴ که برای همهٔ انواع
# فایل مجاز است. اگر هیچ‌کدام جواب نداد، خطای اصلی گزارش می‌شود.
_FALLBACK_STEPS = ("full", "no_output", "method4_no_output")


def convert(file_token: str, method: int = 4, output: str = "txtrawjson") -> dict:
    """تبدیل با «تلاش دوبارهٔ هوشمند».

    اگر سرویس InvalidParams بدهد، به‌جای شکست فوری، با پارامترهای
    محافظه‌کارانه‌تر دوباره تلاش می‌کنیم. تجربهٔ کاربر: به‌جای «خطا»،
    کار ادامه پیدا می‌کند — که هدف اصلی «هرگز گیر نکردن» است.

    اعتبار: هر تلاش دوباره فقط وقتی انجام می‌شود که سرویس درخواست را
    از پایه رد کرده باشد (یعنی تبدیل شروع نشده و اعتبار OCR مصرف نشده).
    """
    last_error: CloudError | None = None
    attempts: list[dict] = []

    for step in _FALLBACK_STEPS:
        payload: dict = {"command": "convert", "filetoken": file_token}
        if step == "full":
            payload["method"] = method
            if output:
                payload["output"] = output
        elif step == "no_output":
            payload["method"] = method
        else:                                   # method4_no_output
            payload["method"] = 4

        try:
            data = _call(payload, timeout=settings.CLOUD_OCR_TIMEOUT)
        except CloudError as exc:
            attempts.append({"step": step, "code": exc.code, "message": exc.message})
            if exc.code.lower().startswith(("invalid", "badrequest")):
                last_error = exc
                continue                        # این پارامتر مشکل داشت، بعدی
            # خطای دیگر (اعتبار/شبکه/فایل) با تلاش دوباره حل نمی‌شود
            exc.attempts = attempts             # type: ignore[attr-defined]
            raise

        return {
            "status": str(data.get("Status", "")),
            "download": pick_key(data, DOWNLOAD_KEYS),
            "output": str(data.get("Output") or "").strip(),
            "attempts": attempts,
            "raw": {k: v for k, v in data.items() if not k.startswith("_")},
        }

    # همهٔ حالت‌ها رد شدند
    assert last_error is not None
    last_error.attempts = attempts             # type: ignore[attr-defined]
    last_error.message = (
        f"{last_error.message} — هر سه حالت ارسال امتحان شد "
        f"({len(attempts)} تلاش) و هیچ‌کدام پذیرفته نشد. "
        "یعنی مشکل از نسخهٔ برنامه یا تغییر سرویس است؛ به پشتیبانی بگویید."
    )
    raise last_error


def convert_audio(file_token: str, language: str = "fa") -> dict:
    data = _call({"command": "convert", "filetoken": file_token, "language": language or "fa"})
    return {"status": str(data.get("Status", ""))}


def check_convert(file_token: str) -> dict:
    data = _call({"command": "checkconvert", "filetoken": file_token})
    # اگر کار در پاسخ «هنوز آماده نیست» علامت خورده، وضعیت را صریح برگردان
    if data.get("_pending"):
        return {"status": "NotReady", "progress": 0, "output": ""}
    progress_raw = str(data.get("Progress") or "0")
    digits = "".join(ch for ch in progress_raw if ch.isdigit() or ch == ".")
    try:
        progress = int(float(digits or 0))
    except ValueError:
        progress = 0
    return {
        "status": str(data.get("Status", "")),
        "progress": max(0, min(progress, 100)),
        "output": pick_key(data, ("Output", "Text", "Result")),
    }


def cancel_convert(file_token: str) -> dict:
    data = _call({"command": "cancelconvert", "filetoken": file_token})
    return {"status": str(data.get("Status", ""))}


def delete_file(file_token: str) -> dict:
    data = _call({"command": "deletefile", "filetoken": file_token})
    return {"status": str(data.get("Status", ""))}


def _as_int(value: Any) -> int:
    """تبدیل ایمن به عدد — مقدار خالی یا نامعتبر باید صفر شود، نه اینکه کار را بکشد."""
    try:
        return int(float(str(value or 0).strip() or 0))
    except (TypeError, ValueError):
        return 0


def check_credit() -> dict:
    data = _call({"command": "checkcredit"})
    return {
        "ocr_credit": _as_int(pick_key(data, ("OCRCredit", "OcrCredit", "Credit"))),
        "audio_credit": _as_int(pick_key(data, ("AudioTranscribeCredit", "AudioCredit"))),
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
