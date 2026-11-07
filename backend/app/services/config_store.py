"""تنظیمات قابل ویرایش از پنل مدیریت (روی پایگاه داده)."""
from __future__ import annotations

from ..config import settings
from ..database import session_scope
from ..models import AppSetting

DEFAULTS: dict[str, str] = {
    "registration_open": "1" if settings.ALLOW_REGISTRATION else "0",
    "license_required": "1" if settings.REQUIRE_LICENSE else "0",
    "trial_days": str(settings.TRIAL_DAYS),
    "trial_pages": str(settings.TRIAL_PAGES),
    "support_phone": "",
    "support_email": "",
    "support_telegram": "",
    "announcement": "",
}


def get_cfg(key: str, default: str | None = None) -> str:
    with session_scope() as db:
        row = db.query(AppSetting).filter(AppSetting.key == f"cfg_{key}").first()
        if row is not None:
            return row.value
    return DEFAULTS.get(key, "" if default is None else default)


def cfg_bool(key: str, default: bool = False) -> bool:
    raw = get_cfg(key, "1" if default else "0")
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def cfg_int(key: str, default: int = 0) -> int:
    try:
        return int(str(get_cfg(key, str(default))).strip())
    except (TypeError, ValueError):
        return default


def set_cfg(key: str, value: str) -> None:
    with session_scope() as db:
        row = db.query(AppSetting).filter(AppSetting.key == f"cfg_{key}").first()
        if row:
            row.value = str(value)
        else:
            db.add(AppSetting(key=f"cfg_{key}", value=str(value)))
        db.commit()


def all_cfg() -> dict:
    data = {key: get_cfg(key) for key in DEFAULTS}
    data["registration_open"] = str(int(cfg_bool("registration_open", settings.ALLOW_REGISTRATION)))
    data["license_required"] = str(int(cfg_bool("license_required", settings.REQUIRE_LICENSE)))
    return data
