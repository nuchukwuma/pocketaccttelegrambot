import React from "react";
import { PiggyBank } from "lucide-react";
import { useLedger } from "./Ledgercontext";
import {
  GlobalStyle,
  TopNav,
  PageHeader,
  SummaryCard,
  SummaryPanel,
  BackLink,
  EmptyState,
  LedgerTable,
  LedgerRow,
  LedgerCell,
  formatDate,
  formatMoney,
} from "./ui";

const COLUMNS = [
  { key: "date", label: "Date", width: "1%" },
  { key: "particulars", label: "Particulars" },
  { key: "paidTo", label: "Paid to" },
  { key: "amount", label: "Amount", align: "right" },
  { key: "running", label: "Running total", align: "right" },
];

export default function PettyCashBook({ onNavigate }) {
  const { business, pettyCashEntries } = useLedger();

  const total = pettyCashEntries.reduce((s, t) => s + t.amount, 0);
  let running = 0;
  const withBalance = [...pettyCashEntries]
    .reverse()
    .map((t) => {
      running += t.amount;
      return { ...t, balance: running };
    })
    .reverse();

  return (
    <div className="min-h-screen w-full bg-paper font-body pb-24">
      <GlobalStyle />
      <TopNav business={business} current="books" onNavigate={onNavigate} />
      <PageHeader
        business={business}
        icon={PiggyBank}
        title="Petty Cash Book"
        subtitle="Small expenses recorded straight from Add entry."
      />

      <div className="max-w-4xl mx-auto px-5 sm:px-8 pt-8 relative">
        <BackLink onClick={() => onNavigate("books")} />

        <SummaryPanel>
          <SummaryCard label="Total spent" value={formatMoney(total)} warn={total > 0} />
          <SummaryCard label="Entries" value={pettyCashEntries.length} />
        </SummaryPanel>

        {withBalance.length === 0 ? (
          <EmptyState
            title="No petty cash entries yet"
            subtitle="Small expenses from Add entry will appear here."
          />
        ) : (
          <LedgerTable columns={COLUMNS} caption="Petty cash entries" minWidth={620}>
            <tbody>
              {withBalance.map((t, i) => {
                const last = i === withBalance.length - 1;
                return (
                  <LedgerRow key={t.id}>
                    <LedgerCell className="whitespace-nowrap">{formatDate(t.date)}</LedgerCell>
                    <LedgerCell>{t.description}</LedgerCell>
                    <LedgerCell className="text-ink-soft">{t.party || "—"}</LedgerCell>
                    <LedgerCell num tone="negative" rule={last ? "sum" : undefined}>
                      {formatMoney(t.amount)}
                    </LedgerCell>
                    <LedgerCell num rule={last ? "sum" : undefined}>
                      {formatMoney(t.balance)}
                    </LedgerCell>
                  </LedgerRow>
                );
              })}
              <tr>
                <LedgerCell className="font-medium" colSpan={3}>
                  Total spent
                </LedgerCell>
                <LedgerCell num tone="negative" rule="total" className="font-semibold">
                  {formatMoney(total)}
                </LedgerCell>
                <LedgerCell num>—</LedgerCell>
              </tr>
            </tbody>
          </LedgerTable>
        )}
      </div>
    </div>
  );
}
