// useUsers.js
// Parallel to how `business` is handled in useCompanySync.js: real REST
// calls to the server (never the relay) for anything touching a password,
// plus a socket listener so a user created/edited on one device shows up
// live on every other device connected for that business.
//
// This does NOT reuse useCompanySync's `mutate()` — that function is for
// ledger data that never touches a database. Users always go through a real
// backend endpoint, since password hashing and uniqueness checks have to
// happen server-side.

import { useCallback, useEffect, useState } from "react";
import { io } from "socket.io-client";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "./db";
import { getAuthHeaders } from "./auth";

const SERVER_URL = import.meta.env?.VITE_SYNC_SERVER_URL || "http://localhost:5000";

export function useUsers(businessId) {
  const [error, setError] = useState(null);

  const users = useLiveQuery(
    () => (businessId ? db.users.where({ businessId }).toArray() : []),
    [businessId]
  );

  // ---- Fetch the current roster once on mount / whenever businessId changes --
  const refreshUsers = useCallback(async () => {
    if (!businessId) return;
    try {
      const res = await fetch(`${SERVER_URL}/api/users?businessId=${businessId}`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error(`Failed to load users: ${res.status}`);
      const data = await res.json();
      await db.users.bulkPut(data.users);
    } catch (err) {
      console.error("[users] refresh error", err);
      setError(err.message);
    }
  }, [businessId]);

  useEffect(() => {
    refreshUsers();
  }, [refreshUsers]);

  // ---- Listen for live USER_EVENT from other devices --------------------------
  // Reuses the same room (`company_<businessId>`) your ledger relay already
  // joins — if your app already has one socket connection open (from
  // useCompanySync), you can instead have that hook forward USER_EVENT
  // through a shared context rather than opening a second socket. Shown here
  // as its own connection for clarity / drop-in simplicity.
  useEffect(() => {
    if (!businessId) return undefined;
    const token = localStorage.getItem("token");
    const socket = io(SERVER_URL, { transports: ["websocket"], auth: token ? { token } : undefined });
    socket.emit("JOIN_COMPANY", { companyId: businessId });

    socket.on("USER_EVENT", async ({ user }) => {
      if (!user || user.businessId !== businessId) return;
      await db.users.put(user);
    });

    return () => {
      socket.emit("LEAVE_COMPANY", { companyId: businessId });
      socket.disconnect();
    };
  }, [businessId]);

  // ---- Real actions: all go straight to the server, never the relay ----------
  const signup = useCallback(async ({ email, name, password, role }) => {
    setError(null);
    const res = await fetch(`${SERVER_URL}/api/users/invite`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ email, name, password, businessId, role }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error);
      throw new Error(data.error);
    }
    await db.users.put(data.user);
    return data.user;
  }, [businessId]);

  const login = useCallback(async ({ email, password }) => {
    setError(null);
    const res = await fetch(`${SERVER_URL}/api/users/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error);
      throw new Error(data.error);
    }
    if (data.token) localStorage.setItem("token", data.token);
    await db.users.put(data.user);
    return data.user; // includes .businessId — this is your real companyId now
  }, []);

  const updateUser = useCallback(async (id, updates) => {
    setError(null);
    const res = await fetch(`${SERVER_URL}/api/users/${id}`, {
      method: "PATCH",
      headers: getAuthHeaders(),
      body: JSON.stringify(updates),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error);
      throw new Error(data.error);
    }
    await db.users.put(data.user);
    return data.user;
  }, []);

  return { users: users || [], error, signup, login, updateUser, refreshUsers };
}

export default useUsers;
