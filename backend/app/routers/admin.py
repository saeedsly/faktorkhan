"""پنل مدیریت: کاربران، طرح‌ها، کدهای اشتراک، تنظیمات، پشتیبانی، پشتیبان‌گیری."""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import Response
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ..config import settings
from ..database import db_health, get_db
from ..deps import audit, get_current_user, require_admin, require_owner, subscription_of
from ..features import TOTAL as FEATURE_TOTAL
from ..jalali import today_jalali
from ..models import (
    AppSetting, AuditLog, Invoice, LicenseKey, OcrJob, Plan, Subscription,
    SupportMessage, User, utcnow,
)
from ..schemas import AdminUserIn, KeyBatchIn, PlanIn, SettingsIn
from ..security import generate_license_key, hash_password, mask_secret
from ..serializers import key_public, plan_public, subscription_public, ticket_public, user_public
from ..services import cloud_ocr
from ..services.config_store import DEFAULTS, all_cfg, set_cfg

router = APIRouter(prefix="/api/admin", tags=["admin"])


# ------------------------------------------------------------ نمای کلی
@router.get("/overview")
def overview(admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    users = db.query(User).count()
    active_subs = db.query(Subscription).filter(
        Subscription.status == "active", Subscription.ends_at > utcnow()
    ).count()
    trialing = db.query(Subscription).filter(Subscription.status == "trialing").count()
    invoices = db.query(Invoice).count()
    jobs = db.query(OcrJob).count()
    keys_unused = db.query(LicenseKey).filter(LicenseKey.status == "unused").count()
    keys_used = db.query(LicenseKey).filter(LicenseKey.status == "used").count()
    revenue = (
        db.query(func.coalesce(func.sum(Plan.price), 0))
        .join(LicenseKey, LicenseKey.plan_id == Plan.id)
        .filter(LicenseKey.status == "used")
        .scalar()
    )
    open_tickets = db.query(SupportMessage).filter(SupportMessage.status == "new").count()
    recent = (
        db.query(AuditLog).order_by(AuditLog.created_at.desc()).limit(12).all()
    )
    return {
        "counts": {
            "users": users, "active_subscriptions": active_subs, "trialing": trialing,
            "invoices": invoices, "jobs": jobs, "keys_unused": keys_unused,
            "keys_used": keys_used, "open_tickets": open_tickets,
        },
        "revenue": int(revenue or 0),
        "features": FEATURE_TOTAL,
        "cloud": cloud_ocr.token_state(),
        "recent": [
            {
                "id": row.id, "actor": row.actor, "action": row.action, "detail": row.detail,
                "ip": row.ip,
                "at": row.created_at.strftime("%Y-%m-%d %H:%M") if row.created_at else "",
            }
            for row in recent
        ],
    }


# ------------------------------------------------------------ کاربران
@router.get("/users")
def list_users(
    q: str = "", user_status: str = Query(default="", alias="status"),
    page: int = 1, per_page: int = 20,
    admin: User = Depends(require_admin), db: Session = Depends(get_db),
):
    query = db.query(User)
    if q:
        needle = f"%{q.strip()}%"
        query = query.filter(or_(User.email.ilike(needle), User.full_name.ilike(needle),
                                 User.phone.ilike(needle), User.company.ilike(needle)))
    if user_status == "active":
        query = query.filter(User.is_active.is_(True))
    elif user_status == "inactive":
        query = query.filter(User.is_active.is_(False))
    total = query.count()
    per_page = max(1, min(per_page, 100))
    rows = query.order_by(User.created_at.desc()).offset((max(page, 1) - 1) * per_page).limit(per_page).all()
    items = []
    for row in rows:
        data = user_public(row)
        data["subscription"] = subscription_public(subscription_of(db, row))
        data["invoice_count"] = db.query(Invoice).filter(Invoice.user_id == row.id).count()
        data["last_ip"] = row.last_ip
        items.append(data)
    return {"items": items, "total": total, "page": page, "per_page": per_page,
            "pages": max(1, (total + per_page - 1) // per_page)}


@router.patch("/users/{user_id}")
def update_user(user_id: int, payload: AdminUserIn, request: Request,
                admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "کاربر یافت نشد.")
    if target.role == "owner" and admin.role != "owner":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "تغییر حساب مالک فقط توسط مالک مجاز است.")
    if payload.role and payload.role == "owner" and admin.role != "owner":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "تعیین نقش مالک مجاز نیست.")

    if payload.is_active is not None:
        target.is_active = payload.is_active
    if payload.role:
        target.role = payload.role

    sub = subscription_of(db, target)
    if payload.plan_id:
        plan = db.get(Plan, payload.plan_id)
        if not plan:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "طرح یافت نشد.")
        sub = sub or Subscription(user_id=target.id)
        sub.plan_id = plan.id
        sub.status = "active"
        sub.starts_at = utcnow()
        sub.ends_at = utcnow() + timedelta(days=plan.duration_days)
        sub.support_until = utcnow() + timedelta(days=plan.support_days or plan.duration_days)
        sub.pages_quota = plan.page_quota
        sub.notes = f"تخصیص دستی {plan.name}"
        db.add(sub)
    if sub:
        if payload.extend_days:
            base = sub.ends_at if (sub.ends_at and sub.ends_at > utcnow()) else utcnow()
            sub.ends_at = base + timedelta(days=payload.extend_days)
            sub.support_until = (sub.support_until or base) + timedelta(days=payload.extend_days)
            if sub.status in {"expired", "trialing"}:
                sub.status = "active"
        if payload.pages_delta:
            sub.pages_quota = max(0, sub.pages_quota + payload.pages_delta)
        if payload.notes is not None:
            sub.notes = payload.notes[:255]
        sub.updated_at = utcnow()
        db.add(sub)
    target.updated_at = utcnow()
    db.add(target)
    db.commit()
    db.refresh(target)
    audit(db, admin, "admin_user_update", "user", target.id, "ویرایش کاربر", request)
    data = user_public(target)
    data["subscription"] = subscription_public(subscription_of(db, target))
    return {"user": data}


@router.post("/users/{user_id}/reset-password")
def reset_password(user_id: int, request: Request, admin: User = Depends(require_admin),
                   db: Session = Depends(get_db)):
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "کاربر یافت نشد.")
    temp = "Fk" + secrets.token_urlsafe(7).replace("-", "a").replace("_", "b") + "1"
    target.password_hash = hash_password(temp)
    target.must_change_password = True
    target.failed_attempts = 0
    target.locked_until = None
    db.add(target)
    db.commit()
    audit(db, admin, "admin_password_reset", "user", target.id, "بازنشانی رمز عبور", request)
    return {"ok": True, "temporary_password": temp,
            "message": "رمز موقت ساخته شد؛ آن را به کاربر اعلام کنید."}


@router.delete("/users/{user_id}")
def delete_user(user_id: int, request: Request, owner: User = Depends(require_owner),
                db: Session = Depends(get_db)):
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "کاربر یافت نشد.")
    if target.id == owner.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "حساب خودتان را نمی‌توانید حذف کنید.")
    if target.role == "owner":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "حذف حساب مالک مجاز نیست.")
    db.delete(target)
    db.commit()
    audit(db, owner, "admin_user_delete", "user", user_id, "حذف کاربر", request)
    return {"ok": True}


# ------------------------------------------------------------ طرح‌ها
@router.get("/plans")
def list_plans(admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    rows = db.query(Plan).order_by(Plan.sort_order, Plan.price).all()
    result = []
    for plan in rows:
        data = plan_public(plan)
        data["keys_unused"] = db.query(LicenseKey).filter(
            LicenseKey.plan_id == plan.id, LicenseKey.status == "unused").count()
        result.append(data)
    return {"items": result}


@router.post("/plans", status_code=201)
def create_plan(payload: PlanIn, request: Request, admin: User = Depends(require_admin),
                db: Session = Depends(get_db)):
    if db.query(Plan).filter(Plan.code == payload.code).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "این کد طرح قبلاً ثبت شده است.")
    plan = Plan(**payload.model_dump())
    db.add(plan)
    db.commit()
    db.refresh(plan)
    audit(db, admin, "plan_create", "plan", plan.id, plan.name, request)
    return {"plan": plan_public(plan)}


@router.put("/plans/{plan_id}")
def update_plan(plan_id: int, payload: PlanIn, request: Request,
                admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    plan = db.get(Plan, plan_id)
    if not plan:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "طرح یافت نشد.")
    for key, value in payload.model_dump().items():
        setattr(plan, key, value)
    db.add(plan)
    db.commit()
    db.refresh(plan)
    audit(db, admin, "plan_update", "plan", plan.id, plan.name, request)
    return {"plan": plan_public(plan)}


@router.delete("/plans/{plan_id}")
def delete_plan(plan_id: int, request: Request, admin: User = Depends(require_admin),
                db: Session = Depends(get_db)):
    plan = db.get(Plan, plan_id)
    if not plan:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "طرح یافت نشد.")
    in_use = db.query(LicenseKey).filter(LicenseKey.plan_id == plan.id,
                                        LicenseKey.status == "unused").count()
    if in_use:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            f"این طرح {in_use} کد فعال‌نشده دارد؛ ابتدا کدها را حذف یا ابطال کنید.")
    db.delete(plan)
    db.commit()
    audit(db, admin, "plan_delete", "plan", plan_id, "حذف طرح", request)
    return {"ok": True}


# ------------------------------------------------------------ کدهای اشتراک
@router.get("/keys")
def list_keys(
    plan_id: int | None = None, key_status: str = Query(default="", alias="status"),
    page: int = 1, per_page: int = 25,
    admin: User = Depends(require_admin), db: Session = Depends(get_db),
):
    query = db.query(LicenseKey)
    if plan_id:
        query = query.filter(LicenseKey.plan_id == plan_id)
    if key_status:
        query = query.filter(LicenseKey.status == key_status)
    total = query.count()
    per_page = max(1, min(per_page, 200))
    rows = query.order_by(LicenseKey.created_at.desc()).offset((max(page, 1) - 1) * per_page).limit(per_page).all()
    return {"items": [key_public(row) for row in rows], "total": total, "page": page,
            "per_page": per_page, "pages": max(1, (total + per_page - 1) // per_page)}


@router.post("/keys/batch", status_code=201)
def create_keys(payload: KeyBatchIn, request: Request, admin: User = Depends(require_admin),
                db: Session = Depends(get_db)):
    plan = db.get(Plan, payload.plan_id)
    if not plan:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "طرح یافت نشد.")
    created: list[str] = []
    attempts = 0
    while len(created) < payload.count and attempts < payload.count * 10:
        attempts += 1
        value = generate_license_key(payload.prefix or "FK")
        if db.query(LicenseKey).filter(LicenseKey.key == value).first():
            continue
        db.add(LicenseKey(key=value, plan_id=plan.id, note=payload.note[:220], created_by=admin.id))
        created.append(value)
    db.commit()
    audit(db, admin, "keys_generate", "license", str(len(created)),
          f"{len(created)} کد برای {plan.name}", request)
    return {
        "created": len(created),
        "plan": plan.name,
        "keys": created,
        "file_hint": "این کدها فقط یک‌بار نمایش داده می‌شوند؛ همین حالا ذخیره یا کپی کنید.",
    }


@router.post("/keys/{key_id}/revoke")
def revoke_key(key_id: int, request: Request, admin: User = Depends(require_admin),
               db: Session = Depends(get_db)):
    key = db.get(LicenseKey, key_id)
    if not key:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "کد یافت نشد.")
    if key.status == "used":
        raise HTTPException(status.HTTP_409_CONFLICT, "این کد استفاده شده است؛ برای قطع دسترسی، اشتراک کاربر را تعلیق کنید.")
    key.status = "revoked"
    db.add(key)
    db.commit()
    audit(db, admin, "key_revoke", "license", key.id, key.key, request)
    return {"ok": True}


@router.delete("/keys/{key_id}")
def delete_key(key_id: int, request: Request, admin: User = Depends(require_admin),
               db: Session = Depends(get_db)):
    key = db.get(LicenseKey, key_id)
    if not key:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "کد یافت نشد.")
    db.delete(key)
    db.commit()
    audit(db, admin, "key_delete", "license", key_id, "حذف کد", request)
    return {"ok": True}


# ------------------------------------------------------------ سرویس ابری (توکن مخفی)
@router.get("/cloud")
def cloud_state(admin: User = Depends(require_admin)):
    state = cloud_ocr.token_state()
    token = cloud_ocr.cloud_token()
    return {
        "gateway_ready": state["gateway_ready"],
        "token_set": state["configured"],
        "token_length": state["length"],
        "token_hint": mask_secret(token) if token else "",
        "visible": False,
        "note": "توکن فقط رمزنگاری‌شده روی سرور نگهداری می‌شود و در هیچ خروجی نمایش داده نمی‌شود.",
    }


@router.post("/cloud/token")
def set_cloud_token(payload: dict, request: Request, admin: User = Depends(require_admin),
                    db: Session = Depends(get_db)):
    token = str(payload.get("token", "")).strip()
    if len(token) < 8:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "توکن معتبر نیست.")
    cloud_ocr.save_cloud_token(token, admin.id)
    audit(db, admin, "cloud_token_set", "settings", "", "به‌روزرسانی توکن ابری", request)
    return {"ok": True, "message": "توکن ذخیره شد. مقدار آن دیگر قابل مشاهده نیست."}


@router.post("/cloud/test")
def test_cloud(admin: User = Depends(require_admin)):
    try:
        credit = cloud_ocr.check_credit()
        return {"ok": True, "credit": credit, "message": "ارتباط با سرویس ابری برقرار است."}
    except cloud_ocr.CloudError as exc:
        return {"ok": False, "message": exc.message}


@router.delete("/cloud/token")
def clear_cloud_token(request: Request, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    row = db.query(AppSetting).filter(AppSetting.key == "cloud_token").first()
    if row:
        db.delete(row)
        db.commit()
    audit(db, admin, "cloud_token_clear", "settings", "", "حذف توکن ابری", request)
    return {"ok": True, "message": "توکن حذف شد."}


# ------------------------------------------------------------ تنظیمات
@router.get("/settings")
def get_settings(admin: User = Depends(require_admin)):
    return {"settings": all_cfg()}


@router.put("/settings")
def update_settings(payload: SettingsIn, request: Request, admin: User = Depends(require_admin),
                    db: Session = Depends(get_db)):
    changed = []
    for field, value in payload.model_dump(exclude_none=True).items():
        if field not in DEFAULTS:
            continue
        if isinstance(value, bool):
            value = "1" if value else "0"
        set_cfg(field, str(value))
        changed.append(field)
    audit(db, admin, "settings_update", "settings", "", ", ".join(changed), request)
    return {"ok": True, "settings": all_cfg(), "changed": changed}


# ------------------------------------------------------------ گزارش رویدادها
@router.get("/audit")
def audit_logs(q: str = "", page: int = 1, per_page: int = 30,
               admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    query = db.query(AuditLog)
    if q:
        needle = f"%{q}%"
        query = query.filter(or_(AuditLog.actor.ilike(needle), AuditLog.action.ilike(needle),
                                 AuditLog.detail.ilike(needle)))
    total = query.count()
    per_page = max(1, min(per_page, 100))
    rows = query.order_by(AuditLog.created_at.desc()).offset((max(page, 1) - 1) * per_page).limit(per_page).all()
    return {
        "items": [
            {"id": r.id, "actor": r.actor, "action": r.action, "entity": r.entity,
             "entity_id": r.entity_id, "detail": r.detail, "ip": r.ip,
             "at": r.created_at.strftime("%Y-%m-%d %H:%M:%S") if r.created_at else ""}
            for r in rows
        ],
        "total": total, "page": page, "per_page": per_page,
        "pages": max(1, (total + per_page - 1) // per_page),
    }


# ------------------------------------------------------------ پشتیبانی
@router.get("/support")
def support_messages(ticket_status: str = Query(default="", alias="status"),
                     admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    query = db.query(SupportMessage)
    if ticket_status:
        query = query.filter(SupportMessage.status == ticket_status)
    rows = query.order_by(SupportMessage.created_at.desc()).limit(100).all()
    return {"items": [ticket_public(row) for row in rows]}


@router.post("/support/{ticket_id}/answer")
def answer_ticket(ticket_id: int, payload: dict, request: Request,
                  admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    ticket = db.get(SupportMessage, ticket_id)
    if not ticket:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "پیام یافت نشد.")
    ticket.answer = str(payload.get("answer", ""))[:4000]
    ticket.status = "answered"
    ticket.answered_at = utcnow()
    db.add(ticket)
    db.commit()
    audit(db, admin, "support_answer", "ticket", ticket.id, ticket.subject, request)
    return {"ok": True, "ticket": ticket_public(ticket)}


# ------------------------------------------------------------ پشتیبان‌گیری و سلامت
@router.get("/backup")
def backup(request: Request, owner: User = Depends(require_owner), db: Session = Depends(get_db)):
    import json

    def rows(model, fields):
        return [{f: (str(getattr(r, f)) if isinstance(getattr(r, f), datetime) else getattr(r, f))
                 for f in fields} for r in db.query(model).all()]

    payload = {
        "meta": {"app": settings.APP_NAME, "version": settings.APP_VERSION,
                 "generated_at": datetime.utcnow().isoformat(), "date": today_jalali()},
        "users": rows(User, ["id", "full_name", "email", "phone", "company", "role", "is_active", "created_at"]),
        "plans": rows(Plan, ["id", "code", "name", "price", "duration_days", "page_quota"]),
        "license_keys": rows(LicenseKey, ["id", "key", "plan_id", "status", "redeemed_by", "created_at"]),
        "subscriptions": rows(Subscription, ["id", "user_id", "plan_id", "status", "starts_at", "ends_at",
                                             "pages_quota", "pages_used", "devices"]),
        "invoices": rows(Invoice, ["id", "user_id", "number", "issue_date", "seller_name", "buyer_name",
                                   "total", "tax", "status", "source", "confidence", "created_at"]),
    }
    audit(db, owner, "backup_export", "system", "", "دریافت پشتیبان", request)
    body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
    return Response(body, media_type="application/json",
                    headers={"Content-Disposition":
                             f'attachment; filename="faktorkhan-backup-{today_jalali().replace("/", "-")}.json"'})


@router.get("/health")
def health(admin: User = Depends(require_admin)):
    state = cloud_ocr.token_state()
    return {
        "database": db_health(),
        "cloud": {"gateway_ready": state["gateway_ready"], "token_set": state["configured"]},
        "version": settings.APP_VERSION,
        "features": FEATURE_TOTAL,
        "uptime_ok": True,
    }
