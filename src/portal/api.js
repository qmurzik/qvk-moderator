// QVK Beta Portal — JSON API router (/api/p/*).
import { META, LIMITS } from "./constants.js";
import { now, fail, json, clean, oneOf, readJson, getSetting, setSetting, bump, displayName, csvCell, admins, rateLimit, HttpError } from "./util.js";
import { loadSession, startLogin, pollLogin, widgetLogin, logout } from "./auth.js";
import { botUsername } from "./telegram.js";
import { upload } from "./files.js";
import * as T from "./tickets.js";

// ---------- profile & devices ----------

async function me(e, ses) {
  const devices = (await e.DB.prepare("SELECT id,model,android,app_version,firmware,updated FROM portal_devices WHERE user_id=? ORDER BY id").bind(ses.user.id).all()).results || [];
  const unread = await e.DB.prepare("SELECT COUNT(*) n FROM portal_notifications WHERE user_id=? AND read=0").bind(ses.user.id).first();
  const settings = {
    current_version: await getSetting(e, "current_version", "3.0"),
    comments_public: (await getSetting(e, "comments_public", "on")) === "on",
  };
  if (ses.isAdmin) {
    settings.notify_admins = (await getSetting(e, "notify_admins", "on")) === "on";
    settings.login_widget = (await getSetting(e, "login_widget", "off")) === "on";
    settings.welcome = await getSetting(e, "welcome", "");
  }
  const active = devices.find((d) => d.id === ses.user.active_device) ? ses.user.active_device : devices[0]?.id ?? null;
  return {
    user: { ...ses.user, name: displayName(ses.user), active_device: active },
    is_admin: ses.isAdmin,
    csrf: ses.session.csrf,
    devices,
    unread: unread?.n || 0,
    rev: await getSetting(e, "rev", "1"),
    bot: await botUsername(e),
    settings,
    meta: META,
  };
}

function readDevice(body) {
  const d = {
    model: clean(body.model, 60, { multiline: false }),
    android: clean(body.android, 20, { multiline: false }),
    app_version: clean(body.app_version, 32, { multiline: false }),
    firmware: clean(body.firmware, 60, { multiline: false }) || null,
  };
  if (d.model.length < 2) fail(400, "Укажите модель устройства");
  if (!d.android) fail(400, "Укажите версию Android");
  if (!d.app_version) fail(400, "Укажите версию приложения");
  return d;
}

async function saveDevice(e, ses, id, body) {
  const d = readDevice(body);
  const t = now();
  if (id) {
    const r = await e.DB.prepare("UPDATE portal_devices SET model=?,android=?,app_version=?,firmware=?,updated=? WHERE id=? AND user_id=?").bind(d.model, d.android, d.app_version, d.firmware, t, Number(id), ses.user.id).run();
    if (!r.meta?.changes) fail(404, "Устройство не найдено");
    return { ok: true, id: Number(id) };
  }
  const n = await e.DB.prepare("SELECT COUNT(*) n FROM portal_devices WHERE user_id=?").bind(ses.user.id).first();
  if (n.n >= LIMITS.devicesPerUser) fail(400, `Можно добавить не более ${LIMITS.devicesPerUser} устройств`);
  const r = await e.DB.prepare("INSERT INTO portal_devices(user_id,model,android,app_version,firmware,created,updated) VALUES(?,?,?,?,?,?,?)").bind(ses.user.id, d.model, d.android, d.app_version, d.firmware, t, t).run();
  const newId = r.meta.last_row_id;
  if (body.make_active || n.n === 0) await e.DB.prepare("UPDATE portal_users SET active_device=? WHERE id=?").bind(newId, ses.user.id).run();
  return { ok: true, id: newId };
}

async function deleteProfile(req, e, ses) {
  const id = ses.user.id;
  await e.DB.batch([
    e.DB.prepare("DELETE FROM portal_devices WHERE user_id=?").bind(id),
    e.DB.prepare("DELETE FROM portal_drafts WHERE user_id=?").bind(id),
    e.DB.prepare("DELETE FROM portal_favorites WHERE user_id=?").bind(id),
    e.DB.prepare("DELETE FROM portal_notifications WHERE user_id=?").bind(id),
    e.DB.prepare("DELETE FROM portal_sessions WHERE user_id=?").bind(id),
    // Reports stay (they belong to the project) but are de-personalised.
    e.DB.prepare("UPDATE portal_users SET first_name='',last_name=NULL,username=NULL,photo_url=NULL,active_device=NULL,notify_tg=0,deleted=1 WHERE id=?").bind(id),
  ]);
  return logout(req, e, null);
}

// ---------- admin ----------

async function adminStats(e) {
  const by = (await e.DB.prepare("SELECT kind,status,COUNT(*) n FROM portal_tickets GROUP BY kind,status").all()).results || [];
  const count = (kind, statuses) => by.filter((r) => r.kind === kind && (!statuses || statuses.includes(r.status))).reduce((s, r) => s + r.n, 0);
  const prio = (await e.DB.prepare("SELECT priority,COUNT(*) n FROM portal_tickets WHERE kind='bug' AND status IN ('new','confirmed','in_progress','verify','need_info') GROUP BY priority").all()).results || [];
  const t = now();
  const day = 86400;
  const since = Math.floor(t / day) * day - 13 * day;
  const daily = (await e.DB.prepare(
    `SELECT d, SUM(b) bugs, SUM(i) ideas, SUM(c) comments FROM (
       SELECT (created/86400)*86400 d, kind='bug' b, kind='idea' i, 0 c FROM portal_tickets WHERE created>=?
       UNION ALL SELECT (created/86400)*86400 d, 0, 0, 1 FROM portal_comments WHERE created>=? AND deleted=0
     ) GROUP BY d ORDER BY d`,
  ).bind(since, since).all()).results || [];
  const days = [];
  for (let i = 0; i < 14; i++) {
    const d = since + i * day;
    const r = daily.find((x) => x.d === d) || {};
    days.push({ d, bugs: r.bugs || 0, ideas: r.ideas || 0, comments: r.comments || 0 });
  }
  const topIdeas = (await e.DB.prepare("SELECT code,title,status,votes FROM portal_tickets WHERE kind='idea' AND duplicate_of IS NULL ORDER BY votes DESC,id DESC LIMIT 5").all()).results || [];
  const testers = (await e.DB.prepare(
    `SELECT u.id,u.first_name,u.last_name,u.username,u.last_seen,
      (SELECT COUNT(*) FROM portal_tickets t WHERE t.author_id=u.id AND t.created>=?) tickets,
      (SELECT COUNT(*) FROM portal_comments c WHERE c.user_id=u.id AND c.created>=? AND c.deleted=0) comments
     FROM portal_users u WHERE u.deleted=0 ORDER BY tickets DESC, comments DESC, u.last_seen DESC LIMIT 10`,
  ).bind(t - 30 * day, t - 30 * day).all()).results || [];
  const users = await e.DB.prepare("SELECT COUNT(*) total, SUM(last_seen>=?) active7, SUM(created>=?) new7 FROM portal_users WHERE deleted=0").bind(t - 7 * day, t - 7 * day).first();
  return {
    bugs: {
      total: count("bug"), new: count("bug", ["new"]), in_work: count("bug", ["confirmed", "in_progress"]), verify: count("bug", ["verify"]),
      fixed: count("bug", ["fixed", "closed"]), need_info: count("bug", ["need_info"]), by_status: by.filter((r) => r.kind === "bug"),
      open_by_priority: prio,
    },
    ideas: { total: count("idea"), new: count("idea", ["new"]), planned: count("idea", ["planned", "in_progress"]), done: count("idea", ["done"]), by_status: by.filter((r) => r.kind === "idea") },
    top_ideas: topIdeas,
    testers: testers.map((u) => ({ id: u.id, name: displayName(u), username: u.username, last_seen: u.last_seen, tickets: u.tickets, comments: u.comments })),
    users: { total: users?.total || 0, active7: users?.active7 || 0, new7: users?.new7 || 0 },
    daily: days,
  };
}

async function adminUsers(e) {
  const rows = (await e.DB.prepare(
    `SELECT u.id,u.first_name,u.last_name,u.username,u.created,u.last_seen,u.banned,u.notify_tg,u.tg_blocked,
      (SELECT COUNT(*) FROM portal_tickets t WHERE t.author_id=u.id AND t.kind='bug') bugs,
      (SELECT COUNT(*) FROM portal_tickets t WHERE t.author_id=u.id AND t.kind='idea') ideas,
      (SELECT COUNT(*) FROM portal_comments c WHERE c.user_id=u.id AND c.deleted=0) comments,
      (SELECT model||' · Android '||android||' · '||app_version FROM portal_devices d WHERE d.user_id=u.id ORDER BY d.updated DESC LIMIT 1) device
     FROM portal_users u WHERE u.deleted=0 ORDER BY u.last_seen DESC LIMIT 500`,
  ).all()).results || [];
  const adm = admins(e);
  return { items: rows.map((u) => ({ ...u, name: displayName(u), is_admin: adm.has(u.id), banned: !!u.banned })) };
}

async function adminSettings(e, body) {
  if (body.current_version !== undefined) {
    const v = clean(body.current_version, 32, { multiline: false });
    if (!v) fail(400, "Укажите версию");
    await setSetting(e, "current_version", v);
  }
  for (const k of ["comments_public", "notify_admins", "login_widget"]) if (body[k] !== undefined) await setSetting(e, k, body[k] ? "on" : "off");
  if (body.welcome !== undefined) await setSetting(e, "welcome", clean(body.welcome, 600));
  await bump(e);
  return { ok: true };
}

async function savePost(e, ses, id, body) {
  const kind = oneOf(body.kind, ["announce", "changelog"], "announce");
  const title = clean(body.title, 140, { multiline: false });
  const text = clean(body.body, LIMITS.postBody);
  const version = clean(body.version, 32, { multiline: false }) || null;
  if (title.length < 2) fail(400, "Укажите заголовок");
  if (id) {
    const r = await e.DB.prepare("UPDATE portal_posts SET kind=?,title=?,body=?,version=?,pinned=? WHERE id=?").bind(kind, title, text, version, body.pinned ? 1 : 0, Number(id)).run();
    if (!r.meta?.changes) fail(404, "Запись не найдена");
  } else {
    await e.DB.prepare("INSERT INTO portal_posts(kind,title,body,version,pinned,author_id,created) VALUES(?,?,?,?,?,?,?)").bind(kind, title, text, version, body.pinned ? 1 : 0, ses.user.id, now()).run();
  }
  await bump(e);
  return { ok: true };
}

async function exportData(e, q) {
  const kind = oneOf(q.get("kind"), ["bug", "idea", "all"], "all");
  const format = oneOf(q.get("format"), ["json", "csv"], "json");
  const rows = (await e.DB.prepare(
    `SELECT t.*,u.first_name,u.last_name,u.username,d.code AS duplicate_code FROM portal_tickets t LEFT JOIN portal_users u ON u.id=t.author_id LEFT JOIN portal_tickets d ON d.id=t.duplicate_of
     ${kind === "all" ? "" : "WHERE t.kind=?"} ORDER BY t.id`,
  ).bind(...(kind === "all" ? [] : [kind])).all()).results || [];
  const iso = (s) => (s ? new Date(s * 1000).toISOString() : "");
  const items = rows.map((r) => ({
    code: r.code, kind: r.kind, category: r.category, title: r.title, status: r.status, priority: r.priority,
    author_id: r.author_id, author: displayName({ id: r.author_id, first_name: r.first_name, last_name: r.last_name, username: r.username }), author_username: r.username || "",
    device: r.device_model || "", android: r.android || "", app_version: r.app_version || "", firmware: r.firmware || "",
    frequency: r.frequency || "", description: r.description, steps: r.steps, expected: r.expected, actual: r.actual,
    how_it_works: r.how_it_works, purpose: r.purpose, fixed_version: r.fixed_version || "", status_note: r.status_note || "",
    votes: r.votes, confirms: r.confirms, comments: r.comments, pinned: !!r.pinned, hidden: !!r.hidden, duplicate_of: r.duplicate_code || "",
    created: iso(r.created), updated: iso(r.updated), resolved: iso(r.resolved),
  }));
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === "json") {
    return new Response(JSON.stringify({ exported: new Date().toISOString(), count: items.length, items }, null, 2), {
      headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="qvk-beta-${kind}-${stamp}.json"`, "cache-control": "no-store" },
    });
  }
  const cols = items.length ? Object.keys(items[0]) : ["code"];
  const csv = "﻿" + [cols.join(","), ...items.map((it) => cols.map((c) => csvCell(it[c])).join(","))].join("\r\n");
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="qvk-beta-${kind}-${stamp}.csv"`, "cache-control": "no-store" } });
}

// ---------- router ----------

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function checkOrigin(req, url) {
  const origin = req.headers.get("origin");
  if (origin && origin !== url.origin) fail(403, "Запрос с чужого сайта отклонён");
  const site = req.headers.get("sec-fetch-site");
  if (site && !["same-origin", "none"].includes(site)) fail(403, "Запрос с чужого сайта отклонён");
}

export async function handleApi(req, e, ctx, url) {
  const path = url.pathname.slice("/api/p".length) || "/";
  const method = req.method;
  const q = url.searchParams;
  const seg = path.split("/").filter(Boolean);

  if (MUTATING.has(method) || path.startsWith("/auth/")) checkOrigin(req, url);

  // ---- unauthenticated endpoints ----
  if (seg[0] === "auth") {
    if (req.headers.get("x-qvk") !== "1") fail(403, "Отсутствует заголовок запроса");
    if (seg[1] === "start" && method === "POST") return startLogin(req, e);
    if (seg[1] === "poll" && method === "GET") return pollLogin(req, e);
    if (seg[1] === "widget" && method === "POST") return widgetLogin(req, e, await readJson(req));
    if (seg[1] === "logout" && method === "POST") return logout(req, e, await loadSession(req, e));
    fail(404, "Не найдено");
  }
  if (path === "/public" && method === "GET") {
    return json({
      version: await getSetting(e, "current_version", "3.0"),
      bot: await botUsername(e),
      login_widget: (await getSetting(e, "login_widget", "off")) === "on",
    });
  }

  const ses = await loadSession(req, e);
  if (!ses) fail(401, "Требуется вход");
  if (MUTATING.has(method) && req.headers.get("x-csrf") !== ses.session.csrf) fail(403, "Сессия устарела, обновите страницу");

  // ---- tester endpoints ----
  if (path === "/me") {
    if (method === "GET") return json(await me(e, ses));
    if (method === "PATCH") {
      const b = await readJson(req);
      if (b.notify_tg !== undefined) await e.DB.prepare("UPDATE portal_users SET notify_tg=?,tg_blocked=CASE WHEN ? THEN 0 ELSE tg_blocked END WHERE id=?").bind(b.notify_tg ? 1 : 0, b.notify_tg ? 1 : 0, ses.user.id).run();
      if (b.active_device !== undefined) {
        const d = await e.DB.prepare("SELECT id FROM portal_devices WHERE id=? AND user_id=?").bind(Number(b.active_device), ses.user.id).first();
        if (!d) fail(404, "Устройство не найдено");
        await e.DB.prepare("UPDATE portal_users SET active_device=? WHERE id=?").bind(d.id, ses.user.id).run();
      }
      return json({ ok: true });
    }
    if (method === "DELETE") return deleteProfile(req, e, ses);
  }
  if (seg[0] === "devices") {
    if (method === "POST" && seg.length === 1) return json(await saveDevice(e, ses, null, await readJson(req)));
    if (method === "PUT" && seg[1]) return json(await saveDevice(e, ses, seg[1], await readJson(req)));
    if (method === "DELETE" && seg[1]) {
      const r = await e.DB.prepare("DELETE FROM portal_devices WHERE id=? AND user_id=?").bind(Number(seg[1]), ses.user.id).run();
      if (!r.meta?.changes) fail(404, "Устройство не найдено");
      return json({ ok: true });
    }
  }
  if (path === "/pulse" && method === "GET") {
    const unread = await e.DB.prepare("SELECT COUNT(*) n FROM portal_notifications WHERE user_id=? AND read=0").bind(ses.user.id).first();
    return json({ rev: await getSetting(e, "rev", "1"), unread: unread?.n || 0 });
  }
  if (path === "/home" && method === "GET") return json(await T.homeData(e, ses));
  if (path === "/tickets" && method === "GET") return json(await T.listTickets(e, ses, q));
  if (path === "/tickets" && method === "POST") return json(await T.createTicket(e, ctx, ses, await readJson(req)));
  if (path === "/similar" && method === "POST") return json(await T.findSimilar(e, ses, await readJson(req)));
  if (seg[0] === "tickets" && seg[1]) {
    const code = decodeURIComponent(seg[1]).toUpperCase();
    const action = seg[2];
    if (!action && method === "GET") return json(await T.ticketDetail(e, ses, code));
    if (!action && method === "PATCH") return json(await T.editTicket(e, ctx, ses, code, await readJson(req)));
    if (action === "comments" && method === "POST") return json(await T.addComment(e, ctx, ses, code, await readJson(req)));
    if (action === "vote" && method === "POST") return json(await T.vote(e, ses, code, await readJson(req)));
    if (action === "confirm" && method === "POST") return json(await T.confirmBug(e, ses, code, await readJson(req)));
    if (action === "favorite" && method === "POST") return json(await T.favorite(e, ses, code, await readJson(req)));
    if (action === "verify" && method === "POST") return json(await T.verifyFix(e, ctx, ses, code, await readJson(req)));
    if (action === "admin" && method === "POST") return json(await T.adminUpdate(e, ctx, ses, code, await readJson(req)));
  }
  if (seg[0] === "comments" && seg[1] && method === "DELETE") return json(await T.deleteComment(e, ses, seg[1]));
  if (path === "/upload" && method === "POST") return upload(req, e, ses);
  if (path === "/known" && method === "GET") return json(await T.knownIssues(e, ses));
  if (path === "/fixes" && method === "GET") return json(await T.fixHistory(e, ses));
  if (path === "/leaders" && method === "GET") return json(await T.leaders(e, ses));
  if (path === "/posts" && method === "GET") {
    const rows = (await e.DB.prepare("SELECT id,kind,title,body,version,pinned,created FROM portal_posts ORDER BY pinned DESC,id DESC LIMIT 100").all()).results || [];
    return json({ items: rows });
  }
  if (path === "/notifications" && method === "GET") {
    const rows = (await e.DB.prepare(
      "SELECT n.id,n.type,n.text,n.created,n.read,t.code,t.kind FROM portal_notifications n LEFT JOIN portal_tickets t ON t.id=n.ticket_id WHERE n.user_id=? ORDER BY n.id DESC LIMIT 100",
    ).bind(ses.user.id).all()).results || [];
    return json({ items: rows.map((r) => ({ ...r, read: !!r.read })) });
  }
  if (path === "/notifications/read" && method === "POST") {
    const b = await readJson(req);
    if (Array.isArray(b.ids) && b.ids.length) {
      const ids = b.ids.map(Number).filter(Number.isSafeInteger).slice(0, 90);
      await e.DB.prepare(`UPDATE portal_notifications SET read=1 WHERE user_id=? AND id IN (${ids.map(() => "?").join(",")})`).bind(ses.user.id, ...ids).run();
    } else await e.DB.prepare("UPDATE portal_notifications SET read=1 WHERE user_id=?").bind(ses.user.id).run();
    return json({ ok: true });
  }
  if (seg[0] === "drafts" && ["bug", "idea"].includes(seg[1])) {
    if (method === "GET") {
      const r = await e.DB.prepare("SELECT data,updated FROM portal_drafts WHERE user_id=? AND kind=?").bind(ses.user.id, seg[1]).first();
      return json({ draft: r ? JSON.parse(r.data) : null, updated: r?.updated || null });
    }
    if (method === "PUT") {
      await rateLimit(e, "draft:" + ses.user.id, 120, 600);
      const b = await readJson(req, 40000);
      const data = JSON.stringify(b.draft || {});
      if (data.length > 30000) fail(413, "Черновик слишком большой");
      await e.DB.prepare("INSERT INTO portal_drafts(user_id,kind,data,updated) VALUES(?,?,?,?) ON CONFLICT(user_id,kind) DO UPDATE SET data=excluded.data,updated=excluded.updated").bind(ses.user.id, seg[1], data, now()).run();
      return json({ ok: true });
    }
    if (method === "DELETE") {
      await e.DB.prepare("DELETE FROM portal_drafts WHERE user_id=? AND kind=?").bind(ses.user.id, seg[1]).run();
      return json({ ok: true });
    }
  }

  // ---- admin endpoints (server-side ADMIN_IDS check) ----
  if (seg[0] === "admin") {
    if (!ses.isAdmin) fail(403, "Только для администрации");
    if (seg[1] === "stats" && method === "GET") return json(await adminStats(e));
    if (seg[1] === "bulk" && method === "POST") return json(await T.adminBulk(e, ctx, ses, await readJson(req)));
    if (seg[1] === "merge" && method === "POST") return json(await T.adminMerge(e, ctx, ses, await readJson(req)));
    if (seg[1] === "export" && method === "GET") return exportData(e, q);
    if (seg[1] === "settings" && method === "POST") return json(await adminSettings(e, await readJson(req)));
    if (seg[1] === "users" && !seg[2] && method === "GET") return json(await adminUsers(e));
    if (seg[1] === "users" && seg[2] && method === "POST") {
      const b = await readJson(req);
      if (admins(e).has(seg[2])) fail(400, "Нельзя заблокировать администратора");
      await e.DB.prepare("UPDATE portal_users SET banned=? WHERE id=?").bind(b.banned ? 1 : 0, seg[2]).run();
      if (b.banned) await e.DB.prepare("DELETE FROM portal_sessions WHERE user_id=?").bind(seg[2]).run();
      return json({ ok: true });
    }
    if (seg[1] === "posts" && method === "POST" && !seg[2]) return json(await savePost(e, ses, null, await readJson(req)));
    if (seg[1] === "posts" && method === "PUT" && seg[2]) return json(await savePost(e, ses, seg[2], await readJson(req)));
    if (seg[1] === "posts" && method === "DELETE" && seg[2]) {
      await e.DB.prepare("DELETE FROM portal_posts WHERE id=?").bind(Number(seg[2])).run();
      await bump(e);
      return json({ ok: true });
    }
  }
  fail(404, "Метод не найден");
}

export function apiError(err) {
  if (err instanceof HttpError) return json({ error: err.message, ...(err.extra || {}) }, err.status);
  console.error("Portal API failure", err?.stack || String(err));
  return json({ error: "Внутренняя ошибка сервера. Попробуйте ещё раз." }, 500);
}
