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


def _text_from_file(path: Path) -> str:
    """متن را از فایل خروجی سرویس بیرون می‌کشد.

    سرویس ممکن است txt/json/docx/html/zip بدهد. نسخهٔ قبلی فقط پسوندهای
    متنی را می‌خواند و اگر docx می‌آمد، متن خالی می‌ماند و کار «شکست»
    اعلام می‌شد — در حالی که توکن مصرف شده بود.
    """
    import json
    import zipfile

    suffix = path.suffix.lower()
    try:
        if suffix in {".txt", ".csv", ".xml", ".html", ".htm"}:
            raw = path.read_bytes()
            for enc in ("utf-8-sig", "utf-8", "windows-1256", "cp1252"):
                try:
                    return raw.decode(enc)
                except UnicodeDecodeError:
                    continue
            return raw.decode("utf-8", errors="ignore")

        if suffix == ".json":
            raw = path.read_text(encoding="utf-8", errors="ignore")
            try:
                data = json.loads(raw)
            except ValueError:
                return raw
            # ساختارهای رایج: {"Output": "..."} یا فهرست صفحه‌ها با Text/Lines
            if isinstance(data, dict):
                for key in ("Output", "Text", "text", "content", "Content"):
                    if isinstance(data.get(key), str) and data[key].strip():
                        return data[key]
            pieces: list[str] = []

            def walk(node) -> None:
                if isinstance(node, str):
                    return
                if isinstance(node, dict):
                    for key in ("Text", "text", "Line", "Words", "Result", "Value"):
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
            if pieces:
                return "\n".join(pieces)
            return raw

        if suffix == ".docx":
            # docx خودش zip است؛ متن در word/document.xml و با تگ <w:t>
            with zipfile.ZipFile(path) as bundle:
                try:
                    xml = bundle.read("word/document.xml").decode("utf-8", errors="ignore")
                except KeyError:
                    return ""
            import re as _re
            # هر پاراگراف یک خط؛ بدون این کار همهٔ سطرها به هم می‌چسبند
            # («فاکتور خریدمبلغ ۲۵۰۰۰۰») و ستون‌های جدول از هم جدا نمی‌شوند.
            paragraphs = _re.split(r"</w:p>", xml)
            lines: list[str] = []
            for para in paragraphs:
                cells = _re.findall(r"<w:t[^>]*>(.*?)</w:t>", para, flags=_re.S)
                line = "".join(cells)
                line = (_re.sub(r"<[^>]+>", "", line)
                        .replace("&amp;", "&").replace("&lt;", "<")
                        .replace("&gt;", ">").replace("&quot;", '"')
                        .replace("&apos;", "'"))
                if line.strip():
                    lines.append(line.rstrip())
            return "\n".join(lines)

        if suffix == ".zip":
            with zipfile.ZipFile(path) as bundle:
                for name in bundle.namelist():
                    if name.lower().endswith((".txt", ".json", ".xml", ".htm", ".html")):
                        return _text_from_file_name(bundle, name)
            return ""
    except (OSError, zipfile.BadZipFile, ValueError) as exc:
        log.warning("خواندن خروجی %s ناموفق: %s", suffix, type(exc).__name__)
        return ""
    return ""


def _text_from_file_name(bundle, name: str) -> str:
    raw = bundle.read(name)
    for enc in ("utf-8-sig", "utf-8", "windows-1256"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="ignore")


def _run_document(job: OcrJob, file_token: str, meta: dict) -> None:
    method = int(job.method or 4)
    allowed = meta.get("methods") or []
    if allowed and method not in allowed:
        method = min(allowed)
        meta["method_adjusted"] = method
    _update(job.id, status="converting", progress=40, message="تبدیل در حال انجام است…", method=method)
    result = cloud_ocr.convert(file_token, method=method, output=job.output or "txtrawjson")
    meta["convert_status"] = result.get("status", "")

    text = ""
    download_url = result.get("download") or ""
    saved = Path("")

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

    # ── ۳) دنبال کردن وضعیت — فقط اگر واقعاً در حال تبدیل است
    if not text.strip():
        checked = cloud_ocr.check_convert(file_token)
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
                    log.warning("checkconvert کار %s: %s", job.id, exc.code)
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

    # ── ۴) اگر لینک داشتیم ولی دانلود متن نداد، دوباره از checkconvert امتحان کن
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
        if meta.get("check_status"):
            detail.append(f"وضعیت سرویس: {meta['check_status']}")
        message = "سرویس ابری خروجی متنی برنگرداند — " + " · ".join(detail) + "."
        kept = saved and saved.exists() and saved.stat().st_size > 0
        if kept:
            message += " فایل خروجی ذخیره شد؛ از پنل دانلودش کنید."
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
        result_path=str(saved) if (saved and saved.exists()) else "",
    )


def _run_media(job: OcrJob, file_token: str, meta: dict) -> None:
    _update(job.id, status="converting", progress=30, message="شروع تبدیل گفتار به متن…")
    cloud_ocr.convert_audio(file_token, language=job.language or "fa")
    started = time.time()
    text = ""
    while time.time() - started < MEDIA_TIMEOUT:
        time.sleep(POLL_INTERVAL)
        checked = cloud_ocr.check_convert(file_token)
        status = checked["status"].lower()
        progress = checked["progress"]
        text = checked.get("output") or text
        _update(job.id, progress=max(30, min(progress, 96)),
                message=f"پیشرفت تبدیل: {progress}%", text=text[:400000])
        if progress >= 100 or status in {"done", "finished", "completed"}:
            break
        if status in {"notfound", "error", "failed", "convertterminated"}:
            _update(job.id, status="failed", message="تبدیل گفتار به متن ناموفق بود.", progress=0)
            return
    parsed = parse_invoice(text, "audio")
    meta["parsed"] = parsed
    _update(job.id, status="done", progress=100, text=text[:400000], meta=meta,
            message="تبدیل گفتار به متن پایان یافت.")


def retry(job_id: int) -> None:
    _update(job_id, status="queued", progress=0, message="در صف پردازش…")
    start(job_id)
