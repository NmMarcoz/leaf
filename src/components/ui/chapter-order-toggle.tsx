import { ArrowDown01, ArrowDown10 } from "lucide-react";

import { useT } from "@/lib/i18n";
import type { ChapterOrder } from "@/lib/chapterOrder";
import { cn } from "@/lib/utils";

/**
 * Flip a chapter list between first-chapter-first and newest-first.
 *
 * The icon shows the order the list is in now; the label says what a press
 * does. `ink` is for the reader's chrome, where the paper styles vanish.
 */
export function ChapterOrderToggle({
  order,
  onToggle,
  tone = "paper",
  className,
}: {
  order: ChapterOrder;
  onToggle: () => void;
  tone?: "paper" | "ink";
  className?: string;
}) {
  const t = useT();
  const label = order === "asc" ? t("common.showNewestFirst") : t("common.showOldestFirst");
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      title={label}
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        tone === "ink"
          ? "text-on-ink-muted hover:bg-ink hover:text-on-ink"
          : "text-text-secondary hover:bg-hover hover:text-foreground",
        className,
      )}
    >
      {order === "asc" ? <ArrowDown01 className="size-4" /> : <ArrowDown10 className="size-4" />}
    </button>
  );
}
