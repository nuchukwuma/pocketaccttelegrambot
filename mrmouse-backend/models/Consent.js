// models/Consent.js
//
// What each person agreed to, and when. Append-only: an acceptance and a
// withdrawal are both new rows, so the history of what someone agreed to
// survives — which is the point of keeping it (NDPA 2023 asks a controller
// to be able to show consent was given). Updates and deletes throw.
const mongoose = require("mongoose");
const { Schema } = mongoose;

const ConsentSchema = new Schema(
  {
    userId: { type: String, required: true },
    businessId: { type: String, required: true },
    purpose: { type: String, required: true },
    action: { type: String, enum: ["accepted", "withdrawn"], required: true },
    version: { type: String, default: null },
    // How it was given: the app's tick box, sign-up, or the HordeMart link screen.
    source: { type: String, enum: ["app", "signup", "hordemart"], default: "app" },
    ip: { type: String, default: null },
    userAgent: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

ConsentSchema.index({ userId: 1, purpose: 1, createdAt: 1 });

function refuse() {
  throw new Error("Consent records are append-only: record a withdrawal instead of changing or deleting one");
}
for (const op of [
  "updateOne",
  "updateMany",
  "findOneAndUpdate",
  "replaceOne",
  "findOneAndReplace",
  "deleteOne",
  "deleteMany",
  "findOneAndDelete",
]) {
  ConsentSchema.pre(op, refuse);
}
ConsentSchema.pre("save", function () {
  if (!this.isNew) refuse();
});

module.exports = mongoose.models.Consent || mongoose.model("Consent", ConsentSchema);
