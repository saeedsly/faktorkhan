"""تست‌های لایه امنیتی."""

from __future__ import annotations

from faktorkhan.security.crypto import decrypt_payload, encrypt_payload, sign_payload, verify_signature


def test_encrypt_decrypt_roundtrip():
    payload = {"customer": "ali", "plan": "annual", "expires_at": "2027-01-01T00:00:00+00:00"}
    secret = "s3cr3t"
    envelope = encrypt_payload(payload, secret)
    assert set(envelope) == {"alg", "kdf", "salt", "nonce", "ciphertext"}
    assert decrypt_payload(envelope, secret) == payload


def test_tamper_detection():
    payload = {"a": 1}
    secret = "s"
    envelope = encrypt_payload(payload, secret)
    envelope["ciphertext"] = "00" * 16
    try:
        decrypt_payload(envelope, secret)
        assert False, "بغيَد باید شکست بخورد"
    except Exception:
        pass


def test_hmac_signing():
    payload = {"x": "y"}
    sig = sign_payload(payload, "k")
    assert verify_signature(payload, sig, "k") is True
    assert verify_signature(payload, sig, "wrong") is False
    assert verify_signature(payload, None, "k") is False
