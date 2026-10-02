// routes/users.js
const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const User = require("../models/User");
const { requireAuth, requireOwnerOrAdmin, requireSameOrigin, clearSessionCookie } = require("../auth");
const { CONSENT_VERSIONS } = require("../legal/versions");
const { limits } = require("../lib/rateLimit");
const { recordConsent, requestMeta } = require("../services/consents");
const {
  sanitizeUser: sanitize,
  hashPassword,
  createBusinessWithOwner,
  issueSession,
} = require("../services/accounts");
const { signupSchema, loginSchema, inviteSchema, userPatchSchema, parseBody } = require("../validation/schemas");

function buildUsersRouter(io) {
  const router = express.Router();

  function broadcastUserEvent(businessId, action, user) {
    io.to(`company_${businessId}`).emit("USER_EVENT", { action, user });
  }

  // Public endpoint: creates a brand-new business and owner only. The
  // person must tick the Terms box; the server records which version.
  router.post("/", requireSameOrigin, limits.signup, async (req, res, next) => {
    try {
      const body = parseBody(signupSchema, req, res);
      if (!body) return;

      if (await User.findOne({ email: body.email })) {
        return res.status(409).json({ error: "A user with this email already exists" });
      }

      const { user, business } = await createBusinessWithOwner({
        email: body.email,
        name: body.name,
        passwordHash: await hashPassword(body.password),
        business: body.business,
      });

      await recordConsent({
        user,
        purpose: "terms",
        version: CONSENT_VERSIONS.terms,
        source: "signup",
        ...requestMeta(req),
      });

      const session = issueSession(user, res);
      broadcastUserEvent(user.businessId, "create", session.user);
      res.status(201).json({
        ok: true,
        ...session,
        business: business ? (business.toObject ? business.toObject() : business) : undefined,
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

  router.post("/login", requireSameOrigin, limits.loginByIp, limits.loginByEmail, async (req, res, next) => {
    try {
      const body = parseBody(loginSchema, req, res);
      if (!body) return;

      const user = await User.findOne({ email: body.email }).select("+passwordHash");
      if (!user) return res.status(401).json({ error: "Invalid email or password" });

      const match = await bcrypt.compare(body.password, user.passwordHash);
      if (!match) return res.status(401).json({ error: "Invalid email or password" });

      res.json({ ok: true, ...issueSession(user, res) });
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
      const body = parseBody(inviteSchema, req, res);
      if (!body) return;
      const { email: normalizedEmail, name, password, businessId, role } = body;
      if (businessId !== req.user.businessId) return res.status(403).json({ error: "You cannot invite users to another business" });
      if (await User.findOne({ email: normalizedEmail })) return res.status(409).json({ error: "A user with this email already exists" });

      const allowedRole = role || "staff";
      const user = await User.create({
        id: crypto.randomUUID(),
        email: normalizedEmail,
        name,
        passwordHash: await hashPassword(password),
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
      const body = parseBody(userPatchSchema, req, res);
      if (!body) return;
      const { name, role, email, password } = body;
      if (target.role === "owner" && target.id !== req.user.id) {
        return res.status(403).json({ error: "The business owner cannot be modified by another user" });
      }
      if (role === "owner" && req.user.role !== "owner") {
        return res.status(403).json({ error: "Only the owner can assign owner role" });
      }
      const updates = { updatedAt: new Date() };
      if (name) updates.name = name;
      if (role) updates.role = role;
      if (email) updates.email = email;
      if (password) updates.passwordHash = await hashPassword(password);

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
