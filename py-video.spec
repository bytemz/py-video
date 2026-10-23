# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller 打包配置：生成单文件 dist/PyVideo.exe。"""
import os

from PyInstaller.utils.hooks import collect_submodules

datas = [("web", "web")]

# 如果项目根目录的 bin/ 中放了 ffmpeg.exe 与 ffprobe.exe，则一起打包。
binaries = []
for filename in ("ffmpeg.exe", "ffprobe.exe"):
    candidate = os.path.join("bin", filename)
    if os.path.isfile(candidate):
        binaries.append((candidate, "bin"))

hiddenimports = [
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.loops.asyncio",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",
    "qrcode.image.svg",
]
hiddenimports += collect_submodules("qrcode")

a = Analysis(
    ["run.py"],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="PyVideo",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon="assets/app.ico",
)
