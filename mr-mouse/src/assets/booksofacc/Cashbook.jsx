import React, { useMemo, useState } from "react";
import { Wallet, Search, Landmark } from "lucide-react";
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
  formatDate,
  formatMoney,
} from "./ui";

const COLUMNS = [
  { key: "date", label: "Date", width: "1%" },
  { key: "particulars", label: "Particulars" },
  { key: "method", label: "Method", width: "1%" },
  { key: "receipts", label: "Receipts", align: "right" },
  { key: "payments", label: "Payments", align: "right" },
  { key: "balance", label: "Balance", align: "right" },
];

const FILTERS = [
  { key: "all", label: "All" },
  { key: "cash", label: "Cash" },
  { key: "bank", label: "Bank" },
];

export default function CashBook({ onNavigate }) {
  const { business, cashBookEntries } = useLedger();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all"); // all | cash | bank

  const rows = useMemo(() => {
    let list = cashBookEntries;
    if (filter !== "all") list = list.filter((t) => t.method === filter);
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((t) =>
        [t.description, t.productName, t.party].filter(Boolean).join(" ").toLowerCase().includes(q)
      );
    }
    return list;
  }, [cashBookEntries, filter, query]);

  // "sale" covers both a cash/bank sale and a debtor settlement (money
  // in); anything else (purchase, running expense, creditor settlement)
  // is money out. See cashBookEntries in Ledgercontext for the mapping.
  const isReceiptRow = (t) => t.tradeType === "sale";

  let runningCash = 0;
  let runningBank = 0;
  const withBalance = [...rows]
    .reverse()
    .map((t) => {
      const isReceipt = isReceiptRow(t);
      const signed = isReceipt ? t.amount : -t.amount;
      if (t.method === "cash") runningCash += signed;
      else runningBank += signed;
      return { ...t, isReceipt, balanceCash: runningCash, balanceBank: runningBank };
    })
    .reverse();

  const totalReceipts = rows.filter(isReceiptRow).reduce((s, t) => s + t.amount, 0);
  const totalPayments = rows.reduce((s, t) => s + (isReceiptRow(t) ? 0 : t.amount), 0);
  const net = totalReceipts - totalPayments;

  return (
    <div className="min-h-screen w-full bg-paper font-body pb-24">
      <GlobalStyle />
      <TopNav business={business} current="books" onNavigate={onNavigate} />
      <PageHeader
        business={business}
        icon={Wallet}
        title="Cash Book"
        subtitle="Cash and bank sales, purchases, and running expenses, in one running record."
      />

      <div className="max-w-5xl mx-auto px-5 sm:px-8 pt-8 relative">
        <BackLink onClick={() => onNavigate("books")} />

        <SummaryPanel
          note={
            rows.length
              ? `Net movement over ${rows.length} ${rows.length === 1 ? "entry" : "entries"}: ${formatMoney(net)}`
              : undefined
          }
          noteTone={net >= 0 ? "positive" : "negative"}
        >
          <SummaryCard label="Total receipts" value={formatMoney(totalReceipts)} accent />
          <SummaryCard label="Total payments" value={formatMoney(totalPayments)} warn={totalPayments > 0} />
          <SummaryCard label="Entries" value={rows.length} />
        </SummaryPanel>

        <div className="flex flex-wrap items-center gap-3 mb-5">
          <div className="flex-1 min-w-[200px] flex items-center gap-2.5 rounded-md border border-rule bg-white px-4 min-h-[44px]">
            <Search size={16} className="text-ink/40 shrink-0" />
            <label htmlFor="cashbook-search" className="sr-only">
              Search particulars
            </label>
            <input
              id="cashbook-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search particulars…"
              className="w-full bg-transparent outline-none text-sm text-ink placeholder:text-ink/35 font-body"
            />
          </div>
          <div className="flex gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                aria-pressed={filter === f.key}
                className={`rounded-md px-4 min-h-[44px] font-body text-sm font-medium transition-colors ${
                  filter === f.key
                    ? "bg-action text-white"
                    : "bg-white border border-rule text-ink-soft hover:text-ink"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {withBalance.length === 0 ? (
          <EmptyState
            title={query || filter !== "all" ? "Nothing matches that" : "No cash or bank entries yet"}
            subtitle={
              query || filter !== "all"
                ? "Try a different search term, or clear the filter."
                : "Cash and bank transactions from Add entry will appear here."
            }
          />
        ) : (
          <LedgerTable columns={COLUMNS} caption="Cash and bank movements" minWidth={780}>
            <tbody>
              {withBalance.map((t, i) => {
                const last = i === withBalance.length - 1;
                return (
                  <LedgerRow key={t.id}>
                    <LedgerCell className="whitespace-nowrap">{formatDate(t.date)}</LedgerCell>
                    <LedgerCell>
                      <span className="block truncate">{t.description || t.productName || "—"}</span>
                      {(t.party || t.category === "runningExpense") && (
                        <span className="block text-[13px] text-ink-soft truncate">
                          {t.party || "Running expense"}
                        </span>
                      )}
                    </LedgerCell>
                    <LedgerCell>
                      <Pill tone="neutral">
                        {t.method === "bank" ? <Landmark size={11} /> : <Wallet size={11} />}
                        {t.method}
                      </Pill>
                    </LedgerCell>
                    <LedgerCell num tone="positive" rule={last ? "sum" : undefined}>
                      {t.isReceipt ? formatMoney(t.amount) : "—"}
                    </LedgerCell>
                    <LedgerCell num tone="negative" rule={last ? "sum" : undefined}>
                      {!t.isReceipt ? formatMoney(t.amount) : "—"}
                    </LedgerCell>
                    <LedgerCell num rule={last ? "sum" : undefined}>
                      {formatMoney(t.method === "bank" ? t.balanceBank : t.balanceCash)}
                    </LedgerCell>
                  </LedgerRow>
                );
              })}
              <tr>
                <LedgerCell className="font-medium" colSpan={3}>
                  Totals
                </LedgerCell>
                <LedgerCell num tone="positive" rule="total" className="font-semibold">
                  {formatMoney(totalReceipts)}
                </LedgerCell>
                <LedgerCell num tone="negative" rule="total" className="font-semibold">
                  {formatMoney(totalPayments)}
                </LedgerCell>
                <LedgerCell num className={net >= 0 ? "text-moss" : "text-clay"}>
                  {formatMoney(net)}
                </LedgerCell>
              </tr>
            </tbody>
          </LedgerTable>
        )}
      </div>
    </div>
  );
}
