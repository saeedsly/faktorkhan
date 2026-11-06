"""منطق کسب‌وکار فاکتور.

قواعد اصلی:
* فاکتور دستی: ابتدا پیش‌نویس (قابل ویرایش)، سپس صدور. شماره و تاریخ هنگام صدور ثبت می‌شوند.
* فاکتور سیستمی: با یک عملیات صادر می‌شود؛ شماره و تاریخ امروز خودکار تعیین می‌شوند و
  بعد از صدور قابل ویرایش نیست.
* شماره‌ها در همان تراکنش صدور گرفته می‌شوند؛ اگر صدور شکست بخورد، شماره سوخته نمی‌شود.
* فاکتور صادرشده فقط با ابطال (با ذکر دلیل) تغییر وضعیت می‌دهد؛ شماره‌اش دوباره استفاده نمی‌شود.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import date
from typing import Callable, Iterable

from . import clock
from .db import Database
from .errors import InvoiceStateError, ValidationError
from .jalali import to_jalali
from .models import DRAFT, ISSUED, MANUAL, SYSTEM, Invoice, LineItem
from .money import InvoiceTotals, add_invoice_totals, calc_line, sum_totals

MAX_ITEMS = 500


@dataclass(frozen=True)
class KindSummary:
    kind: str
    count: int
    totals: InvoiceTotals


class InvoiceService:
    def __init__(self, db: Database, today: Callable[[], date] = clock.today):
        self.db = db
        self._today = today

    @property
    def today(self) -> date:
        return self._today()

    # ----- اعتبارسنجی و محاسبه -----
    def _prepare(self, inv: Invoice) -> None:
        """اعتبارسنجی سرآیند و ردیف‌ها، محاسبه‌ی مبالغ و تنظیم شماره ردیف‌ها."""
        name = (inv.customer_name or "").strip()
        if not name:
            raise ValidationError("نام مشتری الزامی است.")
        inv.customer_name = name
        if not inv.items:
            raise ValidationError("فاکتور باید حداقل یک ردیف داشته باشد.")
        if len(inv.items) > MAX_ITEMS:
            raise ValidationError(f"حداکثر تعداد ردیف‌ها {MAX_ITEMS} است.")

        prepared: list[LineItem] = []
        for index, item in enumerate(inv.items, start=1):
            description = (item.description or "").strip()
            if not description:
                raise ValidationError(f"شرح ردیف {index} خالی است.")
            try:
                totals = calc_line(
                    item.quantity, item.unit_price, item.discount, item.vat_rate,
                )
            except ValidationError as exc:
                raise ValidationError(f"ردیف {index}: {exc}") from exc
            prepared.append(replace(item, description=description, position=index, totals=totals))

        inv.items = prepared
        inv.totals = sum_totals(item.totals for item in prepared if item.totals is not None)

    def _load(self, invoice_id: int) -> Invoice:
        inv = self.db.get_invoice(invoice_id)
        if inv is None:
            raise ValidationError("فاکتور پیدا نشد.")
        return inv

    def _require_manual_draft(self, inv: Invoice) -> None:
        if inv.kind != MANUAL:
            raise InvoiceStateError("فاکتور سیستمی قابل ویرایش نیست.")
        if inv.status != DRAFT:
            raise InvoiceStateError("فاکتور صادرشده قابل ویرایش نیست.")

    def _check_issue_date(self, issue: date) -> None:
        if issue > self.today:
            raise ValidationError("تاریخ صدور نمی‌تواند در آینده باشد.")

    # ----- عملیات عمومی -----
    def save_manual_draft(self, inv: Invoice) -> Invoice:
        """ایجاد یا به‌روزرسانی پیش‌نویس فاکتور دستی (بدون شماره)."""
        if inv.kind != MANUAL:
            raise InvoiceStateError("فاکتور سیستمی قابل ویرایش نیست.")
        if inv.id is not None:
            self._require_manual_draft(self._load(inv.id))
        inv.status = DRAFT
        self._prepare(inv)
        with self.db.transaction():
            return self.db.save_invoice_draft(inv)

    def issue_manual(self, invoice_id: int, issue_date: date | None = None) -> Invoice:
        """صدور پیش‌نویس فاکتور دستی؛ شماره فقط همین‌جا گرفته می‌شود."""
        inv = self._load(invoice_id)
        self._require_manual_draft(inv)
        issue = issue_date or inv.issue_date or self.today
        self._check_issue_date(issue)
        self._prepare(inv)  # خطاها قبل از گرفتن شماره رخ می‌دهند
        inv.issue_date = issue
        return self._issue(inv, issue)

    def issue_system(
        self,
        customer_name: str,
        items: Iterable[LineItem],
        *,
        customer_id: int | None = None,
        customer_national_id: str = "",
        notes: str = "",
    ) -> Invoice:
        """صدور فوری فاکتور سیستمی با شماره و تاریخ خودکار."""
        issue = self.today
        inv = Invoice(
            kind=SYSTEM,
            status=DRAFT,
            customer_name=customer_name,
            customer_id=customer_id,
            customer_national_id=customer_national_id,
            notes=notes,
            items=list(items),
            issue_date=issue,
            created_at=clock.now_iso(),
        )
        self._prepare(inv)
        return self._issue(inv, issue)

    def _issue(self, inv: Invoice, issue: date) -> Invoice:
        with self.db.transaction():
            number = self.db.next_number(inv.kind, to_jalali(issue).year)
            saved = self.db.save_invoice_draft(inv)
            assert saved.id is not None
            self.db.mark_issued(saved.id, number, issue, clock.now_iso())
        result = self._load(saved.id)
        assert result.status == ISSUED and result.number == number
        return result

    def cancel(self, invoice_id: int, reason: str) -> Invoice:
        inv = self._load(invoice_id)
        if inv.status != ISSUED:
            raise InvoiceStateError("فقط فاکتور صادرشده قابل ابطال است.")
        reason = (reason or "").strip()
        if not reason:
            raise ValidationError("دلیل ابطال الزامی است.")
        with self.db.transaction():
            self.db.cancel_invoice(invoice_id, reason)
        return self._load(invoice_id)

    def delete_draft(self, invoice_id: int) -> None:
        inv = self._load(invoice_id)
        if inv.status != DRAFT:
            raise InvoiceStateError("فقط پیش‌نویس قابل حذف است.")
        with self.db.transaction():
            self.db.delete_draft_invoice(invoice_id)

    # ----- گزارش -----
    def summary(self, start: date, end: date) -> list[KindSummary]:
        """جمع فاکتورهای صادرشده (ابطال‌شده‌ها حذف می‌شوند) به تفکیک نوع."""
        if start > end:
            raise ValidationError("تاریخ شروع نباید بعد از تاریخ پایان باشد.")
        invoices = self.db.issued_between(start, end)
        result: list[KindSummary] = []
        for kind in (MANUAL, SYSTEM):
            group = [inv.totals for inv in invoices if inv.kind == kind and inv.totals is not None]
            result.append(KindSummary(kind=kind, count=len(group), totals=add_invoice_totals(group)))
        return result


