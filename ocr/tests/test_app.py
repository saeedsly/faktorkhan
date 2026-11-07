import json

import httpx
from fastapi.testclient import TestClient

from server.app import create_app
from server.vlm import VlmEngine


class FakeEngine:
    name = "fake"

    def recognize_bytes(self, data: bytes):
        if data == b"bad":
            raise ValueError("فایل تصویر معتبر نیست")
        if data == b"boom":
            raise RuntimeError("مدل خراب شد")
        return {"engine": self.name, "text": "متن", "variants": {"paddle": "متن", "raw": "نتم"},
                "lines": [{"text": "متن", "score": 0.9}], "seconds": 0.01, "decode": "paddle"}


class FakeVlm:
    name = "fake-vlm"

    def recognize_bytes(self, data: bytes):
        return {"engine": self.name, "text": "vlm-text", "variants": {"vlm": "vlm-text"},
                "lines": [], "seconds": 0.0, "decode": "vlm"}


def files(data=b"img"):
    return {"file": ("x.png", data, "image/png")}


def test_health_ok_with_engine():
    client = TestClient(create_app({"rapid": FakeEngine()}, serve_ui=False))
    body = client.get("/api/health").json()
    assert body["ok"] is True and body["engine"] == "fake"
    assert body["engines"]["rapid"]["ok"] is True


def test_ocr_roundtrip_default_engine():
    client = TestClient(create_app({"rapid": FakeEngine()}, serve_ui=False))
    res = client.post("/api/ocr", files=files())
    assert res.status_code == 200
    assert res.json()["text"] == "متن"
    assert res.json()["variants"]["raw"] == "نتم"


def test_ocr_selects_engine_by_query():
    client = TestClient(create_app({"rapid": FakeEngine(), "vlm": FakeVlm()}, serve_ui=False))
    res = client.post("/api/ocr?engine=vlm", files=files())
    assert res.status_code == 200
    assert res.json()["text"] == "vlm-text"


def test_unknown_engine_is_400():
    client = TestClient(create_app({"rapid": FakeEngine()}, serve_ui=False))
    assert client.post("/api/ocr?engine=nope", files=files()).status_code == 400


def test_bad_image_is_400_and_engine_failure_is_502():
    client = TestClient(create_app({"rapid": FakeEngine()}, serve_ui=False))
    assert client.post("/api/ocr", files=files(b"bad")).status_code == 400
    res = client.post("/api/ocr", files=files(b"boom"))
    assert res.status_code == 502
    assert "مدل خراب شد" in res.json()["detail"]


def test_without_engine_reports_reason_and_503():
    app = create_app({"rapid": None}, errors={"rapid": "مدل‌ها پیدا نشد"}, serve_ui=False)
    client = TestClient(app)
    health = client.get("/api/health").json()
    assert health["ok"] is False and "مدل‌ها" in health["error"]
    res = client.post("/api/ocr", files=files())
    assert res.status_code == 503
    assert "مدل‌ها" in res.json()["detail"]


def test_vlm_unavailable_shows_in_health_and_503():
    app = create_app({"rapid": FakeEngine(), "vlm": None}, errors={"vlm": "llama-server خاموش است"},
                     serve_ui=False)
    client = TestClient(app)
    health = client.get("/api/health").json()
    assert health["engines"]["vlm"]["ok"] is False
    assert client.post("/api/ocr?engine=vlm", files=files()).status_code == 503


def test_ui_is_served_when_enabled():
    client = TestClient(create_app({"rapid": None}, errors={"rapid": "x"}, serve_ui=True))
    res = client.get("/")
    assert res.status_code == 200
    assert "فاکتورخوان" in res.text


def _vlm_transport(seen: list):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/health":
            return httpx.Response(200, json={"status": "ok"})
        seen.append(json.loads(request.content))
        return httpx.Response(200, json={"choices": [{"message": {"content": "  فاکتور ۱۴۰۵  "}}]})
    return httpx.MockTransport(handler)


def test_vlm_engine_sends_image_and_returns_text():
    seen = []
    engine = VlmEngine("http://llama.test", transport=_vlm_transport(seen))
    result = engine.recognize_bytes(b"\x89PNG-fake")
    assert result["text"] == "فاکتور ۱۴۰۵"
    content = seen[0]["messages"][0]["content"]
    assert content[0]["type"] == "image_url"
    assert content[0]["image_url"]["url"].startswith("data:image/png;base64,")
    assert seen[0]["temperature"] == 0


def test_vlm_health_and_empty_input():
    engine = VlmEngine("http://llama.test", transport=_vlm_transport([]))
    assert engine.health()["ok"] is True
    try:
        engine.recognize_bytes(b"")
    except ValueError:
        pass
    else:
        raise AssertionError("باید ValueError بدهد")


def test_vlm_unreachable_health_reports_error():
    def refuse(request):
        raise httpx.ConnectError("connection refused", request=request)
    engine = VlmEngine("http://llama.test", transport=httpx.MockTransport(refuse))
    status = engine.health()
    assert status["ok"] is False
    assert "llama-server" in status["error"]
