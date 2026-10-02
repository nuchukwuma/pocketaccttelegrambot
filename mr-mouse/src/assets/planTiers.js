// planTiers.js
// Single source of truth for the UI pricing and entitlement labels.
// Server-side billing rules must mirror these values; never trust the client
// for authorization.

export const FREE_TRIAL_DAYS = 30;

export const PLAN_TIERS = {
  solo: {
    key: "solo",
    label: "Individual",
    priceNaira: 1000,
    currency: "NGN",
    interval: "monthly",
    maxDevices: 1,
    minUsers: 1,
    description: "One person, one business.",
  },
  duo: {
    key: "duo",
    label: "Duo",
    priceNaira: 2000,
    currency: "NGN",
    interval: "monthly",
    maxDevices: 2,
    minUsers: 2,
    description: "Two seats for an owner and co-founder or assistant.",
  },
  company: {
    key: "company",
    label: "Company",
    priceNaira: 850,
    currency: "NGN",
    interval: "monthly",
    pricePerUser: true,
    minUsers: 5,
    maxDevices: null,
    description: "₦850 per user, minimum 5 users.",
  },
};

export const ADD_ONS = {
  telegram: {
    key: "telegram",
    label: "Telegram",
    priceNaira: 1500,
    currency: "NGN",
    interval: "monthly",
    description: "Automated Telegram notifications and reminders.",
  },
  whatsapp: {
    key: "whatsapp",
    label: "WhatsApp",
    priceNaira: 500,
    currency: "NGN",
    interval: "monthly",
    description: "WhatsApp document delivery, reminders and automation.",
  },
  ai: {
    key: "ai",
    label: "AI Assistant",
    priceNaira: 1000,
    currency: "NGN",
    interval: "monthly",
    description: "Add entries and ask questions about your books in plain English — via the app or Telegram.",
    // Unlike telegram/whatsapp, this is NOT included in the free trial —
    // paid-only from day one. Settings.jsx and Dashboard.jsx should never
    // show trial-availability copy for this add-on.
    noTrial: true,
  },
};

export function companyPriceNaira(seats) {
  const n = Math.max(PLAN_TIERS.company.minUsers, Number(seats) || PLAN_TIERS.company.minUsers);
  return n * PLAN_TIERS.company.priceNaira;
}

export function resolveMaxDevices(plan) {
  if (!plan || !plan.tier) return PLAN_TIERS.solo.maxDevices;
  if (plan.tier === "company") {
    return Math.max(
      PLAN_TIERS.company.minUsers,
      Number(plan.maxDevices) || PLAN_TIERS.company.minUsers
    );
  }
  return PLAN_TIERS[plan.tier]?.maxDevices ?? PLAN_TIERS.solo.maxDevices;
}
