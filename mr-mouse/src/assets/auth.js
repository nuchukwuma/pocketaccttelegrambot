// auth.js
// Centralized Bearer-token helpers for the Electron/desktop client.
// The backend should issue `token` in login/signup responses and accept
// Authorization: Bearer <token> on authenticated routes.

export function getAuthToken() {
  try {
    return localStorage.getItem("token");
  } catch {
    return null;
  }
}

export function getAuthHeaders(includeContentType = true) {
  const token = getAuthToken();
  return {
    ...(includeContentType ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export function clearAuthToken() {
  try {
    localStorage.removeItem("token");
  } catch {}
}
