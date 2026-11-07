"""سرور محلی ساده برای public/ با MIME درست برای WebAssembly. روی 0.0.0.0 گوش می‌دهد."""

import functools
import http.server
import mimetypes
import os
import sys

mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("application/javascript", ".js")
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public")
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=root)
with http.server.ThreadingHTTPServer(("0.0.0.0", port), handler) as httpd:
    print(f"serving {root} on 0.0.0.0:{port}", flush=True)
    httpd.serve_forever()
