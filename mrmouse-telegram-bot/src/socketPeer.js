// This module makes the bot behave exactly like another browser tab from
// useCompanySync.js: one Socket.io connection per companyId, joining that
// company's room and speaking the same JOIN_COMPANY / REQUEST_STATE /
// STATE_OFFERED / SYNC_MUTATE / SYNC_EVENT protocol your real server
// already implements. No changes to your existing backend are required.
//
// ASSUMPTION (can't verify without your server source): STATE_REQUESTED /
// SYNC_EVENT broadcasts are scoped per-room by companyId, same as a real
// client would experience by being JOIN_COMPANY'd into just that room.
// Because of that, we keep one dedicated connection per company rather
// than multiplexing many companies over a single socket — it avoids any
// ambiguity about which company an inbound event belongs to.

import { io } from "socket.io-client";
import dotenv from "dotenv";
dotenv.config();

import {
  upsertEntity,
  softDeleteEntity,
  buildSnapshotSince,
  getMeta,
  setMeta,
  queueOutbox,
  getPendingOutbox,
  clearOutboxItem,
  uid,
  nowISO,
} from "./db.js";

const SERVER_URL = process.env.MAIN_APP_SERVER_URL || "http://localhost:5000";
export const SYNC_MODE = (process.env.SYNC_MODE || "cache").toLowerCase(); // 'cache' | 'live'
export const isLiveMode = () => SYNC_MODE === "live";
export const isCacheMode = () => SYNC_MODE === "cache";

const STATE_REQUEST_TIMEOUT_MS = 4000;

// companyId -> { socket, status, waiters: [{resolve}] }
const connections = new Map();

function metaKey(companyId) {
  return `lastSyncedAt:${companyId}`;
}

export function connectionStatus(companyId) {
  return connections.get(companyId)?.status || "disconnected";
}

export function ensureConnection(companyId) {
  if (connections.has(companyId)) return connections.get(companyId);

  const socket = io(SERVER_URL, {
    transports: ["websocket"],
    auth: {
      botApiKey: process.env.BOT_API_KEY || "",
      companyId,
    },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 2000,
  });

  const state = { socket, status: "connecting", waiters: [] };
  connections.set(companyId, state);

  socket.on("connect", async () => {
    state.status = "connected";
    socket.emit("JOIN_COMPANY", { companyId });
    if (isCacheMode()) {
      await flushOutbox(companyId);
      await hydrateFromMesh(companyId);
    }
  });

  socket.on("disconnect", () => {
    state.status = "disconnected";
  });

  socket.io.on("reconnect_attempt", () => {
    state.status = "connecting";
  });

  // Passive background updates — how the bot "uploads to / takes from"
  // the mesh continuously, same as any other open device.
  socket.on("SYNC_EVENT", async ({ entity, action, payload }) => {
    if (!isCacheMode() || !payload) return;
    try {
      if (action === "delete") await softDeleteEntity(companyId, entity, payload.id);
      else await upsertEntity(companyId, entity, payload);
    } catch (err) {
      console.error(`[${companyId}] failed to apply SYNC_EVENT`, err);
    }
  });

  // Be a good peer: if we hold cached state and another device asks for a
  // catch-up, offer it — same contract the app's own STATE_REQUESTED
  // handler in useCompanySync.js implements.
  socket.on("STATE_REQUESTED", async ({ since, requesterId }) => {
    if (!isCacheMode()) return; // nothing durable to offer in live mode
    try {
      const entities = await buildSnapshotSince(companyId, since);
      const hasAnything = Object.values(entities).some((arr) => arr.length > 0);
      if (!hasAnything) return;
      socket.emit("PROVIDE_STATE", { toSocketId: requesterId, entities });
    } catch (err) {
      console.error(`[${companyId}] failed to answer STATE_REQUESTED`, err);
    }
  });

  socket.on("STATE_OFFERED", async ({ entities }) => {
    // Resolve any live-mode reads / cache-mode hydration waiting on this.
    const waiters = state.waiters;
    state.waiters = [];
    waiters.forEach((resolve) => resolve(entities));

    if (isCacheMode()) {
      try {
        for (const [table, records] of Object.entries(entities || {})) {
          const entity = table === "pendingOrders" ? "pendingOrder" : table.replace(/s$/, "");
          for (const record of records) await upsertEntity(companyId, entity, record);
        }
        await setMeta(metaKey(companyId), nowISO());
      } catch (err) {
        console.error(`[${companyId}] failed to hydrate from STATE_OFFERED`, err);
      }
    }
  });

  // The server's own incremental-replay backstop (taken when REQUEST_STATE
  // carried a `since`) ends with this instead of STATE_OFFERED — it carries
  // no entities of its own, since each event was already delivered
  // individually via the SYNC_EVENT listener above and applied to the local
  // cache there. Without also tracking it here, the persisted watermark
  // only ever advanced when a live peer answered directly (STATE_OFFERED),
  // so reconnecting into an empty mesh left the cache correctly updated but
  // the resume point frozen — quietly increasing the odds it eventually
  // falls outside the server's own retention window (see server.js).
  socket.on("SYNC_CAUGHT_UP", async ({ upTo }) => {
    if (!isCacheMode() || !upTo) return;
    try {
      await setMeta(metaKey(companyId), upTo);
    } catch (err) {
      console.error(`[${companyId}] failed to persist SYNC_CAUGHT_UP watermark`, err);
    }
  });

  return state;
}

async function hydrateFromMesh(companyId) {
  const since = await getMeta(metaKey(companyId));
  await requestState(companyId, since);
}

// Ask the mesh for state, resolving with whatever STATE_OFFERED arrives
// first (or null on timeout). Used both for cache-mode catch-up and for
// live-mode on-demand reads.
export function requestState(companyId, since = null, timeoutMs = STATE_REQUEST_TIMEOUT_MS) {
  const state = ensureConnection(companyId);
  return new Promise((resolve) => {
    if (state.status !== "connected") {
      resolve(null);
      return;
    }
    const timer = setTimeout(() => resolve(null), timeoutMs);
    state.waiters.push((entities) => {
      clearTimeout(timer);
      resolve(entities);
    });
    state.socket.emit("REQUEST_STATE", { companyId, since });
  });
}

async function flushOutbox(companyId) {
  const state = connections.get(companyId);
  if (!state || state.status !== "connected") return;
  const pending = await getPendingOutbox(companyId);
  for (const item of pending) {
    state.socket.emit("SYNC_MUTATE", {
      companyId: item.company_id,
      entity: item.entity,
      action: item.action,
      id: item.entity_id,
      payload: item.payload,
    });
    await clearOutboxItem(item.local_id);
  }
}

// Stamps a mutation the same way useCompanySync.js's mutate() does, then
// delivers it to the mesh (immediately if connected; queued in cache mode
// if not; rejected outright in live mode if not connected).
export async function emitMutate(companyId, entity, action, record) {
  const state = ensureConnection(companyId);

  const localRecord =
    action === "delete"
      ? { id: record.id }
      : { ...record, id: record.id || uid(), companyId, updatedAt: nowISO(), deleted: false };

  if (isCacheMode()) {
    if (action === "delete") await softDeleteEntity(companyId, entity, localRecord.id);
    else await upsertEntity(companyId, entity, localRecord);
  }

  const mutationArgs = { companyId, entity, action, id: localRecord.id, payload: localRecord };

  if (state.status === "connected") {
    state.socket.emit("SYNC_MUTATE", mutationArgs);
    return { ok: true, delivered: true, record: localRecord };
  }

  if (isCacheMode()) {
    await queueOutbox(mutationArgs);
    return { ok: true, delivered: false, queued: true, record: localRecord };
  }

  return { ok: false, delivered: false, reason: "not_connected" };
}