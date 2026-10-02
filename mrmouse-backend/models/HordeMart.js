// models/HordeMart.js — state for the HordeMart link (routes/hordemart.js).
const mongoose = require("mongoose");
const { Schema } = mongoose;

// Single-use sign-in passes. Mongo removes each row once its pass has expired.
const UsedPassSchema = new Schema({
  jti: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true },
}, { versionKey: false });
UsedPassSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// The 10-minute ticket that stands in for the pass while the person reads
// the terms. Only a hash is stored: a database read cannot sign anyone in.
const SsoTicketSchema = new Schema({
  ticketHash: { type: String, required: true, unique: true },
  claims: { type: Schema.Types.Mixed, required: true },
  expiresAt: { type: Date, required: true },
}, { versionKey: false });
SsoTicketSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// One HordeMart user ⇄ one Mr Mouse user. Linked on HordeMart's stable user
// id, never on email.
const HordeMartLinkSchema = new Schema({
  hordemartUserId: { type: String, required: true, unique: true },
  userId: { type: String, required: true, index: true },
  businessId: { type: String, required: true, index: true },
  siteId: { type: String, required: true, index: true },
  siteSlug: { type: String, default: "" },
  siteName: { type: String, default: "" },
  // Their role in the HordeMart store. Only an owner's link drives stock sync.
  hordemartRole: { type: String, enum: ["owner", "staff"], default: "staff" },
  termsVersion: { type: String, required: true },
  // Set when HordeMart answers 409 (stock sync off there). Cleared on the
  // next sign-in from HordeMart, which is when the owner may have switched it on.
  stockSyncPausedUntil: { type: Date, default: null },
  lastStockPushAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, { versionKey: false });

// HordeMart may deliver the same sale twice; it is applied once.
const HordeMartSaleSchema = new Schema({
  siteId: { type: String, required: true },
  orderNumber: { type: String, required: true },
  receivedAt: { type: Date, default: Date.now },
}, { versionKey: false });
HordeMartSaleSchema.index({ siteId: 1, orderNumber: 1 }, { unique: true });

module.exports = {
  UsedPass: mongoose.models.UsedPass || mongoose.model("UsedPass", UsedPassSchema),
  SsoTicket: mongoose.models.SsoTicket || mongoose.model("SsoTicket", SsoTicketSchema),
  HordeMartLink: mongoose.models.HordeMartLink || mongoose.model("HordeMartLink", HordeMartLinkSchema),
  HordeMartSale: mongoose.models.HordeMartSale || mongoose.model("HordeMartSale", HordeMartSaleSchema),
};
