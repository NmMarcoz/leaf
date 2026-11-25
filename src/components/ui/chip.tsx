import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A single-choice pill — the Figma "Chip". Used where a few short options sit
 * side by side (reader fit and direction, theme, which title to use). Put a
 * group of them in a `role="radiogroup"` container.
 */
export const Chip = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }
>(({ selected = false, className, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    role="radio"
    aria-checked={selected}
    className={cn(
      "inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
      // Figma "v2/Chip de filtro": active is solid ink, the rest an outline.
      selected
        ? "border-strong bg-strong text-on-strong"
        : "border-line text-text-secondary hover:border-line-strong hover:bg-hover",
      className,
    )}
    {...props}
  />
));
Chip.displayName = "Chip";

/**
 * A single-choice option with an explanation — the Figma "Option card".
 */
export function OptionCard({
  selected,
  title,
  detail,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  selected: boolean;
  title: React.ReactNode;
  detail?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={cn(
        "flex w-full flex-col gap-0.5 rounded-lg border px-3.5 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected ? "border-strong bg-sunken" : "border-line bg-raised hover:bg-hover",
        className,
      )}
      {...props}
    >
      <span className="text-sm font-medium text-foreground">
        {title}
      </span>
      {detail && <span className="text-xs leading-4 text-text-secondary">{detail}</span>}
    </button>
  );
}
