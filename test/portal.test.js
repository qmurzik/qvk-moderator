// End-to-end tests of QVK Beta Portal through the real Worker fetch handler.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHmac, createHash } from "node:crypto";
import { createD1 } from "./helpers/d1.js";
import worker from "../src/index.js";
import { resetSchemaCache } from "../src/portal/schema.js";
import { sniff } from "../src/portal/files.js";
import { tokens, similarity } from "../src/portal/tickets.js";

const ORIGIN = "https://portal.test";
const BOT_TOKEN = "123456:TEST";
const ADMIN = "900";

function makeEnv() {
  resetSchemaCache();
  const DB = createD1(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  return { DB, BOT_TOKEN, WEBHOOK_SECRET: "hook-secret", ADMIN_IDS: ADMIN, BOT_USERNAME: "qvk_test_bot" };
}

const sent = [];
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.startsWith("https://api.telegram.org/")) {
    const method = u.split("/").pop();
    const body = init?.body ? JSON.parse(init.body) : {};
    sent.push({ method, body });
    if (method === "sendMessage" && String(body.chat_id) === "666") return Response.json({ ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" }, { status: 403 });
    return Response.json({ ok: true, result: method === "getMe" ? { username: "qvk_test_bot" } : method === "sendMessage" ? { message_id: 1 } : true });
  }
  throw new Error("Unexpected fetch " + u);
};

async function call(env, path, { method = "GET", body, cookie, csrf, headers = {}, raw } = {}) {
  const h = new Headers({ origin: ORIGIN, "x-qvk": "1", ...headers });
  if (cookie) h.set("cookie", cookie);
  if (csrf) h.set("x-csrf", csrf);
  let b = raw;
  if (body !== undefined) {
    h.set("content-type", "application/json");
    b = JSON.stringify(body);
  }
  const waits = [];
  const res = await worker.fetch(new Request(ORIGIN + path, { method, headers: h, body: b }), env, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  return res;
}
const jsonOf = async (res) => ({ status: res.status, data: await res.json() });
const cookieVal = (res, name) => {
  const all = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get("set-cookie")];
  for (const c of all) {
    const m = c && c.match(new RegExp("^" + name.replace(/[-$]/g, "\\$&") + "=([^;]*)"));
    if (m) return name + "=" + m[1];
  }
  return null;
};

let updateId = 1000;
async function webhook(env, update) {
  return call(env, "/webhook", { method: "POST", body: { update_id: ++updateId, ...update }, headers: { "X-Telegram-Bot-Api-Secret-Token": "hook-secret" } });
}

/** Full login through the bot. Returns {cookie, csrf, me}. */
async function login(env, userId, first = "User" + userId) {
  const start = await call(env, "/api/p/auth/start", { method: "POST" });
  assert.equal(start.status, 200);
  const nonce = cookieVal(start, "__Host-qvk_l");
  const { link, code } = await start.json();
  const token = link.split("start=")[1];
  assert.match(token, /^login_[a-f0-9]{32}$/);
  const from = { id: Number(userId), first_name: first, username: "u" + userId };
  await webhook(env, { message: { message_id: 1, chat: { id: Number(userId), type: "private" }, from, text: "/start " + token, date: 1 } });
  const prompt = sent.filter((s) => s.method === "sendMessage" && String(s.body.chat_id) === String(userId)).pop();
  assert.ok(prompt.body.text.includes(code), "bot shows the same code as the site");
  const cb = prompt.body.reply_markup.inline_keyboard[0][0].callback_data;
  assert.match(cb, /^pl:ok:\d+$/);
  // Pending until confirmed.
  assert.equal((await (await call(env, "/api/p/auth/poll", { cookie: nonce })).json()).status, "pending");
  await webhook(env, { callback_query: { id: "cq" + userId, from, data: cb, message: { message_id: 5, chat: { id: Number(userId), type: "private" } } } });
  const poll = await call(env, "/api/p/auth/poll", { cookie: nonce });
  assert.equal((await poll.clone().json()).status, "ok");
  const cookie = cookieVal(poll, "__Host-qvk_s");
  assert.ok(cookie, "session cookie issued");
  // The confirmation is single-use.
  assert.notEqual((await (await call(env, "/api/p/auth/poll", { cookie: nonce })).json()).status, "ok");
  const me = (await jsonOf(await call(env, "/api/p/me", { cookie }))).data;
  return { cookie, csrf: me.csrf, me };
}
const as = (env, s) => ({
  get: (p) => call(env, p, { cookie: s.cookie }).then(jsonOf),
  send: (method, p, body) => call(env, p, { method, body, cookie: s.cookie, csrf: s.csrf }).then(jsonOf),
});

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(3000).fill(7)]);
async function uploadPng(env, s, name = "shot.png", bytes = PNG, type = "image/png") {
  const fd = new FormData();
  fd.append("file", new Blob([bytes], { type }), name);
  const req = new Request(ORIGIN + "/api/p/upload", { method: "POST", body: fd, headers: { origin: ORIGIN, cookie: s.cookie, "x-csrf": s.csrf } });
  return jsonOf(await worker.fetch(req, env, { waitUntil() {} }));
}

const BUG = { kind: "bug", category: "music", title: "Плеер останавливается при блокировке экрана", description: "Музыка перестаёт играть через несколько секунд после блокировки.", steps: "1. Включить трек\n2. Заблокировать экран", expected: "Музыка играет", actual: "Остановка", frequency: "always" };

test("portal: pages, assets and existing routes", async () => {
  const env = makeEnv();
  const home = await call(env, "/");
  assert.equal(home.status, 200);
  assert.match(home.headers.get("content-security-policy"), /default-src 'self'/);
  assert.match(await home.text(), /QVK Beta Portal/);
  for (const p of ["/admin", "/bugs/BUG-0001", "/my", "/new/bug"]) assert.equal((await call(env, p)).status, 200, p);
  const js = await call(env, "/assets/portal.js");
  assert.match(js.headers.get("content-type"), /javascript/);
  assert.equal((await call(env, "/health")).status, 200, "moderator health route intact");
  assert.equal((await call(env, "/app")).status, 200, "moderator mini app intact");
  assert.equal((await call(env, "/nope")).status, 404);
  assert.equal((await call(env, "/api/p/me")).status, 401);
});

test("portal: full tester + admin workflow", async () => {
  const env = makeEnv();
  const alice = await login(env, 101, "Алиса");
  const bob = await login(env, 102, "Боб");
  const admin = await login(env, ADMIN, "Админ");
  assert.equal(alice.me.is_admin, false);
  assert.equal(admin.me.is_admin, true);
  const A = as(env, alice), B = as(env, bob), X = as(env, admin);

  // Device profile.
  let r = await A.send("POST", "/api/p/devices", { model: "Pixel 8", android: "15", app_version: "3.0", firmware: "" });
  assert.equal(r.status, 200);
  const devId = r.data.id;
  r = await A.send("POST", "/api/p/devices", { model: "Galaxy S21", android: "14", app_version: "3.0" });
  assert.equal((await A.get("/api/p/me")).data.devices.length, 2);
  assert.equal((await A.send("PATCH", "/api/p/me", { active_device: r.data.id })).status, 200);
  assert.equal((await B.send("DELETE", "/api/p/devices/" + devId)).status, 404, "cannot delete another user's device");
  await B.send("POST", "/api/p/devices", { model: "Redmi Note 12", android: "13", app_version: "3.0" });
  const bobDev = (await B.get("/api/p/me")).data.devices[0].id;

  // Attachments: type sniffing.
  const up = await uploadPng(env, alice);
  assert.equal(up.status, 200);
  assert.equal(up.data.attachment.mime, "image/png");
  const exe = await uploadPng(env, alice, "evil.png", Uint8Array.from([0x4d, 0x5a, 1, 2, 3, 4]), "image/png");
  assert.equal(exe.status, 415, "fake image rejected");

  // Bug creation with BUG-0001 numbering.
  r = await A.send("POST", "/api/p/tickets", { ...BUG, device_id: devId, attachments: [up.data.attachment.id] });
  assert.equal(r.status, 200);
  assert.equal(r.data.code, "BUG-0001");
  r = await A.send("POST", "/api/p/tickets", { ...BUG, title: "x" });
  assert.equal(r.status, 400, "validation");
  r = await A.send("POST", "/api/p/tickets", { kind: "idea", category: "ui", title: "Тёмная тема для плеера", description: "Добавить отдельную тёмную тему для плеера." });
  assert.equal(r.data.code, "IDEA-0001");

  // Detail snapshot of device + attachment.
  let t = (await A.get("/api/p/tickets/BUG-0001")).data;
  assert.equal(t.device.model, "Pixel 8");
  assert.equal(t.attachments.length, 1);
  assert.equal(t.can.edit, true);
  assert.equal(t.can.admin, false);

  // File access: author ok, others ok while public, Range works.
  const f1 = await call(env, "/files/" + t.attachments[0].id, { cookie: alice.cookie, headers: { range: "bytes=0-7" } });
  assert.equal(f1.status, 206);
  assert.deepEqual([...new Uint8Array(await f1.arrayBuffer())], [...PNG.slice(0, 8)]);
  assert.equal((await call(env, "/files/" + t.attachments[0].id)).status, 401, "files require login");

  // Duplicate search finds the existing report.
  const sim = (await B.send("POST", "/api/p/similar", { kind: "bug", title: "Плеер останавливается после блокировки экрана", category: "music" })).data;
  assert.equal(sim.items[0]?.code, "BUG-0001");

  // "Me too", comment, vote, favourite.
  r = await B.send("POST", "/api/p/tickets/BUG-0001/confirm", {});
  assert.equal(r.data.confirms, 1);
  assert.equal((await A.send("POST", "/api/p/tickets/BUG-0001/confirm", {})).status, 400, "author cannot confirm own bug");
  assert.equal((await B.send("POST", "/api/p/tickets/BUG-0001/comments", { body: "У меня тоже <script>alert(1)</script>" })).status, 200);
  r = await B.send("POST", "/api/p/tickets/IDEA-0001/vote", {});
  assert.deepEqual([r.data.on, r.data.votes], [true, 1]);
  r = await B.send("POST", "/api/p/tickets/IDEA-0001/vote", {});
  assert.deepEqual([r.data.on, r.data.votes], [false, 0], "vote can be withdrawn");
  await B.send("POST", "/api/p/tickets/IDEA-0001/vote", {});
  await B.send("POST", "/api/p/tickets/BUG-0001/favorite", {});
  assert.equal((await B.get("/api/p/tickets?kind=bug&scope=fav")).data.items.length, 1);

  // Permission checks.
  assert.equal((await B.send("POST", "/api/p/tickets/BUG-0001/admin", { status: "fixed" })).status, 403, "testers cannot change status");
  assert.equal((await B.get("/api/p/admin/stats")).status, 403);
  assert.equal((await B.send("PATCH", "/api/p/tickets/BUG-0001", { title: "Взлом заголовка" })).status, 403, "only author edits");
  assert.equal((await call(env, "/api/p/tickets/BUG-0001/comments", { method: "POST", body: { body: "no csrf" }, cookie: bob.cookie })).status, 403, "CSRF token required");
  assert.equal((await call(env, "/api/p/tickets/BUG-0001/comments", { method: "POST", body: { body: "x" }, cookie: bob.cookie, csrf: bob.csrf, headers: { origin: "https://evil.example" } })).status, 403, "cross-origin rejected");
  assert.equal((await call(env, "/api/p/me", { cookie: bob.cookie, headers: { "x-qvk": "", "x-forwarded-user": ADMIN } })).status, 200);
  assert.equal((await B.get("/api/p/me")).data.is_admin, false, "admin never from client data");

  // Author edits while new.
  assert.equal((await A.send("PATCH", "/api/p/tickets/BUG-0001", { title: "Плеер останавливается при блокировке экрана (Pixel)" })).status, 200);

  // Admin: status → need_info → notification; then verify flow.
  sent.length = 0;
  r = await X.send("POST", "/api/p/tickets/BUG-0001/admin", { status: "need_info", note: "Пришлите лог", priority: "high" });
  assert.equal(r.status, 200);
  let notes = (await A.get("/api/p/notifications")).data.items;
  assert.equal(notes[0].type, "need_info");
  assert.ok(sent.some((s) => s.method === "sendMessage" && s.body.chat_id === "101"), "Telegram DM sent to author");
  assert.equal((await A.get("/api/p/pulse")).data.unread, 2, "comment by Bob + need_info");
  await A.send("POST", "/api/p/tickets/BUG-0001/comments", { body: "Лог приложен", kind: "addendum" });
  await X.send("POST", "/api/p/tickets/BUG-0001/comments", { body: "Спасибо, принято" });
  await X.send("POST", "/api/p/tickets/BUG-0001/admin", { status: "in_progress" });
  r = await X.send("POST", "/api/p/tickets/BUG-0001/admin", { status: "verify", fixed_version: "3.0.1" });
  t = (await A.get("/api/p/tickets/BUG-0001")).data;
  assert.equal(t.status, "verify");
  assert.equal(t.can.verify, true);
  assert.equal(t.fixed_version, "3.0.1");
  assert.equal(t.priority, "high");
  assert.ok(t.history.some((h) => h.field === "status" && h.new === "verify"));
  assert.equal(t.comment_list.find((c) => c.kind === "addendum")?.author.is_author, true);
  assert.equal((await B.send("POST", "/api/p/tickets/BUG-0001/verify", { result: "fixed" })).status, 403, "only author verifies");
  r = await A.send("POST", "/api/p/tickets/BUG-0001/verify", { result: "still", note: "Всё ещё воспроизводится" });
  assert.equal((await A.get("/api/p/tickets/BUG-0001")).data.status, "confirmed");
  await X.send("POST", "/api/p/tickets/BUG-0001/admin", { status: "verify" });
  await A.send("POST", "/api/p/tickets/BUG-0001/verify", { result: "fixed" });
  t = (await A.get("/api/p/tickets/BUG-0001")).data;
  assert.equal(t.status, "closed");
  assert.equal((await A.send("PATCH", "/api/p/tickets/BUG-0001", { title: "Новое название бага" })).status, 403, "no edits after triage");

  // Cabinet shows last admin comment.
  const mine = (await A.get("/api/p/tickets?kind=bug&scope=mine")).data.items;
  assert.equal(mine[0].last_admin_comment, "Спасибо, принято");

  // Idea: reject with reason → visible to author.
  await X.send("POST", "/api/p/tickets/IDEA-0001/admin", { status: "postponed", note: "Вернёмся после релиза" });
  t = (await A.get("/api/p/tickets/IDEA-0001")).data;
  assert.equal(t.status_note, "Вернёмся после релиза");

  // Duplicate merge.
  r = await B.send("POST", "/api/p/tickets", { ...BUG, title: "Музыка выключается при блокировке", device_id: bobDev });
  assert.equal(r.data.code, "BUG-0002");
  r = await X.send("POST", "/api/p/admin/merge", { source: "BUG-0002", target: "BUG-0001" });
  assert.equal(r.status, 200);
  const dup = (await B.get("/api/p/tickets/BUG-0002")).data;
  assert.equal(dup.status, "duplicate");
  assert.equal(dup.duplicate_of, "BUG-0001");
  assert.equal((await A.get("/api/p/tickets/BUG-0001")).data.duplicates[0].code, "BUG-0002");

  // Hidden tickets & private attachments.
  const up2 = await uploadPng(env, bob, "secret.png");
  await B.send("POST", "/api/p/tickets", { ...BUG, title: "Секретный баг авторизации", category: "auth", device_id: bobDev, attachments: [up2.data.attachment.id] });
  await X.send("POST", "/api/p/tickets/BUG-0003/admin", { hidden: true });
  assert.equal((await A.get("/api/p/tickets/BUG-0003")).status, 404, "hidden from other testers");
  assert.equal((await B.get("/api/p/tickets/BUG-0003")).status, 200, "visible to author");
  assert.equal((await call(env, "/files/" + up2.data.attachment.id, { cookie: alice.cookie })).status, 404, "private attachment protected");
  assert.equal((await call(env, "/files/" + up2.data.attachment.id, { cookie: admin.cookie })).status, 200);
  assert.ok(!(await A.get("/api/p/tickets?kind=bug")).data.items.some((x) => x.code === "BUG-0003"));

  // Bulk actions, filters, sorting.
  r = await X.send("POST", "/api/p/admin/bulk", { codes: ["BUG-0001", "BUG-0003", "IDEA-0001"], priority: "critical", pinned: true });
  assert.ok(r.data.results.every((x) => x.ok));
  let list = (await X.get("/api/p/tickets?kind=bug&priority=critical&sort=priority")).data;
  assert.equal(list.total, 2);
  list = (await A.get("/api/p/tickets?kind=bug&q=" + encodeURIComponent("плеер"))).data;
  assert.equal(list.items[0].code, "BUG-0001");
  list = (await A.get("/api/p/tickets?kind=bug&device=Redmi")).data;
  assert.equal(list.items[0].code, "BUG-0002");
  list = (await A.get("/api/p/tickets?kind=bug&q=" + encodeURIComponent("100%_"))).data;
  assert.equal(list.total, 0, "LIKE wildcards escaped");

  // Stats, known issues, fixes, leaders, export.
  const stats = (await X.get("/api/p/admin/stats")).data;
  assert.equal(stats.bugs.total, 3);
  assert.equal(stats.ideas.total, 1);
  assert.equal(stats.daily.length, 14);
  assert.equal((await A.get("/api/p/fixes")).data.items[0].code, "BUG-0001");
  assert.ok((await A.get("/api/p/leaders")).data.testers.length >= 1);
  const csv = await call(env, "/api/p/admin/export?format=csv&kind=bug", { cookie: admin.cookie });
  assert.match(csv.headers.get("content-type"), /text\/csv/);
  assert.match(await csv.text(), /BUG-0001/);
  assert.equal((await call(env, "/api/p/admin/export?format=json", { cookie: bob.cookie })).status, 403);

  // Settings: version switch + posts.
  await X.send("POST", "/api/p/admin/settings", { current_version: "3.0.2", comments_public: false });
  assert.equal((await A.get("/api/p/home")).data.version, "3.0.2");
  assert.equal((await A.send("POST", "/api/p/tickets/IDEA-0001/comments", { body: "Можно?" })).status, 200, "author may still comment");
  assert.equal((await B.send("POST", "/api/p/tickets/BUG-0001/comments", { body: "А я?" })).status, 403, "public comments switched off");
  await X.send("POST", "/api/p/admin/posts", { kind: "changelog", title: "Сборка 3.0.2", body: "Исправлен плеер", version: "3.0.2" });
  assert.equal((await A.get("/api/p/home")).data.posts[0].title, "Сборка 3.0.2");

  // Drafts.
  await A.send("PUT", "/api/p/drafts/bug", { draft: { title: "черновик" } });
  assert.equal((await A.get("/api/p/drafts/bug")).data.draft.title, "черновик");

  // Telegram DM failure marks user as unreachable without breaking the flow.
  const blocked = await login(env, 666, "Blocked");
  const Z = as(env, blocked);
  await Z.send("POST", "/api/p/devices", { model: "Moto G", android: "12", app_version: "3.0" });
  const zdev = (await Z.get("/api/p/me")).data.devices[0].id;
  r = await Z.send("POST", "/api/p/tickets", { ...BUG, title: "Ошибка у заблокировавшего бота", device_id: zdev });
  assert.equal((await X.send("POST", "/api/p/tickets/" + r.data.code + "/admin", { status: "confirmed" })).status, 200);
  assert.equal((await Z.get("/api/p/me")).data.user.tg_blocked, true);

  // Profile deletion keeps reports but anonymises them.
  assert.equal((await call(env, "/api/p/me", { method: "DELETE", cookie: bob.cookie, csrf: bob.csrf })).status, 200);
  assert.equal((await B.get("/api/p/me")).status, 401);
  assert.equal((await A.get("/api/p/tickets/BUG-0002")).data.author.name, "Удалённый тестировщик");
});

test("portal: login confirmation is bound to the Telegram user and browser", async () => {
  const env = makeEnv();
  const start = await call(env, "/api/p/auth/start", { method: "POST" });
  const nonce = cookieVal(start, "__Host-qvk_l");
  const token = (await start.json()).link.split("start=")[1];
  await webhook(env, { message: { message_id: 1, chat: { id: 201, type: "private" }, from: { id: 201, first_name: "A" }, text: "/start " + token, date: 1 } });
  const cb = sent.filter((s) => s.body.chat_id === 201).pop().body.reply_markup.inline_keyboard[0][0].callback_data;
  // Another Telegram account presses the button.
  await webhook(env, { callback_query: { id: "x", from: { id: 202, first_name: "B" }, data: cb } });
  assert.equal((await (await call(env, "/api/p/auth/poll", { cookie: nonce })).json()).status, "pending");
  // Without the nonce cookie the token cannot be redeemed.
  await webhook(env, { callback_query: { id: "y", from: { id: 201, first_name: "A" }, data: cb } });
  assert.equal((await (await call(env, "/api/p/auth/poll", {})).json()).status, "missing");
  // Requests without the custom header are refused.
  assert.equal((await call(env, "/api/p/auth/start", { method: "POST", headers: { "x-qvk": "" } })).status, 403);
  // Webhook without secret is refused (existing behaviour).
  assert.equal((await call(env, "/webhook", { method: "POST", body: {} })).status, 401);
});

test("portal: Telegram Login Widget signature verification", async () => {
  const env = makeEnv();
  await call(env, "/");
  await env.DB.prepare("UPDATE portal_settings SET value='on' WHERE key='login_widget'").run();
  const data = { id: "301", first_name: "W", auth_date: String(Math.floor(Date.now() / 1000)) };
  const check = Object.keys(data).sort().map((k) => k + "=" + data[k]).join("\n");
  const secret = createHash("sha256").update(BOT_TOKEN).digest();
  const hash = createHmac("sha256", secret).update(check).digest("hex");
  const ok = await call(env, "/auth/telegram?" + new URLSearchParams({ ...data, hash }));
  assert.equal(ok.status, 302);
  assert.ok(cookieVal(ok, "__Host-qvk_s"));
  const bad = await call(env, "/auth/telegram?" + new URLSearchParams({ ...data, first_name: "Evil", hash }));
  assert.equal(cookieVal(bad, "__Host-qvk_s"), null);
});

test("portal: rate limiting of report creation", async () => {
  const env = makeEnv();
  const s = await login(env, 401);
  const A = as(env, s);
  await A.send("POST", "/api/p/devices", { model: "Pixel", android: "15", app_version: "3.0" });
  const dev = (await A.get("/api/p/me")).data.devices[0].id;
  let last;
  for (let i = 0; i < 13; i++) last = await A.send("POST", "/api/p/tickets", { ...BUG, title: "Ошибка номер " + i, device_id: dev });
  assert.equal(last.status, 429);
});

test("portal: file sniffing and duplicate scoring", () => {
  assert.equal(sniff(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg", "a.jpg"), "image/jpeg");
  assert.equal(sniff(new TextEncoder().encode("log line\n"), "text/plain", "app.log"), "text/plain");
  assert.equal(sniff(new TextEncoder().encode("<html><script>"), "text/html", "x.html"), null);
  assert.equal(sniff(Uint8Array.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]), "video/mp4", "v.mp4"), "video/mp4");
  assert.ok(similarity(tokens("Плеер останавливается при блокировке"), tokens("Плеер останавливается после блокировки экрана")) >= 0.6);
  assert.ok(similarity(tokens("Не приходят уведомления"), tokens("Тёмная тема в настройках")) < 0.2);
});
