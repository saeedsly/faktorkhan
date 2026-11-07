"""اتصال پایگاه داده — سازگار با MySQL (WAMP/XAMPP) و SQLite."""
from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool

from .config import settings


class Base(DeclarativeBase):
    pass


def _engine_kwargs() -> dict:
    url = settings.DATABASE_URL
    if url.startswith("sqlite"):
        kwargs: dict = {"connect_args": {"check_same_thread": False, "timeout": 30}}
        if ":memory:" in url:
            kwargs["poolclass"] = StaticPool
        return kwargs
    return {
        "pool_pre_ping": True,
        "pool_recycle": 1800,
        "pool_size": settings.DB_POOL_SIZE,
        "max_overflow": settings.DB_MAX_OVERFLOW,
        "connect_args": {"charset": "utf8mb4"},
    }


engine = create_engine(settings.DATABASE_URL, echo=settings.SQL_ECHO, future=True, **_engine_kwargs())

if engine.url.get_backend_name() == "sqlite":

    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_connection, _record):  # pragma: no cover
        cur = dbapi_connection.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA foreign_keys=ON")
        cur.execute("PRAGMA synchronous=NORMAL")
        cur.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False, future=True)


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def session_scope() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def init_db() -> None:
    """ساخت جداول در صورت نبود (نصب بدون مهاجرت دستی)."""
    from . import models  # noqa: F401  ثبت مدل‌ها

    Base.metadata.create_all(bind=engine)


def db_health() -> dict:
    from sqlalchemy import text

    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return {"ok": True, "engine": engine.url.get_backend_name(), "database": engine.url.database}
    except Exception as exc:  # pragma: no cover
        return {"ok": False, "engine": engine.url.get_backend_name(), "error": str(exc)[:200]}
