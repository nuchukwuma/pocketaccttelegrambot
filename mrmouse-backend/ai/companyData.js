// ai/companyData.js — the Mongo-backed equivalent of the bot's
// companyData.js. Reads come from EntitySnapshot (the durable
// current-state mirror server.js already maintains). Writes go through
// commitMutation(), which does exactly what server.js's SYNC_MUTATE
// handler does: broadcast SYNC_EVENT to the company room, persist a
// SyncEvent, and update EntitySnapshot. That's what makes an
// AI-originated write show up live on any other open device.

const { randomUUID } = require("crypto");
const EntitySnapshot = require("../models/EntitySnapshot");
const SyncEvent = require("../models/SyncEvent");

const ENTITY_TABLE = {
  product: "products",
  transaction: "transactions",
  settlement: "settlements",
  pendingOrder: "pendingOrders",
  invoice: "invoices",
  deadline: "deadlines",
};

async function fetchCompanyState(businessId) {
  const rows = await EntitySnapshot.find({ businessId, deleted: { $ne: true } }).lean();
  const state = { products: [], transactions: [], settlements: [], pendingOrders: [], invoices: [], deadlines: [] };
  for (const row of rows) {
    const table = ENTITY_TABLE[row.entity];
    if (table) state[table].push(row.payload);
  }
  return state;
}

// `cache`, when passed, is a plain object scoped to a single chat turn
// (created once in ai/agent.js per handleMessage/confirmPending call).
// Several tool calls can ask for company state within the same turn —
// caching the in-flight promise on it means one Mongo round trip covers
// all of them instead of one fetch per tool call. Nothing is cached
// across turns, since a write in between could change the data.
async function getCompanyState(businessId, cache) {
  if (cache) {
    if (!cache.statePromise) cache.statePromise = fetchCompanyState(businessId);
    return cache.statePromise;
  }
  return fetchCompanyState(businessId);
}

async function findProductByName(businessId, name) {
  const state = await getCompanyState(businessId);
  const product = state.products.find((p) => p.name?.toLowerCase() === name.toLowerCase()) || null;
  return { state, product };
}

// `io` is passed in per-call rather than required at module load, since
// this module has no access to the Socket.io server instance otherwise —
// the router wires it through (see routes/aiChat.js).
async function commitMutation(io, businessId, entity, action, record) {
  const id = record.id || randomUUID();
  // Every local Dexie query keys relayed entities by companyId. The normal
  // frontend mutation path stamps companyId before sending SYNC_MUTATE, but
  // AI writes originate on the server, so the server must stamp it here too.
  const payload = {
    ...record,
    id,
    companyId: businessId,
    updatedAt: new Date().toISOString(),
  };

  io.to(`company_${businessId}`).emit("SYNC_EVENT", { entity, action, payload });

  await SyncEvent.create({ businessId, entity, action, entityId: id, payload });

  const snapshotUpdate =
    action === "delete"
      ? { $set: { deleted: true, updatedAt: new Date() } }
      : { $set: { payload, deleted: false, updatedAt: new Date() } };

  await EntitySnapshot.findOneAndUpdate(
    { businessId, entity, entityId: id },
    snapshotUpdate,
    { upsert: true }
  );

  return { ok: true, id, payload };
}

// Mirrors adjustInventory() in Ledgercontext.jsx / the bot's companyData.js.
async function adjustInventory(io, businessId, productName, type, amount, date, note) {
  const name = (productName || "").trim();
  if (!name || !amount) return { ok: false, reason: "invalid_input" };

  const { product } = await findProductByName(businessId, name);
  const entry = { id: randomUUID(), type, amount: Number(amount), date, note: note || "" };

  if (product) {
    return commitMutation(io, businessId, "product", "update", {
      ...product,
      entries: [...(product.entries || []), entry],
    });
  }
  return commitMutation(io, businessId, "product", "create", {
    id: randomUUID(),
    name,
    description: "",
    createdAt: date,
    entries: [entry],
  });
}

// Mirrors addTransaction() — including the automatic inventory ripple for
// trade transactions with a product + quantity.
async function addTransaction(io, businessId, entry) {
  const id = randomUUID();
  const date = entry.date || new Date().toISOString().slice(0, 10);
  const result = await commitMutation(io, businessId, "transaction", "create", { ...entry, id, date });

  if (entry.category === "trade" && entry.productName && entry.quantity && !entry.skipInventory) {
    const moveType = entry.tradeType === "sale" ? "offload" : "load";
    await adjustInventory(
      io,
      businessId,
      entry.productName,
      moveType,
      entry.quantity,
      date,
      entry.tradeType === "sale"
        ? `Sold — ${entry.method === "credit" ? "credit" : entry.method}`
        : `Purchased — ${entry.method === "credit" ? "credit" : entry.method}`
    );
  }
  return result;
}

async function addSettlement(io, businessId, { party, type, amount, method, date }) {
  return commitMutation(io, businessId, "settlement", "create", {
    id: randomUUID(),
    party,
    type,
    amount,
    method: method || "cash",
    date: date || new Date().toISOString().slice(0, 10),
  });
}

async function addPendingOrder(io, businessId, { partyName, productName, quantity, type, note, date }) {
  return commitMutation(io, businessId, "pendingOrder", "create", {
    id: randomUUID(),
    partyName,
    productName,
    quantity,
    type,
    note: note || "",
    status: "pending",
    date: date || new Date().toISOString().slice(0, 10),
  });
}

module.exports = {
  ENTITY_TABLE,
  getCompanyState,
  findProductByName,
  commitMutation,
  adjustInventory,
  addTransaction,
  addSettlement,
  addPendingOrder,
};
