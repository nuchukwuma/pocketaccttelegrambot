// models/FailedWrite.js
//
// Durable dead-letter store for backstop writes (SyncEvent / EntitySnapshot)
// that exhausted every retry in services/durableWrite.js. Nothing in the
// live sync path should silently vanish on a transient Mongo hiccup — if a
// write truly can't go through after retrying, it lands here instead of
// only in a console.error that scrolls off a log. Ops can inspect/replay
// these from the raw `operation` payload. The TTL is a backstop against
// unbounded growth if a failure pattern is never investigated, not an
// assumption that 30 days old is safe to lose.
const mongoose = require("mongoose");
const { Schema } = mongoose;

const FailedWriteSchema = new Schema({
  collection: { type: String, required: true }, // "SyncEvent" | "EntitySnapshot"
  businessId: { type: String, required: true },
  operation: { type: Schema.Types.Mixed, required: true }, // the args that were being written, for replay
  error: { type: String, required: true },
  attempts: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now },
});

// Read pattern: "failed writes for this business, oldest first" (for replay/ops review).
FailedWriteSchema.index({ businessId: 1, createdAt: 1 });

// Absolute ceiling so an uninvestigated failure pattern doesn't grow the
// collection forever — not a claim that these are safe to lose after 30 days.
FailedWriteSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

module.exports = mongoose.models.FailedWrite || mongoose.model("FailedWrite", FailedWriteSchema);