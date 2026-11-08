"""
راه‌اندازی MySQL برای فاکتورخوان روی ویندوز (WAMP / XAMPP / MySQL Server)
========================================================================
این اسکریپت کارهای زیر را انجام می‌دهد:

  ۱. اتصال به MySQL با کاربر root
  ۲. ساخت پایگاه داده با کدگذاری utf8mb4 و collation فارسی
  ۳. ساخت کاربر اختصاصی برنامه + دسترسی فقط به همان پایگاه داده
  ۴. ساخت/به‌روزرسانی فایل .env با کلیدهای امنیتی تصادفی و آدرس اتصال
  ۵. تست اتصال با همان تنظیمات

نمونه‌ها:
    python tools\\setup_mysql.py --interactive          # پرسش‌وپاسخ (پیشنهادی)
    python tools\\setup_mysql.py --root-password "" --db-name faktorkhan
    python tools\\setup_mysql.py --test                  # فقط تست تنظیمات فعلی
    python tools\\setup_mysql.py --dry-run --interactive # نمایش بدون تغییر
"""
from __future__ import annotations

import argparse
import re
import secrets
import socket
import sys
from pathlib import Path
from urllib.parse import quote_plus, unquote

ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = ROOT / ".env"

DEFAULT_DB = "faktorkhan"
DEFAULT_USER = "faktorkhan"

PERSIAN_TABLE_HEAD = """# ────────────────────────────────────────────────────────────────
#  فاکتورخوان — تنظیمات سرور (MySQL)
#  این فایل به‌صورت خودکار توسط tools/setup_mysql.py ساخته شد.
#  هشدار: این فایل را در گیت، پیام‌رسان یا ایمیل قرار ندهید.
# ────────────────────────────────────────────────────────────────
"""


# ────────────────────────────────────────────────── کمک‌تابع‌ها
def ok(msg: str) -> None:
    print(f"  \u2713 {msg}")


def warn(msg: str) -> None:
    print(f"  ! {msg}")


def err(msg: str) -> None:
    print(f"  \u2717 {msg}")


def mask(value: str) -> str:
    if not value:
        return "(خالی)"
    if len(value) <= 3:
        return "•" * len(value)
    return "•" * (len(value) - 2) + value[-2:]


def _usable(ip: str) -> bool:
    return bool(ip) and not ip.startswith(("127.", "169.254.", "0."))


def lan_ip() -> str:
    """آدرس IPv4 معتبر شبکهٔ محلی این سیستم."""
    found: list[str] = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.6)
        s.connect(("8.8.8.8", 80))
        found.append(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            found.append(info[4][0])
    except OSError:
        pass
    for ip in found:
        if _usable(ip):
            return ip
    return ""


def read_env(path: Path) -> dict[str, str]:
    data: dict[str, str] = {}
    if not path.is_file():
        return data
    for raw in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        data[k.strip()] = v.strip().strip('"').strip("'")
    return data


def update_env(path: Path, values: dict[str, str]) -> None:
    """کلیدها را در .env جایگزین/اضافه می‌کند و بقیهٔ خطوط را دست نمی‌زند."""
    lines: list[str] = []
    if path.is_file():
        lines = path.read_text(encoding="utf-8").splitlines()
    else:
        lines = PERSIAN_TABLE_HEAD.splitlines()

    pending = dict(values)
    out: list[str] = []
    for line in lines:
        stripped = line.strip()
        if "=" in stripped and not stripped.startswith("#"):
            key = stripped.split("=", 1)[0].strip()
            if key in pending:
                out.append(f"{key}={pending.pop(key)}")
                continue
        out.append(line)

    if pending:
        out.append("")
        out.append("# ── تنظیمات اضافه‌شده توسط setup_mysql ──")
        for key, val in pending.items():
            out.append(f"{key}={val}")

    path.write_text("\n".join(out).rstrip() + "\n", encoding="utf-8")


def build_url(user: str, password: str, host: str, port: int, db: str) -> str:
    pwd = quote_plus(password)
    return f"mysql+pymysql://{quote_plus(user)}:{pwd}@{host}:{port}/{db}?charset=utf8mb4"


def parse_url(url: str) -> dict:
    m = re.match(r"mysql(?:\+pymysql)?://(?P<user>[^:]+)(?::(?P<pw>[^@]*))?@(?P<host>[^:/]+)(?::(?P<port>\d+))?/(?P<db>[^?]+)", url)
    if not m:
        return {}
    return {
        "user": unquote(m.group("user")),
        "password": unquote(m.group("pw") or ""),
        "host": m.group("host"),
        "port": int(m.group("port") or 3306),
        "db": m.group("db"),
    }


# ────────────────────────────────────────────────── MySQL
def connect(host: str, port: int, user: str, password: str, db: str | None = None):
    try:
        import pymysql  # noqa: PLC0415
    except ModuleNotFoundError:
        err("کتابخانه PyMySQL نصب نیست. اول کتابخانه‌ها را نصب/اجرا کنید")
        err("(در بستهٔ PORTABLE همین‌طور از پیش نصب است).")
        raise SystemExit(4)
    return pymysql.connect(
        host=host, port=port, user=user, password=password, database=db,
        charset="utf8mb4", autocommit=True, connect_timeout=10,
    )


def server_version(conn) -> str:
    with conn.cursor() as cur:
        cur.execute("SELECT VERSION()")
        return str(cur.fetchone()[0])


def setup_database(host: str, port: int, root_user: str, root_pw: str, db: str,
                   app_user: str, app_pw: str, dry_run: bool) -> tuple[bool, list[str]]:
    notes: list[str] = []
    stmts = [
        f"CREATE DATABASE IF NOT EXISTS `{db}` CHARACTER SET utf8mb4 COLLATE utf8mb4_persian_ci",
    ]
    if app_user and app_user.lower() != root_user.lower():
        for hst in ("localhost", "127.0.0.1"):
            stmts += [
                f"CREATE USER IF NOT EXISTS '{app_user}'@'{hst}' IDENTIFIED BY '{app_pw}'",
                f"ALTER USER '{app_user}'@'{hst}' IDENTIFIED BY '{app_pw}'",
                f"GRANT ALL PRIVILEGES ON `{db}`.* TO '{app_user}'@'{hst}'",
            ]
        stmts.append("FLUSH PRIVILEGES")

    if dry_run:
        print("\n--- SQL که اجرا می‌شود (dry-run) ---")
        for s in stmts:
            print("   " + re.sub(r"IDENTIFIED BY '[^']*'", "IDENTIFIED BY '•••'", s) + ";")
        print()
        return True, notes

    try:
        conn = connect(host, port, root_user, root_pw)
    except Exception as exc:  # noqa: BLE001
        err(f"اتصال به MySQL ناموفق بود: {exc}")
        notes.append("اتصال ناموفق")
        return False, notes

    version = server_version(conn)
    ok(f"اتصال به MySQL برقرار شد — نسخه {version}")

    failures = 0
    with conn.cursor() as cur:
        for stmt in stmts:
            try:
                cur.execute(stmt)
            except Exception as exc:  # noqa: BLE001
                msg = str(exc)
                # اگر ساخت کاربر پشتیبانی نشد، از روش قدیمی GRANT استفاده می‌کنیم
                if "CREATE USER" in stmt and ("syntax" in msg.lower() or "not supported" in msg.lower()):
                    try:
                        cur.execute(f"GRANT ALL PRIVILEGES ON `{db}`.* TO '{app_user}'@'localhost' IDENTIFIED BY '{app_pw}'")
                        notes.append("روش قدیمی ساخت کاربر استفاده شد")
                        continue
                    except Exception as exc2:  # noqa: BLE001
                        msg = str(exc2)
                failures += 1
                warn(f"{stmt.split('(')[0][:40]} → {msg}")
    conn.close()

    if failures:
        warnings_only = all("already exists" in n.lower() for n in notes)
        if not warnings_only:
            warn("بعضی دستورها اجرا نشدند؛ متن بالا را بررسی کنید.")
    ok(f"پایگاه داده `{db}` آماده است")
    return True, notes


def verify(db_url: str) -> bool:
    info = parse_url(db_url)
    if not info:
        err("آدرس پایگاه داده قابل خواندن نیست.")
        return False
    try:
        conn = connect(info["host"], info["port"], info["user"], info["password"], info["db"])
    except Exception as exc:  # noqa: BLE001
        err(f"تست اتصال با کاربر برنامه ناموفق بود: {exc}")
        return False
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = %s", (info["db"],))
        n = cur.fetchone()[0]
    version = server_version(conn)
    conn.close()
    ok(f"تست اتصال موفق — MySQL {version} — تعداد جداول فعلی: {n}")
    return True


# ────────────────────────────────────────────────── تعاملی
def ask(prompt: str, default: str = "") -> str:
    suffix = f" [{default}]" if default else ""
    try:
        value = input(f"{prompt}{suffix}: ").strip()
    except EOFError:
        value = ""
    return value or default


def ask_yes(prompt: str, default: bool = False) -> bool:
    d = "y" if default else "n"
    return ask(prompt + " (y/n)", d).lower() in {"y", "yes", "b", "بله", "1", "true"}


def main() -> int:
    ap = argparse.ArgumentParser(description="راه‌اندازی MySQL برای فاکتورخوان")
    ap.add_argument("--interactive", "-i", action="store_true", help="پرسش‌وپاسخ")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=3306)
    ap.add_argument("--root-user", default="root")
    ap.add_argument("--root-password", default="")
    ap.add_argument("--db-name", default=DEFAULT_DB)
    ap.add_argument("--app-user", default=DEFAULT_USER)
    ap.add_argument("--app-password", default="")
    ap.add_argument("--domain", default="", help="دامنه سایت مثل faktorkhan.ir (اختیاری)")
    ap.add_argument("--https", action="store_true", help="سایت پشت HTTPS است")
    ap.add_argument("--open-registration", action="store_true", help="اجازه ثبت‌نام آزاد")
    ap.add_argument("--gateway", default="", help="آدرس درگاه سرویس ابری (اختیاری)")
    ap.add_argument("--env-file", default=str(ENV_PATH))
    ap.add_argument("--dry-run", action="store_true", help="فقط نمایش، بدون تغییر")
    ap.add_argument("--test", action="store_true", help="فقط تست تنظیمات فعلی .env")
    args = ap.parse_args()

    env_path = Path(args.env_file)
    existing = read_env(env_path)

    if args.test:
        url = existing.get("DATABASE_URL", "")
        if not url.startswith("mysql"):
            err("DATABASE_URL در .env روی MySQL تنظیم نشده است (احتمالاً SQLite است).")
            return 2
        print(f"تست اتصال: {re.sub(r':[^:@]*@', ':•••@', url)}")
        return 0 if verify(url) else 3

    print("=" * 64)
    print("  فاکتورخوان — راه‌اندازی پایگاه داده MySQL")
    print("=" * 64)

    if args.interactive:
        print("\nمقادیر پیش‌فرض مناسب WAMP/XAMPP کافی است؛ فقط Enter بزنید.\n")
        args.host = ask("آدرس سرور MySQL", args.host)
        args.port = int(ask("پورت MySQL", str(args.port)))
        args.root_user = ask("کاربر root", args.root_user)
        args.root_password = ask("گذرواژه root (در WAMP معمولاً خالی است)", args.root_password)
        args.db_name = ask("نام پایگاه داده", args.db_name)
        args.app_user = ask("کاربر اختصاصی برنامه", args.app_user)
        generated = secrets.token_urlsafe(18).replace("-", "x").replace("_", "y")
        args.app_password = ask(f"گذرواژه کاربر «{args.app_user}»", args.app_password or generated)
        args.domain = ask("دامنه سایت (خالی = فقط شبکهٔ محلی)", args.domain)
        if args.domain:
            args.https = ask_yes("سایت پشت HTTPS است؟", True)
        args.open_registration = ask_yes("اجازه ثبت‌نام آزاد باشد؟ (توصیه: خیر)", False)

    app_pw = args.app_password or secrets.token_urlsafe(18).replace("-", "x").replace("_", "y")
    good, _notes = setup_database(args.host, args.port, args.root_user, args.root_password,
                                  args.db_name, args.app_user, app_pw, args.dry_run)

    secret = existing.get("SECRET_KEY") or secrets.token_urlsafe(48)
    enc = existing.get("ENCRYPTION_KEY") or secrets.token_urlsafe(48)
    db_url = build_url(args.app_user if args.app_user else args.root_user, app_pw,
                       args.host, args.port, args.db_name)

    hosts = ["localhost", "127.0.0.1"]
    ip = lan_ip()
    if ip:
        hosts.append(ip)
    if args.domain:
        hosts.insert(0, args.domain)
        if not args.domain.startswith("www."):
            hosts.insert(1, f"www.{args.domain}")

    values = {
        "APP_ENV": "production",
        "SECRET_KEY": secret,
        "ENCRYPTION_KEY": enc,
        "DATABASE_URL": db_url,
        "ALLOWED_HOSTS": ",".join(dict.fromkeys(hosts)),
        "FORCE_HTTPS": "1" if args.https else "0",
        "PROXY_HEADERS": "1",
        "FORWARDED_ALLOW_IPS": "127.0.0.1",
        "ENABLE_API_DOCS": "0",
        "ALLOW_REGISTRATION": "true" if args.open_registration else "false",
        # پشت Apache (سایت اینترنتی): برنامه فقط روی ۱۲۷.۰.۰.۱ گوش می‌دهد
        # تا پورت ۸۰۰۰ از بیرون قابل دسترسی نباشد.
        "HOST": "127.0.0.1" if args.domain else "0.0.0.0",
        "PORT": "8000",
    }
    if args.gateway:
        values["CLOUD_OCR_GATEWAY"] = args.gateway

    print("\n--- تنظیمات فایل .env ---")
    for k, v in values.items():
        shown = mask(v) if k in {"SECRET_KEY", "ENCRYPTION_KEY"} else v
        if k == "DATABASE_URL":
            shown = re.sub(r":(?P<p>[^:@/]+)@", ":•••@", v)
        print(f"   {k}={shown}")

    if args.dry_run:
        print("\n(dry-run) فایل .env تغییر نکرد.")
        return 0 if good else 3

    update_env(env_path, values)
    ok(f"فایل تنظیمات به‌روزرسانی شد: {env_path}")

    verified = verify(db_url)
    print()
    print("=" * 64)
    if verified:
        print("  آماده است. مراحل بعدی:")
    else:
        print("  با اخطار تمام شد. مراحل بعدی:")
    print("   ۱. START-SERVER-WINDOWS.bat را اجرا کنید")
    print("   ۲. در مرورگر: http://127.0.0.1:8000")
    if ip:
        print(f"   ۳. از شبکهٔ محلی: http://{ip}:8000")
    if args.domain:
        print(f"   ۴. از اینترنت: https://{args.domain}")
        print("      (برنامه فقط روی 127.0.0.1 گوش می‌دهد؛ دسترسی از طریق Apache است)")
    print("=" * 64)
    return 0 if verified else 3


if __name__ == "__main__":
    raise SystemExit(main())
