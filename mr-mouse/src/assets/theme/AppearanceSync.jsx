import { useEffect } from "react";
import { usePrefRow } from "../booksofacc/Ledgercontext";
import { useTheme } from "./ThemeContext";
import { resolveThemePref } from "./palette";

export const THEME_PREF = "theme";
export const LAYOUT_PREF = "dashboardLayout";

/* Applies the signed-in business's colour theme (Settings → Appearance).
   The choice is a synced preference, so changing it on one device
   re-colours the others as soon as the change arrives. Until Dexie has
   answered, the cached theme from the last visit stays on screen. */
export default function AppearanceSync() {
  const { loaded, value } = usePrefRow(THEME_PREF);
  const { setTheme } = useTheme();
  const key = JSON.stringify(value ?? null);

  useEffect(() => {
    if (!loaded) return;
    setTheme(resolveThemePref(value));
    // `key` stands in for `value`, which is a new object on every read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, key, setTheme]);

  return null;
}
