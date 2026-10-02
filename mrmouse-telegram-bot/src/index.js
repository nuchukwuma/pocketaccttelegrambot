import dotenv from "dotenv";
dotenv.config();

import { initSchema, listLinkedCompanyIds, startTombstoneCleanupWorker } from "./db.js";
import { ensureConnection, SYNC_MODE } from "./socketPeer.js";
import { startServer } from "./server.js";
import { bot } from "./bot.js";
import { startMonthlyStatementWorker } from "./monthlyStatementWorker.js";
import { startReminderWorker } from "./reminderWorker.js";
import { startDeviceNudgeWorker } from "./deviceNudgeWorker.js";

async function main() {
  await initSchema();

  // Reconnect as a peer for every company that already has a linked chat,
  // so cache mode stays warm even across a bot restart.
  const companyIds = await listLinkedCompanyIds();
  companyIds.forEach((companyId) => ensureConnection(companyId));

  startServer();
  startMonthlyStatementWorker();
  startReminderWorker();
  startDeviceNudgeWorker();
  startTombstoneCleanupWorker(30); // keep soft-deleted rows for a month, then free the space
  await bot.launch();

  console.log(`mrmouse telegram bot running (mode: ${SYNC_MODE}, ${companyIds.length} companies reconnected)`);
}

main().catch((err) => {
  console.error("Failed to start bot:", err);
  process.exit(1);
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));