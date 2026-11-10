// QVK Beta Portal — private attachments.
// Stored in R2 when an R2 binding named FILES exists, otherwise in D1 as 1 MB chunks.
// Files are only served to signed-in users that may see the parent ticket.

import { LIMITS } from "./constants.js";
import { now, randomId, fail, json, rateLimit, clean } from "./util.js";

const CHUNK = 1024 * 1024;

const TYPES = {
  "image/jpeg": { group: "image", ext: "jpg" },
  "image/png": { group: "image", ext: "png" },
  "image/webp": { group: "image", ext: "webp" },
  "image/gif": { group: "image", ext: "gif" },
  "video/mp4": { group: "video", ext: "mp4" },
  "video/quicktime": { group: "video", ext: "mov" },
  "video/webm": { group: "video", ext: "webm" },
  "text/plain": { group: "file", ext: "txt" },
  "application/zip": { group: "file", ext: "zip" },
  "application/pdf": { group: "file", ext: "pdf" },
};

export const ALLOWED_MIME = Object.keys(TYPES);

/** Detects the real file type from magic bytes. Returns a mime from TYPES or null. */
export function sniff(bytes, declared, name) {
  const b = bytes;
  const at = (i, ...v) => v.every((x, j) => b[i + j] === x);
  if (b.length >= 3 && at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (b.length >= 8 && at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (b.length >= 6 && at(0, 0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (b.length >= 12 && at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  if (b.length >= 12 && at(4, 0x66, 0x74, 0x79, 0x70)) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
    if (brand === "qt  ") return "video/quicktime";
    if (/^(heic|heix|mif1|msf1|avif)/.test(brand)) return null; // not viewable in most browsers
    return "video/mp4";
  }
  if (b.length >= 4 && at(0, 0x1a, 0x45, 0xdf, 0xa3)) return "video/webm";
  if (b.length >= 4 && at(0, 0x50, 0x4b, 0x03, 0x04)) return "application/zip";
  if (b.length >= 5 && at(0, 0x25, 0x50, 0x44, 0x46, 0x2d)) return "application/pdf";
  // Plain text logs: no NUL bytes in the first 8 KB and a text-like name/type.
  const head = b.subarray(0, 8192);
  if (!head.includes(0) && (declared === "text/plain" || /\.(txt|log)$/i.test(name || ""))) return "text/plain";
  return null;
}

export function maxBytesFor(mime) {
  const g = TYPES[mime]?.group;
  return g === "image" ? LIMITS.imageBytes : g === "video" ? LIMITS.videoBytes : LIMITS.otherBytes;
}

export async function upload(req, e, ses) {
  await rateLimit(e, "upload:" + ses.user.id, 60, 3600);
  const ct = req.headers.get("content-type") || "";
  if (!ct.startsWith("multipart/form-data")) fail(400, "Ожидается multipart/form-data");
  const len = Number(req.headers.get("content-length") || 0);
  if (len > LIMITS.videoBytes + 64 * 1024) fail(413, "Файл слишком большой");
  let form;
  try {
    form = await req.formData();
  } catch {
    fail(400, "Не удалось прочитать файл");
  }
  const file = form.get("file");
  if (!file || typeof file === "string") fail(400, "Файл не передан");
  const name = clean(file.name || "file", 120, { multiline: false }).replace(/[\\/:*?"<>|]/g, "_") || "file";
  if (file.size <= 0) fail(400, "Пустой файл");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniff(bytes, file.type, name);
  if (!mime) fail(415, "Этот тип файла не поддерживается. Разрешены JPG, PNG, WEBP, GIF, MP4, MOV, WEBM, TXT/LOG, ZIP, PDF.");
  const max = maxBytesFor(mime);
  if (bytes.length > max) fail(413, `Файл больше ${Math.round(max / 1024 / 1024)} МБ`);
  // Orphan clean-up: attachments never linked to a ticket within a day.
  const stale = await e.DB.prepare("SELECT id,storage FROM portal_attachments WHERE ticket_id IS NULL AND created<? LIMIT 20").bind(now() - 86400).all();
  for (const s of stale.results || []) await removeAttachment(e, s);

  const id = randomId(20);
  let storage = "d1";
  let chunks = 0;
  if (e.FILES) {
    await e.FILES.put("att/" + id, bytes, { httpMetadata: { contentType: mime } });
    storage = "r2";
  } else {
    const stmts = [];
    for (let i = 0; i * CHUNK < bytes.length; i++) {
      stmts.push(e.DB.prepare("INSERT INTO portal_chunks(att_id,idx,data) VALUES(?,?,?)").bind(id, i, bytes.slice(i * CHUNK, (i + 1) * CHUNK)));
    }
    chunks = stmts.length;
    for (const st of stmts) await st.run();
  }
  await e.DB.prepare("INSERT INTO portal_attachments(id,user_id,name,mime,size,storage,chunks,created) VALUES(?,?,?,?,?,?,?,?)")
    .bind(id, ses.user.id, name, mime, bytes.length, storage, chunks, now()).run();
  return json({ ok: true, attachment: { id, name, mime, size: bytes.length, url: "/files/" + id } });
}

export async function removeAttachment(e, att) {
  if (att.storage === "r2" && e.FILES) await e.FILES.delete("att/" + att.id).catch(() => {});
  await e.DB.batch([
    e.DB.prepare("DELETE FROM portal_chunks WHERE att_id=?").bind(att.id),
    e.DB.prepare("DELETE FROM portal_attachments WHERE id=?").bind(att.id),
  ]);
}

/** Links uploaded (not yet linked) attachments owned by the user to a ticket/comment. */
export async function linkAttachments(e, userId, ids, ticketId, commentId = null) {
  const list = Array.isArray(ids) ? ids.filter((x) => typeof x === "string" && /^[a-z0-9]{20}$/.test(x)).slice(0, LIMITS.attachmentsPerTicket) : [];
  for (const id of list) {
    await e.DB.prepare("UPDATE portal_attachments SET ticket_id=?,comment_id=? WHERE id=? AND user_id=? AND ticket_id IS NULL").bind(ticketId, commentId, id, String(userId)).run();
  }
  return list.length;
}

function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header || "");
  if (!m) return null;
  let start = m[1] === "" ? null : Number(m[1]);
  let end = m[2] === "" ? null : Number(m[2]);
  if (start === null && end === null) return null;
  if (start === null) {
    start = Math.max(0, size - end);
    end = size - 1;
  } else if (end === null || end >= size) end = size - 1;
  if (start > end || start >= size) return "invalid";
  return { start, end };
}

export async function serveFile(req, e, ses, id, canSeeTicket) {
  if (!/^[a-z0-9]{20}$/.test(id)) fail(404, "Файл не найден");
  const att = await e.DB.prepare("SELECT * FROM portal_attachments WHERE id=?").bind(id).first();
  if (!att) fail(404, "Файл не найден");
  const own = att.user_id === ses.user.id;
  if (!ses.isAdmin && !own) {
    if (!att.ticket_id || !(await canSeeTicket(att.ticket_id))) fail(404, "Файл не найден");
  }
  const size = att.size;
  const range = parseRange(req.headers.get("range"), size);
  if (range === "invalid") return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
  const start = range ? range.start : 0;
  const end = range ? range.end : size - 1;
  const inline = /^(image|video)\//.test(att.mime) || att.mime === "application/pdf";
  const headers = {
    "content-type": att.mime === "text/plain" ? "text/plain; charset=utf-8" : att.mime,
    "content-length": String(end - start + 1),
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=86400",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
    "content-disposition": (inline ? "inline" : "attachment") + "; filename*=UTF-8''" + encodeURIComponent(att.name),
  };
  if (range) headers["content-range"] = `bytes ${start}-${end}/${size}`;
  if (req.method === "HEAD") return new Response(null, { status: range ? 206 : 200, headers });

  if (att.storage === "r2") {
    if (!e.FILES) fail(503, "Хранилище файлов недоступно");
    const obj = await e.FILES.get("att/" + id, range ? { range: { offset: start, length: end - start + 1 } } : undefined);
    if (!obj) fail(404, "Файл не найден");
    return new Response(obj.body, { status: range ? 206 : 200, headers });
  }
  const first = Math.floor(start / CHUNK);
  const last = Math.floor(end / CHUNK);
  const rows = await e.DB.prepare("SELECT idx,data FROM portal_chunks WHERE att_id=? AND idx BETWEEN ? AND ? ORDER BY idx").bind(id, first, last).all();
  const out = new Uint8Array(end - start + 1);
  let pos = 0;
  for (const r of rows.results || []) {
    const data = r.data instanceof Uint8Array ? r.data : new Uint8Array(r.data);
    const base = r.idx * CHUNK;
    const from = Math.max(start, base) - base;
    const to = Math.min(end + 1, base + data.length) - base;
    if (to > from) {
      out.set(data.subarray(from, to), pos);
      pos += to - from;
    }
  }
  return new Response(out, { status: range ? 206 : 200, headers });
}
