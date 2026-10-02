// routes/hordemart.js — Mr Mouse's half of the HordeMart link.
// Contract: HordeMart's docs/integrations/mrmouse.md.
//
//   POST /api/integrations/hordemart/sso          { token }  → signed_in | consent_required
//   POST /api/integrations/hordemart/sso/confirm  { ticket, acceptTerms, termsVersion,
//                                                   acceptAppTerms, appTermsVersion }
//   POST /integrations/hordemart/sales            signed by HordeMart (raw body)
//
// HordeMart vouches for who the person is; Mr Mouse's own subscription
// rules still apply to what they can use. Nothing here bills anyone.
const express = require("express");
const crypto = require("crypto");
const User = require("../models/User");
const { UsedPass, SsoTicket, HordeMartLink, HordeMartSale } = require("../models/HordeMart");
const { CONSENT_VERSIONS } = require("../legal/versions");
const { verifyHordeMartPass, verifyBodySignature, newTicket } = require("../lib/hordemartSso");
const { limits } = require("../lib/rateLimit");
const { ssoExchangeSchema, ssoConfirmSchema, saleEventSchema, parseBody } = require("../validation/schemas");
const { createBusinessWithOwner, unusablePasswordHash, issueSession } = require("../services/accounts");
const { recordConsent, hasCurrentConsent, requestMeta } = require("../services/consents");
const { applySale, noteProductChange } = require("../services/hordemartStock");

const TICKET_TTL_MS = 10 * 60 * 1000;

const EXPIRED = "This link has expired. Open Mr Mouse again from your HordeMart dashboard.";
const ASK_OWNER =
  "Your store's owner hasn't added you to their Mr Mouse yet. Ask them to add you under Settings → Team using this email address, then try again.";

const hashTicket = (ticket) => crypto.createHash("sha256").update(ticket).digest("hex");
const hordemartRole = (claims) => (claims.role === "owner" ? "owner" : "staff");

async function claimPass(claims) {
  try {
    await UsedPass.create({ jti: claims.jti, expiresAt: new Date(claims.exp * 1000) });
    return true;
  } catch (err) {
    if (err?.code === 11000) return false;
    throw err;
  }
}

async function claimSale(siteId, orderNumber) {
  try {
    await HordeMartSale.create({ siteId, orderNumber });
    return true;
  } catch (err) {
    if (err?.code === 11000) return false;
    throw err;
  }
}

// Who this pass belongs to in Mr Mouse, if anyone yet: their link first
// (HordeMart's stable id), then — only because HordeMart confirmed the
// address — an account with the same email.
async function findExistingUser(claims) {
  const link = await HordeMartLink.findOne({ hordemartUserId: claims.sub }).lean();
  if (link) {
    const user = await User.findOne({ id: link.userId });
    if (user) return { user, link };
  }
  const user = await User.findOne({ email: claims.email.toLowerCase().trim() });
  return { user, link: null };
}

function buildHordeMartSsoRouter({ ssoSecret = () => process.env.HORDEMART_SSO_SECRET, now = () => Date.now() } = {}) {
  const router = express.Router();
  router.use(limits.hordemartSso);

  // 1. Exchange the 60-second pass at once.
  router.post("/sso", async (req, res, next) => {
    try {
      const secret = ssoSecret();
      if (!secret || secret.length < 32) {
        return res.status(503).json({ error: "Signing in from HordeMart isn't switched on yet." });
      }
      const body = parseBody(ssoExchangeSchema, req, res);
      if (!body) return;

      const claims = verifyHordeMartPass(body.token, secret, now());
      if (!claims) return res.status(401).json({ error: EXPIRED });
      if (!(await claimPass(claims))) {
        return res.status(401).json({ error: "This link has already been used. Open Mr Mouse again from your HordeMart dashboard." });
      }
      if (claims.email_verified !== true) return res.status(403).json({ error: "Confirm your email address in HordeMart first." });

      const { user, link } = await findExistingUser(claims);

      // Linked before, agreed to the current text, consent not withdrawn: straight in.
      if (
        user &&
        link &&
        link.termsVersion === CONSENT_VERSIONS.hordemart &&
        user.businessId === link.businessId &&
        (await hasCurrentConsent(user.id, "hordemart"))
      ) {
        await HordeMartLink.updateOne(
          { _id: link._id },
          {
            $set: {
              siteId: claims.site.id,
              siteSlug: claims.site.slug || "",
              siteName: claims.site.name || "",
              hordemartRole: hordemartRole(claims),
              stockSyncPausedUntil: null,
              updatedAt: new Date(now()),
            },
          }
        );
        if (hordemartRole(claims) === "owner") noteProductChange(user.businessId);
        return res.json({ status: "signed_in", ...issueSession(user, res) });
      }

      // Staff get no new business of their own: their owner adds them first.
      if (!user && hordemartRole(claims) !== "owner") return res.status(403).json({ error: ASK_OWNER });

      // Otherwise a short-lived ticket, so reading the terms can take as long as it takes.
      const ticket = newTicket();
      await SsoTicket.create({ ticketHash: hashTicket(ticket), claims, expiresAt: new Date(now() + TICKET_TTL_MS) });
      return res.json({
        status: "consent_required",
        ticket,
        profile: { name: claims.name || "", email: claims.email, storeName: claims.site.name || "" },
        termsVersion: CONSENT_VERSIONS.hordemart,
        appTermsVersion: CONSENT_VERSIONS.terms,
        existingAccount: Boolean(user),
      });
    } catch (err) { next(err); }
  });

  // 2. They agreed: link (or create) the account and sign in.
  router.post("/sso/confirm", async (req, res, next) => {
    try {
      const body = parseBody(ssoConfirmSchema, req, res);
      if (!body) return;

      const row = await SsoTicket.findOneAndDelete({
        ticketHash: hashTicket(body.ticket),
        expiresAt: { $gt: new Date(now()) },
      }).lean();
      if (!row) return res.status(401).json({ error: EXPIRED });
      const claims = row.claims;

      let { user } = await findExistingUser(claims);
      if (!user) {
        if (hordemartRole(claims) !== "owner") return res.status(403).json({ error: ASK_OWNER });
        ({ user } = await createBusinessWithOwner({
          email: claims.email.toLowerCase().trim(),
          name: String(claims.name || claims.email.split("@")[0]).trim().slice(0, 120),
          passwordHash: await unusablePasswordHash(),
          business: { businessName: String(claims.site.name || "My business").trim().slice(0, 200) },
        }));
      }

      const role = hordemartRole(claims);
      await HordeMartLink.findOneAndUpdate(
        { hordemartUserId: claims.sub },
        {
          $set: {
            userId: user.id,
            businessId: user.businessId,
            siteId: claims.site.id,
            siteSlug: claims.site.slug || "",
            siteName: claims.site.name || "",
            hordemartRole: role,
            termsVersion: CONSENT_VERSIONS.hordemart,
            stockSyncPausedUntil: null,
            updatedAt: new Date(now()),
          },
          $setOnInsert: { createdAt: new Date(now()) },
        },
        { upsert: true }
      );

      const meta = requestMeta(req);
      await recordConsent({ user, purpose: "hordemart", version: CONSENT_VERSIONS.hordemart, source: "hordemart", ...meta });
      await recordConsent({ user, purpose: "terms", version: CONSENT_VERSIONS.terms, source: "hordemart", ...meta });

      if (role === "owner") noteProductChange(user.businessId);
      return res.json({ status: "signed_in", ...issueSession(user, res) });
    } catch (err) { next(err); }
  });

  return router;
}

// 3. Sales from HordeMart: SKUs and quantities that left the shelf. Mount
// BEFORE express.json(): the signature covers the exact bytes sent.
function buildHordeMartSalesRouter(io, { webhookSecret = () => process.env.HORDEMART_WEBHOOK_SECRET, now = () => Date.now() } = {}) {
  const router = express.Router();

  router.post("/", express.raw({ type: "application/json", limit: "64kb" }), async (req, res, next) => {
    try {
      const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
      if (!verifyBodySignature(raw, req.get("x-hordemart-signature"), webhookSecret(), now())) {
        return res.status(401).json({ error: "bad signature" });
      }
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return res.status(422).json({ error: "bad body" });
      }
      const result = saleEventSchema.safeParse(parsed);
      if (!result.success) return res.status(422).json({ error: "bad body" });
      const event = result.data;

      // Delivered twice? Applied once.
      if (!(await claimSale(event.siteId, event.orderNumber))) return res.json({ ok: true, duplicate: true });
      try {
        const results = await applySale(io, event, { now: new Date(now()) });
        return res.json({ ok: true, results: results.map(({ applied, unknownSkus }) => ({ applied, unknownSkus })) });
      } catch (err) {
        // Not applied: forget the claim so a resend is not mistaken for a duplicate.
        await HordeMartSale.deleteOne({ siteId: event.siteId, orderNumber: event.orderNumber });
        throw err;
      }
    } catch (err) { next(err); }
  });

  return router;
}

module.exports = { buildHordeMartSsoRouter, buildHordeMartSalesRouter };
