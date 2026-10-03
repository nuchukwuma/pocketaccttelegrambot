import React from "react";
import { Compass, GraduationCap, ChevronRight } from "lucide-react";
import { useTour } from "../tour/Tour";
import { usePref } from "../booksofacc/Ledgercontext";
import { TOUR_PREF, TOUR_STEPS, stepIndex } from "../tour/steps";

/* Settings → Help: the guided tour again, and the accounting glossary. */
export default function HelpTab({ onNavigate }) {
  const { start } = useTour();
  const progress = usePref(TOUR_PREF, null);
  const midway = progress && (progress.status === "active" || progress.status === "paused");
  const at = midway ? stepIndex(progress.step) : 0;

  const status = !progress
    ? "Not taken yet"
    : progress.status === "done"
    ? "Finished"
    : progress.status === "skipped"
    ? "Skipped"
    : `Stopped at step ${at + 1} of ${TOUR_STEPS.length}`;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-rule bg-surface p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="w-10 h-10 rounded-full bg-action-sunk flex items-center justify-center shrink-0">
            <Compass size={18} className="text-action" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-lg text-ink">Guided tour</h2>
            <p className="font-body text-sm text-ink-soft mt-1">
              A 2-minute walk through Home, Add entry, the Cash Book, Inventory, invoices and your reports — what each
              one is for, with everyday examples.
            </p>
            <p className="font-body text-label text-ink-soft mt-2">{status}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mt-4">
          {midway && (
            <button
              onClick={() => start(at)}
              className="rounded-md bg-action px-4 min-h-tap font-body text-sm font-medium text-on-action hover:bg-action-deep"
            >
              Resume at step {at + 1}
            </button>
          )}
          <button
            onClick={() => start(0)}
            className={
              midway
                ? "rounded-md border border-rule px-4 min-h-tap font-body text-sm text-ink"
                : "rounded-md bg-action px-4 min-h-tap font-body text-sm font-medium text-on-action hover:bg-action-deep"
            }
          >
            {progress ? "Take the tour again" : "Start the tour"}
          </button>
        </div>
      </div>

      <button
        onClick={() => onNavigate("basics")}
        className="w-full text-left rounded-lg border border-rule bg-surface p-5 sm:p-6 flex items-center gap-3 hover:border-action/50 transition-colors"
      >
        <span className="w-10 h-10 rounded-full bg-action-sunk flex items-center justify-center shrink-0">
          <GraduationCap size={18} className="text-action" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-lg text-ink">Accounting basics</span>
          <span className="block font-body text-sm text-ink-soft mt-1">
            Debtors, creditors, VAT, profit and more — explained simply, with Naira examples. Searchable.
          </span>
        </span>
        <ChevronRight size={18} className="text-ink/40 shrink-0" />
      </button>
    </div>
  );
}
