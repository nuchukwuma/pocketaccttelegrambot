// RequireDeviceSlot.jsx
// Sits inside RequireOnline (needs a connection to even check). Registers
// this browser against the business's plan right after login; if the plan's
// device cap is already full and this isn't a previously-registered device,
// the app is blocked with a clear explanation instead of silently letting
// a 6th device onto a 5-seat plan.

import React, { useEffect, useState } from "react";
import { ShieldAlert, Loader2, LogOut, MonitorSmartphone, RotateCw } from "lucide-react";
import { useLedger } from "./booksofacc/Ledgercontext";
import { getOrCreateDeviceId, describeThisDevice } from "./deviceId";
import { getAuthHeaders } from "./auth";
import { tokenColor } from "./theme/tokens";
import { useDevices } from "./useDevices";

const SERVER_URL = import.meta.env?.VITE_SYNC_SERVER_URL || "http://localhost:5000";


export default function RequireDeviceSlot({ children }) {
  const { business, currentUser, logout } = useLedger();
  const [status, setStatus] = useState("checking"); // checking | ok | blocked | error
  const [message, setMessage] = useState("");
  const [code, setCode] = useState(null);
  // Bumped to register again: after freeing a slot, or "Try again".
  const [attempt, setAttempt] = useState(0);
  const retry = () => {
    setStatus("checking");
    setAttempt((n) => n + 1);
  };
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
          setCode(data.code || null);
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
  }, [business?.id, attempt]);

  if (status === "ok") return children;

  if (status === "checking") {
    return (
      <div className="min-h-screen w-full flex flex-col items-center justify-center gap-4" style={{ background: tokenColor("paper") }}>
        <Loader2 size={28} className="animate-spin" style={{ color: tokenColor("moss") }} />
        <p className="text-sm" style={{ color: tokenColor("ink", 53) }}>Checking this device…</p>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen w-full flex flex-col items-center justify-center gap-4 px-6 text-center"
      style={{ background: tokenColor("paper") }}
    >
      <ShieldAlert size={32} style={{ color: tokenColor("clay") }} />
      <h2 className="text-lg font-semibold" style={{ color: tokenColor("ink") }}>
        {status === "blocked" ? "Device limit reached" : "Couldn't verify this device"}
      </h2>
      <p className="text-sm max-w-sm" style={{ color: tokenColor("ink", 53) }}>{message}</p>
      {/* The owner or an admin is the person the message says to ask, and
          the rest of the app (Settings → Devices) is behind this screen —
          so they free a slot here. */}
      {status === "blocked" && code === "DEVICE_LIMIT_REACHED" && ["owner", "admin"].includes(currentUser?.role) && (
        <FreeASlot businessId={business?.id} onFreed={retry} />
      )}
      {status === "error" && (
        <button
          onClick={retry}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border"
          style={{ borderColor: tokenColor("ink", 20), color: tokenColor("ink") }}
        >
          <RotateCw size={15} /> Try again
        </button>
      )}
      <button
        onClick={handleLogout}
        disabled={loggingOut}
        className="flex items-center gap-2 mt-2 px-4 py-2 rounded-lg text-sm font-medium transition-opacity disabled:opacity-60"
        style={{ background: tokenColor("canvas"), color: tokenColor("on-canvas") }}
      >
        <LogOut size={16} />
        {loggingOut ? "Logging out…" : "Log out"}
      </button>
    </div>
  );
}
function FreeASlot({ businessId, onFreed }) {
  const { devices, loading, error, removeDevice } = useDevices(businessId);
  const [busy, setBusy] = useState(null);

  const remove = async (device) => {
    if (!window.confirm(`Sign "${device.label}" out of Mr Mouse to use this device instead?`)) return;
    setBusy(device.id);
    try {
      await removeDevice(device.id);
      onFreed();
    } catch {
      setBusy(null);
    }
  };

  if (loading) return null;
  return (
    <div className="w-full max-w-sm rounded-xl border bg-surface p-4 text-left" style={{ borderColor: tokenColor("ink", 12) }}>
      <p className="text-sm font-medium mb-2" style={{ color: tokenColor("ink") }}>
        Use this device instead of one of these:
      </p>
      <ul className="divide-y" style={{ borderColor: tokenColor("ink", 8) }}>
        {devices.map((device) => (
          <li key={device.id} className="flex items-center justify-between gap-3 py-2">
            <span className="flex items-center gap-2 text-sm" style={{ color: tokenColor("ink") }}>
              <MonitorSmartphone size={15} />
              <span>
                {device.label}
                <span className="block text-xs" style={{ color: tokenColor("ink", 47) }}>
                  Last used {new Date(device.lastSeenAt).toLocaleDateString("en-NG")}
                </span>
              </span>
            </span>
            <button
              onClick={() => remove(device)}
              disabled={Boolean(busy)}
              className="shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
              style={{ borderColor: tokenColor("clay", 40), color: tokenColor("clay") }}
            >
              {busy === device.id ? "Removing…" : "Remove"}
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="text-xs mt-2" style={{ color: tokenColor("clay") }}>{error}</p>}
    </div>
  );
}
