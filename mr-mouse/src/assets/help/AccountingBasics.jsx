import React, { useMemo, useState } from "react";
import { GraduationCap, Search, X } from "lucide-react";
import { useLedger } from "../booksofacc/Ledgercontext";
import { GlobalStyle, TopNav, PageHeader, BackLink, EmptyState } from "../booksofacc/ui";
import { GLOSSARY, searchGlossary } from "./glossary";

/* Accounting basics: the glossary as a page you can search, reached
   from Settings → Help and the end of the guided tour. */
export default function AccountingBasics({ onNavigate }) {
  const { business } = useLedger();
  const [query, setQuery] = useState("");
  const results = useMemo(() => searchGlossary(query), [query]);

  return (
    <div className="min-h-screen w-full bg-paper font-body pb-24">
      <GlobalStyle />
      <TopNav business={business} current="settings" onNavigate={onNavigate} />
      <PageHeader
        business={business}
        icon={GraduationCap}
        title="Accounting basics"
        subtitle="The words Mr Mouse uses, in plain language, with everyday examples."
      />

      <div className="max-w-3xl mx-auto px-5 sm:px-8 pt-8">
        <BackLink onClick={() => onNavigate("settings", { tab: "help" })}>Settings</BackLink>

        <div className="relative mb-6">
          <label htmlFor="basics-search" className="sr-only">
            Search accounting words
          </label>
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink/40 pointer-events-none" />
          <input
            id="basics-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search, e.g. debtors, VAT, profit"
            className="w-full rounded-lg border border-rule bg-surface pl-10 pr-11 min-h-tap font-body text-sm text-ink placeholder:text-ink/40 focus:border-action outline-none"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-0 top-0 min-w-tap min-h-tap flex items-center justify-center text-ink/45 hover:text-ink"
            >
              <X size={16} />
            </button>
          )}
        </div>

        <p className="font-body text-label text-ink-soft mb-3" role="status">
          {query ? `${results.length} of ${GLOSSARY.length} match “${query}”` : `${GLOSSARY.length} words`}
        </p>

        {results.length === 0 ? (
          <EmptyState title="No match" subtitle="Try a shorter word, like “profit” or “owe”." />
        ) : (
          <ul className="space-y-3">
            {results.map((g) => (
              <li key={g.term} className="rounded-lg border border-rule bg-surface p-5">
                <h2 className="font-display text-lg font-semibold text-ink mb-1.5">{g.term}</h2>
                <p className="font-body text-sm text-ink leading-relaxed">{g.tip}</p>
                <p className="font-body text-sm text-ink-soft leading-relaxed mt-2.5 pl-3 border-l-2 border-action/40">
                  <span className="font-semibold text-ink">For example: </span>
                  {g.example}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
