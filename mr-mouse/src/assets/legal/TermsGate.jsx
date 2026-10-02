import React, { useState } from "react";
import ConsentCheckbox from "./ConsentCheckbox";
import LegalModal from "./LegalModal";
import { useConsents } from "./useConsents";
import { CONSENTS } from "./legal";

/* ---------------------------------------------------------------
   Signed in, but has not accepted the current Terms + Privacy
   version (an account from before acceptance was recorded, or the
   terms have changed since). Nothing else renders until they accept
   or sign out.
--------------------------------------------------------------- */

export default function TermsGate({ children, onSignOut }) {
  const { ready, offline, has, accept, consents } = useConsents();
  const [checked, setChecked] = useState(false);
  const [doc, setDoc] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!ready) return null;
  // Can't reach the server to check: let them work, and ask once back online.
  if (has("terms") || offline) return children;

  const changed = Boolean(consents.terms);

  const agree = async () => {
    setBusy(true);
    setError("");
    try {
      await accept("terms");
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-paper flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-rule bg-white p-6 sm:p-8">
        <h1 className="font-display text-2xl font-semibold text-ink mb-2">
          {changed ? "Our terms have changed" : "Please accept our terms"}
        </h1>
        <p className="font-body text-sm text-ink-soft mb-5">
          {changed
            ? "We've updated the Mr Mouse Terms of Service and Privacy Policy. Please read them and accept to carry on."
            : "Before you carry on, please read and accept the Mr Mouse Terms of Service and Privacy Policy."}
        </p>
        <ConsentCheckbox id="accept-terms-gate" checked={checked} onChange={setChecked}>
          I have read and agree to the{" "}
          <button type="button" className="underline text-action" onClick={() => setDoc("terms")}>
            Terms of Service
          </button>{" "}
          and the{" "}
          <button type="button" className="underline text-action" onClick={() => setDoc("privacy")}>
            Privacy Policy
          </button>{" "}
          (version {CONSENTS.terms.version}).
        </ConsentCheckbox>
        {error && (
          <p role="alert" className="mt-3 font-body text-[13px] text-clay">
            {error}
          </p>
        )}
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={agree}
            disabled={!checked || busy}
            className="rounded-xl bg-action text-white font-body text-sm font-medium py-3 px-6 hover:bg-action-deep transition-colors disabled:opacity-50"
          >
            {busy ? "Saving…" : "Accept and continue"}
          </button>
          <button type="button" onClick={onSignOut} className="rounded-xl border border-ink/20 text-ink text-sm font-medium py-3 px-5 hover:bg-paper">
            Sign out
          </button>
        </div>
      </div>
      <LegalModal doc={doc} onClose={() => setDoc(null)} />
    </div>
  );
}
