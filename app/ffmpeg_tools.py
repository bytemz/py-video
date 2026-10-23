"""FFmpeg 定位、自动下载、硬件编码器探测。"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
import zipfile
from pathlib import Path

from .config import BIN_DIR, DATA_DIR, RESOURCE_DIR, settings

IS_WINDOWS = os.name == "nt"
EXE_SUFFIX = ".exe" if IS_WINDOWS else ""
DOWNLOAD_URLS = [
    "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip",
    "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip",
]


def _run(cmd: list[str], timeout: float = 20) -> subprocess.CompletedProcess | None:
    try:
        return subprocess.run(
            cmd,
            capture_output=True,
            check=False,
            timeout=timeout,
            creationflags=subprocess.CREATE_NO_WINDOW if IS_WINDOWS else 0,
        )
    except (OSError, subprocess.SubprocessError):
        return None


class FFmpegTools:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._resolved: tuple[str, str] | None = None
        self._resolved_root: str | None = None
        self._version = ""
        self._encoders: set[str] | None = None
        self._best_encoder: str | None | bool = False
        self.download = {
            "active": False,
            "phase": "idle",
            "progress": 0.0,
            "downloaded": 0,
            "total": 0,
            "error": "",
            "url": "",
        }
        self._download_lock = threading.Lock()
        self._probe_lock = threading.Lock()
        self._probe_running = False
        self.on_ready = None

    # ---------- locate ----------
    def _candidate_dirs(self) -> list[Path]:
        dirs: list[Path] = []
        configured = settings.ffmpeg_dir.strip().strip('"')
        if configured:
            p = Path(configured)
            dirs.append(p.parent if p.is_file() else p)
        exe_dir = Path(sys.executable).resolve().parent
        dirs.extend([exe_dir / "bin", exe_dir, RESOURCE_DIR / "bin", BIN_DIR])
        found = shutil.which("ffmpeg")
        if found:
            dirs.append(Path(found).resolve().parent)
        return list(dict.fromkeys(dirs))

    def _invalidate(self) -> None:
        with self._lock:
            self._resolved = None
            self._resolved_root = None
            self._version = ""
            self._encoders = None
            self._best_encoder = False

    def resolve(self) -> tuple[str, str] | None:
        with self._lock:
            if self._resolved:
                return self._resolved
            for directory in self._candidate_dirs():
                ff = directory / f"ffmpeg{EXE_SUFFIX}"
                fp = directory / f"ffprobe{EXE_SUFFIX}"
                if ff.is_file() and fp.is_file():
                    self._resolved = (str(ff), str(fp))
                    self._resolved_root = str(directory)
                    return self._resolved
            return None

    @property
    def ffmpeg(self) -> str | None:
        pair = self.resolve()
        return pair[0] if pair else None

    @property
    def ffprobe(self) -> str | None:
        pair = self.resolve()
        return pair[1] if pair else None

    @property
    def available(self) -> bool:
        return self.resolve() is not None

    def version(self) -> str:
        if self._version:
            return self._version
        ff = self.ffmpeg
        if not ff:
            return ""
        result = _run([ff, "-hide_banner", "-version"], timeout=10)
        if result and result.returncode == 0:
            first = result.stdout.decode("utf-8", "replace").splitlines()
            if first:
                self._version = first[0].strip()
        return self._version

    def set_dir(self, path: str) -> tuple[bool, str]:
        path = (path or "").strip().strip('"')
        if not path:
            settings.ffmpeg_dir = ""
            self._invalidate()
            return True, "已恢复自动查找"
        p = Path(path)
        directory = p.parent if p.is_file() else p
        if not (directory / f"ffmpeg{EXE_SUFFIX}").is_file():
            return False, f"该目录下没有找到 ffmpeg{EXE_SUFFIX}"
        if not (directory / f"ffprobe{EXE_SUFFIX}").is_file():
            return False, f"该目录下没有找到 ffprobe{EXE_SUFFIX}"
        settings.ffmpeg_dir = str(directory)
        self._invalidate()
        return self.available, "FFmpeg 路径已更新"

    # ---------- probe ----------
    def probe(self, path: str, timeout: float = 30) -> dict | None:
        fp = self.ffprobe
        if not fp:
            return None
        result = _run(
            [
                fp,
                "-v",
                "error",
                "-print_format",
                "json",
                "-show_format",
                "-show_streams",
                str(path),
            ],
            timeout=timeout,
        )
        if not result or result.returncode != 0:
            return None
        try:
            return json.loads(result.stdout.decode("utf-8", "replace"))
        except ValueError:
            return None

    # ---------- encoders ----------
    def list_encoders(self) -> set[str]:
        if self._encoders is not None:
            return self._encoders
        ff = self.ffmpeg
        if not ff:
            self._encoders = set()
            return self._encoders
        result = _run([ff, "-hide_banner", "-encoders"], timeout=15)
        names: set[str] = set()
        if result and result.returncode == 0:
            for line in result.stdout.decode("utf-8", "replace").splitlines():
                parts = line.split()
                if len(parts) >= 2 and parts[0].startswith("V"):
                    names.add(parts[1])
        self._encoders = names
        return names

    def _test_encoder(self, name: str) -> bool:
        ff = self.ffmpeg
        if not ff:
            return False
        result = _run(
            [
                ff,
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "color=c=black:s=256x144:d=0.1",
                "-frames:v",
                "1",
                "-c:v",
                name,
                "-f",
                "null",
                "-",
            ],
            timeout=25,
        )
        return bool(result and result.returncode == 0)

    def pick_encoder(self) -> str:
        """返回可用的 H.264 编码器；libx264 兜底。"""
        with self._lock:
            if self._best_encoder is not False:
                return self._best_encoder or "libx264"
            encoders = self.list_encoders()
            for candidate in ("h264_nvenc", "h264_qsv", "h264_amf"):
                if candidate in encoders and self._test_encoder(candidate):
                    self._best_encoder = candidate
                    return candidate
            self._best_encoder = None
            return "libx264"

    def encoder_label(self) -> str:
        name = self.pick_encoder()
        return {
            "h264_nvenc": "NVIDIA NVENC",
            "h264_qsv": "Intel QuickSync",
            "h264_amf": "AMD AMF",
            "libx264": "CPU (x264)",
        }.get(name, name)

    def _ensure_encoder_probe(self) -> None:
        if self._best_encoder is not False:
            return
        with self._probe_lock:
            if self._probe_running:
                return
            self._probe_running = True
        threading.Thread(target=self._encoder_probe_worker, daemon=True).start()

    def _encoder_probe_worker(self) -> None:
        try:
            self.pick_encoder()
        finally:
            with self._probe_lock:
                self._probe_running = False

    # ---------- download ----------
    def start_download(self) -> tuple[bool, str]:
        if not IS_WINDOWS:
            return False, "自动下载仅支持 Windows，请将 ffmpeg 加入 PATH"
        with self._download_lock:
            if self.download["active"]:
                return True, "正在下载"
            self.download.update(
                active=True,
                phase="准备下载",
                progress=0.0,
                downloaded=0,
                total=0,
                error="",
                url="",
            )
            thread = threading.Thread(target=self._download_worker, daemon=True)
            thread.start()
            return True, "开始下载"

    def _download_worker(self) -> None:
        last_error = ""
        for url in DOWNLOAD_URLS:
            try:
                self._download_one(url)
                self._invalidate()
                settings.ffmpeg_dir = ""
                with self._download_lock:
                    self.download.update(
                        active=False, phase="完成", progress=1.0, error=""
                    )
                if self.on_ready:
                    try:
                        self.on_ready()
                    except Exception:  # noqa: BLE001, S110 - 回调失败不影响下载结果
                        pass
                return
            except Exception as exc:  # noqa: BLE001 - 下载失败需要展示原因
                last_error = str(exc)
                with self._download_lock:
                    self.download.update(progress=0.0, downloaded=0)
        with self._download_lock:
            self.download.update(
                active=False,
                phase="失败",
                error=f"下载失败：{last_error}。可手动下载 FFmpeg 并把 ffmpeg.exe/ffprobe.exe 放到 {BIN_DIR}",
            )

    def _download_one(self, url: str) -> None:
        zip_path = DATA_DIR / "ffmpeg-download.zip"
        part_path = DATA_DIR / "ffmpeg-download.part"
        request = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) PyVideo/1.0",
                "Accept": "*/*",
            },
        )
        with self._download_lock:
            self.download.update(phase="连接服务器", url=url, progress=0.0, downloaded=0)
        with urllib.request.urlopen(request, timeout=60) as response, part_path.open("wb") as fh:
            total = int(response.headers.get("Content-Length") or 0)
            with self._download_lock:
                self.download["total"] = total
                self.download["phase"] = "下载中"
            downloaded = 0
            last_update = 0.0
            while True:
                chunk = response.read(262144)
                if not chunk:
                    break
                fh.write(chunk)
                downloaded += len(chunk)
                now = time.time()
                if now - last_update > 0.2:
                    last_update = now
                    with self._download_lock:
                        self.download["downloaded"] = downloaded
                        self.download["progress"] = (
                            round(downloaded / total, 4) if total else 0.0
                        )
        part_path.replace(zip_path)
        with self._download_lock:
            self.download.update(phase="解压中", progress=1.0)
        ffmpeg_tmp = BIN_DIR / "ffmpeg.new.exe"
        ffprobe_tmp = BIN_DIR / "ffprobe.new.exe"
        for tmp in (ffmpeg_tmp, ffprobe_tmp):
            tmp.unlink(missing_ok=True)
        ffmpeg_bytes = 0
        try:
            with zipfile.ZipFile(zip_path) as archive:
                for member in archive.infolist():
                    lower = member.filename.lower()
                    if lower.endswith("/bin/ffmpeg.exe") or lower == "bin/ffmpeg.exe":
                        ffmpeg_bytes = member.file_size
                        self._extract_member(archive, member, ffmpeg_tmp)
                    elif lower.endswith("/bin/ffprobe.exe") or lower == "bin/ffprobe.exe":
                        self._extract_member(archive, member, ffprobe_tmp)
            if not ffmpeg_bytes:
                raise RuntimeError("压缩包中未找到 ffmpeg.exe")
            if not ffprobe_tmp.is_file():
                raise RuntimeError("压缩包中未找到 ffprobe.exe")
            check = _run([str(ffmpeg_tmp), "-hide_banner", "-version"], timeout=20)
            if not check or check.returncode != 0:
                raise RuntimeError("下载的 FFmpeg 无法运行")
            ffmpeg_tmp.replace(BIN_DIR / "ffmpeg.exe")
            ffprobe_tmp.replace(BIN_DIR / "ffprobe.exe")
        finally:
            for tmp in (ffmpeg_tmp, ffprobe_tmp):
                try:
                    tmp.unlink(missing_ok=True)
                except OSError:
                    pass
            try:
                zip_path.unlink()
            except OSError:
                pass
        if not self.available:
            raise RuntimeError("FFmpeg 解压后无法运行")

    @staticmethod
    def _extract_member(archive: zipfile.ZipFile, member: zipfile.ZipInfo, target: Path) -> None:
        target.parent.mkdir(parents=True, exist_ok=True)
        with archive.open(member) as src, target.open("wb") as dst:
            shutil.copyfileobj(src, dst, length=1024 * 1024)

    def status(self) -> dict:
        pair = self.resolve()
        with self._download_lock:
            download = dict(self.download)
        encoders = []
        if pair:
            self._ensure_encoder_probe()
            best = self._best_encoder
            if best is False:
                encoders = ["检测中"]
            elif best and best != "libx264":
                encoders = [
                    {
                        "h264_nvenc": "NVIDIA NVENC",
                        "h264_qsv": "Intel QuickSync",
                        "h264_amf": "AMD AMF",
                    }.get(best, best)
                ]
        return {
            "ok": bool(pair),
            "ffmpeg": pair[0] if pair else "",
            "ffprobe": pair[1] if pair else "",
            "root": self._resolved_root or "",
            "version": (self.version().split(" Copyright")[0] if pair else ""),
            "download": download,
            "download_supported": IS_WINDOWS,
            "gpu_encoders": encoders,
            "install_dir": str(BIN_DIR),
        }


ffmpeg_tools = FFmpegTools()
