import React, { useState, useMemo } from "react";
import {
  PlusCircle,
  BookOpen,
  BellRing,
  Package,
  ArrowRight,
  ChevronRight,
  Receipt,
  Trophy,
  AlertCircle,
  Wifi,
  WifiOff,
  Loader2,
  Flame,
  Sparkles,
  Wallet,
  TrendingUp,
  TrendingDown,
  PiggyBank,
  HandCoins,
  Truck,
} from "lucide-react";
import { tokenColor } from "../theme/tokens";
import { useLedger, usePref } from "../booksofacc/Ledgercontext";
import { LAYOUT_PREF } from "../theme/AppearanceSync";
import { LAYOUT_IDS } from "./dashboardLayouts";
import { GlobalStyle, TopNav, AnimatedFigure, formatMoney, formatDate } from "../booksofacc/ui.jsx";
import DashboardHero from "./DashboardHero";
import { CashflowChart, ExpenseBars } from "./Charts";
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

export default function Dashboard({ onNavigate }) {
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
    transactions,
    settlements,
    streak,
    connectionStatus,
    bootstrapped,
  } = useLedger();

  // The provider's sync connection. The dashboard used to open a second
  // socket of its own, which doubled every sync message on this screen.
  const { subscription: aiSubscription } = useSubscription(business?.id);
  const aiActive = Boolean(aiSubscription?.addOns?.ai);

  const layoutPref = usePref(LAYOUT_PREF, "classic");
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

  const layout = LAYOUT_IDS.includes(layoutPref) ? layoutPref : "classic";
  const settleCount = debtors.length + creditors.length;

  const deadlineBanner = deadlinesReached > 0 && (
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
  );

  const actions = (
    <div data-tour="dashboard-actions" className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-10">
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
            ? `${deadlinesReached} deadline${deadlinesReached === 1 ? "" : "s"} reached! ${settleCount} account${settleCount === 1 ? "" : "s"} to settle.`
            : `${settleCount} account${settleCount === 1 ? "" : "s"} to settle, ${openOrders} order${openOrders === 1 ? "" : "s"} pending.`
        }
        onClick={() => onNavigate("reminders")}
        badge={settleCount + openOrders}
        hasDeadlineAlert={deadlinesReached > 0}
      />
      <NavCard
        icon={Sparkles}
        title="AI Assistant"
        desc={
          aiActive
            ? "Ask questions or log entries in plain English — try the floating icon or Telegram."
            : "₦1,000/mo — add entries and check balances by just talking to it."
        }
        onClick={() => onNavigate("settings")}
      />
    </div>
  );

  // Compact: one row of small buttons instead of the description cards.
  const compactActions = (
    <div data-tour="dashboard-actions" className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-6">
      {[
        [Receipt, "New invoice", () => onNavigate("invoice"), true],
        [PlusCircle, "Add entry", () => onNavigate("addentry")],
        [BookOpen, "Books", () => onNavigate("books")],
        [BellRing, `Reminders${settleCount + openOrders ? ` (${settleCount + openOrders})` : ""}`, () => onNavigate("reminders")],
      ].map(([Icon, label, onClick, primary]) => (
        <button
          key={label}
          onClick={onClick}
          className={`flex items-center justify-center gap-2 rounded-md min-h-tap px-3 font-body text-sm font-medium transition-colors ${
            primary ? "bg-action text-on-action hover:bg-action-deep" : "border border-rule bg-surface text-ink hover:border-action/50"
          }`}
        >
          <Icon size={16} /> {label}
        </button>
      ))}
    </div>
  );

  const snapshot = (
    <div className="grid sm:grid-cols-3 gap-4 mb-10">
      <SnapshotStat label="Net profit so far" amount={pnl.netProfit} tone={pnl.netProfit >= 0 ? "positive" : "negative"} />
      <SnapshotStat label="Owed to you (debtors)" amount={totalDebtors} tone="neutral" onClick={() => onNavigate("reminders")} />
      <SnapshotStat label="You owe (creditors)" amount={totalCreditors} tone="neutral" onClick={() => onNavigate("reminders")} />
    </div>
  );

  // Compact: every key figure in one ruled list.
  const figureList = (
    <div className="rounded-lg border border-rule bg-surface mb-6">
      <h2 className="font-display text-base font-semibold text-ink px-4 pt-3.5 pb-2">Key figures</h2>
      <dl className="grid sm:grid-cols-2 sm:divide-x divide-rule border-t border-rule">
        {[
          [
            ["Cash available", formatMoney(cashAvailable)],
            ["Petty cash", formatMoney(pettyCash)],
            [`Sales this week (${pulse.salesCount})`, formatMoney(pulse.salesRevenue), "positive"],
            ["Expenses this week", formatMoney(pulse.expensesTotal), "negative"],
            ["Net this week", formatMoney(pulse.net), pulse.net >= 0 ? "positive" : "negative"],
          ],
          [
            ["Net profit so far", formatMoney(pnl.netProfit), pnl.netProfit >= 0 ? "positive" : "negative"],
            ["Owed to you", formatMoney(totalDebtors)],
            ["You owe", formatMoney(totalCreditors)],
            ["Orders pending", openOrders],
            ["Products running low", lowStock, lowStock > 0 ? "negative" : undefined],
          ],
        ].map((column, ci) => (
          <div key={ci} className="divide-y divide-rule">
            {column.map(([label, value, tone]) => (
              <div key={label} className="flex items-center justify-between gap-3 px-4 py-2">
                <dt className="font-body text-label text-ink-soft">{label}</dt>
                <dd className={`font-mono text-sm ${tone === "positive" ? "text-moss" : tone === "negative" ? "text-clay" : "text-ink"}`}>{value}</dd>
              </div>
            ))}
          </div>
        ))}
      </dl>
    </div>
  );

  // Cards: big numbers with plain-language labels.
  const bigCards = (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
      <BigStatCard icon={Wallet} tone="action" label="Money you can spend now" amount={cashAvailable} hint="Cash in hand plus your bank balance." />
      <BigStatCard icon={TrendingUp} tone="positive" label="Sold this week" amount={pulse.salesRevenue} hint={`${pulse.salesCount} sale${pulse.salesCount === 1 ? "" : "s"} so far.`} />
      <BigStatCard icon={TrendingDown} tone="negative" label="Spent this week" amount={pulse.expensesTotal} hint="Running costs and small expenses." />
      <BigStatCard
        icon={PiggyBank}
        tone={pnl.netProfit >= 0 ? "positive" : "negative"}
        label={pnl.netProfit >= 0 ? "Profit so far" : "Loss so far"}
        amount={Math.abs(pnl.netProfit)}
        hint="What's left after costs and expenses."
      />
      <BigStatCard icon={HandCoins} tone="caution" label="Customers owe you" amount={totalDebtors} hint={`${debtors.length} customer${debtors.length === 1 ? "" : "s"}. Tap to see who.`} onClick={() => onNavigate("reminders")} />
      <BigStatCard icon={Truck} tone="neutral" label="You owe suppliers" amount={totalCreditors} hint={`${creditors.length} supplier${creditors.length === 1 ? "" : "s"}. Tap to see who.`} onClick={() => onNavigate("reminders")} />
    </div>
  );

  const analyticsSection = (
    <>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-xl text-ink">Analytics</h2>
        <div className="inline-flex rounded-lg border border-rule bg-surface p-1">
          <PeriodButton active={period === "week"} onClick={() => setPeriod("week")} label="Week" />
          <PeriodButton active={period === "month"} onClick={() => setPeriod("month")} label="Month" />
        </div>
      </div>

      <div className={`grid lg:grid-cols-2 ${layout === "compact" ? "gap-3 mb-4" : "gap-4 mb-6"} items-start`}>
        <CashflowCard analytics={analytics} />
        <ExpenseBreakdownCard analytics={analytics} onNavigate={onNavigate} />
      </div>

      <div className={`grid sm:grid-cols-2 ${layout === "compact" ? "gap-3 mb-6" : "gap-4 mb-10"} items-start`}>
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
    </>
  );

  const lowStockBanner = lowStock > 0 && (
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
  );

  const recentSection = (
    <>
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
        <div className="rounded-lg border border-dashed border-rule bg-surface/60 px-6 py-12 text-center">
          <p className="font-body text-sm text-ink/50">No entries yet — add your first transaction to get started.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-rule bg-surface overflow-hidden">
          <div className="divide-y divide-rule">
            {recent.map((t) => (
              <div key={t.id} className={`flex items-center justify-between gap-4 px-5 ${layout === "compact" ? "py-2.5" : "py-3.5"}`}>
                <div className="min-w-0">
                  <p className="font-body text-sm text-ink truncate">{t.description || t.productName || t.party || "Entry"}</p>
                  <p className="font-body text-label text-ink-soft mt-0.5">
                    {formatDate(t.date)} · {labelFor(t)}
                  </p>
                </div>
                <span className={`font-mono text-sm shrink-0 ${t.tradeType === "sale" ? "text-moss" : "text-ink/70"}`}>{formatMoney(t.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );

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
        compact={layout === "compact"}
        right={
          <div className="flex items-center gap-2.5 shrink-0">
            <StreakBadge streak={streak} />
            <ConnectionBadge status={connectionStatus} bootstrapped={bootstrapped} />
          </div>
        }
      />

      <div className={`max-w-5xl mx-auto px-5 sm:px-8 ${layout === "compact" ? "pt-5" : "pt-8"} relative pb-24`}>
        {layout === "classic" && <WeekPulseCard pulse={pulse} />}
        {deadlineBanner}
        {layout === "compact" ? (
          <>
            {compactActions}
            {figureList}
          </>
        ) : layout === "cards" ? (
          <>
            {bigCards}
            {actions}
          </>
        ) : (
          <>
            {actions}
            {snapshot}
          </>
        )}
        {analyticsSection}
        {lowStockBanner}
        {recentSection}

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

const CARD_TONES = {
  action: { icon: "text-action", chip: "bg-action-sunk", figure: "text-ink" },
  positive: { icon: "text-moss", chip: "bg-moss/12", figure: "text-moss" },
  negative: { icon: "text-clay", chip: "bg-clay/12", figure: "text-clay" },
  caution: { icon: "text-amber-deep", chip: "bg-amber/15", figure: "text-ink" },
  neutral: { icon: "text-ink-soft", chip: "bg-ink/8", figure: "text-ink" },
};

function BigStatCard({ icon: Icon, tone = "neutral", label, amount, hint, onClick }) {
  const t = CARD_TONES[tone] || CARD_TONES.neutral;
  const Wrapper = onClick ? "button" : "div";
  return (
    <Wrapper
      onClick={onClick}
      className={`w-full text-left rounded-2xl border border-rule bg-surface p-5 sm:p-6 ${onClick ? "hover:border-action/50 transition-colors" : ""}`}
    >
      <span className={`w-11 h-11 rounded-full flex items-center justify-center mb-4 ${t.chip}`}>
        <Icon size={20} className={t.icon} />
      </span>
      <p className="font-body text-base font-medium text-ink mb-1">{label}</p>
      <p className={`font-mono text-3xl sm:text-[2rem] leading-tight ${t.figure}`}>
        <AnimatedFigure value={amount} format={formatMoney} />
      </p>
      {hint && <p className="font-body text-sm text-ink-soft mt-2">{hint}</p>}
    </Wrapper>
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
        onClick={() => onNavigate("book-page", { book: "pnlstatement" })}
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