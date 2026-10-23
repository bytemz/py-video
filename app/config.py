"""配置与数据持久化。"""
from __future__ import annotations

import json
import os
import sys
import threading
import time
from pathlib import Path

APP_NAME = "影阁"
APP_EN_ID = "PyVideo"
VERSION = "1.1.1"

DEFAULT_PORT = 8686


def _data_dir() -> Path:
    base = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA")
    root = Path(base) if base else Path.home() / ".local" / "share"
    path = root / APP_EN_ID
    path.mkdir(parents=True, exist_ok=True)
    for sub in ("thumbs", "hls", "subs", "bin"):
        (path / sub).mkdir(exist_ok=True)
    return path


def _resource_dir() -> Path:
    bundled = getattr(sys, "_MEIPASS", None)
    if bundled:
        return Path(bundled)
    return Path(__file__).resolve().parent.parent


DATA_DIR = _data_dir()
RESOURCE_DIR = _resource_dir()
WEB_DIR = RESOURCE_DIR / "web"
THUMB_DIR = DATA_DIR / "thumbs"
HLS_DIR = DATA_DIR / "hls"
SUB_DIR = DATA_DIR / "subs"
BIN_DIR = DATA_DIR / "bin"


class JsonStore:
    """带锁的小型 JSON 存储，写入时使用临时文件原子替换。"""

    def __init__(self, filename: str, default: dict):
        self.path = DATA_DIR / filename
        self._lock = threading.RLock()
        self.data = json.loads(json.dumps(default))
        self._load()

    def _load(self) -> None:
        try:
            raw = self.path.read_text(encoding="utf-8")
            loaded = json.loads(raw)
            if isinstance(loaded, dict):
                self.data = loaded
        except (OSError, ValueError):
            pass

    def save(self) -> None:
        with self._lock:
            tmp = self.path.with_suffix(".tmp")
            try:
                tmp.write_text(
                    json.dumps(self.data, ensure_ascii=False, indent=1),
                    encoding="utf-8",
                )
                tmp.replace(self.path)
            except OSError:
                pass

    @property
    def lock(self) -> threading.RLock:
        return self._lock


class Settings:
    def __init__(self) -> None:
        self.store = JsonStore(
            "settings.json",
            {
                "port": DEFAULT_PORT,
                "folders": [],
                "quality": "auto",
                "ffmpeg_dir": "",
            },
        )

    def _get(self, key, default=None):
        with self.store.lock:
            return self.store.data.get(key, default)

    def _set(self, key, value) -> None:
        with self.store.lock:
            self.store.data[key] = value
            self.store.save()

    @property
    def port(self) -> int:
        try:
            port = int(self._get("port", DEFAULT_PORT))
        except (TypeError, ValueError):
            port = DEFAULT_PORT
        return port if 1 <= port <= 65535 else DEFAULT_PORT

    @port.setter
    def port(self, value: int) -> None:
        self._set("port", int(value))

    @property
    def folders(self) -> list[str]:
        value = self._get("folders", [])
        return [str(v) for v in value if isinstance(v, str)] if isinstance(value, list) else []

    @folders.setter
    def folders(self, value: list[str]) -> None:
        self._set("folders", list(dict.fromkeys(value)))

    @property
    def quality(self) -> str:
        value = self._get("quality", "auto")
        return value if value in ("auto", "original", "1080", "720") else "auto"

    @quality.setter
    def quality(self, value: str) -> None:
        if value in ("auto", "original", "1080", "720"):
            self._set("quality", value)

    @property
    def ffmpeg_dir(self) -> str:
        return str(self._get("ffmpeg_dir", "") or "")

    @ffmpeg_dir.setter
    def ffmpeg_dir(self, value: str) -> None:
        self._set("ffmpeg_dir", str(value or ""))


class ProgressStore:
    def __init__(self) -> None:
        self.store = JsonStore("progress.json", {"items": {}})
        self._dirty = 0

    def get(self, video_id: str) -> dict | None:
        with self.store.lock:
            item = self.store.data.get("items", {}).get(video_id)
            return dict(item) if isinstance(item, dict) else None

    def all(self) -> dict:
        with self.store.lock:
            items = self.store.data.get("items", {})
            return {k: dict(v) for k, v in items.items() if isinstance(v, dict)}

    def update(self, video_id: str, position: float, duration: float) -> None:
        if duration <= 0:
            return
        position = max(0.0, min(float(position), duration))
        with self.store.lock:
            items = self.store.data.setdefault("items", {})
            items[video_id] = {
                "pos": round(position, 2),
                "dur": round(duration, 2),
                "updated": int(time.time()),
            }
            self._dirty += 1
            if self._dirty >= 8:
                self._dirty = 0
                self.store.save()

    def flush(self) -> None:
        self.store.save()


settings = Settings()
progress = ProgressStore()
