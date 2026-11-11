// QVK Beta Portal — notification centre + optional Telegram DMs via the existing bot.
import { tg, escapeTgHtml } from "./telegram.js";
import { now, getSetting, admins } from "./util.js";
import { queuePushForUser, drainOutbox } from "./broadcast.js";


/**
 * Creates an in-app notification and (if the user enabled it) a Telegram DM.
 * Never notifies the actor about their own action.
 */
export async function notify(e, ctx, { userId, actorId, ticket, type, text }) {
  if (!userId || String(userId) === String(actorId ?? "")) return;
  await e.DB.prepare("INSERT INTO portal_notifications(user_id,ticket_id,type,text,created) VALUES(?,?,?,?,?)")
    .bind(String(userId), ticket?.id ?? null, type, text.slice(0, 400), now()).run();
  await queuePushForUser(e, userId, {
    title: ticket?.code ? "QVK Beta · " + ticket.code : "QVK Beta Portal",
    body: text.slice(0, 200),
    url: ticket?.code ? "/" + (ticket.kind === "bug" ? "bugs" : "ideas") + "/" + ticket.code : "/notifications",
    tag: ticket?.code || "portal",
  });
  const job = Promise.all([
    sendDm(e, userId, ticket, text).catch((err) => console.warn("Portal DM failed", String(err))),
    drainOutbox(e).catch((err) => console.warn("Push drain failed", String(err))),
  ]);
  if (ctx?.waitUntil) ctx.waitUntil(job);
  else await job;
}

async function sendDm(e, userId, ticket, text) {
  const u = await e.DB.prepare("SELECT notify_tg,tg_blocked,deleted,tg_id FROM portal_users WHERE id=?").bind(String(userId)).first();
  if (!u || !u.tg_id || !u.notify_tg || u.tg_blocked || u.deleted) return;
  const origin = await getSetting(e, "portal_origin", "");
  const link = ticket && origin ? origin + "/" + (ticket.kind === "bug" ? "bugs" : "ideas") + "/" + ticket.code : origin;
  try {
    await tg(e, "sendMessage", {
      chat_id: String(u.tg_id),
      parse_mode: "HTML",
      text: "💜 <b>QVK Beta Portal</b>\n" + escapeTgHtml(text),
      link_preview_options: { is_disabled: true },
      ...(link ? { reply_markup: { inline_keyboard: [[{ text: ticket ? "Открыть " + ticket.code : "Открыть портал", url: link }]] } } : {}),
    });
  } catch (err) {
    // 403: the user blocked the bot or never started it — stop trying.
    if (err.code === 403 || err.code === 400) await e.DB.prepare("UPDATE portal_users SET tg_blocked=1 WHERE id=?").bind(String(userId)).run();
    throw err;
  }
}

/** Telegram heads-up for admins about new reports / author replies (setting notify_admins). */
export async function notifyAdmins(e, ctx, actorId, ticket, text) {
  if ((await getSetting(e, "notify_admins", "on")) !== "on") return;
  const origin = await getSetting(e, "portal_origin", "");
  const jobs = [];
  const actor = actorId ? await e.DB.prepare("SELECT tg_id FROM portal_users WHERE id=?").bind(String(actorId)).first() : null;
  for (const id of admins(e)) {
    if (actor?.tg_id && id === String(actor.tg_id)) continue;
    jobs.push(
      tg(e, "sendMessage", {
        chat_id: id,
        parse_mode: "HTML",
        text: "🛠 <b>QVK Beta Portal · админ</b>\n" + escapeTgHtml(text),
        link_preview_options: { is_disabled: true },
        ...(origin && ticket ? { reply_markup: { inline_keyboard: [[{ text: "Открыть " + ticket.code, url: origin + "/" + (ticket.kind === "bug" ? "bugs" : "ideas") + "/" + ticket.code }]] } } : {}),
      }).catch((err) => console.warn("Admin DM failed", String(err))),
    );
  }
  const job = Promise.all(jobs);
  if (ctx?.waitUntil) ctx.waitUntil(job);
  else await job;
}
