// db.js
// Dexie.js (IndexedDB) local-first store, matching the real domain model used
// throughout the app (Ledgercontext's transactions/products/settlements/
// pendingOrders/invoices) rather than a generic books/entries placeholder.

import Dexie from "dexie";

export const db = new Dexie("LedgerDB");

db.version(1).stores({
  // Singleton per company — primary key IS the companyId.
  business: "id",

  users: "id, businessId, email, role, updatedAt", // Local user store indexed by businessId
  products: "id, companyId, name, createdAt, updatedAt, deleted",
  transactions: "id, companyId, date, category, method, tradeType, invoiceId, updatedAt, deleted, [companyId+date]",
  settlements: "id, companyId, date, party, type, updatedAt, deleted",
  pendingOrders: "id, companyId, status, date, updatedAt, deleted",
  invoices: "id, companyId, invoiceNumber, date, updatedAt, deleted",

  // Local-only bookkeeping (never sent to the server as entities themselves).
  meta: "key", // e.g. { key: 'lastBootstrapAt:<companyId>', value: ISOString }
  outbox: "++localId, companyId, entity, action, id, createdAt", // queued mutations awaiting server ack
});

// v2: adds the `deadlines` table (bills/debtor/creditor due-date reminders).
// Only the new/changed store needs to be listed — Dexie carries every
// unchanged v1 store forward automatically, so existing local data on
// devices upgrading from v1 is preserved.
db.version(2).stores({
  deadlines: "id, companyId, type, status, dueDate, partyName, updatedAt, deleted",
});

// v3: images and per-business preferences.
//
//   images  Logos, product photos and receipts, stored as Blobs (see
//           ../media/images.js). `kind` says which. Synced as the
//           "image" entity, one message per image.
//   prefs   Per-business settings that follow the business to every
//           device: theme, dashboard layout, tutorial progress. Primary
//           key is `${companyId}:${key}`. Synced as the "pref" entity.
//
// New optional fields on existing records, set to null here so every
// row has the same shape:
//   products.imageId, transactions.receiptImageId,
//   business.logoImageId, business.brandColor
//
// The upgrade only fills in missing fields. It does not touch
// updatedAt, so upgrading a device does not re-sync every record, and
// a record written by an older device (field absent) still reads fine.
db.version(3)
  .stores({
    images: "id, companyId, kind, updatedAt, deleted",
    prefs: "id, companyId, key, updatedAt, deleted",
  })
  .upgrade(async (tx) => {
    const fill = (fields) => (record) => {
      for (const field of fields) if (record[field] === undefined) record[field] = null;
    };
    await tx.table("products").toCollection().modify(fill(["imageId"]));
    await tx.table("transactions").toCollection().modify(fill(["receiptImageId"]));
    await tx.table("business").toCollection().modify(fill(["logoImageId", "brandColor"]));
  });

export function stampRecord(record, { isNew = false } = {}) {
  const now = new Date().toISOString();
  return {
    ...record,
    id: record.id || crypto.randomUUID(),
    createdAt: isNew ? now : record.createdAt || now,
    updatedAt: now,
    deleted: record.deleted ?? false,
  };
}

export async function upsertLocal(table, record) {
  return db.table(table).put(record);
}

export async function softDeleteLocal(table, id) {
  const existing = await db.table(table).get(id);
  if (!existing) return;
  return db.table(table).put({ ...existing, deleted: true, updatedAt: new Date().toISOString() });
}

export async function bulkHydrate(table, records) {
  if (!records?.length) return;
  await db.table(table).bulkPut(records);
}

export async function queueOutbox({ companyId, entity, action, id, payload }) {
  return db.table("outbox").add({ companyId, entity, action, id, payload, createdAt: new Date().toISOString() });
}

export async function clearOutboxItem(localId) {
  return db.table("outbox").delete(localId);
}

export async function getPendingOutbox(companyId) {
  return db.table("outbox").where("companyId").equals(companyId).sortBy("createdAt");
}

export default db;