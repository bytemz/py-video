/* 影阁 · 手机观看端与播放器 */
(function () {
  "use strict";

  const S = {
    root: null,
    search: "",
    folder: "all",
    sort: "recent",
    showSearch: false,
    fingerprint: "",
    timer: null,
    status: null,
    loading: false,
  };

  const QUALITY_LABELS = { auto: "自动", original: "原画", 1080: "1080P", 720: "720P" };
  const QUALITY_KEY = "yinge_quality";

  const Watch = {};

  Watch.mount = function (root) {
    S.root = root;
    document.title = "影阁 · 私人影库";
    root.innerHTML = shell();
    bind();
    load(true);
    S.timer = setInterval(tick, 4500);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        load(false);
        Player.reacquireWakeLock();
      }
    });
    document.addEventListener("popstate", () => {
      if (Player.active) Player.close(true);
    });
  };

  function shell() {
    return `
    <div class="watch-shell">
      <header class="watch-header">
        <div class="watch-top">
          <div class="watch-brand">
            <span class="brand-mark">${App.icon("play")}</span>
            <span class="wb-text"><b>影阁</b><small id="server-addr">正在连接…</small></span>
          </div>
          <div class="grow"></div>
          <div class="watch-actions">
            <button class="icon-btn" data-w="toggle-search" title="搜索">${App.icon("search")}</button>
            <button class="icon-btn" data-w="refresh" title="刷新">${App.icon("refresh")}</button>
          </div>
        </div>
        <div class="watch-search hidden" id="watch-search">
          <div class="search-box">
            ${App.icon("search")}
            <input class="input" id="watch-search-input" placeholder="搜索片名或文件夹" autocomplete="off">
          </div>
        </div>
      </header>
      <main class="watch-main">
        <section class="watch-section hidden" id="continue-section">
          <div class="watch-section-head"><h2>继续观看</h2><span id="continue-count"></span></div>
          <div class="continue-row" id="continue-row"></div>
        </section>
        <div class="watch-toolbar">
          <div class="chip-scroll" id="folder-chips"></div>
        </div>
        <div class="watch-sort">
          <span id="result-count">正在载入影库…</span>
          <select class="sort-select" id="sort-select">
            <option value="recent">最近添加</option>
            <option value="name">名称排序</option>
            <option value="duration">时长最长</option>
            <option value="size">文件最大</option>
          </select>
        </div>
        <section class="video-grid" id="video-grid"></section>
        <div id="watch-empty"></div>
        <div class="watch-foot" id="watch-foot">
          <div>影阁 PyVideo</div>
        </div>
      </main>
      <div id="player-root"></div>
    </div>`;
  }

  function bind() {
    S.root.addEventListener("click", async (event) => {
      const target = event.target.closest("[data-w]");
      if (!target) {
        const card = event.target.closest("[data-video]");
        if (card) {
          const video = App.state.videos.find((item) => item.id === card.dataset.video);
          if (video) openVideo(video);
        }
        return;
      }
      const act = target.dataset.w;
      if (act === "toggle-search") {
        S.showSearch = !S.showSearch;
        document.getElementById("watch-search").classList.toggle("hidden", !S.showSearch);
        if (S.showSearch) {
          setTimeout(() => document.getElementById("watch-search-input").focus(), 60);
        } else {
          const input = document.getElementById("watch-search-input");
          input.value = "";
          S.search = "";
          render(true);
        }
      } else if (act === "refresh") {
        target.disabled = true;
        await load(false);
        setTimeout(() => {
          target.disabled = false;
        }, 500);
        App.toast("已刷新", "ok");
      }
    });

    document.getElementById("watch-search-input").addEventListener("input", (event) => {
      S.search = event.target.value.trim().toLowerCase();
      render(true);
    });

    document.getElementById("sort-select").addEventListener("change", (event) => {
      S.sort = event.target.value;
      render(true);
    });
  }

  async function load(initial) {
    if (S.loading) return;
    S.loading = true;
    try {
      const [status] = await Promise.all([App.fetchStatus(), App.fetchVideos()]);
      S.status = status;
      render(initial);
      if (initial) handlePlayParam();
    } catch (err) {
      if (initial) {
        S.root.innerHTML = `
          <div class="watch-shell">
            <div class="watch-empty" style="margin-top:80px">
              <div class="empty-icon">${App.icon("alert")}</div>
              <h3>无法连接影库</h3>
              <p>${App.esc(err.message || "请确认电脑端程序仍在运行，手机和电脑在同一 Wi-Fi")}</p>
              <button class="btn primary" style="margin-top:16px" onclick="location.reload()">重新加载</button>
            </div>
          </div>`;
      }
    } finally {
      S.loading = false;
    }
  }

  async function tick() {
    if (document.visibilityState === "hidden" || S.loading) return;
    try {
      await App.fetchVideos();
      render(false);
    } catch (err) {
      /* 忽略轮询错误 */
    }
  }

  function sortedVideos() {
    const list = App.state.videos.slice();
    const collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });
    if (S.sort === "recent") {
      list.sort((a, b) => b.mtime - a.mtime);
    } else if (S.sort === "name") {
      list.sort((a, b) => collator.compare(a.stem || a.name, b.stem || b.name));
    } else if (S.sort === "duration") {
      list.sort((a, b) => (b.duration || 0) - (a.duration || 0));
    } else if (S.sort === "size") {
      list.sort((a, b) => (b.size || 0) - (a.size || 0));
    }
    return list;
  }

  function filteredVideos() {
    let list = sortedVideos();
    if (S.folder !== "all") list = list.filter((video) => video.folder === S.folder);
    if (S.search) {
      list = list.filter((video) =>
        `${video.name} ${video.folder} ${video.vcodec || ""} ${video.acodec || ""}`
          .toLowerCase()
          .includes(S.search)
      );
    }
    return list;
  }

  function render(force) {
    if (!S.root || !S.status) return;
    const addr = document.getElementById("server-addr");
    if (addr) {
      const urls = S.status.urls || {};
      addr.textContent = `${urls.primary_ip || ""}:${S.status.port}`;
    }
    const sorting = S.folder !== "all" || !!S.search;
    renderContinue(sorting);
    renderChips();
    renderGrid(force);
    renderFooter();
  }

  function renderContinue(hidden) {
    const section = document.getElementById("continue-section");
    const row = document.getElementById("continue-row");
    if (!section || !row) return;
    const items = App.state.videos
      .filter((video) => {
        const pct = App.progressPercent(video);
        return pct > 0.4 && pct < 97;
      })
      .sort((a, b) => (b.progress.updated || 0) - (a.progress.updated || 0))
      .slice(0, 10);
    if (!items.length || hidden) {
      section.classList.add("hidden");
      return;
    }
    section.classList.remove("hidden");
    document.getElementById("continue-count").textContent = `${items.length} 部未看完`;
    row.innerHTML = items
      .map((video) => {
        const dur = video.progress.dur || video.duration || 0;
        const remain = Math.max(0, dur - (video.progress.pos || 0));
        return `
        <button class="continue-card" data-video="${video.id}">
          ${App.thumbMarkup(video, { play: true, shade: true, progress: true })}
          <div class="c-title">${App.esc(video.stem)}</div>
          <div class="c-meta">继续观看 · 还剩 ${App.formatDuration(remain)}</div>
        </button>`;
      })
      .join("");
  }

  function renderChips() {
    const box = document.getElementById("folder-chips");
    if (!box) return;
    const videos = App.state.videos;
    const counts = new Map();
    for (const video of videos) counts.set(video.folder || "未分类", (counts.get(video.folder || "未分类") || 0) + 1);
    const folders = Array.from(counts.keys()).sort((a, b) => a.localeCompare(b, "zh-CN"));
    if (S.folder !== "all" && !counts.has(S.folder)) S.folder = "all";
    const chips = [
      `<button class="fchip ${S.folder === "all" ? "active" : ""}" data-folder="all">全部<span class="n">${videos.length}</span></button>`,
    ].concat(
      folders.map(
        (folder) =>
          `<button class="fchip ${S.folder === folder ? "active" : ""}" data-folder="${App.esc(folder)}" title="${App.esc(folder)}">${App.esc(folder)}<span class="n">${counts.get(folder)}</span></button>`
      )
    );
    box.innerHTML = chips.join("");
    box.querySelectorAll("[data-folder]").forEach((chip) => {
      chip.addEventListener("click", () => {
        S.folder = chip.dataset.folder;
        renderChips();
        renderGrid(true);
        renderContinue(S.folder !== "all" || !!S.search);
        document.getElementById("result-count").textContent = `${filteredVideos().length} 部影片`;
      });
    });
  }

  function shortRes(video) {
    if (!video.height) return "";
    if (video.height >= 2160) return "4K";
    if (video.height >= 1440) return "2K";
    return video.height + "P";
  }

  function renderGrid(force) {
    const grid = document.getElementById("video-grid");
    const empty = document.getElementById("watch-empty");
    if (!grid) return;
    const list = filteredVideos();
    document.getElementById("result-count").textContent = `${list.length} 部影片`;
    const fingerprint = JSON.stringify(
      list.map((v) => [v.id, v.thumb, v.mtime, v.progress ? v.progress.updated : 0])
    );
    if (!force && fingerprint === S.fingerprint) return;
    S.fingerprint = fingerprint;

    if (!list.length) {
      grid.innerHTML = "";
      const total = App.state.videos.length;
      const watchBase = (S.status && S.status.urls && S.status.urls.pc) || location.origin + "/pc";
      empty.innerHTML = total
        ? `<div class="watch-empty">
             <div class="empty-icon">${App.icon("search")}</div>
             <h3>没有找到影片</h3>
             <p>换个关键词，或选择“全部”文件夹。</p>
           </div>`
        : `<div class="watch-empty">
             <div class="empty-icon">${App.icon("film")}</div>
             <h3>影库还是空的</h3>
             <p>请先在电脑上打开管理页面，添加一个存放视频的文件夹。手机与电脑需要连接同一个 Wi-Fi。</p>
             <a class="pc-link" href="${App.esc(watchBase)}">${App.esc(watchBase)}</a>
           </div>`;
      return;
    }
    empty.innerHTML = "";
    grid.innerHTML = list
      .map((video) => {
        const res = shortRes(video);
        const codec = App.codecLabel(video);
        return `
        <button class="video-card" data-video="${video.id}" title="${App.esc(video.folder || "")}">
          ${App.thumbMarkup(video, { play: false, shade: false, progress: true })}
          <div class="v-title">${App.esc(video.stem)}</div>
          <div class="v-meta">
            ${res ? `<em>${App.esc(res)}</em>` : ""}
            ${codec ? `<span>${App.esc(codec)}</span>` : `<span>分析中</span>`}
            ${video.hdr ? `<span class="dot"></span><span>HDR</span>` : ""}
          </div>
        </button>`;
      })
      .join("");
  }

  function renderFooter() {
    const foot = document.getElementById("watch-foot");
    if (!foot || !S.status) return;
    const lib = App.state.library || {};
    const status = lib.scanning
      ? "正在扫描影库…"
      : lib.probing > 0
        ? "正在分析视频…"
        : `共 ${App.state.videos.length} 部影片`;
    foot.innerHTML = `<div>${App.esc(status)}</div><div>影阁 PyVideo v${App.esc(S.status.version || "1.0.0")} · <a href="/pc">电脑管理</a></div>`;
  }

  function openVideo(video) {
    const queue = filteredVideos();
    const index = queue.findIndex((item) => item.id === video.id);
    Player.open(video, index >= 0 ? queue : sortedVideos());
  }

  function handlePlayParam() {
    const params = new URLSearchParams(location.search);
    const id = params.get("play");
    if (!id) return;
    const video = App.state.videos.find((item) => item.id === id);
    history.replaceState(null, "", location.pathname);
    if (video) openVideo(video);
    else App.toast("没有找到该视频，可能已被移动", "err");
  }

  /* ---------------- player ---------------- */

  const P = {
    active: false,
    el: null,
    art: null,
    videoEl: null,
    video: null,
    info: null,
    queue: [],
    index: -1,
    quality: localStorage.getItem(QUALITY_KEY) || "auto",
    force: false,
    hls: null,
    switching: false,
    errorVisible: false,
    pendingSeek: 0,
    resumeTarget: 0,
    resumeTimer: null,
    saveTimer: null,
    hintTimer: null,
    toastTimer: null,
    wakeLock: null,
    autoRetries: 0,
    shouldAutoplay: true,
    subTracks: [],
    defaultSubIndex: -1,
    subActive: -1,
  };

  const Player = {
    active: false,
    open,
    close,
    requestClose,
  };

  function preferredQuality() {
    return (
      localStorage.getItem(QUALITY_KEY) ||
      (App.state.settings && App.state.settings.quality) ||
      "auto"
    );
  }

  function open(video, queue) {
    if (P.active) close(false);
    P.active = true;
    Player.active = true;
    P.video = video;
    P.queue = queue || [video];
    P.index = P.queue.findIndex((item) => item.id === video.id);
    P.info = null;
    P.art = null;
    P.videoEl = null;
    P.hls = null;
    P.switching = false;
    P.errorVisible = false;
    P.pendingSeek = 0;
    P.resumeTarget = 0;
    P.autoRetries = 0;
    P.shouldAutoplay = true;
    P.subTracks = [];
    P.defaultSubIndex = -1;
    P.subActive = -1;
    P.quality = preferredQuality();
    P.force = false;
    document.body.style.overflow = "hidden";
    document.title = video.stem + " · 影阁";
    if ("mediaSession" in navigator && "MediaMetadata" in window) {
      try {
        const artwork = video.thumb
          ? [{ src: new URL(App.thumbUrl(video), location.origin).href, sizes: "640x360", type: "image/jpeg" }]
          : [];
        navigator.mediaSession.metadata = new MediaMetadata({
          title: video.stem,
          artist: "影阁",
          album: video.folder || "",
          artwork,
        });
      } catch (err) {
        /* 忽略锁屏信息 */
      }
    }
    P.el = document.createElement("div");
    P.el.className = "player";
    Object.assign(P.el.style, {
      position: "fixed",
      top: "0",
      right: "0",
      bottom: "0",
      left: "0",
      width: "100%",
      height: "100%",
      background: "#000",
      zIndex: "200",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
    });
    P.el.innerHTML = playerMarkup(video);
    document.body.appendChild(P.el);
    bindPlayerShell();
    if (history.state && history.state.yingePlayer) {
      history.replaceState({ yingePlayer: true }, "");
    } else {
      history.pushState({ yingePlayer: true }, "");
    }
    startPlayback(P.quality, false);
  }

  function playerMarkup(video) {
    return `
      <div class="art-host" id="art-host"></div>
      <div class="player-head" id="p-head">
        <button class="icon-btn" data-p="back" title="返回列表">${App.icon("back")}</button>
        <div class="player-head-title">
          <b>${App.esc(video.stem)}</b>
          <small id="p-sub">${App.esc(video.folder || "")}</small>
        </div>
      </div>
      <div class="player-center" id="p-center">
        <div class="spinner"></div>
        <div class="pc-title">正在准备播放…</div>
      </div>
      <div class="player-error hidden" id="p-error"></div>
      <div class="player-hint hidden" id="p-hint"></div>
      <div class="resume-toast hidden" id="p-resume"></div>`;
  }

  function bindPlayerShell() {
    P.el.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-p]");
      if (!btn) return;
      const act = btn.dataset.p;
      if (act === "back") requestClose();
      else if (act === "retry") {
        P.shouldAutoplay = true;
        startPlayback(P.quality, P.force);
      } else if (act === "compat") {
        P.shouldAutoplay = true;
        startPlayback("1080", true);
      } else if (act === "replay") {
        hideEnded();
        if (P.art) {
          P.art.currentTime = 0;
          playArt();
        }
      } else if (act === "next") {
        const next = nextVideo();
        if (next) openNext(next);
      }
    });
    clearInterval(P.saveTimer);
    P.saveTimer = setInterval(() => {
      if (P.active && P.videoEl && !P.videoEl.paused && !P.videoEl.ended) saveProgress(false);
    }, 5000);
  }

  function setHeadSub(text) {
    const sub = document.getElementById("p-sub");
    if (sub) sub.textContent = text || "";
  }

  async function startPlayback(quality, force) {
    if (!P.active) return;
    P.switching = true;
    P.force = !!force;
    P.quality = quality || "auto";
    localStorage.setItem(QUALITY_KEY, P.quality);
    hideError();
    hideEnded();
    hideHint();
    cleanupSource();
    showCenter(
      `<div class="spinner"></div><div class="pc-title">正在准备…</div><div class="pc-sub">${App.esc(P.video.name)}</div>`
    );
    let info;
    try {
      info = await fetchInfo(P.quality, P.force);
    } catch (err) {
      P.switching = false;
      showPlayerError("无法开始播放", err.message || "读取播放信息失败", false);
      return;
    }
    if (!P.active) return;
    P.info = info;
    const subText =
      info.mode === "direct"
        ? info.reason || "直连播放"
        : info.mode === "hls"
          ? info.hls_copy
            ? "原画转封装"
            : "转码播放"
          : P.video.folder || "";
    setHeadSub(subText);
    P.resumeTarget = info.resume || 0;
    P.pendingSeek = P.pendingSeek || 0;

    if (info.mode === "direct") {
      try {
        await createArtPlayer(info.url, "mp4");
        if (!P.active) return;
        P.switching = false;
        if (P.shouldAutoplay) playArt();
      } catch (err) {
        P.switching = false;
        showPlayerError("播放器加载失败", err.message || "无法初始化播放器", false);
      }
      return;
    }

    if (info.mode === "hls") {
      showCenter(
        `<div class="spinner"></div><div class="pc-title">正在准备${info.hls_copy ? "转封装" : "转码"}</div><div class="pc-sub">${info.hls_copy ? "原画视频只需重新封装，通常几秒内开始" : "首次播放需要生成视频分片，请稍候"}</div>`
      );
      try {
        const started = await App.post("/api/hls/start", {
          id: P.video.id,
          quality: info.hls_quality || "1080",
        });
        if (!P.active) return;
        P.info = Object.assign({}, info, { hls_copy: !!started.copy, mode: "hls" });
        setHeadSub(started.copy ? "原画转封装" : "转码播放");
        await createArtPlayer(started.playlist, "m3u8");
        if (!P.active) return;
        P.switching = false;
        showHintIfTranscode(!started.copy);
        if (P.shouldAutoplay) playArt();
      } catch (err) {
        P.switching = false;
        showPlayerError("转码失败", err.message || "无法启动转码", true);
      }
      return;
    }

    P.switching = false;
    showPlayerError(
      info.mode === "analyzing" ? "视频分析中" : "无法播放",
      info.message || "当前格式暂时无法播放，请确认电脑端已安装 FFmpeg 并完成扫描。",
      false
    );
  }

  async function fetchInfo(quality, force) {
    for (let attempt = 0; attempt < 14; attempt += 1) {
      const info = await App.api(
        `/api/playinfo/${P.video.id}?quality=${encodeURIComponent(quality)}&force=${force ? 1 : 0}`
      );
      if (info.mode !== "analyzing") return info;
      showCenter(
        `<div class="spinner"></div><div class="pc-title">正在读取视频信息…</div><div class="pc-sub">首次分析 4K 视频需要一点时间</div>`
      );
      await delay(1600);
      if (!P.active) return info;
    }
    throw new Error("视频分析超时，请稍后在电脑端重新扫描");
  }

  function assetUrl(path) {
    const meta = document.querySelector('meta[name="app-version"]');
    const version = meta ? meta.content : "";
    return version ? `${path}?v=${encodeURIComponent(version)}` : path;
  }

  function loadArtPlayer() {
    if (window.Artplayer) return Promise.resolve(window.Artplayer);
    if (window.__artPlayerPromise) return window.__artPlayerPromise;
    window.__artPlayerPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = assetUrl("/static/vendor/artplayer.js");
      script.onload = () => {
        if (window.Artplayer) resolve(window.Artplayer);
        else reject(new Error("播放器组件初始化失败"));
      };
      script.onerror = () => reject(new Error("播放器组件加载失败"));
      document.head.appendChild(script);
    });
    return window.__artPlayerPromise;
  }

  function buildSettings() {
    return [
      {
        html: "画质",
        tooltip: QUALITY_LABELS[P.quality] || "自动",
        selector: [
          { html: "自动", value: "auto", default: P.quality === "auto" },
          { html: "原画", value: "original", default: P.quality === "original" },
          { html: "1080P", value: "1080", default: P.quality === "1080" },
          { html: "720P", value: "720", default: P.quality === "720" },
        ],
        onSelect(item) {
          const value = item.value;
          if (this.setting) this.setting.show = false;
          if (value === P.quality) return;
          setTimeout(() => chooseQuality(value), 60);
        },
      },
    ];
  }

  function buildControls() {
    const controls = [];
    if (nextVideo()) {
      controls.push({
        name: "next",
        position: "right",
        html: `<span class="art-next-btn">${App.icon("chevronRight")}</span>`,
        tooltip: "下一集",
        click: () => {
          const item = nextVideo();
          if (item) openNext(item);
        },
      });
    }
    return controls;
  }

  async function createArtPlayer(url, type) {
    const ArtplayerCtor = await loadArtPlayer();
    if (!P.active) return;
    const host = document.getElementById("art-host");
    if (!host) throw new Error("播放器容器不存在");
    Object.assign(host.style, {
      position: "absolute",
      top: "0",
      right: "0",
      bottom: "0",
      left: "0",
      width: "100%",
      height: "100%",
    });
    host.innerHTML = "";
    const mount = document.createElement("div");
    mount.className = "art-mount";
    mount.style.width = "100%";
    mount.style.height = "100%";
    host.appendChild(mount);
    const art = new ArtplayerCtor({
      container: mount,
      url,
      type,
      poster: P.video && P.video.thumb ? App.thumbUrl(P.video) : "",
      theme: "#6f8bff",
      lang: "zh-cn",
      autoplay: false,
      autoPlayback: false,
      playsInline: true,
      autoSize: false,
      autoMini: false,
      gesture: true,
      fastForward: true,
      autoOrientation: true,
      lock: true,
      airplay: true,
      playbackRate: true,
      aspectRatio: true,
      setting: true,
      settings: buildSettings(),
      controls: buildControls(),
      hotkey: true,
      pip: true,
      fullscreen: true,
      fullscreenWeb: true,
      miniProgressBar: true,
      subtitleOffset: true,
      volume: 0.9,
      customType: {
        mp4: (video, source) => {
          video.src = source;
          video.load();
        },
        m3u8: (video, source, player) => {
          setupHls(video, source, player);
        },
      },
    });
    const artRoot = mount.querySelector(".art-video-player");
    if (artRoot) {
      artRoot.style.width = "100%";
      artRoot.style.height = "100%";
    }
    P.art = art;
    P.videoEl = art.video;
    P.hls = null;
    P.switching = false;
    bindArtEvents(art);
    applyTracks();
    addSubtitleSetting(art);
    art.on("control", (show) => {
      const head = document.getElementById("p-head");
      if (head) head.classList.toggle("faded", !show);
    });
    art.on("ready", () => {
      checkResume();
      setTimeout(() => {
        if (P.active && P.art === art) window.dispatchEvent(new Event("resize"));
      }, 120);
    });
    setTimeout(() => {
      if (P.active && P.art === art) window.dispatchEvent(new Event("resize"));
    }, 350);
    art.once("destroy", () => {
      if (P.hls) {
        try {
          P.hls.destroy();
        } catch (err) {
          /* 忽略 */
        }
        P.hls = null;
      }
    });
    return art;
  }

  function bindArtEvents(art) {
    const video = art.video;
    video.addEventListener("loadedmetadata", () => {
      checkResume();
      applySubtitleMode();
    });
    video.addEventListener("progress", checkResume);
    video.addEventListener("canplay", () => {
      checkResume();
      hideCenter();
      if (P.shouldAutoplay && video.paused && !P.errorVisible) playArt();
    });
    video.addEventListener("playing", () => {
      P.shouldAutoplay = false;
      hideCenter();
      hideError();
      acquireWakeLock();
      stopHintAfter(7000);
    });
    video.addEventListener("pause", () => {
      if (!P.active) return;
      saveProgress(false);
      if (!video.ended) releaseWakeLock();
    });
    video.addEventListener("play", acquireWakeLock);
    video.addEventListener("ended", onEnded);
    video.addEventListener("error", () => {
      if (P.art !== art) return;
      handleVideoError(video);
    });
  }

  function handleVideoError(video) {
    if (!P.active || P.switching || P.errorVisible || video.ended) return;
    const code = video.error ? video.error.code : 0;
    const message =
      code === 4
        ? "当前浏览器无法解码这个视频流。可以尝试切换到兼容模式，将视频转码为 H.264 后再播放。"
        : `播放中断${code ? `（错误 ${code}）` : ""}，可能是网络波动或视频编码问题。`;
    handleMediaFailure(message, true);
  }

  function handleMediaFailure(message, canCompat) {
    if (!P.active) return;
    if (P.info && P.info.mode === "hls" && P.autoRetries < 1) {
      P.autoRetries += 1;
      P.shouldAutoplay = true;
      setTimeout(() => {
        if (P.active && !P.errorVisible) startPlayback(P.quality, P.force);
      }, 900);
      return;
    }
    showPlayerError("播放失败", message, canCompat);
  }

  async function setupHls(video, url, art) {
    if (!P.active) return;
    const nativeHls = video.canPlayType("application/vnd.apple.mpegurl");
    if (nativeHls) {
      video.src = url;
      video.load();
      return;
    }
    let Hls;
    try {
      Hls = await loadHlsJs();
    } catch (err) {
      handleMediaFailure("播放器组件加载失败，请确认网络访问正常后重试", false);
      return;
    }
    if (!P.active || P.art !== art) return;
    if (!Hls || !Hls.isSupported()) {
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = url;
        return;
      }
      handleMediaFailure("当前浏览器不支持 HLS 播放，请尝试使用 Safari 打开", false);
      return;
    }
    const hls = new Hls({
      maxBufferLength: 30,
      maxMaxBufferLength: 90,
      backBufferLength: 30,
      enableWorker: true,
    });
    P.hls = hls;
    hls.loadSource(url);
    hls.attachMedia(video);
    hls.on(Hls.Events.ERROR, (event, data) => {
      if (!data.fatal || !P.active || P.art !== art) return;
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        hls.startLoad();
        return;
      }
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        hls.recoverMediaError();
        return;
      }
      handleMediaFailure(`视频流错误：${data.details || "未知错误"}`, true);
    });
  }

  function loadHlsJs() {
    if (window.Hls) return Promise.resolve(window.Hls);
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = assetUrl("/static/vendor/hls.min.js");
      script.onload = () => resolve(window.Hls);
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  function playArt() {
    if (!P.active || !P.art) return;
    try {
      const result = P.art.play();
      if (result && typeof result.catch === "function") {
        result.catch((err) => {
          if (err && err.name === "NotAllowedError") P.shouldAutoplay = false;
          if (P.active) hideCenter();
        });
      }
    } catch (err) {
      P.shouldAutoplay = false;
      hideCenter();
    }
  }

  function applyTracks() {
    const video = P.videoEl;
    if (!video) return;
    P.subTracks = [];
    P.defaultSubIndex = -1;
    P.subActive = -1;
    ((P.info && P.info.subs) || []).forEach((sub, index) => {
      const track = document.createElement("track");
      track.kind = "subtitles";
      track.label = sub.label;
      track.srclang = "zh";
      track.src = sub.url;
      track.setAttribute("data-sub", "1");
      if (sub.default) {
        track.default = true;
        P.defaultSubIndex = index;
      }
      video.appendChild(track);
      P.subTracks.push(track);
    });
    P.subActive = P.defaultSubIndex;
    applySubtitleMode();
  }

  function applySubtitleMode() {
    P.subTracks.forEach((element, index) => {
      try {
        if (element.track) {
          element.track.mode = index === P.subActive ? "showing" : "disabled";
        }
      } catch (err) {
        /* 忽略不支持的字幕轨 */
      }
    });
  }

  function setSubtitle(value) {
    P.subActive = value === "off" ? -1 : Number(value);
    applySubtitleMode();
  }

  function addSubtitleSetting(art) {
    const subs = (P.info && P.info.subs) || [];
    if (!subs.length) return;
    const current = P.defaultSubIndex >= 0 ? subs[P.defaultSubIndex].label : "关闭";
    art.setting.add({
      html: "字幕",
      tooltip: current,
      selector: [
        { html: "关闭", value: "off", default: P.defaultSubIndex < 0 },
        ...subs.map((sub, index) => ({
          html: sub.label,
          value: String(index),
          default: index === P.defaultSubIndex,
        })),
      ],
      onSelect(item) {
        setSubtitle(item.value);
        updateSettingValue("字幕", item.html);
        return item.html;
      },
    });
  }

  function updateSettingValue(name, value) {
    document.querySelectorAll(".art-setting-item").forEach((row) => {
      const label = row.querySelector(".art-setting-item-left-text");
      if (label && label.textContent.trim() === name) {
        const right = row.querySelector(".art-setting-item-right");
        if (right) right.textContent = value;
      }
    });
  }

  function checkResume() {
    if (!P.active) return;
    const target = P.pendingSeek || P.resumeTarget;
    if (!target || !Number.isFinite(target)) return;
    const duration = currentDuration();
    if (duration && target >= duration - 3) {
      P.pendingSeek = 0;
      P.resumeTarget = 0;
      return;
    }
    let canSeek = true;
    const seekable = P.videoEl ? P.videoEl.seekable : null;
    if (!seekable || !seekable.length) {
      canSeek = false;
    } else {
      try {
        if (seekable.end(seekable.length - 1) < target - 2) canSeek = false;
      } catch (err) {
        canSeek = false;
      }
    }
    if (!canSeek) {
      if (!P.resumeTimer) {
        P.resumeTimer = setTimeout(() => {
          P.resumeTimer = null;
          if (!P.active || !(P.pendingSeek || P.resumeTarget)) return;
          P.pendingSeek = 0;
          P.resumeTarget = 0;
          showHint("目标位置尚未就绪，已从头开始播放", 5000);
        }, 12000);
      }
      return;
    }
    if (P.resumeTimer) {
      clearTimeout(P.resumeTimer);
      P.resumeTimer = null;
    }
    const wasResume = !!P.resumeTarget && !P.pendingSeek;
    P.pendingSeek = 0;
    P.resumeTarget = 0;
    try {
      P.videoEl.currentTime = target;
    } catch (err) {
      return;
    }
    if (wasResume) showResumeToast(target);
  }

  function currentDuration() {
    if (P.info && P.info.duration) return P.info.duration;
    const value = P.videoEl ? P.videoEl.duration : 0;
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  function chooseQuality(value) {
    if (!P.active || value === P.quality) return;
    const time = P.videoEl ? P.videoEl.currentTime || 0 : 0;
    P.pendingSeek = time;
    P.resumeTarget = 0;
    P.autoRetries = 0;
    P.shouldAutoplay = P.videoEl ? (P.videoEl.ended ? true : !P.videoEl.paused) : true;
    startPlayback(value, false);
  }

  function showCenter(html, plain) {
    const center = document.getElementById("p-center");
    if (!center) return;
    center.innerHTML = html;
    center.classList.remove("hidden");
    center.classList.toggle("plain", !!plain);
  }

  function hideCenter() {
    const center = document.getElementById("p-center");
    if (center) center.classList.add("hidden");
  }

  function showPlayerError(title, message, canCompat) {
    if (!P.active) return;
    P.errorVisible = true;
    hideCenter();
    if (P.art) {
      try {
        P.art.pause();
        if (P.art.fullscreen) P.art.fullscreen = false;
        if (P.art.fullscreenWeb) P.art.fullscreenWeb = false;
      } catch (err) {
        /* 忽略 */
      }
    }
    const box = document.getElementById("p-error");
    if (!box) return;
    const compat = canCompat && (App.state.ffmpegOk || (P.video && P.video.copyable));
    box.classList.remove("hidden");
    box.innerHTML = `
      <div class="err-icon">${App.icon("alert")}</div>
      <h3>${App.esc(title)}</h3>
      <p>${App.esc(message)}</p>
      <div class="err-actions">
        <button class="btn sm" data-p="retry">重试</button>
        ${compat ? `<button class="btn sm primary" data-p="compat">兼容模式（1080P）</button>` : ""}
        <button class="btn sm ghost" data-p="back">返回列表</button>
      </div>`;
  }

  function hideError() {
    P.errorVisible = false;
    const box = document.getElementById("p-error");
    if (box) box.classList.add("hidden");
  }

  function showResumeToast(seconds) {
    const toast = document.getElementById("p-resume");
    if (!toast) return;
    toast.textContent = `已从上次位置 ${App.formatDuration(seconds)} 继续播放`;
    toast.classList.remove("hidden");
    clearTimeout(P.toastTimer);
    P.toastTimer = setTimeout(() => toast.classList.add("hidden"), 3200);
  }

  function showHint(text, ms) {
    const hint = document.getElementById("p-hint");
    if (!hint) return;
    hint.textContent = text;
    hint.classList.remove("hidden");
    clearTimeout(P.hintTimer);
    P.hintTimer = setTimeout(() => hint.classList.add("hidden"), ms || 5000);
  }

  function hideHint() {
    const hint = document.getElementById("p-hint");
    if (hint) hint.classList.add("hidden");
    clearTimeout(P.hintTimer);
  }

  function showHintIfTranscode(isTranscode) {
    if (isTranscode) {
      showHint("正在转码，拖动到尚未生成的位置会稍作等待", 7000);
    }
  }

  function stopHintAfter(ms) {
    clearTimeout(P.hintTimer);
    P.hintTimer = setTimeout(() => hideHint(), ms);
  }

  function nextVideo() {
    if (!P.queue || P.index < 0 || P.index >= P.queue.length - 1) return null;
    return P.queue[P.index + 1];
  }

  function openNext(next) {
    saveProgress(false);
    cleanupSource();
    clearTimers();
    const queue = P.queue;
    const oldEl = P.el;
    P.active = false;
    if (oldEl) oldEl.remove();
    P.el = null;
    document.body.style.overflow = "";
    Player.active = false;
    open(next, queue);
    try {
      history.replaceState({ yingePlayer: true }, "");
    } catch (err) {
      /* 忽略 */
    }
  }

  function onEnded() {
    if (!P.active) return;
    saveProgress(true, true);
    releaseWakeLock();
    hideCenter();
    const next = nextVideo();
    hideEnded();
    const overlay = document.createElement("div");
    overlay.className = "ended-overlay";
    overlay.id = "p-ended";
    overlay.innerHTML = `
      <h3>播放完毕</h3>
      <div class="ended-actions">
        <button class="btn sm" data-p="replay">重播</button>
        ${next ? `<button class="btn sm primary" data-p="next">下一集</button>` : ""}
        <button class="btn sm ghost" data-p="back">返回列表</button>
      </div>`;
    P.el.appendChild(overlay);
  }

  function hideEnded() {
    const overlay = document.getElementById("p-ended");
    if (overlay) overlay.remove();
  }

  function cleanupSource() {
    if (P.art) {
      try {
        P.art.destroy(true);
      } catch (err) {
        /* 忽略 */
      }
      P.art = null;
    }
    P.videoEl = null;
    P.hls = null;
    P.subTracks = [];
    P.defaultSubIndex = -1;
    P.subActive = -1;
    const host = document.getElementById("art-host");
    if (host) host.innerHTML = "";
  }

  function saveProgress(keepalive, ended) {
    if (!P.active || !P.video || !P.videoEl) return;
    const duration = currentDuration();
    const position = ended ? duration : P.videoEl.currentTime || 0;
    if (!duration || !Number.isFinite(position)) return;
    const payload = { id: P.video.id, position, duration };
    P.video.progress = {
      pos: position,
      dur: duration,
      updated: Math.floor(Date.now() / 1000),
    };
    if (keepalive) {
      try {
        fetch("/api/progress", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          keepalive: true,
        }).catch(() => {});
      } catch (err) {
        /* 忽略 */
      }
    } else {
      App.post("/api/progress", payload).catch(() => {});
    }
  }

  function clearTimers() {
    clearInterval(P.saveTimer);
    clearTimeout(P.hintTimer);
    clearTimeout(P.toastTimer);
    clearTimeout(P.resumeTimer);
    P.saveTimer = null;
    P.hintTimer = null;
    P.resumeTimer = null;
  }

  function requestClose() {
    if (history.state && history.state.yingePlayer) {
      history.back();
      setTimeout(() => {
        if (P.active) close(true);
      }, 250);
    } else {
      close(true);
    }
  }

  function close(refresh) {
    if (!P.active) return;
    saveProgress(true);
    releaseWakeLock();
    clearTimers();
    P.active = false;
    Player.active = false;
    cleanupSource();
    if (P.el) P.el.remove();
    P.el = null;
    P.videoEl = null;
    P.info = null;
    P.hls = null;
    document.body.style.overflow = "";
    document.title = "影阁 · 私人影库";
    if ("mediaSession" in navigator) {
      try {
        navigator.mediaSession.metadata = null;
      } catch (err) {
        /* 忽略 */
      }
    }
    if (history.state && history.state.yingePlayer) {
      history.replaceState(null, "");
    }
    if (refresh) {
      render(true);
    }
  }

  async function acquireWakeLock() {
    if (!P.active || !("wakeLock" in navigator) || P.wakeLock) return;
    try {
      P.wakeLock = await navigator.wakeLock.request("screen");
      P.wakeLock.addEventListener("release", () => {
        P.wakeLock = null;
      });
    } catch (err) {
      P.wakeLock = null;
    }
  }

  function releaseWakeLock() {
    if (P.wakeLock) {
      try {
        P.wakeLock.release();
      } catch (err) {
        /* 忽略 */
      }
      P.wakeLock = null;
    }
  }

  Player.reacquireWakeLock = function () {
    if (P.active && P.videoEl && !P.videoEl.paused) acquireWakeLock();
  };

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  if ("mediaSession" in navigator) {
    try {
      navigator.mediaSession.setActionHandler("play", () => {
        if (P.videoEl) P.videoEl.play().catch(() => {});
      });
      navigator.mediaSession.setActionHandler("pause", () => {
        if (P.videoEl) P.videoEl.pause();
      });
      navigator.mediaSession.setActionHandler("seekbackward", () => {
        if (P.videoEl) P.videoEl.currentTime = Math.max(0, P.videoEl.currentTime - 10);
      });
      navigator.mediaSession.setActionHandler("seekforward", () => {
        if (P.videoEl) P.videoEl.currentTime = Math.min(currentDuration(), P.videoEl.currentTime + 10);
      });
      navigator.mediaSession.setActionHandler("nexttrack", () => {
        const next = nextVideo();
        if (next) openNext(next);
      });
    } catch (err) {
      /* 浏览器不支持媒体控制 */
    }
  }

  window.addEventListener("pagehide", () => {
    if (P.active) saveProgress(true);
  });

  window.addEventListener("orientationchange", () => {
    setTimeout(() => {
      if (P.active) window.dispatchEvent(new Event("resize"));
    }, 350);
  });

  window.Watch = Watch;
})();
