import sqlite3
from datetime import date
from decimal import Decimal

import pytest

from faktorkhan.db import Database
from faktorkhan.errors import InvoiceStateError, ValidationError
from faktorkhan.models import CANCELLED, DRAFT, ISSUED, MANUAL, SYSTEM, Customer, Invoice, LineItem
from faktorkhan.service import InvoiceService

TODAY = date(2026, 11, 7)


@pytest.fixture
def db(tmp_path):
    database = Database(tmp_path / "test.db")
    yield database
    database.close()


@pytest.fixture
def service(db):
    return InvoiceService(db, today=lambda: TODAY)


def line(desc="کالا", qty="2", price="100000", disc="0", vat="9"):
    return LineItem(description=desc, quantity=Decimal(qty), unit_price=Decimal(price),
                    discount=Decimal(disc), vat_rate=Decimal(vat), unit="عدد")


def manual(items=None, name="علی رضایی", issue=None):
    return Invoice(kind=MANUAL, customer_name=name, items=[line()] if items is None else items, issue_date=issue)


def test_manual_draft_has_no_number_and_is_editable(service):
    draft = service.save_manual_draft(manual())
    assert draft.status == DRAFT and draft.number is None
    assert draft.totals.total == Decimal("218000")
    draft.items = [line(qty="3")]
    updated = service.save_manual_draft(draft)
    assert updated.id == draft.id
    assert updated.totals.total == Decimal("327000")
    assert len(updated.items) == 1


def test_issue_manual_assigns_sequential_numbers_without_gaps(service):
    a = service.issue_manual(service.save_manual_draft(manual()).id, date(2026, 11, 1))
    b = service.issue_manual(service.save_manual_draft(manual()).id, date(2026, 11, 2))
    assert a.number == "M-1405-0001"
    assert b.number == "M-1405-0002"
    assert a.status == ISSUED and a.issue_date == date(2026, 11, 1)


def test_failed_issue_does_not_consume_number(service):
    draft = service.save_manual_draft(manual())
    # پیش‌نویس معتبر است؛ صدور با تاریخ آینده باید شکست بخورد بدون سوزاندن شماره
    with pytest.raises(ValidationError):
        service.issue_manual(draft.id, date(2026, 12, 1))
    issued = service.issue_manual(draft.id, date(2026, 11, 3))
    assert issued.number == "M-1405-0001"


def test_system_invoice_is_auto_issued_and_locked(service, db):
    inv = service.issue_system("مشتری نقدی", [line()])
    assert inv.kind == SYSTEM and inv.status == ISSUED
    assert inv.number == "S-1405-0001"
    assert inv.issue_date == TODAY
    with pytest.raises(InvoiceStateError):
        service.save_manual_draft(inv)  # سیستمی قابل ویرایش نیست
    with pytest.raises(sqlite3.IntegrityError):
        db.conn.execute("UPDATE invoices SET notes='x' WHERE id=?", (inv.id,))
    with pytest.raises(sqlite3.IntegrityError):
        db.conn.execute("DELETE FROM invoices WHERE id=?", (inv.id,))


def test_issued_items_cannot_be_changed_directly_in_db(service, db):
    inv = service.issue_manual(service.save_manual_draft(manual()).id, TODAY)
    with pytest.raises(sqlite3.IntegrityError):
        db.conn.execute(
            "INSERT INTO invoice_items(invoice_id, position, description, quantity, unit_price, "
            "vat_rate, gross, taxable, vat, total) VALUES(?, 9, 'x', '1', '1', '0', '1', '1', '0', '1')",
            (inv.id,),
        )


def test_issued_invoice_cannot_be_edited_or_deleted_via_service(service):
    issued = service.issue_manual(service.save_manual_draft(manual()).id, TODAY)
    with pytest.raises(InvoiceStateError):
        service.save_manual_draft(issued)
    with pytest.raises(InvoiceStateError):
        service.issue_manual(issued.id, TODAY)
    with pytest.raises(InvoiceStateError):
        service.delete_draft(issued.id)


def test_cancel_requires_reason_and_keeps_number_reserved(service):
    inv = service.issue_manual(service.save_manual_draft(manual()).id, TODAY)
    with pytest.raises(ValidationError):
        service.cancel(inv.id, "   ")
    cancelled = service.cancel(inv.id, "اشتباه در مبلغ")
    assert cancelled.status == CANCELLED and cancelled.cancel_reason == "اشتباه در مبلغ"
    assert cancelled.number == "M-1405-0001"
    nxt = service.issue_manual(service.save_manual_draft(manual()).id, TODAY)
    assert nxt.number == "M-1405-0002"


def test_cancelled_invoice_is_immutable(service, db):
    inv = service.issue_system("x", [line()])
    service.cancel(inv.id, "خطا")
    with pytest.raises(sqlite3.IntegrityError):
        db.conn.execute("UPDATE invoices SET cancel_reason='changed' WHERE id=?", (inv.id,))


def test_delete_draft_only(service):
    draft = service.save_manual_draft(manual())
    service.delete_draft(draft.id)
    assert service.db.get_invoice(draft.id) is None


def test_validation_errors_are_user_friendly(service):
    with pytest.raises(ValidationError, match="نام مشتری"):
        service.save_manual_draft(manual(name="  "))
    with pytest.raises(ValidationError, match="حداقل یک ردیف"):
        service.save_manual_draft(manual(items=[]))
    with pytest.raises(ValidationError, match="ردیف 2"):
        service.save_manual_draft(manual(items=[line(), line(qty="0")]))
    with pytest.raises(ValidationError, match="تخفیف"):
        service.save_manual_draft(manual(items=[line(price="1000", disc="5000")]))


def test_customer_snapshot_is_kept_after_customer_changes(service, db):
    cid = db.save_customer(Customer(name="شرکت آلفا", national_id="1234"))
    inv = service.issue_system("شرکت آلفا", [line()], customer_id=cid, customer_national_id="1234")
    with db.transaction():
        db.save_customer(Customer(id=cid, name="نام جدید", national_id="9999"))
    again = db.get_invoice(inv.id)
    assert again.customer_name == "شرکت آلفا" and again.customer_national_id == "1234"


def test_summary_excludes_drafts_and_cancelled(service):
    a = service.issue_manual(service.save_manual_draft(manual()).id, TODAY)   # 218,000
    service.issue_system("نقدی", [line(qty="1")])                              # 109,000
    cancelled = service.issue_system("ابطالی", [line(qty="10")])
    service.cancel(cancelled.id, "تست")
    service.save_manual_draft(manual(items=[line(qty="50")]))                   # پیش‌نویس
    result = {s.kind: s for s in service.summary(date(2026, 11, 1), date(2026, 11, 30))}
    assert result[MANUAL].count == 1
    assert result[MANUAL].totals.total == a.totals.total == Decimal("218000")
    assert result[SYSTEM].count == 1
    assert result[SYSTEM].totals.total == Decimal("109000")


def test_summary_rejects_reversed_range(service):
    with pytest.raises(ValidationError):
        service.summary(date(2026, 11, 30), date(2026, 11, 1))


def test_totals_stored_match_recalculation(service):
    inv = service.issue_manual(
        service.save_manual_draft(manual(items=[
            line("الف", "1.5", "333333", "1000", "9"),
            line("ب", "7", "12345", "0", "10"),
        ])).id,
        TODAY,
    )
    assert sum(i.totals.total for i in inv.items) == inv.totals.total
    assert sum(i.totals.vat for i in inv.items) == inv.totals.vat
