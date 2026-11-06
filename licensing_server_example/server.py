"""سرور لایسنس فاکتورخوان (マイ próprios میزبانی کنید).

این ماژول بخشی از پای خودانه است و نباید در ریپازیتوری عمومی قرار بگیرد.
استفاده از پایتون استاندارد (بدون وابستگی دیپلوینت).
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from faktorkhan.security.crypto import decrypt_payload, encrypt_payload, sign_payload, verify_signature
from faktorkhan.config import LICENSE_APP_SECRET, LICENSE_MASTER_SECRET

HOST = "0.0.0.0"
PORT = 8080
KEY_DIR = Path(__file__).resolve().parent / "keys"
KEY_DIR.mkdir(parents=True, exist_ok=True)


class LicenseHandler(BaseHTTPRequestHandler):
    def _send(self, code: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            self._send(400, {"error": "invalid json"})
            return

        if self.path == "/validate":
            self._handle_validate(data)
        elif self.path == "/issue":
            self._handle_issue(data)
        else:
            self._send(404, {"error": "not found"})

    def _handle_validate(self, data: dict) -> None:
        envelope = data.get("license")
        hwid = data.get("hwid", "")
        if not envelope:
            self._send(400, {"valid": False, "message": "license missing"})
            return
        try:
            payload = decrypt_payload(envelope, LICENSE_MASTER_SECRET)
        except Exception:
            self._send(200, {"valid": False, "message": "cannot decrypt license"})
            return

        if not verify_signature(payload, payload.get("signature"), LICENSE_APP_SECRET):
            self._send(200, {"valid": False, "message": "invalid signature"})
            return

        now = datetime.now(timezone.utc)
        try:
            expires = datetime.fromisoformat(payload["expires_at"])
            if expires.tzinfo is None:
                expires = expires.replace(tzinfo=timezone.utc)
        except Exception:
            self._send(200, {"valid": False, "message": "invalid expires_at"})
            return

        days = max((expires - now).days, 0)
        valid = (payload.get("hwid") == hwid or not hwid) and now <= expires
        self._send(
            200,
            {
                "valid": valid,
                "message": "ok" if valid else "expired or device mismatch",
                "days_remaining": days,
                "plan": payload.get("plan"),
                "customer": payload.get("customer"),
            },
        )

    def _handle_issue(self, data: dict) -> None:
        customer = data.get("customer", "مشتری")
        plan = data.get("plan", "annual")
        days = int(data.get("days", 365))
        hwid = data.get("hwid", "")
        features = data.get("features", ["basic", "ocr", "excel", "history"])

        from faktorkhan.license.core import LicenseManager

        mgr = LicenseManager()
        envelope = mgr.generate_trial_license(customer=customer, plan=plan, days=days, features=features)
        # overwrite hwid with requested one
        try:
            payload = decrypt_payload(envelope, LICENSE_MASTER_SECRET)
            payload["hwid"] = hwid or mgr.hwid
            payload["signature"] = sign_payload(
                {k: v for k, v in payload.items() if k != "signature"}, LICENSE_APP_SECRET
            )
            envelope = encrypt_payload(payload, LICENSE_MASTER_SECRET)
        except Exception as exc:
            self._send(500, {"error": str(exc)})
            return

        out = KEY_DIR / f"license_{customer}.json"
        out.write_text(json.dumps(envelope, indent=2, ensure_ascii=False), encoding="utf-8")
        self._send(200, {"status": "issued", "file": str(out)})


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), LicenseHandler)
    print(f"فاکتورخوان لایسنس سرور روی http://{HOST}:{PORT} اجرا شد")
    server.serve_forever()


if __name__ == "__main__":
    main()
