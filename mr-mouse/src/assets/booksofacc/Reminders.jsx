// Reminders.jsx
import React, { useState, useMemo, useEffect } from "react";
import { useConsentPrompt } from "../legal/ConsentGate";
import { botFetch } from "../botApi";
import {
  BellRing,
  Users,
  Truck,
  PackageSearch,
  Plus,
  Wallet,
  Landmark,
  CheckCircle2,
  Clock,
  AlertCircle,
  Calendar,
  Trash2,
  Receipt,
  FileText,
} from "lucide-react";
import { useLedger } from "./Ledgercontext";
import { GlobalStyle, TopNav, PageHeader, SummaryCard, EmptyState, Field, Modal, Pill, formatDate, formatMoney, todayISO } from "./ui";

const emptySettle = { name: "", type: "debtor", amount: "", method: "cash" };
const emptyOrder = { partyName: "", productName: "", quantity: "", type: "sale", expectedBy: "", note: "" };
const emptyDeadline = { title: "", type: "bill", partyName: "", amount: "", dueDate: todayISO(), note: "" };

function getDaysDiff(dueDate) {
  if (!dueDate) return 0;
  const today = new Date(todayISO() + "T00:00:00");
  const due = new Date(dueDate + "T00:00:00");
  const diffTime = due - today;
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

export default function Reminders({ onNavigate }) {
  const {
    business,
    debtors,
    creditors,
    pendingOrders,
    deadlines,
    addSettlement,
    addPendingOrder,
    fulfillPendingOrder,
    addDeadline,
    completeDeadline,
    deleteDeadline,
  } = useLedger();

  const [settleTarget, setSettleTarget] = useState(null);
  const [settleForm, setSettleForm] = useState(emptySettle);
  const [settleErrors, setSettleErrors] = useState({});

  const [showOrderModal, setShowOrderModal] = useState(false);
  const [orderForm, setOrderForm] = useState(emptyOrder);
  const [orderErrors, setOrderErrors] = useState({});

  const [showDeadlineModal, setShowDeadlineModal] = useState(false);
  const [deadlineForm, setDeadlineForm] = useState(emptyDeadline);
  const [deadlineErrors, setDeadlineErrors] = useState({});
  const [notificationsettings, setNotificationsettings] = useState({
    telegramEnabled: true,
    whatsappEnabled: false,
    notificationWaNumber: "",
    remind3Days: true,
    remind1Day: true,
    remindDue: true,
    remindOverdue: true,
    timezone: "Africa/Lagos",
    reminderHour: 8,
    reminderMinute: 0,
  });
  const [notificationSaving, setNotificationSaving] = useState(false);
  const [notificationError, setNotificationError] = useState(null);

  const totalDebtors = debtors.reduce((s, d) => s + d.balance, 0);
  const totalCreditors = creditors.reduce((s, c) => s + c.balance, 0);
  const openOrders = pendingOrders.filter((o) => o.status === "pending");

  /* ---------- Unified Needs Attention List ---------- */
  const attentionItems = useMemo(() => {
    const today = todayISO();
    const list = [];

    // 1. Explicit active deadlines
    (deadlines || [])
      .filter((d) => d.status !== "completed")
      .forEach((d) => {
        const diff = getDaysDiff(d.dueDate);
        list.push({
          id: d.id,
          type: "deadline",
          category: d.type,
          title: d.title || `${d.type === "bill" ? "Bill due" : d.type === "debtor" ? "Collection due" : "Payment due"}`,
          partyName: d.partyName || "",
          amount: d.amount ? Number(d.amount) : null,
          dueDate: d.dueDate,
          diff,
          isOverdue: d.dueDate < today,
          isToday: d.dueDate === today,
          note: d.note || "",
          raw: d,
        });
      });

    // 2. Pending orders with an expectedBy date
    openOrders
      .filter((o) => Boolean(o.expectedBy))
      .forEach((o) => {
        const diff = getDaysDiff(o.expectedBy);
        list.push({
          id: o.id,
          type: "order",
          category: o.type,
          title: `${o.quantity} × ${o.productName}`,
          partyName: o.partyName,
          amount: null,
          dueDate: o.expectedBy,
          diff,
          isOverdue: o.expectedBy < today,
          isToday: o.expectedBy === today,
          note: o.type === "sale" ? "Order supply promised to customer" : "Order delivery expected from supplier",
          raw: o,
        });
      });

    // Sort by urgency: overdue first, then today, then upcoming date ascending
    return list.sort((a, b) => {
      if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
      return a.title.localeCompare(b.title);
    });
  }, [deadlines, openOrders]);

  const urgentCount = attentionItems.filter((i) => i.isOverdue || i.isToday).length;

  const openSettle = (entry, type) => {
    setSettleTarget({ ...entry, type });
    setSettleForm({ name: entry.name, type, amount: "", method: "cash" });
    setSettleErrors({});
  };

  const openNewDeadline = (preset = {}) => {
    setDeadlineForm({ ...emptyDeadline, ...preset, dueDate: todayISO() });
    setDeadlineErrors({});
    setShowDeadlineModal(true);
  };

  const submitSettle = (e) => {
    e.preventDefault();
    const amt = Number(settleForm.amount);
    const errs = {};
    if (settleForm.amount === "" || isNaN(amt) || amt <= 0) errs.amount = "Enter a valid amount";
    else if (amt > settleTarget.balance + 0.01) errs.amount = `Only ${formatMoney(settleTarget.balance)} outstanding`;
    setSettleErrors(errs);
    if (Object.keys(errs).length) return;

    addSettlement({ party: settleTarget.name, type: settleTarget.type, amount: amt, method: settleForm.method });
    setSettleTarget(null);
  };

  const submitOrder = (e) => {
    e.preventDefault();
    const errs = {};
    if (!orderForm.partyName.trim()) errs.partyName = "Enter a name";
    if (!orderForm.productName.trim()) errs.productName = "Enter a product";
    const qty = Number(orderForm.quantity);
    if (orderForm.quantity === "" || isNaN(qty) || qty <= 0) errs.quantity = "Enter a valid quantity";
    setOrderErrors(errs);
    if (Object.keys(errs).length) return;

    addPendingOrder({ ...orderForm, quantity: qty });
    setShowOrderModal(false);
    setOrderForm(emptyOrder);
  };


  useEffect(() => {
    if (!business?.id) return;

    let cancelled = false;

    (async () => {
      try {
        const res = await botFetch(`/api/notifications/settings?companyId=${encodeURIComponent(business.id)}`);

        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);

        if (!cancelled) {
          setNotificationsettings({
            telegramEnabled: data.telegramEnabled ?? true,
            whatsappEnabled: data.whatsappEnabled ?? false,
            notificationWaNumber: data.notificationWaNumber || "",
            remind3Days: data.remind3Days ?? true,
            remind1Day: data.remind1Day ?? true,
            remindDue: data.remindDue ?? true,
            remindOverdue: data.remindOverdue ?? true,
            timezone: data.timezone || "Africa/Lagos",
            reminderHour: Number(data.reminderHour ?? 8),
            reminderMinute: Number(data.reminderMinute ?? 0),
          });
        }
      } catch (err) {
        if (!cancelled) setNotificationError(err.message || "Could not load notification settings.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [business?.id]);

  const telegramConsent = useConsentPrompt("telegram");

  const saveNotificationsettings = async (patch) => {
    if (!business?.id) return;

    const next = { ...notificationsettings, ...patch };
    setNotificationsettings(next);
    setNotificationSaving(true);
    setNotificationError(null);

    try {
      const res = await botFetch("/api/notifications/settings", {
        method: "POST",
        body: JSON.stringify({
          companyId: business.id,
          ...next,
          notificationWaNumber: String(next.notificationWaNumber || "").replace(/\D/g, "") || null,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);

      setNotificationsettings((s) => ({
        ...s,
        ...data,
        notificationWaNumber: data.notificationWaNumber || "",
      }));
    } catch (err) {
      setNotificationError(err.message || "Could not save notification settings.");
    } finally {
      setNotificationSaving(false);
    }
  };

  const submitDeadline = (e) => {
    e.preventDefault();
    const errs = {};
    if (!deadlineForm.title.trim() && !deadlineForm.partyName.trim()) {
      errs.title = "Enter a title or party name";
    }
    if (!deadlineForm.dueDate) errs.dueDate = "Select a due date";
    setDeadlineErrors(errs);
    if (Object.keys(errs).length) return;

    addDeadline({
      ...deadlineForm,
      amount: deadlineForm.amount ? Number(deadlineForm.amount) : 0,
      title: deadlineForm.title.trim() || `${deadlineForm.type === "bill" ? "Bill" : deadlineForm.partyName}`,
    });
    setShowDeadlineModal(false);
    setDeadlineForm(emptyDeadline);
  };

  return (
    <div className="min-h-screen w-full bg-paper font-body pb-24">
      <GlobalStyle />
      {telegramConsent.prompt}
      <TopNav business={business} current="reminders" onNavigate={onNavigate} />
      <PageHeader
        business={business}
        icon={BellRing}
        title="Reminders & Deadlines"
        subtitle="Track payment deadlines, rent/bills due, pending order fulfillment, and outstanding balances."
      />

      <div className="max-w-5xl mx-auto px-5 sm:px-8 pt-8 relative space-y-10">
        {/* Metric Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          <SummaryCard label="Needs attention" value={urgentCount} warn={urgentCount > 0} />
          <SummaryCard label="Owed to you" value={formatMoney(totalDebtors)} accent />
          <SummaryCard label="You owe" value={formatMoney(totalCreditors)} warn={totalCreditors > 0} />
          <SummaryCard label="Pending orders" value={openOrders.length} />
        </div>


        <Section
          icon={BellRing}
          title="Reminder delivery"
          subtitle="Choose where automatic deadline reminders should be sent."
        >
          <div className="rounded-lg border border-rule bg-surface p-5 space-y-5">
            <div className="grid grid-cols-1 gap-3">
              <label className="flex items-center justify-between gap-4 rounded-lg border border-ink/10 px-4 py-3">
                <span>
                  <span className="block font-body text-sm text-ink">Telegram</span>
                  <span className="block font-body text-tiny text-ink/45">Send to your linked Telegram chat</span>
                </span>
                <input
                  type="checkbox"
                  checked={notificationsettings.telegramEnabled}
                  onChange={(e) => {
                    const on = e.target.checked;
                    // Switching reminders ON sends them through Telegram: ask first.
                    if (on) telegramConsent.ensure(() => saveNotificationsettings({ telegramEnabled: true }));
                    else saveNotificationsettings({ telegramEnabled: false });
                  }}
                />
              </label>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {[
                ["remind3Days", "3 days before"],
                ["remind1Day", "1 day before"],
                ["remindDue", "Due date"],
                ["remindOverdue", "Overdue"],
              ].map(([key, label]) => (
                <label
                  key={key}
                  className="flex items-center gap-2 rounded-lg border border-ink/10 px-3 py-2.5 font-body text-xs text-ink/70"
                >
                  <input
                    type="checkbox"
                    checked={Boolean(notificationsettings[key])}
                    onChange={(e) => saveNotificationsettings({ [key]: e.target.checked })}
                  />
                  {label}
                </label>
              ))}
            </div>

            {notificationSaving && (
              <p className="font-body text-tiny text-ink/45">Saving reminder settings…</p>
            )}
            {notificationError && (
              <p className="font-body text-xs text-clay">{notificationError}</p>
            )}
          </div>
        </Section>

        {/* Urgent Needs Attention Section */}
        <Section
          icon={AlertCircle}
          title="Needs attention"
          subtitle="Time-sensitive payment due dates, expiring pending orders, and scheduled bills."
          action={
            <button
              onClick={() => openNewDeadline()}
              className="flex items-center gap-1.5 rounded-lg bg-action text-on-action font-body text-xs font-medium px-3.5 py-2 hover:bg-action-deep transition-colors"
            >
              <Plus size={14} /> Add deadline
            </button>
          }
        >
          {attentionItems.length === 0 ? (
            <EmptyState
              title="All caught up!"
              subtitle="No urgent deadlines or order dates requiring attention right now."
            />
          ) : (
            <ListCard>
              {attentionItems.map((item) => (
                <div key={`${item.type}-${item.id}`} className="flex items-center justify-between gap-4 px-5 py-4">
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <p className="font-body text-sm font-medium text-ink truncate">{item.title}</p>
                      {item.isOverdue && (
                        <Pill tone="rust">
                          {Math.abs(item.diff)} {Math.abs(item.diff) === 1 ? "day" : "days"} overdue
                        </Pill>
                      )}
                      {item.isToday && <Pill tone="amber">Due today</Pill>}
                      {!item.isOverdue && !item.isToday && (
                        <Pill tone="neutral">Due in {item.diff} {item.diff === 1 ? "day" : "days"}</Pill>
                      )}
                    </div>
                    <p className="font-mono text-tiny text-ink/50">
                      {item.partyName ? `${item.partyName} · ` : ""}
                      {item.amount ? `${formatMoney(item.amount)} · ` : ""}
                      Due date: {formatDate(item.dueDate)}
                      {item.note ? ` (${item.note})` : ""}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {item.type === "deadline" ? (
                      <>
                        <button
                          onClick={() => completeDeadline(item.id)}
                          className="flex items-center gap-1.5 rounded-full border border-moss bg-moss/10 px-3 py-1.5 font-body text-xs text-moss hover:bg-action-deep hover:text-on-action transition-colors"
                        >
                          <CheckCircle2 size={13} /> Resolve
                        </button>
                        <button
                          onClick={() => deleteDeadline(item.id)}
                          className="text-ink/30 hover:text-clay p-1.5 transition-colors"
                          title="Delete deadline"
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => fulfillPendingOrder(item.id)}
                        className="flex items-center gap-1.5 rounded-full border border-ink/15 px-3 py-1.5 font-body text-xs text-ink hover:border-action hover:text-moss transition-colors"
                      >
                        <Clock size={13} /> Mark supplied
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </ListCard>
          )}
        </Section>

        {/* Debtors */}
        <Section icon={Users} title="Debtors" subtitle="Customers who bought on credit and still owe you.">
          {debtors.length === 0 ? (
            <EmptyState title="No outstanding debtors" subtitle="Credit sales that haven't been paid off will show up here." />
          ) : (
            <ListCard>
              {debtors.map((d) => {
                const partyDeadline = (deadlines || []).find(
                  (dl) => dl.status !== "completed" && dl.partyName?.toLowerCase() === d.name.toLowerCase()
                );
                return (
                  <PersonRow
                    key={d.name}
                    name={d.name}
                    amount={d.balance}
                    lastDate={d.lastDate}
                    tone="green"
                    deadline={partyDeadline}
                    onSettle={() => openSettle(d, "debtor")}
                    onSetDeadline={() => openNewDeadline({ type: "debtor", partyName: d.name, amount: d.balance })}
                    settleLabel="Record payment"
                  />
                );
              })}
            </ListCard>
          )}
        </Section>

        {/* Creditors */}
        <Section icon={Truck} title="Creditors" subtitle="Suppliers you bought on credit from and still owe.">
          {creditors.length === 0 ? (
            <EmptyState title="No outstanding creditors" subtitle="Credit purchases that haven't been paid off will show up here." />
          ) : (
            <ListCard>
              {creditors.map((c) => {
                const partyDeadline = (deadlines || []).find(
                  (dl) => dl.status !== "completed" && dl.partyName?.toLowerCase() === c.name.toLowerCase()
                );
                return (
                  <PersonRow
                    key={c.name}
                    name={c.name}
                    amount={c.balance}
                    lastDate={c.lastDate}
                    tone="rust"
                    deadline={partyDeadline}
                    onSettle={() => openSettle(c, "creditor")}
                    onSetDeadline={() => openNewDeadline({ type: "creditor", partyName: c.name, amount: c.balance })}
                    settleLabel="Record payment"
                  />
                );
              })}
            </ListCard>
          )}
        </Section>

        {/* Pending orders */}
        <Section
          icon={PackageSearch}
          title="Pending orders"
          subtitle="Goods ordered or promised, but not yet supplied."
          action={
            <button
              onClick={() => setShowOrderModal(true)}
              className="flex items-center gap-1.5 rounded-lg bg-action text-on-action font-body text-xs font-medium px-3.5 py-2 hover:bg-action-deep transition-colors"
            >
              <Plus size={14} /> New order
            </button>
          }
        >
          {pendingOrders.length === 0 ? (
            <EmptyState title="No orders tracked yet" subtitle="Log goods that are owed to a customer or expected from a supplier." />
          ) : (
            <ListCard>
              {pendingOrders.map((o) => (
                <div key={o.id} className="flex items-center justify-between gap-4 px-5 py-4">
                  <div className="min-w-0">
                    <p className="font-body text-sm text-ink truncate">
                      {o.quantity} × {o.productName} — {o.partyName}
                    </p>
                    <p className="font-mono text-tiny text-ink/40 mt-0.5">
                      {formatDate(o.date)} · {o.type === "sale" ? "Owed to customer" : "Expected from supplier"}
                      {o.expectedBy ? ` · Expected: ${formatDate(o.expectedBy)}` : ""}
                      {o.note ? ` · ${o.note}` : ""}
                    </p>
                  </div>
                  {o.status === "fulfilled" ? (
                    <Pill tone="green">
                      <CheckCircle2 size={11} /> Supplied
                    </Pill>
                  ) : (
                    <button
                      onClick={() => fulfillPendingOrder(o.id)}
                      className="flex items-center gap-1.5 rounded-full border border-ink/15 px-3 py-1.5 font-body text-xs text-ink hover:border-action hover:text-moss transition-colors shrink-0"
                    >
                      <Clock size={12} /> Mark supplied
                    </button>
                  )}
                </div>
              ))}
            </ListCard>
          )}
        </Section>
      </div>

      {/* Settle modal */}
      {settleTarget && (
        <Modal
          title={`Record payment — ${settleTarget.name}`}
          icon={settleTarget.type === "debtor" ? Users : Truck}
          onClose={() => setSettleTarget(null)}
        >
          <p className="font-body text-sm text-ink/55 mb-5">
            {settleTarget.type === "debtor" ? "Money received from" : "Money paid to"} {settleTarget.name}. Outstanding: {formatMoney(settleTarget.balance)}.
          </p>
          <form onSubmit={submitSettle} noValidate className="space-y-5">
            <Field icon={Wallet} label="Amount">
              <input
                type="number"
                min="0"
                className="ledger-input w-full py-2 text-sm"
                placeholder="0.00"
                value={settleForm.amount}
                onChange={(e) => setSettleForm((f) => ({ ...f, amount: e.target.value }))}
              />
              {settleErrors.amount && <p className="font-body text-xs text-clay mt-1">{settleErrors.amount}</p>}
            </Field>
            <div>
              <label className="font-body text-label text-ink-soft mb-2 block">Via</label>
              <div className="grid grid-cols-2 gap-2.5">
                {[
                  { value: "cash", label: "Cash", icon: Wallet },
                  { value: "bank", label: "Bank", icon: Landmark },
                ].map((opt) => {
                  const Icon = opt.icon;
                  const active = settleForm.method === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setSettleForm((f) => ({ ...f, method: opt.value }))}
                      className={`flex items-center justify-center gap-2 rounded-lg border-2 py-2.5 font-body text-sm transition-all ${
                        active ? "border-action bg-action text-on-action" : "border-rule bg-surface text-ink/60"
                      }`}
                    >
                      <Icon size={15} /> {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <button
              type="submit"
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-action text-on-action font-body text-sm font-medium py-3 hover:bg-action-deep transition-colors"
            >
              Save payment
            </button>
          </form>
        </Modal>
      )}

      {/* New Pending Order Modal */}
      {showOrderModal && (
        <Modal title="New pending order" icon={PackageSearch} onClose={() => setShowOrderModal(false)}>
          <form onSubmit={submitOrder} noValidate className="space-y-5">
            <div>
              <label className="font-body text-label text-ink-soft mb-2 block">Type</label>
              <div className="grid grid-cols-2 gap-2.5">
                {[
                  { value: "sale", label: "Owed to customer" },
                  { value: "purchase", label: "Expected from supplier" },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setOrderForm((f) => ({ ...f, type: opt.value }))}
                    className={`rounded-lg border-2 py-2.5 font-body text-sm transition-all ${
                      orderForm.type === opt.value ? "border-action bg-action text-on-action" : "border-rule bg-surface text-ink/60"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <Field icon={Users} label={orderForm.type === "sale" ? "Customer name" : "Supplier name"} error={orderErrors.partyName}>
              <input
                className="ledger-input w-full py-2 text-sm"
                value={orderForm.partyName}
                onChange={(e) => setOrderForm((f) => ({ ...f, partyName: e.target.value }))}
              />
            </Field>
            <Field icon={PackageSearch} label="Product" error={orderErrors.productName}>
              <input
                className="ledger-input w-full py-2 text-sm"
                value={orderForm.productName}
                onChange={(e) => setOrderForm((f) => ({ ...f, productName: e.target.value }))}
              />
            </Field>
            <Field icon={PackageSearch} label="Quantity" error={orderErrors.quantity}>
              <input
                type="number"
                min="0"
                className="ledger-input w-full py-2 text-sm"
                value={orderForm.quantity}
                onChange={(e) => setOrderForm((f) => ({ ...f, quantity: e.target.value }))}
              />
            </Field>
            <Field icon={Calendar} label="Expected date / Deadline" optional>
              <input
                type="date"
                className="ledger-input w-full py-2 text-sm"
                value={orderForm.expectedBy}
                onChange={(e) => setOrderForm((f) => ({ ...f, expectedBy: e.target.value }))}
              />
            </Field>
            <Field icon={FileText} label="Note" optional>
              <input
                className="ledger-input w-full py-2 text-sm"
                value={orderForm.note}
                onChange={(e) => setOrderForm((f) => ({ ...f, note: e.target.value }))}
              />
            </Field>
            <button
              type="submit"
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-action text-on-action font-body text-sm font-medium py-3 hover:bg-action-deep transition-colors"
            >
              Save order
            </button>
          </form>
        </Modal>
      )}

      {/* New Deadline Modal */}
      {showDeadlineModal && (
        <Modal title="Add deadline / alert" icon={Calendar} onClose={() => setShowDeadlineModal(false)}>
          <form onSubmit={submitDeadline} noValidate className="space-y-5">
            <div>
              <label className="font-body text-label text-ink-soft mb-2 block">Category</label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { value: "bill", label: "Bill / Rent" },
                  { value: "debtor", label: "Debtor due" },
                  { value: "creditor", label: "Creditor due" },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setDeadlineForm((f) => ({ ...f, type: opt.value }))}
                    className={`rounded-lg border-2 py-2 text-xs font-body transition-all ${
                      deadlineForm.type === opt.value ? "border-action bg-action text-on-action" : "border-rule bg-surface text-ink/60"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <Field icon={Receipt} label="Title / Description" error={deadlineErrors.title}>
              <input
                className="ledger-input w-full py-2 text-sm"
                placeholder="e.g. Shop Rent, Electricity Bill, Customer payment"
                value={deadlineForm.title}
                onChange={(e) => setDeadlineForm((f) => ({ ...f, title: e.target.value }))}
              />
            </Field>

            <Field icon={Users} label="Party name" optional>
              <input
                className="ledger-input w-full py-2 text-sm"
                placeholder="Person or company name"
                value={deadlineForm.partyName}
                onChange={(e) => setDeadlineForm((f) => ({ ...f, partyName: e.target.value }))}
              />
            </Field>

            <Field icon={Wallet} label="Amount due" optional>
              <input
                type="number"
                min="0"
                className="ledger-input w-full py-2 text-sm"
                placeholder="0.00"
                value={deadlineForm.amount}
                onChange={(e) => setDeadlineForm((f) => ({ ...f, amount: e.target.value }))}
              />
            </Field>

            <Field icon={Calendar} label="Due date" error={deadlineErrors.dueDate}>
              <input
                type="date"
                className="ledger-input w-full py-2 text-sm"
                value={deadlineForm.dueDate}
                onChange={(e) => setDeadlineForm((f) => ({ ...f, dueDate: e.target.value }))}
              />
            </Field>

            <Field icon={FileText} label="Note" optional>
              <input
                className="ledger-input w-full py-2 text-sm"
                placeholder="Additional details..."
                value={deadlineForm.note}
                onChange={(e) => setDeadlineForm((f) => ({ ...f, note: e.target.value }))}
              />
            </Field>

            <button
              type="submit"
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-action text-on-action font-body text-sm font-medium py-3 hover:bg-action-deep transition-colors"
            >
              Save deadline
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}

function Section({ icon: Icon, title, subtitle, action, children }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-4 mb-3">
        <div className="flex items-center gap-2">
          <Icon size={16} className="text-moss" />
          <div>
            <h2 className="font-display text-lg text-ink">{title}</h2>
            <p className="font-body text-xs text-ink/45">{subtitle}</p>
          </div>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function ListCard({ children }) {
  return <div className="rounded-lg border border-rule bg-surface overflow-hidden divide-y divide-rule">{children}</div>;
}

function PersonRow({ name, amount, lastDate, tone, deadline, onSettle, onSetDeadline, settleLabel }) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-body text-sm text-ink truncate">{name}</p>
          {deadline && (
            <Pill tone="amber">
              Due {formatDate(deadline.dueDate)}
            </Pill>
          )}
        </div>
        <p className="font-mono text-tiny text-ink/40 mt-0.5">Last activity {formatDate(lastDate)}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className={`font-mono text-sm mr-1 ${tone === "green" ? "text-moss" : "text-clay"}`}>{formatMoney(amount)}</span>
        {!deadline && (
          <button
            onClick={onSetDeadline}
            className="rounded-full border border-ink/15 px-2.5 py-1 font-body text-xs text-ink/70 hover:border-ink transition-colors"
          >
            Set due date
          </button>
        )}
        <button
          onClick={onSettle}
          className="rounded-full border border-ink/15 px-3 py-1.5 font-body text-xs text-ink hover:border-action hover:text-moss transition-colors"
        >
          {settleLabel}
        </button>
      </div>
    </div>
  );
}