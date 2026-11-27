import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { BookOpen, CircleCheck, CornerDownRight, Download, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ChapterOrderToggle } from "@/components/ui/chapter-order-toggle";
import { Chip } from "@/components/ui/chip";
import { Hint } from "@/components/ui/tooltip";
import type { ContextMenuPosition } from "@/components/ContextMenu";
import { inOrder, useChapterOrder } from "@/lib/chapterOrder";
import { useT } from "@/lib/i18n";
import { canFetchDirectly, type ChapterStatus } from "@/lib/library";
import { cn } from "@/lib/utils";

/** One row, border included (Figma "v2/Linha de capítulo": 52). Every row is
 * this tall, which is what lets the list work out what is on screen from the
 * scroll position alone instead of measuring a thousand rows. */
const ROW = 52;
/** Rows drawn beyond either edge of the screen, so a fast scroll or a fling
 * on a phone never shows a gap before the next rows mount. */
const OVERSCAN = 10;

/** How long one row waits behind the one above it as the list comes in. */
const STAGGER_MS = 22;
/** Rows past this many in get no extra delay: they are below the fold. */
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
  /** The page's scroller. The list has no scroll of its own: it is the page,
   * and works out which rows to draw from where the page is. */
  scroller: React.RefObject<HTMLElement | null>;
  /** "9 volumes · 48 chapters", beside the title. */
  summary: string;
  /** Where reading left off: offered as a jump from the pinned header. */
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
 *
 * Scrolls like a long landing page: the series details go up and off, the
 * chapter header pins to the top, and from there it is the chapters that
 * move, all the way down. No inner scroll box and no pages — a box inside a
 * scrolling page is two scrolls fighting over one wheel, and pages make the
 * reader stop and click to keep going.
 *
 * Only the rows near the screen are mounted. The list's full height is
 * reserved up front, so the page's scrollbar is honest about how long the
 * series is and dragging it lands where it should.
 */
export function ReadingModeChapters({
  chapters,
  scroller,
  summary,
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
  const [order, toggleOrder] = useChapterOrder();

  const shown = useMemo(
    () =>
      inOrder(
        filter === "downloaded" ? chapters.filter((c) => c.folder !== null) : chapters,
        order,
      ),
    [chapters, filter, order],
  );

  const list = useRef<HTMLDivElement | null>(null);
  const header = useRef<HTMLDivElement | null>(null);
  /** The slice of the list that is on screen, in pixels from its top. */
  const [view, setView] = useState({ top: 0, bottom: 800, pinned: false });

  const measure = useCallback(() => {
    const page = scroller.current;
    const node = list.current;
    if (!page || !node) return;
    const pageBox = page.getBoundingClientRect();
    const listTop = node.getBoundingClientRect().top - pageBox.top;
    const headerBottom = header.current
      ? header.current.getBoundingClientRect().bottom - pageBox.top
      : 0;
    setView({
      // The pinned header covers the top of the list, so what is *seen*
      // starts below it.
      top: Math.max(0, headerBottom - listTop),
      bottom: Math.max(0, page.clientHeight - listTop),
      pinned: header.current ? header.current.getBoundingClientRect().top <= pageBox.top + 0.5 : false,
    });
  }, [scroller]);

  useLayoutEffect(() => {
    measure();
  }, [measure, shown]);

  useEffect(() => {
    const page = scroller.current;
    if (!page) return;
    page.addEventListener("scroll", measure, { passive: true });
    const resize = new ResizeObserver(measure);
    resize.observe(page);
    return () => {
      page.removeEventListener("scroll", measure);
      resize.disconnect();
    };
  }, [scroller, measure]);

  // The entry stagger belongs to the rows that arrived with the list. Rows
  // mounted later by scrolling just appear, or every scroll would replay it.
  const [entering, setEntering] = useState(animate);
  useEffect(() => {
    if (!animate) return;
    setEntering(true);
    const timer = window.setTimeout(() => setEntering(false), 700);
    return () => window.clearTimeout(timer);
  }, [animate]);

  const first = Math.max(0, Math.floor(view.top / ROW) - OVERSCAN);
  const end = Math.min(shown.length, Math.ceil(view.bottom / ROW) + OVERSCAN);
  const rows = shown.slice(first, end);

  // What is on screen, as the design's "Capítulos 11–16" — once the list has
  // reached the header; before then the whole series is the honest answer.
  // A row half hidden under the pinned header does not count as on screen.
  const topRow = Math.min(shown.length - 1, Math.round(view.top / ROW));
  const bottomRow = Math.min(shown.length - 1, Math.max(topRow, Math.ceil(view.bottom / ROW) - 1));
  const range =
    view.pinned && shown.length > 0 ? `${shown[topRow].number}–${shown[bottomRow].number}` : null;

  const resumeIndex = resume ? shown.findIndex((c) => c.number === resume) : -1;
  /** Bring a row to just under the pinned header, one row of context above. */
  const jumpTo = (index: number) => {
    const page = scroller.current;
    const node = list.current;
    if (!page || !node) return;
    const pageBox = page.getBoundingClientRect();
    const listTop = node.getBoundingClientRect().top - pageBox.top + page.scrollTop;
    const headerHeight = header.current?.offsetHeight ?? 0;
    page.scrollTo({
      top: listTop + Math.max(0, index - 1) * ROW - headerHeight,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  };

  return (
    <div className="flex flex-col">
      {/* Pinned once it reaches the top. The bleed and the canvas fill keep
          the rows from showing through either side of it as they pass. */}
      <div
        ref={header}
        className={cn(
          "sticky top-0 z-10 -mx-5 flex flex-col gap-3 bg-background px-5 pb-3 pt-4 sm:-mx-8 sm:px-8",
          view.pinned && "shadow-[0_8px_12px_-12px_rgb(20_22_27/0.35)]",
        )}
      >
        <div className="flex items-baseline gap-4">
          <h2 className="type-subtitle flex-1">{t("seriesView.chaptersOverline")}</h2>
          <span className="truncate text-xs text-text-secondary">
            {range ? t("seriesView.chaptersRange", { range }) : summary}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label={t("seriesView.chapterFilter")} className="flex gap-2">
            <Chip selected={filter === "all"} onClick={() => setFilter("all")}>
              {t("seriesView.filterAll")}
            </Chip>
            <Chip selected={filter === "downloaded"} onClick={() => setFilter("downloaded")}>
              {t("seriesView.filterDownloaded")}
            </Chip>
          </div>
          <ChapterOrderToggle order={order} onToggle={toggleOrder} />
          {resumeIndex >= 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => jumpTo(resumeIndex)}
              aria-label={t("seriesView.goToChapter", { number: shown[resumeIndex].number })}
              title={t("seriesView.goToChapter", { number: shown[resumeIndex].number })}
            >
              <CornerDownRight />
              {/* A phone's pinned row has the filters, the order and the
                  download beside it; the label would push one onto a
                  second line and make the pinned header twice as tall. */}
              <span className="max-sm:hidden">
                {t("seriesView.goToChapter", { number: shown[resumeIndex].number })}
              </span>
            </Button>
          )}
          <div className="flex-1" />
          {missingCount > 0 && (
            <Button
              variant="outline"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                onGetMissing({ x: r.left, y: r.bottom + 4 });
              }}
              aria-label={t("seriesView.getMissing", { count: missingCount })}
            >
              <Download />
              <span className="max-sm:hidden">
                {t("seriesView.getMissing", { count: missingCount })}
              </span>
            </Button>
          )}
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="mt-1 rounded-lg border border-dashed border-line-strong px-6 py-10 text-center text-sm text-text-secondary">
          {filter === "downloaded"
            ? t("seriesView.noDownloadedChapters")
            : t("seriesView.noChaptersListed")}
        </p>
      ) : (
        <div
          ref={list}
          className="relative mt-1 overflow-hidden rounded-lg border border-line bg-raised"
          // The whole list's height, reserved before its rows exist.
          style={{ height: shown.length * ROW + 2 }}
        >
          {rows.map((chapter, offset) => {
            const index = first + offset;
            return (
              <ReadingRow
                key={chapter.number}
                chapter={chapter}
                sourceName={sourceName}
                source={sourceOf(chapter)}
                busy={fetchingDirect.has(chapter.number)}
                onRead={() => onRead(chapter)}
                onDownload={() =>
                  canFetchDirectly(chapter)
                    ? onFetchDirect(chapter.number)
                    : onGet(chapter.number)
                }
                className={cn(
                  "absolute inset-x-0",
                  index === shown.length - 1 && "border-b-0",
                  entering && "rise-in",
                )}
                top={index * ROW}
                delay={entering ? Math.min(Math.max(0, index - topRow), STAGGER_ROWS) * STAGGER_MS : 0}
              />
            );
          })}
        </div>
      )}

      <div className="flex min-h-10 items-center gap-2 pt-3 text-xs text-text-tertiary">
        <Download className="size-3.5 shrink-0" />
        <span className="min-w-0 truncate">{t("seriesView.downloadOfflineHint")}</span>
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
  top,
  delay,
}: {
  chapter: ChapterStatus;
  sourceName: string | null;
  source: string | null;
  busy: boolean;
  onRead: () => void;
  onDownload: () => void;
  className?: string;
  /** Where the row sits in the scrolled list, in pixels. */
  top: number;
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
      className={cn("flex h-[52px] items-center border-b border-line pr-2", className)}
      style={{ top, ...(delay ? { animationDelay: `${delay}ms` } : {}) }}
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
