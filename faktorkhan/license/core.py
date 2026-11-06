""" هسته مدیریت لایسنس آفلاین.

ویژگی‌ها:
- بصمہ ماشین (HWID) برای بستن لایسنس به یک سخت‌افزار
- رمزنگاری AES-256-GCM فایل لایسنس
- امضا HMAC-SHA256 برای تغییر ناپذیری
- بررسی انقضا، روزمه مهلت (grace)،agleگałFeatures
- قفل کردن برنامه در صورت انقضا
"""

from __future__ import annotations

import hashlib
import json
import os
import platform
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from faktorkhan.config import (
    LICENSE_APP_SECRET,
    LICENSE_GRACE_DAYS,
    LICENSE_MASTER_SECRET,
)
from faktorkhan.security.crypto import (
    decrypt_payload,
    encrypt_payload,
    sign_payload,
    verify_signature,
)


def compute_hwid() -> str:
    """بصمہ یکتا از composite spezifikات سخت‌افزاری."""
    parts = [
        platform.node() or "",
        platform.machine() or "",
        platform.processor() or "",
        platform.system() or "",
    ]
    try:
        parts.append(str(uuid.getnode()))
    except Exception:  # pragma: no cover - محیط‌های غیرمعمول
        parts.append("unknown")
    return hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()


@dataclass
class License:
    customer: str
    plan: str
    expires_at: str  # ISO 8601 UTC
    hwid: str
    issued_at: str
    features: list[str] = field(default_factory=list)
    signature: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "customer": self.customer,
            "plan": self.plan,
            "expires_at": self.expires_at,
            "hwid": self.hwid,
            "issued_at": self.issued_at,
            "features": self.features,
            "signature": self.signature,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "License":
        return cls(
            customer=data["customer"],
            plan=data["plan"],
            expires_at=data["expires_at"],
            hwid=data["hwid"],
            issued_at=data.get("issued_at", ""),
            features=list(data.get("features", [])),
            signature=data.get("signature", ""),
        )


@dataclass
class LicenseStatus:
    valid: bool
    message: str
    days_remaining: int | None = None
    expired: bool = False
    grace: bool = False
    features: list[str] = field(default_factory=list)
    plan: str = ""
    customer: str = ""


class LicenseManager:
    """مدیریت چرخه حیات لایسنس در سمت کلاینت."""

    def __init__(
        self,
        app_secret: str = LICENSE_APP_SECRET,
        master_secret: str = LICENSE_MASTER_SECRET,
        hwid: str | None = None,
    ) -> None:
        self.app_secret = app_secret
        self.master_secret = master_secret
        self.hwid = hwid or compute_hwid()
        self._license: License | None = None
        self._status: LicenseStatus | None = None

    # ------------------------------------------------------------------ #
    # فعال‌سازی لایسنس از فایل
    # ------------------------------------------------------------------ #
    def activate(self, license_path: str | Path) -> LicenseStatus:
        path = Path(license_path)
        if not path.exists():
            return LicenseStatus(
                valid=False,
                message="فایل لایسنس یافت نشد.",
                expired=True,
            )

        try:
            envelope = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as exc:
            return LicenseStatus(
                valid=False,
                message=f"فایل لایسنس نامعتبر است: {exc}",
                expired=True,
            )

        # decoding payload (رمزنگاری با کلید اصلی)
        try:
            payload = decrypt_payload(envelope, self.master_secret)
        except Exception as exc:  # nonce/salt/ciphertext نامعتبر
            return LicenseStatus(
                valid=False,
                message=f"تک رمزنگاری لایسنس شکست خورد: {exc}",
                expired=True,
            )

        # Verify amza digital (امضا محاسبه شده روی Payload بدون کلید امضا)
        verify_payload = {k: v for k, v in payload.items() if k != "signature"}
        if not verify_signature(verify_payload, payload.get("signature"), self.app_secret):
            return LicenseStatus(
                valid=False,
                message="امضای دیجیتال لایسنس نامعتبر است (فایل دستکاری شده).",
                expired=True,
            )

        license_obj = License.from_dict(payload)
        self._license = license_obj
        return self._evaluate(license_obj)

    # ------------------------------------------------------------------ #
    # ارزیابی وضعیت لایسنس
    # ------------------------------------------------------------------ #
    def _evaluate(self, license_obj: License) -> LicenseStatus:
        now = datetime.now(timezone.utc)
        try:
            expires_at = datetime.fromisoformat(license_obj.expires_at)
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)
        except ValueError:
            return LicenseStatus(
                valid=False,
                message="تاریخ انقضا لایسنس نامعتبر است.",
                expired=True,
            )

        hwid_ok = license_obj.hwid == self.hwid
        delta = expires_at - now
        days_remaining = max(delta.days, 0)
        expired = now > expires_at
        grace = expired and days_remaining >= -LICENSE_GRACE_DAYS

        valid = hwid_ok and (not expired or grace)

        if not hwid_ok:
            message = "لایسنس برای این دستگاه صادر نشده است."
        elif expired and not grace:
            message = "اشتراک منقضی شده است. لطفاً لایسنس جدید خریداری کنید."
        elif expired and grace:
            message = f"اشتراک منقضی شده است (مهلت {LICENSE_GRACE_DAYS} روزه فعال است)."
        else:
            message = f"لایسنس فعال است تا {license_obj.expires_at[:10]}"

        status = LicenseStatus(
            valid=valid,
            message=message,
            days_remaining=days_remaining if not expired else 0,
            expired=expired,
            grace=grace,
            features=list(license_obj.features),
            plan=license_obj.plan,
            customer=license_obj.customer,
        )
        self._status = status
        return status

    # ------------------------------------------------------------------ #
    # کوئری‌های سطح بالا
    # ------------------------------------------------------------------ #
    def validate(self) -> LicenseStatus:
        if self._status is not None:
            return self._status
        # لایسنس فعال نشده: trial مجازی ۷ روزه
        return LicenseStatus(
            valid=False,
            message="لایسنس فعال نشده است. فایل لایسنس را بارگذاری کنید.",
            expired=True,
        )

    def is_valid(self) -> bool:
        return self.validate().valid

    def feature_enabled(self, feature: str) -> bool:
        status = self.validate()
        return status.valid and feature in status.features

    def days_remaining(self) -> int | None:
        return self.validate().days_remaining

    def current_license(self) -> License | None:
        return self._license

    def generate_trial_license(
        self,
        customer: str,
        plan: str = "trial",
        days: int = 7,
        features: list[str] | None = None,
    ) -> dict[str, Any]:
        """ساخت یک لایسنس تست (فقط برای محیط توسعه/نمایش)."""
        now = datetime.now(timezone.utc)
        license_obj = License(
            customer=customer,
            plan=plan,
            expires_at=(now + timedelta(days=days)).isoformat(),
            hwid=self.hwid,
            issued_at=now.isoformat(),
            features=features or ["basic"],
        )
        # امضا روی payload قبل از رمزنگاری
        license_obj.signature = sign_payload(
            {
                "customer": license_obj.customer,
                "plan": license_obj.plan,
                "expires_at": license_obj.expires_at,
                "hwid": license_obj.hwid,
                "issued_at": license_obj.issued_at,
                "features": license_obj.features,
            },
            self.app_secret,
        )
        envelope = encrypt_payload(license_obj.to_dict(), self.master_secret)
        return envelope

    def save_license_file(self, license_path: str | Path) -> None:
        if self._license is None:
            raise RuntimeError("هیچ لایسنس فعالynu نیست.")
        Path(license_path).write_text(
            json.dumps(self._license.to_dict(), indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
