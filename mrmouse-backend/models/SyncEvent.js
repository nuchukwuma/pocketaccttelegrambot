// models/SyncEvent.js
//
// The live sync path (SYNC_MUTATE -> SYNC_EVENT) is pure peer relay: if no
// other device is online when a mutation happens, it's lost except on the
// sender's own local copy. This collection is the durable backstop for
// that gap — every mutation (from a real device OR the Telegram bot) is
// also appended here, so a device that reconnects later (or was never
// online when the change happened) can catch up straight from Mongo
// instead of depending on some specific peer having been online at the
// right moment.
//
// TTL: documents self-delete 7 days after creation via MongoDB's native
// TTL index (`expireAfterSeconds` on `createdAt`) — no cron job needed.
// This is a time-based backstop, not a "keep until every device has
// caught up" guarantee: a device offline for longer than 7 days would
// need a fuller resync. That's an intentional, practical trade-off; a
// per-device acknowledgement system would be the next step up if a
// harder guarantee is ever needed.
const mongoose = require("mongoose");
const { Schema } = mongoose;

const SyncEventSchema = new Schema({
  businessId: { type: String, required: true },
  entity: { type: String, required: true }, // product | transaction | settlement | pendingOrder | invoice | deadline
  action: { type: String, required: true }, // "delete" or an upsert-style action — mirrors whatever the client sent
  entityId: { type: String, required: true },
  payload: { type: Schema.Types.Mixed, required: true }, // full record for an upsert; { id } only for a delete
  createdAt: { type: Date, default: Date.now },
});

// Query pattern is always "events for this business since a timestamp" —
// this compound index serves that directly.
SyncEventSchema.index({ businessId: 1, createdAt: 1 });

// The actual auto-expiry. A single-field ascending index with
// expireAfterSeconds; MongoDB's background TTL monitor removes documents
// once `createdAt` is older than this, independent of the compound index
// above (both can coexist on the same field).
SyncEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 7 });

module.exports = mongoose.models.SyncEvent || mongoose.model("SyncEvent", SyncEventSchema);
