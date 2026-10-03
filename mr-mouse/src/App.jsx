import React, { useState, useEffect } from "react";
import { LedgerProvider, useLedger } from "./assets/booksofacc/Ledgercontext";
import LoginPage from "./assets/Login";
import Dashboard from "./assets/components/Dashboard";
import AddEntry from "./assets/booksofacc/Addentry";
import Books from "./assets/booksofacc/Books";
import Reminders from "./assets/booksofacc/Reminders";
import CashBook from "./assets/booksofacc/Cashbook";
import PettyCashBook from "./assets/booksofacc/Pettycash";
import SalesJournal from "./assets/booksofacc/Salesjournal";
import PurchasesJournal from "./assets/booksofacc/Purchasesjournal";
import Ledger from "./assets/booksofacc/Ledger";
import GeneralLedger from "./assets/booksofacc/Generalledger";
import PnLStatement from "./assets/booksofacc/Pnlstatement";
import InventoryPage from "./assets/Inventory";
import InvoiceBuilder from "./assets/booksofacc/Invoice";
import Settings from "./assets/booksofacc/Settings"; 
import RequireOnline from "./assets/booksofacc/Requireonline";
import RequireDeviceSlot from "./assets/RequireDeviceSlot";
import BillingReminderBanner from "./assets/booksofacc/BillingReminderBanner";
import AiAssistant from "./assets/components/AiAssistant";
import SplashScreen from "./assets/components/SplashScreen";
import { useSubscription, computeAccessState } from "./assets/useSubscription";
import HordeMartLink, { isHordeMartLanding } from "./assets/integrations/HordeMartLink";
import TermsGate from "./assets/legal/TermsGate";
import DevHooks from "./assets/dev/DevHooks";
import AccountingBasics from "./assets/help/AccountingBasics";
import { TourProvider } from "./assets/tour/Tour";
import AppearanceSync from "./assets/theme/AppearanceSync";

const BOOK_PAGES = {
  cashbook: CashBook,
  pettycash: PettyCashBook,
  salesjournal: SalesJournal,
  purchasesjournal: PurchasesJournal,
  ledger: Ledger,
  generalledger: GeneralLedger,
  pnlstatement: PnLStatement,
  inventory: InventoryPage,
};

function AppShell() {
  const { business, setBusiness, authReady, logout } = useLedger();
  // "Open MrMouse" from a HordeMart store dashboard lands here (web only).
  const [hordeMartLanding, setHordeMartLanding] = useState(isHordeMartLanding);
  const { subscription, verify } = useSubscription(business?.id);
  const accessState = computeAccessState(subscription);
  const blocked = accessState === "blocked";

  // The splash holds the first frame while the session is restored, so
  // the app never flashes a bare screen before it knows whether this is
  // a returning user (dashboard) or a new one (login).
  const [splashDone, setSplashDone] = useState(false);
  const [page, setPage] = useState("dashboard");
  const [params, setParams] = useState({});

  // Defensive fallback only: if this ever runs somewhere that DOES land back
  // on a URL with ?reference=/?trxref= (e.g. opened as a plain web page), catch
  // it here at the top of the app so it isn't missed just because Settings.jsx
  // wasn't the page showing. In the packaged app, the real mechanism is the
  // pending-payment + focus check in useSubscription.js, since there's no
  // page for Paystack to redirect back to.
  useEffect(() => {
    if (!business?.id) return;
    const urlParams = new URLSearchParams(window.location.search);
    const reference = urlParams.get("reference") || urlParams.get("trxref");
    if (!reference) return;

    let cancelled = false;
    (async () => {
      try {
        await verify(reference);
      } catch (err) {
        console.error("[billing] payment verification failed:", err);
      } finally {
        if (!cancelled) {
          window.history.replaceState({}, "", window.location.pathname);
          setPage("settings");
        }
      }
    })();

    return () => { cancelled = true; };
  }, [business?.id, verify]);

  const onNavigate = (nextPage, nextParams = {}) => {
    if (blocked && nextPage !== "settings") return; // silently refuse
    setPage(nextPage);
    setParams(nextParams);
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  };

  useEffect(() => {
    if (blocked && page !== "settings") {
      setPage("settings");
    }
  }, [blocked, page]);

  if (hordeMartLanding) {
    return (
      <HordeMartLink
        onSignedIn={(user) => {
          setBusiness(user);
          setPage("dashboard");
          setSplashDone(true);
          setHordeMartLanding(false);
        }}
        onCancel={() => setHordeMartLanding(false)}
      />
    );
  }

  if (!splashDone) {
    return (
      <SplashScreen
        ready={authReady}
        onDone={() => setSplashDone(true)}
      />
    );
  }

  if (!business) {
    return (
      <LoginPage
        onAuthenticated={(profile) => {
          setBusiness(profile);
          setPage("dashboard");
        }}
      />
    );
  }

  return (
    <>
    {/* The business's colour theme, from its synced preferences. */}
    <AppearanceSync />
    <TermsGate onSignOut={logout}>
    <RequireOnline>
      <RequireDeviceSlot>
        <BillingReminderBanner onOpenBilling={() => onNavigate("settings")} />
        <AiAssistant onNavigate={onNavigate} />
        {import.meta.env.DEV && <DevHooks />}
        <TourProvider onNavigate={onNavigate} page={page} params={params} blocked={blocked}>
        {page === "book-page" ? (
          (() => {
            const BookComponent = BOOK_PAGES[params.book] || CashBook;
            return <BookComponent onNavigate={onNavigate} params={params} />;
          })()
        ) : (
          (() => {
            switch (page) {
              case "addentry":
                return <AddEntry onNavigate={onNavigate} />;
              case "books":
                return <Books onNavigate={onNavigate} />;
              case "reminders":
                return <Reminders onNavigate={onNavigate} />;
              case "invoice":
                return <InvoiceBuilder onNavigate={onNavigate} />;
              case "settings":
                return <Settings onNavigate={onNavigate} params={params} />;
              case "basics":
                return <AccountingBasics onNavigate={onNavigate} />;
              case "dashboard":
              default:
                return <Dashboard onNavigate={onNavigate} />;
            }
          })()
        )}
        </TourProvider>
      </RequireDeviceSlot>
    </RequireOnline>
    </TermsGate>
    </>
  );
}

export default function App() {
  return (
    <LedgerProvider>
      <AppShell />
    </LedgerProvider>
  );
}