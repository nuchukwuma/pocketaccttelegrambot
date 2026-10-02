// routes/aiChat.js
const express = require("express");
const {
  handleMessage,
  confirmPending,
  cancelPending,
  getAiStatus,
} = require("../ai/agent");
const { hasCurrentConsent } = require("../services/consents");

// The app asks before the first question (src/assets/legal/ConsentGate);
// this is the check that cannot be skipped by calling the API directly.
async function requireAiConsent(req, res, next) {
  try {
    if (await hasCurrentConsent(req.user.id, "ai")) return next();
    res.status(403).json({
      text: "Before using the assistant, read and accept how it handles your data (Settings → Privacy).",
      code: "CONSENT_REQUIRED",
      purpose: "ai",
    });
  } catch (err) { next(err); }
}

function buildAiChatRouter(io) {
  const router = express.Router();

  function sessionKey(req) {
    return `${req.user.businessId}:${req.user.id}`;
  }

  router.get("/status", async (req, res, next) => {
    try {
      const status = await getAiStatus(req.user.businessId);
      res.json({ ok: true, ...status });
    } catch (err) {
      next(err);
    }
  });

  router.post("/chat", requireAiConsent, async (req, res) => {
    const message = String(req.body?.message || "").trim();

    if (!message) {
      return res.status(400).json({ error: "message is required" });
    }

    try {
      const result = await handleMessage(
        sessionKey(req),
        req.user.businessId,
        message,
        io
      );

      res.json(result);
    } catch (err) {
      console.error(`[ai] ${req.user.businessId}`, {
        code: err?.code,
        status: err?.status,
        provider: err?.provider,
        model: err?.model,
        message: err?.message,
        apiMessage: err?.apiMessage,
        stack: err?.stack,
      });

      const status =
        err?.code === "GEMINI_AUTH"
          ? 502
          : err?.code === "GEMINI_MODEL_NOT_FOUND"
          ? 502
          : err?.code === "GEMINI_RATE_LIMIT"
          ? 429
          : err?.code === "GEMINI_TEMPORARY"
          ? 503
          : 500;

      res.status(status).json({
        text:
          err?.code === "GEMINI_BAD_REQUEST"
            ? "Gemini rejected the request. I need to adjust the Free AI tool conversation format."
            : err?.message ||
              "Something went wrong understanding that — try rephrasing.",
        code: err?.code || "AI_ERROR",
      });
    }
  });

  router.post("/chat/confirm", requireAiConsent, async (req, res) => {
    try {
      const result = await confirmPending(
        sessionKey(req),
        req.user.businessId,
        io
      );

      res.json(result);
    } catch (err) {
      console.error(`[ai confirm] ${req.user.businessId}`, err);
      res.status(500).json({
        text: "Couldn't save that — try again in a moment.",
        code: err?.code || "AI_CONFIRM_ERROR",
      });
    }
  });

  router.post("/chat/cancel", async (req, res) => {
    try {
      const result = await cancelPending(sessionKey(req));
      res.json(result);
    } catch (err) {
      console.error(`[ai cancel] ${req.user.businessId}`, err);
      res.status(500).json({
        text: "Couldn't cancel — try again.",
        code: err?.code || "AI_CANCEL_ERROR",
      });
    }
  });

  return router;
}

module.exports = buildAiChatRouter;
