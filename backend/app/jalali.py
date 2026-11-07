"""تبدیل تاریخ میلادی/شمسی (بدون وابستگی بیرونی)."""
from __future__ import annotations

from datetime import date, datetime

PERSIAN_MONTHS = [
    "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
    "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
]
PERSIAN_WEEKDAYS = ["دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه", "شنبه", "یکشنبه"]


def _div(a: int, b: int) -> int:
    return a // b


def gregorian_to_jalali(gy: int, gm: int, gd: int) -> tuple[int, int, int]:
    g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
    if gy > 1600:
        jy = 979
        gy -= 1600
    else:
        jy = 0
        gy -= 621
    gy2 = gy + 1 if gm > 2 else gy
    days = (365 * gy) + _div(gy2 + 3, 4) - _div(gy2 + 99, 100) + _div(gy2 + 399, 400) - 80 + gd + g_d_m[gm - 1]
    jy += 33 * _div(days, 12053)
    days %= 12053
    jy += 4 * _div(days, 1461)
    days %= 1461
    if days > 365:
        jy += _div(days - 1, 365)
        days = (days - 1) % 365
    if days < 186:
        jm = 1 + _div(days, 31)
        jd = 1 + (days % 31)
    else:
        jm = 7 + _div(days - 186, 30)
        jd = 1 + ((days - 186) % 30)
    return jy, jm, jd


def jalali_to_gregorian(jy: int, jm: int, jd: int) -> tuple[int, int, int]:
    if jy > 979:
        gy = 1600
        jy -= 979
    else:
        gy = 621
    days = (365 * jy) + (_div(jy, 33) * 8) + _div((jy % 33) + 3, 4) + 78 + jd + (
        (jm - 1) * 31 if jm < 7 else ((jm - 7) * 30) + 186
    )
    gy += 400 * _div(days, 146097)
    days %= 146097
    if days > 36524:
        days -= 1
        gy += 100 * _div(days, 36524)
        days %= 36524
        if days >= 365:
            days += 1
    gy += 4 * _div(days, 1461)
    days %= 1461
    if days > 365:
        gy += _div(days - 1, 365)
        days = (days - 1) % 365
    gd = days + 1
    leap = (gy % 4 == 0 and gy % 100 != 0) or gy % 400 == 0
    sal_a = [0, 31, 29 if leap else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    gm = 0
    while gm < 13 and gd > sal_a[gm]:
        gd -= sal_a[gm]
        gm += 1
    return gy, gm, gd


def today_jalali(sep: str = "/") -> str:
    t = date.today()
    jy, jm, jd = gregorian_to_jalali(t.year, t.month, t.day)
    return f"{jy}{sep}{jm:02d}{sep}{jd:02d}"


def jalali_pretty(value: str) -> str:
    """1404/08/16 → ۱۶ آبان ۱۴۰۴"""
    try:
        parts = value.replace("-", "/").split("/")
        jy, jm, jd = int(parts[0]), int(parts[1]), int(parts[2])
        return f"{jd} {PERSIAN_MONTHS[jm - 1]} {jy}"
    except Exception:
        return value or "—"


def to_iso(value: str) -> str:
    """تاریخ شمسی را به میلادی ISO تبدیل می‌کند (برای مرتب‌سازی/گزارش)."""
    try:
        parts = value.replace("-", "/").split("/")
        gy, gm, gd = jalali_to_gregorian(int(parts[0]), int(parts[1]), int(parts[2]))
        return date(gy, gm, gd).isoformat()
    except Exception:
        return ""


def gregorian_from_dt(dt: datetime) -> str:
    gy, gm, gd = gregorian_to_jalali(dt.year, dt.month, dt.day)
    return f"{gy}/{gm:02d}/{gd:02d}"
