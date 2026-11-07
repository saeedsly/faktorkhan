"""موتور خوانش فاکتور: حالت ابری + حالت لوکال، کارها و تبدیل به فاکتور."""
from __future__ import annotations

import shutil
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..deps import audit, consume_quota, get_current_user, rate_limit, require_active_subscription
from ..jalali import today_jalali
from ..models import Invoice, InvoiceItem, OcrJob, User, utcnow
from ..schemas import CloudLinkIn, InvoiceIn
from ..serializers import invoice_public, job_public
from ..services import cloud_ocr, jobs as job_runner, local_ocr
from ..services.parser import parse_invoice

router = APIRouter(prefix="/api/ocr", tags=["ocr"])

ALLOWED_EXT = {".pdf", ".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".webp",
               ".mp3", ".wav", ".m4a", ".mp4", ".ogg", ".flac", ".3gp", ".mpeg"}


def _user_dir(user_id: int) -> Path:
    path = settings.storage_uploads / str(user_id)
    path.mkdir(parents=True, exist_ok=True)
    return path


def _save_upload(upload: UploadFile, user: User) -> Path:
    suffix = Path(upload.filename or "").suffix.lower()
    if suffix not in ALLOWED_EXT:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "قالب فایل مجاز نیست (PDF، تصویر یا فایل صوتی/تصویری).")
    dest = _user_dir(user.id) / f"{uuid.uuid4().hex}{suffix}"
    size = 0
    limit = settings.MAX_UPLOAD_MB * 1024 * 1024
    try:
        with open(dest, "wb") as out:
            while chunk := upload.file.read(1024 * 256):
                size += len(chunk)
                if size > limit:
                    raise HTTPException(
                        status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        f"حجم فایل بیش از {settings.MAX_UPLOAD_MB} مگابایت است.",
                    )
                out.write(chunk)
    except HTTPException:
        dest.unlink(missing_ok=True)
        raise
    finally:
        upload.file.close()
    if size == 0:
        dest.unlink(missing_ok=True)
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "فایل خالی است.")
    return dest


@router.get("/capabilities")
def capabilities(user: User = Depends(get_current_user)):
    local = local_ocr.capabilities()
    state = cloud_ocr.token_state()
    return {
        "cloud": {
            "configured": state["gateway_ready"] and state["configured"],
            "token_set": state["configured"],
            "gateway_ready": state["gateway_ready"],
            "methods": [1, 2, 3, 4],
            "outputs": ["txtrawjson", "txtraw", "txt", "jsoncoordinates", "keeplayout", ""],
            "languages": [
                {"code": "fa", "name": "فارسی"}, {"code": "en", "name": "انگلیسی"},
                {"code": "ar", "name": "عربی"}, {"code": "tr", "name": "ترکی"},
                {"code": "de", "name": "آلمانی"}, {"code": "fr", "name": "فرانسوی"},
                {"code": "ru", "name": "روسی"}, {"code": "es", "name": "اسپانیایی"},
                {"code": "it", "name": "ایتالیایی"}, {"code": "hi", "name": "هندی"},
                {"code": "ko", "name": "کره‌ای"}, {"code": "ja", "name": "ژاپنی"},
                {"code": "ch", "name": "چینی"},
            ],
        },
        "local": local,
        "max_upload_mb": settings.MAX_UPLOAD_MB,
    }


@router.post("/upload", status_code=201)
def upload_and_process(
    request: Request,
    file: UploadFile = File(...),
    provider: str = Form("cloud"),
    method: int = Form(4),
    output: str = Form("txtrawjson"),
    language: str = Form("fa"),
    invoice_type: str = Form("printed"),
    delete_after: bool = Form(True),
    user: User = Depends(require_active_subscription),
    db: Session = Depends(get_db),
):
    rate_limit(request, "ocr_upload", limit=40, window=60)
    if provider not in {"cloud", "local"}:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "موتور نامعتبر است.")
    if provider == "cloud" and not (cloud_ocr.gateway_configured() and cloud_ocr.token_state()["configured"]):
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "سرویس ابری آماده نیست. از حالت لوکال استفاده کنید یا با مدیر تماس بگیرید.")
    path = _save_upload(file, user)

    job = OcrJob(
        user_id=user.id,
        provider=provider,
        method=max(1, min(method, 4)),
        output=output,
        language=language,
        file_name=(file.filename or path.name)[:255],
        file_path=str(path),
        status="queued",
        progress=0,
        message="در صف پردازش…",
        meta={"invoice_type": invoice_type, "delete_after": bool(delete_after)},
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    audit(db, user, "ocr_start", "job", job.id, f"{provider} / {job.file_name}", request)
    job_runner.start(job.id)
    return {"job": job_public(job)}


@router.post("/link", status_code=201)
def process_link(payload: CloudLinkIn, request: Request,
                 user: User = Depends(require_active_subscription), db: Session = Depends(get_db)):
    rate_limit(request, "ocr_link", limit=20, window=60)
    if not (cloud_ocr.gateway_configured() and cloud_ocr.token_state()["configured"]):
        raise HTTPException(status.HTTP_409_CONFLICT, "سرویس ابری آماده نیست.")
    job = OcrJob(
        user_id=user.id, provider="cloud", method=max(1, min(payload.method, 4)),
        output=payload.output, file_name=payload.filelink.rsplit("/", 1)[-1][:255],
        status="queued", message="در صف پردازش…",
        meta={"invoice_type": payload.invoice_type, "source_link": payload.filelink, "delete_after": True},
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    job_runner.start(job.id)
    return {"job": job_public(job)}


@router.get("/jobs")
def list_jobs(limit: int = Query(default=15, ge=1, le=100), with_text: bool = False,
              user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = (
        db.query(OcrJob).filter(OcrJob.user_id == user.id)
        .order_by(OcrJob.created_at.desc()).limit(limit).all()
    )
    return {"items": [job_public(job, with_text=with_text) for job in rows]}


@router.get("/jobs/{job_id}")
def get_job(job_id: int, with_text: bool = False, user: User = Depends(get_current_user),
            db: Session = Depends(get_db)):
    job = db.get(OcrJob, job_id)
    if not job or job.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "کار پردازش یافت نشد.")
    return {"job": job_public(job, with_text=with_text)}


@router.post("/jobs/{job_id}/retry")
def retry_job(job_id: int, user: User = Depends(require_active_subscription), db: Session = Depends(get_db)):
    job = db.get(OcrJob, job_id)
    if not job or job.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "کار پردازش یافت نشد.")
    if job.status in {"queued", "uploading", "converting", "processing"}:
        raise HTTPException(status.HTTP_409_CONFLICT, "این کار در حال اجرا است.")
    job_runner.retry(job.id)
    db.refresh(job)
    return {"job": job_public(job)}


@router.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    job = db.get(OcrJob, job_id)
    if not job or job.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "کار پردازش یافت نشد.")
    if job.file_token:
        try:
            cloud_ocr.cancel_convert(job.file_token)
        except cloud_ocr.CloudError:
            pass
    job.status = "cancelled"
    job.message = "توسط کاربر لغو شد."
    job.updated_at = utcnow()
    db.add(job)
    db.commit()
    return {"job": job_public(job)}


@router.delete("/jobs/{job_id}")
def delete_job(job_id: int, request: Request, user: User = Depends(get_current_user),
               db: Session = Depends(get_db)):
    job = db.get(OcrJob, job_id)
    if not job or job.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "کار پردازش یافت نشد.")
    if job.file_token:
        try:
            cloud_ocr.delete_file(job.file_token)
        except cloud_ocr.CloudError:
            pass
    if job.file_path:
        Path(job.file_path).unlink(missing_ok=True)
    meta = job.meta or {}
    if meta.get("result_file"):
        Path(meta["result_file"]).unlink(missing_ok=True)
    db.delete(job)
    db.commit()
    audit(db, user, "ocr_delete", "job", job_id, "حذف کار پردازش", request)
    return {"ok": True}


@router.get("/jobs/{job_id}/result")
def download_result(job_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    job = db.get(OcrJob, job_id)
    if not job or job.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "کار پردازش یافت نشد.")
    meta = job.meta or {}
    path = Path(meta.get("result_file", ""))
    if not meta.get("result_file") or not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "فایل خروجی موجود نیست.")
    return FileResponse(path, filename=f"result-{job.id}{path.suffix}")


@router.get("/credit")
def credit(user: User = Depends(get_current_user)):
    try:
        return {"ok": True, **cloud_ocr.check_credit()}
    except cloud_ocr.CloudError as exc:
        return {"ok": False, "message": exc.message, "ocr_credit": None, "audio_credit": None}


@router.post("/jobs/{job_id}/to-invoice", status_code=201)
def job_to_invoice(job_id: int, request: Request, payload: InvoiceIn | None = None,
                   user: User = Depends(require_active_subscription), db: Session = Depends(get_db)):
    """تبدیل خروجی OCR به فاکتور ثبت‌شده (با امکان بازبینی انسانی)."""
    job = db.get(OcrJob, job_id)
    if not job or job.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "کار پردازش یافت نشد.")
    if job.status != "done":
        raise HTTPException(status.HTTP_409_CONFLICT, "پردازش این فایل کامل نشده است.")

    parsed = (job.meta or {}).get("parsed") or {}
    data = payload or InvoiceIn()

    def pick(value, fallback):
        return value if value not in ("", None, 0) else fallback

    invoice = Invoice(
        user_id=user.id,
        number=pick(data.number, parsed.get("number", "")) or f"OCR-{job.id}",
        issue_date=pick(data.issue_date, parsed.get("issue_date", "")) or today_jalali(),
        due_date=pick(data.due_date, parsed.get("due_date", "")),
        invoice_type=pick(data.invoice_type, parsed.get("invoice_type", "printed")),
        direction=data.direction or "purchase",
        seller_name=pick(data.seller_name, parsed.get("seller_name", "")),
        seller_tax_id=pick(data.seller_tax_id, parsed.get("seller_tax_id", "")),
        buyer_name=pick(data.buyer_name, parsed.get("buyer_name", "")),
        buyer_tax_id=pick(data.buyer_tax_id, parsed.get("buyer_tax_id", "")),
        subtotal=pick(data.subtotal, parsed.get("subtotal", 0)),
        discount=pick(data.discount, parsed.get("discount", 0)),
        tax=pick(data.tax, parsed.get("tax", 0)),
        total=pick(data.total, parsed.get("total", 0)),
        paid=pick(data.paid, parsed.get("paid", 0)),
        status=data.status or "review",
        source=job.provider,
        confidence=int(parsed.get("confidence", 0)),
        tags=data.tags,
        notes=data.notes,
        ocr_text=(job.text or "")[:400000],
        raw_json=parsed,
        file_name=job.file_name,
        file_path=job.file_path,
        file_size=Path(job.file_path).stat().st_size if job.file_path and Path(job.file_path).is_file() else 0,
        job_id=job.id,
    )
    if invoice.number:
        dup = db.query(Invoice).filter(
            Invoice.user_id == user.id, Invoice.number == invoice.number,
            Invoice.seller_name == invoice.seller_name,
        ).first()
        if dup:
            invoice.duplicate_of = dup.id
    db.add(invoice)
    db.commit()
    db.refresh(invoice)

    items = data.items or [type("I", (), i)() for i in parsed.get("items", [])]
    for idx, item in enumerate(items, start=1):
        total = getattr(item, "total", 0) or int((getattr(item, "unit_price", 0) or 0) * (getattr(item, "qty", 1) or 1))
        db.add(InvoiceItem(
            invoice_id=invoice.id,
            row_no=getattr(item, "row_no", idx) or idx,
            code=getattr(item, "code", "") or "",
            description=getattr(item, "description", "") or "",
            qty=getattr(item, "qty", 1) or 1,
            unit=getattr(item, "unit", "عدد") or "عدد",
            unit_price=getattr(item, "unit_price", 0) or 0,
            discount=getattr(item, "discount", 0) or 0,
            tax_rate=getattr(item, "tax_rate", 0) or 0,
            total=total,
        ))
    job.invoice_id = invoice.id
    job.updated_at = utcnow()
    db.add(job)
    db.commit()

    consume_quota(db, user, pages=max(job.pages, 1))
    db.refresh(invoice)
    audit(db, user, "invoice_from_ocr", "invoice", invoice.id, f"ثبت از پردازش {job.id}", request)
    return {"invoice": invoice_public(invoice), "duplicate_of": invoice.duplicate_of}


@router.get("/file/{job_id}")
def job_file(job_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    job = db.get(OcrJob, job_id)
    if not job or job.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "فایل یافت نشد.")
    path = Path(job.file_path)
    if not job.file_path or not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "فایل اصلی موجود نیست.")
    return FileResponse(path, filename=job.file_name or path.name)


@router.post("/cleanup")
def cleanup(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """پاک‌سازی فایل‌های موقت کاربر."""
    removed = 0
    directory = settings.storage_uploads / str(user.id)
    if directory.is_dir():
        for file in directory.iterdir():
            if file.is_file():
                file.unlink(missing_ok=True)
                removed += 1
    return {"ok": True, "removed": removed}
