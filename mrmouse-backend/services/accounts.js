// services/accounts.js — creating a business with its owner, and the
// session a successful sign-in returns. Shared by sign-up (routes/users.js)
// and the HordeMart link (routes/hordemart.js) so both follow one path.
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const User = require("../models/User");
const Business = require("../models/Business");
const { ensureSubscription } = require("./subscriptionStore");
const { createToken, setSessionCookie } = require("../auth");

const SALT_ROUNDS = 10;
const TRIAL_DAYS = 30;

function sanitizeUser(userDoc) {
  const { passwordHash, _id, __v, ...rest } = userDoc.toObject ? userDoc.toObject() : userDoc;
  return rest;
}

function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

// A password nobody knows, for accounts created from HordeMart: they sign
// in from HordeMart until they set one in Settings.
function unusablePasswordHash() {
  return hashPassword(crypto.randomBytes(32).toString("base64url"));
}

async function createBusinessWithOwner({ email, name, passwordHash, business }) {
  const businessId = crypto.randomUUID();
  const now = new Date();
  await Business.create({
    id: businessId,
    companyId: businessId,
    businessName: business.businessName,
    cac: business.cac || "",
    location: business.location || "",
    contact: business.contact || "",
    industry: business.industry || "",
    email: business.email || email,
    plan: { tier: "solo", maxDevices: 1 },
    billing: {
      status: "trialing",
      trialStartsAt: now,
      trialEndsAt: new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
      planTier: "solo",
      seats: 1,
      addons: { telegram: false, whatsapp: false },
    },
  });

  const user = await User.create({
    id: crypto.randomUUID(),
    email,
    name,
    passwordHash,
    businessId,
    role: "owner",
  });

  const savedBusiness = await ensureSubscription(businessId);
  return { user, business: savedBusiness };
}

// Exactly what POST /api/users/login answers: a bearer token for the
// desktop/mobile apps, and the HttpOnly cookie for the browser.
function issueSession(user, res) {
  const cleanUser = sanitizeUser(user);
  const token = createToken(cleanUser);
  setSessionCookie(res, cleanUser);
  return { token, user: cleanUser };
}

module.exports = {
  SALT_ROUNDS,
  sanitizeUser,
  hashPassword,
  unusablePasswordHash,
  createBusinessWithOwner,
  issueSession,
};
