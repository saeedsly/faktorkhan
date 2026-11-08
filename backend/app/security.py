"""امنیت: هش رمز، توکن JWT، رمزنگاری توکن سرویس ابری، تولید کلید اشتراک."""
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from cryptography.fernet import Fernet, InvalidToken
from passlib.context import CryptContext

from .config import settings

pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")

# ------------------------------------------------------------ رمز عبور
def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    try:
        return pwd_context.verify(password, hashed)
    except Exception:
        return False


# ------------------------------------------------------------ JWT
def _jwt_secret() -> str:
    return settings.SECRET_KEY or "change-me-in-production"


def create_access_token(subject: str, extra: dict[str, Any] | None = None, hours: int | None = None) -> str:
    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": str(subject),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=hours or settings.TOKEN_TTL_HOURS)).timestamp()),
        "jti": secrets.token_hex(8),
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, _jwt_secret(), algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str) -> dict[str, Any] | None:
    try:
        return jwt.decode(token, _jwt_secret(), algorithms=[settings.JWT_ALGORITHM])
    except jwt.PyJWTError:
        return None


# ------------------------------------------------------------ رمزنگاری توکن ابری
def _fernet() -> Fernet:
    digest = hashlib.sha256((settings.ENCRYPTION_KEY or "dev-key").encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_secret(plain: str) -> str:
    if not plain:
        return ""
    return _fernet().encrypt(plain.encode("utf-8")).decode("ascii")


def decrypt_secret(cipher: str) -> str:
    if not cipher:
        return ""
    try:
        return _fernet().decrypt(cipher.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError):
        return ""


def mask_secret(value: str, visible: int = 4) -> str:
    """نمایش امن توکن: فقط چند کاراکتر آخر.

    هرگز ابتدای توکن نمایش داده نمی‌شود؛ اگر توکن کوتاه باشد کاملاً پوشانده می‌شود.
    """
    if not value:
        return ""
    if len(value) <= visible * 3:
        return "•" * 12
    return f"{'•' * 12}{value[-visible:]}"


def fingerprint(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:16]


# ------------------------------------------------------------ کلید اشتراک
_KEY_ALPHABET = "ACDEFGHJKLMNPQRTUVWXY3456789"   # بدون کاراکترهای مشابه


def _key_block(n: int = 4) -> str:
    return "".join(secrets.choice(_KEY_ALPHABET) for _ in range(n))


def generate_license_key(prefix: str = "FK") -> str:
    """کلیدهایی مثل FK-7K4M-9QXA-3DTU-H2NR با رقم کنترلی."""
    blocks = [_key_block() for _ in range(4)]
    body = "".join(blocks)
    checksum = hashlib.sha256(body.encode()).hexdigest().upper()[:2]
    return f"{prefix}-{'-'.join(blocks)}-{checksum}"


def normalize_license_key(raw: str) -> str:
    return (raw or "").strip().upper().replace(" ", "-")


def license_key_is_wellformed(raw: str) -> bool:
    key = normalize_license_key(raw)
    parts = key.split("-")
    if len(parts) != 6 or parts[0] != "FK":
        return False
    body = "".join(parts[1:5])
    checksum = hashlib.sha256(body.encode()).hexdigest().upper()[:2]
    return hmac.compare_digest(checksum, parts[5])


def random_hex(n: int = 16) -> str:
    return secrets.token_hex(n)
