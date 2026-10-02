import React, { useEffect, useRef, useState } from "react";
import { Mouse } from "./MouseArt";

/* ---------------------------------------------------------------
   Splash screen.

   Shown while the session is being restored, before the app can know
   whether to land on the dashboard or the login screen.

   The mice rule a ledger page: the entry lines draw in one by one,
   then the single rule that closes a summed column, then the double
   rule under the total — the same convention the real pages use. So
   the loading indicator is the app's own subject matter doing its own
   job, rather than a spinner borrowed from anywhere.

   It holds for a minimum beat so it reads as intentional rather than
   as a flash, and it will not hand off until the caller says the
   session is actually resolved — whichever takes longer.
--------------------------------------------------------------- */

const MIN_VISIBLE_MS = 1900;
const FADE_MS = 340;

export default function SplashScreen({ ready = true, onDone }) {
  const [minElapsed, setMinElapsed] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const finished = useRef(false);

  useEffect(() => {
    const t = setTimeout(() => setMinElapsed(true), MIN_VISIBLE_MS);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!ready || !minElapsed || finished.current) return;
    finished.current = true;
    setLeaving(true);
    const t = setTimeout(() => onDone?.(), FADE_MS);
    return () => clearTimeout(t);
  }, [ready, minElapsed, onDone]);

  return (
    <div
      className={`fixed inset-0 z-50 bg-paper flex flex-col items-center justify-center px-6 splash-root ${
        leaving ? "splash-leaving" : ""
      }`}
      role="status"
      aria-live="polite"
    >
      <span className="sr-only">Opening your books</span>

      <svg
        viewBox="0 0 320 196"
        className="w-full max-w-[320px] h-auto"
        aria-hidden="true"
      >
        {/* the page being ruled */}
        <rect x="58" y="14" width="204" height="132" rx="3"
          fill="#FFFFFF" stroke="var(--color-rule)" strokeWidth="1.5" />

        {/* entry lines, drawn one after another */}
        {[0, 1, 2, 3, 4].map((i) => (
          <line
            key={i}
            className="splash-rule"
            x1="72"
            x2={i === 4 ? 196 : 248}
            y1={40 + i * 15}
            y2={40 + i * 15}
            stroke="var(--color-rule)"
            strokeWidth="2"
            strokeLinecap="round"
            style={{ "--d": `${260 + i * 150}ms` }}
          />
        ))}

        {/* the single rule closes the column being summed */}
        <line className="splash-rule" x1="196" x2="248" y1="118" y2="118"
          stroke="var(--color-ink)" strokeWidth="1.6" strokeLinecap="round"
          style={{ "--d": "1120ms" }} />
        {/* the double rule sits under the total */}
        <line className="splash-rule" x1="196" x2="248" y1="128" y2="128"
          stroke="var(--color-ink)" strokeWidth="1.6" strokeLinecap="round"
          style={{ "--d": "1340ms" }} />
        <line className="splash-rule" x1="196" x2="248" y1="132" y2="132"
          stroke="var(--color-ink)" strokeWidth="1.6" strokeLinecap="round"
          style={{ "--d": "1340ms" }} />

        {/* the clerk: sits at the page edge and works down it */}
        <g transform="translate(258 128)">
          <g className="splash-clerk">
            <Mouse scale={1.3} />
          </g>
        </g>

        {/* two runners along the desk, one fetching a sheet */}
        <g transform="translate(0 186)">
          <g className="splash-run splash-run-1">
            <Mouse carrying scale={1.3} />
          </g>
        </g>
        <g transform="translate(0 186)">
          <g className="splash-run splash-run-2">
            <Mouse scale={1.3} />
          </g>
        </g>

        {/* desk line */}
        <line x1="0" x2="320" y1="188" y2="188"
          stroke="var(--color-rule)" strokeWidth="2" />
      </svg>

      <p className="font-display text-xl font-semibold text-ink mt-7">Mr Mouse</p>
      <p className="font-body text-[13px] text-ink-soft mt-1">Opening your books…</p>
    </div>
  );
}
