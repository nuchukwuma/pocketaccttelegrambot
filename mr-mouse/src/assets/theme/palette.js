/* ---------------------------------------------------------------
   Colour presets, and the arithmetic that keeps them readable.

   A preset is a handful of seed colours. Everything else a theme needs
   (hover shades, tints, hairlines, the colours that sit on the dark
   bands) is derived here, so adding a preset is one small object and
   every preset gets the same contrast guarantees.

   Contrast is WCAG 2 relative luminance. checkContrast() lists every
   pair the app actually draws (body text on paper, white on a button,
   a green figure on a card…) with the minimum it needs.
--------------------------------------------------------------- */

import { DEFAULT_THEME } from "./tokens.js";

/* ---------- colour arithmetic ---------- */

export function parseHex(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex([r, g, b]) {
  const c = (v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** `a` moved `t` (0–1) of the way towards `b`. */
export function mix(a, b, t) {
  const x = parseHex(a);
  const y = parseHex(b);
  return toHex(x.map((v, i) => v + (y[i] - v) * t));
}

export function luminance(hex) {
  const lin = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = parseHex(hex).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export const isHex = (value) => parseHex(value) !== null;

const WHITE = "#ffffff";

/** White or the given dark ink, whichever reads better on `bg`. */
export function textOn(bg, dark = "#14161f") {
  return contrast(bg, WHITE) >= contrast(bg, dark) ? WHITE : dark;
}

/* ---------- presets ---------- */

/* Seeds. `exact` pins colours that should not be derived (the two
   palettes the app has actually shipped with keep their tuned values). */
const SEEDS = [
  {
    id: "hordemart",
    name: "HordeMart",
    note: "Indigo and brass. The default.",
    exact: DEFAULT_THEME.colors,
  },
  {
    id: "forest",
    name: "Forest",
    note: "The original Mr Mouse greens.",
    paper: "#f7f5ef",
    surface: "#ffffff",
    ink: "#1c2118",
    action: "#2f5741",
    moss: "#3f6b47",
    clay: "#a8483a",
    amber: "#c88a3a",
    canvas: "#1c2118",
    exact: {
      "paper-sunk": "#efece2",
      rule: "#ddd8c9",
      "ink-soft": "#5a6152",
      "action-deep": "#23412f",
      "action-sunk": "#e4ebe5",
      "moss-lift": "#8fb49b",
      "clay-lift": "#e19a85",
      "chart-in": "#2e7d4f",
      "chart-out": "#c08a2e",
      "chart-grid": "#e8e4d8",
      "amber-deep": "#8a5a18",
    },
  },
  {
    id: "ocean",
    name: "Ocean",
    note: "Calm blues and teal.",
    paper: "#f5f9fa",
    surface: "#ffffff",
    ink: "#0f2530",
    action: "#0b6283",
    moss: "#1a7547",
    clay: "#b4472a",
    amber: "#c99a2e",
    canvas: "#0c2a36",
    chartIn: "#1f86b8",
    chartOut: "#e8743b",
  },
  {
    id: "sunset",
    name: "Sunset",
    note: "Warm orange, like evening in Lagos.",
    paper: "#fdf8f3",
    surface: "#ffffff",
    ink: "#2a1a12",
    action: "#b33c0a",
    moss: "#2f7a3e",
    clay: "#a3282a",
    amber: "#c98a1e",
    canvas: "#3a1d12",
    chartIn: "#2f8a52",
    chartOut: "#e0662a",
  },
  {
    id: "royal",
    name: "Royal Purple",
    note: "Deep purple with gold.",
    paper: "#faf8fd",
    surface: "#ffffff",
    ink: "#1e1433",
    action: "#5b2a9e",
    moss: "#16774a",
    clay: "#b4472a",
    amber: "#c99a2e",
    canvas: "#22133d",
    chartIn: "#6b4fd6",
    chartOut: "#e8743b",
  },
  {
    id: "rose",
    name: "Rose",
    note: "Soft pinks, strong buttons.",
    paper: "#fdf7f8",
    surface: "#ffffff",
    ink: "#2d1520",
    action: "#a8234f",
    moss: "#1f7a4a",
    clay: "#a8432c",
    amber: "#c58f2a",
    canvas: "#3a1424",
    chartIn: "#2f86a8",
    chartOut: "#e0567e",
  },
  {
    id: "midnight",
    name: "Midnight",
    note: "Dark mode. Easier on the eyes at night.",
    scheme: "dark",
    paper: "#0e1224",
    surface: "#161b33",
    ink: "#e9ebf5",
    inkSoft: "#a9aec8",
    action: "#8fa2ff",
    moss: "#4cc38a",
    clay: "#f0896a",
    amber: "#e0b450",
    canvas: "#070a18",
    chartIn: "#5aa2ff",
    chartOut: "#ff9a62",
  },
  {
    id: "sand",
    name: "Sand",
    note: "Warm, paper-like neutrals.",
    paper: "#f8f3e8",
    surface: "#fffdf8",
    ink: "#2b2416",
    action: "#7d5410",
    moss: "#4a7336",
    clay: "#a8483a",
    amber: "#b9832a",
    canvas: "#3b3020",
    chartIn: "#4a8a3a",
    chartOut: "#c0702e",
  },
  {
    id: "charcoal",
    name: "Charcoal",
    note: "Plain greys. Lets the numbers speak.",
    paper: "#f6f6f5",
    surface: "#ffffff",
    ink: "#18191b",
    action: "#2e3238",
    moss: "#1f7a4a",
    clay: "#b4472a",
    amber: "#b98a2e",
    canvas: "#1d1f22",
    chartIn: "#3c7fc4",
    chartOut: "#d9733a",
  },
];

/* Everything a theme needs, from the seeds. */
function derive(seed) {
  if (!seed.paper) return { ...seed.exact };
  const dark = seed.scheme === "dark";
  const { paper, surface, ink, action, moss, clay, amber, canvas } = seed;
  const black = "#000000";
  const colors = {
    paper,
    surface,
    ink,
    canvas,
    action,
    moss,
    clay,
    amber,
    "paper-sunk": mix(paper, ink, dark ? 0.07 : 0.045),
    rule: mix(surface, ink, dark ? 0.2 : 0.13),
    "ink-soft": seed.inkSoft || mix(ink, paper, 0.3),
    "action-deep": dark ? mix(action, WHITE, 0.18) : mix(action, black, 0.2),
    "action-sunk": mix(surface, action, dark ? 0.22 : 0.13),
    "moss-lift": mix(moss, WHITE, dark ? 0.15 : 0.45),
    "clay-lift": mix(clay, WHITE, dark ? 0.15 : 0.4),
    "chart-in": seed.chartIn || moss,
    "chart-out": seed.chartOut || clay,
    "chart-grid": mix(surface, ink, dark ? 0.14 : 0.09),
    "amber-deep": dark ? mix(amber, WHITE, 0.25) : mix(amber, black, 0.38),
    "on-canvas": textOn(canvas),
    "on-action": textOn(action, dark ? paper : "#14161f"),
  };
  const [r, g, b] = parseHex(canvas);
  colors.scrim = `rgb(${r} ${g} ${b} / 0.82)`;
  return { ...colors, ...(seed.exact || {}) };
}

export const PRESETS = SEEDS.map((seed) => ({
  id: seed.id,
  name: seed.name,
  note: seed.note,
  scheme: seed.scheme || "light",
  colors: derive(seed),
}));

export const PRESET_IDS = PRESETS.map((p) => p.id);
export const DEFAULT_PRESET = "hordemart";

export function presetById(id) {
  return PRESETS.find((p) => p.id === id) || PRESETS[0];
}

/* ---------- contrast ---------- */

/* Every pairing the screens draw, with the WCAG minimum it needs:
   4.5:1 for text, 3:1 for icons and large figures. */
const PAIRS = [
  ["ink", "paper", 4.5, "Text on the page"],
  ["ink", "surface", 4.5, "Text on cards"],
  ["ink-soft", "surface", 4.5, "Labels on cards"],
  ["ink-soft", "paper", 4.5, "Labels on the page"],
  ["action", "surface", 4.5, "Links"],
  ["on-action", "action", 4.5, "Button text"],
  ["moss", "surface", 4.5, "Money in"],
  ["clay", "surface", 4.5, "Money out"],
  ["amber-deep", "surface", 4.5, "Warnings"],
  ["on-canvas", "canvas", 4.5, "Top bar text"],
  ["moss-lift", "canvas", 3, "Top bar icons"],
  ["clay-lift", "canvas", 3, "Top bar warnings"],
];

/** Every pairing with its ratio; `ok` is false where it falls short. */
export function checkContrast(colors) {
  return PAIRS.map(([fg, bg, min, label]) => {
    const ratio = contrast(colors[fg], colors[bg]);
    return { fg, bg, label, min, ratio: Math.round(ratio * 100) / 100, ok: ratio >= min };
  });
}

export const contrastProblems = (colors) => checkContrast(colors).filter((c) => !c.ok);

/* ---------- custom accent ---------- */

/**
 * A seller's own accent colour, nudged until it works on this theme:
 * readable as link text on cards, and with readable text on it as a
 * button. Returns { color, adjusted } — `adjusted` when the colour had
 * to move, so the screen can say so.
 */
export function fitAccent(hex, colors, scheme = "light") {
  if (!isHex(hex)) return { color: colors.action, adjusted: false };
  const target = scheme === "dark" ? WHITE : "#000000";
  const works = (c) => contrast(c, colors.surface) >= 4.5 && contrast(c, textOn(c, colors.paper)) >= 4.5;
  for (let t = 0; t <= 1.0001; t += 0.04) {
    const candidate = t === 0 ? hex.toLowerCase() : mix(hex, target, t);
    if (works(candidate)) return { color: candidate, adjusted: t > 0 };
  }
  return { color: colors.action, adjusted: true };
}

/** The theme colours with the accent swapped in, plus its derived shades. */
export function withAccent(preset, accent) {
  const dark = preset.scheme === "dark";
  const { color } = fitAccent(accent, preset.colors, preset.scheme);
  return {
    ...preset.colors,
    action: color,
    "action-deep": dark ? mix(color, WHITE, 0.18) : mix(color, "#000000", 0.2),
    "action-sunk": mix(preset.colors.surface, color, dark ? 0.22 : 0.13),
    "on-action": textOn(color, dark ? preset.colors.paper : "#14161f"),
  };
}

/* ---------- stored preference -> theme ---------- */

/**
 * The "theme" preference is { preset, accent? }. Anything unknown or
 * malformed falls back to the default rather than throwing — this comes
 * from sync, so it may have been written by an older or newer app.
 */
export function resolveThemePref(value) {
  const preset = presetById(value?.preset);
  const accent = isHex(value?.accent) ? value.accent : null;
  return {
    id: accent ? `${preset.id}+accent` : preset.id,
    name: preset.name,
    scheme: preset.scheme,
    colors: accent ? withAccent(preset, accent) : preset.colors,
  };
}
