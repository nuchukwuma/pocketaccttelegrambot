// routes/sync.js
// ─────────────────────────────────────────────────────────────────────────
// RELAY ARCHITECTURE — MongoDB now stores ONLY the Business registry
// (companyId -> business profile). Product / Transaction / Settlement /
// PendingOrder / Invoice are NEVER written here anymore — they live only in
// each device's own IndexedDB (via Dexie) and move device-to-device through
// the Socket.io relay in server.js (SYNC_MUTATE / REQUEST_STATE / STATE_OFFERED).
//
// This file keeps the REST surface only for what's genuinely meant to be
// server-authoritative: knowing a company exists, so a device signing in
// on a business name it doesn't recognize still gets *a* companyId to join,
// even before any peer has answered its REQUEST_STATE.
// ─────────────────────────────────────────────────────────────────────────

const express = require("express");
const { z } = require("zod");
const Business = require("../models/Business");
const { requireOwnerOrAdmin } = require("../auth");

const router = express.Router();

/**
 * GET /api/sync/business?companyId=...
 * The only thing left to "bootstrap" from the server — everything else now
 * comes from peers over the socket relay (see useCompanySync.js).
 */
router.get("/business", async (req, res, next) => {
  try {
    const { companyId } = req.query;
    if (!companyId) return res.status(400).json({ error: "companyId is required" });
    if (companyId !== req.user.businessId) return res.status(403).json({ error: "You are not a member of this business" });
    const business = await Business.findOne({ id: companyId }).lean();
    res.json({ companyId, business: business || null });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/sync/business
 * Body: { id, ...profileFields }
 * Updates the business's PROFILE only. Idempotent by id (== companyId).
 *
 * Only the fields below can be written here. This used to $set whatever
 * the app sent, so any owner could post `billing.status: "active"` or a
 * bigger `plan.maxDevices` and skip paying. Plan and billing change only
 * through routes/billing.js, after Paystack confirms a payment.
 */
const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/;
const profileSchema = z
  .object({
    id: z.string().min(1).max(100),
    businessName: z.string().trim().min(1).max(200).optional(),
    cac: z.string().trim().max(60).optional(),
    location: z.string().trim().max(300).optional(),
    contact: z.string().trim().max(120).optional(),
    industry: z.string().trim().max(120).optional(),
    email: z.union([z.string().trim().toLowerCase().email().max(254), z.literal("")]).optional(),
    logoImageId: z.string().max(100).nullable().optional(),
    brandColor: z.string().regex(HEX_COLOUR, "Brand colour must look like #22307a").nullable().optional(),
  })
  .strip();

router.post("/business", requireOwnerOrAdmin, async (req, res, next) => {
  try {
    const parsed = profileSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return res.status(400).json({ error: issue?.message || "Check the business details", field: issue?.path?.join(".") });
    }
    const { id, ...fields } = parsed.data;
    if (id !== req.user.businessId) return res.status(403).json({ error: "You cannot modify another business" });

    const saved = await Business.findOneAndUpdate(
      { id },
      { $set: { ...fields, id, companyId: id, updatedAt: new Date() } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    res.json({ ok: true, business: saved });
  } catch (err) {
    next(err);
  }
});

module.exports = router;