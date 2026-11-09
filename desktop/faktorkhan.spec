# -*- mode: python ; coding: utf-8 -*-
"""
فایل ساخت نسخه ویندوزی فاکتورخوان با PyInstaller
اجرا:  pyinstaller faktorkhan.spec --noconfirm
اثر: سعید سالاری
"""
import sys
from pathlib import Path

ROOT = Path(SPECPATH)                  # پوشه desktop
PROJECT = ROOT.parent                  # ریشه پروژه

datas = [
    (str(PROJECT / "frontend"), "frontend"),
    (str(PROJECT / "desktop" / "installer" / "copyright_fa.txt"), "."),
]
for extra in ("backend/app",):
    src = PROJECT / extra
    if src.is_dir():
        datas.append((str(src), extra))

hiddenimports = [
    "uvicorn.logging", "uvicorn.loops.auto", "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets.auto", "uvicorn.lifespan.on",
    "app.main", "app.routers.auth", "app.routers.billing", "app.routers.invoices",
    "app.routers.ocr", "app.routers.admin", "app.routers.system",
    "app.services.cloud_ocr", "app.services.local_ocr", "app.services.jobs",
    "app.services.parser", "app.services.exporter", "app.services.config_store",
    "sqlalchemy.dialects.sqlite", "sqlalchemy.dialects.mysql",
    "pymysql", "pypdf", "openpyxl", "httpx", "cryptography", "jwt",
]

a = Analysis(
    ["desktop_app.py"],
    pathex=[str(PROJECT / "backend"), str(PROJECT)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib", "pandas", "numpy", "PyQt5", "PySide6"],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="FactorKhan",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    icon=str(ROOT / "installer" / "faktorkhan.ico") if (ROOT / "installer" / "faktorkhan.ico").is_file() else None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="FactorKhan",
)
