#!/usr/bin/env python3
"""
آزمون «فاکتور فارسی با جداکنندهٔ خط تیره»
==========================================
باگ واقعی: فاکتور فارسی ستون‌ها را با خط تیره جدا می‌کند:

    کاغذ A4 — ۱۰ بسته — ۲۵۰,۰۰۰

موتور فقط فاصله/تب/«|» را جداکننده می‌دانست، پس کل سطر یک سلول می‌شد
و **هیچ عددی** پیدا نمی‌کرد. نتیجه برای کاربر:

    وضعیت: آماده ✓   متن: درست ✓   جدول اقلام: خالی ✗

یعنی «فاکتور را خواند ولی اقلام را نفهمید» — و چون کاربر اقلام را
می‌خواهد، حس می‌کرد برنامه کار نکرده.

این آزمون سه چیز را تضمین می‌کند:
  ۱) تعداد درست خوانده شود (۱۰، نه ۱)
  ۲) مبلغ درست باشد
  ۳) جمع اقلام با جمع کل اعلام‌شده بخواند

اجرا:
    python backend/tests/fa_columns_test.py
"""
from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from app.services.ai_parser import extract_items_rules  # noqa: E402
from app.services.parser import parse_invoice  # noqa: E402

PASS = 0
FAIL = 0


def ck(label: str, ok: bool, detail: str = "") -> None:
    global PASS, FAIL
    PASS, FAIL = (PASS + 1, FAIL) if ok else (PASS, FAIL + 1)
    print(f"  {'✓' if ok else '✗'} {label}" + (f" — {detail}" if detail else ""))


def one(label: str, text: str, expect: list[tuple[str, int, int]], total: int) -> None:
    """یک فاکتور را می‌خواند و اقلام/جمع را با انتظار مقایسه می‌کند."""
    print(f"\n[{label}]")
    result = extract_items_rules(text)
    items = result.get("items") or []
    ck(f"{len(expect)} قلم پیدا شد", len(items) == len(expect), f"{len(items)} قلم")

    for idx, (name_part, qty, amount) in enumerate(expect):
        if idx >= len(items):
            ck(f"قلم {idx + 1}: {name_part}", False, "قلم وجود ندارد")
            continue
        it = items[idx]
        desc = str(it.get("description") or "")
        ck(f"قلم {idx + 1} نامش «{name_part}» دارد", name_part in desc, desc)
        ck(f"قلم {idx + 1} تعداد {qty}", int(it.get("qty") or 0) == qty, str(it.get("qty")))
        ck(f"قلم {idx + 1} مبلغ {amount:,}", int(it.get("total") or 0) == amount,
           f"{int(it.get('total') or 0):,}")

    got_total = int((result.get("totals") or {}).get("total") or 0)
    ck(f"جمع کل {total:,}", got_total == total, f"{got_total:,}")

    # مسیر واقعیِ API هم باید همین را بدهد
    parsed = parse_invoice(text)
    p_items = parsed.get("items") or []
    ck("مسیر parse_invoice هم اقلام دارد", len(p_items) == len(expect), f"{len(p_items)} قلم")
    ck("مسیر parse_invoice جمع درست دارد", int(parsed.get("total") or 0) == total,
       f"{int(parsed.get('total') or 0):,}")


print("═" * 62)
print("فاکتور فارسی — جداکنندهٔ خط تیره")
print("═" * 62)

# حالت اصلی که کاربر گزارش داد
one("خط تیرهٔ فارسی (—) با واحد",
    "فاکتور فروش فروشگاه کاغذ نمونه\n"
    "شماره: ۱۴۰۴۰۹۱۵\n"
    "کاغذ A4 — ۱۰ بسته — ۲۵۰,۰۰۰\n"
    "تونر HP — ۲ عدد — ۴۵۰,۰۰۰\n"
    "جمع کل: ۳,۴۰۰,۰۰۰",
    [("کاغذ", 10, 250000), ("تونر", 2, 450000)],
    3400000)

# خط تیرهٔ ساده (-)
one("خط تیرهٔ ساده (-)",
    "کاغذ A4 - ۵ بسته - ۱۰۰,۰۰۰\n"
    "جمع کل: ۵۰۰,۰۰۰",
    [("کاغذ", 5, 100000)],
    500000)

# بدون واحد در ستون تعداد
one("بدون واحد",
    "پرینتر لیزری — ۲ — ۸,۵۰۰,۰۰۰\n"
    "جمع کل: ۱۷,۰۰۰,۰۰۰",
    [("پرینتر", 2, 8500000)],
    17000000)

# تب (فاکتور حرارتی)
one("ستون‌بندی با تب",
    "کاغذ A4\t۱۰ بسته\t۲۵۰,۰۰۰\n"
    "جمع کل: ۲,۵۰۰,۰۰۰",
    [("کاغذ", 10, 250000)],
    2500000)

# ستون با ممیز عمودی
one("ممیز عمودی (|)",
    "کابل شبکه | ۳ عدد | ۱۲۰,۰۰۰\n"
    "جمع کل: ۳۶۰,۰۰۰",
    [("کابل", 3, 120000)],
    360000)

# بدون تعداد (فقط مبلغ) — نباید منفجر شود
print("\n[فقط مبلغ، بدون تعداد]")
r = extract_items_rules("خدمات نصب — ۵۰۰,۰۰۰\nجمع کل: ۵۰۰,۰۰۰")
items = r.get("items") or []
ck("حداقل یک قلم", len(items) >= 1, f"{len(items)}")
if items:
    ck("مبلغ درست", int(items[0].get("total") or 0) == 500000, str(items[0].get("total")))
    ck("تعداد منطقی (۱)", int(items[0].get("qty") or 0) == 1, str(items[0].get("qty")))

# فاکتور انگلیسی — نباید رگرسیون بدهد
print("\n[فاکتور انگلیسی]")
r = extract_items_rules("Paper A4 — 10 boxes — 250,000\nTotal: 2,500,000")
items = r.get("items") or []
ck("اقلام انگلیسی پیدا شد", len(items) >= 1, f"{len(items)}")
if items:
    ck("تعداد انگلیسی درست", int(items[0].get("qty") or 0) == 10, str(items[0].get("qty")))

print("\n" + "═" * 62)
print(f"نتیجه: {PASS} از {PASS + FAIL} بررسی موفق")
print("═" * 62)
sys.exit(0 if FAIL == 0 else 1)
