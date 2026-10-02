// models/EntitySnapshot.js
//
// SyncEvent (see SyncEvent.js) is a rolling LOG of recent mutations — great
// for "what changed since X," useless for "give me everything" once
// history has aged out of its retention window. This collection is the
// missing piece: a durable mirror of CURRENT state, one document per
// (businessId, entity, entityId), always holding the latest value.
//
// It exists specifically to answer a from-scratch catch-up (a brand-new
// device, or the Telegram bot linking to a company for the first time)
// correctly and completely, without depending on any peer happening to be
// online at that exact moment — the gap a pure event log can't close on
// its own.
const mongoose = require("mongoose");
const { Schema } = mongoose;

const EntitySnapshotSchema = new Schema({
  businessId: { type: String, required: true },
  entity: { type: String, required: true }, // product | transaction | settlement | pendingOrder | invoice | deadline
  entityId: { type: String, required: true },
  payload: { type: Schema.Types.Mixed, required: true }, // the full record as last written
  deleted: { type: Boolean, default: false },
  updatedAt: { type: Date, default: Date.now },
});

// One current row per entity instance — upserts key off this.
EntitySnapshotSchema.index({ businessId: 1, entity: 1, entityId: 1 }, { unique: true });

// The read pattern for a full bootstrap: "everything live for this
// business, grouped by entity."
EntitySnapshotSchema.index({ businessId: 1, entity: 1, deleted: 1 });

module.exports = mongoose.models.EntitySnapshot || mongoose.model("EntitySnapshot", EntitySnapshotSchema);
