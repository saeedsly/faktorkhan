"""یکسان‌سازی متن فارسی خروجی OCR.

بخش برگرفته‌شده از پروژه‌ی Persian-OCR-App، Copyright (c) 2025 Hamed Gharghi، مجوز MIT:
https://github.com/Hamed-Gharghi/Persian-OCR-App (فایل ocr_utils.py، تابع normalize_persian_text).
متن کامل مجوز MIT آن پروژه در همان مخزن است. این بخش شامل الگوهای جایگزینی حروف است،
فقط بخش عمومی آن (یکسان‌سازی حروف) آورده شده؛
فهرست اصلاح‌های کلمه‌به‌کلمه‌ی آن پروژه (مخصوص متن کتاب) عمداً نیامده است، چون برای فاکتور
معنا ندارد و ممکن است چیز درست را تغییر دهد. حذف خط‌های تک‌رقمی هم عمداً نیامده، چون
خط‌های کوتاه ممکن است تعداد یا مبلغ باشند.
"""

from __future__ import annotations

import re
import unicodedata

_CHAR_MAP = {
    "ي": "ی",  # ی عربی → فارسی
    "ى": "ی",  # ی الف مقصوره
    "ك": "ک",  # ک عربی → فارسی
    "أ": "ا",
    "إ": "ا",
    "ؤ": "و",
    "ة": "ه",
    "ۀ": "ه",
    "\u0640": "",  # کشیده (ـ)
}
_ARABIC_INDIC = str.maketrans("٠١٢٣٤٥٦٧٨٩", "۰۱۲۳۴۵۶۷۸۹")
_SPACES = re.compile(r"[ \t\u00a0\u200b]+")


def normalize_persian(text: str) -> str:
    if not text:
        return text
    text = unicodedata.normalize("NFC", text)
    text = text.translate(str.maketrans(_CHAR_MAP)).translate(_ARABIC_INDIC)
    lines = [_SPACES.sub(" ", line).strip() for line in text.splitlines()]
    return "\n".join(line for line in lines if line)
