from decimal import Decimal

import pytest

from faktorkhan.errors import ValidationError
from faktorkhan.money import (
    amount_in_words,
    calc_line,
    format_amount,
    parse_decimal,
    round_rial,
    sum_totals,
)


def test_parse_accepts_persian_arabic_digits_and_separators():
    assert parse_decimal("۱٬۲۳۴٬۵۶۷") == Decimal("1234567")
    assert parse_decimal("١,٢٣٤") == Decimal("1234")
    assert parse_decimal("۲٫۵") == Decimal("2.5")
    assert parse_decimal(" 1000 ") == Decimal("1000")


@pytest.mark.parametrize("bad", ["", "abc", "1e5", "1.2.3", "--1", "NaN", "Infinity"])
def test_parse_rejects_invalid_text(bad):
    with pytest.raises(ValidationError):
        parse_decimal(bad)


def test_parse_rejects_float_to_avoid_binary_rounding():
    with pytest.raises(ValidationError):
        parse_decimal(0.1)
    with pytest.raises(ValidationError):
        parse_decimal(True)


def test_round_rial_half_up():
    assert round_rial(Decimal("0.5")) == Decimal("1")
    assert round_rial(Decimal("2.5")) == Decimal("3")
    assert round_rial(Decimal("2.4999")) == Decimal("2")
    assert round_rial(Decimal("-2.5")) == Decimal("-3")


def test_line_vat_and_total_exact():
    # 3 × 1,234,567 = 3,703,701 ; مالیات ۹٪ = 333,333.09 → 333,333
    lt = calc_line("3", "1234567", "0", "9")
    assert lt.gross == Decimal("3703701")
    assert lt.vat == Decimal("333333")
    assert lt.total == Decimal("4037034")


def test_discount_is_applied_before_vat():
    lt = calc_line(10, 1000, discount=2000, vat_rate=10)
    assert lt.gross == Decimal("10000")
    assert lt.taxable == Decimal("8000")
    assert lt.vat == Decimal("800")
    assert lt.total == Decimal("8800")


def test_fractional_quantity_rounds_per_line():
    lt = calc_line("2.5", "999")  # 2497.5 → 2498 (نیم به بالا)
    assert lt.gross == Decimal("2498")


def test_zero_vat_and_zero_discount():
    lt = calc_line(1, 500)
    assert (lt.vat, lt.total) == (Decimal("0"), Decimal("500"))


@pytest.mark.parametrize(
    "qty, price, disc, rate",
    [(0, 100, 0, 9), (-1, 100, 0, 9), (1, -5, 0, 9), (1, 100, -1, 9), (1, 100, 101, 9),
     (1, 100, 0, 101), (1, 100, 0, -1), (1, 100, 200, 0)],
)
def test_invalid_lines_are_rejected(qty, price, disc, rate):
    with pytest.raises(ValidationError):
        calc_line(qty, price, disc, rate)


def test_invoice_total_is_sum_of_rounded_lines():
    lines = [calc_line(1, "1000", vat_rate="9"), calc_line(1, "1000", vat_rate="9")]
    t = sum_totals(lines)
    assert t.total == Decimal("2180")
    assert t.vat == Decimal("180")


def test_format_amount_persian():
    assert format_amount(Decimal("1234567")) == "۱٬۲۳۴٬۵۶۷"
    assert format_amount(Decimal("-1000")) == "-۱٬۰۰۰"
    assert format_amount(Decimal("2.50"), persian=False) == "2.5"
    assert format_amount(Decimal("1000.00"), persian=False) == "1,000"


def test_amount_in_words():
    assert amount_in_words(Decimal("1234567")) == (
        "یک میلیون و دویست و سی و چهار هزار و پانصد و شصت و هفت ریال"
    )
