// services/consents.js — read and write the append-only Consent log.
const Consent = require("../models/Consent");
const { CONSENT_VERSIONS } = require("../legal/versions");

function requestMeta(req) {
  return {
    ip: req?.ip || null,
    userAgent: String(req?.get?.("user-agent") || "").slice(0, 300) || null,
  };
}

function recordConsent({ user, purpose, version, source = "app", ip = null, userAgent = null }) {
  return Consent.create({
    userId: user.id,
    businessId: user.businessId,
    purpose,
    action: "accepted",
    version,
    source,
    ip,
    userAgent,
  });
}

function withdrawConsent({ user, purpose, ip = null, userAgent = null }) {
  return Consent.create({
    userId: user.id,
    businessId: user.businessId,
    purpose,
    action: "withdrawn",
    version: null,
    ip,
    userAgent,
  });
}

// The latest row per purpose decides; a withdrawal cancels what came before.
async function currentConsents(userId) {
  const rows = await Consent.find({ userId }).sort({ createdAt: 1, _id: 1 }).lean();
  const latest = {};
  for (const row of rows) latest[row.purpose] = row;
  return Object.values(latest)
    .filter((row) => row.action === "accepted")
    .map((row) => ({ purpose: row.purpose, version: row.version, acceptedAt: row.createdAt }));
}

// True only for the CURRENT version: agreeing to an older text does not count.
async function hasCurrentConsent(userId, purpose) {
  const latest = await Consent.findOne({ userId, purpose }).sort({ createdAt: -1, _id: -1 }).lean();
  return Boolean(latest && latest.action === "accepted" && latest.version === CONSENT_VERSIONS[purpose]);
}

module.exports = { requestMeta, recordConsent, withdrawConsent, currentConsents, hasCurrentConsent };
