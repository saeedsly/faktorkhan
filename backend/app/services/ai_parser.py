"""هوش مصنوعی فهم اقلام فاکتور + صحت‌سنجی و اصلاح اعداد.

دو لایهٔ مستقل:
  • قاعده‌محور (بدون اینترنت) — همیشه اجرا می‌شود، سریع و قابل پیش‌بینی
  • مدل بینایی-زبانی (اختیاری) — وقتی کلید تنظیم شده باشد، ساختار را از خود تصویر می‌فهمد

هر دو خروجی یکسان می‌دهند تا جایگزین‌پذیر باشند:
    {"items": [...], "totals": {...}, "issues": [...], "confidence": 0..100, "engine": "..."}
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any

from .parser import (
    DIGIT_MAP, normalize, parse_amount, parse_invoice,
)

log = logging.getLogger("faktorkhan.items")

# نام‌های رایج ستون‌های فاکتور (برای تشخیص سرستون)
QTY_WORDS = ("تعداد", "مقدار", "qty", "quantity", "count", "عدد")
PRICE_WORDS = ("قیمت واحد", "قیمت", "مبلغ واحد", "unit price", "price", "rate")
TOTAL_WORDS = ("مبلغ کل", "جمع", "total", "amount", "مبلغ", "بهای کل")
DISC_WORDS = ("تخفیف", "discount", "تخفيف")
UNIT_WORDS = ("واحد", "unit", "uom")
CODE_WORDS = ("کد", "code", "sku", "بارکد", "barcode")

# واحدهای رایج
UNITS = ("عدد", "کیلو", "کیلوگرم", "گرم", "متر", "مترمربع", "لیتر", "بسته", "کارتن",
         "دستگاه", "حلقه", "برگ", "ورق", "شیت", "pcs", "kg", "g", "m", "m2", "l", "box")

# عدد = رقم، با جداکنندهٔ هزارگان (کاما/نقطه/ممیزی)؛ فاصله هرگز داخل عدد نیست
# چون فاصله و Tab در فاکتور یعنی مرز ستون.
NUM_RE = re.compile(r"[-+]?\d(?:[\d,٬٫]|(?<=\d)\.(?=\d\d\d))*")
PERSIAN_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")


def _to_int(raw: str) -> int:
    """تبدیل عدد فارسی/عربی/با جداکننده به عدد صحیح."""
    if not raw:
        return 0
    s = str(raw).translate(PERSIAN_DIGITS)
    s = s.replace("٬", "").replace(",", "").replace("٫", ".").replace(" ", "")
    s = re.sub(r"[^\d.\-]", "", s)
    if s.count(".") > 1:            # جداکنندهٔ هزارگان با نقطه
        s = s.replace(".", "")
    try:
        return int(round(float(s)))
    except (TypeError, ValueError):
        return 0


def _numbers_in(line: str) -> list[int]:
    out = []
    for m in NUM_RE.finditer(line):
        v = _to_int(m.group())
        if v != 0 or re.fullmatch(r"0+", m.group().translate(PERSIAN_DIGITS)):
            out.append(v)
    return out


def _find_unit(text: str) -> str:
    low = text.lower()
    for u in UNITS:
        if re.search(rf"(?<![آ-یa-z]){re.escape(u)}(?![آ-یa-z])", low):
            return u
    return ""


def _header_map(line: str) -> dict[str, int]:
    """نقشهٔ نام ستون → شمارهٔ ستون بر اساس سرستون‌های جدول."""
    cells = [c.strip() for c in re.split(r"\t+|\s{3,}|\|", line) if c.strip()]
    if len(cells) < 2:
        return {}
    mapping: dict[str, int] = {}
    for i, cell in enumerate(cells):
        low = cell.lower()
        if any(w in low for w in QTY_WORDS) and "qty" not in mapping:
            mapping["qty"] = i
        elif any(w in low for w in PRICE_WORDS) and "price" not in mapping:
            mapping["price"] = i
        elif any(w in low for w in TOTAL_WORDS) and "total" not in mapping:
            mapping["total"] = i
        elif any(w in low for w in DISC_WORDS) and "discount" not in mapping:
            mapping["discount"] = i
        elif any(w in low for w in UNIT_WORDS) and "unit" not in mapping:
            mapping["unit"] = i
        elif any(w in low for w in CODE_WORDS) and "code" not in mapping:
            mapping["code"] = i
    return mapping if len(mapping) >= 2 else {}


def _split_cells(line: str) -> list[str]:
    if "\t" in line:
        return [c.strip() for c in line.split("\t")]
    parts = re.split(r"\s{2,}|\|", line)
    if len(parts) >= 2:
        return [p.strip() for p in parts]
    return [line.strip()]


def _desc_and_numbers(cells: list[str], line: str) -> tuple[str, list[int]]:
    """
    از سلول‌های یک سطر، «توضیح کالا» و «اعداد» را جدا می‌کند.
    normalize فاصله‌های چندتایی را به Tab تبدیل می‌کند، پس فاکتور حرارتی هم
    ستون می‌شود؛ ولی اگر هنوز یک سلول واحد بود، از راست اعداد را جدا می‌کنیم.
    """
    # «عدد + واحد» هم عدد حساب می‌شود: «۱۰ بسته»، «۲ عدد»، «۳ کارتن».
    # در فاکتور فارسی ستون تعداد تقریباً همیشه واحد دارد؛ اگر فقط عدد
    # خالص را بپذیریم، تعداد همیشه ۱ می‌ماند و مبلغ قلم صفر می‌شود.
    num_unit = re.compile(r"^[\s\-+]?([\d,٬٫.]+)\s*([^\d]{0,12})$")
    pure_num = re.compile(r"^[\s\-+]?[\d,٬٫.]+\s*(?:%|ریال|تومان)?$")

    def as_number(cell: str) -> int | None:
        c = (cell or "").strip()
        if not c:
            return None
        if pure_num.match(c):
            return _to_int(c)
        m = num_unit.match(c)
        if m:
            unit = m.group(2).strip()
            # واحد باید کوتاه و بی‌عدد باشد، وگرنه «کالای ۳ عددی» را
            # به‌اشتباه عدد می‌گیریم
            if unit and len(unit) <= 12 and not re.search(r"[A-Za-z]{3,}", unit):
                return _to_int(m.group(1))
        return None

    texts = [c for c in cells if c and as_number(c) is None]
    nums: list[int] = []
    for c in reversed(cells):
        val = as_number(c or "")
        if val is not None:
            nums.insert(0, val)
        elif nums:
            break
    if nums and texts:
        desc = max(texts, key=len).strip(" -|:،,")
        if len(desc) >= 2:
            return desc, nums
    # سلول واحد: اعداد پایانی را از راست جدا کن.
    #
    # جداکننده فقط «فاصله» نیست: فاکتور فارسی معمولاً ستون‌ها را با
    # خط تیره، ممیز عمودی یا «|» جدا می‌کند — مثل
    #     «کاغذ A4 — ۱۰ بسته — ۲۵۰,۰۰۰»
    # نسخهٔ قبلی فقط \s+ را می‌دید، پس روی فاکتور فارسی هیچ عددی
    # پیدا نمی‌کرد و جدول اقلام خالی می‌ماند. این باگ «اقلام را
    # تشخیص نمی‌دهد» را دقیقاً توضیح می‌دهد.
    # جداکننده فقط «فاصله» نیست: فاکتور فارسی ستون‌ها را با خط تیره،
    # ممیز عمودی یا «|» جدا می‌کند — مثل «کاغذ A4 — ۱۰ بسته — ۲۵۰,۰۰۰».
    # نسخهٔ قبلی فقط \s+ را می‌دید و روی فاکتور فارسی هیچ عددی پیدا
    # نمی‌کرد؛ نتیجه: «آماده» با جدول اقلام خالی.
    #
    # الگوی «عدد آخر» به سه شکل پذیرفته می‌شود:
    #   ۲۵۰,۰۰۰            ← عدد خالی در انتها
    #   ... — ۲۵۰,۰۰۰      ← با جداکننده
    #   ۱۰ بسته — ۲۵۰,۰۰۰  ← عدد + واحد + جداکننده (حالت رایج فارسی)
    num_pat = NUM_RE.pattern
    last_num = re.compile(
        r"(?:(?:[\s—–\-|│¦]+)|\s*[—–|│¦]\s*)\s*"
        r"(?:(?P<num>" + num_pat + r")(?:\s*[آ-یa-zA-Z]{1,8})?)"
        r"\s*$"
    )
    work = line.strip()
    tail: list[str] = []
    while len(tail) < 6:
        m = last_num.search(work)
        if not m:
            break
        tail.insert(0, m.group("num"))
        work = work[: m.start()].rstrip(" \t—–-|│¦")
    if len(tail) >= 2:
        desc = work.strip(" -|:،,")
        if len(desc) >= 2:
            return desc, [_to_int(t) for t in tail]

    # یک عدد تنها با جداکننده: «خدمات نصب — ۵۰۰,۰۰۰» یا «کرایه — ۱۲۰,۰۰۰».
    # در فاکتور فارسی این شکل (شرح — مبلغ) بسیار رایج است و اگر نخوانیم،
    # سطر کامل از دست می‌رود. تک‌عدد در چنین سطری «مبلغ» است، نه تعداد؛
    # تفکیک تعداد/مبلغ با علم به این قاعده در بالا انجام می‌شود.
    if len(tail) == 1:
        desc = work.strip(" -|:،,")
        if len(desc) >= 2 and re.search(r"[آ-یA-Za-z]{2,}", desc):
            return desc, [_to_int(tail[0])]
    return (line.strip(), [])


def _header_map(line: str) -> dict[str, int]:
    """نقشهٔ نام ستون → شمارهٔ ستون بر اساس سرستون‌های جدول."""
    cells = [c.strip() for c in re.split(r"\t+|\s{3,}|\|", line) if c.strip()]
    if len(cells) < 2:
        return {}
    mapping: dict[str, int] = {}
    for i, cell in enumerate(cells):
        low = cell.lower()
        if any(w in low for w in QTY_WORDS) and "qty" not in mapping:
            mapping["qty"] = i
        elif any(w in low for w in PRICE_WORDS) and "price" not in mapping:
            mapping["price"] = i
        elif any(w in low for w in TOTAL_WORDS) and "total" not in mapping:
            mapping["total"] = i
        elif any(w in low for w in DISC_WORDS) and "discount" not in mapping:
            mapping["discount"] = i
        elif any(w in low for w in UNIT_WORDS) and "unit" not in mapping:
            mapping["unit"] = i
        elif any(w in low for w in CODE_WORDS) and "code" not in mapping:
            mapping["code"] = i
    return mapping if len(mapping) >= 2 else {}


def _split_cells(line: str) -> list[str]:
    if "\t" in line:
        return [c.strip() for c in line.split("\t")]
    parts = re.split(r"\s{2,}|\|", line)
    if len(parts) >= 2:
        return [p.strip() for p in parts]
    return [line.strip()]


def _split_desc_numbers(line: str) -> tuple[str, list[int]]:
    """
    سطر را به «توضیح» و «اعداد پایانی» می‌شکند.
    فاکتور حرارتی ستون‌بندی ندارد و همه‌چیز با یک فاصله آمده:
        «نان سنگک  2  15,000  30,000»
    قاعده: توضیح از ابتدای سطر تا اولین عددی است که به آخر سطر
    یک‌جا با بقیهٔ اعداد بچسبد (حداقل دو عدد در انتها).
    """
    text = line.strip()
    # از راست به چپ اعداد پایانی را جمع کن
    tail: list[str] = []
    work = text
    while True:
        m = re.search(r"\s*(" + NUM_RE.pattern + r")\s*$", work)
        if not m:
            break
        candidate = work[:m.start()].rstrip()
        # اگر با حذف این عدد، هنوز حداقل یک عدد در انتها نماند متوقف شو
        if not re.search(NUM_RE.pattern + r"\s*$", candidate):
            break
        tail.insert(0, m.group(1))
        work = candidate
    if len(tail) < 2:
        return text, []
    desc = work.strip(" -|:،,")
    if len(desc) < 2:
        return text, []
    return desc, [_to_int(t) for t in tail]


STOP_LABELS = (
    "جمع کل", "جمع", "مالیات", "تخفیف", "قابل پرداخت", "مبلغ نهایی", "بهای کل",
    "total", "subtotal", "grand", "tax", "vat", "discount", "amount due", "paid",
    "شماره", "تاریخ", "خریدار", "فروشنده", "آدرس", "تلفن", "invoice", "date",
)


def _is_total_line(line: str) -> bool:
    low = line.lower().strip()
    return any(low.startswith(lbl) or lbl in low[:28] for lbl in STOP_LABELS)


def extract_items_rules(raw_text: str, invoice_type: str | None = None) -> dict[str, Any]:
    """
    استخراج اقلام بدون هیچ سرویس بیرونی.
    برای فاکتور چاپی/حرارتی که ستون‌هایش با Tab یا فاصلهٔ زیاد جدا شده‌اند خوب کار می‌کند.
    """
    text = normalize(raw_text or "")
    lines = [ln for ln in text.split("\n") if ln.strip()]
    items: list[dict[str, Any]] = []
    header: dict[str, int] = {}
    sections: list[str] = []

    for line in lines:
        hm = _header_map(line)
        if hm and not header:
            header = hm
            sections.append("header")
            continue
        if _is_total_line(line):
            sections.append("total:" + line.strip()[:60])
            continue
        cells = _split_cells(line)
        nums = _numbers_in(line)
        # سطری با یک عدد هم می‌تواند قلم باشد: «خدمات نصب — ۵۰۰,۰۰۰».
        # شرط قبلی (حداقل دو عدد) این شکل رایج فاکتور فارسی را کامل
        # دور می‌ریخت و جدول اقلام خالی می‌ماند.
        if not nums and not header:
            continue
        if len(cells) < 2 and not nums:
            continue

        # توضیح کالا: سلولی که عدد نیست و طولانی‌ترین است
        if header:
            desc_candidates = [c for c in cells if c and not re.fullmatch(r"[\d,.\s%]+", c)]
            desc = max(desc_candidates, key=len) if desc_candidates else ""
        else:
            desc, nums = _desc_and_numbers(cells, line)

        if not desc or len(desc) < 2:
            continue

        qty = price = total = discount = 0
        if header:
            def cell(key: str) -> str:
                i = header.get(key)
                return cells[i] if i is not None and i < len(cells) else ""
            qty = _to_int(cell("qty")) or 1
            price = _to_int(cell("price"))
            total = _to_int(cell("total"))
            discount = _to_int(cell("discount"))
        else:
            if len(nums) >= 3:
                # فاکتور فارسی: «کالا — ۱۰ بسته — ۲۵۰,۰۰۰»
                #   nums = [10, 250000]  →  تعداد، سپس مبلغ
                # اگر هر سه باشند، عدد کوچک‌تر «تعداد» است (تعداد کالا
                # هرگز میلیونی نیست) و بزرگ‌ترها قیمت/جمع‌اند.
                # نسخهٔ قبلی nums[0] را تعداد و nums[1] را قیمت واحد
                # می‌گرفت؛ با «۱۰ بسته — ۲۵۰,۰۰۰» نتیجه qty=1 و
                # unit_price=10 می‌شد — عدد کاملاً بی‌معنا در فاکتور.
                a, b, c = nums[0], nums[1], nums[2]
                if a <= 10000 and b >= 1000:
                    qty, total = a, c if c >= b else b
                    price = int(total / qty) if qty else total
                else:
                    qty, price, total = a, b, c
            elif len(nums) == 1:
                # یک عدد تنها در سطر «شرح — مبلغ» = مبلغ نهایی، نه قیمت واحد
                qty, price, total = 1, 0, nums[0]
            elif len(nums) == 2:
                # دو عدد: کوچک‌تر تعداد، بزرگ‌تر مبلغ
                small, big = min(nums), max(nums)
                if small <= 10000 and big >= 1000:
                    qty, price, total = small, int(big / small) if small else big, big
                else:
                    price, total = nums[0], nums[1]
                    qty = 1
        if qty <= 0:
            qty = 1
        if not total and price:
            total = price * qty
        if not price and total and qty:
            price = int(total / qty)

        items.append({
            "code": "",
            "description": re.sub(r"\s{2,}", " ", desc)[:300],
            "qty": qty,
            "unit": _find_unit(line) or "عدد",
            "unit_price": price,
            "discount": discount,
            "tax_rate": 0,
            "total": total,
        })

    totals = _reconcile_totals(items, text)
    issues = _find_issues(items, totals)
    return {
        "items": items,
        "totals": totals,
        "issues": issues,
        "confidence": _score(items, totals, issues),
        "engine": "rules",
    }


def _reconcile_totals(items: list[dict], text: str) -> dict[str, int]:
    """جمع‌های سند را با جمع اقلام مقایسه و بهترین مقدار را انتخاب می‌کند."""
    parsed = parse_invoice(text) if text else {}
    items_sum = sum(int(i.get("total") or 0) for i in items)
    # جمع اعلام‌شدهٔ سند فقط وقتی پذیرفته می‌شود که با جمع اقلام بخواند؛
    # وگرنه جمع اقلام مرجع است و اختلاف به‌عنوان «اشکال» گزارش می‌شود.
    declared = int(parsed.get("subtotal") or 0)
    declared_subtotal = declared if declared else items_sum
    discount = int(parsed.get("discount") or 0)
    tax = int(parsed.get("tax") or 0)
    declared_total = int(parsed.get("total") or 0)
    computed = declared_subtotal - discount + tax
    return {
        "subtotal": declared_subtotal,
        "items_sum": items_sum,
        "discount": discount,
        "tax": tax,
        "total": declared_total or computed,
        "computed_total": computed,
    }


def _find_issues(items: list[dict], totals: dict) -> list[dict[str, str]]:
    """فهرست اشکال‌های عددی — همان چیزی که کاربر باید ببیند و اصلاح کند."""
    issues: list[dict[str, str]] = []
    for idx, it in enumerate(items, start=1):
        qty = int(it.get("qty") or 0)
        price = int(it.get("unit_price") or 0)
        total = int(it.get("total") or 0)
        disc = int(it.get("discount") or 0)
        if qty and price and total:
            expect = qty * price - disc
            if expect and abs(expect - total) > max(1, abs(expect) * 0.02):
                issues.append({
                    "row": str(idx),
                    "field": "total",
                    "message": f"ردیف {idx}: {qty} × {price} باید {expect:,} باشد ولی {total:,} نوشته شده.",
                    "expected": str(expect),
                    "actual": str(total),
                })
    if totals.get("items_sum") and totals.get("subtotal"):
        diff = abs(int(totals["items_sum"]) - int(totals["subtotal"]))
        if diff > max(1, int(totals["subtotal"]) * 0.02):
            issues.append({
                "row": "-",
                "field": "subtotal",
                "message": f"جمع اقلام {int(totals['items_sum']):,} با جمع اعلام‌شده "
                           f"{int(totals['subtotal']):,} نمی‌خواند.",
                "expected": str(totals["items_sum"]),
                "actual": str(totals["subtotal"]),
            })
    total = int(totals.get("total") or 0)
    computed = int(totals.get("computed_total") or 0)
    if total and computed and abs(total - computed) > max(1, abs(computed) * 0.02):
        issues.append({
            "row": "-",
            "field": "total",
            "message": f"مبلغ کل {total:,} با محاسبهٔ "
                       f"{computed:,} نمی‌خواند.",
            "expected": str(computed),
            "actual": str(total),
        })
    return issues


def _score(items: list[dict], totals: dict, issues: list[dict]) -> int:
    """امتیاز اعتماد ۰..۱۰۰ — به کاربر می‌گوید چقدر به این خروجی اعتماد کند."""
    if not items:
        return 0
    score = 55
    if all(int(i.get("unit_price") or 0) for i in items):
        score += 15
    if all(int(i.get("qty") or 0) for i in items):
        score += 10
    if not issues:
        score += 15
    else:
        score -= min(30, 7 * len(issues))
    if totals.get("items_sum") == totals.get("subtotal") and totals.get("items_sum"):
        score += 5
    return max(0, min(100, score))


# ─────────────────────────── لایهٔ هوش مصنوعی ───────────────────────────

AI_PROMPT = """این تصویر یک فاکتور است. آن را به JSON تبدیل کن و فقط JSON برگردان، بدون هیچ توضیح.

ساختار دقیق:
{"items":[{"code":"","description":"","qty":0,"unit":"","unit_price":0,"discount":0,"total":0}],
 "subtotal":0,"discount":0,"tax":0,"total":0,"currency":"IRR",
 "seller":"","buyer":"","number":"","date":""}

قواعد سخت‌گیرانه:
۱) هر ردیف جدول = یک عضو items. سطر جمع/مالیات/تخفیف را در items نگذار.
۲) همهٔ اعداد را فقط با رقم لاتین و بدون جداکننده بنویس (1250000 نه ۱٬۲۵۰٬۰۰۰).
۳) اگر تعداد × قیمت واحد با مبلغ کل نمی‌خواند، عددِ چاپ‌شده در تصویر را بنویس و خودت تصحیح نکن.
۴) اگر بخشی ناخواناست، رشتهٔ خالی یا ۰ بگذار؛ هیچ عددی از خودت نساز.
۵) توضیح کالا را کامل بنویس (نه خلاصه).
۶) تاریخ را همان‌طور که در تصویر است بنویس (شمسی یا میلادی)."""


def _items_from_ai_payload(payload: dict) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for raw in (payload.get("items") or [])[:200]:
        if not isinstance(raw, dict):
            continue
        desc = str(raw.get("description") or raw.get("name") or "").strip()
        if not desc:
            continue
        qty_raw = raw.get("qty", 1)
        try:
            qty = float(str(qty_raw).translate(PERSIAN_DIGITS) or 1)
        except (TypeError, ValueError):
            qty = 1.0
        if qty <= 0:
            qty = 1.0
        item = {
            "code": str(raw.get("code") or "")[:60],
            "description": desc[:300],
            "qty": qty if qty != int(qty) else int(qty),
            "unit": str(raw.get("unit") or "عدد")[:20],
            "unit_price": _to_int(str(raw.get("unit_price") or 0)),
            "discount": _to_int(str(raw.get("discount") or 0)),
            "tax_rate": _to_int(str(raw.get("tax_rate") or 0)),
            "total": _to_int(str(raw.get("total") or 0)),
        }
        if not item["total"] and item["unit_price"]:
            item["total"] = int(round(item["unit_price"] * qty)) - item["discount"]
        out.append(item)
    return out


def extract_items_ai(image_path, mime: str = "image/jpeg", api_key: str = "",
                     model: str = "gemini-2.0-flash", timeout: int = 120) -> dict[str, Any]:
    """
    ساختار فاکتور را از خود تصویر می‌فهمد (نه از متن OCR).
    اگر کلید نباشد یا خطا بدهد، دیکشنری با ok=False برمی‌گردد.
    """
    import base64
    from pathlib import Path

    if not api_key:
        return {"ok": False, "error": "no_key", "message": "کلید موتور هوش مصنوعی تنظیم نشده است."}
    path = Path(image_path)
    if not path.is_file():
        return {"ok": False, "error": "no_file", "message": "فایل تصویر پیدا نشد."}

    try:
        import httpx
    except ImportError:                                     # pragma: no cover
        return {"ok": False, "error": "no_http", "message": "کتابخانهٔ httpx نصب نیست."}

    suffix = path.suffix.lower()
    if mime in ("", "application/octet-stream"):
        mime = {".png": "image/png", ".pdf": "application/pdf", ".jpg": "image/jpeg",
                ".jpeg": "image/jpeg", ".webp": "image/webp"}.get(suffix, "image/jpeg")
    try:
        data_b64 = base64.b64encode(path.read_bytes()).decode("ascii")
    except OSError as exc:
        return {"ok": False, "error": "read", "message": f"خواندن فایل ناموفق: {exc}"}

    body = {
        "contents": [{"parts": [
            {"text": AI_PROMPT},
            {"inline_data": {"mime_type": mime, "data": data_b64}},
        ]}],
        "generationConfig": {"temperature": 0.05, "maxOutputTokens": 8192,
                             "responseMimeType": "application/json"},
    }
    url = (f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent")
    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.post(url, params={"key": api_key}, json=body)
    except Exception as exc:                                # noqa: BLE001
        log.warning("ai items request failed: %s", type(exc).__name__)
        return {"ok": False, "error": "network", "message": "ارتباط با موتور هوش مصنوعی برقرار نشد."}

    if resp.status_code == 429:
        return {"ok": False, "error": "quota", "message": "سهمیهٔ رایگان موتور هوش مصنوعی تمام شده است."}
    if resp.status_code in (401, 403):
        return {"ok": False, "error": "auth", "message": "کلید موتور هوش مصنوعی معتبر نیست."}
    if resp.status_code >= 400:
        return {"ok": False, "error": f"http_{resp.status_code}",
                "message": f"موتور هوش مصنوعی خطا داد (کد {resp.status_code})."}

    try:
        payload = resp.json()
        text = "".join(
            part.get("text", "")
            for part in payload["candidates"][0]["content"]["parts"]
            if isinstance(part, dict)
        ).strip()
    except (KeyError, IndexError, TypeError, ValueError):
        return {"ok": False, "error": "shape", "message": "پاسخ موتور هوش مصنوعی قابل خواندن نبود."}

    text = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.MULTILINE).strip()
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return {"ok": False, "error": "json", "message": "خروجی موتور هوش مصنوعی JSON معتبر نبود."}

    items = _items_from_ai_payload(parsed)
    if not items:
        return {"ok": False, "error": "empty", "message": "موتور هوش مصنوعی هیچ قلمی پیدا نکرد."}

    totals = {
        "subtotal": _to_int(str(parsed.get("subtotal") or 0)) or sum(i["total"] for i in items),
        "items_sum": sum(i["total"] for i in items),
        "discount": _to_int(str(parsed.get("discount") or 0)),
        "tax": _to_int(str(parsed.get("tax") or 0)),
        "total": _to_int(str(parsed.get("total") or 0)),
    }
    totals["computed_total"] = totals["subtotal"] - totals["discount"] + totals["tax"]
    if not totals["total"]:
        totals["total"] = totals["computed_total"]

    issues = _find_issues(items, totals)
    return {
        "ok": True,
        "items": items,
        "totals": totals,
        "issues": issues,
        "confidence": _score(items, totals, issues),
        "engine": f"ai:{model}",
        "meta": {
            "seller": str(parsed.get("seller") or "")[:200],
            "buyer": str(parsed.get("buyer") or "")[:200],
            "number": str(parsed.get("number") or "")[:80],
            "date": str(parsed.get("date") or "")[:20],
            "currency": str(parsed.get("currency") or "IRR")[:8],
        },
    }


def fix_numbers(items: list[dict], totals: dict) -> tuple[list[dict], dict, list[str]]:
    """
    اعداد را اصلاح می‌کند: هر جا تعداد × قیمت با مبلغ کل نخواند،
    مبلغ کل را بازمحاسبه می‌کند. جمع‌ها هم از نو ساخته می‌شوند.
    خروجی: (اقلام اصلاح‌شده، جمع‌های اصلاح‌شده، فهرست تغییرات)
    """
    changes: list[str] = []
    fixed: list[dict] = []
    for idx, raw in enumerate(items, start=1):
        it = dict(raw)
        qty = float(it.get("qty") or 1)
        price = int(it.get("unit_price") or 0)
        disc = int(it.get("discount") or 0)
        total = int(it.get("total") or 0)
        if qty > 0 and price > 0:
            expect = int(round(qty * price)) - disc
            if not total or abs(expect - total) > max(1, abs(expect) * 0.01):
                if total:
                    it["original_total"] = total      # عدد چاپ‌شده حفظ می‌شود
                    changes.append(f"ردیف {idx}: مبلغ کل از {total:,} به {expect:,} اصلاح شد.")
                else:
                    changes.append(f"ردیف {idx}: مبلغ کل خالی بود؛ {expect:,} گذاشته شد.")
                it["total"] = expect
        it["qty"] = int(qty) if qty == int(qty) else qty
        fixed.append(it)

    items_sum = sum(int(i.get("total") or 0) for i in fixed)
    out_totals = dict(totals)
    out_totals["items_sum"] = items_sum
    if out_totals.get("subtotal") and abs(int(out_totals["subtotal"]) - items_sum) > max(1, items_sum * 0.01):
        changes.append(f"جمع اقلام از {int(out_totals['subtotal']):,} به {items_sum:,} اصلاح شد.")
        out_totals["subtotal"] = items_sum
    elif not out_totals.get("subtotal"):
        out_totals["subtotal"] = items_sum
    computed = int(out_totals["subtotal"]) - int(out_totals.get("discount") or 0) + int(out_totals.get("tax") or 0)
    out_totals["computed_total"] = computed
    if int(out_totals.get("total") or 0) != computed:
        if out_totals.get("total"):
            changes.append(f"مبلغ کل از {int(out_totals['total']):,} به {computed:,} اصلاح شد.")
        out_totals["total"] = computed
    return fixed, out_totals, changes
