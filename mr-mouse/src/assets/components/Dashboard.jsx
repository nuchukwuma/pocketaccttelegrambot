import React, { useState, useMemo, useEffect } from "react";
import {
  PlusCircle,
  BookOpen,
  BellRing,
  Package,
  ArrowRight,
  ChevronRight,
  ChevronLeft,
  Lightbulb,
  Receipt,
  Trophy,
  AlertCircle,
  X,
  Wifi,
  WifiOff,
  Loader2,
  Flame,
  Sparkles,
} from "lucide-react";
import { tokenColor } from "../theme/tokens";
import { useLedger } from "../booksofacc/Ledgercontext";
import { GlobalStyle, TopNav, AnimatedFigure, formatMoney, formatDate } from "../booksofacc/ui.jsx";
import DashboardHero from "./DashboardHero";
import { CashflowChart, ExpenseBars } from "./Charts";
import { useCompanySync } from "./useCompanySync";
import { useSubscription } from "../useSubscription";
import ConnectTelegram from "./ConnectTelegram";

/* ---------------------------------------------------------------
   Analytics helpers — derived straight from transactions/settlements
--------------------------------------------------------------- */

function daysAgoISO(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function isCashMovement(method) {
  return method === "cash" || method === "bank";
}

function buildAnalytics({ transactions, settlements, products, computeStock, periodStart }) {
  const inRange = (date) => date >= periodStart;

  const periodTx = transactions.filter((t) => inRange(t.date));
  const periodSettlements = settlements.filter((s) => inRange(s.date));

  /* ---- Cashflow: real cash/bank movement only ---- */
  const dayMap = new Map();
  const touchDay = (date) => {
    if (!dayMap.has(date)) dayMap.set(date, { date, inflow: 0, outflow: 0 });
    return dayMap.get(date);
  };

  periodTx.forEach((t) => {
    if (t.category === "smallExpense") {
      touchDay(t.date).outflow += t.amount;
      return;
    }
    if (!isCashMovement(t.method)) return;
    const day = touchDay(t.date);
    if (t.category === "trade") {
      if (t.tradeType === "sale") day.inflow += t.amount;
      else day.outflow += t.amount;
    } else if (t.category === "runningExpense") {
      day.outflow += t.amount;
    } else if (t.category === "tax") {
      if (t.tradeType === "sale") day.inflow += t.amount;
      else day.outflow += t.amount;
    }
  });

  periodSettlements.forEach((s) => {
    if (!isCashMovement(s.method)) return;
    const day = touchDay(s.date);
    if (s.type === "debtor") day.inflow += s.amount;
    else day.outflow += s.amount;
  });

  const cashDays = Array.from(dayMap.values()).sort((a, b) => (a.date < b.date ? -1 : 1));
  const totalInflow = cashDays.reduce((s, d) => s + d.inflow, 0);
  const totalOutflow = cashDays.reduce((s, d) => s + d.outflow, 0);
  const maxDayValue = Math.max(1, ...cashDays.map((d) => Math.max(d.inflow, d.outflow)));

  /* ---- Expense breakdown ---- */
  const expenseMap = new Map();
  periodTx
    .filter((t) => t.category === "runningExpense" || t.category === "smallExpense")
    .forEach((t) => {
      const label = t.description?.trim() || t.party?.trim() || "Other";
      expenseMap.set(label, (expenseMap.get(label) || 0) + t.amount);
    });
  const totalExpenses = Array.from(expenseMap.values()).reduce((s, v) => s + v, 0);
  const expenseBreakdown = Array.from(expenseMap.entries())
    .map(([label, amount]) => ({ label, amount, pct: totalExpenses ? (amount / totalExpenses) * 100 : 0 }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);

  /* ---- Stock performance ---- */
  const stockStats = products.map((p) => {
    const sales = periodTx.filter(
      (t) => t.category === "trade" && t.tradeType === "sale" && t.productName === p.name && t.quantity
    );
    const unitsSold = sales.reduce((s, t) => s + Number(t.quantity), 0);
    const revenue = sales.reduce((s, t) => s + t.amount, 0);
    return { id: p.id, name: p.name, unitsSold, revenue, stock: computeStock(p) };
  });
  const bestSellers = [...stockStats].filter((p) => p.revenue > 0).sort((a, b) => b.revenue - a.revenue).slice(0, 3);
  const worstSellers = [...stockStats]
    .filter((p) => p.stock > 0)
    .sort((a, b) => a.revenue - b.revenue || a.unitsSold - b.unitsSold)
    .slice(0, 3);

  return {
    cashDays,
    totalInflow,
    totalOutflow,
    netCashflow: totalInflow - totalOutflow,
    maxDayValue,
    expenseBreakdown,
    totalExpenses,
    bestSellers,
    worstSellers,
  };
}

function buildWeekPulse(transactions) {
  const weekStart = daysAgoISO(6);
  const prevWeekStart = daysAgoISO(13);

  const inThisWeek = (t) => t.date >= weekStart;
  const inPrevWeek = (t) => t.date >= prevWeekStart && t.date < weekStart;

  const sales = transactions.filter((t) => t.category === "trade" && t.tradeType === "sale");
  const expenseTx = transactions.filter((t) => t.category === "runningExpense" || t.category === "smallExpense");

  const thisWeekSales = sales.filter(inThisWeek);
  const prevWeekSales = sales.filter(inPrevWeek);
  const thisWeekExpenses = expenseTx.filter(inThisWeek);
  const prevWeekExpenses = expenseTx.filter(inPrevWeek);

  const salesCount = thisWeekSales.length;
  const salesRevenue = thisWeekSales.reduce((s, t) => s + t.amount, 0);
  const expensesTotal = thisWeekExpenses.reduce((s, t) => s + t.amount, 0);
  const prevSalesRevenue = prevWeekSales.reduce((s, t) => s + t.amount, 0);
  const prevExpensesTotal = prevWeekExpenses.reduce((s, t) => s + t.amount, 0);
  const net = salesRevenue - expensesTotal;

  const changePct = prevSalesRevenue > 0 ? ((salesRevenue - prevSalesRevenue) / prevSalesRevenue) * 100 : null;

  let verdict, tone, message;
  const plural = salesCount === 1 ? "" : "s";

  if (salesCount === 0 && expensesTotal === 0) {
    verdict = "No activity yet";
    tone = "neutral";
    message = "Nothing recorded this week yet — add a sale or expense to see how the week's shaping up.";
  } else if (changePct === null) {
    if (net > 0) {
      verdict = "Good week";
      tone = "positive";
      message = `${salesCount} sale${plural} so far, running ${formatMoney(net)} ahead of expenses.`;
    } else if (salesCount > 0) {
      verdict = "Tight week";
      tone = "negative";
      message = `${salesCount} sale${plural} so far, but expenses have outpaced revenue.`;
    } else {
      verdict = "Slow week";
      tone = "negative";
      message = `No sales yet this week, against ${formatMoney(expensesTotal)} in expenses.`;
    }
  } else if (changePct >= 15) {
    verdict = "Great week";
    tone = "positive";
    message = `Sales are up ${Math.round(changePct)}% on last week — ${salesCount} sale${plural} so far.`;
  } else if (changePct >= -10) {
    verdict = "Steady week";
    tone = "neutral";
    message = `Sales are holding close to last week's pace — ${salesCount} sale${plural} so far.`;
  } else {
    verdict = "Slow week";
    tone = "negative";
    message = `Sales are down ${Math.abs(Math.round(changePct))}% on last week — ${salesCount} sale${plural} so far.`;
  }

  return { salesCount, salesRevenue, expensesTotal, prevSalesRevenue, prevExpensesTotal, net, verdict, tone, message };
}

const GLOSSARY_TIPS = [
  {
    term: "Cash Book",
    tip: "Every naira that moves through actual cash or your bank account, recorded in one place — it's your record of real money in and out.",
  },
  {
    term: "Petty Cash",
    tip: "The small, everyday spends — transport, snacks, odd errands — kept in their own pool so they don't get lost among the bigger numbers.",
  },
  {
    term: "Debtors",
    tip: "People or businesses that owe you money — usually because you sold to them on credit and haven't been paid yet.",
  },
  {
    term: "Creditors",
    tip: "Suppliers you owe money to — you bought goods or services from them on credit and payment is still outstanding.",
  },
  {
    term: "Sales / Purchases Journal",
    tip: "A running list of everything sold or bought on credit — it's where you track money that's owed rather than already settled.",
  },
  {
    term: "Ledger",
    tip: "Every account gets its own running story here — Cash, Sales, each customer's balance — pulled together from all your entries.",
  },
  {
    term: "Trial Balance",
    tip: "A health check on your books: total debits should always equal total credits. If they don't, something was recorded wrong somewhere.",
  },
  {
    term: "Gross Profit vs Net Profit",
    tip: "Gross profit is sales minus the cost of the goods you sold. Net profit is what's left after every other expense is taken out too.",
  },
  {
    term: "VAT Payable",
    tip: "VAT you collect from customers isn't your money to keep — it's the government's. This tracks how much you currently owe them.",
  },
  {
    term: "Assets vs Liabilities",
    tip: "Assets are things the business owns or is owed — cash, stock, debtors. Liabilities are what the business owes to others.",
  },
  {
    term: "Double-Entry Bookkeeping",
    tip: "Every transaction touches two accounts, not one — money doesn't just appear, it always moves from somewhere to somewhere.",
  },
  {
    term: "Invoice",
    tip: "A formal bill for goods or services sold — it turns a sale into a paper trail both you and your customer can refer back to.",
  },
];

export default function Dashboard({ onNavigate, companyId }) {
  const {
    business,
    accounts,
    pnl,
    debtors,
    creditors,
    pendingOrders,
    reminders = [],
    products,
    computeStock,
    transactions: localTransactions,
    settlements,
    streak,
  } = useLedger();

  // Real-time synchronization hook integration
  const targetCompanyId = companyId || business?.id || "default";
  const { connectionStatus, bootstrapped, entries: syncedEntries } = useCompanySync(targetCompanyId);
  const { subscription: aiSubscription } = useSubscription(business?.id);
  const aiActive = Boolean(aiSubscription?.addOns?.ai);

  // Map synced websocket entries into transactions fallback if populated
  const transactions = useMemo(() => {
    if (syncedEntries && syncedEntries.length > 0) {
      return syncedEntries.map((e) => ({
        id: e.id,
        date: e.createdAt ? e.createdAt.slice(0, 10) : new Date().toISOString().slice(0, 10),
        amount: e.amount || 0,
        category: e.category || (e.type === "credit" ? "trade" : "runningExpense"),
        tradeType: e.type === "credit" ? "sale" : "purchase",
        method: e.method || "cash",
        description: e.description,
        party: e.party,
        productName: e.productName,
        quantity: e.quantity,
      }));
    }
    return localTransactions;
  }, [syncedEntries, localTransactions]);

  const [period, setPeriod] = useState("week"); // 'week' | 'month'
  const periodStart = useMemo(() => daysAgoISO(period === "week" ? 6 : 29), [period]);
  const analytics = useMemo(
    () => buildAnalytics({ transactions, settlements, products, computeStock, periodStart }),
    [transactions, settlements, products, computeStock, periodStart]
  );
  const pulse = useMemo(() => buildWeekPulse(transactions), [transactions]);

  const cashAvailable = (accounts.find((a) => a.name === "Cash")?.balance || 0) + (accounts.find((a) => a.name === "Bank")?.balance || 0);
  const pettyCash = accounts.find((a) => a.name === "Petty Cash")?.balance || 0;

  const totalDebtors = debtors.reduce((s, d) => s + d.balance, 0);
  const totalCreditors = creditors.reduce((s, c) => s + c.balance, 0);
  const openOrders = pendingOrders.filter((o) => o.status === "pending").length;
  const lowStock = products.filter((p) => computeStock(p) <= 5).length;

  /* ---- Deadline tracking calculations ---- */
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const deadlinesReached = useMemo(() => {
    const isOverdue = (item) => {
      if (!item) return false;
      if (item.isOverdue || item.status === "overdue") return true;
      const targetDate = item.dueDate || item.deadline || item.date;
      return Boolean(targetDate && targetDate <= todayStr);
    };

    const overdueDebtors = debtors.filter((d) => (d.balance > 0 || d.balance === undefined) && isOverdue(d)).length;
    const overdueCreditors = creditors.filter((c) => (c.balance > 0 || c.balance === undefined) && isOverdue(c)).length;
    const overdueOrders = pendingOrders.filter((o) => o.status === "pending" && isOverdue(o)).length;
    const overdueReminders = reminders.filter((r) => r.status !== "completed" && isOverdue(r)).length;

    return overdueDebtors + overdueCreditors + overdueOrders + overdueReminders;
  }, [debtors, creditors, pendingOrders, reminders, todayStr]);

  const recent = [...transactions]
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 6);

  return (
    <div className="min-h-screen w-full bg-paper font-body">
      <GlobalStyle />
      <TopNav business={business} current="dashboard" onNavigate={onNavigate} />

      <DashboardHero
        business={business}
        cashAvailable={cashAvailable}
        pettyCash={pettyCash}
        pulse={pulse}
        entriesThisWeek={pulse?.salesCount || 0}
        right={
          <div className="flex items-center gap-2.5 shrink-0">
            <StreakBadge streak={streak} />
            <ConnectionBadge status={connectionStatus} bootstrapped={bootstrapped} />
          </div>
        }
      />

      <div className="max-w-5xl mx-auto px-5 sm:px-8 pt-8 relative pb-24">
        {/* Quick learning pop-up — first login only, not every visit */}
        <QuickLearningModal tips={GLOSSARY_TIPS} businessId={business?.id} />

        {/* The week in figures. The verdict itself is in the hero. */}
        <WeekPulseCard pulse={pulse} />

        {/* Deadline Reached Banner Notice */}
        {deadlinesReached > 0 && (
          <button
            onClick={() => onNavigate("reminders")}
            className="w-full flex items-center justify-between rounded-xl border border-clay/40 bg-clay/10 px-5 py-3.5 mb-6 text-left hover:border-clay transition-colors"
          >
            <span className="flex items-center gap-2.5 font-body text-sm font-medium text-clay">
              <AlertCircle size={18} className="shrink-0" />
              <span>
                <strong>{deadlinesReached} deadline{deadlinesReached === 1 ? "" : "s"} reached!</strong> Check your reminders for due accounts or pending orders.
              </span>
            </span>
            <span className="flex items-center gap-1 font-mono text-xs text-clay underline shrink-0">
              View Reminders <ChevronRight size={14} />
            </span>
          </button>
        )}

        {/* Quick actions */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-10">
          <NavCard
            icon={Receipt}
            title="New invoice"
            desc="Build a sales invoice or purchase bill. Posts to the books and updates stock on save."
            onClick={() => onNavigate("invoice")}
            highlight
            wide
          />
          <NavCard
            icon={PlusCircle}
            title="Add entry"
            desc="Record a sale, purchase, or expense. It flows into the right book automatically."
            onClick={() => onNavigate("addentry")}
          />
          <NavCard
            icon={BookOpen}
            title="Books"
            desc="Cash book, petty cash, journals, ledgers, inventory and your P&L statement."
            onClick={() => onNavigate("books")}
          />
          <NavCard
            icon={BellRing}
            title="Reminders"
            desc={
              deadlinesReached > 0
                ? `${deadlinesReached} deadline${deadlinesReached === 1 ? "" : "s"} reached! ${debtors.length + creditors.length} account${debtors.length + creditors.length === 1 ? "" : "s"} to settle.`
                : `${debtors.length + creditors.length} account${debtors.length + creditors.length === 1 ? "" : "s"} to settle, ${openOrders} order${openOrders === 1 ? "" : "s"} pending.`
            }
            onClick={() => onNavigate("reminders")}
            badge={debtors.length + creditors.length + openOrders}
            hasDeadlineAlert={deadlinesReached > 0}
          />
          <NavCard
            icon={Sparkles}
            title="AI Assistant"
            desc={
              aiActive
                ? "Ask questions or log entries in plain English \u2014 try the floating icon or Telegram."
                : "\u20a61,000/mo \u2014 add entries and check balances by just talking to it."
            }
            onClick={() => onNavigate("settings")}
          />
        </div>

        {/* This month's picture */}
        <div className="grid sm:grid-cols-3 gap-4 mb-10">
          <SnapshotStat label="Net profit so far" amount={pnl.netProfit} tone={pnl.netProfit >= 0 ? "positive" : "negative"} />
          <SnapshotStat
            label="Owed to you (debtors)"
            amount={totalDebtors}
            tone="neutral"
            onClick={() => onNavigate("reminders")}
          />
          <SnapshotStat
            label="You owe (creditors)"
            amount={totalCreditors}
            tone="neutral"
            onClick={() => onNavigate("reminders")}
          />
        </div>

        {/* Business analytics */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-xl text-ink">Analytics</h2>
          <div className="inline-flex rounded-lg border border-rule bg-surface p-1">
            <PeriodButton active={period === "week"} onClick={() => setPeriod("week")} label="Week" />
            <PeriodButton active={period === "month"} onClick={() => setPeriod("month")} label="Month" />
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-4 mb-6 items-start">
          <CashflowCard analytics={analytics} />
          <ExpenseBreakdownCard analytics={analytics} onNavigate={onNavigate} />
        </div>

        <div className="grid sm:grid-cols-2 gap-4 mb-10 items-start">
          <StockPerformanceCard
            title="Best performers"
            icon={Trophy}
            tone="positive"
            items={analytics.bestSellers}
            emptyText="No sales recorded in this period yet."
            onNavigate={onNavigate}
          />
          <StockPerformanceCard
            title="Needs attention"
            icon={AlertCircle}
            tone="negative"
            items={analytics.worstSellers}
            emptyText="Every product in stock has moved this period."
            onNavigate={onNavigate}
          />
        </div>

        {lowStock > 0 && (
          <button
            onClick={() => onNavigate("book-page", { book: "inventory" })}
            className="w-full flex items-center justify-between rounded-xl border border-clay/30 bg-clay/8 px-5 py-4 mb-10 text-left hover:border-clay/50 transition-colors"
          >
            <span className="flex items-center gap-2 font-body text-sm text-clay">
              <Package size={16} />
              {lowStock} product{lowStock === 1 ? "" : "s"} running low in inventory
            </span>
            <ChevronRight size={16} className="text-clay" />
          </button>
        )}

        {/* Recent activity */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-xl text-ink">Recent activity</h2>
          <button
            onClick={() => onNavigate("book-page", { book: "cashbook" })}
            className="font-body text-label font-medium text-action hover:underline min-h-tap"
          >
            View books
          </button>
        </div>

        {recent.length === 0 ? (
          <div className="rounded-lg border border-dashed border-rule bg-on-canvas/60 px-6 py-12 text-center">
            <p className="font-body text-sm text-ink/50">No entries yet — add your first transaction to get started.</p>
          </div>
        ) : (
          <div className="rounded-lg border border-rule bg-surface overflow-hidden">
            <div className="divide-y divide-rule">
              {recent.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-4 px-5 py-3.5">
                  <div className="min-w-0">
                    <p className="font-body text-sm text-ink truncate">
                      {t.description || t.productName || t.party || "Entry"}
                    </p>
                    <p className="font-body text-label text-ink-soft mt-0.5">
                      {formatDate(t.date)} · {labelFor(t)}
                    </p>
                  </div>
                  <span
                    className={`font-mono text-sm shrink-0 ${
                      t.tradeType === "sale" ? "text-moss" : "text-ink/70"
                    }`}
                  >
                    {formatMoney(t.amount)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Integrations */}
        <div className="mt-10 border-t border-ink/10 pt-6">
          <h2 className="font-display text-xl font-semibold mb-4 text-ink">Integrations</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <ConnectTelegram />
          </div>
        </div>
      </div>
    </div>
  );
}

function StreakBadge({ streak }) {
  if (!streak || streak.current === 0) {
    return (
      <div
        className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium border border-rule bg-surface text-ink/40"
        title="Record something today to start a streak"
      >
        <Flame size={13} />
        No streak yet
      </div>
    );
  }

  const lit = streak.recordedToday;

  return (
    <div
      className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold border ${
        lit ? "border-amber/30 bg-amber/10 text-amber-deep" : "border-ink/10 bg-surface text-ink/60"
      }`}
      title={
        lit
          ? `${streak.current}-day streak — books kept current today`
          : `${streak.current}-day streak — record something today to keep it going`
      }
    >
      <Flame size={13} className={lit ? "" : "opacity-50"} />
      {streak.current} day{streak.current === 1 ? "" : "s"}
    </div>
  );
}

function ConnectionBadge({ status, bootstrapped }) {
  const map = {
    connected: { icon: Wifi, label: "Live", color: tokenColor("moss") },
    connecting: { icon: Loader2, label: "Connecting…", color: tokenColor("ink", 53), spin: true },
    disconnected: { icon: WifiOff, label: "Offline", color: tokenColor("clay") },
  };
  const cfg = map[status] || map.connecting;
  const Icon = cfg.icon;

  return (
    <div
      className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium border border-rule bg-surface"
      style={{ color: cfg.color }}
      title={bootstrapped ? "Initial sync complete" : "Hydrating local data…"}
    >
      <Icon size={13} className={cfg.spin ? "animate-spin" : ""} />
      {cfg.label}
    </div>
  );
}

function QuickLearningModal({ tips, businessId }) {
  const storageKey = businessId ? `seenQuickLearning:${businessId}` : null;
  const [isOpen, setIsOpen] = useState(false);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!storageKey) return;
    const alreadySeen = localStorage.getItem(storageKey);
    if (!alreadySeen) setIsOpen(true);
  }, [storageKey]);

  const close = () => {
    setIsOpen(false);
    if (storageKey) localStorage.setItem(storageKey, "true");
  };

  if (!isOpen) return null;

  const goTo = (i) => setIndex(((i % tips.length) + tips.length) % tips.length);
  const current = tips[index];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-lg rounded-lg border border-rule bg-surface p-6 animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between pb-4 border-b border-ink/8 mb-5">
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-full bg-moss/12 flex items-center justify-center">
              <Lightbulb size={16} className="text-moss" />
            </span>
            <h2 className="font-display text-lg text-ink">Quick Learning</h2>
          </div>
          <button
            onClick={close}
            aria-label="Close modal"
            className="w-8 h-8 rounded-full bg-paper-sunk flex items-center justify-center text-ink/60 hover:text-ink transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="min-h-[120px]">
          <p className="font-body text-label text-ink-soft mb-1">
            Tip {index + 1} of {tips.length}
          </p>
          <h3 className="font-display text-xl text-ink mb-2">{current.term}</h3>
          <p className="font-body text-sm text-ink/70 leading-relaxed">{current.tip}</p>
        </div>

        <div className="flex items-center justify-between pt-5 mt-4 border-t border-ink/8">
          <div className="flex items-center gap-1.5">
            {tips.map((_, i) => (
              <button
                key={i}
                onClick={() => goTo(i)}
                aria-label={`Go to tip ${i + 1}`}
                className={`h-1.5 rounded-full transition-all ${
                  i === index ? "w-5 bg-action" : "w-1.5 bg-ink/15 hover:bg-ink/30"
                }`}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => goTo(index - 1)}
              aria-label="Previous tip"
              className="w-8 h-8 rounded-full border border-rule flex items-center justify-center text-ink/60 hover:text-ink hover:border-action/50 transition-colors"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => goTo(index + 1)}
              aria-label="Next tip"
              className="w-8 h-8 rounded-full border border-rule flex items-center justify-center text-ink/60 hover:text-ink hover:border-action/50 transition-colors"
            >
              <ChevronRight size={16} />
            </button>
            <button
              onClick={close}
              className="ml-2 rounded-lg bg-canvas px-4 py-2 font-body text-xs font-medium text-on-action hover:bg-action-deep transition-colors"
            >
              Got it
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function labelFor(t) {
  if (t.category === "trade") {
    const via = t.method === "credit" ? "credit" : t.method;
    return `${t.tradeType === "sale" ? "Sale" : "Purchase"} · ${via}`;
  }
  if (t.category === "runningExpense") return "Running expense";
  if (t.category === "smallExpense") return "Petty cash";
  return "Entry";
}

function NavCard({ icon: Icon, title, desc, onClick, highlight, badge, hasDeadlineAlert, wide }) {
  return (
    <button
      onClick={onClick}
      className={`text-left rounded-lg border p-5 transition-all relative ${
        wide ? "sm:col-span-2" : ""
      } ${
        highlight
          ? "border-action bg-action text-on-action hover:bg-action-deep hover:border-action-deep"
          : hasDeadlineAlert
          ? "border-clay/40 bg-clay/5 hover:border-clay"
          : "border-rule bg-surface hover:border-action/50"
      }`}
    >
      {!!badge && (
        <span
          className={`absolute top-4 right-4 min-w-[20px] h-5 px-1.5 rounded-full text-on-action text-tiny font-mono flex items-center justify-center ${
            hasDeadlineAlert ? "bg-clay animate-pulse" : "bg-clay"
          }`}
        >
          {badge}
        </span>
      )}
      <Icon size={22} className={highlight ? "text-moss-lift mb-3" : hasDeadlineAlert ? "text-clay mb-3" : "text-moss mb-3"} />
      <h3 className={`font-display text-lg mb-1.5 flex items-center gap-1.5 ${highlight ? "text-on-action" : "text-ink"}`}>
        {title}
        {hasDeadlineAlert && <AlertCircle size={16} className="text-clay" />}
        <ArrowRight size={15} className={highlight ? "text-moss-lift" : "text-ink/30"} />
      </h3>
      <p className={`font-body text-sm ${highlight ? "text-on-action/70" : hasDeadlineAlert ? "text-clay" : "text-ink/55"}`}>{desc}</p>
    </button>
  );
}

function WeekPulseCard({ pulse }) {
  const { salesCount, salesRevenue, expensesTotal, prevSalesRevenue, prevExpensesTotal } = pulse;
  const hasPrev = prevSalesRevenue > 0 || prevExpensesTotal > 0;
  const delta = salesRevenue - prevSalesRevenue;

  return (
    <div className="rounded-lg border border-rule bg-surface p-5 sm:p-6 mb-8">
      <div className="flex flex-wrap items-baseline justify-between gap-4 mb-5">
        <h2 className="font-display text-lg font-semibold text-ink">This week</h2>
        {hasPrev && (
          <span className="font-body text-label text-ink-soft">
            {delta >= 0 ? "Up" : "Down"}{" "}
            <span className={`font-mono ${delta >= 0 ? "text-moss" : "text-clay"}`}>
              {formatMoney(Math.abs(delta))}
            </span>{" "}
            on last week
          </span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-5">
        <MiniStat label="Sales made" value={salesCount} />
        <MiniStat label="Revenue" value={formatMoney(salesRevenue)} tone="positive" />
        <MiniStat label="Expenses" value={formatMoney(expensesTotal)} tone="negative" />
      </div>
    </div>
  );
}

function MiniStat({ label, value, tone }) {
  const toneClass = tone === "positive" ? "text-moss" : tone === "negative" ? "text-clay" : "text-ink";
  return (
    <div>
      <p className="font-body text-label text-ink-soft mb-1">{label}</p>
      <p className={`font-mono text-lg rule-sum pb-1.5 ${toneClass}`}>{value}</p>
    </div>
  );
}

function PeriodButton({ active, onClick, label }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-4 min-h-[40px] font-body text-label font-medium transition-colors ${
        active ? "bg-action text-on-action" : "text-ink-soft hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}

function CashflowCard({ analytics }) {
  const { cashDays, totalInflow, totalOutflow, netCashflow, maxDayValue } = analytics;
  return (
    <div className="rounded-lg border border-rule bg-surface p-5">
      <h3 className="font-display text-base font-semibold text-ink mb-4">Cashflow</h3>

      <div className="grid grid-cols-3 gap-4 mb-5">
        <MiniStat label="In" value={formatMoney(totalInflow)} tone="positive" />
        <MiniStat label="Out" value={formatMoney(totalOutflow)} tone="negative" />
        <MiniStat label="Net" value={formatMoney(netCashflow)} tone={netCashflow >= 0 ? "positive" : "negative"} />
      </div>

      {cashDays.length === 0 ? (
        <p className="font-body text-label text-ink-soft">No cash or bank movement in this period yet.</p>
      ) : (
        <CashflowChart days={cashDays} maxDayValue={maxDayValue} />
      )}
    </div>
  );
}

function ExpenseBreakdownCard({ analytics, onNavigate }) {
  const { expenseBreakdown, totalExpenses } = analytics;
  return (
    <div className="rounded-lg border border-rule bg-surface p-5 flex flex-col">
      <div className="flex items-baseline justify-between gap-3 mb-4">
        <h3 className="font-display text-base font-semibold text-ink">Where the money went</h3>
        <span className="font-mono text-label text-ink-soft">{formatMoney(totalExpenses)}</span>
      </div>

      {expenseBreakdown.length === 0 ? (
        <p className="font-body text-label text-ink-soft">No expenses recorded in this period yet.</p>
      ) : (
        <ExpenseBars items={expenseBreakdown} />
      )}

      <button
        onClick={() => onNavigate("book-page", { book: "pnl" })}
        className="pt-4 self-start font-body text-label font-medium text-action hover:underline min-h-tap"
      >
        View P&L
      </button>
    </div>
  );
}

function StockPerformanceCard({ title, icon: Icon, tone, items, emptyText, onNavigate }) {
  const color = tone === "positive" ? "text-moss" : "text-clay";
  const bg = tone === "positive" ? "bg-moss/10" : "bg-clay/10";
  return (
    <div className="rounded-lg border border-rule bg-surface p-5">
      <div className="flex items-center gap-2 mb-4">
        <span className={`w-7 h-7 rounded-full flex items-center justify-center ${bg}`}>
          <Icon size={14} className={color} />
        </span>
        <p className="font-body text-label text-ink-soft">{title}</p>
      </div>

      {items.length === 0 ? (
        <p className="font-body text-xs text-ink/40">{emptyText}</p>
      ) : (
        <div className="space-y-3">
          {items.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-body text-sm text-ink truncate">{p.name}</p>
                <p className="font-body text-label text-ink-soft">{p.unitsSold} sold · {p.stock} in stock</p>
              </div>
              <span className="font-mono text-sm text-ink shrink-0">{formatMoney(p.revenue)}</span>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={() => onNavigate("book-page", { book: "inventory" })}
        className="mt-4 font-body text-label font-medium text-action hover:underline min-h-tap"
      >
        View inventory
      </button>
    </div>
  );
}

function SnapshotStat({ label, value, amount, tone, onClick }) {
  const color = tone === "positive" ? "text-moss" : tone === "negative" ? "text-clay" : "text-ink";
  const Wrapper = onClick ? "button" : "div";
  return (
    <Wrapper
      onClick={onClick}
      className={`w-full text-left rounded-lg border border-rule bg-surface px-5 py-4 ${onClick ? "hover:border-action/50 transition-colors" : ""}`}
    >
      <p className="font-body text-label text-ink-soft mb-1">{label}</p>
      <p className={`font-mono text-2xl rule-sum pb-1.5 ${color}`}>
        {amount === undefined ? value : <AnimatedFigure value={amount} format={formatMoney} />}
      </p>
    </Wrapper>
  );
}