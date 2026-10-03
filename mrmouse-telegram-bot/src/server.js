import express from "express";
import cors from "cors";
import dotenv from "dotenv";
dotenv.config();

import {
  createPairingCode,
  getNotificationsettings,
  saveNotificationsettings,
  unlinkChatsForCompany,
} from "./db.js";
import { requireCompanyUser } from "./appAuth.js";
import { whatsappRouter } from "./whatsappRoutes.js";
import { monthlyStatementRouter } from "./monthlyStatementRoutes.js";

const SERVER_URL =
  process.env.MAIN_APP_SERVER_URL || "http://localhost:5000";

const app = express();

// Allowed origins array to handle local dev, production web, and Electron desktop (file://)
const allowedOrigins = [
  process.env.FRONTEND_URL,
  "http://localhost:5173",
  "file://",
];

const corsOptions = {
  origin: (origin, callback) => {
    // Allow non-browser requests (!origin), listed origins, or wildcard (*) setting
    if (!origin || allowedOrigins.includes(origin) || process.env.FRONTEND_URL === "*") {
      return callback(null, true);
    }
    return callback(new Error("CORS policy error: Origin not allowed"));
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-bot-api-key"],
  credentials: true,
};

app.use(cors(corsOptions));

// Invoices may carry the business's logo (a small JPEG, at most 60 KB);
// every other route keeps express's 100 KB default.
app.use("/api/whatsapp/send-invoice", express.json({ limit: "256kb" }));
app.use(express.json());


app.get("/health", (_req, res) => res.json({ ok: true }));

// Telegram pairing endpoint.
app.post("/api/pair/create", requireCompanyUser({ consent: "telegram" }), async (req, res) => {
  const { companyId } = req.body || {};

  if (!companyId || typeof companyId !== "string") {
    return res.status(400).json({ error: "companyId is required" });
  }

  try {
    const bizRes = await fetch(
      `${SERVER_URL}/api/sync/business?companyId=${encodeURIComponent(companyId)}`,
      {
        headers: {
          "x-bot-api-key": process.env.BOT_API_KEY || "",
        },
      }
    );

    const bizData = await bizRes.json().catch(() => ({}));

    if (!bizRes.ok || !bizData.business) {
      return res.status(bizRes.ok ? 404 : 502).json({
        error: bizRes.ok
          ? "Unknown business"
          : "Couldn't reach the main server to verify the business",
      });
    }
  } catch {
    return res.status(502).json({
      error: "Couldn't reach the main server to verify the business",
    });
  }

  const { code, expiresAt } = await createPairingCode(companyId);
  res.json({ code, expiresAt });
});

// Notification settings Endpoints
app.get("/api/notifications/settings", requireCompanyUser(), async (req, res) => {
  const { companyId } = req.query;

  if (!companyId) {
    return res.status(400).json({ error: "companyId is required" });
  }

  try {
    const settings = await getNotificationsettings(companyId);
    res.json(settings);
  } catch (err) {
    console.error("[notifications] settings GET failed", err);
    res.status(500).json({
      error: err.message || "Could not load notification settings.",
    });
  }
});

// Switching Telegram reminders on needs the Telegram agreement; switching off never does.
const requireTelegramIfEnabling = requireCompanyUser({
  consent: (req) => (req.body?.telegramEnabled === true ? "telegram" : null),
});

app.post("/api/notifications/settings", requireTelegramIfEnabling, async (req, res) => {
  const { companyId, ...settings } = req.body || {};

  if (!companyId) {
    return res.status(400).json({ error: "companyId is required" });
  }

  try {
    const saved = await saveNotificationsettings(companyId, settings);
    res.json(saved);
  } catch (err) {
    console.error("[notifications] settings POST failed", err);
    res.status(500).json({
      error: err.message || "Could not save notification settings.",
    });
  }
});

// Withdrawing the Telegram agreement (Settings → Privacy) unlinks every
// Telegram chat of the business, so nothing more is sent there.
app.post("/api/telegram/unlink", requireCompanyUser(), async (req, res) => {
  try {
    await unlinkChatsForCompany(req.body.companyId);
    res.json({ ok: true });
  } catch (err) {
    console.error("[telegram] unlink failed", err?.message);
    res.status(500).json({ error: "Could not unlink Telegram. Try again." });
  }
});

// WhatsApp now uses Evolution API.
// There is no Meta webhook dependency in the outbound-only flow.
app.use("/api/whatsapp", whatsappRouter);
app.use("/api/statements", monthlyStatementRouter);

export function startServer() {
  const port = Number(process.env.PORT) || 8787;

  app.listen(port, () => {
    console.log(`Pairing/WhatsApp API listening on :${port}`);
    console.log(`[entitlements] MAIN_APP_SERVER_URL = ${SERVER_URL}`);
  });
}