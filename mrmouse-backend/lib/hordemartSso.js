// lib/hordemartSso.js
// HordeMart ⇄ Mr Mouse wire formats, Mr Mouse side. Mirrors HordeMart's
// src/lib/integrations/mrmouse.ts; the contract is HordeMart's
// docs/integrations/mrmouse.md. Node's crypto only.

const { createHmac, randomBytes, timingSafeEqual } = require("crypto");

const hmac = (secret, data) => createHmac("sha256", secret).update(data).digest();

const SIGNATURE_TOLERANCE_SECONDS = 300;

function assertSecret(secret, name) {
  if (!secret || secret.length < 32) throw new Error(`${name} is missing or shorter than 32 characters`);
}

// Check a HordeMart sign-in pass. Returns its claims, or null for anything
// not exactly right (never says which part failed). Single use is the
// caller's job: refuse a `jti` seen before.
function verifyHordeMartPass(token, secret, now = Date.now()) {
  assertSecret(secret, "HORDEMART_SSO_SECRET");
  const parts = String(token ?? "").split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  try {
    // Pin the algorithm: never let the token say how to check it.
    if (JSON.parse(Buffer.from(header, "base64url").toString()).alg !== "HS256") return null;
    const expected = hmac(secret, `${header}.${payload}`);
    const given = Buffer.from(signature, "base64url");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    const seconds = Math.floor(now / 1000);
    if (claims.iss !== "hordemart" || claims.aud !== "mrmouse") return null;
    if (typeof claims.exp !== "number" || claims.exp < seconds) return null;
    if (typeof claims.iat !== "number" || claims.iat > seconds + 30) return null;
    if (typeof claims.sub !== "string" || !claims.sub || typeof claims.jti !== "string" || !claims.jti) return null;
    if (typeof claims.email !== "string" || typeof claims.site?.id !== "string" || !claims.site.id) return null;
    return claims;
  } catch {
    return null;
  }
}

// `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">`
function signBody(rawBody, secret, now = Date.now()) {
  const t = Math.floor(now / 1000);
  return `t=${t},v1=${hmac(secret, `${t}.${rawBody}`).toString("hex")}`;
}

function verifyBodySignature(rawBody, header, secret, now = Date.now()) {
  if (!header || !secret || secret.length < 32) return false;
  const fields = {};
  for (const part of String(header).split(",")) {
    const i = part.indexOf("=");
    if (i > 0) fields[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  const t = Number(fields.t);
  if (!Number.isInteger(t) || Math.abs(Math.floor(now / 1000) - t) > SIGNATURE_TOLERANCE_SECONDS) return false;
  if (!/^[a-f0-9]{64}$/.test(fields.v1 || "")) return false;
  const expected = hmac(secret, `${t}.${rawBody}`);
  const given = Buffer.from(fields.v1, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const newTicket = () => randomBytes(24).toString("base64url");

// Push absolute stock levels by SKU for one linked store. HordeMart never
// takes prices from this.
async function pushStockToHordeMart({ apiUrl, secret, siteId, items, sentAt = new Date(), fetchImpl = fetch }) {
  const body = JSON.stringify({ siteId, sentAt: sentAt.toISOString(), items });
  const res = await fetchImpl(`${apiUrl.replace(/\/$/, "")}/api/integrations/mrmouse/inventory`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-MrMouse-Signature": signBody(body, secret) },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

module.exports = {
  SIGNATURE_TOLERANCE_SECONDS,
  verifyHordeMartPass,
  signBody,
  verifyBodySignature,
  newTicket,
  pushStockToHordeMart,
};
