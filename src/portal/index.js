// QVK Beta Portal — entry point mounted inside the existing qvk-moderator Worker.
import { ensureSchema } from "./schema.js";
import { handleApi, apiError, adminStats, adminUsers, adminSettings, savePost, settingsSnapshot } from "./api.js";
import { handleMcp } from "./mcp.js";
import { drainOutbox } from "./broadcast.js";
import { loadSession, adminUserIds } from "./auth.js";
import { serveFile } from "./files.js";
import { canSeeTicketId } from "./tickets.js";
import { json, SECURITY_HEADERS, getSetting, HttpError } from "./util.js";
import { APP_JS, APP_CSS, ASSET_HASH } from "./assets.gen.js";

import { botStart, botCallback } from "./auth.js";
import { handleAppApi, APP_PREFIX, appBotStart, appBotCallback } from "./appapi.js";

/** Bot hooks: account linking (/start link_…) and app linking (/start app_…). */
export async function portalBotStart(e, message) {
  return (await botStart(e, message)) || (await appBotStart(e, message));
}
export async function portalBotCallback(e, cq) {
  return (await botCallback(e, cq)) || (await appBotCallback(e, cq));
}

const PAGE_PREFIXES = ["/bugs/", "/ideas/", "/admin/", "/new/"];
const PAGES = new Set(["/", "/login", "/my", "/all", "/known", "/fixes", "/updates", "/leaders", "/notifications", "/profile", "/admin", "/welcome", "/new", "/link"]);

/** Paths owned by the portal. Existing moderator routes (/app, /bug-form, /api/app, /webhook…) are untouched. */
export function isPortalPath(p) {
  return PAGES.has(p) || PAGE_PREFIXES.some((x) => p.startsWith(x)) || p.startsWith("/api/p/") || p === "/api/p" || p === "/mcp" || p.startsWith("/mcp/") || p.startsWith("/api/app/v1/") || p.startsWith("/files/") || p.startsWith("/assets/portal.") || p === "/favicon.svg" || p === "/sw.js" || p === "/manifest.webmanifest";
}

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://t.me https://*.telegram.org https://telegram.org https://*.telesco.pe",
  "media-src 'self' blob:",
  "worker-src 'self'",
  "connect-src 'self'",
    "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c4a1ff"/><stop offset="1" stop-color="#6a4be0"/></linearGradient></defs><rect width="64" height="64" rx="18" fill="url(#g)"/><path d="M20 30a12 12 0 1 1 20.5 8.5L45 43" fill="none" stroke="#fff" stroke-width="5.5" stroke-linecap="round"/></svg>`;

// Service worker: shows Web Push notifications and opens the right page on click.
const SERVICE_WORKER = `self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(d.title || "QVK Beta Portal", {
    body: d.body || "", tag: d.tag || undefined, icon: "/favicon.svg", badge: "/favicon.svg",
    data: { url: typeof d.url === "string" && d.url.startsWith("/") ? d.url : "/" }
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data && event.notification.data.url || "/", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) if (c.url.startsWith(self.location.origin) && "focus" in c) { c.navigate(url); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
`;

/** Cron handler: delivers queued news/push messages. */
export async function portalScheduled(e) {
  if (!e.DB) return;
  await ensureSchema(e);
  await drainOutbox(e, 1);
}

function shell() {
  return `<!doctype html>
<html lang="ru" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0f0c1d">
<meta name="color-scheme" content="dark light">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="QVK Beta">
<meta name="robots" content="noindex,nofollow">
<title>QVK Beta Portal</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="stylesheet" href="/assets/portal.css?v=${ASSET_HASH}">
<script src="/assets/portal.js?v=${ASSET_HASH}" defer></script>
</head>
<body>
<div id="app"><div class="boot"><div class="boot-logo"></div><div class="boot-text">QVK Beta Portal</div></div></div>
<noscript><p style="padding:24px;color:#fff">Для работы портала включите JavaScript.</p></noscript>
</body>
</html>`;
}

const html = (body, status = 200) =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": CSP, ...SECURITY_HEADERS } });

export async function portal(req, e, ctx) {
  const url = new URL(req.url);
  const p = url.pathname;
  try {
    if (p === "/favicon.svg") return new Response(FAVICON, { headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400" } });
    if (p === "/sw.js") {
      return new Response(SERVICE_WORKER, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache", "x-content-type-options": "nosniff" } });
    }
    if (p.startsWith("/assets/portal.")) {
      const isJs = p === "/assets/portal.js";
      const isCss = p === "/assets/portal.css";
      if (!isJs && !isCss) return new Response("Not Found", { status: 404 });
      return new Response(isJs ? APP_JS : APP_CSS, {
        headers: {
          "content-type": isJs ? "text/javascript; charset=utf-8" : "text/css; charset=utf-8",
          "cache-control": url.searchParams.get("v") === ASSET_HASH ? "public, max-age=31536000, immutable" : "no-cache",
          "x-content-type-options": "nosniff",
        },
      });
    }
    if (!e.DB) return json({ error: "База данных не подключена" }, 503);
    await ensureSchema(e);
    if (p === "/manifest.webmanifest") {
      return new Response(JSON.stringify({
        name: "QVK Beta Portal", short_name: "QVK Beta", start_url: "/", display: "standalone",
        background_color: "#0f0c1d", theme_color: "#0f0c1d", lang: "ru",
        icons: [{ src: "/favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
      }), { headers: { "content-type": "application/manifest+json", "cache-control": "public, max-age=3600" } });
    }
    if (p.startsWith(APP_PREFIX + "/")) return await handleAppApi(req, e, ctx, url);
    if (p === "/mcp" || p.startsWith("/mcp/")) return await handleMcp(req, e, ctx, url, { adminStats, adminUsers, adminSettings, savePost, settings: settingsSnapshot });
    if (p.startsWith("/api/p")) return await handleApi(req, e, ctx, url);
    if (p.startsWith("/files/")) {
      if (!["GET", "HEAD"].includes(req.method)) return new Response("Method Not Allowed", { status: 405 });
      const ses = await loadSession(req, e);
      if (!ses) return new Response("Требуется вход", { status: 401 });
      ses.admins = await adminUserIds(e);
      return await serveFile(req, e, ses, p.slice(7), (tid) => canSeeTicketId(e, ses, tid));
    }
    if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method Not Allowed", { status: 405 });
    return html(shell());
  } catch (err) {
    if (p.startsWith("/api/p") || p.startsWith("/mcp")) return apiError(err);
    if (err instanceof HttpError) return new Response(err.message, { status: err.status, headers: { "content-type": "text/plain; charset=utf-8" } });
    console.error("Portal failure", err?.stack || String(err));
    return new Response("Внутренняя ошибка", { status: 500 });
  }
}
