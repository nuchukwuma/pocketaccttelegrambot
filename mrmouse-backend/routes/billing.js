const express = require("express");
const crypto = require("crypto");
const User = require("../models/User");
const Business = require("../models/Business");
const {
  ensureSubscription,
  getEntitlements,
  updateBilling,
  PLAN_PRICES,
  ADDON_PRICES,
  ADDON_PLAN_CODES,
  companyMonthlyAmount,
  addMonth,
} = require("../services/subscriptionStore");
const { initializeTransaction, verifyTransaction } = require("../services/paystackService");
const { requireAuth, requireOwnerOrAdmin } = require("../auth");

const router = express.Router();
const COMPLAINT_EMAIL = "nuchukwuma03@gmail.com";

function safeTier(value) {
  return ["solo", "duo", "company"].includes(value) ? value : "solo";
}

function getOwner(businessId) {
  return User.findOne({ businessId, role: "owner" }).lean();
}

function parseMetadata(metadata) {
  if (!metadata) return {};
  if (typeof metadata === "object") return metadata;
  try { return JSON.parse(metadata); } catch { return {}; }
}

function applyCommonResponse(business) {
  const ent = getEntitlements(business);
  return {
    ok: true,
    supportEmail: COMPLAINT_EMAIL,
    prices: { ...PLAN_PRICES, ...ADDON_PRICES },
    status: ent.status,
    trialEndsAt: ent.trialEndsAt ? new Date(ent.trialEndsAt).toISOString() : null,
    pastDueSince: ent.pastDueSince ? new Date(ent.pastDueSince).toISOString() : null,
    planTier: ent.planTier,
    seats: ent.seats,
    currentPeriodEnd: ent.currentPeriodEnd ? new Date(ent.currentPeriodEnd).toISOString() : null,
    graceEndsAt: ent.graceEndsAt ? new Date(ent.graceEndsAt).toISOString() : null,
    graceActive: ent.graceActive,
    hardStop: ent.hardStop,
    trial: ent.trial,
    paid: ent.paid,
    entitled: ent.entitled,
    telegram: ent.telegram,
    whatsapp: ent.whatsapp,
    ai: ent.ai,
    offline: ent.offline,
    premium: ent.premium,
    addOns: ent.addOns,
    subscription: ent.subscription,
  };
}

router.get("/subscription", requireAuth, async (req, res, next) => {
  try {
    const { companyId } = req.query;
    if (!companyId) return res.status(400).json({ error: "companyId is required" });
    if (companyId !== req.user.businessId) return res.status(403).json({ error: "You are not a member of this business" });
    const business = await ensureSubscription(companyId);
    res.json(applyCommonResponse(business));
  } catch (err) { next(err); }
});

// Accepts user authentication or server-to-server bot API key authentication
router.get("/status", async (req, res, next) => {
  try {
    const { companyId } = req.query;
    if (!companyId) return res.status(400).json({ error: "companyId is required" });

    const botApiKey = req.headers["x-bot-api-key"];
    const isBotRequest = botApiKey && process.env.BOT_API_KEY && botApiKey === process.env.BOT_API_KEY;

    if (!isBotRequest) {
      return requireAuth(req, res, async () => {
        if (companyId !== req.user.businessId) return res.status(403).json({ error: "You are not a member of this business" });
        const business = await ensureSubscription(companyId);
        return res.json(applyCommonResponse(business));
      });
    }

    const business = await ensureSubscription(companyId);
    res.json(applyCommonResponse(business));
  } catch (err) { next(err); }
});

router.post("/initialize", requireAuth, requireOwnerOrAdmin, async (req, res, next) => {
  try {
    const { businessId, tier, seats } = req.body || {};
    if (!businessId) return res.status(400).json({ error: "businessId is required" });
    if (businessId !== req.user.businessId) return res.status(403).json({ error: "You are not a member of this business" });

    const requestedTier = safeTier(tier);
    await ensureSubscription(businessId);
    const owner = await getOwner(businessId);
    if (!owner?.email) return res.status(422).json({ error: "Business owner email is required before payment." });

    const actualSeats = requestedTier === "company" ? Math.max(5, Number(seats) || 5) : requestedTier === "duo" ? 2 : 1;
    const amount = companyMonthlyAmount(requestedTier, actualSeats);
    const reference = `PLAN_${businessId}_${Date.now()}_${crypto.randomBytes(5).toString("hex")}`;
    // This is an app, not a website — there's no page for Paystack to
    // redirect back to, so only pass callback_url if one was explicitly
    // configured. Left unset, Paystack shows its own "payment complete"
    // page instead of dead-ending on a URL the app can't catch.
    const callbackUrl = process.env.PAYSTACK_CALLBACK_URL || undefined;

    const result = await initializeTransaction({
      email: owner.email,
      amountNaira: amount,
      reference,
      planCode: requestedTier === "company"
        ? process.env.PAYSTACK_COMPANY_PLAN_CODE
        : requestedTier === "duo"
        ? process.env.PAYSTACK_DUO_PLAN_CODE
        : process.env.PAYSTACK_INDIVIDUAL_PLAN_CODE,
      callbackUrl,
      metadata: { kind: "plan", businessId, tier: requestedTier, seats: actualSeats },
    });

    res.json({ ok: true, authorizationUrl: result.authorization_url, accessCode: result.access_code, reference: result.reference });
  } catch (err) { next(err); }
});

router.post("/addon/initialize", requireAuth, requireOwnerOrAdmin, async (req, res, next) => {
  try {
    const { businessId, addon } = req.body || {};
    if (!businessId) return res.status(400).json({ error: "businessId is required" });
    if (businessId !== req.user.businessId) return res.status(403).json({ error: "You are not a member of this business" });
    if (!["telegram", "whatsapp", "ai"].includes(addon)) return res.status(400).json({ error: "Invalid addon." });

    await ensureSubscription(businessId);
    const owner = await getOwner(businessId);
    if (!owner?.email) return res.status(422).json({ error: "Owner email is required." });

    const planCode = ADDON_PLAN_CODES[addon];
    if (!planCode) {
      return res.status(500).json({
        error: `No Paystack plan code configured for the ${addon} add-on. Set PAYSTACK_${addon.toUpperCase()}_PLAN_CODE.`,
      });
    }

    const amount = ADDON_PRICES[addon];
    const reference = `ADDON_${addon}_${businessId}_${Date.now()}_${crypto.randomBytes(5).toString("hex")}`;
    const callbackUrl = process.env.PAYSTACK_CALLBACK_URL || undefined;

    const result = await initializeTransaction({
      email: owner.email,
      amountNaira: amount,
      reference,
      planCode,
      callbackUrl,
      metadata: { kind: "addon", businessId, addon },
    });

    res.json({ ok: true, authorizationUrl: result.authorization_url, accessCode: result.access_code, reference: result.reference, amount, addon });
  } catch (err) { next(err); }
});

router.post("/verify", requireAuth, requireOwnerOrAdmin, async (req, res, next) => {
  try {
    const { businessId, reference } = req.body || {};
    if (!businessId || !reference) return res.status(400).json({ error: "businessId and reference are required" });
    if (businessId !== req.user.businessId) return res.status(403).json({ error: "You are not a member of this business" });

    const result = await verifyTransaction(reference);
    const metadata = parseMetadata(result.metadata);
    if (result.status !== "success" || metadata.businessId !== businessId) {
      return res.status(400).json({ error: "Payment could not be verified." });
    }

    if (metadata.kind === "plan") {
      const tier = safeTier(metadata.tier);
      const seats = tier === "company" ? Math.max(5, Number(metadata.seats) || 5) : tier === "duo" ? 2 : 1;
      await updateBilling(businessId, {
        status: "active",
        planTier: tier,
        seats,
        currentPeriodStart: new Date(),
        currentPeriodEnd: addMonth(new Date()),
        pastDueSince: null,
        paystackCustomerCode: result.customer?.customer_code || null,
        paystackAuthorizationCode: result.authorization?.authorization_code || null,
        paystackPlanCode: result.plan?.plan_code || null,
        lastTransactionReference: reference,
      });
    } else if (metadata.kind === "addon") {
      const now = new Date();
      await updateBilling(businessId, {
        addons: {
          [metadata.addon]: {
            currentPeriodStart: now,
            currentPeriodEnd: addMonth(now),
            paystackSubscriptionCode: result.subscription?.subscription_code || null,
            paystackPlanCode: result.plan?.plan_code || ADDON_PLAN_CODES[metadata.addon] || null,
          },
        },
        lastTransactionReference: reference,
      });
    }

    const business = await ensureSubscription(businessId);
    res.json(applyCommonResponse(business));
  } catch (err) { next(err); }
});

router.post("/webhook", (req, res, next) => {
  try {
    const signature = req.headers["x-paystack-signature"];
    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret || !signature || !Buffer.isBuffer(req.body)) return res.status(401).send("Invalid webhook");

    const expected = crypto.createHmac("sha512", secret).update(req.body).digest("hex");
    const provided = String(signature);
    if (expected.length !== provided.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided))) {
      return res.status(401).send("Invalid signature");
    }

    const event = JSON.parse(req.body.toString("utf8"));

    setImmediate(async () => {
      try {
        const data = event.data || {};
        const metadata = parseMetadata(data.metadata);
        const subscriptionCode = data.subscription?.subscription_code || data.subscription_code || null;
        let businessId = metadata.businessId;

        let business = businessId ? await Business.findOne({ id: businessId }) : null;
        if (!business && subscriptionCode) {
          business = await Business.findOne({
            $or: [
              { "billing.paystackSubscriptionCode": subscriptionCode },
              { "billing.addons.telegram.paystackSubscriptionCode": subscriptionCode },
              { "billing.addons.whatsapp.paystackSubscriptionCode": subscriptionCode },
              { "billing.addons.ai.paystackSubscriptionCode": subscriptionCode },
            ],
          });
          if (business) businessId = business.id;
        }
        if (!businessId || !business) return;

        if (event.event === "charge.success") {
          if (metadata.kind === "plan") {
            const tier = safeTier(metadata.tier);
            const seats = tier === "company" ? Math.max(5, Number(metadata.seats) || 5) : tier === "duo" ? 2 : 1;
            await updateBilling(businessId, {
              status: "active",
              planTier: tier,
              seats,
              currentPeriodStart: new Date(),
              currentPeriodEnd: addMonth(new Date()),
              pastDueSince: null,
              paystackCustomerCode: data.customer?.customer_code || null,
              paystackSubscriptionCode: subscriptionCode,
              paystackAuthorizationCode: data.authorization?.authorization_code || null,
              paystackPlanCode: data.plan?.plan_code || null,
              lastTransactionReference: data.reference || null,
            });
          } else if (metadata.kind === "addon") {
            const now = new Date();
            await updateBilling(businessId, {
              addons: {
                [metadata.addon]: {
                  currentPeriodStart: now,
                  currentPeriodEnd: addMonth(now),
                  paystackSubscriptionCode: subscriptionCode,
                  paystackPlanCode: data.plan?.plan_code || ADDON_PLAN_CODES[metadata.addon] || null,
                },
              },
              lastTransactionReference: data.reference || null,
            });
          } else if (subscriptionCode) {
            if (business.billing?.paystackSubscriptionCode === subscriptionCode) {
              await updateBilling(businessId, {
                status: "active",
                currentPeriodStart: new Date(),
                currentPeriodEnd: addMonth(new Date()),
                pastDueSince: null,
                lastTransactionReference: data.reference || null,
              });
            } else {
              const addonKey =
                business.billing?.addons?.telegram?.paystackSubscriptionCode === subscriptionCode
                  ? "telegram"
                  : business.billing?.addons?.whatsapp?.paystackSubscriptionCode === subscriptionCode
                  ? "whatsapp"
                  : null;
              if (addonKey) {
                const now = new Date();
                await updateBilling(businessId, {
                  addons: {
                    [addonKey]: { currentPeriodStart: now, currentPeriodEnd: addMonth(now) },
                  },
                  lastTransactionReference: data.reference || null,
                });
              }
            }
          }
          return;
        }

        if (event.event === "invoice.payment_failed") {
          if (subscriptionCode && business.billing?.paystackSubscriptionCode !== subscriptionCode) {
            return;
          }
          const ensured = await ensureSubscription(businessId);
          if (ensured.billing?.status !== "past_due") {
            ensured.billing.status = "past_due";
            ensured.billing.pastDueSince = new Date();
            ensured.billing.updatedAt = new Date();
            if (subscriptionCode) {
              ensured.billing.paystackSubscriptionCode = subscriptionCode;
            }
            await ensured.save();
          }
          return;
        }

        if (event.event === "subscription.not_renew" || event.event === "subscription.disable") {
          const code = subscriptionCode || data.subscription_code;

          if (business.billing?.paystackSubscriptionCode && business.billing.paystackSubscriptionCode === code) {
            await updateBilling(businessId, {
              status: event.event === "subscription.disable" ? "canceled" : "past_due",
              pastDueSince: event.event === "subscription.not_renew" ? new Date() : null,
            });
            return;
          }

          const addonKey =
            business.billing?.addons?.telegram?.paystackSubscriptionCode === code
              ? "telegram"
              : business.billing?.addons?.whatsapp?.paystackSubscriptionCode === code
              ? "whatsapp"
              : business.billing?.addons?.ai?.paystackSubscriptionCode === code
              ? "ai"
              : null;
          if (addonKey) {
            await updateBilling(businessId, {
              addons: { [addonKey]: { currentPeriodEnd: null } },
            });
          }
        }
      } catch (err) {
        console.error("[paystack webhook] processing failed", err);
      }
    });

    return res.sendStatus(200);
  } catch (err) { next(err); }
});

module.exports = router;