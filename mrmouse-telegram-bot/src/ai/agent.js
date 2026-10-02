// The natural-language AI layer used by Telegram.
//
// Provider selection:
//   - Premium AI add-on active -> Claude (existing paid AI)
//   - Otherwise -> Gemini free tier
//
// The same TOOLS and companyData write functions are used for both providers.
// Gemini is deliberately kept server-side; the API key never reaches Telegram
// users or the browser.

import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";
dotenv.config();

import { TOOLS, WRITE_TOOLS, runReadTool } from "./tools.js";
import { addTransaction, addSettlement, addPendingOrder } from "../companyData.js";
import { generateGemini, isGeminiConfigured } from "./gemini.js";
import { matchFastPath, formatReadResult } from "./fastPath.js";

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

const SERVER_URL = process.env.MAIN_APP_SERVER_URL || "http://localhost:5000";
const CLAUDE_MODEL = process.env.AI_MODEL || "claude-sonnet-5";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const FREE_DAILY_LIMIT = Math.max(1, Number(process.env.GEMINI_FREE_DAILY_REQUESTS) || 20);
const FREE_MAX_READ_ROWS = Math.max(10, Number(process.env.GEMINI_FREE_MAX_READ_ROWS) || 100);
const MAX_STEPS = 6;

const SYSTEM_PROMPT = `You are the bookkeeping assistant inside the mrmouse Telegram bot for a Nigerian small business. Currency is Naira (₦). This is a chat interface — keep replies short and natural, not report-style.

You have read tools (call freely, no confirmation needed) and write tools (record_sale, record_purchase, add_debtor, record_settlement, add_pending_order, record_expense, record_petty_expense). A write tool call only PROPOSES an action — the system shows the user a Confirm/Cancel button separately.

Rules:
- Never call a write tool until you have all its required fields. If quantity, amount, or payment method is missing or ambiguous, ask a short clarifying question in plain text instead of calling the tool.
- "amount" for record_sale/record_purchase is always the TOTAL, not a unit price — if the user gives a unit price, multiply it yourself before calling the tool.
- record_expense is for a running business expense paid from the main cash or bank balance (needs a method). record_petty_expense is for small day-to-day spend out of the petty cash float (no method — it's always petty cash). If the user just says "expense" or "spent" without saying it came from petty cash, use record_expense and ask cash or bank.
- If get_party_account or get_last_transaction_for_party returns "ambiguous" with candidates, ask the user which one they meant. Never guess a name.
- Call at most one write tool per turn. Never claim a bulk write was completed if only one item has been proposed or saved.
- If a tool result contains an "error", relay the problem to the user in plain language rather than trying again blindly.
- If a tool result contains "limited": true, clearly tell the user that the free AI returned only part of the database result. Do not pretend it is complete.`;

const sessions = new Map();
const freeUsage = new Map(); // companyId -> { day, used }

function getSession(chatId) {
  const existing = sessions.get(chatId);
  if (existing && existing.expiresAt > Date.now()) return existing;
  const fresh = {
    messages: [],
    geminiContents: [],
    provider: null,
    pendingToolName: null,
    pendingToolInput: null,
    pendingCallId: null,
    pendingFunctionName: null,
    expiresAt: 0,
  };
  sessions.set(chatId, fresh);
  return fresh;
}

function touch(session) {
  session.expiresAt = Date.now() + 15 * 60 * 1000;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function consumeFreeRequest(companyId) {
  const day = todayKey();
  const current = freeUsage.get(companyId);
  if (!current || current.day !== day) {
    const next = { day, used: 1 };
    freeUsage.set(companyId, next);
    return { ok: true, used: 1, remaining: Math.max(0, FREE_DAILY_LIMIT - 1), limit: FREE_DAILY_LIMIT };
  }
  if (current.used >= FREE_DAILY_LIMIT) {
    return { ok: false, used: current.used, remaining: 0, limit: FREE_DAILY_LIMIT };
  }
  current.used += 1;
  return { ok: true, used: current.used, remaining: Math.max(0, FREE_DAILY_LIMIT - current.used), limit: FREE_DAILY_LIMIT };
}

async function isPremiumAi(companyId) {
  try {
    const res = await fetch(
      `${SERVER_URL}/api/billing/status?companyId=${encodeURIComponent(companyId)}`,
      {
        headers: {
          "x-bot-api-key": process.env.BOT_API_KEY || "",
          "Content-Type": "application/json",
        },
      }
    );
    if (!res.ok) return false;
    const data = await res.json();
    return Boolean(data?.ai || data?.addOns?.ai);
  } catch (err) {
    console.error(`[${companyId}] AI provider lookup failed`, err);
    return false;
  }
}

async function resolveProvider(companyId) {
  const premium = await isPremiumAi(companyId);
  if (premium) {
    return { provider: "claude", tier: "premium", model: CLAUDE_MODEL };
  }
  return { provider: "gemini", tier: "free", model: GEMINI_MODEL };
}

setInterval(() => {
  const now = Date.now();
  for (const [chatId, session] of sessions) {
    if (session.expiresAt < now) sessions.delete(chatId);
  }
  // Keep the quota map bounded to active businesses/days.
  const day = todayKey();
  for (const [companyId, usage] of freeUsage) {
    if (usage.day !== day) freeUsage.delete(companyId);
  }
}, 10 * 60 * 1000).unref?.();

function describeProposal(name, input) {
  const naira = (n) => `₦${Number(n || 0).toLocaleString()}`;
  switch (name) {
    case "record_sale":
      return `Record sale: ${input.quantity} × ${input.productName} for ${naira(input.amount)} (${input.method}${input.party ? ", " + input.party : ""})?`;
    case "record_purchase":
      return `Record purchase: ${input.quantity} × ${input.productName} for ${naira(input.amount)} (${input.method}${input.party ? ", " + input.party : ""})?`;
    case "add_debtor":
      return `Add debtor: ${input.party} owes ${naira(input.amount)}?`;
    case "record_settlement":
      return `Record ${input.type === "debtor" ? "payment received from" : "payment made to"} ${input.party}: ${naira(input.amount)} (${input.method || "cash"})?`;
    case "add_pending_order":
      return `Add pending order: ${input.quantity} × ${input.productName} — ${input.type} for ${input.partyName}${input.note ? " (" + input.note + ")" : ""}?`;
    case "record_expense":
      return `Record expense: ${naira(input.amount)} (${input.method}) — ${input.description}?`;
    case "record_petty_expense":
      return `Record petty cash expense: ${naira(input.amount)} — ${input.description}${input.party ? " (paid to " + input.party + ")" : ""}?`;
    default:
      return "Confirm this action?";
  }
}

async function executeWriteTool(companyId, name, input) {
  switch (name) {
    case "record_sale":
    case "record_purchase": {
      const tradeType = name === "record_sale" ? "sale" : "purchase";
      if (input.method === "credit" && !input.party) return { ok: false, reason: "party_required" };
      return addTransaction(companyId, {
        category: "trade",
        tradeType,
        method: input.method,
        productName: input.productName,
        quantity: Number(input.quantity),
        amount: Number(input.amount),
        party: input.party || null,
        description: `${tradeType} of ${input.productName}`,
      });
    }

    case "add_debtor":
      return addTransaction(companyId, {
        category: "trade",
        tradeType: "sale",
        method: "credit",
        productName: "Manual balance",
        quantity: 0,
        amount: Number(input.amount),
        party: input.party,
        description: `Opening/manual balance for ${input.party}`,
        skipInventory: true,
      });

    case "record_settlement":
      return addSettlement(companyId, {
        party: input.party,
        type: input.type,
        amount: Number(input.amount),
        method: input.method || "cash",
      });

    case "add_pending_order":
      return addPendingOrder(companyId, {
        partyName: input.partyName,
        productName: input.productName,
        quantity: Number(input.quantity),
        type: input.type,
        note: input.note,
      });

    case "record_expense":
      return addTransaction(companyId, {
        category: "runningExpense",
        method: input.method,
        amount: Number(input.amount),
        description: input.description,
      });

    case "record_petty_expense":
      return addTransaction(companyId, {
        category: "smallExpense",
        method: "pettyCash",
        amount: Number(input.amount),
        description: input.description,
        party: input.party || null,
      });

    default:
      return { ok: false, reason: "unknown_tool" };
  }
}

function writeResultMessage(result) {
  if (result.ok) return "Done — recorded.";
  if (result.reason === "party_required") return "A party name is required for credit transactions — who was it?";
  return "Couldn't save that — try again in a moment.";
}

async function runClaudeLoop(session, companyId) {
  if (!anthropic) return { text: "Premium Claude AI is not configured on the server." };

  // Scoped to this one turn's loop (up to MAX_STEPS): every read tool call
  // made across those steps shares the same fetched company state instead
  // of each one re-fetching it (a live-mode round trip, or 6 Turso reads).
  const stateCache = {};

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages: session.messages,
    });

    session.messages.push({ role: "assistant", content: response.content });

    const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");
    if (!toolUseBlocks.length) {
      const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
      return { text: text || "OK." };
    }

    const writeCall = toolUseBlocks.find((b) => WRITE_TOOLS.has(b.name));
    if (writeCall) {
      session.pendingCallId = writeCall.id;
      session.pendingToolName = writeCall.name;
      session.pendingToolInput = writeCall.input;
      return { text: describeProposal(writeCall.name, writeCall.input), confirm: true, provider: "claude" };
    }

    // Claude can ask for several read tools in one step — run them
    // concurrently instead of awaiting one at a time.
    const results = await Promise.all(
      toolUseBlocks.map((block) => runReadTool(companyId, block.name, block.input, { stateCache }))
    );
    const toolResults = toolUseBlocks.map((block, i) => ({
      type: "tool_result",
      tool_use_id: block.id,
      content: JSON.stringify(results[i]),
    }));
    session.messages.push({ role: "user", content: toolResults });
  }

  return { text: "I'm having trouble finishing that — try rephrasing?" };
}

function appendGeminiFunctionResponses(session, responses) {
  session.geminiContents.push({
    role: "user",
    parts: responses.map(({ name, response }) => ({
      functionResponse: { name, response },
    })),
  });
}

async function runGeminiLoop(session, companyId, { consumeQuota = false } = {}) {
  if (!isGeminiConfigured()) {
    return { text: "Free Gemini AI is not configured on the bot server yet." };
  }

  if (consumeQuota) {
    const quota = consumeFreeRequest(companyId);
    if (!quota.ok) {
      return {
        text: `You've reached the free Gemini AI limit for today (${quota.limit} requests for this business). Your records are safe. Try again tomorrow or upgrade to Premium AI for higher availability and larger workloads.`,
        limited: true,
        quota,
        provider: "gemini",
      };
    }
  }

  const stateCache = {};

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await generateGemini({
      contents: session.geminiContents,
      systemPrompt: SYSTEM_PROMPT,
      tools: TOOLS,
      model: GEMINI_MODEL,
      maxOutputTokens: 1000,
    });

    session.geminiContents.push(response.content);

    if (!response.functionCalls.length) {
      const text = response.parts.filter((p) => p.text).map((p) => p.text).join("\n").trim();
      return { text: text || "OK.", provider: "gemini" };
    }

    const writeCall = response.functionCalls.find((call) => WRITE_TOOLS.has(call.name));
    if (writeCall) {
      session.pendingCallId = writeCall.id;
      session.pendingFunctionName = writeCall.name;
      session.pendingToolName = writeCall.name;
      session.pendingToolInput = writeCall.input;
      return { text: describeProposal(writeCall.name, writeCall.input), confirm: true, provider: "gemini" };
    }

    const results = await Promise.all(
      response.functionCalls.map((call) =>
        runReadTool(companyId, call.name, call.input, { maxRows: FREE_MAX_READ_ROWS, stateCache })
      )
    );
    const responses = response.functionCalls.map((call, i) => ({ name: call.name, response: results[i] }));
    appendGeminiFunctionResponses(session, responses);
  }

  return { text: "I'm having trouble finishing that — try rephrasing?", provider: "gemini" };
}

function clearPending(session) {
  session.pendingToolName = null;
  session.pendingToolInput = null;
  session.pendingCallId = null;
  session.pendingFunctionName = null;
}

async function runLoop(session, companyId, options = {}) {
  return session.provider === "claude"
    ? runClaudeLoop(session, companyId)
    : runGeminiLoop(session, companyId, options);
}

// Handles a message via the fast path when it matches a known read-only
// intent — skips Claude/Gemini entirely and answers straight from the
// ledger. Still logs the exchange into the session history (in whichever
// format the active provider uses) so a follow-up question that DOES need
// the model has this turn as context. Returns null if nothing matched, so
// the caller falls through to the normal AI loop.
async function tryFastPath(session, companyId, userText) {
  const fast = matchFastPath(userText);
  if (!fast) return null;

  const result = await runReadTool(companyId, fast.name, fast.input, {
    maxRows: FREE_MAX_READ_ROWS,
  });
  const text = formatReadResult(fast.name, result) || "OK.";

  if (session.provider === "claude") {
    session.messages.push({ role: "user", content: userText });
    session.messages.push({ role: "assistant", content: [{ type: "text", text }] });
  } else {
    session.geminiContents.push({ role: "user", parts: [{ text: userText }] });
    session.geminiContents.push({ role: "model", parts: [{ text }] });
  }

  return { text, fastPath: true, provider: session.provider };
}

export async function handleMessage(chatId, companyId, userText) {
  const session = getSession(chatId);
  touch(session);

  if (!session.provider) {
    const mode = await resolveProvider(companyId);
    session.provider = mode.provider;
  }

  if (session.pendingToolName) {
    if (session.provider === "claude") {
      session.messages.push({
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: session.pendingCallId,
          content: "User did not confirm and sent a new message instead — treat the previous proposal as cancelled.",
        }],
      });
    } else {
      appendGeminiFunctionResponses(session, [{
        name: session.pendingFunctionName || session.pendingToolName,
        response: { ok: false, cancelled: true, message: "User did not confirm the previous proposal. Treat it as cancelled." },
      }]);
    }
    clearPending(session);
  }

  const fastResult = await tryFastPath(session, companyId, userText);
  if (fastResult) return fastResult;

  if (session.provider === "claude") {
    session.messages.push({ role: "user", content: userText });
    return runLoop(session, companyId);
  }

  session.geminiContents.push({ role: "user", parts: [{ text: userText }] });
  return runLoop(session, companyId, { consumeQuota: true });
}

export async function confirmPending(chatId, companyId) {
  const session = getSession(chatId);
  if (!session.pendingToolName) return { text: "Nothing to confirm." };
  touch(session);

  const provider = session.provider;
  const result = await executeWriteTool(companyId, session.pendingToolName, session.pendingToolInput);

  if (provider === "claude") {
    session.messages.push({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: session.pendingCallId, content: JSON.stringify(result) }],
    });
  } else {
    appendGeminiFunctionResponses(session, [{
      name: session.pendingFunctionName || session.pendingToolName,
      response: result,
    }]);
  }

  clearPending(session);

  let followUp = { text: "" };
  try {
    followUp = await runLoop(session, companyId, { consumeQuota: false });
  } catch (err) {
    console.error(`[ai follow-up] ${companyId}`, err);
    followUp = { text: "The entry was saved. The AI follow-up is temporarily unavailable." };
  }

  return {
    text: `${writeResultMessage(result)}${followUp.text && followUp.text !== "OK." ? "\n" + followUp.text : ""}`,
    provider,
  };
}

export async function cancelPending(chatId) {
  const session = getSession(chatId);
  if (!session.pendingToolName) return { text: "Nothing to cancel." };
  touch(session);

  if (session.provider === "claude") {
    session.messages.push({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: session.pendingCallId, content: "User cancelled — do not record this." }],
    });
  } else {
    appendGeminiFunctionResponses(session, [{
      name: session.pendingFunctionName || session.pendingToolName,
      response: { ok: false, cancelled: true, message: "User cancelled — do not record this." },
    }]);
  }

  const provider = session.provider;
  clearPending(session);
  return { text: "Cancelled.", provider };
}
