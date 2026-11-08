"""ثبت توکن سرویس ابری از خط فرمان — بدون نیاز به مرورگر.

توکن به‌صورت مخفی (getpass) گرفته می‌شود، رمزنگاری‌شده در پایگاه ذخیره می‌گردد و
هرگز چاپ نمی‌شود. آدرس درگاه هم نمایش داده نمی‌شود.

نمونهٔ استفاده (ویندوز):

    SET-CLOUD-TOKEN-WINDOWS.bat
    python tools\\set_cloud_token.py --check
    python tools\\set_cloud_token.py --clear
"""
from __future__ import annotations

import argparse
import getpass
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

try:
    from app.database import init_db, session_scope  # noqa: E402
    from app.models import AppSetting  # noqa: E402
    from app.services import cloud_ocr  # noqa: E402
    from app.security import mask_secret  # noqa: E402
except Exception as exc:  # pragma: no cover - وابستگی‌ها نصب نشده‌اند
    print(f"[خطا] کتابخانه‌های برنامه پیدا نشد: {exc}")
    print("       ابتدا START-WINDOWS.bat را یک‌بار اجرا کنید تا محیط آماده شود.")
    raise SystemExit(1)


def _ok(text: str) -> None:
    print(f"  \u2713 {text}")


def _err(text: str) -> None:
    print(f"  \u2717 {text}")


def show_state() -> int:
    state = cloud_ocr.token_state()
    print("وضعیت سرویس ابری:")
    print(f"  درگاه:      {'آماده' if state['gateway_ready'] else 'نامعتبر'}")
    print(f"  توکن:       {'ثبت‌شده' if state['configured'] else 'ثبت نشده'}")
    if state["configured"]:
        print(f"  طول توکن:   {state['length']}")
        print(f"  اثر انگشت:  {mask_secret(cloud_ocr.cloud_token())}")
    return 0 if state["configured"] else 2


def save(token: str) -> int:
    token = token.strip().strip('"').strip("'")
    if len(token) < 8:
        _err("توکن خیلی کوتاه است (حداقل ۸ کاراکتر).")
        return 1
    cloud_ocr.save_cloud_token(token)
    _ok("توکن رمزنگاری‌شده ذخیره شد.")
    _ok("مقدار توکن در هیچ خروجی یا صفحه‌ای نمایش داده نمی‌شود.")
    print("\nبرای بررسی اتصال و اعتبار:")
    print("  python tools\\set_cloud_token.py --test")
    return 0


def test_connection() -> int:
    try:
        credit = cloud_ocr.check_credit()
    except cloud_ocr.CloudError as exc:
        _err(f"اتصال برقرار نشد: {exc.message}")
        return 3
    _ok("ارتباط با سرویس ابری برقرار است.")
    print(f"  اعتبار OCR:  {credit['ocr_credit']:,} صفحه")
    print(f"  اعتبار صوت: {credit['audio_credit']:,} ثانیه")
    return 0


def clear() -> int:
    with session_scope() as db:
        row = db.query(AppSetting).filter(AppSetting.key == cloud_ocr.TOKEN_KEY).first()
        if row is None:
            _err("توکنی ثبت نشده بود.")
            return 2
        db.delete(row)
    _ok("توکن حذف شد؛ سرویس ابری غیرفعال است.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="ثبت توکن سرویس ابری فاکتورخوان")
    ap.add_argument("--token", help="توکن (اگر ندهید، به‌صورت مخفی پرسیده می‌شود)")
    ap.add_argument("--check", action="store_true", help="نمایش وضعیت بدون تغییر")
    ap.add_argument("--test", action="store_true", help="تست اتصال و اعتبار")
    ap.add_argument("--clear", action="store_true", help="حذف توکن")
    args = ap.parse_args()

    init_db()

    if args.check:
        return show_state()
    if args.test:
        return test_connection()
    if args.clear:
        return clear()

    token = args.token
    if not token:
        try:
            token = getpass.getpass("توکن سرویس ابری (نمایش داده نمی‌شود): ")
        except (EOFError, KeyboardInterrupt):
            print("\n  [لغو شد]")
            return 1
    code = save(token)
    if code != 0:
        return code
    if args.test:
        print()
        return test_connection()
    try:
        answer = input("\nالان اتصال تست شود؟ (y/n) [y]: ").strip().lower()
    except (EOFError, KeyboardInterrupt):
        answer = "n"
    if answer in {"", "y", "yes"}:
        print()
        return test_connection()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
