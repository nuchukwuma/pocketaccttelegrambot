import React from "react";
import { Truck } from "lucide-react";
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
  { key: "supplier", label: "Supplier" },
  { key: "product", label: "Product / particulars" },
  { key: "qty", label: "Qty", align: "right" },
  { key: "amount", label: "Amount", align: "right" },
];

export default function PurchasesJournal({ onNavigate }) {
  const { business, purchasesJournalEntries } = useLedger();
  const total = purchasesJournalEntries.reduce((s, t) => s + t.amount, 0);
  const totalUnits = purchasesJournalEntries.reduce((s, t) => s + (Number(t.quantity) || 0), 0);

  return (
    <div className="min-h-screen w-full bg-paper font-body pb-24">
      <GlobalStyle />
      <TopNav business={business} current="books" onNavigate={onNavigate} />
      <PageHeader
        business={business}
        icon={Truck}
        title="Purchases Journal"
        subtitle="Goods bought on credit — each line also opens a creditor account."
      />

      <div className="max-w-5xl mx-auto px-5 sm:px-8 pt-8 relative">
        <BackLink onClick={() => onNavigate("books")} />

        <SummaryPanel>
          <SummaryCard label="Total on credit" value={formatMoney(total)} warn={total > 0} />
          <SummaryCard label="Units bought" value={totalUnits} />
          <SummaryCard label="Entries" value={purchasesJournalEntries.length} />
        </SummaryPanel>

        {purchasesJournalEntries.length === 0 ? (
          <EmptyState
            title="No credit purchases yet"
            subtitle="Credit purchases from Add entry will appear here."
          />
        ) : (
          <LedgerTable columns={COLUMNS} caption="Credit purchases" minWidth={660}>
            <tbody>
              {purchasesJournalEntries.map((t, i) => {
                const last = i === purchasesJournalEntries.length - 1;
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
                    <LedgerCell num tone="negative" rule={last ? "sum" : undefined}>
                      {formatMoney(t.amount)}
                    </LedgerCell>
                  </LedgerRow>
                );
              })}
              <tr>
                <LedgerCell className="font-medium" colSpan={3}>
                  Total bought on credit
                </LedgerCell>
                <LedgerCell num className="font-medium">{totalUnits}</LedgerCell>
                <LedgerCell num tone="negative" rule="total" className="font-semibold">
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
