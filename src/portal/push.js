// QVK Beta Portal — Web Push (RFC 8030/8291/8292) on plain WebCrypto, no dependencies.
// VAPID keys are generated once and kept in portal_settings (server-only storage).

import { getSetting } from "./util.js";

const enc = new TextEncoder();
export const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const unb64u = (s) => {
  s = String(s).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(s + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
};
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

/** Returns {publicKey (base64url raw, 65 bytes), privateJwk}. Generated on first call. */
export async function vapidKeys(e) {
  const stored = await getSetting(e, "vapid_keys", "");
  if (stored) return JSON.parse(stored);
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const keys = {
    publicKey: b64u(await crypto.subtle.exportKey("raw", kp.publicKey)),
    privateJwk: await crypto.subtle.exportKey("jwk", kp.privateKey),
  };
  await e.DB.prepare("INSERT OR IGNORE INTO portal_settings(key,value) VALUES('vapid_keys',?)").bind(JSON.stringify(keys)).run();
  return JSON.parse(await getSetting(e, "vapid_keys", JSON.stringify(keys)));
}

async function vapidAuth(keys, endpoint, subject) {
  const aud = new URL(endpoint).origin;
  const header = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey("jwk", keys.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(header + "." + claims));
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${keys.publicKey}`;
}

async function hkdf(salt, ikm, info, bytes) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}

/** aes128gcm content encoding (RFC 8188 + RFC 8291), single record. */
export async function encryptPayload(p256dh, auth, plaintext) {
  const uaPublic = unb64u(p256dh);
  const authSecret = unb64u(auth);
  const local = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", local.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, local.privateKey, 256));
  const ikm = await hkdf(authSecret, ecdh, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const data = concat(enc.encode(plaintext), new Uint8Array([2])); // last-record delimiter
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, data));
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  return concat(header, asPublic, cipher);
}

/**
 * Sends one push message. Returns "ok", "gone" (subscription expired — delete it) or throws.
 */
export async function sendPush(e, sub, message, subject) {
  const endpoint = String(sub.endpoint);
  if (!/^https:\/\//.test(endpoint)) return "gone";
  const keys = await vapidKeys(e);
  const body = await encryptPayload(sub.p256dh, sub.auth, JSON.stringify(message));
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: await vapidAuth(keys, endpoint, subject),
      "content-encoding": "aes128gcm",
      "content-type": "application/octet-stream",
      ttl: "86400",
      urgency: "normal",
    },
    body,
  });
  if (res.status === 404 || res.status === 410) return "gone";
  if (!res.ok) throw Error("Push " + res.status + " " + (await res.text().catch(() => "")).slice(0, 200));
  return "ok";
}

export async function pushSubject(e) {
  const origin = await getSetting(e, "portal_origin", "");
  return origin || "mailto:noreply@qvk.invalid";
}
