"""موتور اختیاری «ایبو» (سرویس ابری OCR؛ نیاز به توکن API و اعتبار حساب).

پیش‌فرض خاموش است. فقط وقتی فعال می‌شود که متغیر محیطی EBOO_TOKEN تنظیم شده باشد.
تصویر برای سرور ایبو ارسال می‌شود؛ بنابراین کاربر باید آگاهانه آن را فعال کند.

جریان (طبق «راهنمای استفاده از سرویس API ایبو، نگارش ۳.۴»):
    1. addfile   فایل را بفرست؛ FileToken می‌گیری
    2. convert   با method=4 (استخراج متن OCR) و output=txtraw؛ متن می‌گیری
    3. deletefile  فایل را از سرور ایبو پاک کن (در هر حالت)

توکن هرگز در پیام خطا، پاسخ API یا لاگ نوشته نمی‌شود.
"""

from __future__ import annotations

import json
import os
import time
from typing import Any

import httpx

API_URL = "https://www.eboo.ir/api/ocr/getway"
TOKEN_ENV = "EBOO_TOKEN"
OCR_METHOD = 4  # استخراج متن OCR؛ برای عکس و PDF تصویری فقط این روش فعال است
POLL_SECONDS = 2.0
POLL_LIMIT = 60  # حدود ۲ دقیقه


class EbooError(RuntimeError):
    """خطای منطقی سرویس ایبو؛ code همان Status یا کد HTTP است (بدون توکن)."""

    def __init__(self, code: str, message: str = ""):
        super().__init__(message or code)
        self.code = code


ERROR_TEXT = {
    "FileCorrupted": "فایل خراب، غیرمجاز یا دارای رمز است.",
    "NoEnoughCredit": "اعتبار حساب ایبو کافی نیست.",
    "UploadFailed": "آپلود فایل به ایبو ناموفق بود.",
    "UnknowMethod": "روش تبدیل نامعتبر است.",
    "TokenNotFound": "فایل با این توکن در ایبو پیدا نشد.",
    "MethodNotAllowed": "این روش تبدیل برای این فایل مجاز نیست.",
    "ConvertError": "خطا در تبدیل فایل در ایبو.",
    "IPError": "آی‌پی این رایانه برای توکن ایبو مجاز نیست (در پنل ایبو بررسی کنید).",
    "500": "خطای داخلی سرور ایبو.",
}


class EbooEngine:
    name = "eBoo API (ابری)"

    def __init__(self, token: str, base_url: str = API_URL, timeout: float = 120.0,
                 transport: httpx.BaseTransport | None = None, poll_seconds: float = POLL_SECONDS):
        if not token or not token.strip():
            raise ValueError("توکن ایبو خالی است.")
        self._token = token.strip()
        self._url = base_url
        self._poll = poll_seconds
        self._client = httpx.Client(timeout=timeout, transport=transport)

    # ----- ارتباط با API -----
    def _call(self, data: dict[str, Any], files: dict | None = None) -> dict[str, Any] | str:
        payload = {"token": self._token, **data}
        try:
            res = self._client.post(self._url, data=payload, files=files)
        except httpx.HTTPError as exc:
            raise EbooError("NetworkError", "اتصال به سرویس ایبو برقرار نشد.") from exc
        if res.status_code != 200:
            raise EbooError(str(res.status_code), ERROR_TEXT.get(str(res.status_code), f"HTTP {res.status_code}"))
        text = res.text.strip()
        try:
            body = json.loads(text)
        except json.JSONDecodeError:
            return text  # حالت txtraw: متن ساده
        if isinstance(body, dict) and body.get("Status") not in (None, "Done", "ConvertStarted", "Converting"):
            code = str(body.get("Status"))
            raise EbooError(code, ERROR_TEXT.get(code, f"خطای ایبو: {code}"))
        return body

    def add_file(self, data: bytes, filename: str) -> dict[str, Any]:
        files = {"filehandle": (filename, data, "application/octet-stream")}
        body = self._call({"command": "addfile"}, files=files)
        if not isinstance(body, dict) or not body.get("FileToken"):
            raise EbooError("BadResponse", "پاسخ addfile ایبو توکن فایل ندارد.")
        return body

    def convert(self, file_token: str) -> str:
        body = self._call({"command": "convert", "filetoken": file_token,
                           "method": str(OCR_METHOD), "output": "txtraw"})
        return self._extract_text(body, file_token)

    def _extract_text(self, body: dict[str, Any] | str, file_token: str) -> str:
        if isinstance(body, str):
            return body
        if body.get("Status") in ("Done", None) and any(k in body for k in ("Output", "output", "Text")):
            return str(body.get("Output") or body.get("output") or body.get("Text"))
        # تبدیل ممکن است ناهمزمان باشد؛ با checkconvert پیگیری کن
        for _ in range(POLL_LIMIT):
            if body.get("Status") not in ("Converting", "ConvertStarted", None):
                break
            time.sleep(self._poll)
            body = self._call({"command": "checkconvert", "filetoken": file_token})
            if isinstance(body, str):
                return body
            if body.get("Output"):
                return str(body["Output"])
        raise EbooError("NoOutput", "ایبو متنی برنگرداند (پاسخ ناشناخته یا زمان تمام شد).")

    def delete_file(self, file_token: str) -> None:
        try:
            self._call({"command": "deletefile", "filetoken": file_token})
        except EbooError:
            pass  # حذف ناموفق نباید خروجی OCR را خراب کند؛ در پیام به کاربر گفته می‌شود

    def check_credit(self) -> dict[str, Any]:
        body = self._call({"command": "checkcredit"})
        return body if isinstance(body, dict) else {"raw": body}

    # ----- رابط یکسان با سایر موتورها -----
    def recognize_bytes(self, data: bytes, filename: str = "invoice.png") -> dict[str, Any]:
        if not data:
            raise ValueError("فایل خالی است.")
        started = time.perf_counter()
        added = self.add_file(data, _filename_for(data, filename))
        token = str(added["FileToken"])
        try:
            text = self.convert(token)
        finally:
            self.delete_file(token)
        return {
            "engine": self.name,
            "model_files": {"api": "eboo", "method": str(OCR_METHOD)},
            "decode": "ebo",
            "text": text.strip(),
            "variants": {"ebo": text.strip()},
            "lines": [],
            "seconds": round(time.perf_counter() - started, 3),
        }


def _filename_for(data: bytes, default: str) -> str:
    """ایبو از پسوند فایل نوع آن را می‌فهمد؛ پسوند را از روی محتوای واقعی تعیین می‌کنیم."""
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "invoice.png"
    if data[:3] == b"\xff\xd8\xff":
        return "invoice.jpg"
    if data[:4] == b"%PDF":
        return "invoice.pdf"
    if data[:2] == b"BM":
        return "invoice.bmp"
    return default


def engine_from_env(env: dict[str, str] | None = None, transport: httpx.BaseTransport | None = None) -> EbooEngine | None:
    """اگر EBOO_TOKEN تنظیم نشده باشد None برمی‌گرداند (موتور خاموش)."""
    env = os.environ if env is None else env
    token = env.get(TOKEN_ENV, "").strip()
    if not token:
        return None
    return EbooEngine(token, transport=transport)
