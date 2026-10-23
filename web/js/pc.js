/* 影阁 · 电脑管理端 */
(function () {
  "use strict";

  const S = {
    root: null,
    search: "",
    filter: "all",
    fingerprint: "",
    timer: null,
    busy: false,
    lastDownloadActive: false,
    ffmpegFingerprint: "",
    initialized: false,
  };

  const PC = {};

  PC.mount = function (root) {
    S.root = root;
    document.title = "影阁 · 电脑管理";
    root.className = "";
    root.innerHTML = shell();
    bindEvents();
    loadAll(true);
    S.timer = setInterval(tick, 4000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") loadAll(false);
    });
  };

  function shell() {
    return `
    <div class="pc-shell">
      <header class="topbar">
        <div class="brand">
          <span class="brand-mark">${App.icon("play")}</span>
          <span class="brand-text"><b>影阁</b><small>PYVIDEO · 私人影库</small></span>
        </div>
        <div class="topbar-spacer"></div>
        <div class="topbar-tags">
          <span class="status-pill"><i></i>服务运行中</span>
          <span class="addr-pill" id="top-addr"><span>正在获取地址…</span><button data-act="copy-watch" title="复制手机地址">${App.icon("copy")}</button></span>
        </div>
        <div class="topbar-actions">
          <a class="btn ghost sm" href="/watch" target="_blank" rel="noopener">${App.icon("phone")}手机版</a>
        </div>
      </header>

      <main class="pc-main">
        <section class="hero-grid">
          <div class="card hero">
            <div class="hero-copy">
              <span class="eyebrow">PHONE CINEMA</span>
              <h1>把 4K 电影<br><em>装进手机</em></h1>
              <p>电脑负责管理与转码，手机只负责观看。连接同一个 Wi-Fi，扫码即播；MP4 直连原画，MKV 与特殊音轨自动转封装或转码。</p>
              <div class="hero-actions">
                <button class="btn primary" data-act="copy-watch">${App.icon("copy")}复制手机地址</button>
                <a class="btn ghost" href="/watch" target="_blank" rel="noopener">${App.icon("eye")}预览手机端</a>
              </div>
              <div class="hero-url">${App.icon("wifi")}<b id="hero-url">—</b></div>
            </div>
            <div class="hero-qr">
              <div class="qr-frame"><img id="qr-img" src="/api/qr.svg?view=watch" alt="手机访问二维码"></div>
              <div class="qr-caption">用 iPhone 相机<br>或 Chrome 扫码</div>
            </div>
          </div>
          <div class="stat-stack" id="stat-stack"></div>
        </section>

        <section class="card">
          <div class="section-head">
            <div>
              <div class="section-title"><span class="dot"></span>视频文件夹</div>
              <div class="section-sub" id="folder-sub">添加存放视频的文件夹，支持子目录</div>
            </div>
            <div class="grow"></div>
            <div class="section-actions">
              <button class="btn sm" data-act="scan">${App.icon("refresh")}重新扫描</button>
            </div>
          </div>
          <form class="folder-form" id="folder-form">
            <div class="path-input">
              ${App.icon("folder")}
              <input id="folder-input" placeholder="例如 D:\\Movies，或 NAS 映射盘 Z:\\" autocomplete="off" spellcheck="false">
              <button type="button" class="browse" data-act="browse">浏览…</button>
            </div>
            <button class="btn primary" type="submit">${App.icon("plus")}添加文件夹</button>
          </form>
          <div class="chip-row" id="folder-suggestions"></div>
          <div id="scan-state"></div>
          <div class="folder-list" id="folder-list"></div>
        </section>

        <section class="card">
          <div class="section-head">
            <div>
              <div class="section-title"><span class="dot"></span>视频库 <span class="badge muted" id="library-count">0</span></div>
              <div class="section-sub" id="library-sub">扫描完成后会显示编码信息与播放方式</div>
            </div>
          </div>
          <div class="library-toolbar">
            <div class="search-box">
              ${App.icon("search")}
              <input class="input" id="library-search" placeholder="搜索片名、文件夹或编码" autocomplete="off">
            </div>
            <select class="input" id="library-filter" style="width:150px">
              <option value="all">全部格式</option>
              <option value="direct">可直接播放</option>
              <option value="hls">需要转换</option>
            </select>
          </div>
          <div class="table-wrap" id="table-wrap"></div>
        </section>

        <section class="settings-grid">
          <div class="card" id="settings-card"></div>
          <div class="card" id="ffmpeg-card"></div>
        </section>

        <footer class="pc-foot">
          <span>影阁 PyVideo · 仅建议在家庭局域网内使用</span>
          <span>手机首次打不开时，请检查 Windows 防火墙是否放行了专用网络</span>
        </footer>
      </main>
    </div>`;
  }

  function bindEvents() {
    const root = S.root;

    root.addEventListener("click", async (event) => {
      const target = event.target.closest("[data-act]");
      if (!target) return;
      const act = target.dataset.act;
      const id = target.dataset.id;
      try {
        if (act === "copy-watch") {
          const url = (App.state.status && App.state.status.urls.watch) || "";
          if (url) App.copyText(url);
        } else if (act === "scan") {
          target.disabled = true;
          try {
            await App.post("/api/scan");
            App.toast("已开始重新扫描", "ok");
            await loadAll(false);
          } finally {
            target.disabled = false;
          }
        } else if (act === "browse") {
          await browseFolder(target);
        } else if (act === "remove-folder") {
          const path = target.dataset.path || "";
          if (!confirm(`移除这个文件夹？\n\n${path}\n\n只会从影库中移除，不会删除任何文件。`)) return;
          await App.post("/api/folders/remove", { path });
          App.toast("已移除文件夹", "ok");
          await loadAll(false);
        } else if (act === "add-suggestion") {
          await addFolder(target.dataset.path || "");
        } else if (act === "locate") {
          await App.post(`/api/open/${id}`);
        } else if (act === "preview") {
          window.open(`/watch?play=${encodeURIComponent(id)}`, "_blank", "noopener");
        } else if (act === "copy-video-link") {
          const base = (App.state.status && App.state.status.urls.watch) || location.origin + "/watch";
          App.copyText(`${base}?play=${encodeURIComponent(id)}`);
        } else if (act === "save-port") {
          await savePort();
        } else if (act === "save-ffmpeg-path") {
          await saveFFmpegPath();
        } else if (act === "download-ffmpeg") {
          target.disabled = true;
          const res = await App.post("/api/ffmpeg/download");
          App.toast(res.message || "开始下载", "ok");
          S.lastDownloadActive = true;
          await loadAll(false);
        } else if (act === "clear-cache") {
          if (!confirm("清理所有 HLS 转码缓存？正在观看的视频可能需要重新转码。")) return;
          const res = await App.post("/api/cache/clear");
          App.toast(`已清理 ${App.formatSize(res.size || 0)} 缓存`, "ok");
          await loadAll(false);
        }
      } catch (err) {
        App.toast(err.message || "操作失败", "err");
        target.disabled = false;
      }
    });

    document.getElementById("folder-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const input = document.getElementById("folder-input");
      const path = input.value.trim();
      if (!path) {
        input.focus();
        return;
      }
      await addFolder(path);
    });

    const search = document.getElementById("library-search");
    search.addEventListener("input", () => {
      S.search = search.value.trim().toLowerCase();
      renderLibrary();
    });

    const filter = document.getElementById("library-filter");
    filter.addEventListener("change", () => {
      S.filter = filter.value;
      renderLibrary();
    });

    document.getElementById("settings-card").addEventListener("change", async (event) => {
      if (event.target.id === "setting-quality") {
        try {
          await App.post("/api/settings", { quality: event.target.value });
          App.toast("默认画质已更新", "ok");
        } catch (err) {
          App.toast(err.message, "err");
        }
      }
    });
  }

  async function browseFolder(button) {
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "选择中…";
    try {
      const res = await App.post("/api/folders/pick");
      if (res && res.path) {
        await addFolder(res.path);
      }
    } catch (err) {
      App.toast(err.message || "无法打开文件夹选择器", "err");
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  async function addFolder(path) {
    if (S.busy) return;
    S.busy = true;
    try {
      const res = await App.post("/api/folders", { path });
      App.toast(res.message || "已添加", "ok");
      const input = document.getElementById("folder-input");
      if (input) input.value = "";
      await loadAll(false);
    } catch (err) {
      App.toast(err.message || "添加失败", "err");
    } finally {
      S.busy = false;
    }
  }

  async function savePort() {
    const input = document.getElementById("setting-port");
    const port = parseInt(input.value, 10);
    if (!port) {
      App.toast("请输入有效端口", "err");
      return;
    }
    try {
      const res = await App.post("/api/settings", { port });
      App.toast(res.message || "已保存", "ok");
      if (res.restart_required) App.toast("关闭程序后重新打开，新端口才会生效", "ok");
      await loadAll(false);
    } catch (err) {
      App.toast(err.message, "err");
    }
  }

  async function saveFFmpegPath() {
    const input = document.getElementById("ffmpeg-path");
    try {
      const res = await App.post("/api/settings", { ffmpeg_dir: input.value.trim() });
      App.toast(res.message || "已保存", "ok");
      await loadAll(false);
    } catch (err) {
      App.toast(err.message, "err");
    }
  }

  async function loadAll(initial) {
    try {
      await Promise.all([App.fetchStatus(), App.fetchVideos()]);
      if (initial) S.initialized = true;
      renderTop();
      renderStats();
      renderFolders();
      renderLibrary();
      renderSettings();
      renderFFmpeg();
      checkDownloadState();
    } catch (err) {
      if (initial) S.root.innerHTML = failure(err.message);
    }
  }

  async function tick() {
    if (S.busy || document.visibilityState === "hidden") return;
    try {
      const before = App.state.ffmpeg && App.state.ffmpeg.download;
      await App.fetchStatus();
      const after = App.state.ffmpeg && App.state.ffmpeg.download;
      if (before && before.active) S.lastDownloadActive = true;
      checkDownloadState();
      if (App.pendingWork() || S.lastDownloadActive) {
        await App.fetchVideos();
        renderLibrary();
      }
      renderTop();
      renderStats();
      renderFolders();
      renderSettings();
      renderFFmpeg();
      if (after && after.active) S.lastDownloadActive = true;
    } catch (err) {
      /* 轮询失败静默，等待下次 */
    }
  }

  async function checkDownloadState() {
    const ff = App.state.ffmpeg || {};
    const dl = ff.download || {};
    if (!S.lastDownloadActive) {
      if (dl.active) S.lastDownloadActive = true;
      return;
    }
    if (dl.active) return;
    S.lastDownloadActive = false;
    if (dl.phase === "完成") {
      try {
        await App.post("/api/ffmpeg/refresh");
        await loadAll(false);
        App.toast("FFmpeg 已就绪，视频已重新分析", "ok");
      } catch (err) {
        App.toast(err.message, "err");
      }
    } else if (dl.phase === "失败") {
      App.toast(dl.error || "FFmpeg 下载失败", "err");
    }
  }

  function renderTop() {
    const status = App.state.status;
    if (!status) return;
    const watch = status.urls.watch;
    const addr = document.getElementById("top-addr");
    if (addr) addr.querySelector("span").textContent = watch.replace(/\/watch$/, "");
    const heroUrl = document.getElementById("hero-url");
    if (heroUrl) heroUrl.textContent = watch;
    const qr = document.getElementById("qr-img");
    if (qr && qr.dataset.base !== watch) {
      qr.dataset.base = watch;
      qr.src = `/api/qr.svg?view=watch&t=${Date.now()}`;
    }
  }

  function renderStats() {
    const box = document.getElementById("stat-stack");
    if (!box || !App.state.status) return;
    const videos = App.state.videos || [];
    const lib = App.state.library || {};
    const ff = App.state.ffmpeg || {};
    const analyzed = videos.filter((v) => v.vcodec).length;
    const direct = videos.filter((v) => v.direct).length;
    const directPct = analyzed ? Math.round((direct / analyzed) * 100) : 0;
    const encoder = (ff.gpu_encoders && ff.gpu_encoders[0]) || (ff.ok ? "CPU x264" : "未安装");
    const sizeText = App.formatSize(lib.total_size || 0);
    const sizeMatch = sizeText.match(/(GB|TB|MB|KB|B)$/);
    const cards = [
      {
        icon: "film",
        label: "视频总数",
        value: lib.count || videos.length || 0,
        unit: "部",
        foot: `${lib.folders ? lib.folders.length : 0} 个文件夹`,
      },
      {
        icon: "database",
        label: "影库容量",
        value: sizeText.replace(/\s?(GB|TB|MB|KB|B)$/, ""),
        unit: sizeMatch ? sizeMatch[0] : "",
        foot: lib.scanned ? `已检查 ${lib.scanned} 个文件` : "等待扫描",
      },
      {
        icon: "spark",
        label: "直连播放",
        value: analyzed ? directPct : 0,
        unit: "%",
        foot: analyzed ? `${direct} 部无需转换` : "分析中…",
      },
      {
        icon: "tv",
        label: "转码引擎",
        value: ff.ok ? "已就绪" : "未安装",
        unit: "",
        foot: ff.ok ? encoder : "点击下方一键下载",
      },
    ];
    box.innerHTML = cards
      .map(
        (card) => `
      <div class="stat-card">
        <div class="stat-top"><span>${card.label}</span><span class="stat-icon">${App.icon(card.icon)}</span></div>
        <div class="stat-value">${App.esc(card.value)}<small>${App.esc(card.unit)}</small></div>
        <div class="stat-foot">${App.esc(card.foot)}</div>
      </div>`
      )
      .join("");
  }

  function renderFolders() {
    const list = document.getElementById("folder-list");
    const suggestions = document.getElementById("folder-suggestions");
    const sub = document.getElementById("folder-sub");
    const scanState = document.getElementById("scan-state");
    if (!list || !App.state.status) return;
    const lib = App.state.library || {};
    const folders = lib.folders || [];
    const videos = App.state.videos || [];
    sub.textContent = folders.length
      ? `${folders.length} 个文件夹 · ${videos.length} 部视频`
      : "添加存放视频的文件夹，支持子目录";

    list.innerHTML = folders.length
      ? folders
          .map((folder) => {
            const base = folder.split(/[\\/]/).filter(Boolean).pop() || folder;
            const count = videos.filter(
              (v) => v.folder === base || String(v.folder || "").startsWith(base + "/")
            ).length;
            return `
          <div class="folder-row">
            <span class="fi">${App.icon("folder")}</span>
            <span class="fp" title="${App.esc(folder)}">${App.esc(folder)}</span>
            <span class="fs">${count} 部</span>
            <button class="fx" data-act="remove-folder" data-path="${App.esc(folder)}" title="移除文件夹">${App.icon("trash")}</button>
          </div>`;
          })
          .join("")
      : `<div class="empty" style="padding:26px 10px 8px"><p>还没有添加文件夹，影库目前是空的</p></div>`;

    const existing = new Set(folders.map((f) => f.toLowerCase()));
    const items = (App.state.status.suggestions || []).filter(
      (item) => !existing.has(item.path.toLowerCase())
    );
    suggestions.innerHTML = items.length
      ? `<span style="color:var(--muted-2);font-size:11.5px;align-self:center;margin-right:2px">快速添加</span>` +
        items
          .map(
            (item) =>
              `<button class="chip" data-act="add-suggestion" data-path="${App.esc(item.path)}">${App.icon("plus")}${App.esc(item.label)}</button>`
          )
          .join("")
      : "";

    let scan = "";
    if (lib.scanning) {
      scan += `<div class="scan-line"><i></i></div><div style="color:var(--muted);font-size:11.5px;margin-top:8px">正在扫描文件夹… 已检查 ${lib.scanned || 0} 个文件</div>`;
    }
    if (lib.probing > 0) {
      scan += `<div class="scan-line"><i></i></div><div style="color:var(--muted);font-size:11.5px;margin-top:8px">正在分析编码信息，剩余 ${lib.probing} 个</div>`;
    }
    if (lib.thumbs_pending > 0) {
      scan += `<div style="color:var(--muted-2);font-size:11.5px;margin-top:8px">正在生成缩略图，剩余 ${lib.thumbs_pending} 个</div>`;
    }
    if (lib.error) {
      scan += `<div class="notice">${App.icon("alert")}<span>扫描出错：${App.esc(lib.error)}</span></div>`;
    }
    if ((lib.invalid_folders || []).length) {
      scan += `<div class="notice">${App.icon("alert")}<span>以下文件夹已无法访问：${lib.invalid_folders
        .map(App.esc)
        .join("、")}</span></div>`;
    }
    scanState.innerHTML = scan;
  }

  function compatBadge(video) {
    if (video.direct) return `<span class="badge direct" title="${App.esc(video.detail || "")}">直连</span>`;
    if (!video.vcodec && !video.direct) {
      return `<span class="badge muted" title="${App.esc(video.detail || "")}">分析中</span>`;
    }
    if (video.reason === "无法打开") {
      return `<span class="badge bad" title="${App.esc(video.detail || "")}">无法打开</span>`;
    }
    if (video.copyable) {
      return `<span class="badge copy" title="${App.esc(video.detail || "")}">${App.esc(video.reason || "转封装")}</span>`;
    }
    return `<span class="badge trans" title="${App.esc(video.detail || "")}">${App.esc(video.reason || "转码")}</span>`;
  }

  function renderLibrary() {
    const wrap = document.getElementById("table-wrap");
    const count = document.getElementById("library-count");
    const sub = document.getElementById("library-sub");
    if (!wrap) return;
    const all = App.state.videos || [];
    const filtered = all.filter((video) => {
      if (S.filter === "direct" && !video.direct) return false;
      if (S.filter === "hls" && video.direct) return false;
      if (!S.search) return true;
      const haystack = `${video.name} ${video.folder} ${video.vcodec || ""} ${video.acodec || ""}`.toLowerCase();
      return haystack.includes(S.search);
    });
    count.textContent = String(filtered.length);
    const analyzed = all.filter((v) => v.vcodec).length;
    sub.textContent = all.length
      ? `${all.length} 部视频${analyzed < all.length ? ` · ${all.length - analyzed} 部分析中` : ""}`
      : "扫描完成后会显示编码信息与播放方式";

    const fingerprint = JSON.stringify(
      filtered.map((v) => [
        v.id,
        v.thumb,
        v.direct,
        v.reason,
        v.progress ? v.progress.updated : 0,
        v.duration,
      ])
    );
    if (fingerprint === S.fingerprint) return;
    S.fingerprint = fingerprint;

    if (!all.length) {
      wrap.innerHTML = `
        <div class="empty">
          <div class="empty-icon">${App.icon("film")}</div>
          <h3>影库还是空的</h3>
          <p>在上方添加一个视频文件夹，扫描完成后就能在手机上观看。常见位置：下载目录、电影盘、NAS 映射盘。</p>
        </div>`;
      return;
    }
    if (!filtered.length) {
      wrap.innerHTML = `<div class="empty"><div class="empty-icon">${App.icon("search")}</div><h3>没有匹配的视频</h3><p>换个关键词，或切换格式筛选。</p></div>`;
      return;
    }
    const rows = filtered
      .map((video) => {
        const percent = Math.round(App.progressPercent(video));
        const meta = [
          App.resolutionLabel(video),
          App.codecLabel(video),
          App.audioLabel(video),
          video.hdr ? "HDR" : "",
        ]
          .filter(Boolean)
          .join(" · ");
        const folder = video.folder || "";
        return `
        <tr>
          <td>
            <div class="cell-video">
              <div class="mini-thumb">
                <div class="ph">${App.icon("film")}</div>
                ${video.thumb ? `<img src="${App.thumbUrl(video)}" loading="lazy" alt="" onload="this.previousElementSibling.remove()" onerror="this.remove()">` : ""}
              </div>
              <div class="cell-title">
                <b title="${App.esc(video.name)}">${App.esc(video.stem)}</b>
                <small title="${App.esc(folder)}">${App.esc(folder || "—")}</small>
              </div>
            </div>
          </td>
          <td class="hide-md">${meta ? `<span class="mono">${App.esc(meta)}</span>` : '<span style="color:var(--muted-2)">分析中…</span>'}</td>
          <td class="hide-sm mono">${App.formatSize(video.size)}</td>
          <td class="hide-sm mono">${video.duration ? App.formatDuration(video.duration) : "—"}</td>
          <td>${compatBadge(video)}</td>
          <td class="hide-md">
            ${
              percent > 0
                ? `<div style="display:flex;align-items:center;gap:8px"><span class="progress-mini"><i style="width:${percent}%"></i></span><span class="mono" style="font-size:10.5px;color:var(--muted-2)">${percent}%</span></div>`
                : `<span style="color:var(--muted-2);font-size:11px">未观看</span>`
            }
          </td>
          <td>
            <div class="table-actions">
              <button class="icon-btn" data-act="preview" data-id="${video.id}" title="预览播放">${App.icon("play")}</button>
              <button class="icon-btn" data-act="copy-video-link" data-id="${video.id}" title="复制手机播放链接">${App.icon("copy")}</button>
              <button class="icon-btn" data-act="locate" data-id="${video.id}" title="在资源管理器中定位">${App.icon("folder")}</button>
            </div>
          </td>
        </tr>`;
      })
      .join("");

    wrap.innerHTML = `
      <table class="video-table">
        <thead><tr>
          <th>视频</th>
          <th class="hide-md">规格</th>
          <th class="hide-sm">大小</th>
          <th class="hide-sm">时长</th>
          <th>播放方式</th>
          <th class="hide-md">进度</th>
          <th style="text-align:right">操作</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  function renderSettings() {
    const card = document.getElementById("settings-card");
    if (!card || !App.state.status) return;
    const settings = App.state.settings || {};
    const status = App.state.status;
    const cache = status.cache || {};
    const fingerprint = JSON.stringify([settings, cache.hls_size, status.port]);
    if (card.dataset.fp === fingerprint) return;
    if (document.activeElement && document.activeElement.id === "setting-port") return;
    card.dataset.fp = fingerprint;
    card.innerHTML = `
      <div class="section-head" style="margin-bottom:8px">
        <div><div class="section-title"><span class="dot"></span>服务设置</div><div class="section-sub">当前监听端口 ${status.port}</div></div>
      </div>
      <div class="setting-row">
        <div class="sl"><b>服务端口</b><small>修改后需要重启程序；当前 ${status.port}</small></div>
        <div class="sr">
          <input class="input" id="setting-port" type="number" min="1024" max="65535" value="${settings.port || 8686}">
          <button class="btn sm" data-act="save-port">保存</button>
        </div>
      </div>
      <div class="setting-row">
        <div class="sl"><b>默认画质</b><small>自动：能直连就直连，MKV 优先原画转封装</small></div>
        <div class="sr">
          <select class="input" id="setting-quality" style="width:126px;height:34px;font-size:12.5px">
            <option value="auto" ${settings.quality === "auto" ? "selected" : ""}>自动</option>
            <option value="original" ${settings.quality === "original" ? "selected" : ""}>原画</option>
            <option value="1080" ${settings.quality === "1080" ? "selected" : ""}>1080P</option>
            <option value="720" ${settings.quality === "720" ? "selected" : ""}>720P</option>
          </select>
        </div>
      </div>
      <div class="setting-row">
        <div class="sl"><b>转码缓存</b><small>${App.formatSize(cache.hls_size || 0)} · 自动清理闲置会话</small></div>
        <div class="sr"><button class="btn sm" data-act="clear-cache">清理缓存</button></div>
      </div>
      <div class="notice">${App.icon("lock")}<span>服务仅面向家庭局域网，没有登录校验。请勿将端口直接暴露到公网。</span></div>`;
  }

  function renderFFmpeg() {
    const card = document.getElementById("ffmpeg-card");
    if (!card || !App.state.status) return;
    const ff = App.state.ffmpeg || {};
    const download = ff.download || {};
    const fingerprint = JSON.stringify([
      ff.ok,
      ff.version,
      ff.ffmpeg,
      ff.gpu_encoders,
      download.active,
      download.phase,
      download.progress,
      download.error,
      download.downloaded,
      download.total,
    ]);
    if (card.dataset.fp === fingerprint) return;
    if (document.activeElement && document.activeElement.id === "ffmpeg-path") return;
    card.dataset.fp = fingerprint;

    let stateLine = ff.ok
      ? `<span class="ffmpeg-state"><i></i>${App.esc(ff.version || "已就绪")}</span>`
      : `<span class="ffmpeg-state off"><i></i>未安装 · 复杂格式将无法播放</span>`;

    let downloadBlock = "";
    if (download.active) {
      const total = download.total || 0;
      const percent = total ? Math.min(100, Math.round((download.downloaded / total) * 100)) : Math.round((download.progress || 0) * 100);
      downloadBlock = `
        <div class="dl-bar"><i style="width:${percent}%"></i></div>
        <div style="margin-top:6px;color:var(--muted-2);font-size:11px">${App.esc(download.phase || "下载中")} · ${percent}% · ${App.formatSize(download.downloaded || 0)}</div>`;
    } else if (download.phase === "失败" && download.error) {
      downloadBlock = `<div class="notice" style="margin-top:10px">${App.icon("alert")}<span>${App.esc(download.error)}</span></div>`;
    }

    card.innerHTML = `
      <div class="section-head" style="margin-bottom:8px">
        <div><div class="section-title"><span class="dot"></span>转码引擎</div><div class="section-sub">处理 MKV、DTS 音轨、浏览器不支持的编码</div></div>
      </div>
      <div class="setting-row">
        <div class="sl"><b>FFmpeg</b><small>${stateLine}</small>
          ${ff.ok ? `<small>${App.esc(ff.ffmpeg)}</small>` : `<small>安装目录：${App.esc(ff.install_dir || "")}</small>`}
          ${ff.ok && ff.gpu_encoders && ff.gpu_encoders.length ? `<small>硬件加速：${App.esc(ff.gpu_encoders.join(" / "))}</small>` : ""}
        </div>
        <div class="sr">
          ${ff.ok ? `<button class="btn sm" data-act="download-ffmpeg">更新</button>` : `<button class="btn sm primary" data-act="download-ffmpeg">${App.icon("download")}一键下载</button>`}
        </div>
      </div>
      ${downloadBlock}
      <div class="setting-row" style="border-bottom:none;padding-bottom:0">
        <div class="sl"><b>手动指定路径</b><small>已有 FFmpeg 时，填写包含 ffmpeg.exe 的目录</small></div>
      </div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <input class="input" id="ffmpeg-path" placeholder="例如 D:\\Tools\\ffmpeg\\bin" value="${App.esc(ff.root || "")}" style="flex:1;height:34px;font-size:12px">
        <button class="btn sm" data-act="save-ffmpeg-path">应用</button>
      </div>`;
  }

  function failure(message) {
    return `
    <div class="pc-shell">
      <main class="pc-main" style="padding-top:80px">
        <div class="card">
          <div class="empty">
            <div class="empty-icon">${App.icon("alert")}</div>
            <h3>无法连接服务</h3>
            <p>${App.esc(message || "请确认电脑端程序仍在运行")}</p>
            <button class="btn primary" onclick="location.reload()">重新加载</button>
          </div>
        </div>
      </main>
    </div>`;
  }

  window.PC = PC;
})();
