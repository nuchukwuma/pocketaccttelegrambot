import React from "react";

/* ---------------------------------------------------------------
   The house artwork.

   Mice built from SVG primitives — ellipses, circles, a curve for the
   tail — rather than traced path data, so they weigh a few hundred
   bytes, stay sharp at any size, and take their colour from the theme
   instead of being baked in. Shared by the splash screen and the
   dashboard so there is one drawing of a mouse in this codebase, not
   two that drift apart.

   Every mouse is drawn facing right with its feet on y=0, so a caller
   only has to translate it into place.
--------------------------------------------------------------- */

export function Mouse({ carrying = false, scale = 1, ink = "var(--color-ink)", paper = "var(--color-paper)", animated = true }) {
  return (
    <g transform={`scale(${scale})`}>
      <g className={animated ? "splash-mouse" : undefined}>
        <path d="M -1 -3 q -9 0 -11 -7" fill="none" stroke={ink} strokeWidth="1.3" strokeLinecap="round" />
        <line
          className={animated ? "splash-leg splash-leg-a" : undefined}
          x1="3" y1="-1" x2="3" y2="2.5" stroke={ink} strokeWidth="1.3" strokeLinecap="round"
        />
        <line
          className={animated ? "splash-leg splash-leg-b" : undefined}
          x1="10" y1="-1" x2="10" y2="2.5" stroke={ink} strokeWidth="1.3" strokeLinecap="round"
        />
        <ellipse cx="7" cy="-5" rx="8" ry="5.2" fill={ink} />
        <circle cx="15.5" cy="-6.5" r="4.1" fill={ink} />
        <circle cx="14" cy="-11" r="2.6" fill={ink} />
        <circle cx="14" cy="-11" r="1.1" fill={paper} />
        <path d="M 19 -6 l 3.4 1.2" fill="none" stroke={ink} strokeWidth="1.1" strokeLinecap="round" />
        <circle cx="16.6" cy="-7.6" r="0.7" fill={paper} />

        {carrying && (
          <g className={animated ? "splash-sheet" : undefined}>
            <rect x="2" y="-21" width="13" height="9" rx="1" fill={paper} stroke={ink} strokeWidth="1" />
            <line x1="4.5" y1="-18" x2="12.5" y2="-18" stroke={ink} strokeWidth="0.8" opacity="0.5" />
            <line x1="4.5" y1="-15.5" x2="10" y2="-15.5" stroke={ink} strokeWidth="0.8" opacity="0.5" />
          </g>
        )}
      </g>
    </g>
  );
}

/* The desk scene that heads the dashboard: a ledger propped open, a
   clerk working it, a stack of filed sheets and a runner bringing the
   next one over. Drawn light-on-dark because it sits on the ink band.

   `entriesThisWeek` decides how many sheets are on the spike — the
   drawing reports something true about the business rather than being
   decoration that looks the same for everybody. */
export function LedgerDesk({ entriesThisWeek = 0, className = "" }) {
  const sheets = Math.max(0, Math.min(5, entriesThisWeek));
  const sage = "var(--color-moss-lift)";
  const light = "rgba(255,255,255,0.88)";
  const faint = "rgba(255,255,255,0.28)";

  return (
    <svg
      viewBox="0 0 260 132"
      className={className}
      role="img"
      aria-label={`Illustration of a ledger desk with ${sheets} ${sheets === 1 ? "entry" : "entries"} filed this week`}
      fill="none"
    >
      {/* the open ledger, two leaves meeting at the spine */}
      <path d="M 66 96 L 66 44 Q 96 36 124 44 L 124 96 Q 96 88 66 96 Z"
        fill="rgba(255,255,255,0.07)" stroke={faint} strokeWidth="1.4" />
      <path d="M 124 96 L 124 44 Q 152 36 182 44 L 182 96 Q 152 88 124 96 Z"
        fill="rgba(255,255,255,0.07)" stroke={faint} strokeWidth="1.4" />
      <line x1="124" y1="44" x2="124" y2="96" stroke={faint} strokeWidth="1.4" />

      {/* ruled entries on the left leaf, the ruled total on the right */}
      {[0, 1, 2].map((i) => (
        <line key={i} x1="75" x2="115" y1={56 + i * 11} y2={54 + i * 11}
          stroke={faint} strokeWidth="1.6" strokeLinecap="round" />
      ))}
      {[0, 1].map((i) => (
        <line key={i} x1="133" x2="173" y1={54 + i * 11} y2={56 + i * 11}
          stroke={faint} strokeWidth="1.6" strokeLinecap="round" />
      ))}
      {/* the double rule under the total — the app's own convention */}
      <line x1="147" y1="78" x2="173" y2="79" stroke={sage} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="147" y1="82" x2="173" y2="83" stroke={sage} strokeWidth="1.5" strokeLinecap="round" />

      {/* the clerk, at the spine */}
      <g transform="translate(112 44)">
        <Mouse scale={1.15} ink={light} paper="var(--color-ink)" animated={false} />
      </g>

      {/* filed sheets, one per entry this week */}
      {Array.from({ length: sheets }).map((_, i) => (
        <rect key={i} x={200 + i * 3} y={88 - i * 7} width="34" height="12" rx="1.5"
          fill="rgba(255,255,255,0.06)" stroke={faint} strokeWidth="1.1" />
      ))}
      {sheets > 0 && (
        <line x1={202} y1={94 - (sheets - 1) * 7} x2={228} y2={94 - (sheets - 1) * 7}
          stroke={faint} strokeWidth="1.2" strokeLinecap="round" />
      )}

      {/* a runner bringing the next sheet over */}
      <g transform="translate(20 100)">
        <Mouse carrying scale={1.15} ink={light} paper="var(--color-ink)" animated={false} />
      </g>

      {/* the desk */}
      <line x1="4" y1="102" x2="256" y2="102" stroke={faint} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
