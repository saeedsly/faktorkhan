from fastapi.testclient import TestClient

from server.app import create_app


class FakeEngine:
    name = "fake"

    def recognize_bytes(self, data: bytes):
        if data == b"bad":
            raise ValueError("فایل تصویر معتبر نیست")
        return {"engine": self.name, "text": "متن", "variants": {"paddle": "متن", "raw": "نتم"},
                "lines": [{"text": "متن", "score": 0.9}], "seconds": 0.01, "decode": "paddle"}


def test_health_ok_with_engine():
    client = TestClient(create_app(FakeEngine(), serve_ui=False))
    body = client.get("/api/health").json()
    assert body == {"ok": True, "engine": "fake", "error": None}


def test_ocr_roundtrip_with_fake_engine():
    client = TestClient(create_app(FakeEngine(), serve_ui=False))
    res = client.post("/api/ocr", files={"file": ("x.png", b"img", "image/png")})
    assert res.status_code == 200
    assert res.json()["text"] == "متن"
    assert res.json()["variants"]["raw"] == "نتم"


def test_ocr_bad_image_returns_400():
    client = TestClient(create_app(FakeEngine(), serve_ui=False))
    res = client.post("/api/ocr", files={"file": ("x.png", b"bad", "image/png")})
    assert res.status_code == 400


def test_without_engine_reports_reason_and_503():
    app = create_app(None, engine_error="مدل‌ها پیدا نشد", serve_ui=False)
    client = TestClient(app)
    assert client.get("/api/health").json()["ok"] is False
    res = client.post("/api/ocr", files={"file": ("x.png", b"img", "image/png")})
    assert res.status_code == 503
    assert "مدل‌ها" in res.json()["detail"]


def test_ui_is_served_when_enabled():
    client = TestClient(create_app(None, engine_error="x", serve_ui=True))
    res = client.get("/")
    assert res.status_code == 200
    assert "فاکتورخوان" in res.text
