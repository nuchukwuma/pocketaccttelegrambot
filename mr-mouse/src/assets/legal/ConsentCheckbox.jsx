import React from "react";

/* The one way Mr Mouse asks for agreement: never pre-ticked, saying
   exactly what is agreed to. A button stays disabled until it is ticked. */
export default function ConsentCheckbox({ id, checked, onChange, children }) {
  return (
    <label htmlFor={id} className="flex items-start gap-3 cursor-pointer font-body text-[13px] leading-relaxed text-ink-soft">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-[18px] w-[18px] shrink-0 accent-[var(--color-action)]"
      />
      <span>{children}</span>
    </label>
  );
}
