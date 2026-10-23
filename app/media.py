"""媒体库：扫描、元数据探测、兼容性判断、缩略图、字幕。"""
from __future__ import annotations

import hashlib
import os
import queue
import re
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from .config import SUB_DIR, THUMB_DIR, JsonStore, settings
from .ffmpeg_tools import IS_WINDOWS, ffmpeg_tools

VIDEO_EXTS = {
    ".mp4",
    ".m4v",
    ".mov",
    ".mkv",
    ".avi",
    ".wmv",
    ".flv",
    ".webm",
    ".ts",
    ".m2ts",
    ".mpg",
    ".mpeg",
    ".3gp",
}
SUB_EXTS = {".srt", ".vtt"}
SKIP_DIRS = {"$recycle.bin", "system volume information", "recycler", "node_modules"}

AUDIO_NAMES = {
    "aac": "AAC",
    "ac3": "AC-3",
    "eac3": "E-AC-3",
    "dts": "DTS",
    "truehd": "TrueHD",
    "flac": "FLAC",
    "opus": "Opus",
    "mp3": "MP3",
    "vorbis": "Vorbis",
    "pcm_s16le": "PCM",
    "pcm_s24le": "PCM",
}
VIDEO_NAMES = {
    "h264": "H.264",
    "hevc": "H.265",
    "av1": "AV1",
    "vp9": "VP9",
    "vp8": "VP8",
    "mpeg4": "MPEG-4",
    "vc1": "VC-1",
    "mpeg2video": "MPEG-2",
}
LANG_LABELS = {
    "zh": "中文",
    "chi": "中文",
    "chs": "简体中文",
    "cht": "繁体中文",
    "zh-cn": "简体中文",
    "zh-tw": "繁体中文",
    "en": "English",
    "eng": "English",
    "ja": "日本語",
    "jpn": "日本語",
    "ko": "한국어",
}


def natural_key(value: str) -> list:
    return [int(part) if part.isdigit() else part.casefold() for part in re.split(r"(\d+)", value)]


def video_id_for(path: str) -> str:
    return hashlib.sha1(os.path.normcase(path).encode("utf-8")).hexdigest()[:16]


def _parse_fps(value: str) -> float:
    try:
        if "/" in value:
            num, den = value.split("/", 1)
            den_f = float(den)
            return round(float(num) / den_f, 3) if den_f else 0.0
        return round(float(value), 3)
    except (TypeError, ValueError, ZeroDivisionError):
        return 0.0


def _parse_meta(probe: dict) -> dict:
    fmt = probe.get("format") or {}
    streams = probe.get("streams") or []
    video = next(
        (
            s
            for s in streams
            if s.get("codec_type") == "video" and not s.get("disposition", {}).get("attached_pic")
        ),
        None,
    )
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    duration = 0.0
    for candidate in (fmt.get("duration"), (video or {}).get("duration")):
        try:
            duration = float(candidate)
            if duration > 0:
                break
        except (TypeError, ValueError):
            continue
    vcodec = (video or {}).get("codec_name", "") or ""
    acodec = (audio or {}).get("codec_name", "") or ""
    channels = int((audio or {}).get("channels") or 0)
    meta = {
        "duration": round(duration, 2),
        "width": int((video or {}).get("width") or 0),
        "height": int((video or {}).get("height") or 0),
        "vcodec": vcodec,
        "acodec": acodec,
        "vtag": (video or {}).get("codec_tag_string", "") or "",
        "pix_fmt": (video or {}).get("pix_fmt", "") or "",
        "fps": _parse_fps((video or {}).get("avg_frame_rate", "0/0")),
        "channels": channels,
        "hdr": (video or {}).get("color_transfer", "") in ("smpte2084", "arib-std-b67"),
        "container": (fmt.get("format_name", "") or ""),
        "bitrate": int(fmt.get("bit_rate") or 0),
        "audio_count": sum(1 for s in streams if s.get("codec_type") == "audio"),
    }
    return meta


def _compat(ext: str, meta: dict | None) -> dict:
    if not meta:
        if not ffmpeg_tools.available:
            is_mp4 = ext in (".mp4", ".m4v", ".mov")
            return {
                "direct": is_mp4,
                "copyable": False,
                "reason": "直连" if is_mp4 else "需要 FFmpeg",
                "detail": "未安装 FFmpeg，无法分析编码",
                "unknown": not is_mp4,
            }
        return {
            "direct": False,
            "copyable": True,
            "reason": "分析中",
            "detail": "正在读取编码信息",
            "unknown": True,
        }

    container = meta.get("container", "")
    vcodec = meta.get("vcodec", "")
    acodec = meta.get("acodec", "")
    pix_fmt = meta.get("pix_fmt", "")
    vtag = meta.get("vtag", "")

    container_ok = any(key in container for key in ("mp4", "mov"))
    if vcodec == "h264":
        video_ok = pix_fmt in ("yuv420p", "yuvj420p", "nv12", "")
    elif vcodec == "hevc":
        video_ok = (not pix_fmt) or pix_fmt.startswith("yuv420p")
    else:
        video_ok = False
    audio_ok = acodec in ("", "aac", "mp3")
    tag_ok = vcodec != "hevc" or vtag in ("hvc1", "")
    direct = bool(container_ok and video_ok and audio_ok and tag_ok)

    v_label = VIDEO_NAMES.get(vcodec, vcodec.upper() or "未知视频")
    a_label = AUDIO_NAMES.get(acodec, acodec.upper() if acodec else "")
    if meta.get("channels", 0) > 2:
        a_label += f" {meta['channels']}ch"

    if direct:
        reason, detail = "直连", f"MP4 · {v_label}" + (f" · {a_label}" if a_label else "")
    elif not video_ok:
        reason, detail = "需要转码", f"{v_label} 编码浏览器无法直接播放"
    elif not container_ok or not tag_ok:
        reason = "快速转封装"
        parts = ["MKV/AVI 容器" if not container_ok else "HEVC hev1 标记", v_label]
        if a_label:
            parts.append(a_label)
        detail = " · ".join(parts)
        if not audio_ok:
            detail += " · 音轨转为 AAC"
    elif not audio_ok:
        reason, detail = "音轨转换", f"{a_label or '特殊音轨'} 需转为 AAC"
    else:
        reason, detail = "转码", "浏览器兼容性未知"

    return {
        "direct": direct,
        "copyable": bool(video_ok),
        "reason": reason,
        "detail": detail,
        "unknown": False,
    }


def _sub_label(filename: str, stem: str) -> tuple[str, bool]:
    remainder = filename[: -len(Path(filename).suffix)]
    if remainder.lower().startswith(stem.lower()):
        remainder = remainder[len(stem) :]
    remainder = remainder.strip(" ._-")
    label = LANG_LABELS.get(remainder.lower(), remainder.upper() if remainder else "字幕")
    is_default = remainder.lower() in ("zh", "chs", "chi", "zh-cn", "sc")
    return label, is_default


def decode_subtitle(raw: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "gb18030", "big5", "cp1252"):
        try:
            text = raw.decode(encoding)
            if encoding == "utf-8-sig" or not text.startswith("\ufeff"):
                return text.lstrip("\ufeff")
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", "replace")


def srt_to_vtt(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n").strip()
    if text.upper().startswith("WEBVTT"):
        return text + "\n"
    blocks = re.split(r"\n{2,}", text)
    output = ["WEBVTT", ""]
    for block in blocks:
        lines = [line for line in block.split("\n") if line.strip()]
        if not lines:
            continue
        time_idx = next((i for i, line in enumerate(lines) if "-->" in line), None)
        if time_idx is None:
            continue
        timing = lines[time_idx].replace(",", ".")
        timing = re.sub(r"\s+", " ", timing).strip()
        body = []
        for line in lines[time_idx + 1 :]:
            line = re.sub(r"\{[^}]*\}", "", line)
            line = re.sub(r"</?font[^>]*>", "", line, flags=re.IGNORECASE)
            if line.strip():
                body.append(line.rstrip())
        if body:
            output.append(timing)
            output.extend(body)
            output.append("")
    return "\n".join(output).strip() + "\n"


class MediaLibrary:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self.videos: dict[str, dict] = {}
        self._cache = JsonStore("media_cache.json", {"items": {}})
        self.scanning = False
        self.probing = 0
        self.scanned = 0
        self.scan_error = ""
        self._thumb_queue: queue.Queue = queue.Queue()
        self._thumb_pending = 0
        self._thumb_queued: dict[str, float] = {}
        self._thumb_lock = threading.Lock()
        self._executor: ThreadPoolExecutor | None = None
        self._thumb_thread = threading.Thread(target=self._thumb_worker, daemon=True)
        self._thumb_thread.start()
        self._last_cache_save = 0.0
        self._scan_again = False

    # ---------- folders ----------
    @staticmethod
    def normalize_folder(path: str) -> str:
        path = (path or "").strip().strip('"').strip("'")
        if not path:
            return ""
        return os.path.abspath(os.path.expanduser(os.path.expandvars(path)))

    def add_folder(self, path: str) -> tuple[bool, str]:
        normalized = self.normalize_folder(path)
        if not normalized:
            return False, "请输入文件夹路径"
        if not os.path.isdir(normalized):
            return False, "文件夹不存在或无权访问"
        folders = settings.folders
        key = os.path.normcase(normalized)
        if any(os.path.normcase(f) == key for f in folders):
            return False, "该文件夹已经添加过了"
        folders.append(normalized)
        settings.folders = folders
        self.start_scan()
        return True, "已添加文件夹，正在扫描"

    def remove_folder(self, path: str) -> tuple[bool, str]:
        key = os.path.normcase(self.normalize_folder(path))
        folders = [f for f in settings.folders if os.path.normcase(f) != key]
        if len(folders) == len(settings.folders):
            return False, "没有找到该文件夹"
        settings.folders = folders
        self.start_scan()
        return True, "已移除文件夹"

    def invalid_folders(self) -> list[str]:
        return [f for f in settings.folders if not os.path.isdir(f)]

    # ---------- scan ----------
    def start_scan(self) -> bool:
        with self._lock:
            if self.scanning:
                self._scan_again = True
                return False
            self.scanning = True
            self.scanned = 0
            self.scan_error = ""
        threading.Thread(target=self._scan_worker, daemon=True).start()
        return True

    def _walk_folder(self, root: str):
        seen_dirs: set[str] = set()
        stack = [root]
        while stack:
            current = stack.pop()
            try:
                real = os.path.normcase(os.path.realpath(current))
            except OSError:
                continue
            if real in seen_dirs:
                continue
            seen_dirs.add(real)
            try:
                with os.scandir(current) as entries:
                    for entry in entries:
                        try:
                            if entry.is_dir(follow_symlinks=False):
                                if entry.name.startswith(".") or entry.name.lower() in SKIP_DIRS:
                                    continue
                                stack.append(entry.path)
                            elif entry.is_file(follow_symlinks=False):
                                yield entry
                        except OSError:
                            continue
            except OSError:
                continue

    def _scan_worker(self) -> None:
        try:
            folders = settings.folders
            records: dict[str, dict] = {}
            dir_files: dict[str, list[str]] = {}
            scanned = 0
            for root in folders:
                if not os.path.isdir(root):
                    continue
                for entry in self._walk_folder(root):
                    scanned += 1
                    if scanned % 40 == 0:
                        with self._lock:
                            self.scanned = scanned
                    suffix = Path(entry.name).suffix.lower()
                    dir_files.setdefault(os.path.dirname(entry.path), []).append(entry.name)
                    if suffix not in VIDEO_EXTS:
                        continue
                    try:
                        stat = entry.stat()
                    except OSError:
                        continue
                    path = os.path.abspath(entry.path)
                    vid = video_id_for(path)
                    rel_dir = os.path.relpath(os.path.dirname(path), root)
                    root_name = os.path.basename(root.rstrip("\\/")) or root
                    folder_label = root_name if rel_dir == "." else os.path.join(root_name, rel_dir)
                    folder_label = folder_label.replace("\\", "/")
                    cached = self._cache.data.get("items", {}).get(path) or {}
                    fresh = cached.get("mtime") == stat.st_mtime and cached.get("size") == stat.st_size
                    meta = cached.get("meta") if fresh else None
                    records[vid] = {
                        "id": vid,
                        "path": path,
                        "name": entry.name,
                        "stem": Path(entry.name).stem,
                        "ext": suffix,
                        "folder": folder_label,
                        "root": root,
                        "size": stat.st_size,
                        "mtime": int(stat.st_mtime),
                        "meta": meta,
                        "compat": _compat(suffix, meta),
                        "subs": [],
                        "thumb": (THUMB_DIR / f"{vid}.jpg").is_file(),
                        "thumb_v": int(stat.st_mtime),
                    }
            for vid, record in records.items():
                stem = record["stem"].lower()
                subs = []
                for filename in dir_files.get(os.path.dirname(record["path"]), []):
                    suffix = Path(filename).suffix.lower()
                    if suffix not in SUB_EXTS:
                        continue
                    name_stem = Path(filename).stem.lower()
                    if name_stem == stem or (name_stem.startswith(stem) and len(name_stem) > len(stem)):
                        label, default = _sub_label(filename, record["stem"])
                        subs.append(
                            {
                                "path": os.path.join(os.path.dirname(record["path"]), filename),
                                "label": label,
                                "default": default,
                            }
                        )
                subs.sort(key=lambda item: (not item["default"], item["label"]))
                record["subs"] = subs

            with self._lock:
                self.videos = records
                self.scanned = scanned
                self.scanning = False
            self._refresh_cache_entries(records)

            missing = [r for r in records.values() if r["meta"] is None]
            if missing and ffmpeg_tools.available:
                with self._lock:
                    self.probing = len(missing)
                self._start_probing(missing)
            else:
                with self._lock:
                    self.probing = 0
                self._enqueue_thumbs(list(records.values()))
        except Exception as exc:  # noqa: BLE001 - 扫描异常要反馈到界面
            with self._lock:
                self.scanning = False
                self.scan_error = str(exc)
        finally:
            with self._lock:
                self.scanning = False
                again = self._scan_again
                self._scan_again = False
            self._save_cache()
            if again:
                self.start_scan()

    def _refresh_cache_entries(self, records: dict[str, dict]) -> None:
        with self._cache.lock:
            items = self._cache.data.setdefault("items", {})
            valid_paths = {record["path"] for record in records.values()}
            for path in list(items):
                if path not in valid_paths:
                    items.pop(path, None)
            for record in records.values():
                entry = items.get(record["path"]) or {}
                if entry.get("mtime") != record["mtime"] or entry.get("size") != record["size"]:
                    entry = {
                        "mtime": record["mtime"],
                        "size": record["size"],
                        "meta": record["meta"],
                    }
                    items[record["path"]] = entry
            self._cache.save()

    def _start_probing(self, records: list[dict]) -> None:
        executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="probe")
        self._executor = executor
        for record in records:
            executor.submit(self._probe_one, record["id"], record["path"], record["mtime"])

    def _probe_one(self, vid: str, path: str, mtime: int) -> None:
        try:
            probe = ffmpeg_tools.probe(path)
            meta = _parse_meta(probe) if probe else None
            with self._lock:
                record = self.videos.get(vid)
                if record and record["mtime"] == mtime:
                    if meta:
                        record["meta"] = meta
                        record["compat"] = _compat(record["ext"], meta)
                        with self._cache.lock:
                            self._cache.data.setdefault("items", {})[path] = {
                                "mtime": mtime,
                                "size": record["size"],
                                "meta": meta,
                            }
                        self._enqueue_thumbs([record])
                    else:
                        record["compat"] = {
                            "direct": False,
                            "copyable": False,
                            "reason": "无法打开",
                            "detail": "FFprobe 读取失败，文件可能损坏",
                            "unknown": False,
                        }
        finally:
            with self._lock:
                self.probing = max(0, self.probing - 1)
                finished = self.probing == 0
            if finished:
                self._save_cache(force=True)

    def _save_cache(self, force: bool = False) -> None:
        now = time.time()
        if not force and now - self._last_cache_save < 3:
            return
        self._last_cache_save = now
        self._cache.save()

    def flush(self) -> None:
        self._save_cache(force=True)

    def refresh_after_ffmpeg(self) -> None:
        """FFmpeg 可用后，重新探测缺失元数据并排队缩略图。"""
        if not self.scanning:
            self.start_scan()

    # ---------- thumbnails ----------
    def _enqueue_thumbs(self, records: list[dict]) -> None:
        if not ffmpeg_tools.available:
            return
        with self._thumb_lock:
            for record in records:
                target = THUMB_DIR / f"{record['id']}.jpg"
                fresh = target.is_file() and target.stat().st_mtime >= record["mtime"]
                if fresh:
                    record["thumb"] = True
                    continue
                if record["id"] in self._thumb_queued:
                    continue
                record["thumb"] = False
                self._thumb_queued[record["id"]] = record["mtime"]
                self._thumb_pending += 1
                self._thumb_queue.put((record["id"], record["path"], record["mtime"]))

    def _thumb_worker(self) -> None:
        while True:
            vid, path, mtime = self._thumb_queue.get()
            try:
                self._make_thumb(vid, path, mtime)
            finally:
                with self._thumb_lock:
                    self._thumb_pending = max(0, self._thumb_pending - 1)
                    self._thumb_queued.pop(vid, None)
                self._thumb_queue.task_done()

    def _make_thumb(self, vid: str, path: str, mtime: int) -> None:
        ff = ffmpeg_tools.ffmpeg
        if not ff or not os.path.isfile(path):
            return
        target = THUMB_DIR / f"{vid}.jpg"
        if target.is_file() and target.stat().st_mtime >= mtime:
            self._mark_thumb(vid)
            return
        with self._lock:
            record = self.videos.get(vid)
            meta = (record or {}).get("meta") or {}
        duration = meta.get("duration") or 0
        width = meta.get("width") or 640
        seek = min(max(duration * 0.15, 3), 90) if duration else 5
        scale_width = min(640, width) if width else 640
        for attempt in (0, 1):
            cmd = [
                ff,
                "-hide_banner",
                "-loglevel",
                "error",
                "-ss",
                f"{seek if attempt == 0 else 1:.2f}",
                "-i",
                path,
                "-frames:v",
                "1",
                "-vf",
                f"scale={scale_width}:-2",
                "-q:v",
                "4",
                "-an",
                "-sn",
                "-y",
                str(target),
            ]
            try:
                result = subprocess.run(
                    cmd,
                    check=False,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    timeout=60,
                    creationflags=subprocess.CREATE_NO_WINDOW if IS_WINDOWS else 0,
                )
                if result.returncode == 0 and target.is_file() and target.stat().st_size > 0:
                    self._mark_thumb(vid)
                    return
            except (OSError, subprocess.SubprocessError):
                return
        try:
            target.unlink(missing_ok=True)
        except OSError:
            pass

    def _mark_thumb(self, vid: str) -> None:
        with self._lock:
            record = self.videos.get(vid)
            if record:
                record["thumb"] = True

    def rebuild_thumbs(self) -> None:
        with self._lock:
            records = list(self.videos.values())
        for record in records:
            target = THUMB_DIR / f"{record['id']}.jpg"
            try:
                if target.exists() and target.stat().st_mtime < record["mtime"]:
                    target.unlink()
            except OSError:
                pass
            record["thumb"] = target.is_file()
        self._enqueue_thumbs(records)

    # ---------- access ----------
    def get(self, vid: str) -> dict | None:
        with self._lock:
            record = self.videos.get(vid)
            return dict(record) if record else None

    def snapshot(self) -> list[dict]:
        with self._lock:
            items = []
            for record in self.videos.values():
                item = {
                    "id": record["id"],
                    "name": record["name"],
                    "stem": record["stem"],
                    "ext": record["ext"],
                    "folder": record["folder"],
                    "size": record["size"],
                    "mtime": record["mtime"],
                    "thumb": record["thumb"],
                    "thumb_v": record["thumb_v"],
                    "subs": [
                        {"index": index, "label": sub["label"], "default": sub["default"]}
                        for index, sub in enumerate(record.get("subs", []))
                    ],
                }
                item.update(record.get("meta") or {})
                item.update(record.get("compat") or {})
                items.append(item)
            items.sort(key=lambda item: (natural_key(item["folder"]), natural_key(item["name"])))
            return items

    def state(self) -> dict:
        with self._lock:
            total = len(self.videos)
            size = sum(v["size"] for v in self.videos.values())
            with self._thumb_lock:
                pending = self._thumb_pending
            return {
                "count": total,
                "total_size": size,
                "scanning": self.scanning,
                "probing": self.probing,
                "thumbs_pending": pending,
                "scanned": self.scanned,
                "error": self.scan_error,
                "folders": settings.folders,
                "invalid_folders": self.invalid_folders(),
            }

    # ---------- subtitles ----------
    def subtitle_path(self, vid: str, index: int) -> Path | None:
        record = self.get(vid)
        if not record:
            return None
        subs = record.get("subs") or []
        if index < 0 or index >= len(subs):
            return None
        source = Path(subs[index]["path"])
        if not source.is_file():
            return None
        target = SUB_DIR / f"{vid}-{index}.vtt"
        try:
            if target.is_file() and target.stat().st_mtime >= source.stat().st_mtime:
                return target
            text = decode_subtitle(source.read_bytes())
            if source.suffix.lower() == ".srt":
                text = srt_to_vtt(text)
            if not text.lstrip().upper().startswith("WEBVTT"):
                text = "WEBVTT\n\n" + text
            target.write_text(text, encoding="utf-8")
            return target
        except OSError:
            return None


library = MediaLibrary()
