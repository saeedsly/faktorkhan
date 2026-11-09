"""مدیریت فاکتورها: فهرست، جست‌وجو، ثبت، ویرایش، گزارش و خروجی."""
from __future__ import annotations

import io
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import FileResponse
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..deps import audit, get_current_user, require_active_subscription
from ..jalali import today_jalali
from ..models import Invoice, InvoiceItem, OcrJob, User, utcnow
from ..schemas import InvoiceIn
from ..serializers import invoice_public
from ..services import exporter
from ..services.ai_parser import (
    _find_issues as _find_issues_public, extract_items_ai, extract_items_rules, fix_numbers,
)
from ..services.parser import parse_invoice

router = APIRouter(prefix="/api/invoices", tags=["invoices"])

SORTABLE = {
    "created_at": Invoice.created_at,
    "issue_date": Invoice.issue_date,
    "total": Invoice.total,
    "number": Invoice.number,
    "seller_name": Invoice.seller_name,
}


def _apply_items(db: Session, invoice: Invoice, items_in: list) -> None:
    db.query(InvoiceItem).filter(InvoiceItem.invoice_id == invoice.id).delete()
    for idx, item in enumerate(items_in, start=1):
        total = item.total or int((item.unit_price or 0) * (item.qty or 1) - (item.discount or 0))
        db.add(InvoiceItem(
            invoice_id=invoice.id,
            row_no=item.row_no or idx,
            code=item.code or "",
            description=item.description or "",
            qty=item.qty or 1,
            unit=item.unit or "عدد",
            unit_price=item.unit_price or 0,
            discount=item.discount or 0,
            tax_rate=item.tax_rate or 0,
            total=total,
            engine=getattr(item, "engine", "manual") or "manual",
            ai_confidence=int(getattr(item, "ai_confidence", 0) or 0),
            verified=1 if getattr(item, "verified", False) else 0,
            note=(getattr(item, "note", "") or "")[:200],
        ))


def _recalc(invoice: Invoice, db: Session) -> None:
    db.flush()
    rows = db.query(InvoiceItem).filter(InvoiceItem.invoice_id == invoice.id).all()
    if not rows:
        return
    items_sum = sum(int(r.total or 0) for r in rows)
    if not invoice.subtotal:
        invoice.subtotal = items_sum
    computed_total = invoice.subtotal - invoice.discount + invoice.tax
    if not invoice.total and computed_total:
        invoice.total = computed_total


def _query_for(db: Session, user: User):
    query = db.query(Invoice).filter(Invoice.user_id == user.id)
    return query


@router.get("")
def list_invoices(
    q: str = "",
    invoice_status: str = Query(default="", alias="status"),
    invoice_type: str = Query(default="", alias="type"),
    direction: str = "",
    source: str = "",
    date_from: str = "",
    date_to: str = "",
    tag: str = "",
    page: int = 1,
    per_page: int = 20,
    sort: str = "created_at",
    order: str = "desc",
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = _query_for(db, user)
    if q:
        needle = f"%{q.strip()}%"
        query = query.filter(or_(
            Invoice.number.ilike(needle),
            Invoice.seller_name.ilike(needle),
            Invoice.buyer_name.ilike(needle),
            Invoice.tags.ilike(needle),
            Invoice.notes.ilike(needle),
        ))
    if invoice_status:
        query = query.filter(Invoice.status.in_(invoice_status.split(",")))
    if invoice_type:
        query = query.filter(Invoice.invoice_type.in_(invoice_type.split(",")))
    if direction:
        query = query.filter(Invoice.direction == direction)
    if source:
        query = query.filter(Invoice.source == source)
    if tag:
        query = query.filter(Invoice.tags.ilike(f"%{tag}%"))
    if date_from:
        query = query.filter(Invoice.issue_date >= date_from)
    if date_to:
        query = query.filter(Invoice.issue_date <= date_to)

    total = query.count()
    column = SORTABLE.get(sort, Invoice.created_at)
    query = query.order_by(column.desc() if order == "desc" else column.asc())
    per_page = max(1, min(per_page, 200))
    rows = query.offset((max(page, 1) - 1) * per_page).limit(per_page).all()

    agg = db.query(
        func.count(Invoice.id), func.coalesce(func.sum(Invoice.total), 0),
        func.coalesce(func.sum(Invoice.tax), 0),
    ).filter(Invoice.user_id == user.id).first()

    return {
        "items": [invoice_public(inv, with_items=False) for inv in rows],
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": max(1, (total + per_page - 1) // per_page),
        "summary": {"count": int(agg[0] or 0), "sum_total": int(agg[1] or 0), "sum_tax": int(agg[2] or 0)},
    }


@router.get("/stats")
def stats(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    base = _query_for(db, user)
    total = base.count()
    confirmed = base.filter(Invoice.status == "confirmed").count()
    draft = base.filter(Invoice.status == "draft").count()
    review = base.filter(Invoice.status == "review").count()
    archived = base.filter(Invoice.status == "archived").count()
    sums = db.query(
        func.coalesce(func.sum(Invoice.total), 0),
        func.coalesce(func.sum(Invoice.tax), 0),
        func.coalesce(func.sum(Invoice.discount), 0),
    ).filter(Invoice.user_id == user.id).first()

    by_type = {
        row[0]: row[1] for row in
        db.query(Invoice.invoice_type, func.count(Invoice.id)).filter(Invoice.user_id == user.id)
        .group_by(Invoice.invoice_type).all()
    }
    by_source = {
        row[0]: row[1] for row in
        db.query(Invoice.source, func.count(Invoice.id)).filter(Invoice.user_id == user.id)
        .group_by(Invoice.source).all()
    }
    monthly = (
        db.query(Invoice.issue_date, func.sum(Invoice.total), func.count(Invoice.id))
        .filter(Invoice.user_id == user.id)
        .group_by(Invoice.issue_date)
        .order_by(Invoice.issue_date.desc())
        .limit(40)
        .all()
    )
    series = [
        {"date": row[0] or "—", "total": int(row[1] or 0), "count": int(row[2] or 0)}
        for row in reversed(monthly)
    ]
    top_sellers = [
        {"name": row[0] or "نامشخص", "total": int(row[1] or 0), "count": int(row[2] or 0)}
        for row in db.query(Invoice.seller_name, func.sum(Invoice.total), func.count(Invoice.id))
        .filter(Invoice.user_id == user.id, Invoice.seller_name != "")
        .group_by(Invoice.seller_name)
        .order_by(func.sum(Invoice.total).desc())
        .limit(6).all()
    ]
    avg_confidence = db.query(func.avg(Invoice.confidence)).filter(Invoice.user_id == user.id).scalar() or 0

    return {
        "counts": {"total": total, "confirmed": confirmed, "draft": draft, "review": review, "archived": archived},
        "sums": {"total": int(sums[0] or 0), "tax": int(sums[1] or 0), "discount": int(sums[2] or 0)},
        "by_type": by_type,
        "by_source": by_source,
        "series": series,
        "top_sellers": top_sellers,
        "avg_confidence": int(avg_confidence or 0),
    }


@router.get("/export")
def export(
    format: str = "xlsx",
    ids: str = "",
    invoice_status: str = Query(default="", alias="status"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = _query_for(db, user)
    if ids and ids != "all":
        try:
            wanted = [int(x) for x in ids.split(",") if x.strip()]
        except ValueError:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "شناسه‌ها نامعتبر است.")
        query = query.filter(Invoice.id.in_(wanted))
    elif invoice_status:
        query = query.filter(Invoice.status == invoice_status)
    rows = query.order_by(Invoice.created_at.desc()).limit(5000).all()
    today = today_jalali().replace("/", "-")
    if format == "csv":
        return Response(
            exporter.to_csv(rows), media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="invoices-{today}.csv"'},
        )
    if format == "json":
        return Response(
            exporter.to_json(rows), media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="invoices-{today}.json"'},
        )
    data = exporter.to_xlsx(rows)
    return Response(
        data, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="invoices-{today}.xlsx"'},
    )


@router.post("/parse")
def parse_text(payload: dict, user: User = Depends(get_current_user)):
    text = str(payload.get("text", ""))[:200000]
    if len(text.strip()) < 5:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "متنی برای تحلیل ارسال نشده است.")
    return {"parsed": parse_invoice(text, payload.get("invoice_type"))}


# ═══════════════════ فهم خودکار اقلام با هوش مصنوعی ═══════════════════

def _item_payload(items: list[dict], engine: str) -> list[dict]:
    """آماده‌سازی اقلام برای ارسال به رابط کاربری."""
    out = []
    for idx, it in enumerate(items, start=1):
        out.append({
            "row_no": idx,
            "code": str(it.get("code") or ""),
            "description": str(it.get("description") or ""),
            "qty": it.get("qty") or 1,
            "unit": str(it.get("unit") or "عدد"),
            "unit_price": int(it.get("unit_price") or 0),
            "discount": int(it.get("discount") or 0),
            "tax_rate": int(it.get("tax_rate") or 0),
            "total": int(it.get("total") or 0),
            "original_total": int(it.get("original_total") or 0),
            "engine": engine,
            "ai_confidence": int(it.get("ai_confidence") or 0),
            "note": str(it.get("note") or ""),
        })
    return out


def _merge_result(result: dict, raw_text: str, autofix: bool) -> dict:
    """
    خروجی موتور (قاعده‌محور یا هوش مصنوعی) را به یک قرارداد یکسان تبدیل می‌کند،
    در صورت لزوم اعداد را اصلاح می‌کند و هشدارها را می‌سازد.
    """
    items = result.get("items") or []
    totals = result.get("totals") or {}
    engine = result.get("engine") or "rules"
    changes: list[str] = []
    if autofix and items:
        items, totals, changes = fix_numbers(items, totals)
        # توضیح تغییر را روی همان ردیف بگذار، نه با شمارهٔ ترتیبی تغییرات
        for idx, it in enumerate(items, start=1):
            if it.get("original_total"):
                it["note"] = (f"مبلغ کل چاپ‌شده {int(it['original_total']):,} بود؛ "
                              f"بر اساس تعداد × قیمت به {int(it['total']):,} اصلاح شد.")
    issues = result.get("issues") or []
    if changes:
        # بعد از اصلاح، هشدارهای رفع‌شده نباید باقی بمانند
        issues = [i for i in issues if i.get("field") != "total"]
    parsed = parse_invoice(raw_text) if raw_text else {}
    return {
        "items": _item_payload(items, engine.split(":")[0]),
        "totals": totals,
        "issues": issues,
        "autofix": changes,
        "confidence": int(result.get("confidence") or 0),
        "engine": engine,
        "meta": result.get("meta") or {},
        "parsed": parsed,
        "item_count": len(items),
        "items_sum": int(totals.get("items_sum") or sum(int(i.get("total") or 0) for i in items)),
    }


def _apply_to_invoice(db: Session, user: User, invoice_id, merged: dict,
                      engine: str = "ai") -> dict:
    """اقلام فهمیده‌شده را جایگزین اقلام فاکتور موجود می‌کند."""
    try:
        invoice = db.get(Invoice, int(invoice_id))
    except (TypeError, ValueError):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "شناسهٔ فاکتور نامعتبر است.")
    if not invoice or invoice.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "فاکتور پیدا نشد.")

    db.query(InvoiceItem).filter(InvoiceItem.invoice_id == invoice.id).delete()
    for idx, it in enumerate(merged["items"], start=1):
        db.add(InvoiceItem(
            invoice_id=invoice.id, row_no=idx, code=it["code"],
            description=it["description"], qty=it["qty"], unit=it["unit"],
            unit_price=it["unit_price"], discount=it["discount"],
            tax_rate=it["tax_rate"], total=it["total"],
            engine=engine, ai_confidence=int(merged.get("confidence") or 0),
            note=(it.get("note") or "")[:200],
        ))
    totals = merged.get("totals") or {}
    invoice.subtotal = int(totals.get("subtotal") or merged.get("items_sum") or 0)
    invoice.discount = int(totals.get("discount") or 0)
    invoice.tax = int(totals.get("tax") or 0)
    invoice.total = int(totals.get("total") or 0)
    invoice.items_engine = engine
    invoice.items_confidence = int(merged.get("confidence") or 0)
    invoice.items_issues = merged.get("issues") or []
    invoice.items_autofixed = len(merged.get("autofix") or [])
    meta = merged.get("meta") or {}
    if meta.get("seller") and not invoice.seller_name:
        invoice.seller_name = meta["seller"]
    if meta.get("buyer") and not invoice.buyer_name:
        invoice.buyer_name = meta["buyer"]
    if meta.get("number") and not invoice.number:
        invoice.number = meta["number"]
    db.commit()
    db.refresh(invoice)
    audit(db, user, "invoice_ai_fill", "invoice", invoice.id,
          f"پر کردن خودکار {len(merged['items'])} قلم با {engine}", None)
    return {"applied_to": invoice.id, "invoice": invoice_public(invoice)}


@router.post("/understand")
def understand_text(payload: dict, user: User = Depends(get_current_user),
                    db: Session = Depends(get_db)):
    """
    از متن استخراج‌شده، اقلام فاکتور را می‌سازد.
    body: {"text": "...", "invoice_type": "printed", "autofix": true, "apply_to": <id>}
    """
    text = str(payload.get("text", ""))[:200000]
    if len(text.strip()) < 5:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "متنی برای تحلیل ارسال نشده است.")
    invoice_type = payload.get("invoice_type")
    autofix = bool(payload.get("autofix", settings.AI_ITEMS_AUTOFIX))
    result = extract_items_rules(text, invoice_type)
    if not result.get("items"):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "هیچ قلمی در متن پیدا نشد. متن را واضح‌تر بفرستید یا از عکس استفاده کنید.",
        )
    merged = _merge_result(result, text, autofix)
    merged["engine"] = "rules"
    apply_to = payload.get("apply_to")
    if apply_to:
        merged.update(_apply_to_invoice(db, user, apply_to, merged, engine="rules"))
    return merged


@router.post("/understand-image")
def understand_image(payload: dict, user: User = Depends(get_current_user),
                     db: Session = Depends(get_db)):
    """
    تصویر فاکتور را مستقیم به هوش مصنوعی می‌دهد تا خودش اقلام را بفهمد.
    body: {"job_id": 12}  یا  {"path": "..."}  و اختیاری {"apply_to": <invoice_id>}
    اگر کلید تنظیم نشده باشد، خطای روشن برمی‌گرداند (نه ۵۰۰).
    """
    job_id = payload.get("job_id")
    image_path = payload.get("path") or ""
    ocr_text = ""
    if job_id:
        job = db.query(OcrJob).filter(OcrJob.id == int(job_id), OcrJob.user_id == user.id).first()
        if not job:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "کار خوانش پیدا نشد.")
        image_path = image_path or job.file_path
        ocr_text = job.text or ""
    if not image_path:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "مسیر تصویر یا شناسهٔ کار لازم است.")

    key = settings.AI_ITEMS_KEY
    if not (settings.AI_ITEMS_ENABLED and key):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "موتور هوش مصنوعی فعال نیست. کلید آن را در تنظیمات وارد کنید یا از متن استفاده کنید.",
        )

    result = extract_items_ai(
        image_path, api_key=key, model=settings.AI_ITEMS_MODEL,
        timeout=settings.AI_ITEMS_TIMEOUT,
    )
    if not result.get("ok"):
        # اگر هوش مصنوعی نشد، از متن ابری استفاده کن — کاربر دست‌خالی نمی‌ماند
        if ocr_text.strip():
            fallback = extract_items_rules(ocr_text)
            if fallback.get("items"):
                merged = _merge_result(fallback, ocr_text, settings.AI_ITEMS_AUTOFIX)
                merged["fallback"] = result.get("message") or "هوش مصنوعی پاسخ نداد."
                merged["engine"] = "rules"
                return merged
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            result.get("message") or "فهم اقلام از تصویر ناموفق بود.")

    merged = _merge_result(result, ocr_text, settings.AI_ITEMS_AUTOFIX)
    merged["engine"] = settings.AI_ITEMS_MODEL

    apply_to = payload.get("apply_to")
    if apply_to:
        merged.update(_apply_to_invoice(db, user, apply_to, merged, engine="ai"))
    return merged


@router.post("/fix-numbers")
def fix_numbers_endpoint(payload: dict, user: User = Depends(get_current_user)):
    """
    اعداد یک فاکتور را بازبینی و اصلاح می‌کند.
    body: {"items": [...], "totals": {...}, "apply_to": <id>}
    """
    items = payload.get("items") or []
    if not isinstance(items, list) or not items:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "فهرست اقلام خالی است.")
    norm_items = []
    for raw in items[:500]:
        if not isinstance(raw, dict):
            continue
        norm_items.append({
            "code": str(raw.get("code") or ""),
            "description": str(raw.get("description") or ""),
            "qty": raw.get("qty") or 1,
            "unit": str(raw.get("unit") or "عدد"),
            "unit_price": int(raw.get("unit_price") or 0),
            "discount": int(raw.get("discount") or 0),
            "tax_rate": int(raw.get("tax_rate") or 0),
            "total": int(raw.get("total") or 0),
        })
    totals_in = payload.get("totals") or {}
    totals = {
        "subtotal": int(totals_in.get("subtotal") or 0),
        "discount": int(totals_in.get("discount") or 0),
        "tax": int(totals_in.get("tax") or 0),
        "total": int(totals_in.get("total") or 0),
        "items_sum": sum(int(i["total"]) for i in norm_items),
    }
    fixed, out_totals, changes = fix_numbers(norm_items, totals)
    issues = _find_issues_public(fixed, out_totals)

    apply_to = payload.get("apply_to")
    if apply_to:
        invoice = db.get(Invoice, int(apply_to))
        if not invoice or invoice.user_id != user.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "فاکتور پیدا نشد.")
        for row, it in zip(invoice.items, fixed):
            row.total = int(it["total"])
            row.qty = it["qty"]
        invoice.subtotal = out_totals["subtotal"]
        invoice.total = out_totals["total"]
        invoice.items_issues = issues
        invoice.items_autofixed = len(changes)
        db.commit()

    return {
        "items": _item_payload(fixed, "rules"),
        "totals": out_totals,
        "changes": changes,
        "issues": issues,
        "confidence": 100 if not issues else max(0, 100 - 8 * len(issues)),
    }


@router.post("", status_code=201)
def create_invoice(payload: InvoiceIn, request: Request,
                   user: User = Depends(require_active_subscription), db: Session = Depends(get_db)):
    invoice = Invoice(
        user_id=user.id,
        number=payload.number.strip(),
        issue_date=payload.issue_date or today_jalali(),
        due_date=payload.due_date,
        invoice_type=payload.invoice_type,
        direction=payload.direction,
        seller_name=payload.seller_name.strip(),
        seller_tax_id=payload.seller_tax_id.strip(),
        buyer_name=payload.buyer_name.strip(),
        buyer_tax_id=payload.buyer_tax_id.strip(),
        subtotal=payload.subtotal,
        discount=payload.discount,
        tax=payload.tax,
        total=payload.total,
        paid=payload.paid,
        status=payload.status,
        source=payload.source,
        job_id=payload.job_id,
        tags=payload.tags,
        notes=payload.notes,
        ocr_text=payload.ocr_text[:400000],
    )
    # جلوگیری از ثبت تکراری
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
    _apply_items(db, invoice, payload.items)
    if payload.items_engine:
        invoice.items_engine = payload.items_engine
        invoice.items_confidence = int(payload.items_confidence or 0)
        invoice.items_autofixed = int(payload.items_autofixed or 0)
    _recalc(invoice, db)
    db.commit()
    db.refresh(invoice)
    audit(db, user, "invoice_create", "invoice", invoice.id, f"ثبت فاکتور {invoice.number}", request)
    return {"invoice": invoice_public(invoice), "duplicate_of": invoice.duplicate_of}


@router.get("/{invoice_id}")
def get_invoice(invoice_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    invoice = db.get(Invoice, invoice_id)
    if not invoice or invoice.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "فاکتور یافت نشد.")
    return {"invoice": invoice_public(invoice, with_text=True)}


@router.put("/{invoice_id}")
def update_invoice(invoice_id: int, payload: InvoiceIn, request: Request,
                   user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    invoice = db.get(Invoice, invoice_id)
    if not invoice or invoice.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "فاکتور یافت نشد.")
    for field in (
        "number", "issue_date", "due_date", "invoice_type", "direction", "seller_name",
        "seller_tax_id", "buyer_name", "buyer_tax_id", "subtotal", "discount", "tax",
        "total", "paid", "status", "tags", "notes",
    ):
        setattr(invoice, field, getattr(payload, field))
    if payload.ocr_text:
        invoice.ocr_text = payload.ocr_text[:400000]
    if payload.items_engine:
        invoice.items_engine = payload.items_engine
        invoice.items_confidence = int(payload.items_confidence or 0)
        invoice.items_autofixed = int(payload.items_autofixed or 0)
    invoice.updated_at = utcnow()
    _apply_items(db, invoice, payload.items)
    _recalc(invoice, db)
    db.add(invoice)
    db.commit()
    db.refresh(invoice)
    audit(db, user, "invoice_update", "invoice", invoice.id, f"ویرایش فاکتور {invoice.number}", request)
    return {"invoice": invoice_public(invoice)}


@router.delete("/{invoice_id}")
def delete_invoice(invoice_id: int, request: Request, user: User = Depends(get_current_user),
                   db: Session = Depends(get_db)):
    invoice = db.get(Invoice, invoice_id)
    if not invoice or invoice.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "فاکتور یافت نشد.")
    if invoice.file_path:
        Path(invoice.file_path).unlink(missing_ok=True)
    db.delete(invoice)
    db.commit()
    audit(db, user, "invoice_delete", "invoice", invoice_id, "حذف فاکتور", request)
    return {"ok": True}


@router.post("/bulk")
def bulk_action(payload: dict, request: Request, user: User = Depends(get_current_user),
                db: Session = Depends(get_db)):
    ids = payload.get("ids") or []
    action = str(payload.get("action", ""))
    if not ids or not isinstance(ids, list):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "فاکتوری انتخاب نشده است.")
    rows = db.query(Invoice).filter(Invoice.user_id == user.id, Invoice.id.in_(ids)).all()
    if action == "delete":
        for row in rows:
            if row.file_path:
                Path(row.file_path).unlink(missing_ok=True)
            db.delete(row)
    elif action in {"draft", "review", "confirmed", "archived"}:
        for row in rows:
            row.status = action
            row.updated_at = utcnow()
            db.add(row)
    elif action == "tag" and payload.get("tag"):
        tag = str(payload["tag"])[:60]
        for row in rows:
            tags = [t for t in (row.tags or "").split(",") if t]
            if tag not in tags:
                tags.append(tag)
            row.tags = ",".join(tags[:8])
            db.add(row)
    else:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "عملیات درخواستی معتبر نیست.")
    db.commit()
    audit(db, user, "invoice_bulk", "invoice", f"{len(rows)}", f"{action} روی {len(rows)} فاکتور", request)
    return {"ok": True, "affected": len(rows)}


@router.get("/{invoice_id}/file")
def invoice_file(invoice_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    invoice = db.get(Invoice, invoice_id)
    if not invoice or invoice.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "فاکتور یافت نشد.")
    path = Path(invoice.file_path)
    if not invoice.file_path or not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "فایل اصلی موجود نیست.")
    return FileResponse(path, filename=invoice.file_name or path.name)


@router.get("/{invoice_id}/print")
def print_payload(invoice_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    invoice = db.get(Invoice, invoice_id)
    if not invoice or invoice.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "فاکتور یافت نشد.")
    return {
        "invoice": invoice_public(invoice),
        "company": {"name": user.company or user.full_name, "phone": user.phone, "email": user.email},
        "issued_by": user.full_name,
    }
