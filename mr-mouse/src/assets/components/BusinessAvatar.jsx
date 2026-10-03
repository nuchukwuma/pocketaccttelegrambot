import React from "react";
import { useImageUrl } from "../media/images";
import { isHex, textOn } from "../theme/palette";

/** "Compare Foods Ltd" -> "CF"; one word -> its first two letters. */
export function initialsOf(name) {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "MM";
  const letters = words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0];
  return letters.toUpperCase();
}

/* The business's logo, or its initials on its brand colour when it has
   no logo. Used in the top bar, the dashboard, page headers and the
   sign-in screen. `size` is in pixels. */
export default function BusinessAvatar({ business, size = 32, className = "", ring = false }) {
  const url = useImageUrl(business?.logoImageId || null);
  const name = business?.businessName || business?.name || "";
  const brand = isHex(business?.brandColor) ? business.brandColor : null;
  const box = { width: size, height: size };
  const ringClass = ring ? "ring-1 ring-on-canvas/25" : "";

  if (url) {
    return (
      <span
        className={`inline-flex items-center justify-center overflow-hidden rounded-lg bg-surface shrink-0 ${ringClass} ${className}`}
        style={box}
      >
        <img src={url} alt={name ? `${name} logo` : "Business logo"} className="w-full h-full object-contain" />
      </span>
    );
  }

  return (
    <span
      role="img"
      aria-label={name ? `${name} logo` : "Business logo"}
      className={`inline-flex items-center justify-center rounded-lg font-display font-semibold shrink-0 select-none ${
        brand ? "" : "bg-action text-on-action"
      } ${ringClass} ${className}`}
      style={{ ...box, fontSize: Math.round(size * 0.4), ...(brand ? { background: brand, color: textOn(brand) } : {}) }}
    >
      {initialsOf(name)}
    </span>
  );
}
