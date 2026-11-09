"""تبدیل مدل‌ها به ساختارهای امن برای ارسال به رابط کاربری."""
from __future__ import annotations

from datetime import datetime

from .jalali import gregorian_from_dt
from .models import (
    Invoice, LicenseKey, OcrJob, Plan, Subscription, SupportMessage, User, utcnow,
)


def fa_date(value: datetime | None) -> str:
    return gregorian_from_dt(value) if value else ""


def user_public(user: User) -> dict:
    return {
        "id": user.id,
        "full_name": user.full_name,
        "email": user.email,
        "phone": user.phone,
        "company": user.company,
        "role": user.role,
        "is_active": user.is_active,
        "is_admin": user.is_admin,
        "initials": user.initials,
        "avatar_color": user.avatar_color,
        "theme": user.theme,
        "created_at": fa_date(user.created_at),
        "last_login_at": fa_date(user.last_login_at),
        "device_count": len([d for d in (user.subscription.devices if user.subscription else "").split(",") if d]),
    }


def plan_public(plan: Plan) -> dict:
    return {
        "id": plan.id,
        "code": plan.code,
        "name": plan.name,
        "tagline": plan.tagline,
        "price": plan.price,
        "duration_days": plan.duration_days,
        "support_days": plan.support_days,
        "page_quota": plan.page_quota,
        "max_devices": plan.max_devices,
        "features": plan.features or [],
        "is_active": plan.is_active,
        "is_featured": plan.is_featured,
        "sort_order": plan.sort_order,
    }


def subscription_public(sub: Subscription | None) -> dict | None:
    if not sub:
        return None
    plan = sub.plan
    return {
        "id": sub.id,
        "status": sub.status,
        "valid": sub.is_valid,
        "plan_name": plan.name if plan else ("دوره آزمایشی" if sub.status == "trialing" else "بدون طرح"),
        "plan_id": sub.plan_id,
        "starts_at": fa_date(sub.starts_at),
        "ends_at": fa_date(sub.ends_at),
        "support_until": fa_date(sub.support_until),
        "days_left": sub.days_left,
        "pages_used": sub.pages_used,
        "pages_quota": sub.pages_quota,
        "pages_left": sub.pages_left,
        "usage_percent": int(min(100, (sub.pages_used / sub.pages_quota * 100) if sub.pages_quota else 0)),
        "max_devices": plan.max_devices if plan else 1,
        "device_count": len([d for d in (sub.devices or "").split(",") if d]),
        "notes": sub.notes,
        "support_active": bool(sub.support_until and sub.support_until >= utcnow()),
    }


def invoice_public(inv: Invoice, with_items: bool = True, with_text: bool = False) -> dict:
    data = {
        "id": inv.id,
        "number": inv.number,
        "issue_date": inv.issue_date,
        "due_date": inv.due_date,
        "invoice_type": inv.invoice_type,
        "direction": inv.direction,
        "seller_name": inv.seller_name,
        "seller_tax_id": inv.seller_tax_id,
        "buyer_name": inv.buyer_name,
        "buyer_tax_id": inv.buyer_tax_id,
        "subtotal": inv.subtotal,
        "discount": inv.discount,
        "tax": inv.tax,
        "total": inv.total,
        "paid": inv.paid,
        "currency": inv.currency,
        "status": inv.status,
        "source": inv.source,
        "confidence": inv.confidence,
        "tags": [t for t in (inv.tags or "").split(",") if t],
        "notes": inv.notes,
        "file_name": inv.file_name,
        "has_file": bool(inv.file_path),
        "thumb_color": inv.thumb_color,
        "created_at": fa_date(inv.created_at),
        "updated_at": fa_date(inv.updated_at),
        "duplicate_of": inv.duplicate_of,
        "job_id": inv.job_id,
        "items_count": len(inv.items or []),
        "items_engine": inv.items_engine or "",
        "items_confidence": inv.items_confidence or 0,
        "items_autofixed": inv.items_autofixed or 0,
        "items_issues": inv.items_issues or [],
    }
    if with_items:
        data["items"] = [
            {
                "id": i.id,
                "row_no": i.row_no,
                "code": i.code,
                "description": i.description,
                "qty": i.qty,
                "unit": i.unit,
                "unit_price": i.unit_price,
                "discount": i.discount,
                "tax_rate": i.tax_rate,
                "total": i.total,
                "engine": i.engine or "manual",
                "ai_confidence": i.ai_confidence or 0,
                "verified": i.verified or 0,
                "note": i.note or "",
            }
            for i in (inv.items or [])
        ]
    if with_text:
        data["ocr_text"] = inv.ocr_text or ""
        data["raw_json"] = inv.raw_json or {}
    return data


def job_public(job: OcrJob, with_text: bool = False, with_parsed: bool = True) -> dict:
    meta = job.meta or {}
    parsed = meta.get("parsed") if with_parsed else None
    data = {
        "id": job.id,
        "provider": job.provider,
        "method": job.method,
        "output": job.output,
        "file_name": job.file_name,
        "pages": job.pages,
        "status": job.status,
        "progress": job.progress,
        "message": job.message,
        "language": job.language,
        "invoice_id": job.invoice_id,
        "created_at": fa_date(job.created_at),
        "updated_at": fa_date(job.updated_at),
        "engine": meta.get("engine", ""),
        "has_result_file": bool(meta.get("result_file")),
        "remote_active": bool(job.file_token),
    }
    if parsed:
        data["parsed"] = {
            k: parsed.get(k)
            for k in (
                "number", "issue_date", "due_date", "invoice_type", "seller_name", "seller_tax_id",
                "buyer_name", "buyer_tax_id", "subtotal", "discount", "tax", "total", "paid",
                "items", "confidence", "fields_found", "warnings",
            )
        }
    if with_text:
        data["text"] = job.text or ""
    return data


def key_public(key: LicenseKey) -> dict:
    return {
        "id": key.id,
        "key": key.key,
        "plan_id": key.plan_id,
        "plan_name": key.plan.name if key.plan else "",
        "status": key.status,
        "note": key.note,
        "created_at": fa_date(key.created_at),
        "redeemed_at": fa_date(key.redeemed_at),
        "redeemed_by": key.redeemed_by,
        "expires_at": fa_date(key.expires_at),
    }


def ticket_public(ticket: SupportMessage) -> dict:
    return {
        "id": ticket.id,
        "user_id": ticket.user_id,
        "name": ticket.name,
        "contact": ticket.contact,
        "subject": ticket.subject,
        "message": ticket.message,
        "status": ticket.status,
        "answer": ticket.answer,
        "created_at": fa_date(ticket.created_at),
        "answered_at": fa_date(ticket.answered_at),
    }
