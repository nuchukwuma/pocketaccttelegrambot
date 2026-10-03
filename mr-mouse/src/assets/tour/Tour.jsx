import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Compass, Lightbulb, X } from "lucide-react";
import { useLedger, usePrefRow } from "../booksofacc/Ledgercontext";
import { TOUR_PREF, TOUR_STEPS, stepIndex } from "./steps";

/* ---------------------------------------------------------------
   The guided tour.

   - Starts by itself the first time a business signs in. A business
     that was already using Mr Mouse before the tour existed is asked
     instead of being dropped into it.
   - Skip, back, next, and pause (×, or Escape). A paused tour offers
     to resume at the same step next time.
   - Progress is a per-business preference in Dexie ("tour"), synced,
     so finishing it on the shop laptop doesn't start it again on the
     phone.
   - Settings → Help restarts it (useTour().start()).

   The spotlight is a hole in a dimmed layer; clicks outside the card
   are blocked so the tour can't get out of step with the screen.
--------------------------------------------------------------- */

const TourCtx = createContext(null);

export function useTour() {
  return useContext(TourCtx) || { start: () => {}, running: false };
}

const LAST = TOUR_STEPS.length - 1;

export function TourProvider({ children, onNavigate, page, params, blocked }) {
  const { business, bootstrapped, transactions, currentUser, setPref } = useLedger();
  const pref = usePrefRow(TOUR_PREF);
  const [running, setRunning] = useState(false);
  const [index, setIndex] = useState(0);
  const [prompt, setPrompt] = useState(null); // null | { kind: "new" } | { kind: "resume", index }
  const checkedFor = useRef(null);

  const save = useCallback((status, i) => setPref(TOUR_PREF, { status, step: TOUR_STEPS[i]?.id ?? null }), [setPref]);

  const start = useCallback(
    (from = 0) => {
      setPrompt(null);
      setIndex(from);
      setRunning(true);
      save("active", from);
    },
    [save]
  );

  // First visit per business: start, offer, or offer to resume. Waits for
  // the first sync round so a device that hasn't yet received the
  // business's tour progress doesn't start it again.
  useEffect(() => {
    if (!business?.id || !bootstrapped || !pref.loaded || blocked) return;
    if (checkedFor.current === business.id) return;
    checkedFor.current = business.id;

    const stored = pref.value;
    if (!stored) {
      let existing = (transactions?.length || 0) > 0;
      try {
        existing ||= Boolean(localStorage.getItem(`seenQuickLearning:${business.id}`));
      } catch {
        // No storage: judge by the books alone.
      }
      if (existing) setPrompt({ kind: "new" });
      else start(0);
    } else if (stored.status === "active" || stored.status === "paused") {
      setPrompt({ kind: "resume", index: stepIndex(stored.step) });
    }
  }, [business?.id, bootstrapped, pref.loaded, pref.value, blocked, transactions, start]);

  // Signing out or into another business ends anything in progress.
  useEffect(() => {
    setRunning(false);
    setPrompt(null);
  }, [currentUser?.businessId]);

  const step = TOUR_STEPS[index];

  // Open the step's screen (only when it isn't already showing).
  useEffect(() => {
    if (!running || !step) return;
    const samePage = page === step.page && (step.params?.book ?? null) === (params?.book ?? null);
    if (!samePage) onNavigate(step.page, step.params || {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, index]);

  const go = useCallback(
    (i) => {
      const next = Math.max(0, Math.min(LAST, i));
      setIndex(next);
      save("active", next);
    },
    [save]
  );

  const pause = useCallback(() => {
    setRunning(false);
    save("paused", index);
  }, [index, save]);

  const skip = useCallback(() => {
    setRunning(false);
    setPrompt(null);
    setPref(TOUR_PREF, { status: "skipped", step: null });
  }, [setPref]);

  const finish = useCallback(() => {
    setRunning(false);
    setPref(TOUR_PREF, { status: "done", step: null });
    onNavigate("dashboard");
  }, [setPref, onNavigate]);

  const value = useMemo(() => ({ start, running }), [start, running]);

  return (
    <TourCtx.Provider value={value}>
      {children}
      {running && step && (
        <TourOverlay
          step={step}
          index={index}
          onBack={() => go(index - 1)}
          onNext={() => (index === LAST ? finish() : go(index + 1))}
          onPause={pause}
          onSkip={skip}
          // Steps are tied to a screen; wait for it before measuring.
          page={page}
          book={params?.book}
        />
      )}
      {!running && prompt && (
        <TourPrompt
          prompt={prompt}
          onStart={() => start(prompt.kind === "resume" ? prompt.index : 0)}
          onLater={() => setPrompt(null)}
          onNever={skip}
        />
      )}
    </TourCtx.Provider>
  );
}

/* ---------- measuring the highlighted element ---------- */

const PAD = 8;

function useTargetRect(targetId, ready) {
  const [rect, setRect] = useState(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!ready) return undefined;
    setRect(null);
    setMissing(false);
    let el = null;
    let frame = 0;
    let observer = null;
    let tries = 0;

    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!el?.isConnected) return;
        const r = el.getBoundingClientRect();
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
      });
    };

    const find = () => {
      el = document.querySelector(`[data-tour="${targetId}"]`);
      if (!el) {
        if (++tries > 30) setMissing(true); // ~3s: show the card on its own
        else timer = setTimeout(find, 100);
        return;
      }
      // Bring it into view under the sticky top bar.
      const top = el.getBoundingClientRect().top + window.scrollY - 64;
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({ top: Math.max(0, top), behavior: reduced ? "auto" : "smooth" });
      measure();
      observer = new ResizeObserver(measure);
      observer.observe(el);
    };
    let timer = setTimeout(find, 50);

    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [targetId, ready]);

  return { rect, missing };
}

function useViewport() {
  const read = () => ({ w: window.innerWidth, h: window.innerHeight });
  const [vp, setVp] = useState(read);
  useEffect(() => {
    const on = () => setVp(read());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return vp;
}

/* ---------- the overlay ---------- */

function TourOverlay({ step, index, onBack, onNext, onPause, onSkip, page, book }) {
  const onStepScreen = page === step.page && (step.params?.book ?? null) === (book ?? null);
  const { rect, missing } = useTargetRect(step.target, onStepScreen);
  const vp = useViewport();
  const cardRef = useRef(null);
  const [cardH, setCardH] = useState(0);
  const mobile = vp.w < 640;

  // A short page can't scroll its highlighted part up to the top, which
  // leaves no room for the card (on a phone, the sheet would cover it).
  // Give the page that room while the tour runs.
  useEffect(() => {
    const before = document.body.style.paddingBottom;
    document.body.style.paddingBottom = "70vh";
    return () => {
      document.body.style.paddingBottom = before;
    };
  }, []);
  const headingId = `tour-title-${step.id}`;

  useLayoutEffect(() => {
    setCardH(cardRef.current?.offsetHeight || 0);
  }, [step.id, vp.w, rect]);

  // Focus the card on each step so screen readers read it out.
  useEffect(() => {
    cardRef.current?.focus({ preventScroll: true });
  }, [step.id]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onPause();
      else if (e.key === "ArrowRight") onNext();
      else if (e.key === "ArrowLeft" && index > 0) onBack();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onPause, onNext, onBack, index]);

  // The hole, clipped to the screen (and, on a phone, to above the sheet)
  // so a tall form doesn't push it off.
  const visibleBottom = mobile && cardH ? vp.h - cardH - 8 : vp.h - 4;
  const hole = rect
    ? (() => {
        const top = Math.max(rect.top - PAD, 4);
        const left = Math.max(rect.left - PAD, 4);
        const bottom = Math.max(top, Math.min(rect.top + rect.height + PAD, visibleBottom));
        const right = Math.min(rect.left + rect.width + PAD, vp.w - 4);
        return { top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
      })()
    : null;

  // Card placement: a bottom sheet on phones. On wider screens: below the
  // hole, else above it, else beside it, else in the corner with the most
  // room (a tall target on a short screen leaves no clear spot).
  let cardStyle;
  if (mobile) {
    cardStyle = { left: 0, right: 0, bottom: 0 };
  } else {
    const width = Math.min(440, vp.w - 32);
    const left = hole ? Math.min(Math.max(hole.left, 16), vp.w - width - 16) : (vp.w - width) / 2;
    const midTop = (h) => Math.min(Math.max(16, h.top + h.height / 2 - cardH / 2), vp.h - cardH - 16);
    if (hole && hole.top + hole.height + 16 + cardH <= vp.h - 16) cardStyle = { top: hole.top + hole.height + 16, left, width };
    else if (hole && hole.top - 16 - cardH >= 16) cardStyle = { top: hole.top - 16 - cardH, left, width };
    else if (hole && vp.w - (hole.left + hole.width) >= width + 32) cardStyle = { top: midTop(hole), left: hole.left + hole.width + 16, width };
    else if (hole && hole.left >= width + 32) cardStyle = { top: midTop(hole), left: hole.left - width - 16, width };
    else if (hole) cardStyle = vp.w - (hole.left + hole.width) >= hole.left ? { bottom: 16, right: 16, width } : { bottom: 16, left: 16, width };
    else cardStyle = { top: Math.max(16, (vp.h - cardH) / 2), left, width };
  }

  const showCard = Boolean(rect) || missing;

  return (
    <div className="fixed inset-0 z-[70]" aria-live="polite">
      {/* Dim everything except the hole; also swallows stray clicks. */}
      {hole ? (
        <div
          className="tour-hole fixed rounded-xl pointer-events-none"
          style={{
            ...hole,
            boxShadow:
              "0 0 0 3px var(--color-amber), 0 0 0 200vmax color-mix(in srgb, var(--color-canvas) 66%, transparent)",
          }}
        />
      ) : (
        <div className="fixed inset-0" style={{ background: "color-mix(in srgb, var(--color-canvas) 66%, transparent)" }} />
      )}
      <div className="fixed inset-0" onClick={(e) => e.stopPropagation()} />

      {showCard && (
        <div
          ref={cardRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={headingId}
          tabIndex={-1}
          className={`fixed bg-surface border border-rule text-ink shadow-[0_20px_60px_rgba(0,0,0,0.35)] outline-none ${
            mobile ? "rounded-t-2xl px-5 pt-4 pb-5 max-h-[58vh] overflow-y-auto" : "rounded-xl p-5"
          }`}
          style={cardStyle}
        >
          <div className="flex items-center justify-between gap-3 mb-2">
            <span className="flex items-center gap-1.5 font-body text-caption text-ink-soft">
              <Compass size={14} className="text-action" />
              Step {index + 1} of {TOUR_STEPS.length}
            </span>
            <button
              onClick={onPause}
              aria-label="Pause tour"
              title="Pause — you can carry on later"
              className="flex items-center justify-center min-w-tap min-h-tap -mr-3 -mt-2 text-ink/45 hover:text-ink"
            >
              <X size={18} />
            </button>
          </div>

          <h2 id={headingId} className="font-display text-lg font-semibold text-ink mb-3 text-balance">
            {step.title}
          </h2>

          <p className="font-body text-caption font-semibold text-ink-soft mb-1">How to use it</p>
          <p className="font-body text-sm text-ink leading-relaxed mb-3">{step.how}</p>

          <div className="rounded-lg bg-action-sunk px-3.5 py-3 mb-4">
            <p className="font-body text-caption font-semibold text-action flex items-center gap-1.5 mb-1">
              <Lightbulb size={13} /> Why it matters
            </p>
            <p className="font-body text-sm text-ink leading-relaxed">{step.why}</p>
          </div>

          <div className="flex items-center gap-1 mb-4" aria-hidden="true">
            {TOUR_STEPS.map((s, i) => (
              <span
                key={s.id}
                className={`h-1.5 rounded-full transition-all ${i === index ? "w-5 bg-action" : i < index ? "w-1.5 bg-action/50" : "w-1.5 bg-ink/15"}`}
              />
            ))}
          </div>

          <div className="flex items-center justify-between gap-2">
            <button onClick={onSkip} className="font-body text-label text-ink-soft hover:text-ink underline min-h-tap px-1">
              Skip tour
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={onBack}
                disabled={index === 0}
                className="flex items-center gap-1 rounded-md border border-rule px-3 min-h-tap font-body text-sm text-ink disabled:opacity-35"
              >
                <ChevronLeft size={16} /> Back
              </button>
              <button
                onClick={onNext}
                className="flex items-center gap-1 rounded-md bg-action px-4 min-h-tap font-body text-sm font-medium text-on-action hover:bg-action-deep"
              >
                {index === LAST ? "Finish" : "Next"} {index !== LAST && <ChevronRight size={16} />}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- the offer to start or resume ---------- */

function TourPrompt({ prompt, onStart, onLater, onNever }) {
  const resume = prompt.kind === "resume";
  return (
    <div
      role="region"
      aria-label="Guided tour"
      className="fixed z-[65] bottom-4 left-4 right-4 sm:left-auto sm:w-[360px] rounded-xl border border-rule bg-surface p-4 shadow-[0_16px_40px_rgba(0,0,0,0.25)]"
    >
      <div className="flex items-start gap-3">
        <span className="w-9 h-9 rounded-full bg-action-sunk flex items-center justify-center shrink-0">
          <Compass size={17} className="text-action" />
        </span>
        <div className="min-w-0">
          <p className="font-display text-base font-semibold text-ink">
            {resume ? "Carry on with the tour?" : "New: a 2-minute guided tour"}
          </p>
          <p className="font-body text-sm text-ink-soft mt-0.5">
            {resume
              ? `You stopped at step ${prompt.index + 1} of ${TOUR_STEPS.length}.`
              : "See how each screen helps you keep your books, with real examples."}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 mt-3">
        <button onClick={onNever} className="font-body text-label text-ink-soft underline min-h-tap px-2">
          {resume ? "End tour" : "No thanks"}
        </button>
        <button onClick={onLater} className="rounded-md border border-rule px-3 min-h-tap font-body text-sm text-ink">
          Not now
        </button>
        <button
          onClick={onStart}
          className="rounded-md bg-action px-4 min-h-tap font-body text-sm font-medium text-on-action hover:bg-action-deep"
        >
          {resume ? "Resume" : "Start tour"}
        </button>
      </div>
    </div>
  );
}
