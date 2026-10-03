import React, { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState } from "react";
import { COLOR_TOKENS, FONT_TOKENS, DEFAULT_THEME, completeTheme, tokenColor } from "./tokens";

/* ---------------------------------------------------------------
   ThemeContext — applies a theme by writing its tokens onto <html>.

   Components never read colours from here: they use Tailwind classes
   (bg-surface, text-ink…) or tokenColor() in inline styles, both of
   which resolve through the CSS variables this sets. So changing the
   theme repaints everything without re-rendering anything.

   Stage 3 adds per-business presets and storage; this provider only
   needs setTheme() to be called with the chosen theme.
--------------------------------------------------------------- */

const ThemeCtx = createContext(null);

export function applyTheme(theme, root = document.documentElement) {
  const t = completeTheme(theme);
  for (const name of COLOR_TOKENS) root.style.setProperty(`--color-${name}`, t.colors[name]);
  for (const name of FONT_TOKENS) root.style.setProperty(`--font-${name}`, t.fonts[name]);
  // Native controls (scrollbars, date pickers, autofill) follow the scheme.
  root.style.colorScheme = t.scheme === "dark" ? "dark" : "light";
  root.dataset.theme = t.id;
  // The browser / Android status bar matches the top bar.
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);
  }
  meta.content = t.colors.canvas;
  return t;
}

export function ThemeProvider({ initialTheme = DEFAULT_THEME, children }) {
  const [theme, setThemeState] = useState(() => completeTheme(initialTheme));

  // Layout effect: applied before paint, so a theme change never flashes.
  useLayoutEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = useCallback((next) => setThemeState(completeTheme(next)), []);
  const resetTheme = useCallback(() => setThemeState(DEFAULT_THEME), []);

  const value = useMemo(() => ({ theme, setTheme, resetTheme, tokenColor }), [theme, setTheme, resetTheme]);
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeCtx);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
