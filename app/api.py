"""HTTP API。"""
from __future__ import annotations

import os
import subprocess
import threading
import time
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

from .config import (
    APP_NAME,
    DATA_DIR,
    THUMB_DIR,
    VERSION,
    progress,
    settings,
)
from .ffmpeg_tools import IS_WINDOWS, ffmpeg_tools
from .media import library
from .network import qr_svg, urls_for
from .streaming import HLSError, HLSManager, serve_file

router = APIRouter(prefix="/api")
hls_manager = HLSManager(library)
ffmpeg_tools.on_ready = library.refresh_after_ffmpeg
_pick_lock = threading.Lock()


class FolderIn(BaseModel):
    path: str


class ProgressIn(BaseModel):
    id: str
    position: float
    duration: float


class HLSIn(BaseModel):
    id: str
    quality: str = "auto"


class SettingsIn(BaseModel):
    port: int | None = None
    quality: str | None = None
    ffmpeg_dir: str | None = None


def _port(request: Request) -> int:
    return int(getattr(request.app.state, "port", settings.port))


@router.get("/status")
def status(request: Request):
    port = _port(request)
    state = library.state()
    return {
        "app": APP_NAME,
        "version": VERSION,
        "port": port,
        "started_at": int(getattr(request.app.state, "started_at", time.time())),
        "urls": urls_for(port),
        "library": state,
        "ffmpeg": ffmpeg_tools.status(),
        "settings": {
            "port": settings.port,
            "quality": settings.quality,
        },
        "cache": {"hls_size": hls_manager.cache_size()},
        "suggestions": _folder_suggestions(),
    }


def _folder_suggestions() -> list[dict]:
    added = {os.path.normcase(f) for f in settings.folders}
    home = Path.home()
    result = []
    for name in ("Videos", "Downloads", "Movies", "Desktop"):
        candidate = home / name
        try:
            if candidate.is_dir() and os.path.normcase(str(candidate)) not in added:
                result.append({"label": name, "path": str(candidate)})
        except OSError:
            continue
    return result


@router.post("/scan")
def rescan():
    started = library.start_scan()
    return {"ok": True, "started": started, "state": library.state()}


@router.get("/videos")
def videos():
    items = library.snapshot()
    all_progress = progress.all()
    for item in items:
        item["progress"] = all_progress.get(item["id"])
    return {
        "videos": items,
        "state": library.state(),
        "ffmpeg_ok": ffmpeg_tools.available,
    }


@router.post("/folders")
def add_folder(body: FolderIn):
    ok, message = library.add_folder(body.path)
    if not ok:
        raise HTTPException(status_code=400, detail=message)
    return {"ok": True, "message": message, "state": library.state()}


@router.post("/folders/remove")
def remove_folder(body: FolderIn):
    ok, message = library.remove_folder(body.path)
    if not ok:
        raise HTTPException(status_code=400, detail=message)
    return {"ok": True, "message": message, "state": library.state()}


@router.post("/folders/pick")
def pick_folder():
    if not IS_WINDOWS:
        return {"path": ""}
    with _pick_lock:
        path = _pick_folder_windows()
    return {"path": path}


def _pick_folder_windows() -> str:
    target = DATA_DIR / "picked-folder.txt"
    try:
        target.unlink(missing_ok=True)
    except OSError:
        pass
    script = r"""
Add-Type -AssemblyName System.Windows.Forms | Out-Null
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.Opacity = 0
$owner.WindowState = 'Minimized'
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = '选择视频文件夹'
$dialog.ShowNewFolderButton = $false
$result = $dialog.ShowDialog($owner)
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
  [System.IO.File]::WriteAllText($env:PYVIDEO_PICK, $dialog.SelectedPath, [System.Text.Encoding]::UTF8)
}
$owner.Dispose()
"""
    env = os.environ.copy()
    env["PYVIDEO_PICK"] = str(target)
    try:
        subprocess.run(
            ["powershell", "-NoProfile", "-STA", "-Command", script],
            env=env,
            timeout=300,
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        if target.is_file():
            return target.read_text(encoding="utf-8-sig").strip()
    except (OSError, subprocess.SubprocessError):
        pass
    finally:
        try:
            target.unlink(missing_ok=True)
        except OSError:
            pass
    try:
        import tkinter as tk
        from tkinter import filedialog

        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        selected = filedialog.askdirectory(title="选择视频文件夹")
        root.destroy()
        return selected or ""
    except Exception:  # noqa: BLE001 - 原生选择器不可用时直接返回
        return ""


@router.get("/thumb/{vid}")
def thumbnail(vid: str):
    if not library.get(vid):
        raise HTTPException(status_code=404, detail="视频不存在")
    path = THUMB_DIR / f"{vid}.jpg"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="缩略图生成中")
    return FileResponse(
        path,
        media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=86400"},
    )


@router.api_route("/stream/{vid}", methods=["GET", "HEAD"])
def stream(vid: str, request: Request):
    record = library.get(vid)
    if not record:
        raise HTTPException(status_code=404, detail="视频不存在")
    path = Path(record["path"])
    if not path.is_file():
        raise HTTPException(status_code=404, detail="文件已被移动或删除")
    return serve_file(request, path)


def _direct_ok(video: dict) -> bool:
    return bool((video.get("compat") or {}).get("direct"))


def _pick_hls_quality(video: dict, requested: str, force: bool) -> str:
    compat = video.get("compat") or {}
    if requested in ("original", "1080", "720"):
        return requested
    if force:
        return "1080"
    if compat.get("copyable"):
        return "original"
    return "1080"


@router.get("/playinfo/{vid}")
def playinfo(vid: str, quality: str = "auto", force: int = 0):
    video = library.get(vid)
    if not video:
        raise HTTPException(status_code=404, detail="视频不存在")
    if quality not in ("auto", "original", "1080", "720"):
        quality = "auto"
    compat = video.get("compat") or {}
    meta = video.get("meta") or {}
    direct = _direct_ok(video)
    height = int(meta.get("height") or 0)
    ffmpeg_ok = ffmpeg_tools.available

    if not meta and not ffmpeg_ok and video["ext"] in (".mp4", ".m4v", ".mov"):
        direct = True

    want_hls = False
    effective = "original"
    mode = "unavailable"
    message = ""
    warn = ""

    if quality in ("auto", "original"):
        if direct and not force:
            mode = "direct"
        elif ffmpeg_ok:
            want_hls = True
            effective = "original" if compat.get("copyable") and not force else "1080"
            if force and quality == "auto":
                effective = "1080"
            mode = "hls"
        else:
            mode = "unavailable"
            message = "此视频需要 FFmpeg 转换格式，请先在电脑端完成 FFmpeg 安装"
    else:
        if direct and (not height or height <= int(quality)) and not force:
            mode = "direct"
            effective = quality
        elif ffmpeg_ok:
            want_hls = True
            effective = quality
            mode = "hls"
        elif direct and not force:
            mode = "direct"
            effective = quality
        else:
            mode = "unavailable"
            message = "此视频需要 FFmpeg 转换格式，请先在电脑端完成 FFmpeg 安装"

    if not meta and ffmpeg_ok and mode != "direct":
        mode = "analyzing"
        message = "正在读取视频信息，请稍候"
    if compat.get("reason") == "无法打开":
        mode = "unavailable"
        message = "视频文件无法读取，可能已损坏或被移动；请重新扫描影库"

    duration = float(meta.get("duration") or 0)
    resume = 0.0
    saved = progress.get(vid)
    if saved and duration:
        pos = float(saved.get("pos") or 0)
        if pos > 8 and pos < duration * 0.97 and (duration - pos) > 5:
            resume = round(pos, 1)

    subs = []
    for index, sub in enumerate(video.get("subs") or []):
        subs.append(
            {
                "index": index,
                "label": sub.get("label") or f"字幕 {index + 1}",
                "default": bool(sub.get("default")),
                "url": f"/api/subs/{vid}/{index}.vtt",
            }
        )

    response = {
        "id": vid,
        "title": video["stem"],
        "mode": mode,
        "url": f"/api/stream/{vid}?v={video['mtime']}" if mode == "direct" else "",
        "hls_quality": effective if want_hls else "",
        "hls_copy": bool(want_hls and effective == "original" and compat.get("copyable")),
        "resume": resume,
        "duration": duration,
        "subs": subs,
        "quality": quality,
        "direct": direct,
        "copyable": bool(compat.get("copyable")),
        "reason": compat.get("detail") or compat.get("reason") or "",
        "message": message,
        "warn": warn,
        "ffmpeg": ffmpeg_ok,
    }
    return response


@router.post("/hls/start")
def hls_start(body: HLSIn):
    video = library.get(body.id)
    if not video:
        raise HTTPException(status_code=404, detail="视频不存在")
    if not ffmpeg_tools.available:
        raise HTTPException(status_code=400, detail="未安装 FFmpeg")
    quality = _pick_hls_quality(video, body.quality, force=False)
    try:
        session = hls_manager.start(video, quality)
    except HLSError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    plan = session.plan
    return {
        "sid": session.sid,
        "playlist": f"/api/hls/{session.sid}/playlist.m3u8",
        "quality": quality,
        "copy": bool(plan.get("copy_video")),
        "encoder": plan.get("encoder") or "",
        "height": plan.get("height") or 0,
    }


@router.get("/hls/{sid}/{name}")
def hls_file(sid: str, name: str):
    session = hls_manager.get(sid)
    if not session:
        raise HTTPException(status_code=404, detail="转码会话已结束")
    try:
        if name == "playlist.m3u8":
            return hls_manager.playlist_response(session)
        return hls_manager.segment_response(session, name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="片段不存在") from exc
    except HLSError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/progress")
def save_progress(body: ProgressIn):
    if body.duration <= 0:
        return {"ok": False}
    progress.update(body.id, body.position, body.duration)
    return {"ok": True}


@router.get("/subs/{vid}/{index}.vtt")
def subtitle(vid: str, index: int):
    path = library.subtitle_path(vid, index)
    if not path:
        raise HTTPException(status_code=404, detail="字幕不存在")
    return FileResponse(path, media_type="text/vtt; charset=utf-8")


@router.post("/settings")
def update_settings(body: SettingsIn):
    message = []
    restart = False
    if body.port is not None:
        if not 1024 <= body.port <= 65535:
            raise HTTPException(status_code=400, detail="端口需要在 1024-65535 之间")
        if body.port != settings.port:
            settings.port = body.port
            restart = True
            message.append("端口已保存，重启程序后生效")
    if body.quality is not None:
        settings.quality = body.quality
        message.append("默认画质已更新")
    if body.ffmpeg_dir is not None:
        ok, info = ffmpeg_tools.set_dir(body.ffmpeg_dir)
        if not ok:
            raise HTTPException(status_code=400, detail=info)
        message.append(info)
        if ffmpeg_tools.available:
            library.refresh_after_ffmpeg()
    return {
        "ok": True,
        "message": "；".join(message) or "已保存",
        "restart_required": restart,
        "settings": {"port": settings.port, "quality": settings.quality},
        "ffmpeg": ffmpeg_tools.status(),
    }


@router.post("/ffmpeg/download")
def download_ffmpeg():
    ok, message = ffmpeg_tools.start_download()
    return {"ok": ok, "message": message, "download": ffmpeg_tools.status()["download"]}


@router.post("/ffmpeg/refresh")
def refresh_ffmpeg():
    if ffmpeg_tools.available:
        library.refresh_after_ffmpeg()
        library.rebuild_thumbs()
    return {"ok": ffmpeg_tools.available, "ffmpeg": ffmpeg_tools.status()}


@router.post("/cache/clear")
def clear_cache():
    removed = hls_manager.clear()
    return {"ok": True, "removed": removed, "size": hls_manager.cache_size()}


@router.post("/open/{vid}")
def open_in_explorer(vid: str):
    record = library.get(vid)
    if not record:
        raise HTTPException(status_code=404, detail="视频不存在")
    path = record["path"]
    try:
        if IS_WINDOWS:
            subprocess.Popen(f'explorer.exe /select,"{path.replace(chr(34), "")}"')
        elif os.name == "darwin":
            subprocess.Popen(["open", "-R", path])
        else:
            subprocess.Popen(["xdg-open", os.path.dirname(path)])
    except OSError:
        raise HTTPException(status_code=500, detail="无法打开资源管理器") from None
    return {"ok": True}


@router.get("/qr.svg")
def qr(request: Request, view: str = "watch"):
    url = urls_for(_port(request))["watch" if view == "watch" else "pc"]
    return Response(
        qr_svg(url),
        media_type="image/svg+xml",
        headers={"Cache-Control": "no-store"},
    )
