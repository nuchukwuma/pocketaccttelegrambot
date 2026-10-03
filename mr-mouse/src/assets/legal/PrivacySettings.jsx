import React, { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { CONSENTS } from "./legal";
import { useConsents } from "./useConsents";
import LegalModal from "./LegalModal";
import { botFetch } from "../botApi";
import { useLedger } from "../booksofacc/Ledgercontext";

/* Withdrawing stops the feature, not just the paperwork: Telegram chats
   are unlinked and WhatsApp is logged out on the bot server. (HordeMart is
   unlinked by the backend itself when the withdrawal is recorded.) */
const SWITCH_OFF = {
  telegram: "/api/telegram/unlink",
  whatsapp: "/api/whatsapp/disconnect",
};

/* Settings → Privacy: what you have agreed to, and a way to take it back. */
export default function PrivacySettings() {
  const { consents, has, withdraw } = useConsents();
  const { business } = useLedger();
  const [doc, setDoc] = useState(null);
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState(null);

  async function withdrawConsent(purpose) {
    if (!window.confirm(`Withdraw consent for "${CONSENTS[purpose].title}"? It stops sharing from now on.`)) return;
    setBusy(purpose);
    setMessage(null);
    try {
      await withdraw(purpose);
      if (SWITCH_OFF[purpose] && business?.id) {
        const res = await botFetch(SWITCH_OFF[purpose], {
          method: "POST",
          body: JSON.stringify({ companyId: business.id }),
        }).catch(() => null);
        if (!res?.ok) {
          setMessage({
            tone: "warn",
            text: `Withdrawn. We couldn't switch ${CONSENTS[purpose].title.replace("Connect ", "")} off just now — disconnect it in Settings to be sure.`,
          });
          return;
        }
      }
      setMessage({ tone: "ok", text: "Withdrawn. Nothing more is shared for this from now on." });
    } catch (err) {
      setMessage({ tone: "warn", text: err.message });
    } finally {
      setBusy(null);
    }
  }
  const optional = ["ai", "telegram", "whatsapp", "hordemart"];

  return (
    <div className="rounded-xl border border-rule bg-surface p-5">
      <div className="flex items-center gap-2 mb-1">
        <ShieldCheck size={16} className="text-action" />
        <h3 className="font-display text-base font-semibold text-ink">Privacy and consent</h3>
      </div>
      <p className="font-body text-label text-ink-soft mb-4">
        You accepted the{" "}
        <button type="button" className="underline text-action" onClick={() => setDoc("terms")}>
          Terms
        </button>{" "}
        and{" "}
        <button type="button" className="underline text-action" onClick={() => setDoc("privacy")}>
          Privacy Policy
        </button>
        {consents.terms?.acceptedAt ? ` on ${new Date(consents.terms.acceptedAt).toLocaleDateString("en-NG")}` : ""}.
        Optional features that share your data:
      </p>
      <ul className="divide-y divide-rule">
        {optional.map((purpose) => (
          <li key={purpose} className="flex items-center justify-between gap-3 py-3">
            <div>
              <div className="font-body text-sm text-ink">{CONSENTS[purpose].title}</div>
              <div className="font-body text-caption text-ink/50">
                {has(purpose)
                  ? `Agreed ${new Date(consents[purpose].acceptedAt).toLocaleDateString("en-NG")}`
                  : "Off — you'll be asked before it's switched on"}
              </div>
            </div>
            {has(purpose) && (
              <button
                type="button"
                onClick={() => withdrawConsent(purpose)}
                disabled={Boolean(busy)}
                className="shrink-0 rounded-lg border border-clay/40 text-clay text-label font-medium px-3 py-1.5 hover:bg-clay/8 disabled:opacity-50"
              >
                {busy === purpose ? "Withdrawing…" : "Withdraw"}
              </button>
            )}
          </li>
        ))}
      </ul>
      {message && (
        <p role="status" className={`font-body text-label mt-3 ${message.tone === "ok" ? "text-moss" : "text-clay"}`}>
          {message.text}
        </p>
      )}
      <LegalModal doc={doc} onClose={() => setDoc(null)} />
    </div>
  );
}
