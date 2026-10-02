// Ported line-for-line from the postings/accounts/pnl/debtors/creditors
// logic in Ledgercontext.jsx, so numbers reported by the bot match what
// the app itself would compute for the same transactions/settlements —
// whether those records came from Turso (cache mode) or a fresh
// REQUEST_STATE snapshot (live mode).

export function computeStock(product) {
  return (product.entries || []).reduce((sum, e) => sum + (e.type === "load" ? e.amount : -e.amount), 0);
}

export function buildPostings(transactions, settlements) {
  const list = [];
  const push = (account, date, particulars, debit, credit, ref) =>
    list.push({ account, date, particulars, debit: debit || 0, credit: credit || 0, ref });

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
}

export function buildAccounts(postings) {
  const map = new Map();
  postings.forEach((p) => {
    if (!map.has(p.account)) map.set(p.account, []);
    map.get(p.account).push(p);
  });
  return Array.from(map.entries())
    .map(([name, rows]) => {
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
      return { name, type, rows, totalDebit, totalCredit, balance: totalDebit - totalCredit };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getAccount(accounts, name) {
  return accounts.find((a) => a.name === name) || null;
}

export function computePnl(accounts) {
  const sales = getAccount(accounts, "Sales")?.totalCredit || 0;
  const purchases = getAccount(accounts, "Purchases")?.totalDebit || 0;
  const expenseAccounts = accounts.filter((a) => a.name.startsWith("Expense —"));
  const totalExpenses = expenseAccounts.reduce((s, a) => s + a.totalDebit, 0);
  const grossProfit = sales - purchases;
  const netProfit = grossProfit - totalExpenses;
  return { sales, purchases, grossProfit, totalExpenses, netProfit };
}

export function computeDebtorsCreditors(accounts) {
  const debtors = accounts
    .filter((a) => a.type === "Asset (Receivable)" && a.balance > 0.001)
    .map((a) => ({ name: a.name.replace(" (Debtor)", ""), balance: a.balance }));
  const creditors = accounts
    .filter((a) => a.type === "Liability (Payable)" && -a.balance > 0.001)
    .map((a) => ({ name: a.name.replace(" (Creditor)", ""), balance: -a.balance }));
  return { debtors, creditors };
}

export function computeCashBank(accounts) {
  return {
    cash: getAccount(accounts, "Cash")?.balance || 0,
    bank: getAccount(accounts, "Bank")?.balance || 0,
    pettyCash: getAccount(accounts, "Petty Cash")?.balance || 0,
  };
}

export function money(n) {
  const v = Number(n) || 0;
  return `₦${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
