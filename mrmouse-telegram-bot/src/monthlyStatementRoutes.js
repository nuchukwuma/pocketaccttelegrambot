import express from "express";
import {
  listMonthlyStatements,
  getMonthlyStatement,
  statementDeliveryExists,
  recordStatementDelivery,
  listChatIdsForCompany,
  getNotificationsettings,
} from "./db.js";
import { bot } from "./bot.js";
import { getEvolutionConnection, sendDocument } from "./whatsapp.js";

export const monthlyStatementRouter = express.Router();

function requireApiKey(req, res, next) {
  const key = req.header("x-bot-api-key");
  if (!key || key !== process.env.BOT_API_KEY) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

monthlyStatementRouter.get("/list", requireApiKey, async (req, res) => {
  const { companyId, limit } = req.query;
  if (!companyId) return res.status(400).json({ error: "companyId is required" });

  const rows = await listMonthlyStatements(companyId, Math.min(Number(limit) || 12, 24));
  res.json(
    rows.map((row) => ({
      id: row.id,
      companyId: row.company_id,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      status: row.status,
      generatedAt: row.generated_at,
      openingBalance: Number(row.opening_balance || 0),
      totalSales: Number(row.total_sales || 0),
      totalPurchases: Number(row.total_purchases || 0),
      totalExpenses: Number(row.total_expenses || 0),
      totalDebtors: Number(row.total_debtors || 0),
      totalCreditors: Number(row.total_creditors || 0),
      netProfit: Number(row.net_profit || 0),
      title: row.payload?.title || `Monthly Statement — ${row.period_start} to ${row.period_end}`,
    }))
  );
});

monthlyStatementRouter.get("/:id", requireApiKey, async (req, res) => {
  const { companyId } = req.query;
  if (!companyId) return res.status(400).json({ error: "companyId is required" });

  const rows = await listMonthlyStatements(companyId, 24);
  const statement = rows.find((row) => row.id === req.params.id);
  if (!statement) return res.status(404).json({ error: "Statement not found" });

  res.json(statement);
});

monthlyStatementRouter.post("/send", requireApiKey, async (req, res) => {
  const { companyId, statementId, channel } = req.body || {};

  if (!companyId || !statementId || !["telegram", "whatsapp"].includes(channel)) {
    return res.status(400).json({
      error: "companyId, statementId and channel are required",
    });
  }

  const statements = await listMonthlyStatements(companyId, 24);
  const statement = statements.find((row) => row.id === statementId);
  if (!statement) return res.status(404).json({ error: "Statement not found" });

  const payload = statement.payload || {};
  const caption = `📊 ${payload.title || "Monthly statement"}\n\nNet profit: ${Number(statement.net_profit || 0).toLocaleString()}`;
  const pdf = Buffer.from(payload.pdfBase64, "base64");

  if (channel === "telegram") {
    const chats = await listChatIdsForCompany(companyId);
    if (!chats.length) {
      return res.status(422).json({ error: "No Telegram chat linked to this business." });
    }

    const results = [];
    for (const chatId of chats) {
      const recipient = String(chatId);
      if (await statementDeliveryExists(statementId, "telegram", recipient)) continue;

      try {
        await bot.telegram.sendDocument(
          chatId,
          { source: pdf, filename: payload.filename || "statement.pdf" },
          { caption: caption.slice(0, 1024) }
        );
        await recordStatementDelivery({
          statementId,
          companyId,
          channel,
          recipient,
          status: "sent",
        });
        results.push({ recipient, ok: true });
      } catch (err) {
        await recordStatementDelivery({
          statementId,
          companyId,
          channel,
          recipient,
          status: "failed",
          error: err?.message || "Telegram send failed",
        });
        results.push({ recipient, ok: false, error: err?.message });
      }
    }
    return res.json({ ok: results.some((r) => r.ok), results });
  }

  const settings = await getNotificationsettings(companyId);
  const recipient = settings.notificationWaNumber;
  if (!recipient) {
    return res.status(422).json({
      error: "No WhatsApp notification number is configured.",
    });
  }

  const connection = await getEvolutionConnection(companyId);
  if (connection?.state !== "open") {
    return res.status(422).json({
      error: `WhatsApp is not connected (state: ${connection?.state || "unknown"}).`,
    });
  }

  if (await statementDeliveryExists(statementId, "whatsapp", recipient)) {
    return res.json({ ok: true, alreadySent: true });
  }

  try {
    await sendDocument(
      companyId,
      recipient,
      pdf,
      "application/pdf",
      payload.filename || "statement.pdf",
      caption
    );

    await recordStatementDelivery({
      statementId,
      companyId,
      channel,
      recipient,
      status: "sent",
    });

    res.json({ ok: true });
  } catch (err) {
    await recordStatementDelivery({
      statementId,
      companyId,
      channel,
      recipient,
      status: "failed",
      error: err?.message || "WhatsApp send failed",
    });

    res.status(502).json({ error: err?.message || "WhatsApp send failed" });
  }
});
