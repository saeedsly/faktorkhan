from datetime import date

import pytest

from faktorkhan.errors import ValidationError
from faktorkhan.fa import integer_to_words_fa
from faktorkhan.jalali import format_jalali, jalali_month_bounds, parse_jalali


@pytest.mark.parametrize(
    "n, text",
    [
        (0, "صفر"), (1, "یک"), (10, "ده"), (12, "دوازده"), (21, "بیست و یک"),
        (100, "صد"), (115, "صد و پانزده"), (1000, "هزار"), (1001, "هزار و یک"),
        (1000000, "یک میلیون"), (1000001, "یک میلیون و یک"),
        (1000000000, "یک میلیارد"), (-5, "منفی پنج"),
    ],
)
def test_words(n, text):
    assert integer_to_words_fa(n) == text


def test_words_rejects_non_integer():
    with pytest.raises(TypeError):
        integer_to_words_fa(1.5)  # type: ignore[arg-type]


def test_jalali_conversion_of_today():
    # 2026-11-07 ↔ ۱۴۰۵/۰۸/۱۶
    assert format_jalali(date(2026, 11, 7)) == "۱۴۰۵/۰۸/۱۶"
    assert format_jalali(date(2026, 11, 7), persian=False) == "1405/08/16"


def test_parse_jalali_roundtrip_and_digits():
    assert parse_jalali("۱۴۰۵/۰۸/۱۶") == date(2026, 11, 7)
    assert parse_jalali("1405-8-16") == date(2026, 11, 7)
    assert parse_jalali("1403/12/30") == date(2025, 3, 20)  # سال کبیسه


@pytest.mark.parametrize("bad", ["1404/12/30", "1405/13/01", "1405/01/32", "16/08/1405", "", "abc"])
def test_parse_jalali_rejects_invalid_dates(bad):
    with pytest.raises(ValidationError):
        parse_jalali(bad)


def test_jalali_month_bounds():
    first, last = jalali_month_bounds(date(2026, 11, 7))  # آبان ۱۴۰۵ (۳۰ روز)
    assert format_jalali(first) == "۱۴۰۵/۰۸/۰۱"
    assert format_jalali(last) == "۱۴۰۵/۰۸/۳۰"
    first, last = jalali_month_bounds(date(2026, 3, 1))  # اسفند ۱۴۰۴ (غیرکبیسه: ۲۹)
    assert format_jalali(last) == "۱۴۰۴/۱۲/۲۹"
