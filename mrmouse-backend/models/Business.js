const mongoose = require("mongoose");
const { Schema } = mongoose;

function sanitizeAddonState(val) {
  if (typeof val === "boolean" || !val) {
    return {
      currentPeriodStart: null,
      currentPeriodEnd: null,
      paystackSubscriptionCode: null,
      paystackPlanCode: null,
    };
  }
  return val;
}

const AddonStateSchema = new Schema(
  {
    currentPeriodStart: { type: Date, default: null },
    currentPeriodEnd: { type: Date, default: null },
    paystackSubscriptionCode: { type: String, default: null },
    paystackPlanCode: { type: String, default: null },
  },
  { _id: false }
);

const AddonsSchema = new Schema(
  {
    telegram: { type: AddonStateSchema, default: () => ({}), set: sanitizeAddonState },
    ai: { type: AddonStateSchema, default: () => ({}), set: sanitizeAddonState },
    whatsapp: { type: AddonStateSchema, default: () => ({}), set: sanitizeAddonState },
  },
  { _id: false }
);

const BillingSchema = new Schema(
  {
    status: {
      type: String,
      enum: ["trialing", "active", "past_due", "canceled", "cancelled", "expired", "inactive"],
      default: "trialing",
    },
    trialStartsAt: { type: Date, default: Date.now },
    trialEndsAt: { type: Date, default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
    pastDueSince: { type: Date, default: null },
    planTier: { type: String, enum: ["solo", "duo", "company"], default: "solo" },
    seats: { type: Number, min: 1, default: 1 },
    currentPeriodStart: { type: Date, default: null },
    currentPeriodEnd: { type: Date, default: null },
    paystackCustomerCode: { type: String, default: null },
    paystackSubscriptionCode: { type: String, default: null },
    paystackAuthorizationCode: { type: String, default: null },
    paystackPlanCode: { type: String, default: null },
    lastTransactionReference: { type: String, default: null },
    addons: { type: AddonsSchema, default: () => ({}) },
    updatedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const BusinessSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    companyId: { type: String, required: true, index: true },
    businessName: { type: String, required: true, trim: true },
    cac: { type: String, default: "" },
    location: { type: String, default: "" },
    contact: { type: String, default: "" },
    industry: { type: String, default: "" },
    email: { type: String, default: "" },
    plan: {
      tier: { type: String, enum: ["solo", "duo", "company"], default: "solo" },
      maxDevices: { type: Number, default: 1, min: 1 },
    },
    billing: { type: BillingSchema, default: () => ({}) },
    updatedAt: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now },
  },
  { minimize: false, versionKey: false }
);

module.exports = mongoose.model("Business", BusinessSchema);