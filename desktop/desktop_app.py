#!/usr/bin/env python3
"""
فاکتورخوان — نسخه رومیزی ویندوز
=================================
این فایل برنامه را به‌صورت یک اپلیکیشن دسکتاپ اجرا می‌کند:
  • سرور داخلی روی 127.0.0.1 (بدون نیاز به اینترنت و MySQL)
  • پایگاه داده SQLite در پوشه داده کاربر (AppData)
  • پنجره بومی ویندوز با پوسته اختصاصی (pywebview)
  • در صورت نبود pywebview، مرورگر پیش‌فرض باز می‌شود

اثر: سعید سالاری — تمامی حقوق محفوظ است.
"""
from __future__ import annotations

import logging
import os
import socket
import sys
import tempfile
import threading
import time
import webbrowser
from pathlib import Path

APP_TITLE = "فاکتورخوان — سامانه هوشمند خوانش فاکتور"
DEFAULT_PORT = 8765


# ------------------------------------------------------------- مسیرها
def app_root() -> Path:
    """ریشه منابع (در حالت PyInstaller داخل _MEIPASS)."""
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
    return Path(__file__).resolve().parent.parent


def data_dir() -> Path:
    """پوشه داده پایدار کاربر."""
    if os.name == "nt":
        base = Path(os.getenv("APPDATA", Path.home() / "AppData" / "Roaming"))
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.getenv("XDG_DATA_HOME", Path.home() / ".local" / "share"))
    path = base / "FactorKhan"
    path.mkdir(parents=True, exist_ok=True)
    return path


ROOT = app_root()
DATA = data_dir()
os.environ.setdefault("DATA_DIR", str(DATA / "storage"))
os.environ.setdefault("DATABASE_URL", f"sqlite:///{(DATA / 'faktorkhan.db').as_posix()}")
os.environ.setdefault("APP_ENV", "desktop")
os.environ.setdefault("HOST", "127.0.0.1")
os.environ.setdefault("ALLOW_REGISTRATION", "true")

sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(name)s | %(message)s",
    handlers=[logging.FileHandler(DATA / "desktop.log", encoding="utf-8"), logging.StreamHandler()],
)
log = logging.getLogger("faktorkhan.desktop")


def free_port(preferred: int = DEFAULT_PORT) -> int:
    """پورت آزاد پیدا می‌کند (اگر پورت پیش‌فرض اشغال بود)."""
    for port in range(preferred, preferred + 40):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                sock.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def wait_for_server(port: int, timeout: float = 45.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.6):
                return True
        except OSError:
            time.sleep(0.25)
    return False


def start_server(port: int) -> None:
    import uvicorn

    from app.seed import bootstrap

    bootstrap()
    try:
        uvicorn.run("app.main:app", host="127.0.0.1", port=port, log_level="warning", access_log=False)
    except Exception as exc:  # pragma: no cover
        log.exception("server crashed: %s", exc)


def credential_hint() -> str:
    path = Path(os.environ["DATA_DIR"]) / "OWNER-CREDENTIALS.txt"
    if path.is_file():
        content = path.read_text(encoding="utf-8")
        lines = [ln for ln in content.splitlines() if ":" in ln]
        return "\n".join(lines[-2:]) if lines else ""
    return ""


def main() -> None:
    port = free_port()
    url = f"http://127.0.0.1:{port}/"
    thread = threading.Thread(target=start_server, args=(port,), daemon=True, name="faktorkhan-server")
    thread.start()

    if not wait_for_server(port):
        log.error("سرور داخلی بالا نیامد")
        _message("فاکتورخوان", "سرور داخلی اجرا نشد. فایل log را بررسی کنید.")
        return

    log.info("آماده روی %s", url)
    try:
        import webview  # type: ignore

        window = webview.create_window(
            APP_TITLE,
            url,
            width=1440,
            height=900,
            min_size=(1000, 660),
            background_color="#080d1a",
            text_select=True,
            confirm_close=False,
        )
        _ = window
        webview.start(debug=False, http_server=False)
    except Exception as exc:  # pragma: no cover
        log.warning("pywebview در دسترس نیست (%s) — اجرا در مرورگر", type(exc).__name__)
        webbrowser.open(url)
        hint = credential_hint()
        _message(
            "فاکتورخوان اجرا شد",
            f"برنامه در مرورگر باز شد:\n{url}\n\n{hint}\n\nبرای بستن برنامه، پنجره کنسول را ببندید.",
        )
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            pass


def _message(title: str, text: str) -> None:
    try:
        if os.name == "nt":
            import ctypes

            ctypes.windll.user32.MessageBoxW(0, text, title, 0x40)
            return
    except Exception:
        pass
    print(f"\n=== {title} ===\n{text}\n")


if __name__ == "__main__":
    try:
        main()
    finally:
        # اطمینان از پایان سرور و آزاد شدن پورت
        logging.shutdown()
        os._exit(0)
