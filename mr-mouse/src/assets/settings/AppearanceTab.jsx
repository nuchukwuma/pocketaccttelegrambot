import React, { useState } from "react";
import { Check, ChevronDown, Moon, Palette, LayoutGrid, Wand2 } from "lucide-react";
import { useLedger, usePref } from "../booksofacc/Ledgercontext";
import { PRESETS, checkContrast, fitAccent, isHex, resolveThemePref } from "../theme/palette";
import { THEME_PREF, LAYOUT_PREF } from "../theme/AppearanceSync";
import { DASHBOARD_LAYOUTS } from "../components/dashboardLayouts";

/* Settings → Appearance. Every choice is a preset you can see before
   choosing: each tile is drawn in its own colours. Choosing applies at
   once, is saved for the business, and follows it to its other devices. */

const varsFor = (colors) => Object.fromEntries(Object.entries(colors).map(([k, v]) => [`--color-${k}`, v]));

export default function AppearanceTab() {
  const { setPref } = useLedger();
  const stored = usePref(THEME_PREF, null);
  const layout = usePref(LAYOUT_PREF, "classic");
  const presetId = PRESETS.some((p) => p.id === stored?.preset) ? stored.preset : "hordemart";
  const accent = isHex(stored?.accent) ? stored.accent : null;
  const [draftAccent, setDraftAccent] = useState(accent || "#e0662a");
  const [showChecks, setShowChecks] = useState(false);

  const current = resolveThemePref({ preset: presetId, accent });
  const checks = checkContrast(current.colors);
  const draft = resolveThemePref({ preset: presetId, accent: isHex(draftAccent) ? draftAccent : null });
  const basePreset = PRESETS.find((p) => p.id === presetId);
  const fitted = isHex(draftAccent) ? fitAccent(draftAccent, basePreset.colors, basePreset.scheme) : null;

  const choose = (id) => setPref(THEME_PREF, { preset: id, ...(accent ? { accent } : {}) });

  return (
    <div className="space-y-6">
      {/* ---- Colour themes ---- */}
      <section className="rounded-lg border border-rule bg-surface p-5 sm:p-6" aria-labelledby="themes-heading">
        <h2 id="themes-heading" className="font-display text-lg text-ink flex items-center gap-2">
          <Palette size={18} className="text-action" /> Colour theme
        </h2>
        <p className="font-body text-sm text-ink-soft mt-1 mb-4">
          Each preview is drawn in that theme's colours. Every theme passes the readability check for text and figures.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3" role="radiogroup" aria-label="Colour theme">
          {PRESETS.map((p) => {
            const active = p.id === presetId;
            const colors = accent ? resolveThemePref({ preset: p.id, accent }).colors : p.colors;
            return (
              <button
                key={p.id}
                role="radio"
                aria-checked={active}
                onClick={() => choose(p.id)}
                className={`text-left rounded-lg border-2 overflow-hidden transition-colors ${active ? "border-action" : "border-rule hover:border-action/50"}`}
              >
                <ThemeSwatch colors={colors} />
                <span className="flex items-start justify-between gap-2 px-3 py-2.5 bg-surface">
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 font-body text-sm font-semibold text-ink">
                      {p.name}
                      {p.scheme === "dark" && <Moon size={13} className="text-ink-soft" aria-label="dark" />}
                    </span>
                    <span className="block font-body text-caption text-ink-soft">{p.note}</span>
                  </span>
                  {active && (
                    <span className="w-6 h-6 rounded-full bg-action text-on-action flex items-center justify-center shrink-0">
                      <Check size={14} />
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        {/* ---- Custom accent ---- */}
        <div className="mt-6 pt-5 border-t border-rule">
          <h3 className="font-display text-base text-ink">Your own accent colour</h3>
          <p className="font-body text-sm text-ink-soft mt-1 mb-3">
            Changes buttons and links on the {basePreset.name} theme. If a colour is too light or too dark to read, it is
            nudged until it is.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 rounded-md border border-rule px-2 min-h-tap font-body text-sm text-ink cursor-pointer">
              <input
                type="color"
                value={isHex(draftAccent) ? draftAccent : "#e0662a"}
                onChange={(e) => setDraftAccent(e.target.value)}
                className="w-7 h-7 border-0 bg-transparent p-0 cursor-pointer"
                aria-label="Pick an accent colour"
              />
              Pick
            </label>
            <input
              value={draftAccent}
              onChange={(e) => setDraftAccent(e.target.value)}
              aria-label="Accent colour as a hex code"
              className="ledger-input w-24 py-2 text-sm font-mono"
              maxLength={7}
            />
            <div className="rounded-md px-4 min-h-tap flex items-center font-body text-sm font-medium" style={varsFor(draft.colors)}>
              <span className="rounded-md bg-action text-on-action px-3 py-2">Button</span>
              <span className="ml-3 text-action underline">Link</span>
            </div>
          </div>
          {fitted?.adjusted && (
            <p className="font-body text-label text-amber-deep mt-2 flex items-center gap-1.5" role="status">
              <Wand2 size={13} /> Adjusted to {fitted.color} so text on it stays readable.
            </p>
          )}
          <div className="flex flex-wrap gap-2 mt-3">
            <button
              onClick={() => isHex(draftAccent) && setPref(THEME_PREF, { preset: presetId, accent: draftAccent.toLowerCase() })}
              disabled={!isHex(draftAccent)}
              className="rounded-md bg-action px-4 min-h-tap font-body text-sm font-medium text-on-action hover:bg-action-deep disabled:opacity-50"
            >
              Use this accent
            </button>
            {accent && (
              <button onClick={() => setPref(THEME_PREF, { preset: presetId })} className="rounded-md border border-rule px-4 min-h-tap font-body text-sm text-ink">
                Back to the theme's own colour
              </button>
            )}
          </div>
        </div>

        {/* ---- Contrast check for what's applied ---- */}
        <div className="mt-6 pt-5 border-t border-rule">
          <button
            onClick={() => setShowChecks((v) => !v)}
            aria-expanded={showChecks}
            className="flex items-center gap-2 font-body text-sm font-medium text-ink min-h-tap"
          >
            <ChevronDown size={16} className={`transition-transform ${showChecks ? "rotate-180" : ""}`} />
            Readability check: {checks.every((c) => c.ok) ? "all passed" : `${checks.filter((c) => !c.ok).length} to fix`}
          </button>
          {showChecks && (
            <ul className="mt-2 grid sm:grid-cols-2 gap-x-6 gap-y-1.5">
              {checks.map((c) => (
                <li key={`${c.fg}-${c.bg}`} className="flex items-center justify-between gap-3 font-body text-label">
                  <span className="text-ink-soft">{c.label}</span>
                  <span className={`font-mono ${c.ok ? "text-moss" : "text-clay"}`}>
                    {c.ratio.toFixed(1)}:1 {c.ok ? "✓" : `(needs ${c.min}:1)`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* ---- Dashboard layout ---- */}
      <section className="rounded-lg border border-rule bg-surface p-5 sm:p-6" aria-labelledby="layout-heading">
        <h2 id="layout-heading" className="font-display text-lg text-ink flex items-center gap-2">
          <LayoutGrid size={18} className="text-action" /> Home screen layout
        </h2>
        <p className="font-body text-sm text-ink-soft mt-1 mb-4">The same figures, arranged three ways.</p>
        <div className="grid sm:grid-cols-3 gap-3" role="radiogroup" aria-label="Home screen layout">
          {DASHBOARD_LAYOUTS.map((l) => {
            const active = l.id === layout;
            return (
              <button
                key={l.id}
                role="radio"
                aria-checked={active}
                onClick={() => setPref(LAYOUT_PREF, l.id)}
                className={`text-left rounded-lg border-2 p-3 transition-colors ${active ? "border-action" : "border-rule hover:border-action/50"}`}
              >
                <LayoutSketch id={l.id} />
                <span className="flex items-center justify-between gap-2 mt-2.5">
                  <span className="font-body text-sm font-semibold text-ink">{l.name}</span>
                  {active && <Check size={15} className="text-action" />}
                </span>
                <span className="block font-body text-caption text-ink-soft">{l.note}</span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

/* A theme in miniature: top bar, a card with money in and out, a button. */
function ThemeSwatch({ colors }) {
  return (
    <span className="block bg-paper" style={varsFor(colors)} aria-hidden="true">
      <span className="flex items-center gap-1.5 bg-canvas px-3 py-2">
        <span className="w-3 h-3 rounded bg-moss-lift" />
        <span className="font-body text-micro text-on-canvas">Home · Books</span>
      </span>
      <span className="block p-3">
        <span className="block rounded-md bg-surface border border-rule px-2.5 py-2">
          <span className="block font-body text-micro text-ink-soft">Cash available</span>
          <span className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-sm text-ink">₦245,000</span>
            <span className="font-mono text-micro text-moss">+₦45k</span>
            <span className="font-mono text-micro text-clay">−₦12k</span>
          </span>
        </span>
        <span className="mt-2 inline-block rounded bg-action px-2.5 py-1 font-body text-micro text-on-action">Add entry</span>
      </span>
    </span>
  );
}

/* Wireframes of the three home layouts, in the current theme. */
function LayoutSketch({ id }) {
  const bar = "rounded-sm bg-ink/12";
  if (id === "compact") {
    return (
      <span className="block rounded-md bg-paper border border-rule p-2 h-24" aria-hidden="true">
        <span className="block h-3 rounded-sm bg-canvas mb-1.5" />
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className="flex justify-between gap-2 mb-1">
            <span className={`${bar} h-1.5 w-1/2`} />
            <span className={`${bar} h-1.5 w-1/5`} />
          </span>
        ))}
        <span className="flex gap-1 mt-1.5">
          {[0, 1, 2, 3].map((i) => <span key={i} className="h-2.5 flex-1 rounded-sm bg-action/60" />)}
        </span>
      </span>
    );
  }
  if (id === "cards") {
    return (
      <span className="block rounded-md bg-paper border border-rule p-2 h-24" aria-hidden="true">
        <span className="grid grid-cols-2 gap-1.5 h-full">
          {["bg-moss/25", "bg-action/20", "bg-amber/25", "bg-clay/20"].map((c) => (
            <span key={c} className={`rounded ${c} p-1.5`}>
              <span className={`block ${bar} h-1 w-2/3 mb-1`} />
              <span className="block rounded-sm bg-ink/40 h-2.5 w-4/5" />
            </span>
          ))}
        </span>
      </span>
    );
  }
  return (
    <span className="block rounded-md bg-paper border border-rule p-2 h-24" aria-hidden="true">
      <span className="block h-7 rounded-sm bg-canvas mb-1.5 p-1">
        <span className="block h-2 w-1/3 rounded-sm bg-on-canvas/60" />
      </span>
      <span className="grid grid-cols-3 gap-1 mb-1.5">
        {[0, 1, 2].map((i) => <span key={i} className="h-5 rounded-sm border border-rule bg-surface" />)}
      </span>
      <span className="grid grid-cols-2 gap-1">
        <span className="h-6 rounded-sm border border-rule bg-surface" />
        <span className="h-6 rounded-sm border border-rule bg-surface" />
      </span>
    </span>
  );
}
