import { useCallback, useEffect, useState } from "react";
import { getAuthHeaders } from "../auth";
import { currentVersion } from "./legal";

/* ---------------------------------------------------------------
   Consent records, kept by the backend (mrmouse-backend/routes/consents.js):

     GET    /api/consents          → { consents: [{ purpose, version, acceptedAt }] }
     POST   /api/consents          { purpose, version, accept: true }
     DELETE /api/consents/:purpose

   The server stamps who, when, IP and device — the browser cannot be
   the record of its own consent — and the AI, Telegram and WhatsApp
   endpoints check it there too. So agreeing needs a connection: if the
   server can't be reached, nothing is recorded and the person is told.
--------------------------------------------------------------- */

const SERVER_URL = import.meta.env?.VITE_SYNC_SERVER_URL || "http://localhost:5000";

// { consents: { purpose: { version, acceptedAt } }, offline }, shared by every hook.
// `offline` means the server couldn't be asked: Mr Mouse works offline,
// so the Terms screen lets people carry on and asks once they're back.
let cache = null;
const listeners = new Set();
const publish = () => listeners.forEach((fn) => fn(cache));

async function load() {
  const consents = {};
  let offline = false;
  try {
    const res = await fetch(`${SERVER_URL}/api/consents`, { headers: getAuthHeaders() });
    if (res.ok) {
      const data = await res.json();
      for (const c of data.consents || []) consents[c.purpose] = { version: c.version, acceptedAt: c.acceptedAt };
    } else if (res.status >= 500) {
      offline = true;
    }
  } catch {
    offline = true;
  }
  cache = { consents, offline };
  publish();
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    if (cache?.offline) load();
  });
}

async function failure(res, fallback) {
  const data = await res?.json().catch(() => ({}));
  return new Error(data?.error || fallback);
}

export function useConsents() {
  const [state, setState] = useState(cache);

  useEffect(() => {
    listeners.add(setState);
    if (cache === null) load();
    return () => listeners.delete(setState);
  }, []);

  const has = useCallback(
    (purpose) => Boolean(state?.consents[purpose] && state.consents[purpose].version === currentVersion(purpose)),
    [state]
  );

  const accept = useCallback(async (purpose) => {
    const version = currentVersion(purpose);
    const res = await fetch(`${SERVER_URL}/api/consents`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ purpose, version, accept: true }),
    }).catch(() => null);
    if (!res) throw new Error("You're offline. Connect to the internet, then try again.");
    if (!res.ok) throw await failure(res, "Could not save your choice. Try again.");
    cache = {
      consents: { ...(cache?.consents || {}), [purpose]: { version, acceptedAt: new Date().toISOString() } },
      offline: false,
    };
    publish();
  }, []);

  const withdraw = useCallback(async (purpose) => {
    const res = await fetch(`${SERVER_URL}/api/consents/${encodeURIComponent(purpose)}`, {
      method: "DELETE",
      headers: getAuthHeaders(),
    }).catch(() => null);
    if (!res) throw new Error("You're offline. Connect to the internet, then try again.");
    if (!res.ok) throw await failure(res, "Could not withdraw. Try again.");
    const consents = { ...(cache?.consents || {}) };
    delete consents[purpose];
    cache = { consents, offline: false };
    publish();
  }, []);

  return {
    ready: state !== null,
    offline: Boolean(state?.offline),
    consents: state?.consents || {},
    has,
    accept,
    withdraw,
    reload: load,
  };
}

/** Forget everything on sign-out, so the next account starts clean. */
export function resetConsentCache() {
  cache = null;
  try {
    // Left behind by an earlier version that kept unsent consents here.
    localStorage.removeItem("mm-consents-pending");
  } catch {
    /* nothing stored */
  }
}
