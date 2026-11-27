import { BookOpen, ChevronsLeft, ChevronsRight, X } from "lucide-react";

import { WheelPicker } from "@/components/ui/wheel-picker";
import { usePresence } from "@/hooks/usePresence";
import { useT } from "@/lib/i18n";
import { isMobile } from "@/lib/platform";
import type { ReaderTarget } from "@/lib/reader";
import { cn } from "@/lib/utils";

/** One entry in the picker: a chapter number and how to open it. */
export interface DockChapter {
  number: string;
  target: ReaderTarget;
}

interface ReaderChapterDockProps {
  /** Whether the dock itself is showing. The picker keeps it up while open. */
  visible: boolean;
  chapters: DockChapter[];
  /** The chapter being read, by number. */
  current: string;
  previous: ReaderTarget | null;
  next: ReaderTarget | null;
  /** Right-to-left: the next chapter is to the left, as the pages are. */
  rtl: boolean;
  pickerOpen: boolean;
  onPickerOpenChange: (open: boolean) => void;
  onNavigate: (target: ReaderTarget) => void;
  /** Where the dock sits above the bottom edge (Tailwind classes). */
  className?: string;
}

/**
 * The chapter dock (Figma "v2 · Leitor · controles por proximidade").
 *
 * The page scrubber moves within a chapter; this moves between them — a step
 * either way, or a jump through the picker. It is not part of the always-on
 * chrome: on a desktop it rises when the pointer comes near the bottom of the
 * page, on a phone it comes with the chrome a tap in the middle shows. A
 * reader spends most of a chapter not wanting to leave it, so the dock stays
 * out of the picture until asked for.
 */
export function ReaderChapterDock({
  visible,
  chapters,
  current,
  previous,
  next,
  rtl,
  pickerOpen,
  onPickerOpenChange,
  onNavigate,
  className,
}: ReaderChapterDockProps) {
  const t = useT();
  const dock = usePresence(visible || pickerOpen, 160);
  const picker = usePresence(pickerOpen, 180);

  if (!dock.mounted && !picker.mounted) return null;

  // Left and right follow the page, not the list: in a right-to-left book the
  // chapter after this one is further left, the way the pages already turn.
  const left = rtl ? next : previous;
  const right = rtl ? previous : next;
  const at = Math.max(
    0,
    chapters.findIndex((c) => c.number === current),
  );

  return (
    <>
      {picker.mounted && (
        <>
          {/* Figma "Dismiss picker outside": a click anywhere else closes the
              picker and does nothing more — it must not also turn the page. */}
          <div
            aria-hidden
            className="absolute inset-0 z-30"
            onPointerDown={(event) => {
              event.stopPropagation();
              onPickerOpenChange(false);
            }}
          />
          <div
            className={cn(
              "pointer-events-none absolute inset-x-0 z-40 flex justify-center px-3",
              // 16px above the dock, whose top is 56px above its own bottom.
              "bottom-[calc(4.25rem+72px)] sm:bottom-[152px]",
            )}
          >
            <div
              role="dialog"
              aria-label={t("readerView.chapters")}
              className={cn(
                "pointer-events-auto flex w-[296px] max-w-full flex-col rounded-[28px] border-[0.5px] border-on-ink-muted bg-ink-raised pb-3 pt-3 text-on-ink shadow-[0_10px_15px_-3px_rgb(0_0_0/0.1),0_4px_6px_-4px_rgb(0_0_0/0.1)]",
                picker.leaving ? "picker-out" : "picker-in",
              )}
            >
              <div className="flex h-7 items-center gap-2 px-4">
                <p className="text-sm font-medium">{t("readerView.chapters")}</p>
                <div className="flex-1" />
                <span className="font-mono text-xs text-on-ink-muted">{chapters.length}</span>
                <button
                  type="button"
                  aria-label={t("readerView.closeChapters")}
                  title={t("readerView.closeChapters")}
                  onClick={() => onPickerOpenChange(false)}
                  className="-mr-1.5 flex size-7 items-center justify-center rounded-md text-on-ink transition-colors hover:bg-ink"
                >
                  <X className="size-4" />
                </button>
              </div>

              <WheelPicker
                // Remounted per chapter, so it always opens on the one being
                // read rather than wherever it was last left.
                key={current}
                className="mx-3 mt-3"
                labels={chapters.map((c) => t("readerView.chapterLabel", { number: c.number }))}
                current={at}
                ariaLabel={t("readerView.chapters")}
                onCancel={() => onPickerOpenChange(false)}
                onPick={(index) => {
                  onPickerOpenChange(false);
                  const chosen = chapters[index];
                  if (chosen && chosen.number !== current) onNavigate(chosen.target);
                }}
              />

              <p className="mt-2 text-center text-xs text-on-ink-muted">
                {isMobile ? t("readerView.pickerHintTouch") : t("readerView.pickerHint")}
              </p>
            </div>
          </div>
        </>
      )}

      {dock.mounted && (
        <div className={cn("pointer-events-none absolute inset-x-0 z-40 flex justify-center", className)}>
          <div
            className={cn(
              "pointer-events-auto flex h-14 items-center gap-2 rounded-full border border-on-ink-muted bg-ink-raised p-2 text-on-ink drop-shadow-[0_10px_7.5px_rgb(0_0_0/0.1)]",
              dock.leaving ? "dock-out" : "dock-in",
            )}
          >
            <DockStep
              label={t(rtl ? "readerView.nextChapter" : "readerView.previousChapter")}
              disabled={!left}
              onClick={() => left && onNavigate(left)}
            >
              <ChevronsLeft className="size-4" />
            </DockStep>

            <button
              type="button"
              aria-expanded={pickerOpen}
              aria-haspopup="dialog"
              disabled={chapters.length === 0}
              onClick={() => onPickerOpenChange(!pickerOpen)}
              className="flex h-10 w-[136px] items-center gap-2 rounded-full bg-ink pl-3.5 pr-4 text-sm font-medium transition-colors hover:bg-ink-pressed disabled:opacity-50"
            >
              <BookOpen className="size-4 shrink-0" />
              <span className="truncate">{t("readerView.chapters")}</span>
            </button>

            <DockStep
              label={t(rtl ? "readerView.previousChapter" : "readerView.nextChapter")}
              disabled={!right}
              onClick={() => right && onNavigate(right)}
            >
              <ChevronsRight className="size-4" />
            </DockStep>
          </div>
        </div>
      )}
    </>
  );
}

function DockStep({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-10 shrink-0 items-center justify-center rounded-lg text-on-ink transition-colors hover:bg-ink disabled:opacity-35 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
