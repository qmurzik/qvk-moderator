// QVK Beta Portal — small server helpers.

export const now = () => Math.floor(Date.now() / 1000);

export class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export const fail = (status, message, extra) => {
  throw new HttpError(status, message, extra);
};

export const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "strict-transport-security": "max-age=31536000",
  "x-robots-tag": "noindex, nofollow",
};

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...SECURITY_HEADERS, ...headers },
  });
}

export function hex(bytes) {
  return Array.from(new Uint8Array(bytes), (x) => x.toString(16).padStart(2, "0")).join("");
}

export function randomHex(n = 16) {
  return hex(crypto.getRandomValues(new Uint8Array(n)));
}

export function randomId(n = 12) {
  const alphabet = "abcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

const enc = new TextEncoder();

export async function sha256(text) {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(String(text))));
}

export async function hmacHex(keyBytes, text) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(text)));
}

export function safeEqual(a, b) {
  a = String(a ?? "");
  b = String(b ?? "");
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** Normalises user text: strips control characters (except newlines/tabs), trims, limits length. */
export function clean(value, max = 2000, { multiline = true } = {}) {
  let s = String(value ?? "").replace(/\r\n?/g, "\n");
  s = multiline ? s.replace(/[\u0000-\u0008\u000b-\u001f\u007f​-‏‪-‮⁦-⁩]/g, "") : s.replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, " ");
  s = s.replace(/\n{4,}/g, "\n\n\n").trim();
  return s.length > max ? s.slice(0, max) : s;
}

export function oneOf(value, list, fallback = null) {
  return list.includes(value) ? value : fallback;
}

export function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.get("cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function cookie(name, value, maxAge, secure = true) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}; Secure`;
}

export const admins = (e) => new Set(String(e.ADMIN_IDS || "").split(",").map((x) => x.trim()).filter(Boolean));
export const isAdminId = (e, id) => !!id && admins(e).has(String(id));

/** Escapes LIKE wildcards; use with ESCAPE '\\'. */
export const likeEscape = (s) => String(s).replace(/[\\%_]/g, (c) => "\\" + c);

export async function readJson(req, maxBytes = 200000) {
  const len = Number(req.headers.get("content-length") || 0);
  if (len > maxBytes) fail(413, "Слишком большой запрос");
  const text = await req.text();
  if (text.length > maxBytes) fail(413, "Слишком большой запрос");
  if (!text) return {};
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== "object" || Array.isArray(data)) fail(400, "Некорректные данные");
    return data;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    fail(400, "Некорректный JSON");
  }
}

export const clientIp = (req) => req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "0.0.0.0";

/** Fixed-window rate limit stored in D1. Throws 429 when exceeded. */
export async function rateLimit(e, key, limit, windowSec) {
  const w = Math.floor(now() / windowSec);
  const k = key + "|" + windowSec;
  const row = await e.DB.prepare(
    "INSERT INTO portal_rate(k,w,c) VALUES(?,?,1) ON CONFLICT(k) DO UPDATE SET c=CASE WHEN portal_rate.w=excluded.w THEN portal_rate.c+1 ELSE 1 END, w=excluded.w RETURNING c",
  ).bind(k, w).first();
  if ((row?.c || 0) > limit) {
    const retry = windowSec - (now() % windowSec);
    fail(429, "Слишком много запросов. Подождите немного и попробуйте снова.", { retry_after: retry });
  }
}

export async function getSetting(e, key, fallback = "") {
  const r = await e.DB.prepare("SELECT value FROM portal_settings WHERE key=?").bind(key).first();
  return r?.value ?? fallback;
}

export async function setSetting(e, key, value) {
  await e.DB.prepare("INSERT INTO portal_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(key, String(value)).run();
}

/** Increments the global revision counter that clients poll to detect changes. */
export async function bump(e) {
  await e.DB.prepare("UPDATE portal_settings SET value=CAST(CAST(value AS INTEGER)+1 AS TEXT) WHERE key='rev'").run();
}

export function csvCell(v) {
  let s = v == null ? "" : String(v);
  // Prevent spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export const displayName = (u) => {
  if (!u) return "Тестировщик";
  if (u.deleted) return "Удалённый тестировщик";
  if (u.nick) return u.nick;
  const n = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
  return n || (u.username ? "@" + u.username : "Тестировщик " + String(u.id).slice(-4));
};
