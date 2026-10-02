import dotenv from "dotenv";
dotenv.config();

import crypto from "crypto";
import { bot } from "./bot.js";
import { fetchBusiness } from "./business.js";
import {
  listLinkedCompanyIds,
  listChatIdsForCompany,
  listEntities,
  getMonthlyStatement,
  saveMonthlyStatement,
  statementDeliveryExists,
  recordStatementDelivery,
  getNotificationsettings,
} from "./db.js";
import { getEvolutionConnection, sendDocument } from "./whatsapp.js";
import {
  buildPostings,
  buildAccounts,
  computeCashBank,
  computeDebtorsCreditors,
  computePnl,
} from "./ledger.js";
import { buildBalanceReportPdf } from "./whatsappPdf.js";

const CHECK_INTERVAL_MS = Number(process.env.STATEMENT_CHECK_INTERVAL_MS || 60_000);
const TIMEZONE = process.env.STATEMENT_TIMEZONE || "Africa/Lagos";

function zonedParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
  };
}

function previousMonthRange(now = new Date()) {
  const { year, month, day } = zonedParts(now);

  // Generate once on the first day of the new month.
  if (day !== 1) return null;

  const currentMonthStart = new Date(Date.UTC(year, month - 1, 1));
  const previousMonthStart = new Date(Date.UTC(year, month - 2, 1));
  const previousMonthEnd = new Date(Date.UTC(year, month - 1, 0));

  const iso = (d) => d.toISOString().slice(0, 10);

  return {
    start: iso(previousMonthStart),
    end: iso(previousMonthEnd),
    currentMonthKey: iso(currentMonthStart),
  };
}

function inPeriod(date, start, end) {
  return Boolean(date && date >= start && date <= end);
}

async function buildStatement(companyId, period) {
  const existing = await getMonthlyStatement(companyId, period.start, period.end);
  if (existing) return existing;

  const [business, transactions, settlements] = await Promise.all([
    fetchBusiness(companyId),
    listEntities(companyId, "transaction"),
    listEntities(companyId, "settlement"),
  ]);

  const periodTransactions = transactions.filter((t) =>
    inPeriod(t.date, period.start, period.end)
  );
  const periodSettlements = settlements.filter((s) =>
    inPeriod(s.date, period.start, period.end)
  );

  const accounts = buildAccounts(
    buildPostings(periodTransactions, periodSettlements)
  );
  const { cash, bank, pettyCash } = computeCashBank(accounts);
  const { debtors, creditors } = computeDebtorsCreditors(accounts);
  const pnl = computePnl(accounts);

  // Reuse the existing PDF reporting infrastructure.
  // This creates a period-end financial statement PDF for the business.
  const pdf = await buildBalanceReportPdf(business, {
    cash,
    bank,
    pettyCash,
    debtors,
    creditors,
    netProfit: pnl.netProfit,
  });

  const statement = {
    id: crypto.randomUUID(),
    companyId,
    periodStart: period.start,
    periodEnd: period.end,
    status: "ready",
    generatedAt: new Date().toISOString(),
    openingBalance: 0,
    totalSales: pnl.sales || 0,
    totalPurchases: pnl.purchases || 0,
    totalExpenses: pnl.totalExpenses || 0,
    totalDebtors: debtors.reduce((sum, d) => sum + Number(d.balance || 0), 0),
    totalCreditors: creditors.reduce((sum, c) => sum + Number(c.balance || 0), 0),
    netProfit: pnl.netProfit || 0,
    payload: {
      title: `Monthly Statement — ${period.start} to ${period.end}`,
      filename: `Statement-${period.start}-to-${period.end}.pdf`,
      pdfBase64: pdf.toString("base64"),
      cash,
      bank,
      pettyCash,
      debtors,
      creditors,
      netProfit: pnl.netProfit || 0,
      sales: pnl.sales || 0,
      purchases: pnl.purchases || 0,
      totalExpenses: pnl.totalExpenses || 0,
    },
  };

  return saveMonthlyStatement(statement);
}

function textSummary(statement) {
  return [
    `📊 Monthly statement — ${statement.periodStart} to ${statement.periodEnd}`,
    "",
    `Sales: ${Number(statement.totalSales || 0).toLocaleString()}`,
    `Expenses: ${Number(statement.totalExpenses || 0).toLocaleString()}`,
    `Net profit: ${Number(statement.netProfit || 0).toLocaleString()}`,
    `Debtors: ${Number(statement.totalDebtors || 0).toLocaleString()}`,
    `Creditors: ${Number(statement.totalCreditors || 0).toLocaleString()}`,
    "",
    "Your full statement is attached.",
  ].join("\n");
}

async function deliverTelegram(statement) {
  const chats = await listChatIdsForCompany(statement.companyId);
  if (!chats.length) return;

  const caption = textSummary(statement);

  for (const chatId of chats) {
    const recipient = String(chatId);
    if (await statementDeliveryExists(statement.id, "telegram", recipient)) {
      continue;
    }

    try {
      await bot.telegram.sendDocument(
        chatId,
        {
          source: Buffer.from(statement.payload.pdfBase64, "base64"),
          filename: statement.payload.filename,
        },
        { caption: caption.slice(0, 1024) }
      );

      await recordStatementDelivery({
        statementId: statement.id,
        companyId: statement.companyId,
        channel: "telegram",
        recipient,
        status: "sent",
      });
    } catch (err) {
      await recordStatementDelivery({
        statementId: statement.id,
        companyId: statement.companyId,
        channel: "telegram",
        recipient,
        status: "failed",
        error: err?.message || "Telegram send failed",
      });
    }
  }
}

async function deliverWhatsApp(statement) {
  const settings = await getNotificationsettings(statement.companyId).catch(() => null);
  const recipient = settings?.notificationWaNumber;
  if (!recipient) return;

  const connection = await getEvolutionConnection(statement.companyId).catch(() => null);
  if (connection?.state !== "open") return;

  if (await statementDeliveryExists(statement.id, "whatsapp", recipient)) {
    return;
  }

  try {
    await sendDocument(
      statement.companyId,
      recipient,
      Buffer.from(statement.payload.pdfBase64, "base64"),
      "application/pdf",
      statement.payload.filename,
      textSummary(statement)
    );

    await recordStatementDelivery({
      statementId: statement.id,
      companyId: statement.companyId,
      channel: "whatsapp",
      recipient,
      status: "sent",
    });
  } catch (err) {
    await recordStatementDelivery({
      statementId: statement.id,
      companyId: statement.companyId,
      channel: "whatsapp",
      recipient,
      status: "failed",
      error: err?.message || "WhatsApp send failed",
    });
  }
}

export async function runMonthlyStatementCheck(now = new Date()) {
  const period = previousMonthRange(now);
  if (!period) return { generated: 0 };

  let generated = 0;
  const companyIds = await listLinkedCompanyIds();

  for (const companyId of companyIds) {
    try {
      const before = await getMonthlyStatement(companyId, period.start, period.end);
      const statement = await buildStatement(companyId, period);
      if (!before) generated += 1;

      // Automatic delivery is best-effort and de-duplicated.
      await deliverTelegram(statement);
      await deliverWhatsApp(statement);
    } catch (err) {
      console.error(
        `[statements] ${companyId} failed for ${period.start}..${period.end}:`,
        err
      );
    }
  }

  return { generated };
}

export function startMonthlyStatementWorker() {
  const interval = setInterval(() => {
    void runMonthlyStatementCheck();
  }, CHECK_INTERVAL_MS);

  interval.unref?.();
  void runMonthlyStatementCheck();

  console.log(
    `[statements] monthly worker started; interval=${CHECK_INTERVAL_MS}ms; timezone=${TIMEZONE}`
  );

  return interval;
}
