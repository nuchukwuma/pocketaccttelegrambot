/* ---------------------------------------------------------------
   Runtime colour tokens.

   Colour is primarily expressed through Tailwind classes backed by
   the `@theme` block in src/index.css — that is the source of truth
   and the place to edit the palette.

   This file covers the few places that need a real hex string at
   runtime rather than a CSS variable:

     - colours passed to lucide icons via the `color` prop
     - colours composed with an alpha suffix (`${COLORS.ink}88`),
       which needs a 6-digit hex to append to and cannot take a var()

   KEEP IN SYNC with src/index.css.
--------------------------------------------------------------- */

export const COLORS = {
  ink: "#1C2118", // text, dark canvases
  inkSoft: "#5A6152", // secondary text
  action: "#2F5741", // the only interactive colour (a deeper green than moss)
  moss: "#4F7355", // money in
  clay: "#A8483A", // money out
  paper: "#F7F5EF", // the page ground
  paperSunk: "#EFECE2", // inset / raised surfaces
  rule: "#DDD8C9", // hairlines
};
