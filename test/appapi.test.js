// Tests of the QVK app API (/api/app/v1) through the real Worker fetch handler.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deflateRawSync, crc32 } from "node:zlib";
import { createD1 } from "./helpers/d1.js";
import worker from "../src/index.js";
import { resetSchemaCache } from "../src/portal/schema.js";

const ORIGIN = "https://portal.test";
const ADMIN = "900";
const sent = [];
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.startsWith("https://api.telegram.org/")) {
    const method = u.split("/").pop();
    const body = init?.body ? JSON.parse(init.body) : {};
    sent.push({ method, body });
    return Response.json({ ok: true, result: method === "sendMessage" ? { message_id: 1 } : true });
  }
  throw new Error("Unexpected fetch " + u);
};

function makeEnv() {
  resetSchemaCache();
  return { DB: createD1(readFileSync(new URL("../schema.sql", import.meta.url), "utf8")), BOT_TOKEN: "1:T", WEBHOOK_SECRET: "hs", ADMIN_IDS: ADMIN, BOT_USERNAME: "qvk_test_bot" };
}
async function raw(env, path, { method = "GET", body, headers = {}, form } = {}) {
  const h = new Headers(headers);
  let b;
  if (form) b = form;
  else if (body !== undefined) {
    h.set("content-type", "application/json");
    b = typeof body === "string" ? body : JSON.stringify(body);
  }
  const waits = [];
  const res = await worker.fetch(new Request(ORIGIN + path, { method, headers: h, body: b }), env, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  return res;
}
const J = async (res) => ({ status: res.status, headers: res.headers, data: res.headers.get("content-type")?.includes("json") ? await res.json() : null });
const cookieOf = (res) => res.headers.getSetCookie().find((c) => c.startsWith("__Host-qvk_s")).split(";")[0];

let upd = 1;
const hook = (env, u) => raw(env, "/webhook", { method: "POST", body: { update_id: ++upd, ...u }, headers: { "X-Telegram-Bot-Api-Secret-Token": "hs" } });

/** Web account (cookie + csrf) for confirming codes and comparing with the portal. */
async function webUser(env, nick, tgId) {
  const r = await raw(env, "/api/p/auth/register", { method: "POST", body: { nick, password: "password-" + nick }, headers: { origin: ORIGIN, "x-qvk": "1" } });
  assert.equal(r.status, 200);
  const cookie = cookieOf(r);
  const me = (await J(await raw(env, "/api/p/me", { headers: { cookie } }))).data;
  const W = {
    cookie,
    csrf: me.csrf,
    get: (p) => raw(env, p, { headers: { cookie } }).then(J),
    send: (m, p, b = {}) => raw(env, p, { method: m, body: b, headers: { cookie, "x-csrf": me.csrf, origin: ORIGIN, "x-qvk": "1" } }).then(J),
  };
  if (tgId) {
    const link = (await W.send("POST", "/api/p/tg/link")).data.link.split("start=")[1];
    const from = { id: Number(tgId), first_name: nick };
    await hook(env, { message: { message_id: 1, chat: { id: Number(tgId), type: "private" }, from, text: "/start " + link, date: 1 } });
    const cb = sent.filter((x) => x.body.chat_id === Number(tgId)).pop().body.reply_markup.inline_keyboard[0][0].callback_data;
    await hook(env, { callback_query: { id: "c", from, data: cb } });
  }
  return W;
}

/** Links the app to a web account through the portal page flow. Returns an app client. */
async function appFor(env, W, deviceName = "Poco F9 · QVK 3.0") {
  const start = await J(await raw(env, "/api/app/v1/link/start", { method: "POST", body: { device_name: deviceName } }));
  assert.equal(start.status, 201);
  const code = start.data.code.replace("-", "");
  assert.equal((await W.send("POST", "/api/p/app-links/" + code + "/confirm")).status, 200);
  const poll = await J(await raw(env, "/api/app/v1/link/poll", { method: "POST", body: { poll_token: start.data.poll_token } }));
  assert.equal(poll.data.status, "approved");
  return client(env, poll.data.token);
}
function client(env, token) {
  const auth = { authorization: "Bearer " + token };
  return {
    token,
    get: (p) => raw(env, "/api/app/v1" + p, { headers: auth }).then(J),
    send: (m, p, b) => raw(env, "/api/app/v1" + p, { method: m, body: b, headers: auth }).then(J),
    upload: (files) => {
      const fd = new FormData();
      for (const [name, bytes, type] of files) fd.append("file", new Blob([bytes], { type }), name);
      return raw(env, "/api/app/v1/attachments", { method: "POST", form: fd, headers: auth }).then(J);
    },
  };
}
const DEVICE = { model: "Poco F9 Ultra", android: "16", app_version: "8.100-qvk-3.0.0-alpha22", firmware: "HyperOS 3.0.310" };
const BUG = { kind: "bug", category: "music", title: "Плеер падает при смене трека", description: "При свайпе на следующий трек приложение закрывается.", steps: "1. Открыть плеер\n2. Свайпнуть влево", expected: "Следующий трек", actual: "Вылет", frequency: "often", device: DEVICE };
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(2000).fill(1)]);
const LOG = new TextEncoder().encode("E/AndroidRuntime: FATAL EXCEPTION: main\n");
function zip(name, text) {
  const raw0 = Buffer.from(text), comp = deflateRawSync(raw0), nm = Buffer.from(name), crc = crc32(raw0);
  const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw0.length, 22); lh.writeUInt16LE(nm.length, 26);
  const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(raw0.length, 24); ch.writeUInt16LE(nm.length, 28);
  const cd = Buffer.concat([ch, nm]); const eo = Buffer.alloc(22);
  eo.writeUInt32LE(0x06054b50, 0); eo.writeUInt16LE(1, 8); eo.writeUInt16LE(1, 10); eo.writeUInt32LE(cd.length, 12); eo.writeUInt32LE(30 + nm.length + comp.length, 16);
  return new Uint8Array(Buffer.concat([lh, nm, comp, cd, eo]));
}
const isErr = (r, status, code) => {
  assert.equal(r.status, status, JSON.stringify(r.data));
  assert.equal(typeof r.data.error.message, "string");
  assert.match(r.data.error.message, /[а-яё]/i, "message in Russian");
  if (code) assert.equal(r.data.error.code, code);
};

test("app api: meta is public and complete", async () => {
  const env = makeEnv();
  const r = await J(await raw(env, "/api/app/v1/meta"));
  assert.equal(r.status, 200);
  assert.equal(r.data.categories.length, 10);
  assert.ok(r.data.bug_statuses.some((s) => s.code === "verify"));
  assert.ok(r.data.idea_statuses.some((s) => s.code === "done"));
  assert.equal(r.data.limits.attachment_max_bytes, 5 * 1024 * 1024);
  assert.equal(r.data.limits.attachments_per_request, 5);
  assert.equal(r.data.limits.tickets_per_hour, 10);
  assert.equal(r.data.limits.comments_per_hour, 30);
  assert.equal(r.data.current_version, "3.0");
  isErr(await J(await raw(env, "/api/app/v1/nope")), 401, "unauthorized");
});

test("app api: linking via portal — pending, approve, single use, deny, expiry, revoke", async () => {
  const env = makeEnv();
  const W = await webUser(env, "linker");
  const start = await J(await raw(env, "/api/app/v1/link/start", { method: "POST", body: { device_name: "Pixel 9" } }));
  assert.match(start.data.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(start.data.expires_in, 600);
  assert.match(start.data.confirm_url, /\/link\?code=[A-Z2-9]{8}$/);
  assert.match(start.data.telegram_url, /^https:\/\/t\.me\/qvk_test_bot\?start=app_[A-Z2-9]{8}$/);
  const poll = () => raw(env, "/api/app/v1/link/poll", { method: "POST", body: { poll_token: start.data.poll_token } }).then(J);
  assert.equal((await poll()).data.status, "pending");
  isErr(await J(await raw(env, "/api/app/v1/link/poll", { method: "POST", body: { poll_token: "qlp_" + "0".repeat(48) } })), 404, "link_not_found");
  isErr(await J(await raw(env, "/api/app/v1/link/poll", { method: "POST", body: "{bad" })), 400, "bad_json");
  const code = start.data.code;
  const look = await W.get("/api/p/app-links/" + code.replace("-", ""));
  assert.equal(look.data.device_name, "Pixel 9");
  await W.send("POST", "/api/p/app-links/" + code + "/confirm"); // dash accepted
  const ok = await poll();
  assert.equal(ok.data.status, "approved");
  assert.match(ok.data.token, /^qat_[a-f0-9]{48}$/);
  assert.equal(ok.data.user.name, "linker");
  assert.equal((await poll()).data.status, "used", "token is issued once");
  // Only the hash is stored.
  const row = await env.DB.prepare("SELECT token_hash FROM portal_app_tokens").first();
  assert.ok(!row.token_hash.includes(ok.data.token.slice(4)));
  const A = client(env, ok.data.token);
  assert.equal((await A.get("/me")).data.user.name, "linker");
  // Listed and revocable in the profile.
  const toks = (await W.get("/api/p/app-tokens")).data.items;
  assert.equal(toks[0].name, "Pixel 9");
  await W.send("DELETE", "/api/p/app-tokens/" + toks[0].id);
  isErr(await A.get("/me"), 401, "token_revoked");
  // Deny.
  const s2 = await J(await raw(env, "/api/app/v1/link/start", { method: "POST", body: {} }));
  await W.send("POST", "/api/p/app-links/" + s2.data.code + "/deny");
  assert.equal((await J(await raw(env, "/api/app/v1/link/poll", { method: "POST", body: { poll_token: s2.data.poll_token } }))).data.status, "denied");
  const again = await W.send("POST", "/api/p/app-links/" + s2.data.code + "/confirm");
  assert.equal(again.status, 404, "denied code can't be confirmed later");
  assert.match(again.data.error, /устарел/);
  // Expiry.
  const s3 = await J(await raw(env, "/api/app/v1/link/start", { method: "POST", body: {} }));
  await env.DB.prepare("UPDATE portal_app_links SET expires=1 WHERE code=?").bind(s3.data.code.replace("-", "")).run();
  assert.equal((await J(await raw(env, "/api/app/v1/link/poll", { method: "POST", body: { poll_token: s3.data.poll_token } }))).data.status, "expired");
  // Logout from the app revokes its own token.
  const B = await appFor(env, W);
  assert.equal((await B.send("POST", "/logout")).status, 200);
  isErr(await B.get("/me"), 401, "token_revoked");
  isErr(await client(env, "garbage").get("/me"), 401, "unauthorized");
});

test("app api: linking via Telegram bot", async () => {
  const env = makeEnv();
  await webUser(env, "tguser", 555);
  const s = await J(await raw(env, "/api/app/v1/link/start", { method: "POST", body: { device_name: "Redmi Note 13" } }));
  const startParam = s.data.telegram_url.split("start=")[1];
  sent.length = 0;
  // Unlinked Telegram gets a hint.
  await hook(env, { message: { message_id: 1, chat: { id: 777, type: "private" }, from: { id: 777, first_name: "X" }, text: "/start " + startParam, date: 1 } });
  assert.match(sent.pop().body.text, /не привязан/);
  await hook(env, { message: { message_id: 1, chat: { id: 555, type: "private" }, from: { id: 555, first_name: "T" }, text: "/start " + startParam, date: 1 } });
  const prompt = sent.pop().body;
  assert.match(prompt.text, /Redmi Note 13/);
  assert.match(prompt.text, new RegExp(s.data.code));
  const cb = prompt.reply_markup.inline_keyboard[0][0].callback_data;
  // A different Telegram account can't approve.
  await hook(env, { callback_query: { id: "x", from: { id: 777 }, data: cb } });
  assert.equal((await J(await raw(env, "/api/app/v1/link/poll", { method: "POST", body: { poll_token: s.data.poll_token } }))).data.status, "pending");
  await hook(env, { callback_query: { id: "y", from: { id: 555 }, data: cb } });
  const r = await J(await raw(env, "/api/app/v1/link/poll", { method: "POST", body: { poll_token: s.data.poll_token } }));
  assert.equal(r.data.status, "approved");
  assert.equal(r.data.user.name, "tguser");
});

test("app api: attachments — types, sizes, count, download, privacy", async () => {
  const env = makeEnv();
  const W = await webUser(env, "files");
  const A = await appFor(env, W);
  const ok = await A.upload([["shot.png", PNG, "image/png"], ["logs.zip", zip("log.txt", "boom"), "application/zip"], ["app.log", LOG, "text/plain"]]);
  assert.equal(ok.status, 201);
  assert.deepEqual(ok.data.attachments.map((a) => a.mime), ["image/png", "application/zip", "text/plain"]);
  isErr(await A.upload(new Array(6).fill(["a.png", PNG, "image/png"])), 400, "too_many_files");
  isErr(await A.upload([["big.png", new Uint8Array(5 * 1024 * 1024 + 1).fill(1).map((x, i) => (i < 8 ? PNG[i] : 1)), "image/png"]]), 413, "file_too_large");
  isErr(await A.upload([["anim.gif", Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0]), "image/gif"]]), 415, "unsupported_file");
  isErr(await A.upload([["fake.png", Uint8Array.from([0x4d, 0x5a, 0, 0]), "image/png"]]), 415, "unsupported_file");
  isErr(await A.upload([]), 400, "validation");
  const before = (await env.DB.prepare("SELECT COUNT(*) n FROM portal_attachments").first()).n;
  isErr(await A.upload([["ok.png", PNG, "image/png"], ["bad.gif", Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0]), "image/gif"]]), 415, "unsupported_file");
  assert.equal((await env.DB.prepare("SELECT COUNT(*) n FROM portal_attachments").first()).n, before, "nothing stored when one file is bad");
  // Download through the API (Bearer), not the web cookie route.
  const t = await A.send("POST", "/tickets", { ...BUG, attachments: [ok.data.attachments[0].id] });
  const att = t.data.ticket.attachments[0];
  assert.equal(att.url, "/api/app/v1/attachments/" + att.id);
  const dl = await raw(env, att.url, { headers: { authorization: "Bearer " + A.token } });
  assert.equal(dl.status, 200);
  assert.equal(dl.headers.get("content-type"), "image/png");
  // Another user's unused upload can't be attached.
  const B = await appFor(env, await webUser(env, "other"));
  isErr(await B.send("POST", "/tickets", { ...BUG, attachments: [ok.data.attachments[1].id] }), 400, "attachment_not_found");
  isErr(await A.send("POST", "/tickets", { ...BUG, attachments: [ok.data.attachments[0].id] }), 409, "attachment_used");
});

test("app api: create, list, card, similar, comments, me-too, verify, notifications", async () => {
  const env = makeEnv();
  const admin = await webUser(env, "boss", ADMIN);
  const W = await webUser(env, "tester");
  const A = await appFor(env, W);
  const B = await appFor(env, await webUser(env, "second"));
  const up = await A.upload([["shot.png", PNG, "image/png"]]);

  // Create bug — source app, device from the app, admins notified in Telegram.
  sent.length = 0;
  const c = await A.send("POST", "/tickets", { ...BUG, attachments: [up.data.attachments[0].id] });
  assert.equal(c.status, 201);
  const t = c.data.ticket;
  assert.equal(t.code, "BUG-0001");
  assert.equal(t.source, "app");
  assert.deepEqual(t.device, DEVICE);
  assert.equal(t.status.code, "new");
  assert.equal(t.history[0].field, "created");
  assert.ok(sent.some((m) => m.body.chat_id === ADMIN && /BUG-0001 · 📱 из приложения/.test(m.body.text)), "admin TG notification");
  // Device remembered in the web profile; web view shows the same ticket with source.
  const me = (await W.get("/api/p/me")).data;
  assert.equal(me.devices[0].model, "Poco F9 Ultra");
  assert.equal((await W.get("/api/p/tickets/BUG-0001")).data.source, "app");
  // Validation errors.
  isErr(await A.send("POST", "/tickets", { ...BUG, title: "x" }), 400, "validation");
  isErr(await A.send("POST", "/tickets", { ...BUG, device: undefined }), 400, "validation");
  isErr(await A.send("POST", "/tickets", { ...BUG, kind: "nope" }), 400, "validation");
  isErr(await A.send("POST", "/tickets", { ...BUG, category: "space" }), 400, "validation");
  // Idea.
  const idea = await A.send("POST", "/tickets", { kind: "idea", category: "ui", title: "Компактный плеер", description: "Сделать плеер меньше по высоте.", how_it_works: "Переключатель в настройках", purpose: "Больше места", device: DEVICE });
  assert.equal(idea.data.ticket.code, "IDEA-0001");

  // Lists.
  const mine = await A.get("/tickets?kind=bug");
  assert.equal(mine.data.total, 1);
  assert.equal(mine.data.items[0].is_mine, true);
  assert.equal((await B.get("/tickets?kind=bug")).data.total, 0, "scope=mine by default");
  assert.equal((await B.get("/tickets?kind=bug&scope=all")).data.total, 1);
  assert.equal((await A.get("/tickets?kind=bug&updated_since=2999-01-01T00:00:00Z")).data.total, 0);
  assert.equal((await A.get("/tickets?kind=bug&updated_since=2000-01-01T00:00:00Z")).data.total, 1);
  isErr(await A.get("/tickets/BUG-9999"), 404, "not_found");

  // Similar.
  const sim = await B.send("POST", "/similar", { kind: "bug", title: "Плеер падает при смене трека свайпом", category: "music" });
  assert.equal(sim.data.items[0].code, "BUG-0001");
  assert.equal(sim.data.items[0].status.code, "new");
  isErr(await B.send("POST", "/similar", {}), 400, "validation");

  // Me too (bug) with comment and log; idea vote; own ticket refused; undo.
  const log = await B.upload([["logcat.txt", LOG, "text/plain"]]);
  const mt = await B.send("POST", "/tickets/BUG-0001/me-too", { comment: "Тоже падает на Pixel", attachments: [log.data.attachments[0].id] });
  assert.equal(mt.status, 200);
  assert.deepEqual([mt.data.me_too, mt.data.counts.confirms], [true, 1]);
  let card = (await A.get("/tickets/BUG-0001")).data.ticket;
  const cm = card.comments.find((x) => x.text === "Тоже падает на Pixel");
  assert.equal(cm.attachments[0].name, "logcat.txt");
  isErr(await A.send("POST", "/tickets/BUG-0001/me-too", {}), 409, "own_ticket");
  assert.equal((await B.send("POST", "/tickets/IDEA-0001/me-too", {})).data.counts.votes, 1);
  assert.equal((await B.send("DELETE", "/tickets/IDEA-0001/me-too")).data.counts.votes, 0);

  // Comments: own and another's ticket; author notified.
  assert.equal((await A.send("POST", "/tickets/BUG-0001/comments", { text: "Дополнение: только в альбомах", addendum: true })).status, 201);
  assert.equal((await B.send("POST", "/tickets/BUG-0001/comments", { text: "И у меня в альбомах" })).status, 201);
  isErr(await B.send("POST", "/tickets/BUG-0001/comments", { text: "" }), 400, "validation");
  assert.ok((await A.get("/notifications?unread=1")).data.items.some((n) => n.type === "comment" && n.ticket === "BUG-0001"));

  // Team reply and status from the web admin → visible in the app card.
  await admin.send("POST", "/api/p/tickets/BUG-0001/comments", { body: "Спасибо, исправляем" });
  await admin.send("POST", "/api/p/tickets/BUG-0001/admin", { status: "verify", fixed_version: "alpha23", note: "Проверьте в alpha23" });
  card = (await A.get("/tickets/BUG-0001")).data.ticket;
  assert.equal(card.status.code, "verify");
  assert.equal(card.team_note, "Проверьте в alpha23");
  assert.equal(card.can.verify, true);
  assert.ok(card.comments.some((x) => x.author.is_team && x.text === "Спасибо, исправляем"));
  const list = (await A.get("/tickets?kind=bug")).data.items[0];
  assert.equal(list.needs_action, "verify");
  assert.equal(list.last_team_comment, "Спасибо, исправляем");

  // Verify: non-author refused; not_fixed → back to confirmed; then fixed → closed.
  isErr(await B.send("POST", "/tickets/BUG-0001/verify", { result: "fixed" }), 403, "forbidden");
  isErr(await A.send("POST", "/tickets/BUG-0001/verify", { result: "maybe" }), 400, "validation");
  sent.length = 0;
  const nf = await A.send("POST", "/tickets/BUG-0001/verify", { result: "not_fixed", comment: "Всё ещё падает", attachments: [(await A.upload([["after.png", PNG, "image/png"]])).data.attachments[0].id] });
  assert.equal(nf.data.ticket.status.code, "confirmed");
  assert.ok(nf.data.ticket.comments.some((x) => x.attachments.some((a) => a.name === "after.png")));
  assert.ok(sent.some((m) => m.body.chat_id === ADMIN && /проблема осталась/.test(m.body.text)), "admins told");
  isErr(await A.send("POST", "/tickets/BUG-0001/verify", { result: "fixed" }), 409, "conflict");
  await admin.send("POST", "/api/p/tickets/BUG-0001/admin", { status: "verify" });
  assert.equal((await A.send("POST", "/tickets/BUG-0001/verify", { result: "fixed", comment: "Теперь ок" })).data.ticket.status.code, "closed");
  assert.ok((await A.get("/tickets/BUG-0001")).data.ticket.history.some((h) => h.field === "status" && h.to === "closed"));

  // Notifications read.
  assert.equal((await A.send("POST", "/notifications/read", {})).status, 200);
  assert.equal((await A.get("/notifications?unread=1")).data.items.length, 0);
  assert.equal((await A.get("/me")).data.counts.unread_notifications, 0);
  // An admin's app token is still a tester token.
  const AdminApp = await appFor(env, admin);
  isErr(await AdminApp.send("POST", "/tickets/BUG-0001/verify", { result: "fixed" }), 403);
});

test("app api: logs request reaches the app as a logs_request notification", async () => {
  const env = makeEnv();
  const admin = await webUser(env, "boss", ADMIN);
  const W = await webUser(env, "author", 444);
  const A = await appFor(env, W);
  const other = await webUser(env, "stranger");
  await A.send("POST", "/tickets", BUG);
  assert.equal((await W.get("/api/p/me")).data.user.app_connected, true);

  // 1) Team button in the admin panel (web endpoint).
  sent.length = 0;
  const r = await admin.send("POST", "/api/p/tickets/BUG-0001/request-logs", { text: "Пришлите журнал после повторения бага" });
  assert.equal(r.status, 200);
  assert.deepEqual([r.data.app_connected, r.data.already_pending], [true, false]);
  let n = (await A.get("/notifications?unread=1")).data.items.find((x) => x.type === "logs_request");
  assert.deepEqual([n.type, n.ticket, n.text], ["logs_request", "BUG-0001", "Пришлите журнал после повторения бага"]);
  assert.ok(sent.some((m) => m.body.chat_id === "444" && /журнал/.test(m.body.text)), "author also told in Telegram");
  assert.ok((await A.get("/tickets/BUG-0001")).data.ticket.history.some((h) => h.field === "logs_request" && h.to === "team"));
  // Repeated request while unread → no duplicate.
  assert.equal((await admin.send("POST", "/api/p/tickets/BUG-0001/request-logs", {})).data.already_pending, true);
  assert.equal((await A.get("/notifications?unread=1")).data.items.filter((x) => x.type === "logs_request").length, 1);
  // Only the team can request (author/stranger via the web endpoint → 403).
  assert.equal((await other.send("POST", "/api/p/tickets/BUG-0001/request-logs", {})).status, 403);
  assert.equal((await W.send("POST", "/api/p/tickets/BUG-0001/request-logs", {})).status, 403);
  // The app answers with a comment + log; marks the notification read.
  const log = await A.upload([["qvk-log.txt", LOG, "text/plain"]]);
  await A.send("POST", "/tickets/BUG-0001/comments", { text: "Журнал приложения по запросу команды", attachments: [log.data.attachments[0].id] });
  await A.send("POST", "/notifications/read", { ids: [n.id] });
  assert.equal((await A.get("/notifications?unread=1")).data.items.filter((x) => x.type === "logs_request").length, 0);

  // 2) Author's checkbox in the web form.
  await W.send("POST", "/api/p/devices", { model: "Poco", android: "16", app_version: "alpha32" });
  const dev = (await W.get("/api/p/me")).data.devices[0].id;
  const c = await W.send("POST", "/api/p/tickets", { ...BUG, device: undefined, device_id: dev, request_logs: true });
  n = (await A.get("/notifications?unread=1")).data.items.find((x) => x.type === "logs_request" && x.ticket === c.data.code);
  assert.match(n.text, new RegExp("журнал.*" + c.data.code));
  // Without the checkbox — nothing.
  const c2 = await W.send("POST", "/api/p/tickets", { ...BUG, title: "Ещё одна ошибка плеера", device: undefined, device_id: dev });
  assert.ok(!(await A.get("/notifications?unread=1")).data.items.some((x) => x.ticket === c2.data.code));
});

test("app api: rate limits — 10 tickets and 30 comments per hour with Retry-After", async () => {
  const env = makeEnv();
  const A = await appFor(env, await webUser(env, "spammer"));
  for (let i = 0; i < 10; i++) assert.equal((await A.send("POST", "/tickets", { ...BUG, title: "Ошибка номер " + i })).status, 201);
  const r = await A.send("POST", "/tickets", { ...BUG, title: "Одиннадцатая ошибка" });
  isErr(r, 429, "rate_limited");
  const ra = Number(r.headers.get("retry-after"));
  assert.ok(ra > 0 && ra <= 3600);
  assert.equal(r.data.error.retry_after, ra);
  for (let i = 0; i < 30; i++) assert.equal((await A.send("POST", "/tickets/BUG-0001/comments", { text: "Комментарий " + i })).status, 201, "comment " + i);
  isErr(await A.send("POST", "/tickets/BUG-0001/comments", { text: "Ещё один" }), 429, "rate_limited");
});
