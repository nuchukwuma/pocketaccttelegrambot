import React from "react";
import {
  BookOpen,
  Wallet,
  PiggyBank,
  ShoppingCart,
  Truck,
  BookMarked,
  Library,
  Package,
  FileBarChart,
  ChevronRight,
} from "lucide-react";
import { useLedger } from "./Ledgercontext";
import { GlobalStyle, TopNav, PageHeader, formatMoney } from "./ui";

export default function Books({ onNavigate }) {
  const { business, cashBookEntries, pettyCashEntries, salesJournalEntries, purchasesJournalEntries, accounts, products, pnl } =
    useLedger();

  const items = [
    {
      key: "cashbook",
      icon: Wallet,
      title: "Cash Book",
      desc: "Every cash and bank movement — sales, purchases, and running expenses.",
      meta: `${cashBookEntries.length} entries`,
    },
    {
      key: "pettycash",
      icon: PiggyBank,
      title: "Petty Cash Book",
      desc: "Small, day-to-day expenses paid out of petty cash.",
      meta: `${pettyCashEntries.length} entries`,
    },
    {
      key: "salesjournal",
      icon: ShoppingCart,
      title: "Sales Journal",
      desc: "Goods sold on credit, awaiting payment.",
      meta: `${salesJournalEntries.length} entries`,
    },
    {
      key: "purchasesjournal",
      icon: Truck,
      title: "Purchases Journal",
      desc: "Goods bought on credit, awaiting payment.",
      meta: `${purchasesJournalEntries.length} entries`,
    },
    {
      key: "ledger",
      icon: BookMarked,
      title: "Ledger",
      desc: "Look up any individual account — a customer, supplier, or expense.",
      meta: `${accounts.length} accounts`,
    },
    {
      key: "inventory",
      icon: Package,
      title: "Inventory",
      desc: "Stock on hand — updated automatically as goods are sold or bought.",
      meta: `${products.length} products`,
    },
    {
      key: "generalledger",
      icon: Library,
      title: "General Ledger",
      desc: "Every account together, with total debits, credits, and balances.",
      meta: `${accounts.length} accounts`,
    },
    {
      key: "pnlstatement",
      icon: FileBarChart,
      title: "Statement",
      desc: "Trial balance and profit & loss statement for the business.",
      meta: formatMoney(pnl.netProfit) + " net",
    },
  ];

  return (
    <div className="min-h-screen w-full bg-paper font-body pb-24">
      <GlobalStyle />
      <TopNav business={business} current="books" onNavigate={onNavigate} />
      <PageHeader
        business={business}
        icon={BookOpen}
        title="Books"
        subtitle="Every book fills itself in from what you record in Add entry — nothing here is typed twice."
      />

      <div className="max-w-5xl mx-auto px-5 sm:px-8 pt-8 relative">
        <div className="grid sm:grid-cols-2 gap-4">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                onClick={() => onNavigate("book-page", { book: item.key })}
                className="text-left rounded-lg border border-rule bg-surface p-5 hover:border-action/50 transition-all flex items-start gap-4"
              >
                <div className="w-10 h-10 rounded-lg bg-paper-sunk flex items-center justify-center shrink-0">
                  <Icon size={18} className="text-moss" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-display text-lg text-ink mb-1">{item.title}</h3>
                  <p className="font-body text-sm text-ink/55 mb-2">{item.desc}</p>
                  <span className="font-body text-label font-medium text-action">{item.meta}</span>
                </div>
                <ChevronRight size={16} className="text-ink/30 shrink-0 mt-1" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}