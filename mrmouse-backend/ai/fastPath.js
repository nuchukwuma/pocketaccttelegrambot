// ai/fastPath.js
//
// Cheap, offline intent matching for the handful of read-only questions
// that make up most of the AI chat traffic ("how much gold do i have",
// "who owes me", "balance"). When a message matches, we call the same
// runReadTool() the LLM would have called and format the result directly
// — no Claude/Gemini request at all. This means these queries:
//   - never fail because Gemini/Claude is down or rate-limited
//   - don't consume the free-tier daily quota
//   - answer instantly
//
// Anything that doesn't match a pattern here (chit-chat, ambiguous
// phrasing, multi-step requests, and ALL write actions) falls through to
// the normal LLM loop untouched. This module deliberately stays narrow —
// a wrong fast-path match with no model in the loop to catch it would be
// worse than just going to the LLM, so patterns are conservative and
// party-name lookups (get_party_account, get_last_transaction_for_party)
// are intentionally left out: extracting a person's name reliably from
// free text is exactly the kind of fuzzy matching an LLM is for.

const GENERIC_STOCK_WORDS = new Set([
  "cash", "money", "naira", "profit", "stock", "inventory",
  "it", "that", "this", "bank", "the bank", "in the bank",
]);

function stripPunctuation(text) {
  return String(text || "").trim().replace(/[?!.]+$/, "").trim();
}

// Order matters: check the specific/narrow intents (balance, debtors,
// creditors, deadlines, pending orders) before the generic "how much X
// do i have" stock pattern, so "how much cash do i have" resolves to
// get_balance_summary rather than being mistaken for a stock lookup.
function matchFastPath(rawText) {
  const stripped = stripPunctuation(rawText);
  if (!stripped) return null;
  const lower = stripped.toLowerCase();

  if (
    /\bbalance\s+summary\b/.test(lower) ||
    /\b(cash|bank)\s+balance\b/.test(lower) ||
    /^(?:what(?:'s|’s| is)|whats)\s+my\s+balance$/.test(lower) ||
    /\bhow\s+much\s+(?:cash|money)\b.*\b(?:have|left|is there|do i have)\b/.test(lower) ||
    /\bhow\s+much\s+(?:is\s+)?(?:in\s+)?(?:my\s+)?(?:the\s+)?bank\b/.test(lower) ||
    /\bnet\s+profit\b/.test(lower) ||
    lower === "balance" ||
    lower === "my balance" ||
    lower === "cash" ||
    lower === "bank"
  ) {
    return { name: "get_balance_summary", input: {} };
  }

  if (
    /\bwho\s+owes?\s+me\b/.test(lower) ||
    /\b(?:my\s+)?debtors\b/.test(lower) ||
    /\bwho\s+(?:still\s+)?owes\b/.test(lower)
  ) {
    return { name: "get_debtors", input: {} };
  }

  if (
    /\bwho\s+do\s+i\s+owe\b/.test(lower) ||
    /\b(?:my\s+)?creditors\b/.test(lower) ||
    /\bwho\s+am\s+i\s+owing\b/.test(lower)
  ) {
    return { name: "get_creditors", input: {} };
  }

  if (/\bdeadlines?\b/.test(lower) || /\breminders?\b/.test(lower)) {
    return { name: "get_deadlines", input: {} };
  }

  if (/\bpending\s+orders?\b/.test(lower)) {
    return { name: "get_pending_orders", input: {} };
  }

  if (
    /^(?:my\s+|our\s+)?stock$/.test(lower) ||
    /^(?:my\s+|our\s+)?inventory$/.test(lower) ||
    /^stock\s+levels?$/.test(lower) ||
    /^show\s+(?:me\s+)?(?:my\s+|our\s+)?stock$/.test(lower)
  ) {
    return { name: "get_stock", input: {} };
  }

  const stockPatterns = [
    /^how\s+(?:much|many)\s+(.+?)\s+(?:do\s+i\s+have|do\s+we\s+have|is\s+left|are\s+left|have\s+i\s+got|left)$/i,
    /^(?:what(?:'s|’s| is))?\s*(?:my\s+|our\s+)?stock\s+(?:of|for)\s+(.+)$/i,
    /^(?:stock|inventory)\s+(?:of|for)\s+(.+)$/i,
  ];
  for (const pattern of stockPatterns) {
    const match = stripped.match(pattern);
    if (match && match[1]) {
      const productName = match[1].trim();
      if (productName.length > 1 && !GENERIC_STOCK_WORDS.has(productName.toLowerCase())) {
        return { name: "get_stock", input: { productName } };
      }
    }
  }

  return null;
}

function naira(n) {
  return `₦${Number(n || 0).toLocaleString()}`;
}

function withLimitNote(text, result) {
  return result?.limited ? `${text}\n(showing ${result.returned} of ${result.total})` : text;
}

// Formats a runReadTool() result into the same kind of short, conversational
// reply the LLM would give — for the read tools fast-pathed above. Returns
// null for anything not covered here so the caller can fall back safely.
function formatReadResult(name, result) {
  if (result?.error) return result.error;
  if (result?.ambiguous) {
    const names = (result.candidates || []).map((c) => c.name || c).join(", ");
    return names
      ? `I found more than one match: ${names}. Which one did you mean?`
      : "I found more than one match for that — which one did you mean?";
  }

  switch (name) {
    case "get_stock": {
      if (result.product !== undefined) {
        return `${result.product}: ${result.stock} in stock.`;
      }
      const rows = result.products || [];
      if (!rows.length) return "No products found yet.";
      const lines = rows.map((p) => `• ${p.product}: ${p.stock}`).join("\n");
      return withLimitNote(`Current stock:\n${lines}`, result);
    }

    case "get_balance_summary":
      return [
        `Cash: ${naira(result.cash)}`,
        `Bank: ${naira(result.bank)}`,
        `Petty cash: ${naira(result.pettyCash)}`,
        `Debtors owe you: ${naira(result.totalDebtors)}`,
        `You owe creditors: ${naira(result.totalCreditors)}`,
        `Net profit: ${naira(result.netProfit)}`,
      ].join("\n");

    case "get_debtors": {
      const rows = result.debtors || [];
      if (!rows.length) return "Nobody currently owes you money.";
      const lines = rows.map((d) => `• ${d.name}: ${naira(d.balance)}`).join("\n");
      return withLimitNote(`People who owe you:\n${lines}`, result);
    }

    case "get_creditors": {
      const rows = result.creditors || [];
      if (!rows.length) return "You don't currently owe anyone money.";
      const lines = rows.map((c) => `• ${c.name}: ${naira(c.balance)}`).join("\n");
      return withLimitNote(`People you owe:\n${lines}`, result);
    }

    case "get_pending_orders": {
      const rows = result.orders || [];
      if (!rows.length) return "No pending orders.";
      const lines = rows
        .map((o) => `• ${o.quantity} × ${o.product} — ${o.type} for ${o.party}${o.status && o.status !== "pending" ? ` (${o.status})` : ""}`)
        .join("\n");
      return withLimitNote(`Pending orders:\n${lines}`, result);
    }

    case "get_deadlines": {
      const rows = result.deadlines || [];
      if (!rows.length) return "No upcoming deadlines.";
      const lines = rows
        .map((d) => {
          const label = d.title || d.description || d.note || d.name || "Deadline";
          const when = d.date || d.dueDate || d.due || null;
          return `• ${label}${when ? ` — ${when}` : ""}`;
        })
        .join("\n");
      return withLimitNote(`Upcoming deadlines:\n${lines}`, result);
    }

    default:
      return null;
  }
}

module.exports = { matchFastPath, formatReadResult };
