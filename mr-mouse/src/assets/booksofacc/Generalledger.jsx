import React from "react";
import { Library, ArrowLeft, ChevronRight } from "lucide-react";
import { useLedger } from "./Ledgercontext";
import {
  GlobalStyle,
  TopNav,
  PageHeader,
  SummaryCard,
  EmptyState,
  LedgerTable,
  LedgerRow,
  LedgerCell,
  formatMoney,
} from "./ui";

const GROUPS = [
  { label: "Assets", type: "Asset" },
  { label: "Receivables (Debtors)", type: "Asset (Receivable)" },
  { label: "Liabilities (Creditors)", type: "Liability (Payable)" },
  { label: "Revenue", type: "Revenue" },
  { label: "Expenses & Purchases", type: "Expense" },
];

const COLUMNS = [
  { key: "account", label: "Account" },
  { key: "debit", label: "Debit", align: "right" },
  { key: "credit", label: "Credit", align: "right" },
  { key: "balance", label: "Balance", align: "right" },
];

export default function GeneralLedger({ onNavigate }) {
  const { business, accounts } = useLedger();

  const totalDebit = accounts.reduce((s, a) => s + a.totalDebit, 0);
  const totalCredit = accounts.reduce((s, a) => s + a.totalCredit, 0);

  // A trial balance only balances if debits equal credits. Surfacing that
  // here — rather than leaving the reader to compare two figures — is the
  // whole reason this page exists.
  const balanced = Math.abs(totalDebit - totalCredit) < 0.005;

  return (
    <div className="min-h-screen w-full bg-paper font-body pb-24">
      <GlobalStyle />
      <TopNav business={business} current="books" onNavigate={onNavigate} />
      <PageHeader
        business={business}
        icon={Library}
        title="General Ledger"
        subtitle="Every account rolled up together — the basis for your trial balance."
      />

      <div className="max-w-5xl mx-auto px-5 sm:px-8 pt-8 relative">
        <button
          onClick={() => onNavigate("books")}
          className="flex items-center gap-1.5 font-body text-sm text-ink-soft hover:text-ink mb-6 min-h-[44px]"
        >
          <ArrowLeft size={15} /> All books
        </button>

        <div className="bg-white border border-rule rounded-lg px-5 py-5 mb-8">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-5 sm:gap-6">
            <SummaryCard label="Total debit" value={formatMoney(totalDebit)} />
            <SummaryCard label="Total credit" value={formatMoney(totalCredit)} />
            <SummaryCard label="Accounts" value={accounts.length} />
          </div>
          {accounts.length > 0 && (
            <p className={`font-body text-[13px] mt-4 ${balanced ? "text-moss" : "text-clay"}`}>
              {balanced
                ? "Debits and credits agree — the ledger balances."
                : `Out of balance by ${formatMoney(Math.abs(totalDebit - totalCredit))}. Check for an entry posted on one side only.`}
            </p>
          )}
        </div>

        {accounts.length === 0 ? (
          <EmptyState
            title="No accounts yet"
            subtitle="Post entries via Add entry to build out your general ledger."
          />
        ) : (
          <div className="space-y-8">
            {GROUPS.map((g) => {
              const rows = accounts.filter((a) => a.type === g.type);
              if (!rows.length) return null;

              const groupDebit = rows.reduce((s, a) => s + a.totalDebit, 0);
              const groupCredit = rows.reduce((s, a) => s + a.totalCredit, 0);

              return (
                <section key={g.type}>
                  <h3 className="font-display text-base font-semibold text-ink mb-3">{g.label}</h3>

                  <LedgerTable columns={COLUMNS} caption={`${g.label} accounts`}>
                    <tbody>
                      {rows.map((a) => {
                        const isCredit = a.balance < 0;
                        const last = rows[rows.length - 1] === a;
                        return (
                          <LedgerRow key={a.name}>
                            <LedgerCell>
                              <button
                                onClick={() =>
                                  onNavigate("book-page", { book: "ledger", account: a.name })
                                }
                                className="flex items-center gap-1.5 text-left text-ink hover:text-action transition-colors py-1.5"
                              >
                                <span className="truncate">{a.name}</span>
                                <ChevronRight size={14} className="text-ink/30 shrink-0" />
                              </button>
                            </LedgerCell>
                            <LedgerCell num rule={last ? "sum" : undefined}>
                              {a.totalDebit ? formatMoney(a.totalDebit) : "—"}
                            </LedgerCell>
                            <LedgerCell num rule={last ? "sum" : undefined}>
                              {a.totalCredit ? formatMoney(a.totalCredit) : "—"}
                            </LedgerCell>
                            <LedgerCell
                              num
                              tone={isCredit ? "negative" : "positive"}
                              rule={last ? "sum" : undefined}
                            >
                              {formatMoney(Math.abs(a.balance))}{" "}
                              <span className="text-ink/45">{isCredit ? "CR" : "DR"}</span>
                            </LedgerCell>
                          </LedgerRow>
                        );
                      })}

                      <tr>
                        <LedgerCell className="font-medium">{g.label} total</LedgerCell>
                        <LedgerCell num className="font-medium">{formatMoney(groupDebit)}</LedgerCell>
                        <LedgerCell num className="font-medium">{formatMoney(groupCredit)}</LedgerCell>
                        <LedgerCell num>—</LedgerCell>
                      </tr>
                    </tbody>
                  </LedgerTable>
                </section>
              );
            })}

            {/* The grand total is the one place the double rule belongs. */}
            <section>
              <LedgerTable columns={COLUMNS} caption="Trial balance totals" showHeader={false}>
                <tbody>
                  <tr>
                    <LedgerCell className="font-semibold">Trial balance</LedgerCell>
                    <LedgerCell num rule="total" className="font-semibold">
                      {formatMoney(totalDebit)}
                    </LedgerCell>
                    <LedgerCell num rule="total" className="font-semibold">
                      {formatMoney(totalCredit)}
                    </LedgerCell>
                    <LedgerCell num className={balanced ? "text-moss" : "text-clay"}>
                      {balanced ? "Balanced" : "Out by " + formatMoney(Math.abs(totalDebit - totalCredit))}
                    </LedgerCell>
                  </tr>
                </tbody>
              </LedgerTable>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
