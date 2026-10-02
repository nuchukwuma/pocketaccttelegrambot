import React, { useEffect, useState } from "react";
import { useConsentPrompt } from "../legal/ConsentGate";
import { BellRing, FileText, MessageCircle, X } from "lucide-react";
import { formatMoney } from "../booksofacc/ui";
import { botFetch } from "../botApi";


export default function MonthlyStatementPopup({ business, onClose }) {
  const [statement, setStatement] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  // Statements go out through Telegram: ask before the first one.
  const telegramConsent = useConsentPrompt("telegram");

  useEffect(() => {
    if (!business?.id) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await botFetch(`/api/statements/list?companyId=${encodeURIComponent(business.id)}&limit=1`);
        const data = await res.json().catch(() => []);
        if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
        if (!cancelled) setStatement(data?.[0] || null);
      } catch (err) {
        if (!cancelled) setError(err.message || "Could not load statement.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [business?.id]);

  if (loading || !statement) return null;

  async function loadFullStatement() {
    const res = await botFetch(`/api/statements/${statement.id}?companyId=${encodeURIComponent(business.id)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not load statement.");
    return data;
  }

  async function viewStatement() {
    setBusy("view");
    setError(null);
    try {
      const data = await loadFullStatement();
      const binary = atob(data.payload.pdfBase64);
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function send(channel) {
    setBusy(channel);
    setError(null);
    try {
      const res = await botFetch("/api/statements/send", {
        method: "POST",
        body: JSON.stringify({
          companyId: business.id,
          statementId: statement.id,
          channel,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not send statement.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 p-4">
      {telegramConsent.prompt}
      <div className="w-full max-w-md rounded-lg bg-white shadow-2xl border border-rule p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="rounded-full bg-paper-sunk p-2">
              <BellRing size={18} className="text-moss" />
            </div>
            <div>
              <h2 className="font-display text-lg text-ink">Monthly statement ready</h2>
              <p className="font-body text-xs text-ink/45">
                {statement.periodStart} → {statement.periodEnd}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-ink/40 hover:text-ink">
            <X size={17} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 my-5">
          <Metric label="Sales" value={formatMoney(statement.totalSales)} />
          <Metric label="Expenses" value={formatMoney(statement.totalExpenses)} />
          <Metric label="Net profit" value={formatMoney(statement.netProfit)} />
          <Metric label="Debtors" value={formatMoney(statement.totalDebtors)} />
        </div>

        <div className="space-y-2.5">
          <button
            onClick={viewStatement}
            disabled={Boolean(busy)}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-action text-white py-2.5 text-sm font-medium disabled:opacity-50"
          >
            <FileText size={15} />
            {busy === "view" ? "Opening…" : "View statement"}
          </button>

          <div className="grid grid-cols-1 gap-2.5">
            <button
              onClick={() => telegramConsent.ensure(() => send("telegram"))}
              disabled={Boolean(busy)}
              className="flex items-center justify-center gap-2 rounded-lg border border-rule py-2.5 text-sm text-ink disabled:opacity-50"
            >
              <MessageCircle size={15} />
              {busy === "telegram" ? "Sending…" : "Telegram"}
            </button>
          </div>
        </div>

        {error && <p className="mt-3 text-xs text-clay">{error}</p>}
      </div>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="rounded-lg bg-paper border border-ink/8 p-3">
      <div className="font-body text-[13px] text-ink-soft">{label}</div>
      <div className="font-body text-sm text-ink mt-1">{value}</div>
    </div>
  );
}
