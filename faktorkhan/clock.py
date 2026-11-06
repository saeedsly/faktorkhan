"""زمان و تاریخ امروز بر اساس منطقه‌ی زمانی ایران (تهران)."""

from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

TEHRAN_TZ = ZoneInfo("Asia/Tehran")


def now() -> datetime:
    return datetime.now(TEHRAN_TZ)


def today() -> date:
    return now().date()


def now_iso() -> str:
    return now().isoformat(timespec="seconds")
