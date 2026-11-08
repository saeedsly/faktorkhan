"""
نصب آفلاین کتابخانه‌های فاکتورخوان از پوشه wheels
====================================================
این اسکریپت نیازی به pip و اینترنت ندارد و فقط با کتابخانه‌های استاندارد پایتون
کار می‌کند. فایل‌های .whl را باز می‌کند و داخل Lib\\site-packages می‌ریزد؛
همان کاری که pip انجام می‌دهد، ولی بدون شبکه.

کاربرد روی سیستم کاربر (در صورت نیاز به ترمیم):
    python tools\\install_offline.py
    python tools\\install_offline.py --wheels wheels --site python\\Lib\\site-packages

کاربرد در زمان ساخت بسته:
    python tools\\install_offline.py --target 3.13 --site out\\python\\Lib\\site-packages
"""
from __future__ import annotations

import argparse
import re
import shutil
import struct
import sys
import zipfile
from pathlib import Path

WHEEL_RE = re.compile(r"^(?P<name>[^-]+)-(?P<ver>[^-]+)-(?P<py>[^-]+)-(?P<abi>[^-]+)-(?P<plat>[^-]+)\.whl$")


def normalize(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def parse_wheel(filename: str):
    m = WHEEL_RE.match(filename)
    if not m:
        return None
    return m.groupdict()


def compatible(info: dict, minor: int) -> bool:
    """آیا این فایل whl با پایتون 3.<minor> روی ویندوز ۶۴بیتی سازگار است؟"""
    plat = info["plat"]
    if plat not in ("any", "win_amd64", "win32"):
        return False
    if plat == "win32" and struct.calcsize("P") * 8 != 32:
        return False
    py, abi = info["py"], info["abi"]
    if py in ("py3", "py2.py3") and abi == "none":
        return True
    m = re.match(r"cp3(\d+)$", py)
    if not m:
        return False
    tag_minor = int(m.group(1))
    if abi == "none":                      # مثل cp39-none-any
        return tag_minor <= minor
    m = re.match(r"cp3(\d+)$", abi)
    if m:
        return tag_minor == minor and int(m.group(1)) == minor
    if abi == "abi3":
        return tag_minor <= minor
    return False


def version_key(v: str):
    return [int(x) if x.isdigit() else 0 for x in re.split(r"[.+-]", v)]


def collect(wheels_dir: Path, minor: int) -> dict[str, tuple[str, Path]]:
    chosen: dict[str, tuple[str, Path]] = {}
    for path in sorted(wheels_dir.glob("*.whl")):
        info = parse_wheel(path.name)
        if not info or not compatible(info, minor):
            continue
        key = normalize(info["name"])
        cur = chosen.get(key)
        if cur is None or version_key(info["ver"]) > version_key(cur[0]):
            chosen[key] = (info["ver"], path)
    return chosen


def install(wheel: Path, site: Path) -> int:
    """محتوای whl را در site باز می‌کند و تعداد فایل‌ها را برمی‌گرداند."""
    count = 0
    stem = wheel.name[: -len(".whl")]
    with zipfile.ZipFile(wheel) as zf:
        for item in zf.infolist():
            name = item.filename
            if name.endswith("/"):
                continue
            rel = name
            # پوشه‌های <name>-<ver>.data/purelib|platlib همان site-packages هستند
            for part in ("purelib", "platlib"):
                marker = f".data/{part}/"
                if marker in name:
                    rel = name.split(marker, 1)[1]
                    break
            else:
                if ".data/" in name:       # scripts / data / headers لازم نیست
                    continue
            target = site / rel
            if target.exists() and target.stat().st_size == item.file_size:
                count += 1
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(item) as src, open(target, "wb") as dst:
                shutil.copyfileobj(src, dst)
            count += 1
    return count


def detect_site() -> Path:
    """مسیر site-packages مربوط به همین مفسر."""
    for p in sys.path:
        if p.endswith("site-packages"):
            return Path(p)
    return Path(sys.prefix) / "Lib" / "site-packages"


def main() -> int:
    ap = argparse.ArgumentParser(description="نصب آفلاین کتابخانه‌ها از پوشه wheels")
    ap.add_argument("--wheels", default="wheels", help="پوشه فایل‌های whl")
    ap.add_argument("--site", default="", help="مقصد نصب (پیش‌فرض: site-packages همین پایتون)")
    ap.add_argument("--target", default="", help="نسخه پایتون مقصد مثل 3.13 (پیش‌فرض: نسخه در حال اجرا)")
    ap.add_argument("--list", action="store_true", help="فقط نمایش فایل‌های انتخاب‌شده")
    args = ap.parse_args()

    wheels_dir = Path(args.wheels)
    if not wheels_dir.is_dir():
        print(f"[خطا] پوشه wheels پیدا نشد: {wheels_dir}")
        return 2

    if args.target:
        minor = int(args.target.split(".")[1])
    else:
        minor = sys.version_info.minor
    site = Path(args.site) if args.site else detect_site()

    chosen = collect(wheels_dir, minor)
    if not chosen:
        print(f"[خطا] هیچ فایل سازگاری برای پایتون 3.{minor} در {wheels_dir} نبود.")
        return 3

    print(f"پایتون مقصد: 3.{minor}  |  مقصد نصب: {site}  |  تعداد بسته‌ها: {len(chosen)}")
    if args.list:
        for name, (ver, path) in sorted(chosen.items()):
            print(f"  {name}=={ver}   ({path.name})")
        return 0

    site.mkdir(parents=True, exist_ok=True)
    total = 0
    for name, (ver, path) in sorted(chosen.items()):
        try:
            total += install(path, site)
            print(f"  ✓ {name}=={ver}")
        except Exception as exc:                       # noqa: BLE001
            print(f"  ✗ {name}=={ver}  →  {exc}")
    print(f"\nپایان: {len(chosen)} بسته، {total} فایل در {site} نصب شد.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
