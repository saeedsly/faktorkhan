"""تست‌های هسته لایسنس."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

from faktorkhan.license.core import LicenseManager, compute_hwid


def _write_license(manager: LicenseManager, suffix: str = "") -> Path:
    env = manager.generate_trial_license(
        customer="تست مشتری",
        plan="trial",
        days=7,
        features=["basic", "ocr", "excel"],
    )
    p = Path(tempfile.mkdtemp()) / f"license{suffix}.json"
    p.write_text(json.dumps(env), encoding="utf-8")
    return p


def test_activate_valid_trial():
    manager = LicenseManager()
    path = _write_license(manager)
    status = manager.activate(path)
    assert status.valid is True
    assert status.plan == "trial"
    assert status.days_remaining is not None and status.days_remaining >= 0


def test_hwid_mismatch():
    manager = LicenseManager(hwid="deadbeef" * 8)  # دستگاه متفاوت
    path = _write_license(LicenseManager())  # لایسنس برای دستگاه اصلی
    status = manager.activate(path)
    assert status.valid is False
    assert "دستگاه" in status.message or "نامعتبر" in status.message


def test_tampered_signature():
    manager = LicenseManager()
    path = _write_license(manager)
    envelope = json.loads(path.read_text(encoding="utf-8"))
    envelope["ciphertext"] = "ff" * 32  # دسکاری
    path.write_text(json.dumps(envelope), encoding="utf-8")
    status = manager.activate(path)
    assert status.valid is False


def test_feature_enabled():
    manager = LicenseManager()
    path = _write_license(manager)
    manager.activate(path)
    assert manager.feature_enabled("ocr") is True
    assert manager.feature_enabled("nonexistent") is False


def test_compute_hwid_deterministic():
    assert compute_hwid() == compute_hwid()
    assert len(compute_hwid()) == 64
