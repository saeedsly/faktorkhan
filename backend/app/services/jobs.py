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
        raise cloud_ocr.CloudError("سرویس ابری توکن فایل را برنگرداند.", "NoFileToken")
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


def _run_document(job: OcrJob, file_token: str, meta: dict) -> None:
    method = int(job.method or 4)
    allowed = meta.get("methods") or []
    if allowed and method not in allowed:
        method = min(allowed)
        meta["method_adjusted"] = method
    _update(job.id, status="converting", progress=40, message="تبدیل در حال انجام است…", method=method)
    result = cloud_ocr.convert(file_token, method=method, output=job.output or "txtrawjson")

    text = ""
    download_url = result.get("download") or ""
    if download_url:
        suffix = Path(download_url.split("?")[0]).suffix or ".txt"
        dest = settings.storage_exports / f"job-{job.id}{suffix}"
        try:
            cloud_ocr.download(download_url, dest)
            meta["result_file"] = str(dest)
            if suffix.lower() in {".txt", ".json", ".csv", ".xml", ".html"}:
                text = dest.read_text(encoding="utf-8", errors="ignore")
        except cloud_ocr.CloudError:
            meta["download_failed"] = True

    if not text.strip():
        checked = cloud_ocr.check_convert(file_token)
        if checked.get("output"):
            text = checked["output"]
        if checked.get("status", "").lower() in {"converting", "inprogress"}:
            for _ in range(20):
                time.sleep(POLL_INTERVAL)
                checked = cloud_ocr.check_convert(file_token)
                _update(job.id, progress=min(55 + checked.get("progress", 0) // 2, 92))
                if checked.get("output"):
                    text = checked["output"]
                if checked.get("progress", 0) >= 100 or checked.get("status", "").lower() in {"done", "finished"}:
                    break

    parsed = parse_invoice(text, job.meta.get("invoice_type") if job.meta else None)
    meta["parsed"] = parsed
    meta["remote"] = True
    if not text.strip() and not download_url:
        _update(job.id, status="failed", message="سرویس ابری خروجی متنی برنگرداند.", meta=meta, progress=0)
        return
    _update(
        job.id,
        status="done",
        progress=100,
        text=text[:400000],
        message=f"تبدیل با روش {job.method} انجام شد.",
        meta=meta,
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
