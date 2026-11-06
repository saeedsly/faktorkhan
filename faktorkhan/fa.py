"""ابزارهای متن فارسی: تبدیل ارقام و عدد به حروف."""

from __future__ import annotations

PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹"
ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩"

_TO_LATIN = {ord(c): str(i) for i, c in enumerate(PERSIAN_DIGITS)}
_TO_LATIN.update({ord(c): str(i) for i, c in enumerate(ARABIC_DIGITS)})
_TO_PERSIAN = {ord(str(i)): c for i, c in enumerate(PERSIAN_DIGITS)}


def normalize_digits(text: str) -> str:
    """ارقام فارسی و عربی را به ارقام لاتین تبدیل می‌کند."""
    return text.translate(_TO_LATIN)


def to_persian_digits(text: str) -> str:
    """ارقام لاتین را به ارقام فارسی تبدیل می‌کند."""
    return text.translate(_TO_PERSIAN)


_ONES = ("", "یک", "دو", "سه", "چهار", "پنج", "شش", "هفت", "هشت", "نه")
_TEENS = (
    "ده", "یازده", "دوازده", "سیزده", "چهارده",
    "پانزده", "شانزده", "هفده", "هجده", "نوزده",
)
_TENS = ("", "", "بیست", "سی", "چهل", "پنجاه", "شصت", "هفتاد", "هشتاد", "نود")
_HUNDREDS = ("", "صد", "دویست", "سیصد", "چهارصد", "پانصد", "ششصد", "هفتصد", "هشتصد", "نهصد")
_SCALES = ("", "هزار", "میلیون", "میلیارد", "تریلیون")


def _below_thousand(n: int) -> str:
    parts: list[str] = []
    hundreds, rest = divmod(n, 100)
    if hundreds:
        parts.append(_HUNDREDS[hundreds])
    if 10 <= rest < 20:
        parts.append(_TEENS[rest - 10])
    else:
        tens, ones = divmod(rest, 10)
        if tens:
            parts.append(_TENS[tens])
        if ones:
            parts.append(_ONES[ones])
    return " و ".join(parts)


def integer_to_words_fa(n: int) -> str:
    """عدد صحیح را به حروف فارسی تبدیل می‌کند (مثلاً 1234 → «یک هزار و دویست و سی و چهار»)."""
    if isinstance(n, bool) or not isinstance(n, int):
        raise TypeError("فقط عدد صحیح پشتیبانی می‌شود.")
    if n == 0:
        return "صفر"
    sign = "منفی " if n < 0 else ""
    n = abs(n)
    if n >= 1000 ** len(_SCALES):
        raise ValueError("عدد بزرگ‌تر از حد مجاز است.")
    chunks: list[str] = []
    index = 0
    while n:
        n, chunk = divmod(n, 1000)
        if chunk:
            if index == 1 and chunk == 1:
                words = _SCALES[1]  # «هزار» و نه «یک هزار»
            else:
                words = _below_thousand(chunk)
                if index:
                    words += " " + _SCALES[index]
            chunks.append(words)
        index += 1
    return sign + " و ".join(reversed(chunks))
