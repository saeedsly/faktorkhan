"""پایگاه داده SQLite برای تاریخچه فاکتورهای پردازش‌شده."""

from __future__ import annotations

import sqlite3
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from faktorkhan.config import DB_PATH
from faktorkhan.ocr.parser import Invoice


class InvoiceRepository:
    """.Repository» دسترسی به فاکتورها در SQLite."""

    def __init__(self, db_path: str | Path = DB_PATH) -> None:
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS invoices (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    invoice_no TEXT,
                    invoice_date TEXT,
                    vendor TEXT,
                    customer TEXT,
                    subtotal REAL,
                    tax REAL,
                    total REAL,
                    currency TEXT DEFAULT 'تومان',
                    ocr_confidence REAL,
                    raw_text TEXT,
                    created_at TEXT,
                    file_path TEXT,
                    source_image TEXT
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS invoice_items (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    invoice_id INTEGER,
                    row_no INTEGER,
                    description TEXT,
                    quantity REAL,
                    unit_price REAL,
                    total_price REAL,
                    FOREIGN KEY (invoice_id) REFERENCES invoices (id) ON DELETE CASCADE
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS license_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    event TEXT,
                    detail TEXT,
                    created_at TEXT
                )
                """
            )
            conn.commit()

    def save_invoice(self, invoice: Invoice, source_image: str | None = None) -> int:
        with self._connect() as conn:
            now = datetime.now(timezone.utc).isoformat()
            cur = conn.execute(
                """
                INSERT INTO invoices
                (invoice_no, invoice_date, vendor, customer, subtotal, tax, total,
                 currency, ocr_confidence, raw_text, created_at, file_path, source_image)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    invoice.invoice_no,
                    invoice.invoice_date,
                    invoice.vendor,
                    invoice.customer,
                    invoice.subtotal,
                    invoice.tax,
                    invoice.total,
                    invoice.currency,
                    invoice.confidence,
                    invoice.raw_text,
                    now,
                    None,
                    source_image,
                ),
            )
            invoice_id = cur.lastrowid
            for item in invoice.items:
                conn.execute(
                    """
                    INSERT INTO invoice_items
                    (invoice_id, row_no, description, quantity, unit_price, total_price)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        invoice_id,
                        item.row_no,
                        item.description,
                        item.quantity,
                        item.unit_price,
                        item.total_price,
                    ),
                )
            conn.commit()
            return invoice_id

    def list_invoices(self, limit: int = 100) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM invoices ORDER BY created_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
            return [dict(row) for row in rows]

    def get_invoice_with_items(self, invoice_id: int) -> dict[str, Any] | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM invoices WHERE id = ?", (invoice_id,)
            ).fetchone()
            if row is None:
                return None
            invoice = dict(row)
            items = conn.execute(
                "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY row_no",
                (invoice_id,),
            ).fetchall()
            invoice["items"] = [dict(item) for item in items]
            return invoice

    def log_license_event(self, event: str, detail: str = "") -> None:
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO license_events (event, detail, created_at) VALUES (?, ?, ?)",
                (event, detail, datetime.now(timezone.utc).isoformat()),
            )
            conn.commit()
