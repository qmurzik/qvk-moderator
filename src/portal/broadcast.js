// QVK Beta Portal — news broadcast and delivery queue.
//
// Publishing a post creates an in-app notification for every tester and queues
// one Telegram message per linked account and one Web Push per subscribed browser
// (portal_outbox). The queue is drained in small batches — right after publishing,
// on a cron tick and opportunistically on regular requests — so large audiences
// stay within the Worker's per-request subrequest limit.

import { tg, escapeTgHtml } from "./telegram.js";
import { sendPush, pushSubject } from "./push.js";
import { now, getSetting } from "./util.js";

const BATCH = 35;
const MAX_ATTEMPTS = 4;

export async function broadcastPost(e, ctx, post) {
  const t = now();
  const title = (post.kind === "changelog" ? "📦 " : "📣 ") + post.title + (post.version ? " · v" + post.version : "");
  const preview = String(post.body || "").replace(/\s+/g, " ").trim();
  // In-app notification centre — everyone active.
  await e.DB.prepare(
    `INSERT INTO portal_notifications(user_id,ticket_id,type,text,created)
     SELECT id,NULL,'news',?,? FROM portal_users WHERE deleted=0 AND banned=0 AND id<>'claude'`,
  ).bind((title + (preview ? "\n" + preview : "")).slice(0, 400), t).run();
  const tgPayload = JSON.stringify({ kind: "news", title: post.title, version: post.version || null, body: String(post.body || "").slice(0, 3300), changelog: post.kind === "changelog" });
  const pushPayload = JSON.stringify({ title: "QVK Beta · " + title, body: preview.slice(0, 180) || "Новая запись на странице обновлений", url: "/updates", tag: "news-" + post.id });
  const tgRes = await e.DB.prepare(
    `INSERT INTO portal_outbox(channel,target,payload,created)
     SELECT 'tg',tg_id,?,? FROM portal_users WHERE tg_id IS NOT NULL AND notify_tg=1 AND notify_news=1 AND tg_blocked=0 AND deleted=0 AND banned=0`,
  ).bind(tgPayload, t).run();
  const pushRes = await e.DB.prepare(
    `INSERT INTO portal_outbox(channel,target,payload,created)
     SELECT 'push',CAST(p.id AS TEXT),?,? FROM portal_push p JOIN portal_users u ON u.id=p.user_id WHERE u.notify_news=1 AND u.deleted=0 AND u.banned=0`,
  ).bind(pushPayload, t).run();
  const recipients = (tgRes.meta?.changes || 0) + (pushRes.meta?.changes || 0);
  await e.DB.prepare("UPDATE portal_posts SET recipients=? WHERE id=?").bind(recipients, post.id).run();
  const job = drainOutbox(e).catch((err) => console.warn("Outbox drain failed", String(err)));
  if (ctx?.waitUntil) ctx.waitUntil(job);
  else await job;
  return { telegram: tgRes.meta?.changes || 0, push: pushRes.meta?.changes || 0 };
}

/** Queues one push per browser of a user (personal notifications). */
export async function queuePushForUser(e, userId, message) {
  await e.DB.prepare(
    "INSERT INTO portal_outbox(channel,target,payload,created) SELECT 'push',CAST(id AS TEXT),?,? FROM portal_push WHERE user_id=?",
  ).bind(JSON.stringify(message), now(), String(userId)).run();
}

export async function outboxPending(e) {
  const r = await e.DB.prepare("SELECT COUNT(*) n FROM portal_outbox WHERE claimed<?").bind(now() - 120).first();
  return r?.n || 0;
}

/** Sends up to BATCH queued messages. Safe to call concurrently (rows are claimed atomically). */
export async function drainOutbox(e, rounds = 1) {
  let sent = 0;
  for (let r = 0; r < rounds; r++) {
    const t = now();
    const rows = (await e.DB.prepare(
      `UPDATE portal_outbox SET claimed=?,attempts=attempts+1
       WHERE id IN (SELECT id FROM portal_outbox WHERE claimed<? ORDER BY id LIMIT ?) RETURNING id,channel,target,payload,attempts`,
    ).bind(t, t - 120, BATCH).run()).results || [];
    if (!rows.length) break;
    const origin = await getSetting(e, "portal_origin", "");
    const subject = await pushSubject(e);
    for (const row of rows) {
      let done = false;
      try {
        const p = JSON.parse(row.payload);
        if (row.channel === "tg") done = await deliverTelegram(e, row.target, p, origin);
        else if (row.channel === "push") done = await deliverPush(e, row.target, p, subject);
        else done = true;
      } catch (err) {
        console.warn("Outbox delivery failed", row.channel, String(err));
        done = row.attempts >= MAX_ATTEMPTS;
      }
      if (done) {
        await e.DB.prepare("DELETE FROM portal_outbox WHERE id=?").bind(row.id).run();
        sent++;
      } else {
        // Retry later.
        await e.DB.prepare("UPDATE portal_outbox SET claimed=? WHERE id=?").bind(t - 60, row.id).run();
      }
    }
  }
  return sent;
}

async function deliverTelegram(e, tgId, p, origin) {
  const text =
    (p.changelog ? "📦 <b>Список изменений" : "📣 <b>Новости QVK Beta") + "</b>\n\n<b>" + escapeTgHtml(p.title) + "</b>" + (p.version ? " · <code>" + escapeTgHtml(p.version) + "</code>" : "") +
    (p.body ? "\n\n" + escapeTgHtml(p.body) : "");
  try {
    await tg(e, "sendMessage", {
      chat_id: tgId,
      parse_mode: "HTML",
      text: text.slice(0, 4000),
      link_preview_options: { is_disabled: true },
      ...(origin ? { reply_markup: { inline_keyboard: [[{ text: "Открыть на портале", url: origin + "/updates" }]] } } : {}),
    });
    return true;
  } catch (err) {
    if (err.code === 403 || err.code === 400) {
      await e.DB.prepare("UPDATE portal_users SET tg_blocked=1 WHERE tg_id=?").bind(String(tgId)).run();
      return true; // permanent failure — drop
    }
    if (err.code === 429) return false;
    throw err;
  }
}

async function deliverPush(e, subId, message, subject) {
  const sub = await e.DB.prepare("SELECT * FROM portal_push WHERE id=?").bind(Number(subId)).first();
  if (!sub) return true;
  const r = await sendPush(e, sub, message, subject);
  if (r === "gone") await e.DB.prepare("DELETE FROM portal_push WHERE id=?").bind(sub.id).run();
  return true;
}
