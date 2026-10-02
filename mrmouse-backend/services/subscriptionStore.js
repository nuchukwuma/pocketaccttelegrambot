const Business = require("../models/Business");

const TRIAL_DAYS = 30;
const GRACE_DAYS = 7;
const PLAN_PRICES = { solo: 1000, duo: 2000, company: 850 };
// ai is deliberately NOT included in the trial bundle — see getEntitlements()
// below, where `ai` is gated purely on isAddonActive(), unlike telegram/
// whatsapp which are also unlocked during a trial.
const ADDON_PRICES = { telegram: 1500, whatsapp: 500, ai: 1000 };

const ADDON_PLAN_CODES = {
  telegram: process.env.PAYSTACK_TELEGRAM_PLAN_CODE || null,
  whatsapp: process.env.PAYSTACK_WHATSAPP_PLAN_CODE || null,
  ai: process.env.PAYSTACK_AI_PLAN_CODE || null,
};

function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function addMonth(date) {
  const d = new Date(date);
  const originalDay = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + 1);
  if (d.getUTCDate() < originalDay) d.setUTCDate(0);
  return d;
}

function normalizeTier(tier) {
  return ["solo", "duo", "company"].includes(tier) ? tier : "solo";
}

function normalizeSeats(tier, seats) {
  if (tier === "company") return Math.max(5, Number(seats) || 5);
  if (tier === "duo") return 2;
  return 1;
}

function companyMonthlyAmount(tier, seats) {
  const normalized = normalizeTier(tier);
  return normalized === "company"
    ? normalizeSeats("company", seats) * PLAN_PRICES.company
    : PLAN_PRICES[normalized] || PLAN_PRICES.solo;
}

function asDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isAddonActive(addonState, now = new Date()) {
  const end = asDate(addonState?.currentPeriodEnd);
  return Boolean(end && now < end);
}

// Fixed: Handles primitive booleans (e.g. false / true from legacy DB records)
// to prevent Mongoose CastError on embedded subdocuments.
function normalizeAddonState(state) {
  if (typeof state === "boolean" || !state) {
    return {
      currentPeriodStart: null,
      currentPeriodEnd: null,
      paystackSubscriptionCode: null,
      paystackPlanCode: null,
    };
  }
  return {
    currentPeriodStart: state.currentPeriodStart || null,
    currentPeriodEnd: state.currentPeriodEnd || null,
    paystackSubscriptionCode: state.paystackSubscriptionCode || null,
    paystackPlanCode: state.paystackPlanCode || null,
  };
}

function getTrialWindow(business) {
  const createdAt = asDate(business.createdAt) || new Date();
  const start = asDate(business.billing?.trialStartsAt) || createdAt;
  const end = asDate(business.billing?.trialEndsAt) || addDays(start, TRIAL_DAYS);
  return { start, end };
}

function trialState(billing, now = new Date()) {
  const start = asDate(billing?.trialStartsAt);
  const end = asDate(billing?.trialEndsAt);
  if (!start || !end) return { active: false, expired: true, grace: false, graceEndsAt: null };

  const graceEndsAt = addDays(end, GRACE_DAYS);
  const active = now >= start && now < end;
  const grace = now >= end && now < graceEndsAt;
  const expired = now >= graceEndsAt;

  return { active, expired, grace, graceEndsAt };
}

function paidState(billing, now = new Date()) {
  if (!billing) return { active: false, pastDue: false, grace: false, blocked: true, graceEndsAt: null };

  const periodEnd = asDate(billing.currentPeriodEnd);
  const active = billing.status === "active" && (!periodEnd || now < periodEnd);

  if (active) {
    return { active: true, pastDue: false, grace: false, blocked: false, graceEndsAt: periodEnd };
  }

  if (billing.status === "past_due") {
    const pastDueSince = asDate(billing.pastDueSince);
    const graceEndsAt = pastDueSince ? addDays(pastDueSince, GRACE_DAYS) : now;
    const grace = pastDueSince ? now < graceEndsAt : false;
    return {
      active: false,
      pastDue: true,
      grace,
      blocked: !grace,
      graceEndsAt,
    };
  }

  return { active: false, pastDue: false, grace: false, blocked: true, graceEndsAt: periodEnd };
}

function computeAccessState(business, now = new Date()) {
  const billing = business?.billing || {};
  const trial = trialState(billing, now);
  const paid = paidState(billing, now);

  if (trial.active) {
    return {
      status: "trialing",
      trialActive: true,
      graceActive: false,
      graceEndsAt: trial.graceEndsAt,
      hardStop: false,
      subscriptionActive: false,
      entitled: true,
    };
  }

  if (trial.grace) {
    return {
      status: "expired",
      trialActive: false,
      graceActive: true,
      graceEndsAt: trial.graceEndsAt,
      hardStop: false,
      subscriptionActive: false,
      entitled: true,
    };
  }

  if (paid.active) {
    return {
      status: "active",
      trialActive: false,
      graceActive: false,
      graceEndsAt: paid.graceEndsAt,
      hardStop: false,
      subscriptionActive: true,
      entitled: true,
    };
  }

  if (paid.pastDue && paid.grace) {
    return {
      status: "past_due",
      trialActive: false,
      graceActive: true,
      graceEndsAt: paid.graceEndsAt,
      hardStop: false,
      subscriptionActive: false,
      entitled: true,
    };
  }

  return {
    status: billing.status === "canceled" || billing.status === "cancelled" ? "canceled" : (billing.status || "expired"),
    trialActive: false,
    graceActive: false,
    graceEndsAt: paid.graceEndsAt || trial.graceEndsAt || null,
    hardStop: true,
    subscriptionActive: false,
    entitled: false,
  };
}

async function ensureSubscription(companyId) {
  if (!companyId) throw Object.assign(new Error("companyId is required"), { status: 400 });
  const business = await Business.findOne({ id: companyId });
  if (!business) throw Object.assign(new Error("Business not found"), { status: 404 });

  const now = new Date();
  const current = business.billing || {};
  const trial = getTrialWindow(business);
  const planTier = normalizeTier(current.planTier || business.plan?.tier || "solo");
  const seats = normalizeSeats(planTier, current.seats || business.plan?.maxDevices || 1);

  const desiredStatus = current.status || (now < trial.end ? "trialing" : "expired");
  const billing = {
    ...current,
    status: desiredStatus,
    trialStartsAt: current.trialStartsAt || trial.start,
    trialEndsAt: current.trialEndsAt || trial.end,
    planTier,
    seats,
    pastDueSince: current.pastDueSince || null,
    addons: {
      telegram: normalizeAddonState(current.addons?.telegram),
      whatsapp: normalizeAddonState(current.addons?.whatsapp),
      ai: normalizeAddonState(current.addons?.ai),
    },
    updatedAt: now,
  };

  const state = computeAccessState({ billing }, now);
  if (billing.status === "trialing" && !state.trialActive && !state.graceActive) billing.status = "expired";
  if (billing.status === "active" && !state.subscriptionActive) billing.status = "expired";
  if (billing.status === "cancelled") billing.status = "canceled";

  business.billing = billing;
  business.plan = {
    tier: planTier,
    maxDevices: planTier === "company" ? Math.max(5, seats) : planTier === "duo" ? 2 : 1,
  };

  await business.save();
  return business;
}

function getEntitlements(business, now = new Date()) {
  if (!business) {
    return {
      trial: false,
      paid: false,
      entitled: false,
      hardStop: true,
      graceActive: false,
      plan: false,
      telegram: false,
      whatsapp: false,
      offline: false,
      maxDevices: 0,
      status: "inactive",
    };
  }

  const billing = business.billing || {};
  const planTier = normalizeTier(billing.planTier || business.plan?.tier || "solo");
  const seats = normalizeSeats(planTier, billing.seats || business.plan?.maxDevices || 1);
  const maxDevices = planTier === "company" ? Math.max(5, seats) : planTier === "duo" ? 2 : 1;
  const access = computeAccessState(business, now);
  const premiumUnlocked = access.trialActive || access.subscriptionActive || access.graceActive;
  const telegramAddonActive = isAddonActive(billing.addons?.telegram, now);
  const whatsappAddonActive = isAddonActive(billing.addons?.whatsapp, now);
  // Deliberately NOT gated by premiumUnlocked/trial — ai is paid-only from
  // day one, no free trial window, regardless of the business's plan or
  // trial status. It only turns on when the ₦1000 add-on itself is active.
  const aiAddonActive = isAddonActive(billing.addons?.ai, now);

  return {
    businessId: business.id,
    trial: access.trialActive,
    paid: access.subscriptionActive,
    entitled: access.entitled,
    hardStop: access.hardStop,
    graceActive: access.graceActive,
    status: access.status,
    planTier,
    seats,
    maxDevices,
    trialStartsAt: billing.trialStartsAt || null,
    trialEndsAt: billing.trialEndsAt || null,
    pastDueSince: billing.pastDueSince || null,
    currentPeriodStart: billing.currentPeriodStart || null,
    currentPeriodEnd: billing.currentPeriodEnd || null,
    graceEndsAt: access.graceEndsAt || null,
    offline: access.entitled,
    telegram: premiumUnlocked && (access.trialActive || telegramAddonActive),
    whatsapp: premiumUnlocked && (access.trialActive || whatsappAddonActive),
    ai: aiAddonActive,
    addOns: {
      telegram: premiumUnlocked && (access.trialActive || telegramAddonActive),
      whatsapp: premiumUnlocked && (access.trialActive || whatsappAddonActive),
      ai: aiAddonActive,
    },
    premium: {
      reminders: premiumUnlocked,
      monthlyStatements: premiumUnlocked,
      telegram: premiumUnlocked && (access.trialActive || telegramAddonActive),
      whatsapp: premiumUnlocked && (access.trialActive || whatsappAddonActive),
      ai: aiAddonActive,
    },
    subscription: {
      companyId: business.id,
      status: access.status,
      trialEndsAt: billing.trialEndsAt ? new Date(billing.trialEndsAt).toISOString() : null,
      pastDueSince: billing.pastDueSince ? new Date(billing.pastDueSince).toISOString() : null,
      planTier,
      seats,
      currentPeriodEnd: billing.currentPeriodEnd ? new Date(billing.currentPeriodEnd).toISOString() : null,
      graceEndsAt: access.graceEndsAt ? new Date(access.graceEndsAt).toISOString() : null,
      graceActive: access.graceActive,
      hardStop: access.hardStop,
      addOns: {
        telegram: premiumUnlocked && (access.trialActive || telegramAddonActive),
        whatsapp: premiumUnlocked && (access.trialActive || whatsappAddonActive),
        ai: aiAddonActive,
      },
      addOnPeriods: {
        telegram: billing.addons?.telegram?.currentPeriodEnd
          ? new Date(billing.addons.telegram.currentPeriodEnd).toISOString()
          : null,
        whatsapp: billing.addons?.whatsapp?.currentPeriodEnd
          ? new Date(billing.addons.whatsapp.currentPeriodEnd).toISOString()
          : null,
        ai: billing.addons?.ai?.currentPeriodEnd
          ? new Date(billing.addons.ai.currentPeriodEnd).toISOString()
          : null,
      },
      prices: {
        planMonthlyNaira: companyMonthlyAmount(planTier, seats),
        telegramMonthlyNaira: ADDON_PRICES.telegram,
        whatsappMonthlyNaira: ADDON_PRICES.whatsapp,
        aiMonthlyNaira: ADDON_PRICES.ai,
      },
    },
  };
}

async function updateBilling(companyId, updates = {}) {
  const business = await ensureSubscription(companyId);
  const current = business.billing || {};

  const planTier = normalizeTier(updates.planTier || current.planTier || business.plan?.tier || "solo");
  const seats = normalizeSeats(planTier, updates.seats || current.seats || business.plan?.maxDevices || 1);

  const addons = {
    telegram: { ...normalizeAddonState(current.addons?.telegram), ...(updates.addons?.telegram || {}) },
    whatsapp: { ...normalizeAddonState(current.addons?.whatsapp), ...(updates.addons?.whatsapp || {}) },
    ai: { ...normalizeAddonState(current.addons?.ai), ...(updates.addons?.ai || {}) },
  };

  business.billing = {
    ...current,
    status: updates.status || current.status || "trialing",
    trialStartsAt: current.trialStartsAt || getTrialWindow(business).start,
    trialEndsAt: current.trialEndsAt || getTrialWindow(business).end,
    planTier,
    seats,
    currentPeriodStart: updates.currentPeriodStart || current.currentPeriodStart || null,
    currentPeriodEnd: updates.currentPeriodEnd || current.currentPeriodEnd || null,
    pastDueSince: Object.prototype.hasOwnProperty.call(updates, "pastDueSince") ? updates.pastDueSince : (current.pastDueSince || null),
    paystackCustomerCode: updates.paystackCustomerCode || current.paystackCustomerCode || null,
    paystackSubscriptionCode: updates.paystackSubscriptionCode || current.paystackSubscriptionCode || null,
    paystackAuthorizationCode: updates.paystackAuthorizationCode || current.paystackAuthorizationCode || null,
    paystackPlanCode: updates.paystackPlanCode || current.paystackPlanCode || null,
    lastTransactionReference: updates.lastTransactionReference || current.lastTransactionReference || null,
    addons,
    updatedAt: new Date(),
  };

  if (updates.status === "active") business.billing.pastDueSince = null;

  business.plan = {
    tier: planTier,
    maxDevices: planTier === "company" ? Math.max(5, seats) : planTier === "duo" ? 2 : 1,
  };

  await business.save();
  return business;
}

module.exports = {
  TRIAL_DAYS,
  GRACE_DAYS,
  PLAN_PRICES,
  ADDON_PRICES,
  ADDON_PLAN_CODES,
  addMonth,
  companyMonthlyAmount,
  ensureSubscription,
  getEntitlements,
  updateBilling,
  computeAccessState,
  isAddonActive,
};