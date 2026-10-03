import React, { useEffect, useRef, useState } from "react";
import { Loader2, Store } from "lucide-react";
import ConsentCheckbox from "../legal/ConsentCheckbox";
import LegalModal from "../legal/LegalModal";
import { CONSENTS } from "../legal/legal";
import { resetConsentCache } from "../legal/useConsents";

/* ---------------------------------------------------------------
   Landing page for "Open MrMouse" in a HordeMart store dashboard:

     https://<mr mouse web>/?sso=hordemart#token=<60-second signed pass>

   (The app root, not /sso/hordemart: this app builds with relative
   asset URLs for the desktop version, which break on a deeper path.)

   1. Read the pass from the URL fragment and remove it from the
      address bar at once (it must not linger in history).
   2. Hand it straight to the backend, which checks it and either
      signs the seller in (already linked, terms current) or answers
      with a short-lived ticket — so the 60 seconds don't run out while
      someone reads the terms.
   3. First time: show what linking means and ask for agreement, then
      confirm the ticket.

   Backend contract: server/README-hordemart.md (and HordeMart's
   docs/integrations/mrmouse.md).
--------------------------------------------------------------- */

const SERVER_URL = import.meta.env?.VITE_SYNC_SERVER_URL || "http://localhost:5000";

export function isHordeMartLanding() {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("sso") === "hordemart";
}

async function post(path, body) {
  const res = await fetch(`${SERVER_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "This link didn't work. Open Mr Mouse again from your HordeMart dashboard.");
  return data;
}

export default function HordeMartLink({ onSignedIn, onCancel }) {
  const [state, setState] = useState({ step: "checking" });
  const [checked, setChecked] = useState(false);
  const [doc, setDoc] = useState(null);
  const started = useRef(false);

  const finish = (data) => {
    if (data.token) {
      localStorage.setItem("token", data.token);
      localStorage.setItem("mm-has-signed-in", "1");
      resetConsentCache();
    }
    window.history.replaceState(null, "", window.location.pathname);
    onSignedIn(data.user);
  };

  useEffect(() => {
    // Once only — StrictMode runs effects twice in development, and the
    // pass is single-use.
    if (started.current) return;
    started.current = true;

    const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
    // Off the address bar before anything else: no pass in history.
    window.history.replaceState(null, "", window.location.pathname);
    if (!token) {
      setState({ step: "error", message: "This link is incomplete. Open Mr Mouse again from your HordeMart dashboard." });
      return;
    }
    post("/api/integrations/hordemart/sso", { token })
      .then((data) => {
        if (data.status === "signed_in") finish(data);
        else setState({ step: "consent", ticket: data.ticket, profile: data.profile || {} });
      })
      .catch((err) => setState({ step: "error", message: err.message }));
    // finish is stable for this screen's lifetime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const confirm = async () => {
    setState((s) => ({ ...s, busy: true, message: "" }));
    try {
      const data = await post("/api/integrations/hordemart/sso/confirm", {
        ticket: state.ticket,
        acceptTerms: true,
        termsVersion: CONSENTS.hordemart.version,
        acceptAppTerms: true,
        appTermsVersion: CONSENTS.terms.version,
      });
      finish(data);
    } catch (err) {
      setState((s) => ({ ...s, busy: false, message: err.message }));
    }
  };

  const cancel = () => {
    window.history.replaceState(null, "", window.location.pathname);
    onCancel();
  };

  return (
    <div className="min-h-screen bg-paper flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-2xl border border-rule bg-surface p-6 sm:p-8">
        <div className="flex items-center gap-2 mb-4">
          <Store size={18} className="text-action" />
          <span className="font-body text-sm text-ink-soft">From your HordeMart store</span>
        </div>

        {state.step === "checking" && (
          <p className="flex items-center gap-2 font-body text-sm text-ink-soft">
            <Loader2 size={16} className="animate-spin" /> Signing you in…
          </p>
        )}

        {state.step === "error" && (
          <>
            <h1 className="font-display text-xl font-semibold text-ink mb-2">We couldn't sign you in</h1>
            <p role="alert" className="font-body text-sm text-clay mb-5">{state.message}</p>
            <button type="button" onClick={cancel} className="rounded-xl border border-ink/20 text-ink text-sm font-medium py-2.5 px-5">
              Go to Mr Mouse sign-in
            </button>
          </>
        )}

        {state.step === "consent" && (
          <>
            <h1 className="font-display text-2xl font-semibold text-ink mb-2">Link {state.profile.storeName || "your store"} to Mr Mouse</h1>
            <p className="font-body text-sm text-ink-soft mb-4">
              Signing in as <strong>{state.profile.name}</strong> ({state.profile.email}). Before we link your HordeMart store:
            </p>
            <ul className="list-disc pl-5 font-body text-label leading-relaxed text-ink-soft space-y-1 mb-5">
              {CONSENTS.hordemart.points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
            <ConsentCheckbox id="consent-hordemart" checked={checked} onChange={setChecked}>
              I agree to link my HordeMart store as described, and to the Mr Mouse{" "}
              <button type="button" className="underline text-action" onClick={() => setDoc("terms")}>
                Terms of Service
              </button>{" "}
              and{" "}
              <button type="button" className="underline text-action" onClick={() => setDoc("privacy")}>
                Privacy Policy
              </button>
              .
            </ConsentCheckbox>
            {state.message && (
              <p role="alert" className="mt-3 font-body text-label text-clay">
                {state.message}
              </p>
            )}
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={confirm}
                disabled={!checked || state.busy}
                className="rounded-xl bg-action text-on-action font-body text-sm font-medium py-3 px-6 hover:bg-action-deep transition-colors disabled:opacity-50"
              >
                {state.busy ? "Linking…" : "Agree and continue"}
              </button>
              <button type="button" onClick={cancel} className="rounded-xl border border-ink/20 text-ink text-sm font-medium py-3 px-5">
                Not now
              </button>
            </div>
          </>
        )}
      </div>
      <LegalModal doc={doc} onClose={() => setDoc(null)} />
    </div>
  );
}
