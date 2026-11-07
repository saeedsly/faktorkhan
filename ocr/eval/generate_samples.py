"""تولید فاکتورهای ساختگی با جواب درست (ground truth) برای سنجش دقت OCR.

خروجی: eval/samples/inv_XXX.png و eval/samples/truth.json
فاکتورها با همان سرویس و قالب خود برنامه ساخته می‌شوند، پس جواب درست دقیق است.
تصاویر دو برابر بزرگ‌تر رندر می‌شوند تا کیفیت شبیه اسکن ۳۰۰ dpi باشد.

اجرا (از ریشه‌ی ریپو):  LD_LIBRARY_PATH=... python ocr/eval/generate_samples.py [تعداد]
"""

from __future__ import annotations

import json
import os
import random
import sys
import tempfile
from datetime import date
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from PySide6.QtCore import QSizeF, Qt  # noqa: E402
from PySide6.QtGui import QColor, QImage, QPainter, QTextDocument, QTextOption  # noqa: E402
from PySide6.QtWidgets import QApplication  # noqa: E402

from faktorkhan.db import Database  # noqa: E402
from faktorkhan.fa import to_persian_digits  # noqa: E402
from faktorkhan.jalali import format_jalali, to_jalali  # noqa: E402
from faktorkhan.models import MANUAL, Invoice, LineItem  # noqa: E402
from faktorkhan.pdf import build_invoice_html  # noqa: E402
from faktorkhan.service import InvoiceService  # noqa: E402

PRODUCTS = [
    "برنج ایرانی طارم", "روغن مایع آفتابگردان", "قند حبه", "چای لاهیجان", "نبات چوبی",
    "شیر پاستوریزه", "ماست پرچرب", "پنیر سفید", "عدس پلویی", "لوبیا چیتی",
    "صابون مایع", "شامپو بچه", "خمیر دندان", "دستمال کاغذی", "کنسرو ماهی",
    "سس گوجه", "ترخون خشک", "زعفران سرگل", "خرما مضافتی", "گردو خردشده",
]
CUSTOMERS = ["علی رضایی", "شرکت آلفا تجارت", "مریم احمدی", "فروشگاه نور", "حسین کریمی"]


def render_png(html: str, path: Path, width: int = 1000, scale: int = 2) -> None:
    doc = QTextDocument()
    option = QTextOption()
    option.setTextDirection(Qt.LayoutDirection.RightToLeft)
    doc.setDefaultTextOption(option)
    doc.setHtml(html)
    doc.setPageSize(QSizeF(width, 1400))
    height = int(doc.size().height()) + 40
    img = QImage(width * scale, height * scale, QImage.Format.Format_RGB32)
    img.fill(QColor("white"))
    painter = QPainter(img)
    painter.scale(scale, scale)
    doc.drawContents(painter)
    painter.end()
    img.save(str(path))


def main(count: int) -> None:
    app = QApplication.instance() or QApplication([])  # noqa: F841
    out_dir = Path(__file__).resolve().parent / "samples"
    out_dir.mkdir(parents=True, exist_ok=True)
    rng = random.Random(1405)
    company = {"company_name": "فروشگاه نمونه", "company_national_id": "14001234567",
               "company_address": "تهران، خیابان ولیعصر"}
    truth = []
    with tempfile.TemporaryDirectory() as tmp:
        db = Database(Path(tmp) / "gen.db")
        svc = InvoiceService(db, today=lambda: date(2026, 11, 7))
        for n in range(1, count + 1):
            items = []
            for _ in range(rng.randint(1, 4)):
                qty = rng.randint(1, 20)
                price = rng.randint(5, 900) * 1000
                gross = qty * price
                disc = rng.choice([0, 0, rng.randint(1, gross // 1000) * 1000]) if gross >= 1000 else 0
                items.append(LineItem(
                    description=rng.choice(PRODUCTS), unit=rng.choice(["عدد", "کیلو", "بسته"]),
                    quantity=Decimal(qty), unit_price=Decimal(price),
                    discount=Decimal(disc), vat_rate=Decimal(9),
                ))
            day = date(2026, 1, 1).toordinal() + rng.randint(0, 280)
            issue = date.fromordinal(day)
            draft = svc.save_manual_draft(Invoice(kind=MANUAL, customer_name=rng.choice(CUSTOMERS), items=items))
            inv = svc.issue_manual(draft.id, issue)
            t = inv.totals
            numbers = set()
            for it in inv.items:
                numbers.update([int(it.quantity), int(it.unit_price), int(it.discount), int(it.totals.total)])
            numbers.update([int(t.subtotal), int(t.discount), int(t.taxable), int(t.vat), int(t.total)])
            name = f"inv_{n:03d}.png"
            render_png(build_invoice_html(inv, company), out_dir / name)
            truth.append({
                "file": name,
                "invoice_number": inv.number,
                "issue_date": format_jalali(inv.issue_date, persian=False),
                "subtotal": int(t.subtotal), "discount": int(t.discount),
                "taxable": int(t.taxable), "vat": int(t.vat), "total": int(t.total),
                "items": [it.description for it in inv.items],
                "numbers": sorted(numbers),
            })
        db.close()
    (out_dir / "truth.json").write_text(json.dumps(truth, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{count} نمونه در {out_dir} ساخته شد.")


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 30)
