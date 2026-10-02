// ai/partyData.js — identical logic to the bot's src/ai/partyData.js,
// ported to CommonJS and to this repo's getCompanyState().

const { getCompanyState } = require("./companyData");
const { fuzzyMatchNames } = require("./fuzzyMatch");

function listPartyNames(state) {
  const names = new Set();
  (state.transactions || []).forEach((t) => t.party && names.add(t.party));
  (state.settlements || []).forEach((s) => s.party && names.add(s.party));
  (state.pendingOrders || []).forEach((o) => o.partyName && names.add(o.partyName));
  return [...names];
}

async function resolveParty(businessId, query, stateCache) {
  const state = await getCompanyState(businessId, stateCache);
  const names = listPartyNames(state);
  const matches = fuzzyMatchNames(names, query);
  if (!matches.length) return { state, match: null, candidates: [] };

  const [best, second] = matches;
  const confident = best.score >= 0.9 && (!second || best.score - second.score > 0.15);
  if (confident) return { state, match: best.name, candidates: [] };

  return { state, match: null, candidates: matches.map((m) => m.name) };
}

function partyHistory(state, partyName) {
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

function lastTransactionForParty(state, partyName, type) {
  const txs = (state.transactions || [])
    .filter((t) => t.party === partyName && t.category === "trade")
    .filter((t) => !type || t.tradeType === type)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  return txs[0] || null;
}

module.exports = { listPartyNames, resolveParty, partyHistory, lastTransactionForParty };
