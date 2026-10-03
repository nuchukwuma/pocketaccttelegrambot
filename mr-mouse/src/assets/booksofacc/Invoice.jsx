import React, { useState } from "react";
import { useConsentPrompt } from "../legal/ConsentGate";
import { botFetch } from "../botApi";
import { MessageSquare, Check, Loader2, Printer, Share2, Plus, Trash2, ArrowLeft } from "lucide-react";
import { useLedger } from "./Ledgercontext";
import { GlobalStyle, TopNav, Field, formatMoney } from "./ui";


export default function InvoiceBuilder({ onNavigate }) {
  const { business: rawBusiness } = useLedger();

  // Standardize profile fields at the component level
  const business = rawBusiness
    ? {
        ...rawBusiness,
        name: rawBusiness.name || rawBusiness.businessName || "Your business",
        address: rawBusiness.address || rawBusiness.location || "",
        phone: rawBusiness.phone || rawBusiness.contact || "",
      }
    : null;

  const [invoice, setInvoice] = useState({
    invoiceNumber: "INV-001",
    clientName: "",
    clientEmail: "",
    date: new Date().toISOString().split("T")[0],
    items: [{ description: "", quantity: 1, price: 0 }],
  });

  const [sendStatus, setSendStatus] = useState("idle"); // idle | sending | sent | error
  const [sendError, setSendError] = useState("");

  const handleItemChange = (index, field, value) => {
    // Replace the item rather than mutating it in place — the old version
    // wrote through to the same object React was still holding, which is
    // the kind of thing that works until it silently doesn't.
    setInvoice((prev) => ({
      ...prev,
      items: prev.items.map((item, i) => (i === index ? { ...item, [field]: value } : item)),
    }));
  };

  const addItem = () => {
    setInvoice((prev) => ({
      ...prev,
      items: [...prev.items, { description: "", quantity: 1, price: 0 }],
    }));
  };

  const removeItem = (index) => {
    setInvoice((prev) => ({
      ...prev,
      items: prev.items.length === 1 ? prev.items : prev.items.filter((_, i) => i !== index),
    }));
  };

  const calculateTotal = () => {
    return invoice.items.reduce(
      (sum, item) => sum + Number(item.quantity || 0) * Number(item.price || 0),
      0
    );
  };

  const handlePrint = () => {
    window.print();
  };

  const handleShare = async () => {
    const total = calculateTotal();
    const shareData = {
      title: `Invoice #${invoice.invoiceNumber}`,
      text: `Invoice #${invoice.invoiceNumber} from ${business?.name || "Business"} - Total: ₦${total.toLocaleString()}`,
      url: window.location.href,
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch (err) {
        if (err.name !== "AbortError") {
          console.error("Error sharing:", err);
        }
      }
    } else {
      try {
        await navigator.clipboard.writeText(`${shareData.title}\n${shareData.text}`);
        alert("Invoice summary copied to clipboard!");
      } catch (err) {
        console.error("Clipboard write failed:", err);
      }
    }
  };

  // Messages to clients go through WhatsApp (Meta): ask before the first one.
  const whatsappConsent = useConsentPrompt("whatsapp");

  const sendViaWhatsApp = async () => {
    if (!business?.id) return;
    setSendStatus("sending");
    setSendError("");

    const total = calculateTotal();
    const mappedItems = invoice.items.map((item) => ({
      description: item.description || "—",
      quantity: Number(item.quantity) || 0,
      unitPrice: Number(item.price) || 0,
      netAmount: Number(item.quantity || 0) * Number(item.price || 0),
    }));

    try {
      const res = await botFetch("/api/whatsapp/send-invoice", {
        method: "POST",
        body: JSON.stringify({
          companyId: business.id,
          invoice: {
            invoiceNumber: invoice.invoiceNumber,
            date: invoice.date,
            party: invoice.clientName || "Customer",
            partyContact: invoice.clientEmail || "",
            items: mappedItems,
            subtotal: total,
            total,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || `Send failed: ${res.status}`);
      }
      setSendStatus("sent");
      setTimeout(() => setSendStatus("idle"), 3000);
    } catch (err) {
      console.error("[invoice] whatsapp send error", err);
      setSendStatus("error");
      setSendError(err.message || "Couldn't send — check that WhatsApp is connected in settings.");
    }
  };

  const handleBackToDashboard = () => {
    if (onNavigate) {
      onNavigate("dashboard");
    } else {
      window.history.back();
    }
  };

  const sending = sendStatus === "sending";

  return (
    <div className="min-h-screen w-full bg-paper font-body">
      <GlobalStyle />
      {whatsappConsent.prompt}
      <TopNav business={business} current="invoice" onNavigate={onNavigate} />

      {/* The preview is the deliverable, so it is what prints — the form,
          the nav and the page chrome are all hidden on paper. */}
      <style>{`
        @media print {
          @page { margin: 16mm; }
          /* Paper is white whatever the screen theme is. */
          body { background: #fff; }
        }
      `}</style>

      <div className="max-w-6xl mx-auto px-5 sm:px-8 pt-6 pb-24 print:p-0 print:max-w-none">
        <div className="print:hidden">
          <button
            onClick={handleBackToDashboard}
            type="button"
            className="flex items-center gap-1.5 font-body text-sm text-ink-soft hover:text-ink mb-6 min-h-tap"
          >
            <ArrowLeft size={15} /> Back to dashboard
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 print:block">
          {/* ---- Form ---- */}
          <div className="bg-surface p-6 rounded-lg border border-rule print:hidden">
            <h2 className="font-display text-xl font-semibold mb-5 text-ink">Create invoice</h2>

            <div className="space-y-5 font-body text-sm">
              <Field label="Invoice number">
                <input
                  id="invoice-number"
                  type="text"
                  value={invoice.invoiceNumber}
                  onChange={(e) => setInvoice({ ...invoice, invoiceNumber: e.target.value })}
                  className="ledger-input w-full py-2 text-sm"
                />
              </Field>

              <Field label="Client name">
                <input
                  id="invoice-client"
                  type="text"
                  value={invoice.clientName}
                  onChange={(e) => setInvoice({ ...invoice, clientName: e.target.value })}
                  placeholder="e.g. Adaeze Foods Ltd"
                  className="ledger-input w-full py-2 text-sm"
                />
              </Field>

              <Field
                label="Client phone"
                optional
                error={undefined}
              >
                <input
                  id="invoice-client-phone"
                  type="text"
                  value={invoice.clientEmail}
                  onChange={(e) => setInvoice({ ...invoice, clientEmail: e.target.value })}
                  placeholder="e.g. 0803 123 4567 — needed to send on WhatsApp"
                  className="ledger-input w-full py-2 text-sm"
                />
              </Field>

              <div>
                <p className="font-body text-label text-ink-soft mb-2">Line items</p>
                <div className="space-y-2">
                  {invoice.items.map((item, index) => (
                    <div key={index} className="flex gap-2 items-end">
                      <div className="flex-1 min-w-0">
                        <label htmlFor={`item-desc-${index}`} className="sr-only">
                          Item {index + 1} description
                        </label>
                        <input
                          id={`item-desc-${index}`}
                          type="text"
                          placeholder="Item description"
                          value={item.description}
                          onChange={(e) => handleItemChange(index, "description", e.target.value)}
                          className="ledger-input w-full py-2 text-sm"
                        />
                      </div>
                      <div className="w-16 shrink-0">
                        <label htmlFor={`item-qty-${index}`} className="sr-only">
                          Item {index + 1} quantity
                        </label>
                        <input
                          id={`item-qty-${index}`}
                          type="number"
                          placeholder="Qty"
                          value={item.quantity}
                          onChange={(e) => handleItemChange(index, "quantity", e.target.value)}
                          className="ledger-input w-full py-2 text-sm font-mono text-right"
                        />
                      </div>
                      <div className="w-24 shrink-0">
                        <label htmlFor={`item-price-${index}`} className="sr-only">
                          Item {index + 1} unit price
                        </label>
                        <input
                          id={`item-price-${index}`}
                          type="number"
                          placeholder="Price"
                          value={item.price}
                          onChange={(e) => handleItemChange(index, "price", e.target.value)}
                          className="ledger-input w-full py-2 text-sm font-mono text-right"
                        />
                      </div>
                      <button
                        onClick={() => removeItem(index)}
                        type="button"
                        disabled={invoice.items.length === 1}
                        aria-label={`Remove item ${index + 1}`}
                        className="flex items-center justify-center w-11 h-11 shrink-0 text-ink/35 hover:text-clay disabled:opacity-30 disabled:hover:text-ink/35 transition-colors"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  onClick={addItem}
                  type="button"
                  className="inline-flex items-center gap-1.5 font-body text-label font-medium text-action hover:underline mt-3 min-h-tap"
                >
                  <Plus size={14} /> Add item
                </button>
              </div>

              <div className="pt-4 border-t border-rule space-y-3">
                <button
                  onClick={() => whatsappConsent.ensure(sendViaWhatsApp)}
                  type="button"
                  disabled={sending || !business?.id}
                  className="w-full flex items-center justify-center gap-2 rounded-md bg-action text-on-action font-body text-sm font-medium min-h-tap px-4 hover:bg-action-deep disabled:opacity-60 transition-colors"
                >
                  {sending ? (
                    <>
                      <Loader2 size={16} className="animate-spin" /> Sending…
                    </>
                  ) : sendStatus === "sent" ? (
                    <>
                      <Check size={16} /> Sent on WhatsApp
                    </>
                  ) : (
                    <>
                      <MessageSquare size={16} /> Send on WhatsApp
                    </>
                  )}
                </button>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={handleShare}
                    type="button"
                    className="flex items-center justify-center gap-2 rounded-md border border-rule bg-surface text-ink font-body text-sm font-medium min-h-tap hover:bg-paper transition-colors"
                  >
                    <Share2 size={16} /> Share…
                  </button>

                  <button
                    onClick={handlePrint}
                    type="button"
                    className="flex items-center justify-center gap-2 rounded-md border border-rule bg-surface text-ink font-body text-sm font-medium min-h-tap hover:bg-paper transition-colors"
                  >
                    <Printer size={16} /> Print
                  </button>
                </div>

                {sendStatus === "error" && (
                  <p role="alert" className="font-body text-label text-clay">
                    {sendError}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* ---- Preview ---- */}
          <InvoicePreview business={business} invoice={invoice} total={calculateTotal()} />
        </div>
      </div>
    </div>
  );
}

function InvoicePreview({ business, invoice, total }) {
  return (
    <div className="bg-surface p-8 rounded-lg border border-rule text-ink flex flex-col justify-between print:border-none print:p-0 print:w-full">
      <div>
        <div className="flex justify-between items-start gap-6 rule-sum pb-6 mb-6">
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-bold text-ink mb-1">
              {business?.name || "Your Business"}
            </h1>
            {business?.address && (
              <p className="font-body text-label text-ink-soft">{business.address}</p>
            )}
            {business?.phone && (
              <p className="font-body text-label text-ink-soft">{business.phone}</p>
            )}
          </div>
          <div className="text-right shrink-0">
            <h2 className="font-display text-lg font-semibold text-ink">Invoice</h2>
            <p className="font-mono text-label text-ink-soft">#{invoice.invoiceNumber}</p>
            <p className="font-mono text-label text-ink-soft">{invoice.date}</p>
          </div>
        </div>

        <div className="mb-6">
          <p className="font-body text-label text-ink-soft mb-1">Billed to</p>
          <p className="font-body text-sm font-medium">{invoice.clientName || "Client name"}</p>
        </div>

        <table className="w-full text-left border-collapse mb-6">
          <thead>
            <tr>
              <th className="font-body text-tiny font-medium text-ink-soft py-2 border-b border-rule">
                Description
              </th>
              <th className="font-body text-tiny font-medium text-ink-soft py-2 border-b border-rule text-right">
                Qty
              </th>
              <th className="font-body text-tiny font-medium text-ink-soft py-2 border-b border-rule text-right">
                Price
              </th>
              <th className="font-body text-tiny font-medium text-ink-soft py-2 border-b border-rule text-right">
                Amount
              </th>
            </tr>
          </thead>
          <tbody className="font-body text-sm">
            {invoice.items.map((item, idx) => {
              const last = idx === invoice.items.length - 1;
              return (
                <tr key={idx}>
                  <td className="py-2.5 border-b border-rule">{item.description || "—"}</td>
                  <td className="py-2.5 border-b border-rule text-right font-mono">
                    {item.quantity}
                  </td>
                  <td className={`py-2.5 text-right font-mono ${last ? "rule-sum" : "border-b border-rule"}`}>
                    {formatMoney(item.price)}
                  </td>
                  <td className={`py-2.5 text-right font-mono ${last ? "rule-sum" : "border-b border-rule"}`}>
                    {formatMoney(Number(item.quantity || 0) * Number(item.price || 0))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex justify-between items-center gap-6">
        <span className="font-body text-sm font-medium">Total due</span>
        <span className="font-mono text-xl font-semibold text-ink rule-total pb-1">
          {formatMoney(total)}
        </span>
      </div>
    </div>
  );
}
