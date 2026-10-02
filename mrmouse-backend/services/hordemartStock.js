// services/hordemartStock.js
//
// Keeping a linked HordeMart store's stock in step with Mr Mouse:
//
//   out: after any product change, push absolute stock by SKU to HordeMart
//        (debounced per business). Only from an owner's link, only while
//        that person's consent stands, and only while HordeMart has stock
//        sync switched on (a 409 pauses pushing).
//   in:  a paid HordeMart order becomes an "offload" entry on the matching
//        product — the same thing recording a sale in the app does — and
//        reaches every open device through the normal sync relay.
//
// Products match on their item code (`sku`), exactly as HordeMart matches.
// Nothing about price or customers crosses in either direction.

const EntitySnapshot = require("../models/EntitySnapshot");
const User = require("../models/User");
const { HordeMartLink } = require("../models/HordeMart");
const { computeStock } = require("../ai/ledger");
const { pushStockToHordeMart } = require("../lib/hordemartSso");
const { hasCurrentConsent } = require("./consents");

const PUSH_DEBOUNCE_MS = 5_000;
const PAUSE_AFTER_REFUSAL_MS = 6 * 60 * 60 * 1000;
const MAX_ITEMS_PER_MESSAGE = 500;

function stockSyncConfig(env = process.env) {
  const apiUrl = env.HORDEMART_API_URL || "";
  const secret = env.HORDEMART_WEBHOOK_SECRET || "";
  return { apiUrl, secret, enabled: Boolean(apiUrl && secret.length >= 32) };
}

const cleanSku = (value) => (typeof value === "string" ? value.trim() : "");

async function liveProducts(businessId) {
  const rows = await EntitySnapshot.find({ businessId, entity: "product", deleted: { $ne: true } }).lean();
  return rows.map((row) => row.payload).filter((p) => p && !p.deleted);
}

// Links allowed to push for this business right now.
async function pushingLinks(businessId, now) {
  const links = await HordeMartLink.find({ businessId, hordemartRole: "owner" }).lean();
  const allowed = [];
  for (const link of links) {
    if (link.stockSyncPausedUntil && link.stockSyncPausedUntil > now) continue;
    // Stock is the business's data: its owner or an admin decides to share it.
    const user = await User.findOne({ id: link.userId }).lean();
    if (!user || user.businessId !== businessId || !["owner", "admin"].includes(user.role)) continue;
    if (!(await hasCurrentConsent(link.userId, "hordemart"))) continue;
    allowed.push(link);
  }
  return allowed;
}

// Absolute counts by SKU; two products sharing a code are added together.
function stockBySku(products) {
  const totals = new Map();
  for (const product of products) {
    const sku = cleanSku(product.sku);
    if (!sku || sku.length > 64) continue;
    totals.set(sku, (totals.get(sku) || 0) + computeStock(product));
  }
  return [...totals].map(([sku, quantity]) => ({ sku, quantity: Math.max(0, Math.floor(quantity)) }));
}

async function pushBusinessStock(businessId, { config = stockSyncConfig(), fetchImpl = fetch, now = new Date() } = {}) {
  if (!config.enabled) return { pushed: 0, reason: "not_configured" };
  const links = await pushingLinks(businessId, now);
  if (links.length === 0) return { pushed: 0, reason: "no_link" };

  const items = stockBySku(await liveProducts(businessId));
  if (items.length === 0) return { pushed: 0, reason: "no_skus" };

  let pushed = 0;
  const sites = [...new Map(links.map((link) => [link.siteId, link])).values()];
  for (const link of sites) {
    for (let i = 0; i < items.length; i += MAX_ITEMS_PER_MESSAGE) {
      const { status } = await pushStockToHordeMart({
        apiUrl: config.apiUrl,
        secret: config.secret,
        siteId: link.siteId,
        items: items.slice(i, i + MAX_ITEMS_PER_MESSAGE),
        sentAt: now,
        fetchImpl,
      });
      if (status === 409 || status === 404) {
        // Stock sync is off at HordeMart (or the store is gone): stop asking.
        await HordeMartLink.updateMany(
          { siteId: link.siteId, businessId },
          { $set: { stockSyncPausedUntil: new Date(now.getTime() + PAUSE_AFTER_REFUSAL_MS), updatedAt: now } }
        );
        break;
      }
      if (status >= 200 && status < 300) {
        pushed += 1;
        await HordeMartLink.updateMany({ siteId: link.siteId, businessId }, { $set: { lastStockPushAt: now } });
      } else {
        console.error(`[hordemart] stock push refused (${status}) for business ${businessId}`);
        break;
      }
    }
  }
  return { pushed };
}

const pending = new Map(); // businessId -> timer

// Called after any product write. Cheap when nothing is linked.
function noteProductChange(businessId) {
  if (!businessId || pending.has(businessId) || !stockSyncConfig().enabled) return;
  const timer = setTimeout(() => {
    pending.delete(businessId);
    pushBusinessStock(businessId).catch((err) => {
      console.error(`[hordemart] stock push failed for business ${businessId}:`, err?.name || "Error");
    });
  }, PUSH_DEBOUNCE_MS);
  timer.unref?.();
  pending.set(businessId, timer);
}

// Apply one paid HordeMart order. Returns what happened, per business.
async function applySale(io, event, { now = new Date() } = {}) {
  // Lazy: ai/companyData.js calls back into this module after product writes.
  const { commitMutation } = require("../ai/companyData");

  const links = await HordeMartLink.find({ siteId: event.siteId, hordemartRole: "owner" }).lean();
  const businessIds = [...new Set(links.map((link) => link.businessId))];
  const results = [];

  const wanted = new Map();
  for (const item of event.items) {
    const sku = cleanSku(item.sku);
    wanted.set(sku, (wanted.get(sku) || 0) + item.quantity);
  }
  const date = (event.paidAt ? new Date(event.paidAt) : now).toISOString().slice(0, 10);

  for (const businessId of businessIds) {
    const products = await liveProducts(businessId);
    const applied = [];
    const unknownSkus = [];
    for (const [sku, quantity] of wanted) {
      const product = products.find((p) => cleanSku(p.sku) === sku);
      if (!product) {
        unknownSkus.push(sku);
        continue;
      }
      // Deterministic id: applying the same order twice changes nothing.
      const entryId = `hordemart:${event.orderNumber}:${sku}`;
      const entries = Array.isArray(product.entries) ? product.entries : [];
      if (entries.some((e) => e.id === entryId)) continue;
      await commitMutation(io, businessId, "product", "update", {
        ...product,
        entries: [
          ...entries,
          { id: entryId, type: "offload", amount: quantity, date, note: `Sold on HordeMart — order ${event.orderNumber}` },
        ],
      });
      applied.push(sku);
    }
    results.push({ businessId, applied, unknownSkus });
  }
  return results;
}

module.exports = {
  stockSyncConfig,
  stockBySku,
  pushBusinessStock,
  noteProductChange,
  applySale,
};
