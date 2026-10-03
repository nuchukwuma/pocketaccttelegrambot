/* ---------------------------------------------------------------
   Theme tokens.

   Every colour, face and size the app draws with is a CSS custom
   property (src/index.css declares the defaults in Tailwind's @theme
   block). Tailwind v4 compiles its utilities to var(--color-…), so
   setting these properties at runtime re-themes every screen — which
   is all ThemeContext does.

   A theme is a plain object: { id, name, scheme, colors, fonts }.
   `colors` keys are token names without the --color- prefix.
--------------------------------------------------------------- */

export const COLOR_TOKENS = [
  "paper",
  "paper-sunk",
  "rule",
  "ink",
  "ink-soft",
  "action",
  "action-deep",
  "action-sunk",
  "moss",
  "clay",
  "moss-lift",
  "clay-lift",
  "chart-in",
  "chart-out",
  "chart-grid",
  "amber",
  "amber-deep",
  "surface",
  "canvas",
  "on-canvas",
  "on-action",
  "scrim",
];

export const FONT_TOKENS = ["display", "body", "mono"];

/* The look the app ships with (HordeMart's palette). Must match the
   defaults in src/index.css, so the first paint and the applied theme
   are the same. */
export const DEFAULT_THEME = Object.freeze({
  id: "hordemart",
  name: "HordeMart",
  scheme: "light",
  colors: Object.freeze({
    paper: "#fcfcf8",
    "paper-sunk": "#f1f2f8",
    rule: "#dfe2ee",
    ink: "#161a33",
    "ink-soft": "#4a4f6a",
    action: "#22307a",
    "action-deep": "#1a2563",
    "action-sunk": "#dce1f5",
    moss: "#12784a",
    clay: "#b4472a",
    "moss-lift": "#6fcf9b",
    "clay-lift": "#e07a5c",
    "chart-in": "#2a78d6",
    "chart-out": "#eb6834",
    "chart-grid": "#e4e7f1",
    amber: "#c99a2e",
    "amber-deep": "#8f6200",
    surface: "#ffffff",
    canvas: "#161a33",
    "on-canvas": "#ffffff",
    "on-action": "#ffffff",
    scrim: "rgb(22 26 51 / 0.82)",
  }),
  fonts: Object.freeze({
    display: "'Unbounded', 'Trebuchet MS', sans-serif",
    body: "'Figtree', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    mono: "'IBM Plex Mono', ui-monospace, Menlo, monospace",
  }),
});

/* A token as a CSS value, optionally see-through:
     tokenColor("ink")      -> var(--color-ink)
     tokenColor("ink", 53)  -> ink at 53% opacity
   Use this anywhere a colour goes into an inline style or an SVG, so
   it follows the theme instead of freezing a hex at build time. */
export function tokenColor(name, percent) {
  const value = `var(--color-${name})`;
  if (percent === undefined || percent >= 100) return value;
  return `color-mix(in srgb, ${value} ${percent}%, transparent)`;
}

/* Fill gaps from the default, so a theme that only changes the accent
   still has every token. */
export function completeTheme(theme) {
  if (!theme) return DEFAULT_THEME;
  return {
    ...DEFAULT_THEME,
    ...theme,
    colors: { ...DEFAULT_THEME.colors, ...(theme.colors || {}) },
    fonts: { ...DEFAULT_THEME.fonts, ...(theme.fonts || {}) },
  };
}
