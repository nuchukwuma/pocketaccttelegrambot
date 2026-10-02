// src/deviceNudgeWorker.js
//
// Devices don't get their sync cursor advanced (and can't ack a durable
// catch-up, per the backend's Device.lastSyncedAt gating) unless the app
// actually gets opened. A device sitting untouched for a day is both an
// out-of-date local copy for that person AND, per the backend's pruning
// job, one more reason cleanup stays blocked for the whole business. This
// worker is the "hey, open the app" nudge — delivered over Telegram, so
// it reaches someone whether the app itself is running or not.
import dotenv from "dotenv";
dotenv.config();

import { bot } from "./bot.js";
import {
  listLinkedCompanyIds,
  listChatIdsForCompany,
  staleDeviceNotificationSent,
  recordStaleDeviceNotification,
} from "./db.js";
import { checkFeature } from "./entitlements.js";

const SERVER_URL = process.env.MAIN_APP_SERVER_URL || "http://localhost:5000";
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // "hasn't logged in for a day"
const CHECK_INTERVAL_MS = Number(process.env.DEVICE_NUDGE_CHECK_INTERVAL_MS || 60 * 60 * 1000); // hourly is plenty for a once-a-day nudge

function todayStr() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD, dedup key
}

async function fetchDevices(companyId) {
  const res = await fetch(
    `${SERVER_URL}/api/devices?businessId=${encodeURIComponent(companyId)}`,
    { headers: { "x-bot-api-key": process.env.BOT_API_KEY || "" } }
  );
  if (!res.ok) throw new Error(`Device list failed: ${res.status}`);
  const data = await res.json();
  return data.devices || [];
}

async function processCompany(companyId) {
  // Same paywall this business already agreed to for Telegram — a nudge
  // is still a Telegram message, so it follows the same entitlement rule
  // as every other Telegram-delivered notification.
  const feature = await checkFeature(companyId, "telegram");
  if (!feature.ok) return;

  const chatIds = await listChatIdsForCompany(companyId);
  if (!chatIds.length) return;

  let devices;
  try {
    devices = await fetchDevices(companyId);
  } catch (err) {
    console.error(`[${companyId}] failed to fetch devices for nudge check`, err);
    return;
  }

  const now = Date.now();
  const today = todayStr();

  for (const device of devices) {
    const lastSeenAt = device.lastSeenAt ? new Date(device.lastSeenAt).getTime() : null;
    if (!lastSeenAt || now - lastSeenAt < STALE_THRESHOLD_MS) continue;

    const alreadySent = await staleDeviceNotificationSent(companyId, device.id, today);
    if (alreadySent) continue;

    const hoursSince = Math.floor((now - lastSeenAt) / (60 * 60 * 1000));
    const label = device.label || "A device";
    const body =
      `📱 ${label} hasn't opened PocketAccountant in over ${hoursSince >= 48 ? Math.floor(hoursSince / 24) + " days" : "a day"}.\n\n` +
      `Open the app on that device so it can catch up on the latest records.`;

    for (const chatId of chatIds) {
      try {
        await bot.telegram.sendMessage(chatId, body);
      } catch (err) {
        console.error(`[${companyId}] failed to send stale-device nudge to chat ${chatId}`, err);
      }
    }

    await recordStaleDeviceNotification(companyId, device.id, today);
  }
}

let running = false;

export async function runDeviceNudgeCheck() {
  if (running) return;
  running = true;
  try {
    const companyIds = await listLinkedCompanyIds();
    for (const companyId of companyIds) {
      try {
        await processCompany(companyId);
      } catch (err) {
        console.error(`[${companyId}] device nudge check failed`, err);
      }
    }
  } finally {
    running = false;
  }
}

export function startDeviceNudgeWorker() {
  void runDeviceNudgeCheck();

  const timer = setInterval(() => {
    void runDeviceNudgeCheck();
  }, CHECK_INTERVAL_MS);

  timer.unref?.();

  console.log(`[device-nudge] worker started; interval=${CHECK_INTERVAL_MS}ms, threshold=${STALE_THRESHOLD_MS}ms`);
}
