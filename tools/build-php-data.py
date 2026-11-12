#!/usr/bin/env python3
"""ساخت deploy/php/data.php از منبع نسخهٔ پایتون.

چرا این اسکریپت وجود دارد
--------------------------
نسخهٔ PHP باید همان ۱۲۰ قابلیت، همان متن حق معنوی و همان معرفی پدیدآورندهٔ
نسخهٔ پایتون را نشان دهد. اگر این متن‌ها را در دو جا (دو زبان) دستی نگه
می‌داشتیم، دیر یا زود از هم دور می‌شدند — و کاربر همان چیزی را می‌بیند که
بین دو نسخه فرق دارد.

اجرا:
    python3 tools/build-php-data.py

خروجی: deploy/php/data.php
"""

from __future__ import annotations

import importlib.util
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend" / "app"
OUT = ROOT / "deploy" / "php" / "data.php"


def load(name: str, path: pathlib.Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:  # pragma: no cover
        raise SystemExit(f"بارگذاری {path} ممکن نشد")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def php_str(value: str) -> str:
    return "'" + value.replace("\\", "\\\\").replace("'", "\\'") + "'"


def php_val(value, ind: int = 0) -> str:
    pad = "    " * ind
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        return php_str(value)
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):  # pragma: no cover - فعلاً داده‌ای نداریم
        return repr(value)
    if isinstance(value, list):
        if not value:
            return "array()"
        body = ",\n".join(pad + "    " + php_val(item, ind + 1) for item in value)
        return "array(\n" + body + ",\n" + pad + ")"
    if isinstance(value, dict):
        if not value:
            return "array()"
        body = ",\n".join(
            pad + "    " + php_str(str(k)) + " => " + php_val(v, ind + 1) for k, v in value.items()
        )
        return "array(\n" + body + ",\n" + pad + ")"
    raise TypeError(f"نوع پشتیبانی‌نشده: {type(value)!r}")


def block(value) -> str:
    """آرایه را با تورفتگی ثابت داخل بدنهٔ تابع می‌گذارد."""
    text = php_val(value)
    if "\n" not in text:
        return text
    first, *rest = text.split("\n")
    return first + "\n" + "\n".join("    " + line for line in rest).lstrip("\n")


def main() -> int:
    branding = load("fk_branding", BACKEND / "branding.py")
    features = load("fk_features", BACKEND / "features.py")

    parts: list[str] = ['<?php\n', """/**
 * داده‌های ثابت برنامه — تولید خودکار از منبع نسخهٔ پایتون
 * ======================================================
 * منبع: `backend/app/branding.py` و `backend/app/features.py`.
 *
 * چرا تولید خودکار؟ کاربر انتظار دارد فهرست «۱۲۰ قابلیت»، متن حق معنوی و
 * معرفی پدیدآورنده در هر دو نسخه کلمه‌به‌کلمه یکی باشد. اگر هر کدام را
 * جدا می‌نوشتیم، دیر یا زود از هم دور می‌شدند — و همان چیزی می‌شد که
 * کاربر شکایتش را کرد: «نسخهٔ PHP همهٔ آن چیزها را ندارد».
 *
 * این فایل را دستی ویرایش نکنید؛ اجرا کنید:
 *     python3 tools/build-php-data.py
 */

declare(strict_types=1);
"""]

    for key in ("APP_TITLE", "APP_SUBTITLE", "APP_VERSION", "APP_EDITION"):
        parts.append(f"const FK_{key} = {php_str(getattr(branding, key))};\n")

    parts.append("\n/** معرفی پدیدآورنده — همان ساختاری که `/api/system/meta` می‌فرستد */\n")
    parts.append("function fk_owner(): array\n{\n    return " + block(branding.OWNER) + ";\n}\n\n")

    texts = (
        ("fk_copyright_text", "COPYRIGHT_TEXT", "متن کامل حق معنوی و مالکیت فکری"),
        ("fk_install_welcome", "INSTALL_WELCOME", "متن خوش‌آمد نصب که کاربر باید بپذیرد"),
        ("fk_support_intro", "SUPPORT_INTRO", "یک خط معرفی پشتیبانی"),
    )
    for func, attr, doc in texts:
        parts.append(f"/** {doc} */\nfunction {func}(): string\n{{\n    return {php_str(getattr(branding, attr))};\n}}\n\n")

    parts.append("function fk_faq(): array\n{\n    return " + block(branding.FAQ) + ";\n}\n\n")
    parts.append(
        """/**
 * ۱۲۰ قابلیت — فهرست رسمی محصول در ۹ گروه.
 * همان آرایه‌ای که نسخهٔ پایتون به `/api/system/features` می‌فرستد.
 */
function fk_feature_groups(): array
{
    return """
        + block(features.FEATURE_GROUPS)
        + """;
}

/** تعداد کل (۱۲۰) — از خود آرایه حساب می‌شود تا هرگز با فهرست اختلاف پیدا نکند */
function fk_features_total(): int
{
    $n = 0;
    foreach (fk_feature_groups() as $g) {
        $n += count((array) ($g['items'] ?? array()));
    }
    return $n;
}

/** فهرست تخت با شماره و نام گروه — برای جست‌وجو و جدول */
function fk_features_flat(): array
{
    $out = array();
    $i = 0;
    foreach (fk_feature_groups() as $g) {
        foreach ((array) ($g['items'] ?? array()) as $title) {
            $i++;
            $out[] = array(
                'no' => $i,
                'group' => (string) ($g['title'] ?? ''),
                'title' => (string) $title,
            );
        }
    }
    return $out;
}
"""
    )

    OUT.write_text("".join(parts), encoding="utf-8")
    total = features.TOTAL
    assert total == sum(len(g["items"]) for g in features.FEATURE_GROUPS)
    print(f"✓ {OUT.relative_to(ROOT)} ساخته شد — {total} قابلیت در {len(features.FEATURE_GROUPS)} گروه")
    print(f"  حجم: {OUT.stat().st_size:,} بایت")
    return 0


if __name__ == "__main__":
    sys.exit(main())
