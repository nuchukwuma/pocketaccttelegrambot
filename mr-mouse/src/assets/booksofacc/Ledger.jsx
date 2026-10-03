import React, { useState, useMemo } from "react";
import { BookMarked, Search, ChevronRight } from "lucide-react";
import { useLedger } from "./Ledgercontext";
import {
  GlobalStyle,
  TopNav,
  PageHeader,
  SummaryCard,
  SummaryPanel,
  BackLink,
  EmptyState,
  Pill,
  LedgerTable,
  LedgerRow,
  LedgerCell,
  withViewTransition,
  formatDate,
  formatMoney,
} from "./ui";

const ACCOUNT_COLUMNS = [
  { key: "date", label: "Date", width: "1%" },
  { key: "particulars", label: "Particulars" },
  { key: "debit", label: "Debit", align: "right" },
  { key: "credit", label: "Credit", align: "right" },
  { key: "balance", label: "Balance", align: "right" },
];

const LIST_COLUMNS = [
  { key: "account", label: "Account" },
  { key: "type", label: "Type" },
  { key: "balance", label: "Balance", align: "right" },
];

export default function Ledger({ onNavigate, params }) {
  const { business, accounts } = useLedger();
  const [selected, setSelected] = useState(params?.account || null);
  const [query, setQuery] = useState("");

  const filteredAccounts = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter((a) => a.name.toLowerCase().includes(q));
  }, [accounts, query]);

  const account = accounts.find((a) => a.name === selected) || null;

  // A ledger account carries a running balance down the page — that is
  // what makes it a ledger rather than a list of postings.
  const rowsWithBalance = useMemo(() => {
    if (!account) return [];
    let running = 0;
    return account.rows.map((r) => {
      running += (r.debit || 0) - (r.credit || 0);
      return { ...r, running };
    });
  }, [account]);

  const open = (name) => withViewTransition(() => setSelected(name));

  return (
    <div className="min-h-screen w-full bg-paper font-body pb-24">
      <GlobalStyle />
      <TopNav business={business} current="books" onNavigate={onNavigate} />
      <PageHeader
        business={business}
        icon={BookMarked}
        title={account ? account.name : "Ledger"}
        subtitle={
          account
            ? `${account.type} account — every posting that touched it.`
            : "Every account, built automatically from your journals and cash book."
        }
      />

      <div className="max-w-5xl mx-auto px-5 sm:px-8 pt-8 relative">
        <BackLink onClick={() => (account ? open(null) : onNavigate("books"))}>
          {account ? "All accounts" : "All books"}
        </BackLink>

        <div className="ledger-view">
          {!account ? (
            <>
              <div className="mb-5 flex items-center gap-2.5 rounded-md border border-rule bg-surface px-4 min-h-tap">
                <Search size={16} className="text-ink/40 shrink-0" />
                <label htmlFor="ledger-search" className="sr-only">
                  Search accounts
                </label>
                <input
                  id="ledger-search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search accounts…"
                  className="w-full bg-transparent outline-none text-sm text-ink placeholder:text-ink/35 font-body"
                />
              </div>

              {filteredAccounts.length === 0 ? (
                <EmptyState
                  title={query ? "No account matches that" : "No accounts yet"}
                  subtitle={
                    query
                      ? "Try a shorter search term."
                      : "Accounts appear as soon as you add entries."
                  }
                />
              ) : (
                <LedgerTable columns={LIST_COLUMNS} caption="All accounts" minWidth={480}>
                  <tbody>
                    {filteredAccounts.map((a) => {
                      const isCredit = a.balance < 0;
                      return (
                        <LedgerRow key={a.name}>
                          <LedgerCell>
                            <button
                              onClick={() => open(a.name)}
                              className="flex items-center gap-1.5 text-left text-ink hover:text-action transition-colors py-1.5"
                            >
                              <span className="truncate">{a.name}</span>
                              <ChevronRight size={14} className="text-ink/30 shrink-0" />
                            </button>
                          </LedgerCell>
                          <LedgerCell>
                            <Pill tone="neutral">{a.type}</Pill>
                          </LedgerCell>
                          <LedgerCell num tone={isCredit ? "negative" : "positive"}>
                            {formatMoney(Math.abs(a.balance))}{" "}
                            <span className="text-ink/45">{isCredit ? "CR" : "DR"}</span>
                          </LedgerCell>
                        </LedgerRow>
                      );
                    })}
                  </tbody>
                </LedgerTable>
              )}
            </>
          ) : (
            <>
              <SummaryPanel>
                <SummaryCard label="Total debit" value={formatMoney(account.totalDebit)} />
                <SummaryCard label="Total credit" value={formatMoney(account.totalCredit)} />
                <SummaryCard
                  label="Balance"
                  value={`${formatMoney(Math.abs(account.balance))} ${account.balance < 0 ? "CR" : "DR"}`}
                  warn={account.balance < 0}
                  accent={account.balance >= 0}
                />
              </SummaryPanel>

              {rowsWithBalance.length === 0 ? (
                <EmptyState
                  title="Nothing posted to this account yet"
                  subtitle="Entries that touch this account will appear here."
                />
              ) : (
                <LedgerTable
                  columns={ACCOUNT_COLUMNS}
                  caption={`${account.name} account`}
                  minWidth={700}
                >
                  <tbody>
                    {rowsWithBalance.map((r, i) => {
                      const last = i === rowsWithBalance.length - 1;
                      return (
                        <LedgerRow key={r.id}>
                          <LedgerCell className="whitespace-nowrap">{formatDate(r.date)}</LedgerCell>
                          <LedgerCell>{r.particulars}</LedgerCell>
                          <LedgerCell num tone="positive" rule={last ? "sum" : undefined}>
                            {r.debit ? formatMoney(r.debit) : "—"}
                          </LedgerCell>
                          <LedgerCell num tone="negative" rule={last ? "sum" : undefined}>
                            {r.credit ? formatMoney(r.credit) : "—"}
                          </LedgerCell>
                          <LedgerCell num rule={last ? "sum" : undefined}>
                            {formatMoney(Math.abs(r.running))}{" "}
                            <span className="text-ink/45">{r.running < 0 ? "CR" : "DR"}</span>
                          </LedgerCell>
                        </LedgerRow>
                      );
                    })}
                    <tr>
                      <LedgerCell className="font-medium" colSpan={2}>
                        Closing balance
                      </LedgerCell>
                      <LedgerCell num tone="positive" rule="total" className="font-semibold">
                        {formatMoney(account.totalDebit)}
                      </LedgerCell>
                      <LedgerCell num tone="negative" rule="total" className="font-semibold">
                        {formatMoney(account.totalCredit)}
                      </LedgerCell>
                      <LedgerCell num rule="total" className="font-semibold">
                        {formatMoney(Math.abs(account.balance))}{" "}
                        <span className="text-ink/45">{account.balance < 0 ? "CR" : "DR"}</span>
                      </LedgerCell>
                    </tr>
                  </tbody>
                </LedgerTable>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
