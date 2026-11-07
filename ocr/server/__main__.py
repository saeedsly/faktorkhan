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
from .engine import DET_VERSIONS, EngineNotReady, PPOCRv5Engine
from .textorder import DECODE_MODES
from .vlm import VlmEngine

HERE = Path(__file__).resolve().parent.parent


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="سرور OCR فاکتورخوان")
    p.add_argument("--models", default=str(HERE / "models"), help="پوشه‌ی models با det/ و rec/")
    p.add_argument("--decode", default="paddle", choices=DECODE_MODES,
                   help="paddle = معکوس‌سازی مانند PaddleOCR؛ raw = بدون معکوس‌سازی")
    p.add_argument("--det-version", default="v5", choices=DET_VERSIONS,
                   help="v5 = models/det (پیش‌فرض)؛ v6 = models/det_v6 (نیاز به دانلود با --det-v6)")
    p.add_argument("--vlm-url", default=None,
                   help="آدرس llama-server با Qwen3-VL، مثلاً http://127.0.0.1:8080 (اختیاری)")
    p.add_argument("--host", default="0.0.0.0")
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--check", action="store_true",
                   help="فقط بارگذاری موتورها را بررسی کن و خروجی بده (بدون اجرای سرور)")
    args = p.parse_args(argv)

    engines: dict = {"rapid": None}
    errors: dict[str, str] = {}
    try:
        engines["rapid"] = PPOCRv5Engine(Path(args.models), decode=args.decode, det_version=args.det_version)
        print(f"موتور آماده است: {engines['rapid'].name} | فایل‌ها: "
              f"{engines['rapid'].model_files} | decode={args.decode} | det={args.det_version}", flush=True)
    except (EngineNotReady, ImportError) as exc:
        errors["rapid"] = str(exc)
        print(f"هشدار: موتور PP-OCRv5 بارگذاری نشد: {exc}", file=sys.stderr, flush=True)

    health_info: dict[str, dict] = {}
    if args.vlm_url:
        vlm = VlmEngine(args.vlm_url)
        status = vlm.health()
        if status["ok"]:
            engines["vlm"] = vlm
            print(f"موتور VLM آماده است: {args.vlm_url}", flush=True)
        else:
            errors["vlm"] = status["error"]
            print(f"هشدار: موتور VLM در دسترس نیست: {status['error']}", file=sys.stderr, flush=True)

    # eBoo (ابری، اختیاری): فقط وقتی متغیر محیطی EBOO_TOKEN تنظیم شده باشد
    from .eboo import engine_from_env
    try:
        ebo = engine_from_env()
    except ValueError as exc:
        ebo = None
        errors["ebo"] = str(exc)
    if ebo is not None:
        engines["ebo"] = ebo
        print("موتور eBoo فعال است؛ تصویرها برای سرور ایبو فرستاده می‌شوند.", flush=True)

    if args.check:
        return 0 if engines.get("rapid") is not None else 1

    app = create_app(engines, errors=errors, health_info=health_info)
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
