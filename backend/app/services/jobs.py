"""اجرای پس‌زمینه‌ای کارهای OCR (بدون بلاک شدن سرور)."""
from __future__ import annotations

import logging
import time
from pathlib import Path

from ..config import settings
from ..database import session_scope
from ..models import OcrJob, utcnow
from . import cloud_ocr
from .parser import parse_invoice

log = logging.getLogger("faktorkhan.jobs")

POLL_INTERVAL = 4
MEDIA_TIMEOUT = 60 * 12          # ۱۲ دقیقه برای فایل صوتی/تصویری


def _update(job_id: int, **fields) -> None:
    with session_scope() as db:
        job = db.get(OcrJob, job_id)
        if not job:
            return
        for key, value in fields.items():
            setattr(job, key, value)
        job.updated_at = utcnow()
        db.add(job)


def _get(job_id: int) -> OcrJob | None:
    with session_scope() as db:
        job = db.get(OcrJob, job_id)
        if job:
            db.expunge(job)
        return job


def start(job_id: int) -> None:
    import threading

    thread = threading.Thread(target=run, args=(job_id,), daemon=True, name=f"ocr-{job_id}")
    thread.start()


def run(job_id: int) -> None:
    job = _get(job_id)
    if not job:
        return
    try:
        if job.provider == "cloud":
            _run_cloud(job)
        else:
            _run_local(job)
    except cloud_ocr.CloudError as exc:
        log.warning("job %s cloud error: %s", job_id, exc.code)
        _update(job_id, status="failed", message=exc.message, progress=0)
    except Exception as exc:  # pragma: no cover
        log.exception("job %s crashed: %s", job_id, type(exc).__name__)
        _update(job_id, status="failed", message="خطای غیرمنتظره در پردازش فایل رخ داد.", progress=0)


# ---------------------------------------------------- بازیابی کارهای گیرکرده
def recover_stale(max_age_minutes: int = 20) -> int:
    """کارهایی که سرور وسط پردازششان خاموش/ری‌استارت شده را نجات بده.

    بدون این تابع، هر ری‌استارت سرور (یا هر بار که کاربر صفحه را رفرش
    می‌کند و کار در «در حال پردازش» مانده) یک کار یتیم برای همیشه باقی
    می‌گذارد: کاربر درصد ثابتی می‌بیند که هیچ‌وقت تمام نمی‌شود — دقیقاً
    همان چیزی که نباید اتفاق بیفتد.

    کارهایی که خیلی وقت است در وضعیت میانی مانده‌اند و رشته‌ای در این
    پروسه ندارند، به «شکست» با پیام روشن تبدیل می‌شوند تا کاربر بتواند
    دوباره تلاش کند.
    """
    import datetime as _dt
    from sqlalchemy import select

    cutoff = _dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(minutes=max_age_minutes)
    pending = {"queued", "uploading", "processing", "converting", "polling"}
    recovered = 0
    try:
        with session_scope() as db:
            rows = db.execute(select(OcrJob).where(OcrJob.status.in_(pending))).scalars().all()
            for row in rows:
                created = row.created_at
                if created is None:
                    continue
                if created.tzinfo is None:
                    created = created.replace(tzinfo=_dt.timezone.utc)
                if created > cutoff:
                    continue                        # تازه شروع شده — دست نزن
                row.status = "failed"
                row.progress = 0
                row.message = (
                    "پردازش این فایل نیمه‌کاره ماند (سرور در میانهٔ کار بازراه‌اندازی شد). "
                    "اعتباری برای آن مصرف نشده است؛ فایل را دوباره بفرستید."
                )
                recovered += 1
    except Exception as exc:                        # noqa: BLE001
        log.warning("recover_stale failed: %s", type(exc).__name__)
        return 0
    if recovered:
        log.warning("%d کار نیمه‌کاره بازیابی شد.", recovered)
    return recovered


# ------------------------------------------------------------ محلی
def _run_local(job: OcrJob) -> None:
    from . import local_ocr

    path = Path(job.file_path)
    _update(job.id, status="processing", progress=25, message="استخراج متن به‌صورت محلی…")
    result = local_ocr.extract(path)
    if not result["ok"]:
        _update(job.id, status="failed", message=result["message"] or "استخراج متن ناموفق بود.", progress=0)
        return
    parsed = parse_invoice(result["text"], job.meta.get("invoice_type") if job.meta else None)
    _update(
        job.id,
        status="done",
        progress=100,
        text=result["text"][:200000],
        pages=result["pages"],
        message=f"متن با موتور {result['engine']} استخراج شد.",
        meta={**(job.meta or {}), "engine": result["engine"], "parsed": parsed},
    )


# ------------------------------------------------------------ ابری
def _run_cloud(job: OcrJob) -> None:
    delete_after = (job.meta or {}).get("delete_after", True)
    meta = dict(job.meta or {})

    # ۱) ثبت فایل
    _update(job.id, status="uploading", progress=8, message="ارسال فایل به سرویس ابری…")
    if meta.get("source_link"):
        added = cloud_ocr.add_file_link(meta["source_link"])
    else:
        added = cloud_ocr.add_file(path=Path(job.file_path), file_name=job.file_name)

    file_token = added["file_token"]
    if not file_token:
        raise cloud_ocr.CloudError(
            "سرویس ابری توکن فایل را برنگرداند. فایل را دوباره با نام و قالب درست (jpg/png/pdf) "
            "ارسال کنید؛ اگر تکرار شد صفحهٔ عیب‌یابی (diag) را ببینید.",
            "NoFileToken",
        )
    meta.update({"methods": added["methods"], "kind": added["kind"], "remote": True})
    _update(job.id, file_token=file_token, pages=added["pages"] or job.pages, meta=meta,
            progress=22, message="فایل در سرویس ابری ثبت شد.")

    # ۲) تبدیل
    if added["kind"] == "media":
        _run_media(job, file_token, meta)
    else:
        _run_document(job, file_token, meta)

    # ۳) پاک‌سازی سمت سرویس (حریم خصوصی)
    if delete_after and file_token:
        try:
            cloud_ocr.delete_file(file_token)
            meta["remote"] = False
            _update(job.id, file_token="", meta=meta)
        except cloud_ocr.CloudError:
            pass


def _decode_text(raw: bytes) -> str:
    """رمزگشایی متن با چند کدگذاری — سرویس ممکن است هرکدام را بدهد."""
    for enc in ("utf-8-sig", "utf-8", "windows-1256", "cp1252", "utf-16"):
        try:
            return raw.decode(enc)
        except (UnicodeDecodeError, UnicodeError):
            continue
    return raw.decode("utf-8", errors="ignore")


def _docx_text(bundle) -> str:
    """متن را از بستهٔ docx بیرون می‌کشد (بدون وابستگی بیرونی)."""
    import re as _re
    import zipfile

    for entry in ("word/document.xml", "content.xml", "word/document2.xml"):
        try:
            xml = bundle.read(entry).decode("utf-8", errors="ignore")
        except KeyError:
            continue
        paragraphs = _re.split(r"</w:p>", xml)
        lines: list[str] = []
        for para in paragraphs:
            cells = _re.findall(r"<w:t[^>]*>(.*?)</w:t>", para, flags=_re.S)
            if not cells:
                # OpenDocument از <text:p> استفاده می‌کند
                cells = _re.findall(r"<text:p[^>]*>(.*?)</text:p>", para, flags=_re.S)
            line = "".join(cells)
            line = (_re.sub(r"<[^>]+>", "", line)
                    .replace("&amp;", "&").replace("&lt;", "<")
                    .replace("&gt;", ">").replace("&quot;", '"')
                    .replace("&apos;", "'"))
            if line.strip():
                lines.append(line.rstrip())
        if lines:
            return "\n".join(lines)
    return ""


def _json_text(raw: str) -> str:
    """متن را از پاسخ JSON بیرون می‌کشد — ساختارهای رایج سرویس‌ها را می‌شناسد."""
    import json

    try:
        data = json.loads(raw)
    except ValueError:
        return ""
    if isinstance(data, dict):
        for key in ("Output", "Text", "text", "Content", "content", "Result"):
            value = data.get(key)
            if isinstance(value, str) and value.strip():
                return value
    pieces: list[str] = []

    def walk(node) -> None:
        if isinstance(node, dict):
            for key in ("Text", "text", "Line", "Word", "Words", "Result", "Value"):
                value = node.get(key)
                if isinstance(value, str) and value.strip():
                    pieces.append(value.strip())
                    return
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(data)
    return "\n".join(pieces)


def _text_from_file(path: Path) -> str:
    """متن را از فایل خروجی سرویس بیرون می‌کشد.

    درس مهم از باگ واقعی (کاربر: «اعتبار کم می‌شود ولی متن نمی‌آید»):
    همان کاری را بکن که نسخهٔ PHP می‌کند و کار می‌کند — به **محتوای**
    فایل نگاه کن، نه فقط پسوند. سرویس لینک را گاهی بدون پسوند می‌دهد،
    گاهی با پسوند بزرگ، گاهی docx را با نام .bin. تشخیص بر پایهٔ پسوند
    در همهٔ این حالت‌ها متن را دور می‌ریخت در حالی که فایل سالم بود.
    """
    import zipfile

    try:
        raw = path.read_bytes()
    except OSError:
        return ""
    if not raw:
        return ""

    # ── ۱) شناسایی واقعی ZIP (docx/odt/zip خروجی) از روی بایت‌های اول
    if raw[:2] == b"PK":
        try:
            with zipfile.ZipFile(path) as bundle:
                text = _docx_text(bundle)
                if text.strip():
                    return text
                # زیپ ولی سند ورد نبود — دنبال هر فایل متنی داخلش بگرد
                for name in bundle.namelist():
                    if name.lower().endswith((".txt", ".json", ".xml", ".csv", ".html")):
                        inner = bundle.read(name)
                        if inner[:1] in (b"{", b"["):
                            parsed = _json_text(_decode_text(inner))
                            if parsed.strip():
                                return parsed
                        return _decode_text(inner)
                return ""                           # زیپ باز شد ولی متنی نبود
        except (zipfile.BadZipFile, OSError):
            # فایل با PK شروع شده ولی ZIP سالم نیست. اگر پسوندش سند است،
            # یعنی فایل خراب است — «notazip» را به‌عنوان متن فاکتور برنگردان.
            if path.suffix.lower() in {".docx", ".doc", ".odt", ".xlsx", ".pptx", ".zip"}:
                return ""
            # وگرنه ممکن است متن ساده‌ای باشد که اتفاقی با P شروع شده

    # ── ۲) شناسایی متن از روی محتوا (نه پسوند)
    head = raw[:600].lstrip().lower()
    looks_html = head.startswith((b"<!doctype", b"<html", b"<?xml", b"<w:"))
    looks_json = head[:1] in (b"{", b"[")
    # بایت‌های کنترلی = فایل دودویی
    _control = set(range(0, 9)) | {11, 12} | set(range(14, 32))
    is_binary = any(b in _control for b in raw[:4000])

    # پسوند سند ولی محتوا ZIP نیست → فایل خراب است، متن فاکتور برنگردان
    if path.suffix.lower() in {".docx", ".doc", ".odt", ".xlsx", ".pptx"} and not looks_json:
        if not (looks_html and b"<w:" in head):
            return ""

    if looks_json:
        parsed = _json_text(_decode_text(raw))
        if parsed.strip():
            return parsed
        return _decode_text(raw)                    # JSON نامعتبر → خام

    if looks_html or not is_binary:
        text = _decode_text(raw)
        if looks_html or "<" in text[:200]:
            # تگ‌های HTML/XML را بردار تا متن خالص بماند
            import re as _re
            text = _re.sub(r"<script[\s\S]*?</script>", " ", text, flags=_re.I)
            text = _re.sub(r"<style[\s\S]*?</style>", " ", text, flags=_re.I)
            text = _re.sub(r"<[^>]+>", "\n", text)
            for entity, char in (("&nbsp;", " "), ("&amp;", "&"), ("&lt;", "<"),
                                 ("&gt;", ">"), ("&quot;", '"'), ("&#39;", "'")):
                text = text.replace(entity, char)
            text = "\n".join(line.strip() for line in text.splitlines() if line.strip())
        return text

    # ── ۳) دودویی ناشناخته — پسوند می‌تواند کمک کند
    suffix = path.suffix.lower()
    if suffix in {".txt", ".csv", ".xml", ".html", ".htm", ".json", ".rtf"}:
        return _decode_text(raw)
    return ""


def _rescue_with_ai(job: OcrJob, meta: dict) -> str:
    """اگر سرویس ابری متنی نداد، خود تصویر را با هوش مصنوعی بخوان.

    مزیت بزرگ: اعتبار سرویس ابری مصرف نمی‌شود و فایل روی سرور خودمان
    است. اگر کلید تنظیم شده باشد، کاربر هرگز «دست‌خالی» نمی‌ماند.
    """
    from .ai_parser import extract_items_ai

    path = Path(job.file_path or "")
    if not job.file_path or not path.is_file():
        meta["ai_rescue"] = "no_file"
        return ""
    suffix = path.suffix.lower()
    if suffix not in {".png", ".jpg", ".jpeg", ".webp", ".pdf", ".bmp", ".tif", ".tiff"}:
        meta["ai_rescue"] = "unsupported_type"
        return ""
    _update(job.id, message="سرویس ابری متنی نداد؛ خوانش با موتور هوش مصنوعی…", progress=70)
    result = extract_items_ai(
        str(path), api_key=settings.AI_ITEMS_KEY,
        model=settings.AI_ITEMS_MODEL, timeout=settings.AI_ITEMS_TIMEOUT,
    )
    if not result.get("ok"):
        meta["ai_rescue"] = result.get("error") or "failed"
        meta["ai_rescue_message"] = result.get("message") or ""
        return ""

    # فاکتور را از ساختار AI به متن خوانا تبدیل کن تا در همان باکس بیاید
    lines: list[str] = []
    for item in result.get("items") or []:
        name = str(item.get("description") or item.get("name") or "").strip()
        qty = item.get("quantity") or 0
        price = item.get("unit_price") or 0
        total = item.get("total") or item.get("line_total") or 0
        if name:
            parts = [name]
            if qty:
                parts.append(f"تعداد {qty}")
            if price:
                parts.append(f"قیمت {price:,}")
            if total:
                parts.append(f"مبلغ {total:,}")
            lines.append(" — ".join(parts))
    totals = result.get("totals") or {}
    if totals.get("total"):
        lines.append(f"جمع کل: {int(totals['total']):,}")
    elif totals.get("subtotal"):
        lines.append(f"جمع کل: {int(totals['subtotal']):,}")

    meta["ai_rescue"] = "ok"
    meta["ai_result"] = result
    return "\n".join(lines)


def _run_document(job: OcrJob, file_token: str, meta: dict) -> None:
    method = int(job.method or 4)
    allowed = meta.get("methods") or []
    if allowed and method not in allowed:
        method = min(allowed)
        meta["method_adjusted"] = method
    _update(job.id, status="converting", progress=40, message="تبدیل در حال انجام است…", method=method)
    try:
        result = cloud_ocr.convert(file_token, method=method, output=job.output or "txtrawjson")
    except cloud_ocr.CloudError as exc:
        # هر خطای سرویس باید کار را با پیام روشن ببندد، نه اینکه آن را
        # در وضعیت «در حال تبدیل» رها کند (کاربر فکر می‌کند گیر کرده).
        meta["convert_status"] = exc.code
        meta["convert_error"] = exc.message
        meta["remote"] = True
        _update(job.id, status="failed", progress=0, message=exc.message, meta=meta,
                result_path="")
        return
    meta["convert_status"] = result.get("status", "")

    text = ""
    download_url = result.get("download") or ""
    # عمداً None است، نه Path(""): Path("") به پوشهٔ جاری اشاره می‌کند و
    # exists() آن True می‌شود — نتیجه یک پیام دروغ «فایل ذخیره شد» بود
    # در حالی که هیچ فایلی ذخیره نشده بود.
    saved: Path | None = None

    # ── ۱) لینک خروجی: بی‌درنگ دانلود شود (طبق قرارداد سرویس برای عکس/PDF)
    if download_url:
        suffix = Path(download_url.split("?")[0]).suffix or ".txt"
        saved = settings.storage_exports / f"job-{job.id}{suffix}"
        try:
            cloud_ocr.download(download_url, saved)
            meta["result_file"] = str(saved)
            meta["result_suffix"] = suffix
            text = _text_from_file(saved)
            if text.strip():
                meta["text_source"] = "download"
        except cloud_ocr.CloudError as exc:
            meta["download_failed"] = True
            meta["download_error"] = exc.code
            log.warning("دانلود خروجی کار %s ناموفق: %s", job.id, exc.code)

    # ── ۲) متن مستقیم در پاسخ convert (بدون نیاز به فایل)
    if not text.strip() and result.get("output"):
        text = result["output"]
        meta["text_source"] = "convert"

    # ── ۳) دنبال کردن وضعیت
    #
    # دو قاعدهٔ مهم که هر دو از قرارداد واقعی سرویس می‌آیند:
    #
    #   الف) اگر `convert` لینک فایل داد، کار تمام است. طبق قرارداد سرویس،
    #        برای عکس و PDF مسیر درست «addfile → convert → دانلود» است و
    #        `checkconvert` نقشی ندارد. نسخهٔ قبلی اینجا همیشه checkconvert
    #        می‌زد؛ برای عکس سرویس با InvalidParams جواب می‌داد و کار
    #        می‌مرد — در حالی که فایل خروجی آماده و قابل دانلود بود.
    #
    #   ب) `checkconvert` فقط برای فایل صوتی/تصویری معنا دارد (و شاید صف).
    #        هر خطای آن باید نادیده گرفته شود، نه اینکه کل کار را بکشد.
    if not text.strip() and not download_url:
        try:
            checked = cloud_ocr.check_convert(file_token)
        except cloud_ocr.CloudError as exc:
            # سرویس این فایل را برای checkconvert نمی‌شناسد — یعنی مسیرش
            # convert→download بوده، نه checkconvert. کار نباید بمیرد.
            meta["check_error"] = exc.code
            meta["check_error_message"] = exc.message
            log.info("checkconvert برای کار %s معنا نداشت (%s)", job.id, exc.code)
            checked = {}

        if checked:
            meta["check_status"] = checked.get("status", "")
            if checked.get("output"):
                text = checked["output"]
                meta["text_source"] = "checkconvert"

            lowered = checked.get("status", "").lower().replace(" ", "")
            pending = {"converting", "inprogress", "processing", "queued", "waiting", "notready"}
            if not text.strip() and (lowered in pending or checked.get("progress", 0) < 100):
                for _ in range(30):
                    time.sleep(POLL_INTERVAL)
                    try:
                        checked = cloud_ocr.check_convert(file_token)
                    except cloud_ocr.CloudError as exc:
                        # همین وضعیت ممکن است برای صف هم رخ دهد؛ صبر می‌کنیم
                        log.info("checkconvert کار %s: %s", job.id, exc.code)
                        meta["check_error"] = exc.code
                        continue
                    _update(job.id, progress=min(55 + checked.get("progress", 0) // 2, 92),
                            message=f"پیشرفت تبدیل: {checked.get('progress', 0)}%")
                    if checked.get("output"):
                        text = checked["output"]
                        meta["text_source"] = "checkconvert"
                        break
                    lowered = checked.get("status", "").lower().replace(" ", "")
                    if checked.get("progress", 0) >= 100 or lowered in {"done", "finished", "completed"}:
                        break
                    if lowered in {"error", "failed", "notfound"}:
                        break

    # ── ۴) اگر لینک داشتیم ولی متن از فایل درنیامد، یک بار دیگر از لینک
    #      به شکل دیگری امتحان کن (مثلاً لینک به zip یا فایل بدون پسوند).
    if not text.strip() and download_url:
        try:
            checked = cloud_ocr.check_convert(file_token)
            if checked.get("output"):
                text = checked["output"]
                meta["text_source"] = "checkconvert-fallback"
        except cloud_ocr.CloudError:
            pass

    parsed = parse_invoice(text, job.meta.get("invoice_type") if job.meta else None)
    meta["parsed"] = parsed
    meta["remote"] = True
    meta["chars"] = len(text)

    # ── ۵) نجات خودکار: اگر سرویس متنی نداد، خودِ تصویر را از موتور
    #      هوش مصنوعی بخوان. این همان کاری است که نسخهٔ PHP می‌کند و
    #      کاربر را از «اعتبار کم شد ولی متنی نیامد» نجات می‌دهد.
    if not text.strip() and settings.AI_ITEMS_ENABLED and settings.AI_ITEMS_KEY:
        rescued = _rescue_with_ai(job, meta)
        if rescued:
            text = rescued

    if not text.strip():
        # پیام دقیق: بگو دقیقاً کجا شکست خورد و کاربر چه کار کند،
        # نه یک جملهٔ مبهم که فقط نگرانی تولید می‌کند.
        detail = []
        if download_url:
            detail.append("لینک خروجی آمد ولی متنی داخلش نبود")
        else:
            detail.append("سرویس لینک خروجی نداد")
        if meta.get("result_suffix"):
            detail.append(f"قالب دریافتی: {meta['result_suffix']}")
        # وضعیت checkconvert را فقط وقتی نشان بده که واقعاً مسیر تبدیل بوده.
        # اگر فایل از طریق لینک آمده بود، خطای checkconvert بی‌ربط است و
        # بردنش در پیام فقط کاربر را گمراه می‌کند (باگ واقعی: کاربر
        # «InvalidParams» دید در حالی که فایلش سالم دانلود شده بود).
        if meta.get("check_status") and not download_url:
            detail.append(f"وضعیت سرویس: {meta['check_status']}")
        message = "سرویس ابری خروجی متنی برنگرداند — " + " · ".join(detail) + "."
        kept = bool(saved is not None and saved.is_file() and saved.stat().st_size > 0)
        # فقط وقتی بگو «دانلودش کن» که فایل واقعاً سند قابل‌استفاده باشد.
        # گفتن این جمله برای فایل دودوییِ بی‌محتوا کاربر را دنبال سراب می‌فرستد.
        _doc_suffixes = {".docx", ".doc", ".pdf", ".odt", ".txt", ".rtf", ".xlsx"}
        kept_useful = kept and (Path(str(saved)).suffix.lower() in _doc_suffixes
                                or meta.get("text_source") in {"download", "convert"})
        if kept_useful:
            message += " فایل خروجی ذخیره شد؛ از پنل دانلودش کنید."
        elif meta.get("convert_status", "").lower().startswith(("invalid", "badrequest")):
            # درخواست از پایه رد شده — کیفیت عکس ربطی ندارد، گفتنش گمراه‌کننده است
            message += (" این خطا از درخواست است، نه از عکس — کمی بعد دوباره تلاش کنید؛ "
                        "اگر تکرار شد به پشتیبانی بگویید.")
        elif download_url:
            # لینک آمده بود ولی فایل قابل خواندن نبود — مشکل از عکس نیست
            message += (" فایل خروجی از سرویس دریافت شد ولی متن قابل استخراج نبود. "
                        "اگر تکرار شد، قالب خروجی را در تنظیمات به «متن خام» تغییر دهید.")
        else:
            message += (" فایل را دوباره بفرستید؛ اگر تکرار شد، کیفیت عکس را بالا ببرید "
                        "(نور یکدست، بدون کج‌شدگی) یا از موتور هوش مصنوعی استفاده کنید.")
        _update(job.id, status="failed", message=message, meta=meta, progress=0,
                result_path=str(saved) if kept else "")
        return

    _update(
        job.id,
        status="done",
        progress=100,
        text=text[:400000],
        message=f"تبدیل انجام شد — {len(text):,} نویسه استخراج شد.",
        meta=meta,
        result_path=str(saved) if (saved is not None and saved.is_file()) else "",
    )


def _run_media(job: OcrJob, file_token: str, meta: dict) -> None:
    _update(job.id, status="converting", progress=30, message="شروع تبدیل گفتار به متن…")
    try:
        cloud_ocr.convert_audio(file_token, language=job.language or "fa")
    except cloud_ocr.CloudError as exc:
        meta["convert_status"] = exc.code
        _update(job.id, status="failed", progress=0, message=exc.message, meta=meta,
                result_path="")
        return

    started = time.time()
    text = ""
    errors = 0
    while time.time() - started < MEDIA_TIMEOUT:
        time.sleep(POLL_INTERVAL)
        try:
            checked = cloud_ocr.check_convert(file_token)
        except cloud_ocr.CloudError as exc:
            # خطای گذرا یا ناسازگاری پارامتر نباید کار را بکشد؛ چند بار صبر
            # می‌کنیم و اگر ادامه یافت با پیام روشن می‌بندیم.
            errors += 1
            meta["last_check_error"] = exc.code
            log.info("checkconvert صوتی کار %s: %s (%s)", job.id, exc.code, errors)
            if errors >= 5:
                _update(job.id, status="failed", progress=0, meta=meta, result_path="",
                        message=f"وضعیت تبدیل صوتی از سرویس خوانده نشد ({exc.code}). "
                                "دوباره تلاش کنید.")
                return
            continue

        errors = 0
        status = checked["status"].lower()
        progress = checked["progress"]
        text = checked.get("output") or text
        _update(job.id, progress=max(30, min(progress, 96)),
                message=f"پیشرفت تبدیل: {progress}%", text=text[:400000])
        if progress >= 100 or status in {"done", "finished", "completed"}:
            break
        if status in {"notfound", "error", "failed", "convertterminated"}:
            _update(job.id, status="failed", progress=0, meta=meta, result_path="",
                    message="تبدیل گفتار به متن ناموفق بود.")
            return

    if not text.strip():
        # «تبدیل تمام شد ولی متنی نبود» با «موفق» یکی نیست
        _update(job.id, status="failed", progress=0, meta=meta, result_path="",
                message="سرویس برای این فایل صوتی متنی برنگرداند. "
                        "فایل را دوباره بفرستید یا کیفیت صدا را بررسی کنید.")
        return

    parsed = parse_invoice(text, "audio")
    meta["parsed"] = parsed
    _update(job.id, status="done", progress=100, text=text[:400000], meta=meta,
            message=f"تبدیل گفتار به متن پایان یافت — {len(text):,} نویسه.")


def retry(job_id: int) -> None:
    _update(job_id, status="queued", progress=0, message="در صف پردازش…")
    start(job_id)
