"""اجرای سرور: python -m server --models models --port 8000

روی 0.0.0.0 گوش می‌دهد تا از شبکه‌ی محلی هم قابل دسترسی باشد.
اگر وزن‌ها پیدا نشوند، سرور بالا می‌آید ولی /api/ocr خطای روشن می‌دهد
و رابط کاربری به موتور داخل مرورگر برمی‌گردد.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import uvicorn

from .app import create_app
from .engine import EngineNotReady, PPOCRv5Engine
from .textorder import DECODE_MODES

HERE = Path(__file__).resolve().parent.parent


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="سرور OCR فاکتورخوان")
    p.add_argument("--models", default=str(HERE / "models"), help="پوشه‌ی models با det/ و rec/")
    p.add_argument("--decode", default="paddle", choices=DECODE_MODES,
                   help="paddle = معکوس‌سازی مانند PaddleOCR؛ raw = بدون معکوس‌سازی")
    p.add_argument("--host", default="0.0.0.0")
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--check", action="store_true",
                   help="فقط بارگذاری موتور را بررسی کن و خروجی بده (بدون اجرای سرور)")
    args = p.parse_args(argv)

    engine = None
    error = None
    try:
        engine = PPOCRv5Engine(Path(args.models), decode=args.decode)
        print(f"موتور آماده است: {engine.name} | فایل‌ها: {engine.model_files} | decode={args.decode}", flush=True)
    except (EngineNotReady, ImportError) as exc:
        error = str(exc)
        print(f"هشدار: موتور PP-OCRv5 بارگذاری نشد: {error}", file=sys.stderr, flush=True)

    if args.check:
        return 0 if engine is not None else 1

    app = create_app(engine, engine_error=error)
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
