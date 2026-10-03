import React, { useState } from "react";
import ConsentGate from "../legal/ConsentGate";
import { MessageCircle, Copy, Check } from "lucide-react";
import { useLedger } from "../booksofacc/Ledgercontext";
import { botFetch } from "../botApi";

// Pairs a Telegram chat with this business. Calls the bot server with the
// signed-in person's own token (see ../botApi.js).
//
// Env vars in the React app's .env (Vite):
//   VITE_BOT_SERVER_URL=https://your-bot-server.example.com
//   VITE_TELEGRAM_BOT_USERNAME=<the bot's @username, without the @>

const TELEGRAM_BOT_USERNAME = import.meta.env?.VITE_TELEGRAM_BOT_USERNAME || "Accountantmousebot";

/* Shown only after the business owner agrees to what Telegram involves
   (legal/legal.js → telegram). Until then, this component never renders,
   so it cannot contact the bot server. */
export default function ConnectTelegramGated() {
  return (
    <ConsentGate purpose="telegram">
      <ConnectTelegram />
    </ConsentGate>
  );
}

function ConnectTelegram() {
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
      const res = await botFetch("/api/pair/create", {
        method: "POST",
        body: JSON.stringify({ companyId: business.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
      setCode(data.code);
      setExpiresAt(data.expiresAt);
    } catch (err) {
      console.error("[telegram] pairing error", err);
      setError(err.message && !err.message.startsWith("Request failed") ? err.message : "Couldn't generate a code. Try again.");
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
    <div className="rounded-lg border border-rule bg-surface p-5 max-w-md">
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
          className="w-full rounded-lg bg-action text-on-action font-body text-sm font-medium py-2.5 hover:bg-action-deep transition-colors disabled:opacity-50"
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
          <p className="font-mono text-micro text-ink/40">Expires {new Date(expiresAt).toLocaleTimeString()}</p>
        </div>
      )}

      {error && <p className="font-body text-xs text-clay mt-2">{error}</p>}
    </div>
  );
}