"""تولید گذرواژهٔ تصادفی برای کاربر پایگاه داده (بدون آرگومان)."""
import secrets
import string

ALPHABET = string.ascii_letters + string.digits + "_-"
print("Fk" + "".join(secrets.choice(ALPHABET) for _ in range(18)))
