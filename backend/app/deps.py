"""وابستگی‌های مشترک: احراز هویت، نقش‌ها، محدودیت نرخ، گزارش رخداد."""
from __future__ import annotations

import time
from collections import defaultdict, deque

from fastapi import Depends, Header, HTTPException, Request, status
from sqlalchemy.orm import Session

from .config import settings
from .database import get_db
from .models import AuditLog, Device, Invoice, Subscription, User, utcnow
from .security import decode_token


def client_ip(request: Request) -> str:
    """IP کاربر؛ X-Forwarded-For فقط وقتی پروکسی مورد اعتماد است خوانده می‌شود.

    خواندن بدون اعتبارسنجی این هدر اجازهٔ جعل IP و دورزدن محدودیت نرخ را می‌دهد،
    بنابراین به‌صورت پیش‌فرض خاموش است و با TRUST_PROXY=1 روشن می‌شود.
    """
    if settings.TRUST_PROXY:
        forwarded = request.headers.get("x-forwarded-for", "")
        if forwarded:
            return forwarded.split(",")[0].strip()[:64]
    return (request.client.host if request.client else "")[:64]


def _bearer(authorization: str | None) -> str | None:
    if not authorization:
        return None
    parts = authorization.split(None, 1)
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1].strip()
    return None


def get_current_user(
    request: Request,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> User:
    token = _bearer(authorization) or request.cookies.get("fk_token")
    payload = decode_token(token) if token else None
    if not payload:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "نشست شما معتبر نیست؛ دوباره وارد شوید.")
    try:
        user_id = int(payload.get("sub", 0))
    except (TypeError, ValueError):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "نشست نامعتبر است.")
    user = db.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "حساب کاربری غیرفعال است.")
    return user


def get_optional_user(
    request: Request,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> User | None:
    try:
        return get_current_user(request, authorization, db)
    except HTTPException:
        return None


def require_admin(user: User = Depends(get_current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "دسترسی به این بخش فقط برای مدیران مجاز است.")
    return user


def require_owner(user: User = Depends(get_current_user)) -> User:
    if user.role != "owner":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "این عملیات فقط برای مالک سامانه مجاز است.")
    return user


# ------------------------------------------------------------ اشتراک
def subscription_of(db: Session, user: User) -> Subscription | None:
    return db.query(Subscription).filter(Subscription.user_id == user.id).first()


def ensure_subscription(db: Session, user: User) -> Subscription:
    """اگر کاربر اشتراک ندارد، دوره آزمایشی ساخته می‌شود."""
    sub = subscription_of(db, user)
    if sub:
        return sub
    from datetime import timedelta

    sub = Subscription(
        user_id=user.id,
        status="trialing",
        starts_at=utcnow(),
        ends_at=utcnow() + timedelta(days=settings.TRIAL_DAYS),
        support_until=utcnow() + timedelta(days=settings.TRIAL_DAYS),
        pages_quota=settings.TRIAL_PAGES,
        pages_used=0,
        notes="دوره آزمایشی",
    )
    db.add(sub)
    db.commit()
    db.refresh(sub)
    return sub


def require_active_subscription(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> User:
    if user.is_admin or not settings.REQUIRE_LICENSE:
        return user
    sub = ensure_subscription(db, user)
    if not sub.is_valid:
        raise HTTPException(
            status.HTTP_402_PAYMENT_REQUIRED,
            "اشتراک شما منقضی شده است. برای ادامه، کد اشتراک را فعال کنید.",
        )
    if sub.pages_quota and sub.pages_used >= sub.pages_quota:
        raise HTTPException(
            status.HTTP_402_PAYMENT_REQUIRED,
            "سهمیه صفحات اشتراک شما به پایان رسیده است.",
        )
    return user


def consume_quota(db: Session, user: User, pages: int = 1) -> None:
    if user.is_admin:
        return
    sub = ensure_subscription(db, user)
    sub.pages_used += max(pages, 1)
    sub.updated_at = utcnow()
    db.add(sub)
    db.commit()


def register_device(db: Session, user: User, device_id: str, platform: str = "") -> None:
    if not device_id:
        return
    sub = subscription_of(db, user)
    if sub:
        ids = [d for d in (sub.devices or "").split(",") if d]
        if device_id not in ids:
            limit = 1
            if sub.plan:
                limit = max(sub.plan.max_devices, 1)
            if len(ids) >= limit and user.role == "user":
                raise HTTPException(
                    status.HTTP_403_FORBIDDEN,
                    "تعداد دستگاه‌های مجاز این اشتراک تکمیل شده است. با پشتیبانی تماس بگیرید.",
                )
            ids.append(device_id)
            sub.devices = ",".join(ids)
            db.add(sub)
            db.commit()
    row = db.query(Device).filter(Device.user_id == user.id, Device.device_id == device_id).first()
    if row:
        row.last_seen = utcnow()
        row.platform = platform or row.platform
    else:
        db.add(Device(user_id=user.id, device_id=device_id, label=f"دستگاه {device_id[-4:]}", platform=platform))
    db.commit()


def audit(
    db: Session,
    user: User | None,
    action: str,
    entity: str = "",
    entity_id: str | int = "",
    detail: str = "",
    request: Request | None = None,
) -> None:
    try:
        db.add(
            AuditLog(
                user_id=user.id if user else None,
                actor=(user.full_name or user.email) if user else "مهمان",
                action=action,
                entity=entity,
                entity_id=str(entity_id)[:60],
                detail=detail[:500],
                ip=client_ip(request) if request else "",
                user_agent=(request.headers.get("user-agent", "")[:300] if request else ""),
            )
        )
        db.commit()
    except Exception:  # pragma: no cover - ثبت لاگ نباید جریان اصلی را متوقف کند
        db.rollback()


# ------------------------------------------------------------ محدودیت نرخ
"""
محدودیت نرخ — با آگاهی از «چند کاربر پشت یک IP»

باگ واقعی که این را لازم کرد: در یک شبکهٔ اداری، ۱۰۰ کاربر از طریق
یک NAT به اینترنت وصل‌اند و همه **یک IP** دارند. اگر محدودیت را فقط به
IP گره بزنیم، کاربر یازدهم به بعد مسدود می‌شود و همه فکر می‌کنند برنامه
خراب است.

راه‌حل: کلید محدودیت ترکیبی است:
  • اگر کاربر وارد شده باشد → شناسهٔ خودش (هر کاربر سهم خودش را دارد)
  • اگر وارد نشده باشد       → IP + شناسهٔ دستگاه (مرورگر)

این کار هم ضدحملهٔ خودکار مؤثر می‌ماند، هم کاربران واقعی را در یک دفتر
مسدود نمی‌کند.
"""
_RATE: dict[str, deque] = defaultdict(deque)
_RATE_SEEN: dict[str, float] = {}
_RATE_LAST_CLEAN = [0.0]


def _rate_key(request: Request, bucket: str) -> str:
    """کلید محدودیت: کاربر واقعی اولویت دارد، بعد IP + دستگاه."""
    identity = ""
    try:
        # اگر توکن معتبر در هدر است، از شناسهٔ کاربر استفاده کن
        auth = request.headers.get("authorization") or ""
        if auth.lower().startswith("bearer "):
            from .security import decode_token

            payload = decode_token(auth.split(" ", 1)[1].strip())
            identity = f"u{payload.get('sub') or payload.get('uid') or ''}"
    except Exception:
        identity = ""
    if not identity:
        # اثر انگشت سبک مرورگر — دو کاربر پشت یک IP کلید جدا می‌گیرند
        ua = (request.headers.get("user-agent") or "")[:120]
        lang = (request.headers.get("accept-language") or "")[:40]
        identity = f"d{client_ip(request)}|{hash(ua + lang) & 0xFFFFFF:06x}"
    return f"{bucket}:{identity}"


def _rate_cleanup(now: float) -> None:
    """پاک‌سازی دوره‌ای — بدون این، حافظه با هر IP جدید رشد می‌کند."""
    if now - _RATE_LAST_CLEAN[0] < 300:
        return
    _RATE_LAST_CLEAN[0] = now
    stale = [k for k in _RATE if not _RATE[k] or now - _RATE[k][-1] > 3600]
    for k in stale:
        _RATE.pop(k, None)


def rate_limit(request: Request, bucket: str, limit: int = 30, window: int = 60,
               per_user: bool = True) -> None:
    """محدودیت نرخ.

    per_user=True (پیش‌فرض): هر کاربر سهم خودش را دارد — مناسب نصب چندکاربره.
    per_user=False: محدودیت خالص بر IP — برای مسیرهای ضدحمله مثل ورود،
    که مهاجم ممکن است هزار حساب بسازد.
    """
    if not getattr(settings, "RATE_LIMIT_ENABLED", True):
        return
    key = _rate_key(request, bucket) if per_user else f"{bucket}:{client_ip(request)}"
    now = time.time()
    _rate_cleanup(now)
    q = _RATE[key]
    while q and now - q[0] > window:
        q.popleft()
    if len(q) >= limit:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                            "تعداد درخواست‌ها زیاد است؛ چند لحظه صبر کنید و دوباره تلاش کنید.")
    q.append(now)


def invoice_stats_for(db: Session, user: User) -> dict:
    base = db.query(Invoice).filter(Invoice.user_id == user.id)
    total = base.count()
    confirmed = base.filter(Invoice.status == "confirmed").count()
    draft = base.filter(Invoice.status == "draft").count()
    return {"total": total, "confirmed": confirmed, "draft": draft}
