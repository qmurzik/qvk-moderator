// QVK Beta Portal — Telegram helpers (uses the existing bot token; no second bot).
import { getSetting, setSetting } from "./util.js";

export async function tg(e, method, data) {
  if (!e.BOT_TOKEN) throw Error("BOT_TOKEN не настроен");
  const r = await fetch("https://api.telegram.org/bot" + e.BOT_TOKEN + "/" + method, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) {
    const err = Error("Telegram " + method + ": " + (j.description || r.status));
    err.code = j.error_code || r.status;
    throw err;
  }
  return j.result;
}

export async function botUsername(e) {
  if (e.BOT_USERNAME) return String(e.BOT_USERNAME).replace(/^@/, "");
  const cached = await getSetting(e, "bot_username", "");
  if (cached) return cached;
  try {
    const me = await tg(e, "getMe", {});
    if (me?.username) {
      await setSetting(e, "bot_username", me.username);
      return me.username;
    }
  } catch (err) {
    console.error("getMe failed", String(err));
  }
  return "";
}

export const escapeTgHtml = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
