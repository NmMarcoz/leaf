import { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Download,
  Loader2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Hint } from "@/components/ui/tooltip";
import type { ContextMenuPosition } from "@/components/ContextMenu";
import { useT } from "@/lib/i18n";
import { canFetchDirectly, type ChapterStatus } from "@/lib/library";
import { cn } from "@/lib/utils";

/** Rows per page of the list. A long series is hundreds of chapters, and a
 * page that long buries the footer's way onward under minutes of scrolling. */
const PAGE = 30;

/** How long one row waits behind the one above it as the list comes in. */
const STAGGER_MS = 22;
/** Past this many rows the stagger stops growing: the rest are below the
 * fold, and making them wait would only delay a list nobody is watching. */
const STAGGER_ROWS = 12;

type Filter = "all" | "downloaded";

/**
 * Chapter order as the source lists it: by number, whatever volume a chapter
 * was filed under. Numbers that are not numbers ("Extra") keep their place
 * after the rest rather than being guessed at.
 */
export function sourceOrder(chapters: ChapterStatus[]): ChapterStatus[] {
  return chapters
    .map((chapter, index) => ({ chapter, index, n: Number.parseFloat(chapter.number) }))
    .sort((a, b) => {
      const an = Number.isNaN(a.n) ? Infinity : a.n;
      const bn = Number.isNaN(b.n) ? Infinity : b.n;
      return an === bn ? a.index - b.index : an - bn;
    })
    .map((entry) => entry.chapter);
}

/** A chapter can be opened: its pages are here, or the source streams them. */
export const isReadable = (chapter: ChapterStatus) =>
  chapter.folder !== null || canFetchDirectly(chapter);

interface ReadingModeChaptersProps {
  /** Every chapter of the series, in source order. */
  chapters: ChapterStatus[];
  /** Where reading left off, so the list opens on the page holding it. */
  resume: string | null;
  missingCount: number;
  /** The series' source by name, for rows that have no source of their own.
   * `null` when it has no name worth showing (an extension's id). */
  sourceName: string | null;
  sourceOf: (chapter: ChapterStatus) => string | null;
  fetchingDirect: ReadonlySet<string>;
  onRead: (chapter: ChapterStatus) => void;
  onFetchDirect: (chapter: string) => void;
  onGet: (chapter: string) => void;
  onGetMissing: (at: ContextMenuPosition) => void;
  /** Rows come in one after another rather than all at once. */
  animate: boolean;
}

/**
 * The series as one list of chapters (Figma "07c · Série · modo de leitura").
 *
 * Reading mode drops the volume shelf, which is how the library is *built*,
 * for the order the source publishes in, which is how it is *read*. Every
 * row opens its chapter — from disk when downloaded, streamed when the source
 * hosts it — and downloading for offline is the secondary action beside it.
 */
export function ReadingModeChapters({
  chapters,
  resume,
  missingCount,
  sourceName,
  sourceOf,
  fetchingDirect,
  onRead,
  onFetchDirect,
  onGet,
  onGetMissing,
  animate,
}: ReadingModeChaptersProps) {
  const t = useT();
  const [filter, setFilter] = useState<Filter>("all");

  const shown = useMemo(
    () => (filter === "downloaded" ? chapters.filter((c) => c.folder !== null) : chapters),
    [chapters, filter],
  );
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));

  // Open on the page with the chapter to read next: someone forty chapters in
  // wants chapter 41 in front of them, not chapter 1.
  const startPage = useMemo(() => {
    const at = resume ? shown.findIndex((c) => c.number === resume) : -1;
    return at < 0 ? 0 : Math.floor(at / PAGE);
  }, [shown, resume]);
  const [page, setPage] = useState(startPage);
  useEffect(() => setPage(startPage), [startPage]);

  const at = Math.min(page, pages - 1);
  const slice = shown.slice(at * PAGE, at * PAGE + PAGE);
  const range =
    slice.length > 0 ? `${slice[0].number}–${slice[slice.length - 1].number}` : "";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label={t("seriesView.chapterFilter")} className="flex gap-2">
          <Chip selected={filter === "all"} onClick={() => setFilter("all")}>
            {t("seriesView.filterAll")}
          </Chip>
          <Chip selected={filter === "downloaded"} onClick={() => setFilter("downloaded")}>
            {t("seriesView.filterDownloaded")}
          </Chip>
        </div>
        <div className="flex-1" />
        {missingCount > 0 && (
          <Button
            variant="outline"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              onGetMissing({ x: r.left, y: r.bottom + 4 });
            }}
          >
            <Download />
            {t("seriesView.getMissing", { count: missingCount })}
          </Button>
        )}
      </div>

      {slice.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line-strong px-6 py-10 text-center text-sm text-text-secondary">
          {filter === "downloaded"
            ? t("seriesView.noDownloadedChapters")
            : t("seriesView.noChaptersListed")}
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-line bg-raised">
          {slice.map((chapter, index) => (
            <ReadingRow
              key={chapter.number}
              chapter={chapter}
              sourceName={sourceName}
              source={sourceOf(chapter)}
              busy={fetchingDirect.has(chapter.number)}
              onRead={() => onRead(chapter)}
              onDownload={() =>
                canFetchDirectly(chapter) ? onFetchDirect(chapter.number) : onGet(chapter.number)
              }
              className={animate ? "rise-in" : undefined}
              delay={animate ? Math.min(index, STAGGER_ROWS) * STAGGER_MS : 0}
            />
          ))}
        </div>
      )}

      <div className="flex min-h-10 items-center gap-2 text-xs text-text-tertiary">
        <Download className="size-3.5 shrink-0" />
        <span className="min-w-0 truncate max-sm:hidden">{t("seriesView.downloadOfflineHint")}</span>
        <div className="flex-1" />
        {range && <span className="shrink-0">{t("seriesView.chaptersRange", { range })}</span>}
        {pages > 1 && (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={at === 0}
              onClick={() => setPage(at - 1)}
              aria-label={t("seriesView.previousChapters")}
              title={t("seriesView.previousChapters")}
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={at >= pages - 1}
              onClick={() => setPage(at + 1)}
              aria-label={t("seriesView.nextChapters")}
              title={t("seriesView.nextChapters")}
            >
              <ChevronRight />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/** Figma "v2/Linha de capítulo", with its download button beside it. */
function ReadingRow({
  chapter,
  sourceName,
  source,
  busy,
  onRead,
  onDownload,
  className,
  delay,
}: {
  chapter: ChapterStatus;
  sourceName: string | null;
  source: string | null;
  busy: boolean;
  onRead: () => void;
  onDownload: () => void;
  className?: string;
  delay: number;
}) {
  const t = useT();
  const have = chapter.folder !== null;
  const readable = isReadable(chapter);
  const read = chapter.read_at !== null;

  const detail = have
    ? [t("seriesView.pagesCount", { count: chapter.page_count }), source ?? sourceName]
        .filter(Boolean)
        .join(" · ") +
      (read
        ? t("seriesView.readSuffix")
        : chapter.last_page > 0
          ? t("seriesView.pageSuffix", { page: chapter.last_page + 1 })
          : "")
    : chapter.unavailable
      ? t("seriesView.notHostedBySource")
      : readable
        ? [t("seriesView.online"), sourceName].filter(Boolean).join(" · ")
        : t("seriesView.notDownloaded");

  const action = read
    ? t("seriesView.reRead")
    : chapter.last_page > 0
      ? t("seriesView.resume")
      : t("seriesView.read");

  return (
    <div
      className={cn("flex h-[52px] items-center border-b border-line pr-2 last:border-b-0", className)}
      style={delay ? { animationDelay: `${delay}ms` } : undefined}
    >
      <button
        type="button"
        onClick={onRead}
        disabled={!readable}
        className="group flex h-full min-w-0 flex-1 items-center gap-3 rounded-lg px-3 text-left transition-colors hover:bg-hover disabled:cursor-default disabled:hover:bg-transparent"
      >
        <span className="w-7 shrink-0 font-mono text-xs text-text-tertiary">{chapter.number}</span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span
            className={cn(
              "truncate text-sm font-medium",
              read ? "text-text-secondary" : "text-foreground",
            )}
          >
            {t("seriesView.chapterNumber", { number: chapter.number })}
            {chapter.title && (
              <span className="font-normal text-text-secondary"> · {chapter.title}</span>
            )}
          </span>
          <span className={cn("truncate text-xs", have || readable ? "text-text-tertiary" : "text-warning")}>
            {detail}
          </span>
        </span>
        {readable && (
          <span className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-text-secondary group-hover:text-foreground">
            <BookOpen className="size-3.5" />
            {action}
          </span>
        )}
      </button>

      {have ? (
        <Hint label={t("seriesView.downloaded")}>
          <span
            role="img"
            aria-label={t("seriesView.downloaded")}
            className="flex size-9 shrink-0 items-center justify-center text-success"
          >
            <CircleCheck className="size-4" />
          </span>
        </Hint>
      ) : (
        <Hint
          label={
            canFetchDirectly(chapter)
              ? t("seriesView.downloadForOffline", { number: chapter.number })
              : chapter.unavailable
                ? t("seriesView.notHostedHint")
                : t("seriesView.pastePageHint")
          }
        >
          <Button
            variant="ghost"
            size="icon"
            className="size-9 shrink-0 text-text-secondary"
            disabled={busy}
            onClick={onDownload}
            aria-label={t("seriesView.downloadForOffline", { number: chapter.number })}
          >
            {busy ? <Loader2 className="animate-spin" /> : <Download />}
          </Button>
        </Hint>
      )}
    </div>
  );
}
