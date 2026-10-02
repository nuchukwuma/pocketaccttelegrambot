// Deliberately the ONLY place the bot server asks "is this business
// allowed to use Telegram / WhatsApp / reminders right now" — there is
// no local copy of subscription state. It calls the main backend's real,
// Mongo-backed billing.js/subscriptionStore.js directly.
//
// This REPLACES the bot server's own subscriptionStore.js +
// billingEntitlements.js (the Turso versions) — those tracked a SECOND,
// disconnected billing record that a Paystack payment never touched, so
// checking against them would have blocked paying customers while
// leaving expired ones through, depending on which record happened to
// be stale in which direction. Delete those two files once this is
// wired in; keeping both means two possible answers to "is this
// business entitled," which is worse than having neither.
import dotenv from "dotenv";
dotenv.config();

const SERVER_URL = process.env.MAIN_APP_SERVER_URL || "http://localhost:5000";

// Entitlement checks happen on every command/request — a 30s cache keeps
// that from hammering the main backend on every /stock or /balance call,
// without meaningfully delaying a hardStop from taking effect.
const CACHE_TTL_MS = 30_000;
const cache = new Map(); // companyId -> { data, expiresAt }

export async function getEntitlements(companyId, { fresh = false } = {}) {
  const cached = cache.get(companyId);
  if (!fresh && cached && cached.expiresAt > Date.now()) return cached.data;

  try {
    const res = await fetch(
      `${SERVER_URL}/api/billing/status?companyId=${encodeURIComponent(companyId)}`,
      {
        headers: {
          "x-bot-api-key": process.env.BOT_API_KEY || "",
          "Content-Type": "application/json",
        },
      }
    );

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Billing status failed: ${res.status}`);

    cache.set(companyId, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    return data;
  } catch (err) {
    console.error(`[${companyId}] entitlements fetch failed`, err);
    // Fail CLOSED if the billing source is unreachable.
    return {
      entitled: false,
      hardStop: true,
      telegram: false,
      whatsapp: false,
      ai: false,
      premium: { reminders: false },
    };
  }
}

const FEATURE_MESSAGES = {
  telegram:
    "Telegram is a paid add-on (or included in your trial). Subscribe from the app's Settings to keep using it.",
  whatsapp:
    "WhatsApp is a paid add-on (or included in your trial). Subscribe from the app's Settings to keep using it.",
  reminders:
    "Reminders need an active subscription or trial. Subscribe from the app's Settings to keep using them.",
  ai:
    "The AI assistant is a paid add-on (₦1,000/month) — not part of the free trial. Subscribe from Settings → AI to use it.",
};

// Returns { ok: true, entitlements } or { ok: false, message, entitlements }.
export async function checkFeature(companyId, feature) {
  const entitlements = await getEntitlements(companyId);
  const allowed =
    feature === "telegram"
      ? Boolean(entitlements.telegram)
      : feature === "whatsapp"
      ? Boolean(entitlements.whatsapp)
      : feature === "reminders"
      ? Boolean(entitlements.premium?.reminders ?? entitlements.entitled)
      : feature === "ai"
      ? Boolean(entitlements.ai) // deliberately NOT falling back to entitlements.entitled — no trial for AI
      : Boolean(entitlements.entitled);

  if (allowed) return { ok: true, entitlements };
  return {
    ok: false,
    message: FEATURE_MESSAGES[feature] || "An active subscription is required.",
    entitlements,
  };
}

// Call after a webhook/verify confirms a payment, or after /link, so the
// very next check reflects it instead of waiting out the cache TTL.
export function invalidateEntitlements(companyId) {
  cache.delete(companyId);
}