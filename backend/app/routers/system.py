"""اطلاعات عمومی سامانه، قابلیت‌ها، معرفی پدیدآورنده و پشتیبانی."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from .. import branding
from ..config import app_meta, settings
from ..database import db_health, get_db
from ..deps import audit, get_optional_user, rate_limit
from ..features import FEATURE_GROUPS, TOTAL
from ..models import SupportMessage
from ..schemas import SupportTicketIn
from ..services import cloud_ocr
from ..services.config_store import cfg_bool, get_cfg

router = APIRouter(prefix="/api/system", tags=["system"])


@router.get("/meta")
def meta():
    contact = dict(branding.OWNER["contact"])
    for key in ("phone", "email", "telegram"):
        value = get_cfg(f"support_{key}")
        if value:
            contact[key] = value
    return {
        "app": {
            **app_meta(),
            "subtitle": branding.APP_SUBTITLE,
        },
        "owner": {
            "name": branding.OWNER["name"],
            "title_parts": branding.OWNER["title_parts"],
            "tagline": branding.OWNER["tagline"],
            "bio": branding.OWNER["bio"],
            "philosophy": branding.OWNER["philosophy"],
            "skills": branding.OWNER["skills"],
            "support_note": branding.OWNER["support_note"],
            "response_time": branding.OWNER["response_time"],
            "contact": contact,
        },
        "copyright": branding.COPYRIGHT_TEXT,
        "support_intro": branding.SUPPORT_INTRO,
        "faq": branding.FAQ,
        "announcement": get_cfg("announcement"),
        "settings": {
            "registration_open": cfg_bool("registration_open", settings.ALLOW_REGISTRATION),
            "license_required": cfg_bool("license_required", settings.REQUIRE_LICENSE),
            "trial_days": get_cfg("trial_days"),
            "trial_pages": get_cfg("trial_pages"),
            "max_upload_mb": settings.MAX_UPLOAD_MB,
        },
        "features_total": TOTAL,
    }


@router.get("/features")
def features():
    return {"total": TOTAL, "groups": FEATURE_GROUPS}


@router.get("/health")
def health():
    db = db_health()
    cloud = cloud_ocr.token_state()
    return {
        "ok": bool(db.get("ok")),
        "database": {"ok": bool(db.get("ok")), "engine": db.get("engine", "")},
        "cloud": {"gateway_ready": cloud["gateway_ready"], "token_set": cloud["configured"]},
        "version": settings.APP_VERSION,
        "features": TOTAL,
    }


@router.get("/announcement")
def announcement():
    return {"text": get_cfg("announcement")}


@router.post("/support", status_code=201)
def create_ticket(payload: SupportTicketIn, request: Request,
                  user=Depends(get_optional_user), db: Session = Depends(get_db)):
    rate_limit(request, "support", limit=6, window=600)
    ticket = SupportMessage(
        user_id=user.id if user else None,
        name=(user.full_name if user else payload.contact or "مهمان")[:120],
        contact=(payload.contact or (user.email if user else ""))[:120],
        subject=payload.subject[:160],
        message=payload.message[:4000],
    )
    db.add(ticket)
    db.commit()
    db.refresh(ticket)
    audit(db, user, "support_ticket", "ticket", ticket.id, ticket.subject, request)
    return {"ok": True, "id": ticket.id,
            "message": "پیام شما ثبت شد. پاسخ از طریق همین بخش و در پنل پشتیبانی پیگیری می‌شود."}
