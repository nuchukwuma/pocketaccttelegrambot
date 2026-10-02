// routes/users.js
const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const User = require("../models/User");
const Business = require("../models/Business");
const { ensureSubscription } = require("../services/subscriptionStore");
const { requireAuth, requireOwnerOrAdmin, requireSameOrigin, setSessionCookie, clearSessionCookie, createToken } = require("../auth");

const SALT_ROUNDS = 10;

function sanitize(userDoc) {
  const { passwordHash, _id, __v, ...rest } = userDoc.toObject ? userDoc.toObject() : userDoc;
  return rest;
}

function buildUsersRouter(io) {
  const router = express.Router();

  function broadcastUserEvent(businessId, action, user) {
    io.to(`company_${businessId}`).emit("USER_EVENT", { action, user });
  }

  // Public endpoint: creates a brand-new business and owner only.
  router.post("/", requireSameOrigin, async (req, res, next) => {
    try {
      const { email, name, password, business } = req.body;
      if (!email || !name || !password) {
        return res.status(400).json({ error: "email, name, password are required" });
      }

      const normalizedEmail = email.toLowerCase().trim();
      const existingUser = await User.findOne({ email: normalizedEmail });
      if (existingUser) {
        return res.status(409).json({ error: "A user with this email already exists" });
      }

      if (!business?.businessName) {
        return res.status(400).json({ error: "business.businessName is required to create a new company" });
      }

      let createdBusiness = null;
      const resolvedBusinessId = crypto.randomUUID();
      const now = new Date();
      const trialEndsAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      createdBusiness = await Business.create({
        id: resolvedBusinessId,
        companyId: resolvedBusinessId,
        businessName: business.businessName,
        cac: business.cac || "",
        location: business.location || "",
        contact: business.contact || "",
        industry: business.industry || "",
        email: business.email || normalizedEmail,
        plan: { tier: "solo", maxDevices: 1 },
        billing: {
          status: "trialing",
          trialStartsAt: now,
          trialEndsAt,
          planTier: "solo",
          seats: 1,
          addons: { telegram: false, whatsapp: false },
        },
      });

      const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
      const user = await User.create({
        id: crypto.randomUUID(),
        email: normalizedEmail,
        name: name.trim(),
        passwordHash,
        businessId: resolvedBusinessId,
        role: "owner",
      });

      if (createdBusiness) {
        createdBusiness = await ensureSubscription(resolvedBusinessId);
      }

      const cleanUser = sanitize(user);
      broadcastUserEvent(resolvedBusinessId, "create", cleanUser);

      const token = createToken(cleanUser);
      setSessionCookie(res, cleanUser);
      res.status(201).json({
        ok: true,
        user: cleanUser,
        token,
        business: createdBusiness ? createdBusiness.toObject() : undefined,
      });
    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({
          error: "A user or business with this identifier already exists.",
        });
      }
      next(err);
    }
  });

  router.post("/login", requireSameOrigin, async (req, res, next) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: "email and password are required" });
      }

      const user = await User.findOne({ email: email.toLowerCase().trim() }).select("+passwordHash");
      if (!user) return res.status(401).json({ error: "Invalid email or password" });

      const match = await bcrypt.compare(password, user.passwordHash);
      if (!match) return res.status(401).json({ error: "Invalid email or password" });

      const cleanUser = sanitize(user);
      const token = createToken(cleanUser);
      setSessionCookie(res, cleanUser);
      res.json({ ok: true, user: cleanUser, token });
    } catch (err) {
      next(err);
    }
  });

  router.get("/me", requireAuth, async (req, res) => {
    res.json({ ok: true, user: sanitize(req.user) });
  });

  router.post("/logout", requireSameOrigin, async (_req, res) => {
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  // Inviting a teammate is authenticated and restricted to the same business.
  router.post("/invite", requireAuth, requireSameOrigin, requireOwnerOrAdmin, async (req, res, next) => {
    try {
      const { email, name, password, businessId, role } = req.body;
      if (!email || !name || !password || !businessId) {
        return res.status(400).json({ error: "email, name, password and businessId are required" });
      }
      if (businessId !== req.user.businessId) return res.status(403).json({ error: "You cannot invite users to another business" });
      const normalizedEmail = email.toLowerCase().trim();
      if (await User.findOne({ email: normalizedEmail })) return res.status(409).json({ error: "A user with this email already exists" });

      const allowedRole = ["admin", "staff", "accountant"].includes(role) ? role : "staff";
      const user = await User.create({
        id: crypto.randomUUID(),
        email: normalizedEmail,
        name: name.trim(),
        passwordHash: await bcrypt.hash(password, SALT_ROUNDS),
        businessId: req.user.businessId,
        role: allowedRole,
      });
      const cleanUser = sanitize(user);
      broadcastUserEvent(req.user.businessId, "create", cleanUser);
      res.status(201).json({ ok: true, user: cleanUser });
    } catch (err) { next(err); }
  });

  router.get("/", requireAuth, async (req, res, next) => {
    try {
      const { businessId } = req.query;
      if (!businessId) return res.status(400).json({ error: "businessId is required" });
      if (businessId !== req.user.businessId) return res.status(403).json({ error: "You are not a member of this business" });
      const users = await User.find({ businessId }).lean();
      res.json({ businessId, users: users.map((u) => sanitize(u)) });
    } catch (err) {
      next(err);
    }
  });

  router.patch("/:id", requireAuth, requireSameOrigin, requireOwnerOrAdmin, async (req, res, next) => {
    try {
      const { id } = req.params;
      const target = await User.findOne({ id });
      if (!target) return res.status(404).json({ error: "User not found" });
      if (target.businessId !== req.user.businessId) return res.status(403).json({ error: "You cannot modify users in another business" });
      const { name, role, email, password } = req.body;
      if (target.role === "owner" && target.id !== req.user.id) {
        return res.status(403).json({ error: "The business owner cannot be modified by another user" });
      }
      if (role && !["admin", "staff", "accountant"].includes(role) && role !== "owner") {
        return res.status(400).json({ error: "Invalid role" });
      }
      if (role === "owner" && req.user.role !== "owner") {
        return res.status(403).json({ error: "Only the owner can assign owner role" });
      }
      const updates = { updatedAt: new Date() };
      if (name) updates.name = name.trim();
      if (role) updates.role = role;
      if (email) updates.email = email.toLowerCase().trim();
      if (password) updates.passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

      const user = await User.findOneAndUpdate({ id }, { $set: updates }, { new: true });
      if (!user) return res.status(404).json({ error: "User not found" });

      const clean = sanitize(user);
      broadcastUserEvent(user.businessId, "update", clean);
      res.json({ ok: true, user: clean });
    } catch (err) {
      if (err.code === 11000) return res.status(409).json({ error: "Email already in use." });
      next(err);
    }
  });

  return router;
}

module.exports = buildUsersRouter;
