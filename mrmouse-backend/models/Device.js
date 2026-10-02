// models/Device.js
const mongoose = require("mongoose");
const { Schema } = mongoose;

const DeviceSchema = new Schema(
  {
    id: { type: String, required: true },
    businessId: { type: String, required: true, index: true },
    label: { type: String, default: "Unnamed device" },
    firstSeenAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
    // Set only via a server-confirmed ACK_SYNCED (see server.js) — the
    // point up to which this device has actually received sync events,
    // not merely "the last time its local clock said it was done." Null
    // until the device's first successful catch-up.
    lastSyncedAt: { type: Date, default: null },
  },
  { minimize: false, versionKey: false }
);

// Compound unique index ensures device IDs are unique per business
DeviceSchema.index({ id: 1, businessId: 1 }, { unique: true });

module.exports = mongoose.model("Device", DeviceSchema);