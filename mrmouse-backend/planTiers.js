// planTiers.js
// Single source of truth for the three tiers, shared between server-side
// enforcement and any client-side pricing/settings UI. Copy this file
// as-is into the client project too, so both sides agree on the numbers.

const PLAN_TIERS = {
  solo: { label: "Solo", maxDevices: 1, description: "One device, one business — no sharing the login." },
  duo: { label: "Duo", maxDevices: 2, description: "Two devices — e.g. you and a co-founder, or phone + laptop." },
  company: {
    label: "Company",
    maxDevices: null, // admin-chosen — see plan.maxDevices on the Business record instead
    description: "Admin picks the number of seats. Enforced against Business.plan.maxDevices, not this constant.",
  },
};

// Resolves the actual enforced cap for a given business's plan. Solo/Duo are
// fixed regardless of what's stored; Company defers to whatever the admin set.
function resolveMaxDevices(plan) {
  if (!plan || !plan.tier) return PLAN_TIERS.solo.maxDevices;
  if (plan.tier === "company") return Math.max(1, Number(plan.maxDevices) || 1);
  return PLAN_TIERS[plan.tier]?.maxDevices ?? PLAN_TIERS.solo.maxDevices;
}

module.exports = { PLAN_TIERS, resolveMaxDevices };
