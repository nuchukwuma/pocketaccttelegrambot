// BillingReminderBanner.jsx
// A slim, dismissible banner — not a full-page block. Shows when the
// trial is ending soon, or when a recurring payment has failed. Dismissal
// is per-day (stored in localStorage), so closing it stops it nagging for
// the rest of today but it comes back tomorrow if the underlying problem
// (trial still ending, payment still failed) hasn't been resolved.
//
// This is deliberately NOT a hard block — once you're ready to actually
// cut off access when a trial truly expires with no payment, that's a
// separate full-page gate (same pattern as RequireOnline/RequireDeviceSlot)
// layered on top of this, not a replacement for it.

import React, { useEffect, useState } from "react";
import { AlertTriangle, X, Clock } from "lucide-react";
import { useLedger } from "./Ledgercontext";
import { useSubscription } from "../useSubscription";
import { COLORS } from "../theme";

const TRIAL_WARNING_THRESHOLD_DAYS = 7;

function dismissalKey(businessId) {
  return `billingBannerDismissed:${businessId}`;
}

// billing.js's /subscription endpoint returns trialEndsAt (an ISO date),
// not a precomputed days-left count — derive it here rather than trusting
// the server to send a field it never sends.
function daysLeftInTrial(trialEndsAt) {
  if (!trialEndsAt) return null;
  const end = new Date(trialEndsAt).getTime();
  if (!Number.isFinite(end)) return null;
  return Math.ceil((end - Date.now()) / 86400000);
}

export default function BillingReminderBanner({ onOpenBilling }) {
  const { business } = useLedger();
  const { subscription } = useSubscription(business?.id);
  const [dismissedToday, setDismissedToday] = useState(false);

  useEffect(() => {
    if (!business?.id) return;
    const today = new Date().toISOString().slice(0, 10);
    setDismissedToday(localStorage.getItem(dismissalKey(business.id)) === today);
  }, [business?.id]);

  if (!subscription || dismissedToday) return null;

  let message = null;
  let urgent = false;

  if (subscription.status === "past_due") {
    message = "Your last payment didn't go through. Update your payment method to avoid losing access.";
    urgent = true;
  } else if (subscription.status === "trialing") {
    const daysLeft = daysLeftInTrial(subscription.trialEndsAt);
    if (daysLeft !== null && daysLeft <= TRIAL_WARNING_THRESHOLD_DAYS) {
      if (daysLeft <= 0) {
        message = "Your free trial has ended. Subscribe to keep using your books.";
        urgent = true;
      } else {
        message = `Your free trial ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"}. Subscribe to keep access after that.`;
        urgent = daysLeft <= 2;
      }
    }
  }

  if (!message) return null;

  const dismiss = () => {
    const today = new Date().toISOString().slice(0, 10);
    localStorage.setItem(dismissalKey(business.id), today);
    setDismissedToday(true);
  };

  return (
    <div
      className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm"
      style={{
        background: urgent ? `${COLORS.clay}14` : `${COLORS.ink}08`,
        borderBottom: `1px solid ${urgent ? `${COLORS.clay}30` : `${COLORS.ink}12`}`,
      }}
    >
      <div className="flex items-center gap-2 min-w-0">
        {urgent ? (
          <AlertTriangle size={15} style={{ color: COLORS.clay }} className="shrink-0" />
        ) : (
          <Clock size={15} style={{ color: `${COLORS.ink}70` }} className="shrink-0" />
        )}
        <span className="font-body truncate" style={{ color: urgent ? COLORS.clay : COLORS.ink }}>
          {message}
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={onOpenBilling}
          className="rounded-full px-3 py-1 font-body text-xs font-medium text-white"
          style={{ background: urgent ? COLORS.clay : COLORS.ink }}
        >
          {subscription.status === "past_due" ? "Update payment" : "Subscribe"}
        </button>
        <button onClick={dismiss} aria-label="Dismiss for today" style={{ color: `${COLORS.ink}50` }}>
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
