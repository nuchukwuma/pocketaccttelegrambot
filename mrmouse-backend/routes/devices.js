// routes/devices.js
const express = require("express");
const Device = require("../models/Device");
const { ensureSubscription, getEntitlements } = require("../services/subscriptionStore");
const { requireOwnerOrAdmin } = require("../auth");

function buildDevicesRouter(io) {
  const router = express.Router();

  router.post("/register", requireOwnerOrAdmin, async (req, res, next) => {
    try {
      const { businessId, deviceId, label } = req.body;
      if (!businessId || !deviceId) {
        return res.status(400).json({ error: "businessId and deviceId are required" });
      }
      if (businessId !== req.user.businessId) return res.status(403).json({ error: "You cannot register a device for another business" });

      const business = await ensureSubscription(businessId);
      const entitlements = getEntitlements(business);
      const maxDevices = Number(entitlements.maxDevices || 0);
      const existing = await Device.findOne({ id: deviceId, businessId });

      if (!entitlements.entitled) {
        return res.status(402).json({
          error: "Your free trial or subscription has ended. Please subscribe to continue.",
          code: "SUBSCRIPTION_REQUIRED",
          subscriptionStatus: entitlements.status,
        });
      }

      if (existing) {
        existing.lastSeenAt = new Date();
        if (label) existing.label = label;
        await existing.save();
        return res.json({ ok: true, device: existing, maxDevices, alreadyRegistered: true, subscription: entitlements.subscription });
      }

      const count = await Device.countDocuments({ businessId });
      if (count >= maxDevices) {
        return res.status(403).json({
          error: `Device limit reached for this plan (${maxDevices} device${maxDevices === 1 ? "" : "s"}). Ask your account admin to remove a device, or upgrade your plan.`,
          code: "DEVICE_LIMIT_REACHED",
          maxDevices,
          currentCount: count,
        });
      }

      const device = await Device.findOneAndUpdate(
        { id: deviceId, businessId },
        {
          $setOnInsert: { id: deviceId, businessId, firstSeenAt: new Date() },
          $set: { lastSeenAt: new Date(), label: label || "Unnamed device" },
        },
        { upsert: true, new: true, runValidators: true }
      );

      io.to(`company_${businessId}`).emit("DEVICE_EVENT", { action: "register", device });
      res.status(201).json({ ok: true, device, maxDevices, subscription: entitlements.subscription });
    } catch (err) {
      if (err.code === 11000) return res.status(409).json({ error: "Device is already registered." });
      next(err);
    }
  });

  router.get("/", async (req, res, next) => {
    try {
      const { businessId } = req.query;
      if (!businessId) return res.status(400).json({ error: "businessId is required" });
      if (businessId !== req.user.businessId) return res.status(403).json({ error: "You are not a member of this business" });

      const [devices, business] = await Promise.all([
        Device.find({ businessId }).sort({ firstSeenAt: 1 }).lean(),
        ensureSubscription(businessId),
      ]);

      const entitlements = getEntitlements(business);
      res.json({
        businessId,
        devices,
        maxDevices: entitlements.maxDevices,
        trial: entitlements.trial,
        paid: entitlements.paid,
        subscriptionStatus: entitlements.status,
        plan: { tier: entitlements.planTier, maxDevices: entitlements.maxDevices },
        billing: entitlements.subscription,
      });
    } catch (err) {
      next(err);
    }
  });

  router.delete("/:deviceId", requireOwnerOrAdmin, async (req, res, next) => {
    try {
      const { deviceId } = req.params;
      const { businessId } = req.body;
      if (!businessId) return res.status(400).json({ error: "businessId is required" });
      if (businessId !== req.user.businessId) return res.status(403).json({ error: "You cannot remove a device from another business" });

      const device = await Device.findOneAndDelete({ id: deviceId, businessId });
      if (!device) return res.status(404).json({ error: "Device not found" });

      io.to(`company_${businessId}`).emit("DEVICE_EVENT", { action: "remove", device });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = buildDevicesRouter;
