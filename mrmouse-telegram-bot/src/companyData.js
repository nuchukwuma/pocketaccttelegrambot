import { listEntities } from "./db.js";
import { isLiveMode, requestState, emitMutate } from "./socketPeer.js";

const TABLE_OF = {
  product: "products",
  transaction: "transactions",
  settlement: "settlements",
  pendingOrder: "pendingOrders",
  invoice: "invoices",
  deadline: "deadlines",
};

// Returns { products, transactions, settlements, pendingOrders, invoices,
// deadlines } for a company, sourced from Turso (cache mode) or a fresh
// live snapshot (live mode). Returns null in live mode if nothing
// responded in time.
async function fetchCompanyState(companyId) {
  if (isLiveMode()) {
    const entities = await requestState(companyId, null);
    if (!entities) return null;
    return {
      products: (entities.products || []).filter((r) => !r.deleted),
      transactions: (entities.transactions || []).filter((r) => !r.deleted),
      settlements: (entities.settlements || []).filter((r) => !r.deleted),
      pendingOrders: (entities.pendingOrders || []).filter((r) => !r.deleted),
      invoices: (entities.invoices || []).filter((r) => !r.deleted),
      deadlines: (entities.deadlines || []).filter((r) => !r.deleted),
    };
  }

  const [products, transactions, settlements, pendingOrders, invoices, deadlines] = await Promise.all([
    listEntities(companyId, "product"),
    listEntities(companyId, "transaction"),
    listEntities(companyId, "settlement"),
    listEntities(companyId, "pendingOrder"),
    listEntities(companyId, "invoice"),
    listEntities(companyId, "deadline"),
  ]);
  return { products, transactions, settlements, pendingOrders, invoices, deadlines };
}

// `cache`, when passed, is a plain object scoped to a single chat turn
// (created once in ai/agent.js per handleMessage/confirmPending call).
// A turn can involve several tool calls, each of which used to trigger
// its own full state fetch (a live-mode round trip over the socket peer,
// or 6 parallel Turso queries) — caching the in-flight promise means one
// fetch covers every tool call in that turn instead of one fetch each.
export async function getCompanyState(companyId, cache) {
  if (cache) {
    if (!cache.statePromise) cache.statePromise = fetchCompanyState(companyId);
    return cache.statePromise;
  }
  return fetchCompanyState(companyId);
}

export async function findProductByName(companyId, name) {
  const state = await getCompanyState(companyId);
  if (!state) return { state: null, product: null };
  const product = state.products.find((p) => p.name?.toLowerCase() === name.toLowerCase()) || null;
  return { state, product };
}

// Mirrors adjustInventory() in Ledgercontext.jsx exactly: rewrites the
// WHOLE product record with an appended entry, rather than a separate
// movements table — that's the shape the app itself sends over the wire.
export async function adjustInventory(companyId, productName, type, amount, date, note) {
  const name = (productName || "").trim();
  if (!name || !amount) return { ok: false, reason: "invalid_input" };

  const { state, product } = await findProductByName(companyId, name);
  if (!state) return { ok: false, reason: "no_online_source" };

  const entry = { id: crypto.randomUUID(), type, amount: Number(amount), date, note: note || "" };

  if (product) {
    return emitMutate(companyId, "product", "update", {
      ...product,
      entries: [...(product.entries || []), entry],
    });
  }
  return emitMutate(companyId, "product", "create", {
    name,
    description: "",
    createdAt: date,
    entries: [entry],
  });
}

// Mirrors addTransaction() in Ledgercontext.jsx, including the automatic
// inventory ripple for trade transactions with a product + quantity.
export async function addTransaction(companyId, entry) {
  const date = entry.date || new Date().toISOString().slice(0, 10);
  const result = await emitMutate(companyId, "transaction", "create", { ...entry, date });
  if (!result.ok) return result;

  if (entry.category === "trade" && entry.productName && entry.quantity && !entry.skipInventory) {
    const moveType = entry.tradeType === "sale" ? "offload" : "load";
    await adjustInventory(
      companyId,
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

export async function addSettlement(companyId, { party, type, amount, method, date }) {
  return emitMutate(companyId, "settlement", "create", {
    party,
    type,
    amount,
    method: method || "cash",
    date: date || new Date().toISOString().slice(0, 10),
  });
}

export async function addPendingOrder(companyId, { partyName, productName, quantity, type, note, date }) {
  return emitMutate(companyId, "pendingOrder", "create", {
    partyName,
    productName,
    quantity,
    type,
    note: note || "",
    status: "pending",
    date: date || new Date().toISOString().slice(0, 10),
  });
}

export async function fulfillPendingOrder(companyId, order) {
  return emitMutate(companyId, "pendingOrder", "update", { ...order, status: "fulfilled" });
}

export { TABLE_OF };
