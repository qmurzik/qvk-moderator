// QVK Beta Portal — authentication.
//
// Accounts: nickname + password. Passwords are stored as PBKDF2-SHA256 hashes
// (100 000 iterations — the Workers maximum — with a random 16-byte salt).
// Sessions: random 256-bit token in an HttpOnly Secure cookie; only its SHA-256
// is stored in D1. Sliding expiry of 60 days.
//
// Telegram is optional: a tester may link their Telegram account through the
// existing bot (/start link_<token> + confirmation button). The link enables
// DM notifications, and an account whose linked Telegram id is listed in the
// server-side ADMIN_IDS variable gets admin rights. A nickname alone never
// grants admin rights.

import { ensureSchema } from "./schema.js";
import { tg, botUsername, escapeTgHtml } from "./telegram.js";
import { now, randomHex, randomId, sha256, safeEqual, parseCookies, cookie, fail, isAdminId, getSetting, setSetting, clientIp, rateLimit, json, clean } from "./util.js";

export const SESSION_COOKIE = "__Host-qvk_s";
const SESSION_TTL = 60 * 24 * 3600; // 60 days, sliding
const LINK_TTL = 15 * 60;
const PBKDF2_ITER = 100000;

const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${PBKDF2_ITER}$${b64(salt)}$${b64(await pbkdf2(password, salt, PBKDF2_ITER))}`;
}

export async function verifyPassword(password, stored) {
  const m = /^pbkdf2\$(\d+)\$([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+)$/.exec(stored || "");
  if (!m) return false;
  const got = await pbkdf2(password, unb64(m[2]), Number(m[1]));
  return safeEqual(b64(got), m[3]);
}

// A dummy hash so that "unknown nickname" and "wrong password" take the same time.
let dummyHash = null;
const getDummy = async () => (dummyHash ||= await hashPassword(randomHex(8)));

export const NICK_RE = /^[\p{L}\p{N}_.-]{3,24}$/u;
export const normNick = (n) => String(n || "").trim().toLowerCase().replace(/ё/g, "е");

function readCredentials(body) {
  const nick = clean(body.nick, 40, { multiline: false });
  const password = String(body.password ?? "");
  if (!NICK_RE.test(nick)) fail(400, "Ник: 3–24 символа — буквы, цифры, «_», «.» или «-»");
  if (password.length < 8) fail(400, "Пароль должен быть не короче 8 символов");
  if (password.length > 128) fail(400, "Пароль слишком длинный");
  return { nick, password };
}

const isSecure = (req) => new URL(req.url).protocol === "https:";

/** Admin = linked Telegram id is in ADMIN_IDS. */
export const isAdminUser = (e, u) => !!u?.tg_id && isAdminId(e, u.tg_id);

/** Ids of portal accounts that are admins (used for "Команда QVK" badges). */
export async function adminUserIds(e) {
  const list = String(e.ADMIN_IDS || "").split(",").map((x) => x.trim()).filter(Boolean);
  // "claude" is the built-in account used by the MCP connector (see mcp.js).
  if (!list.length) return new Set(["claude"]);
  const rows = (await e.DB.prepare(`SELECT id FROM portal_users WHERE tg_id IN (${list.map(() => "?").join(",")})`).bind(...list).all()).results || [];
  return new Set(["claude", ...rows.map((r) => r.id)]);
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
    `SELECT s.hash,s.user_id,s.csrf,s.expires,s.seen,u.nick,u.first_name,u.last_name,u.username,u.photo_url,u.notify_tg,u.tg_blocked,u.tg_id,u.active_device,u.banned,u.deleted,u.created
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
    nick: row.nick,
    first_name: row.first_name,
    last_name: row.last_name,
    username: row.username,
    photo_url: row.photo_url,
    notify_tg: !!row.notify_tg,
    tg_blocked: !!row.tg_blocked,
    tg_linked: !!row.tg_id,
    active_device: row.active_device,
    created: row.created,
  };
  return { user, session: { hash, csrf: row.csrf }, isAdmin: isAdminUser(e, row) };
}

export async function register(req, e, body) {
  await rateLimit(e, "register:" + clientIp(req), 6, 3600);
  const { nick, password } = readCredentials(body);
  const lc = normNick(nick);
  const taken = await e.DB.prepare("SELECT id FROM portal_users WHERE nick_lc=?").bind(lc).first();
  if (taken) fail(409, "Этот ник уже занят");
  const id = "u" + randomId(15);
  const t = now();
  try {
    await e.DB.prepare("INSERT INTO portal_users(id,nick,nick_lc,pass_hash,first_name,created,last_seen,notify_tg) VALUES(?,?,?,?,?,?,?,1)")
      .bind(id, nick, lc, await hashPassword(password), nick, t, t).run();
  } catch (err) {
    if (/UNIQUE/i.test(String(err))) fail(409, "Этот ник уже занят");
    throw err;
  }
  return json({ ok: true }, 200, { "set-cookie": await createSession(req, e, id) });
}

export async function login(req, e, body) {
  const nick = clean(body.nick, 40, { multiline: false });
  const password = String(body.password ?? "").slice(0, 200);
  await rateLimit(e, "login:" + clientIp(req), 20, 600);
  await rateLimit(e, "login-nick:" + normNick(nick), 10, 900);
  const u = await e.DB.prepare("SELECT id,pass_hash,banned,deleted FROM portal_users WHERE nick_lc=?").bind(normNick(nick)).first();
  const ok = await verifyPassword(password, u?.pass_hash || (await getDummy()));
  if (!u || !ok || u.deleted) fail(401, "Неверный ник или пароль");
  if (u.banned) fail(403, "Доступ закрыт администратором");
  return json({ ok: true }, 200, { "set-cookie": await createSession(req, e, u.id) });
}

export async function changePassword(req, e, ses, body) {
  await rateLimit(e, "passwd:" + ses.user.id, 10, 3600);
  const u = await e.DB.prepare("SELECT pass_hash FROM portal_users WHERE id=?").bind(ses.user.id).first();
  if (!(await verifyPassword(String(body.current ?? ""), u?.pass_hash))) fail(400, "Текущий пароль указан неверно");
  const next = String(body.password ?? "");
  if (next.length < 8 || next.length > 128) fail(400, "Новый пароль: от 8 до 128 символов");
  await e.DB.batch([
    e.DB.prepare("UPDATE portal_users SET pass_hash=? WHERE id=?").bind(await hashPassword(next), ses.user.id),
    // Sign out every other device.
    e.DB.prepare("DELETE FROM portal_sessions WHERE user_id=? AND hash<>?").bind(ses.user.id, ses.session.hash),
  ]);
  return json({ ok: true });
}

/** Admin-only: sets a temporary password for a tester who forgot theirs. */
export async function adminResetPassword(e, userId, password) {
  if (String(password).length < 8 || String(password).length > 128) fail(400, "Пароль: от 8 до 128 символов");
  const r = await e.DB.prepare("UPDATE portal_users SET pass_hash=? WHERE id=? AND deleted=0").bind(await hashPassword(String(password)), userId).run();
  if (!r.meta?.changes) fail(404, "Пользователь не найден");
  await e.DB.prepare("DELETE FROM portal_sessions WHERE user_id=?").bind(userId).run();
}

export async function logout(req, e, ses) {
  if (ses) await e.DB.prepare("DELETE FROM portal_sessions WHERE hash=?").bind(ses.session.hash).run();
  return json({ ok: true }, 200, { "set-cookie": cookie(SESSION_COOKIE, "", 0, isSecure(req)) });
}

// ---------- Telegram linking ----------

export async function startTelegramLink(req, e, ses) {
  await rateLimit(e, "tglink:" + ses.user.id, 10, 3600);
  const bot = await botUsername(e);
  if (!bot) fail(503, "Бот не настроен");
  const token = randomHex(16);
  const t = now();
  const origin = new URL(req.url).origin;
  if ((await getSetting(e, "portal_origin", "")) !== origin) await setSetting(e, "portal_origin", origin);
  await e.DB.batch([
    e.DB.prepare("DELETE FROM portal_links WHERE expires<? OR user_id=?").bind(t, ses.user.id),
    e.DB.prepare("INSERT INTO portal_links(token_hash,user_id,created,expires) VALUES(?,?,?,?)").bind(await sha256(token), ses.user.id, t, t + LINK_TTL),
  ]);
  return json({ ok: true, link: "https://t.me/" + bot + "?start=link_" + token, bot });
}

export async function unlinkTelegram(e, ses) {
  await e.DB.prepare("UPDATE portal_users SET tg_id=NULL,username=NULL,tg_blocked=0 WHERE id=?").bind(ses.user.id).run();
  return json({ ok: true });
}

/** Handles "/start link_<token>" and "/start portal_notify" in a private chat. Returns true when handled. */
export async function botStart(e, message) {
  if (message?.chat?.type !== "private" || !message.from?.id) return false;
  const m = String(message.text || "").match(/^\/start(?:@\w+)?\s+(link_([a-f0-9]{32})|portal_notify)$/);
  if (!m) return false;
  await ensureSchema(e);
  const chat = message.chat.id;
  const tgId = String(message.from.id);
  if (m[1] === "portal_notify") {
    const r = await e.DB.prepare("UPDATE portal_users SET notify_tg=1,tg_blocked=0 WHERE tg_id=?").bind(tgId).run();
    await tg(e, "sendMessage", {
      chat_id: chat,
      text: r.meta?.changes ? "🔔 Уведомления QVK Beta Portal включены." : "Этот Telegram пока не привязан к аккаунту портала. Откройте профиль на сайте и нажмите «Подключить Telegram».",
    });
    return true;
  }
  const row = await e.DB.prepare("SELECT l.token_hash,l.user_id,l.expires,u.nick FROM portal_links l JOIN portal_users u ON u.id=l.user_id WHERE l.token_hash=?").bind(await sha256(m[2])).first();
  if (!row || row.expires < now()) {
    await tg(e, "sendMessage", { chat_id: chat, text: "⌛ Ссылка устарела. Откройте профиль на сайте и нажмите «Подключить Telegram» ещё раз." });
    return true;
  }
  await e.DB.prepare("UPDATE portal_links SET tg_user=? WHERE token_hash=?").bind(tgId, row.token_hash).run();
  await tg(e, "sendMessage", {
    chat_id: chat,
    parse_mode: "HTML",
    text: "💜 <b>QVK Beta Portal</b>\n\nПривязать этот Telegram к аккаунту <b>" + escapeTgHtml(row.nick) + "</b>?\nБот будет присылать уведомления об обращениях.\n\nЕсли это не ваш аккаунт — нажмите «Отмена».",
    reply_markup: { inline_keyboard: [[{ text: "✅ Привязать", callback_data: "pl:ok:" + row.token_hash.slice(0, 40) }, { text: "✖ Отмена", callback_data: "pl:no:" + row.token_hash.slice(0, 40) }]] },
  });
  return true;
}

/** Handles "pl:ok:<id>" / "pl:no:<id>" confirmation buttons. Returns true when handled. */
export async function botCallback(e, cq) {
  const m = String(cq?.data || "").match(/^pl:(ok|no):([a-f0-9]{40})$/);
  if (!m) return false;
  await ensureSchema(e);
  const from = cq.from;
  const answer = (text) => tg(e, "answerCallbackQuery", { callback_query_id: cq.id, text }).catch(() => {});
  const edit = (text, markup) =>
    cq.message ? tg(e, "editMessageText", { chat_id: cq.message.chat.id, message_id: cq.message.message_id, text, ...(markup ? { reply_markup: markup } : {}) }).catch(() => {}) : null;
  const row = await e.DB.prepare("SELECT token_hash,user_id,tg_user,expires FROM portal_links WHERE substr(token_hash,1,40)=?").bind(m[2]).first();
  if (!row || row.expires < now() || row.tg_user !== String(from?.id)) {
    await answer("Запрос устарел");
    return true;
  }
  await e.DB.prepare("DELETE FROM portal_links WHERE token_hash=?").bind(row.token_hash).run();
  if (m[1] === "no") {
    await answer("Отменено");
    await edit("✖ Привязка отменена.");
    return true;
  }
  const tgId = String(from.id);
  await e.DB.batch([
    // One Telegram account ↔ one portal account.
    e.DB.prepare("UPDATE portal_users SET tg_id=NULL,username=NULL WHERE tg_id=? AND id<>?").bind(tgId, row.user_id),
    e.DB.prepare("UPDATE portal_users SET tg_id=?,username=?,tg_blocked=0,notify_tg=1 WHERE id=?").bind(tgId, from.username ? String(from.username).slice(0, 64) : null, row.user_id),
  ]);
  await answer("Telegram привязан");
  const origin = await getSetting(e, "portal_origin", "");
  await edit("✅ Telegram привязан. Теперь уведомления о ваших обращениях будут приходить сюда.", origin ? { inline_keyboard: [[{ text: "Открыть QVK Beta Portal", url: origin + "/" }]] } : null);
  return true;
}
