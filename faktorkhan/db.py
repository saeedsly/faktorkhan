"""لایه‌ی ذخیره‌سازی SQLite.

* مبالغ و تعدادها به‌صورت متن (TEXT) ذخیره می‌شوند تا دقت Decimal از دست نرود.
* شماره فاکتور فقط داخل تراکنش صدور و بدون شکاف تولید می‌شود.
* triggerها تضمین می‌کنند فاکتور صادرشده/ابطال‌شده و اقلام آن قابل تغییر نیستند.
"""

from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Iterator

from .clock import now_iso
from .errors import ValidationError
from .models import (
    CANCELLED,
    DRAFT,
    ISSUED,
    NUMBER_PREFIX,
    Customer,
    Invoice,
    LineItem,
    Product,
)
from .money import InvoiceTotals, LineTotals

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS customers (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    phone         TEXT NOT NULL DEFAULT '',
    address       TEXT NOT NULL DEFAULT '',
    national_id   TEXT NOT NULL DEFAULT '',
    economic_code TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS products (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    code       TEXT NOT NULL DEFAULT '',
    name       TEXT NOT NULL,
    unit       TEXT NOT NULL DEFAULT '',
    unit_price TEXT NOT NULL DEFAULT '0',
    vat_rate   TEXT NOT NULL DEFAULT '9'
);

CREATE TABLE IF NOT EXISTS numbering (
    series     TEXT PRIMARY KEY,
    last_value INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS invoices (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    kind                 TEXT NOT NULL CHECK (kind IN ('manual', 'system')),
    status               TEXT NOT NULL CHECK (status IN ('draft', 'issued', 'cancelled')),
    number               TEXT UNIQUE,
    issue_date           TEXT,
    customer_id          INTEGER REFERENCES customers(id) ON DELETE SET NULL,
    customer_name        TEXT NOT NULL DEFAULT '',
    customer_national_id TEXT NOT NULL DEFAULT '',
    notes                TEXT NOT NULL DEFAULT '',
    subtotal             TEXT NOT NULL DEFAULT '0',
    discount_total       TEXT NOT NULL DEFAULT '0',
    taxable_total        TEXT NOT NULL DEFAULT '0',
    vat_total            TEXT NOT NULL DEFAULT '0',
    total                TEXT NOT NULL DEFAULT '0',
    created_at           TEXT NOT NULL,
    issued_at            TEXT,
    cancel_reason        TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS invoice_items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id  INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    position    INTEGER NOT NULL,
    product_id  INTEGER REFERENCES products(id) ON DELETE SET NULL,
    description TEXT NOT NULL,
    unit        TEXT NOT NULL DEFAULT '',
    quantity    TEXT NOT NULL,
    unit_price  TEXT NOT NULL,
    discount    TEXT NOT NULL DEFAULT '0',
    vat_rate    TEXT NOT NULL,
    gross       TEXT NOT NULL,
    taxable     TEXT NOT NULL,
    vat         TEXT NOT NULL,
    total       TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS trg_invoice_locked_update
BEFORE UPDATE ON invoices
WHEN OLD.status <> 'draft' AND NOT (OLD.status = 'issued' AND NEW.status = 'cancelled')
BEGIN
    SELECT RAISE(ABORT, 'فاکتور صادرشده قابل ویرایش نیست');
END;

CREATE TRIGGER IF NOT EXISTS trg_invoice_locked_delete
BEFORE DELETE ON invoices
WHEN OLD.status <> 'draft'
BEGIN
    SELECT RAISE(ABORT, 'فقط پیش‌نویس قابل حذف است');
END;

CREATE TRIGGER IF NOT EXISTS trg_items_locked_insert
BEFORE INSERT ON invoice_items
WHEN (SELECT status FROM invoices WHERE id = NEW.invoice_id) <> 'draft'
BEGIN
    SELECT RAISE(ABORT, 'اقلام فاکتور صادرشده قابل تغییر نیست');
END;

CREATE TRIGGER IF NOT EXISTS trg_items_locked_delete
BEFORE DELETE ON invoice_items
WHEN (SELECT status FROM invoices WHERE id = OLD.invoice_id) <> 'draft'
BEGIN
    SELECT RAISE(ABORT, 'اقلام فاکتور صادرشده قابل تغییر نیست');
END;
"""


def _dec(value: str | None) -> Decimal:
    return Decimal(value) if value not in (None, "") else Decimal(0)


class Database:
    def __init__(self, path: str | Path):
        self.path = str(path)
        # isolation_level=None: تراکنش‌ها را خودمان با BEGIN IMMEDIATE کنترل می‌کنیم.
        self.conn = sqlite3.connect(self.path, isolation_level=None)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys = ON")
        self.conn.executescript(SCHEMA)

    def close(self) -> None:
        self.conn.close()

    @contextmanager
    def transaction(self) -> Iterator[None]:
        self.conn.execute("BEGIN IMMEDIATE")
        try:
            yield
        except BaseException:
            self.conn.execute("ROLLBACK")
            raise
        else:
            self.conn.execute("COMMIT")

    # ----- تنظیمات -----
    def get_setting(self, key: str, default: str = "") -> str:
        row = self.conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
        return row["value"] if row else default

    def set_setting(self, key: str, value: str) -> None:
        self.conn.execute(
            "INSERT INTO settings(key, value) VALUES(?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )

    # ----- مشتریان -----
    def list_customers(self) -> list[Customer]:
        rows = self.conn.execute("SELECT * FROM customers ORDER BY name, id").fetchall()
        return [
            Customer(
                id=r["id"], name=r["name"], phone=r["phone"], address=r["address"],
                national_id=r["national_id"], economic_code=r["economic_code"],
            )
            for r in rows
        ]

    def save_customer(self, c: Customer) -> int:
        if c.id is None:
            cur = self.conn.execute(
                "INSERT INTO customers(name, phone, address, national_id, economic_code) "
                "VALUES(?, ?, ?, ?, ?)",
                (c.name, c.phone, c.address, c.national_id, c.economic_code),
            )
            return int(cur.lastrowid)
        self.conn.execute(
            "UPDATE customers SET name=?, phone=?, address=?, national_id=?, economic_code=? "
            "WHERE id=?",
            (c.name, c.phone, c.address, c.national_id, c.economic_code, c.id),
        )
        return c.id

    def delete_customer(self, customer_id: int) -> None:
        self.conn.execute("DELETE FROM customers WHERE id = ?", (customer_id,))

    # ----- کالا و خدمات -----
    def list_products(self) -> list[Product]:
        rows = self.conn.execute("SELECT * FROM products ORDER BY name, id").fetchall()
        return [
            Product(
                id=r["id"], code=r["code"], name=r["name"], unit=r["unit"],
                unit_price=_dec(r["unit_price"]), vat_rate=_dec(r["vat_rate"]),
            )
            for r in rows
        ]

    def save_product(self, p: Product) -> int:
        if p.id is None:
            cur = self.conn.execute(
                "INSERT INTO products(code, name, unit, unit_price, vat_rate) VALUES(?, ?, ?, ?, ?)",
                (p.code, p.name, p.unit, str(p.unit_price), str(p.vat_rate)),
            )
            return int(cur.lastrowid)
        self.conn.execute(
            "UPDATE products SET code=?, name=?, unit=?, unit_price=?, vat_rate=? WHERE id=?",
            (p.code, p.name, p.unit, str(p.unit_price), str(p.vat_rate), p.id),
        )
        return p.id

    def delete_product(self, product_id: int) -> None:
        self.conn.execute("DELETE FROM products WHERE id = ?", (product_id,))

    # ----- شماره‌گذاری -----
    def next_number(self, kind: str, jalali_year: int) -> str:
        """شماره بعدی فاکتور. باید داخل transaction فراخوانی شود."""
        series = f"{kind}-{jalali_year}"
        self.conn.execute(
            "INSERT INTO numbering(series, last_value) VALUES(?, 0) ON CONFLICT(series) DO NOTHING",
            (series,),
        )
        self.conn.execute("UPDATE numbering SET last_value = last_value + 1 WHERE series = ?", (series,))
        seq = self.conn.execute(
            "SELECT last_value FROM numbering WHERE series = ?", (series,)
        ).fetchone()["last_value"]
        return f"{NUMBER_PREFIX[kind]}-{jalali_year}-{seq:04d}"

    # ----- فاکتورها -----
    def _row_to_item(self, r: sqlite3.Row) -> LineItem:
        return LineItem(
            id=r["id"],
            position=r["position"],
            product_id=r["product_id"],
            description=r["description"],
            unit=r["unit"],
            quantity=_dec(r["quantity"]),
            unit_price=_dec(r["unit_price"]),
            discount=_dec(r["discount"]),
            vat_rate=_dec(r["vat_rate"]),
            totals=LineTotals(
                gross=_dec(r["gross"]),
                discount=_dec(r["discount"]),
                taxable=_dec(r["taxable"]),
                vat=_dec(r["vat"]),
                total=_dec(r["total"]),
            ),
        )

    def _row_to_invoice(self, h: sqlite3.Row, items: list[LineItem]) -> Invoice:
        return Invoice(
            id=h["id"],
            kind=h["kind"],
            status=h["status"],
            number=h["number"],
            issue_date=date.fromisoformat(h["issue_date"]) if h["issue_date"] else None,
            customer_id=h["customer_id"],
            customer_name=h["customer_name"],
            customer_national_id=h["customer_national_id"],
            notes=h["notes"],
            items=items,
            totals=InvoiceTotals(
                subtotal=_dec(h["subtotal"]),
                discount=_dec(h["discount_total"]),
                taxable=_dec(h["taxable_total"]),
                vat=_dec(h["vat_total"]),
                total=_dec(h["total"]),
            ),
            created_at=h["created_at"],
            issued_at=h["issued_at"] or "",
            cancel_reason=h["cancel_reason"],
        )

    def get_invoice(self, invoice_id: int) -> Invoice | None:
        h = self.conn.execute("SELECT * FROM invoices WHERE id = ?", (invoice_id,)).fetchone()
        if h is None:
            return None
        rows = self.conn.execute(
            "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY position", (invoice_id,)
        ).fetchall()
        return self._row_to_invoice(h, [self._row_to_item(r) for r in rows])

    def list_invoices(self) -> list[Invoice]:
        rows = self.conn.execute("SELECT * FROM invoices ORDER BY id DESC").fetchall()
        return [self._row_to_invoice(h, []) for h in rows]

    def issued_between(self, start: date, end: date) -> list[Invoice]:
        rows = self.conn.execute(
            "SELECT * FROM invoices WHERE status = ? AND issue_date BETWEEN ? AND ?",
            (ISSUED, start.isoformat(), end.isoformat()),
        ).fetchall()
        return [self._row_to_invoice(h, []) for h in rows]

    def save_invoice_draft(self, inv: Invoice) -> Invoice:
        """ذخیره‌ی سرآیند و اقلام یک فاکتور پیش‌نویس (ایجاد یا به‌روزرسانی)."""
        if inv.totals is None:
            raise ValidationError("جمع فاکتور محاسبه نشده است.")
        t = inv.totals
        issue_date = inv.issue_date.isoformat() if inv.issue_date else None
        if inv.id is None:
            cur = self.conn.execute(
                "INSERT INTO invoices(kind, status, issue_date, customer_id, customer_name, "
                "customer_national_id, notes, subtotal, discount_total, taxable_total, vat_total, "
                "total, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    inv.kind, DRAFT, issue_date, inv.customer_id, inv.customer_name,
                    inv.customer_national_id, inv.notes, str(t.subtotal), str(t.discount),
                    str(t.taxable), str(t.vat), str(t.total), inv.created_at or now_iso(),
                ),
            )
            inv.id = int(cur.lastrowid)
        else:
            self.conn.execute(
                "UPDATE invoices SET issue_date=?, customer_id=?, customer_name=?, "
                "customer_national_id=?, notes=?, subtotal=?, discount_total=?, taxable_total=?, "
                "vat_total=?, total=? WHERE id=?",
                (
                    issue_date, inv.customer_id, inv.customer_name, inv.customer_national_id,
                    inv.notes, str(t.subtotal), str(t.discount), str(t.taxable), str(t.vat),
                    str(t.total), inv.id,
                ),
            )
        self.conn.execute("DELETE FROM invoice_items WHERE invoice_id = ?", (inv.id,))
        for item in inv.items:
            lt = item.totals
            if lt is None:
                raise ValidationError("مبلغ ردیف محاسبه نشده است.")
            self.conn.execute(
                "INSERT INTO invoice_items(invoice_id, position, product_id, description, unit, "
                "quantity, unit_price, discount, vat_rate, gross, taxable, vat, total) "
                "VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    inv.id, item.position, item.product_id, item.description, item.unit,
                    str(item.quantity), str(item.unit_price), str(lt.discount),
                    str(item.vat_rate), str(lt.gross), str(lt.taxable), str(lt.vat), str(lt.total),
                ),
            )
        saved = self.get_invoice(inv.id)
        assert saved is not None
        return saved

    def mark_issued(self, invoice_id: int, number: str, issue_date: date, issued_at: str) -> None:
        cur = self.conn.execute(
            "UPDATE invoices SET status=?, number=?, issue_date=?, issued_at=? "
            "WHERE id=? AND status=?",
            (ISSUED, number, issue_date.isoformat(), issued_at, invoice_id, DRAFT),
        )
        if cur.rowcount != 1:
            raise ValidationError("فقط فاکتور پیش‌نویس قابل صدور است.")

    def cancel_invoice(self, invoice_id: int, reason: str) -> None:
        cur = self.conn.execute(
            "UPDATE invoices SET status=?, cancel_reason=? WHERE id=? AND status=?",
            (CANCELLED, reason, invoice_id, ISSUED),
        )
        if cur.rowcount != 1:
            raise ValidationError("فقط فاکتور صادرشده قابل ابطال است.")

    def delete_draft_invoice(self, invoice_id: int) -> None:
        cur = self.conn.execute("DELETE FROM invoices WHERE id=? AND status=?", (invoice_id, DRAFT))
        if cur.rowcount != 1:
            raise ValidationError("فقط پیش‌نویس قابل حذف است.")

    # ----- اطلاعات شرکت (برای سربرگ فاکتور) -----
    COMPANY_KEYS = (
        "company_name", "company_national_id", "company_economic_code",
        "company_phone", "company_address",
    )

    def get_company_info(self) -> dict[str, str]:
        return {key: self.get_setting(key) for key in self.COMPANY_KEYS}

    def save_company_info(self, info: dict[str, str]) -> None:
        for key in self.COMPANY_KEYS:
            self.set_setting(key, info.get(key, "").strip())
