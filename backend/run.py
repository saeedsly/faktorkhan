#!/usr/bin/env python3
"""اجرای فاکتورخوان.

    python run.py                 # اجرا روی پورت ۸۰۰۰
    python run.py --demo          # همراه داده نمایشی
    python run.py --port 9000     # پورت دلخواه
"""
from __future__ import annotations

import argparse
import sys
import threading
import webbrowser
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.config import settings  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="فاکتورخوان — سامانه خوانش فاکتور")
    parser.add_argument("--host", default=settings.HOST)
    parser.add_argument("--port", type=int, default=settings.PORT)
    parser.add_argument("--demo", action="store_true", help="ایجاد داده نمایشی")
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--reload", action="store_true")
    args = parser.parse_args()

    if args.demo:
        from app.seed import bootstrap

        result = bootstrap(demo=True)
        if result.get("owner"):
            info = result["owner"]
            print(f"\nحساب مالک → {info['email']} / {info['password']}\n")

    if not args.no_browser:
        url_host = "127.0.0.1" if args.host in {"0.0.0.0", "::"} else args.host
        threading.Timer(1.6, lambda: webbrowser.open(f"http://{url_host}:{args.port}/")).start()

    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        log_level="info",
        access_log=True,
    )


if __name__ == "__main__":
    main()
