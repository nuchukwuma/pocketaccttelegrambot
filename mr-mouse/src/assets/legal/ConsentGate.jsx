import React, { useState } from "react";
import { ShieldCheck } from "lucide-react";
import ConsentCheckbox from "./ConsentCheckbox";
import { CONSENTS } from "./legal";
import { useConsents } from "./useConsents";

/* ---------------------------------------------------------------
   Wrap a feature that sends data somewhere else (the assistant,
   Telegram, WhatsApp). Until the current version of its consent is
   accepted, the feature is not rendered at all — so it cannot make a
   single request — and this card explains what will happen instead.
--------------------------------------------------------------- */

export function ConsentCard({ purpose, onAccepted, compact = false }) {
  const { accept } = useConsents();
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const info = CONSENTS[purpose];

  const agree = async () => {
    setBusy(true);
    setError("");
    try {
      await accept(purpose);
      onAccepted?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`rounded-xl border border-rule bg-surface ${compact ? "p-4" : "p-5"}`}>
      <div className="flex items-center gap-2 mb-2">
        <ShieldCheck size={16} className="text-action" />
        <h3 className="font-display text-base font-semibold text-ink">{info.title}</h3>
      </div>
      {info.summary && <p className="font-body text-label text-ink-soft mb-3">{info.summary} Before you switch it on:</p>}
      <ul className="list-disc pl-5 font-body text-label leading-relaxed text-ink-soft space-y-1 mb-4">
        {info.points.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
      <ConsentCheckbox id={`consent-${purpose}`} checked={checked} onChange={setChecked}>
        I understand and agree. I can switch this off at any time in Settings → Privacy.
      </ConsentCheckbox>
      {error && (
        <p role="alert" className="mt-3 font-body text-label text-clay">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={agree}
        disabled={!checked || busy}
        className="mt-4 rounded-xl bg-action text-on-action font-body text-sm font-medium py-2.5 px-5 hover:bg-action-deep transition-colors disabled:opacity-50"
      >
        {busy ? "Saving…" : "Agree and switch on"}
      </button>
    </div>
  );
}

export default function ConsentGate({ purpose, children, compact }) {
  const { ready, has } = useConsents();
  if (!ready) return null;
  if (!has(purpose)) return <ConsentCard purpose={purpose} compact={compact} />;
  return children;
}

/* ---------------------------------------------------------------
   For an action rather than a screen ("Send via WhatsApp"):

     const whatsapp = useConsentPrompt("whatsapp");
     <button onClick={() => whatsapp.ensure(sendViaWhatsApp)}>…</button>
     {whatsapp.prompt}

   Runs the action straight away if consent is in place; otherwise
   asks first and runs it only after "Agree and switch on".
--------------------------------------------------------------- */
export function useConsentPrompt(purpose) {
  const { has } = useConsents();
  const [pending, setPending] = useState(null);

  const ensure = (action) => {
    if (has(purpose)) return action();
    setPending(() => action);
    return undefined;
  };

  const prompt = pending ? (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
      style={{ background: "var(--color-scrim)" }}
      role="dialog"
      aria-modal="true"
      aria-label={CONSENTS[purpose].title}
    >
      <div className="w-full max-w-md max-h-[90vh] overflow-y-auto">
        <ConsentCard
          purpose={purpose}
          onAccepted={() => {
            const action = pending;
            setPending(null);
            action();
          }}
        />
        <button type="button" onClick={() => setPending(null)} className="mt-3 w-full rounded-xl bg-surface/90 text-ink text-sm font-medium py-2.5">
          Not now
        </button>
      </div>
    </div>
  ) : null;

  return { ensure, prompt, allowed: has(purpose) };
}
