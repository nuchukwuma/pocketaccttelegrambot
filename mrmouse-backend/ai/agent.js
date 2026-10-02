// ai/agent.js
// One bookkeeping agent with two model providers:
//   - Premium: Claude (existing paid AI)
//   - Free: Gemini (same tools, same write confirmation flow)
//
// The model is interchangeable; bookkeeping reads/writes stay in tools.js
// and companyData.js so both tiers operate on the exact same business logic.

const Anthropic = require("@anthropic-ai/sdk");
const Business = require("../models/Business");
const { ensureSubscription, isAddonActive } = require("../services/subscriptionStore");
const { consumeFreeRequest, getUsage, freeLimitMessage } = require("../services/aiUsage");
const { generateGemini, isGeminiConfigured } = require("./gemini");
const { TOOLS, WRITE_TOOLS, runReadTool } = require("./tools");
const { matchFastPath, formatReadResult } = require("./fastPath");
const { addTransaction, addSettlement, addPendingOrder } = require("./companyData");

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

const CLAUDE_MODEL = process.env.AI_MODEL || "claude-sonnet-5";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const FREE_MAX_READ_ROWS = Math.max(10, Number(process.env.GEMINI_FREE_MAX_READ_ROWS) || 100);
const MAX_STEPS = 6;

const SYSTEM_PROMPT = `You are the bookkeeping assistant inside the Mr. Mouse web app for a Nigerian small business. Currency is Naira (₦). Keep replies short and conversational — this renders in a small chat widget, not a report.

You have read tools (call freely, no confirmation needed) and write tools (record_sale, record_purchase, add_debtor, record_settlement, add_pending_order, record_expense, record_petty_expense). A write tool call only PROPOSES an action — the system shows the user a Confirm/Cancel button before it is saved.

Rules:
- Never call a write tool until you have all its required fields. If quantity, amount, or payment method is missing or ambiguous, ask a short clarifying question in plain text instead of calling the tool.
- "amount" for record_sale/record_purchase is always the TOTAL, not a unit price — multiply it yourself if the user gives a unit price.
- record_expense is for a running business expense paid from the main cash or bank balance (needs a method). record_petty_expense is for small day-to-day spend out of the petty cash float (no method — it's always petty cash). If the user just says "expense" or "spent" without saying it came from petty cash, use record_expense and ask cash or bank.
- If get_party_account or get_last_transaction_for_party returns "ambiguous" with candidates, ask the user which one they meant. Never guess a name.
- Call at most one write tool per turn. Never claim a bulk write was completed if only one item has been proposed or saved.
- If a tool result contains an "error", relay the problem in plain language rather than retrying blindly.
- If a tool result contains "limited": true, clearly tell the user that the free AI returned only part of the database result and show the returned results. Do not pretend the result is complete.
- Never invent missing accounting data.`;

const sessions = new Map();

function getSession(key) {
  const existing = sessions.get(key);
  if (existing && existing.expiresAt > Date.now()) return existing;
  const fresh = {
    messages: [],          // Claude format
    geminiContents: [],    // Gemini format
    provider: null,
    pendingToolName: null,
    pendingToolInput: null,
    pendingCallId: null,
    pendingFunctionName: null,
    expiresAt: 0,
  };
  sessions.set(key, fresh);
  return fresh;
}

function touch(session) {
  session.expiresAt = Date.now() + 15 * 60 * 1000;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, session] of sessions) {
    if (session.expiresAt < now) sessions.delete(key);
  }
}, 10 * 60 * 1000).unref?.();

async function resolveProvider(businessId) {
  const business = await ensureSubscription(businessId);
  const premium = isAddonActive(business.billing?.addons?.ai);

  if (premium) {
    return {
      provider: "claude",
      tier: "premium",
      model: CLAUDE_MODEL,
      configured: Boolean(anthropic),
      business,
    };
  }

  return {
    provider: "gemini",
    tier: "free",
    model: GEMINI_MODEL,
    configured: isGeminiConfigured(),
    business,
  };
}

async function getAiStatus(businessId) {
  const mode = await resolveProvider(businessId);
  let quota = null;
  if (mode.provider === "gemini") quota = await getUsage(businessId);

  return {
    provider: mode.provider,
    tier: mode.tier,
    model: mode.model,
    configured: mode.configured,
    free: mode.provider === "gemini"
      ? {
          dailyLimit: quota.limit,
          usedToday: quota.used,
          remainingToday: quota.remaining,
          maxDatabaseRowsPerQuery: FREE_MAX_READ_ROWS,
          limitations: [
            "Free Gemini availability is subject to shared Google/API rate limits.",
            `Database-heavy list requests are capped at ${FREE_MAX_READ_ROWS} rows per tool result.`,
            "Large or multi-step requests can hit the free request limit sooner.",
            "A request can be temporarily rejected when the free provider is busy or rate-limited.",
          ],
        }
      : null,
  };
}

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

async function executeWriteTool(io, businessId, name, input) {
  switch (name) {
    case "record_sale":
    case "record_purchase": {
      const tradeType = name === "record_sale" ? "sale" : "purchase";
      if (input.method === "credit" && !input.party) return { ok: false, reason: "party_required" };
      return addTransaction(io, businessId, {
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
      return addTransaction(io, businessId, {
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
      return addSettlement(io, businessId, {
        party: input.party,
        type: input.type,
        amount: Number(input.amount),
        method: input.method || "cash",
      });

    case "add_pending_order":
      return addPendingOrder(io, businessId, {
        partyName: input.partyName,
        productName: input.productName,
        quantity: Number(input.quantity),
        type: input.type,
        note: input.note,
      });

    case "record_expense":
      return addTransaction(io, businessId, {
        category: "runningExpense",
        method: input.method,
        amount: Number(input.amount),
        description: input.description,
      });

    case "record_petty_expense":
      return addTransaction(io, businessId, {
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

function textFromClaude(response) {
  return response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
}

async function runClaudeLoop(session, businessId, io) {
  if (!anthropic) return { text: "Premium Claude AI is not configured on the server." };

  // Scoped to this one turn's loop (up to MAX_STEPS): every read tool call
  // made across those steps shares the same fetched company state instead
  // of each one re-querying Mongo and rebuilding the ledger from scratch.
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
    if (!toolUseBlocks.length) return { text: textFromClaude(response) || "OK." };

    const writeCall = toolUseBlocks.find((b) => WRITE_TOOLS.has(b.name));
    if (writeCall) {
      session.pendingToolName = writeCall.name;
      session.pendingToolInput = writeCall.input;
      session.pendingCallId = writeCall.id;
      return { text: describeProposal(writeCall.name, writeCall.input), confirm: true };
    }

    // Claude can (and often does) ask for several read tools in one step —
    // e.g. get_stock + get_debtors + get_balance_summary. These are
    // independent reads, so run them concurrently instead of awaiting one
    // at a time.
    const results = await Promise.all(
      toolUseBlocks.map((block) => runReadTool(businessId, block.name, block.input, { stateCache }))
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
    parts: responses.map(({ id, name, response }) => ({
      functionResponse: {
        ...(id ? { id } : {}),
        name,
        response,
      },
    })),
  });
}

async function runGeminiLoop(session, businessId, io, { consumeQuota = false } = {}) {
  if (!isGeminiConfigured()) {
    return { text: "Free Gemini AI is not configured on the server yet. Add GEMINI_API_KEY to enable it." };
  }

  if (consumeQuota) {
    const quota = await consumeFreeRequest(businessId);
    if (!quota.ok) {
      return {
        text: freeLimitMessage(quota.limit),
        quota,
        limited: true,
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
      return { text: text || "OK." };
    }

    const writeCall = response.functionCalls.find((call) => WRITE_TOOLS.has(call.name));
    if (writeCall) {
      session.pendingToolName = writeCall.name;
      session.pendingToolInput = writeCall.input;
      session.pendingCallId = writeCall.id;
      session.pendingFunctionName = writeCall.name;
      return { text: describeProposal(writeCall.name, writeCall.input), confirm: true };
    }

    const results = await Promise.all(
      response.functionCalls.map((call) =>
        runReadTool(businessId, call.name, call.input, { maxRows: FREE_MAX_READ_ROWS, stateCache })
      )
    );
    const responses = response.functionCalls.map((call, i) => ({
      id: call.id,
      name: call.name,
      response: results[i],
    }));
    appendGeminiFunctionResponses(session, responses);
  }

  return { text: "I'm having trouble finishing that — try rephrasing?" };
}

async function runLoop(session, businessId, io, options = {}) {
  if (session.provider === "claude") return runClaudeLoop(session, businessId, io);
  return runGeminiLoop(session, businessId, io, options);
}

function clearPending(session) {
  session.pendingToolName = null;
  session.pendingToolInput = null;
  session.pendingCallId = null;
  session.pendingFunctionName = null;
}

// Handles a message via the fast path when it matches a known read-only
// intent — skips Claude/Gemini entirely and answers straight from the
// ledger. Still logs the exchange into the session history (in whichever
// format the active provider uses) so a follow-up question that DOES need
// the model has this turn as context. Returns null if nothing matched, so
// the caller falls through to the normal AI loop.
async function tryFastPath(session, businessId, userText) {
  const fast = matchFastPath(userText);
  if (!fast) return null;

  const result = await runReadTool(businessId, fast.name, fast.input, {
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

async function handleMessage(sessionKey, businessId, userText, io) {
  const session = getSession(sessionKey);
  touch(session);

  if (!session.provider) {
    const mode = await resolveProvider(businessId);
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
        id: session.pendingCallId,
        name: session.pendingFunctionName || session.pendingToolName,
        response: { ok: false, cancelled: true, message: "User did not confirm the previous proposal. Treat it as cancelled." },
      }]);
    }
    clearPending(session);
  }

  const fastResult = await tryFastPath(session, businessId, userText);
  if (fastResult) return fastResult;

  if (session.provider === "claude") {
    session.messages.push({ role: "user", content: userText });
    return runLoop(session, businessId, io);
  }

  session.geminiContents.push({ role: "user", parts: [{ text: userText }] });
  return runLoop(session, businessId, io, { consumeQuota: true });
}

async function confirmPending(sessionKey, businessId, io) {
  const session = getSession(sessionKey);
  if (!session.pendingToolName) return { text: "Nothing to confirm." };
  touch(session);

  const provider = session.provider;
  const name = session.pendingToolName;
  const input = session.pendingToolInput;
  const result = await executeWriteTool(io, businessId, name, input);

  if (provider === "claude") {
    session.messages.push({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: session.pendingCallId, content: JSON.stringify(result) }],
    });
  } else {
    appendGeminiFunctionResponses(session, [{
      id: session.pendingCallId,
      name: session.pendingFunctionName || name,
      response: result,
    }]);
  }

  clearPending(session);

  // The write itself does not consume another user-request quota. This keeps
  // a Confirm click from unexpectedly using up a free daily request.
  let followUp;
  try {
    followUp = await runLoop(session, businessId, io, { consumeQuota: false });
  } catch (err) {
    // The write has already happened. Do not make a provider failure look
    // like the accounting entry failed.
    console.error(`[ai follow-up] ${businessId}`, err);
    followUp = { text: "The entry was saved. The AI follow-up is temporarily unavailable." };
  }

  return {
    text: `${writeResultMessage(result)}${followUp.text && followUp.text !== "OK." ? "\n" + followUp.text : ""}`,
    provider,
  };
}

async function cancelPending(sessionKey) {
  const session = getSession(sessionKey);
  if (!session.pendingToolName) return { text: "Nothing to cancel." };
  touch(session);

  if (session.provider === "claude") {
    session.messages.push({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: session.pendingCallId, content: "User cancelled — do not record this." }],
    });
  } else {
    appendGeminiFunctionResponses(session, [{
      id: session.pendingCallId,
      name: session.pendingFunctionName || session.pendingToolName,
      response: { ok: false, cancelled: true, message: "User cancelled — do not record this." },
    }]);
  }

  clearPending(session);
  return { text: "Cancelled.", provider: session.provider };
}

module.exports = { handleMessage, confirmPending, cancelPending, getAiStatus, resolveProvider };
