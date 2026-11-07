"""ترتیب خطوط و معکوس‌سازی خروجی CTC برای متن عربی/فارسی.

منطق `pred_reverse` دقیقاً از PaddleOCR (ppocr/postprocess/rec_postprocess.py) گرفته شده:
وقتی نام فایل دیکشنری شامل "arabic" باشد، PaddleOCR خروجی را برمی‌گرداند.
مدل‌های عربی روی متن «ترتیب بصری» (چپ به راست روی صفحه) آموزش دیده‌اند.

نکته‌ی مهم: این تابع ارقام ASCII و علامت‌های لاتین را به‌صورت یک قطعه نگه می‌دارد،
اما ارقام فارسی (۰-۹) در regex نیستند و تک‌تک معکوس می‌شوند. یعنی «۱۲۳» به «۳۲۱» تبدیل
می‌شود. این رفتار عمداً در حالت `paddle` نگه داشته شده تا با PaddleOCR یکسان باشد،
و حالت `raw` بدون معکوس‌سازی هم در خروجی هست. کدام درست است باید با تست روی مدل واقعی
و نمونه‌های فارسی سنجیده شود (eval هر دو را گزارش می‌دهد).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from statistics import median

_LTR_CHARS = re.compile(r"[a-zA-Z0-9 :*./%+-]")
DECODE_MODES = ("paddle", "raw")


def paddle_reverse(text: str) -> str:
    """همان منطق PaddleOCR: قطعه‌های لاتین/عددی نگه داشته و ترتیب قطعه‌ها معکوس می‌شود."""
    pieces: list[str] = []
    current = ""
    for ch in text:
        if not _LTR_CHARS.search(ch):
            if current:
                pieces.append(current)
            pieces.append(ch)
            current = ""
        else:
            current += ch
    if current:
        pieces.append(current)
    return "".join(reversed(pieces))


def apply_decode(text: str, mode: str) -> str:
    if mode == "paddle":
        return paddle_reverse(text)
    if mode == "raw":
        return text
    raise ValueError(f"decode mode نامعتبر: {mode!r}")


@dataclass
class Detection:
    text: str
    score: float
    box: list[list[float]]  # چهار گوشه: بالا-چپ، بالا-راست، پایین-راست، پایین-چپ

    @property
    def cx(self) -> float:
        return sum(p[0] for p in self.box) / len(self.box)

    @property
    def cy(self) -> float:
        return sum(p[1] for p in self.box) / len(self.box)

    @property
    def height(self) -> float:
        ys = [p[1] for p in self.box]
        return max(ys) - min(ys)


def group_rows(dets: list[Detection], rtl: bool = True) -> list[list[Detection]]:
    """قطعه‌های تشخیص‌داده‌شده را به سطر و سپس به ترتیب خواندن تبدیل می‌کند.

    سطرها از بالا به پایین؛ داخل هر سطر از راست به چپ (برای فارسی).
    دو قطعه وقتی هم‌سطرند که مرکز عمودی‌شان کمتر از نیم ارتفاع میانه فاصله داشته باشد.
    """
    if not dets:
        return []
    tol = 0.5 * median(d.height for d in dets) or 1.0
    rows: list[list[Detection]] = []
    for d in sorted(dets, key=lambda d: d.cy):
        if rows:
            row_cy = sum(x.cy for x in rows[-1]) / len(rows[-1])
            if abs(d.cy - row_cy) <= tol:
                rows[-1].append(d)
                continue
        rows.append([d])
    for row in rows:
        row.sort(key=lambda d: d.cx, reverse=rtl)
    return rows


def assemble_text(rows: list[list[Detection]]) -> str:
    """سطرها با فاصله‌ی ساده؛ هر سطر یک خط متن."""
    return "\n".join("   ".join(d.text for d in row) for row in rows)
