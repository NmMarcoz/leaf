import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Cloud,
  ExternalLink,
  Loader2,
  Settings2,
  TriangleAlert,
} from "lucide-react";

import { ReaderSettings } from "@/components/ReaderSettings";
import { Button } from "@/components/ui/button";
import { useImageZoom } from "@/hooks/useImageZoom";
import { useT } from "@/lib/i18n";
import {
  cachedPage,
  clearPages,
  loadPage,
  loadPrefs,
  readerChapter,
  readerOnlineChapter,
  readerOnlineChapters,
  seriesTranslations,
  readerTrackOnline,
  savePrefs,
  saveReadingProgress,
  type FitMode,
  type ReaderPrefs,
  type ReaderTarget,
} from "@/lib/reader";
import { languageName } from "@/lib/api";
import { isMobile } from "@/lib/platform";
import { cn } from "@/lib/utils";

/** The pan/reset pair a mounted page image lends to the keyboard handler. */
type ZoomHandle = ReturnType<typeof useImageZoom>["handle"];

interface ReaderViewProps {
  target: ReaderTarget;
  /** Move to another chapter without leaving the reader. */
  onNavigate: (target: ReaderTarget) => void;
  /** Leave for the series this chapter belongs to. */
  onOpenSeries: (seriesId: number) => void;
  onExit: () => void;
}

/**
 * How many pages to fetch ahead of the one being read, and how many behind.
 *
 * Asymmetric because reading is: you move forward far more than back, and a
 * miss forward is the one that shows as a blank page. Two either side was not
 * enough when streaming — every turn was a round trip — and fetching the whole
 * chapter would hammer the source for pages nobody may reach.
 */
const PRELOAD_AHEAD = 6;
const PRELOAD_BEHIND = 2;

/** How long to sit still before writing the reading position. */
const SAVE_DELAY = 600;

/** Pixels a touch must travel across the page before it counts as a turn. */
const SWIPE_MIN = 50;

/** How far one arrow press scans a zoomed page. */
const PAN_KEY_STEP = 120;

/**
 * A chapter, flattened to the handful of things the reader draws.
 *
 * Both sources normalise to this, so nothing below here branches on where the
 * pages came from except to decide who to ask for the bytes.
 */
interface OpenChapter {
  seriesTitle: string;
  number: string;
  title: string | null;
  direction: string;
  /** File paths when local, URLs when streamed. */
  pages: string[];
  online: boolean;
  startPage: number;
  previous: ReaderTarget | null;
  next: ReaderTarget | null;
  /** Where to record progress. Absent for a series not in the library. */
  progress: { seriesId: number; chapter: string } | null;
  /**
   * How to reach this series at its source, when it has one.
   *
   * Carried on the open chapter rather than taken from the target, because a
   * downloaded chapter's target says nothing about the source and reading it in
   * another translation means streaming that one.
   */
  online_source: { source: string; seriesSourceId: string; language: string } | null;
}

/**
 * The reader.
 *
 * Three layouts, because manga is drawn in three shapes: single pages, facing
 * pairs, and the unbroken vertical strip a webtoon is. Direction comes from the
 * series, so a right-to-left title turns the way it was drawn to.
 *
 * Reads from the library or straight from the source. Streaming is what makes
 * sampling a series possible without committing a few hundred megabytes to it,
 * and a chapter read that way can be downloaded afterwards if it is worth
 * keeping.
 */
export function ReaderView({
  target,
  onNavigate,
  onOpenSeries,
  onExit,
}: ReaderViewProps) {
  const t = useT();
  const [open, setOpen] = useState<OpenChapter | null>(null);
  /**
   * Why the chapter could not be shown.
   *
   * Kept here rather than pushed to the app's error toast: the reader fills the
   * window, and a chapter that will not open has to say so *and* offer a way
   * out in the same place. An endless spinner is not a failure state.
   */
  const [failure, setFailure] = useState<{
    message: string;
    externalUrl: string | null;
  } | null>(null);
  const [page, setPage] = useState(0);
  const [prefs, setPrefs] = useState<ReaderPrefs>(loadPrefs);
  const [showChrome, setShowChrome] = useState(true);
  const [showSettings, setShowSettings] = useState(false);

  const scroller = useRef<HTMLDivElement | null>(null);
  const saveTimer = useRef<number | null>(null);

  const rtl = (prefs.direction ?? open?.direction) === "right-to-left";
  const total = open?.pages.length ?? 0;

  /* ------------------------------------------------------------- loading */

  useEffect(() => {
    let cancelled = false;
    setOpen(null);
    setFailure(null);

    const run = async () => {
      if (target.kind === "library") {
        const found = await readerChapter(target.seriesId, target.chapter);
        if (cancelled) return;
        setOpen({
          seriesTitle: found.series_title,
          number: found.number,
          title: found.title,
          direction: found.direction,
          pages: found.pages,
          online: false,
          startPage: found.last_page,
          previous: found.previous
            ? { kind: "library", seriesId: target.seriesId, chapter: found.previous }
            : null,
          next: found.next
            ? { kind: "library", seriesId: target.seriesId, chapter: found.next }
            : null,
          progress: { seriesId: target.seriesId, chapter: found.number },
          online_source:
            found.source && found.series_source_id
              ? {
                  source: found.source,
                  seriesSourceId: found.series_source_id,
                  language: found.language,
                }
              : null,
        });
        setPage(found.last_page);
        return;
      }

      const found = await readerOnlineChapter(target.source, target.chapterId);
      if (cancelled) return;

      if (found.pages.length === 0) {
        setFailure({ message: t("readerView.noPagesMessage"), externalUrl: null });
        return;
      }

      // History reopening a single entry has no list, and the reader needs one
      // to move on from here. Fetched rather than demanded of every caller,
      // because this is the one that has never been able to supply it.
      let ordered = target.chapters;
      if (ordered.length === 0 && target.seriesSourceId) {
        ordered = await readerOnlineChapters(
          target.source,
          target.seriesSourceId,
          target.language || null,
        ).catch(() => []);
        if (cancelled) return;
      }

      // Position looked up in the list each time rather than carried along, so
      // moving to a chapter produces a target that knows its own neighbours.
      const at = ordered.findIndex((c) => c.id === target.chapterId);
      const sibling = (index: number): ReaderTarget | null => {
        const found = at < 0 ? undefined : ordered[index];
        return found
          ? {
              ...target,
              chapters: ordered,
              chapterId: found.id,
              chapterNumber: found.number,
              kind: "online",
            }
          : null;
      };

      // Recorded whether or not the series is in the library, so history is
      // the same question however the pages were reached. Failing to record is
      // not worth refusing to read over — it costs the history entry, nothing
      // more.
      // Without the source's own id there is nothing to record against that
      // could ever be found again, so the existing library row is used as-is.
      const seriesId = !target.seriesSourceId
        ? target.librarySeriesId
        : await readerTrackOnline({
            source: target.source,
            seriesSourceId: target.seriesSourceId,
            title: target.seriesTitle,
            coverUrl: target.coverUrl,
            chapter: target.chapterNumber,
            chapterSourceId: target.chapterId,
            pages: found.pages.length,
            language: target.language || null,
          }).catch(() => target.librarySeriesId);
      if (cancelled) return;

      setOpen({
        seriesTitle: target.seriesTitle,
        number: target.chapterNumber,
        title: null,
        direction: target.direction,
        pages: found.pages,
        online: true,
        startPage: Math.min(keepPage.current ?? 0, found.pages.length - 1),
        previous: sibling(at - 1),
        next: sibling(at + 1),
        progress: seriesId ? { seriesId, chapter: target.chapterNumber } : null,
        online_source: target.seriesSourceId
          ? {
              source: target.source,
              seriesSourceId: target.seriesSourceId,
              language: target.language,
            }
          : null,
      });
      setPage(Math.min(keepPage.current ?? 0, found.pages.length - 1));
      keepPage.current = null;
    };

    run().catch((e) => {
      // A reader extension reports a chapter its site indexes but a publisher
      // hosts as an error ending in the publisher's URL — the only channel a
      // script has. Offering that URL as a button keeps "where it lives" one
      // tap away whichever reader said it.
      if (!cancelled) {
        const message = String(e);
        setFailure({ message, externalUrl: message.match(/https?:\/\/\S+$/)?.[0] ?? null });
      }
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  // Decoded pages are large; holding a whole series' worth would be a leak.
  useEffect(() => clearPages, []);

  // Fetch a little ahead so a page turn is instant rather than a flash of
  // nothing. Backwards too: re-reading a panel is as common as moving on. This
  // matters far more when streaming, where a miss is a round trip.
  useEffect(() => {
    if (!open) return;
    // Nearest first: the page after this one matters more than the sixth, and
    // the shared gate in `imagecache` runs these a few at a time.
    const offsets = [0];
    for (let i = 1; i <= Math.max(PRELOAD_AHEAD, PRELOAD_BEHIND); i += 1) {
      if (i <= PRELOAD_AHEAD) offsets.push(i);
      if (i <= PRELOAD_BEHIND) offsets.push(-i);
    }
    for (const offset of offsets) {
      const source = open.pages[page + offset];
      if (source) void loadPage(source, open.online).catch(() => {});
    }
  }, [open, page]);

  /* ------------------------------------------------------------ progress */

  const record = useCallback(
    (chapter: OpenChapter, at: number) => {
      if (!chapter.progress) return;
      // The last page counts as finished: nothing else marks it, and requiring
      // a separate action to say "done" is bookkeeping nobody does.
      const finished = at >= chapter.pages.length - 1;
      void saveReadingProgress(
        chapter.progress.seriesId,
        chapter.progress.chapter,
        at,
        finished,
      ).catch(() => {});
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => record(open, page), SAVE_DELAY);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [open, page, record]);

  // Leaving mid-page would otherwise lose up to SAVE_DELAY of progress.
  useEffect(() => {
    return () => {
      if (open) record(open, page);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, page]);

  /* ----------------------------------------------------------- navigation */

  const step = prefs.mode === "double" ? 2 : 1;

  /**
   * A page turn in flight, and where it is heading.
   *
   * The commit is deferred: while a turn runs, `page` still holds the old
   * view — fully painted, never re-rastered — and the new view rides in over
   * it as an overlay. `page` only moves at the end. That ordering is the
   * whole point: animating the *old* page away (the first attempt) exposed
   * the new one underneath before its image had painted, so every turn
   * started with a flash of the incoming page interpolating into place.
   *
   * `id` increments per turn so a second one mid-flight remounts the overlay
   * and restarts the animation instead of being swallowed. Only `advance()`
   * sets it: the position slider, Home/End and chapter changes jump, and
   * animating a jump would pretend they turned pages.
   */
  const [turn, setTurn] = useState<{ to: number; forward: boolean; id: number } | null>(null);

  // Reduced motion kills the keyframes, and a killed animation fires no
  // animationend — the turn would only land via the safety timer, showing
  // the new page faded-in 80ms late. Treated as "none" at the state level
  // rather than by CSS alone.
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  // animationend is the normal commit; this timer is the safety net for the
  // turn whose animation never reported — an overlay unmounted early by a
  // mode switch, a tab that slept through the frame. The animation is 180ms,
  // so 260 never fires while it is still legitimately running.
  useEffect(() => {
    if (!turn) return;
    const timer = window.setTimeout(() => {
      setPage(turn.to);
      setTurn(null);
    }, 260);
    return () => window.clearTimeout(timer);
  }, [turn]);

  // A chapter (re)load lands on its own page; an in-flight turn from the
  // previous one must not commit on top of it.
  useEffect(() => setTurn(null), [open]);

  /** Jump straight to a page — the slider, Home/End. Not a turn: no overlay,
   * and any overlay still running is abandoned rather than committed. */
  const jump = useCallback((at: number) => {
    setTurn(null);
    setPage(at);
  }, []);

  /** The pair indices the given page starts a view with, in screen order. */
  const pagesAt = useCallback(
    (start: number): number[] => {
      if (!open) return [];
      if (prefs.mode !== "double") return [start];
      const pair = [start, start + 1].filter((i) => i < open.pages.length);
      return rtl ? pair.reverse() : pair;
    },
    [open, prefs.mode, rtl],
  );

  const advance = useCallback(
    (delta: number) => {
      if (!open) return;
      // During a turn the committed page is behind where reading already is:
      // the new view is mid-animation on top. Fast taps must stack onto the
      // turn in flight, not re-step from the page underneath it.
      const here = turn ? turn.to : page;
      const next = here + delta * step;

      if (next < 0) {
        if (open.previous) onNavigate(open.previous);
        return;
      }
      if (next >= open.pages.length) {
        if (open.next) onNavigate(open.next);
        return;
      }
      // Zooming rides a transform on the image; letting it persist into a
      // turn would slide a panned crop across the screen as the new page.
      zoomHandle.current?.reset();
      if (prefs.mode !== "webtoon" && prefs.animation !== "none" && !reducedMotion) {
        setTurn((current) => ({ to: next, forward: delta > 0, id: (current?.id ?? 0) + 1 }));
      } else {
        setPage(next);
      }

      if (prefs.mode === "webtoon") {
        scroller.current
          ?.querySelector(`[data-page="${next}"]`)
          ?.scrollIntoView({ behavior: "auto", block: "start" });
      }
    },
    [open, page, turn, step, prefs.mode, prefs.animation, reducedMotion, onNavigate],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const node = event.target as HTMLElement | null;
      if (node && (node.tagName === "INPUT" || node.isContentEditable)) return;

      switch (event.key) {
        case "Escape":
          event.preventDefault();
          onExit();
          break;
        case "ArrowRight":
          event.preventDefault();
          // In a right-to-left book the right-hand side is where you came from.
          advance(rtl ? -1 : 1);
          break;
        case "ArrowLeft":
          event.preventDefault();
          advance(rtl ? 1 : -1);
          break;
        case "ArrowDown":
          if (prefs.mode !== "webtoon") {
            // While a page is zoomed beyond its box, arrows scan it rather
            // than turn it: reading a zoomed page means looking at more of it.
            if (zoomHandle.current?.panByPixels(0, -PAN_KEY_STEP)) {
              event.preventDefault();
              break;
            }
            if (event.key === "ArrowDown") {
              event.preventDefault();
              advance(1);
            }
          }
          break;
        case " ":
          if (prefs.mode !== "webtoon") {
            event.preventDefault();
            advance(1);
          }
          break;
        case "ArrowUp":
          if (prefs.mode !== "webtoon") {
            if (zoomHandle.current?.panByPixels(0, PAN_KEY_STEP)) {
              event.preventDefault();
              break;
            }
            event.preventDefault();
            advance(-1);
          }
          break;
        case "Home":
          event.preventDefault();
          jump(0);
          break;
        case "End":
          event.preventDefault();
          jump(Math.max(0, total - 1));
          break;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [advance, onExit, rtl, prefs.mode, total]);

  // Where a touch started, and whether the gesture that just ended was a swipe
  // rather than a tap. Refs because neither ever needs to paint anything.
  const turnByDrag = useCallback(
    (dx: number) => {
      // Dragging left pulls the next page in from the right, which is the
      // previous page in a right-to-left book.
      advance(dx < 0 ? (rtl ? -1 : 1) : rtl ? 1 : -1);
    },
    [advance, rtl],
  );

  /** Translations the source has, fetched when the settings panel is opened. */
  const [translations, setTranslations] = useState<string[]>([]);
  const [switching, setSwitching] = useState(false);
  /**
   * The page to land on after a translation swap.
   *
   * A ref, not state: it is consumed by the load that follows and must not
   * survive into the next chapter the reader opens normally.
   */
  const keepPage = useRef<number | null>(null);

  const swipe = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  /** The outgoing page during a turn animates but reads nothing, so its
   * handle lands here — a ref the keyboard never consults. */
  const ghostHandle = useRef<ZoomHandle | null>(null);
  /**
   * The zoom handle of whichever page image is currently mounted. In paged
   * and double mode at most two images exist and only one can be zoomed, so
   * "the last one registered" is always the one arrows should pan. Kept as a
   * ref that PageImage clears on unmount (and re-claims when another mounts),
   * so leaving the paged layouts can't leave the arrows panning a corpse.
   */
  const zoomHandle = useRef<ZoomHandle | null>(null);
  /** Where a mouse button went down. WebView synthesises no touch events from
   * a mouse, so without this a drag ends as a plain click at the release
   * point — which turns the page by *where the finger lifted*, the one thing
   * a drag never reads as. */
  const mouseDown = useRef<{ x: number; y: number } | null>(null);

  /**
   * Read this same chapter in another translation.
   *
   * Matched by chapter *number*, because that is the only thing the two
   * translations agree on — the ids are per-language. The page is kept and
   * clamped: a different group's rip of the same chapter can be shorter.
   */
  const swapTranslation = useCallback(
    async (code: string) => {
      const from = open?.online_source;
      if (!open || !from || code === from.language) return;

      setSwitching(true);
      try {
        const ordered = await readerOnlineChapters(from.source, from.seriesSourceId, code);
        const found = ordered.find((c) => c.number === open.number);
        if (!found) {
          setFailure({
            message: t("readerView.noChapterInLanguage", {
              number: open.number,
              language: languageName(code, t),
            }),
            externalUrl: null,
          });
          return;
        }

        // Always a stream, even from a downloaded chapter: the pages on disk
        // are in one language and cannot be swapped for another's.
        keepPage.current = page;
        onNavigate({
          kind: "online",
          source: from.source,
          chapterId: found.id,
          seriesTitle: open.seriesTitle,
          chapterNumber: found.number,
          direction: open.direction,
          language: code,
          chapters: ordered,
          seriesSourceId: from.seriesSourceId,
          coverUrl: null,
          librarySeriesId: open.progress?.seriesId ?? null,
        });
      } finally {
        setSwitching(false);
      }
    },
    [open, page, onNavigate, t],
  );

  const patchPrefs = useCallback((patch: Partial<ReaderPrefs>) => {
    setPrefs((current) => {
      const next = { ...current, ...patch };
      savePrefs(next);
      return next;
    });
  }, []);

  /* --------------------------------------------------------------- render */

  const surface =
    prefs.background === "white"
      ? "bg-white"
      : prefs.background === "grey"
        ? "bg-neutral-700"
        : "bg-ink";

  const visible = useMemo(() => pagesAt(page), [pagesAt, page]);
  // On the last page (or the last pair): what the "up next" card waits for.
  const atEnd = total > 0 && Math.max(page, ...visible) >= total - 1;

  // The incoming view during a turn: the pages the overlay carries. The old
  // view stays underneath, committed and painted, until the end commits.
  const turning = useMemo(() => (turn ? pagesAt(turn.to) : []), [turn, pagesAt]);

  // Loading and failure both need the way out. Being unable to leave a screen
  // that will never finish is worse than the thing that went wrong.
  if (!open) {
    return (
      <div className={cn("relative flex h-full flex-col", surface)}>
        <div className={cn(PILL, "left-3 top-3 max-w-[calc(100%-1.5rem)] sm:left-6 sm:top-5")}>
          <button
            type="button"
            onClick={onExit}
            aria-label={t("readerView.goBack")}
            className={PILL_ICON}
          >
            <ArrowLeft className="size-4" />
          </button>
          <p className="truncate pl-0.5 pr-3 text-xs font-medium">
            {target.kind === "online" ? target.seriesTitle : t("readerView.openingChapter")}
          </p>
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center p-8">
          {failure ? (
            <div className="max-w-md text-center">
              <TriangleAlert className="mx-auto size-7 text-amber-500" />
              <h2 className="mt-3 text-sm font-medium text-on-ink">
                {t("readerView.cannotReadTitle")}
              </h2>
              {/* The message ends in a publisher URL, which has no spaces in
                  it to wrap at and runs off both edges of a phone without this. */}
              <p className="mt-1.5 break-words text-xs leading-relaxed text-on-ink-muted">
                {failure.message}
              </p>

              <div className="mt-5 flex items-center justify-center gap-2">
                {/* Restyled for the ink surface: the default ink button
                    disappears into it, and the outline one turns paper. The
                    way onward is the paper one when there is somewhere to go. */}
                <Button
                  variant="ghost"
                  onClick={onExit}
                  className={cn(
                    failure.externalUrl
                      ? "bg-ink-raised text-on-ink hover:bg-ink-raised/80 hover:text-on-ink"
                      : "bg-on-ink text-ink hover:bg-on-ink/90 hover:text-ink",
                  )}
                >
                  <ArrowLeft />
                  {t("readerView.goBack")}
                </Button>
                {failure.externalUrl && (
                  <Button asChild className="bg-on-ink text-ink hover:bg-on-ink/90">
                    <a
                      href={failure.externalUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ExternalLink />
                      {t("readerView.readAtPublisher")}
                    </a>
                  </Button>
                )}
              </div>

              <p className="mt-4 text-[11px] text-on-ink-muted/70">
                {isMobile ? t("readerView.backCloses") : t("readerView.escCloses")}
              </p>
            </div>
          ) : (
            <Loader2 className="size-5 animate-spin text-white/50" />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("relative flex h-full flex-col", surface)}>
      {showChrome && (
        <>
          {/* Floating ink pills rather than full-width bars (Figma "13 ·
              Leitor"): the page keeps the whole screen and the chrome only
              covers what it labels. */}
          <div className={cn(PILL, "left-3 top-3 max-w-[calc(100%-9.5rem)] sm:left-6 sm:top-5")}>
            <button
              type="button"
              onClick={onExit}
              aria-label={t("readerView.goBack")}
              className={PILL_ICON}
            >
              <ArrowLeft className="size-4" />
            </button>
            {/* The title is the way to the series: from halfway through a
                chapter, "what else is there" is a question worth one tap. */}
            <button
              type="button"
              className="min-w-0 pl-0.5 pr-3 text-left text-xs leading-4"
              onClick={() => open.progress && onOpenSeries(open.progress.seriesId)}
              disabled={!open.progress}
            >
              <p className="truncate font-medium text-on-ink">{open.seriesTitle}</p>
              <p className="flex items-center gap-1 truncate text-on-ink-muted">
                {open.online && <Cloud className="size-3 shrink-0" aria-label={t("readerView.streaming")} />}
                <span className="truncate">
                  {t("readerView.chapterLabel", { number: open.number })}
                  {open.title ? ` · ${open.title}` : ""}
                </span>
              </p>
            </button>
          </div>

          <div
            className={cn(
              PILL,
              "right-3 top-3 sm:top-5",
              // Steps aside for the settings panel instead of hiding under it.
              showSettings ? "sm:right-[376px]" : "sm:right-6",
            )}
          >
            {/* A raw counter, not narrative text — left unwrapped like a clock. */}
            <span className="pl-2.5 pr-1.5 font-mono text-xs text-on-ink-muted">
              {page + 1} / {total}
            </span>
            <button
              type="button"
              aria-label={t("readerSettings.title")}
              aria-pressed={showSettings}
              className={cn(PILL_ICON, "bg-ink")}
              onClick={() => {
                setShowSettings((v) => !v);
                const from = open.online_source;
                if (from && !translations.length) {
                  void seriesTranslations(from.source, from.seriesSourceId)
                    .then(setTranslations)
                    .catch(() => {});
                }
              }}
            >
              <Settings2 className="size-4" />
            </button>
          </div>
        </>
      )}

      {prefs.mode === "webtoon" ? (
        <WebtoonPages
          ref={scroller}
          chapter={open}
          fit={prefs.fit}
          onVisiblePage={setPage}
          onToggleChrome={() => setShowChrome((v) => !v)}
        />
      ) : (
        <div
          // Chrome's WebView ignores user-scalable=no, so pinch-zoom is still
          // native and fights the reader's own scaling. touch-none hands the
          // whole gesture to the reader; tap and swipe still work because they
          // read touch events, not the browser's pan/zoom handling.
          className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden touch-none"
          onClick={(event) => {
            // A swipe ends in a click too, and turning the page twice for one
            // gesture is worse than either behaviour on its own.
            if (swiped.current) {
              swiped.current = false;
              return;
            }
            // Thirds: outer edges turn, the middle shows and hides the chrome.
            const { left, width } = event.currentTarget.getBoundingClientRect();
            const position = (event.clientX - left) / width;
            if (position < 0.33) advance(rtl ? 1 : -1);
            else if (position > 0.67) advance(rtl ? -1 : 1);
            else setShowChrome((v) => !v);
          }}
          onTouchStart={(event) => {
            // Chrome sends no click after a touch that moved, so a swipe's flag
            // would otherwise linger and eat the next real tap.
            swiped.current = false;
            const touch = event.touches[0];
            swipe.current = { x: touch.clientX, y: touch.clientY };
          }}
          onTouchEnd={(event) => {
            const from = swipe.current;
            swipe.current = null;
            if (!from) return;
            const touch = event.changedTouches[0];
            const dx = touch.clientX - from.x;
            const dy = touch.clientY - from.y;
            // Mostly-horizontal and far enough to be deliberate. A drifting
            // thumb on a tap moves a few pixels in every direction.
            if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) < Math.abs(dy)) return;
            swiped.current = true;
            turnByDrag(dx);
          }}
          onMouseDown={(event) => {
            // The zoom hook claims the press whenever there is something to
            // pan — original-size fit at scale 1 included — and says so by
            // preventDefault-ing the mousedown before it bubbles here. That
            // press is a pan, not a swipe, and must not also turn the page.
            if (event.defaultPrevented || event.button !== 0) {
              mouseDown.current = null;
              return;
            }
            mouseDown.current = { x: event.clientX, y: event.clientY };
          }}
          onMouseUp={(event) => {
            const from = mouseDown.current;
            mouseDown.current = null;
            if (!from) return;
            const dx = event.clientX - from.x;
            const dy = event.clientY - from.y;
            if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) < Math.abs(dy)) return;
            // The zoom hook ends its own pan with a click that stops
            // propagation, so a consumed gesture never reaches this click
            // handler — and the flag below is what keeps it from firing.
            swiped.current = true;
            turnByDrag(dx);
          }}
        >
          {visible.map((index) => (
            <PageImage
              key={open.pages[index]}
              source={open.pages[index]}
              online={open.online}
              fit={prefs.fit}
              paired={prefs.mode === "double" && visible.length > 1}
              handleRef={zoomHandle}
            />
          ))}

          {turn && turning.length > 0 && prefs.animation !== "none" && (
            <div
              // Keyed by turn id: a second turn mid-flight remounts the
              // overlay and the animation starts over instead of carrying
              // on. The images cost nothing to rebuild — preloaded pages
              // hit the decode cache synchronously on mount. pointer-
              // events-none and a dead handle ref: this page is arriving,
              // not yet being read or panned.
              key={turn.id}
              onAnimationEnd={(event) => {
                // The wrapper's own animation, not the images' (which
                // inherit none of it, but a nested transition would).
                if (event.target !== event.currentTarget) return;
                setPage(turn.to);
                setTurn(null);
              }}
              className={cn(
                "pointer-events-none absolute inset-0 z-10 flex items-center justify-center overflow-hidden",
                // Forward in a left-to-right book: the new page rides in
                // from the right. RTL mirrors it. A fade turns the entry
                // side into a crossfade over the page underneath.
                prefs.animation === "fade"
                  ? "turn-fade"
                  : turn.forward !== rtl
                    ? "turn-enter-right"
                    : "turn-enter-left",
              )}
            >
              {turning.map((index) => (
                <PageImage
                  key={open.pages[index]}
                  source={open.pages[index]}
                  online={open.online}
                  fit={prefs.fit}
                  paired={prefs.mode === "double" && turning.length > 1}
                  handleRef={ghostHandle}
                  bare
                />
              ))}
            </div>
          )}
        </div>
      )}

      {showChrome && (
        <div
          className={cn(
            PILL,
            "bottom-3 left-1/2 w-[600px] max-w-[calc(100%-1.5rem)] -translate-x-1/2 gap-3 px-2.5 sm:bottom-5",
          )}
        >
          <button
            type="button"
            aria-label={t(rtl ? "readerView.nextPage" : "readerView.previousPage")}
            className={cn(PILL_ICON, "p-1.5")}
            onClick={() => advance(rtl ? 1 : -1)}
          >
            <ChevronLeft className="size-4" />
          </button>

          {/* The bar is drawn, the range input on top of it does the work:
              a native range cannot take the design's thin track and accent
              fill in every engine. Reversed for a right-to-left book, so the
              fill grows from the right and dragging right goes back. */}
          <div className="relative flex h-6 min-w-0 flex-1 items-center">
            <div
              className={cn(
                "flex h-1 w-full overflow-hidden rounded-full bg-ink",
                rtl && "justify-end",
              )}
            >
              <div
                className="h-1 rounded-full bg-deliver"
                style={{ width: `${total > 1 ? ((page + 1) / total) * 100 : 100}%` }}
              />
            </div>
            <input
              type="range"
              min={0}
              max={Math.max(0, total - 1)}
              value={page}
              aria-label={t("readerView.pageSlider")}
              onChange={(e) => jump(Number(e.target.value))}
              className={cn(
                "absolute inset-0 h-full w-full cursor-pointer opacity-0",
                rtl && "[direction:rtl]",
              )}
            />
          </div>

          <button
            type="button"
            aria-label={t(rtl ? "readerView.previousPage" : "readerView.nextPage")}
            className={cn(PILL_ICON, "p-1.5")}
            onClick={() => advance(rtl ? -1 : 1)}
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      )}

      {/* Figma "13b · fim do capítulo": the last page offers the next chapter
          instead of leaving the reader to find it. Turning on from here goes
          there too, so the card is a signpost, not a gate. Kept up with the
          chrome hidden — that is exactly when the reader would miss it. */}
      {atEnd && open.next && !showSettings && (
        <div className="absolute inset-x-3 bottom-[4.25rem] z-20 flex flex-col gap-2.5 rounded-2xl bg-raised p-4 text-foreground shadow-[0_12px_32px_rgba(0,0,0,0.4)] sm:inset-x-auto sm:bottom-24 sm:right-6 sm:w-60">
          <p className="type-overline text-text-tertiary">{t("readerView.upNext")}</p>
          <p className="type-subtitle">
            {t("readerView.chapterLabel", { number: targetNumber(open.next) })}
          </p>
          {!isMobile && (
            <p className="text-xs text-text-tertiary">
              {t("readerView.continueHint", { arrow: rtl ? "←" : "→" })}
            </p>
          )}
          <Button className="w-full" onClick={() => open.next && onNavigate(open.next)}>
            <ChevronRight />
            {t("readerView.continue")}
          </Button>
        </div>
      )}

      {showSettings && (
        <ReaderSettings
          className="absolute inset-x-3 top-[4.25rem] z-30 w-auto sm:inset-x-auto sm:right-6 sm:top-5 sm:w-[340px]"
          prefs={prefs}
          seriesDirection={open.direction}
          translations={open.online_source ? translations : []}
          language={open.online_source?.language ?? ""}
          switching={switching}
          onLanguage={(code) => void swapTranslation(code)}
          onChange={patchPrefs}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

/** The floating ink pill every piece of reader chrome sits in (Figma "13 · Leitor"). */
const PILL =
  "absolute z-20 flex items-center gap-1.5 rounded-full bg-ink-raised/95 px-2 py-1.5 text-on-ink shadow-[0_8px_24px_rgba(0,0,0,0.35)]";
const PILL_ICON =
  "flex shrink-0 items-center justify-center rounded-full p-2 text-on-ink transition-colors hover:bg-ink";

/** The chapter number a reader target opens, for the "up next" card. */
function targetNumber(target: ReaderTarget): string {
  if (target.kind === "library") return target.chapter;
  return target.chapters.find((c) => c.id === target.chapterId)?.number ?? target.chapterNumber;
}

/** Tailwind for each fit mode, shared by both layouts. */
function fitClass(fit: FitMode): string {
  switch (fit) {
    case "width":
      return "w-full h-auto";
    case "height":
      return "h-full w-auto";
    case "original":
      return "max-w-none";
    default:
      return "max-h-full max-w-full object-contain";
  }
}

function PageImage({
  source,
  online,
  fit,
  paired,
  handleRef,
  bare,
}: {
  source: string;
  online: boolean;
  fit: FitMode;
  paired: boolean;
  /** Claims this image's pan handle for the arrow keys while it is mounted. */
  handleRef: React.MutableRefObject<ZoomHandle | null>;
  /** A turn ghost: rendered for the animation only, never keyboard-visible. */
  bare?: boolean;
}) {
  const t = useT();
  const zoom = useImageZoom<HTMLImageElement>();
  const [url, setUrl] = useState<string | undefined>(() => cachedPage(source, online));
  const [failed, setFailed] = useState(false);
  // "Original size" is one image pixel per *screen* pixel. Left to CSS it is one
  // per CSS pixel, which on a phone at a device pixel ratio near 3 draws a page
  // three times wider than the screen — blurred, cropped to its middle, and
  // already below the zoom's floor, so it looks stuck zoomed in.
  const [nativeWidth, setNativeWidth] = useState<number | null>(null);

  // The keyboard arrows pan whichever image is actually zoomed or panned,
  // not merely mounted: in double mode both pages register otherwise, and
  // the last one mounted would swallow arrows aimed at the first. A ghost
  // never registers at all — it is mid-exit and inert.
  useEffect(() => {
    if (bare || !zoom.moved) return;
    handleRef.current = zoom.handle;
    return () => {
      if (handleRef.current === zoom.handle) handleRef.current = null;
    };
  }, [zoom.moved, zoom.handle, handleRef]);

  useEffect(() => {
    const hit = cachedPage(source, online);
    setUrl(hit);
    setFailed(false);
    if (hit) return;

    let cancelled = false;
    loadPage(source, online)
      .then((next) => !cancelled && setUrl(next))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [source, online]);

  if (failed) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-xs text-white/50">
        {t("readerView.pageLoadFailed")}
        {online && (
          <>
            <br />
            {t("readerView.rateLimited")}
          </>
        )}
      </div>
    );
  }
  if (!url) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-5 animate-spin text-white/40" />
      </div>
    );
  }

  return (
    <>
      <img
        ref={zoom.ref}
        src={url}
        alt=""
        draggable={false}
        onLoad={(event) =>
          setNativeWidth(event.currentTarget.naturalWidth / window.devicePixelRatio)
        }
        style={{
          ...(fit === "original" && nativeWidth ? { width: nativeWidth } : {}),
          ...zoom.style,
        }}
        className={cn(fitClass(fit), paired && "max-w-[50%]")}
      />
      {zoom.zoomed && (
        <button
          onClick={(event) => {
            event.stopPropagation();
            zoom.reset();
          }}
          className="absolute bottom-16 right-3 z-30 rounded-md border border-white/20 bg-black/70 px-2.5 py-1 text-[11px] text-white backdrop-blur-sm hover:bg-black/85"
        >
          {t("readerView.zoomReset")}
        </button>
      )}
    </>
  );
}

/** The continuous strip a webtoon is drawn as. */
function WebtoonPages({
  chapter,
  fit,
  onVisiblePage,
  onToggleChrome,
  ref,
}: {
  chapter: OpenChapter;
  fit: FitMode;
  onVisiblePage: (page: number) => void;
  onToggleChrome: () => void;
  ref?: React.Ref<HTMLDivElement>;
}) {
  const container = useRef<HTMLDivElement | null>(null);

  // Which page is being looked at, so progress reflects scrolling rather than
  // only explicit page turns.
  useEffect(() => {
    const node = container.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (top) {
          const index = Number((top.target as HTMLElement).dataset.page);
          if (!Number.isNaN(index)) onVisiblePage(index);
        }
      },
      { root: node, threshold: [0.25, 0.5, 0.75] },
    );

    node.querySelectorAll("[data-page]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [chapter, onVisiblePage]);

  return (
    <div
      ref={(node) => {
        container.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) (ref as React.RefObject<HTMLDivElement | null>).current = node;
      }}
      onClick={onToggleChrome}
      className="scrollbar-thin flex min-h-0 flex-1 flex-col items-center overflow-x-hidden overflow-y-auto touch-pan-y"
    >
      {chapter.pages.map((source, index) => (
        <div key={source} data-page={index} className="w-full max-w-4xl">
          <LazyStripPage source={source} online={chapter.online} fit={fit} />
        </div>
      ))}
    </div>
  );
}

/**
 * A strip page, fetched only once it is near the viewport.
 *
 * A long webtoon chapter is a hundred tall images; loading them all up front
 * would stall for seconds and, when streaming, hammer the source for pages
 * nobody has scrolled to yet.
 */
function LazyStripPage({
  source,
  online,
  fit,
}: {
  source: string;
  online: boolean;
  fit: FitMode;
}) {
  const t = useT();
  const zoom = useImageZoom<HTMLImageElement>();
  const [url, setUrl] = useState<string | undefined>(() => cachedPage(source, online));
  const holder = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (url) return;
    const node = holder.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        observer.disconnect();
        void loadPage(source, online)
          .then(setUrl)
          .catch(() => {});
      },
      { rootMargin: "1200px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [source, online, url]);

  return (
    <div ref={holder} className="flex min-h-32 w-full items-center justify-center">
      {url ? (
        <>
          <img
            ref={zoom.ref}
            src={url}
            alt=""
            draggable={false}
            style={zoom.style}
            className={cn("w-full", fit === "original" && "max-w-none")}
          />
          {zoom.zoomed && (
            <button
              onClick={(event) => {
                event.stopPropagation();
                zoom.reset();
              }}
              className="fixed bottom-16 right-3 z-30 rounded-md border border-white/20 bg-black/70 px-2.5 py-1 text-[11px] text-white backdrop-blur-sm hover:bg-black/85"
            >
              {t("readerView.zoomReset")}
            </button>
          )}
        </>
      ) : (
        <Loader2 className="size-4 animate-spin text-white/30" />
      )}
    </div>
  );
}
