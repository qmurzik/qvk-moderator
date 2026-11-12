// QVK Beta Portal — bug reports & ideas.
import {
  BUG_STATUS_IDS, IDEA_STATUS_IDS, CATEGORY_IDS, FREQUENCY_IDS, PRIORITY_IDS, PRIORITIES, LIMITS,
  KNOWN_ISSUE_STATUSES, OPEN_BUG_STATUSES, statusLabel,
} from "./constants.js";
import { now, fail, clean, oneOf, likeEscape, getSetting, bump, rateLimit, displayName } from "./util.js";
import { notify, notifyAdmins } from "./notify.js";
import { queuePushForUser, drainOutbox } from "./broadcast.js";
import { tg, escapeTgHtml } from "./telegram.js";
import { linkAttachments } from "./files.js";

export const CODE_RE = /^(BUG|IDEA)-(\d{1,7})$/;
const kindOfCode = (code) => (String(code).startsWith("BUG-") ? "bug" : "idea");
const statusIds = (kind) => (kind === "bug" ? BUG_STATUS_IDS : IDEA_STATUS_IDS);
const resolvedStatuses = ["fixed", "closed", "done"];

/** Case-insensitive search text (SQLite LIKE only folds ASCII, so Cyrillic is lower-cased here). */
export const searchText = (o) => [o.code, o.title, o.description, o.steps, o.expected, o.actual, o.how_it_works, o.purpose].filter(Boolean).join("\n").toLowerCase().replace(/ё/g, "е").slice(0, 20000);
const normQuery = (q) => String(q).toLowerCase().replace(/ё/g, "е");

const AUTHOR_COLS = "u.nick AS a_nick,u.first_name AS a_first,u.last_name AS a_last,u.username AS a_username,u.deleted AS a_deleted";

export function shapeTicket(r, ses) {
  const author = { id: r.author_id, nick: r.a_nick, first_name: r.a_first, last_name: r.a_last, username: r.a_username, deleted: r.a_deleted };
  const out = {
    id: r.id, code: r.code, kind: r.kind, category: r.category, title: r.title,
    description: r.description, steps: r.steps, expected: r.expected, actual: r.actual, frequency: r.frequency,
    how_it_works: r.how_it_works, purpose: r.purpose,
    device: { model: r.device_model, android: r.android, app_version: r.app_version, firmware: r.firmware },
    status: r.status, priority: r.priority, fixed_version: r.fixed_version, status_note: r.status_note,
    pinned: !!r.pinned, hidden: !!r.hidden, duplicate_of: r.dup_code || null, source: r.source || "web",
    votes: r.votes, confirms: r.confirms, comments: r.comments,
    created: r.created, updated: r.updated, activity: r.activity, resolved: r.resolved,
    author: { name: displayName(author), is_admin: !!ses.admins?.has(r.author_id), me: r.author_id === ses.user.id },
    my_vote: !!r.my_vote, my_confirm: !!r.my_confirm, my_fav: !!r.my_fav,
  };
  if (ses.isAdmin) {
    out.author.id = r.author_id;
    out.author.username = r.a_username || null;
  }
  if (r.last_admin !== undefined) out.last_admin_comment = r.last_admin || null;
  return out;
}

function adminInList(ses) {
  const list = [...(ses.admins || [])];
  return { sql: list.length ? "(" + list.map(() => "?").join(",") + ")" : "('')", binds: list };
}

async function loadTicket(e, ses, code) {
  if (!CODE_RE.test(String(code || ""))) fail(404, "Обращение не найдено");
  const r = await e.DB.prepare(
    `SELECT t.*,${AUTHOR_COLS},d.code AS dup_code,
      EXISTS(SELECT 1 FROM portal_votes v WHERE v.ticket_id=t.id AND v.user_id=?) AS my_vote,
      EXISTS(SELECT 1 FROM portal_confirms c WHERE c.ticket_id=t.id AND c.user_id=?) AS my_confirm,
      EXISTS(SELECT 1 FROM portal_favorites f WHERE f.ticket_id=t.id AND f.user_id=?) AS my_fav
     FROM portal_tickets t LEFT JOIN portal_users u ON u.id=t.author_id LEFT JOIN portal_tickets d ON d.id=t.duplicate_of
     WHERE t.code=?`,
  ).bind(ses.user.id, ses.user.id, ses.user.id, code).first();
  if (!r) fail(404, "Обращение не найдено");
  if (r.hidden && !ses.isAdmin && r.author_id !== ses.user.id) fail(404, "Обращение не найдено");
  return r;
}

export async function canSeeTicketId(e, ses, ticketId) {
  if (ses.isAdmin) return true;
  const r = await e.DB.prepare("SELECT hidden,author_id FROM portal_tickets WHERE id=?").bind(ticketId).first();
  return !!r && (!r.hidden || r.author_id === ses.user.id);
}

// ---------- listing ----------

export async function listTickets(e, ses, q) {
  const kind = oneOf(q.get("kind"), ["bug", "idea"], "bug");
  const where = ["t.kind=?"];
  const binds = [kind];
  if (!ses.isAdmin) {
    where.push("(t.hidden=0 OR t.author_id=?)");
    binds.push(ses.user.id);
  }
  const scope = q.get("scope") || "all";
  if (scope === "mine") {
    where.push("t.author_id=?");
    binds.push(ses.user.id);
  } else if (scope === "fav") {
    where.push("EXISTS(SELECT 1 FROM portal_favorites f2 WHERE f2.ticket_id=t.id AND f2.user_id=?)");
    binds.push(ses.user.id);
  }
  const statuses = String(q.get("status") || "").split(",").filter((s) => statusIds(kind).includes(s));
  if (q.get("status") === "open") statuses.push(...(kind === "bug" ? OPEN_BUG_STATUSES : ["new", "review", "planned", "in_progress"]));
  if (statuses.length) {
    where.push("t.status IN (" + statuses.map(() => "?").join(",") + ")");
    binds.push(...statuses);
  }
  const category = oneOf(q.get("category"), CATEGORY_IDS);
  if (category) {
    where.push("t.category=?");
    binds.push(category);
  }
  const priority = oneOf(q.get("priority"), PRIORITY_IDS);
  if (priority) {
    where.push("t.priority=?");
    binds.push(priority);
  }
  const version = clean(q.get("version"), 32, { multiline: false });
  if (version) {
    where.push("t.app_version=?");
    binds.push(version);
  }
  const android = clean(q.get("android"), 20, { multiline: false });
  if (android) {
    where.push("t.android=?");
    binds.push(android);
  }
  const device = clean(q.get("device"), 60, { multiline: false });
  if (device) {
    where.push("t.device_model LIKE ? ESCAPE '\\'");
    binds.push("%" + likeEscape(device) + "%");
  }
  if (q.get("pinned") === "1") where.push("t.pinned=1");
  if (/^\d{1,12}$/.test(q.get("updated_after") || "")) {
    where.push("t.updated>?");
    binds.push(Number(q.get("updated_after")));
  }
  if (ses.isAdmin && q.get("hidden") === "1") where.push("t.hidden=1");
  if (ses.isAdmin && /^u[a-z0-9]{15}$/.test(q.get("author") || "")) {
    where.push("t.author_id=?");
    binds.push(q.get("author"));
  }
  const search = clean(q.get("q"), 100, { multiline: false });
  if (search) {
    where.push("(t.code=? OR t.search LIKE ? ESCAPE '\\')");
    binds.push(search.toUpperCase(), "%" + likeEscape(normQuery(search)) + "%");
  }
  const prioritySql = "CASE t.priority " + PRIORITIES.map((p) => `WHEN '${p.id}' THEN ${p.weight}`).join(" ") + " ELSE 0 END";
  const sorts = {
    new: "t.created DESC",
    old: "t.created ASC",
    priority: prioritySql + " DESC, t.created DESC",
    activity: "t.activity DESC",
    updated: "t.updated DESC",
    votes: kind === "idea" ? "t.votes DESC, t.created DESC" : "t.confirms DESC, t.created DESC",
  };
  const sortKey = oneOf(q.get("sort"), Object.keys(sorts), scope === "mine" ? "updated" : "new");
  const order = (scope === "all" && q.get("pinfirst") !== "0" ? "t.pinned DESC, " : "") + sorts[sortKey];
  const limit = Math.min(100, Math.max(1, Number(q.get("limit")) || 30));
  const page = Math.max(0, Number(q.get("page")) || 0);
  const adm = adminInList(ses);
  const withAdminNote = scope === "mine";
  const sql = `SELECT t.*,${AUTHOR_COLS},d.code AS dup_code,
      EXISTS(SELECT 1 FROM portal_votes v WHERE v.ticket_id=t.id AND v.user_id=?) AS my_vote,
      EXISTS(SELECT 1 FROM portal_confirms c WHERE c.ticket_id=t.id AND c.user_id=?) AS my_confirm,
      EXISTS(SELECT 1 FROM portal_favorites f WHERE f.ticket_id=t.id AND f.user_id=?) AS my_fav
      ${withAdminNote ? `,(SELECT body FROM portal_comments c2 WHERE c2.ticket_id=t.id AND c2.deleted=0 AND c2.user_id IN ${adm.sql} ORDER BY c2.id DESC LIMIT 1) AS last_admin` : ""}
     FROM portal_tickets t LEFT JOIN portal_users u ON u.id=t.author_id LEFT JOIN portal_tickets d ON d.id=t.duplicate_of
     WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ? OFFSET ?`;
  const allBinds = [ses.user.id, ses.user.id, ses.user.id, ...(withAdminNote ? adm.binds : []), ...binds, limit + 1, page * limit];
  const rows = (await e.DB.prepare(sql).bind(...allBinds).all()).results || [];
  const total = await e.DB.prepare(`SELECT COUNT(*) n FROM portal_tickets t WHERE ${where.join(" AND ")}`).bind(...binds).first();
  const sesx = { ...ses, e };
  return { items: rows.slice(0, limit).map((r) => shapeTicket(r, sesx)), more: rows.length > limit, total: total?.n || 0, page };
}

// ---------- detail ----------

export async function ticketDetail(e, ses, code) {
  const r = await loadTicket(e, ses, code);
  const sesx = { ...ses, e };
  const t = shapeTicket(r, sesx);
  const comments = (await e.DB.prepare(
    `SELECT c.id,c.user_id,c.kind,c.body,c.created,c.edited,c.deleted,u.nick,u.first_name,u.last_name,u.username,u.deleted AS udel
     FROM portal_comments c LEFT JOIN portal_users u ON u.id=c.user_id WHERE c.ticket_id=? ORDER BY c.id LIMIT 500`,
  ).bind(r.id).all()).results || [];
  const atts = (await e.DB.prepare("SELECT id,comment_id,name,mime,size,user_id FROM portal_attachments WHERE ticket_id=? ORDER BY created").bind(r.id).all()).results || [];
  const history = (await e.DB.prepare(
    `SELECT h.field,h.old,h.new,h.note,h.created,h.actor_id,u.nick,u.first_name,u.last_name,u.username,u.deleted AS udel
     FROM portal_history h LEFT JOIN portal_users u ON u.id=h.actor_id WHERE h.ticket_id=? ORDER BY h.id LIMIT 300`,
  ).bind(r.id).all()).results || [];
  const dups = (await e.DB.prepare("SELECT code,title,status FROM portal_tickets WHERE duplicate_of=? ORDER BY id").bind(r.id).all()).results || [];
  const shapeAtt = (a) => ({ id: a.id, name: a.name, mime: a.mime, size: a.size, url: "/files/" + a.id });
  t.attachments = atts.filter((a) => !a.comment_id).map(shapeAtt);
  t.comment_list = comments.map((c) => ({
    id: c.id,
    kind: c.kind,
    body: c.deleted ? "" : c.body,
    deleted: !!c.deleted,
    created: c.created,
    edited: c.edited,
    author: { name: displayName({ id: c.user_id, nick: c.nick, first_name: c.first_name, last_name: c.last_name, username: c.username, deleted: c.udel }), is_admin: !!ses.admins?.has(c.user_id), me: c.user_id === ses.user.id, is_author: c.user_id === r.author_id },
    can_delete: !c.deleted && (ses.isAdmin || c.user_id === ses.user.id),
    attachments: c.deleted ? [] : atts.filter((a) => a.comment_id === c.id).map(shapeAtt),
  }));
  t.history = history.map((h) => ({
    field: h.field, old: h.old, new: h.new, note: h.note, created: h.created,
    actor: displayName({ id: h.actor_id, nick: h.nick, first_name: h.first_name, last_name: h.last_name, username: h.username, deleted: h.udel }),
    actor_is_admin: !!ses.admins?.has(h.actor_id),
  }));
  t.duplicates = dups;
  const commentsPublic = (await getSetting(e, "comments_public", "on")) === "on";
  const isAuthor = r.author_id === ses.user.id;
  t.can = {
    comment: ses.isAdmin || isAuthor || commentsPublic,
    addendum: isAuthor,
    edit: ses.isAdmin || (isAuthor && (r.kind === "bug" ? ["new", "need_info"] : ["new", "review"]).includes(r.status)),
    verify: isAuthor && r.kind === "bug" && r.status === "verify",
    confirm: !isAuthor && r.kind === "bug" && !["duplicate"].includes(r.status),
    vote: r.kind === "idea",
    admin: ses.isAdmin,
  };
  return t;
}

// ---------- create / edit ----------

function readFields(kind, body, partial = false) {
  const f = {};
  const want = (k, max, min, label) => {
    if (partial && body[k] === undefined) return;
    const v = clean(body[k], max, { multiline: k !== "title" });
    if (min && v.length < min) fail(400, `Поле «${label}» слишком короткое (минимум ${min} симв.)`);
    f[k] = v;
  };
  if (!partial || body.category !== undefined) {
    f.category = oneOf(body.category, CATEGORY_IDS);
    if (!f.category) fail(400, "Выберите категорию");
  }
  want("title", LIMITS.title, 4, "Название");
  want("description", LIMITS.text, 10, "Описание");
  if (kind === "bug") {
    want("steps", LIMITS.text, 5, "Как воспроизвести");
    want("expected", LIMITS.short, 0, "Ожидаемый результат");
    want("actual", LIMITS.short, 0, "Фактический результат");
    if (!partial || body.frequency !== undefined) {
      f.frequency = oneOf(body.frequency, FREQUENCY_IDS);
      if (!f.frequency) fail(400, "Укажите частоту возникновения");
    }
  } else {
    want("how_it_works", LIMITS.text, 0, "Как это должно работать");
    want("purpose", LIMITS.short, 0, "Для чего это нужно");
  }
  return f;
}

/** Validates a device described by the QVK app (not a saved profile device). */
export function readAppDevice(d) {
  if (!d || typeof d !== "object") fail(400, "Не переданы данные устройства", { code: "validation" });
  const out = {
    model: clean(d.model, 60, { multiline: false }),
    android: clean(d.android, 20, { multiline: false }),
    app_version: clean(d.app_version, 64, { multiline: false }),
    firmware: clean(d.firmware, 80, { multiline: false }) || null,
  };
  if (out.model.length < 2) fail(400, "Не указана модель устройства", { code: "validation" });
  if (!out.android) fail(400, "Не указана версия Android", { code: "validation" });
  if (!out.app_version) fail(400, "Не указана версия приложения", { code: "validation" });
  return out;
}

export async function createTicket(e, ctx, ses, body, opts = {}) {
  const kind = oneOf(body.kind, ["bug", "idea"]);
  if (!kind) fail(400, "Неизвестный тип обращения");
  await rateLimit(e, "create:" + ses.user.id, 12, 3600);
  const f = readFields(kind, body);
  let device = null;
  if (opts.device) device = opts.device;
  else if (body.device_id != null) {
    device = await e.DB.prepare("SELECT * FROM portal_devices WHERE id=? AND user_id=?").bind(Number(body.device_id), ses.user.id).first();
    if (!device) fail(400, "Устройство не найдено — выберите его в профиле");
  } else if (kind === "bug") fail(400, "Укажите устройство, на котором возникла ошибка");
  const counter = await e.DB.prepare("UPDATE portal_counters SET n=n+1 WHERE kind=? RETURNING n").bind(kind).first();
  const num = counter.n;
  const code = (kind === "bug" ? "BUG-" : "IDEA-") + String(num).padStart(4, "0");
  const t = now();
  const res = await e.DB.prepare(
    `INSERT INTO portal_tickets(kind,num,code,author_id,category,title,description,steps,expected,actual,frequency,how_it_works,purpose,device_model,android,app_version,firmware,status,priority,created,updated,activity,search,source)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    kind, num, code, ses.user.id, f.category, f.title, f.description, f.steps || "", f.expected || "", f.actual || "", f.frequency || null,
    f.how_it_works || "", f.purpose || "", device?.model || null, device?.android || null, device?.app_version || null, device?.firmware || null,
    "new", "normal", t, t, t, searchText({ code, ...f }), opts.source === "app" ? "app" : "web",
  ).run();
  const id = res.meta.last_row_id;
  await e.DB.batch([
    e.DB.prepare("INSERT INTO portal_history(ticket_id,actor_id,field,old,new,created) VALUES(?,?,?,?,?,?)").bind(id, ses.user.id, "created", null, "new", t),
    e.DB.prepare("DELETE FROM portal_drafts WHERE user_id=? AND kind=?").bind(ses.user.id, kind),
  ]);
  await linkAttachments(e, ses.user.id, body.attachments, id);
  await bump(e);
  if (body.request_logs === true && opts.source !== "app") await requestLogs(e, ctx, ses, code, { byAuthor: true });
  await notifyAdmins(e, ctx, ses.user.id, { id, code, kind }, (kind === "bug" ? "🐛 Новый баг " : "💡 Новое предложение ") + code + (opts.source === "app" ? " · 📱 из приложения" : "") + "\n" + f.title + "\nАвтор: " + displayName(ses.user));
  return { ok: true, code };
}

export async function editTicket(e, ctx, ses, code, body) {
  const r = await loadTicket(e, ses, code);
  const isAuthor = r.author_id === ses.user.id;
  const editable = r.kind === "bug" ? ["new", "need_info"] : ["new", "review"];
  if (!ses.isAdmin && !(isAuthor && editable.includes(r.status))) fail(403, "Редактирование недоступно для текущего статуса");
  const f = readFields(r.kind, body, true);
  const keys = Object.keys(f).filter((k) => f[k] !== r[k]);
  if (!keys.length) return { ok: true, code };
  const t = now();
  await e.DB.prepare(`UPDATE portal_tickets SET ${keys.map((k) => k + "=?").join(",")},updated=?,activity=?,search=? WHERE id=?`).bind(...keys.map((k) => f[k]), t, t, searchText({ ...r, ...f }), r.id).run();
  await e.DB.prepare("INSERT INTO portal_history(ticket_id,actor_id,field,old,new,created) VALUES(?,?,?,?,?,?)").bind(r.id, ses.user.id, "edited", null, keys.join(","), t).run();
  await bump(e);
  if (isAuthor && r.status === "need_info") await notifyAdmins(e, ctx, ses.user.id, r, `✏️ Автор дополнил ${code} (статус «Недостаточно данных»)`);
  return { ok: true, code };
}

// ---------- reactions ----------

async function toggle(e, table, ticketId, userId, on) {
  if (on) {
    const r = await e.DB.prepare(`INSERT OR IGNORE INTO ${table}(ticket_id,user_id,created) VALUES(?,?,?)`).bind(ticketId, userId, now()).run();
    return r.meta?.changes > 0;
  }
  const r = await e.DB.prepare(`DELETE FROM ${table} WHERE ticket_id=? AND user_id=?`).bind(ticketId, userId).run();
  return r.meta?.changes > 0;
}

export async function vote(e, ses, code, body) {
  const r = await loadTicket(e, ses, code);
  if (r.kind !== "idea") fail(400, "Голосовать можно только за предложения");
  await rateLimit(e, "react:" + ses.user.id, 150, 600);
  const on = body.on === undefined ? !r.my_vote : !!body.on;
  await toggle(e, "portal_votes", r.id, ses.user.id, on);
  await e.DB.prepare("UPDATE portal_tickets SET votes=(SELECT COUNT(*) FROM portal_votes WHERE ticket_id=?),activity=? WHERE id=?").bind(r.id, now(), r.id).run();
  const n = await e.DB.prepare("SELECT votes FROM portal_tickets WHERE id=?").bind(r.id).first();
  await bump(e);
  return { ok: true, on, votes: n.votes };
}

export async function confirmBug(e, ses, code, body) {
  const r = await loadTicket(e, ses, code);
  if (r.kind !== "bug") fail(400, "Подтверждать можно только ошибки");
  if (r.author_id === ses.user.id) fail(400, "Это ваш отчёт");
  await rateLimit(e, "react:" + ses.user.id, 150, 600);
  const on = body.on === undefined ? !r.my_confirm : !!body.on;
  await toggle(e, "portal_confirms", r.id, ses.user.id, on);
  await e.DB.prepare("UPDATE portal_tickets SET confirms=(SELECT COUNT(*) FROM portal_confirms WHERE ticket_id=?),activity=? WHERE id=?").bind(r.id, now(), r.id).run();
  const n = await e.DB.prepare("SELECT confirms FROM portal_tickets WHERE id=?").bind(r.id).first();
  await bump(e);
  return { ok: true, on, confirms: n.confirms };
}

export async function favorite(e, ses, code, body) {
  const r = await loadTicket(e, ses, code);
  const on = body.on === undefined ? !r.my_fav : !!body.on;
  if (on) await e.DB.prepare("INSERT OR IGNORE INTO portal_favorites(user_id,ticket_id,created) VALUES(?,?,?)").bind(ses.user.id, r.id, now()).run();
  else await e.DB.prepare("DELETE FROM portal_favorites WHERE user_id=? AND ticket_id=?").bind(ses.user.id, r.id).run();
  return { ok: true, on };
}

// ---------- comments ----------

export async function addComment(e, ctx, ses, code, body) {
  const r = await loadTicket(e, ses, code);
  const isAuthor = r.author_id === ses.user.id;
  const commentsPublic = (await getSetting(e, "comments_public", "on")) === "on";
  if (!ses.isAdmin && !isAuthor && !commentsPublic) fail(403, "Комментарии сейчас доступны только автору и администрации");
  await rateLimit(e, "comment:" + ses.user.id, 30, 600);
  const text = clean(body.body, LIMITS.comment);
  const hasFiles = Array.isArray(body.attachments) && body.attachments.length > 0;
  if (text.length < 1 && !hasFiles) fail(400, "Комментарий пустой");
  const kind = body.kind === "addendum" && isAuthor ? "addendum" : "comment";
  const t = now();
  const res = await e.DB.prepare("INSERT INTO portal_comments(ticket_id,user_id,kind,body,created) VALUES(?,?,?,?,?)").bind(r.id, ses.user.id, kind, text, t).run();
  const cid = res.meta.last_row_id;
  if (hasFiles) await linkAttachments(e, ses.user.id, body.attachments, r.id, cid);
  await e.DB.prepare("UPDATE portal_tickets SET comments=comments+1,activity=?,updated=? WHERE id=?").bind(t, t, r.id).run();
  await bump(e);
  const preview = text.length > 160 ? text.slice(0, 157) + "…" : text;
  if (ses.isAdmin) {
    await notify(e, ctx, { userId: r.author_id, actorId: ses.user.id, ticket: r, type: "comment", text: `💬 Администратор ответил в ${r.code} «${r.title}»:\n${preview}` });
  } else if (isAuthor) {
    await notifyAdmins(e, ctx, ses.user.id, r, `${kind === "addendum" ? "📎 Автор дополнил" : "💬 Автор ответил в"} ${r.code}:\n${preview}`);
  } else {
    await notify(e, ctx, { userId: r.author_id, actorId: ses.user.id, ticket: r, type: "comment", text: `💬 Новый комментарий в ${r.code} от ${displayName(ses.user)}:\n${preview}` });
  }
  return { ok: true, id: cid };
}

export async function deleteComment(e, ses, id) {
  const c = await e.DB.prepare("SELECT id,ticket_id,user_id,deleted FROM portal_comments WHERE id=?").bind(Number(id)).first();
  if (!c || c.deleted) fail(404, "Комментарий не найден");
  if (!ses.isAdmin && c.user_id !== ses.user.id) fail(403, "Нельзя удалить чужой комментарий");
  await e.DB.batch([
    e.DB.prepare("UPDATE portal_comments SET deleted=1 WHERE id=?").bind(c.id),
    e.DB.prepare("UPDATE portal_tickets SET comments=MAX(0,comments-1) WHERE id=?").bind(c.ticket_id),
  ]);
  await bump(e);
  return { ok: true };
}

// ---------- verification by author ----------

// ---------- logs request (picked up by the QVK app via /api/app/v1/notifications) ----------

/**
 * Asks the ticket author's QVK app to upload its log. Creates a "logs_request" notification
 * for the author (the app polls unread notifications) and a history entry.
 * Allowed for admins, and for the author when submitting the report.
 */
export async function requestLogs(e, ctx, ses, code, { byAuthor = false, text = "" } = {}) {
  const r = await loadTicket(e, ses, code);
  const isAuthor = r.author_id === ses.user.id;
  if (!ses.isAdmin && !(byAuthor && isAuthor)) fail(403, "Запросить журнал может только команда");
  const msg = clean(text, 300) || (byAuthor ? `Выгрузите журнал приложения по обращению ${r.code}` : `Пришлите журнал по ${r.code} после повторения бага`);
  const t = now();
  const pending = await e.DB.prepare("SELECT id FROM portal_notifications WHERE user_id=? AND ticket_id=? AND type='logs_request' AND read=0").bind(r.author_id, r.id).first();
  if (!pending) {
    await e.DB.prepare("INSERT INTO portal_notifications(user_id,ticket_id,type,text,created) VALUES(?,?,?,?,?)").bind(r.author_id, r.id, "logs_request", msg, t).run();
  }
  await e.DB.prepare("INSERT INTO portal_history(ticket_id,actor_id,field,old,new,note,created) VALUES(?,?,?,?,?,?,?)").bind(r.id, ses.user.id, "logs_request", null, byAuthor ? "author" : "team", byAuthor ? null : msg, t).run();
  await e.DB.prepare("UPDATE portal_tickets SET activity=? WHERE id=?").bind(t, r.id).run();
  const app = await e.DB.prepare("SELECT COUNT(*) n FROM portal_app_tokens WHERE user_id=? AND revoked=0 AND last_used>?").bind(r.author_id, t - 180 * 86400).first();
  // A team request also reaches the author in Telegram/push, so it isn't missed without the app.
  if (!byAuthor) {
    const u = await e.DB.prepare("SELECT tg_id,notify_tg,tg_blocked FROM portal_users WHERE id=?").bind(r.author_id).first();
    await queuePushForUser(e, r.author_id, { title: "QVK Beta · " + r.code, body: msg, url: "/" + (r.kind === "bug" ? "bugs" : "ideas") + "/" + r.code, tag: r.code });
    const jobs = [drainOutbox(e).catch(() => {})];
    if (u?.tg_id && u.notify_tg && !u.tg_blocked) {
      jobs.push(tg(e, "sendMessage", { chat_id: u.tg_id, parse_mode: "HTML", text: "📄 <b>QVK Beta Portal</b>\n" + escapeTgHtml(msg) + (app.n ? "\n\nОткройте QVK — приложение предложит выгрузить журнал." : "\n\nПриложите журнал к обращению на сайте или подключите приложение QVK в профиле.") }).catch(() => {}));
    }
    const job = Promise.all(jobs);
    if (ctx?.waitUntil) ctx.waitUntil(job);
    else await job;
  }
  await bump(e);
  return { ok: true, already_pending: !!pending, app_connected: app.n > 0 };
}

export async function verifyFix(e, ctx, ses, code, body) {
  const r = await loadTicket(e, ses, code);
  if (r.author_id !== ses.user.id || r.kind !== "bug") fail(403, "Проверить исправление может только автор отчёта");
  if (r.status !== "verify") fail(409, "Отчёт не ожидает проверки");
  const t = now();
  const note = clean(body.note, LIMITS.comment);
  if (body.result === "fixed") {
    await e.DB.batch([
      e.DB.prepare("UPDATE portal_tickets SET status='closed',resolved=COALESCE(resolved,?),updated=?,activity=?,status_note=? WHERE id=?").bind(t, t, t, "Автор подтвердил исправление", r.id),
      e.DB.prepare("INSERT INTO portal_history(ticket_id,actor_id,field,old,new,note,created) VALUES(?,?,?,?,?,?,?)").bind(r.id, ses.user.id, "status", r.status, "closed", "Автор подтвердил исправление", t),
    ]);
    if (note) await e.DB.prepare("INSERT INTO portal_comments(ticket_id,user_id,kind,body,created) VALUES(?,?,?,?,?)").bind(r.id, ses.user.id, "verify", "✅ " + note, t).run();
    await notifyAdmins(e, ctx, ses.user.id, r, `✅ Автор подтвердил исправление ${r.code}`);
  } else if (body.result === "still") {
    await e.DB.batch([
      e.DB.prepare("UPDATE portal_tickets SET status='confirmed',updated=?,activity=?,status_note=?,comments=comments+1 WHERE id=?").bind(t, t, "Автор сообщил, что проблема осталась", r.id),
      e.DB.prepare("INSERT INTO portal_history(ticket_id,actor_id,field,old,new,note,created) VALUES(?,?,?,?,?,?,?)").bind(r.id, ses.user.id, "status", r.status, "confirmed", "Проблема осталась", t),
      e.DB.prepare("INSERT INTO portal_comments(ticket_id,user_id,kind,body,created) VALUES(?,?,?,?,?)").bind(r.id, ses.user.id, "verify", "⚠️ Проблема осталась" + (note ? ": " + note : ""), t),
    ]);
    await notifyAdmins(e, ctx, ses.user.id, r, `⚠️ ${r.code}: автор сообщает, что проблема осталась${note ? "\n" + note : ""}`);
  } else fail(400, "Неизвестный результат проверки");
  await bump(e);
  return { ok: true };
}

// ---------- admin ----------

export async function adminUpdate(e, ctx, ses, code, body, { silentBump = false } = {}) {
  if (!ses.isAdmin) fail(403, "Только для администрации");
  const r = await loadTicket(e, ses, code);
  const t = now();
  const sets = {};
  const hist = [];
  const note = body.note !== undefined ? clean(body.note, LIMITS.comment) : "";
  let newStatus = null;
  if (body.status !== undefined) {
    const s = oneOf(body.status, statusIds(r.kind));
    if (!s) fail(400, "Недопустимый статус");
    if (s !== r.status) {
      newStatus = s;
      sets.status = s;
      sets.status_note = note || null;
      if (resolvedStatuses.includes(s)) sets.resolved = r.resolved || t;
      else if (!["verify"].includes(s)) sets.resolved = null;
      hist.push(["status", r.status, s, note || null]);
    }
  }
  if (body.fixed_version !== undefined || newStatus === "fixed") {
    let v = clean(body.fixed_version, 32, { multiline: false });
    if (!v && newStatus === "fixed") v = r.fixed_version || (await getSetting(e, "current_version", ""));
    if ((v || null) !== (r.fixed_version || null)) {
      sets.fixed_version = v || null;
      hist.push(["fixed_version", r.fixed_version, v || null, null]);
    }
  }
  if (body.priority !== undefined) {
    const p = oneOf(body.priority, PRIORITY_IDS);
    if (!p) fail(400, "Недопустимый приоритет");
    if (p !== r.priority) {
      sets.priority = p;
      hist.push(["priority", r.priority, p, null]);
    }
  }
  for (const flag of ["pinned", "hidden"]) {
    if (body[flag] !== undefined && !!body[flag] !== !!r[flag]) {
      sets[flag] = body[flag] ? 1 : 0;
      hist.push([flag, String(r[flag]), String(sets[flag]), null]);
    }
  }
  if (note && !newStatus && note !== (r.status_note || "")) {
    sets.status_note = note;
    hist.push(["note", null, null, note || null]);
  }
  const keys = Object.keys(sets);
  if (!keys.length) return { ok: true, changed: false };
  await e.DB.prepare(`UPDATE portal_tickets SET ${keys.map((k) => k + "=?").join(",")},updated=?,activity=? WHERE id=?`).bind(...keys.map((k) => sets[k]), t, t, r.id).run();
  await e.DB.batch(hist.map(([field, o, n, nt]) => e.DB.prepare("INSERT INTO portal_history(ticket_id,actor_id,field,old,new,note,created) VALUES(?,?,?,?,?,?,?)").bind(r.id, ses.user.id, field, o ?? null, n ?? null, nt ?? null, t)));
  if (!silentBump) await bump(e);

  // Author notifications.
  const fixedVersion = sets.fixed_version ?? r.fixed_version;
  const why = note ? "\n" + note : "";
  if (newStatus) {
    let type = "status";
    let text = `Статус ${r.code} «${r.title}»: ${statusLabel(r.kind, newStatus)}${why}`;
    if (r.kind === "bug") {
      if (newStatus === "need_info") (type = "need_info"), (text = `⚪ По ${r.code} нужны дополнительные данные${why || ". Откройте отчёт и дополните его."}`);
      if (newStatus === "verify") (type = "verify"), (text = `🔵 Проверьте исправление ${r.code}${fixedVersion ? " в версии " + fixedVersion : ""} и подтвердите результат.${why}`);
      if (newStatus === "fixed") (type = "fixed"), (text = `🟢 Ошибка ${r.code} исправлена${fixedVersion ? " в версии " + fixedVersion : ""}!${why}`);
    } else {
      if (newStatus === "done") (type = "implemented"), (text = `🎉 Ваше предложение ${r.code} «${r.title}» реализовано!${why}`);
      if (newStatus === "rejected") text = `✖ Предложение ${r.code} отклонено.${why ? "\nПричина: " + note : ""}`;
      if (newStatus === "postponed") text = `⏸ Предложение ${r.code} отложено.${why ? "\nПричина: " + note : ""}`;
    }
    await notify(e, ctx, { userId: r.author_id, actorId: ses.user.id, ticket: r, type, text });
  } else if (sets.status_note !== undefined && note) {
    await notify(e, ctx, { userId: r.author_id, actorId: ses.user.id, ticket: r, type: "comment", text: `📝 Пояснение администрации к ${r.code}:\n${note}` });
  }
  return { ok: true, changed: true };
}

export async function adminBulk(e, ctx, ses, body) {
  if (!ses.isAdmin) fail(403, "Только для администрации");
  const codes = Array.isArray(body.codes) ? [...new Set(body.codes.filter((c) => CODE_RE.test(String(c))))].slice(0, 100) : [];
  if (!codes.length) fail(400, "Не выбраны обращения");
  const patch = {};
  for (const k of ["status", "priority", "pinned", "hidden", "note", "fixed_version"]) if (body[k] !== undefined && body[k] !== "") patch[k] = body[k];
  if (!Object.keys(patch).length) fail(400, "Не выбрано действие");
  const results = [];
  for (const code of codes) {
    try {
      // A status only valid for one kind is skipped for the other kind.
      const p = { ...patch };
      if (p.status && !statusIds(kindOfCode(code)).includes(p.status)) delete p.status;
      const r = await adminUpdate(e, ctx, ses, code, p, { silentBump: true });
      results.push({ code, ok: true, changed: r.changed });
    } catch (err) {
      results.push({ code, ok: false, error: err.message });
    }
  }
  await bump(e);
  return { ok: true, results };
}

export async function adminMerge(e, ctx, ses, body) {
  if (!ses.isAdmin) fail(403, "Только для администрации");
  const src = await loadTicket(e, ses, String(body.source || "").toUpperCase());
  const dst = await loadTicket(e, ses, String(body.target || "").toUpperCase());
  if (src.id === dst.id) fail(400, "Нельзя объединить обращение само с собой");
  if (src.kind !== dst.kind) fail(400, "Объединять можно только обращения одного типа");
  if (dst.duplicate_of) fail(400, "Целевое обращение само отмечено как дубликат");
  const t = now();
  const note = `Объединено с ${dst.code}`;
  const stmts = [
    e.DB.prepare("UPDATE portal_tickets SET duplicate_of=?,status=?,status_note=?,updated=?,activity=? WHERE id=?").bind(dst.id, src.kind === "bug" ? "duplicate" : "rejected", note, t, t, src.id),
    e.DB.prepare("INSERT INTO portal_history(ticket_id,actor_id,field,old,new,note,created) VALUES(?,?,?,?,?,?,?)").bind(src.id, ses.user.id, "status", src.status, src.kind === "bug" ? "duplicate" : "rejected", note, t),
    e.DB.prepare("INSERT INTO portal_history(ticket_id,actor_id,field,old,new,note,created) VALUES(?,?,?,?,?,?,?)").bind(dst.id, ses.user.id, "merged", src.code, dst.code, `Присоединён дубликат ${src.code}`, t),
    e.DB.prepare("UPDATE portal_tickets SET duplicate_of=? WHERE duplicate_of=?").bind(dst.id, src.id),
  ];
  if (src.kind === "bug") {
    stmts.push(
      e.DB.prepare("INSERT OR IGNORE INTO portal_confirms(ticket_id,user_id,created) SELECT ?,user_id,created FROM portal_confirms WHERE ticket_id=? AND user_id<>?").bind(dst.id, src.id, dst.author_id),
      e.DB.prepare("INSERT OR IGNORE INTO portal_confirms(ticket_id,user_id,created) SELECT ?,?,? WHERE ?<>?").bind(dst.id, src.author_id, t, src.author_id, dst.author_id),
      e.DB.prepare("UPDATE portal_tickets SET confirms=(SELECT COUNT(*) FROM portal_confirms WHERE ticket_id=?),activity=?,updated=? WHERE id=?").bind(dst.id, t, t, dst.id),
    );
  } else {
    stmts.push(
      e.DB.prepare("INSERT OR IGNORE INTO portal_votes(ticket_id,user_id,created) SELECT ?,user_id,created FROM portal_votes WHERE ticket_id=?").bind(dst.id, src.id),
      e.DB.prepare("UPDATE portal_tickets SET votes=(SELECT COUNT(*) FROM portal_votes WHERE ticket_id=?),activity=?,updated=? WHERE id=?").bind(dst.id, t, t, dst.id),
    );
  }
  await e.DB.batch(stmts);
  await bump(e);
  await notify(e, ctx, { userId: src.author_id, actorId: ses.user.id, ticket: dst, type: "status", text: `🔗 Ваше обращение ${src.code} объединено с ${dst.code}. Следите за статусом там — вы уже отмечены как столкнувшийся с проблемой.` });
  return { ok: true, target: dst.code };
}

// ---------- duplicate search ----------

const STOP = new Set("при для что как это его она они или ещё уже был была было быть есть нет не на по из от до за над под без все всё когда если чтобы тоже также очень приложение приложении qvk".split(" "));

export function tokens(text) {
  return new Set(
    String(text || "")
      .toLowerCase()
      .replace(/ё/g, "е")
      .split(/[^a-zа-я0-9]+/i)
      .filter((w) => w.length >= 3 && !STOP.has(w))
      .map((w) => (w.length > 6 ? w.slice(0, 6) : w)),
  );
}

export function similarity(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const base = Math.min(1, inter / Math.min(a.size, b.size, 8));
  return base * (inter >= 2 || Math.min(a.size, b.size) <= 2 ? 1 : 0.5);
}

export async function findSimilar(e, ses, body) {
  const kind = oneOf(body.kind, ["bug", "idea"], "bug");
  const title = tokens(body.title);
  const desc = tokens(String(body.description || "").slice(0, 1500));
  if (!title.size) return { items: [] };
  const rows = (await e.DB.prepare(
    `SELECT id,code,title,description,category,status,confirms,votes,created FROM portal_tickets
     WHERE kind=? AND hidden=0 AND duplicate_of IS NULL ORDER BY id DESC LIMIT 500`,
  ).bind(kind).all()).results || [];
  const scored = rows
    .map((r) => {
      const st = similarity(title, tokens(r.title));
      const sd = desc.size ? similarity(desc, tokens(String(r.description).slice(0, 1500))) : 0;
      let score = st * 0.7 + sd * 0.3 + (body.category && body.category === r.category ? 0.08 : 0);
      if (["closed", "cannot_reproduce", "rejected"].includes(r.status)) score -= 0.05;
      return { code: r.code, title: r.title, status: r.status, category: r.category, confirms: r.confirms, votes: r.votes, created: r.created, score: Math.round(score * 100) / 100 };
    })
    .filter((x) => x.score >= 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  return { items: scored };
}

// ---------- overviews ----------

export async function homeData(e, ses) {
  const c = await e.DB.prepare(
    `SELECT
      SUM(kind='bug') bugs,
      SUM(kind='bug' AND status='new') new_bugs,
      SUM(kind='bug' AND status IN ('confirmed','in_progress')) in_work,
      SUM(kind='bug' AND status='verify') verify,
      SUM(kind='bug' AND status IN ('fixed','closed')) fixed,
      SUM(kind='idea') ideas,
      SUM(kind='idea' AND status='done') ideas_done
     FROM portal_tickets WHERE hidden=0`,
  ).first();
  const mine = await e.DB.prepare(
    `SELECT SUM(kind='bug') bugs, SUM(kind='idea') ideas,
      SUM(kind='bug' AND status IN ('fixed','closed')) fixed, SUM(kind='bug' AND status='verify') verify,
      SUM(kind='bug' AND status='need_info') need_info
     FROM portal_tickets WHERE author_id=?`,
  ).bind(ses.user.id).first();
  const posts = (await e.DB.prepare("SELECT id,kind,title,body,version,pinned,created FROM portal_posts ORDER BY pinned DESC,id DESC LIMIT 5").all()).results || [];
  const recent = await listTickets(e, ses, new URLSearchParams({ kind: "bug", sort: "activity", limit: "5", pinfirst: "0" }));
  const ideas = await listTickets(e, ses, new URLSearchParams({ kind: "idea", sort: "votes", limit: "3", pinfirst: "0" }));
  const z = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k, v || 0]));
  return {
    version: await getSetting(e, "current_version", "3.0"),
    welcome: await getSetting(e, "welcome", ""),
    counts: z(c),
    mine: z(mine),
    posts,
    recent: recent.items,
    top_ideas: ideas.items,
  };
}

export async function knownIssues(e, ses) {
  const version = await getSetting(e, "current_version", "");
  const rows = (await e.DB.prepare(
    `SELECT t.*,${AUTHOR_COLS},NULL AS dup_code,0 AS my_vote,0 AS my_confirm,0 AS my_fav FROM portal_tickets t LEFT JOIN portal_users u ON u.id=t.author_id
     WHERE t.kind='bug' AND t.hidden=0 AND (t.status IN (${KNOWN_ISSUE_STATUSES.map(() => "?").join(",")}) OR (t.pinned=1 AND t.status IN ('new','need_info')))
     ORDER BY t.pinned DESC, CASE t.priority WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'normal' THEN 2 ELSE 1 END DESC, t.confirms DESC LIMIT 200`,
  ).bind(...KNOWN_ISSUE_STATUSES).all()).results || [];
  return { version, items: rows.map((r) => shapeTicket(r, { ...ses, e })) };
}

export async function fixHistory(e, ses) {
  const rows = (await e.DB.prepare(
    `SELECT t.*,${AUTHOR_COLS},NULL AS dup_code,0 AS my_vote,0 AS my_confirm,0 AS my_fav FROM portal_tickets t LEFT JOIN portal_users u ON u.id=t.author_id
     WHERE t.hidden=0 AND ((t.kind='bug' AND t.status IN ('fixed','closed') AND t.fixed_version IS NOT NULL) OR (t.kind='idea' AND t.status='done'))
     ORDER BY COALESCE(t.resolved,t.updated) DESC LIMIT 300`,
  ).all()).results || [];
  return { items: rows.map((r) => shapeTicket(r, { ...ses, e })) };
}

export async function leaders(e, ses) {
  const users = (await e.DB.prepare(
    `SELECT u.id,u.nick,u.first_name,u.last_name,u.username,
      (SELECT COUNT(*) FROM portal_tickets t WHERE t.author_id=u.id AND t.kind='bug') bugs,
      (SELECT COUNT(*) FROM portal_tickets t WHERE t.author_id=u.id AND t.kind='bug' AND t.status IN ('confirmed','in_progress','verify','fixed','closed')) accepted,
      (SELECT COUNT(*) FROM portal_tickets t WHERE t.author_id=u.id AND t.kind='bug' AND t.status IN ('fixed','closed')) fixed,
      (SELECT COUNT(*) FROM portal_tickets t WHERE t.author_id=u.id AND t.kind='idea') ideas,
      (SELECT COUNT(*) FROM portal_tickets t WHERE t.author_id=u.id AND t.kind='idea' AND t.status='done') ideas_done,
      (SELECT COALESCE(SUM(votes),0) FROM portal_tickets t WHERE t.author_id=u.id AND t.kind='idea') votes,
      (SELECT COUNT(*) FROM portal_confirms c WHERE c.user_id=u.id) confirms_given,
      (SELECT COUNT(*) FROM portal_comments c WHERE c.user_id=u.id AND c.deleted=0) comments
     FROM portal_users u WHERE u.deleted=0 AND u.banned=0`,
  ).all()).results || [];
  const adm = ses.admins || new Set();
  const ranked = users
    .filter((u) => !adm.has(u.id))
    .map((u) => ({
      name: displayName(u),
      me: u.id === ses.user.id,
      bugs: u.bugs, accepted: u.accepted, fixed: u.fixed, ideas: u.ideas, ideas_done: u.ideas_done, votes: u.votes, confirms_given: u.confirms_given, comments: u.comments,
      points: u.accepted * 5 + u.fixed * 3 + u.bugs + u.ideas + u.ideas_done * 8 + u.votes + u.confirms_given + Math.min(u.comments, 50) * 0.2,
    }))
    .filter((u) => u.points > 0)
    .map((u) => ({ ...u, points: Math.round(u.points) }))
    .sort((a, b) => b.points - a.points)
    .slice(0, 50);
  const top = await listTickets(e, ses, new URLSearchParams({ kind: "bug", sort: "votes", limit: "10", pinfirst: "0" }));
  const topIdeas = await listTickets(e, ses, new URLSearchParams({ kind: "idea", sort: "votes", limit: "10", pinfirst: "0" }));
  return { testers: ranked, top_bugs: top.items.filter((t) => t.confirms > 0), top_ideas: topIdeas.items.filter((t) => t.votes > 0) };
}
