import React, { useState } from "react";
import { KeyRound } from "lucide-react";
import { getAuthHeaders } from "../auth";

const SERVER_URL = import.meta.env?.VITE_SYNC_SERVER_URL || "http://localhost:5000";
const MIN = 12;

/* Settings → Your account: choose a password (accounts opened from
   HordeMart start without one, so the phone and desktop apps can't sign
   them in yet), or change it — which needs the current one. */
export default function PasswordSettings({ user }) {
  const [hasPassword, setHasPassword] = useState(user?.passwordSet !== false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  async function submit(event) {
    event.preventDefault();
    setMessage(null);
    if (next.length < MIN) {
      setMessage({ tone: "warn", text: `Use at least ${MIN} characters — a short sentence works well.` });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${SERVER_URL}/api/users/me/password`, {
        method: "POST",
        headers: getAuthHeaders(),
        credentials: "include",
        body: JSON.stringify(hasPassword ? { currentPassword: current, newPassword: next } : { newPassword: next }),
      }).catch(() => null);
      if (!res) throw new Error("You're offline. Connect to the internet, then try again.");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not save your password. Try again.");
      setMessage({
        tone: "ok",
        text: hasPassword
          ? "Password changed."
          : `Password set. You can now sign in with ${user?.email || "your email"} and this password on any device.`,
      });
      setHasPassword(true);
      setCurrent("");
      setNext("");
    } catch (err) {
      setMessage({ tone: "warn", text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-rule bg-surface p-5" noValidate>
      <div className="flex items-center gap-2 mb-1">
        <KeyRound size={16} className="text-action" />
        <h3 className="font-display text-base font-semibold text-ink">{hasPassword ? "Change your password" : "Choose a password"}</h3>
      </div>
      <p className="font-body text-label text-ink-soft mb-4">
        {hasPassword
          ? "Enter your current password, then the new one."
          : "You signed in from HordeMart. Choose a password to also sign in on the Mr Mouse phone and desktop apps."}
      </p>
      <div className="space-y-3">
        {hasPassword && (
          <div>
            <label htmlFor="current-password" className="font-body text-label text-ink-soft block mb-1.5">
              Current password
            </label>
            <input
              id="current-password"
              type="password"
              autoComplete="current-password"
              className="ledger-input w-full py-2 text-sm"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </div>
        )}
        <div>
          <label htmlFor="new-password" className="font-body text-label text-ink-soft block mb-1.5">
            New password
          </label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            className="ledger-input w-full py-2 text-sm"
            placeholder={`At least ${MIN} characters`}
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </div>
      </div>
      {message && (
        <p role="status" className={`font-body text-label mt-3 ${message.tone === "ok" ? "text-moss" : "text-clay"}`}>
          {message.text}
        </p>
      )}
      <button
        type="submit"
        disabled={busy || !next || (hasPassword && !current)}
        className="mt-4 rounded-lg bg-action text-on-action text-sm font-medium px-4 py-2.5 hover:bg-action-deep disabled:opacity-50"
      >
        {busy ? "Saving…" : hasPassword ? "Change password" : "Set password"}
      </button>
    </form>
  );
}
