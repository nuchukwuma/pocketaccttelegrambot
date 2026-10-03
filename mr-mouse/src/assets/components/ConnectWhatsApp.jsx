import React, { useEffect, useState } from "react";
import ConsentGate from "../legal/ConsentGate";
import { MessageSquare, Check, RefreshCw, Trash2 } from "lucide-react";
import { useLedger } from "../booksofacc/Ledgercontext";
import { botFetch } from "../botApi";


async function apiFetch(path, options = {}) {
  const res = await botFetch(path, options);

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || `Request failed: ${res.status}`);
  }

  return data;
}

/* Shown only after the business owner agrees to what WhatsApp involves
   (legal/legal.js → whatsapp). Until then, this component never renders,
   so it cannot contact the bot server. */
export default function ConnectWhatsAppGated() {
  return (
    <ConsentGate purpose="whatsapp">
      <ConnectWhatsApp />
    </ConsentGate>
  );
}

function ConnectWhatsApp() {
  const { business } = useLedger();

  const [qr, setQr] = useState(null);
  const [instanceName, setInstanceName] = useState(null);
  const [state, setState] = useState("unknown");
  const [loadingQr, setLoadingQr] = useState(false);
  const [error, setError] = useState(null);

  const [clients, setClients] = useState([]);
  const [clientNumber, setClientNumber] = useState("");
  const [clientName, setClientName] = useState("");
  const [savingClient, setSavingClient] = useState(false);
  const [clientError, setClientError] = useState(null);

  const connected = state === "open";

  const loadClients = async () => {
    if (!business?.id) return;

    try {
      const data = await apiFetch(
        `/api/whatsapp/clients?companyId=${encodeURIComponent(business.id)}`
      );
      setClients(data.clients || []);
    } catch {
      console.error("[whatsapp] clients load failed", err);
      setClientError(err.message);
    }
  };

  const refreshStatus = async () => {
    if (!business?.id) return;

    try {
      const data = await apiFetch(
        `/api/whatsapp/connect/status?companyId=${encodeURIComponent(
          business.id
        )}`
      );

      setInstanceName(data.instanceName || null);
      setState(data.state || "unknown");
    } catch {
      // A missing instance is not fatal; the Connect button will create it.
      setState("not_created");
    }
  };

  const generateQr = async () => {
    if (!business?.id) return;

    setLoadingQr(true);
    setError(null);

    try {
      const data = await apiFetch("/api/whatsapp/connect", {
        method: "POST",
        body: JSON.stringify({ companyId: business.id }),
      });

      setInstanceName(data.instanceName || null);
      setState(data.state || "unknown");
      setQr(data.qr || null);
    } catch (err) {
      console.error("[whatsapp] QR generation failed", err);
      setError(err.message || "Couldn't start WhatsApp connection.");
    } finally {
      setLoadingQr(false);
    }
  };

  useEffect(() => {
    if (!business?.id) return;

    refreshStatus();
    loadClients();
  }, [business?.id]);

  useEffect(() => {
    if (!business?.id || connected) return;

    let active = true;

    const poll = async () => {
      try {
        const data = await apiFetch(
          `/api/whatsapp/connect/status?companyId=${encodeURIComponent(
            business.id
          )}`
        );

        if (!active) return;

        setState(data.state || "unknown");
        setInstanceName(data.instanceName || null);

        if (data.state === "open") {
          setQr(null);
        }
      } catch {
        // Keep polling quietly while the connection is being established.
      }
    };

    const timer = setInterval(poll, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [business?.id, connected]);

  const addClient = async () => {
    if (!business?.id || !clientNumber.trim()) return;

    setSavingClient(true);
    setClientError(null);

    try {
      await apiFetch("/api/whatsapp/clients", {
        method: "POST",
        body: JSON.stringify({
          companyId: business.id,
          waNumber: clientNumber,
          name: clientName.trim() || undefined,
        }),
      });

      setClientNumber("");
      setClientName("");
      await loadClients();
    } catch (err) {
      setClientError(err.message || "Couldn't save client.");
    } finally {
      setSavingClient(false);
    }
  };

  const removeClient = async (waId) => {
    if (!business?.id) return;

    try {
      await apiFetch(
        `/api/whatsapp/clients/${encodeURIComponent(waId)}`,
        {
          method: "DELETE",
          body: JSON.stringify({ companyId: business.id }),
        }
      );

      await loadClients();
    } catch (err) {
      setClientError(err.message || "Couldn't remove client.");
    }
  };

  return (
    <div className="rounded-lg border border-rule bg-surface p-5 max-w-md space-y-6">
      <section>
        <div className="flex items-center gap-2 mb-3">
          <MessageSquare size={18} className="text-moss" />
          <h3 className="font-display text-lg text-ink">
            Connect your WhatsApp
          </h3>
        </div>

        <p className="font-body text-sm text-ink/60 mb-4">
          This connects this business's own WhatsApp account to your
          PocketAccountant account. Your clients will not scan this QR.
        </p>

        <div className="rounded-lg bg-paper-sunk px-4 py-3 mb-3">
          <div className="flex items-center justify-between">
            <span className="font-body text-xs text-ink/60">
              Connection
            </span>
            <span
              className={`font-body text-xs font-semibold ${
                connected ? "text-moss" : "text-clay"
              }`}
            >
              {connected ? "Connected" : state}
            </span>
          </div>

          {instanceName && (
            <p className="font-mono text-micro text-ink/40 mt-1 break-all">
              {instanceName}
            </p>
          )}
        </div>

        {qr && !connected && (
          <div className="rounded-lg border border-ink/10 p-3 mb-3 bg-surface">
            <img
              src={qr}
              alt="WhatsApp connection QR code"
              className="w-full max-w-[320px] mx-auto"
            />
            <p className="font-body text-xs text-ink/60 text-center mt-2">
              On the WhatsApp phone for this business: Linked Devices → Link a
              device → scan this QR.
            </p>
          </div>
        )}

        <button
          onClick={generateQr}
          disabled={loadingQr || !business?.id}
          className="w-full rounded-lg bg-action text-on-action font-body text-sm font-medium py-2.5 hover:bg-action-deep transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {loadingQr ? (
            "Starting…"
          ) : connected ? (
            <>
              <Check size={16} />
              WhatsApp connected
            </>
          ) : (
            <>
              <RefreshCw size={16} />
              {qr ? "Refresh QR" : "Connect WhatsApp"}
            </>
          )}
        </button>
      </section>

      <section className="border-t border-ink/10 pt-5">
        <div className="flex items-center gap-2 mb-2">
          <MessageSquare size={17} className="text-moss" />
          <h4 className="font-display text-base text-ink">
            Your WhatsApp clients
          </h4>
        </div>

        <p className="font-body text-xs text-ink/50 mb-3">
          Add the phone numbers that should receive invoices and reports from
          this business.
        </p>

        <div className="space-y-2">
          <input
            value={clientNumber}
            onChange={(e) => setClientNumber(e.target.value)}
            placeholder="2348012345678"
            inputMode="tel"
            className="w-full rounded-lg border border-ink/15 px-3 py-2.5 font-body text-sm outline-none focus:border-moss"
          />

          <input
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            placeholder="Client name (optional)"
            className="w-full rounded-lg border border-ink/15 px-3 py-2.5 font-body text-sm outline-none focus:border-moss"
          />

          <button
            onClick={addClient}
            disabled={savingClient || !business?.id || !clientNumber.trim()}
            className="w-full rounded-lg border border-ink/15 text-ink font-body text-sm font-medium py-2.5 hover:bg-paper-sunk transition-colors disabled:opacity-50"
          >
            {savingClient ? "Saving…" : "Add client"}
          </button>
        </div>

        {clients.length > 0 && (
          <div className="mt-4 space-y-2">
            {clients.map((client) => (
              <div
                key={client.wa_id}
                className="flex items-center justify-between rounded-lg bg-paper px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="font-body text-sm text-ink truncate">
                    {client.name || "WhatsApp client"}
                  </p>
                  <p className="font-mono text-micro text-ink/50">
                    {client.wa_id}
                  </p>
                </div>

                <button
                  onClick={() => removeClient(client.wa_id)}
                  className="text-clay hover:text-ink p-1"
                  title="Remove client"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}

        {clientError && (
          <p className="font-body text-xs text-clay mt-2">
            {clientError}
          </p>
        )}
      </section>

      {error && (
        <p className="font-body text-xs text-clay">{error}</p>
      )}
    </div>
  );
}