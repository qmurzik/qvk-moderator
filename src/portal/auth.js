// QVK Beta Portal — authentication.
//
// Primary method: one-time confirmation through the existing Telegram bot.
//   1. Browser calls /api/p/auth/start → server stores a random login token (hashed)
//      and sets an HttpOnly "login nonce" cookie bound to this browser.
//   2. Browser opens t.me/<bot>?start=login_<token>. The bot (webhook is protected by
//      WEBHOOK_SECRET, so the Telegram user id is trustworthy) asks the user to confirm
//      and shows the same 4-digit code that is displayed on the site.
//   3. Browser polls /api/p/auth/poll with its nonce cookie; after confirmation a
//      session cookie is issued. The token alone is useless without the nonce cookie.
// Optional: the official Telegram Login Widget (after /setdomain in BotFather).
//
// Admin rights are derived only from the server-side ADMIN_IDS list.

import { ensureSchema } from "./schema.js";
import { tg, botUsername, escapeTgHtml } from "./telegram.js";
import { now, randomHex, sha256, hmacHex, safeEqual, parseCookies, cookie, fail, isAdminId, getSetting, setSetting, clientIp, rateLimit, json } from "./util.js";

export const SESSION_COOKIE = "__Host-qvk_s";
export const LOGIN_COOKIE = "__Host-qvk_l";
const SESSION_TTL = 60 * 24 * 3600; // 60 days, sliding
const LOGIN_TTL = 10 * 60;

const isSecure = (req) => new URL(req.url).protocol === "https:";

export async function upsertUser(e, from) {
  const t = now();
  const id = String(from.id);
  await e.DB.prepare(
    `INSERT INTO portal_users(id,first_name,last_name,username,photo_url,created,last_seen) VALUES(?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET first_name=excluded.first_name,last_name=excluded.last_name,username=excluded.username,
     photo_url=COALESCE(excluded.photo_url,portal_users.photo_url),last_seen=excluded.last_seen,deleted=0`,
  ).bind(id, String(from.first_name || "").slice(0, 64), String(from.last_name || "").slice(0, 64) || null, String(from.username || "").slice(0, 64) || null, from.photo_url ? String(from.photo_url).slice(0, 300) : null, t, t).run();
  return id;
}

export async function createSession(req, e, userId) {
  const token = randomHex(32);
  const csrf = randomHex(16);
  const t = now();
  await e.DB.prepare("INSERT INTO portal_sessions(hash,user_id,csrf,created,expires,seen,ua) VALUES(?,?,?,?,?,?,?)")
    .bind(await sha256(token), String(userId), csrf, t, t + SESSION_TTL, t, String(req.headers.get("user-agent") || "").slice(0, 200)).run();
  return cookie(SESSION_COOKIE, token, SESSION_TTL, isSecure(req));
}

/** Returns {user, session, isAdmin} or null. Never trusts client-supplied identity. */
export async function loadSession(req, e) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const hash = await sha256(token);
  const row = await e.DB.prepare(
    `SELECT s.hash,s.user_id,s.csrf,s.expires,s.seen,u.first_name,u.last_name,u.username,u.photo_url,u.notify_tg,u.tg_blocked,u.active_device,u.banned,u.deleted,u.created
     FROM portal_sessions s JOIN portal_users u ON u.id=s.user_id WHERE s.hash=?`,
  ).bind(hash).first();
  const t = now();
  if (!row || row.expires < t || row.banned || row.deleted) return null;
  if (t - row.seen > 600) {
    await e.DB.batch([
      e.DB.prepare("UPDATE portal_sessions SET seen=?,expires=? WHERE hash=?").bind(t, t + SESSION_TTL, hash),
      e.DB.prepare("UPDATE portal_users SET last_seen=? WHERE id=?").bind(t, row.user_id),
    ]);
  }
  const user = {
    id: row.user_id,
    first_name: row.first_name,
    last_name: row.last_name,
    username: row.username,
    photo_url: row.photo_url,
    notify_tg: !!row.notify_tg,
    tg_blocked: !!row.tg_blocked,
    active_device: row.active_device,
    created: row.created,
  };
  return { user, session: { hash, csrf: row.csrf }, isAdmin: isAdminId(e, row.user_id) };
}

export async function startLogin(req, e) {
  await rateLimit(e, "login:" + clientIp(req), 15, 600);
  const bot = await botUsername(e);
  if (!bot) fail(503, "Бот не настроен: не удалось определить имя бота");
  const token = randomHex(16);
  const nonce = randomHex(24);
  const code = String(1000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 9000));
  const t = now();
  // Remember the public origin so the bot can link back to the site.
  const origin = new URL(req.url).origin;
  if ((await getSetting(e, "portal_origin", "")) !== origin) await setSetting(e, "portal_origin", origin);
  await e.DB.batch([
    e.DB.prepare("DELETE FROM portal_logins WHERE expires<?").bind(t - 3600),
    e.DB.prepare("INSERT INTO portal_logins(token_hash,nonce_hash,code,created,expires,ua) VALUES(?,?,?,?,?,?)")
      .bind(await sha256(token), await sha256(nonce), code, t, t + LOGIN_TTL, String(req.headers.get("user-agent") || "").slice(0, 160)),
  ]);
  return json(
    { ok: true, link: "https://t.me/" + bot + "?start=login_" + token, code, expires: t + LOGIN_TTL, bot },
    200,
    { "set-cookie": cookie(LOGIN_COOKIE, nonce, LOGIN_TTL, isSecure(req)) },
  );
}

export async function pollLogin(req, e) {
  const nonce = parseCookies(req)[LOGIN_COOKIE];
  if (!nonce || !/^[a-f0-9]{48}$/.test(nonce)) return json({ status: "missing" });
  const row = await e.DB.prepare("SELECT id,status,user_id,expires FROM portal_logins WHERE nonce_hash=?").bind(await sha256(nonce)).first();
  if (!row) return json({ status: "missing" });
  if (row.expires < now() && row.status !== "confirmed") return json({ status: "expired" });
  if (row.status === "denied") return json({ status: "denied" });
  if (row.status !== "confirmed" || !row.user_id) return json({ status: "pending" });
  // One-shot: mark used atomically so the confirmation cannot be replayed.
  const used = await e.DB.prepare("UPDATE portal_logins SET status='used' WHERE id=? AND status='confirmed'").bind(row.id).run();
  if (!used.meta?.changes) return json({ status: "missing" });
  const sessionCookie = await createSession(req, e, row.user_id);
  const headers = new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  headers.append("set-cookie", sessionCookie);
  headers.append("set-cookie", cookie(LOGIN_COOKIE, "", 0, isSecure(req)));
  return new Response(JSON.stringify({ status: "ok" }), { headers });
}

/** Telegram Login Widget verification (https://core.telegram.org/widgets/login). */
export async function verifyWidget(e, data) {
  if (!data || typeof data !== "object" || !/^[a-f0-9]{64}$/.test(String(data.hash || ""))) return null;
  const fields = Object.entries(data)
    .filter(([k, v]) => k !== "hash" && v !== undefined && v !== null && ["id", "first_name", "last_name", "username", "photo_url", "auth_date"].includes(k))
    .map(([k, v]) => k + "=" + v)
    .sort()
    .join("\n");
  const secret = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(e.BOT_TOKEN)));
  const expected = await hmacHex(secret, fields);
  if (!safeEqual(expected, data.hash)) return null;
  if (Math.abs(now() - Number(data.auth_date)) > 86400) return null;
  if (!/^\d{1,20}$/.test(String(data.id))) return null;
  return data;
}

export async function widgetLogin(req, e, body) {
  await rateLimit(e, "login:" + clientIp(req), 15, 600);
  if ((await getSetting(e, "login_widget", "off")) !== "on") fail(403, "Вход через виджет отключён");
  const data = await verifyWidget(e, body);
  if (!data) fail(401, "Подпись Telegram недействительна");
  const banned = await e.DB.prepare("SELECT banned FROM portal_users WHERE id=?").bind(String(data.id)).first();
  if (banned?.banned) fail(403, "Доступ закрыт администратором");
  await upsertUser(e, data);
  return json({ ok: true }, 200, { "set-cookie": await createSession(req, e, data.id) });
}

export async function logout(req, e, ses) {
  if (ses) await e.DB.prepare("DELETE FROM portal_sessions WHERE hash=?").bind(ses.session.hash).run();
  return json({ ok: true }, 200, { "set-cookie": cookie(SESSION_COOKIE, "", 0, isSecure(req)) });
}

// ---------- Bot side ----------

/** Handles "/start login_<token>" in a private chat. Returns true when handled. */
export async function botStart(e, message) {
  if (message?.chat?.type !== "private" || !message.from?.id) return false;
  const text = String(message.text || "");
  const m = text.match(/^\/start(?:@\w+)?\s+(login_([a-f0-9]{32})|portal_notify)$/);
  if (!m) return false;
  await ensureSchema(e);
  const chat = message.chat.id;
  if (m[1] === "portal_notify") {
    await e.DB.prepare("UPDATE portal_users SET notify_tg=1,tg_blocked=0 WHERE id=?").bind(String(message.from.id)).run();
    await tg(e, "sendMessage", { chat_id: chat, text: "🔔 Уведомления QVK Beta Portal включены. Я напишу, когда статус ваших обращений изменится." });
    return true;
  }
  const row = await e.DB.prepare("SELECT id,code,status,expires FROM portal_logins WHERE token_hash=?").bind(await sha256(m[2])).first();
  if (!row || row.status !== "pending" || row.expires < now()) {
    await tg(e, "sendMessage", { chat_id: chat, text: "⌛ Ссылка для входа устарела. Вернитесь на сайт и нажмите «Войти через Telegram» ещё раз." });
    return true;
  }
  const user = await e.DB.prepare("SELECT banned FROM portal_users WHERE id=?").bind(String(message.from.id)).first();
  if (user?.banned) {
    await tg(e, "sendMessage", { chat_id: chat, text: "⛔ Доступ к порталу закрыт администратором." });
    return true;
  }
  await e.DB.prepare("UPDATE portal_logins SET tg_user=? WHERE id=? AND status='pending'").bind(String(message.from.id), row.id).run();
  await tg(e, "sendMessage", {
    chat_id: chat,
    parse_mode: "HTML",
    text:
      "💜 <b>Вход в QVK Beta Portal</b>\n\nКод на сайте: <b>" + escapeTgHtml(row.code) + "</b>\nУбедитесь, что он совпадает с кодом в браузере.\n\nЕсли вы не начинали вход — нажмите «Отмена».",
    reply_markup: { inline_keyboard: [[{ text: "✅ Подтвердить вход", callback_data: "pl:ok:" + row.id }, { text: "✖ Отмена", callback_data: "pl:no:" + row.id }]] },
  });
  return true;
}

/** Handles "pl:ok:<id>" / "pl:no:<id>" callback buttons. Returns true when handled. */
export async function botCallback(e, cq) {
  const m = String(cq?.data || "").match(/^pl:(ok|no):(\d{1,12})$/);
  if (!m) return false;
  await ensureSchema(e);
  const from = cq.from;
  const answer = (text) => tg(e, "answerCallbackQuery", { callback_query_id: cq.id, text, show_alert: false }).catch(() => {});
  const row = await e.DB.prepare("SELECT id,status,tg_user,expires FROM portal_logins WHERE id=?").bind(Number(m[2])).first();
  if (!row || row.status !== "pending" || row.expires < now() || row.tg_user !== String(from?.id)) {
    await answer("Запрос на вход устарел");
    return true;
  }
  const edit = (text, markup) =>
    cq.message ? tg(e, "editMessageText", { chat_id: cq.message.chat.id, message_id: cq.message.message_id, text, ...(markup ? { reply_markup: markup } : {}) }).catch(() => {}) : null;
  if (m[1] === "no") {
    await e.DB.prepare("UPDATE portal_logins SET status='denied' WHERE id=? AND status='pending'").bind(row.id).run();
    await answer("Вход отменён");
    await edit("✖ Вход отменён. Если это были не вы — просто проигнорируйте запрос.");
    return true;
  }
  await upsertUser(e, from);
  const r = await e.DB.prepare("UPDATE portal_logins SET status='confirmed',user_id=? WHERE id=? AND status='pending'").bind(String(from.id), row.id).run();
  if (!r.meta?.changes) {
    await answer("Запрос на вход устарел");
    return true;
  }
  await e.DB.prepare("UPDATE portal_users SET tg_blocked=0 WHERE id=?").bind(String(from.id)).run();
  await answer("Вход подтверждён");
  const origin = await getSetting(e, "portal_origin", "");
  await edit("✅ Вход подтверждён. Вернитесь в браузер — страница откроется автоматически.", origin ? { inline_keyboard: [[{ text: "Открыть QVK Beta Portal", url: origin + "/" }]] } : null);
  return true;
}
