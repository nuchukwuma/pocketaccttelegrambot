import React, { useState } from "react";
import { MessageCircle, Copy, Check } from "lucide-react";
import { useLedger } from "../booksofacc/Ledgercontext";

// Drop this into a settings page in the app (e.g. rendered from Dashboard
// or a new settings.jsx). It calls the BOT SERVER directly with a shared
// key — see the "harden this" note in the bot's README before shipping
// broadly; for now this is enough to get the opt-in flow working end to
// end.
//
// Env vars needed in the React app's .env (Vite):
//   VITE_BOT_SERVER_URL=https://your-bot-server.example.com
//   VITE_BOT_API_KEY=<same value as BOT_API_KEY in the bot's .env>

const BOT_SERVER_URL = import.meta.env?.VITE_BOT_SERVER_URL || "http://localhost:8787";
const BOT_API_KEY = import.meta.env?.VITE_BOT_API_KEY || "";
const TELEGRAM_BOT_USERNAME = import.meta.env?.VITE_TELEGRAM_BOT_USERNAME || "Accountantmousebot";

export default function ConnectTelegram() {
  const { business } = useLedger();
  const [code, setCode] = useState(null);
  const [expiresAt, setExpiresAt] = useState(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const generateCode = async () => {
    if (!business?.id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BOT_SERVER_URL}/api/pair/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-bot-api-key": BOT_API_KEY },
        body: JSON.stringify({ companyId: business.id }),
      });
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      const data = await res.json();
      setCode(data.code);
      setExpiresAt(data.expiresAt);
    } catch (err) {
      console.error("[telegram] pairing error", err);
      setError("Couldn't generate a code. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const copyLinkCommand = () => {
    navigator.clipboard.writeText(`/link ${code}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-lg border border-rule bg-white p-5 max-w-md">
      <div className="flex items-center gap-2 mb-3">
        <MessageCircle size={18} className="text-moss" />
        <h3 className="font-display text-lg text-ink">Connect Telegram</h3>
      </div>
      <p className="font-body text-sm text-ink/60 mb-4">
        Check stock, log sales, and see who owes you — right from Telegram.
      </p>

      {!code ? (
        <button
          onClick={generateCode}
          disabled={loading || !business?.id}
          className="w-full rounded-lg bg-action text-white font-body text-sm font-medium py-2.5 hover:bg-action-deep transition-colors disabled:opacity-50"
        >
          {loading ? "Generating…" : "Generate connection code"}
        </button>
      ) : (
        <div className="space-y-3">
          <div className="rounded-lg bg-paper-sunk px-4 py-3 flex items-center justify-between">
            <span className="font-mono text-lg tracking-[0.15em] text-ink">{code}</span>
            <button onClick={copyLinkCommand} className="text-moss hover:text-ink">
              {copied ? <Check size={16} /> : <Copy size={16} />}
            </button>
          </div>
          <ol className="font-body text-xs text-ink/60 list-decimal list-inside space-y-1">
            <li>
              Open{" "}
              <a
                href={`https://t.me/${TELEGRAM_BOT_USERNAME}`}
                target="_blank"
                rel="noreferrer"
                className="text-moss underline"
              >
                @{TELEGRAM_BOT_USERNAME}
              </a>{" "}
              on Telegram
            </li>
            <li>
              Send: <code className="bg-paper-sunk px-1 rounded">/link {code}</code>
            </li>
          </ol>
          <p className="font-mono text-[10px] text-ink/40">Expires {new Date(expiresAt).toLocaleTimeString()}</p>
        </div>
      )}

      {error && <p className="font-body text-xs text-clay mt-2">{error}</p>}
    </div>
  );
}