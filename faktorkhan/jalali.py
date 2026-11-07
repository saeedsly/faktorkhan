"""تبدیل و اعتبارسنجی تاریخ شمسی."""

from __future__ import annotations

import re
from datetime import date, timedelta

import jdatetime

from .errors import ValidationError
from .fa import normalize_digits, to_persian_digits

_DATE_RE = re.compile(r"(\d{4})/(\d{1,2})/(\d{1,2})")


def to_jalali(d: date) -> jdatetime.date:
    return jdatetime.date.fromgregorian(date=d)


def format_jalali(d: date, persian: bool = True) -> str:
    """مثلاً ۱۴۰۵/۰۸/۱۶."""
    j = to_jalali(d)
    text = f"{j.year:04d}/{j.month:02d}/{j.day:02d}"
    return to_persian_digits(text) if persian else text


def parse_jalali(text: str) -> date:
    """متن شمسی (با ارقام فارسی یا لاتین) را به تاریخ میلادی تبدیل می‌کند.

    تاریخ‌های نامعتبر مانند ۱۴۰۴/۱۲/۳۰ (سال کبیسه نیست) رد می‌شوند.
    """
    cleaned = normalize_digits(text or "").strip().replace("-", "/")
    match = _DATE_RE.fullmatch(cleaned)
    if not match:
        raise ValidationError("تاریخ باید به شکل ۱۴۰۵/۰۸/۱۶ وارد شود.")
    year, month, day = (int(x) for x in match.groups())
    try:
        return jdatetime.date(year, month, day).togregorian()
    except ValueError as exc:
        raise ValidationError(f"تاریخ شمسی نامعتبر است: {text}") from exc


def jalali_month_bounds(d: date) -> tuple[date, date]:
    """اولین و آخرین روز ماه شمسی که شامل d است (به میلادی)."""
    j = to_jalali(d)
    first = jdatetime.date(j.year, j.month, 1)
    next_year = j.year + (1 if j.month == 12 else 0)
    next_month = 1 if j.month == 12 else j.month + 1
    last = jdatetime.date(next_year, next_month, 1).togregorian() - timedelta(days=1)
    return first.togregorian(), last
