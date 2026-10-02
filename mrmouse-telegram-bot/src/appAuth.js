// appAuth.js — who is calling the bot server's HTTP API from the app.
//
// The app used to send `x-bot-api-key`, but every VITE_ variable is
// compiled into the app, so that key was public and let anyone act for
// any companyId. Now the app sends the signed-in person's own session
// token (Authorization: Bearer …). This file asks the main backend whose
// token it is, and only lets them act for THEIR business.
//
// Server-to-server calls (the bot to the main backend) still use
// BOT_API_KEY — that key must now be rotated, since old app builds
// published it.
import { createHash } from "node:crypto";
import dotenv from "dotenv";
dotenv.config();

const SERVER_URL = process.env.MAIN_APP_SERVER_URL || "http://localhost:5000";
const CACHE_TTL_MS = 60_000;

// Old app builds only send the key. Off by default: turning it on
// re-opens the hole, so only for a short changeover while users update.
const ALLOW_LEGACY_APP_KEY = process.env.ALLOW_LEGACY_APP_KEY === "true";
if (ALLOW_LEGACY_APP_KEY) {
  console.warn("[auth] ALLOW_LEGACY_APP_KEY is on: requests carrying only the app key are accepted for any business. Turn it off once users have updated.");
}

const userCache = new Map(); // sha256(token) -> { user, expiresAt }
const consentCache = new Map(); // sha256(token):purpose -> expiresAt (positive answers only)

const tokenKey = (token) => createHash("sha256").update(token).digest("hex");

function bearer(req) {
  const header = req.header("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

async function fetchJson(path, token, fetchImpl) {
  const res = await fetchImpl(`${SERVER_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8_000),
  });
  if (res.status === 401 || res.status === 403) return { status: res.status, data: null };
  if (!res.ok) throw new Error(`main server answered ${res.status}`);
  return { status: res.status, data: await res.json() };
}

export async function resolveAppUser(token, { fetchImpl = fetch, now = Date.now() } = {}) {
  if (!token) return null;
  const key = tokenKey(token);
  const hit = userCache.get(key);
  if (hit && hit.expiresAt > now) return hit.user;
  const { data } = await fetchJson("/api/users/me", token, fetchImpl);
  const user = data?.user || null;
  if (user) userCache.set(key, { user, expiresAt: now + CACHE_TTL_MS });
  else userCache.delete(key);
  return user;
}

// Has this person agreed to the CURRENT text for `purpose`? Asked fresh
// unless a yes was seen in the last minute, so a just-given consent is
// never refused and a withdrawal takes effect within a minute.
export async function hasAppConsent(token, purpose, { fetchImpl = fetch, now = Date.now() } = {}) {
  const key = `${tokenKey(token)}:${purpose}`;
  if ((consentCache.get(key) || 0) > now) return true;
  const { data } = await fetchJson("/api/consents", token, fetchImpl);
  const current = data?.versions?.[purpose];
  const ok = Boolean(current && (data.consents || []).some((c) => c.purpose === purpose && c.version === current));
  if (ok) consentCache.set(key, now + CACHE_TTL_MS);
  else consentCache.delete(key);
  return ok;
}

const CONSENT_MESSAGES = {
  telegram: "Agree to connecting Telegram first (Settings → Privacy).",
  whatsapp: "Agree to connecting WhatsApp first (Settings → Privacy).",
};

/**
 * Middleware for app-facing routes.
 *   requireCompanyUser()                              signed in, own business only
 *   requireCompanyUser({ consent: "telegram" })        …and agreed to Telegram
 *   requireCompanyUser({ consent: (req) => purpose })  purpose decided by the request
 */
export function requireCompanyUser({ consent = null, fetchImpl = fetch } = {}) {
  return async (req, res, next) => {
    try {
      const companyId = req.body?.companyId || req.query?.companyId;
      if (!companyId || typeof companyId !== "string") {
        return res.status(400).json({ error: "companyId is required" });
      }

      const token = bearer(req);
      if (!token) {
        const key = req.header("x-bot-api-key");
        if (ALLOW_LEGACY_APP_KEY && key && process.env.BOT_API_KEY && key === process.env.BOT_API_KEY) return next();
        return res.status(401).json({ error: "Sign in again to continue." });
      }

      const user = await resolveAppUser(token, { fetchImpl });
      if (!user) return res.status(401).json({ error: "Sign in again to continue." });
      if (user.businessId !== companyId) {
        return res.status(403).json({ error: "You are not a member of this business." });
      }
      req.appUser = user;

      const purpose = typeof consent === "function" ? consent(req) : consent;
      if (purpose && !(await hasAppConsent(token, purpose, { fetchImpl }))) {
        return res.status(403).json({
          error: CONSENT_MESSAGES[purpose] || "Your agreement is needed first.",
          code: "CONSENT_REQUIRED",
          purpose,
        });
      }
      next();
    } catch (err) {
      console.error("[auth] could not check the caller:", err?.message || "error");
      res.status(503).json({ error: "Couldn't reach the main server to check your sign-in. Try again." });
    }
  };
}

export function _resetAuthCaches() {
  userCache.clear();
  consentCache.clear();
}
