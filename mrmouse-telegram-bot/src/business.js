// Uses the SAME REST endpoint useCompanySync.js already calls
// (fetchBusinessFromServer / saveBusinessToServer). No socket involved —
// business profile was never part of the peer-to-peer relay in the app,
// so we don't reinvent that here either.
import dotenv from "dotenv";
dotenv.config();
import { cacheBusiness, getCachedBusiness } from "./db.js";
import { isCacheMode } from "./socketPeer.js";

const SERVER_URL = process.env.MAIN_APP_SERVER_URL || "http://localhost:5000";

export async function fetchBusiness(companyId) {
  try {
    const res = await fetch(`${SERVER_URL}/api/sync/business?companyId=${encodeURIComponent(companyId)}`, {
      headers: { "x-bot-api-key": process.env.BOT_API_KEY || "" },
    });
    if (!res.ok) throw new Error(`Business fetch failed: ${res.status}`);
    const data = await res.json();
    if (data.business && isCacheMode()) await cacheBusiness(companyId, data.business);
    return data.business || null;
  } catch (err) {
    console.error(`[${companyId}] business fetch error`, err);
    // Fall back to whatever we last cached, if anything.
    return isCacheMode() ? await getCachedBusiness(companyId) : null;
  }
}
