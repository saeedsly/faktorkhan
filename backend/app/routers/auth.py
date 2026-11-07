"""احراز هویت و مدیریت حساب کاربری."""
from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..deps import (
    audit,
    client_ip,
    ensure_subscription,
    get_current_user,
    rate_limit,
    register_device,
    subscription_of,
)
from ..models import Device, LicenseKey, Plan, Subscription, User, utcnow
from ..schemas import ChangePasswordIn, LoginIn, ProfileIn, RegisterIn
from ..security import (
    create_access_token,
    hash_password,
    license_key_is_wellformed,
    normalize_license_key,
    verify_password,
)
from ..serializers import subscription_public, user_public

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _apply_license(db: Session, user: User, raw_key: str) -> dict:
    key_value = normalize_license_key(raw_key)
    if not license_key_is_wellformed(key_value):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "قالب کد اشتراک درست نیست.")
    key = db.query(LicenseKey).filter(LicenseKey.key == key_value).first()
    if not key:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "کد اشتراک یافت نشد.")
    if key.status != "unused":
        raise HTTPException(status.HTTP_409_CONFLICT, "این کد اشتراک قبلاً استفاده یا لغو شده است.")
    if key.expires_at and key.expires_at < utcnow():
        raise HTTPException(status.HTTP_410_GONE, "این کد اشتراک منقضی شده است.")

    plan = db.get(Plan, key.plan_id)
    if not plan:
        raise HTTPException(status.HTTP_409_CONFLICT, "طرح مربوط به این کد در دسترس نیست.")

    sub = subscription_of(db, user) or ensure_subscription(db, user)
    base = sub.ends_at if (sub.ends_at and sub.ends_at > utcnow()) else utcnow()
    sub.plan_id = plan.id
    sub.status = "active"
    sub.ends_at = base + timedelta(days=plan.duration_days)
    sub.support_until = base + timedelta(days=plan.support_days or plan.duration_days)
    sub.pages_quota = max(sub.pages_quota, 0) + plan.page_quota
    sub.pages_used = 0
    sub.license_key_id = key.id
    sub.notes = f"فعال‌سازی با کد {plan.name}"
    sub.updated_at = utcnow()
    db.add(sub)

    key.status = "used"
    key.redeemed_at = utcnow()
    key.redeemed_by = user.id
    db.add(key)
    db.commit()
    db.refresh(sub)
    return {"plan": plan.name, "ends_at": sub.ends_at, "pages": plan.page_quota}


@router.post("/register", status_code=201)
def register(payload: RegisterIn, request: Request, db: Session = Depends(get_db)):
    rate_limit(request, "register", limit=10, window=300)
    if not settings.ALLOW_REGISTRATION:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "ثبت‌نام در این نسخه بسته است. با پشتیبانی تماس بگیرید.")
    email = payload.email.lower().strip()
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "این ایمیل قبلاً ثبت شده است.")

    is_first = db.query(User).count() == 0
    user = User(
        full_name=payload.full_name.strip(),
        email=email,
        phone=payload.phone.strip(),
        company=payload.company.strip(),
        password_hash=hash_password(payload.password),
        role="owner" if is_first else "user",
        is_active=True,
        last_login_at=utcnow(),
        last_ip=client_ip(request),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    db.add(Subscription(
        user_id=user.id, status="trialing", starts_at=utcnow(),
        ends_at=utcnow() + timedelta(days=settings.TRIAL_DAYS),
        support_until=utcnow() + timedelta(days=settings.TRIAL_DAYS),
        pages_quota=settings.TRIAL_PAGES, pages_used=0, notes="دوره آزمایشی",
    ))
    db.commit()

    license_info = None
    if payload.license_key.strip():
        try:
            license_info = _apply_license(db, user, payload.license_key)
        except HTTPException as exc:
            license_info = {"error": exc.detail}

    audit(db, user, "register", "user", user.id, "ثبت‌نام کاربر جدید", request)
    token = create_access_token(user.id, {"role": user.role})
    db.refresh(user)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": user_public(user),
        "subscription": subscription_public(subscription_of(db, user)),
        "license": license_info,
        "first_user": is_first,
    }


@router.post("/login")
def login(payload: LoginIn, request: Request, db: Session = Depends(get_db)):
    rate_limit(request, "login", limit=20, window=300)
    email = payload.email.lower().strip()
    user = db.query(User).filter(User.email == email).first()
    now = utcnow()

    if user and user.locked_until and user.locked_until > now:
        minutes = int((user.locked_until - now).total_seconds() // 60) + 1
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, f"حساب موقتاً قفل است. {minutes} دقیقه دیگر تلاش کنید.")

    if not user or not verify_password(payload.password, user.password_hash):
        if user:
            user.failed_attempts += 1
            if user.failed_attempts >= settings.MAX_LOGIN_ATTEMPTS:
                user.locked_until = now + timedelta(minutes=settings.LOCK_MINUTES)
                user.failed_attempts = 0
            db.commit()
        audit(db, user, "login_failed", "user", user.id if user else "", "تلاش ناموفق ورود", request)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "ایمیل یا رمز عبور اشتباه است.")

    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "این حساب غیرفعال شده است. با پشتیبانی تماس بگیرید.")

    user.failed_attempts = 0
    user.locked_until = None
    user.last_login_at = now
    user.last_ip = client_ip(request)
    db.add(user)
    db.commit()

    ensure_subscription(db, user)
    if payload.device_id:
        try:
            register_device(db, user, payload.device_id, request.headers.get("user-agent", "")[:60])
        except HTTPException:
            pass

    audit(db, user, "login", "user", user.id, "ورود موفق", request)
    db.refresh(user)
    token = create_access_token(user.id, {"role": user.role})
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": user_public(user),
        "subscription": subscription_public(subscription_of(db, user)),
    }


@router.get("/me")
def me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    sub = ensure_subscription(db, user)
    return {
        "user": user_public(user),
        "subscription": subscription_public(sub),
        "permissions": {
            "admin": user.is_admin,
            "owner": user.role == "owner",
            "invoices": True,
            "cloud": True,
        },
    }


@router.patch("/profile")
def update_profile(payload: ProfileIn, request: Request, user: User = Depends(get_current_user),
                   db: Session = Depends(get_db)):
    for field in ("full_name", "company", "phone", "theme"):
        value = getattr(payload, field)
        if value is not None:
            setattr(user, field, value.strip() if isinstance(value, str) else value)
    user.updated_at = utcnow()
    db.add(user)
    db.commit()
    db.refresh(user)
    audit(db, user, "profile_update", "user", user.id, "ویرایش پروفایل", request)
    return {"user": user_public(user)}


@router.post("/change-password")
def change_password(payload: ChangePasswordIn, request: Request, user: User = Depends(get_current_user),
                    db: Session = Depends(get_db)):
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "رمز عبور فعلی درست نیست.")
    user.password_hash = hash_password(payload.new_password)
    user.must_change_password = False
    user.updated_at = utcnow()
    db.add(user)
    db.commit()
    audit(db, user, "password_change", "user", user.id, "تغییر رمز عبور", request)
    return {"ok": True, "message": "رمز عبور با موفقیت تغییر کرد."}


@router.post("/logout")
def logout(request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    audit(db, user, "logout", "user", user.id, "خروج از حساب", request)
    return {"ok": True}


@router.get("/devices")
def list_devices(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.query(Device).filter(Device.user_id == user.id).order_by(Device.last_seen.desc()).all()
    return {
        "items": [
            {
                "id": row.id,
                "device_id": row.device_id,
                "label": row.label,
                "platform": row.platform,
                "last_seen": row.last_seen.strftime("%Y-%m-%d %H:%M") if row.last_seen else "",
            }
            for row in rows
        ],
        "limit": (user.subscription.plan.max_devices if user.subscription and user.subscription.plan else 1),
    }


@router.delete("/devices/{device_id}")
def remove_device(device_id: str, request: Request, user: User = Depends(get_current_user),
                  db: Session = Depends(get_db)):
    row = db.query(Device).filter(Device.user_id == user.id, Device.device_id == device_id).first()
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "دستگاه یافت نشد.")
    db.delete(row)
    sub = subscription_of(db, user)
    if sub:
        sub.devices = ",".join(d for d in (sub.devices or "").split(",") if d and d != device_id)
        db.add(sub)
    db.commit()
    audit(db, user, "device_remove", "device", device_id, "حذف دستگاه", request)
    return {"ok": True}
