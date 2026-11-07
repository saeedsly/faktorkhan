"""اشتراک‌ها، طرح‌ها و فعال‌سازی کد."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import audit, ensure_subscription, get_current_user, rate_limit, subscription_of
from ..models import LicenseKey, Plan, Subscription, User, utcnow
from ..schemas import RedeemIn
from ..security import license_key_is_wellformed, normalize_license_key
from ..serializers import plan_public, subscription_public
from .auth import _apply_license

router = APIRouter(prefix="/api/billing", tags=["billing"])


@router.get("/plans")
def plans(db: Session = Depends(get_db)):
    rows = db.query(Plan).filter(Plan.is_active.is_(True)).order_by(Plan.sort_order, Plan.price).all()
    return {"items": [plan_public(p) for p in rows]}


@router.get("/subscription")
def my_subscription(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    sub = ensure_subscription(db, user)
    data = subscription_public(sub)
    if data and sub.plan:
        data["features"] = sub.plan.features or []
    return {"subscription": data}


@router.post("/redeem")
def redeem(payload: RedeemIn, request: Request, user: User = Depends(get_current_user),
           db: Session = Depends(get_db)):
    rate_limit(request, "redeem", limit=15, window=600)
    info = _apply_license(db, user, payload.key)
    audit(db, user, "license_redeem", "license", "", f"فعال‌سازی {info['plan']}", request)
    return {
        "ok": True,
        "message": f"اشتراک «{info['plan']}» فعال شد.",
        "subscription": subscription_public(subscription_of(db, user)),
    }


@router.get("/usage")
def usage(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    sub = ensure_subscription(db, user)
    return {
        "pages_used": sub.pages_used,
        "pages_quota": sub.pages_quota,
        "pages_left": sub.pages_left,
        "days_left": sub.days_left,
        "status": sub.status,
        "valid": sub.is_valid,
        "support_active": bool(sub.support_until and sub.support_until >= utcnow()),
        "support_until": sub.support_until.strftime("%Y-%m-%d") if sub.support_until else "",
    }


@router.get("/check-key/{key}")
def check_key(key: str, db: Session = Depends(get_db)):
    """اعتبارسنجی کد اشتراک بدون مصرف کردن آن."""
    value = normalize_license_key(key)
    if not license_key_is_wellformed(value):
        return {"valid": False, "reason": "قالب کد درست نیست."}
    row = db.query(LicenseKey).filter(LicenseKey.key == value).first()
    if not row:
        return {"valid": False, "reason": "کد یافت نشد."}
    if row.status != "unused":
        return {"valid": False, "reason": "این کد قبلاً استفاده شده است."}
    plan = db.get(Plan, row.plan_id)
    return {
        "valid": True,
        "plan": plan.name if plan else "",
        "duration_days": plan.duration_days if plan else 0,
        "page_quota": plan.page_quota if plan else 0,
    }
