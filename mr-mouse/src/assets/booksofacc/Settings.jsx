import React, { useMemo, useState, useEffect } from "react";
import {
  Settings as settingsIcon,
  ArrowLeft,
  Smartphone,
  Users,
  Building,
  Trash2,
  ShieldAlert,
  Laptop,
  Clock,
  CreditCard,
  Send,
  Sparkles,
  CheckCircle2,
} from "lucide-react";
import { useLedger } from "./Ledgercontext";
import { useDevices } from "../useDevices";
import { ADD_ONS, PLAN_TIERS, companyPriceNaira } from "../planTiers";
import { useSubscription, computeAccessState } from "../useSubscription";
import ConnectTelegram from "../components/ConnectTelegram";
import ConnectWhatsApp from "../components/ConnectWhatsApp";
import PrivacySettings from "../legal/PrivacySettings";
import PasswordSettings from "../account/PasswordSettings";
import {
  GlobalStyle,
  TopNav,
  PageHeader,
  Field,
  Modal,
  SummaryCard,
  EmptyState,
  formatDate,
} from "./ui";

const CAN_MANAGE_ROLES = ["owner", "admin"];
const COMPLAINT_EMAIL = "nuchukwuma03@gmail.com";

const naira = (n) =>
  new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  }).format(Number(n || 0));

export default function Settings({ onNavigate }) {
  const { business, currentUser } = useLedger();
  const { subscription, refresh } = useSubscription(business?.id);
  const blocked = computeAccessState(subscription) === "blocked";
  const [tab, setTab] = useState("plan");
  const canManage = CAN_MANAGE_ROLES.includes(currentUser?.role);

  // Trigger immediate refresh if returning from Paystack checkout redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("reference") || params.get("trxref")) {
      refresh();
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [refresh]);

  // Default to plan tab when account is blocked
  useEffect(() => {
    if (blocked) setTab("plan");
  }, [blocked]);

  if (!canManage) {
    return (
      <div className="min-h-screen w-full bg-paper font-body pb-24">
        <GlobalStyle />
        <TopNav business={business} current="settings" onNavigate={onNavigate} />
        <PageHeader business={business} icon={settingsIcon} title="settings" subtitle="Plan, billing, devices and connected channels." />
        <div className="max-w-3xl mx-auto px-5 sm:px-8 pt-8 relative">
          <button onClick={() => onNavigate("dashboard")} className="flex items-center gap-1.5 font-body text-sm text-ink-soft hover:text-ink mb-6">
            <ArrowLeft size={14} /> Back
          </button>
          <EmptyState title="Owner or admin access only" subtitle="Ask an account owner or admin to manage billing, devices, or channels." />
          {/* Everyone manages their own password and consents. */}
          <div className="space-y-5 mt-8">
            <PasswordSettings user={currentUser} />
            <PrivacySettings />
          </div>
          <p className="mt-5 text-center text-xs text-ink/50">
            Billing complaints: <a className="underline" href={`mailto:${COMPLAINT_EMAIL}`}>{COMPLAINT_EMAIL}</a>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-paper font-body pb-24">
      <GlobalStyle />
      <TopNav business={business} current="settings" onNavigate={onNavigate} />
      <PageHeader
        business={business}
        icon={settingsIcon}
        title="settings"
        subtitle="Manage your subscription, devices, offline access, and connected channels."
      />

      <div className="max-w-3xl mx-auto px-5 sm:px-8 pt-8 relative">
        <button onClick={() => onNavigate("dashboard")} className="flex items-center gap-1.5 font-body text-sm text-ink-soft hover:text-ink mb-6">
          <ArrowLeft size={14} /> Back
        </button>

        {blocked && (
          <div className="rounded-xl border border-clay/25 bg-clay/8 px-5 py-4 mb-6 flex items-start gap-3">
            <ShieldAlert size={18} className="text-clay shrink-0 mt-0.5" />
            <div>
              <p className="font-body text-sm font-medium text-ink">
                Access is paused — your trial and grace period have ended.
              </p>
              <p className="font-body text-xs text-ink/60 mt-1">
                Your records are safe and untouched. Subscribe below to restore full access —
                it unlocks automatically the moment payment is confirmed.
              </p>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-1.5 mb-6">
          {[
            ["plan", "Plan & Billing"],
            ["ai", "AI Assistant"],
            ["devices", "Devices"],
            ["connect", "Connect"],
            ["account", "Your account"],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`rounded-full px-4 py-2 font-body text-sm font-medium transition-colors ${
                tab === key ? "bg-action text-white" : "bg-white border border-rule text-ink/60"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "plan" ? (
          <PlanTab companyId={business?.id} currentUser={currentUser} />
        ) : tab === "ai" ? (
          <AiTab companyId={business?.id} />
        ) : tab === "devices" ? (
          <DevicesTab businessId={business?.id} />
        ) : tab === "account" ? (
          <div className="space-y-5">
            <PasswordSettings user={currentUser} />
            <PrivacySettings />
          </div>
        ) : (
          <div className="space-y-5">
            <ConnectTelegram />
            <ConnectWhatsApp />
            <SupportCard />
          </div>
        )}
      </div>
    </div>
  );
}

function PlanTab({ companyId }) {
  const { subscription, loading, error, refresh, startCheckout, purchaseAddOn, checkPendingPayment } = useSubscription(companyId);
  const [seats, setSeats] = useState(subscription?.seats || 5);
  const [busy, setBusy] = useState(null);

  const currentTier = subscription?.planTier || "solo";
  const trial = subscription?.status === "trialing";
  const active = subscription?.status === "active";
  const trialText = trial && subscription?.trialEndsAt
    ? `Free trial ends ${formatDate(subscription.trialEndsAt.slice(0, 10))}`
    : null;

  const companyTotal = useMemo(() => companyPriceNaira(seats), [seats]);

  async function checkout(plan, selectedSeats = 1) {
    try {
      setBusy(plan);
      await startCheckout(plan, selectedSeats, []);
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function addOnCheckout(key) {
    try {
      setBusy(key);
      await purchaseAddOn(key);
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <SummaryCard label="Status" value={trial ? "Free trial" : active ? "Active" : "Not subscribed"} accent />
        <SummaryCard label="Plan" value={PLAN_TIERS[currentTier]?.label || "Individual"} />
      </div>

      {trialText && (
        <div className="rounded-xl border border-moss/20 bg-paper-sunk p-4 text-sm text-ink">
          <div className="font-medium">Everything is unlocked during your first month.</div>
          <div className="text-xs text-ink/55 mt-1">{trialText}</div>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-clay/20 bg-clay/5 p-4 text-xs text-clay">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-center py-10 text-sm text-ink/45">Loading billing…</p>
      ) : (
        <>
          <div className="rounded-lg border border-rule bg-white p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <p className="font-body text-[13px] text-ink-soft">Subscription plans</p>
                <h2 className="font-display text-lg text-ink mt-1">Choose what fits your business</h2>
              </div>
              <CreditCard size={19} className="text-moss" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <BillingCard
                icon={Smartphone}
                name="Individual"
                price={`${naira(1000)}/month`}
                detail="1 user"
                active={currentTier === "solo" && active}
                button="Subscribe"
                busy={busy === "solo"}
                onClick={() => checkout("solo", 1)}
              />
              <BillingCard
                icon={Users}
                name="Duo"
                price={`${naira(2000)}/month`}
                detail="2 users"
                active={currentTier === "duo" && active}
                button="Subscribe"
                busy={busy === "duo"}
                onClick={() => checkout("duo", 2)}
              />
              <BillingCard
                icon={Building}
                name="Company"
                price={`${naira(850)}/user/month`}
                detail="Minimum 5 users"
                active={currentTier === "company" && active}
                button="Subscribe"
                busy={busy === "company"}
                onClick={() => checkout("company", Math.max(5, Number(seats) || 5))}
              />
            </div>

            <div className="mt-5 max-w-xs">
              <Field icon={Users} label="Company users">
                <input
                  type="number"
                  min="5"
                  className="ledger-input w-full py-2 text-sm"
                  value={seats}
                  onChange={(e) => setSeats(Math.max(5, Number(e.target.value) || 5))}
                />
              </Field>
              <p className="font-mono text-[10px] text-ink/40 mt-1">
                {naira(companyTotal)}/month for {seats} users.
              </p>
            </div>

            {active && subscription?.currentPeriodEnd && (
              <p className="mt-5 text-xs text-ink/50">
                Current paid period ends {formatDate(subscription.currentPeriodEnd.slice(0, 10))}.
              </p>
            )}

            <button
              onClick={async () => { await checkPendingPayment(); await refresh(); }}
              className="mt-4 text-xs underline text-ink/55"
            >
              Refresh billing status
            </button>
          </div>

          <div className="rounded-lg border border-rule bg-white p-5 sm:p-6">
            <p className="font-body text-[13px] text-ink-soft mb-3">Optional monthly add-ons</p>
            <div className="space-y-3">
              <AddOnRow
                icon={Send}
                label="Telegram"
                description="Automated Telegram notifications, reminders and statements."
                price={`${naira(ADD_ONS.telegram.priceNaira)}/month`}
                active={subscription?.addOns?.telegram}
                disabled={busy === "telegram"}
                onClick={() => addOnCheckout("telegram")}
              />
              <AddOnRow
                icon={Sparkles}
                label="Premium AI (Claude)"
                description="Higher-capacity Claude AI for larger workloads and more consistent availability."
                price={`${naira(ADD_ONS.ai.priceNaira)}/month`}
                active={subscription?.addOns?.ai}
                disabled={busy === "ai"}
                onClick={() => addOnCheckout("ai")}
              />
            </div>

            {trial && (
              <p className="mt-4 text-xs text-moss">
                Telegram is available without charge during the one-month trial. Free Gemini AI is
                available separately; Premium AI (Claude) is optional.
              </p>
            )}
          </div>
        </>
      )}

      <SupportCard />
    </div>
  );
}

function AiTab({ companyId }) {
  const { subscription, purchaseAddOn } = useSubscription(companyId);
  const [busy, setBusy] = useState(false);

  const premiumActive = Boolean(subscription?.addOns?.ai);

  async function subscribe() {
    try {
      setBusy(true);
      await purchaseAddOn("ai");
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-rule bg-white p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-paper-sunk p-2.5 shrink-0">
            <Sparkles size={18} className="text-moss" />
          </div>
          <div className="flex-1">
            <div className="font-display text-lg text-ink">AI Assistant</div>
            <p className="font-body text-sm text-ink/60 mt-1">
              Talk to your books instead of navigating through forms. Both AI modes use the same
              bookkeeping tools and the same confirmation-before-saving workflow.
            </p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className={`rounded-xl border-2 p-4 ${!premiumActive ? "border-moss bg-paper-sunk" : "border-ink/10 bg-white"}`}>
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="font-display text-base text-ink">Free AI — Gemini</div>
                <div className="text-xs text-ink/45 mt-1">Included at no extra charge</div>
              </div>
              {!premiumActive && (
                <span className="rounded-full bg-moss text-white px-2.5 py-1 font-body text-[12px] font-medium">
                  Active
                </span>
              )}
            </div>

            <div className="mt-4 space-y-2.5">
              {[
                ["Same bookkeeping actions", "Record sales, purchases, expenses, settlements and pending orders with confirmation."],
                ["Same live lookups", "Ask about stock, balances, debtors, creditors, deadlines and party accounts."],
                ["Free-tier limits", "The app defaults to 20 free AI prompts/day, plus shared provider rate limits that can interrupt usage."],
                ["Large database limits", "Database-heavy list results are capped for free requests, so very large lists may be partial."],
              ].map(([title, desc]) => (
                <div key={title} className="flex gap-2.5">
                  <CheckCircle2 size={15} className="text-moss shrink-0 mt-0.5" />
                  <div>
                    <div className="font-body text-sm font-medium text-ink">{title}</div>
                    <div className="font-body text-xs text-ink/50 mt-0.5">{desc}</div>
                  </div>
                </div>
              ))}
            </div>

            <p className="font-body text-xs text-ink/50 mt-4">
              Free Gemini is designed for normal day-to-day bookkeeping. A busy period or a
              large/bulk database request may need to be retried later.
            </p>
          </div>

          <div className={`rounded-xl border-2 p-4 ${premiumActive ? "border-action bg-action text-white" : "border-ink/10 bg-white"}`}>
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className={`font-display text-base ${premiumActive ? "text-white" : "text-ink"}`}>Premium AI — Claude</div>
                <div className={`text-xs mt-1 ${premiumActive ? "text-white/60" : "text-ink/45"}`}>₦1,000/month</div>
              </div>
              {premiumActive && (
                <span className="rounded-full bg-white/15 text-white px-2.5 py-1 font-body text-[12px] font-medium">
                  Active
                </span>
              )}
            </div>

            <div className="mt-4 space-y-2.5">
              {[
                ["Higher availability", "Less likely to be interrupted by free-tier request limits."],
                ["Better for heavier workloads", "Prefer this when you regularly query or work with larger business datasets."],
                ["Fewer free-tier restrictions", "Premium AI uses Claude instead of the shared free Gemini allowance."],
                ["Same accounting workflow", "The same tools, same data and same confirmation safeguards are used."],
              ].map(([title, desc]) => (
                <div key={title} className="flex gap-2.5">
                  <CheckCircle2 size={15} className={premiumActive ? "text-white shrink-0 mt-0.5" : "text-moss shrink-0 mt-0.5"} />
                  <div>
                    <div className={`font-body text-sm font-medium ${premiumActive ? "text-white" : "text-ink"}`}>{title}</div>
                    <div className={`font-body text-xs mt-0.5 ${premiumActive ? "text-white/55" : "text-ink/50"}`}>{desc}</div>
                  </div>
                </div>
              ))}
            </div>

            {!premiumActive && (
              <button
                onClick={subscribe}
                disabled={busy}
                className="mt-5 w-full rounded-lg bg-action text-white font-body text-sm font-medium px-5 py-2.5 hover:bg-action-deep disabled:opacity-50"
              >
                {busy ? "Opening payment…" : "Upgrade to Premium AI — ₦1,000/mo"}
              </button>
            )}

            <p className={`font-body text-xs mt-4 ${premiumActive ? "text-white/50" : "text-ink/45"}`}>
              Premium is optional. Free Gemini remains available when Premium AI is not active.
            </p>
          </div>
        </div>

        <p className="font-body text-xs text-ink/45 mt-5">
          Nothing is ever recorded without your confirmation — every logged entry shows you exactly
          what it is about to save first.
        </p>
      </div>

      <SupportCard />
    </div>
  );
}

function BillingCard({ icon: Icon, name, price, detail, active, button, busy, onClick }) {
  return (
    <div className={`rounded-xl border-2 p-4 ${active ? "border-moss bg-paper-sunk" : "border-ink/10 bg-white"}`}>
      <Icon size={18} className="text-moss" />
      <div className="font-display text-base text-ink mt-3">{name}</div>
      <div className="font-mono text-sm text-ink/70 mt-1">{price}</div>
      <div className="font-body text-xs text-ink/45 mt-1">{detail}</div>
      <button
        onClick={onClick}
        disabled={busy}
        className="mt-4 w-full rounded-lg bg-action text-white font-body text-xs font-medium py-2.5 hover:bg-action-deep disabled:opacity-50"
      >
        {busy ? "Opening payment…" : active ? "Current plan" : button}
      </button>
    </div>
  );
}

function AddOnRow({ icon: Icon, label, description, price, active, disabled, onClick }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-ink/10 p-4">
      <div className="flex gap-3">
        <Icon size={18} className="text-moss mt-0.5" />
        <div>
          <div className="font-body text-sm font-medium text-ink">{label}</div>
          <div className="font-body text-xs text-ink/45 mt-0.5">{description}</div>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="font-mono text-xs">{active ? "Active" : price}</span>
        <button
          onClick={onClick}
          disabled={active || disabled}
          className="rounded-full border border-ink/15 px-3 py-1.5 text-xs hover:border-action disabled:opacity-40"
        >
          {active ? "Enabled" : disabled ? "Opening…" : "Add"}
        </button>
      </div>
    </div>
  );
}

function SupportCard() {
  return (
    <div className="rounded-lg border border-rule bg-white p-4 text-sm">
      <div className="font-medium text-ink">Billing complaints</div>
      <p className="text-xs text-ink/50 mt-1">
        Contact <a className="underline" href="mailto:2026mischief@gmail.com">2026mischief@gmail.com</a>
      </p>
    </div>
  );
}

function DevicesTab({ businessId }) {
  const { devices, maxDevices, loading, removeDevice } = useDevices(businessId);
  const [confirmTarget, setConfirmTarget] = useState(null);

  const handleRemove = async () => {
    if (!confirmTarget) return;
    try { await removeDevice(confirmTarget.id); }
    finally { setConfirmTarget(null); }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <SummaryCard label="Devices in use" value={devices.length} warn={devices.length >= maxDevices} />
        <SummaryCard label="Plan limit" value={maxDevices} />
      </div>

      {loading ? (
        <p className="font-body text-sm text-ink/45 text-center py-10">Loading devices…</p>
      ) : devices.length === 0 ? (
        <EmptyState title="No devices registered yet" subtitle="Devices appear here the first time they log in." />
      ) : (
        <div className="rounded-lg border border-rule bg-white overflow-hidden">
          <div className="hidden sm:grid grid-cols-[2fr_1.2fr_1.2fr_auto] gap-3 px-5 py-3 bg-paper-sunk font-body text-[13px] text-ink-soft">
            <span>Device</span><span>First seen</span><span>Last seen</span><span></span>
          </div>
          <div className="divide-y divide-rule">
            {devices.map((d) => (
              <div key={d.id} className="grid grid-cols-2 sm:grid-cols-[2fr_1.2fr_1.2fr_auto] gap-2 sm:gap-3 items-center px-5 py-3.5">
                <span className="col-span-2 sm:col-span-1 font-body text-sm text-ink truncate flex items-center gap-2">
                  <Laptop size={14} className="text-ink/40 shrink-0" /> {d.label}
                </span>
                <span className="font-mono text-[11px] text-ink/50 flex items-center gap-1.5">
                  <Clock size={11} /> {formatDate(d.firstSeenAt?.slice(0, 10))}
                </span>
                <span className="font-mono text-[11px] text-ink/50">{formatDate(d.lastSeenAt?.slice(0, 10))}</span>
                <button onClick={() => setConfirmTarget(d)} className="justify-self-end flex items-center gap-1.5 rounded-full border border-clay/25 px-3 py-1.5 font-body text-xs text-clay hover:bg-clay/8">
                  <Trash2 size={12} /> Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {devices.length >= maxDevices && (
        <p className="font-body text-xs text-clay">You've reached your plan's device limit. Remove a device above, or upgrade your plan.</p>
      )}

      {confirmTarget && (
        <Modal title="Remove this device?" icon={ShieldAlert} onClose={() => setConfirmTarget(null)}>
          <p className="font-body text-sm text-ink/60 mb-6">
            <span className="font-medium text-ink">{confirmTarget.label}</span> will need to log in again to regain access.
          </p>
          <div className="flex gap-3">
            <button onClick={handleRemove} className="flex-1 rounded-lg bg-clay text-white font-body text-sm font-medium py-3">Remove device</button>
            <button onClick={() => setConfirmTarget(null)} className="flex-1 rounded-lg border border-ink/15 text-ink font-body text-sm font-medium py-3">Cancel</button>
          </div>
        </Modal>
      )}
    </div>
  );
}