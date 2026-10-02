import dotenv from "dotenv";
dotenv.config();

import { bot } from "./bot.js";
import {
  listLinkedCompanyIds,
  listEntities,
  getNotificationsettings,
  notificationWasSent,
  recordNotificationAttempt,
} from "./db.js";
import { sendText, getEvolutionConnection } from "./whatsapp.js";
import { checkFeature } from "./entitlements.js";

const RUN_INTERVAL_MS = Number(process.env.REMINDER_CHECK_INTERVAL_MS || 60_000);
const DEFAULT_TIMEZONE = process.env.REMINDER_TIMEZONE || "Africa/Lagos";

function datePartsInTimeZone(date = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    iso: `${map.year}-${map.month}-${map.day}`,
  };
}

function daysDiff(dueDate, today) {
  const due = new Date(`${dueDate}T00:00:00Z`);
  const now = new Date(`${today}T00:00:00Z`);
  return Math.round((due - now) / 86_400_000);
}

function formatMoney(value) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 2,
  }).format(amount);
}

function buildReminder(deadline, reminderType, today) {
  const diff = daysDiff(deadline.dueDate, today);
  const title =
    deadline.title ||
    (deadline.type === "bill"
      ? "Bill due"
      : deadline.type === "debtor"
      ? "Collection due"
      : "Payment due");

  let lead;
  if (reminderType === "3_days") lead = "is due in 3 days";
  else if (reminderType === "1_day") lead = "is due tomorrow";
  else if (reminderType === "due") lead = "is due today";
  else lead = `is overdue by ${Math.max(1, Math.abs(diff))} ${
    Math.abs(diff) === 1 ? "day" : "days"
  }`;

  const lines = [`⏰ ${title} — ${lead}.`];

  if (deadline.partyName) lines.push(`Party: ${deadline.partyName}`);
  if (Number(deadline.amount)) lines.push(`Amount: ${formatMoney(deadline.amount)}`);
  lines.push(`Due: ${deadline.dueDate}`);
  if (deadline.note) lines.push(`Note: ${deadline.note}`);

  return lines.join("\n");
}

function reminderTypesFor(deadline, today, settings) {
  if (!deadline?.dueDate || deadline.status === "completed") return [];

  const diff = daysDiff(deadline.dueDate, today);
  const types = [];

  if (diff === 3 && settings.remind3Days) types.push("3_days");
  if (diff === 1 && settings.remind1Day) types.push("1_day");
  if (diff === 0 && settings.remindDue) types.push("due");
  if (diff < 0 && settings.remindOverdue) types.push("overdue");

  return types;
}

async function sendTelegram(companyId, body) {
  const result = { attempted: false, sent: false, reason: null };

  // Server-side hardstop — checked before delivery, not just hidden in
  // the dashboard's UI, so it can't be bypassed by anything that isn't
  // actually paying.
  const feature = await checkFeature(companyId, "telegram");
  if (!feature.ok) {
    result.reason = feature.message;
    return result;
  }

  const { listChatIdsForCompany } = await import("./db.js");
  const chatIds = await listChatIdsForCompany(companyId);

  if (!chatIds.length) {
    result.reason = "No Telegram chat linked to this business.";
    return result;
  }

  result.attempted = true;
  const failures = [];

  for (const chatId of chatIds) {
    try {
      await bot.telegram.sendMessage(chatId, body);
    } catch (err) {
      failures.push(err);
    }
  }

  result.sent = failures.length === 0;
  if (failures.length) {
    result.reason = failures[0]?.message || "Telegram send failed.";
  }

  return result;
}

async function sendWhatsApp(companyId, body, waNumber) {
  if (!waNumber) {
    return {
      attempted: false,
      sent: false,
      reason: "No notification WhatsApp number configured.",
    };
  }

  // Server-side hardstop, same reasoning as sendTelegram above.
  const feature = await checkFeature(companyId, "whatsapp");
  if (!feature.ok) {
    return { attempted: false, sent: false, reason: feature.message };
  }

  try {
    const connection = await getEvolutionConnection(companyId);
    if (connection.state !== "open") {
      return {
        attempted: false,
        sent: false,
        reason: `WhatsApp is not connected (state: ${connection.state}).`,
      };
    }

    await sendText(companyId, waNumber, body);

    return { attempted: true, sent: true, reason: null };
  } catch (err) {
    return {
      attempted: true,
      sent: false,
      reason: err?.message || "WhatsApp send failed.",
    };
  }
}

async function processCompany(companyId, now = new Date()) {
  // Reminders themselves need SOME active entitlement (trial, paid, or
  // grace) — not tied to a specific channel add-on. Skip the whole
  // company early if not, rather than doing all the deadline work first.
  const remindersFeature = await checkFeature(companyId, "reminders");
  if (!remindersFeature.ok) return;

  const settings = await getNotificationsettings(companyId);
  const { iso: today } = datePartsInTimeZone(now, settings.timezone || DEFAULT_TIMEZONE);

  const deadlines = await listEntities(companyId, "deadline");

  for (const deadline of deadlines) {
    for (const reminderType of reminderTypesFor(deadline, today, settings)) {
      const body = buildReminder(deadline, reminderType, today);

      if (settings.telegramEnabled) {
        const sent = await notificationWasSent({
          companyId,
          deadlineId: deadline.id,
          channel: "telegram",
          reminderType,
          scheduledDate: today,
        });

        if (!sent) {
          const result = await sendTelegram(companyId, body);

          await recordNotificationAttempt({
            companyId,
            deadlineId: deadline.id,
            channel: "telegram",
            reminderType,
            scheduledDate: today,
            status: result.sent ? "sent" : "failed",
            error: result.reason,
          });
        }
      }

      if (settings.whatsappEnabled) {
        const sent = await notificationWasSent({
          companyId,
          deadlineId: deadline.id,
          channel: "whatsapp",
          reminderType,
          scheduledDate: today,
        });

        if (!sent) {
          const result = await sendWhatsApp(
            companyId,
            body,
            settings.notificationWaNumber
          );

          await recordNotificationAttempt({
            companyId,
            deadlineId: deadline.id,
            channel: "whatsapp",
            reminderType,
            scheduledDate: today,
            status: result.sent ? "sent" : "failed",
            error: result.reason,
          });
        }
      }
    }
  }
}

let running = false;

export async function runReminderCheck() {
  if (running) return;
  running = true;

  try {
    const companies = await listLinkedCompanyIds();
    for (const companyId of companies) {
      try {
        await processCompany(companyId);
      } catch (err) {
        console.error(`[reminders] ${companyId} failed:`, err);
      }
    }
  } finally {
    running = false;
  }
}

export async function testReminderWorker() {
  await runReminderCheck();
  return { ok: true };
}

export function startReminderWorker() {
  void runReminderCheck();

  const timer = setInterval(() => {
    void runReminderCheck();
  }, RUN_INTERVAL_MS);

  timer.unref?.();

  console.log(
    `[reminders] worker started; interval=${RUN_INTERVAL_MS}ms`
  );

  return timer;
}