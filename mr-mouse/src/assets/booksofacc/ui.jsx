import React, { useEffect, useRef, useState } from "react";
import { Building2, Briefcase, MapPin, Phone, X, Home, PlusCircle, BookOpen, BellRing, Settings, LogOut, ArrowLeft } from "lucide-react";
import { useLedger } from "./Ledgercontext";
import { useSubscription, computeAccessState } from "../useSubscription";

/* ---------------------------------------------------------------
   Shared helpers
--------------------------------------------------------------- */

export const uid = () => Math.random().toString(36).slice(2, 10);
export const todayISO = () => new Date().toISOString().slice(0, 10);

export const formatDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

export const formatMoney = (n) => {
  const v = Number(n || 0);
  const sign = v < 0 ? "−" : "";
  return `₦${sign}${Math.abs(v).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

/* ---------------------------------------------------------------
   Global input / scrollbar styling.

   The font-family declarations that used to live here are now in
   index.css, so they apply to every page without a component having
   to render them. Login.jsx previously declared its own competing
   copy — that is what let the login screen drift onto an entirely
   different typeface pairing from the rest of the app.
--------------------------------------------------------------- */

export function GlobalStyle() {
  return (
    <style>{`
      html, body { max-width: 100%; overflow-x: hidden; }
      #root { overflow-x: hidden; }
      * { box-sizing: border-box; }
      .ledger-input {
        background: transparent;
        border: none;
        border-bottom: 1.5px solid var(--color-rule);
        color: var(--color-ink);
        transition: border-color 0.15s ease;
      }
      .ledger-input::placeholder { color: color-mix(in srgb, var(--color-ink) 34%, transparent); }
      .ledger-input:focus {
        outline: none;
        border-bottom-color: var(--color-action);
        border-bottom-width: 2px;
      }
      .ledger-field-error .ledger-input { border-bottom-color: var(--color-clay); }
      select.ledger-input option { background-color: var(--color-surface); color: var(--color-ink); }

      /* Keyboard focus has to be visible on every control, not just inputs. */
      :focus-visible {
        outline: 2px solid var(--color-action);
        outline-offset: 2px;
        border-radius: 2px;
      }

      ::-webkit-scrollbar { width: 8px; height: 8px; }
      ::-webkit-scrollbar-thumb {
        background: color-mix(in srgb, var(--color-ink) 18%, transparent);
        border-radius: 8px;
      }

      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after {
          animation-duration: 0.01ms !important;
          transition-duration: 0.01ms !important;
        }
      }
    `}</style>
  );
}

/* ---------------------------------------------------------------
   Persistent top navigation.

   Every target here is at least 44px tall. The previous 29px was
   comfortable with a mouse and a miss on a phone, which matters now
   that this ships as an APK.
--------------------------------------------------------------- */

const NAV_ITEMS = [
  { key: "dashboard", label: "Home", icon: Home },
  { key: "addentry", label: "Add entry", icon: PlusCircle },
  { key: "books", label: "Books", icon: BookOpen },
  { key: "reminders", label: "Reminders", icon: BellRing },
  { key: "settings", label: "Settings", icon: Settings },
];

export function TopNav({ business, current, onNavigate }) {
  const { logout } = useLedger();
  const { subscription } = useSubscription(business?.id);
  const restricted = computeAccessState(subscription) === "blocked";
  const name = business?.businessName?.trim() || "Your business";

  return (
    <div className="sticky top-0 z-30 bg-canvas/97 backdrop-blur border-b border-on-canvas/10">
      <div className="max-w-6xl mx-auto px-4 sm:px-8 flex items-center justify-between gap-3 min-h-nav">
        <button
          onClick={() => onNavigate("dashboard")}
          className="flex items-center gap-2 shrink-0 min-h-tap"
        >
          <div className="w-6 h-6 rounded-full border border-on-canvas/25 bg-on-canvas/10 flex items-center justify-center">
            <div className="w-1.5 h-1.5 rounded-full bg-moss-lift" />
          </div>
          <span className="font-display text-base font-semibold text-on-canvas hidden sm:inline">
            Mr Mouse
          </span>
        </button>

        <nav className="flex items-center gap-0.5 overflow-x-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = current === item.key || (item.key === "books" && current === "book-page");
            const isSettings = item.key === "settings";
            const disabled = restricted && !isSettings;
            return (
              <button
                key={item.key}
                onClick={() => !disabled && onNavigate(item.key)}
                disabled={disabled}
                aria-current={active ? "page" : undefined}
                title={disabled ? "Subscribe to regain access" : undefined}
                className={`flex items-center gap-1.5 rounded-md px-3 min-h-tap font-body text-sm whitespace-nowrap transition-colors ${
                  disabled
                    ? "text-on-canvas/25 cursor-not-allowed"
                    : active
                    ? "bg-surface text-ink font-medium"
                    : "text-on-canvas/65 hover:text-on-canvas hover:bg-on-canvas/10"
                }`}
              >
                <Icon size={16} />
                <span className="hidden xs:inline sm:inline">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-2 shrink-0">
          <span className="font-body text-label text-on-canvas/45 hidden md:inline truncate max-w-[160px]">{name}</span>
          <button
            onClick={logout}
            className="flex items-center justify-center min-w-tap min-h-tap text-on-canvas/50 hover:text-on-canvas transition-colors"
            aria-label="Log out"
            title="Log out"
          >
            <LogOut size={17} />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   Page header banner.

   The business name used to sit in a tracked-out ALL-CAPS mono
   eyebrow. Sentence case reads faster and is one less piece of
   template chrome.
--------------------------------------------------------------- */

export function PageHeader({ business, icon: Icon, title, subtitle, right }) {
  const name = business?.businessName?.trim() || "Your business";
  const location = business?.location?.trim();
  const contact = business?.contact?.trim();
  const industry = business?.industry?.trim();

  return (
    <div className="relative bg-canvas pb-9 pt-8 px-5 sm:px-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-2 mb-5">
          <Building2 size={14} className="text-moss-lift" />
          <span className="font-body text-sm text-on-canvas/70">{name}</span>
        </div>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl sm:text-4xl font-bold text-on-canvas mb-2 flex items-center gap-2.5 text-balance">
              {Icon && <Icon size={26} className="text-moss-lift shrink-0" />}
              {title}
            </h1>
            {subtitle && <p className="font-body text-sm text-on-canvas/55 max-w-xl">{subtitle}</p>}
          </div>
          {right}
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-1.5 font-body text-label text-on-canvas/40 mt-4">
          {industry && (
            <span className="flex items-center gap-1.5"><Briefcase size={12} /> {industry}</span>
          )}
          {location && (
            <span className="flex items-center gap-1.5"><MapPin size={12} /> {location}</span>
          )}
          {contact && (
            <span className="flex items-center gap-1.5"><Phone size={12} /> {contact}</span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   Shared primitives
--------------------------------------------------------------- */

/* Point a field's <label> at its own input/select/textarea, so screen
   readers announce the field's name. Children that are not a single form
   control (a custom picker, say) are left as they are. */
export function linkLabel(children, generatedId) {
  if (React.isValidElement(children) && ["input", "select", "textarea"].includes(children.type)) {
    const id = children.props.id || generatedId;
    return { htmlFor: id, control: children.props.id ? children : React.cloneElement(children, { id }) };
  }
  return { htmlFor: undefined, control: children };
}

export function Field({ icon: Icon, label, error, optional, action, children }) {
  const { htmlFor, control } = linkLabel(children, React.useId());
  return (
    <div className={error ? "ledger-field-error" : ""}>
      <label htmlFor={htmlFor} className="font-body text-label text-ink-soft flex items-center gap-1.5 mb-1.5">
        {Icon && <Icon size={13} />}
        {label}
        {optional && <span className="text-ink/35">(optional)</span>}
      </label>
      <div className="flex items-center gap-2">
        <div className="flex-1">{control}</div>
        {action}
      </div>
      {error && <p className="font-body text-xs text-clay mt-1">{error}</p>}
    </div>
  );
}

/* A modal that behaves like one: focus moves in on open and back out
   on close, Tab is trapped inside, Escape dismisses, and the page
   behind it stops scrolling.

   Backdrop click no longer closes by default. The Invoice Builder
   puts a half-finished invoice in a modal, and a stray click on the
   backdrop discarding it is real lost work — pass
   `dismissOnBackdrop` where the content is genuinely disposable. */
export function Modal({ title, icon: Icon, onClose, children, wide, dismissOnBackdrop = false }) {
  const panelRef = useRef(null);
  const headingId = useRef(`modal-${uid()}`).current;

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    const panel = panelRef.current;
    const SELECTOR =
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

    const focusable = () =>
      Array.from(panel?.querySelectorAll(SELECTOR) || []).filter(
        (el) => el.offsetWidth > 0 || el.offsetHeight > 0
      );

    (focusable()[0] || panel)?.focus?.();

    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose?.();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-4 overflow-y-auto backdrop-blur-sm"
      style={{ background: "var(--color-scrim)" }}
      onClick={dismissOnBackdrop ? onClose : undefined}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        className={`w-full ${wide ? "max-w-2xl" : "max-w-md"} rounded-lg border border-rule bg-surface shadow-[0_25px_70px_rgba(0,0,0,0.45)] p-6 sm:p-8 relative my-8`}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 flex items-center justify-center min-w-tap min-h-tap text-ink/40 hover:text-ink"
          aria-label="Close"
        >
          <X size={18} />
        </button>
        <h3 id={headingId} className="font-display text-xl font-semibold text-ink mb-6 flex items-center gap-2 pr-10 text-balance">
          {Icon && <Icon size={18} className="text-action" />}
          {title}
        </h3>
        {children}
      </div>
    </div>
  );
}

/* A figure and its label, ruled underneath rather than boxed in a
   card with a shadow. Border, fill, radius and shadow each say
   "separate object" — spending all four on every summary flattened
   the hierarchy so nothing read as more important than anything else. */
export function SummaryCard({ label, value, warn, accent }) {
  return (
    <div className="bg-transparent">
      <p className="font-body text-label text-ink-soft mb-1">{label}</p>
      <p
        className={`font-mono text-xl sm:text-2xl rule-sum pb-1.5 inline-block min-w-full ${
          warn ? "text-clay" : accent ? "text-moss" : "text-ink"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

export function EmptyState({ title, subtitle, action }) {
  return (
    <div className="border border-dashed border-rule bg-on-canvas/60 px-6 py-14 text-center rounded-lg">
      <RulingIn className="mx-auto mb-5" />
      <p className="font-display text-lg font-semibold text-ink mb-1">{title}</p>
      {subtitle && <p className="font-body text-sm text-ink-soft mb-5 max-w-sm mx-auto">{subtitle}</p>}
      {action}
    </div>
  );
}

/* An empty ledger ruling itself in: the entry lines draw first, then the
   single rule that closes a summed column, then the double rule under the
   total. It is the same convention the filled pages use, so a business
   with no entries yet is being shown the shape of what it is about to
   have rather than a shrug of an icon.

   It plays once, on mount, and is inert under prefers-reduced-motion —
   the finished ruling is the SVG's resting state, so nothing is hidden
   waiting on an animation that may never run. */
function RulingIn({ className = "" }) {
  return (
    <svg
      viewBox="0 0 160 92"
      width="160"
      height="92"
      className={`ruling-in ${className}`}
      role="img"
      aria-label="An empty ledger page"
      fill="none"
    >
      {[0, 1, 2, 3].map((i) => (
        <line
          key={i}
          x1="8"
          x2={i === 3 ? 96 : 152}
          y1={12 + i * 14}
          y2={12 + i * 14}
          stroke="var(--color-rule)"
          strokeWidth="2"
          strokeLinecap="round"
          style={{ "--d": `${i * 90}ms` }}
        />
      ))}
      {/* the single rule: a column has been summed */}
      <line
        x1="96" x2="152" y1="70" y2="70"
        stroke="var(--color-ink)" strokeWidth="1.5" strokeLinecap="round"
        style={{ "--d": "380ms" }}
      />
      {/* the double rule: this is the final total */}
      <line
        x1="96" x2="152" y1="78" y2="78"
        stroke="var(--color-ink)" strokeWidth="1.5" strokeLinecap="round"
        style={{ "--d": "500ms" }}
      />
      <line
        x1="96" x2="152" y1="82" y2="82"
        stroke="var(--color-ink)" strokeWidth="1.5" strokeLinecap="round"
        style={{ "--d": "500ms" }}
      />
    </svg>
  );
}

/* Tones are named for what they mean, not what colour they are —
   the old `green`/`rust` names are why the same green ended up on
   both a positive figure and a primary button.

   `caution` is new. Reminders already passed tone="amber", which
   matched nothing here, so those "Due today" pills were rendering
   with no styling at all. The legacy names stay mapped so no call
   site breaks while they migrate. */
export function Pill({ tone = "neutral", children }) {
  const tones = {
    neutral: "bg-ink/8 text-ink-soft",
    positive: "bg-moss/12 text-moss",
    negative: "bg-clay/12 text-clay",
    caution: "bg-amber/15 text-amber-deep",
    info: "bg-action-sunk text-action",
    // legacy aliases
    green: "bg-moss/12 text-moss",
    rust: "bg-clay/12 text-clay",
    amber: "bg-amber/15 text-amber-deep",
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-body text-tiny font-medium ${tones[tone] || tones.neutral}`}>
      {children}
    </span>
  );
}

/* Counts a figure up the first time it resolves.

   Deliberately narrow: it animates on first mount only, never on a
   re-render, so a figure does not re-count every time the dashboard
   recalculates or a sibling filter changes. Anything the user typed
   themselves should never be passed through it.

   The tabular numerals matter here rather than being a nicety — with
   proportional digits the number's width changes on every frame and the
   whole row jitters while it counts. */
export function AnimatedFigure({ value, format = (n) => n, className = "", duration = 800 }) {
  const [shown, setShown] = useState(() => value);
  const animated = useRef(false);

  useEffect(() => {
    if (animated.current) {
      setShown(value);
      return;
    }
    animated.current = true;

    const target = Number(value) || 0;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced || target === 0) {
      setShown(value);
      return;
    }

    let frame;
    let start = null;
    const tick = (ts) => {
      if (start === null) start = ts;
      const p = Math.min((ts - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(target * eased);
      if (p < 1) frame = requestAnimationFrame(tick);
      else setShown(value);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);

  return <span className={className}>{format(shown)}</span>;
}

/* Sits on paper, below the header — page content no longer overlaps the
   dark band, so this takes the normal ink treatment. */
export function BackLink({ onClick, children = "All books" }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 font-body text-sm text-ink-soft hover:text-ink mb-6 min-h-tap"
    >
      <ArrowLeft size={15} /> {children}
    </button>
  );
}

/* Groups the figures at the top of a book page onto one surface, so the
   page reads as "here are the totals, here is the detail" rather than as
   a row of identical floating cards. */
export function SummaryPanel({ children, note, noteTone = "neutral" }) {
  const toneClass =
    noteTone === "positive" ? "text-moss" : noteTone === "negative" ? "text-clay" : "text-ink-soft";
  return (
    <div className="bg-surface border border-rule rounded-lg px-5 py-5 mb-8">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-5 sm:gap-6">{children}</div>
      {note && <p className={`font-body text-label mt-4 ${toneClass}`}>{note}</p>}
    </div>
  );
}

/* Wraps a state change in a View Transition so switching between ledger
   views cross-fades instead of snapping. The column rules hold still and
   only the rows change, which makes the six books read as one continuous
   record rather than six separate pages.

   Falls back to a plain call where the API is missing (Firefox, older
   WebViews) and where the user has asked for reduced motion — in both
   cases the update is simply instant, which is the correct outcome. */
export function withViewTransition(update) {
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (reduced || typeof document === "undefined" || !document.startViewTransition) {
    update();
    return;
  }
  document.startViewTransition(update);
}

/* ---------------------------------------------------------------
   Ledger table

   A real <table>, because this is tabular data and screen readers
   should be told so. Money columns are right-aligned in tabular
   numerals so decimal points form a true column.

   `rule-sum` and `rule-total` (defined in index.css) are the
   accounting convention: one line under a column being summed, two
   under the final total. They replace card shadows as the way this
   app shows structure.

   The table scrolls horizontally inside its own container so the
   page body never scrolls sideways on a phone.
--------------------------------------------------------------- */

export function LedgerTable({ columns, children, caption, minWidth = 560, showHeader = true }) {
  return (
    <div className="overflow-x-auto border border-rule bg-surface rounded-lg">
      <table className="w-full border-collapse" style={{ minWidth }}>
        {caption && <caption className="sr-only">{caption}</caption>}
        {showHeader && (
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={`font-body text-tiny font-medium text-ink-soft px-4 pt-3.5 pb-2 border-b border-rule whitespace-nowrap ${
                  c.align === "right" ? "text-right" : "text-left"
                }`}
                style={c.width ? { width: c.width } : undefined}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        )}
        {children}
      </table>
    </div>
  );
}

/* A clickable row keeps a real <button> in its lead cell so keyboard
   and screen-reader users get the same navigation a mouse does —
   a click handler on the <tr> alone would be invisible to both. */
export function LedgerRow({ children, className = "" }) {
  return (
    <tr className={`border-b border-rule last:border-b-0 hover:bg-paper transition-colors ${className}`}>
      {children}
    </tr>
  );
}

export function LedgerCell({ children, num, tone, rule, className = "", ...rest }) {
  const toneClass =
    tone === "positive" ? "text-moss" : tone === "negative" ? "text-clay" : "text-ink";
  const ruleClass = rule === "sum" ? "rule-sum" : rule === "total" ? "rule-total" : "";
  return (
    <td
      className={`px-4 py-3 align-baseline ${num ? `text-right font-mono text-sm whitespace-nowrap ${toneClass}` : "font-body text-sm text-ink"} ${ruleClass} ${className}`}
      {...rest}
    >
      {children}
    </td>
  );
}
