// Ledgercontext.jsx
import React, { createContext, useContext, useState, useMemo, useCallback, useEffect } from "react";
import { resetConsentCache } from "../legal/useConsents";
import { uid, todayISO } from "./ui.jsx";
import { useCompanySync } from "../components/useCompanySync";
import { getAuthHeaders, clearAuthToken } from "../auth";

const LedgerCtx = createContext(null);
const SERVER_URL = import.meta.env?.VITE_SYNC_SERVER_URL || "http://localhost:5000";

const emptyPendingOrder = { partyName: "", productName: "", quantity: "", type: "sale", expectedBy: "", note: "" };

export function LedgerProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const saved = localStorage.getItem("ledger_user");
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  // App.jsx gates its entire render on this — it used to be undefined
  // forever (nothing ever set it), which is why the app was stuck on a
  // blank screen. It's also the fix for a real gap: a leftover
  // "ledger_user" in localStorage used to be trusted as "logged in" with
  // no check against the server at all, which meant a stale/expired
  // session cookie (or none) could render the whole app as authenticated
  // right up until the first real request 401'd. Now the cached user is
  // only a starting guess — it's confirmed (or discarded) against
  // GET /api/users/me, which reads the actual session cookie, before the
  // app is allowed to treat anyone as logged in.
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function verifySession() {
      if (!currentUser) {
        if (!cancelled) setAuthReady(true);
        return;
      }
      try {
        const res = await fetch(`${SERVER_URL}/api/users/me`, {
          headers: getAuthHeaders(),
        });
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          // Refresh with the server's copy (role/business could have
          // changed since this was cached) rather than just keeping
          // whatever was in localStorage.
          setCurrentUser((prev) => ({ ...prev, ...data.user }));
        } else {
          // Token missing/expired/invalid — the cached profile is stale.
          localStorage.removeItem("ledger_user");
          clearAuthToken();
          setCurrentUser(null);
        }
      } catch {
        // Network error reaching the backend — don't strand the user on a
        // permanently blank screen; let them back into the app with what's
        // cached, and any actual request will surface the real problem.
      } finally {
        if (!cancelled) setAuthReady(true);
      }
    }

    verifySession();
    return () => {
      cancelled = true;
    };
    // Intentionally runs once on mount only — this is a one-time "is the
    // session still good" check, not something that should re-fire on
    // every currentUser change (that would re-verify right after every
    // login/logout, which is pointless — those flows already know their
    // own result).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const logout = useCallback(async () => {
    resetConsentCache();
    setCurrentUser(null);
    localStorage.removeItem("ledger_user");
    try {
      await fetch(`${SERVER_URL}/api/users/logout`, {
        method: "POST",
        headers: getAuthHeaders(),
      });
      clearAuthToken();
    } catch {
      // The app itself is logged out regardless (currentUser is cleared
      // above), but if this request fails the HttpOnly session cookie
      // could outlive it server-side until it naturally expires — it's
      // not readable/clearable from JS directly, only via this endpoint.
    }
  }, []);

  // Gated on authReady: without this, companyId is derived from the
  // synchronously-restored localStorage cache and useCompanySync fires
  // immediately on mount, before verifySession() above has had a chance to
  // confirm the cached token is still valid. That races an unverified
  // (possibly expired/invalid) token against the backend and produces a
  // spurious 401 on /api/sync/business right before the session check
  // catches up and logs the user out anyway.
  const companyId = authReady ? currentUser?.businessId || currentUser?.id || null : null;

  const {
    connectionStatus,
    bootstrapped,
    requestStateFromPeers,
    business: syncedBusiness,
    products,
    transactions,
    settlements,
    pendingOrders,
    invoices,
    deadlines = [],
    mutate,
  } = useCompanySync(companyId);

  const business = syncedBusiness || null;

  const setBusiness = useCallback((profile) => {
    setCurrentUser(profile);
    if (profile) {
      localStorage.setItem("ledger_user", JSON.stringify(profile));
    } else {
      localStorage.removeItem("ledger_user");
    }
  }, []);

  /* ---------- Inventory helpers (shared with Inventory.jsx) ---------- */

  const computeStock = useCallback(
    (product) => (product.entries || []).reduce((sum, e) => sum + (e.type === "load" ? e.amount : -e.amount), 0),
    []
  );

  const adjustInventory = useCallback(
    (productName, type, amount, date, note) => {
      const name = (productName || "").trim();
      if (!name || !amount) return;
      const existing = products.find((p) => p.name.toLowerCase() === name.toLowerCase());
      const entry = {
        id: uid(),
        type,
        amount: Number(amount),
        date,
        note: note || "",
        recordedBy: currentUser?.id,
      };
      if (existing) {
        mutate("product", "update", { ...existing, entries: [...(existing.entries || []), entry] });
      } else {
        mutate("product", "create", {
          id: uid(),
          name,
          description: "",
          createdAt: date,
          createdBy: currentUser?.id,
          entries: [entry],
        });
      }
    },
    [products, mutate, currentUser]
  );

  const setProducts = useCallback(
    (updater) => {
      const next = typeof updater === "function" ? updater(products) : updater;
      const currentById = new Map(products.map((p) => [p.id, p]));
      const nextIds = new Set();

      next.forEach((p) => {
        nextIds.add(p.id);
        const prev = currentById.get(p.id);
        if (!prev) {
          mutate("product", "create", p);
        } else if (JSON.stringify(prev) !== JSON.stringify(p)) {
          mutate("product", "update", p);
        }
      });

      products.forEach((p) => {
        if (!nextIds.has(p.id)) mutate("product", "delete", { id: p.id });
      });
    },
    [products, mutate]
  );

  /* ---------- Add Entry: the single write path ---------- */

  const addTransaction = useCallback(
    (entry) => {
      const tx = mutate("transaction", "create", {
        id: uid(),
        date: todayISO(),
        createdBy: currentUser?.id,
        createdByName: currentUser?.name,
        ...entry,
      });

      if (tx.category === "trade" && tx.productName && tx.quantity && !tx.skipInventory) {
        const moveType = tx.tradeType === "sale" ? "offload" : "load";
        adjustInventory(
          tx.productName,
          moveType,
          tx.quantity,
          tx.date,
          tx.tradeType === "sale" ? `Sold — ${tx.method === "credit" ? "credit" : tx.method}` : `Purchased — ${tx.method === "credit" ? "credit" : tx.method}`
        );
      }
      return tx;
    },
    [mutate, adjustInventory, currentUser]
  );

  const getLastUnitPrice = useCallback(
    (productName) => {
      const name = (productName || "").trim().toLowerCase();
      if (!name) return "";
      const matches = transactions.filter(
        (t) =>
          t.category === "trade" &&
          t.tradeType === "sale" &&
          t.productName &&
          t.productName.trim().toLowerCase() === name &&
          Number(t.quantity) > 0
      );
      if (!matches.length) return "";
      const latest = [...matches].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
      return Math.round((latest.amount / Number(latest.quantity)) * 100) / 100;
    },
    [transactions]
  );

  /* ---------- Invoices: builds line-item transactions + VAT posting ---------- */

  const addInvoice = useCallback(
    (payload) => {
      const { party, partyContact, date, dueDate, method, tradeType, items, discountPercent, taxPercent, notes } = payload;

      const invoiceId = uid();
      const invoiceNumber = `INV-${String(invoices.length + 1).padStart(4, "0")}`;
      const invoiceDate = date || todayISO();

      const subtotal = items.reduce((s, i) => s + Number(i.quantity) * Number(i.unitPrice), 0);
      const discountAmount = Math.round(((subtotal * (Number(discountPercent) || 0)) / 100) * 100) / 100;
      const netSubtotal = subtotal - discountAmount;
      const taxAmount = Math.round(((netSubtotal * (Number(taxPercent) || 0)) / 100) * 100) / 100;
      const total = netSubtotal + taxAmount;

      const invoiceItems = items.map((i) => {
        const gross = Number(i.quantity) * Number(i.unitPrice);
        const share = subtotal > 0 ? gross / subtotal : 0;
        const netAmount = Math.round((gross - discountAmount * share) * 100) / 100;
        return { ...i, quantity: Number(i.quantity), unitPrice: Number(i.unitPrice), grossAmount: gross, netAmount };
      });

      invoiceItems.forEach((item) => {
        addTransaction({
          date: invoiceDate,
          party,
          productName: item.isInventoryItem ? item.name : "",
          description: item.description ? `${item.name} — ${item.description}` : item.name,
          method,
          category: "trade",
          tradeType,
          amount: item.netAmount,
          quantity: item.isInventoryItem ? item.quantity : "",
          skipInventory: !item.isInventoryItem,
          invoiceId,
          invoiceNumber,
        });
      });

      if (taxAmount > 0) {
        addTransaction({
          date: invoiceDate,
          party,
          productName: "",
          description: `VAT — Invoice ${invoiceNumber}`,
          method,
          category: "tax",
          tradeType,
          amount: taxAmount,
          quantity: "",
          skipInventory: true,
          invoiceId,
          invoiceNumber,
        });
      }

      const invoice = {
        id: invoiceId,
        invoiceNumber,
        date: invoiceDate,
        dueDate: dueDate || "",
        party,
        partyContact: partyContact || "",
        tradeType,
        method,
        items: invoiceItems,
        subtotal,
        discountPercent: Number(discountPercent) || 0,
        discountAmount,
        taxPercent: Number(taxPercent) || 0,
        taxAmount,
        total,
        notes: notes || "",
        createdBy: currentUser?.id,
        createdByName: currentUser?.name,
        createdAt: todayISO(),
      };

      mutate("invoice", "create", invoice);
      return invoice;
    },
    [invoices.length, addTransaction, mutate, currentUser]
  );

  const addSettlement = useCallback(
    (settlement) =>
      mutate("settlement", "create", {
        id: uid(),
        date: todayISO(),
        createdBy: currentUser?.id,
        createdByName: currentUser?.name,
        ...settlement,
      }),
    [mutate, currentUser]
  );

  const addPendingOrder = useCallback(
    (order) =>
      mutate("pendingOrder", "create", {
        id: uid(),
        date: todayISO(),
        status: "pending",
        createdBy: currentUser?.id,
        createdByName: currentUser?.name,
        ...order,
      }),
    [mutate, currentUser]
  );

  const fulfillPendingOrder = useCallback(
    (id) => {
      const existing = pendingOrders.find((o) => o.id === id);
      if (!existing) return;
      mutate("pendingOrder", "update", {
        ...existing,
        status: "fulfilled",
        fulfilledBy: currentUser?.id,
        fulfilledByName: currentUser?.name,
      });
    },
    [pendingOrders, mutate, currentUser]
  );

  /* ---------- Deadlines ---------- */

  const addDeadline = useCallback(
    (deadline) =>
      mutate("deadline", "create", {
        id: uid(),
        createdAt: todayISO(),
        status: "pending",
        createdBy: currentUser?.id,
        createdByName: currentUser?.name,
        ...deadline,
      }),
    [mutate, currentUser]
  );

  const completeDeadline = useCallback(
    (id) => {
      const existing = (deadlines || []).find((d) => d.id === id);
      if (existing) {
        mutate("deadline", "update", { ...existing, status: "completed" });
      } else {
        mutate("deadline", "delete", { id });
      }
    },
    [deadlines, mutate]
  );

  const deleteDeadline = useCallback(
    (id) => mutate("deadline", "delete", { id }),
    [mutate]
  );

  /* ---------- Derived books (pure functions of transactions) ---------- */

  const cashBookEntries = useMemo(() => {
    // Trade/expense transactions paid in cash or bank.
    const fromTransactions = transactions.filter((t) => t.method === "cash" || t.method === "bank");

    // Debtor/creditor settlements move cash or bank too (a customer
    // paying off what they owe, or the business paying a supplier), but
    // they're their own entity — not a "transaction" — so without this
    // they never showed up here even though they change the cash/bank
    // balance everywhere else (balance summary, P&L). Normalize them into
    // the same shape the rows below expect: `tradeType: "sale"` reads as
    // a receipt (money in), `tradeType: "purchase"` reads as a payment
    // (money out) — same convention as a cash sale/purchase.
    const fromSettlements = settlements
      .filter((s) => s.method === "cash" || s.method === "bank")
      .map((s) => ({
        id: s.id,
        date: s.date,
        method: s.method,
        amount: s.amount,
        category: "settlement",
        tradeType: s.type === "debtor" ? "sale" : "purchase",
        description: s.type === "debtor" ? `Payment received from ${s.party}` : `Payment made to ${s.party}`,
        party: s.party,
      }));

    return [...fromTransactions, ...fromSettlements].sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [transactions, settlements]);

  const pettyCashEntries = useMemo(
    () => transactions.filter((t) => t.category === "smallExpense").sort((a, b) => (a.date < b.date ? 1 : -1)),
    [transactions]
  );

  const salesJournalEntries = useMemo(
    () =>
      transactions
        .filter((t) => t.category === "trade" && t.method === "credit" && t.tradeType === "sale")
        .sort((a, b) => (a.date < b.date ? 1 : -1)),
    [transactions]
  );

  const purchasesJournalEntries = useMemo(
    () =>
      transactions
        .filter((t) => t.category === "trade" && t.method === "credit" && t.tradeType === "purchase")
        .sort((a, b) => (a.date < b.date ? 1 : -1)),
    [transactions]
  );

  /* ---------- Double-entry postings ---------- */

  const postings = useMemo(() => {
    const list = [];
    const push = (account, date, particulars, debit, credit, ref) =>
      list.push({ id: uid(), account, date, particulars, debit: debit || 0, credit: credit || 0, ref });

    transactions.forEach((t) => {
      const label = t.description?.trim() || t.productName?.trim() || t.party?.trim() || "Entry";
      if (t.category === "trade") {
        if (t.method === "credit") {
          if (t.tradeType === "sale") {
            const acct = `${t.party || "Customer"} (Debtor)`;
            push(acct, t.date, `Credit sale — ${label}`, t.amount, 0, t.id);
            push("Sales", t.date, `Credit sale to ${t.party || "customer"}`, 0, t.amount, t.id);
          } else {
            const acct = `${t.party || "Supplier"} (Creditor)`;
            push("Purchases", t.date, `Credit purchase from ${t.party || "supplier"}`, t.amount, 0, t.id);
            push(acct, t.date, `Credit purchase — ${label}`, 0, t.amount, t.id);
          }
        } else {
          const cashAcct = t.method === "bank" ? "Bank" : "Cash";
          if (t.tradeType === "sale") {
            push(cashAcct, t.date, `Sale — ${label}`, t.amount, 0, t.id);
            push("Sales", t.date, `${cashAcct} sale — ${label}`, 0, t.amount, t.id);
          } else {
            push("Purchases", t.date, `${cashAcct} purchase — ${label}`, t.amount, 0, t.id);
            push(cashAcct, t.date, `Purchase — ${label}`, 0, t.amount, t.id);
          }
        }
      } else if (t.category === "runningExpense") {
        const cashAcct = t.method === "bank" ? "Bank" : "Cash";
        const acct = `Expense — ${label}`;
        push(acct, t.date, `Paid via ${cashAcct}`, t.amount, 0, t.id);
        push(cashAcct, t.date, `Running expense — ${label}`, 0, t.amount, t.id);
      } else if (t.category === "smallExpense") {
        const acct = `Expense — ${label}`;
        push(acct, t.date, "Paid from petty cash", t.amount, 0, t.id);
        push("Petty Cash", t.date, `Petty cash — ${label}`, 0, t.amount, t.id);
      } else if (t.category === "tax") {
        const settleAcct =
          t.method === "credit"
            ? t.tradeType === "sale"
              ? `${t.party || "Customer"} (Debtor)`
              : `${t.party || "Supplier"} (Creditor)`
            : t.method === "bank"
            ? "Bank"
            : "Cash";
        if (t.tradeType === "sale") {
          push(settleAcct, t.date, `VAT on ${label}`, t.amount, 0, t.id);
          push("VAT Payable", t.date, `VAT collected — ${label}`, 0, t.amount, t.id);
        } else {
          push("VAT Recoverable", t.date, `VAT paid — ${label}`, t.amount, 0, t.id);
          push(settleAcct, t.date, `VAT on ${label}`, 0, t.amount, t.id);
        }
      }
    });

    settlements.forEach((s) => {
      const cashAcct = s.method === "bank" ? "Bank" : "Cash";
      if (s.type === "debtor") {
        push(cashAcct, s.date, `Received from ${s.party}`, s.amount, 0, s.id);
        push(`${s.party} (Debtor)`, s.date, "Payment received", 0, s.amount, s.id);
      } else {
        push(`${s.party} (Creditor)`, s.date, "Payment made", s.amount, 0, s.id);
        push(cashAcct, s.date, `Paid to ${s.party}`, 0, s.amount, s.id);
      }
    });

    return list;
  }, [transactions, settlements]);

  /* ---------- Chart of accounts / General Ledger ---------- */

  const accounts = useMemo(() => {
    const map = new Map();
    postings.forEach((p) => {
      if (!map.has(p.account)) map.set(p.account, []);
      map.get(p.account).push(p);
    });
    return Array.from(map.entries())
      .map(([name, rows]) => {
        const sorted = [...rows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
        const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
        const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
        let type = "Expense";
        if (name === "Cash" || name === "Bank" || name === "Petty Cash") type = "Asset";
        else if (name === "Sales") type = "Revenue";
        else if (name.endsWith("(Debtor)")) type = "Asset (Receivable)";
        else if (name.endsWith("(Creditor)")) type = "Liability (Payable)";
        else if (name === "VAT Payable") type = "Liability";
        else if (name === "VAT Recoverable") type = "Asset";
        else if (name === "Purchases" || name.startsWith("Expense —")) type = "Expense";
        return { name, type, rows: sorted, totalDebit, totalCredit, balance: totalDebit - totalCredit };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [postings]);

  const getAccount = useCallback((name) => accounts.find((a) => a.name === name) || null, [accounts]);

  /* ---------- Trial balance & P&L ---------- */

  const trialBalance = useMemo(() => {
    const rows = accounts
      .filter((a) => a.totalDebit !== 0 || a.totalCredit !== 0)
      .map((a) => ({
        name: a.name,
        type: a.type,
        debit: a.balance > 0 ? a.balance : 0,
        credit: a.balance < 0 ? -a.balance : 0,
      }));
    const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
    const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
    return { rows, totalDebit, totalCredit, balanced: Math.abs(totalDebit - totalCredit) < 0.01 };
  }, [accounts]);

  const pnl = useMemo(() => {
    const sales = getAccount("Sales")?.totalCredit || 0;
    const purchases = getAccount("Purchases")?.totalDebit || 0;
    const expenseAccounts = accounts.filter((a) => a.name.startsWith("Expense —"));
    const expenseLines = expenseAccounts.map((a) => ({ label: a.name.replace("Expense — ", ""), amount: a.totalDebit }));
    const totalExpenses = expenseLines.reduce((s, l) => s + l.amount, 0);
    const grossProfit = sales - purchases;
    const netProfit = grossProfit - totalExpenses;
    return { sales, purchases, grossProfit, expenseLines, totalExpenses, netProfit };
  }, [accounts, getAccount]);

  /* ---------- Debtors / Creditors / Reminders ---------- */

  const debtors = useMemo(
    () =>
      accounts
        .filter((a) => a.type === "Asset (Receivable)" && a.balance > 0.001)
        .map((a) => ({ name: a.name.replace(" (Debtor)", ""), balance: a.balance, lastDate: a.rows[a.rows.length - 1]?.date })),
    [accounts]
  );

  const creditors = useMemo(
    () =>
      accounts
        .filter((a) => a.type === "Liability (Payable)" && -a.balance > 0.001)
        .map((a) => ({ name: a.name.replace(" (Creditor)", ""), balance: -a.balance, lastDate: a.rows[a.rows.length - 1]?.date })),
    [accounts]
  );

  /* ---------- Books-kept streak ---------- */

  const activityDates = useMemo(() => {
    const set = new Set();
    transactions.forEach((t) => t.date && set.add(t.date));
    settlements.forEach((s) => s.date && set.add(s.date));
    products.forEach((p) => (p.entries || []).forEach((e) => e.date && set.add(e.date)));
    return set;
  }, [transactions, settlements, products]);

  const streak = useMemo(() => {
    const addDays = (dateStr, delta) => {
      const d = new Date(`${dateStr}T00:00:00`);
      d.setDate(d.getDate() + delta);
      return d.toISOString().slice(0, 10);
    };

    const longestStreak = () => {
      const sorted = Array.from(activityDates).sort();
      let longest = 0;
      let run = 0;
      let prev = null;
      for (const d of sorted) {
        run = prev && addDays(prev, 1) === d ? run + 1 : 1;
        longest = Math.max(longest, run);
        prev = d;
      }
      return longest;
    };

    if (activityDates.size === 0) return { current: 0, longest: 0, recordedToday: false };

    const today = todayISO();
    const recordedToday = activityDates.has(today);

    let cursor = recordedToday ? today : addDays(today, -1);
    if (!activityDates.has(cursor)) {
      return { current: 0, longest: longestStreak(), recordedToday: false };
    }

    let current = 0;
    while (activityDates.has(cursor)) {
      current += 1;
      cursor = addDays(cursor, -1);
    }

    return { current, longest: Math.max(current, longestStreak()), recordedToday };
  }, [activityDates]);

  const value = {
    business,
    setBusiness,
    currentUser,
    setCurrentUser,
    authReady,
    logout,
    mutate,
    connectionStatus,
    bootstrapped,
    requestStateFromPeers,
    products,
    setProducts,
    computeStock,
    adjustInventory,
    transactions,
    addTransaction,
    settlements,
    addSettlement,
    pendingOrders,
    addPendingOrder,
    fulfillPendingOrder,
    deadlines,
    addDeadline,
    completeDeadline,
    deleteDeadline,
    invoices,
    addInvoice,
    getLastUnitPrice,
    cashBookEntries,
    pettyCashEntries,
    salesJournalEntries,
    purchasesJournalEntries,
    postings,
    accounts,
    getAccount,
    trialBalance,
    pnl,
    debtors,
    creditors,
    streak,
  };

  return <LedgerCtx.Provider value={value}>{children}</LedgerCtx.Provider>;
}

export function useLedger() {
  const ctx = useContext(LedgerCtx);
  if (!ctx) throw new Error("useLedger must be used within a LedgerProvider");
  return ctx;
}

export { emptyPendingOrder };