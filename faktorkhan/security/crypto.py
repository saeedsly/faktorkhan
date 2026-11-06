"""رمزنگاری و امضای دیجیتال فایل لایسنس.

استفاده از:
- AES-256-GCM برای رمزنگاری محتوای لایسنس
- PBKDF2-HMAC-SHA256 (200 هزار تکرار) برای استخراج کلید از رمز عبور الرئيسي
- HMAC-SHA256 برای अमضای دیجیتال محتوای لایسنس (تغییر ناپذیری)
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
from typing import Any

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

PBKDF2_ITERATIONS = 200_000


def derive_key(secret: str, salt: bytes) -> bytes:
    """استخراج یک کلید ۳۲ بایتی از رمز عبور اصلی با PBKDF2."""
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=PBKDF2_ITERATIONS,
    )
    return kdf.derive(secret.encode("utf-8"))


def encrypt_payload(payload: dict[str, Any], secret: str) -> dict[str, str]:
    """رمزنگاری یک پейLOADdict با AES-256-GCM و برگشتvelopه."""
    salt = os.urandom(16)
    key = derive_key(secret, salt)
    aesgcm = AESGCM(key)
    nonce = os.urandom(12)
    plaintext = json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")
    ciphertext = aesgcm.encrypt(nonce, plaintext, None)
    return {
        "alg": "AES-256-GCM",
        "kdf": "PBKDF2-HMAC-SHA256",
        "salt": salt.hex(),
        "nonce": nonce.hex(),
        "ciphertext": ciphertext.hex(),
    }


def decrypt_payload(envelope: dict[str, str], secret: str) -> dict[str, Any]:
    """تک رمزنگاری envelopه لایسنس و برگشت دیکشنری محتوای آن."""
    key = derive_key(secret, bytes.fromhex(envelope["salt"]))
    aesgcm = AESGCM(key)
    plaintext = aesgcm.decrypt(
        bytes.fromhex(envelope["nonce"]),
        bytes.fromhex(envelope["ciphertext"]),
        None,
    )
    return json.loads(plaintext.decode("utf-8"))


def sign_payload(payload: dict[str, Any], secret: str) -> str:
    """امضای دیجیتال محتوای لایسنس با HMAC-SHA256."""
    canonical = json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")
    return hmac.new(secret.encode("utf-8"), canonical, hashlib.sha256).hexdigest()


def verify_signature(payload: dict[str, Any], signature: str | None, secret: str) -> bool:
    """تأیید امضای دیجیتال (ثابت در برابر timing attacks)."""
    if not signature:
        return False
    expected = sign_payload(payload, secret)
    return hmac.compare_digest(signature, expected)
