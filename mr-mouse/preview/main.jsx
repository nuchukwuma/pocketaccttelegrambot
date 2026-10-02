import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import "./preview.css";

import GeneralLedger from "../src/assets/booksofacc/Generalledger";
import CashBook from "../src/assets/booksofacc/Cashbook";
import PettyCash from "../src/assets/booksofacc/Pettycash";
import SalesJournal from "../src/assets/booksofacc/Salesjournal";
import PurchasesJournal from "../src/assets/booksofacc/Purchasesjournal";
import Ledger from "../src/assets/booksofacc/Ledger";
import PnL from "../src/assets/booksofacc/Pnlstatement";
import Invoice from "../src/assets/booksofacc/Invoice";
import Dashboard from "../src/assets/components/Dashboard";
import SplashScreen from "../src/assets/components/SplashScreen";

const PAGES = {
  generalledger: GeneralLedger,
  cashbook: CashBook,
  pettycash: PettyCash,
  salesjournal: SalesJournal,
  purchasesjournal: PurchasesJournal,
  ledger: Ledger,
  pnl: PnL,
  invoice: Invoice,
  dashboard: Dashboard,
  splash: () => <SplashScreen ready={false} onDone={() => {}} />,
  splashready: () => <SplashScreen ready onDone={() => { window.__splashDone = Date.now(); }} />,
};

function Harness() {
  const initial = new URLSearchParams(location.search).get("page") || "generalledger";
  const [page] = useState(initial);
  const Page = PAGES[page] || GeneralLedger;
  return <Page onNavigate={() => {}} params={{}} />;
}

createRoot(document.getElementById("root")).render(<Harness />);
