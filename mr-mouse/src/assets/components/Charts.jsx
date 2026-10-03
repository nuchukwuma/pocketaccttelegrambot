import React, { useState } from "react";
import { formatMoney } from "../booksofacc/ui";

/* ---------------------------------------------------------------
   Charts.

   Series colour comes from --color-chart-in / --color-chart-out, which
   are NOT the moss/clay used for money in running text. In text a
   figure carries a sign and sits in a labelled column, so colour only
   reinforces; in a chart colour is the identity, and moss vs clay
   scores ΔE 4.9 for deuteranopia — two bars a colourblind reader
   cannot tell apart. The chart pair was chosen by running the palette
   validator until every check passed.

   Specs held to throughout: bars capped at 24px with a 4px rounded
   data-end and a square baseline, hairline solid gridlines one step off
   the surface, a 2px surface gap between adjacent bars, labels
   selective rather than one per mark, and text in ink tokens rather
   than the series colour.
--------------------------------------------------------------- */

const AXIS_TICKS = 3;

/* Round a maximum up to something a person would actually write on an
   axis — 1/2/5 × a power of ten — so ticks read 0 / 250,000 / 500,000
   rather than 0 / 237,411 / 474,822. */
function niceCeil(value) {
  if (!value || value <= 0) return 1;
  const exp = Math.floor(Math.log10(value));
  const pow = Math.pow(10, exp);
  const frac = value / pow;
  const nice = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  return nice * pow;
}

const compact = (n) => {
  const v = Math.abs(n);
  if (v >= 1_000_000) return `${(n / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}m`;
  if (v >= 1_000) return `${(n / 1_000).toFixed(v >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(n));
};

function Swatch({ color, label }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="w-2.5 h-2.5 rounded-xs" style={{ background: color }} />
      <span className="font-body text-caption text-ink-soft">{label}</span>
    </span>
  );
}

/* ---------------------------------------------------------------
   Cashflow — money in and money out, by day.
--------------------------------------------------------------- */

export function CashflowChart({ days, maxDayValue }) {
  const [hover, setHover] = useState(null);

  const top = niceCeil(Math.max(maxDayValue || 0, 1));
  const H = 132;
  const PAD_B = 22;
  const PAD_T = 10;
  const plotH = H - PAD_B - PAD_T;

  // Bars are laid out in percentage of the plot width so the chart is
  // fluid; only the vertical scale needs real units.
  const slot = 100 / Math.max(days.length, 1);
  const y = (v) => PAD_T + plotH - (v / top) * plotH;

  // Label only the biggest day, not every bar.
  const peakIndex = days.reduce(
    (best, d, i) => (d.inflow + d.outflow > days[best].inflow + days[best].outflow ? i : best),
    0
  );

  return (
    <div className="relative">
      <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" className="w-full h-[132px] block">
        {/* gridlines — hairline, solid, recessive */}
        {Array.from({ length: AXIS_TICKS + 1 }).map((_, i) => {
          const v = (top / AXIS_TICKS) * i;
          return (
            <line
              key={i}
              x1="0"
              x2="100"
              y1={y(v)}
              y2={y(v)}
              stroke="var(--color-chart-grid)"
              strokeWidth="0.5"
              vectorEffect="non-scaling-stroke"
            />
          );
        })}

        {days.map((d, i) => {
          const cx = slot * i;
          const barW = Math.min(slot * 0.34, 3.2);
          const gap = 0.35; // the 2px surface gap, in viewBox units
          const inH = Math.max(d.inflow > 0 ? 1.5 : 0, (d.inflow / top) * plotH);
          const outH = Math.max(d.outflow > 0 ? 1.5 : 0, (d.outflow / top) * plotH);
          const groupLeft = cx + slot / 2 - barW - gap / 2;
          return (
            <g key={d.date} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              {/* generous hit target, bigger than the marks */}
              <rect x={cx} y="0" width={slot} height={H} fill="transparent" />
              {d.inflow > 0 && (
                <rect
                  x={groupLeft}
                  y={PAD_T + plotH - inH}
                  width={barW}
                  height={inH}
                  rx="0.8"
                  fill="var(--color-chart-in)"
                  opacity={hover === null || hover === i ? 1 : 0.45}
                />
              )}
              {d.outflow > 0 && (
                <rect
                  x={groupLeft + barW + gap}
                  y={PAD_T + plotH - outH}
                  width={barW}
                  height={outH}
                  rx="0.8"
                  fill="var(--color-chart-out)"
                  opacity={hover === null || hover === i ? 1 : 0.45}
                />
              )}
            </g>
          );
        })}

        {/* baseline sits on top of the bars' square end */}
        <line
          x1="0" x2="100" y1={PAD_T + plotH} y2={PAD_T + plotH}
          stroke="var(--color-rule)" strokeWidth="1" vectorEffect="non-scaling-stroke"
        />
      </svg>

      {/* Axis labels live in HTML rather than the stretched SVG, so the
          non-uniform preserveAspectRatio never distorts the type. */}
      <div className="absolute left-0 top-0 h-[132px] w-[42px] pointer-events-none">
        {Array.from({ length: AXIS_TICKS + 1 }).map((_, i) => {
          const v = (top / AXIS_TICKS) * i;
          return (
            <span
              key={i}
              className="absolute right-0 font-mono text-micro text-ink-soft -translate-y-1/2"
              style={{ top: `${y(v)}px` }}
            >
              {compact(v)}
            </span>
          );
        })}
      </div>

      <div className="flex items-center justify-between mt-1.5 pl-[46px]">
        <span className="font-body text-tiny text-ink-soft">
          {days.length ? shortDay(days[0].date) : ""}
        </span>
        <span className="font-body text-tiny text-ink-soft">
          {days.length ? shortDay(days[days.length - 1].date) : ""}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-4 mt-3">
        <Swatch color="var(--color-chart-in)" label="Money in" />
        <Swatch color="var(--color-chart-out)" label="Money out" />
        {days[peakIndex] && days[peakIndex].inflow + days[peakIndex].outflow > 0 && (
          <span className="font-body text-caption text-ink-soft ml-auto">
            Busiest: {shortDay(days[peakIndex].date)},{" "}
            <span className="font-mono">
              {formatMoney(days[peakIndex].inflow + days[peakIndex].outflow)}
            </span>
          </span>
        )}
      </div>

      {hover !== null && days[hover] && (
        <div className="absolute top-0 left-1/2 -translate-x-1/2 bg-canvas text-on-canvas rounded-md px-3 py-2 pointer-events-none shadow-lg">
          <p className="font-body text-tiny text-on-canvas/60 mb-0.5">{shortDay(days[hover].date)}</p>
          <p className="font-mono text-caption">In {formatMoney(days[hover].inflow)}</p>
          <p className="font-mono text-caption">Out {formatMoney(days[hover].outflow)}</p>
        </div>
      )}
    </div>
  );
}

function shortDay(iso) {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/* ---------------------------------------------------------------
   Expense breakdown — one series, so no legend: the heading already
   says what is plotted. Value rides the end of each bar.
--------------------------------------------------------------- */

export function ExpenseBars({ items }) {
  const top = Math.max(...items.map((e) => e.amount), 1);
  return (
    <div className="space-y-3.5">
      {items.map((e) => (
        <div key={e.label}>
          <div className="flex items-baseline justify-between gap-3 mb-1.5">
            <span className="font-body text-label text-ink truncate">{e.label}</span>
            <span className="font-mono text-caption text-ink-soft shrink-0">{formatMoney(e.amount)}</span>
          </div>
          <div className="h-2 rounded-xs bg-paper-sunk overflow-hidden">
            <div
              className="h-full rounded-xs"
              style={{
                width: `${Math.max(2, (e.amount / top) * 100)}%`,
                background: "var(--color-chart-out)",
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
