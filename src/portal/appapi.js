// QVK Beta Portal — API for the QVK Android app (/api/app/v1, JSON).
//
// Auth: personal app token ("Authorization: Bearer qat_…"), obtained by linking
// the app to a portal account with a short code confirmed on the portal or in the
// Telegram bot. Only SHA-256 of tokens is stored; tokens are revoked in the profile.
// All ticket logic (validation, numbering, history, notifications to the author and
// to admins in Telegram) is shared with the web portal (tickets.js).

import { META, LIMITS, BUG_STATUSES, IDEA_STATUSES } from "./constants.js";
import { now, fail, json, clean, oneOf, sha256, randomHex, getSetting, setSetting, rateLimit, clientIp, HttpError, displayName } from "./util.js";
import { adminUserIds } from "./auth.js";
import { botUsername, tg, escapeTgHtml } from "./telegram.js";
import { storeFile, serveFile, sniff, APP_POLICY } from "./files.js";
import { ensureSchema } from "./schema.js";
import * as T from "./tickets.js";

export const APP_PREFIX = "/api/app/v1";
const LINK_TTL = 10 * 60;
const TOKEN_IDLE_TTL = 180 * 24 * 3600;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const FILES_PER_REQUEST = 5;
const TICKETS_PER_HOUR = 10;
const COMMENTS_PER_HOUR = 30;

const iso = (s) => (s ? new Date(s * 1000).toISOString() : null);
const statusOf = (kind, id) => {
  const s = (kind === "bug" ? BUG_STATUSES : IDEA_STATUSES).find((x) => x.id === id);
  return s ? { code: s.id, label: s.label, emoji: s.emoji, color: s.color } : { code: id, label: id };
};
const ERROR_CODES = { 400: "validation", 401: "unauthorized", 403: "forbidden", 404: "not_found", 405: "method_not_allowed", 409: "conflict", 410: "gone", 413: "file_too_large", 415: "unsupported_file", 422: "unprocessable", 429: "rate_limited", 503: "unavailable" };

function appError(err) {
  if (err instanceof HttpError) {
    const code = err.extra?.code || ERROR_CODES[err.status] || "error";
    const headers = err.extra?.retry_after ? { "retry-after": String(err.extra.retry_after) } : {};
    return json({ error: { code, message: err.message, ...(err.extra?.retry_after ? { retry_after: err.extra.retry_after } : {}) } }, err.status, headers);
  }
  console.error("App API failure", err?.stack || String(err));
  return json({ error: { code: "internal", message: "Внутренняя ошибка сервера. Попробуйте ещё раз." } }, 500);
}

async function readBody(req) {
  const text = await req.text();
  if (text.length > 100000) fail(413, "Слишком большой запрос", { code: "payload_too_large" });
  if (!text) return {};
  try {
    const d = JSON.parse(text);
    if (!d || typeof d !== "object" || Array.isArray(d)) throw 0;
    return d;
  } catch {
    fail(400, "Некорректный JSON", { code: "bad_json" });
  }
}

// ---------- linking ----------

const genCode = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => CODE_ALPHABET[b % 32]).join("");
const normCode = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const showCode = (c) => c.slice(0, 4) + "-" + c.slice(4);

async function linkStart(req, e, body) {
  await rateLimit(e, "app-link:" + clientIp(req), 10, 600);
  const deviceName = clean(body.device_name, 80, { multiline: false }) || "Приложение QVK";
  const t = now();
  const code = genCode();
  const poll = "qlp_" + randomHex(24);
  const origin = new URL(req.url).origin;
  if ((await getSetting(e, "portal_origin", "")) !== origin) await setSetting(e, "portal_origin", origin);
  await e.DB.batch([
    e.DB.prepare("DELETE FROM portal_app_links WHERE expires<?").bind(t - 3600),
    e.DB.prepare("INSERT INTO portal_app_links(code,poll_hash,device_name,created,expires) VALUES(?,?,?,?,?)").bind(code, await sha256(poll), deviceName, t, t + LINK_TTL),
  ]);
  const bot = await botUsername(e);
  return json({
    code: showCode(code),
    poll_token: poll,
    expires_in: LINK_TTL,
    poll_interval: 3,
    confirm_url: origin + "/link?code=" + code,
    telegram_url: bot ? "https://t.me/" + bot + "?start=app_" + code : null,
  }, 201);
}

async function linkPoll(req, e, body) {
  await rateLimit(e, "app-poll:" + clientIp(req), 300, 600);
  const poll = String(body.poll_token || "");
  if (!/^qlp_[a-f0-9]{48}$/.test(poll)) fail(400, "Некорректный poll_token", { code: "validation" });
  const row = await e.DB.prepare("SELECT * FROM portal_app_links WHERE poll_hash=?").bind(await sha256(poll)).first();
  if (!row) fail(404, "Запрос на подключение не найден", { code: "link_not_found" });
  if (row.status === "denied") return json({ status: "denied" });
  if (row.status === "used") return json({ status: "used" });
  if (row.expires < now()) return json({ status: "expired" });
  if (row.status !== "approved") return json({ status: "pending", expires_in: row.expires - now() });
  const claimed = await e.DB.prepare("UPDATE portal_app_links SET status='used' WHERE id=? AND status='approved'").bind(row.id).run();
  if (!claimed.meta?.changes) return json({ status: "used" });
  const token = "qat_" + randomHex(24);
  const t = now();
  await e.DB.prepare("INSERT INTO portal_app_tokens(user_id,token_hash,name,created,last_used) VALUES(?,?,?,?,?)").bind(row.user_id, await sha256(token), row.device_name, t, t).run();
  const u = await e.DB.prepare("SELECT id,nick,first_name FROM portal_users WHERE id=?").bind(row.user_id).first();
  return json({ status: "approved", token, token_type: "Bearer", user: { name: displayName(u) } });
}

/** Shared by the portal page and the bot: approve/deny a pending code for a user. */
export async function decideLink(e, code, userId, approve) {
  const c = normCode(code);
  const row = await e.DB.prepare("SELECT * FROM portal_app_links WHERE code=?").bind(c).first();
  if (!row || row.expires < now() || row.status !== "pending") fail(404, "Код не найден или устарел. Запросите новый код в приложении.", { code: "link_not_found" });
  await e.DB.prepare("UPDATE portal_app_links SET status=?,user_id=? WHERE id=? AND status='pending'").bind(approve ? "approved" : "denied", approve ? String(userId) : null, row.id).run();
  return { ok: true, device_name: row.device_name };
}

export async function lookupLink(e, code) {
  const row = await e.DB.prepare("SELECT device_name,status,expires FROM portal_app_links WHERE code=?").bind(normCode(code)).first();
  if (!row || row.expires < now() || row.status !== "pending") fail(404, "Код не найден или устарел. Запросите новый код в приложении.", { code: "link_not_found" });
  return { code: showCode(normCode(code)), device_name: row.device_name, expires_in: row.expires - now() };
}

export async function listAppTokens(e, userId) {
  const rows = (await e.DB.prepare("SELECT id,name,created,last_used FROM portal_app_tokens WHERE user_id=? AND revoked=0 AND last_used>? ORDER BY last_used DESC").bind(String(userId), now() - TOKEN_IDLE_TTL).all()).results || [];
  return rows;
}

export async function revokeAppToken(e, userId, id) {
  const r = await e.DB.prepare("UPDATE portal_app_tokens SET revoked=1 WHERE id=? AND user_id=?").bind(Number(id), String(userId)).run();
  if (!r.meta?.changes) fail(404, "Подключение не найдено");
}

// ---------- bot ----------

/** "/start app_<CODE>" in a private chat. */
export async function appBotStart(e, message) {
  if (message?.chat?.type !== "private" || !message.from?.id) return false;
  const m = String(message.text || "").match(/^\/start(?:@\w+)?\s+app_([A-Za-z0-9]{8})$/);
  if (!m) return false;
  await ensureSchema(e);
  const chat = message.chat.id;
  const code = normCode(m[1]);
  const row = await e.DB.prepare("SELECT id,device_name,status,expires FROM portal_app_links WHERE code=?").bind(code).first();
  if (!row || row.expires < now() || row.status !== "pending") {
    await tg(e, "sendMessage", { chat_id: chat, text: "⌛ Код устарел. Запросите новый код в приложении QVK." });
    return true;
  }
  const u = await e.DB.prepare("SELECT id,nick,first_name FROM portal_users WHERE tg_id=? AND deleted=0 AND banned=0").bind(String(message.from.id)).first();
  const origin = await getSetting(e, "portal_origin", "");
  if (!u) {
    await tg(e, "sendMessage", {
      chat_id: chat,
      text: "Этот Telegram не привязан к аккаунту QVK Beta Portal. Подтвердите код на сайте или сначала привяжите Telegram в профиле портала.",
      ...(origin ? { reply_markup: { inline_keyboard: [[{ text: "Подтвердить на сайте", url: origin + "/link?code=" + code }]] } } : {}),
    });
    return true;
  }
  await tg(e, "sendMessage", {
    chat_id: chat,
    parse_mode: "HTML",
    text: `📱 <b>Подключение приложения</b>\n\nПодключить «${escapeTgHtml(row.device_name)}» к аккаунту <b>${escapeTgHtml(displayName(u))}</b>?\nКод: <code>${showCode(code)}</code> — сверьте его с экраном приложения.\n\nЕсли вы не запрашивали подключение — нажмите «Отмена».`,
    reply_markup: { inline_keyboard: [[{ text: "✅ Подключить", callback_data: "pa:ok:" + row.id }, { text: "✖ Отмена", callback_data: "pa:no:" + row.id }]] },
  });
  return true;
}

export async function appBotCallback(e, cq) {
  const m = String(cq?.data || "").match(/^pa:(ok|no):(\d{1,12})$/);
  if (!m) return false;
  await ensureSchema(e);
  const answer = (text) => tg(e, "answerCallbackQuery", { callback_query_id: cq.id, text }).catch(() => {});
  const edit = (text) => (cq.message ? tg(e, "editMessageText", { chat_id: cq.message.chat.id, message_id: cq.message.message_id, text }).catch(() => {}) : null);
  const row = await e.DB.prepare("SELECT code,status,expires FROM portal_app_links WHERE id=?").bind(Number(m[2])).first();
  const u = await e.DB.prepare("SELECT id FROM portal_users WHERE tg_id=? AND deleted=0 AND banned=0").bind(String(cq.from?.id)).first();
  if (!row || !u || row.status !== "pending" || row.expires < now()) {
    await answer("Запрос устарел");
    return true;
  }
  await decideLink(e, row.code, u.id, m[1] === "ok");
  await answer(m[1] === "ok" ? "Приложение подключено" : "Отменено");
  await edit(m[1] === "ok" ? "✅ Приложение подключено. Вернитесь в QVK." : "✖ Подключение отменено.");
  return true;
}

// ---------- shaping ----------

const appAtt = (a) => ({ id: a.id, name: a.name, mime: a.mime, size: a.size, url: APP_PREFIX + "/attachments/" + a.id });

function briefOut(t) {
  return {
    code: t.code,
    kind: t.kind,
    category: t.category,
    title: t.title,
    status: statusOf(t.kind, t.status),
    priority: t.priority,
    source: t.source,
    fixed_version: t.fixed_version || null,
    team_note: t.status_note || null,
    last_team_comment: t.last_admin_comment ?? undefined,
    needs_action: t.author.me ? (t.status === "verify" && t.kind === "bug" ? "verify" : t.status === "need_info" ? "need_info" : null) : null,
    is_mine: t.author.me,
    me_too: t.kind === "bug" ? t.my_confirm : t.my_vote,
    counts: { confirms: t.confirms, votes: t.votes, comments: t.comments },
    duplicate_of: t.duplicate_of,
    created: iso(t.created),
    updated: iso(t.updated),
  };
}

function fullOut(t, origin) {
  return {
    ...briefOut(t),
    last_team_comment: undefined,
    description: t.description,
    steps: t.steps || null,
    expected: t.expected || null,
    actual: t.actual || null,
    frequency: t.frequency || null,
    how_it_works: t.how_it_works || null,
    purpose: t.purpose || null,
    device: t.device,
    author: { name: t.author.name, is_me: t.author.me, is_team: t.author.is_admin },
    attachments: t.attachments.map(appAtt),
    comments: t.comment_list.filter((c) => !c.deleted).map((c) => ({
      id: c.id,
      kind: c.kind,
      text: c.body,
      author: { name: c.author.name, is_team: c.author.is_admin, is_author: c.author.is_author, is_me: c.author.me },
      attachments: c.attachments.map(appAtt),
      created: iso(c.created),
    })),
    history: t.history.map((h) => ({ field: h.field, from: h.old ?? null, to: h.new ?? null, note: h.note || null, by: h.actor, by_team: h.actor_is_admin, at: iso(h.created) })),
    can: { comment: t.can.comment, verify: t.can.verify, me_too: t.kind === "bug" ? t.can.confirm : !t.author.me },
    web_url: origin + (t.kind === "bug" ? "/bugs/" : "/ideas/") + t.code,
  };
}

// ---------- auth ----------

async function appSession(req, e) {
  const m = /^Bearer\s+(qat_[a-f0-9]{48})$/i.exec(req.headers.get("authorization") || "");
  if (!m) fail(401, "Требуется подключение приложения к аккаунту", { code: "unauthorized" });
  const row = await e.DB.prepare(
    `SELECT k.id kid,k.last_used,k.revoked,u.id,u.nick,u.first_name,u.last_name,u.username,u.notify_tg,u.tg_id,u.banned,u.deleted,u.created
     FROM portal_app_tokens k JOIN portal_users u ON u.id=k.user_id WHERE k.token_hash=?`,
  ).bind(await sha256(m[1])).first();
  const t = now();
  if (!row || row.revoked || row.last_used < t - TOKEN_IDLE_TTL) fail(401, "Подключение отозвано или устарело. Подключите приложение заново.", { code: "token_revoked" });
  if (row.banned || row.deleted) fail(403, "Доступ к порталу закрыт", { code: "account_disabled" });
  if (t - row.last_used > 300) await e.DB.batch([
    e.DB.prepare("UPDATE portal_app_tokens SET last_used=? WHERE id=?").bind(t, row.kid),
    e.DB.prepare("UPDATE portal_users SET last_seen=? WHERE id=?").bind(t, row.id),
  ]);
  const admins = await adminUserIds(e);
  return {
    user: { id: row.id, nick: row.nick, first_name: row.first_name, last_name: row.last_name, username: row.username, tg_linked: !!row.tg_id, created: row.created },
    session: { hash: "app:" + row.kid, csrf: "" },
    tokenId: row.kid,
    // The app API is a tester API — admin tools stay on the web portal and in the connector.
    isAdmin: false,
    admins,
  };
}

async function readFiles(req, e, ses) {
  const ct = req.headers.get("content-type") || "";
  if (!ct.startsWith("multipart/form-data")) fail(400, "Ожидается multipart/form-data с полями file", { code: "validation" });
  if (Number(req.headers.get("content-length") || 0) > FILES_PER_REQUEST * APP_POLICY.maxBytes + 256 * 1024) fail(413, "Слишком большой запрос", { code: "payload_too_large" });
  await rateLimit(e, "upload:" + ses.user.id, 60, 3600);
  let form;
  try {
    form = await req.formData();
  } catch {
    fail(400, "Не удалось прочитать файлы", { code: "validation" });
  }
  const files = form.getAll("file").filter((f) => f && typeof f !== "string");
  if (!files.length) fail(400, "Файлы не переданы (поле file)", { code: "validation" });
  if (files.length > FILES_PER_REQUEST) fail(400, `Не больше ${FILES_PER_REQUEST} файлов за раз`, { code: "too_many_files" });
  // Validate everything before storing anything (all-or-nothing).
  for (const f of files) {
    if (f.size > APP_POLICY.maxBytes) fail(413, `Файл «${f.name}» больше ${APP_POLICY.maxBytes / 1048576} МБ`, { code: "file_too_large" });
    if (f.size <= 0) fail(400, `Файл «${f.name}» пустой`, { code: "validation" });
    const head = new Uint8Array(await f.slice(0, 8192).arrayBuffer());
    const mime = sniff(head, f.type, f.name);
    if (!mime || !APP_POLICY.allowed.includes(mime)) fail(415, APP_POLICY.message.replace("Этот тип", `Тип файла «${f.name}»`), { code: "unsupported_file" });
  }
  const out = [];
  for (const f of files) out.push(await storeFile(e, ses.user.id, f, APP_POLICY));
  return out;
}

function attIds(body) {
  const ids = body.attachments ?? [];
  if (!Array.isArray(ids) || ids.some((x) => typeof x !== "string")) fail(400, "attachments — массив id строк", { code: "validation" });
  if (ids.length > FILES_PER_REQUEST) fail(400, `Не больше ${FILES_PER_REQUEST} вложений`, { code: "too_many_files" });
  return ids;
}

async function checkOwnAttachments(e, ses, ids) {
  for (const id of ids) {
    const a = await e.DB.prepare("SELECT ticket_id,user_id FROM portal_attachments WHERE id=?").bind(id).first();
    if (!a || a.user_id !== ses.user.id) fail(400, "Вложение " + id + " не найдено — сначала загрузите его", { code: "attachment_not_found" });
    if (a.ticket_id) fail(409, "Вложение " + id + " уже прикреплено", { code: "attachment_used" });
  }
}

async function commentLimit(e, ses) {
  await rateLimit(e, "app-comment:" + ses.user.id, COMMENTS_PER_HOUR, 3600);
}

/** Saves the device reported by the app into the profile (so the web portal knows it too). */
async function rememberDevice(e, ses, d) {
  const t = now();
  const ex = await e.DB.prepare("SELECT id FROM portal_devices WHERE user_id=? AND lower(model)=lower(?)").bind(ses.user.id, d.model).first();
  if (ex) {
    await e.DB.prepare("UPDATE portal_devices SET android=?,app_version=?,firmware=?,updated=? WHERE id=?").bind(d.android, d.app_version, d.firmware, t, ex.id).run();
    return;
  }
  const n = await e.DB.prepare("SELECT COUNT(*) n FROM portal_devices WHERE user_id=?").bind(ses.user.id).first();
  if (n.n >= LIMITS.devicesPerUser) return;
  const r = await e.DB.prepare("INSERT INTO portal_devices(user_id,model,android,app_version,firmware,created,updated) VALUES(?,?,?,?,?,?,?)").bind(ses.user.id, d.model, d.android, d.app_version, d.firmware, t, t).run();
  if (n.n === 0) await e.DB.prepare("UPDATE portal_users SET active_device=? WHERE id=?").bind(r.meta.last_row_id, ses.user.id).run();
}

// ---------- router ----------

export async function handleAppApi(req, e, ctx, url) {
  try {
    const path = url.pathname.slice(APP_PREFIX.length) || "/";
    const seg = path.split("/").filter(Boolean);
    const method = req.method;
    const origin = url.origin;

    if (path === "/meta" && method === "GET") {
      return json({
        api_version: 1,
        current_version: await getSetting(e, "current_version", "3.0"),
        categories: META.categories.map(({ id, label }) => ({ code: id, label })),
        frequencies: META.frequencies.map(({ id, label }) => ({ code: id, label })),
        bug_statuses: META.bugStatuses.map((s) => ({ code: s.id, label: s.label, emoji: s.emoji, color: s.color, description: s.desc })),
        idea_statuses: META.ideaStatuses.map((s) => ({ code: s.id, label: s.label, emoji: s.emoji, color: s.color, description: s.desc })),
        priorities: META.priorities.map(({ id, label }) => ({ code: id, label })),
        limits: {
          attachment_max_bytes: APP_POLICY.maxBytes,
          attachments_per_request: FILES_PER_REQUEST,
          attachment_types: APP_POLICY.allowed,
          tickets_per_hour: TICKETS_PER_HOUR,
          comments_per_hour: COMMENTS_PER_HOUR,
          title: { min: 4, max: LIMITS.title },
          description: { min: 10, max: LIMITS.text },
          steps: { min: 5, max: LIMITS.text },
          expected_actual_purpose_max: LIMITS.short,
          how_it_works_max: LIMITS.text,
          comment_max: LIMITS.comment,
        },
      });
    }
    if (path === "/link/start" && method === "POST") return await linkStart(req, e, await readBody(req));
    if (path === "/link/poll" && method === "POST") return await linkPoll(req, e, await readBody(req));

    const ses = await appSession(req, e);

    if (path === "/me" && method === "GET") {
      const mine = await e.DB.prepare(
        "SELECT SUM(kind='bug') bugs, SUM(kind='idea') ideas, SUM(kind='bug' AND status='verify') verify, SUM(status='need_info') need_info FROM portal_tickets WHERE author_id=?",
      ).bind(ses.user.id).first();
      const unread = await e.DB.prepare("SELECT COUNT(*) n FROM portal_notifications WHERE user_id=? AND read=0").bind(ses.user.id).first();
      return json({
        user: { name: displayName(ses.user), telegram_linked: ses.user.tg_linked, joined: iso(ses.user.created) },
        counts: { bugs: mine?.bugs || 0, ideas: mine?.ideas || 0, needs_verify: mine?.verify || 0, needs_info: mine?.need_info || 0, unread_notifications: unread?.n || 0 },
      });
    }
    if (path === "/logout" && method === "POST") {
      await e.DB.prepare("UPDATE portal_app_tokens SET revoked=1 WHERE id=?").bind(ses.tokenId).run();
      return json({ ok: true });
    }
    if (path === "/attachments" && method === "POST") return json({ attachments: await readFiles(req, e, ses) }, 201);
    if (seg[0] === "attachments" && seg[1] && (method === "GET" || method === "HEAD")) {
      return await serveFile(req, e, ses, seg[1], (tid) => T.canSeeTicketId(e, ses, tid));
    }
    if (path === "/similar" && method === "POST") {
      const b = await readBody(req);
      if (!clean(b.title, 140)) fail(400, "Укажите title", { code: "validation" });
      const r = await T.findSimilar(e, ses, { kind: oneOf(b.kind, ["bug", "idea"], "bug"), title: b.title, description: b.description, category: b.category });
      return json({ items: r.items.map((x) => ({ code: x.code, title: x.title, category: x.category, status: statusOf(oneOf(b.kind, ["bug", "idea"], "bug"), x.status), counts: { confirms: x.confirms, votes: x.votes }, score: x.score, created: iso(x.created) })) });
    }
    if (path === "/tickets" && method === "POST") {
      const b = await readBody(req);
      const kind = oneOf(b.kind, ["bug", "idea"]);
      if (!kind) fail(400, "kind должен быть bug или idea", { code: "validation" });
      const device = T.readAppDevice(b.device);
      const ids = attIds(b);
      await checkOwnAttachments(e, ses, ids);
      await rateLimit(e, "app-create:" + ses.user.id, TICKETS_PER_HOUR, 3600);
      const r = await T.createTicket(e, ctx, ses, { ...b, kind, attachments: ids, device_id: undefined }, { source: "app", device });
      await rememberDevice(e, ses, device);
      return json({ ticket: fullOut(await T.ticketDetail(e, ses, r.code), origin) }, 201);
    }
    if (path === "/tickets" && method === "GET") {
      const q = url.searchParams;
      const scope = oneOf(q.get("scope"), ["mine", "all"], "mine");
      const p = new URLSearchParams({ kind: oneOf(q.get("kind"), ["bug", "idea"], "bug"), scope, pinfirst: "0", sort: scope === "mine" ? "updated" : oneOf(q.get("sort"), ["new", "activity", "votes", "updated"], "new") });
      for (const k of ["status", "q", "category"]) if (q.get(k)) p.set(k, q.get(k));
      const since = Date.parse(q.get("updated_since") || "");
      if (!Number.isNaN(since)) p.set("updated_after", String(Math.floor(since / 1000)));
      p.set("limit", String(Math.min(50, Math.max(1, Number(q.get("limit")) || 20))));
      p.set("page", String(Math.max(0, Number(q.get("page")) || 0)));
      const r = await T.listTickets(e, ses, p);
      return json({ items: r.items.map(briefOut), total: r.total, page: r.page, has_more: r.more });
    }
    if (seg[0] === "tickets" && seg[1]) {
      const code = decodeURIComponent(seg[1]).toUpperCase();
      const action = seg[2];
      if (!action && method === "GET") return json({ ticket: fullOut(await T.ticketDetail(e, ses, code), origin) });
      if (action === "comments" && method === "POST") {
        const b = await readBody(req);
        const ids = attIds(b);
        await checkOwnAttachments(e, ses, ids);
        if (!clean(b.text, LIMITS.comment) && !ids.length) fail(400, "Комментарий пустой", { code: "validation" });
        await commentLimit(e, ses);
        const r = await T.addComment(e, ctx, ses, code, { body: b.text, attachments: ids, kind: b.addendum ? "addendum" : "comment" });
        return json({ ok: true, comment_id: r.id, ticket: fullOut(await T.ticketDetail(e, ses, code), origin) }, 201);
      }
      if (action === "me-too" && (method === "POST" || method === "DELETE")) {
        const t = await T.ticketDetail(e, ses, code);
        if (t.author.me) fail(409, t.kind === "bug" ? "Это ваш отчёт" : "Нельзя голосовать за своё предложение", { code: "own_ticket" });
        const on = method === "POST";
        const b = on ? await readBody(req) : {};
        const ids = on ? attIds(b) : [];
        if (on) await checkOwnAttachments(e, ses, ids);
        if (on && (clean(b.comment, LIMITS.comment) || ids.length)) await commentLimit(e, ses);
        const r = t.kind === "bug" ? await T.confirmBug(e, ses, code, { on }) : await T.vote(e, ses, code, { on });
        if (on && (clean(b.comment, LIMITS.comment) || ids.length)) {
          await T.addComment(e, ctx, ses, code, { body: clean(b.comment, LIMITS.comment) || (t.kind === "bug" ? "Встречается и у меня." : "Поддерживаю."), attachments: ids });
        }
        return json({ ok: true, me_too: r.on, counts: { confirms: r.confirms ?? t.confirms, votes: r.votes ?? t.votes } });
      }
      if (action === "verify" && method === "POST") {
        const b = await readBody(req);
        const result = { fixed: "fixed", not_fixed: "still" }[b.result];
        if (!result) fail(400, "result должен быть fixed или not_fixed", { code: "validation" });
        const ids = attIds(b);
        await checkOwnAttachments(e, ses, ids);
        await commentLimit(e, ses);
        await T.verifyFix(e, ctx, ses, code, { result, note: b.comment });
        if (ids.length) await T.addComment(e, ctx, ses, code, { body: "Вложения к проверке исправления", attachments: ids });
        return json({ ok: true, ticket: fullOut(await T.ticketDetail(e, ses, code), origin) });
      }
    }
    if (path === "/notifications" && method === "GET") {
      const unreadOnly = url.searchParams.get("unread") === "1";
      const rows = (await e.DB.prepare(
        `SELECT n.id,n.type,n.text,n.created,n.read,t.code FROM portal_notifications n LEFT JOIN portal_tickets t ON t.id=n.ticket_id
         WHERE n.user_id=? ${unreadOnly ? "AND n.read=0" : ""} ORDER BY n.id DESC LIMIT 50`,
      ).bind(ses.user.id).all()).results || [];
      return json({ items: rows.map((r) => ({ id: r.id, type: r.type, text: r.text, ticket: r.code || null, read: !!r.read, created: iso(r.created) })) });
    }
    if (path === "/notifications/read" && method === "POST") {
      const b = await readBody(req);
      if (Array.isArray(b.ids) && b.ids.length) {
        const ids = b.ids.map(Number).filter(Number.isSafeInteger).slice(0, 90);
        await e.DB.prepare(`UPDATE portal_notifications SET read=1 WHERE user_id=? AND id IN (${ids.map(() => "?").join(",")})`).bind(ses.user.id, ...ids).run();
      } else await e.DB.prepare("UPDATE portal_notifications SET read=1 WHERE user_id=?").bind(ses.user.id).run();
      return json({ ok: true });
    }
    fail(404, "Метод API не найден", { code: "not_found" });
  } catch (err) {
    return appError(err);
  }
}
