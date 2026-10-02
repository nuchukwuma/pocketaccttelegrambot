require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const mongoose = require("mongoose");
const { Server } = require("socket.io");

const Device = require("./models/Device");
const syncRouter = require("./routes/sync");
const buildUsersRouter = require("./routes/users");
const buildDevicesRouter = require("./routes/devices");
const billingRouter = require("./routes/billing");
const buildAiChatRouter = require("./routes/aiChat");
const { requireAuthOrBot, requireAuth, requireSameOrigin, verifyToken, COOKIE_NAME } = require("./auth");
const User = require("./models/User");
const SyncEvent = require("./models/SyncEvent");
const EntitySnapshot = require("./models/EntitySnapshot");
const BusinessBackup = require("./models/BusinessBackup");
const { durableWrite } = require("./services/durableWrite");

// Mirrors ENTITY_TABLE in the frontend's useCompanySync.js and the
// equivalent mapping in the bot's socketPeer.js — same pluralization, so a
// bulk snapshot built here slots into the exact shape both already expect
// from a peer's STATE_OFFERED.
const ENTITY_TABLE = {
  product: "products",
  transaction: "transactions",
  settlement: "settlements",
  pendingOrder: "pendingOrders",
  invoice: "invoices",
  deadline: "deadlines",
};

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;

// Must match the `expireAfterSeconds` TTL on SyncEvent.js's createdAt index —
// this is what makes a `since` older than this "possibly missing events,"
// not just "no events." Keep these two in sync if the TTL ever changes.
const SYNC_EVENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

// Define allowed origins including local dev, production web, and Electron (file:// / null)
const allowedOrigins = [
  process.env.CLIENT_ORIGIN,
  "http://localhost:5173",
  "file://",
  "https://localhost",       // Capacitor Android WebView origin
  "capacitor://localhost",   // Capacitor iOS WebView origin
];

const corsOptions = {
  origin: (origin, callback) => {
    // Desktop apps (file://) and non-browser clients (Postman/mobile) may not send an Origin header
    if (!origin || allowedOrigins.includes(origin) || process.env.CLIENT_ORIGIN === "*") {
      return callback(null, true);
    }
    return callback(new Error("CORS policy error: Origin not allowed"));
  },
  credentials: true,
};

async function start() {
  if (MONGO_URI) {
    await mongoose.connect(MONGO_URI);
    console.log("[mongo] connected");
  } else {
    throw new Error("MONGO_URI is required");
  }

  const app = express();
  app.use(cors(corsOptions));

  // Paystack webhook must see the exact raw payload for HMAC-SHA512 verification.
  app.use("/api/billing/webhook", express.raw({ type: "application/json" }));

  // All ordinary JSON routes can use the normal parser.
  app.use(express.json({ limit: "2mb" }));

  const server = http.createServer(app);
  const io = new Server(server, {
    cors: corsOptions,
  });

  // Socket authentication
  io.use(async (socket, next) => {
    try {
      const auth = socket.handshake.auth || {};
      let user = null;

      if (auth.botApiKey && process.env.BOT_API_KEY && auth.botApiKey === process.env.BOT_API_KEY) {
        if (!auth.companyId) return next(new Error("companyId required"));
        user = await User.findOne({ businessId: auth.companyId, role: "owner" }).lean();
        if (!user) return next(new Error("Invalid business"));
      } else {
        let token = auth.token || null;
        if (!token) {
          const raw = socket.handshake.headers.cookie || "";
          token = raw
            .split(";")
            .map((p) => p.trim())
            .find((p) => p.startsWith(`${COOKIE_NAME}=`))
            ?.slice(COOKIE_NAME.length + 1);
          if (token) token = decodeURIComponent(token);
        }

        const claims = verifyToken(token);
        if (!claims) return next(new Error("Authentication required"));
        user = await User.findOne({ id: claims.sub }).lean();
        if (!user || user.businessId !== claims.businessId) return next(new Error("Invalid session"));
      }

      socket.data.user = user;
      socket.data.businessId = user.businessId;
      // Only real devices send this — the bot's socketPeer.js auth payload
      // has no deviceId, by design. That keeps the bot out of the pruning
      // gate below: it consumes the same replayed events but never blocks
      // cleanup by "not having acked," since it isn't a device a business
      // owner manages via /api/devices.
      socket.data.deviceId = typeof auth.deviceId === "string" ? auth.deviceId : null;
      next();
    } catch (err) {
      next(err);
    }
  });

  io.on("connection", (socket) => {
    console.log(`[socket] connected ${socket.id} user=${socket.data.user.id}`);

    socket.on("JOIN_COMPANY", ({ companyId }) => {
      if (!companyId || companyId !== socket.data.businessId) return;
      const room = `company_${socket.data.businessId}`;
      socket.join(room);
      socket.data.joinedCompanyId = socket.data.businessId;
      socket.emit("JOINED_COMPANY", { companyId: socket.data.businessId, room });
    });

    socket.on("LEAVE_COMPANY", ({ companyId }) => {
      if (!companyId || companyId !== socket.data.businessId) return;
      socket.leave(`company_${socket.data.businessId}`);
      socket.data.joinedCompanyId = null;
    });

    socket.on("SYNC_MUTATE", ({ companyId, entity, action, id, payload }) => {
      if (companyId !== socket.data.businessId || socket.data.joinedCompanyId !== socket.data.businessId) return;
      if (!entity || !action || !id) return;

      io.to(`company_${socket.data.businessId}`).except(socket.id).emit("SYNC_EVENT", {
        entity, action, payload,
      });

      // Durable backstop #1: the rolling event log, for efficient
      // incremental catch-up (see REQUEST_STATE below). Wrapped in
      // durableWrite so a transient Mongo blip retries instead of silently
      // dropping the one copy this backstop exists to guarantee.
      durableWrite(
        "SyncEvent",
        socket.data.businessId,
        { entity, action, entityId: id, payload },
        () => SyncEvent.create({
          businessId: socket.data.businessId,
          entity,
          action,
          entityId: id,
          payload,
        })
      );

      // Durable backstop #2: the current-state mirror, for a correct
      // from-scratch bootstrap when there's no history to replay from (or
      // it's aged out). A delete's payload is deliberately minimal
      // (`{ id }` only — same as the live SYNC_EVENT path already
      // expects) so we must NOT blindly overwrite the stored payload with
      // that stub; only flip `deleted` and leave the rest of the record
      // as it last was.
      const snapshotUpdate =
        action === "delete"
          ? { $set: { deleted: true, updatedAt: new Date() }, $setOnInsert: { payload: payload || { id } } }
          : { $set: { payload, deleted: false, updatedAt: new Date(payload?.updatedAt || Date.now()) } };

      durableWrite(
        "EntitySnapshot",
        socket.data.businessId,
        { entity, entityId: id, snapshotUpdate },
        () => EntitySnapshot.findOneAndUpdate(
          { businessId: socket.data.businessId, entity, entityId: id },
          snapshotUpdate,
          { upsert: true }
        )
      );
    });

    socket.on("REQUEST_STATE", async ({ companyId, since }) => {
      if (companyId !== socket.data.businessId || socket.data.joinedCompanyId !== socket.data.businessId) return;

      // Keep asking online peers too — when one's available this is the
      // lowest-latency path and needs no round trip to Mongo.
      io.to(`company_${socket.data.businessId}`).except(socket.id).emit("STATE_REQUESTED", {
        since, requesterId: socket.id,
      });

      // A `since` older than SyncEvent's own TTL (see SyncEvent.js) is
      // indistinguishable, from a plain `find({ createdAt: { $gt: since } })`,
      // from "nothing changed since then" — the log may have simply aged
      // those events out already. Treating a stale `since` the same as no
      // `since` at all removes that ambiguity at the source: a device that
      // reconnects after a long gap gets a full, correct EntitySnapshot
      // bootstrap instead of a confident-but-wrong "you're caught up."
      const sinceIsStale = since && Date.now() - new Date(since).getTime() > SYNC_EVENT_RETENTION_MS;

      if (!since || sinceIsStale) {
        // Nothing to incrementally catch up FROM — this is a from-scratch
        // bootstrap (first-ever connection for this device, the bot linking
        // to a company for the first time, or a resume point old enough
        // that the event log can no longer answer it correctly).
        // EntitySnapshot can, because it always holds the current value
        // regardless of age. Answered as a bulk STATE_OFFERED — the exact
        // same shape a peer would send, so neither the frontend nor the
        // bot needs any changes to handle it.
        try {
          const rows = await EntitySnapshot.find({
            businessId: socket.data.businessId,
            deleted: { $ne: true },
          }).lean();

          const entities = Object.fromEntries(Object.values(ENTITY_TABLE).map((table) => [table, []]));
          for (const row of rows) {
            const table = ENTITY_TABLE[row.entity];
            if (table) entities[table].push(row.payload);
          }

          socket.emit("STATE_OFFERED", { entities, fromSocketId: "server" });
        } catch (err) {
          console.error(`[sync] failed to build snapshot for ${socket.data.businessId}`, err);
        }
        return;
      }

      // Durable catch-up: replay whatever's been persisted since `since`,
      // regardless of whether any peer is online to answer at all. Each
      // stored event is replayed as an individual SYNC_EVENT — the exact
      // same event the client already handles correctly for both upserts
      // and deletes (it branches on `action === "delete"` itself), so no
      // client-side changes are needed and a delete's minimal `{ id }`
      // payload is handled exactly as it already is for a live delete.
      try {
        const events = await SyncEvent.find({
          businessId: socket.data.businessId,
          createdAt: { $gt: new Date(since) },
        }).sort({ createdAt: 1 }).lean();

        for (const event of events) {
          socket.emit("SYNC_EVENT", { entity: event.entity, action: event.action, payload: event.payload });
        }

        // Tell the requester exactly what it's now caught up to, using
        // OUR timestamp (the last replayed event's createdAt, or the
        // `since` it asked with if nothing was newer) — not the client's
        // own clock. This is what makes ACK_SYNCED below trustworthy: the
        // device is acking data it's actually been sent, not just "I
        // waited a few seconds and assume I'm fine."
        const upTo = events.length ? events[events.length - 1].createdAt.toISOString() : since;
        socket.emit("SYNC_CAUGHT_UP", { upTo });
      } catch (err) {
        console.error(`[sync] failed to replay SyncEvents for ${socket.data.businessId}`, err);
      }
    });

    // A device confirming it has actually applied everything up to `syncedAt`
    // (sent in response to SYNC_CAUGHT_UP above). This is the only thing the
    // pruning job below trusts — silence from an unregistered/bot connection
    // is fine and expected, not an error.
    socket.on("ACK_SYNCED", async ({ syncedAt }) => {
      if (!socket.data.deviceId || !syncedAt) return;
      try {
        await Device.updateOne(
          { id: socket.data.deviceId, businessId: socket.data.businessId },
          { $set: { lastSyncedAt: new Date(syncedAt) } }
        );
      } catch (err) {
        console.error(`[sync] failed to record ACK_SYNCED for device ${socket.data.deviceId}`, err);
      }
    });

    socket.on("PROVIDE_STATE", ({ toSocketId, entities }) => {
      if (!toSocketId || !entities) return;
      const target = io.sockets.sockets.get(toSocketId);
      if (!target || target.data.businessId !== socket.data.businessId || socket.data.joinedCompanyId !== socket.data.businessId) return;
      target.emit("STATE_OFFERED", { entities, fromSocketId: socket.id });
    });

    socket.on("disconnect", (reason) => {
      console.log(`[socket] disconnected ${socket.id} (${reason})`);
    });
  });

  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.use("/api/sync", requireAuthOrBot, requireSameOrigin, syncRouter);
  app.use("/api/users", buildUsersRouter(io));
  app.use("/api/devices", requireAuthOrBot, requireSameOrigin, buildDevicesRouter(io));
  app.use("/api/billing", billingRouter);
  app.use("/api/ai", requireAuth, requireSameOrigin, buildAiChatRouter(io));

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(err.status || 500).json({
      error: err.message || "Internal server error",
    });
  });

  server.listen(PORT, () => console.log(`[server] listening on :${PORT}`));

  startSyncEventPruner();
  startBackupSnapshotter();
}

// Deletes SyncEvents earlier than every active device's confirmed
// ACK_SYNCED progress, per business — a device that's proven it received
// an event no longer needs it kept around on its behalf. This runs
// independently of (and in addition to) the model's 7-day TTL index,
// which stays in place as the absolute ceiling for a device that never
// comes back (lost, decommissioned, or just never reconnects).
const ACTIVE_DEVICE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const PRUNE_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

function startSyncEventPruner() {
  const run = () => pruneAcknowledgedSyncEvents().catch((err) => {
    console.error("[sync] pruning pass failed", err);
  });
  run();
  setInterval(run, PRUNE_INTERVAL_MS);
}

async function pruneAcknowledgedSyncEvents() {
  const businessIds = await SyncEvent.distinct("businessId");

  for (const businessId of businessIds) {
    const activeSince = new Date(Date.now() - ACTIVE_DEVICE_WINDOW_MS);
    const activeDevices = await Device.find({
      businessId,
      lastSeenAt: { $gte: activeSince },
    }).lean();

    // No active devices at all: nothing to gate against, and nothing at
    // risk either (nobody's waiting on this data). Leave it for the TTL
    // ceiling rather than guessing.
    if (activeDevices.length === 0) continue;

    // Any active device that has never acked at all is, by definition,
    // not caught up yet — its absence of proof means we don't prune
    // anything for this business this pass. This is the "wait for
    // everyone" guarantee: one un-acked active device blocks cleanup for
    // the whole business, exactly as intended.
    if (activeDevices.some((d) => !d.lastSyncedAt)) continue;

    const cutoff = activeDevices.reduce(
      (min, d) => (d.lastSyncedAt < min ? d.lastSyncedAt : min),
      activeDevices[0].lastSyncedAt
    );

    await SyncEvent.deleteMany({ businessId, createdAt: { $lt: cutoff } });
  }

  // EntitySnapshot tombstones don't need the same ack-gated treatment as
  // SyncEvent: a from-scratch bootstrap already filters out deleted rows
  // entirely (see REQUEST_STATE), so a tombstone lingering a bit longer
  // than necessary costs space, not correctness. Simple age-based cleanup
  // is enough here.
  const tombstoneCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  await EntitySnapshot.deleteMany({ deleted: true, updatedAt: { $lt: tombstoneCutoff } });
}

// Point-in-time rollback safety net for EntitySnapshot (see
// BusinessBackup.js). This is not for catch-up like SyncEvent/EntitySnapshot
// are — it's insurance against a bad write (buggy client, mistaken bulk
// edit) clobbering current state with nothing to restore from. Runs far
// less often than the sync pruner since it's a coarser-grained safety net,
// not a live path.
const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const BACKUPS_TO_KEEP_PER_BUSINESS = 7;

function startBackupSnapshotter() {
  const run = () => snapshotAllBusinesses().catch((err) => {
    console.error("[backup] snapshot pass failed", err);
  });
  run();
  setInterval(run, BACKUP_INTERVAL_MS);
}

async function snapshotAllBusinesses() {
  const businessIds = await EntitySnapshot.distinct("businessId");

  for (const businessId of businessIds) {
    try {
      // Same shape/construction as the REQUEST_STATE from-scratch bootstrap
      // above, so a restore could be replayed through the exact same
      // STATE_OFFERED path the client already knows how to handle.
      const rows = await EntitySnapshot.find({
        businessId,
        deleted: { $ne: true },
      }).lean();

      const entities = Object.fromEntries(Object.values(ENTITY_TABLE).map((table) => [table, []]));
      for (const row of rows) {
        const table = ENTITY_TABLE[row.entity];
        if (table) entities[table].push(row.payload);
      }

      await BusinessBackup.create({ businessId, entities });

      // Keep only the most recent N per business — older ones stop being
      // useful rollback points and just cost storage.
      const stale = await BusinessBackup.find({ businessId })
        .sort({ takenAt: -1 })
        .skip(BACKUPS_TO_KEEP_PER_BUSINESS)
        .select("_id")
        .lean();

      if (stale.length) {
        await BusinessBackup.deleteMany({ _id: { $in: stale.map((d) => d._id) } });
      }
    } catch (err) {
      console.error(`[backup] failed to snapshot business ${businessId}`, err);
    }
  }
}

start().catch((err) => {
  console.error("[fatal] failed to start server", err);
  process.exit(1);
});