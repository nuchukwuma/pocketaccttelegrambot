import React from "react";
import { useImageUrl } from "../media/images";
import { COLOR_TOKENS, DEFAULT_THEME } from "../theme/tokens";
import { fitAccent, isHex } from "../theme/palette";

/* An invoice is paper: black on white whatever theme the app wears
   (a dark theme would otherwise print light-grey text on white). Spread
   this on the invoice's container to pin the light palette inside it. */
export const PAPER_VARS = Object.fromEntries(
  COLOR_TOKENS.map((name) => [`--color-${name}`, DEFAULT_THEME.colors[name]])
);

const PAPER = { surface: "#ffffff", paper: "#ffffff", action: DEFAULT_THEME.colors.action };

/** The business's brand colour, made readable on white paper if needed. */
export function invoiceBrandColor(business) {
  if (!isHex(business?.brandColor)) return DEFAULT_THEME.colors.action;
  return fitAccent(business.brandColor, PAPER, "light").color;
}

/* Top of an invoice: brand rule, logo, the business's details, and the
   invoice number and date. */
export default function InvoiceLetterhead({ business, number, date }) {
  const logoUrl = useImageUrl(business?.logoImageId || null);
  const brand = invoiceBrandColor(business);
  const name = business?.businessName || business?.name || "Your business";
  const address = business?.address || business?.location || "";
  const phone = business?.phone || business?.contact || "";

  return (
    <div>
      <div className="h-1.5 rounded-full mb-6 print:rounded-none" style={{ background: brand }} />
      <div className="flex justify-between items-start gap-6 rule-sum pb-6 mb-6">
        <div className="flex items-start gap-4 min-w-0">
          {logoUrl && (
            <img src={logoUrl} alt={`${name} logo`} className="w-16 h-16 object-contain shrink-0" />
          )}
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-bold text-ink mb-1 break-words">{name}</h1>
            {address && <p className="font-body text-label text-ink-soft">{address}</p>}
            {phone && <p className="font-body text-label text-ink-soft">{phone}</p>}
          </div>
        </div>
        <div className="text-right shrink-0">
          <h2 className="font-display text-lg font-semibold tracking-wide uppercase" style={{ color: brand }}>
            Invoice
          </h2>
          {number !== undefined && <p className="font-mono text-label text-ink-soft">#{number}</p>}
          {date && <p className="font-mono text-label text-ink-soft">{date}</p>}
        </div>
      </div>
    </div>
  );
}
