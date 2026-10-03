import React from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import BusinessAvatar from "./BusinessAvatar";
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
  compact = false,
}) {
  const name = business?.businessName?.trim() || "Your business";
  const tone = pulse?.tone;
  const ToneIcon = tone === "positive" ? TrendingUp : tone === "negative" ? TrendingDown : Minus;
  const toneClass =
    tone === "positive" ? "text-moss-lift" : tone === "negative" ? "text-clay-lift" : "text-on-canvas/60";

  return (
    <div data-tour="dashboard-hero" className="relative bg-canvas overflow-hidden">
      <div className={`max-w-5xl mx-auto px-5 sm:px-8 ${compact ? "pt-4 pb-5" : "pt-7 pb-9"}`}>
        <div className={`flex items-start justify-between gap-4 ${compact ? "mb-3" : "mb-6"}`}>
          <div className="flex items-center gap-3 min-w-0">
            <BusinessAvatar business={business} size={compact ? 32 : 44} ring />
            <span className="font-display text-base sm:text-lg font-semibold text-on-canvas truncate">{name}</span>
          </div>
          {right}
        </div>

        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-8">
          <div className="min-w-0">
            <p className="font-body text-label text-on-canvas/55 mb-1.5">Cash available</p>
            <p className={`font-mono leading-none text-on-canvas tracking-tight ${compact ? "text-[1.8rem]" : "text-[2.4rem] sm:text-[3rem]"}`}>
              <AnimatedFigure value={cashAvailable} format={formatMoney} />
            </p>

            <div className={`flex flex-wrap items-center gap-x-6 gap-y-2 ${compact ? "mt-3" : "mt-5"}`}>
              <span className={`inline-flex items-center gap-1.5 font-body text-sm ${toneClass}`}>
                <ToneIcon size={15} /> {pulse?.verdict}
              </span>
              <span className="font-body text-sm text-on-canvas/45">
                Petty cash {formatMoney(pettyCash)}
              </span>
            </div>

            {pulse?.message && !compact && (
              <p className="font-body text-sm text-on-canvas/55 max-w-md mt-3">{pulse.message}</p>
            )}
          </div>

          {!compact && <LedgerDesk
            entriesThisWeek={entriesThisWeek}
            className="w-[260px] max-w-full h-auto shrink-0 hidden sm:block"
          />}
        </div>
      </div>
    </div>
  );
}
