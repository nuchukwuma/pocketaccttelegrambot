import React from "react";
import { ShoppingCart } from "lucide-react";
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
  { key: "customer", label: "Customer" },
  { key: "product", label: "Product / particulars" },
  { key: "qty", label: "Qty", align: "right" },
  { key: "amount", label: "Amount", align: "right" },
];

export default function SalesJournal({ onNavigate }) {
  const { business, salesJournalEntries } = useLedger();
  const total = salesJournalEntries.reduce((s, t) => s + t.amount, 0);
  const totalUnits = salesJournalEntries.reduce((s, t) => s + (Number(t.quantity) || 0), 0);

  return (
    <div className="min-h-screen w-full bg-paper font-body pb-24">
      <GlobalStyle />
      <TopNav business={business} current="books" onNavigate={onNavigate} />
      <PageHeader
        business={business}
        icon={ShoppingCart}
        title="Sales Journal"
        subtitle="Goods sold on credit — each line also opens a debtor account."
      />

      <div className="max-w-5xl mx-auto px-5 sm:px-8 pt-8 relative">
        <BackLink onClick={() => onNavigate("books")} />

        <SummaryPanel>
          <SummaryCard label="Total on credit" value={formatMoney(total)} accent />
          <SummaryCard label="Units sold" value={totalUnits} />
          <SummaryCard label="Entries" value={salesJournalEntries.length} />
        </SummaryPanel>

        {salesJournalEntries.length === 0 ? (
          <EmptyState
            title="No credit sales yet"
            subtitle="Credit sales from Add entry will appear here."
          />
        ) : (
          <LedgerTable columns={COLUMNS} caption="Credit sales" minWidth={660}>
            <tbody>
              {salesJournalEntries.map((t, i) => {
                const last = i === salesJournalEntries.length - 1;
                return (
                  <LedgerRow key={t.id}>
                    <LedgerCell className="whitespace-nowrap">{formatDate(t.date)}</LedgerCell>
                    <LedgerCell>{t.party || "—"}</LedgerCell>
                    <LedgerCell>
                      <span className="block truncate">{t.productName || "—"}</span>
                      {t.description && (
                        <span className="block text-label text-ink-soft truncate">{t.description}</span>
                      )}
                    </LedgerCell>
                    <LedgerCell num>{t.quantity || "—"}</LedgerCell>
                    <LedgerCell num tone="positive" rule={last ? "sum" : undefined}>
                      {formatMoney(t.amount)}
                    </LedgerCell>
                  </LedgerRow>
                );
              })}
              <tr>
                <LedgerCell className="font-medium" colSpan={3}>
                  Total sold on credit
                </LedgerCell>
                <LedgerCell num className="font-medium">{totalUnits}</LedgerCell>
                <LedgerCell num tone="positive" rule="total" className="font-semibold">
                  {formatMoney(total)}
                </LedgerCell>
              </tr>
            </tbody>
          </LedgerTable>
        )}
      </div>
    </div>
  );
}
