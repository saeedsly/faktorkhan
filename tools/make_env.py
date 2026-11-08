"""
ساخت/به‌روزرسانی فایل .env فاکتورخوان
=====================================
بدون وابستگی بیرونی، با کتابخانهٔ استاندارد پایتون کار می‌کند و هم در
اسکریپت ویندوز (setup-mysql-windows.bat) و هم در اسکریپت لینوکس
(deploy/lamp-install.sh) استفاده می‌شود.

نمونه:
    python tools/make_env.py --gen-secrets \
        --set APP_ENV=production \
        --set "DATABASE_URL=mysql+pymysql://fk:pass@127.0.0.1:3306/faktorkhan?charset=utf8mb4" \
        --set ALLOWED_HOSTS=faktorkhan.ir

قواعد:
  * کلیدهای موجود در .env فعلی حفظ می‌شوند مگر با --set عوض شوند.
  * --gen-secrets فقط کلیدهای خالی را پر می‌کند (کلید موجود را عوض نمی‌کند).
  * هیچ مقدار حساسی در خروجی چاپ نمی‌شود.
"""
from __future__ import annotations

import argparse
import secrets
import sys
from pathlib import Path

HEADER = (
    "# ────────────────────────────────────────────────────────────────\n"
    "#  فاکتورخوان — تنظیمات محیطی (ساخته‌شده به‌صورت خودکار)\n"
    "#  هشدار: این فایل حاوی کلیدهای امنیتی است؛ آن را جایی کپی/آپلود نکنید.\n"
    "# ────────────────────────────────────────────────────────────────\n"
)

ORDER = [
    "APP_NAME", "APP_ENV", "SECRET_KEY", "ENCRYPTION_KEY", "TOKEN_TTL_HOURS",
    "MAX_LOGIN_ATTEMPTS", "LOCK_MINUTES", "LOGIN_RATE_LIMIT", "LOGIN_RATE_WINDOW",
    "DATABASE_URL", "CLOUD_OCR_GATEWAY", "CLOUD_OCR_TIMEOUT", "CLOUD_OCR_VERIFY_TLS",
    "CLOUD_OCR_SEED_TOKEN", "ALLOW_REGISTRATION", "REQUIRE_LICENSE", "TRIAL_DAYS",
    "TRIAL_PAGES", "OWNER_NAME", "OWNER_EMAIL", "OWNER_PASSWORD", "HOST", "PORT",
    "DATA_DIR", "MAX_UPLOAD_MB", "CORS_ORIGINS", "TRUST_PROXY", "ALLOWED_HOSTS",
    "FORCE_HTTPS", "ENABLE_API_DOCS",
]

SECRET_KEYS = {"SECRET_KEY", "ENCRYPTION_KEY", "CLOUD_OCR_SEED_TOKEN", "OWNER_PASSWORD"}


def read_env(path: Path) -> dict[str, str]:
    data: dict[str, str] = {}
    if not path.is_file():
        return data
    for raw in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        data[key.strip()] = value.strip()
    return data


def main() -> int:
    ap = argparse.ArgumentParser(description="ساخت فایل .env فاکتورخوان")
    ap.add_argument("--path", default=".env", help="مسیر فایل .env (پیش‌فرض: .env)")
    ap.add_argument("--set", action="append", default=[], metavar="KEY=VALUE")
    ap.add_argument("--gen-secrets", action="store_true")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    path = Path(args.path)
    data = read_env(path)

    # مقادیر پیش‌فرض لازم
    data.setdefault("APP_NAME", "فاکتورخوان")
    data.setdefault("APP_ENV", "production")
    data.setdefault("HOST", "0.0.0.0")
    data.setdefault("PORT", "8000")

    if args.gen_secrets:
        if not data.get("SECRET_KEY"):
            data["SECRET_KEY"] = secrets.token_urlsafe(48)
        if not data.get("ENCRYPTION_KEY"):
            data["ENCRYPTION_KEY"] = secrets.token_urlsafe(48)

    for item in args.set:
        if "=" not in item:
            print(f"[خطا] قالب نامعتبر (باید KEY=VALUE باشد): {item}")
            return 2
        key, value = item.split("=", 1)
        data[key.strip()] = value.strip()

    keys = [k for k in ORDER if k in data] + sorted(k for k in data if k not in ORDER)
    lines = [HEADER]
    for key in keys:
        value = data.get(key, "")
        lines.append(f"{key}={value}\n")
    path.write_text("".join(lines), encoding="utf-8")

    if not args.quiet:
        print(f"فایل {path} نوشته شد ({len(keys)} کلید).")
        for key in keys:
            if key in SECRET_KEYS:
                value = data.get(key, "")
                state = "تعیین‌شده" if value else "خالی"
                print(f"  {key}: {state} (طول {len(value)})")
            elif key in {"DATABASE_URL"} and "@" in data.get(key, ""):
                print(f"  {key}: {data[key].split('@')[-1]}")
            else:
                print(f"  {key}: {data.get(key, '')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
