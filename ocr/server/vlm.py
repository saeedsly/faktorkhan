"""موتور VLM اختیاری (مثلاً Qwen3-VL-8B یا 4B) از طریق llama-server (llama.cpp).

هدف: دست‌نویس و فاکتورهای سخت. مدل تصویر را مستقیم می‌خواند و متن منطقی برمی‌گرداند
(ترتیب معکوس‌سازی لازم نیست). روی CPU کند است؛ برای مقایسه با PP-OCRv5 استفاده کنید.

راه‌اندازی (نمونه؛ مدل و mmproj را از Hugging Face دانلود کنید):
    llama-server -m Qwen3-VL-8B-Instruct-Q4_K_M.gguf --mmproj mmproj-F16.gguf --port 8080
    python -m server --vlm-url http://127.0.0.1:8080
"""

from __future__ import annotations

import base64
import time
from typing import Any

import httpx

DEFAULT_PROMPT = (
    "این تصویر یک فاکتور یا سند فارسی است. تمام متن آن را دقیقاً همان‌طور که نوشته شده، "
    "از بالا به پایین و از راست به چپ بخوان. ارقام را همان‌طور که هستند نگه دار. "
    "فقط متن را بنویس؛ توضیح اضافه نده."
)


class VlmEngine:
    name = "Qwen3-VL (llama-server)"

    def __init__(self, base_url: str, model: str = "qwen3-vl", prompt: str = DEFAULT_PROMPT,
                 timeout: float = 900.0, transport: httpx.BaseTransport | None = None):
        self.model = model
        self.prompt = prompt
        self.base_url = base_url.rstrip("/")
        self.client = httpx.Client(base_url=self.base_url, timeout=timeout, transport=transport)

    def health(self) -> dict[str, Any]:
        try:
            res = self.client.get("/health")
            ok = res.status_code == 200
            return {"ok": ok, "engine": self.name, "error": None if ok else f"HTTP {res.status_code}"}
        except httpx.HTTPError as exc:
            return {"ok": False, "engine": self.name, "error": f"llama-server در دسترس نیست: {exc}"}

    def recognize_bytes(self, data: bytes) -> dict[str, Any]:
        if not data:
            raise ValueError("فایل خالی است.")
        mime = "image/jpeg" if data[:2] == b"\xff\xd8" else "image/png"
        image_url = f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}"
        payload = {
            "model": self.model,
            "temperature": 0,
            "max_tokens": 4096,
            "messages": [{
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": image_url}},
                    {"type": "text", "text": self.prompt},
                ],
            }],
        }
        started = time.perf_counter()
        res = self.client.post("/v1/chat/completions", json=payload)
        res.raise_for_status()
        text = res.json()["choices"][0]["message"]["content"].strip()
        return {
            "engine": self.name,
            "model_files": {"model": self.model},
            "decode": "vlm",
            "text": text,
            "variants": {"vlm": text},
            "lines": [],
            "seconds": round(time.perf_counter() - started, 3),
        }
