// QVK Beta Portal — MCP server for Claude (Streamable HTTP, JSON responses).
//
// Endpoint: POST /mcp/<key>  (for Claude custom connectors, which take a URL)
//       or: POST /mcp with "Authorization: Bearer <key>" (Claude Code, API).
// The key is created by an admin in /admin/settings; only its SHA-256 is stored.
// Every action is performed as the built-in admin account shown to testers as
// "Команда QVK" — in ticket history, comments and notifications.

import { META } from "./constants.js";
import { now, fail, json, sha256, safeEqual, getSetting, setSetting, randomHex, clientIp, rateLimit, HttpError, bump } from "./util.js";
import { adminUserIds } from "./auth.js";
import * as T from "./tickets.js";
import { readAttachment, zipEntries, zipExtract } from "./files.js";

export const CLAUDE_ID = "claude";
/** Name testers see on everything done through the connector. */
export const TEAM_NAME = "Команда QVK";
const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const iso = (s) => (s ? new Date(s * 1000).toISOString() : null);

// ---------- key management (called from the admin API) ----------

export async function ensureClaudeUser(e) {
  const t = now();
  await e.DB.prepare(
    "INSERT INTO portal_users(id,first_name,created,last_seen,notify_tg) VALUES(?,?,?,?,0) ON CONFLICT(id) DO UPDATE SET first_name=excluded.first_name",
  ).bind(CLAUDE_ID, TEAM_NAME, t, t).run();
}

export async function mcpStatus(e) {
  const hash = await getSetting(e, "mcp_key_hash", "");
  return {
    enabled: !!hash,
    created: Number(await getSetting(e, "mcp_key_created", "0")) || null,
    last_used: Number(await getSetting(e, "mcp_key_used", "0")) || null,
  };
}

export async function createMcpKey(e) {
  const key = "qvk_" + randomHex(24);
  await ensureClaudeUser(e);
  await setSetting(e, "mcp_key_hash", await sha256(key));
  await setSetting(e, "mcp_key_created", String(now()));
  await setSetting(e, "mcp_key_used", "0");
  return key;
}

export async function revokeMcpKey(e) {
  await setSetting(e, "mcp_key_hash", "");
}

// ---------- tool helpers ----------

const brief = (t) => ({
  code: t.code,
  title: t.title,
  status: t.status,
  priority: t.priority,
  category: t.category,
  author: t.author?.name,
  device: t.device?.model ? `${t.device.model} · Android ${t.device.android} · QVK ${t.device.app_version}` : null,
  votes: t.kind === "idea" ? t.votes : undefined,
  confirms: t.kind === "bug" ? t.confirms : undefined,
  comments: t.comments,
  pinned: t.pinned || undefined,
  hidden: t.hidden || undefined,
  fixed_version: t.fixed_version || undefined,
  duplicate_of: t.duplicate_of || undefined,
  created: iso(t.created),
  updated: iso(t.updated),
});

const full = (t) => ({
  ...brief(t),
  kind: t.kind,
  description: t.description,
  steps: t.steps || undefined,
  expected: t.expected || undefined,
  actual: t.actual || undefined,
  frequency: t.frequency || undefined,
  how_it_works: t.how_it_works || undefined,
  purpose: t.purpose || undefined,
  device: t.device,
  author: { name: t.author.name, username: t.author.username || null, user_id: t.author.id },
  status_note: t.status_note || undefined,
  attachments: t.attachments.map((a) => ({ id: a.id, name: a.name, mime: a.mime, size: a.size })),
  duplicates: t.duplicates.length ? t.duplicates.map((d) => d.code) : undefined,
  comments: t.comment_list.filter((c) => !c.deleted).map((c) => ({ id: c.id, author: c.author.name, team: c.author.is_admin || undefined, kind: c.kind !== "comment" ? c.kind : undefined, text: c.body, attachments: c.attachments.length ? c.attachments.map((a) => ({ id: a.id, name: a.name, mime: a.mime, size: a.size })) : undefined, at: iso(c.created) })),
  history: t.history.map((h) => ({ field: h.field, from: h.old ?? undefined, to: h.new ?? undefined, note: h.note || undefined, by: h.actor, at: iso(h.created) })),
});

const S = (o) => ({ type: "string", ...o });
const STATUS_HELP = "Баги: " + META.bugStatuses.map((s) => `${s.id} (${s.label})`).join(", ") + ". Предложения: " + META.ideaStatuses.map((s) => `${s.id} (${s.label})`).join(", ") + ".";
const PRIORITY_IDS = META.priorities.map((p) => p.id);
const CATEGORY_IDS = META.categories.map((c) => c.id);
const CODE = S({ description: "Номер обращения, например BUG-0001 или IDEA-0003", pattern: "^(BUG|IDEA)-\\d+$" });

const TOOLS = [
  {
    name: "get_overview",
    title: "Сводка портала",
    description: "Статистика бета-тестирования: количество багов по статусам, предложения, популярные идеи, активность тестировщиков за 14 дней, текущая тестируемая версия и настройки.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: "object", properties: {} },
    run: async (e, ses, ctx, a, api) => ({ ...(await api.adminStats(e)), settings: await api.settings(e) }),
  },
  {
    name: "list_tickets",
    title: "Список обращений",
    description: "Поиск и фильтрация багов или предложений. " + STATUS_HELP + " Возвращает краткие карточки; полные данные — get_ticket.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        kind: S({ enum: ["bug", "idea"], description: "bug — баги (по умолчанию), idea — предложения" }),
        status: S({ description: "Один или несколько статусов через запятую, либо 'open' — все незакрытые" }),
        category: S({ enum: CATEGORY_IDS }),
        priority: S({ enum: PRIORITY_IDS }),
        q: S({ description: "Поиск по номеру, названию и тексту" }),
        version: S({ description: "Версия приложения автора, например 3.0" }),
        android: S({ description: "Версия Android, например 14" }),
        device: S({ description: "Часть названия модели устройства" }),
        author: S({ description: "user_id автора (из get_ticket или list_testers)" }),
        sort: S({ enum: ["new", "old", "priority", "activity", "updated", "votes"], description: "votes — по голосам (идеи) или подтверждениям (баги)" }),
        hidden_only: { type: "boolean" },
        limit: { type: "integer", minimum: 1, maximum: 100, description: "По умолчанию 30" },
        page: { type: "integer", minimum: 0 },
      },
    },
    run: async (e, ses, ctx, a) => {
      const q = new URLSearchParams({ kind: a.kind || "bug", pinfirst: "0" });
      for (const k of ["status", "category", "priority", "q", "version", "android", "device", "author", "sort"]) if (a[k]) q.set(k, String(a[k]));
      if (a.hidden_only) q.set("hidden", "1");
      q.set("limit", String(a.limit || 30));
      q.set("page", String(a.page || 0));
      const r = await T.listTickets(e, ses, q);
      return { total: r.total, page: r.page, more: r.more, items: r.items.map(brief) };
    },
  },
  {
    name: "get_ticket",
    title: "Открыть обращение",
    description: "Полные данные обращения: описание, шаги, устройство и Android автора, вложения (id для get_attachment), обсуждение и история статусов.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: "object", properties: { code: CODE }, required: ["code"] },
    run: async (e, ses, ctx, a) => full(await T.ticketDetail(e, ses, String(a.code).toUpperCase())),
  },
  {
    name: "get_attachment",
    title: "Открыть вложение",
    description: "Просмотреть вложение обращения или комментария по id из get_ticket. Скриншоты (JPG/PNG/WEBP/GIF) возвращаются как изображения, TXT/LOG — как текст (большие логи частями: offset, отрицательный offset — с конца), ZIP — список файлов, а с параметром entry — содержимое текстового файла из архива. Видео и PDF просмотреть нельзя — только сведения о файле.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        id: S({ description: "id вложения из get_ticket", pattern: "^[a-z0-9]{20}$" }),
        entry: S({ description: "Для ZIP: имя файла внутри архива" }),
        offset: { type: "integer", description: "Для текста: с какого символа читать (по умолчанию 0; -50000 — последние 50 000 символов)" },
      },
      required: ["id"],
    },
    run: async (e, ses, ctx, a) => {
      if (!/^[a-z0-9]{20}$/.test(String(a.id || ""))) fail(400, "Некорректный id вложения");
      const att = await e.DB.prepare("SELECT a.*,t.code FROM portal_attachments a LEFT JOIN portal_tickets t ON t.id=a.ticket_id WHERE a.id=?").bind(a.id).first();
      if (!att || !att.ticket_id) fail(404, "Вложение не найдено");
      const meta = { id: att.id, name: att.name, mime: att.mime, size: att.size, ticket: att.code, uploaded: iso(att.created) };
      const textOut = (bytes, label) => {
        const all = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
        const PAGE = 60000;
        let from = Number(a.offset) || 0;
        if (from < 0) from = Math.max(0, all.length + from);
        const chunk = all.slice(from, from + PAGE);
        const head = `${label} · символы ${from}–${from + chunk.length} из ${all.length}${from + chunk.length < all.length ? " (дальше: offset=" + (from + chunk.length) + ")" : ""}`;
        return { __content: [{ type: "text", text: head + "\n\n" + chunk }] };
      };
      if (att.mime.startsWith("image/")) {
        if (att.size > 4.5 * 1024 * 1024) return { ...meta, note: "Изображение больше 4,5 МБ — его нельзя передать для просмотра. Попросите администратора открыть его на сайте." };
        const bytes = await readAttachment(e, att);
        let bin = "";
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return { __content: [{ type: "text", text: JSON.stringify(meta) }, { type: "image", data: btoa(bin), mimeType: att.mime }] };
      }
      if (att.mime === "text/plain") return textOut(await readAttachment(e, att), att.name);
      if (att.mime === "application/zip") {
        const bytes = await readAttachment(e, att);
        const entries = zipEntries(bytes).filter((x) => !x.name.endsWith("/"));
        if (!a.entry) return { ...meta, files: entries.map((x) => ({ name: x.name, size: x.size })), hint: "Чтобы прочитать файл, вызовите get_attachment с entry=<имя>" };
        const ent = entries.find((x) => x.name === a.entry);
        if (!ent) fail(404, "В архиве нет файла " + a.entry);
        const data = await zipExtract(bytes, ent);
        if (data.subarray(0, 8192).includes(0)) return { ...meta, entry: ent.name, size: ent.size, note: "Это двоичный файл — показать его как текст нельзя." };
        return textOut(data, `${att.name} → ${ent.name}`);
      }
      return { ...meta, note: att.mime.startsWith("video/") ? "Видео нельзя просмотреть через коннектор — его можно открыть на сайте в карточке " + att.code + "." : "Этот тип файла нельзя просмотреть через коннектор — откройте его на сайте." };
    },
  },
  {
    name: "update_ticket",
    title: "Изменить обращение",
    description: "Сменить статус, приоритет, версию исправления, пояснение для автора, закрепление или видимость. " + STATUS_HELP + " Автор получит уведомление о смене статуса. При status=fixed без fixed_version подставляется текущая версия.",
    annotations: { destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: "object",
      properties: {
        code: CODE,
        status: S({}),
        priority: S({ enum: PRIORITY_IDS }),
        fixed_version: S({ description: "Версия, в которой исправлено" }),
        note: S({ description: "Пояснение для автора (причина отклонения, что исправлено и т.п.). Видно на странице обращения." }),
        pinned: { type: "boolean" },
        hidden: { type: "boolean", description: "Скрыть от тестировщиков (кроме автора)" },
      },
      required: ["code"],
    },
    run: async (e, ses, ctx, a) => {
      const patch = {};
      for (const k of ["status", "priority", "fixed_version", "note", "pinned", "hidden"]) if (a[k] !== undefined) patch[k] = a[k];
      const r = await T.adminUpdate(e, ctx, ses, String(a.code).toUpperCase(), patch);
      return { ok: true, changed: r.changed, ticket: brief(await T.ticketDetail(e, ses, String(a.code).toUpperCase())) };
    },
  },
  {
    name: "bulk_update",
    title: "Массовое изменение",
    description: "Применить одинаковые изменения к нескольким обращениям (до 100). Статус, неподходящий для типа обращения, пропускается.",
    annotations: { destructiveHint: false },
    inputSchema: {
      type: "object",
      properties: {
        codes: { type: "array", items: CODE, minItems: 1, maxItems: 100 },
        status: S({}),
        priority: S({ enum: PRIORITY_IDS }),
        fixed_version: S({}),
        note: S({}),
        pinned: { type: "boolean" },
        hidden: { type: "boolean" },
      },
      required: ["codes"],
    },
    run: async (e, ses, ctx, a) => T.adminBulk(e, ctx, ses, { ...a, codes: (a.codes || []).map((c) => String(c).toUpperCase()) }),
  },
  {
    name: "add_comment",
    title: "Ответить в обращении",
    description: "Оставить комментарий от имени команды — тестировщики увидят подпись «Команда QVK». Автор получит уведомление.",
    annotations: { destructiveHint: false },
    inputSchema: { type: "object", properties: { code: CODE, text: S({ description: "Текст комментария (до 4000 символов)" }) }, required: ["code", "text"] },
    run: async (e, ses, ctx, a) => T.addComment(e, ctx, ses, String(a.code).toUpperCase(), { body: a.text }),
  },
  {
    name: "merge_duplicate",
    title: "Объединить дубликаты",
    description: "Отметить source как дубликат target: статус source станет «Дубликат» (для идей — «Отклонено»), подтверждения/голоса перенесутся, автор source получит уведомление.",
    annotations: { destructiveHint: true },
    inputSchema: { type: "object", properties: { source: CODE, target: CODE }, required: ["source", "target"] },
    run: async (e, ses, ctx, a) => T.adminMerge(e, ctx, ses, a),
  },
  {
    name: "find_similar",
    title: "Найти похожие",
    description: "Найти существующие обращения, похожие по названию/описанию — помогает выявлять дубликаты.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: "object", properties: { kind: S({ enum: ["bug", "idea"] }), title: S({}), description: S({}), category: S({ enum: CATEGORY_IDS }) }, required: ["title"] },
    run: async (e, ses, ctx, a) => T.findSimilar(e, ses, a),
  },
  {
    name: "list_testers",
    title: "Тестировщики",
    description: "Список тестировщиков: ник, user_id, число багов/идей/комментариев, последнее устройство, привязан ли Telegram, блокировка.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: "object", properties: {} },
    run: async (e, ses, ctx, a, api) => {
      const r = await api.adminUsers(e, ses);
      return r.items.filter((u) => u.id !== CLAUDE_ID).map((u) => ({ user_id: u.id, name: u.name, admin: u.is_admin || undefined, banned: u.banned || undefined, telegram: u.tg_linked, bugs: u.bugs, ideas: u.ideas, comments: u.comments, device: u.device, last_seen: iso(u.last_seen), joined: iso(u.created) }));
    },
  },
  {
    name: "list_posts",
    title: "Объявления",
    description: "Объявления и списки изменений на странице «Обновления».",
    annotations: { readOnlyHint: true },
    inputSchema: { type: "object", properties: {} },
    run: async (e) => ((await e.DB.prepare("SELECT id,kind,title,body,version,pinned,created FROM portal_posts ORDER BY pinned DESC,id DESC LIMIT 100").all()).results || []).map((p) => ({ ...p, pinned: !!p.pinned, created: iso(p.created) })),
  },
  {
    name: "publish_post",
    title: "Опубликовать объявление",
    description: "Создать или изменить (если указан id) объявление или список изменений. Появится на главной и на странице «Обновления».",
    annotations: { destructiveHint: false },
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "integer", description: "id существующей записи для редактирования" },
        kind: S({ enum: ["announce", "changelog"], description: "announce — объявление, changelog — список изменений" }),
        title: S({}),
        body: S({ description: "Текст; переносы строк сохраняются, ссылки и BUG-/IDEA-номера становятся кликабельными" }),
        version: S({}),
        pinned: { type: "boolean" },
      },
      required: ["title"],
    },
    run: async (e, ses, ctx, a, api) => api.savePost(e, ses, a.id || null, a),
  },
  {
    name: "delete_post",
    title: "Удалить объявление",
    description: "Удалить объявление по id.",
    annotations: { destructiveHint: true },
    inputSchema: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
    run: async (e, ses, ctx, a) => {
      const r = await e.DB.prepare("DELETE FROM portal_posts WHERE id=?").bind(Number(a.id)).run();
      if (!r.meta?.changes) fail(404, "Запись не найдена");
      await bump(e);
      return { ok: true };
    },
  },
  {
    name: "update_settings",
    title: "Настройки портала",
    description: "Изменить текущую тестируемую версию, приветствие на главной, публичность комментариев и уведомления админов в Telegram.",
    annotations: { destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: "object",
      properties: {
        current_version: S({ description: "Например 3.0.2" }),
        welcome: S({ description: "Текст приветствия на главной (до 600 символов)" }),
        comments_public: { type: "boolean", description: "Могут ли все тестировщики комментировать" },
        notify_admins: { type: "boolean", description: "Уведомлять админов в Telegram о новых обращениях" },
      },
    },
    run: async (e, ses, ctx, a, api) => {
      await api.adminSettings(e, a);
      return { ok: true, settings: await api.settings(e) };
    },
  },
];

// ---------- JSON-RPC handling ----------

const rpcResult = (id, result) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

async function handleMessage(e, ctx, ses, msg, api) {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return rpcError(msg?.id, -32600, "Invalid Request");
  const isNotification = msg.id === undefined || msg.id === null;
  const p = msg.params || {};
  switch (msg.method) {
    case "initialize": {
      const v = PROTOCOLS.includes(p.protocolVersion) ? p.protocolVersion : PROTOCOLS[0];
      return rpcResult(msg.id, {
        protocolVersion: v,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "qvk-beta-portal", title: "QVK Beta Portal", version: "1.0.0" },
        instructions:
          "Админ-доступ к QVK Beta Portal — порталу закрытого бета-тестирования приложения QVK. " +
          "Действия выполняются от имени аккаунта «Команда QVK» — так их видят тестировщики. Пишите от лица команды (если тестировщик прямо спросит, отвечает ли ИИ, — не отрицайте). Авторы обращений получают уведомления о смене статуса и комментариях, " +
          "все изменения видны в истории. Перед массовыми изменениями, объединением дубликатов, скрытием обращений и удалением объявлений " +
          "уточняйте у пользователя. Пишите тестировщикам по-русски, вежливо и по делу. " + STATUS_HELP,
      });
    }
    case "ping":
      return isNotification ? null : rpcResult(msg.id, {});
    case "tools/list":
      return rpcResult(msg.id, { tools: TOOLS.map(({ run, ...t }) => t) });
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === p.name);
      if (!tool) return rpcError(msg.id, -32602, "Unknown tool: " + p.name);
      try {
        const out = await tool.run(e, ses, ctx, p.arguments || {}, api);
        return rpcResult(msg.id, { content: out?.__content || [{ type: "text", text: JSON.stringify(out) }] });
      } catch (err) {
        if (!(err instanceof HttpError)) console.error("MCP tool failure", p.name, err?.stack || String(err));
        return rpcResult(msg.id, { isError: true, content: [{ type: "text", text: err instanceof HttpError ? err.message : "Внутренняя ошибка: " + String(err?.message || err) }] });
      }
    }
    default:
      if (isNotification || msg.method.startsWith("notifications/")) return null;
      return rpcError(msg.id, -32601, "Method not found: " + msg.method);
  }
}

/** Entry for /mcp and /mcp/<key>. `api` provides admin helpers from api.js. */
export async function handleMcp(req, e, ctx, url, api) {
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type, mcp-protocol-version, mcp-session-id", "access-control-allow-methods": "POST, OPTIONS" };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const pathKey = url.pathname.slice("/mcp".length).replace(/^\//, "");
  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const key = pathKey || bearer;
  const stored = await getSetting(e, "mcp_key_hash", "");
  if (!stored || !/^qvk_[a-f0-9]{48}$/.test(key) || !safeEqual(await sha256(key), stored)) {
    await rateLimit(e, "mcp-bad:" + clientIp(req), 20, 600);
    return json({ error: stored ? "Неверный ключ доступа" : "Доступ для Claude не включён в настройках портала" }, 401, cors);
  }
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: { ...cors, allow: "POST, OPTIONS" } });
  await rateLimit(e, "mcp", 600, 600);
  const t = now();
  if (t - (Number(await getSetting(e, "mcp_key_used", "0")) || 0) > 60) await setSetting(e, "mcp_key_used", String(t));
  await ensureClaudeUser(e);
  const admins = await adminUserIds(e);
  const ses = {
    user: { id: CLAUDE_ID, first_name: TEAM_NAME, name: TEAM_NAME, notify_tg: false, active_device: null },
    session: { hash: "mcp", csrf: "" },
    isAdmin: true,
    admins,
  };
  let body;
  try {
    const text = await req.text();
    if (text.length > 200000) return json(rpcError(null, -32600, "Request too large"), 413, cors);
    body = JSON.parse(text);
  } catch {
    return json(rpcError(null, -32700, "Parse error"), 400, cors);
  }
  const msgs = Array.isArray(body) ? body : [body];
  const out = [];
  for (const m of msgs) {
    const r = await handleMessage(e, ctx, ses, m, api);
    if (r) out.push(r);
  }
  if (!out.length) return new Response(null, { status: 202, headers: cors });
  return json(Array.isArray(body) ? out : out[0], 200, cors);
}
