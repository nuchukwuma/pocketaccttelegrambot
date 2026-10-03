import React, { useState, useMemo } from "react";
import {
  Calendar,
  Package,
  User,
  FileText,
  Wallet,
  Landmark,
  CreditCard,
  Coins,
  Receipt,
  ArrowDownCircle,
  ArrowUpCircle,
  Hash,
  BadgeDollarSign,
  CheckCircle2,
  Plus,
} from "lucide-react";
import { useLedger } from "./Ledgercontext";
import { GlobalStyle, TopNav, PageHeader, Field, todayISO } from "./ui";

const CATEGORY_OPTIONS = [
  {
    key: "cashbank",
    label: "Cash / Bank",
    icon: Wallet,
    desc: "Goods paid for or sold on the spot.",
  },
  {
    key: "credit",
    label: "Credit",
    icon: CreditCard,
    desc: "Sales or purchases on account.",
  },
  {
    key: "running",
    label: "Running expense",
    icon: Receipt,
    desc: "Operating cost paid by cash or bank.",
  },
  {
    key: "small",
    label: "Small expense",
    icon: Coins,
    desc: "Minor spend, out of petty cash.",
  },
];

const emptyForm = {
  category: "",
  date: todayISO(),
  productName: "",
  newProductName: "",
  party: "",
  description: "",
  method: "cash", // 'cash' | 'bank' — used for cashbank + running
  creditType: "sale", // 'sale' | 'purchase' — used for credit
  tradeType: "sale", // 'sale' | 'purchase' — used for cashbank
  amount: "",
  quantity: "",
};

export default function AddEntry({ onNavigate }) {
  const { business, products, addTransaction } = useLedger();
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState({});
  const [saved, setSaved] = useState(null);

  const set = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const isTrade = form.category === "cashbank" || form.category === "credit";
  const needsProduct = isTrade;
  const needsParty = isTrade;
  const needsQuantity = isTrade;

  const destinationBook = useMemo(() => {
    if (form.category === "cashbank") return "Cash Book";
    if (form.category === "credit") return form.creditType === "sale" ? "Sales Journal" : "Purchases Journal";
    if (form.category === "running") return "Cash Book (as an expense)";
    if (form.category === "small") return "Petty Cash Book";
    return null;
  }, [form.category, form.creditType]);

  const reset = () => {
    setForm(emptyForm);
    setErrors({});
  };

  const validate = () => {
    const e = {};
    if (!form.category) e.category = "Choose what kind of entry this is";
    if (!form.date) e.date = "Enter a date";

    if (needsProduct) {
      const usingNew = form.productName === "__new__";
      if (usingNew && !form.newProductName.trim()) e.productName = "Enter the new product's name";
      if (!usingNew && !form.productName) e.productName = "Select or add a product";
    }
    if (needsParty && !form.party.trim())
      e.party = form.category === "credit" || form.tradeType === "sale" ? "Enter a customer name" : "Enter a supplier name";
    if ((form.category === "running" || form.category === "small") && !form.description.trim())
      e.description = "Describe the expense";

    const amt = Number(form.amount);
    if (form.amount === "" || isNaN(amt) || amt <= 0) e.amount = "Enter a valid amount";

    if (needsQuantity) {
      const qty = Number(form.quantity);
      if (form.quantity === "" || isNaN(qty) || qty <= 0) e.quantity = "Enter a valid quantity";
    }

    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = (e) => {
    e.preventDefault();
    if (!validate()) return;

    const productName = form.productName === "__new__" ? form.newProductName.trim() : form.productName;
    const amount = Number(form.amount);
    const quantity = needsQuantity ? Number(form.quantity) : "";

    let tx;
    if (form.category === "cashbank") {
      tx = {
        date: form.date,
        productName,
        party: form.party.trim(),
        description: form.description.trim(),
        method: form.method,
        category: "trade",
        tradeType: form.tradeType,
        amount,
        quantity,
      };
    } else if (form.category === "credit") {
      tx = {
        date: form.date,
        productName,
        party: form.party.trim(),
        description: form.description.trim(),
        method: "credit",
        category: "trade",
        tradeType: form.creditType,
        amount,
        quantity,
      };
    } else if (form.category === "running") {
      tx = {
        date: form.date,
        productName: "",
        party: form.party.trim(),
        description: form.description.trim(),
        method: form.method,
        category: "runningExpense",
        amount,
        quantity: "",
      };
    } else {
      tx = {
        date: form.date,
        productName: "",
        party: form.party.trim(),
        description: form.description.trim(),
        method: "pettyCash",
        category: "smallExpense",
        amount,
        quantity: "",
      };
    }

    const created = addTransaction(tx);
    setSaved({ ...created, destinationBook });
    reset();
  };

  return (
    <div className="min-h-screen w-full bg-paper font-body pb-24">
      <GlobalStyle />
      <TopNav business={business} current="addentry" onNavigate={onNavigate} />
      <PageHeader
        business={business}
        icon={Plus}
        title="Add entry"
        subtitle="One form for every transaction — it's filed into the right book for you."
      />

      <div className="max-w-2xl mx-auto px-5 sm:px-8 pt-8 relative">
        {saved && (
          <div className="mb-6 rounded-xl border border-moss/30 bg-moss/8 px-5 py-4 flex items-start gap-3">
            <CheckCircle2 size={20} className="text-moss shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="font-body text-sm text-ink">
                Saved — posted to <strong>{saved.destinationBook}</strong>
                {saved.productName ? ` and updated inventory for "${saved.productName}"` : ""}.
              </p>
              <button
                onClick={() => onNavigate("book-page", { book: bookKeyFor(saved.destinationBook) })}
                className="font-body text-label font-medium text-action hover:underline mt-1.5 inline-block"
              >
                View that book →
              </button>
            </div>
          </div>
        )}

        <form onSubmit={submit} noValidate className="rounded-lg border border-rule bg-surface p-6 sm:p-8 space-y-6">
          {/* Category selector */}
          <div className={errors.category ? "ledger-field-error" : ""}>
            <label className="font-body text-label text-ink-soft mb-2 block">
              What is this entry?
            </label>
            <div className="grid grid-cols-2 gap-2.5">
              {CATEGORY_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const active = form.category === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() =>
                      setForm((f) => ({
                        ...emptyForm,
                        date: f.date,
                        category: opt.key,
                      }))
                    }
                    className={`flex flex-col items-start gap-1 rounded-xl border-2 px-4 py-3.5 text-left transition-all ${
                      active
                        ? "border-moss bg-moss text-on-action"
                        : "border-rule bg-surface text-ink hover:border-ink/25"
                    }`}
                  >
                    <Icon size={18} className={active ? "text-on-action" : "text-moss"} />
                    <span className="font-body text-sm font-semibold">{opt.label}</span>
                    <span className={`font-body text-tiny ${active ? "text-on-action/75" : "text-ink/45"}`}>{opt.desc}</span>
                  </button>
                );
              })}
            </div>
            {errors.category && <p className="font-body text-xs text-clay mt-2">{errors.category}</p>}
          </div>

          {form.category && (
            <>
              <div className="h-px bg-ink/10" />

              <Field icon={Calendar} label="Date" error={errors.date}>
                <input
                  type="date"
                  className="ledger-input w-full py-2 text-sm"
                  value={form.date}
                  onChange={(e) => set("date", e.target.value)}
                />
              </Field>

              {/* Cash / Bank sub-controls */}
              {form.category === "cashbank" && (
                <>
                  <ToggleRow
                    label="Sale or purchase?"
                    options={[
                      { value: "sale", label: "Sale — money in", icon: ArrowDownCircle },
                      { value: "purchase", label: "Purchase — money out", icon: ArrowUpCircle },
                    ]}
                    value={form.tradeType}
                    onChange={(v) => set("tradeType", v)}
                  />
                  <ToggleRow
                    label="Cash or bank?"
                    options={[
                      { value: "cash", label: "Cash", icon: Wallet },
                      { value: "bank", label: "Bank", icon: Landmark },
                    ]}
                    value={form.method}
                    onChange={(v) => set("method", v)}
                  />
                </>
              )}

              {/* Credit sub-controls */}
              {form.category === "credit" && (
                <ToggleRow
                  label="Credit sale or credit purchase?"
                  options={[
                    { value: "sale", label: "Credit sale", icon: ArrowDownCircle },
                    { value: "purchase", label: "Credit purchase", icon: ArrowUpCircle },
                  ]}
                  value={form.creditType}
                  onChange={(v) => set("creditType", v)}
                />
              )}

              {/* Running expense: still needs cash/bank */}
              {form.category === "running" && (
                <ToggleRow
                  label="Paid by cash or bank?"
                  options={[
                    { value: "cash", label: "Cash", icon: Wallet },
                    { value: "bank", label: "Bank", icon: Landmark },
                  ]}
                  value={form.method}
                  onChange={(v) => set("method", v)}
                />
              )}

              {/* Particulars */}
              {needsProduct && (
                <Field icon={Package} label="Product" error={errors.productName}>
                  {form.productName === "__new__" ? (
                    <div className="space-y-1.5">
                      <input
                        autoFocus
                        className="ledger-input w-full py-2 text-sm"
                        placeholder="e.g., Bag of Beans (25kg)"
                        value={form.newProductName}
                        onChange={(e) => set("newProductName", e.target.value)}
                      />
                      <button type="button" onClick={() => set("productName", "")} className="font-body text-xs text-moss hover:underline">
                        Choose an existing product instead
                      </button>
                    </div>
                  ) : (
                    <select
                      className="ledger-input w-full py-2 text-sm appearance-none"
                      value={form.productName}
                      onChange={(e) => set("productName", e.target.value)}
                    >
                      <option value="" disabled>
                        Select a product
                      </option>
                      <option value="__new__">+ Add a new product</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.name}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              )}

              {needsParty && (
                <Field
                  icon={User}
                  label={
                    (form.category === "credit" ? form.creditType : form.tradeType) === "sale"
                      ? "Customer name"
                      : "Supplier name"
                  }
                  error={errors.party}
                >
                  <input
                    className="ledger-input w-full py-2 text-sm"
                    placeholder="e.g., Chuka's Supermarket"
                    value={form.party}
                    onChange={(e) => set("party", e.target.value)}
                  />
                </Field>
              )}

              {(form.category === "running" || form.category === "small") && (
                <Field icon={User} label="Paid to (optional)" optional>
                  <input
                    className="ledger-input w-full py-2 text-sm"
                    placeholder="e.g., PHCN, vendor, staff name"
                    value={form.party}
                    onChange={(e) => set("party", e.target.value)}
                  />
                </Field>
              )}

              <Field
                icon={FileText}
                label={form.category === "running" || form.category === "small" ? "Description of expense" : "Description"}
                error={errors.description}
                optional={isTrade}
              >
                <input
                  className="ledger-input w-full py-2 text-sm"
                  placeholder={
                    form.category === "running"
                      ? "e.g., Shop rent for August"
                      : form.category === "small"
                      ? "e.g., Transport, tea for staff"
                      : "Any extra note about this transaction"
                  }
                  value={form.description}
                  onChange={(e) => set("description", e.target.value)}
                />
              </Field>

              <div className="grid grid-cols-2 gap-4">
                <Field icon={BadgeDollarSign} label="Amount paid / received" error={errors.amount}>
                  <input
                    type="number"
                    min="0"
                    className="ledger-input w-full py-2 text-sm"
                    placeholder="0.00"
                    value={form.amount}
                    onChange={(e) => set("amount", e.target.value)}
                  />
                </Field>
                {needsQuantity && (
                  <Field icon={Hash} label="Quantity" error={errors.quantity}>
                    <input
                      type="number"
                      min="0"
                      className="ledger-input w-full py-2 text-sm"
                      placeholder="0"
                      value={form.quantity}
                      onChange={(e) => set("quantity", e.target.value)}
                    />
                  </Field>
                )}
              </div>

              {destinationBook && (
                <p className="font-mono text-tiny text-ink/40">
                  This will post to the <span className="text-moss">{destinationBook}</span>
                  {isTrade && form.productName && form.productName !== "__new__" ? " and update inventory" : ""}.
                </p>
              )}

              <button
                type="submit"
                className="w-full flex items-center justify-center gap-2 rounded-lg bg-action text-on-action font-body text-sm font-medium py-3 hover:bg-action-deep transition-colors"
              >
                Save entry
              </button>
            </>
          )}
        </form>
      </div>
    </div>
  );
}

function bookKeyFor(destination) {
  if (destination.startsWith("Cash Book")) return "cashbook";
  if (destination === "Sales Journal") return "salesjournal";
  if (destination === "Purchases Journal") return "purchasesjournal";
  if (destination === "Petty Cash Book") return "pettycash";
  return "cashbook";
}

function ToggleRow({ label, options, value, onChange }) {
  return (
    <div>
      <label className="font-body text-label text-ink-soft mb-2 block">{label}</label>
      <div className="grid grid-cols-2 gap-2.5">
        {options.map((opt) => {
          const Icon = opt.icon;
          const active = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              aria-pressed={active}
              className={`flex items-center justify-center gap-2 rounded-lg border-2 py-2.5 font-body text-sm transition-all ${
                active
                  ? "border-action bg-action text-on-action"
                  : "border-rule bg-surface text-ink/60 hover:border-ink/25"
              }`}
            >
              <Icon size={15} />
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}