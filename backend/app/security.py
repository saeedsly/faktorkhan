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

from .config import settings

# ------------------------------------------------------------ رمز عبور
#
# پیش‌تر از passlib استفاده می‌شد. passlib از ۲۰۲۰ به بعد نگه‌داری نمی‌شود و
# روی پایتون ۳.۱۳ (که در ویندوز ۱۰ به‌سادگی نصب می‌شود) با خطای
# «crypt is deprecated» از کار می‌افتد. این‌جا همان الگوریتم
# pbkdf2_sha256 را با hashlib استاندارد پیاده کرده‌ایم تا:
#   • هیچ وابستگی خارجی لازم نباشد،
#   • هش‌های قدیمی که passlib ساخته بود همچنان معتبر بمانند.

PBKDF2_ROUNDS = 29000          # همان عددی که passlib استفاده می‌کرد
PBKDF2_PREFIX = "$pbkdf2-sha256$"


def _b64_crypt(data: bytes) -> str:
    """base64 سازگار با passlib: «+/» به «.» تبدیل می‌شود و = حذف می‌شود."""
    return base64.b64encode(data).decode("ascii").rstrip("=").replace("+", ".")


def _b64_crypt_decode(text: str) -> bytes:
    raw = text.replace(".", "+")
    raw += "=" * (-len(raw) % 4)
    return base64.b64decode(raw)


def hash_password(password: str, rounds: int = PBKDF2_ROUNDS) -> str:
    """هش رمز با قالب دقیقاً یکسان با passlib (سازگاری با کاربران موجود)."""
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, rounds, 32)
    return f"{PBKDF2_PREFIX}{rounds}${_b64_crypt(salt)}${_b64_crypt(digest)}"


def verify_password(password: str, hashed: str) -> bool:
    """بررسی رمز؛ هش‌های قدیمی passlib و هش‌های تازه هر دو پذیرفته می‌شوند."""
    if not hashed or not password:
        return False
    try:
        if hashed.startswith(PBKDF2_PREFIX):
            _, _, rounds_s, salt_s, digest_s = hashed.split("$")
            rounds = int(rounds_s)
            salt = _b64_crypt_decode(salt_s)
            expected = _b64_crypt_decode(digest_s)
            actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, rounds, len(expected))
            return hmac.compare_digest(actual, expected)
        # قالب‌های دیگر (مثلاً bcrypt قدیمی) → تلاش با passlib فقط اگر نصب باشد
        from passlib.context import CryptContext  # noqa: PLC0415
        return CryptContext(schemes=["bcrypt", "pbkdf2_sha256"]).verify(password, hashed)
    except Exception:
        return False


def needs_rehash(hashed: str) -> bool:
    """آیا این هش با تنظیمات فعلی ساخته نشده و باید بازسازی شود؟"""
    if not hashed.startswith(PBKDF2_PREFIX):
        return True
    try:
        rounds = int(hashed.split("$")[2])
    except (IndexError, ValueError):
        return True
    return rounds < PBKDF2_ROUNDS


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
