/* Home screen layouts (Settings → Appearance). Same figures, arranged
   for different people: Classic is the original, Compact fits more on a
   small phone screen, Cards is for people who want the big numbers and
   little else. */
export const DASHBOARD_LAYOUTS = [
  { id: "classic", name: "Classic", note: "The original: summary, charts and activity." },
  { id: "compact", name: "Compact", note: "Dense: every key figure in one list." },
  { id: "cards", name: "Cards", note: "Big, friendly stat cards with plain labels." },
];

export const LAYOUT_IDS = DASHBOARD_LAYOUTS.map((l) => l.id);
