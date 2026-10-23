/* 影阁 · 通用工具与图标 */
(function () {
  "use strict";

  const ICONS = {
    play: '<path d="M8 5.6v12.8c0 .8.9 1.3 1.6.9l10-6.4a1 1 0 0 0 0-1.8l-10-6.4A1 1 0 0 0 8 5.6Z" fill="currentColor" stroke="none"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.4-3.4"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 6.3"/><path d="M20 4.5V11h-6.4"/>',
    phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.8"/><path d="M10.5 18.2h3"/>',
    folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M4 7h16"/><path d="M9 7V5.2c0-.7.6-1.2 1.2-1.2h3.6c.7 0 1.2.5 1.2 1.2V7"/><path d="M6.4 7l.8 12c.1 1 .9 1.8 2 1.8h5.6c1 0 1.9-.8 2-1.8l.8-12"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    check: '<path d="m5 12.5 4.2 4.2L19 7"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V6.5A2.5 2.5 0 0 0 12.5 4h-6A2.5 2.5 0 0 0 4 6.5v6A2.5 2.5 0 0 0 6.5 15H9"/>',
    back: '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
    chevronRight: '<path d="m9 6 6 6-6 6"/>',
    settings: '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 14.6a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z"/>',
    download: '<path d="M12 4v11"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M5 19.5h14"/>',
    external: '<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
    film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    database: '<ellipse cx="12" cy="6" rx="7.5" ry="3"/><path d="M4.5 6v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6"/><path d="M4.5 12v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6"/>',
    wifi: '<path d="M3.5 9.5a13 13 0 0 1 17 0"/><path d="M6.5 13a8.5 8.5 0 0 1 11 0"/><path d="M9.5 16.4a4 4 0 0 1 5 0"/><circle cx="12" cy="19.5" r="1" fill="currentColor" stroke="none"/>',
    monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    spark: '<path d="M12 3.5 13.7 9l5.5 1.7-5.5 1.7L12 18l-1.7-5.6L4.8 10.7 10.3 9Z"/>',
    alert: '<path d="M12 8v5"/><circle cx="12" cy="16.5" r="1" fill="currentColor" stroke="none"/><path d="M10.3 4.3 2.8 17.2A2 2 0 0 0 4.5 20h15a2 2 0 0 0 1.7-2.8L13.7 4.3a2 2 0 0 0-3.4 0Z"/>',
    tv: '<rect x="3" y="5" width="18" height="13" rx="2"/><path d="M9 21h6"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5"/><circle cx="12" cy="8" r="1" fill="currentColor" stroke="none"/>',
    lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10"/>',
    eye: '<path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.6"/>',
    tag: '<path d="m12.5 3.5 8 8-8.2 8.2a1.8 1.8 0 0 1-2.5 0l-5.5-5.5a1.8 1.8 0 0 1 0-2.5Z"/><circle cx="8.2" cy="8.2" r="1.2"/>',
    volume: '<path d="M5 9.5h3l4-3.5v12l-4-3.5H5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18 6a8.5 8.5 0 0 1 0 12"/>',
  };

  const App = {
    state: {
      mode: null,
      status: null,
      videos: [],
      library: {},
      ffmpeg: {},
      settings: {},
      loadedAt: 0,
    },
  };

  App.icon = function (name, extra) {
    const body = ICONS[name] || "";
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="ico${extra ? " " + extra : ""}">${body}</svg>`;
  };

  App.esc = function (value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

  App.api = async function (path, options) {
    const opts = Object.assign({ cache: "no-store" }, options || {});
    if (opts.body && typeof opts.body !== "string") {
      opts.body = JSON.stringify(opts.body);
      opts.headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
    }
    let res;
    try {
      res = await fetch(path, opts);
    } catch (err) {
      throw new Error("无法连接服务，请确认电脑端程序仍在运行");
    }
    let data = null;
    try {
      data = await res.json();
    } catch (err) {
      data = null;
    }
    if (!res.ok) {
      const message = data && (data.detail || data.message);
      throw new Error(typeof message === "string" ? message : `请求失败 (${res.status})`);
    }
    return data;
  };

  App.post = function (path, body) {
    return App.api(path, { method: "POST", body: body || {} });
  };

  App.formatSize = function (bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return value + " B";
    const units = ["KB", "MB", "GB", "TB"];
    let size = value / 1024;
    let index = 0;
    while (size >= 1024 && index < units.length - 1) {
      size /= 1024;
      index += 1;
    }
    return (size >= 100 ? size.toFixed(0) : size.toFixed(1)) + " " + units[index];
  };

  App.formatDuration = function (seconds) {
    const value = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(value / 3600);
    const m = Math.floor((value % 3600) / 60);
    const s = value % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  };

  App.formatDate = function (ts) {
    if (!ts) return "";
    const date = new Date(ts * 1000);
    const now = new Date();
    const diff = (now - date) / 1000;
    if (diff < 60) return "刚刚";
    if (diff < 3600) return Math.floor(diff / 60) + " 分钟前";
    if (diff < 86400) return Math.floor(diff / 3600) + " 小时前";
    if (diff < 86400 * 7) return Math.floor(diff / 86400) + " 天前";
    return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
  };

  App.resolutionLabel = function (video) {
    if (!video) return "";
    if (!video.width || !video.height) return "";
    return `${video.width}×${video.height}`;
  };

  App.codecLabel = function (video) {
    const map = { h264: "H.264", hevc: "H.265", av1: "AV1", vp9: "VP9", vp8: "VP8", mpeg4: "MPEG-4", vc1: "VC-1", mpeg2video: "MPEG-2" };
    return map[video.vcodec] || (video.vcodec ? String(video.vcodec).toUpperCase() : "");
  };

  App.audioLabel = function (video) {
    const map = { aac: "AAC", ac3: "AC-3", eac3: "E-AC-3", dts: "DTS", truehd: "TrueHD", flac: "FLAC", opus: "Opus", mp3: "MP3", vorbis: "Vorbis" };
    let label = map[video.acodec] || (video.acodec ? String(video.acodec).toUpperCase() : "");
    if (label && video.channels > 2) label += " " + video.channels + "ch";
    return label;
  };

  App.progressPercent = function (video) {
    if (!video || !video.progress) return 0;
    const dur = video.progress.dur || video.duration || 0;
    if (!dur) return 0;
    return Math.max(0, Math.min(100, (video.progress.pos / dur) * 100));
  };

  App.isFinished = function (video) {
    const percent = App.progressPercent(video);
    return percent >= 97;
  };

  App.debounce = function (fn, wait) {
    let timer = null;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), wait);
    };
  };

  App.toast = function (message, type) {
    const root = document.getElementById("toast-root");
    if (!root) return;
    const node = document.createElement("div");
    node.className = "toast " + (type || "");
    node.textContent = message;
    root.appendChild(node);
    setTimeout(() => {
      node.style.transition = "opacity .25s ease, transform .25s ease";
      node.style.opacity = "0";
      node.style.transform = "translateY(6px)";
      setTimeout(() => node.remove(), 260);
    }, 3000);
  };

  App.copyText = async function (text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const area = document.createElement("textarea");
        area.value = text;
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        area.remove();
      }
      App.toast("已复制", "ok");
      return true;
    } catch (err) {
      App.toast("复制失败，请手动选择地址", "err");
      return false;
    }
  };

  App.fetchStatus = async function () {
    const data = await App.api("/api/status");
    App.state.status = data;
    App.state.library = data.library || {};
    App.state.ffmpeg = data.ffmpeg || {};
    App.state.settings = data.settings || {};
    return data;
  };

  App.fetchVideos = async function () {
    const data = await App.api("/api/videos");
    App.state.videos = data.videos || [];
    App.state.library = data.state || App.state.library;
    App.state.ffmpegOk = !!data.ffmpeg_ok;
    App.state.loadedAt = Date.now();
    return data;
  };

  App.pendingWork = function () {
    const lib = App.state.library || {};
    const ff = App.state.ffmpeg || {};
    return !!(
      lib.scanning ||
      (lib.probing || 0) > 0 ||
      (lib.thumbs_pending || 0) > 0 ||
      (ff.download && ff.download.active)
    );
  };

  App.thumbUrl = function (video, size) {
    if (!video || !video.thumb) return "";
    return `/api/thumb/${video.id}?v=${video.thumb_v || 0}${size ? "&s=" + size : ""}`;
  };

  App.thumbMarkup = function (video, opts) {
    const options = opts || {};
    const img = App.thumbUrl(video);
    const alt = App.esc(video.name || "");
    return `
      <div class="thumb">
        <div class="thumb-ph">${App.icon("film")}</div>
        ${img ? `<img src="${img}" alt="${alt}" loading="lazy" onload="this.classList.add('ready');if(this.previousElementSibling)this.previousElementSibling.remove()" onerror="this.remove()">` : ""}
        ${options.shade !== false ? '<div class="thumb-shade"></div>' : ""}
        ${
          options.play !== false
            ? `<span class="thumb-play">${App.icon("play")}</span>`
            : ""
        }
        ${video.duration ? `<span class="thumb-duration">${App.formatDuration(video.duration)}</span>` : ""}
        ${
          options.progress !== false && App.progressPercent(video) > 0
            ? `<span class="thumb-progress"><i style="width:${App.progressPercent(video)}%"></i></span>`
            : ""
        }
      </div>`;
  };

  App.boot = function () {
    const isWatch = location.pathname.startsWith("/watch");
    App.state.mode = isWatch ? "watch" : "pc";
    document.body.dataset.mode = App.state.mode;
    const root = document.getElementById("app");
    if (isWatch) {
      if (window.Watch) window.Watch.mount(root);
      else root.textContent = "页面加载失败";
    } else if (window.PC) {
      window.PC.mount(root);
    } else {
      root.textContent = "页面加载失败";
    }
  };

  window.App = App;
})();
