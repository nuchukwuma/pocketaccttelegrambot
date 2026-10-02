// models/BusinessBackup.js
//
// EntitySnapshot (see EntitySnapshot.js) only ever holds a business's
// CURRENT state — a bad write (buggy client, corrupted payload, a mistaken
// bulk edit replayed from a device) overwrites it with nothing to roll back
// to, beyond the 30-day soft-delete tombstone window for individual deletes.
// This collection adds what that can't: a rotating series of point-in-time
// copies of a business's full EntitySnapshot state, taken periodically by
// runBackupSnapshotter() in server.js, so "restore to yesterday / last
// week" is possible without depending on any external service or the
// business owner remembering to export anything.
const mongoose = require("mongoose");
const { Schema } = mongoose;

const BusinessBackupSchema = new Schema({
  businessId: { type: String, required: true },
  entities: { type: Schema.Types.Mixed, required: true }, // same shape as STATE_OFFERED's `entities`
  takenAt: { type: Date, default: Date.now },
});

// Read pattern: "this business's backups, newest first" for restore, and
// "beyond the Nth newest" for rotation (see snapshotAllBusinesses in server.js).
BusinessBackupSchema.index({ businessId: 1, takenAt: -1 });

// Absolute ceiling in case the keep-last-N rotation logic is ever skipped
// or buggy — not the primary retention mechanism, just a backstop on top of it.
BusinessBackupSchema.index({ takenAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

module.exports = mongoose.models.BusinessBackup || mongoose.model("BusinessBackup", BusinessBackupSchema);