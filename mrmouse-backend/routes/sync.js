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
 * Upserts the one thing that stays in Mongo. Idempotent by id (== companyId).
 */
router.post("/business", requireOwnerOrAdmin, async (req, res, next) => {
  try {
    const { id, ...fields } = req.body;
    if (!id) return res.status(400).json({ error: "id (companyId) is required" });
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