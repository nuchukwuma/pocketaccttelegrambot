// useDevices.js
// Parallel to useUsers.js: fetches the device roster for a business, stays
// live via the DEVICE_EVENT socket broadcast routes/devices.js already
// sends, and exposes removeDevice() for freeing a slot.

import { useCallback, useEffect, useState } from "react";
import { io } from "socket.io-client";
import { getAuthHeaders, getAuthToken } from "./auth";

const SERVER_URL = import.meta.env?.VITE_SYNC_SERVER_URL || "http://localhost:5000";

export function useDevices(businessId) {
  const [devices, setDevices] = useState([]);
  const [maxDevices, setMaxDevices] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const res = await fetch(`${SERVER_URL}/api/devices?businessId=${businessId}`, { headers: getAuthHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load devices");
      setDevices(data.devices || []);
      setMaxDevices(data.maxDevices || 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!businessId) return undefined;
    const token = getAuthToken();
    const socket = io(SERVER_URL, { transports: ["websocket"], auth: token ? { token } : undefined });
    socket.emit("JOIN_COMPANY", { companyId: businessId });

    socket.on("DEVICE_EVENT", ({ action, device }) => {
      if (!device || device.businessId !== businessId) return;
      setDevices((prev) => {
        if (action === "remove") return prev.filter((d) => d.id !== device.id);
        const exists = prev.some((d) => d.id === device.id);
        return exists ? prev.map((d) => (d.id === device.id ? device : d)) : [...prev, device];
      });
    });

    return () => {
      socket.emit("LEAVE_COMPANY", { companyId: businessId });
      socket.disconnect();
    };
  }, [businessId]);

  const removeDevice = useCallback(
    async (deviceId) => {
      setError(null);
      const res = await fetch(`${SERVER_URL}/api/devices/${deviceId}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
        body: JSON.stringify({ businessId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error);
        throw new Error(data.error);
      }
      setDevices((prev) => prev.filter((d) => d.id !== deviceId));
    },
    [businessId]
  );

  return { devices, maxDevices, loading, error, refresh, removeDevice };
}

export default useDevices;
