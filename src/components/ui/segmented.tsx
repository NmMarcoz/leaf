import { cn } from "@/lib/utils";

/** The design's segmented control: a sunken track, the chosen one raised. */
export function Segmented<V extends string>({
  value,
  onChange,
  options,
}: {
  value: V;
  onChange: (value: V) => void;
  /** `[value, label, disabledReason?]` — a reason disables the option. */
  options: [string, string, string?][];
}) {
  return (
    <div role="radiogroup" className="flex shrink-0 gap-0.5 rounded-[10px] bg-sunken p-[3px]">
      {options.map(([option, label, disabled]) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          disabled={!!disabled}
          title={disabled}
          onClick={() => onChange(option as V)}
          className={cn(
            "rounded-lg px-2.5 py-[5px] text-xs font-medium transition-colors",
            value === option
              ? "bg-raised text-foreground shadow-xs"
              : "text-text-secondary enabled:hover:text-foreground disabled:opacity-45",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
