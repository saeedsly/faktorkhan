"""محاسبات مالی با Decimal.

قوانین:
* هیچ‌جا از float استفاده نمی‌شود (ورودی float رد می‌شود).
* مبالغ به ریال و بدون اعشار گرد می‌شوند (ROUND_HALF_UP).
* گرد کردن برای هر ردیف انجام می‌شود و جمع فاکتور از جمع ردیف‌های گرد شده است،
  بنابراین جمع‌ها همیشه با اجزای فاکتور می‌خوانند.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Iterable

from .errors import ValidationError
from .fa import integer_to_words_fa, normalize_digits, to_persian_digits

CURRENCY = "ریال"
ZERO = Decimal(0)
RIAL = Decimal(1)
HUNDRED = Decimal(100)

_NUMBER_RE = re.compile(r"-?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)")
# جداکننده‌های هزارگان فارسی/انگلیسی حذف و جداکننده اعشار فارسی به نقطه تبدیل می‌شود.
_CLEAN = str.maketrans({"٬": None, "،": None, ",": None, "٫": ".", " ": None, "\u200c": None})


def parse_decimal(value, field: str = "مقدار") -> Decimal:
    """ورودی متنی یا عددی کاربر را به Decimal تبدیل و اعتبارسنجی می‌کند."""
    if isinstance(value, bool):
        raise ValidationError(f"{field} نامعتبر است.")
    if isinstance(value, float):
        raise ValidationError(f"{field} نباید به‌صورت float باشد؛ عدد را به‌صورت متن وارد کنید.")
    if isinstance(value, Decimal):
        result = value
    elif isinstance(value, int):
        result = Decimal(value)
    elif isinstance(value, str):
        cleaned = normalize_digits(value).translate(_CLEAN)
        if not _NUMBER_RE.fullmatch(cleaned):
            raise ValidationError(f"{field} نامعتبر است: «{value}»")
        try:
            result = Decimal(cleaned)
        except InvalidOperation as exc:  # pragma: no cover - regex already guards this
            raise ValidationError(f"{field} نامعتبر است: «{value}»") from exc
    else:
        raise ValidationError(f"{field} نامعتبر است.")
    if not result.is_finite():
        raise ValidationError(f"{field} نامعتبر است.")
    return result


def round_rial(value: Decimal) -> Decimal:
    """گرد کردن به ریال کامل (نیم به بالا)."""
    return value.quantize(RIAL, rounding=ROUND_HALF_UP)


def _check_percent(value: Decimal, field: str) -> None:
    if value < ZERO or value > HUNDRED:
        raise ValidationError(f"{field} باید بین ۰ و ۱۰۰ باشد.")


@dataclass(frozen=True)
class LineTotals:
    gross: Decimal      # تعداد × قیمت واحد (گرد شده)
    discount: Decimal   # تخفیف ردیف
    taxable: Decimal    # مبلغ مشمول مالیات = گراس − تخفیف
    vat: Decimal        # مالیات بر ارزش افزوده
    total: Decimal      # مبلغ نهایی ردیف = مشمول مالیات + مالیات


@dataclass(frozen=True)
class InvoiceTotals:
    subtotal: Decimal   # جمع گراس ردیف‌ها (قبل از تخفیف)
    discount: Decimal
    taxable: Decimal
    vat: Decimal
    total: Decimal      # مبلغ قابل پرداخت


def calc_line(quantity, unit_price, discount=ZERO, vat_rate=ZERO, field_prefix: str = "") -> LineTotals:
    """محاسبه کامل یک ردیف فاکتور."""
    qty = parse_decimal(quantity, f"{field_prefix}تعداد")
    price = parse_decimal(unit_price, f"{field_prefix}قیمت واحد")
    disc = parse_decimal(discount, f"{field_prefix}تخفیف")
    rate = parse_decimal(vat_rate, f"{field_prefix}درصد مالیات")

    if qty <= ZERO:
        raise ValidationError(f"{field_prefix}تعداد باید بزرگ‌تر از صفر باشد.")
    if price < ZERO:
        raise ValidationError(f"{field_prefix}قیمت واحد نمی‌تواند منفی باشد.")
    if disc < ZERO:
        raise ValidationError(f"{field_prefix}تخفیف نمی‌تواند منفی باشد.")
    _check_percent(rate, f"{field_prefix}درصد مالیات")

    gross = round_rial(qty * price)
    disc = round_rial(disc)
    if disc > gross:
        raise ValidationError(f"{field_prefix}تخفیف از مبلغ ردیف بیشتر است.")
    taxable = gross - disc
    vat = round_rial(taxable * rate / HUNDRED)
    return LineTotals(gross=gross, discount=disc, taxable=taxable, vat=vat, total=taxable + vat)


def sum_totals(lines: Iterable[LineTotals]) -> InvoiceTotals:
    """جمع ردیف‌ها به جمع فاکتور."""
    subtotal = discount = taxable = vat = total = ZERO
    for line in lines:
        subtotal += line.gross
        discount += line.discount
        taxable += line.taxable
        vat += line.vat
        total += line.total
    return InvoiceTotals(subtotal=subtotal, discount=discount, taxable=taxable, vat=vat, total=total)


def add_invoice_totals(items: Iterable[InvoiceTotals]) -> InvoiceTotals:
    """جمع چند فاکتور (برای گزارش)."""
    subtotal = discount = taxable = vat = total = ZERO
    for t in items:
        subtotal += t.subtotal
        discount += t.discount
        taxable += t.taxable
        vat += t.vat
        total += t.total
    return InvoiceTotals(subtotal=subtotal, discount=discount, taxable=taxable, vat=vat, total=total)


def format_amount(value, persian: bool = True) -> str:
    """نمایش عدد با جداکننده هزارگان (مثلاً ۱٬۲۳۴٬۵۶۷)."""
    d = parse_decimal(value)
    text = format(abs(d).normalize(), ",f")
    if persian:
        text = to_persian_digits(text.replace(",", "٬").replace(".", "٫"))
    return ("-" if d < ZERO else "") + text


def amount_in_words(value) -> str:
    """مبلغ به حروف فارسی همراه با واحد پول (مثلاً «یک میلیون و ... ریال»)."""
    rial = int(round_rial(parse_decimal(value)))
    return f"{integer_to_words_fa(rial)} {CURRENCY}"
