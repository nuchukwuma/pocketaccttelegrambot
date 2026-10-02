// services/durableWrite.js
//
// SyncEvent and EntitySnapshot are the durable backstop for the whole sync
// system (see server.js's SYNC_MUTATE handler) — but until now, both writes
// were pure fire-and-forget: kicked off without awaiting, with failure
// handled only by `.catch(err => console.error(...))`. A transient Mongo
// blip at exactly the wrong moment meant the backstop copy silently never
// got written, even though the live SYNC_EVENT broadcast to peers had
// already succeeded — the one gap the backstop exists to cover was itself
// unguarded.
//
// This wraps a write with bounded retries (exponential backoff) and, if
// every attempt still fails, records it in FailedWrite instead of only
// logging — so a persistence failure is discoverable and replayable from
// the stored `operation` payload, never just lost in a scrolling log.
const FailedWrite = require("../models/FailedWrite");

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 200;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `attemptFn`, retrying on failure with exponential backoff. If every
 * attempt fails, persists the failure to FailedWrite for later inspection
 * or replay rather than only logging it.
 *
 * @param {string} collectionName - label for FailedWrite, e.g. "SyncEvent"
 * @param {string} businessId
 * @param {Object} operationDescription - the args being written, kept for replay/inspection
 * @param {() => Promise<any>} attemptFn - performs one write attempt
 */
async function durableWrite(collectionName, businessId, operationDescription, attemptFn) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await attemptFn();
    } catch (err) {
      lastErr = err;
      console.error(`[durableWrite] ${collectionName} attempt ${attempt}/${MAX_ATTEMPTS} failed for ${businessId}`, err);
      if (attempt < MAX_ATTEMPTS) await sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
    }
  }

  try {
    await FailedWrite.create({
      collection: collectionName,
      businessId,
      operation: operationDescription,
      error: String(lastErr?.message || lastErr),
      attempts: MAX_ATTEMPTS,
    });
  } catch (deadLetterErr) {
    // If even the dead-letter write fails, this is the last line of
    // defense left — surface it as loudly as possible.
    console.error(`[durableWrite] FailedWrite itself failed to persist for ${businessId}`, deadLetterErr);
  }
}

module.exports = { durableWrite };