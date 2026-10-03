import React, { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import { getCachedSubscriptionEntitlement } from "../useSubscription";
import { tokenColor } from "../theme/tokens";


function isPaidOfflineEntitlementValid(entitlement) {
  if (!entitlement) return false;
  if (entitlement.status !== "active") return false;
  if (!entitlement.currentPeriodEnd) return false;

  const end = new Date(entitlement.currentPeriodEnd).getTime();
  return Number.isFinite(end) && end > Date.now();
}

export default function RequireOnline({ children }) {
  const [browserOnline, setBrowserOnline] = useState(navigator.onLine);
  const [cachedEntitlement] = useState(() => getCachedSubscriptionEntitlement());

  useEffect(() => {
    const goOnline = () => setBrowserOnline(true);
    const goOffline = () => setBrowserOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  // Paid subscribers can continue using the locally-cached ledger offline until
  // their last verified billing period expires. The server remains authoritative
  // whenever the app is online.
  if (!browserOnline && !isPaidOfflineEntitlementValid(cachedEntitlement)) {
    return (
      <div
        className="min-h-screen w-full flex flex-col items-center justify-center gap-4 px-6 text-center"
        style={{ background: tokenColor("paper") }}
      >
        <WifiOff size={32} style={{ color: tokenColor("clay") }} />
        <h2 className="text-lg font-semibold" style={{ color: tokenColor("ink") }}>
          No internet connection
        </h2>
        <p className="text-sm max-w-xs" style={{ color: tokenColor("ink", 53) }}>
          Connect to Wi-Fi or mobile data to continue. Active subscribers can use
          previously synced records offline until their paid period expires.
        </p>
      </div>
    );
  }

  return children;
}
