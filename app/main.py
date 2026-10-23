"""应用入口与启动逻辑。"""
from __future__ import annotations

import contextlib
import json
import re
import socket
import threading
import time
import urllib.request
import webbrowser

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import RedirectResponse, Response
from fastapi.staticfiles import StaticFiles

from .api import hls_manager, router
from .config import APP_NAME, HLS_DIR, VERSION, WEB_DIR, progress, settings
from .ffmpeg_tools import ffmpeg_tools
from .media import library
from .network import urls_for

MOBILE_UA = re.compile(r"iPhone|iPad|iPod|Android|Mobile|Windows Phone|HarmonyOS", re.IGNORECASE)


def _cleanup_old_sessions() -> None:
    cutoff = time.time() - 24 * 3600
    try:
        for child in HLS_DIR.iterdir():
            if child.is_dir():
                try:
                    if child.stat().st_mtime < cutoff:
                        import shutil

                        shutil.rmtree(child, ignore_errors=True)
                except OSError:
                    continue
    except OSError:
        pass


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    _cleanup_old_sessions()
    if settings.folders:
        library.start_scan()
    yield
    hls_manager.stop_all()
    library.flush()
    progress.flush()


def create_app(port: int) -> FastAPI:
    app = FastAPI(
        title=APP_NAME,
        version=VERSION,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
    )
    app.state.port = port
    app.state.started_at = time.time()
    app.include_router(router)
    app.mount("/static", StaticFiles(directory=str(WEB_DIR)), name="static")

    @app.middleware("http")
    async def static_no_cache(request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/static/"):
            response.headers["Cache-Control"] = "no-cache, must-revalidate"
        return response

    @app.get("/")
    def root(request: Request):
        agent = request.headers.get("user-agent", "")
        target = "/watch" if MOBILE_UA.search(agent) else "/pc"
        return RedirectResponse(target, status_code=302)

    @app.get("/pc")
    @app.get("/watch")
    def page():
        html = (WEB_DIR / "index.html").read_text(encoding="utf-8").replace("__VERSION__", VERSION)
        return Response(
            html,
            media_type="text/html; charset=utf-8",
            headers={"Cache-Control": "no-cache"},
        )

    @app.get("/favicon.ico")
    def favicon():
        path = WEB_DIR / "favicon.svg"
        if path.is_file():
            return Response(path.read_bytes(), media_type="image/svg+xml")
        return Response(status_code=204)

    return app


def find_free_port(desired: int) -> int:
    for offset in range(30):
        port = desired + offset
        if port > 65535:
            break
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            try:
                sock.bind(("0.0.0.0", port))
                return port
            except OSError:
                continue
    raise RuntimeError(f"端口 {desired} 附近没有可用端口")


def _existing_instance(port: int) -> str | None:
    try:
        with urllib.request.urlopen(
            f"http://127.0.0.1:{port}/api/status", timeout=1.5
        ) as response:
            data = json.loads(response.read().decode("utf-8"))
        if data.get("app") == APP_NAME and data.get("version"):
            return f"http://127.0.0.1:{port}/pc"
    except (OSError, ValueError):
        pass
    return None


def _banner(port: int) -> str:
    urls = urls_for(port)
    primary = urls["watch"]
    ffmpeg_line = (
        "已就绪 · 支持硬件加速与格式转换"
        if ffmpeg_tools.available
        else "未安装  ·  可在电脑管理页一键下载"
    )
    lines = [
        "",
        "  " + "=" * 58,
        f"  {APP_NAME}  ·  PyVideo {VERSION}",
        "  " + "-" * 58,
        f"  电脑管理    http://127.0.0.1:{port}/pc",
        f"  手机观看    {primary}",
        f"  FFmpeg     {ffmpeg_line}",
        "  " + "-" * 58,
        "  手机和电脑连接同一个 Wi-Fi，扫码即可观看",
        "  首次运行请在 Windows 防火墙弹窗中允许“专用网络”",
        "  按 Ctrl+C 停止服务",
        "  " + "=" * 58,
        "",
    ]
    return "\n".join(lines)


def _open_when_ready(port: int) -> None:
    for _ in range(80):
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.25):
                break
        except OSError:
            time.sleep(0.15)
    webbrowser.open(f"http://127.0.0.1:{port}/pc")


def launch(port: int | None = None, no_browser: bool = False) -> None:
    desired = int(port or settings.port)
    existing = _existing_instance(desired)
    if existing:
        print(f"\n影阁已经在运行：{existing}\n直接打开浏览器即可；如需重启，请先关闭已有窗口。\n")
        if not no_browser:
            webbrowser.open(existing)
        return
    actual = find_free_port(desired)
    if actual != desired:
        print(f"[提示] 端口 {desired} 被占用，改用 {actual}")
    app = create_app(actual)
    print(_banner(actual), flush=True)
    if not no_browser:
        threading.Thread(target=_open_when_ready, args=(actual,), daemon=True).start()
    config = uvicorn.Config(
        app,
        host="0.0.0.0",
        port=actual,
        log_level="warning",
        access_log=False,
        timeout_keep_alive=75,
    )
    server = uvicorn.Server(config)
    try:
        server.run()
    except KeyboardInterrupt:
        pass
    finally:
        print("\n服务已停止。", flush=True)
