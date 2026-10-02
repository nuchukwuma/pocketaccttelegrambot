import express from "express";
import dotenv from "dotenv";
dotenv.config();

import {
  linkWhatsApp,
  unlinkWhatsApp,
  listWhatsAppLinksForCompany,
} from "./db.js";
import {
  ensureEvolutionInstance,
  getEvolutionConnection,
  getEvolutionQr,
  logoutEvolutionInstance,
  deleteEvolutionInstance,
  sendFileTo,
} from "./whatsapp.js";
import {
  buildInvoicePdf,
  buildBalanceReportPdf,
  buildInventoryReportPdf,
} from "./whatsappPdf.js";
import { getCompanyState } from "./companyData.js";
import {
  buildPostings,
  buildAccounts,
  computeCashBank,
  computeDebtorsCreditors,
  computePnl,
} from "./ledger.js";
import { fetchBusiness } from "./business.js";
import { checkFeature } from "./entitlements.js";

const SERVER_URL =
  process.env.MAIN_APP_SERVER_URL || "http://localhost:5000";

export const whatsappRouter = express.Router();

function requireApiKey(req, res, next) {
  const key = req.header("x-bot-api-key");

  if (!key || key !== process.env.BOT_API_KEY) {
    return res.status(401).json({ error: "unauthorized" });
  }

  next();
}

// Server-side hardstop for every route that actually uses the WhatsApp
// connection (connect/QR/disconnect/send-*), so it can't be bypassed by
// calling this API directly, whatever the dashboard shows. Deliberately
// NOT applied to /clients (managing recipient numbers) — that's just
// bookkeeping, not usage.
async function requireWhatsAppEntitlement(req, res, next) {
  const companyId = req.body?.companyId || req.query?.companyId;
  if (!companyId) return res.status(400).json({ error: "companyId is required" });

  const feature = await checkFeature(companyId, "whatsapp");
  if (!feature.ok) return res.status(402).json({ error: feature.message, code: "FEATURE_NOT_ENTITLED" });

  next();
}

function normalizeWaId(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return /^\d{8,15}$/.test(digits) ? digits : null;
}

async function assertBusinessExists(companyId) {
  const response = await fetch(
    `${SERVER_URL}/api/sync/business?companyId=${encodeURIComponent(companyId)}`,
    {
      headers: {
        "x-bot-api-key": process.env.BOT_API_KEY || "",
      },
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.business) {
    const error = new Error(
      response.ok ? "Unknown business" : "Main server business lookup failed"
    );
    error.status = response.ok ? 404 : 502;
    throw error;
  }

  return data.business;
}

async function sendToCompany(
  companyId,
  buffer,
  mimeType,
  filename,
  caption,
  recipientWaId = null
) {
  const clients = await listWhatsAppLinksForCompany(companyId);

  const recipients = recipientWaId
    ? clients.filter((client) => client.wa_id === recipientWaId)
    : clients;

  if (!recipients.length) {
    return {
      ok: false,
      error: recipientWaId
        ? "That WhatsApp client is not linked to this business."
        : "No WhatsApp clients are linked to this business yet.",
    };
  }

  const results = await Promise.allSettled(
    recipients.map((client) =>
      sendFileTo(
        companyId,
        client.wa_id,
        buffer,
        mimeType,
        filename,
        caption
      )
    )
  );

  const failed = results.filter((result) => result.status === "rejected");

  if (failed.length === results.length) {
    return {
      ok: false,
      error: failed[0].reason?.message || "Send failed",
    };
  }

  return {
    ok: true,
    sentTo: results.length - failed.length,
    failed: failed.length,
    recipients: recipients.map((client) => ({
      waId: client.wa_id,
      name: client.name,
    })),
  };
}

// ---------- Per-business Evolution connection ----------

whatsappRouter.post("/connect", requireApiKey, requireWhatsAppEntitlement, async (req, res) => {
  const { companyId } = req.body || {};

  if (!companyId || typeof companyId !== "string") {
    return res.status(400).json({ error: "companyId is required" });
  }

  try {
    await assertBusinessExists(companyId);

    const qrResult = await getEvolutionQr(companyId);
    const connection = await getEvolutionConnection(companyId);

    res.json({
      companyId,
      instanceName: qrResult.instanceName,
      state: connection.state || qrResult.state,
      qr: qrResult.qr,
      connected: (connection.state || qrResult.state) === "open",
    });
  } catch (err) {
    console.error(`[${companyId}] WhatsApp connect failed`, err);
    if (err.upstreamStatus === 429) {
      res.set("Retry-After", "20");
      return res.status(429).json({
        error: "WhatsApp is rate-limited right now — try again shortly.",
        code: "UPSTREAM_RATE_LIMITED",
      });
    }
    res.status(err.status || 502).json({
      error: err.message || "Couldn't start WhatsApp connection.",
    });
  }
});

whatsappRouter.get("/connect/status", requireApiKey, requireWhatsAppEntitlement, async (req, res) => {
  const { companyId } = req.query;

  if (!companyId || typeof companyId !== "string") {
    return res.status(400).json({ error: "companyId is required" });
  }

  try {
    const connection = await getEvolutionConnection(companyId);

    res.json({
      companyId,
      instanceName: connection.instance_name,
      state: connection.state,
      connected: connection.state === "open",
    });
  } catch (err) {
    console.error(`[${companyId}] WhatsApp status failed`, err);
    if (err.upstreamStatus === 429) {
      res.set("Retry-After", "15");
      return res.status(429).json({
        error: "WhatsApp connection check is rate-limited right now — try again shortly.",
        code: "UPSTREAM_RATE_LIMITED",
      });
    }
    res.status(502).json({
      error: err.message || "Couldn't read WhatsApp connection status.",
    });
  }
});

whatsappRouter.post("/connect/qr", requireApiKey, requireWhatsAppEntitlement, async (req, res) => {
  const { companyId } = req.body || {};

  if (!companyId || typeof companyId !== "string") {
    return res.status(400).json({ error: "companyId is required" });
  }

  try {
    await assertBusinessExists(companyId);
    const result = await getEvolutionQr(companyId);

    res.json({
      companyId,
      instanceName: result.instanceName,
      state: result.state,
      qr: result.qr,
      connected: result.state === "open",
    });
  } catch (err) {
    console.error(`[${companyId}] WhatsApp QR failed`, err);
    if (err.upstreamStatus === 429) {
      res.set("Retry-After", "20");
      return res.status(429).json({
        error: "WhatsApp QR generation is rate-limited right now — try again shortly.",
        code: "UPSTREAM_RATE_LIMITED",
      });
    }
    res.status(502).json({
      error: err.message || "Couldn't generate WhatsApp QR.",
    });
  }
});

whatsappRouter.post("/disconnect", requireApiKey, async (req, res) => {
  const { companyId } = req.body || {};

  if (!companyId || typeof companyId !== "string") {
    return res.status(400).json({ error: "companyId is required" });
  }

  try {
    const result = await logoutEvolutionInstance(companyId);
    res.json({ ok: true, result });
  } catch (err) {
    res.status(502).json({
      error: err.message || "Couldn't disconnect WhatsApp.",
    });
  }
});

whatsappRouter.delete("/connection", requireApiKey, async (req, res) => {
  const { companyId } = req.body || {};

  if (!companyId || typeof companyId !== "string") {
    return res.status(400).json({ error: "companyId is required" });
  }

  try {
    await deleteEvolutionInstance(companyId);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({
      error: err.message || "Couldn't delete WhatsApp connection.",
    });
  }
});

// ---------- Customer/client WhatsApp numbers (not gated — bookkeeping, not usage) ----------

whatsappRouter.get("/clients", requireApiKey, async (req, res) => {
  const { companyId } = req.query;

  if (!companyId || typeof companyId !== "string") {
    return res.status(400).json({ error: "companyId is required" });
  }

  const clients = await listWhatsAppLinksForCompany(companyId);

  res.json({
    companyId,
    clients,
  });
});

whatsappRouter.post("/clients", requireApiKey, async (req, res) => {
  const { companyId, waNumber, name } = req.body || {};

  if (!companyId || typeof companyId !== "string") {
    return res.status(400).json({ error: "companyId is required" });
  }

  const normalized = normalizeWaId(waNumber);

  if (!normalized) {
    return res.status(400).json({
      error: "Enter a valid WhatsApp number with country code, e.g. 2348012345678.",
    });
  }

  try {
    await assertBusinessExists(companyId);

    const client = await linkWhatsApp(
      normalized,
      companyId,
      name?.trim() || null
    );

    res.json({ ok: true, client });
  } catch (err) {
    res.status(err.status || 502).json({
      error: err.message || "Couldn't save WhatsApp client.",
    });
  }
});

whatsappRouter.delete("/clients/:waId", requireApiKey, async (req, res) => {
  const { companyId } = req.body || {};
  const waId = normalizeWaId(req.params.waId);

  if (!companyId || typeof companyId !== "string") {
    return res.status(400).json({ error: "companyId is required" });
  }

  if (!waId) {
    return res.status(400).json({ error: "Invalid WhatsApp number." });
  }

  await unlinkWhatsApp(companyId, waId);
  res.json({ ok: true });
});

// ---------- Sending documents ----------

whatsappRouter.post("/send-invoice", requireApiKey, requireWhatsAppEntitlement, async (req, res) => {
  const { companyId, invoice, waNumber } = req.body || {};

  if (!companyId || !invoice) {
    return res.status(400).json({
      error: "companyId and invoice are required",
    });
  }

  const recipientWaId = waNumber ? normalizeWaId(waNumber) : null;

  if (waNumber && !recipientWaId) {
    return res.status(400).json({ error: "Invalid waNumber." });
  }

  try {
    const business = await fetchBusiness(companyId);
    const buffer = await buildInvoicePdf(business, invoice);
    const filename = `Invoice-${invoice.invoiceNumber || Date.now()}.pdf`;

    const result = await sendToCompany(
      companyId,
      buffer,
      "application/pdf",
      filename,
      `Invoice ${invoice.invoiceNumber || ""}`.trim(),
      recipientWaId
    );

    if (!result.ok) return res.status(422).json(result);

    res.json(result);
  } catch (err) {
    console.error(`[${companyId}] send-invoice failed`, err);
    res.status(500).json({ error: err.message });
  }
});

whatsappRouter.post("/send-report", requireApiKey, requireWhatsAppEntitlement, async (req, res) => {
  const { companyId, reportType, waNumber } = req.body || {};

  if (!companyId || !reportType) {
    return res.status(400).json({
      error: "companyId and reportType are required",
    });
  }

  const recipientWaId = waNumber ? normalizeWaId(waNumber) : null;

  if (waNumber && !recipientWaId) {
    return res.status(400).json({ error: "Invalid waNumber." });
  }

  try {
    const [business, state] = await Promise.all([
      fetchBusiness(companyId),
      getCompanyState(companyId),
    ]);

    if (!state) {
      return res.status(422).json({
        error:
          "No data source available right now (live mode, nothing online).",
      });
    }

    let buffer;
    let filename;

    if (reportType === "balance") {
      const accounts = buildAccounts(
        buildPostings(state.transactions, state.settlements)
      );

      const { cash, bank, pettyCash } = computeCashBank(accounts);
      const { debtors, creditors } = computeDebtorsCreditors(accounts);
      const { netProfit } = computePnl(accounts);

      buffer = await buildBalanceReportPdf(business, {
        cash,
        bank,
        pettyCash,
        debtors,
        creditors,
        netProfit,
      });

      filename = `Balance-${new Date().toISOString().slice(0, 10)}.pdf`;
    } else if (reportType === "inventory") {
      buffer = await buildInventoryReportPdf(business, state.products);
      filename = `Inventory-${new Date().toISOString().slice(0, 10)}.pdf`;
    } else {
      return res.status(400).json({
        error: "reportType must be 'balance' or 'inventory'",
      });
    }

    const result = await sendToCompany(
      companyId,
      buffer,
      "application/pdf",
      filename,
      null,
      recipientWaId
    );

    if (!result.ok) return res.status(422).json(result);

    res.json(result);
  } catch (err) {
    console.error(`[${companyId}] send-report failed`, err);
    res.status(500).json({ error: err.message });
  }
});

whatsappRouter.post("/send-file", requireApiKey, requireWhatsAppEntitlement, async (req, res) => {
  const {
    companyId,
    filename,
    mimeType,
    base64,
    caption,
    waNumber,
  } = req.body || {};

  if (!companyId || !filename || !mimeType || !base64) {
    return res.status(400).json({
      error: "companyId, filename, mimeType, and base64 are required",
    });
  }

  const recipientWaId = waNumber ? normalizeWaId(waNumber) : null;

  if (waNumber && !recipientWaId) {
    return res.status(400).json({ error: "Invalid waNumber." });
  }

  try {
    const buffer = Buffer.from(base64, "base64");

    const result = await sendToCompany(
      companyId,
      buffer,
      mimeType,
      filename,
      caption,
      recipientWaId
    );

    if (!result.ok) return res.status(422).json(result);

    res.json(result);
  } catch (err) {
    console.error(`[${companyId}] send-file failed`, err);
    res.status(500).json({ error: err.message });
  }
});