// useAuth.js
import { useCallback, useState } from "react";
import { getAuthHeaders, clearAuthToken } from "./auth";

const SERVER_URL = import.meta.env?.VITE_SYNC_SERVER_URL || "http://localhost:5000";

async function parse(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
  return data;
}

function storeToken(data) {
  if (data?.token) {
    localStorage.setItem("token", data.token);
  }
}

export function useAuth() {
  const [error, setError] = useState(null);

  const signupNewCompany = useCallback(async ({ email, name, password, businessName, cac, location, contact, industry, plan }) => {
    setError(null);
    try {
      const res = await fetch(`${SERVER_URL}/api/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          name,
          password,
          business: {
            businessName,
            cac,
            location,
            contact,
            industry,
          },
          ...(plan ? { plan } : {}),
        }),
      });
      const data = await parse(res);
      storeToken(data);
      return data;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  }, []);

  const inviteTeammate = useCallback(async ({ email, name, password, businessId, role }) => {
    setError(null);
    try {
      const res = await fetch(`${SERVER_URL}/api/users/invite`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ email, name, password, businessId, role }),
      });
      return await parse(res);
    } catch (err) {
      setError(err.message);
      throw err;
    }
  }, []);

  const login = useCallback(async ({ email, password }) => {
    setError(null);
    try {
      const res = await fetch(`${SERVER_URL}/api/users/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await parse(res);
      storeToken(data);
      return data.user;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  }, []);

  const logout = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`${SERVER_URL}/api/users/logout`, {
        method: "POST",
        headers: getAuthHeaders(),
      });
      const data = await parse(res);
      clearAuthToken();
      return data;
    } catch (err) {
      // Clear the local token even if the network request fails.
      clearAuthToken();
      setError(err.message);
      throw err;
    }
  }, []);

  return { signupNewCompany, inviteTeammate, login, logout, error };
}

export default useAuth;
