// deviceId.js
// A persistent, per-browser identifier — not tied to any user or business,
// just "this browser installation." Stored in localStorage rather than
// Dexie so it survives independently of any app data being cleared.
//
// Known limitation, worth knowing rather than being surprised by: a private/
// incognito window has no persistent localStorage across sessions, so it
// gets treated as a brand-new device every time it's opened. That's a soft
// limit — fine for a subscription gate, not meant to be bulletproof.

const KEY = "pocketaccountant_device_id";

export function getOrCreateDeviceId() {
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
  }
  return id;
}

export function describeThisDevice() {
  const ua = navigator.userAgent || "";
  const platform = navigator.platform || "Unknown platform";
  // Trimmed, human-readable label for an admin's device list — not trying
  // to be a full user-agent parser, just enough to tell devices apart.
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua)
    ? "Chrome"
    : /Firefox\//.test(ua)
    ? "Firefox"
    : /Safari\//.test(ua)
    ? "Safari"
    : "Browser";
  return `${browser} on ${platform}`;
}
