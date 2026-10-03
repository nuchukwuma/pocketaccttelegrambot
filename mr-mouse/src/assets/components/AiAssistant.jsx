import React, { useState, useRef, useEffect } from "react";
import { ConsentCard } from "../legal/ConsentGate";
import { useConsents } from "../legal/useConsents";
import { useLedger } from "../booksofacc/Ledgercontext";
import { useSubscription } from "../useSubscription";
import { getAuthHeaders } from "../auth";

const SERVER_URL =
  import.meta.env?.VITE_SYNC_SERVER_URL ||
  "http://localhost:5000";

export default function AiAssistant({ onNavigate }) {
  const { business } = useLedger();
  const { subscription } = useSubscription(business?.id);

  const premiumActive = Boolean(
    subscription?.addOns?.ai
  );

  const [open, setOpen] = useState(false);
  // Nothing is sent to an AI provider until the owner agrees (legal/legal.js → ai).
  const { has: hasConsent } = useConsents();
  const aiAllowed = hasConsent("ai");
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState(false);

  const listRef = useRef(null);

  useEffect(() => {
    listRef.current?.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  if (!business) return null;

  async function send(text) {
    if (!aiAllowed) return; // belt and braces: the panel is not shown either
    const cleanText = String(text || "").trim();

    if (!cleanText || busy || pendingConfirm) {
      return;
    }

    setMessages((m) => [
      ...m,
      {
        role: "user",
        text: cleanText,
      },
    ]);

    setInput("");
    setBusy(true);

    try {
      const res = await fetch(
        `${SERVER_URL}/api/ai/chat`,
        {
          method: "POST",

          headers: {
            ...getAuthHeaders(true),
          },

          credentials: "include",

          body: JSON.stringify({
            message: cleanText,
          }),
        }
      );

      let data = {};

      try {
        data = await res.json();
      } catch {
        data = {};
      }

      console.log("[AI] status:", res.status);
      console.log("[AI] response:", data);

      if (!res.ok) {
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            text:
              data?.text ||
              data?.error ||
              `AI request failed (${res.status}).`,
          },
        ]);

        return;
      }

      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text:
            data?.text ||
            "The AI returned an empty response. Please try again.",
          confirm: Boolean(data?.confirm),
        },
      ]);

      setPendingConfirm(Boolean(data?.confirm));
    } catch (err) {
      console.error("[AI] request failed:", err);

      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text:
            "Couldn't reach the AI server. Please check that the backend is running.",
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function respondToConfirm(confirmed) {
    if (busy || !aiAllowed) return;

    setBusy(true);

    try {
      const endpoint = confirmed
        ? "confirm"
        : "cancel";

      const res = await fetch(
        `${SERVER_URL}/api/ai/chat/${endpoint}`,
        {
          method: "POST",

          headers: {
            ...getAuthHeaders(false),
          },

          credentials: "include",
        }
      );

      let data = {};

      try {
        data = await res.json();
      } catch {
        data = {};
      }

      console.log(
        `[AI] ${endpoint} status:`,
        res.status
      );

      if (!res.ok) {
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            text:
              data?.text ||
              data?.error ||
              "The AI could not complete that action.",
          },
        ]);

        return;
      }

      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text:
            data?.text ||
            (confirmed
              ? "Done."
              : "Cancelled."),
        },
      ]);
    } catch (err) {
      console.error(
        "[AI] confirmation request failed:",
        err
      );

      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text:
            "Couldn't contact the server. Please try again.",
        },
      ]);
    } finally {
      setPendingConfirm(false);
      setBusy(false);
    }
  }

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-action text-white shadow-lg flex items-center justify-center hover:scale-105 transition-transform"
        aria-label="Ask the assistant"
      >
        {open ? "✕" : "💬"}
      </button>

      {open && !aiAllowed && (
        <div className="fixed bottom-24 right-4 left-4 z-50 w-auto max-w-sm mx-auto sm:left-auto sm:mx-0 sm:w-[92vw] max-h-[70vh] overflow-y-auto rounded-2xl shadow-2xl">
          <ConsentCard purpose="ai" compact />
        </div>
      )}

      {open && aiAllowed && (
        <div className="fixed bottom-24 right-4 left-4 z-50 w-auto max-w-sm mx-auto sm:left-auto sm:mx-0 sm:w-[92vw] h-[65vh] bg-white rounded-2xl shadow-2xl border border-black/10 flex flex-col overflow-hidden">

          {/* Header */}
          <div className="px-4 py-3 border-b bg-paper flex items-center justify-between gap-3">

            <div className="font-medium">
              Mr. Mouse assistant
            </div>

            <div className="font-body text-[13px] text-ink-soft">
              {premiumActive
                ? "Premium · Claude"
                : "Free · Gemini"}
            </div>

          </div>

          {/* Free AI notice */}
          {!premiumActive && (
            <div className="px-4 py-2 border-b bg-paper-sunk text-[11px] text-ink/60">

              Free Gemini AI is active.
              Free limits may apply to request frequency
              and large database results.

              <button
                onClick={() =>
                  onNavigate?.("settings")
                }
                className="ml-1 underline text-ink"
              >
                Compare Premium
              </button>

            </div>
          )}

          {/* Messages */}
          <div
            ref={listRef}
            className="flex-1 overflow-y-auto px-4 py-3 space-y-3"
          >

            {messages.length === 0 && (
              <div className="space-y-3">

                {/* Fast Path Commands */}
                <div className="bg-paper rounded-xl p-3 border border-rule">
                  <p className="text-sm font-semibold text-action mb-2">
                    ⚡ Fast Commands
                  </p>

                  <p className="text-xs text-ink-soft mb-3">
                    Get common bookkeeping information instantly.
                  </p>

                  <div className="flex flex-wrap gap-2">
                    {[
                      "How much gold do I have?",
                      "How much silver do I have?",
                      "Show my stock.",
                      "What's my balance?",
                      "How much cash do I have?",
                      "Who owes me?",
                      "Who do I owe?",
                      "Show pending orders.",
                      "Show deadlines.",
                      "Balance summary.",
                    ].map((example) => (
                      <button
                        key={example}
                        onClick={() => send(example)}
                        disabled={busy || pendingConfirm}
                        className="text-xs px-3 py-2 rounded-full border border-action/20 bg-white text-action hover:bg-action hover:text-white transition disabled:opacity-50"
                      >
                        {example}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Normal AI Examples */}
                <div className="bg-paper rounded-xl p-3 border">
                  <p className="text-sm font-semibold text-ink mb-2">
                    💬 Record transactions
                  </p>

                  <p className="text-xs text-ink-soft mb-2">
                    You can also tell me what happened in your business.
                  </p>

                  <div className="space-y-2 text-xs text-ink-soft">
                    <div>
                      • I sold 20 pieces of gold for ₦400,000 cash.
                    </div>

                    <div>
                      • I bought 10 bags of rice for ₦250,000.
                    </div>

                    <div>
                      • Add debtor John for ₦50,000.
                    </div>

                    <div>
                      • Record expense ₦12,000 for transport.
                    </div>

                    <div>
                      • Add pending order for Mary — 5 necklaces.
                    </div>
                  </div>
                </div>

              </div>
            )}

            {messages.map((m, i) => (
              <div
                key={i}
                className={`text-sm ${
                  m.role === "user"
                    ? "text-right"
                    : "text-left"
                }`}
              >
                <span
                  className={`inline-block px-3 py-2 rounded-xl max-w-[85%] whitespace-pre-wrap ${
                    m.role === "user"
                      ? "bg-action text-white"
                      : "bg-paper-sunk"
                  }`}
                >
                  {m.text}
                </span>
              </div>
            ))}

            {busy && !pendingConfirm && (
              <div className="text-left">
                <span className="inline-block px-3 py-2 rounded-xl bg-paper-sunk text-ink-soft">
                  Thinking…
                </span>
              </div>
            )}

            {pendingConfirm && (
              <div className="flex gap-2 justify-start">

                <button
                  onClick={() =>
                    respondToConfirm(true)
                  }
                  disabled={busy}
                  className="px-3 py-1.5 rounded-lg bg-action text-white text-sm disabled:opacity-50"
                >
                  ✅ Confirm
                </button>

                <button
                  onClick={() =>
                    respondToConfirm(false)
                  }
                  disabled={busy}
                  className="px-3 min-h-[44px] rounded-md border border-rule bg-white text-ink text-sm disabled:opacity-50"
                >
                  ❌ Cancel
                </button>

              </div>
            )}

          </div>

          {/* Input */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="border-t p-2 flex gap-2"
          >

            <input
              value={input}
              onChange={(e) =>
                setInput(e.target.value)
              }
              disabled={
                busy || pendingConfirm
              }
              placeholder={
                pendingConfirm
                  ? "Confirm or cancel above first…"
                  : "Ask or tell me something…"
              }
              className="flex-1 px-3 py-2 rounded-lg border text-sm"
            />

            <button
              type="submit"
              disabled={
                busy ||
                pendingConfirm ||
                !input.trim()
              }
              className="px-3 py-2 rounded-lg bg-action text-white text-sm disabled:opacity-50"
            >
              →
            </button>

          </form>

        </div>
      )}
    </>
  );
}
