// useCompanySync.js
// ─────────────────────────────────────────────────────────────────────────
// RELAY ARCHITECTURE. Public shape is UNCHANGED from before — this still
// returns { connectionStatus, business, products, transactions, ...,
// mutate }. Ledgercontext.jsx does not need to change at all.
//
// What's different underneath:
//  - No REST bootstrap/delta for products/transactions/settlements/
//    pendingOrders/invoices. Catching up now means asking whichever peer
//    devices are currently online (REQUEST_STATE -> STATE_OFFERED).
//  - mutate() emits SYNC_MUTATE over the socket instead of POSTing to a
//    REST endpoint — the server relays it, it never touches a database.
//  - `business` is the one exception: still fetched/saved via the slim
//    REST endpoints in routes/sync.js, since that's the one thing meant to
//    be server-authoritative.
// ─────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { useLiveQuery } from "dexie-react-hooks";
import { db, upsertLocal, softDeleteLocal, bulkHydrate, queueOutbox, clearOutboxItem, getPendingOutbox } from "./Db";
import { getAuthToken, getAuthHeaders } from "../auth";
import { getOrCreateDeviceId } from "../deviceId";
import { processImage, toWireImage, fromWireImage } from "../media/images";

const SERVER_URL = import.meta.env?.VITE_SYNC_SERVER_URL || "http://localhost:5000";
const STATE_REQUEST_TIMEOUT_MS = 3000; // how long to wait for a peer to answer before giving up

const ENTITY_TABLE = {
  product: "products",
  transaction: "transactions",
  settlement: "settlements",
  pendingOrder: "pendingOrders",
  invoice: "invoices",
  deadline: "deadlines",
  pref: "prefs",
};
const RELAYED_ENTITIES = Object.keys(ENTITY_TABLE); // everything except 'business' and 'image'

export function useCompanySync(companyId) {
  const socketRef = useRef(null);
  const [connectionStatus, setConnectionStatus] = useState("connecting");
  const [bootstrapped, setBootstrapped] = useState(false); // true once we've asked peers at least once
  const [peersRespondedThisSync, setPeersRespondedThisSync] = useState(0);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);

  const metaKey = companyId ? `lastSyncedAt:${companyId}` : null;

  // ---- Live, reactive local data (unchanged — still Dexie) --------------------
  const business = useLiveQuery(() => (companyId ? db.business.get(companyId) : undefined), [companyId]);
  const products = useLiveQuery(
    () => (companyId ? db.products.where({ companyId }).and((p) => !p.deleted).toArray() : []),
    [companyId]
  );
  const transactions = useLiveQuery(
    () => (companyId ? db.transactions.where({ companyId }).and((t) => !t.deleted).toArray() : []),
    [companyId]
  );
  const settlements = useLiveQuery(
    () => (companyId ? db.settlements.where({ companyId }).and((s) => !s.deleted).toArray() : []),
    [companyId]
  );
  const pendingOrders = useLiveQuery(
    () => (companyId ? db.pendingOrders.where({ companyId }).and((o) => !o.deleted).toArray() : []),
    [companyId]
  );
  const invoices = useLiveQuery(
    () => (companyId ? db.invoices.where({ companyId }).and((i) => !i.deleted).toArray() : []),
    [companyId]
  );
  const deadlines = useLiveQuery(
    () => (companyId ? db.deadlines.where({ companyId }).and((d) => !d.deleted).toArray() : []),
    [companyId]
  );

  // ---- Business: still server-authoritative (the one thing in Mongo) ---------
  const fetchBusinessFromServer = useCallback(async () => {
    if (!companyId) return null;
    try {
      const res = await fetch(`${SERVER_URL}/api/sync/business?companyId=${companyId}`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error(`Business fetch failed: ${res.status}`);
      const data = await res.json();
      if (data.business) await db.business.put(data.business);
      return data.business;
    } catch (err) {
      console.error("[sync] business fetch error", err);
      return null;
    }
  }, [companyId]);

  const saveBusinessToServer = useCallback(async (profile) => {
    try {
      const res = await fetch(`${SERVER_URL}/api/sync/business`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify(profile),
      });
      if (!res.ok) throw new Error(`Business save failed: ${res.status}`);
      const data = await res.json();
      if (data.business) await db.business.put(data.business);
    } catch (err) {
      console.error("[sync] business save error", err);
    }
  }, []);

  // ---- Building a "what's changed since X" snapshot from OUR OWN local data --
  // This is what we hand to a peer that asked us for a catch-up.
  const buildLocalSnapshot = useCallback(
    async (since) => {
      const sinceDate = since ? new Date(since) : new Date(0);
      const isNewer = (r) => new Date(r.updatedAt) > sinceDate;
      // Images are never in a bulk snapshot: a few of them would push one
      // message past the server's 1MB limit. They catch up one message per
      // image from the server instead (see the backend's REQUEST_STATE).
      const [p, t, s, o, i, d, pr] = await Promise.all([
        db.products.where({ companyId }).toArray(),
        db.transactions.where({ companyId }).toArray(),
        db.settlements.where({ companyId }).toArray(),
        db.pendingOrders.where({ companyId }).toArray(),
        db.invoices.where({ companyId }).toArray(),
        db.deadlines.where({ companyId }).toArray(),
        db.prefs.where({ companyId }).toArray(),
      ]);
      return {
        products: p.filter(isNewer),
        transactions: t.filter(isNewer),
        settlements: s.filter(isNewer),
        pendingOrders: o.filter(isNewer),
        invoices: i.filter(isNewer),
        deadlines: d.filter(isNewer),
        prefs: pr.filter(isNewer),
      };
    },
    [companyId]
  );

  const applyPeerSnapshot = useCallback(async (entities) => {
    await Promise.all([
      bulkHydrate("products", entities.products),
      bulkHydrate("transactions", entities.transactions),
      bulkHydrate("settlements", entities.settlements),
      bulkHydrate("pendingOrders", entities.pendingOrders),
      bulkHydrate("invoices", entities.invoices),
      bulkHydrate("deadlines", entities.deadlines),
      bulkHydrate("prefs", entities.prefs),
    ]);
  }, []);

  // `lastSyncedAt` is read via a ref, not a dependency, on purpose — see the
  // note below on why. Keep it in sync with the state value on every change.
  const lastSyncedAtRef = useRef(lastSyncedAt);
  useEffect(() => {
    lastSyncedAtRef.current = lastSyncedAt;
  }, [lastSyncedAt]);

  // ---- Ask every currently-connected peer to catch us up ----------------------
  // IMPORTANT: this must NOT depend on `lastSyncedAt` directly. It reads and
  // writes that state, so including it as a dependency would give this
  // function a new identity every time a sync completes — which, since the
  // socket lifecycle effect below depends on this function, would tear down
  // and rebuild the socket connection after every single sync. That was the
  // "reconnecting every second" bug: sync finishes -> new function identity
  // -> socket rebuilt -> reconnects -> syncs again -> repeat. Reading through
  // a ref keeps this function's identity stable across the whole session.
  const requestStateFromPeers = useCallback(async () => {
    const socket = socketRef.current;
    if (!companyId || !socket) return;
    const meta = await db.table("meta").get(metaKey);
    const since = lastSyncedAtRef.current || meta?.value || null;
    // Signed out (or reconnected) while reading: that socket is gone.
    if (socketRef.current !== socket) return;

    setPeersRespondedThisSync(0);
    socket.emit("REQUEST_STATE", { companyId, since });

    // Give peers a window to answer; whichever come back get applied as
    // they arrive (see the STATE_OFFERED listener below). After the window,
    // mark ourselves bootstrapped regardless — even zero replies means "we
    // asked, nobody had anything newer, proceed with what we've got."
    setTimeout(() => {
      setBootstrapped(true);
      const now = new Date().toISOString();
      setLastSyncedAt(now);
      db.table("meta").put({ key: metaKey, value: now });
    }, STATE_REQUEST_TIMEOUT_MS);
  }, [companyId, metaKey]);

  // ---- Flush mutations queued while offline, now over the socket -------------
  const flushOutbox = useCallback(async () => {
    const socket = socketRef.current;
    if (!companyId || !socket) return;
    const pending = await getPendingOutbox(companyId);
    for (const item of pending) {
      // Disconnected or signed out part-way: stop, and leave the rest
      // queued for the next connection rather than dropping them.
      if (socketRef.current !== socket || !socket.connected) return;
      socket.emit("SYNC_MUTATE", {
        companyId: item.companyId,
        entity: item.entity,
        action: item.action,
        id: item.id,
        payload: item.payload,
      });
      await clearOutboxItem(item.localId);
    }
  }, [companyId]);

  // ---- connection status ref, so mutate() doesn't get recreated on every flip
  const connectionStatusRef = useRef(connectionStatus);
  useEffect(() => {
    connectionStatusRef.current = connectionStatus;
  }, [connectionStatus]);

  // ---- Images: Blob on this device, base64 on the wire --------------------------
  const applyIncomingImage = useCallback(async (action, payload) => {
    if (!payload?.id) return;
    if (action === "delete") {
      // Drop the bytes, keep a tombstone so a late copy can't resurrect it.
      await db.images.put({ id: payload.id, companyId, deleted: true, blob: null, updatedAt: new Date().toISOString() });
      return;
    }
    const existing = await db.images.get(payload.id);
    if (existing?.updatedAt && payload.updatedAt && existing.updatedAt >= payload.updatedAt) return;
    const record = fromWireImage(payload);
    if (record) await db.images.put({ ...record, companyId, deleted: false });
  }, [companyId]);

  const relay = useCallback(async (mutationArgs) => {
    const socket = socketRef.current;
    if (connectionStatusRef.current === "connected" && socket) socket.emit("SYNC_MUTATE", mutationArgs);
    else await queueOutbox(mutationArgs);
  }, []);

  /**
   * Process and keep an image from a file input or the camera, then send it
   * to the business's other devices. Resolves to the new image id; rejects
   * with an ImageError whose message can be shown as-is.
   */
  const saveImage = useCallback(
    async (file, { kind }) => {
      if (!companyId) throw new Error("Not signed in");
      const processed = await processImage(file);
      const now = new Date().toISOString();
      const record = {
        id: crypto.randomUUID(),
        companyId,
        kind,
        blob: processed.blob,
        mime: processed.mime,
        width: processed.width,
        height: processed.height,
        bytes: processed.bytes,
        createdAt: now,
        updatedAt: now,
        deleted: false,
      };
      await db.images.put(record);
      await relay({ companyId, entity: "image", action: "create", id: record.id, payload: await toWireImage(record) });
      return record.id;
    },
    [companyId, relay]
  );

  const deleteImage = useCallback(
    async (imageId) => {
      if (!companyId || !imageId) return;
      await db.images.put({ id: imageId, companyId, deleted: true, blob: null, updatedAt: new Date().toISOString() });
      await relay({ companyId, entity: "image", action: "delete", id: imageId, payload: { id: imageId } });
    },
    [companyId, relay]
  );

  // ---- Socket.io lifecycle ------------------------------------------------------
  useEffect(() => {
    if (!companyId) return undefined;

    const token = getAuthToken();
    const deviceId = getOrCreateDeviceId();
    const socket = io(SERVER_URL, {
      transports: ["websocket"],
      reconnection: true,
      auth: { ...(token ? { token } : {}), deviceId },
    });
    socketRef.current = socket;
    setConnectionStatus("connecting");

    socket.on("connect", async () => {
      setConnectionStatus("connected");
      socket.emit("JOIN_COMPANY", { companyId });
      await requestStateFromPeers();
      await flushOutbox();
    });

    socket.on("disconnect", () => setConnectionStatus("disconnected"));
    socket.io.on("reconnect_attempt", () => setConnectionStatus("connecting"));

    // Live change from another connected device.
    socket.on("SYNC_EVENT", async ({ entity, action, payload }) => {
      if (entity === "image") {
        await applyIncomingImage(action, payload);
        return;
      }
      const table = ENTITY_TABLE[entity];
      if (!table || !payload) return;
      if (action === "delete") await softDeleteLocal(table, payload.id);
      else await upsertLocal(table, payload);
    });

    // The server refused something we sent (today: an image over the size
    // limit or of the wrong type). Mark it, so the screen that shows the
    // image can say it isn't reaching other devices.
    socket.on("SYNC_REJECTED", async ({ entity, id, reason }) => {
      console.warn(`[sync] server refused ${entity} ${id}: ${reason}`);
      if (entity === "image" && id) await db.images.update(id, { syncError: reason });
    });

    // A newly-joined (or reconnecting) peer is asking us to catch them up.
    socket.on("STATE_REQUESTED", async ({ since, requesterId }) => {
      const snapshot = await buildLocalSnapshot(since);
      const hasAnything = RELAYED_ENTITIES.some((e) => snapshot[ENTITY_TABLE[e]]?.length > 0 || snapshot[e]?.length > 0);
      // Only bother answering if we actually have something newer to offer —
      // avoids a burst of empty replies from every idle peer.
      if (!hasAnything) return;
      socket.emit("PROVIDE_STATE", { toSocketId: requesterId, entities: snapshot });
    });

    // A peer answered OUR request — apply it.
    socket.on("STATE_OFFERED", async ({ entities }) => {
      await applyPeerSnapshot(entities);
      setPeersRespondedThisSync((n) => n + 1);
      const now = new Date().toISOString();
      setLastSyncedAt(now);
      await db.table("meta").put({ key: metaKey, value: now });
    });

    // The server's confirmation of exactly what it replayed to us from its
    // durable event log (see REQUEST_STATE on the backend). We ack this
    // specific timestamp back — not our own clock's "now" — so the
    // server's pruning job only ever deletes events we've actually proven
    // we received. By the time this fires, the SYNC_EVENT replays it
    // refers to have already been emitted (and handled) ahead of it on
    // this same socket, so acking here means they're applied.
    socket.on("SYNC_CAUGHT_UP", ({ upTo }) => {
      if (upTo) socket.emit("ACK_SYNCED", { syncedAt: upTo });
    });

    return () => {
      socket.emit("LEAVE_COMPANY", { companyId });
      socket.disconnect();
      socketRef.current = null;
    };
  }, [companyId, metaKey, requestStateFromPeers, flushOutbox, buildLocalSnapshot, applyPeerSnapshot, applyIncomingImage]);

  // ---- Business: fetch on mount, since it's still server-authoritative -------
  useEffect(() => {
    if (!companyId) return;
    fetchBusinessFromServer();
  }, [companyId, fetchBusinessFromServer]);


  // ---- Optimistic mutation: local write + relay, no database write anywhere --
  const mutate = useCallback(
    (entity, action, record) => {
      if (entity === "business") {
        const stamped = { ...record, id: record.id || companyId, companyId, updatedAt: new Date().toISOString() };
        db.business.put(stamped);
        saveBusinessToServer(stamped);
        return stamped;
      }

      const table = ENTITY_TABLE[entity];
      if (!table) throw new Error(`Unknown entity "${entity}"`);

      let localRecord;
      if (action === "delete") {
        localRecord = { id: record.id };
      } else {
        localRecord = {
          ...record,
          id: record.id || crypto.randomUUID(),
          companyId,
          updatedAt: new Date().toISOString(),
          deleted: false,
        };
      }

      (async () => {
        if (action === "delete") await softDeleteLocal(table, localRecord.id);
        else await upsertLocal(table, localRecord);

        const mutationArgs = { companyId, entity, action, id: localRecord.id, payload: localRecord };

        if (connectionStatusRef.current === "connected" && socketRef.current) {
          socketRef.current.emit("SYNC_MUTATE", mutationArgs);
        } else {
          await queueOutbox(mutationArgs);
        }
      })();

      return localRecord;
    },
    [companyId, saveBusinessToServer]
  );

  return {
    connectionStatus,
    bootstrapped,
    peersRespondedThisSync, // 0 after a sync round means: nobody else was online to catch us up from
    lastSyncedAt,
    business,
    products: products || [],
    transactions: transactions || [],
    settlements: settlements || [],
    pendingOrders: pendingOrders || [],
    invoices: invoices || [],
    deadlines: deadlines || [],
    mutate,
    saveImage,
    deleteImage,
    requestStateFromPeers,
  };
}

export default useCompanySync;