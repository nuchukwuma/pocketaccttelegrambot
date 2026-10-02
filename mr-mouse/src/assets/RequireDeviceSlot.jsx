// RequireDeviceSlot.jsx
// Sits inside RequireOnline (needs a connection to even check). Registers
// this browser against the business's plan right after login; if the plan's
// device cap is already full and this isn't a previously-registered device,
// the app is blocked with a clear explanation instead of silently letting
// a 6th device onto a 5-seat plan.

import React, { useEffect, useState } from "react";
import { ShieldAlert, Loader2, LogOut } from "lucide-react";
import { useLedger } from "./booksofacc/Ledgercontext";
import { getOrCreateDeviceId, describeThisDevice } from "./deviceId";
import { getAuthHeaders } from "./auth";
import { COLORS } from "./theme";

const SERVER_URL = import.meta.env?.VITE_SYNC_SERVER_URL || "http://localhost:5000";


export default function RequireDeviceSlot({ children }) {
  const { business, logout } = useLedger();
  const [status, setStatus] = useState("checking"); // checking | ok | blocked | error
  const [message, setMessage] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
    }
  };

  useEffect(() => {
    if (!business?.id) return;
    let cancelled = false;

    const deviceId = getOrCreateDeviceId();
    const label = describeThisDevice();

    fetch(`${SERVER_URL}/api/devices/register`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ businessId: business.id, deviceId, label }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setStatus("blocked");
          setMessage(data.error || "This device isn't allowed on this account's current plan.");
          return;
        }
        setStatus("ok");
      })
      .catch(() => {
        if (!cancelled) {
          setStatus("error");
          setMessage("Couldn't verify this device. Check your connection and try again.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [business?.id]);

  if (status === "ok") return children;

  if (status === "checking") {
    return (
      <div className="min-h-screen w-full flex flex-col items-center justify-center gap-4" style={{ background: COLORS.paper }}>
        <Loader2 size={28} className="animate-spin" color={COLORS.moss} />
        <p className="text-sm" style={{ color: `${COLORS.ink}88` }}>Checking this device…</p>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen w-full flex flex-col items-center justify-center gap-4 px-6 text-center"
      style={{ background: COLORS.paper }}
    >
      <ShieldAlert size={32} color={COLORS.clay} />
      <h2 className="text-lg font-semibold" style={{ color: COLORS.ink }}>
        {status === "blocked" ? "Device limit reached" : "Couldn't verify this device"}
      </h2>
      <p className="text-sm max-w-sm" style={{ color: `${COLORS.ink}88` }}>{message}</p>
      <button
        onClick={handleLogout}
        disabled={loggingOut}
        className="flex items-center gap-2 mt-2 px-4 py-2 rounded-lg text-sm font-medium transition-opacity disabled:opacity-60"
        style={{ background: COLORS.ink, color: COLORS.paper }}
      >
        <LogOut size={16} />
        {loggingOut ? "Logging out…" : "Log out"}
      </button>
    </div>
  );
}