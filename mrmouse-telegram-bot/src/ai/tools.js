// Tool schemas Claude picks from, plus the dispatcher for READ tools
// (executed immediately — nothing to confirm). WRITE tools are listed
// here for the schema but dispatched separately in agent.js, since they
// go through a confirm/cancel step before touching companyData.js.

import { getCompanyState } from "../companyData.js";
import {
  buildPostings,
  buildAccounts,
  computeStock,
  computePnl,
  computeDebtorsCreditors,
  computeCashBank,
} from "../ledger.js";
import { resolveParty, partyHistory, lastTransactionForParty } from "./partyData.js";

function ledgerFrom(state) {
  return buildAccounts(buildPostings(state.transactions, state.settlements));
}

export const WRITE_TOOLS = new Set([
  "record_sale",
  "record_purchase",
  "add_debtor",
  "record_settlement",
  "add_pending_order",
  "record_expense",
  "record_petty_expense",
]);

export const TOOLS = [
  // ---------- read tools ----------
  {
    name: "get_stock",
    description: "Get current stock/inventory level for a product, or all products if no name is given.",
    input_schema: {
      type: "object",
      properties: {
        productName: { type: "string", description: "Product name. Omit to list all products." },
      },
    },
  },
  {
    name: "get_balance_summary",
    description: "Get cash, bank, petty cash balances, total debtors, total creditors, and net profit.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_debtors",
    description: "List everyone who currently owes the business money, with amounts.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_creditors",
    description: "List everyone the business currently owes money to, with amounts.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_pending_orders",
    description: "List pending or fulfilled orders.",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["pending", "fulfilled", "all"], description: "Defaults to pending." },
      },
    },
  },
  {
    name: "get_deadlines",
    description: "List upcoming deadlines/reminders for this business.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_party_account",
    description:
      "Get a specific customer or supplier's full account: running balance and transaction/payment history. Use for 'how much does X owe', 'show me Peter's account'. If the name is ambiguous, you'll get a list of close-match candidates back — ask the user which one they meant rather than guessing.",
    input_schema: {
      type: "object",
      properties: {
        partyName: { type: "string", description: "The customer/supplier name as the user said it." },
      },
      required: ["partyName"],
    },
  },
  {
    name: "get_last_transaction_for_party",
    description: "Find the most recent sale or purchase involving a specific person, e.g. 'what did Peter last buy'.",
    input_schema: {
      type: "object",
      properties: {
        partyName: { type: "string" },
        type: { type: "string", enum: ["sale", "purchase"], description: "Omit to get the most recent of either." },
      },
      required: ["partyName"],
    },
  },

  // ---------- write tools (proposal only — agent.js pauses for confirmation) ----------
  {
    name: "record_sale",
    description:
      "Propose recording a sale of a product. Do not call this until quantity, total amount, and payment method are known — ask the user first if any are missing or ambiguous.",
    input_schema: {
      type: "object",
      properties: {
        productName: { type: "string" },
        quantity: { type: "number" },
        amount: { type: "number", description: "TOTAL sale amount in naira, not a unit price." },
        method: { type: "string", enum: ["cash", "bank", "credit"] },
        party: { type: "string", description: "Customer name — required if method is credit." },
      },
      required: ["productName", "quantity", "amount", "method"],
    },
  },
  {
    name: "record_purchase",
    description: "Propose recording a purchase of a product (stock coming in).",
    input_schema: {
      type: "object",
      properties: {
        productName: { type: "string" },
        quantity: { type: "number" },
        amount: { type: "number", description: "TOTAL purchase amount in naira." },
        method: { type: "string", enum: ["cash", "bank", "credit"] },
        party: { type: "string", description: "Supplier name — required if method is credit." },
      },
      required: ["productName", "quantity", "amount", "method"],
    },
  },
  {
    name: "add_debtor",
    description:
      "Propose recording a manual debtor balance for someone who owes the business money, not tied to a specific product sale (e.g. an existing/opening balance).",
    input_schema: {
      type: "object",
      properties: {
        party: { type: "string" },
        amount: { type: "number" },
      },
      required: ["party", "amount"],
    },
  },
  {
    name: "record_settlement",
    description: "Propose recording a payment received from a debtor, or a payment made to a creditor.",
    input_schema: {
      type: "object",
      properties: {
        party: { type: "string" },
        type: { type: "string", enum: ["debtor", "creditor"], description: "'debtor' = they paid you. 'creditor' = you paid them." },
        amount: { type: "number" },
        method: { type: "string", enum: ["cash", "bank"] },
      },
      required: ["party", "type", "amount"],
    },
  },
  {
    name: "add_pending_order",
    description: "Propose adding a pending order — something owed to a customer or expected from a supplier, not yet fulfilled.",
    input_schema: {
      type: "object",
      properties: {
        partyName: { type: "string" },
        productName: { type: "string" },
        quantity: { type: "number" },
        type: { type: "string", enum: ["sale", "purchase"] },
        note: { type: "string" },
      },
      required: ["partyName", "productName", "quantity", "type"],
    },
  },
  {
    name: "record_expense",
    description: "Propose recording a running business expense paid by cash or bank (rent, transport, salaries, etc). Not for small day-to-day spend out of petty cash — use record_petty_expense for that.",
    input_schema: {
      type: "object",
      properties: {
        amount: { type: "number" },
        method: { type: "string", enum: ["cash", "bank"] },
        description: { type: "string" },
      },
      required: ["amount", "method", "description"],
    },
  },
  {
    name: "record_petty_expense",
    description: "Propose recording a small day-to-day expense paid out of petty cash (snacks, transport fare, minor supplies). Always petty cash — never cash or bank, so there is no method field. Use record_expense instead for anything paid from the main cash or bank balance.",
    input_schema: {
      type: "object",
      properties: {
        amount: { type: "number" },
        description: { type: "string" },
        party: { type: "string", description: "Optional — who it was paid to." },
      },
      required: ["amount", "description"],
    },
  },
];

// Executes any non-write tool immediately and returns a plain JSON-able
// result for Claude to read back. Write tools are never routed here.
export async function runReadTool(companyId, name, input = {}, options = {}) {
  const maxRows = Number.isFinite(options.maxRows) ? Math.max(1, Math.floor(options.maxRows)) : Infinity;
  const limited = (rows) => {
    const list = Array.isArray(rows) ? rows : [];
    if (!Number.isFinite(maxRows) || list.length <= maxRows) return { rows: list, limited: false, total: list.length, returned: list.length };
    return { rows: list.slice(0, maxRows), limited: true, total: list.length, returned: maxRows };
  };
  switch (name) {
    case "get_stock": {
      const state = await getCompanyState(companyId, options.stateCache);
      if (!state) return { error: "No data source available right now." };
      if (input.productName) {
        const p = state.products.find((p) => p.name?.toLowerCase() === input.productName.toLowerCase());
        if (!p) return { error: `No product named "${input.productName}".` };
        return { product: p.name, stock: computeStock(p) };
      }
      const stock = limited(state.products.map((p) => ({ product: p.name, stock: computeStock(p) })));
      return { products: stock.rows, ...(stock.limited ? { limited: true, total: stock.total, returned: stock.returned } : {}) };
    }

    case "get_balance_summary": {
      const state = await getCompanyState(companyId, options.stateCache);
      if (!state) return { error: "No data source available right now." };
      const accounts = ledgerFrom(state);
      const cashBank = computeCashBank(accounts);
      const pnl = computePnl(accounts);
      const { debtors, creditors } = computeDebtorsCreditors(accounts);
      return {
        cash: cashBank.cash,
        bank: cashBank.bank,
        pettyCash: cashBank.pettyCash,
        totalDebtors: debtors.reduce((s, d) => s + d.balance, 0),
        totalCreditors: creditors.reduce((s, c) => s + c.balance, 0),
        netProfit: pnl.netProfit,
      };
    }

    case "get_debtors": {
      const state = await getCompanyState(companyId, options.stateCache);
      if (!state) return { error: "No data source available right now." };
      const { debtors } = computeDebtorsCreditors(ledgerFrom(state));
      const capped = limited(debtors);
      return { debtors: capped.rows, ...(capped.limited ? { limited: true, total: capped.total, returned: capped.returned } : {}) };
    }

    case "get_creditors": {
      const state = await getCompanyState(companyId, options.stateCache);
      if (!state) return { error: "No data source available right now." };
      const { creditors } = computeDebtorsCreditors(ledgerFrom(state));
      const capped = limited(creditors);
      return { creditors: capped.rows, ...(capped.limited ? { limited: true, total: capped.total, returned: capped.returned } : {}) };
    }

    case "get_pending_orders": {
      const state = await getCompanyState(companyId, options.stateCache);
      if (!state) return { error: "No data source available right now." };
      const status = input.status || "pending";
      let orders = state.pendingOrders;
      if (status !== "all") orders = orders.filter((o) => (o.status || "pending") === status);
      const mappedOrders = orders.map((o) => ({
        id: o.id.slice(0, 8),
        party: o.partyName,
        product: o.productName,
        quantity: o.quantity,
        type: o.type,
        status: o.status || "pending",
      }));
      const capped = limited(mappedOrders);
      return { orders: capped.rows, ...(capped.limited ? { limited: true, total: capped.total, returned: capped.returned } : {}) };
    }

    case "get_deadlines": {
      const state = await getCompanyState(companyId, options.stateCache);
      if (!state) return { error: "No data source available right now." };
      const capped = limited(state.deadlines);
      return { deadlines: capped.rows, ...(capped.limited ? { limited: true, total: capped.total, returned: capped.returned } : {}) };
    }

    case "get_party_account": {
      const { state, match, candidates } = await resolveParty(companyId, input.partyName, options.stateCache);
      if (!state) return { error: "No data source available right now." };
      if (!match) {
        return candidates.length
          ? { ambiguous: true, candidates }
          : { error: `No records found for anyone named "${input.partyName}".` };
      }
      const history = partyHistory(state, match);
      const accounts = ledgerFrom(state);
      const debtorAcct = accounts.find((a) => a.name === `${match} (Debtor)`);
      const creditorAcct = accounts.find((a) => a.name === `${match} (Creditor)`);
      const relationship = debtorAcct?.balance > 0.001 ? "debtor" : creditorAcct && -creditorAcct.balance > 0.001 ? "creditor" : "none";
      const balance = relationship === "debtor" ? debtorAcct.balance : relationship === "creditor" ? -creditorAcct.balance : 0;
      return {
        party: match,
        relationship,
        balance,
        history: (() => { const capped = limited(history.map((h) => ({ kind: h.kind, date: h.date, ...h.record }))); return capped.rows; })(),
        ...(limited(history).limited ? { limited: true, total: history.length, returned: maxRows } : {}),
      };
    }

    case "get_last_transaction_for_party": {
      const { state, match, candidates } = await resolveParty(companyId, input.partyName, options.stateCache);
      if (!state) return { error: "No data source available right now." };
      if (!match) {
        return candidates.length
          ? { ambiguous: true, candidates }
          : { error: `No records found for anyone named "${input.partyName}".` };
      }
      const tx = lastTransactionForParty(state, match, input.type);
      if (!tx) return { party: match, message: "No transactions found for this person." };
      return {
        party: match,
        date: tx.date,
        product: tx.productName,
        quantity: tx.quantity,
        amount: tx.amount,
        method: tx.method,
        type: tx.tradeType,
      };
    }

    default:
      return { error: `Unknown read tool: ${name}` };
  }
}
