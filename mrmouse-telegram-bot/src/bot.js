import { Telegraf, Markup } from "telegraf";
import dotenv from "dotenv";
dotenv.config();

import { linkChat, unlinkChat, getCompanyIdForChat, consumePairingCode } from "./db.js";
import { handleMessage, confirmPending, cancelPending } from "./ai/agent.js";
import { ensureConnection, connectionStatus, SYNC_MODE, isLiveMode } from "./socketPeer.js";
import { fetchBusiness } from "./business.js";
import { checkFeature } from "./entitlements.js";
import {
  getCompanyState,
  findProductByName,
  adjustInventory,
  addTransaction,
  addSettlement,
  addPendingOrder,
  fulfillPendingOrder,
} from "./companyData.js";
import {
  computeStock,
  buildPostings,
  buildAccounts,
  computePnl,
  computeDebtorsCreditors,
  computeCashBank,
  money,
} from "./ledger.js";

export const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

const ALLOWED_IDS = (process.env.ALLOWED_TELEGRAM_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

bot.use(async (ctx, next) => {
  if (ALLOWED_IDS.length && !ALLOWED_IDS.includes(String(ctx.from?.id))) {
    return ctx.reply(`Not authorized. Your Telegram ID is ${ctx.from?.id} — add it to ALLOWED_TELEGRAM_IDS to use this bot.`);
  }
  return next();
});

function splitArgs(text, command) {
  const rest = text.slice(command.length).trim();
  if (!rest) return [];
  return rest.split("|").map((s) => s.trim());
}

async function requireCompany(ctx) {
  const companyId = await getCompanyIdForChat(ctx.chat.id);
  if (!companyId) {
    await ctx.reply(
      "This chat isn't linked yet.\n\nOpen the mrmouse app dashboard, go to settings → Connect Telegram, and send me the 6-digit code with:\n/link 123456"
    );
    return null;
  }

  // Server-side hardstop — checked here, not in the frontend, so it
  // can't be bypassed by talking to this bot directly regardless of
  // what the dashboard shows.
  const feature = await checkFeature(companyId, "telegram");
  if (!feature.ok) {
    await ctx.reply(feature.message);
    return null;
  }

  ensureConnection(companyId); // make sure the peer connection is warm
  return companyId;
}

function ledgerFrom(state) {
  const postings = buildPostings(state.transactions, state.settlements);
  const accounts = buildAccounts(postings);
  return accounts;
}

async function requireState(ctx, companyId) {
  const state = await getCompanyState(companyId);
  if (!state) {
    await ctx.reply(
      isLiveMode()
        ? "No online device responded in time. Open the app on any device and try again."
        : "Couldn't read data right now — try again in a moment."
    );
    return null;
  }
  return state;
}

// ---------- commands ----------

bot.start((ctx) =>
  ctx.reply(
    "mrmouse ledger bot.\n\n" +
      "Link this chat from the app dashboard (settings → Connect Telegram), then send:\n" +
      "/link 123456\n\n" +
      "Then /help for everything else."
  )
);

bot.help((ctx) =>
  ctx.reply(
    [
      "/link CODE — link this chat using the code shown in the dashboard",
      "/unlink — unlink this chat",
      "/whoami — show what this chat is linked to, and sync mode",
      "/business — show linked business info",
      "/stock [ProductName] — check inventory (all products if no name)",
      "/addstock Product | Qty | load/offload | Note(optional) — adjust stock",
      "/sale Product | Qty | Amount | cash/bank/credit | Party(optional)",
      "/purchase Product | Qty | Amount | cash/bank/credit | Party(optional)",
      "/expense Amount | cash/bank | Description — running expense",
      "/pettycash Amount | Description — petty cash expense",
      "/balance — cash, bank, debtors, creditors, net profit",
      "/debtors — who owes you",
      "/creditors — who you owe",
      "/pending — pending orders",
      "/fulfil OrderId — mark a pending order as fulfilled",
      "",
      "Or just tell me in plain English — \"I sold 20 pieces of gold\", \"how much silver do I have\", \"what's Peter's account look like\". I'll ask if I need more details, and confirm before recording anything. (AI assistant is a separate ₦1,000/month add-on — subscribe from Settings → AI.)",
    ].join("\n")
  )
);

bot.command("link", async (ctx) => {
  const args = splitArgs(ctx.message.text, "/link");
  if (args.length < 1) return ctx.reply("Usage: /link 123456 (the code shown in the dashboard)");
  const result = await consumePairingCode(args[0]);
  if (!result.ok) {
    const reasons = {
      not_found: "That code doesn't exist. Generate a new one from the dashboard.",
      used: "That code has already been used. Generate a new one.",
      expired: "That code expired. Generate a new one from the dashboard.",
    };
    return ctx.reply(reasons[result.reason] || "Couldn't link with that code.");
  }
  await linkChat(ctx.chat.id, result.companyId);
  ensureConnection(result.companyId);
  ctx.reply(`Linked. This chat is now connected to your business (mode: ${SYNC_MODE}).`);
});

bot.command("unlink", async (ctx) => {
  await unlinkChat(ctx.chat.id);
  ctx.reply("Unlinked. Use /link CODE to connect again.");
});

bot.command("whoami", async (ctx) => {
  const companyId = await getCompanyIdForChat(ctx.chat.id);
  if (!companyId) return ctx.reply("Not linked. Use /link CODE.");
  ctx.reply(`companyId: ${companyId}\nMode: ${SYNC_MODE}\nConnection: ${connectionStatus(companyId)}`);
});

bot.command("business", async (ctx) => {
  const companyId = await requireCompany(ctx);
  if (!companyId) return;
  const b = await fetchBusiness(companyId);
  if (!b) return ctx.reply("No business record found.");
  ctx.reply(
    [
      `Name: ${b.name || b.businessName || "—"}`,
      `Location: ${b.location || b.address || "—"}`,
      `Contact: ${b.contact || b.phone || "—"}`,
      `Industry: ${b.industry || "—"}`,
      `Email: ${b.email || "—"}`,
    ].join("\n")
  );
});

bot.command("stock", async (ctx) => {
  const companyId = await requireCompany(ctx);
  if (!companyId) return;
  const args = splitArgs(ctx.message.text, "/stock");

  if (args.length === 0) {
    const state = await requireState(ctx, companyId);
    if (!state) return;
    if (!state.products.length) return ctx.reply("No products yet.");
    ctx.reply(state.products.map((p) => `${p.name}: ${computeStock(p)}`).join("\n"));
    return;
  }

  const { state, product } = await findProductByName(companyId, args[0]);
  if (!state) return ctx.reply(isLiveMode() ? "No online device responded in time." : "Couldn't read data right now.");
  if (!product) return ctx.reply(`No product named "${args[0]}".`);
  ctx.reply(`${product.name}: ${computeStock(product)} in stock`);
});

bot.command("addstock", async (ctx) => {
  const companyId = await requireCompany(ctx);
  if (!companyId) return;
  const args = splitArgs(ctx.message.text, "/addstock");
  if (args.length < 3) return ctx.reply("Usage: /addstock Product | Qty | load/offload | Note(optional)");
  const [productName, qty, type, note] = args;
  if (!["load", "offload"].includes(type)) return ctx.reply('Type must be "load" or "offload".');

  const result = await adjustInventory(companyId, productName, type, Number(qty), new Date().toISOString().slice(0, 10), note);
  if (!result.ok) return ctx.reply(writeFailureMessage(result));
  ctx.reply(
    `Stock updated: ${productName} ${type === "load" ? "+" : "-"}${qty}` +
      (result.queued ? " (queued — will sync once a device is online)" : "")
  );
});

bot.command("sale", (ctx) => tradeCommand(ctx, "sale"));
bot.command("purchase", (ctx) => tradeCommand(ctx, "purchase"));

async function tradeCommand(ctx, tradeType) {
  const companyId = await requireCompany(ctx);
  if (!companyId) return;
  const args = splitArgs(ctx.message.text, `/${tradeType}`);
  if (args.length < 4) {
    return ctx.reply(`Usage: /${tradeType} Product | Qty | Amount | cash/bank/credit | Party(optional)`);
  }
  const [productName, qty, amount, method, party] = args;
  if (!["cash", "bank", "credit"].includes(method)) return ctx.reply("Method must be cash, bank, or credit.");
  if (method === "credit" && !party) return ctx.reply("A party name is required for credit transactions.");

  const result = await addTransaction(companyId, {
    category: "trade",
    tradeType,
    method,
    productName,
    quantity: Number(qty),
    amount: Number(amount),
    party: party || null,
    description: `${tradeType} of ${productName}`,
  });
  if (!result.ok) return ctx.reply(writeFailureMessage(result));
  ctx.reply(
    `Recorded ${tradeType}: ${qty} × ${productName} for ${money(amount)} (${method}).` +
      (result.queued ? " (queued — will sync once a device is online)" : "")
  );
}

bot.command("expense", async (ctx) => {
  const companyId = await requireCompany(ctx);
  if (!companyId) return;
  const args = splitArgs(ctx.message.text, "/expense");
  if (args.length < 3) return ctx.reply("Usage: /expense Amount | cash/bank | Description");
  const [amount, method, description] = args;
  if (!["cash", "bank"].includes(method)) return ctx.reply("Method must be cash or bank.");
  const result = await addTransaction(companyId, { category: "runningExpense", method, amount: Number(amount), description });
  if (!result.ok) return ctx.reply(writeFailureMessage(result));
  ctx.reply(`Recorded expense: ${money(amount)} (${method}) — ${description}`);
});

bot.command("pettycash", async (ctx) => {
  const companyId = await requireCompany(ctx);
  if (!companyId) return;
  const args = splitArgs(ctx.message.text, "/pettycash");
  if (args.length < 2) return ctx.reply("Usage: /pettycash Amount | Description");
  const [amount, description] = args;
  const result = await addTransaction(companyId, { category: "smallExpense", amount: Number(amount), description });
  if (!result.ok) return ctx.reply(writeFailureMessage(result));
  ctx.reply(`Recorded petty cash: ${money(amount)} — ${description}`);
});

bot.command("balance", async (ctx) => {
  const companyId = await requireCompany(ctx);
  if (!companyId) return;
  const state = await requireState(ctx, companyId);
  if (!state) return;
  const accounts = ledgerFrom(state);
  const { cash, bank, pettyCash } = computeCashBank(accounts);
  const pnl = computePnl(accounts);
  const { debtors, creditors } = computeDebtorsCreditors(accounts);
  ctx.reply(
    [
      `Cash: ${money(cash)}`,
      `Bank: ${money(bank)}`,
      `Petty cash: ${money(pettyCash)}`,
      `Owed to you (debtors): ${money(debtors.reduce((s, d) => s + d.balance, 0))}`,
      `You owe (creditors): ${money(creditors.reduce((s, c) => s + c.balance, 0))}`,
      `Net profit: ${money(pnl.netProfit)}`,
    ].join("\n")
  );
});

bot.command("debtors", async (ctx) => {
  const companyId = await requireCompany(ctx);
  if (!companyId) return;
  const state = await requireState(ctx, companyId);
  if (!state) return;
  const { debtors } = computeDebtorsCreditors(ledgerFrom(state));
  if (!debtors.length) return ctx.reply("No outstanding debtors.");
  ctx.reply(debtors.map((d) => `${d.name}: ${money(d.balance)}`).join("\n"));
});

bot.command("creditors", async (ctx) => {
  const companyId = await requireCompany(ctx);
  if (!companyId) return;
  const state = await requireState(ctx, companyId);
  if (!state) return;
  const { creditors } = computeDebtorsCreditors(ledgerFrom(state));
  if (!creditors.length) return ctx.reply("No outstanding creditors.");
  ctx.reply(creditors.map((c) => `${c.name}: ${money(c.balance)}`).join("\n"));
});

bot.command("pending", async (ctx) => {
  const companyId = await requireCompany(ctx);
  if (!companyId) return;
  const state = await requireState(ctx, companyId);
  if (!state) return;
  if (!state.pendingOrders.length) return ctx.reply("No pending orders.");
  ctx.reply(
    state.pendingOrders
      .map((o) => `[${o.status === "fulfilled" ? "done" : "open"}] ${o.id.slice(0, 8)} — ${o.quantity} × ${o.productName} — ${o.partyName} (${o.type})`)
      .join("\n")
  );
});

bot.command("fulfil", async (ctx) => {
  const companyId = await requireCompany(ctx);
  if (!companyId) return;
  const args = splitArgs(ctx.message.text, "/fulfil");
  if (!args.length) return ctx.reply("Usage: /fulfil OrderId (use the short id shown in /pending)");
  const state = await requireState(ctx, companyId);
  if (!state) return;
  const match = state.pendingOrders.find((o) => o.id.startsWith(args[0]));
  if (!match) return ctx.reply("No matching order found. Check /pending for the id.");
  const result = await fulfillPendingOrder(companyId, match);
  if (!result.ok) return ctx.reply(writeFailureMessage(result));
  ctx.reply(`Marked "${match.productName}" for ${match.partyName} as fulfilled.`);
});

// ---------- natural-language AI mode (anything that isn't a slash command) ----------

bot.on("text", async (ctx) => {
  const text = ctx.message.text.trim();
  if (text.startsWith("/")) {
    return ctx.reply("Unknown command. Send /help for the list of commands.");
  }

  const companyId = await requireCompany(ctx); // telegram entitlement + link check, same as every command
  if (!companyId) return;

  // Separate gate — AI is its own paid add-on with no trial window,
  // independent of whether Telegram itself is entitled.
  const aiFeature = await checkFeature(companyId, "ai");
  if (!aiFeature.ok) return ctx.reply(aiFeature.message);

  await ctx.sendChatAction("typing").catch(() => {});

  let result;
  try {
    result = await handleMessage(ctx.chat.id, companyId, text);
  } catch (err) {
    console.error(`[ai] ${companyId}`, err);
    return ctx.reply("Something went wrong understanding that — try rephrasing, or use a /command instead.");
  }

  if (result.confirm) {
    return ctx.reply(
      result.text,
      Markup.inlineKeyboard([
        Markup.button.callback("✅ Confirm", "ai_confirm"),
        Markup.button.callback("❌ Cancel", "ai_cancel"),
      ])
    );
  }
  return ctx.reply(result.text);
});

bot.action("ai_confirm", async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  await ctx.editMessageReplyMarkup(undefined).catch(() => {});

  const companyId = await getCompanyIdForChat(ctx.chat.id);
  if (!companyId) return ctx.reply("This chat isn't linked. Use /link CODE.");

  const aiFeature = await checkFeature(companyId, "ai");
  if (!aiFeature.ok) return ctx.reply(aiFeature.message);

  let result;
  try {
    result = await confirmPending(ctx.chat.id, companyId);
  } catch (err) {
    console.error(`[ai confirm] ${companyId}`, err);
    return ctx.reply("Couldn't save that — try again in a moment.");
  }
  ctx.reply(result.text);
});

bot.action("ai_cancel", async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  await ctx.editMessageReplyMarkup(undefined).catch(() => {});
  const result = await cancelPending(ctx.chat.id);
  ctx.reply(result.text || "Cancelled.");
});

function writeFailureMessage(result) {
  if (result.reason === "no_online_source") {
    return "No online device to read current data from — try again when the app is open somewhere.";
  }
  if (result.reason === "not_connected") {
    return "Not connected to the app's server right now, and live mode doesn't queue writes — try again shortly.";
  }
  return "Couldn't save that — try again in a moment.";
}