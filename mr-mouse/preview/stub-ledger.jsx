import React from "react";

const tx = (id, date, tradeType, method, amount, o = {}) => ({
  id, date, tradeType, method, amount, ...o,
});

export const useLedger = () => ({
  business: {
    id: "demo", businessName: "Adaeze Foods Ltd", industry: "Food processing",
    location: "Ikeja, Lagos", contact: "0803 123 4567",
  },
  logout: () => {},
  accounts: [
    { name: "Petty Cash", type: "Asset", totalDebit: 0, totalCredit: 25100, balance: -25100, rows: [] },
    { name: "Cash",               type: "Asset",               totalDebit: 1840000, totalCredit: 834950, balance: 1005050,
      rows: [
        { id: "r1", date: "2026-08-04", particulars: "Balance b/f",              debit: 842150, credit: 0 },
        { id: "r2", date: "2026-08-07", particulars: "Shoprite Ikeja — inv 0412", debit: 396000, credit: 0 },
        { id: "r3", date: "2026-08-11", particulars: "Dangote Cement — 40 bags",  debit: 0, credit: 185000 },
        { id: "r4", date: "2026-08-23", particulars: "Generator diesel",          debit: 0, credit: 18400 },
      ] },
    { name: "Bank",               type: "Asset",               totalDebit: 2960000, totalCredit: 1120000, balance: 1840000, rows: [] },
    { name: "Shoprite Ikeja",     type: "Asset (Receivable)",  totalDebit: 396000,  totalCredit: 0,      balance: 396000, rows: [] },
    { name: "Dangote Cement",     type: "Liability (Payable)", totalDebit: 0,       totalCredit: 185000, balance: -185000, rows: [] },
    { name: "VAT payable",        type: "Liability (Payable)", totalDebit: 0,       totalCredit: 29700,  balance: -29700, rows: [] },
    { name: "Sales",              type: "Revenue",             totalDebit: 0,       totalCredit: 2418000, balance: -2418000, rows: [] },
    { name: "Purchases",          type: "Expense",             totalDebit: 925000,  totalCredit: 0,      balance: 925000, rows: [] },
  ],
  cashBookEntries: [
    tx("c1", "2026-08-23", "purchase", "cash", 18400, { description: "Generator diesel", category: "runningExpense" }),
    tx("c2", "2026-08-11", "purchase", "bank", 185000, { description: "Cement — 40 bags", party: "Dangote Cement" }),
    tx("c3", "2026-08-07", "sale",     "bank", 396000, { description: "Invoice 0412", party: "Shoprite Ikeja" }),
    tx("c4", "2026-08-02", "sale",     "cash", 128400, { description: "Counter sales", party: "Walk-in" }),
  ],
  pettyCashEntries: [
    tx("p1", "2026-08-23", "purchase", "cash", 18400, { description: "Generator diesel", party: "Mobil Ikeja" }),
    tx("p2", "2026-08-19", "purchase", "cash", 4200,  { description: "Cleaning supplies", party: "Mama Chidi Stores" }),
    tx("p3", "2026-08-12", "purchase", "cash", 2500,  { description: "Dispatch rider", party: "" }),
  ],
  salesJournalEntries: [
    tx("s1", "2026-08-07", "sale", "credit", 396000, { party: "Shoprite Ikeja", productName: "Palm oil — 25L", quantity: 24, description: "Invoice 0412" }),
    tx("s2", "2026-08-14", "sale", "credit", 128400, { party: "Mama Chidi Stores", productName: "Garri — 50kg", quantity: 12 }),
  ],
  purchasesJournalEntries: [
    tx("b1", "2026-08-11", "purchase", "credit", 185000, { party: "Dangote Cement", productName: "Cement", quantity: 40 }),
    tx("b2", "2026-08-18", "purchase", "credit", 74000,  { party: "Honeywell Flour", productName: "Flour — 50kg", quantity: 20 }),
  ],
  trialBalance: {
    balanced: false, totalDebit: 7007800, totalCredit: 4832650,
    rows: [
      { name: "Cash at hand", type: "Asset", debit: 1840000, credit: 834950 },
      { name: "Bank",               type: "Asset", debit: 2960000, credit: 1120000 },
      { name: "Sales", type: "Revenue", debit: 0, credit: 2418000 },
      { name: "Purchases", type: "Expense", debit: 925000, credit: 0 },
    ],
  },
  debtors: [
    { name: "Shoprite Ikeja", balance: 396000 },
    { name: "Mama Chidi Stores", balance: 68400 },
  ],
  creditors: [{ name: "Dangote Cement", balance: 185000 }],
  pendingOrders: [{ id: "o1", status: "open" }],
  reminders: [],
  products: [
    { id: "pr1", name: "Palm oil — 25L", lowStockThreshold: 10 },
    { id: "pr2", name: "Garri — 50kg", lowStockThreshold: 5 },
  ],
  computeStock: () => 24,
  settlements: [],
  streak: { current: 4, recordedToday: true },
  transactions: [
    tx("c1", "2026-09-10", "purchase", "cash", 18400, { description: "Generator diesel", category: "runningExpense" }),
    tx("c2", "2026-09-09", "purchase", "bank", 185000, { description: "Cement", party: "Dangote Cement", category: "trade", productName: "Cement", quantity: 40 }),
    tx("c3", "2026-09-08", "sale", "bank", 396000, { description: "Invoice 0412", party: "Shoprite Ikeja", category: "trade", productName: "Palm oil — 25L", quantity: 24 }),
    tx("c4", "2026-09-07", "sale", "cash", 128400, { description: "Counter sales", party: "Walk-in", category: "trade", productName: "Garri — 50kg", quantity: 12 }),
  ],
  pnl: {
    sales: 2418000, purchases: 925000, grossProfit: 1493000, totalExpenses: 218400,
    netProfit: 1274600,
    expenseLines: [
      { label: "Generator diesel", amount: 18400 },
      { label: "Transport", amount: 96000 },
      { label: "Shop rent", amount: 104000 },
    ],
  },
});
export const LedgerProvider = ({ children }) => <>{children}</>;
