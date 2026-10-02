// WhatsApp transport through Evolution API.
// Evolution API owns the WhatsApp Web/Baileys sessions.
// This module never chooses a global sender instance: callers pass a
// business/companyId, and the instance mapping is stored in Turso.
import crypto from "crypto";
import dotenv from "dotenv";
dotenv.config();

import {
  getEvolutionInstance,
  saveEvolutionInstance,
  updateEvolutionInstanceStatus,
} from "./db.js";

const EVOLUTION_API_URL = (
  process.env.EVOLUTION_API_URL || "http://localhost:8080"
).replace(/\/+$/, "");

const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || "";

function assertConfigured() {
  if (!EVOLUTION_API_KEY) {
    throw new Error("EVOLUTION_API_KEY must be set in the bot .env");
  }
}

function normalizeWaId(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!/^\d{8,15}$/.test(digits)) {
    throw new Error("Invalid WhatsApp number. Use country code followed by digits only.");
  }
  return digits;
}

function safeInstancePart(companyId) {
  const cleaned = String(companyId || "")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 36);

  return cleaned || "business";
}

function newInstanceName(companyId) {
  return `mrmouse_${safeInstancePart(companyId)}_${crypto.randomBytes(4).toString("hex")}`;
}

async function evolutionRequest(path, options = {}) {
  assertConfigured();

  const response = await fetch(`${EVOLUTION_API_URL}${path}`, {
    ...options,
    headers: {
      apikey: EVOLUTION_API_KEY,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });

  const text = await response.text();

  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const detail =
      data?.response?.message?.[0] ||
      data?.message ||
      data?.error ||
      data?.raw ||
      response.statusText;

    const err = new Error(`Evolution API ${response.status}: ${detail}`);
    err.upstreamStatus = response.status;
    throw err;
  }

  return data;
}

function extractQr(data) {
  const candidate =
    data?.qrcode?.base64 ||
    data?.qrcode?.image ||
    data?.base64 ||
    data?.image ||
    null;

  if (!candidate || typeof candidate !== "string") return null;

  return candidate.startsWith("data:image")
    ? candidate
    : `data:image/png;base64,${candidate}`;
}

function extractState(data) {
  return (
    data?.instance?.state ||
    data?.instance?.status ||
    data?.state ||
    data?.status ||
    "unknown"
  );
}

export async function ensureEvolutionInstance(companyId) {
  assertConfigured();

  if (!companyId) throw new Error("companyId is required");

  const existing = await getEvolutionInstance(companyId);

  if (existing) {
    return existing;
  }

  const instanceName = newInstanceName(companyId);

  // Evolution can generate its own instance token. We store the token
  // returned by the API if present, while normal API calls use the server's
  // global key so the bot can manage all of its tenants.
  const created = await evolutionRequest("/instance/create", {
    method: "POST",
    body: JSON.stringify({
      instanceName,
      qrcode: true,
      integration: "WHATSAPP-BAILEYS",
    }),
  });

  const instanceToken =
    created?.hash?.apikey ||
    created?.apikey ||
    created?.token ||
    null;

  return saveEvolutionInstance(
    companyId,
    instanceName,
    instanceToken,
    "created"
  );
}

// The frontend polls /connect/status on an interval with no backoff of its
// own, and each poll used to trigger a brand-new call to Evolution's
// connectionState endpoint. Under polling, that's enough request volume to
// trip Evolution's own rate limiting (429). A cache on successful results
// alone doesn't help here: a *failing* call never populates it, so every
// poll during a rate-limited window still went straight back to Evolution,
// kept re-triggering the same 429, and never let it cool down. Caching the
// failure too (briefly, and separately from success) is what actually
// breaks that loop.
const CONNECTION_CACHE_TTL_MS = 8_000;
const ERROR_CACHE_TTL_MS = 15_000;
const connectionCache = new Map(); // companyId -> { data, expiresAt }
const errorCache = new Map(); // companyId -> { error, expiresAt }

export async function getEvolutionConnection(companyId, { fresh = false } = {}) {
  const cachedOk = connectionCache.get(companyId);
  if (!fresh && cachedOk && cachedOk.expiresAt > Date.now()) return cachedOk.data;

  const cachedErr = errorCache.get(companyId);
  if (!fresh && cachedErr && cachedErr.expiresAt > Date.now()) throw cachedErr.error;

  try {
    const account = await ensureEvolutionInstance(companyId);

    const data = await evolutionRequest(
      `/instance/connectionState/${encodeURIComponent(account.instance_name)}`
    );

    const state = extractState(data);
    const connectedAt =
      state === "open" && !account.connected_at
        ? new Date().toISOString()
        : undefined;

    const saved = await updateEvolutionInstanceStatus(
      companyId,
      state,
      connectedAt
    );

    const result = {
      ...saved,
      state,
    };

    connectionCache.set(companyId, {
      data: result,
      expiresAt: Date.now() + CONNECTION_CACHE_TTL_MS,
    });
    errorCache.delete(companyId);

    return result;
  } catch (err) {
    errorCache.set(companyId, {
      error: err,
      expiresAt: Date.now() + ERROR_CACHE_TTL_MS,
    });
    throw err;
  }
}

// A WhatsApp/Baileys QR code is typically valid for roughly 20-30 seconds
// before Evolution would issue a new one anyway. Without a cache here,
// every poll tick generated a brand new QR — which both hammered
// Evolution's rate limit (429s) AND made the QR practically unscannable,
// since it kept getting replaced before a phone camera could focus on it.
const QR_CACHE_TTL_MS = 20_000;
const QR_ERROR_CACHE_TTL_MS = 15_000;
const qrCache = new Map(); // companyId -> { data, expiresAt }
const qrErrorCache = new Map(); // companyId -> { error, expiresAt }

export async function getEvolutionQr(companyId, { fresh = false } = {}) {
  const cachedOk = qrCache.get(companyId);
  if (!fresh && cachedOk && cachedOk.expiresAt > Date.now()) return cachedOk.data;

  const cachedErr = qrErrorCache.get(companyId);
  if (!fresh && cachedErr && cachedErr.expiresAt > Date.now()) throw cachedErr.error;

  try {
    const account = await ensureEvolutionInstance(companyId);

    const data = await evolutionRequest(
      `/instance/connect/${encodeURIComponent(account.instance_name)}`
    );

    const state = extractState(data);
    const qr = extractQr(data);

    if (state === "open") {
      await updateEvolutionInstanceStatus(
        companyId,
        state,
        account.connected_at || new Date().toISOString()
      );
    } else {
      await updateEvolutionInstanceStatus(companyId, state);
    }

    const result = {
      companyId,
      instanceName: account.instance_name,
      state,
      qr,
      raw: data,
    };

    qrCache.set(companyId, { data: result, expiresAt: Date.now() + QR_CACHE_TTL_MS });
    qrErrorCache.delete(companyId);

    return result;
  } catch (err) {
    qrErrorCache.set(companyId, { error: err, expiresAt: Date.now() + QR_ERROR_CACHE_TTL_MS });
    throw err;
  }
}

export async function logoutEvolutionInstance(companyId) {
  const account = await getEvolutionInstance(companyId);
  if (!account) return { ok: true };

  const data = await evolutionRequest(
    `/instance/logout/${encodeURIComponent(account.instance_name)}`,
    { method: "DELETE" }
  );

  await updateEvolutionInstanceStatus(companyId, "close");

  return data;
}

export async function deleteEvolutionInstance(companyId) {
  const account = await getEvolutionInstance(companyId);
  if (!account) return { ok: true };

  const data = await evolutionRequest(
    `/instance/delete/${encodeURIComponent(account.instance_name)}`,
    { method: "DELETE" }
  );

  const { deleteEvolutionInstanceRecord } = await import("./db.js");
  await deleteEvolutionInstanceRecord(companyId);

  return data;
}

export async function sendText(companyId, to, body) {
  const account = await ensureEvolutionInstance(companyId);
  const number = normalizeWaId(to);

  return evolutionRequest(
    `/message/sendText/${encodeURIComponent(account.instance_name)}`,
    {
      method: "POST",
      body: JSON.stringify({
        number,
        text: String(body || ""),
      }),
    }
  );
}

export async function sendDocument(
  companyId,
  to,
  buffer,
  mimeType,
  filename,
  caption
) {
  const account = await ensureEvolutionInstance(companyId);
  const number = normalizeWaId(to);

  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error("Document buffer is empty.");
  }

  if (!filename) {
    throw new Error("A filename is required when sending a document.");
  }

  return evolutionRequest(
    `/message/sendMedia/${encodeURIComponent(account.instance_name)}`,
    {
      method: "POST",
      body: JSON.stringify({
        number,
        mediatype: "document",
        mimetype: mimeType || "application/octet-stream",
        media: buffer.toString("base64"),
        fileName: filename,
        ...(caption ? { caption } : {}),
      }),
    }
  );
}

export async function sendImage(
  companyId,
  to,
  buffer,
  mimeType,
  filename,
  caption
) {
  const account = await ensureEvolutionInstance(companyId);
  const number = normalizeWaId(to);

  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error("Image buffer is empty.");
  }

  return evolutionRequest(
    `/message/sendMedia/${encodeURIComponent(account.instance_name)}`,
    {
      method: "POST",
      body: JSON.stringify({
        number,
        mediatype: "image",
        mimetype: mimeType || "image/jpeg",
        media: buffer.toString("base64"),
        ...(filename ? { fileName: filename } : {}),
        ...(caption ? { caption } : {}),
      }),
    }
  );
}

export async function sendFileTo(
  companyId,
  to,
  buffer,
  mimeType,
  filename,
  caption
) {
  if ((mimeType || "").startsWith("image/")) {
    return sendImage(companyId, to, buffer, mimeType, filename, caption);
  }

  return sendDocument(
    companyId,
    to,
    buffer,
    mimeType,
    filename,
    caption
  );
}