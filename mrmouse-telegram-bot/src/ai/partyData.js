// Party-scoped views on top of getCompanyState() — "Peter's account",
// "what did Peter last buy" — kept separate from companyData.js since
// these are read-side conveniences, not entity mutations or the raw
// state fetch.

import { getCompanyState } from "../companyData.js";
import { fuzzyMatchNames } from "./fuzzyMatch.js";

// Every distinct party/customer/supplier name seen across transactions,
// settlements, and pending orders for this company.
export function listPartyNames(state) {
  const names = new Set();
  (state.transactions || []).forEach((t) => t.party && names.add(t.party));
  (state.settlements || []).forEach((s) => s.party && names.add(s.party));
  (state.pendingOrders || []).forEach((o) => o.partyName && names.add(o.partyName));
  return [...names];
}

// Resolves free-text ("peter", "Peter Samuel") against known party names.
//   { state, match: "Peter Samuel", candidates: [] }        — confident
//   { state, match: null, candidates: [...] }                — ambiguous
//   { state, match: null, candidates: [] }                   — no source, or nothing close
//   { state: null, match: null, candidates: [] }              — no online data source at all
export async function resolveParty(companyId, query, stateCache) {
  const state = await getCompanyState(companyId, stateCache);
  if (!state) return { state: null, match: null, candidates: [] };

  const names = listPartyNames(state);
  const matches = fuzzyMatchNames(names, query);
  if (!matches.length) return { state, match: null, candidates: [] };

  const [best, second] = matches;
  const confident = best.score >= 0.9 && (!second || best.score - second.score > 0.15);
  if (confident) return { state, match: best.name, candidates: [] };

  return { state, match: null, candidates: matches.map((m) => m.name) };
}

// All transactions/settlements/pendingOrders involving a specific
// (already-resolved) party name, oldest first.
export function partyHistory(state, partyName) {
  const events = [];
  (state.transactions || [])
    .filter((t) => t.party === partyName)
    .forEach((t) => events.push({ kind: "transaction", date: t.date, record: t }));
  (state.settlements || [])
    .filter((s) => s.party === partyName)
    .forEach((s) => events.push({ kind: "settlement", date: s.date, record: s }));
  (state.pendingOrders || [])
    .filter((o) => o.partyName === partyName)
    .forEach((o) => events.push({ kind: "pendingOrder", date: o.date, record: o }));
  events.sort((a, b) => new Date(a.date) - new Date(b.date));
  return events;
}

// Most recent trade (sale or purchase) involving a resolved party name.
// `type` narrows to "sale" or "purchase"; omit for either.
export function lastTransactionForParty(state, partyName, type) {
  const txs = (state.transactions || [])
    .filter((t) => t.party === partyName && t.category === "trade")
    .filter((t) => !type || t.tradeType === type)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  return txs[0] || null;
}
