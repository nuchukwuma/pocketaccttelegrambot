import React from "react";
import { Building2, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { LedgerDesk } from "./MouseArt";
import { AnimatedFigure, formatMoney } from "../booksofacc/ui";

/* ---------------------------------------------------------------
   The dashboard masthead.

   The other pages open with the shared PageHeader, which is a title and
   some business detail — right for a book you came to read. The
   dashboard is the screen people land on every morning, so it leads
   with the one number they came for (cash available), the week's
   verdict in a sentence, and the desk artwork.

   The artwork is not decoration bolted on: the sheets on the spike
   count this week's entries, so it says something true and changes as
   the business works.
--------------------------------------------------------------- */

export default function DashboardHero({
  business,
  cashAvailable,
  pettyCash,
  pulse,
  entriesThisWeek,
  right,
}) {
  const name = business?.businessName?.trim() || "Your business";
  const tone = pulse?.tone;
  const ToneIcon = tone === "positive" ? TrendingUp : tone === "negative" ? TrendingDown : Minus;
  const toneClass =
    tone === "positive" ? "text-moss-lift" : tone === "negative" ? "text-clay-lift" : "text-white/60";

  return (
    <div className="relative bg-ink overflow-hidden">
      <div className="max-w-5xl mx-auto px-5 sm:px-8 pt-7 pb-9">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div className="flex items-center gap-2 min-w-0">
            <Building2 size={14} className="text-moss-lift shrink-0" />
            <span className="font-body text-sm text-white/70 truncate">{name}</span>
          </div>
          {right}
        </div>

        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-8">
          <div className="min-w-0">
            <p className="font-body text-[13px] text-white/55 mb-1.5">Cash available</p>
            <p className="font-mono text-[2.4rem] sm:text-[3rem] leading-none text-white tracking-tight">
              <AnimatedFigure value={cashAvailable} format={formatMoney} />
            </p>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-5">
              <span className={`inline-flex items-center gap-1.5 font-body text-sm ${toneClass}`}>
                <ToneIcon size={15} /> {pulse?.verdict}
              </span>
              <span className="font-body text-sm text-white/45">
                Petty cash {formatMoney(pettyCash)}
              </span>
            </div>

            {pulse?.message && (
              <p className="font-body text-sm text-white/55 max-w-md mt-3">{pulse.message}</p>
            )}
          </div>

          <LedgerDesk
            entriesThisWeek={entriesThisWeek}
            className="w-[260px] max-w-full h-auto shrink-0 hidden sm:block"
          />
        </div>
      </div>
    </div>
  );
}
