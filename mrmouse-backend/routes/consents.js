// routes/consents.js
//
//   GET    /api/consents            the signed-in user's current consents
//   POST   /api/consents            { purpose, version, accept: true }
//   DELETE /api/consents/:purpose   withdraw
//
// The server stamps who, when, IP and device, and only accepts the version
// it knows is current — a browser cannot be the record of its own consent.
const express = require("express");
const { CONSENT_VERSIONS } = require("../legal/versions");
const { consentSchema, parseBody } = require("../validation/schemas");
const { requestMeta, recordConsent, withdrawConsent, currentConsents } = require("../services/consents");
const { HordeMartLink } = require("../models/HordeMart");

function buildConsentsRouter() {
  const router = express.Router();

  router.get("/", async (req, res, next) => {
    try {
      res.json({ consents: await currentConsents(req.user.id), versions: CONSENT_VERSIONS });
    } catch (err) { next(err); }
  });

  router.post("/", async (req, res, next) => {
    try {
      const body = parseBody(consentSchema, req, res);
      if (!body) return;
      if (body.version !== CONSENT_VERSIONS[body.purpose]) {
        return res.status(409).json({
          error: "This text has been updated. Reload the page and read the latest version.",
          code: "CONSENT_VERSION_OUTDATED",
          version: CONSENT_VERSIONS[body.purpose],
        });
      }
      await recordConsent({ user: req.user, purpose: body.purpose, version: body.version, ...requestMeta(req) });
      res.status(201).json({ ok: true });
    } catch (err) { next(err); }
  });

  router.delete("/:purpose", async (req, res, next) => {
    try {
      const { purpose } = req.params;
      if (!(purpose in CONSENT_VERSIONS)) return res.status(404).json({ error: "Unknown consent" });
      if (purpose === "terms") {
        return res.status(422).json({ error: "The Terms can't be withdrawn here. To stop using Mr Mouse, ask us to close your account." });
      }
      await withdrawConsent({ user: req.user, purpose, ...requestMeta(req) });
      // HordeMart: unlinking is the whole of stopping it — no more sign-in
      // from HordeMart, stock pushes or sales for this person.
      if (purpose === "hordemart") await HordeMartLink.deleteMany({ userId: req.user.id });
      // Telegram and WhatsApp connections live on the bot server; the app
      // disconnects those itself after this succeeds (see PrivacySettings.jsx).
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  return router;
}

module.exports = buildConsentsRouter;
