"""استخراج هوشمند فیلدهای فاکتور از متن OCR (فارسی/انگلیسی).

سه خانواده فاکتور پشتیبانی می‌شود:
  * چاپی (printed) — خروجی متنی و ساخت‌یافته
  * حرارتی (thermal) — متن تک‌ستونی و فشرده
  * دستی (handwritten) — OCR خام با خطاهای نگارشی
"""
from __future__ import annotations

import json
import re
from typing import Any

DIGIT_MAP = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
ARABIC_FIX = str.maketrans({"ي": "ی", "ك": "ک", "ۀ": "ه", "أ": "ا", "إ": "ا", "ؤ": "و", "\u200c": " "})

AMOUNT_RE = r"[-+]?\d[\d,٬.٫]{1,18}"

PERSIAN_MONTHS = {
    "فروردین": 1, "اردیبهشت": 2, "خرداد": 3, "تیر": 4, "مرداد": 5, "شهریور": 6,
    "مهر": 7, "آبان": 8, "اذر": 9, "آذر": 9, "دی": 10, "بهمن": 11, "اسفند": 12,
}


LINE_START_LABELS = (
    r"شماره\s*(?:فاکتور|صورتحساب)|تاریخ|خریدار|فروشنده|فروشگاه|جمع|مالیات|تخفیف|قابل\s*پرداخت"
    r"|مبلغ|invoice|inv\.|date|buyer|customer|seller|vendor|total|grand|subtotal|vat|tax|amount|paid"
)


def auto_break_lines(text: str) -> str:
    """اگر PDF متن را بدون شکست خط استخراج کرده باشد، سطرها بازسازی می‌شوند."""
    if not text:
        return ""
    if text.count("\n") >= 3 or len(text) < 120:
        return text
    broken = re.sub(rf"(?<!^)\s*(?={LINE_START_LABELS})", "\n", text, flags=re.IGNORECASE)
    broken = re.sub(r"(?<=[a-z0-9])(?=[A-Z][a-z])", "\n", broken)
    broken = re.sub(r"(?<=\d)(?=(?:Invoice|Date|Buyer|Seller|Total|Grand|VAT|Tax|Subtotal|Amount|Paid)\b)",
                    "\n", broken, flags=re.IGNORECASE)
    broken = re.sub(r"\n{2,}", "\n", broken)
    return broken


def normalize(text: str) -> str:
    if not text:
        return ""
    t = text.translate(DIGIT_MAP).translate(ARABIC_FIX)
    t = t.replace("\u00a0", " ").replace("\r\n", "\n").replace("\r", "\n")
    lines = []
    for line in t.split("\n"):
        line = re.sub(r"[ \t]{2,}", "\t", line).strip()
        lines.append(line)
    # ستون‌های جدول باید حفظ شوند تا ردیف اقلام قابل تشخیص باشد
    return "\n".join(lines).strip()


def parse_amount(raw: str | None) -> int:
    if not raw:
        return 0
    digits = re.sub(r"[^\d]", "", str(raw).translate(DIGIT_MAP))
    if not digits:
        return 0
    try:
        return int(digits)
    except ValueError:
        return 0


def _clean_number(raw: str) -> str:
    return re.sub(r"\s+", "", str(raw)).strip("-:/#")


def find_invoice_number(text: str) -> str:
    patterns = [
        r"(?:شماره\s*(?:فاکتور|فاكتور|صورتحساب|سند)|فاکتور\s*(?:شماره|شماره‌اش)|شماره\s*سریال)\s*[:#\-–]?\s*([A-Za-z0-9\-/]{2,20})",
        r"(?:invoice\s*(?:no\.?|number|#)|inv\.?\s*no\.?)\s*[:#\-]?\s*([A-Za-z0-9\-/]{2,20})",
        r"فاکتور\s*[:#\-]?\s*([A-Za-z0-9\-/]{3,20})",
        r"(?:^|\n)\s*(?:no|شماره)\s*[:#]\s*([A-Za-z0-9\-/]{2,20})",
    ]
    for pattern in patterns:
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            value = _clean_number(m.group(1))
            if re.fullmatch(r"\d{4}/\d{1,2}/\d{1,2}", value):
                continue
            if any(ch.isdigit() for ch in value):
                return value
    return ""


def find_dates(text: str) -> list[str]:
    results: list[str] = []
    for m in re.finditer(r"(\d{4}[/\-.]\d{1,2}[/\-.]\d{1,2})", text):
        value = m.group(1).replace(".", "/").replace("-", "/")
        parts = value.split("/")
        try:
            year, month, day = int(parts[0]), int(parts[1]), int(parts[2])
        except ValueError:
            continue
        if 1300 <= year <= 1500 and 1 <= month <= 12 and 1 <= day <= 31:
            results.append(f"{year}/{month:02d}/{day:02d}")
        elif 1900 <= year <= 2100 and 1 <= month <= 12 and 1 <= day <= 31:
            from ..jalali import gregorian_to_jalali

            jy, jm, jd = gregorian_to_jalali(year, month, day)
            results.append(f"{jy}/{jm:02d}/{jd:02d}")
    # تاریخ‌های نوشتاری: ۱۶ آبان ۱۴۰۴ / 16 آبان 1404
    for m in re.finditer(r"(\d{1,2})\s+([آ-ی]{3,10})\s+(\d{4})", text):
        month = PERSIAN_MONTHS.get(m.group(2).strip())
        if month:
            results.append(f"{int(m.group(3))}/{month:02d}/{int(m.group(1)):02d}")
    seen, unique = set(), []
    for item in results:
        if item not in seen:
            seen.add(item)
            unique.append(item)
    return unique


def _labeled_amount(text: str, labels: list[str]) -> int:
    for label in labels:
        pattern = rf"{label}[^\d\n]{{0,25}}({AMOUNT_RE})"
        for m in re.finditer(pattern, text, re.IGNORECASE):
            value = parse_amount(m.group(1))
            if value:
                return value
    return 0


def find_totals(text: str) -> dict[str, int]:
    payable = _labeled_amount(text, [
        r"مبلغ\s*قابل\s*پرداخت", r"مبلغ\s*نهایی", r"قابل\s*پرداخت", r"مبلغ\s*پرداختی",
        r"amount\s*due", r"grand\s*total", r"total\s*amount", r"^\s*total\s*[:：]",
    ])
    gross = _labeled_amount(text, [
        r"جمع\s*کل\s*(?:فاکتور|مبالغ|مبلغ)?(?!\s*مالیات)", r"جمع\s*فاکتور", r"مبلغ\s*کل",
        r"جمع\s*مبالغ", r"^\s*total\s*[:：]", r"\btotal\b",
    ])
    subtotal = _labeled_amount(text, [
        r"جمع\s*(?:جز|اقلام|کالا|ردیف)", r"جمع\s*قبل\s*از\s*مالیات", r"مبلغ\s*خالص",
        r"sub\s*total", r"subtotal",
    ])
    tax = _labeled_amount(text, [
        r"مالیات\s*(?:بر\s*)?(?:ارزش\s*افزوده|و\s*عوارض)?", r"ارزش\s*افزوده", r"\bVAT\b", r"\btax\b",
    ])
    discount = _labeled_amount(text, [r"تخفیف", r"discount"])
    paid = _labeled_amount(text, [r"پرداخت\s*شده", r"پیش\s*پرداخت", r"مبلغ\s*دریافتی", r"\bpaid\b"])

    base = subtotal or gross
    if not payable:
        payable = base - discount + tax if base else 0
    if not base:
        base = payable - tax + discount
    return {
        "total": abs(payable),
        "subtotal": abs(base),
        "tax": abs(tax),
        "discount": abs(discount),
        "paid": abs(paid),
        "gross": abs(gross),
    }


def find_party(text: str, kind: str) -> tuple[str, str]:
    if kind == "seller":
        name_labels = [r"فروشنده", r"فروشگاه", r"نام\s*شرکت", r"مؤسسه", r"عرضه\s*کننده", r"seller", r"vendor", r"from"]
        tax_labels = [r"شناسه\s*ملی\s*(?:فروشنده)?", r"کد\s*اقتصادی\s*(?:فروشنده)?", r"شماره\s*ثبت"]
    else:
        name_labels = [r"خریدار", r"مشتری", r"نام\s*خریدار", r"buyer", r"customer", r"bill\s*to", r"to"]
        tax_labels = [r"شناسه\s*ملی\s*(?:خریدار)?", r"کد\s*اقتصادی\s*(?:خریدار)?", r"کد\s*ملی"]
    name, tax_id = "", ""
    for label in name_labels:
        m = re.search(rf"{label}\s*[:：\-]?\s*([^\t\n:：|]{{2,60}})", text, re.IGNORECASE)
        if m:
            candidate = m.group(1).replace("\t", " ").strip(" :-|")
            candidate = re.sub(r"(شناسه|کد|تلفن|فکس|آدرس|شماره).*$", "", candidate).strip(" :-|")
            candidate = re.sub(r"^(نام|شرکت|آقای|خانم)\s+", "", candidate)
            if len(candidate) >= 2 and not re.fullmatch(r"[\d\s,]+", candidate):
                name = candidate[:120]
                break
    for label in tax_labels:
        m = re.search(rf"{label}\s*[:：\-]?\s*(\d[\d\-]{{5,20}})", text)
        if m:
            tax_id = m.group(1).strip()
            break
    return name, tax_id


def find_items(text: str) -> list[dict[str, Any]]:
    """استخراج ردیف اقلام از متن — مناسب فاکتورهای چاپی و حرارتی."""
    items: list[dict[str, Any]] = []
    skip_labels = re.compile(
        r"(جمع|مالیات|تخفیف|total|\btax\b|قابل\s*پرداخت|شماره|فاکتور|تاریخ|شناسه\s*(?:ملی|اقتصادی)"
        r"|کد\s*(?:ملی|اقتصادی|پستی)|تلفن|فکس|آدرس|وب\s*سایت|ایمیل|امضا|مهر|شبا"
        r"|شماره\s*کارت|شماره\s*حساب|ساعت|صفحه)",
        re.IGNORECASE,
    )
    for line in text.split("\n"):
        line = line.strip()
        if len(line) < 6 or skip_labels.search(line):
            continue
        tokens = [t.strip() for t in re.split(r"\t|\s{2,}|\|", line) if t.strip()]
        numbers = [parse_amount(t) for t in tokens if re.fullmatch(r"[\d,٬.\s\-]{2,}", t.strip())]
        text_parts = [t for t in tokens if re.search(r"[آ-یA-Za-z]{2,}", t) and not re.fullmatch(r"[\d,٬.]+", t)]
        if len(numbers) < 2 or not text_parts:
            # تلاش دوم: اعداد انتهای خط (قالب حرارتی فشرده)
            trailing = re.findall(r"\b\d[\d,٬.]{2,}\b", line)
            if len(trailing) < 2:
                continue
            numbers = [parse_amount(t) for t in trailing]
        if len(numbers) < 2:
            continue
        total = numbers[-1]
        unit_price = numbers[-2] if len(numbers) >= 2 else total
        qty: float = 1
        if unit_price and total and total % unit_price == 0 and 1 <= total // unit_price <= 10000:
            qty = total // unit_price
        elif len(numbers) >= 3 and numbers[0] <= 100000:
            qty = numbers[0]
        if not total or total > 10**14:
            continue
        description = " ".join(text_parts).strip(" -|")
        description = re.sub(r"^\d{1,3}[\s\-.)]+", "", description)
        description = re.sub(r"(\s[\d,٬.]+)+\s*$", "", description)
        description = re.sub(r"\s{2,}", " ", description).strip(" -|")[:200]
        if not description:
            description = "کالا/خدمت"
        items.append({
            "row_no": len(items) + 1,
            "code": "",
            "description": description,
            "qty": float(qty or 1),
            "unit": "عدد",
            "unit_price": int(unit_price or 0),
            "discount": 0,
            "tax_rate": 0,
            "total": int(total or 0),
        })
        if len(items) >= 80:
            break
    return items


def _flatten_json(raw: Any) -> str:
    """تبدیل خروجی JSON سرویس (متن/مختصات) به متن ساده."""
    chunks: list[str] = []

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            for key in ("Text", "text", "Word", "word", "Line", "line", "Value", "value"):
                if key in node and isinstance(node[key], (str, int, float)):
                    chunks.append(str(node[key]))
                    return
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                if isinstance(value, (dict, list)):
                    walk(value)
                elif isinstance(value, (str, int, float)):
                    chunks.append(str(value))
        elif isinstance(node, (str, int, float)):
            chunks.append(str(node))

    walk(raw)
    return "\n".join(chunks)


def text_from_payload(payload: str) -> str:
    """اگر خروجی سرویس JSON بود، متن داخل آن استخراج می‌شود."""
    stripped = (payload or "").strip()
    if stripped.startswith(("{", "[")):
        try:
            return _flatten_json(json.loads(stripped))
        except json.JSONDecodeError:
            pass
    return payload or ""


def detect_type(text: str) -> str:
    low = text.lower()
    if len(text) < 260 and re.search(r"(فیش|رسید|pos|کارتخوان|تراکنش)", low):
        return "thermal"
    if re.search(r"(handwritten|دست\s*نویس)", low):
        return "handwritten"
    return "printed"


def parse_invoice(raw_text: str, invoice_type: str | None = None) -> dict[str, Any]:
    text = normalize(auto_break_lines(text_from_payload(raw_text)))
    found: list[str] = []

    number = find_invoice_number(text)
    if number:
        found.append("number")
    dates = find_dates(text)
    totals = find_totals(text)
    seller, seller_tax = find_party(text, "seller")
    buyer, buyer_tax = find_party(text, "buyer")
    items = find_items(text)

    if not seller:
        for line in text.split("\n")[:4]:
            candidate = line.replace("\t", " ").strip()
            if (4 <= len(candidate) <= 60 and re.search(r"(?:[آ-ی]{3,}|[A-Za-z]{3,})", candidate)
                    and not re.search(r"(فاکتور|تاریخ|شماره|جمع|مالیات|تخفیف|خریدار|فروشنده)", candidate)
                    and not re.search(r"\d{3,}", candidate)):
                seller = candidate
                break
    if seller:
        found.append("seller")
    if buyer:
        found.append("buyer")
    if totals["total"]:
        found.append("total")
    if totals["tax"]:
        found.append("tax")
    if items:
        found.append("items")

    if not totals["total"] and items:
        totals["total"] = sum(i["total"] for i in items)
        found.append("total(sum)")
    if not totals["subtotal"] and items:
        totals["subtotal"] = sum(i["total"] for i in items)
    if not number:
        # جایگزین: طولانی‌ترین عدد ۴ تا ۱۲ رقمی مستقل در ابتدای سند
        m = re.search(r"(?:^|\n)[^\d]{0,12}(\d{4,12})(?:\n|$)", text)
        if m:
            number = m.group(1)

    confidence = min(
        100,
        int(
            (18 if number else 0)
            + (14 if dates else 0)
            + (16 if seller else 0)
            + (10 if buyer else 0)
            + (20 if totals["total"] else 0)
            + (8 if totals["tax"] else 0)
            + (10 if items else 0)
            + (4 if len(text) > 200 else 0)
        ),
    )

    warnings: list[str] = []
    if not number:
        warnings.append("شماره فاکتور پیدا نشد؛ دستی وارد کنید.")
    if not dates:
        warnings.append("تاریخ فاکتور شناسایی نشد.")
    if not totals["total"]:
        warnings.append("مبلغ کل شناسایی نشد؛ جمع اقلام بررسی شود.")
    items_sum = sum(i["total"] for i in items)
    expected = totals.get("subtotal") or totals["total"]
    if items and expected and abs(items_sum - expected) > max(2000, expected * 0.06):
        warnings.append("جمع اقلام با مبلغ کل اختلاف دارد؛ بازبینی لازم است.")
    if confidence < 55:
        warnings.append("کیفیت متن پایین است؛ پیشنهاد می‌شود فایل واضح‌تری ارسال شود.")

    return {
        "number": number,
        "issue_date": dates[0] if dates else "",
        "due_date": dates[1] if len(dates) > 1 else "",
        "invoice_type": invoice_type or detect_type(text),
        "seller_name": seller,
        "seller_tax_id": seller_tax,
        "buyer_name": buyer,
        "buyer_tax_id": buyer_tax,
        "subtotal": totals["subtotal"],
        "discount": totals["discount"],
        "tax": totals["tax"],
        "total": totals["total"],
        "paid": totals["paid"],
        "items": items,
        "confidence": confidence,
        "fields_found": found,
        "warnings": warnings,
        "text": text,
    }


def merge_texts(parts: list[str]) -> str:
    return "\n".join(p for p in (normalize(x) for x in parts) if p)
