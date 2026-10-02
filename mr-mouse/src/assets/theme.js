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
  ink: "#161A33", // text, dark canvases (HordeMart text-primary)
  inkSoft: "#4A4F6A", // secondary text
  action: "#22307A", // the only interactive colour (HordeMart indigo)
  moss: "#12784A", // money in
  clay: "#B4472A", // money out (HordeMart kola)
  paper: "#FCFCF8", // the page ground
  paperSunk: "#F1F2F8", // inset / raised surfaces
  rule: "#DFE2EE", // hairlines
};
