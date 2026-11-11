// End-to-end tests of QVK Beta Portal through the real Worker fetch handler.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createD1 } from "./helpers/d1.js";
import { deflateRawSync, crc32 } from "node:zlib";
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
  if (u.startsWith("https://fcm.googleapis.com/")) {
    pushes.push({ url: u, headers: Object.fromEntries(new Headers(init.headers)), body: new Uint8Array(init.body) });
    return new Response(null, { status: u.endsWith("/gone") ? 410 : 201 });
  }
  throw new Error("Unexpected fetch " + u);
};
const pushes = [];

/** A fake browser push subscription with its private key, to decrypt what the server sends. */
async function fakeBrowser(name) {
  const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const b64u = (b) => Buffer.from(b).toString("base64url");
  return { kp, auth, sub: { endpoint: "https://fcm.googleapis.com/fcm/send/" + name, keys: { p256dh: b64u(await crypto.subtle.exportKey("raw", kp.publicKey)), auth: b64u(auth) } } };
}
async function decryptPush(browser, body) {
  const hk = async (salt, ikm, info, n) => new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]), n * 8));
  const salt = body.slice(0, 16), idlen = body[20], asPub = body.slice(21, 21 + idlen), ct = body.slice(21 + idlen);
  const uaPub = new Uint8Array(await crypto.subtle.exportKey("raw", browser.kp.publicKey));
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: await crypto.subtle.importKey("raw", asPub, { name: "ECDH", namedCurve: "P-256" }, false, []) }, browser.kp.privateKey, 256));
  const te = new TextEncoder();
  const ikm = await hk(browser.auth, ecdh, Buffer.concat([te.encode("WebPush: info\0"), uaPub, asPub]), 32);
  const cek = await hk(salt, ikm, te.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hk(salt, ikm, te.encode("Content-Encoding: nonce\0"), 12);
  const pt = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]), ct));
  assert.equal(pt[pt.length - 1], 2, "last-record delimiter");
  return JSON.parse(new TextDecoder().decode(pt.slice(0, -1)));
}

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

/** Registers "nick" with a password and links Telegram id `tgId` through the bot. Returns {cookie, csrf, me}. */
async function login(env, tgId, nick = "user" + tgId, { link = true } = {}) {
  const reg = await call(env, "/api/p/auth/register", { method: "POST", body: { nick, password: "secret-pass-" + tgId } });
  assert.equal(reg.status, 200, "register " + nick);
  const cookie = cookieVal(reg, "__Host-qvk_s");
  assert.ok(cookie, "session cookie issued");
  let me = (await jsonOf(await call(env, "/api/p/me", { cookie }))).data;
  if (link) {
    await linkTelegram(env, cookie, me.csrf, tgId);
    me = (await jsonOf(await call(env, "/api/p/me", { cookie }))).data;
    assert.equal(me.user.tg_linked, true);
  }
  return { cookie, csrf: me.csrf, me };
}
async function linkTelegram(env, cookie, csrf, tgId, presserId = tgId) {
  const r = await jsonOf(await call(env, "/api/p/tg/link", { method: "POST", cookie, csrf, body: {} }));
  assert.equal(r.status, 200);
  const token = r.data.link.split("start=")[1];
  assert.match(token, /^link_[a-f0-9]{32}$/);
  const from = { id: Number(tgId), first_name: "TG" + tgId, username: "tg" + tgId };
  await webhook(env, { message: { message_id: 1, chat: { id: Number(tgId), type: "private" }, from, text: "/start " + token, date: 1 } });
  const prompt = sent.filter((x) => x.method === "sendMessage" && String(x.body.chat_id) === String(tgId)).pop();
  const cb = prompt.body.reply_markup.inline_keyboard[0][0].callback_data;
  assert.match(cb, /^pl:ok:[a-f0-9]{40}$/);
  await webhook(env, { callback_query: { id: "cq" + tgId, from: { ...from, id: Number(presserId) }, data: cb, message: { message_id: 5, chat: { id: Number(tgId), type: "private" } } } });
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

/** Builds a ZIP with deflated entries. */
function makeZip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text), comp = deflateRawSync(raw), nm = Buffer.from(name), crc = crc32(raw);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nm.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, nm, comp); centrals.push(ch, nm);
    offset += 30 + nm.length + comp.length;
  }
  const cd = Buffer.concat(centrals), eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(Object.keys(files).length, 8); eocd.writeUInt16LE(Object.keys(files).length, 10); eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, eocd]));
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

test("portal: nickname + password accounts", async () => {
  const env = makeEnv();
  const reg = (body) => call(env, "/api/p/auth/register", { method: "POST", body }).then(jsonOf);
  const login = (body) => call(env, "/api/p/auth/login", { method: "POST", body });
  assert.equal((await reg({ nick: "Tester_1", password: "password-1" })).status, 200);
  assert.equal((await reg({ nick: "tester_1", password: "password-2" })).status, 409, "nick is unique case-insensitively");
  assert.equal((await reg({ nick: "a", password: "password-1" })).status, 400, "short nick");
  assert.equal((await reg({ nick: "<script>", password: "password-1" })).status, 400, "bad characters");
  assert.equal((await reg({ nick: "shortpw", password: "123" })).status, 400, "short password");
  assert.equal((await login({ nick: "tester_1", password: "wrong-password" })).status, 401);
  assert.equal((await login({ nick: "nobody", password: "password-1" })).status, 401);
  const ok = await login({ nick: "TESTER_1", password: "password-1" });
  assert.equal(ok.status, 200);
  const cookie = cookieVal(ok, "__Host-qvk_s");
  const me = (await jsonOf(await call(env, "/api/p/me", { cookie }))).data;
  assert.equal(me.user.name, "Tester_1");
  assert.equal(me.is_admin, false);
  // Stored hash is PBKDF2, never the plain password.
  const row = await env.DB.prepare("SELECT pass_hash FROM portal_users WHERE nick_lc='tester_1'").first();
  assert.match(row.pass_hash, /^pbkdf2\$100000\$/);
  assert.ok(!row.pass_hash.includes("password-1"));
  // Registering the admin's nickname does NOT give admin rights.
  const fake = await reg({ nick: "admin", password: "password-9" });
  const fc = cookieVal(await login({ nick: "admin", password: "password-9" }), "__Host-qvk_s");
  assert.equal(fake.status, 200);
  assert.equal((await jsonOf(await call(env, "/api/p/me", { cookie: fc }))).data.is_admin, false);
  // Password change signs out other sessions.
  const other = cookieVal(await login({ nick: "tester_1", password: "password-1" }), "__Host-qvk_s");
  const r = await call(env, "/api/p/me/password", { method: "POST", cookie, csrf: me.csrf, body: { current: "password-1", password: "password-new" } });
  assert.equal(r.status, 200);
  assert.equal((await call(env, "/api/p/me", { cookie: other })).status, 401);
  assert.equal((await call(env, "/api/p/me", { cookie })).status, 200);
  assert.equal((await login({ nick: "tester_1", password: "password-new" })).status, 200);
  // Brute force is rate limited per nickname.
  let last;
  for (let i = 0; i < 12; i++) last = await login({ nick: "tester_1", password: "bad" + i });
  assert.equal(last.status, 429);
  // Requests without the custom header are refused.
  assert.equal((await call(env, "/api/p/auth/login", { method: "POST", body: {}, headers: { "x-qvk": "" } })).status, 403);
  assert.equal((await call(env, "/webhook", { method: "POST", body: {} })).status, 401, "existing webhook protection intact");
});

test("portal: Telegram linking is confirmed by the same Telegram user; admin via ADMIN_IDS", async () => {
  const env = makeEnv();
  const s = await login(env, 501, "linkme", { link: false });
  // Someone else pressing the button cannot link.
  await linkTelegram(env, s.cookie, s.csrf, 501, 502);
  assert.equal((await jsonOf(await call(env, "/api/p/me", { cookie: s.cookie }))).data.user.tg_linked, false);
  const adm = await login(env, ADMIN, "boss", { link: false });
  assert.equal(adm.me.is_admin, false, "no admin before Telegram link");
  assert.equal((await call(env, "/api/p/admin/stats", { cookie: adm.cookie })).status, 403);
  await linkTelegram(env, adm.cookie, adm.csrf, ADMIN);
  const me = (await jsonOf(await call(env, "/api/p/me", { cookie: adm.cookie }))).data;
  assert.equal(me.is_admin, true);
  assert.equal((await call(env, "/api/p/admin/stats", { cookie: adm.cookie })).status, 200);
  // Admin resets a forgotten password.
  const users = (await jsonOf(await call(env, "/api/p/admin/users", { cookie: adm.cookie }))).data.items;
  const target = users.find((u) => u.name === "linkme");
  assert.equal((await call(env, "/api/p/admin/users/" + target.id, { method: "POST", cookie: adm.cookie, csrf: me.csrf, body: { password: "temporary-1" } })).status, 200);
  assert.equal((await call(env, "/api/p/me", { cookie: s.cookie })).status, 401, "old sessions revoked");
  assert.equal((await call(env, "/api/p/auth/login", { method: "POST", body: { nick: "linkme", password: "temporary-1" } })).status, 200);
  // Unlinking Telegram removes admin rights.
  await call(env, "/api/p/tg/unlink", { method: "POST", cookie: adm.cookie, csrf: me.csrf, body: {} });
  assert.equal((await jsonOf(await call(env, "/api/p/me", { cookie: adm.cookie }))).data.is_admin, false);
});

test("portal: MCP connector gives Claude admin access as «Команда QVK»", async () => {
  const env = makeEnv();
  const admin = await login(env, ADMIN, "boss");
  const tester = await login(env, 777, "tester777");
  const X = as(env, admin), A = as(env, tester);
  await A.send("POST", "/api/p/devices", { model: "Pixel 9", android: "15", app_version: "3.0" });
  const dev = (await A.get("/api/p/me")).data.devices[0].id;
  const img = (await uploadPng(env, tester)).data.attachment;
  const log = (await uploadPng(env, tester, "app.log", new TextEncoder().encode("start\n" + "x".repeat(70000) + "\nFATAL crash in Player\n"), "text/plain")).data.attachment;
  const zip = (await uploadPng(env, tester, "logs.zip", makeZip({ "logcat.txt": "E/Player: boom\n".repeat(50), "bin.dat": "\u0000\u0001\u0002" }), "application/zip")).data.attachment;
  assert.ok(img && log && zip, "uploads ok");
  await A.send("POST", "/api/p/tickets", { ...BUG, device_id: dev, attachments: [img.id, log.id, zip.id] });
  await A.send("POST", "/api/p/tickets", { ...BUG, title: "Музыка выключается после блокировки", device_id: dev });

  const rpc = async (path, body, headers = {}) => {
    const res = await call(env, path, { method: "POST", body, headers: { origin: "", "x-qvk": "", ...headers } });
    return { status: res.status, data: res.status === 202 ? null : await res.json() };
  };
  // Disabled by default.
  assert.equal((await rpc("/mcp/qvk_" + "0".repeat(48), { jsonrpc: "2.0", id: 1, method: "tools/list" })).status, 401);
  // Only admins manage the key.
  assert.equal((await A.send("POST", "/api/p/admin/mcp", {})).status, 403);
  const k = await X.send("POST", "/api/p/admin/mcp", {});
  assert.equal(k.status, 200);
  assert.match(k.data.key, /^qvk_[a-f0-9]{48}$/);
  const key = k.data.key;
  assert.ok(!(await env.DB.prepare("SELECT value FROM portal_settings WHERE key='mcp_key_hash'").first()).value.includes(key), "only hash stored");
  assert.equal((await rpc("/mcp/qvk_" + "1".repeat(48), { jsonrpc: "2.0", id: 1, method: "tools/list" })).status, 401, "wrong key");

  const init = await rpc("/mcp/" + key, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
  assert.equal(init.data.result.protocolVersion, "2025-06-18");
  assert.equal((await rpc("/mcp/" + key, { jsonrpc: "2.0", method: "notifications/initialized" })).status, 202);
  const tools = (await rpc("/mcp/" + key, { jsonrpc: "2.0", id: 2, method: "tools/list" })).data.result.tools.map((t) => t.name);
  for (const n of ["get_overview", "list_tickets", "get_ticket", "update_ticket", "bulk_update", "add_comment", "merge_duplicate", "list_testers", "publish_post", "update_settings"]) assert.ok(tools.includes(n), n);
  // Bearer auth works too.
  const call2 = (name, args, viaBearer = false) =>
    rpc(viaBearer ? "/mcp" : "/mcp/" + key, { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name, arguments: args } }, viaBearer ? { authorization: "Bearer " + key } : {}).then((r) => {
      const res = r.data.result;
      return { isError: !!res.isError, data: res.isError ? res.content[0].text : JSON.parse(res.content[0].text) };
    });
  const list = await call2("list_tickets", { kind: "bug", status: "new" }, true);
  assert.equal(list.data.total, 2);
  const gt = (await rpc("/mcp/" + key, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "get_ticket", arguments: { code: "BUG-0001" } } })).data.result;
  assert.ok(gt.content.some((c) => c.type === "image" && c.mimeType === "image/png"), "get_ticket attaches screenshots");
  assert.ok(gt.content.some((c) => c.type === "text" && c.text.includes("FATAL crash in Player")), "get_ticket attaches log tail");
  const t = { data: JSON.parse(gt.content[0].text) };
  assert.equal(t.data.device.model, "Pixel 9");
  assert.equal(t.data.attachments.length, 3);
  // Attachments are viewable through the connector.
  const raw = (args) => rpc("/mcp/" + key, { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "get_attachment", arguments: args } }).then((r) => r.data.result);
  const ri = await raw({ id: img.id });
  assert.equal(ri.content[1].type, "image");
  assert.equal(ri.content[1].mimeType, "image/png");
  assert.deepEqual([...Buffer.from(ri.content[1].data, "base64")], [...PNG]);
  const rl = await raw({ id: log.id });
  assert.match(rl.content[0].text, /offset=60000/);
  const tail = await raw({ id: log.id, offset: -100 });
  assert.match(tail.content[0].text, /FATAL crash in Player/);
  const rz = JSON.parse((await raw({ id: zip.id })).content[0].text);
  assert.deepEqual(rz.files.map((f) => f.name), ["logcat.txt", "bin.dat"]);
  assert.match((await raw({ id: zip.id, entry: "logcat.txt" })).content[0].text, /E\/Player: boom/);
  assert.match((await raw({ id: zip.id, entry: "bin.dat" })).content[0].text, /двоичный/);
  assert.equal((await raw({ id: "a".repeat(20) })).isError, true);
  sent.length = 0;
  const up = await call2("update_ticket", { code: "BUG-0001", status: "confirmed", priority: "high", note: "Воспроизвели" });
  assert.equal(up.data.ticket.status, "confirmed");
  assert.equal((await call2("update_ticket", { code: "BUG-0001", status: "nonsense" })).isError, true, "validation errors are reported");
  await call2("add_comment", { code: "BUG-0001", text: "Спасибо, уже исправляем" });
  // Tester sees the team, not "Claude".
  const view = (await A.get("/api/p/tickets/BUG-0001")).data;
  const c = view.comment_list.find((x) => x.body === "Спасибо, уже исправляем");
  assert.equal(c.author.name, "Команда QVK");
  assert.equal(c.author.is_admin, true);
  assert.equal(view.history.find((h) => h.field === "status" && h.new === "confirmed").actor, "Команда QVK");
  const notes = (await A.get("/api/p/notifications")).data.items;
  assert.ok(notes.some((n) => n.type === "comment") && notes.some((n) => n.type === "status"));
  assert.ok(sent.some((m) => m.method === "sendMessage" && m.body.chat_id === "777"), "tester DM via bot");
  assert.ok(!JSON.stringify(view).includes("Claude"), "no Claude mention for testers");
  // Merge, posts, settings, overview, testers.
  assert.equal((await call2("merge_duplicate", { source: "BUG-0002", target: "BUG-0001" })).data.ok, true);
  await call2("publish_post", { kind: "changelog", title: "Сборка 3.0.3", body: "Исправлен плеер", version: "3.0.3" });
  await call2("update_settings", { current_version: "3.0.3" });
  assert.equal((await A.get("/api/p/home")).data.version, "3.0.3");
  assert.equal((await A.get("/api/p/home")).data.posts[0].title, "Сборка 3.0.3");
  const ov = await call2("get_overview", {});
  assert.equal(ov.data.bugs.total, 2);
  const testers = await call2("list_testers", {});
  assert.ok(!testers.data.some((u) => u.user_id === "claude"));
  // Status/revoke.
  assert.ok((await X.get("/api/p/admin/mcp")).data.last_used);
  await X.send("DELETE", "/api/p/admin/mcp");
  assert.equal((await rpc("/mcp/" + key, { jsonrpc: "2.0", id: 1, method: "tools/list" })).status, 401, "revoked");
});

test("portal: news are broadcast to Telegram and browser push", async () => {
  const env = makeEnv();
  const admin = await login(env, ADMIN, "boss");
  const linked = await login(env, 801, "with_tg");
  const optout = await login(env, 802, "no_news");
  const webOnly = await login(env, 803, "web_only", { link: false });
  const X = as(env, admin), L = as(env, linked), O = as(env, optout), W = as(env, webOnly);
  await O.send("PATCH", "/api/p/me", { notify_news: false });
  // Browser subscriptions.
  const key = (await W.get("/api/p/push/key")).data.publicKey;
  assert.equal(Buffer.from(key, "base64url").length, 65);
  const br = await fakeBrowser("web-only-1");
  assert.equal((await W.send("POST", "/api/p/push/subscribe", br.sub)).status, 200);
  assert.equal((await W.send("POST", "/api/p/push/subscribe", { ...br.sub, endpoint: "https://evil.example/push" })).status, 400, "only real push services");
  const gone = await fakeBrowser("gone");
  await L.send("POST", "/api/p/push/subscribe", gone.sub);
  assert.equal((await W.get("/api/p/me")).data.user.push_count, 1);

  sent.length = 0;
  pushes.length = 0;
  const r = await X.send("POST", "/api/p/admin/posts", { kind: "changelog", title: "Сборка 3.0.4", body: "• Исправлен плеер\n• <b>Новое</b> меню", version: "3.0.4" });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.sent, { telegram: 2, push: 2 }, "admin + linked tester by Telegram (opt-out skipped), two browsers");
  const tgNews = sent.filter((m) => m.method === "sendMessage" && /Сборка 3\.0\.4/.test(m.body.text));
  assert.deepEqual(tgNews.map((m) => m.body.chat_id).sort(), ["801", ADMIN]);
  assert.match(tgNews[0].body.text, /&lt;b&gt;Новое&lt;\/b&gt;/, "post text is HTML-escaped for Telegram");
  // Push: encrypted correctly, VAPID-signed.
  const p1 = pushes.find((x) => x.url.endsWith("web-only-1"));
  assert.equal(p1.headers["content-encoding"], "aes128gcm");
  const [, jwt, k] = p1.headers.authorization.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, key);
  const [h, c, sig] = jwt.split(".");
  const vk = await crypto.subtle.importKey("raw", Buffer.from(key, "base64url"), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  assert.ok(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, vk, Buffer.from(sig, "base64url"), new TextEncoder().encode(h + "." + c)), "VAPID signature valid");
  assert.equal(JSON.parse(Buffer.from(c, "base64url")).aud, "https://fcm.googleapis.com");
  const msg = await decryptPush(br, p1.body);
  assert.match(msg.title, /Сборка 3\.0\.4/);
  assert.equal(msg.url, "/updates");
  // Expired subscription removed.
  assert.equal((await L.get("/api/p/me")).data.user.push_count, 0);
  // In-app notification for everyone, queue drained.
  assert.equal((await W.get("/api/p/notifications")).data.items[0].type, "news");
  assert.equal((await env.DB.prepare("SELECT COUNT(*) n FROM portal_outbox").first()).n, 0);
  assert.equal((await W.get("/api/p/posts")).data.items[0].recipients, 4);
  // notify:false publishes silently.
  sent.length = 0; pushes.length = 0;
  const silent = await X.send("POST", "/api/p/admin/posts", { title: "Тихая запись", body: "без рассылки", notify: false });
  assert.equal(silent.data.sent, undefined);
  assert.equal(sent.length + pushes.length, 0);
  // Personal notifications also reach the browser.
  await W.send("POST", "/api/p/devices", { model: "Pixel", android: "15", app_version: "3.0" });
  const dev = (await W.get("/api/p/me")).data.devices[0].id;
  await W.send("POST", "/api/p/tickets", { ...BUG, device_id: dev });
  pushes.length = 0;
  await X.send("POST", "/api/p/tickets/BUG-0001/admin", { status: "confirmed" });
  const personal = await decryptPush(br, pushes.find((x) => x.url.endsWith("web-only-1")).body);
  assert.equal(personal.url, "/bugs/BUG-0001");
  // Large audiences are delivered in batches by the cron handler.
  for (let i = 0; i < 50; i++) await env.DB.prepare("INSERT INTO portal_outbox(channel,target,payload,created) VALUES('tg',?,?,0)").bind(String(5000 + i), JSON.stringify({ title: "x", body: "y" })).run();
  await worker.scheduled({}, env, { waitUntil: (p) => p });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal((await env.DB.prepare("SELECT COUNT(*) n FROM portal_outbox").first()).n, 15, "35 per run");
  // Service worker is served.
  const sw = await call(env, "/sw.js");
  assert.match(await sw.text(), /showNotification/);
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
