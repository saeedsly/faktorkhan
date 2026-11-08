#!/usr/bin/env python3
"""اجرای فاکتورخوان.

    python run.py                 # اجرا روی پورت ۸۰۰۰
    python run.py --demo          # همراه داده نمایشی
    python run.py --port 9000     # پورت دلخواه
"""
from __future__ import annotations

import argparse
import socket
import sys
import threading
import webbrowser
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.config import settings  # noqa: E402


def _lan_ips() -> list[str]:
    """آدرس‌های IPv4 این سیستم در شبکهٔ محلی (برای حالت سرور)."""
    ips: list[str] = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.5)
        s.connect(("8.8.8.8", 80))
        first = s.getsockname()[0]
        if not first.startswith(("127.", "169.254.", "0.")):
            ips.append(first)
        s.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if ip not in ips and not ip.startswith(("127.", "169.254.", "0.")):
                ips.append(ip)
    except OSError:
        pass
    return ips


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

    if args.host in {"0.0.0.0", "::"}:
        print("\nحالت سرور: برنامه برای شبکه باز است.")
        print(f"  همین سیستم:   http://127.0.0.1:{args.port}")
        for ip in _lan_ips():
            print(f"  شبکهٔ محلی:   http://{ip}:{args.port}")
        print()

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
        server_header=False,          # نام و نسخهٔ سرور افشا نشود
        proxy_headers=settings.TRUST_PROXY,
        forwarded_allow_ips="127.0.0.1" if settings.TRUST_PROXY else None,
    )


if __name__ == "__main__":
    main()
