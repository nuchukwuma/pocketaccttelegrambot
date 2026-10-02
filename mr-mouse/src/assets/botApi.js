// botApi.js — calls to the bot server (Telegram, WhatsApp, statements,
// reminder settings).
//
// They carry the signed-in person's own session token. The bot server asks
// the main backend whose token it is and only lets them act for their own
// business. There is deliberately no shared key here any more: anything
// in a VITE_ variable is compiled into the app for anyone to read.
import { getAuthHeaders } from "./auth";

export const BOT_SERVER_URL = import.meta.env?.VITE_BOT_SERVER_URL || "http://localhost:8787";

export function botFetch(path, { headers, ...options } = {}) {
  return fetch(`${BOT_SERVER_URL}${path}`, {
    ...options,
    headers: { ...getAuthHeaders(true), ...(headers || {}) },
  });
}
