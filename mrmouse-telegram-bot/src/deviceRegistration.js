// The bot connecting to a company is, functionally, another device reading
// and writing its data — so it should consume a seat under that business's
// plan (Business.plan via planTiers.js) exactly like a browser would,
// rather than being a free way around the device cap. This module talks to
// the real backend's POST /api/devices/register and DELETE /api/devices/:id.
import dotenv from "dotenv";
dotenv.config();
import { uid, getBotDeviceId, setBotDeviceId } from "./db.js";

const SERVER_URL = process.env.MAIN_APP_SERVER_URL || "http://localhost:5000";

async function ensureBotDeviceId(companyId) {
  let deviceId = await getBotDeviceId(companyId);
  if (!deviceId) {
    deviceId = uid();
    await setBotDeviceId(companyId, deviceId);
  }
  return deviceId;
}

// Call before linking a chat. Returns { ok: true, device, maxDevices } or
// { ok: false, code: 'DEVICE_LIMIT_REACHED', error, maxDevices } — the
// error message is already phrased for a human (comes straight from
// routes/devices.js), so it's safe to relay directly to the Telegram user.
export async function registerBotDevice(companyId) {
  const deviceId = await ensureBotDeviceId(companyId);
  try {
    const res = await fetch(`${SERVER_URL}/api/devices/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-bot-api-key": process.env.BOT_API_KEY || "",
      },
      body: JSON.stringify({ businessId: companyId, deviceId, label: "Telegram bot" }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, status: res.status, code: data.code, error: data.error || "Registration failed" };
    }
    return { ok: true, device: data.device, maxDevices: data.maxDevices };
  } catch (err) {
    console.error(`[${companyId}] device registration failed`, err);
    return { ok: false, error: "Couldn't reach the main server to register the device." };
  }
}

// Frees the seat. Called when the last chat for a company unlinks, or when
// the bot needs to clean up after being removed from the devices list.
export async function unregisterBotDevice(companyId) {
  const deviceId = await getBotDeviceId(companyId);
  if (!deviceId) return { ok: true };
  try {
    const res = await fetch(`${SERVER_URL}/api/devices/${deviceId}`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        "x-bot-api-key": process.env.BOT_API_KEY || "",
      },
      body: JSON.stringify({ businessId: companyId }),
    });
    if (!res.ok && res.status !== 404) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, error: data.error };
    }
    return { ok: true };
  } catch (err) {
    console.error(`[${companyId}] device unregister failed`, err);
    return { ok: false, error: "network_error" };
  }
}
