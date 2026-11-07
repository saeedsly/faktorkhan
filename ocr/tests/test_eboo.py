"""تست موتور eBoo با MockTransport (بدون اینترنت و بدون صرف اعتبار)."""

import json
import re
from urllib.parse import parse_qs

import httpx
import pytest
from fastapi.testclient import TestClient

from server.app import create_app
from server.eboo import EbooEngine, EbooError, _filename_for, engine_from_env

TOKEN = "TEST-TOKEN-do-not-leak-123"
PNG = b"\x89PNG\r\n\x1a\n" + b"fake-image-bytes"


def form_fields(request: httpx.Request) -> dict:
    """فیلدهای فرم را هم برای urlencoded و هم برای multipart می‌خواند."""
    body = request.content.decode("utf-8", "replace")
    if "multipart/form-data" in request.headers.get("content-type", ""):
        return {m.group(1): m.group(2) for m in re.finditer(r'name="(\w+)"\r\n\r\n([^\r\n]*)', body)}
    return {k: v[0] for k, v in parse_qs(body).items()}


class FakeEboo:
    """پاسخ‌های ساختگی API؛ هر درخواست ثبت می‌شود."""

    def __init__(self, convert_reply=None, add_status="Done", checkconvert_reply=None):
        self.calls = []
        self.convert_reply = convert_reply
        self.add_status = add_status
        self.checkconvert_reply = checkconvert_reply

    def __call__(self, request: httpx.Request) -> httpx.Response:
        fields = form_fields(request)
        command = fields.get("command", "?")
        self.calls.append({"command": command, "fields": fields, "body": request.content.decode("utf-8", "replace")})
        if command == "addfile":
            return httpx.Response(200, json={"Status": self.add_status, "PageCount": "1",
                                             "FileToken": "tok123", "ConvertMethods": "1,2,3,4"})
        if command == "convert":
            reply = self.convert_reply if self.convert_reply is not None else "متن فاکتور ۱۲۳"
            return httpx.Response(200, text=reply if isinstance(reply, str) else json.dumps(reply))
        if command == "checkconvert":
            return httpx.Response(200, json=self.checkconvert_reply or {"Status": "Done", "Output": "از polling"})
        if command == "deletefile":
            return httpx.Response(200, json={"Status": "DeleteDone"})
        return httpx.Response(200, json={"Status": "Done", "OCRCredit": "210"})

    def commands(self):
        return [c["command"] for c in self.calls]


def make_engine(fake, poll=0.0):
    return EbooEngine(TOKEN, transport=httpx.MockTransport(fake), poll_seconds=poll)


def test_full_flow_sends_expected_commands_and_deletes_file():
    fake = FakeEboo()
    result = make_engine(fake).recognize_bytes(PNG)
    assert fake.commands() == ["addfile", "convert", "deletefile"]
    assert result["text"] == "متن فاکتور ۱۲۳"
    assert result["decode"] == "ebo"
    assert result["model_files"]["method"] == "4"
    fields = fake.calls[1]["fields"]
    assert fields["method"] == "4"
    assert fields["output"] == "txtraw"
    assert fields["filetoken"] == "tok123"
    assert fields["token"] == TOKEN


def test_addfile_sends_image_with_detected_name():
    fake = FakeEboo()
    make_engine(fake).recognize_bytes(PNG)
    assert 'filename="invoice.png"' in fake.calls[0]["body"]


def test_json_output_field_is_used():
    fake = FakeEboo(convert_reply={"Status": "Done", "Output": "خروجی JSON"})
    assert make_engine(fake).recognize_bytes(PNG)["text"] == "خروجی JSON"


def test_async_convert_is_polled_with_checkconvert():
    fake = FakeEboo(convert_reply={"Status": "Converting", "Progress": "18%"})
    result = make_engine(fake).recognize_bytes(PNG)
    assert "checkconvert" in fake.commands()
    assert result["text"] == "از polling"


def test_error_status_raises_persian_message_and_still_deletes():
    fake = FakeEboo(add_status="NoEnoughCredit")
    with pytest.raises(EbooError) as info:
        make_engine(fake).recognize_bytes(PNG)
    assert info.value.code == "NoEnoughCredit"
    assert "اعتبار" in str(info.value)
    assert "deletefile" not in fake.commands()  # فایلی ثبت نشده بود


def test_convert_error_still_deletes_uploaded_file():
    def handler(request):
        if form_fields(request).get("command") == "convert":
            return httpx.Response(200, json={"Status": "ConvertError"})
        return FakeEboo()(request)

    fake = FakeEboo()
    with pytest.raises(EbooError):
        EbooEngine(TOKEN, transport=httpx.MockTransport(handler), poll_seconds=0).recognize_bytes(PNG)


def test_token_never_appears_in_errors():
    fake = FakeEboo(add_status="IPError")
    with pytest.raises(EbooError) as info:
        make_engine(fake).recognize_bytes(PNG)
    assert TOKEN not in str(info.value)
    assert TOKEN not in repr(info.value)


def test_http_failure_gives_clear_error():
    def handler(request):
        return httpx.Response(500, text="boom")

    with pytest.raises(EbooError) as info:
        EbooEngine(TOKEN, transport=httpx.MockTransport(handler)).recognize_bytes(PNG)
    assert info.value.code == "500"


def test_empty_file_and_empty_token_are_rejected():
    with pytest.raises(ValueError):
        make_engine(FakeEboo()).recognize_bytes(b"")
    with pytest.raises(ValueError):
        EbooEngine("   ")


def test_engine_off_without_env_token(monkeypatch):
    assert engine_from_env({}) is None
    assert engine_from_env({"EBOO_TOKEN": "  "}) is None
    assert isinstance(engine_from_env({"EBOO_TOKEN": TOKEN}), EbooEngine)


def test_filename_detection_from_content():
    assert _filename_for(PNG, "x.bin") == "invoice.png"
    assert _filename_for(b"\xff\xd8\xff\xe0rest", "x.bin") == "invoice.jpg"
    assert _filename_for(b"%PDF-1.7", "x.bin") == "invoice.pdf"
    assert _filename_for(b"unknown", "fallback.bin") == "fallback.bin"


class _Ok:
    name = "rapid-fake"

    def recognize_bytes(self, data):
        return {"engine": self.name, "text": "x", "decode": "paddle", "variants": {"paddle": "x"},
                "seconds": 0.0, "lines": []}


def test_app_exposes_ebo_only_when_engine_present_and_hides_token():
    eboo = make_engine(FakeEboo())
    client = TestClient(create_app({"rapid": _Ok(), "ebo": eboo}, serve_ui=False))
    health = client.get("/api/health").json()
    assert health["engines"]["ebo"]["ok"] is True
    assert TOKEN not in json.dumps(health, ensure_ascii=False)

    without = TestClient(create_app({"rapid": _Ok()}, serve_ui=False)).get("/api/health").json()
    assert "ebo" not in without["engines"]
