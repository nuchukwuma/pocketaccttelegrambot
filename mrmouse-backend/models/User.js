// models/User.js
const mongoose = require("mongoose");
const { Schema } = mongoose;

const UserSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    name: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    businessId: { type: String, required: true, index: true },
    role: { type: String, enum: ["owner", "admin", "staff", "accountant"], default: "staff" },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { minimize: false, versionKey: false }
);

UserSchema.index({ businessId: 1, email: 1 });

module.exports = mongoose.model("User", UserSchema);