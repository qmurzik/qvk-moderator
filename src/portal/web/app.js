/* QVK Beta Portal — client application (vanilla JS, no build step). */
(() => {
  "use strict";

  // ---------------------------------------------------------------- utils
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
  const raw = (s) => new Raw(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const val = (v) => (v instanceof Raw ? v.s : Array.isArray(v) ? v.map(val).join("") : v === false || v == null ? "" : esc(v));
  /** Tagged template: every interpolation is HTML-escaped unless wrapped in raw(). */
  const html = (strings, ...vals) => raw(strings.reduce((out, s, i) => out + s + (i < vals.length ? val(vals[i]) : ""), ""));
  const set = (el, tpl) => { if (el) el.innerHTML = val(tpl); return el; };
  const debounce = (fn, ms) => { let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; d.cancel = () => clearTimeout(t); return d; };
  const plural = (n, f) => { const a = Math.abs(n) % 100, b = a % 10; if (a > 10 && a < 20) return f[2]; if (b > 1 && b < 5) return f[1]; if (b === 1) return f[0]; return f[2]; };
  const fmtSize = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + " МБ" : Math.max(1, Math.round(b / 1024)) + " КБ");
  const fmtDate = (s) => new Date(s * 1000).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });
  const fmtDT = (s) => new Date(s * 1000).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const rel = (s) => {
    const d = Date.now() / 1000 - s;
    if (d < 60) return "только что";
    if (d < 3600) { const m = Math.floor(d / 60); return m + " " + plural(m, ["минуту", "минуты", "минут"]) + " назад"; }
    if (d < 86400) { const h = Math.floor(d / 3600); return h + " " + plural(h, ["час", "часа", "часов"]) + " назад"; }
    if (d < 172800) return "вчера";
    if (d < 7 * 86400) { const x = Math.floor(d / 86400); return x + " " + plural(x, ["день", "дня", "дней"]) + " назад"; }
    return fmtDate(s);
  };
  const hue = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  const initials = (n) => String(n || "?").replace(/^@/, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
  const avatar = (name, team) => html`<div class="ava ${team ? "team" : ""}" style="--h:${hue(name)}" aria-hidden="true">${team ? raw(icon("shield", "s")) : initials(name)}</div>`;
  /** Escapes text, then links URLs and BUG-/IDEA- references. */
  const rich = (text) => raw(esc(text).replace(/(https?:\/\/[^\s<]+)|\b((?:BUG|IDEA)-\d{4,7})\b/g, (m, url, code) => {
    if (url) {
      const trail = url.match(/[.,);:!?]+$/)?.[0] || "";
      const u = trail ? url.slice(0, -trail.length) : url;
      return `<a href="${u}" target="_blank" rel="noopener noreferrer nofollow">${u}</a>${trail}`;
    }
    return `<a href="/${code.startsWith("BUG") ? "bugs" : "ideas"}/${code}">${code}</a>`;
  }));

  // ---------------------------------------------------------------- icons
  const ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
    bug: '<rect x="7" y="7" width="10" height="13" rx="5"/><path d="M12 11v9M7 13H3M21 13h-4M7.5 17.5 4.5 19.5M16.5 17.5l3 2M8 9 5 6M16 9l3-3M9.5 7a2.5 2.5 0 0 1 5 0"/>',
    bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3z"/>',
    inbox: '<path d="M3 13 5.5 5h13L21 13v6H3z"/><path d="M3 13h5l1.5 3h5L16 13h5"/>',
    grid: '<rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/>',
    bell: '<path d="M6 9a6 6 0 0 1 12 0c0 6.5 2.5 8 2.5 8h-17S6 15.5 6 9"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
    star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3l-5.5 2.9 1-6.2L3 9.6l6.2-.9z"/>',
    pin: '<path d="M9 4h6l-1 5 3 3v2H7v-2l3-3z"/><path d="M12 14v7"/>',
    eyeoff: '<path d="m3 3 18 18"/><path d="M10.6 6.1A10 10 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-3 3.6M6.6 7.6A17 17 0 0 0 2.5 12s3.5 6 9.5 6a9.6 9.6 0 0 0 4-.9"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    left: '<path d="m15 5-7 7 7 7"/>',
    right: '<path d="m9 5 7 7-7 7"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v4h16v-4"/>',
    clip: '<path d="m20 11.5-8 8a5 5 0 0 1-7-7L13.5 4a3.5 3.5 0 0 1 5 5L10 17.5a2 2 0 0 1-3-3L14.5 7"/>',
    message: '<path d="M4 5h16v11H9l-5 4z"/>',
    up: '<path d="m6 13 6-7 6 7M12 6v13"/>',
    trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H4v1a3 3 0 0 0 4 3M16 6h4v1a3 3 0 0 1-4 3M12 13v4M8 21h8M9 21v-2h6v2"/>',
    megaphone: '<path d="M3 10v4h3l8 5V5l-8 5z"/><path d="M18 9a4 4 0 0 1 0 6"/>',
    settings: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
    logout: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>',
    phone: '<rect x="6" y="2.5" width="12" height="19" rx="3"/><path d="M11 18h2"/>',
    download: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    sparkles: '<path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 3v4M17 5h4"/>',
    alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.6-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5L20 16M20 20v-4h-4"/>',
    music: '<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
    layout: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M9 9v12"/>',
    video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M15 8l2 2"/>',
    zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    dots: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
    send: '<path d="m4 12 16-8-6 16-3-6z"/><path d="m11 14 9-10"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>',
    telegram: '<path d="M21 4 3 11l6 2 2 6 3-4 5 4z"/><path d="m9 13 12-9"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    file: '<path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/>',
    merge: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="12" r="2"/><path d="M6 7v10M6 9c0 3 3 3 6 3h4"/>',
  };
  const icon = (n, cls = "") => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ICONS.dots}</svg>`;
  const I = (n, cls) => raw(icon(n, cls));
  const LOGO = raw('<svg viewBox="0 0 24 24"><path d="M7 11.5a5 5 0 1 1 8.5 3.6L18 17.5"/></svg>');

  // ---------------------------------------------------------------- state & api
  const S = { me: null, rev: null, unread: 0, nav: 0, refresh: null, timer: null, theme: localStorage.getItem("qvk_theme") || "dark" };
  const M = () => S.me.meta;

  class ApiError extends Error { constructor(m, status, data) { super(m); this.status = status; this.data = data; } }
  async function api(method, path, body) {
    const headers = { "x-qvk": "1" };
    if (S.me?.csrf) headers["x-csrf"] = S.me.csrf;
    if (body !== undefined) headers["content-type"] = "application/json";
    let res;
    try {
      res = await fetch("/api/p" + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, credentials: "same-origin" });
    } catch {
      throw new ApiError("Нет соединения с сервером", 0);
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && S.me && !path.startsWith("/auth")) { S.me = null; boot(); }
    if (!res.ok) throw new ApiError(data.error || "Ошибка " + res.status, res.status, data);
    return data;
  }
  const GET = (p) => api("GET", p);
  const POST = (p, b = {}) => api("POST", p, b);

  // ---------------------------------------------------------------- theme
  function applyTheme() {
    const t = S.theme === "system" ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : S.theme;
    document.documentElement.dataset.theme = t;
    $('meta[name="theme-color"]')?.setAttribute("content", t === "light" ? "#f5f2fc" : "#0d0b18");
  }
  applyTheme();
  matchMedia("(prefers-color-scheme: light)").addEventListener?.("change", applyTheme);

  // ---------------------------------------------------------------- toasts & dialogs
  function toast(text, type = "ok") {
    let box = $(".toasts");
    if (!box) { box = document.createElement("div"); box.className = "toasts"; box.setAttribute("role", "status"); document.body.append(box); }
    const el = document.createElement("div");
    el.className = "toast " + type;
    set(el, html`${I(type === "ok" ? "check" : "alert")}<span>${text}</span>`);
    box.append(el);
    setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 300); }, type === "ok" ? 2600 : 4200);
  }
  const fail = (err) => toast(err?.message || String(err), "err");

  /** Opens a modal sheet. `render(body, close)` fills it. Returns close(). */
  function sheet(title, render) {
    const ov = document.createElement("div");
    ov.className = "overlay";
    set(ov, html`<div class="sheet" role="dialog" aria-modal="true" aria-label="${title}"><div class="grab"></div><div class="row between"><h2>${title}</h2><button class="btn ghost icon sm" data-close aria-label="Закрыть">${I("x")}</button></div><div class="sheet-body mt"></div></div>`);
    const close = () => { ov.remove(); document.removeEventListener("keydown", onKey); };
    const onKey = (e) => e.key === "Escape" && close();
    ov.addEventListener("click", (e) => { if (e.target === ov || e.target.closest("[data-close]")) close(); });
    document.addEventListener("keydown", onKey);
    document.body.append(ov);
    render($(".sheet-body", ov), close);
    return close;
  }
  function confirmSheet(title, text, okLabel = "Подтвердить", danger = false) {
    return new Promise((resolve) => {
      let done = false;
      const close = sheet(title, (b, c) => {
        set(b, html`<p class="muted">${text}</p><div class="row mt2"><button class="btn block" data-no>Отмена</button><button class="btn block ${danger ? "danger" : "primary"}" data-yes>${okLabel}</button></div>`);
        $("[data-no]", b).onclick = () => { done = true; c(); resolve(false); };
        $("[data-yes]", b).onclick = () => { done = true; c(); resolve(true); };
      });
      const obs = new MutationObserver(() => { if (!document.body.contains($(".overlay")) && !done) { obs.disconnect(); resolve(false); } });
      obs.observe(document.body, { childList: true });
      void close;
    });
  }
  function lightbox(src) {
    const el = document.createElement("div");
    el.className = "lightbox";
    set(el, html`<img src="${src}" alt=""><button class="btn icon" aria-label="Закрыть">${I("x")}</button>`);
    el.onclick = () => el.remove();
    document.body.append(el);
  }
  function confetti() {
    const box = document.createElement("div");
    box.className = "confetti";
    const colors = ["#c9a7ff", "#8b5cf6", "#4cc9f0", "#3ddc97", "#f7c948", "#ff9f43"];
    for (let i = 0; i < 70; i++) {
      const p = document.createElement("i");
      p.style.left = Math.random() * 100 + "vw";
      p.style.background = colors[i % colors.length];
      p.style.animationDelay = Math.random() * 0.6 + "s";
      p.style.transform = `rotate(${Math.random() * 360}deg)`;
      box.append(p);
    }
    document.body.append(box);
    setTimeout(() => box.remove(), 3400);
  }

  // ---------------------------------------------------------------- dictionaries
  const statusOf = (kind, id) => (kind === "bug" ? M().bugStatuses : M().ideaStatuses).find((s) => s.id === id) || { id, label: id, color: "#999", desc: "" };
  const badge = (kind, id, lg) => { const s = statusOf(kind, id); return html`<span class="badge ${lg ? "lg" : ""}" style="--c:${s.color}" title="${s.desc}">${s.emoji ? s.emoji + " " : ""}${s.label}</span>`; };
  const prioOf = (id) => M().priorities.find((p) => p.id === id) || M().priorities[1];
  const prio = (id) => { const p = prioOf(id); return html`<span class="prio" style="--c:${p.color}">${I("zap", "s")}${p.label}</span>`; };
  const catOf = (id) => M().categories.find((c) => c.id === id) || { id, label: id, icon: "dots" };
  const freqOf = (id) => M().frequencies.find((f) => f.id === id)?.label || "—";
  const pathOf = (t) => "/" + (t.kind === "bug" ? "bugs" : "ideas") + "/" + t.code;
  const statusOptions = (kind, cur) => (kind === "bug" ? M().bugStatuses : M().ideaStatuses).map((s) => html`<option value="${s.id}" ${s.id === cur ? "selected" : ""}>${s.emoji} ${s.label}</option>`);
  const prioOptions = (cur) => M().priorities.map((p) => html`<option value="${p.id}" ${p.id === cur ? "selected" : ""}>${p.label}</option>`);

  // ---------------------------------------------------------------- shell
  function navItems() {
    const items = [
      ["/", "home", "Главная"],
      ["/all", "grid", "Все обращения"],
      ["/my", "inbox", "Мои обращения"],
      ["/known", "alert", "Известные проблемы"],
      ["/fixes", "history", "История исправлений"],
      ["/updates", "megaphone", "Обновления"],
      ["/leaders", "trophy", "Рейтинг"],
      ["/notifications", "bell", "Уведомления"],
      ["/profile", "user", "Профиль"],
    ];
    return items;
  }
  function renderShell() {
    const me = S.me;
    set($("#app"), html`
      <div class="layout">
        <aside class="side">
          <a class="brand" href="/"><div class="logo">${LOGO}</div><div><b>QVK Beta Portal</b><small>Тестирование ${me.settings.current_version}</small></div></a>
          <a class="btn primary block" href="/new/bug">${I("bug")}Сообщить об ошибке</a>
          <a class="btn block mt" href="/new/idea" style="margin-top:8px">${I("bulb")}Предложить идею</a>
          <div class="nav-label">Портал</div>
          <nav class="nav">${navItems().map(([h, i, l]) => html`<a href="${h}" data-nav="${h}">${I(i)}<span>${l}</span>${h === "/notifications" ? raw('<span class="count" data-unread hidden></span>') : ""}</a>`)}</nav>
          ${me.is_admin ? html`<div class="nav-label">Администрирование</div><nav class="nav"><a href="/admin" data-nav="/admin">${I("shield")}<span>Панель управления</span></a><a href="/admin/bugs" data-nav="/admin/bugs">${I("bug")}<span>Управление багами</span></a><a href="/admin/ideas" data-nav="/admin/ideas">${I("bulb")}<span>Управление идеями</span></a></nav>` : ""}
          <div class="side-foot"><a class="row" href="/profile" style="color:var(--text);padding:8px 10px;border-radius:14px">${avatar(me.user.name)}<div style="min-width:0"><b class="ell" style="display:block;font-size:14px">${me.user.name}</b><small class="muted">${me.is_admin ? "Администратор" : "Тестировщик"}</small></div></a></div>
        </aside>
        <header class="topbar">
          <a class="brand" href="/"><div class="logo">${LOGO}</div><b>QVK Beta</b></a>
          <span class="spacer"></span>
          <a class="btn ghost icon" href="/notifications" aria-label="Уведомления" style="position:relative">${I("bell")}<span class="dot" data-unread-dot hidden style="position:absolute;top:9px;right:9px"></span></a>
          <a href="/profile" aria-label="Профиль">${avatar(me.user.name)}</a>
        </header>
        <main class="main" id="view"></main>
        <nav class="bottom" aria-label="Навигация">
          <a href="/" data-nav="/">${I("home")}Главная</a>
          <a href="/all" data-nav="/all">${I("grid")}Обращения</a>
          <a href="/new" class="plus" data-nav="/new" aria-label="Создать"><span class="pbtn">${I("plus")}</span></a>
          <a href="/my" data-nav="/my">${I("inbox")}Мои</a>
          ${me.is_admin ? html`<a href="/admin" data-nav="/admin">${I("shield")}Админ</a>` : html`<a href="/leaders" data-nav="/leaders">${I("trophy")}Рейтинг</a>`}
        </nav>
      </div>`);
    updateUnread(me.unread);
  }
  function markNav() {
    const p = location.pathname;
    $$("[data-nav]").forEach((a) => {
      const h = a.dataset.nav;
      const on = h === "/" ? p === "/" : h === "/admin" ? p.startsWith("/admin") && !(a.closest(".side") && ["/admin/bugs", "/admin/ideas"].includes(p)) : h === "/new" ? p.startsWith("/new") : p === h || p.startsWith(h + "/");
      a.classList.toggle("on", on);
    });
  }
  function updateUnread(n) {
    S.unread = n;
    $$("[data-unread]").forEach((el) => { el.hidden = !n; el.textContent = n > 99 ? "99+" : n; });
    $$("[data-unread-dot]").forEach((el) => (el.hidden = !n));
    document.title = (n ? `(${n}) ` : "") + "QVK Beta Portal";
  }

  // ---------------------------------------------------------------- router
  const routes = [];
  const route = (re, fn) => routes.push([re, fn]);
  function navigate(path, replace = false) {
    if (path === location.pathname + location.search) { run(); return; }
    history[replace ? "replaceState" : "pushState"]({}, "", path);
    run();
  }
  async function run() {
    if (!S.me) return boot();
    const p = location.pathname;
    if (!S.me.devices.length && !S.me.is_admin && !["/welcome", "/profile", "/link"].includes(p)) {
      sessionStorage.setItem("qvk_after_welcome", p + location.search);
      return navigate("/welcome", true);
    }
    const view = $("#view");
    if (!view) { renderShell(); return run(); }
    S.refresh = null;
    const id = ++S.nav;
    markNav();
    for (const [re, fn] of routes) {
      const m = p.match(re);
      if (m) {
        view.classList.remove("fade-in"); void view.offsetWidth; view.classList.add("fade-in");
        try { await fn(m, view, () => id === S.nav); } catch (err) { if (id === S.nav) set(view, errorBox(err)); }
        if (!history.state?.keepScroll) window.scrollTo(0, 0);
        return;
      }
    }
    set(view, html`<div class="empty"><div class="ei">${I("alert")}</div><b>Страница не найдена</b><a class="btn mt" href="/">На главную</a></div>`);
  }
  const errorBox = (err) => html`<div class="empty"><div class="ei">${I("alert")}</div><b>${err.status === 404 ? "Не найдено" : "Не удалось загрузить"}</b><p>${err.message}</p><button class="btn mt" onclick="location.reload()">${I("refresh")}Обновить</button></div>`;
  window.addEventListener("popstate", run);
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const go = e.target.closest("[data-go]");
    if (go && !e.target.closest("a,button,select,input,textarea,label")) { navigate(go.dataset.go); return; }
    const a = e.target.closest("a[href]");
    if (!a || a.target || a.hasAttribute("download")) return;
    const href = a.getAttribute("href");
    if (!href.startsWith("/") || href.startsWith("//") || href.startsWith("/files/") || href.startsWith("/api/")) return;
    e.preventDefault();
    navigate(href);
  });

  // ---------------------------------------------------------------- skeletons
  const skList = (n = 4) => html`<div class="tlist">${Array.from({ length: n }, () => html`<div class="sk card"></div>`)}</div>`;
  const skPage = () => html`<div class="sk title"></div><div class="sk line" style="width:40%"></div><div class="mt2">${skList(5)}</div>`;
  const empty = (ic, title, text, action) => html`<div class="empty fade-in"><div class="ei">${I(ic, "l")}</div><b>${title}</b><p style="margin:4px 0 0">${text}</p>${action || ""}</div>`;

  // ---------------------------------------------------------------- ticket card
  function ticketCard(t, opt = {}) {
    const cat = catOf(t.category);
    const isIdea = t.kind === "idea";
    const note = t.status_note || t.last_admin_comment;
    const body = html`
      <div style="min-width:0">
        <div class="top"><span class="code mono">${t.code}</span>${badge(t.kind, t.status)}${t.pinned ? html`<span class="chip">${I("pin", "s")}Закреплено</span>` : ""}${t.hidden ? html`<span class="chip">${I("eyeoff", "s")}Скрыто</span>` : ""}${t.priority !== "normal" && !isIdea ? prio(t.priority) : ""}</div>
        <h3><a href="${pathOf(t)}" style="color:inherit">${t.title}</a></h3>
        <div class="meta">
          <span>${I(cat.icon, "s")}${cat.label}</span>
          ${t.device?.model ? html`<span>${I("phone", "s")}${t.device.model} · Android ${t.device.android}</span>` : ""}
          ${t.device?.app_version ? html`<span class="mono">v${t.device.app_version}</span>` : ""}
          <span title="${fmtDT(t.created)}">${I("clock", "s")}${rel(opt.updated ? t.updated : t.created)}</span>
          ${!isIdea && t.confirms ? html`<span>${I("users", "s")}${t.confirms}</span>` : ""}
          ${t.comments ? html`<span>${I("message", "s")}${t.comments}</span>` : ""}
          ${opt.author ? html`<span>${I("user", "s")}${t.author.name}</span>` : ""}
          ${t.fixed_version && ["fixed", "closed", "verify"].includes(t.status) ? html`<span style="color:var(--ok)">${I("check", "s")}в ${t.fixed_version}</span>` : ""}
        </div>
        ${opt.note && note ? html`<div class="note"><b>Команда QVK:</b> ${note.length > 220 ? note.slice(0, 217) + "…" : note}</div>` : ""}
        ${opt.note && t.status === "verify" && t.author.me ? html`<div class="note" style="border-color:var(--info)"><b>Нужна ваша проверка.</b> Откройте отчёт и подтвердите исправление.</div>` : ""}
        ${opt.note && t.status === "need_info" && t.author.me ? html`<div class="note" style="border-color:var(--warn)"><b>Нужны дополнительные данные.</b> Откройте отчёт и дополните его.</div>` : ""}
      </div>`;
    if (isIdea && opt.vote !== false) {
      return html`<article class="tcard with-vote ${t.pinned ? "pinned" : ""}" data-go="${pathOf(t)}">${voteBtn(t)}${body}</article>`;
    }
    return html`<article class="tcard ${t.pinned ? "pinned" : ""}" data-go="${pathOf(t)}">${body}</article>`;
  }
  const voteBtn = (t) => html`<button class="vote ${t.my_vote ? "on" : ""}" data-vote="${t.code}" aria-pressed="${t.my_vote ? "true" : "false"}" aria-label="Голос за предложение">${I("up")}<span data-votes>${t.votes}</span></button>`;
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-vote]");
    if (!b) return;
    e.preventDefault();
    b.disabled = true;
    try {
      const r = await POST(`/tickets/${b.dataset.vote}/vote`);
      $$(`[data-vote="${b.dataset.vote}"]`).forEach((x) => { x.classList.toggle("on", r.on); x.setAttribute("aria-pressed", r.on); const v = $("[data-votes]", x); if (v) v.textContent = r.votes; });
      toast(r.on ? "Голос учтён" : "Голос отменён");
    } catch (err) { fail(err); } finally { b.disabled = false; }
  });

  // ---------------------------------------------------------------- polling
  async function pulse() {
    if (!S.me || document.visibilityState !== "visible") return;
    try {
      const r = await GET("/pulse");
      updateUnread(r.unread);
      if (S.rev && r.rev !== S.rev && S.refresh) {
        const busy = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) && document.activeElement.closest("#view");
        if (!busy && !$(".overlay")) { S.rev = r.rev; S.refresh().catch(() => {}); return; }
        return; // try again on the next tick
      }
      S.rev = r.rev;
    } catch { /* offline — ignore */ }
  }
  function startPolling() {
    clearInterval(S.timer);
    S.timer = setInterval(pulse, 12000);
  }
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && pulse());

  // ---------------------------------------------------------------- login
  async function renderLogin(mode = "login") {
    clearInterval(S.timer);
    const pub = await GET("/public").catch(() => ({ version: "3.0" }));
    const reg = mode === "register";
    set($("#app"), html`
      <div class="login"><div class="login-card fade-in">
        <div class="logo">${LOGO}</div>
        <span class="ver"><i></i>Бета ${pub.version}</span>
        <h1>QVK Beta Portal</h1>
        <p class="muted">Закрытое тестирование QVK. Сообщайте об ошибках, предлагайте идеи и следите за их статусом.</p>
        <div class="seg mt2" style="width:100%;display:grid;grid-template-columns:1fr 1fr"><button data-mode="login" class="${reg ? "" : "on"}" style="justify-content:center">Вход</button><button data-mode="register" class="${reg ? "on" : ""}" style="justify-content:center">Регистрация</button></div>
        <form id="auth" class="stack mt2" style="text-align:left" novalidate>
          <label class="f">Ник<input name="nick" maxlength="24" autocomplete="username" autocapitalize="off" spellcheck="false" placeholder="например, qvk_tester" required></label>
          <label class="f">Пароль${reg ? html` <small>не короче 8 символов</small>` : ""}<input name="password" type="password" maxlength="128" autocomplete="${reg ? "new-password" : "current-password"}" required></label>
          ${reg ? html`<label class="f">Повторите пароль<input name="password2" type="password" maxlength="128" autocomplete="new-password" required></label>` : ""}
          <div class="field-err" id="aerr" hidden></div>
          <button class="btn primary lg block" id="asub">${reg ? raw(icon("sparkles") + "Создать аккаунт") : raw(icon("right") + "Войти")}</button>
        </form>
        <p class="faint" style="font-size:13px;margin-top:14px">${reg ? "Ник виден другим тестировщикам. Пароль хранится только в зашифрованном виде." : "Забыли пароль? Напишите администрации в чате тестирования — вам выдадут временный."}</p>
        ${reg ? "" : html`<div class="feat">
          <div>${I("bug")}<span>Баг-репорты в пару нажатий — с устройством и вложениями</span></div>
          <div>${I("bell")}<span>Статусы обращений и ответы команды в одном месте</span></div>
          <div>${I("bulb")}<span>Голосование за предложения других тестировщиков</span></div>
        </div>`}
      </div></div>`);
    $$("[data-mode]").forEach((b) => (b.onclick = () => renderLogin(b.dataset.mode)));
    const form = $("#auth");
    setTimeout(() => form.nick.focus(), 50);
    form.onsubmit = async (e) => {
      e.preventDefault();
      const err = $("#aerr");
      const show = (m) => { err.textContent = m; err.hidden = false; };
      err.hidden = true;
      const nick = form.nick.value.trim(), password = form.password.value;
      if (!/^[\p{L}\p{N}_.-]{3,24}$/u.test(nick)) return show("Ник: 3–24 символа — буквы, цифры, «_», «.» или «-»");
      if (reg && password.length < 8) return show("Пароль должен быть не короче 8 символов");
      if (reg && password !== form.password2.value) return show("Пароли не совпадают");
      const btn = $("#asub");
      btn.disabled = true;
      try {
        await POST(reg ? "/auth/register" : "/auth/login", { nick, password });
        boot();
      } catch (ex) {
        show(ex.message);
        btn.disabled = false;
      }
    };
  }

  // ---------------------------------------------------------------- boot
  async function boot() {
    try {
      S.me = await GET("/me");
    } catch (err) {
      S.me = null;
      if (err.status === 401) return renderLogin();
      set($("#app"), html`<div class="login"><div class="login-card">${errorBox(err)}</div></div>`);
      return;
    }
    S.rev = S.me.rev;
    if (location.pathname === "/login") history.replaceState({}, "", "/");
    renderShell();
    startPolling();
    run();
    syncPush();
  }
  async function reloadMe() { const me = await GET("/me"); S.me = me; return me; }

  // ================================================================ PAGES

  // ---------------------------------------------------------------- home
  route(/^\/$/, async (m, view, alive) => {
    set(view, html`<div class="sk hero"></div><div class="grid g4 mt2">${Array.from({ length: 4 }, () => html`<div class="sk card"></div>`)}</div>`);
    const load = async () => {
      const d = await GET("/home");
      if (!alive()) return;
      const c = d.counts, my = d.mine, me = S.me;
      set(view, html`
        <section class="hero">
          <span class="ver"><i></i>Тестируемая версия ${d.version}</span>
          <h1>Привет, ${me.user.first_name || me.user.name} 👋</h1>
          <p>${d.welcome}</p>
          <div class="actions stagger">
            <a class="action main-a" href="/new/bug"><span class="ai">${I("bug")}</span><b>Сообщить об ошибке</b><small>Баг-репорт за минуту</small></a>
            <a class="action" href="/new/idea"><span class="ai">${I("bulb")}</span><b>Предложить улучшение</b><small>Поделитесь идеей</small></a>
            <a class="action" href="/my"><span class="ai">${I("inbox")}</span><b>Мои обращения</b><small>${(my.bugs || 0) + (my.ideas || 0)} ${plural((my.bugs || 0) + (my.ideas || 0), ["обращение", "обращения", "обращений"])}</small></a>
            <a class="action" href="/all"><span class="ai">${I("grid")}</span><b>Все обращения</b><small>${c.bugs} ${plural(c.bugs, ["баг", "бага", "багов"])} · ${c.ideas} ${plural(c.ideas, ["идея", "идеи", "идей"])}</small></a>
          </div>
        </section>
        ${my.verify ? html`<a class="callout row mt2" style="--c:var(--info);color:var(--text)" href="/my">${I("refresh")}<span><b>Нужна ваша проверка:</b> ${my.verify} ${plural(my.verify, ["исправление ждёт", "исправления ждут", "исправлений ждут"])} подтверждения</span>${I("right", "right")}</a>` : ""}
        ${my.need_info ? html`<a class="callout row" style="--c:var(--warn);color:var(--text)" href="/my">${I("alert")}<span><b>Нужны данные:</b> команда просит дополнить ${my.need_info} ${plural(my.need_info, ["отчёт", "отчёта", "отчётов"])}</span>${I("right", "right")}</a>` : ""}
        <div class="grid g4 mt2 stagger">
          <a class="stat" href="/all?status=new" style="--c:#ff5d73"><div class="l"><i></i>Новые ошибки</div><div class="v">${c.new_bugs}</div></a>
          <a class="stat" href="/all?status=confirmed,in_progress" style="--c:#f7c948"><div class="l"><i></i>В работе</div><div class="v">${c.in_work}</div></a>
          <a class="stat" href="/all?status=verify" style="--c:#4cc9f0"><div class="l"><i></i>Ждут проверки</div><div class="v">${c.verify}</div></a>
          <a class="stat" href="/fixes" style="--c:#3ddc97"><div class="l"><i></i>Исправлено</div><div class="v">${c.fixed}</div></a>
        </div>
        <div class="grid g2 m1" style="align-items:start">
          <div>
            <h2 class="sec">${I("megaphone", "s")}Новости и изменения<a href="/updates">Все</a></h2>
            <div class="stack stagger">${d.posts.length ? d.posts.map(postCard) : empty("megaphone", "Пока нет объявлений", "Здесь появятся новости тестирования и списки изменений.")}</div>
          </div>
          <div>
            <h2 class="sec">${I("zap", "s")}Свежая активность<a href="/all?sort=activity">Все</a></h2>
            <div class="tlist stagger">${d.recent.length ? d.recent.map((t) => ticketCard(t)) : empty("bug", "Отчётов пока нет", "Станьте первым, кто сообщит об ошибке!")}</div>
            ${d.top_ideas.length ? html`<h2 class="sec">${I("sparkles", "s")}Популярные идеи<a href="/all?tab=idea&sort=votes">Все</a></h2><div class="tlist">${d.top_ideas.map((t) => ticketCard(t))}</div>` : ""}
            <div class="row wrap mt2"><a class="btn sm" href="/known">${I("alert", "s")}Известные проблемы</a><a class="btn sm" href="/fixes">${I("history", "s")}История исправлений</a><a class="btn sm" href="/leaders">${I("trophy", "s")}Рейтинг тестировщиков</a></div>
          </div>
        </div>`);
    };
    await load();
    S.refresh = load;
  });
  const postCard = (p) => html`<article class="post ${p.pinned ? "pinned" : ""}"><div class="row wrap"><span class="chip">${p.kind === "changelog" ? "📦 Список изменений" : "📣 Объявление"}</span>${p.version ? html`<span class="chip mono">v${p.version}</span>` : ""}${p.pinned ? html`<span class="chip">${I("pin", "s")}</span>` : ""}<span class="faint right" style="font-size:12.5px">${fmtDate(p.created)}</span></div><h3>${p.title}</h3>${p.body ? html`<div class="text">${rich(p.body)}</div>` : ""}</article>`;

  // ---------------------------------------------------------------- welcome / device onboarding
  function deviceForm(d = {}) {
    return html`
      <div class="stack">
        <label class="f">Модель устройства<input name="model" maxlength="60" placeholder="Например, Xiaomi Redmi Note 12" value="${d.model || ""}" autocomplete="off"></label>
        <div class="grid g2">
          <label class="f">Версия Android<input name="android" maxlength="20" list="android-list" inputmode="decimal" placeholder="14" value="${d.android || ""}"></label>
          <label class="f">Версия приложения<input name="app_version" maxlength="32" placeholder="${S.me.settings.current_version}" value="${d.app_version || S.me.settings.current_version}"></label>
        </div>
        <label class="f">Прошивка <small>необязательно — MIUI/HyperOS, One UI, кастомная ROM…</small><input name="firmware" maxlength="60" placeholder="HyperOS 1.0.5" value="${d.firmware || ""}"></label>
        <datalist id="android-list">${["16", "15", "14", "13", "12", "11", "10", "9", "8.1"].map((v) => html`<option value="${v}">`)}</datalist>
      </div>`;
  }
  const readForm = (root) => Object.fromEntries($$("input,textarea,select", root).filter((x) => x.name).map((x) => [x.name, x.type === "checkbox" ? x.checked : x.value.trim()]));

  route(/^\/welcome$/, async (m, view) => {
    set(view, html`
      <div class="wiz">
        <div class="hero">
          <span class="ver"><i></i>Шаг 1 из 1</span>
          <h1>Добро пожаловать в бету! 💜</h1>
          <p>Расскажите, на каком устройстве вы тестируете QVK. Эти данные будут автоматически подставляться в каждый отчёт — заполнять их снова не придётся.</p>
        </div>
        <div class="card pad-l mt2"><form id="dev-form">${deviceForm()}<button class="btn primary lg block mt2" type="submit">${I("check")}Сохранить и продолжить</button>
        ${S.me.is_admin ? html`<a class="btn ghost block mt" href="/admin">Пропустить (администратор)</a>` : ""}</form></div>
      </div>`);
    $("#dev-form").onsubmit = async (e) => {
      e.preventDefault();
      try {
        await POST("/devices", { ...readForm(e.target), make_active: true });
        await reloadMe();
        toast("Устройство сохранено");
        const next = sessionStorage.getItem("qvk_after_welcome");
        sessionStorage.removeItem("qvk_after_welcome");
        navigate(next && next !== "/welcome" ? next : "/", true);
      } catch (err) { fail(err); }
    };
  });

  // ---------------------------------------------------------------- lists
  function filterChips(state, kind, onChange) {
    const statuses = kind === "bug" ? M().bugStatuses : M().ideaStatuses;
    const cur = new Set(String(state.status || "").split(",").filter(Boolean));
    return html`<div class="chips-scroll">
      <button class="chip ${!cur.size ? "on" : ""}" data-st="">Все</button>
      ${statuses.map((s) => html`<button class="chip ${cur.has(s.id) ? "on" : ""}" data-st="${s.id}">${s.emoji} ${s.label}</button>`)}
    </div>`;
  }
  function filterSheet(state, kind, onApply, admin = false) {
    sheet("Фильтры и сортировка", (b, close) => {
      set(b, html`<form class="stack" id="ff">
        <label class="f">Категория<select name="category"><option value="">Все категории</option>${M().categories.map((c) => html`<option value="${c.id}" ${state.category === c.id ? "selected" : ""}>${c.label}</option>`)}</select></label>
        ${kind === "bug" || admin ? html`<label class="f">Приоритет<select name="priority"><option value="">Любой</option>${M().priorities.map((p) => html`<option value="${p.id}" ${state.priority === p.id ? "selected" : ""}>${p.label}</option>`)}</select></label>` : ""}
        <div class="grid g2"><label class="f">Версия приложения<input name="version" value="${state.version || ""}" placeholder="${S.me.settings.current_version}"></label>
        <label class="f">Версия Android<input name="android" value="${state.android || ""}" placeholder="14"></label></div>
        <label class="f">Модель устройства<input name="device" value="${state.device || ""}" placeholder="Pixel, Samsung, Redmi…"></label>
        <label class="f">Сортировка<select name="sort">
          ${[["new", "Сначала новые"], ["old", "Сначала старые"], ["activity", "По активности"], ["updated", "По обновлению"], ["priority", "По приоритету"], ["votes", kind === "idea" ? "По голосам" : "По подтверждениям"]].map(([v, l]) => html`<option value="${v}" ${state.sort === v ? "selected" : ""}>${l}</option>`)}
        </select></label>
        ${admin ? html`<label class="switch"><input type="checkbox" name="hidden" ${state.hidden === "1" ? "checked" : ""}><span class="t">Только скрытые</span></label><label class="switch"><input type="checkbox" name="pinned" ${state.pinned === "1" ? "checked" : ""}><span class="t">Только закреплённые</span></label>` : ""}
        <div class="row mt"><button type="button" class="btn block" id="ff-reset">Сбросить</button><button class="btn primary block">Применить</button></div>
      </form>`);
      $("#ff").onsubmit = (e) => {
        e.preventDefault();
        const f = readForm(e.target);
        Object.assign(state, { category: f.category, priority: f.priority || "", version: f.version, android: f.android, device: f.device, sort: f.sort, hidden: f.hidden ? "1" : "", pinned: f.pinned ? "1" : "" });
        close(); onApply();
      };
      $("#ff-reset").onclick = () => { for (const k of ["category", "priority", "version", "android", "device", "sort", "hidden", "pinned", "author"]) state[k] = ""; close(); onApply(); };
    });
  }
  const FILTER_KEYS = ["status", "category", "priority", "version", "android", "device", "sort", "q", "hidden", "pinned", "author"];
  const activeFilters = (st) => ["category", "priority", "version", "android", "device", "hidden", "pinned", "author"].filter((k) => st[k]).length + (st.sort && st.sort !== "new" ? 1 : 0);
  function syncUrl(state, extra = {}) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...extra, ...state })) if (v) q.set(k, v);
    const s = q.toString();
    history.replaceState(history.state, "", location.pathname + (s ? "?" + s : ""));
  }

  /** Generic paginated ticket list bound to a container. */
  function ticketList(container, buildQuery, renderItem, emptyTpl) {
    let page = 0, items = [], more = false, total = 0;
    const draw = () => {
      set(container, items.length ? html`<div class="faint" style="font-size:13px;margin:-4px 0 10px">${total} ${plural(total, ["обращение", "обращения", "обращений"])}</div><div class="tlist">${items.map(renderItem)}</div>${more ? html`<button class="btn block mt" data-more>Показать ещё</button>` : ""}` : typeof emptyTpl === "function" ? emptyTpl() : emptyTpl);
      const mb = $("[data-more]", container);
      if (mb) mb.onclick = async () => { mb.disabled = true; page++; await fetchPage(true); };
    };
    const fetchPage = async (append) => {
      const q = buildQuery();
      q.set("page", append ? page : 0);
      const r = await GET("/tickets?" + q);
      if (!append) page = 0;
      items = append ? items.concat(r.items) : r.items;
      more = r.more; total = r.total;
      draw();
      return r;
    };
    return {
      load: async () => { set(container, skList(4)); await fetchPage(false); },
      refresh: async () => {
        const q = buildQuery(); q.set("page", 0); q.set("limit", Math.max(30, items.length));
        const r = await GET("/tickets?" + q); items = r.items; more = r.more; total = r.total; draw();
      },
      get items() { return items; },
      draw,
    };
  }

  route(/^\/all$/, async (m, view) => {
    const qs = new URLSearchParams(location.search);
    const st = Object.fromEntries(FILTER_KEYS.map((k) => [k, qs.get(k) || ""]));
    let kind = qs.get("tab") === "idea" ? "idea" : "bug";
    set(view, html`
      <div class="page-head"><div class="grow"><h1>Все обращения</h1><p>Ошибки и предложения всех тестировщиков</p></div>
        <a class="btn primary hide-m" href="/new/${"bug"}">${I("plus")}Новое обращение</a></div>
      <div class="toolbar">
        <div class="seg" id="tabs"><button data-k="bug">${I("bug", "s")}Баги</button><button data-k="idea">${I("bulb", "s")}Предложения</button></div>
        <form class="search" id="sf">${I("search")}<input type="search" name="q" placeholder="Поиск по номеру, названию, описанию" value="${st.q}" enterkeyhint="search"></form>
        <button class="btn" id="fb">${I("filter")}<span>Фильтры</span><span class="count" id="fc" hidden></span></button>
      </div>
      <div id="chips"></div><div id="list"></div>`);
    const list = ticketList($("#list", view), () => { const q = new URLSearchParams({ kind }); for (const k of FILTER_KEYS) if (st[k]) q.set(k, st[k]); return q; }, (t) => ticketCard(t), empty("search", "Ничего не найдено", "Попробуйте изменить фильтры или поисковый запрос."));
    const apply = async () => {
      $$("#tabs button", view).forEach((b) => b.classList.toggle("on", b.dataset.k === kind));
      set($("#chips", view), filterChips(st, kind));
      $$("#chips [data-st]", view).forEach((b) => (b.onclick = () => {
        const cur = new Set(st.status.split(",").filter(Boolean));
        if (!b.dataset.st) cur.clear(); else cur.has(b.dataset.st) ? cur.delete(b.dataset.st) : cur.add(b.dataset.st);
        st.status = [...cur].join(","); apply();
      }));
      const n = activeFilters(st); const fc = $("#fc", view); fc.hidden = !n; fc.textContent = n;
      syncUrl(st, { tab: kind === "idea" ? "idea" : "" });
      await list.load();
    };
    $$("#tabs button", view).forEach((b) => (b.onclick = () => { if (kind !== b.dataset.k) { kind = b.dataset.k; st.status = ""; apply(); } }));
    $("#sf", view).onsubmit = (e) => { e.preventDefault(); st.q = e.target.q.value.trim(); apply(); $("input", e.target).blur(); };
    $("#sf input", view).addEventListener("search", (e) => { if (!e.target.value && st.q) { st.q = ""; apply(); } });
    $("#fb", view).onclick = () => filterSheet(st, kind, apply);
    await apply();
    S.refresh = list.refresh;
  });

  route(/^\/my$/, async (m, view) => {
    const qs = new URLSearchParams(location.search);
    let tab = ["bugs", "ideas", "fav"].includes(qs.get("tab")) ? qs.get("tab") : "bugs";
    set(view, html`
      <div class="page-head"><div class="grow"><h1>Мои обращения</h1><p>Статусы ваших отчётов и ответы команды обновляются автоматически</p></div></div>
      <div class="toolbar"><div class="seg" id="tabs"><button data-t="bugs">${I("bug", "s")}Мои баги</button><button data-t="ideas">${I("bulb", "s")}Мои предложения</button><button data-t="fav">${I("star", "s")}Избранное</button></div></div>
      <div id="list"></div>`);
    const list = ticketList($("#list", view), () => {
      const q = new URLSearchParams(tab === "fav" ? { kind: favKind, scope: "fav" } : { kind: tab === "bugs" ? "bug" : "idea", scope: "mine", sort: "updated" });
      return q;
    }, (t) => ticketCard(t, { note: true, updated: tab !== "fav" }), () => (tab === "bugs" ? empty("bug", "Вы ещё не отправляли баги", "Нашли ошибку? Расскажите о ней — это займёт минуту.", html`<a class="btn primary mt" href="/new/bug">${I("plus")}Сообщить об ошибке</a>`) : empty("bulb", "Предложений пока нет", "Поделитесь идеей, как сделать QVK лучше.", html`<a class="btn primary mt" href="/new/idea">${I("plus")}Предложить улучшение</a>`)));
    let favKind = "bug";
    const apply = async () => {
      $$("#tabs button", view).forEach((b) => b.classList.toggle("on", b.dataset.t === tab));
      history.replaceState(history.state, "", "/my" + (tab !== "bugs" ? "?tab=" + tab : ""));
      if (tab === "fav") {
        // Favourites contain both kinds — show two sections.
        const box = $("#list", view);
        set(box, skList(3));
        const [b, i] = await Promise.all([GET("/tickets?kind=bug&scope=fav&limit=100"), GET("/tickets?kind=idea&scope=fav&limit=100")]);
        set(box, b.items.length || i.items.length ? html`${b.items.length ? html`<h2 class="sec" style="margin-top:4px">Баги</h2><div class="tlist">${b.items.map((t) => ticketCard(t))}</div>` : ""}${i.items.length ? html`<h2 class="sec">Предложения</h2><div class="tlist">${i.items.map((t) => ticketCard(t))}</div>` : ""}` : empty("star", "Избранное пусто", "Нажмите звёздочку на странице обращения, чтобы следить за ним."));
        return;
      }
      await list.load();
    };
    $$("#tabs button", view).forEach((b) => (b.onclick = () => { tab = b.dataset.t; apply(); }));
    await apply();
    S.refresh = () => (tab === "fav" ? apply() : list.refresh());
  });

  // ---------------------------------------------------------------- uploader
  const ACCEPT = "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm,text/plain,.log,.txt,application/zip,application/pdf";
  function uploadFile(file, onProgress) {
    return new Promise((resolve, reject) => {
      const lim = M().limits;
      const max = file.type.startsWith("video/") ? lim.videoBytes : file.type.startsWith("image/") ? lim.imageBytes : lim.otherBytes;
      if (file.size > max) return reject(new Error(`«${file.name}» больше ${Math.round(max / 1048576)} МБ`));
      const fd = new FormData();
      fd.append("file", file, file.name);
      const x = new XMLHttpRequest();
      x.open("POST", "/api/p/upload");
      x.setRequestHeader("x-csrf", S.me.csrf);
      x.setRequestHeader("x-qvk", "1");
      x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
      x.onload = () => {
        let d = {};
        try { d = JSON.parse(x.responseText); } catch { /* ignore */ }
        x.status === 200 ? resolve(d.attachment) : reject(new Error(d.error || "Не удалось загрузить файл"));
      };
      x.onerror = () => reject(new Error("Сеть недоступна"));
      x.send(fd);
    });
  }
  /** Attachment picker. `list` is a live array of {id,name,mime,size}. */
  function uploader(root, list, onChange, { compact = false } = {}) {
    const pending = new Map();
    const draw = () => {
      set(root, html`
        ${compact ? "" : html`<label class="drop" tabindex="0">${I("upload", "l")}<div style="margin-top:6px"><b style="color:var(--text)">Добавить файлы</b></div><small>Скриншоты, видео до ${Math.round(M().limits.videoBytes / 1048576)} МБ, логи (TXT, ZIP, PDF)</small><input type="file" multiple accept="${ACCEPT}" hidden></label>`}
        ${compact ? html`<input type="file" multiple accept="${ACCEPT}" hidden>` : ""}
        ${list.length || pending.size ? html`<div class="files">
          ${list.map((a) => html`<div class="file">${a.mime.startsWith("image/") ? html`<img src="/files/${a.id}" alt="" loading="lazy">` : a.mime.startsWith("video/") ? html`${I("video", "l")}<span class="fname">${a.name}</span>` : html`${I("file", "l")}<span class="fname">${a.name}</span>`}<button type="button" class="x" data-rm="${a.id}" aria-label="Удалить">${I("x", "s")}</button></div>`)}
          ${[...pending.entries()].map(([k, p]) => html`<div class="file">${p.preview ? html`<img src="${p.preview}" alt="">` : ""}<span class="fname">${p.name}</span><div class="bar"><i style="width:${Math.round(p.progress * 100)}%" data-bar="${k}"></i></div></div>`)}
        </div>` : ""}`);
      const input = $("input[type=file]", root);
      const drop = $(".drop", root);
      if (drop) {
        drop.onkeydown = (e) => (e.key === "Enter" || e.key === " ") && input.click();
        drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
        drop.ondragleave = () => drop.classList.remove("over");
        drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); add([...e.dataTransfer.files]); };
      }
      input.onchange = () => { add([...input.files]); input.value = ""; };
      $$("[data-rm]", root).forEach((b) => (b.onclick = () => { const i = list.findIndex((a) => a.id === b.dataset.rm); if (i >= 0) list.splice(i, 1); draw(); onChange(); }));
    };
    const add = async (files) => {
      for (const f of files) {
        if (list.length + pending.size >= M().limits.attachmentsPerTicket) { toast(`Не более ${M().limits.attachmentsPerTicket} вложений`, "err"); break; }
        const key = Math.random().toString(36).slice(2);
        pending.set(key, { name: f.name, progress: 0, preview: f.type.startsWith("image/") ? URL.createObjectURL(f) : null });
        draw();
        uploadFile(f, (p) => { const e = pending.get(key); if (e) e.progress = p; const bar = $(`[data-bar="${key}"]`, root); if (bar) bar.style.width = Math.round(p * 100) + "%"; })
          .then((att) => { list.push(att); toast("Файл загружен"); })
          .catch(fail)
          .finally(() => { const p = pending.get(key); if (p?.preview) URL.revokeObjectURL(p.preview); pending.delete(key); draw(); onChange(); });
      }
    };
    draw();
    return { open: () => $("input[type=file]", root).click(), busy: () => pending.size > 0 };
  }

  // ---------------------------------------------------------------- new ticket wizard
  route(/^\/new(?:\/(bug|idea))?$/, async (m, view) => {
    const kind = m[1];
    if (!kind) {
      set(view, html`<div class="wiz"><div class="page-head"><div class="grow"><h1>Новое обращение</h1><p>Что вы хотите сообщить команде?</p></div></div>
        <div class="grid g2 m1 stagger">
          <a class="action main-a" href="/new/bug" style="min-height:150px"><span class="ai">${I("bug")}</span><b>Сообщить об ошибке</b><small>Что-то работает не так, как должно</small></a>
          <a class="action" href="/new/idea" style="min-height:150px"><span class="ai">${I("bulb")}</span><b>Предложить улучшение</b><small>Идея новой функции или доработки</small></a>
        </div></div>`);
      return;
    }
    const isBug = kind === "bug";
    const STEPS = isBug ? ["category", "summary", "repro", "device", "preview"] : ["category", "idea", "media", "preview"];
    const TITLES = { category: "Категория", summary: "Суть проблемы", repro: "Воспроизведение", device: "Устройство и вложения", idea: "Описание идеи", media: "Изображения и примеры", preview: "Предпросмотр" };
    const LKEY = "qvk_draft_" + kind;
    const blank = () => ({ category: "", title: "", description: "", steps: "", expected: "", actual: "", frequency: "", how_it_works: "", purpose: "", device_id: S.me.user.active_device, attachments: [] });
    let d = blank();
    let step = 0;
    let restored = false;
    try {
      const local = JSON.parse(localStorage.getItem(LKEY) || "null");
      const server = await GET("/drafts/" + kind).catch(() => ({}));
      const pick = local && (!server.draft || (local._t || 0) >= (server.updated || 0) * 1000) ? local : server.draft;
      if (pick && (pick.title || pick.description || pick.category)) { d = { ...blank(), ...pick }; step = Math.min(pick._step || 0, STEPS.length - 2); restored = true; }
    } catch { /* ignore */ }
    if (!S.me.devices.find((x) => x.id === d.device_id)) d.device_id = S.me.devices[0]?.id ?? null;
    const saveServer = debounce(() => api("PUT", "/drafts/" + kind, { draft: d }).catch(() => {}), 2000);
    const save = () => { if (cleared && !d.title && !d.category) return; cleared = false; d._t = Date.now(); d._step = step; localStorage.setItem(LKEY, JSON.stringify(d)); saveServer(); };
    let cleared = false;
    const clearDraft = () => { cleared = true; saveServer.cancel(); localStorage.removeItem(LKEY); api("DELETE", "/drafts/" + kind).catch(() => {}); };
    let up = null;
    let similar = null;

    const field = (name, label, opts = {}) => {
      const tag = opts.area ? "textarea" : "input";
      return html`<label class="f">${label}${opts.hint ? html` <small>${opts.hint}</small>` : ""}${raw(`<${tag} name="${name}" ${opts.area ? `rows="${opts.rows || 5}"` : 'autocomplete="off"'} maxlength="${opts.max || 6000}" placeholder="${esc(opts.ph || "")}">${opts.area ? esc(d[name]) : ""}</${tag}>`)}</label>`;
    };
    const validate = () => {
      const s = STEPS[step];
      if (s === "category" && !d.category) return "Выберите категорию";
      if (s === "category" && !isBug && d.title.trim().length < 4) return "Введите название идеи (минимум 4 символа)";
      if ((s === "summary") && d.title.trim().length < 4) return "Введите название (минимум 4 символа)";
      if ((s === "summary" || s === "idea") && d.description.trim().length < 10) return "Опишите подробнее (минимум 10 символов)";
      if (s === "repro" && d.steps.trim().length < 5) return "Опишите шаги воспроизведения";
      if (s === "repro" && !d.frequency) return "Укажите, как часто возникает ошибка";
      if (s === "device" && !d.device_id) return "Выберите устройство или добавьте его в профиле";
      if ((s === "device" || s === "media") && up?.busy()) return "Дождитесь окончания загрузки файлов";
      return null;
    };
    const devCard = (dv) => html`<button type="button" class="dev ${d.device_id === dv.id ? "on" : ""}" data-dev="${dv.id}"><span class="di">${I("phone")}</span><span style="flex:1;min-width:0"><b>${dv.model}</b><small>Android ${dv.android} · QVK ${dv.app_version}${dv.firmware ? " · " + dv.firmware : ""}</small></span>${d.device_id === dv.id ? I("check") : ""}</button>`;
    const previewTpl = () => {
      const cat = catOf(d.category);
      const dev = S.me.devices.find((x) => x.id === d.device_id);
      const blk = (t, v) => (v ? html`<div class="block"><h4>${t}</h4><div class="text">${v}</div></div>` : "");
      return html`<div class="preview-box">
        <div class="row wrap"><span class="mono" style="color:var(--accent);font-weight:700">${isBug ? "BUG" : "IDEA"}-????</span>${badge(kind, "new")}<span class="chip">${I(cat.icon, "s")}${cat.label}</span></div>
        <h2 class="ttitle" style="font-size:22px">${d.title}</h2>
        ${blk("Описание", d.description)}
        ${isBug ? html`${blk("Как воспроизвести", d.steps)}${blk("Ожидаемый результат", d.expected)}${blk("Фактический результат", d.actual)}<div class="block"><h4>Частота</h4>${freqOf(d.frequency)}</div>` : html`${blk("Как это должно работать", d.how_it_works)}${blk("Для чего это нужно", d.purpose)}`}
        ${dev ? html`<div class="block"><h4>Устройство</h4>${dev.model} · Android ${dev.android} · QVK ${dev.app_version}${dev.firmware ? " · " + dev.firmware : ""}</div>` : ""}
        ${d.attachments.length ? html`<div class="block"><h4>Вложения</h4>${d.attachments.length} ${plural(d.attachments.length, ["файл", "файла", "файлов"])}</div>` : ""}
      </div>`;
    };
    const similarTpl = () => {
      if (similar === null) return html`<div class="row muted mb"><span class="spin" style="width:15px;height:15px"></span>Ищем похожие обращения…</div>`;
      if (!similar.length) return html`<div class="callout row" style="--c:var(--ok)">${I("check")}<span>Похожих обращений не найдено — ваш отчёт уникален.</span></div>`;
      return html`<div class="similar"><h3>${I("alert", "s")} Возможно, об этом уже сообщали</h3><p class="muted" style="margin:0;font-size:14px">Проверьте похожие обращения. Если это то же самое — подтвердите, что ${isBug ? "ошибка встречается и у вас" : "идея вам нравится"}. Иначе просто отправьте свой отчёт.</p>
        ${similar.map((s) => html`<div class="sim"><div class="row wrap"><span class="mono" style="color:var(--accent);font-weight:700;font-size:13px">${s.code}</span>${badge(kind, s.status)}<span class="faint" style="font-size:12.5px">${isBug ? `${s.confirms} подтв.` : `${s.votes} голосов`}</span></div><b style="display:block;margin-top:6px">${s.title}</b>
          <div class="row wrap"><a class="btn sm" href="/${isBug ? "bugs" : "ideas"}/${s.code}" target="_blank" rel="noopener">${I("link", "s")}Открыть</a>
          <button class="btn sm ok" data-same="${s.code}">${I("check", "s")}${isBug ? "У меня тоже" : "Поддержать"}</button>
          <button class="btn sm" data-addc="${s.code}">${I("message", "s")}Добавить комментарий</button></div></div>`)}
        <p class="faint" style="font-size:13px;margin:12px 0 0">Это другая проблема? Нажмите «Отправить» — отчёт будет создан отдельно.</p></div>`;
    };
    const render = () => {
      const s = STEPS[step];
      let body;
      if (s === "category") {
        body = html`<div class="cats">${M().categories.map((c) => html`<button type="button" class="cat ${d.category === c.id ? "on" : ""}" data-cat="${c.id}"><span class="ci">${I(c.icon)}</span>${c.label}</button>`)}</div>
          ${isBug ? "" : html`<div class="mt2">${field("title", "Название идеи", { max: 140, ph: "Коротко: что предлагаете?" })}</div>`}`;
      } else if (s === "summary") {
        body = html`<div class="stack">${field("title", "Название", { max: 140, hint: "коротко и по делу", ph: "Например: Плеер останавливается при блокировке экрана" })}${field("description", "Подробное описание", { area: true, rows: 6, ph: "Что произошло? В каком разделе? Что вы делали перед этим?" })}</div>`;
      } else if (s === "repro") {
        body = html`<div class="stack">${field("steps", "Как воспроизвести", { area: true, rows: 5, ph: "1. Открыть «Музыку»\n2. Включить любой трек\n3. Заблокировать экран" })}
          <div class="grid g2 m1">${field("expected", "Ожидаемый результат", { area: true, rows: 3, max: 2000, ph: "Музыка продолжает играть" })}${field("actual", "Фактический результат", { area: true, rows: 3, max: 2000, ph: "Воспроизведение останавливается через 5 секунд" })}</div>
          <div><div style="font-weight:650;margin-bottom:8px">Частота возникновения</div><div class="row wrap">${M().frequencies.map((f) => html`<button type="button" class="chip ${d.frequency === f.id ? "on" : ""}" data-freq="${f.id}">${f.label}</button>`)}</div></div></div>`;
      } else if (s === "device") {
        body = html`<div style="font-weight:650;margin-bottom:8px">Устройство</div>
          <div class="devpick">${S.me.devices.map(devCard)}</div>
          <a class="btn ghost sm mt" href="/profile">${I("plus", "s")}Добавить или изменить устройство</a>
          <div style="font-weight:650;margin:22px 0 8px">Скриншоты, видео и другие вложения</div><div id="up"></div>`;
      } else if (s === "idea") {
        body = html`<div class="stack">${field("description", "Описание идеи", { area: true, rows: 5, ph: "В чём суть предложения?" })}${field("how_it_works", "Как это должно работать", { area: true, rows: 4, ph: "Опишите сценарий: что видит и делает пользователь" })}${field("purpose", "Для чего это нужно", { area: true, rows: 3, max: 2000, ph: "Какую проблему решает, кому будет полезно" })}</div>`;
      } else if (s === "media") {
        body = html`<p class="muted" style="margin-top:0">Необязательно: мокапы, скриншоты из других приложений, наброски.</p><div id="up"></div>`;
      } else {
        body = html`<div id="sim">${similarTpl()}</div>${previewTpl()}`;
      }
      const last = step === STEPS.length - 1;
      set(view, html`<div class="wiz">
        <a class="back" href="/">${I("left", "s")}Отмена</a>
        <div class="steps" aria-hidden="true">${STEPS.map((_, i) => html`<i class="${i < step ? "done" : i === step ? "cur" : ""}"></i>`)}</div>
        <div class="row between"><div class="step-title">Шаг ${step + 1} из ${STEPS.length} · ${TITLES[s]}</div>${restored && step === 0 ? html`<button class="linkish" id="reset" style="font-size:13px">Начать заново</button>` : ""}</div>
        <h1>${isBug ? "Сообщить об ошибке" : "Предложить улучшение"}</h1>
        <form id="wf" class="mt2" novalidate>${body}
          <div class="wiz-nav">${step > 0 ? html`<button type="button" class="btn lg" id="prev">${I("left")}Назад</button>` : ""}<button class="btn primary lg" id="next">${last ? raw(icon("send") + "Отправить") : raw("Далее" + icon("right"))}</button></div>
        </form></div>`);
      const form = $("#wf", view);
      $$("input[name],textarea[name]", form).forEach((el) => { if (el.tagName === "INPUT") el.value = d[el.name] || ""; el.oninput = () => { d[el.name] = el.value; save(); }; });
      $$("[data-cat]", form).forEach((b) => (b.onclick = () => { d.category = b.dataset.cat; save(); if (isBug) { step++; save(); render(); } else render(); }));
      $$("[data-freq]", form).forEach((b) => (b.onclick = () => { d.frequency = b.dataset.freq; save(); $$("[data-freq]", form).forEach((x) => x.classList.toggle("on", x === b)); }));
      $$("[data-dev]", form).forEach((b) => (b.onclick = () => { d.device_id = Number(b.dataset.dev); save(); render(); }));
      if ($("#up", view)) up = uploader($("#up", view), d.attachments, save);
      if ($("#reset", view)) $("#reset", view).onclick = () => { d = blank(); step = 0; restored = false; clearDraft(); render(); };
      if ($("#prev", view)) $("#prev", view).onclick = () => { step--; save(); render(); window.scrollTo(0, 0); };
      form.onsubmit = async (e) => {
        e.preventDefault();
        const err = validate();
        if (err) return toast(err, "err");
        if (!last) {
          step++; save(); render(); window.scrollTo(0, 0);
          if (STEPS[step] === "preview") findSimilar();
          return;
        }
        const btn = $("#next", view);
        btn.disabled = true; set(btn, html`<span class="spin"></span>Отправка…`);
        try {
          const r = await POST("/tickets", { kind, category: d.category, title: d.title, description: d.description, steps: d.steps, expected: d.expected, actual: d.actual, frequency: d.frequency, how_it_works: d.how_it_works, purpose: d.purpose, device_id: d.device_id, attachments: d.attachments.map((a) => a.id) });
          clearDraft();
          success(r.code);
        } catch (err2) {
          fail(err2);
          btn.disabled = false; set(btn, html`${I("send")}Отправить`);
        }
      };
      bindSimilar();
    };
    const bindSimilar = () => {
      $$("[data-same]", view).forEach((b) => (b.onclick = async () => {
        b.disabled = true;
        try {
          if (isBug) await POST(`/tickets/${b.dataset.same}/confirm`, { on: true });
          else await POST(`/tickets/${b.dataset.same}/vote`, { on: true });
          toast(isBug ? "Отмечено: ошибка встречается и у вас" : "Голос учтён");
          if (await confirmSheet("Удалить черновик?", "Вы присоединились к существующему обращению. Удалить ваш черновик и перейти к нему?", "Перейти")) { clearDraft(); navigate(`/${isBug ? "bugs" : "ideas"}/${b.dataset.same}`); }
        } catch (err) { fail(err); b.disabled = false; }
      }));
      $$("[data-addc]", view).forEach((b) => (b.onclick = () => { sessionStorage.setItem("qvk_comment_prefill", d.description ? `Встречается и у меня.\n\n${d.title}\n${d.description}`.slice(0, 3000) : ""); navigate(`/${isBug ? "bugs" : "ideas"}/${b.dataset.addc}#comment`); }));
    };
    const findSimilar = async () => {
      similar = null;
      try { similar = (await POST("/similar", { kind, title: d.title, description: d.description, category: d.category })).items; } catch { similar = []; }
      const box = $("#sim", view);
      if (box) { set(box, similarTpl()); bindSimilar(); }
    };
    const success = (code) => {
      confetti();
      set(view, html`<div class="success fade-in"><div class="big">${I("check")}</div><div class="muted">${isBug ? "Отчёт отправлен" : "Предложение опубликовано"}</div><div class="code mono">${code}</div>
        <p class="muted" style="max-width:44ch;margin:8px auto 0">Спасибо! Статус обращения будет обновляться в разделе «Мои обращения». ${S.me.user.notify_tg ? "Также мы пришлём уведомление в Telegram." : ""}</p>
        <div class="row wrap" style="justify-content:center;margin-top:22px"><a class="btn primary" href="/${isBug ? "bugs" : "ideas"}/${code}">${I("right")}Открыть обращение</a><a class="btn" href="/new/${kind}">${I("plus")}Создать ещё</a><a class="btn ghost" href="/">На главную</a></div></div>`);
    };
    if (restored) toast("Черновик восстановлен");
    render();
    if (STEPS[step] === "preview") findSimilar();
  });

  // ---------------------------------------------------------------- ticket page
  route(/^\/(bugs|ideas)\/((?:BUG|IDEA)-\d+)$/i, async (m, view, alive) => {
    const code = m[2].toUpperCase();
    set(view, html`<div class="sk line" style="width:120px"></div><div class="sk title mt"></div><div class="tlayout mt2"><div>${skList(3)}</div><div class="sk card" style="height:200px"></div></div>`);
    let t = await GET("/tickets/" + code);
    if (!alive()) return;
    if ((t.kind === "bug") !== (m[1].toLowerCase() === "bugs")) history.replaceState({}, "", pathOf(t));
    const isBug = t.kind === "bug";
    const commentAtts = [];
    set(view, html`
      <a class="back" href="${history.length > 1 ? "#" : "/all"}" id="back">${I("left", "s")}Назад</a>
      <div id="t-head"></div>
      <div class="tlayout">
        <div><div id="t-body"></div>
          <h2 class="sec">${I("message", "s")}Обсуждение и история</h2>
          <div id="t-timeline" class="timeline"></div>
          <div id="t-composer"></div>
        </div>
        <aside><div id="t-side"></div><div id="t-admin"></div></aside>
      </div>`);
    $("#back", view).onclick = (e) => { if (history.length > 1) { e.preventDefault(); history.back(); } };

    const drawHead = () => set($("#t-head", view), html`
      <div class="thead"><span class="mono" style="color:var(--accent);font-weight:800">${t.code}</span>${badge(t.kind, t.status, true)}${isBug && t.priority !== "normal" ? prio(t.priority) : ""}
        ${t.pinned ? html`<span class="chip">${I("pin", "s")}Закреплено</span>` : ""}${t.hidden ? html`<span class="chip">${I("eyeoff", "s")}Скрыто администрацией</span>` : ""}${t.source === "app" ? html`<span class="chip">${I("phone", "s")}Из приложения</span>` : ""}
        <span class="right row"><button class="btn sm icon ${t.my_fav ? "on" : ""}" id="fav" aria-label="В избранное" title="В избранное">${I("star", "s")}</button><button class="btn sm icon" id="copy" aria-label="Скопировать ссылку" title="Скопировать ссылку">${I("link", "s")}</button>${t.can.edit ? html`<button class="btn sm" id="edit">${I("edit", "s")}<span class="hide-m">Изменить</span></button>` : ""}</span></div>
      <h1 class="ttitle">${t.title}</h1>
      <div class="row wrap muted" style="font-size:13.5px;gap:14px"><span class="row" style="gap:6px">${I("user", "s")}${t.author.name}${t.author.is_admin ? html` <span class="role">Команда</span>` : ""}${t.author.me ? html` <span class="role">Вы</span>` : ""}</span><span title="${fmtDT(t.created)}">${I("clock", "s")} ${fmtDate(t.created)}</span><span>${I(catOf(t.category).icon, "s")} ${catOf(t.category).label}</span>${t.updated !== t.created ? html`<span>Обновлено ${rel(t.updated)}</span>` : ""}</div>
      <p class="status-desc">${statusOf(t.kind, t.status).desc}</p>`);
    const blk = (title, v) => (v ? html`<div class="block"><h4>${title}</h4><div class="text">${rich(v)}</div></div>` : "");
    const gallery = (atts) => html`<div class="gallery">${atts.map((a) => a.mime.startsWith("image/") ? html`<a href="${a.url}" data-lb="${a.url}" target="_blank"><img src="${a.url}" alt="${a.name}" loading="lazy"></a>` : a.mime.startsWith("video/") ? html`<div class="vid"><video src="${a.url}" controls preload="metadata" playsinline></video></div>` : html`<a href="${a.url}" target="_blank" rel="noopener">${I("file", "l")}<span>${a.name}<br><small class="faint">${fmtSize(a.size)}</small></span></a>`)}</div>`;
    const drawBody = () => {
      const st = statusOf(t.kind, t.status);
      set($("#t-body", view), html`
        ${t.duplicate_of ? html`<div class="callout" style="--c:#a78bfa"><h3>${I("merge", "s")}Это дубликат</h3>Обсуждение продолжается в <a href="/${isBug ? "bugs" : "ideas"}/${t.duplicate_of}">${t.duplicate_of}</a>.</div>` : ""}
        ${t.can.verify ? html`<div class="callout" style="--c:var(--info)"><h3>${I("refresh", "s")}Проверьте исправление</h3><p style="margin:0 0 12px">Команда исправила ошибку${t.fixed_version ? html` в версии <b>${t.fixed_version}</b>` : ""}. Проверьте на своём устройстве и сообщите результат.</p>
          <textarea id="vnote" rows="2" placeholder="Комментарий (необязательно)" style="min-height:60px"></textarea>
          <div class="row wrap mt"><button class="btn ok" data-verify="fixed">${I("check")}Исправлено</button><button class="btn danger" data-verify="still">${I("alert")}Проблема осталась</button></div></div>` : ""}
        ${t.status_note ? html`<div class="callout" style="--c:${st.color}"><h3>${I("shield", "s")}${t.kind === "idea" && ["rejected", "postponed"].includes(t.status) ? "Причина" : "Комментарий команды"}</h3><div class="text">${rich(t.status_note)}</div></div>` : ""}
        <div class="card pad-l">
          ${blk(isBug ? "Описание" : "Описание идеи", t.description)}
          ${isBug ? html`${blk("Как воспроизвести", t.steps)}<div class="grid g2 m1">${blk("Ожидаемый результат", t.expected)}${blk("Фактический результат", t.actual)}</div>` : html`${blk("Как это должно работать", t.how_it_works)}${blk("Для чего это нужно", t.purpose)}`}
          ${t.attachments.length ? html`<div class="block"><h4>Вложения · ${t.attachments.length}</h4>${gallery(t.attachments)}</div>` : ""}
          ${t.duplicates.length ? html`<div class="block"><h4>Объединённые дубликаты</h4><div class="row wrap">${t.duplicates.map((x) => html`<a class="chip mono" href="/${isBug ? "bugs" : "ideas"}/${x.code}">${x.code}</a>`)}</div></div>` : ""}
        </div>`);
      $$("[data-verify]", view).forEach((b) => (b.onclick = async () => {
        if (!(await confirmSheet(b.dataset.verify === "fixed" ? "Подтвердить исправление?" : "Проблема осталась?", b.dataset.verify === "fixed" ? "Отчёт будет закрыт. Спасибо за проверку!" : "Отчёт вернётся команде в работу.", "Да, отправить"))) return;
        try { await POST(`/tickets/${t.code}/verify`, { result: b.dataset.verify, note: $("#vnote", view)?.value || "" }); toast(b.dataset.verify === "fixed" ? "Спасибо! Отчёт закрыт" : "Команда получила ваш ответ"); await reload(); } catch (err) { fail(err); }
      }));
    };
    const drawSide = () => set($("#t-side", view), html`
      <div class="card stack">
        ${isBug ? html`
          ${t.can.confirm ? html`<button class="btn block ${t.my_confirm ? "on" : ""}" id="confirm">${I(t.my_confirm ? "check" : "users")}${t.my_confirm ? "Вы подтвердили" : "У меня тоже"} · ${t.confirms}</button>` : html`<div class="row muted">${I("users", "s")}Подтвердили: <b style="color:var(--text)">${t.confirms}</b></div>`}
          <dl class="kv"><dt>Устройство</dt><dd>${t.device.model || "—"}</dd><dt>Android</dt><dd>${t.device.android || "—"}</dd><dt>Версия QVK</dt><dd class="mono">${t.device.app_version || "—"}</dd>${t.device.firmware ? html`<dt>Прошивка</dt><dd>${t.device.firmware}</dd>` : ""}<dt>Частота</dt><dd>${freqOf(t.frequency)}</dd>${t.fixed_version ? html`<dt>Исправлено в</dt><dd class="mono" style="color:var(--ok)">${t.fixed_version}</dd>` : ""}<dt>Приоритет</dt><dd>${prioOf(t.priority).label}</dd></dl>`
        : html`<div class="row" style="gap:14px">${voteBtn(t)}<div><b style="font-size:18px">${t.votes} ${plural(t.votes, ["голос", "голоса", "голосов"])}</b><div class="muted" style="font-size:13px">Поддержите идею, если она вам нравится</div></div></div>
          ${t.device.model ? html`<dl class="kv"><dt>Устройство</dt><dd>${t.device.model}</dd><dt>Версия QVK</dt><dd class="mono">${t.device.app_version}</dd></dl>` : ""}`}
        ${t.author.username && S.me.is_admin ? html`<div class="hr" style="margin:4px 0"></div><dl class="kv"><dt>Автор</dt><dd>${t.author.name}<br><a href="https://t.me/${t.author.username}" target="_blank" rel="noopener">@${t.author.username}</a> <span class="faint mono">${t.author.id}</span></dd></dl>` : ""}
      </div>`);
    const drawTimeline = () => {
      const fieldLabel = { status: "Статус", priority: "Приоритет", fixed_version: "Версия исправления", pinned: "Закрепление", hidden: "Видимость", edited: "Отредактировано", note: "Пояснение", merged: "Объединение", created: "Создано" };
      const hv = (h, v) => (h.field === "status" ? statusOf(t.kind, v).label : h.field === "priority" ? prioOf(v).label : h.field === "pinned" ? (v === "1" ? "закреплено" : "откреплено") : h.field === "hidden" ? (v === "1" ? "скрыто" : "видно всем") : v || "—");
      const events = [
        ...t.history.map((h) => ({ t: h.created, h })),
        ...t.comment_list.map((c) => ({ t: c.created, c })),
      ].sort((a, b) => a.t - b.t);
      set($("#t-timeline", view), events.length ? events.map((ev) => {
        if (ev.h) {
          const h = ev.h;
          if (h.field === "created") return html`<div class="hist">${I("sparkles", "s")}<span><b>${h.actor}</b> создал${""} обращение</span><span class="faint">${rel(h.created)}</span></div>`;
          if (h.field === "edited") return html`<div class="hist">${I("edit", "s")}<span><b>${h.actor}</b> отредактировал отчёт</span><span class="faint">${rel(h.created)}</span></div>`;
          if (h.field === "note") return html`<div class="hist">${I("shield", "s")}<span><b>${h.actor}</b> оставил пояснение</span><span class="faint">${rel(h.created)}</span>${h.note ? html`<span class="note-h">${h.note}</span>` : ""}</div>`;
          if (h.field === "merged") return html`<div class="hist">${I("merge", "s")}<span>${h.note}</span><span class="faint">${rel(h.created)}</span></div>`;
          return html`<div class="hist">${I(h.field === "status" ? "refresh" : "settings", "s")}<span><b>${h.actor}</b> · ${fieldLabel[h.field] || h.field}: ${h.old != null ? html`<span class="faint">${hv(h, h.old)}</span> → ` : ""}<b style="color:var(--text)">${hv(h, h.new)}</b></span><span class="faint" title="${fmtDT(h.created)}">${rel(h.created)}</span>${h.note ? html`<span class="note-h">${h.note}</span>` : ""}</div>`;
        }
        const c = ev.c;
        return html`<div class="cmt ${c.author.is_admin ? "admin" : ""} ${c.kind === "addendum" ? "addendum" : ""}">${avatar(c.author.name, c.author.is_admin)}<div class="bubble">
          <div class="who"><b>${c.author.name}</b>${c.author.is_admin ? html`<span class="role">Команда QVK</span>` : ""}${c.author.is_author && !c.author.is_admin ? html`<span class="role">Автор</span>` : ""}${c.kind === "addendum" ? html`<span class="role" style="color:var(--info)">Дополнение</span>` : ""}<span class="faint" title="${fmtDT(c.created)}">${rel(c.created)}</span>
          ${c.can_delete ? html`<button class="btn ghost sm icon right" data-delc="${c.id}" aria-label="Удалить">${I("trash", "s")}</button>` : ""}</div>
          ${c.deleted ? html`<i class="faint">Комментарий удалён</i>` : html`<div class="text">${rich(c.body)}</div>${c.attachments.length ? html`<div class="mt">${gallery(c.attachments)}</div>` : ""}`}
        </div></div>`;
      }) : html`<p class="faint">Пока нет комментариев.</p>`);
      $$("[data-delc]", view).forEach((b) => (b.onclick = async () => { if (!(await confirmSheet("Удалить комментарий?", "Это действие нельзя отменить.", "Удалить", true))) return; try { await api("DELETE", "/comments/" + b.dataset.delc); toast("Комментарий удалён"); await reload(); } catch (err) { fail(err); } }));
    };
    const drawComposer = () => {
      if (!t.can.comment) { set($("#t-composer", view), html`<p class="faint mt">Комментарии к этому обращению доступны только автору и команде.</p>`); return; }
      set($("#t-composer", view), html`<div class="composer" id="comment"><div class="card">
        <textarea id="ctext" rows="2" maxlength="4000" placeholder="${t.can.addendum ? "Ответьте команде или дополните отчёт…" : "Написать комментарий…"}"></textarea>
        <div id="cup"></div>
        <div class="row mt" style="gap:8px">
          <button class="btn sm icon" id="cattach" aria-label="Прикрепить файл">${I("clip", "s")}</button>
          ${t.can.addendum ? html`<label class="row" style="gap:6px;font-size:13.5px;cursor:pointer"><input type="checkbox" class="check" id="cadd">Дополнение к отчёту</label>` : ""}
          <button class="btn primary sm right" id="csend">${I("send", "s")}Отправить</button>
        </div></div></div>`);
      const up = uploader($("#cup", view), commentAtts, () => {}, { compact: true });
      $("#cattach", view).onclick = () => up.open();
      const prefill = sessionStorage.getItem("qvk_comment_prefill");
      if (prefill) { $("#ctext", view).value = prefill; sessionStorage.removeItem("qvk_comment_prefill"); }
      if (location.hash === "#comment") setTimeout(() => $("#ctext", view)?.focus(), 300);
      $("#csend", view).onclick = async () => {
        const body = $("#ctext", view).value.trim();
        if (!body && !commentAtts.length) return toast("Напишите комментарий", "err");
        if (up.busy()) return toast("Дождитесь загрузки файлов", "err");
        const b = $("#csend", view); b.disabled = true;
        try {
          await POST(`/tickets/${t.code}/comments`, { body, kind: $("#cadd", view)?.checked ? "addendum" : "comment", attachments: commentAtts.map((a) => a.id) });
          commentAtts.length = 0;
          $("#ctext", view).value = "";
          if ($("#cadd", view)) $("#cadd", view).checked = false;
          set($("#cup", view), ""); drawComposer();
          toast("Комментарий отправлен");
          await reload();
        } catch (err) { fail(err); } finally { b.disabled = false; }
      };
    };
    const drawAdmin = () => {
      if (!t.can.admin) return;
      set($("#t-admin", view), html`<div class="card adm mt"><h3>${I("shield", "s")}Управление</h3><form class="stack" id="af">
        <label class="f">Статус<select name="status">${statusOptions(t.kind, t.status)}</select></label>
        ${isBug ? html`<label class="f">Приоритет<select name="priority">${prioOptions(t.priority)}</select></label>
        <label class="f">Версия исправления<input name="fixed_version" value="${t.fixed_version || ""}" placeholder="${S.me.settings.current_version}"></label>` : ""}
        <label class="f">Пояснение для автора <small>${t.status_note ? "текущее пояснение показано выше; новое заменит его" : "будет видно на странице и придёт автору"}</small><textarea name="note" rows="3" style="min-height:80px" placeholder="${isBug ? "Например: исправлено, проверьте в сборке 3.0.2" : "Причина отклонения или переноса"}"></textarea></label>
        <label class="switch" style="padding:4px 0"><input type="checkbox" name="pinned" ${t.pinned ? "checked" : ""}><span class="t">Закрепить</span></label>
        <label class="switch" style="padding:4px 0"><input type="checkbox" name="hidden" ${t.hidden ? "checked" : ""}><span class="t">Скрыть от тестировщиков</span></label>
        <button class="btn primary block">${I("check")}Сохранить</button>
        <div class="row wrap">${isBug ? html`<button type="button" class="btn sm ok" data-quick="fixed">${I("check", "s")}Исправлено</button><button type="button" class="btn sm" data-quick="verify">${I("refresh", "s")}На проверку</button><button type="button" class="btn sm" data-quick="need_info">Нужны данные</button>` : html`<button type="button" class="btn sm ok" data-quick="done">${I("check", "s")}Реализовано</button><button type="button" class="btn sm danger" data-quick="rejected">Отклонить</button>`}</div>
        <div class="hr" style="margin:4px 0"></div>
        <label class="f">Объединить как дубликат <small>это обращение станет дубликатом указанного</small><div class="row"><input name="target" placeholder="${isBug ? "BUG-0001" : "IDEA-0001"}" style="text-transform:uppercase"><button type="button" class="btn" id="merge">${I("merge", "s")}</button></div></label>
      </form></div>`);
      const form = $("#af", view);
      const save = async (patch) => {
        try {
          await POST(`/tickets/${t.code}/admin`, patch);
          toast("Изменения сохранены"); await reload();
        } catch (err) { fail(err); }
      };
      form.onsubmit = (e) => { e.preventDefault(); const f = readForm(form); delete f.target; save(f); };
      $$("[data-quick]", form).forEach((b) => (b.onclick = () => { const f = readForm(form); delete f.target; f.status = b.dataset.quick; save(f); }));
      $("#merge", form).onclick = async () => {
        const target = form.target.value.trim().toUpperCase();
        if (!target) return toast("Укажите номер основного обращения", "err");
        if (!(await confirmSheet("Объединить дубликат?", `${t.code} будет отмечен как дубликат ${target}. Подтверждения/голоса перенесутся, автор получит уведомление.`, "Объединить"))) return;
        try { await POST("/admin/merge", { source: t.code, target }); toast("Обращения объединены"); await reload(); } catch (err) { fail(err); }
      };
    };
    const bindHead = () => {
      $("#fav", view).onclick = async () => { try { const r = await POST(`/tickets/${t.code}/favorite`); t.my_fav = r.on; drawHead(); bindHead(); toast(r.on ? "Добавлено в избранное" : "Удалено из избранного"); } catch (err) { fail(err); } };
      $("#copy", view).onclick = async () => { const url = location.origin + pathOf(t); try { await navigator.clipboard.writeText(url); toast("Ссылка скопирована"); } catch { prompt("Ссылка на обращение", url); } };
      if ($("#edit", view)) $("#edit", view).onclick = editSheet;
      const cb = $("#confirm", view);
      if (cb) cb.onclick = async () => { try { const r = await POST(`/tickets/${t.code}/confirm`); t.my_confirm = r.on; t.confirms = r.confirms; drawSide(); bindHead(); toast(r.on ? "Отмечено: встречается и у вас" : "Отметка снята"); } catch (err) { fail(err); } };
    };
    const editSheet = () => sheet("Редактирование " + t.code, (b, close) => {
      const area = (n, l, rows = 4) => html`<label class="f">${l}<textarea name="${n}" rows="${rows}">${t[n] || ""}</textarea></label>`;
      set(b, html`<form class="stack" id="ef">
        <label class="f">Категория<select name="category">${M().categories.map((c) => html`<option value="${c.id}" ${c.id === t.category ? "selected" : ""}>${c.label}</option>`)}</select></label>
        <label class="f">Название<input name="title" maxlength="140" value="${t.title}"></label>
        ${area("description", "Описание", 5)}
        ${isBug ? html`${area("steps", "Как воспроизвести")}${area("expected", "Ожидаемый результат", 2)}${area("actual", "Фактический результат", 2)}<label class="f">Частота<select name="frequency">${M().frequencies.map((f) => html`<option value="${f.id}" ${f.id === t.frequency ? "selected" : ""}>${f.label}</option>`)}</select></label>` : html`${area("how_it_works", "Как это должно работать")}${area("purpose", "Для чего это нужно", 3)}`}
        <button class="btn primary block">${I("check")}Сохранить</button></form>`);
      $("#ef", b).onsubmit = async (e) => { e.preventDefault(); try { await api("PATCH", "/tickets/" + t.code, readForm(e.target)); close(); toast("Обращение обновлено"); await reload(); } catch (err) { fail(err); } };
    });
    const drawAll = () => { drawHead(); drawBody(); drawSide(); drawTimeline(); drawAdmin(); bindHead(); };
    const reload = async () => { t = await GET("/tickets/" + code); if (!alive()) return; drawAll(); };
    drawAll();
    drawComposer();
    view.addEventListener("click", (e) => { const a = e.target.closest("[data-lb]"); if (a) { e.preventDefault(); lightbox(a.dataset.lb); } });
    S.refresh = async () => {
      // Do not wipe an admin form that is being edited.
      if ($("#af", view)?.contains(document.activeElement)) return;
      await reload();
    };
    if (location.hash === "#comment") setTimeout(() => $("#comment", view)?.scrollIntoView({ behavior: "smooth", block: "center" }), 200);
  });

  // ---------------------------------------------------------------- known / fixes / updates / leaders
  route(/^\/known$/, async (m, view) => {
    set(view, skPage());
    const load = async () => {
      const r = await GET("/known");
      set(view, html`<div class="page-head"><div class="grow"><h1>Известные проблемы</h1><p>Подтверждённые ошибки, над которыми работает команда. Версия ${r.version}.</p></div></div>
        <div class="callout row" style="--c:var(--info)">${I("alert")}<span>Если вы столкнулись с одной из этих проблем — откройте её и нажмите <b>«У меня тоже»</b> вместо создания нового отчёта.</span></div>
        <div class="tlist stagger">${r.items.length ? r.items.map((t) => ticketCard(t)) : empty("check", "Известных проблем нет", "Команда не отслеживает открытых подтверждённых ошибок.")}</div>`);
    };
    await load(); S.refresh = load;
  });

  route(/^\/fixes$/, async (m, view) => {
    set(view, skPage());
    const load = async () => {
      const r = await GET("/fixes");
      const groups = new Map();
      for (const t of r.items) { const v = t.kind === "bug" ? t.fixed_version || "—" : t.fixed_version || "Реализованные идеи"; if (!groups.has(v)) groups.set(v, []); groups.get(v).push(t); }
      set(view, html`<div class="page-head"><div class="grow"><h1>История исправлений</h1><p>Исправленные ошибки и реализованные предложения по версиям</p></div></div>
        ${r.items.length ? [...groups.entries()].map(([v, list]) => html`<h2 class="sec">${I("history", "s")}${/^\d/.test(v) ? "Версия " + v : v}<span class="faint" style="margin-left:auto;text-transform:none;letter-spacing:0">${list.length}</span></h2><div class="tlist">${list.map((t) => ticketCard(t, { vote: false }))}</div>`) : empty("history", "Пока пусто", "Здесь появятся исправленные ошибки с номером версии.")}`);
    };
    await load(); S.refresh = load;
  });

  route(/^\/updates$/, async (m, view) => {
    set(view, skPage());
    const load = async () => {
      const r = await GET("/posts");
      set(view, html`<div class="page-head"><div class="grow"><h1>Обновления</h1><p>Объявления команды и списки изменений бета-версий</p></div>${S.me.is_admin ? html`<button class="btn primary" id="np">${I("plus")}Новая запись</button>` : ""}</div>
        <div class="stack stagger">${r.items.length ? r.items.map((p) => html`<div>${postCard(p)}${S.me.is_admin ? html`<div class="row" style="margin:6px 4px 0">${p.recipients ? html`<span class="faint" style="font-size:12.5px;margin-right:6px">${I("send", "s")} разослано: ${p.recipients}</span>` : ""}<button class="btn ghost sm" data-ep="${p.id}">${I("edit", "s")}Изменить</button><button class="btn ghost sm" data-dp="${p.id}">${I("trash", "s")}Удалить</button></div>` : ""}</div>`) : empty("megaphone", "Записей пока нет", "Здесь появятся объявления и списки изменений.")}</div>`);
      if (!S.me.is_admin) return;
      $("#np", view).onclick = () => postSheet(null, load);
      $$("[data-ep]", view).forEach((b) => (b.onclick = () => postSheet(r.items.find((p) => String(p.id) === b.dataset.ep), load)));
      $$("[data-dp]", view).forEach((b) => (b.onclick = async () => { if (!(await confirmSheet("Удалить запись?", "Запись исчезнет со страницы обновлений.", "Удалить", true))) return; try { await api("DELETE", "/admin/posts/" + b.dataset.dp); toast("Запись удалена"); load(); } catch (err) { fail(err); } }));
    };
    await load(); S.refresh = load;
  });
  function postSheet(p, done) {
    sheet(p ? "Редактировать запись" : "Новая запись", (b, close) => {
      set(b, html`<form class="stack" id="pf">
        <div class="seg"><label class="row" style="padding:6px 10px;gap:6px"><input type="radio" name="kind" value="announce" ${!p || p.kind === "announce" ? "checked" : ""}>📣 Объявление</label><label class="row" style="padding:6px 10px;gap:6px"><input type="radio" name="kind" value="changelog" ${p?.kind === "changelog" ? "checked" : ""}>📦 Список изменений</label></div>
        <label class="f">Заголовок<input name="title" maxlength="140" value="${p?.title || ""}"></label>
        <label class="f">Версия <small>необязательно</small><input name="version" maxlength="32" value="${p?.version || ""}" placeholder="${S.me.settings.current_version}"></label>
        <label class="f">Текст<textarea name="body" rows="7">${p?.body || ""}</textarea></label>
        <label class="switch"><input type="checkbox" name="pinned" ${p?.pinned ? "checked" : ""}><span class="t">Закрепить сверху</span></label>
        ${p ? "" : html`<label class="switch"><input type="checkbox" name="notify" checked><span class="t">Разослать тестировщикам<small>В Telegram — тем, у кого он привязан, и пуш-уведомлением — у кого они включены в браузере</small></span></label>`}
        <button class="btn primary block">${I("check")}Опубликовать</button></form>`);
      $("#pf", b).onsubmit = async (e) => {
        e.preventDefault();
        const f = readForm(e.target);
        f.kind = $('input[name="kind"]:checked', e.target).value;
        try {
          const r = p ? await api("PUT", "/admin/posts/" + p.id, f) : await POST("/admin/posts", f);
          close();
          toast(r.sent ? `Опубликовано · Telegram: ${r.sent.telegram}, пуш: ${r.sent.push}` : "Запись опубликована");
          done();
        } catch (err) { fail(err); }
      };
    });
  }

  route(/^\/leaders$/, async (m, view) => {
    set(view, skPage());
    const r = await GET("/leaders");
    const medal = ["🥇", "🥈", "🥉"];
    const top = r.testers.slice(0, 3);
    const order = top.length === 3 ? [top[1], top[0], top[2]] : top;
    set(view, html`<div class="page-head"><div class="grow"><h1>Рейтинг тестировщиков</h1><p>Баллы: подтверждённый баг +5, исправленный +3, отчёт +1, реализованная идея +8, голос за вашу идею +1, подтверждение чужого бага +1.</p></div></div>
      ${top.length ? html`<div class="podium stagger">${order.map((u) => { const i = r.testers.indexOf(u); return html`<div class="pod p${i + 1}"><div class="medal">${medal[i]}</div>${avatar(u.name)}<b>${u.name}${u.me ? " (вы)" : ""}</b><div class="pts">${u.points}</div><small class="muted">${u.accepted} ${plural(u.accepted, ["принятый баг", "принятых бага", "принятых багов"])}</small></div>`; })}</div>` : empty("trophy", "Рейтинг пока пуст", "Отправляйте отчёты, чтобы попасть в рейтинг!")}
      ${r.testers.length > 3 ? html`<div class="card mt2 scroll-x"><table class="table"><thead><tr><th>#</th><th>Тестировщик</th><th>Баги</th><th>Принято</th><th>Идеи</th><th>Баллы</th></tr></thead><tbody>${r.testers.slice(3).map((u, i) => html`<tr${u.me ? raw(' style="background:rgba(155,109,255,.08)"') : ""}><td class="faint">${i + 4}</td><td><b>${u.name}</b></td><td>${u.bugs}</td><td>${u.accepted}</td><td>${u.ideas}</td><td><b>${u.points}</b></td></tr>`)}</tbody></table></div>` : ""}
      <div class="grid g2 m1 mt2" style="align-items:start">
        <div><h2 class="sec">${I("users", "s")}Самые подтверждаемые баги</h2><div class="tlist">${r.top_bugs.length ? r.top_bugs.map((t) => ticketCard(t)) : html`<p class="faint">Пока нет подтверждений.</p>`}</div></div>
        <div><h2 class="sec">${I("sparkles", "s")}Самые популярные идеи</h2><div class="tlist">${r.top_ideas.length ? r.top_ideas.map((t) => ticketCard(t)) : html`<p class="faint">Пока нет голосов.</p>`}</div></div>
      </div>`);
  });

  // ---------------------------------------------------------------- notifications
  route(/^\/notifications$/, async (m, view) => {
    set(view, skPage());
    const load = async () => {
      const r = await GET("/notifications");
      const ic = { status: "refresh", comment: "message", need_info: "alert", verify: "refresh", fixed: "check", implemented: "sparkles", news: "megaphone" };
      set(view, html`<div class="page-head"><div class="grow"><h1>Уведомления</h1><p>Изменения статусов и ответы команды</p></div>${r.items.some((n) => !n.read) ? html`<button class="btn" id="ra">${I("check")}Прочитать все</button>` : ""}</div>
        ${!S.me.user.tg_linked || !S.me.user.notify_tg || S.me.user.tg_blocked ? html`<a class="callout row" style="--c:var(--accent);color:var(--text)" href="/profile">${I("telegram")}<span>Хотите получать уведомления в Telegram? Подключите его в профиле — это займёт 10 секунд.</span>${I("right", "right")}</a>` : ""}
        <div class="stack stagger">${r.items.length ? r.items.map((n) => html`<button class="notif ${n.read ? "" : "unread"}" data-n="${n.id}" data-href="${n.code ? "/" + (n.kind === "bug" ? "bugs" : "ideas") + "/" + n.code : n.type === "news" ? "/updates" : ""}"><span class="ni">${I(ic[n.type] || "bell")}</span><span style="flex:1;min-width:0"><span class="tx">${n.text}</span><small class="faint" style="display:block;margin-top:4px">${rel(n.created)}${n.code ? " · " + n.code : ""}</small></span>${n.read ? "" : raw('<span class="dot"></span>')}</button>`) : empty("bell", "Уведомлений нет", "Здесь появятся изменения статусов ваших обращений и ответы команды.")}</div>`);
      $("#ra", view) && ($("#ra", view).onclick = async () => { await POST("/notifications/read", {}); updateUnread(0); load(); });
      $$("[data-n]", view).forEach((b) => (b.onclick = async () => {
        POST("/notifications/read", { ids: [Number(b.dataset.n)] }).then(() => pulse()).catch(() => {});
        if (b.dataset.href) navigate(b.dataset.href); else { b.classList.remove("unread"); }
      }));
    };
    await load(); S.refresh = load;
  });

  // ---------------------------------------------------------------- profile
  // ---------------------------------------------------------------- app linking
  route(/^\/link$/, async (m, view) => {
    const initial = (new URLSearchParams(location.search).get("code") || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
    const draw = (code = initial) => {
      set(view, html`<div class="wiz"><div class="page-head"><div class="grow"><h1>Подключение приложения</h1><p>Введите код, который показывает приложение QVK, чтобы оно могло отправлять обращения от вашего имени.</p></div></div>
        <form class="card pad-l stack" id="lf"><label class="f">Код из приложения<input name="code" class="mono" maxlength="9" autocomplete="off" autocapitalize="characters" placeholder="ABCD-EFGH" value="${code ? code.slice(0, 4) + (code.length > 4 ? "-" + code.slice(4) : "") : ""}" style="font-size:22px;letter-spacing:3px;text-align:center"></label><button class="btn primary lg block">${I("right")}Продолжить</button></form></div>`);
      $("#lf", view).onsubmit = async (e) => {
        e.preventDefault();
        const c = e.target.code.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
        if (c.length !== 8) return toast("Код состоит из 8 символов", "err");
        try {
          const r = await GET("/app-links/" + c);
          set(view, html`<div class="wiz"><div class="page-head"><div class="grow"><h1>Подключить приложение?</h1></div></div>
            <div class="card pad-l stack"><div class="row" style="gap:14px"><span class="di" style="width:48px;height:48px;border-radius:14px;background:var(--surface2);display:grid;place-items:center;color:var(--accent)">${I("phone", "l")}</span><div><b style="font-size:17px">${r.device_name}</b><div class="muted mono">Код ${r.code}</div></div></div>
            <p class="muted" style="margin:0">Приложение сможет от имени <b>${S.me.user.name}</b> создавать обращения, комментировать, подтверждать «у меня тоже» и видеть ваши обращения. Отключить его можно в профиле в любой момент.</p>
            <div class="row"><button class="btn block" id="ld">Отмена</button><button class="btn primary block" id="lc">${I("check")}Подключить</button></div></div></div>`);
          $("#lc", view).onclick = async () => { try { await POST("/app-links/" + c + "/confirm"); toast("Приложение подключено"); set(view, html`<div class="success fade-in"><div class="big">${I("check")}</div><div class="code" style="font-size:26px">Готово</div><p class="muted">Вернитесь в приложение QVK — оно подключится автоматически.</p><a class="btn mt2" href="/profile">Перейти в профиль</a></div>`); } catch (err) { fail(err); } };
          $("#ld", view).onclick = async () => { try { await POST("/app-links/" + c + "/deny"); toast("Подключение отменено"); navigate("/"); } catch (err) { fail(err); } };
        } catch (err) { fail(err); }
      };
    };
    draw();
    if (initial.length === 8) $("#lf", view).requestSubmit();
  });

  // ---------------------------------------------------------------- web push
  const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const b64ToBytes = (s) => { s = s.replace(/-/g, "+").replace(/_/g, "/"); return Uint8Array.from(atob(s + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0)); };
  async function currentPushSub() {
    if (!pushSupported()) return null;
    const reg = await navigator.serviceWorker.getRegistration("/");
    return reg ? reg.pushManager.getSubscription() : null;
  }
  async function enablePush() {
    const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    const perm = await Notification.requestPermission();
    if (perm !== "granted") throw new Error(perm === "denied" ? "Уведомления запрещены в настройках браузера для этого сайта" : "Разрешение не получено");
    const { publicKey } = await GET("/push/key");
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
    await POST("/push/subscribe", sub.toJSON());
  }
  async function disablePush() {
    const sub = await currentPushSub();
    if (sub) { await POST("/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe().catch(() => {}); }
  }
  /** Keeps an existing browser subscription bound to the signed-in account. */
  async function syncPush() {
    try { const sub = await currentPushSub(); if (sub && Notification.permission === "granted") await POST("/push/subscribe", sub.toJSON()); } catch { /* ignore */ }
  }
  async function drawPush(view) {
    const st = $("#push-st", view), btn = $("#push-btn", view);
    if (!st) return;
    if (!pushSupported()) {
      st.textContent = isIOS() && !isStandalone() ? "На iPhone: «Поделиться» → «На экран „Домой“», откройте портал с иконки и включите здесь." : "Этот браузер не поддерживает пуш-уведомления.";
      set(btn, "");
      return;
    }
    const sub = await currentPushSub().catch(() => null);
    const on = !!sub && Notification.permission === "granted";
    st.textContent = on ? "Включены в этом браузере. Приходят новости и изменения ваших обращений." : Notification.permission === "denied" ? "Запрещены в настройках браузера — разрешите уведомления для сайта." : "Выключены. Включите, чтобы получать уведомления даже при закрытой вкладке.";
    set(btn, on ? html`<button class="btn sm" data-push="off">Выключить</button>` : html`<button class="btn primary sm" data-push="on">${I("bell", "s")}Включить</button>`);
    $("[data-push]", btn).onclick = async (e) => {
      e.target.disabled = true;
      try {
        if (e.target.dataset.push === "on") { await enablePush(); toast("Пуш-уведомления включены"); } else { await disablePush(); toast("Пуш-уведомления выключены"); }
      } catch (err) { fail(err); }
      drawPush(view);
    };
  }

  async function drawApps(view) {
    const box = $("#apps-list", view);
    if (!box) return;
    let r;
    try { r = await GET("/app-tokens"); } catch { return; }
    set(box, r.items.map((k) => html`<div class="row" style="gap:10px;padding:8px 12px;border-radius:12px;background:var(--surface)"><span style="flex:1;min-width:0"><b class="ell" style="display:block">${k.name}</b><small class="faint">подключено ${fmtDate(k.created)} · активность ${rel(k.last_used)}</small></span><button class="btn sm danger" data-revoke="${k.id}">Отключить</button></div>`));
    $$("[data-revoke]", box).forEach((b) => (b.onclick = async () => {
      if (!(await confirmSheet("Отключить приложение?", "Приложение потеряет доступ к аккаунту. Чтобы снова пользоваться им, подключите его по новому коду.", "Отключить", true))) return;
      try { await api("DELETE", "/app-tokens/" + b.dataset.revoke); toast("Приложение отключено"); drawApps(view); } catch (err) { fail(err); }
    }));
  }

  route(/^\/profile$/, async (m, view) => {
    const draw = () => {
      const me = S.me, u = me.user;
      set(view, html`
        <div class="page-head"><div class="grow"><h1>Профиль</h1><p>Ваши устройства и настройки</p></div></div>
        <div class="card pad-l row" style="gap:16px">${avatar(u.name)}<div style="min-width:0"><b style="font-size:18px">${u.name}</b><div class="muted" style="font-size:14px">${u.username ? "@" + u.username + " · " : ""}${me.is_admin ? "Администратор" : "Тестировщик"} · с ${fmtDate(u.created)}</div></div></div>
        <h2 class="sec">${I("phone", "s")}Устройства<button class="btn sm right" id="add-dev" style="text-transform:none;letter-spacing:0">${I("plus", "s")}Добавить</button></h2>
        <div class="devpick">${me.devices.length ? me.devices.map((d) => html`<div class="dev ${d.id === u.active_device ? "on" : ""}"><span class="di">${I("phone")}</span><span style="flex:1;min-width:0"><b>${d.model}</b><small>Android ${d.android} · QVK ${d.app_version}${d.firmware ? " · " + d.firmware : ""}</small>${d.id === u.active_device ? html`<small style="display:block;color:var(--accent)">Используется по умолчанию</small>` : ""}</span>
          <span class="row" style="gap:4px">${d.id !== u.active_device ? html`<button class="btn sm" data-act="${d.id}">Основное</button>` : ""}<button class="btn sm icon" data-edd="${d.id}" aria-label="Изменить">${I("edit", "s")}</button><button class="btn sm icon" data-deld="${d.id}" aria-label="Удалить">${I("trash", "s")}</button></span></div>`) : empty("phone", "Нет устройств", "Добавьте устройство, чтобы отправлять баг-репорты.")}</div>
        <h2 class="sec">${I("settings", "s")}Настройки</h2>
        <div class="card">
          <div class="row wrap" style="padding:10px 0;gap:12px"><span class="di" style="width:40px;height:40px;border-radius:12px;background:var(--surface2);display:grid;place-items:center;color:var(--accent)">${I("telegram")}</span><span style="flex:1;min-width:180px"><b>Telegram</b><small class="muted" style="display:block;font-size:13px">${u.tg_linked ? (u.tg_blocked ? "Привязан, но бот не может вам написать — откройте бота и нажмите «Запустить»." : "Привязан" + (u.username ? " · @" + u.username : "") + ". Уведомления приходят в личные сообщения бота.") : "Не привязан. Подключите, чтобы получать уведомления в Telegram."}</small></span>
            ${u.tg_linked ? html`<button class="btn sm" id="tgun">Отвязать</button>` : html`<button class="btn primary sm" id="tglink">${I("telegram", "s")}Подключить</button>`}</div>
          ${u.tg_linked ? html`<label class="switch"><input type="checkbox" id="ntg" ${u.notify_tg ? "checked" : ""}><span class="t">Уведомления в Telegram<small>Бот пришлёт сообщение, когда статус ваших обращений изменится</small></span></label>` : ""}
          <label class="switch"><input type="checkbox" id="nnews" ${u.notify_news !== false ? "checked" : ""}><span class="t">Новости и списки изменений<small>Присылать объявления команды в Telegram и пуш-уведомлениями</small></span></label>
          <div class="hr" style="margin:6px 0"></div>
          <div class="row wrap" style="padding:10px 0;gap:12px" id="push-row"><span class="di" style="width:40px;height:40px;border-radius:12px;background:var(--surface2);display:grid;place-items:center;color:var(--accent)">${I("bell")}</span><span style="flex:1;min-width:180px"><b>Пуш-уведомления в браузере</b><small class="muted" style="display:block;font-size:13px" id="push-st">Проверяем…</small></span><span id="push-btn"></span></div>
          <div class="hr" style="margin:6px 0"></div>
          <div style="padding:10px 0" id="apps-row"><div class="row wrap" style="gap:12px"><span class="di" style="width:40px;height:40px;border-radius:12px;background:var(--surface2);display:grid;place-items:center;color:var(--accent)">${I("phone")}</span><span style="flex:1;min-width:180px"><b>Приложение QVK</b><small class="muted" style="display:block;font-size:13px">Отправляйте обращения прямо из приложения. Подключение — по коду, без пароля.</small></span><a class="btn sm" href="/link">${I("key", "s")}Ввести код</a></div><div id="apps-list" class="stack" style="margin-top:10px"></div></div>
          <div class="hr" style="margin:6px 0"></div>
          <div class="row between wrap" style="padding:8px 0"><span><b>Пароль</b><small class="muted" style="display:block;font-size:13px">Вход: ник <b>${u.nick || u.name}</b> и пароль</small></span><button class="btn sm" id="pwd">${I("key", "s")}Сменить пароль</button></div>
          <div class="hr" style="margin:6px 0"></div>
          <div class="row between wrap" style="padding:8px 0"><span><b>Тема оформления</b></span><div class="seg" id="theme"><button data-th="dark">${I("moon", "s")}Тёмная</button><button data-th="light">${I("sun", "s")}Светлая</button><button data-th="system">Авто</button></div></div>
        </div>
        <div class="row wrap mt2"><button class="btn" id="logout">${I("logout")}Выйти</button><button class="btn danger" id="delp">${I("trash")}Удалить профиль</button></div>
        <p class="faint" style="font-size:13px">Удаление профиля стирает устройства, черновики, избранное и уведомления. Ваши отчёты останутся в системе без имени автора.</p>`);
      $$("#theme button", view).forEach((b) => { b.classList.toggle("on", b.dataset.th === S.theme); b.onclick = () => { S.theme = b.dataset.th; localStorage.setItem("qvk_theme", S.theme); applyTheme(); draw(); }; });
      $("#add-dev", view).onclick = () => devSheet(null);
      $$("[data-edd]", view).forEach((b) => (b.onclick = () => devSheet(me.devices.find((d) => String(d.id) === b.dataset.edd))));
      $$("[data-deld]", view).forEach((b) => (b.onclick = async () => { if (!(await confirmSheet("Удалить устройство?", "Ранее отправленные отчёты сохранят данные устройства.", "Удалить", true))) return; try { await api("DELETE", "/devices/" + b.dataset.deld); await reloadMe(); toast("Устройство удалено"); draw(); } catch (err) { fail(err); } }));
      $$("[data-act]", view).forEach((b) => (b.onclick = async () => { try { await api("PATCH", "/me", { active_device: Number(b.dataset.act) }); await reloadMe(); toast("Основное устройство изменено"); draw(); } catch (err) { fail(err); } }));
      if ($("#tglink", view)) $("#tglink", view).onclick = async () => {
        try {
          const r = await POST("/tg/link");
          sheet("Подключение Telegram", (b, close) => {
            set(b, html`<p class="muted" style="margin-top:0">Откройте бота <b>@${r.bot}</b>, нажмите <b>«Запустить»</b>, затем <b>«Привязать»</b>. Ссылка действует 15 минут.</p><a class="btn primary lg block" href="${r.link}" target="_blank" rel="noopener">${I("telegram")}Открыть @${r.bot}</a><button class="btn block mt" id="tgdone">Готово, я подтвердил</button>`);
            $("#tgdone", b).onclick = async () => { await reloadMe(); close(); toast(S.me.user.tg_linked ? "Telegram привязан" : "Привязка ещё не подтверждена", S.me.user.tg_linked ? "ok" : "err"); renderShell(); markNav(); run(); };
          });
        } catch (err) { fail(err); }
      };
      if ($("#tgun", view)) $("#tgun", view).onclick = async () => { if (!(await confirmSheet("Отвязать Telegram?", "Уведомления в Telegram перестанут приходить." + (me.is_admin ? " Вы потеряете доступ к админ-панели." : ""), "Отвязать", true))) return; try { await POST("/tg/unlink"); await reloadMe(); toast("Telegram отвязан"); renderShell(); markNav(); run(); } catch (err) { fail(err); } };
      $("#pwd", view).onclick = () => sheet("Смена пароля", (b, close) => {
        set(b, html`<form class="stack" id="pf"><label class="f">Текущий пароль<input type="password" name="current" autocomplete="current-password"></label><label class="f">Новый пароль <small>не короче 8 символов</small><input type="password" name="password" autocomplete="new-password"></label><label class="f">Повторите новый пароль<input type="password" name="password2" autocomplete="new-password"></label><button class="btn primary block">${I("check")}Сохранить</button><p class="faint" style="font-size:13px;margin:0">После смены пароля другие устройства выйдут из аккаунта.</p></form>`);
        $("#pf", b).onsubmit = async (e) => {
          e.preventDefault();
          const f = e.target;
          if (f.password.value !== f.password2.value) return toast("Пароли не совпадают", "err");
          try { await POST("/me/password", { current: f.current.value, password: f.password.value }); close(); toast("Пароль изменён"); } catch (err) { fail(err); }
        };
      });
      $("#nnews", view).onchange = async (e) => { try { await api("PATCH", "/me", { notify_news: e.target.checked }); await reloadMe(); toast(e.target.checked ? "Новости включены" : "Новости выключены"); } catch (err) { fail(err); } };
      drawPush(view);
      drawApps(view);
      if ($("#ntg", view)) $("#ntg", view).onchange = async (e) => { try { await api("PATCH", "/me", { notify_tg: e.target.checked }); await reloadMe(); toast(e.target.checked ? "Уведомления включены" : "Уведомления выключены"); draw(); } catch (err) { fail(err); } };
      $("#logout", view).onclick = async () => { await disablePush().catch(() => {}); await POST("/auth/logout").catch(() => {}); location.href = "/"; };
      $("#delp", view).onclick = async () => { if (!(await confirmSheet("Удалить профиль?", "Устройства, черновики, избранное и уведомления будут удалены безвозвратно. Отчёты останутся без имени автора.", "Удалить профиль", true))) return; try { await api("DELETE", "/me"); location.href = "/"; } catch (err) { fail(err); } };
    };
    const devSheet = (d) => sheet(d ? "Изменить устройство" : "Новое устройство", (b, close) => {
      set(b, html`<form id="dvf">${deviceForm(d || {})}${d ? "" : html`<label class="switch"><input type="checkbox" name="make_active" checked><span class="t">Сделать основным</span></label>`}<button class="btn primary block mt">${I("check")}Сохранить</button></form>`);
      $("#dvf", b).onsubmit = async (e) => { e.preventDefault(); try { d ? await api("PUT", "/devices/" + d.id, readForm(e.target)) : await POST("/devices", readForm(e.target)); await reloadMe(); close(); toast("Устройство сохранено"); draw(); } catch (err) { fail(err); } };
    });
    await reloadMe();
    draw();
  });

  // ================================================================ ADMIN
  route(/^\/admin(?:\/(bugs|ideas|testers|settings))?$/, async (m, view, alive) => {
    if (!S.me.is_admin) { set(view, empty("shield", "Доступ запрещён", "Эта страница доступна только администрации.")); return; }
    const tab = m[1] || "overview";
    const tabs = html`<div class="seg mb" style="margin-bottom:16px">${[["", "Обзор", "chart"], ["bugs", "Баги", "bug"], ["ideas", "Предложения", "bulb"], ["testers", "Тестировщики", "users"], ["settings", "Настройки", "settings"]].map(([k, l, ic]) => html`<a href="/admin${k ? "/" + k : ""}" class="${(k || "overview") === tab ? "on" : ""}">${I(ic, "s")}${l}</a>`)}</div>`;
    const head = (title, sub, extra = "") => html`<div class="page-head"><div class="grow"><h1>${title}</h1><p>${sub}</p></div>${extra}</div>${tabs}`;
    if (tab === "overview") return adminOverview(view, head, alive);
    if (tab === "bugs" || tab === "ideas") return adminList(view, head, tab === "bugs" ? "bug" : "idea");
    if (tab === "testers") return adminTesters(view, head);
    return adminSettingsPage(view, head);
  });

  async function adminOverview(view, head, alive) {
    set(view, html`${head("Панель управления", "Сводка бета-тестирования")}<div class="grid g4">${Array.from({ length: 8 }, () => html`<div class="sk card"></div>`)}</div>`);
    const load = async () => {
      const s = await GET("/admin/stats");
      if (!alive()) return;
      const maxDay = Math.max(1, ...s.daily.map((d) => d.bugs + d.ideas + d.comments));
      const wd = (d) => new Date(d * 1000).toLocaleDateString("ru-RU", { day: "numeric" });
      const prioMap = Object.fromEntries(s.bugs.open_by_priority.map((p) => [p.priority, p.n]));
      const openTotal = Math.max(1, s.bugs.open_by_priority.reduce((a, p) => a + p.n, 0));
      set(view, html`${head("Панель управления", "Сводка бета-тестирования", html`<div class="row wrap"><a class="btn sm" href="/api/p/admin/export?format=csv" download>${I("download", "s")}CSV</a><a class="btn sm" href="/api/p/admin/export?format=json" download>${I("download", "s")}JSON</a></div>`)}
        <div class="grid g4 stagger">
          <a class="stat" href="/admin/bugs" style="--c:var(--accent)"><div class="l"><i></i>Всего багов</div><div class="v">${s.bugs.total}</div></a>
          <a class="stat" href="/admin/bugs?status=new" style="--c:#ff5d73"><div class="l"><i></i>Новые</div><div class="v">${s.bugs.new}</div></a>
          <a class="stat" href="/admin/bugs?status=confirmed,in_progress" style="--c:#f7c948"><div class="l"><i></i>В работе</div><div class="v">${s.bugs.in_work}</div></a>
          <a class="stat" href="/admin/bugs?status=fixed,closed" style="--c:#3ddc97"><div class="l"><i></i>Исправлено</div><div class="v">${s.bugs.fixed}</div></a>
          <a class="stat" href="/admin/bugs?status=verify" style="--c:#4cc9f0"><div class="l"><i></i>Ждут перепроверки</div><div class="v">${s.bugs.verify}</div></a>
          <a class="stat" href="/admin/bugs?status=need_info" style="--c:#c9c4d9"><div class="l"><i></i>Нужны данные</div><div class="v">${s.bugs.need_info}</div></a>
          <a class="stat" href="/admin/ideas" style="--c:#b794ff"><div class="l"><i></i>Предложений</div><div class="v">${s.ideas.total}</div></a>
          <a class="stat" href="/admin/testers" style="--c:#ff9f43"><div class="l"><i></i>Тестировщиков</div><div class="v">${s.users.total}</div><small class="muted">${s.users.active7} активны за 7 дн.</small></a>
        </div>
        <div class="grid g2 m1 mt2" style="align-items:start">
          <div class="card"><h2 class="sec" style="margin-top:0">${I("chart", "s")}Активность за 14 дней</h2>
            <div class="bars">${s.daily.map((d) => html`<div class="b" title="${fmtDate(d.d)}: ${d.bugs} баг., ${d.ideas} ид., ${d.comments} комм.">
              <span style="height:${(d.comments / maxDay) * 100}%;background:rgba(155,109,255,.35)"></span><span style="height:${(d.ideas / maxDay) * 100}%;background:#4cc9f0"></span><span style="height:${(d.bugs / maxDay) * 100}%;background:var(--accent2)"></span><em>${wd(d.d)}</em></div>`)}</div>
            <div class="legend"><span><i style="background:var(--accent2)"></i>Баги</span><span><i style="background:#4cc9f0"></i>Идеи</span><span><i style="background:rgba(155,109,255,.35)"></i>Комментарии</span></div></div>
          <div class="card"><h2 class="sec" style="margin-top:0">${I("zap", "s")}Открытые баги по приоритету</h2>
            <div class="stack">${M().priorities.slice().reverse().map((p) => html`<a href="/admin/bugs?priority=${p.id}&status=open" style="color:var(--text)"><div class="row between" style="font-size:14px;margin-bottom:6px"><span>${p.label}</span><b>${prioMap[p.id] || 0}</b></div><div class="pbar" style="--c:${p.color}"><i style="width:${((prioMap[p.id] || 0) / openTotal) * 100}%"></i></div></a>`)}</div></div>
        </div>
        <div class="grid g2 m1" style="align-items:start">
          <div><h2 class="sec">${I("sparkles", "s")}Популярные предложения<a href="/admin/ideas?sort=votes">Все</a></h2>
            <div class="card">${s.top_ideas.length ? html`<table class="table"><tbody>${s.top_ideas.map((t) => html`<tr><td><a class="mono" href="/ideas/${t.code}">${t.code}</a></td><td>${t.title}<div class="mt" style="margin-top:4px">${badge("idea", t.status)}</div></td><td class="nowrap"><b>${t.votes}</b> ${I("up", "s")}</td></tr>`)}</tbody></table>` : html`<p class="faint" style="margin:0">Пока нет предложений.</p>`}</div></div>
          <div><h2 class="sec">${I("users", "s")}Активность тестировщиков · 30 дней<a href="/admin/testers">Все</a></h2>
            <div class="card scroll-x">${s.testers.length ? html`<table class="table"><thead><tr><th>Тестировщик</th><th>Обращ.</th><th>Комм.</th><th>Был</th></tr></thead><tbody>${s.testers.map((u) => html`<tr><td><a href="/admin/bugs?author=${u.id}" style="color:var(--text)"><b>${u.name}</b></a>${u.username ? html`<div class="faint" style="font-size:12px">@${u.username}</div>` : ""}</td><td>${u.tickets}</td><td>${u.comments}</td><td class="faint nowrap">${rel(u.last_seen)}</td></tr>`)}</tbody></table>` : html`<p class="faint" style="margin:0">Пока нет тестировщиков.</p>`}</div></div>
        </div>`);
    };
    await load();
    S.refresh = load;
  }

  async function adminList(view, head, kind) {
    const qs = new URLSearchParams(location.search);
    const st = Object.fromEntries(FILTER_KEYS.map((k) => [k, qs.get(k) || ""]));
    if (!st.sort) st.sort = "new";
    const selected = new Set();
    set(view, html`${head(kind === "bug" ? "Управление багами" : "Управление предложениями", "Меняйте статусы прямо в списке. Отметьте несколько карточек для массовых действий.", html`<div class="row wrap"><a class="btn sm" href="/api/p/admin/export?kind=${kind}&format=csv" download>${I("download", "s")}CSV</a><a class="btn sm" href="/api/p/admin/export?kind=${kind}&format=json" download>${I("download", "s")}JSON</a></div>`)}
      <div class="toolbar">
        <form class="search" id="sf">${I("search")}<input type="search" name="q" placeholder="Номер, название, текст" value="${st.q}" enterkeyhint="search"></form>
        <button class="btn" id="fb">${I("filter")}<span>Фильтры</span><span class="count" id="fc" hidden></span></button>
        <label class="btn" style="gap:8px"><input type="checkbox" class="check" id="selall">Все</label>
      </div>
      <div id="chips"></div><div id="list"></div><div id="bulk"></div>`);
    const card = (t) => html`<div class="acard ${selected.has(t.code) ? "sel" : ""}" data-card="${t.code}">
      <input type="checkbox" class="check" data-sel="${t.code}" ${selected.has(t.code) ? "checked" : ""} aria-label="Выбрать ${t.code}" style="margin-top:2px">
      <div style="min-width:0">
        <div class="row wrap" style="gap:8px"><a class="mono" href="${pathOf(t)}" style="font-weight:800;font-size:13px">${t.code}</a>${badge(t.kind, t.status)}${t.pinned ? I("pin", "s") : ""}${t.hidden ? I("eyeoff", "s") : ""}<span class="faint right" style="font-size:12px">${rel(t.created)}</span></div>
        <a class="ttl" href="${pathOf(t)}">${t.title}</a>
        <div class="tcard" style="padding:0;border:0;background:none"><div class="meta">
          <span>${I("user", "s")}${t.author.name}</span>
          ${t.device.model ? html`<span>${I("phone", "s")}${t.device.model} · A${t.device.android}</span>` : ""}
          ${t.device.app_version ? html`<span class="mono">v${t.device.app_version}</span>` : ""}
          <span>${I(catOf(t.category).icon, "s")}${catOf(t.category).label}</span>
          ${kind === "bug" ? html`<span>${I("users", "s")}${t.confirms}</span>` : html`<span>${I("up", "s")}${t.votes}</span>`}
          <span>${I("message", "s")}${t.comments}</span>
        </div></div>
        <div class="ctl">
          <select class="sm" data-status="${t.code}" aria-label="Статус">${statusOptions(kind, t.status)}</select>
          <select class="sm" data-prio="${t.code}" aria-label="Приоритет">${prioOptions(t.priority)}</select>
          <button class="btn sm icon ${t.pinned ? "on" : ""}" data-pin="${t.code}" title="${t.pinned ? "Открепить" : "Закрепить"}" aria-label="Закрепить">${I("pin", "s")}</button>
        </div>
      </div></div>`;
    const list = ticketList($("#list", view), () => { const q = new URLSearchParams({ kind, pinfirst: "0" }); for (const k of FILTER_KEYS) if (st[k]) q.set(k, st[k]); return q; }, card, empty("check", "Обращений нет", "По выбранным фильтрам ничего не найдено."));
    const listEl = $("#list", view);
    const quick = async (code, patch) => {
      try { await POST(`/tickets/${code}/admin`, patch); toast(`${code}: сохранено`); await list.refresh(); } catch (err) { fail(err); await list.refresh(); }
    };
    listEl.addEventListener("change", async (e) => {
      const s = e.target.closest("[data-status]");
      const p = e.target.closest("[data-prio]");
      const c = e.target.closest("[data-sel]");
      if (c) { c.checked ? selected.add(c.dataset.sel) : selected.delete(c.dataset.sel); c.closest(".acard").classList.toggle("sel", c.checked); drawBulk(); return; }
      if (p) return quick(p.dataset.prio, { priority: p.value });
      if (s) {
        const status = s.value;
        if (["rejected", "postponed", "need_info", "cannot_reproduce"].includes(status) || status === "fixed" || status === "verify") {
          return sheet(statusOf(kind, status).label, (b, close) => {
            set(b, html`<form class="stack" id="qs"><p class="muted" style="margin:0">${s.dataset.status} → ${statusOf(kind, status).label}</p>
              ${status === "fixed" || status === "verify" ? html`<label class="f">Версия исправления<input name="fixed_version" value="${S.me.settings.current_version}"></label>` : ""}
              <label class="f">${["rejected", "postponed"].includes(status) ? "Причина" : "Пояснение для автора"} <small>необязательно</small><textarea name="note" rows="3"></textarea></label>
              <button class="btn primary block">${I("check")}Сохранить</button></form>`);
            $("#qs", b).onsubmit = (ev) => { ev.preventDefault(); close(); quick(s.dataset.status, { status, ...readForm(ev.target) }); };
            const obs = new MutationObserver(() => { if (!document.body.contains(b)) { obs.disconnect(); list.refresh(); } });
            obs.observe(document.body, { childList: true });
          });
        }
        return quick(s.dataset.status, { status });
      }
    });
    listEl.addEventListener("click", (e) => { const b = e.target.closest("[data-pin]"); if (b) quick(b.dataset.pin, { pinned: !b.classList.contains("on") }); });
    const drawBulk = () => {
      const box = $("#bulk", view);
      if (!selected.size) { set(box, ""); return; }
      set(box, html`<div class="bulkbar"><b style="padding:0 6px">${selected.size} выбрано</b>
        <select class="sm" id="bs"><option value="">Статус…</option>${statusOptions(kind, "")}</select>
        <select class="sm" id="bp"><option value="">Приоритет…</option>${prioOptions("")}</select>
        <select class="sm" id="bf"><option value="">Ещё…</option><option value="pin">Закрепить</option><option value="unpin">Открепить</option><option value="hide">Скрыть</option><option value="show">Показать</option></select>
        <button class="btn primary sm" id="bapply">${I("check", "s")}Применить</button><button class="btn ghost sm icon" id="bclear" aria-label="Снять выделение">${I("x", "s")}</button></div>`);
      $("#bclear", box).onclick = () => { selected.clear(); $("#selall", view).checked = false; list.draw(); drawBulk(); };
      $("#bapply", box).onclick = async () => {
        const patch = {};
        if ($("#bs", box).value) patch.status = $("#bs", box).value;
        if ($("#bp", box).value) patch.priority = $("#bp", box).value;
        const f = $("#bf", box).value;
        if (f === "pin" || f === "unpin") patch.pinned = f === "pin";
        if (f === "hide" || f === "show") patch.hidden = f === "hide";
        if (!Object.keys(patch).length) return toast("Выберите действие", "err");
        if (!(await confirmSheet("Массовое действие", `Применить изменения к ${selected.size} ${plural(selected.size, ["обращению", "обращениям", "обращениям"])}? Авторы получат уведомления о смене статуса.`, "Применить"))) return;
        try {
          const r = await POST("/admin/bulk", { codes: [...selected], ...patch });
          const bad = r.results.filter((x) => !x.ok).length;
          toast(bad ? `Готово, с ошибками: ${bad}` : "Изменения применены", bad ? "err" : "ok");
          selected.clear(); $("#selall", view).checked = false; drawBulk(); await list.refresh();
        } catch (err) { fail(err); }
      };
    };
    const apply = async () => {
      set($("#chips", view), filterChips(st, kind));
      $$("#chips [data-st]", view).forEach((b) => (b.onclick = () => {
        const cur = new Set(st.status.split(",").filter(Boolean));
        if (!b.dataset.st) cur.clear(); else cur.has(b.dataset.st) ? cur.delete(b.dataset.st) : cur.add(b.dataset.st);
        st.status = [...cur].join(","); apply();
      }));
      const n = activeFilters(st); const fc = $("#fc", view); fc.hidden = !n; fc.textContent = n;
      syncUrl(st);
      selected.clear(); drawBulk();
      await list.load();
    };
    $("#selall", view).onchange = (e) => { selected.clear(); if (e.target.checked) list.items.forEach((t) => selected.add(t.code)); list.draw(); drawBulk(); };
    $("#sf", view).onsubmit = (e) => { e.preventDefault(); st.q = e.target.q.value.trim(); apply(); $("input", e.target).blur(); };
    $("#sf input", view).addEventListener("search", (e) => { if (!e.target.value && st.q) { st.q = ""; apply(); } });
    $("#fb", view).onclick = () => filterSheet(st, kind, apply, true);
    await apply();
    S.refresh = async () => { if (selected.size) return; await list.refresh(); };
  }

  async function adminTesters(view, head) {
    set(view, html`${head("Тестировщики", "Участники бета-тестирования")}${skList(4)}`);
    const load = async () => {
      const r = await GET("/admin/users");
      set(view, html`${head("Тестировщики", `${r.items.length} ${plural(r.items.length, ["участник", "участника", "участников"])}`)}
        <div class="stack">${r.items.map((u) => html`<div class="card row wrap" style="gap:14px">${avatar(u.name, u.is_admin)}<div style="flex:1;min-width:200px"><b>${u.name}</b>${u.is_admin ? html` <span class="role">Админ</span>` : ""}${u.banned ? html` <span class="role" style="color:var(--bad)">Заблокирован</span>` : ""}
          <div class="muted" style="font-size:13px">${u.username ? html`<a href="https://t.me/${u.username}" target="_blank" rel="noopener">@${u.username}</a> · ` : ""}${u.tg_linked ? "Telegram привязан · " : ""}был ${rel(u.last_seen)}</div>
          ${u.device ? html`<div class="faint" style="font-size:13px">${I("phone", "s")} ${u.device}</div>` : ""}</div>
          <div class="row wrap" style="gap:6px"><a class="chip" href="/admin/bugs?author=${u.id}">${I("bug", "s")}${u.bugs}</a><a class="chip" href="/admin/ideas?author=${u.id}">${I("bulb", "s")}${u.ideas}</a><span class="chip">${I("message", "s")}${u.comments}</span>
          <button class="btn sm" data-pw="${u.id}" data-nick="${u.name}">${I("key", "s")}Пароль</button>${u.is_admin ? "" : html`<button class="btn sm ${u.banned ? "" : "danger"}" data-ban="${u.id}" data-to="${u.banned ? "0" : "1"}">${u.banned ? "Разблокировать" : "Заблокировать"}</button>`}</div></div>`)}</div>`);
      $$("[data-pw]", view).forEach((b) => (b.onclick = () => sheet("Временный пароль · " + b.dataset.nick, (box, close) => {
        const gen = Array.from(crypto.getRandomValues(new Uint8Array(10)), (x) => "abcdefghjkmnpqrstuvwxyz23456789"[x % 31]).join("");
        set(box, html`<form class="stack" id="rpf"><p class="muted" style="margin:0">Тестировщик выйдет на всех устройствах. Передайте ему новый пароль — он сможет сменить его в профиле.</p><label class="f">Новый пароль<input name="password" class="mono" value="${gen}"></label><button class="btn primary block">${I("check")}Установить</button></form>`);
        $("#rpf", box).onsubmit = async (e) => { e.preventDefault(); try { await POST("/admin/users/" + b.dataset.pw, { password: e.target.password.value }); close(); toast("Пароль установлен"); } catch (err) { fail(err); } };
      })));
      $$("[data-ban]", view).forEach((b) => (b.onclick = async () => {
        const ban = b.dataset.to === "1";
        if (ban && !(await confirmSheet("Заблокировать тестировщика?", "Пользователь потеряет доступ к порталу. Его обращения сохранятся.", "Заблокировать", true))) return;
        try { await POST("/admin/users/" + b.dataset.ban, { banned: ban }); toast(ban ? "Доступ закрыт" : "Доступ восстановлен"); load(); } catch (err) { fail(err); }
      }));
    };
    await load();
  }

  async function adminSettingsPage(view, head) {
    await reloadMe();
    const s = S.me.settings;
    set(view, html`${head("Настройки", "Параметры портала")}
      <div class="grid g2 m1" style="align-items:start">
        <div class="card pad-l"><h2 class="sec" style="margin-top:0">${I("zap", "s")}Тестируемая версия</h2>
          <form class="row" id="vf"><input name="current_version" value="${s.current_version}" maxlength="32" class="mono"><button class="btn primary">${I("check")}Сохранить</button></form>
          <p class="faint" style="font-size:13px">Версия показывается на главной, подставляется в новые устройства и используется по умолчанию при отметке «Исправлено».</p>
          <h2 class="sec">${I("megaphone", "s")}Приветствие на главной</h2>
          <form id="wf"><textarea name="welcome" rows="3" maxlength="600">${s.welcome}</textarea><button class="btn mt">${I("check")}Сохранить текст</button></form>
          <a class="btn block mt2" href="/updates">${I("megaphone")}Управление объявлениями и изменениями</a></div>
        <div class="card pad-l"><h2 class="sec" style="margin-top:0">${I("settings", "s")}Параметры</h2>
          <label class="switch"><input type="checkbox" data-set="comments_public" ${s.comments_public ? "checked" : ""}><span class="t">Комментарии от всех тестировщиков<small>Если выключено — обсуждать обращение могут только автор и команда</small></span></label>
          <label class="switch"><input type="checkbox" data-set="notify_admins" ${s.notify_admins ? "checked" : ""}><span class="t">Уведомлять администраторов в Telegram<small>О новых обращениях, ответах авторов и результатах перепроверки</small></span></label>
          <div class="hr"></div>
          <h2 class="sec" style="margin-top:0">${I("download", "s")}Выгрузка данных</h2>
          <div class="row wrap"><a class="btn sm" href="/api/p/admin/export?format=csv" download>Всё · CSV</a><a class="btn sm" href="/api/p/admin/export?format=json" download>Всё · JSON</a><a class="btn sm" href="/api/p/admin/export?kind=bug&format=csv" download>Баги · CSV</a><a class="btn sm" href="/api/p/admin/export?kind=idea&format=csv" download>Идеи · CSV</a></div>
          <div class="hr"></div>
          <p class="faint" style="font-size:13px;margin:0">Ссылка для тестировщиков: <a href="/" class="mono">${location.origin}/</a><br>Администратор — аккаунт, к которому в профиле привязан Telegram из переменной ADMIN_IDS на сервере. Ник сам по себе прав не даёт.</p>
        </div>
      </div>
      <div class="card pad-l mt2" id="mcp-card"><div class="sk line" style="width:40%"></div></div>`);
    const drawMcp = async () => {
      const box = $("#mcp-card", view);
      let st;
      try { st = await GET("/admin/mcp"); } catch (err) { set(box, html`<p class="field-err">${err.message}</p>`); return; }
      set(box, html`<h2 class="sec" style="margin-top:0">${I("sparkles", "s")}Управление через Claude<span class="chip" style="margin-left:auto;text-transform:none;letter-spacing:0">${st.enabled ? "🟢 Подключено" : "⚪ Выключено"}</span></h2>
        <p class="muted" style="margin:0 0 12px;font-size:14px">Подключите портал к Claude как коннектор — и Claude сможет смотреть обращения, менять статусы и приоритеты, отвечать тестировщикам, объединять дубликаты, публиковать объявления и менять версию. Тестировщики видят эти действия от имени <b>«Команда QVK»</b>.</p>
        ${st.enabled ? html`<p class="faint" style="font-size:13px;margin:0 0 12px">Ключ создан ${fmtDT(st.created)}${st.last_used ? " · последнее использование " + rel(st.last_used) : " · ещё не использовался"}</p>` : ""}
        <div class="row wrap"><button class="btn ${st.enabled ? "" : "primary"}" id="mcp-new">${I("key")}${st.enabled ? "Создать новый ключ" : "Включить и получить ссылку"}</button>${st.enabled ? html`<button class="btn danger" id="mcp-off">${I("x")}Отключить</button>` : ""}</div>`);
      $("#mcp-new", box).onclick = async () => {
        if (st.enabled && !(await confirmSheet("Создать новый ключ?", "Старая ссылка перестанет работать — коннектор в Claude нужно будет переподключить.", "Создать"))) return;
        try {
          const r = await POST("/admin/mcp");
          const link = r.url + r.key;
          sheet("Ссылка для Claude", (b) => {
            set(b, html`<p class="muted" style="margin-top:0">Ссылка показывается <b>один раз</b>. Это пароль от админ-доступа — не публикуйте её.</p>
              <div class="row"><input class="mono" readonly value="${link}" id="mcp-link" style="font-size:13px"><button class="btn icon" id="mcp-copy" aria-label="Скопировать">${I("copy")}</button></div>
              <div class="block mt2"><h4>Как подключить</h4><div class="text" style="font-size:14px">1. claude.ai → Settings → Connectors → «Add custom connector».
2. Название: QVK Beta Portal, URL — ссылка выше. Авторизацию не заполняйте.
3. В чате включите коннектор и попросите, например: «Покажи новые баги и расставь приоритеты».

Для Claude Code: claude mcp add --transport http qvk ${link}</div></div>`);
            $("#mcp-link", b).onclick = (e) => e.target.select();
            $("#mcp-copy", b).onclick = async () => { try { await navigator.clipboard.writeText(link); toast("Ссылка скопирована"); } catch { $("#mcp-link", b).select(); } };
          });
          drawMcp();
        } catch (err) { fail(err); }
      };
      if ($("#mcp-off", box)) $("#mcp-off", box).onclick = async () => {
        if (!(await confirmSheet("Отключить доступ Claude?", "Ссылка перестанет работать сразу.", "Отключить", true))) return;
        try { await api("DELETE", "/admin/mcp"); toast("Доступ отключён"); drawMcp(); } catch (err) { fail(err); }
      };
    };
    drawMcp();
    const saveSet = async (patch, msg) => { try { await POST("/admin/settings", patch); await reloadMe(); toast(msg || "Настройки сохранены"); } catch (err) { fail(err); } };
    $("#vf", view).onsubmit = async (e) => { e.preventDefault(); await saveSet({ current_version: e.target.current_version.value.trim() }, "Версия обновлена"); $$(".side .brand small").forEach((x) => (x.textContent = "Тестирование " + S.me.settings.current_version)); };
    $("#wf", view).onsubmit = (e) => { e.preventDefault(); saveSet({ welcome: e.target.welcome.value }); };
    $$("[data-set]", view).forEach((c) => (c.onchange = () => saveSet({ [c.dataset.set]: c.checked })));
  }

  // ---------------------------------------------------------------- start
  boot();
})();
