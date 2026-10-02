const mongoose = require("mongoose");

const AiUsageSchema = new mongoose.Schema(
  {
    businessId: { type: String, required: true, index: true },
    day: { type: String, required: true },
    requests: { type: Number, default: 0, min: 0 },
    updatedAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

AiUsageSchema.index({ businessId: 1, day: 1 }, { unique: true });

module.exports = mongoose.model("AiUsage", AiUsageSchema);
