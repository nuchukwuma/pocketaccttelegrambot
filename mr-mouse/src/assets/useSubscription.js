import { useCallback, useEffect, useState, useRef } from "react";
import { getAuthHeaders } from "./auth";

const SERVER_URL = import.meta.env?.VITE_SYNC_SERVER_URL || "http://localhost:5000";
const CACHE_KEY = "pocketaccountant_subscription_entitlement_v1";
const PENDING_KEY = "pocketaccountant_pending_payment_v1";
const PENDING_MAX_AGE_MS = 30 * 60 * 1000; // stop auto-retrying a checkout the user abandoned
const PENDING_MAX_ATTEMPTS = 5;

function saveCache(entitlement) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      ...entitlement,
      cachedAt: new Date().toISOString(),
    }));
  } catch {}
}

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Tracks a checkout that was opened but hasn't been confirmed yet. This is
// how we know to re-check with Paystack once the app regains focus — there's
// no page for a website-style callback to land on, since this is an app.
function savePending(companyId, reference) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify({
      companyId, reference, startedAt: Date.now(), attempts: 0,
    }));
  } catch {}
}

function readPending() {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearPending() {
  try { localStorage.removeItem(PENDING_KEY); } catch {}
}

function bumpPendingAttempts(pending) {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify({ ...pending, attempts: (pending.attempts || 0) + 1 })); } catch {}
}

export function useSubscription(companyId) {
  const [subscription, setSubscription] = useState(() => readCache());
  const [loading, setLoading] = useState(Boolean(companyId));
  const [error, setError] = useState(null);
  const verifyingRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!companyId) return null;
    setLoading(true);
    setError(null);

    try {
      // Matches billing.js's GET /subscription (companyId query param)
      const res = await fetch(
        `${SERVER_URL}/api/billing/subscription?companyId=${encodeURIComponent(companyId)}`,
        {
          headers: getAuthHeaders(),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Subscription request failed: ${res.status}`);

      setSubscription(data);
      saveCache(data);
      return data;
    } catch (err) {
      setError(err.message || "Could not load subscription.");
      return readCache();
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Matches billing.js's POST /initialize — body is { businessId, tier, seats }.
  // This app has no web page for Paystack to redirect back to, so checkout
  // opens in the system browser (window.open) instead of navigating the
  // app's own window away, and the reference is remembered so it can be
  // verified once the app regains focus (see the effect below).
  const startCheckout = useCallback(async (tier, seats = 1) => {
    if (!companyId) throw new Error("No business is selected.");

    const res = await fetch(`${SERVER_URL}/api/billing/initialize`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ businessId: companyId, tier, seats }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Could not start payment.");

    if (data.authorizationUrl) {
      savePending(companyId, data.reference);
      window.open(data.authorizationUrl, "_blank", "noopener");
    }

    return data;
  }, [companyId]);

  // Matches billing.js's POST /addon/initialize — body is { businessId, addon }
  const purchaseAddOn = useCallback(async (addon) => {
    if (!companyId) throw new Error("No business is selected.");
    if (!["telegram", "whatsapp", "ai"].includes(addon)) throw new Error(`Unknown add-on: ${addon}`);

    const res = await fetch(`${SERVER_URL}/api/billing/addon/initialize`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ businessId: companyId, addon }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Could not start payment.");

    if (data.authorizationUrl) {
      savePending(companyId, data.reference);
      window.open(data.authorizationUrl, "_blank", "noopener");
    }

    return data;
  }, [companyId]);

  // Matches billing.js's POST /verify — body is { businessId, reference }.
  // This is the call that actually confirms a Paystack charge and applies it
  // to the business's billing record; refresh() alone only re-reads whatever
  // is already stored, it does not verify anything.
  const verify = useCallback(async (reference) => {
    if (!companyId) throw new Error("No business is selected.");
    if (!reference) throw new Error("Missing payment reference.");

    const res = await fetch(`${SERVER_URL}/api/billing/verify`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ businessId: companyId, reference }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Could not verify payment.");

    setSubscription(data);
    saveCache(data);
    return data;
  }, [companyId]);

  const checkPendingPayment = useCallback(async () => {
    if (!companyId || verifyingRef.current) return;
    const pending = readPending();
    if (!pending || pending.companyId !== companyId) return;
    if (Date.now() - pending.startedAt > PENDING_MAX_AGE_MS) { clearPending(); return; }
    if ((pending.attempts || 0) >= PENDING_MAX_ATTEMPTS) { clearPending(); return; }

    verifyingRef.current = true;
    try {
      await verify(pending.reference);
      clearPending();
    } catch {
      bumpPendingAttempts(pending);
    } finally {
      verifyingRef.current = false;
    }
  }, [companyId, verify]);

  // Re-checks a pending payment whenever the app comes back to the
  // foreground — this is the actual "callback" for an app with no website
  // to redirect to. The Paystack webhook is still the authoritative source
  // server-side; this just makes the UI update promptly once the user
  // switches back from the browser they paid in.
  useEffect(() => {
    if (!companyId) return;
    void checkPendingPayment();
    document.addEventListener("visibilitychange", checkPendingPayment);
    window.addEventListener("focus", checkPendingPayment);
    return () => {
      document.removeEventListener("visibilitychange", checkPendingPayment);
      window.removeEventListener("focus", checkPendingPayment);
    };
  }, [companyId, checkPendingPayment]);

  return {
    subscription,
    loading,
    error,
    refresh,
    startCheckout,
    purchaseAddOn,
    verify,
    checkPendingPayment,
  };
}

export function getCachedSubscriptionEntitlement() {
  return readCache();
}

const GRACE_DAYS = 7;

export function computeAccessState(subscription) {
  if (!subscription) return "unknown";
  if (subscription.status === "active") return "active";

  if (subscription.status === "trialing") {
    const trialEnd = new Date(subscription.trialEndsAt).getTime();
    if (!Number.isFinite(trialEnd)) return "unknown";
    const graceEnd = trialEnd + GRACE_DAYS * 86400000;
    return Date.now() < graceEnd ? "grace" : "blocked";
  }

  if (subscription.status === "past_due") {
    const pastDueStart = subscription.pastDueSince
      ? new Date(subscription.pastDueSince).getTime()
      : Date.now();
    const graceEnd = pastDueStart + GRACE_DAYS * 86400000;
    return Date.now() < graceEnd ? "grace" : "blocked";
  }

  return "blocked";
}