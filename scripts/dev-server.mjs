// Local preview of the portal with an in-memory SQLite D1 and a fake Telegram API.
// node scripts/dev-server.mjs  → http://localhost:8787  (/__dev/login?uid=900 logs in as admin)
import http from "node:http";
import { readFileSync } from "node:fs";
import { createD1 } from "../test/helpers/d1.js";
import worker from "../src/index.js";

const PORT = Number(process.env.PORT || 8787);
const ORIGIN = `http://localhost:${PORT}`;
const env = { DB: createD1(readFileSync(new URL("../schema.sql", import.meta.url), "utf8")), BOT_TOKEN: "1:DEV", WEBHOOK_SECRET: "dev", ADMIN_IDS: "900", BOT_USERNAME: "qvk_dev_bot" };
const tgLog = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith("https://api.telegram.org/")) {
    const method = String(url).split("/").pop();
    tgLog.push({ method, body: init?.body ? JSON.parse(init.body) : {} });
    return Response.json({ ok: true, result: method === "sendMessage" ? { message_id: 1 } : true });
  }
  return realFetch(url, init);
};
let upd = 1;
const call = async (path, opt = {}) => {
  const waits = [];
  const res = await worker.fetch(new Request(ORIGIN + path, { ...opt, headers: { origin: ORIGIN, "x-qvk": "1", ...(opt.headers || {}) } }), env, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  return res;
};
async function devLogin(uid, name) {
  const s = await call("/api/p/auth/start", { method: "POST" });
  const nonce = s.headers.getSetCookie().find((c) => c.startsWith("__Host-qvk_l")).split(";")[0];
  const token = (await s.json()).link.split("start=")[1];
  const from = { id: Number(uid), first_name: name, username: "user" + uid };
  const hook = (u) => call("/webhook", { method: "POST", body: JSON.stringify({ update_id: ++upd, ...u }), headers: { "X-Telegram-Bot-Api-Secret-Token": "dev", "content-type": "application/json" } });
  await hook({ message: { message_id: 1, chat: { id: Number(uid), type: "private" }, from, text: "/start " + token, date: 1 } });
  const cb = tgLog.filter((x) => x.body.chat_id === Number(uid)).pop().body.reply_markup.inline_keyboard[0][0].callback_data;
  await hook({ callback_query: { id: "c", from, data: cb } });
  const p = await call("/api/p/auth/poll", { headers: { cookie: nonce } });
  return p.headers.getSetCookie().find((c) => c.startsWith("__Host-qvk_s")).split(";")[0];
}
async function seed() {
  const users = { 101: "Алиса", 102: "Максим", 103: "Ольга", 900: "Команда QVK" };
  const sess = {};
  for (const [id, n] of Object.entries(users)) {
    const cookie = await devLogin(id, n);
    const me = await (await call("/api/p/me", { headers: { cookie } })).json();
    sess[id] = { cookie, csrf: me.csrf };
  }
  const send = async (uid, method, path, body) => (await call(path, { method, body: JSON.stringify(body), headers: { cookie: sess[uid].cookie, "x-csrf": sess[uid].csrf, "content-type": "application/json" } })).json();
  const devs = { 101: ["Google Pixel 8", "15", "3.0", "Stock"], 102: ["Xiaomi Redmi Note 12", "13", "3.0", "HyperOS 1.0.5"], 103: ["Samsung Galaxy S23", "14", "3.0", "One UI 6.1"] };
  const did = {};
  for (const [u, [model, android, app_version, firmware]] of Object.entries(devs)) did[u] = (await send(u, "POST", "/api/p/devices", { model, android, app_version, firmware })).id;
  const bugs = [
    [101, "music", "Плеер останавливается при блокировке экрана", "Музыка перестаёт играть примерно через 5 секунд после блокировки экрана.", "1. Открыть «Музыку»\n2. Включить любой трек\n3. Заблокировать экран", "Музыка продолжает играть", "Воспроизведение останавливается", "always"],
    [102, "messages", "Не отправляются голосовые сообщения в беседах", "При записи голосового в беседе на 20+ участников сообщение висит с часами.", "1. Открыть беседу\n2. Записать голосовое\n3. Отпустить кнопку", "Сообщение отправлено", "Бесконечная загрузка", "often"],
    [103, "ui", "Наезжает текст в нижней панели на маленьких экранах", "На экране 5.5\" подписи вкладок налезают друг на друга.", "1. Включить крупный шрифт\n2. Открыть главный экран", "Подписи помещаются", "Текст перекрывается", "always"],
    [101, "notifications", "Дублируются push-уведомления о лайках", "Иногда одно уведомление приходит два-три раза подряд.", "1. Получить лайк\n2. Смотреть шторку", "Одно уведомление", "Два-три одинаковых", "sometimes"],
    [102, "performance", "Лента подтормаживает при быстрой прокрутке", "На длинной ленте FPS падает, особенно с видео.", "1. Открыть ленту\n2. Быстро прокрутить вниз", "Плавная прокрутка", "Рывки и фризы", "often"],
  ];
  for (const [u, category, title, description, steps, expected, actual, frequency] of bugs) await send(u, "POST", "/api/p/tickets", { kind: "bug", category, title, description, steps, expected, actual, frequency, device_id: did[u] });
  const ideas = [
    [103, "music", "Эквалайзер с пресетами", "Добавить эквалайзер с готовыми пресетами для разных жанров.", "Настройки → Звук → Эквалайзер, 5 полос и пресеты.", "Чтобы музыка звучала лучше на разных наушниках."],
    [101, "ui", "Компактный режим ленты", "Режим, в котором посты занимают меньше места.", "Переключатель в настройках ленты.", "Больше контента на экране."],
    [102, "messages", "Отложенная отправка сообщений", "Возможность запланировать сообщение на время.", "Долгое нажатие на кнопку отправки → выбрать время.", "Удобно для разных часовых поясов."],
  ];
  for (const [u, category, title, description, how_it_works, purpose] of ideas) await send(u, "POST", "/api/p/tickets", { kind: "idea", category, title, description, how_it_works, purpose });
  for (const u of [101, 102]) await send(u, "POST", "/api/p/tickets/IDEA-0001/vote", {});
  await send(102, "POST", "/api/p/tickets/IDEA-0002/vote", {});
  await send(103, "POST", "/api/p/tickets/BUG-0001/confirm", {});
  await send(102, "POST", "/api/p/tickets/BUG-0001/confirm", {});
  await send(900, "POST", "/api/p/tickets/BUG-0001/admin", { status: "in_progress", priority: "high" });
  await send(900, "POST", "/api/p/tickets/BUG-0001/comments", { body: "Воспроизвели на Pixel и Samsung, исправляем. Спасибо за подробный отчёт!" });
  await send(900, "POST", "/api/p/tickets/BUG-0001/admin", { status: "verify", fixed_version: "3.0.1", note: "Исправлено в сборке 3.0.1 — проверьте, пожалуйста." });
  await send(900, "POST", "/api/p/tickets/BUG-0003/admin", { status: "fixed", fixed_version: "3.0.1" });
  await send(900, "POST", "/api/p/tickets/BUG-0002/admin", { status: "need_info", note: "Пришлите, пожалуйста, видео записи экрана." });
  await send(900, "POST", "/api/p/tickets/BUG-0005/admin", { status: "confirmed", priority: "critical", pinned: true });
  await send(900, "POST", "/api/p/tickets/IDEA-0001/admin", { status: "planned", note: "Добавим в 3.1" });
  await send(900, "POST", "/api/p/admin/posts", { kind: "changelog", title: "Бета 3.0.1 доступна", body: "• Исправлен плеер при блокировке экрана\n• Улучшена стабильность ленты\n• Новые иконки в нижней панели", version: "3.0.1", pinned: true });
  await send(900, "POST", "/api/p/admin/posts", { kind: "announce", title: "Добро пожаловать в закрытую бету 3.0", body: "Спасибо, что участвуете! Пишите обо всём, что заметите." });
}
await seed();
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, ORIGIN);
    if (url.pathname === "/__dev/login") {
      const cookie = await devLogin(url.searchParams.get("uid") || "101", url.searchParams.get("name") || "Тестер");
      res.writeHead(302, { location: "/", "set-cookie": cookie + "; Path=/; Secure; HttpOnly; SameSite=Lax" });
      return res.end();
    }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
    const waits = [];
    const r = await worker.fetch(new Request(ORIGIN + req.url, { method: req.method, headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body, duplex: "half" }), env, { waitUntil: (p) => waits.push(p) });
    const out = {};
    r.headers.forEach((v, k) => { if (k !== "set-cookie") out[k] = v; });
    const sc = r.headers.getSetCookie();
    if (sc.length) out["set-cookie"] = sc;
    res.writeHead(r.status, out);
    res.end(Buffer.from(await r.arrayBuffer()));
    await Promise.all(waits);
  } catch (err) {
    console.error(err);
    res.writeHead(500); res.end("dev error");
  }
}).listen(PORT, () => console.log("QVK Beta Portal dev server on " + ORIGIN));
