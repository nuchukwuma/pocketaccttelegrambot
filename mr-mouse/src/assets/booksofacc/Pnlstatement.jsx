import React, { useState } from "react";
import { FileBarChart, Scale, TrendingUp } from "lucide-react";
import { useLedger } from "./Ledgercontext";
import {
  GlobalStyle,
  TopNav,
  PageHeader,
  SummaryCard,
  SummaryPanel,
  BackLink,
  LedgerTable,
  LedgerRow,
  LedgerCell,
  withViewTransition,
  formatMoney,
} from "./ui";

const TRIAL_COLUMNS = [
  { key: "account", label: "Account" },
  { key: "type", label: "Type" },
  { key: "debit", label: "Debit", align: "right" },
  { key: "credit", label: "Credit", align: "right" },
];

/* One line of a profit & loss statement. `rule` carries the accounting
   convention through: a single rule closes a section being summed, and
   the double rule sits above the final figure. */
function StatementLine({ label, amount, bracket, strong, indent, rule }) {
  const ruleClass = rule === "sum" ? "rule-sum" : rule === "total" ? "rule-total" : "";
  return (
    <div className="px-5 py-3 flex items-center justify-between gap-6">
      <span
        className={`font-body text-sm ${indent ? "pl-4 text-ink-soft" : "text-ink"} ${
          strong ? "font-medium" : ""
        }`}
      >
        {label}
      </span>
      <span
        className={`font-mono text-sm whitespace-nowrap pb-1 ${ruleClass} ${
          strong ? "font-semibold text-ink" : indent ? "text-ink-soft" : "text-ink"
        }`}
      >
        {bracket ? `(${formatMoney(amount)})` : formatMoney(amount)}
      </span>
    </div>
  );
}

export default function PnLStatement({ onNavigate }) {
  const { business, trialBalance, pnl } = useLedger();
  const [tab, setTab] = useState("pnl"); // 'pnl' | 'trial'

  const switchTab = (next) => withViewTransition(() => setTab(next));

  const TABS = [
    { key: "pnl", label: "Profit & Loss", icon: TrendingUp },
    { key: "trial", label: "Trial Balance", icon: Scale },
  ];

  return (
    <div className="min-h-screen w-full bg-paper font-body pb-24">
      <GlobalStyle />
      <TopNav business={business} current="books" onNavigate={onNavigate} />
      <PageHeader
        business={business}
        icon={FileBarChart}
        title="Statement"
        subtitle="Trial balance and profit & loss, drawn straight from the general ledger."
      />

      <div className="max-w-4xl mx-auto px-5 sm:px-8 pt-8 relative">
        <BackLink onClick={() => onNavigate("books")} />

        <div className="flex gap-1.5 mb-6" role="tablist">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                role="tab"
                aria-selected={active}
                onClick={() => switchTab(t.key)}
                className={`flex items-center gap-1.5 rounded-md px-4 min-h-tap font-body text-sm font-medium transition-colors ${
                  active
                    ? "bg-action text-on-action"
                    : "bg-surface border border-rule text-ink-soft hover:text-ink"
                }`}
              >
                <Icon size={15} /> {t.label}
              </button>
            );
          })}
        </div>

        <div className="ledger-view">
          {tab === "trial" ? (
            <>
              <SummaryPanel
                note={
                  trialBalance.balanced
                    ? "Debits and credits agree."
                    : "Debits and credits don't match — double-check recent entries."
                }
                noteTone={trialBalance.balanced ? "positive" : "negative"}
              >
                <SummaryCard label="Total debit" value={formatMoney(trialBalance.totalDebit)} />
                <SummaryCard
                  label="Total credit"
                  value={formatMoney(trialBalance.totalCredit)}
                  warn={!trialBalance.balanced}
                />
              </SummaryPanel>

              <LedgerTable columns={TRIAL_COLUMNS} caption="Trial balance" minWidth={620}>
                <tbody>
                  {trialBalance.rows.map((r, i) => {
                    const last = i === trialBalance.rows.length - 1;
                    return (
                      <LedgerRow key={r.name}>
                        <LedgerCell>{r.name}</LedgerCell>
                        <LedgerCell className="text-ink-soft text-label">{r.type}</LedgerCell>
                        <LedgerCell num tone="positive" rule={last ? "sum" : undefined}>
                          {r.debit ? formatMoney(r.debit) : "—"}
                        </LedgerCell>
                        <LedgerCell num tone="negative" rule={last ? "sum" : undefined}>
                          {r.credit ? formatMoney(r.credit) : "—"}
                        </LedgerCell>
                      </LedgerRow>
                    );
                  })}
                  <tr>
                    <LedgerCell className="font-semibold" colSpan={2}>
                      Total
                    </LedgerCell>
                    <LedgerCell num rule="total" className="font-semibold">
                      {formatMoney(trialBalance.totalDebit)}
                    </LedgerCell>
                    <LedgerCell num rule="total" className="font-semibold">
                      {formatMoney(trialBalance.totalCredit)}
                    </LedgerCell>
                  </tr>
                </tbody>
              </LedgerTable>
            </>
          ) : (
            <>
              <SummaryPanel>
                <SummaryCard label="Sales" value={formatMoney(pnl.sales)} accent />
                <SummaryCard label="Purchases (COGS)" value={formatMoney(pnl.purchases)} warn={pnl.purchases > 0} />
                <SummaryCard
                  label="Operating expenses"
                  value={formatMoney(pnl.totalExpenses)}
                  warn={pnl.totalExpenses > 0}
                />
              </SummaryPanel>

              <div className="rounded-lg border border-rule bg-surface overflow-hidden mb-6">
                <StatementLine label="Sales" amount={pnl.sales} />
                <StatementLine label="Less: Purchases" amount={pnl.purchases} bracket rule="sum" />
                <StatementLine label="Gross profit" amount={pnl.grossProfit} strong />

                {pnl.expenseLines.length > 0 && (
                  <p className="px-5 pt-4 pb-1 font-body text-label text-ink-soft">
                    Less: Operating expenses
                  </p>
                )}
                {pnl.expenseLines.map((l, i) => (
                  <StatementLine
                    key={l.label}
                    label={l.label}
                    amount={l.amount}
                    bracket
                    indent
                    rule={i === pnl.expenseLines.length - 1 ? "sum" : undefined}
                  />
                ))}

                <div className="px-5 py-5 flex items-center justify-between gap-6 bg-canvas">
                  <span className="font-display text-lg font-semibold text-on-canvas">Net profit</span>
                  <span
                    className={`font-mono text-2xl whitespace-nowrap ${
                      pnl.netProfit >= 0 ? "text-moss-lift" : "text-clay-lift"
                    }`}
                  >
                    {formatMoney(pnl.netProfit)}
                  </span>
                </div>
              </div>

              <p className="font-body text-label text-ink-soft max-w-prose">
                Sales and purchases include both cash/bank and credit transactions. Credit balances
                still owed are tracked separately under Reminders.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
