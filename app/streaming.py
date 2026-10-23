"""HTTP Range 直连播放与按需 HLS 转码。"""
from __future__ import annotations

import hashlib
import mimetypes
import re
import shutil
import subprocess
import threading
import time
from email.utils import formatdate
from pathlib import Path

from fastapi import Request
from fastapi.responses import FileResponse, Response, StreamingResponse

from .config import HLS_DIR
from .ffmpeg_tools import IS_WINDOWS, ffmpeg_tools
from .media import MediaLibrary


class HLSError(RuntimeError):
    pass


RANGE_RE = re.compile(r"bytes=(\d*)-(\d*)$")
SAFE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
CHUNK = 512 * 1024
CACHE_LIMIT = 30 * 1024**3
CACHE_TARGET = 24 * 1024**3


def content_type_for(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in (".mp4", ".m4v", ".mov", ".ts", ".m2ts"):
        return "video/mp4"
    if suffix == ".webm":
        return "video/webm"
    guessed, _ = mimetypes.guess_type(str(path))
    return guessed or "application/octet-stream"


def _file_headers(path: Path) -> dict:
    stat = path.stat()
    return {
        "Accept-Ranges": "bytes",
        "ETag": f'"{int(stat.st_mtime * 1000)}-{stat.st_size}"',
        "Last-Modified": formatdate(stat.st_mtime, usegmt=True),
    }


def serve_file(request: Request, path: Path, cache_control: str = "private, max-age=0, must-revalidate"):
    stat = path.stat()
    size = stat.st_size
    headers = _file_headers(path)
    headers["Cache-Control"] = cache_control
    media_type = content_type_for(path)
    range_header = request.headers.get("range", "").strip()
    start, end = 0, size - 1
    status_code = 200
    if range_header:
        match = RANGE_RE.match(range_header)
        if not match:
            return Response(status_code=416, headers={"Content-Range": f"bytes */{size}"})
        first, second = match.group(1), match.group(2)
        if first:
            start = int(first)
            end = int(second) if second else size - 1
        else:
            if not second:
                return Response(status_code=416, headers={"Content-Range": f"bytes */{size}"})
            suffix = int(second)
            start = max(0, size - suffix)
        if start >= size or start > end:
            return Response(status_code=416, headers={"Content-Range": f"bytes */{size}"})
        end = min(end, size - 1)
        status_code = 206
        headers["Content-Range"] = f"bytes {start}-{end}/{size}"
    length = max(0, end - start + 1)
    headers["Content-Length"] = str(length)
    if request.method.upper() == "HEAD":
        return Response(status_code=status_code, headers=headers, media_type=media_type)

    def iterator():
        with path.open("rb") as fh:
            fh.seek(start)
            remaining = length
            while remaining > 0:
                chunk = fh.read(min(CHUNK, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
                yield chunk

    return StreamingResponse(
        iterator(), status_code=status_code, headers=headers, media_type=media_type
    )


class HLSSession:
    def __init__(
        self,
        sid: str,
        directory: Path,
        video: dict,
        quality: str,
        plan: dict,
        proc: subprocess.Popen,
    ):
        self.sid = sid
        self.directory = directory
        self.video = video
        self.quality = quality
        self.plan = plan
        self.proc = proc
        self.created = time.time()
        self.last_access = time.time()
        self.log_path = directory / "ffmpeg.log"
        self.last_playlist = ""

    @property
    def playlist(self) -> Path:
        return self.directory / "playlist.m3u8"

    @property
    def running(self) -> bool:
        return self.proc.poll() is None

    def touch(self) -> None:
        self.last_access = time.time()

    def log_tail(self, lines: int = 14) -> str:
        try:
            raw = self.log_path.read_text(encoding="utf-8", errors="replace")
            return "\n".join(raw.strip().splitlines()[-lines:])
        except OSError:
            return ""

    def stop(self) -> None:
        if self.proc.poll() is None:
            try:
                self.proc.terminate()
                self.proc.wait(timeout=5)
            except (OSError, subprocess.SubprocessError):
                try:
                    self.proc.kill()
                except OSError:
                    pass


class HLSManager:
    def __init__(self, library: MediaLibrary):
        self.library = library
        self.sessions: dict[str, HLSSession] = {}
        self._lock = threading.RLock()
        self._size_cache: tuple[float, int] = (0.0, 0)
        self._sweeper = threading.Thread(target=self._sweep_loop, daemon=True)
        self._sweeper.start()

    def get(self, sid: str, touch: bool = True) -> HLSSession | None:
        with self._lock:
            session = self.sessions.get(sid)
            if session and touch:
                session.touch()
            return session

    # ---------- plan ----------
    def build_plan(self, video: dict, quality: str) -> dict:
        meta = video.get("meta") or {}
        compat = video.get("compat") or {}
        if not meta:
            raise HLSError("缺少视频编码信息，请先安装 FFmpeg 并重新扫描")
        if quality not in ("original", "1080", "720"):
            quality = "1080"
        copy_video = quality == "original" and bool(compat.get("copyable"))
        source_height = int(meta.get("height") or 0)
        target_height = 0
        if not copy_video:
            target_height = {"original": source_height or 1080, "1080": 1080, "720": 720}[quality]
            if source_height:
                target_height = min(target_height, source_height)
        acodec = meta.get("acodec") or ""
        copy_audio = bool(acodec) and acodec == "aac"
        encoder = "" if copy_video else ffmpeg_tools.pick_encoder()
        return {
            "copy_video": copy_video,
            "copy_audio": copy_audio,
            "target_height": target_height,
            "encoder": encoder,
            "height": target_height or source_height,
        }

    # ---------- ffmpeg command ----------
    @staticmethod
    def _video_args(encoder: str, height: int) -> list[str]:
        maxrate = "35M" if height > 1440 else ("14M" if height > 900 else "8M")
        bufsize = "70M" if height > 1440 else ("28M" if height > 900 else "16M")
        if encoder == "h264_nvenc":
            return [
                "-c:v", "h264_nvenc",
                "-rc", "vbr", "-cq", "22", "-b:v", "0",
                "-maxrate", maxrate, "-bufsize", bufsize,
                "-profile:v", "high", "-pix_fmt", "yuv420p",
            ]
        if encoder == "h264_qsv":
            return [
                "-c:v", "h264_qsv", "-preset", "veryfast",
                "-global_quality", "23", "-maxrate", maxrate, "-bufsize", bufsize,
                "-profile:v", "high", "-pix_fmt", "nv12",
            ]
        if encoder == "h264_amf":
            return [
                "-c:v", "h264_amf", "-quality", "balanced",
                "-rc", "cqp", "-qp_i", "22", "-qp_p", "24",
                "-maxrate", maxrate, "-bufsize", bufsize,
                "-profile:v", "high", "-pix_fmt", "yuv420p",
            ]
        return [
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "22",
            "-maxrate", maxrate, "-bufsize", bufsize,
            "-profile:v", "high", "-pix_fmt", "yuv420p",
        ]

    def _command(self, video: dict, plan: dict, directory: Path, force_software: bool = False) -> list[str]:
        ff = ffmpeg_tools.ffmpeg
        meta = video.get("meta") or {}
        args = [
            ff, "-hide_banner", "-y", "-i", video["path"],
            "-map", "0:v:0", "-map", "0:a:0?", "-sn", "-dn",
        ]
        if plan["copy_video"]:
            args += ["-c:v", "copy"]
            if meta.get("vcodec") == "hevc":
                args += ["-tag:v", "hvc1"]
            if plan["copy_audio"]:
                args += ["-c:a", "copy"]
            elif meta.get("acodec"):
                args += ["-c:a", "aac", "-b:a", "192k", "-ac", "2"]
        else:
            encoder = "libx264" if force_software else plan["encoder"]
            height = plan["target_height"] or 1080
            args += ["-vf", f"scale=-2:{height},setsar=1"]
            args += self._video_args(encoder, height)
            if meta.get("acodec"):
                args += ["-c:a", "aac", "-b:a", "192k", "-ac", "2"]
            args += ["-force_key_frames", "expr:gte(t,n_forced*4)"]
        args += [
            "-max_muxing_queue_size", "2048",
            "-f", "hls",
            "-hls_time", "4",
            "-hls_playlist_type", "event",
            "-hls_flags", "independent_segments",
            "-hls_segment_type", "fmp4",
            "-hls_fmp4_init_filename", "init.mp4",
            "-hls_segment_filename", str(directory / "seg_%05d.m4s"),
            str(directory / "playlist.m3u8"),
        ]
        return args

    # ---------- start ----------
    def start(self, video: dict, quality: str) -> HLSSession:
        if not ffmpeg_tools.available:
            raise HLSError("未安装 FFmpeg，无法转换此视频格式")
        plan = self.build_plan(video, quality)
        key = f"{video['id']}:{video.get('mtime')}:{quality}"
        sid = hashlib.sha1(key.encode("utf-8")).hexdigest()[:12]
        with self._lock:
            existing = self.sessions.get(sid)
            if existing and existing.playlist.is_file():
                existing.touch()
                return existing
        directory = HLS_DIR / sid
        if directory.exists():
            shutil.rmtree(directory, ignore_errors=True)
        directory.mkdir(parents=True, exist_ok=True)

        attempts: list[bool] = []
        if not plan["copy_video"] and plan["encoder"] != "libx264":
            attempts = [False, True]
        else:
            attempts = [True]

        last_error = ""
        for force_software in attempts:
            if directory.exists():
                shutil.rmtree(directory, ignore_errors=True)
            directory.mkdir(parents=True, exist_ok=True)
            cmd = self._command(video, plan, directory, force_software=force_software)
            log_path = directory / "ffmpeg.log"
            log_file = log_path.open("wb")
            try:
                proc = subprocess.Popen(
                    cmd,
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL,
                    stderr=log_file,
                    cwd=str(directory),
                    creationflags=subprocess.CREATE_NO_WINDOW if IS_WINDOWS else 0,
                )
            except OSError as exc:
                log_file.close()
                last_error = f"无法启动 FFmpeg：{exc}"
                continue
            ready, error = self._wait_ready(proc, directory)
            log_file.close()
            if ready:
                session = HLSSession(sid, directory, video, quality, plan, proc)
                with self._lock:
                    self.sessions[sid] = session
                return session
            last_error = error
            try:
                if proc.poll() is None:
                    proc.terminate()
            except OSError:
                pass
            try:
                tail = log_path.read_text(encoding="utf-8", errors="replace").strip().splitlines()[-10:]
                if tail:
                    last_error += "\n" + "\n".join(tail)
            except OSError:
                pass

        shutil.rmtree(directory, ignore_errors=True)
        raise HLSError(last_error or "转码启动失败")

    @staticmethod
    def _playlist_ready(directory: Path) -> bool:
        playlist = directory / "playlist.m3u8"
        try:
            text = playlist.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return False
        if "#EXTINF" not in text:
            return False
        for name in re.findall(r"^(seg_[0-9]+\.m4s)$", text, re.MULTILINE):
            segment = directory / name
            try:
                if segment.stat().st_size > 1024:
                    return True
            except OSError:
                continue
        return False

    def _wait_ready(self, proc: subprocess.Popen, directory: Path) -> tuple[bool, str]:
        deadline = time.time() + 35
        while time.time() < deadline:
            if self._playlist_ready(directory):
                return True, ""
            if proc.poll() is not None:
                time.sleep(0.15)
                if self._playlist_ready(directory):
                    return True, ""
                return False, "FFmpeg 退出，可能无法处理该视频"
            time.sleep(0.25)
        return False, "转码准备超时（文件过大或磁盘过慢）"

    # ---------- serve ----------
    def playlist_response(self, session: HLSSession) -> Response:
        session.touch()
        playlist = session.playlist
        text = ""
        for _ in range(5):
            try:
                text = playlist.read_text(encoding="utf-8", errors="replace")
            except OSError:
                text = ""
            if text.startswith("#EXTM3U") and text.endswith("\n"):
                session.last_playlist = text
                break
            text = ""
            time.sleep(0.08)
        if not text:
            text = session.last_playlist
        if not text.startswith("#EXTM3U"):
            raise HLSError("播放列表尚未生成")
        return Response(
            content=text,
            media_type="application/vnd.apple.mpegurl",
            headers={"Cache-Control": "no-store, no-cache"},
        )

    def segment_response(self, session: HLSSession, name: str) -> FileResponse:
        if not SAFE_NAME.fullmatch(name):
            raise FileNotFoundError(name)
        path = session.directory / name
        if not path.is_file():
            raise FileNotFoundError(name)
        session.touch()
        return FileResponse(
            path,
            media_type="video/mp4",
            headers={"Cache-Control": "public, max-age=31536000, immutable"},
        )

    # ---------- cleanup ----------
    def clear(self) -> int:
        with self._lock:
            sessions = list(self.sessions.values())
            self.sessions.clear()
        for session in sessions:
            session.stop()
        removed = 0
        for child in HLS_DIR.iterdir():
            if child.is_dir():
                shutil.rmtree(child, ignore_errors=True)
                removed += 1
        self._size_cache = (time.time(), 0)
        return removed

    def stop_all(self) -> None:
        with self._lock:
            sessions = list(self.sessions.values())
            self.sessions.clear()
        for session in sessions:
            session.stop()

    @staticmethod
    def _dir_size(directory: Path) -> int:
        total = 0
        for file in directory.rglob("*"):
            try:
                if file.is_file():
                    total += file.stat().st_size
            except OSError:
                continue
        return total

    def cache_size(self) -> int:
        now = time.time()
        if now - self._size_cache[0] < 20:
            return self._size_cache[1]
        total = 0
        for child in HLS_DIR.iterdir():
            if child.is_dir():
                total += self._dir_size(child)
        self._size_cache = (now, total)
        return total

    def _enforce_cache_limit(self, now: float) -> None:
        total = self.cache_size()
        if total <= CACHE_LIMIT:
            return
        with self._lock:
            candidates = sorted(self.sessions.values(), key=lambda s: s.last_access)
        if len(candidates) <= 1:
            return
        newest = candidates[-1]
        for session in candidates:
            if session is newest or now - session.last_access < 180:
                continue
            size = self._dir_size(session.directory)
            with self._lock:
                self.sessions.pop(session.sid, None)
            session.stop()
            shutil.rmtree(session.directory, ignore_errors=True)
            total -= size
            if total <= CACHE_TARGET:
                break
        self._size_cache = (now, max(0, total))

    def _sweep_loop(self) -> None:
        while True:
            time.sleep(60)
            now = time.time()
            stale: list[HLSSession] = []
            with self._lock:
                for sid, session in list(self.sessions.items()):
                    if now - session.last_access > 1800:
                        stale.append(session)
                        self.sessions.pop(sid, None)
                if len(self.sessions) > 6:
                    ordered = sorted(self.sessions.values(), key=lambda s: s.last_access)
                    for session in ordered[: len(self.sessions) - 6]:
                        stale.append(session)
                        self.sessions.pop(session.sid, None)
            for session in stale:
                session.stop()
                shutil.rmtree(session.directory, ignore_errors=True)
            if stale:
                self._size_cache = (0.0, 0)
                self.cache_size()
            try:
                self._enforce_cache_limit(now)
            except OSError:
                pass
