import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, FolderOpen, Loader2, Plus, Search, SlidersHorizontal, Trash2 } from "lucide-react";

import { AddFromSourceDialog } from "@/components/AddFromSourceDialog";
import { AddSeriesDialog } from "@/components/AddSeriesDialog";
import { RemoveSeriesDialog } from "@/components/RemoveSeriesDialog";
import {
  isFiltering,
  LibraryFilters,
  matches,
  noFilter,
  type LibraryFilter,
} from "@/components/LibraryFilters";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Hint } from "@/components/ui/tooltip";
import { useRestoredScroll } from "@/hooks/useRestoredScroll";
import { useThumbnail } from "@/hooks/useThumbnail";
import { useT } from "@/lib/i18n";
import {
  isComplete,
  librarySeries,
  libraryVolumes,
  UNSORTED,
  type Series,
} from "@/lib/library";
import { canPickFolders, isMobile } from "@/lib/platform";
import {
  historyTarget,
  readingHistory,
  type HistoryEntry,
  type ReaderTarget,
} from "@/lib/reader";
import { cn } from "@/lib/utils";

/** Which slice of the shelf the chips show. */
export type ShelfSlice = "all" | "reading" | "gaps" | "ready";
export type ShelfSort = "recent" | "title" | "missing";

/** What a visit to the shelf is, so it survives opening a series. */
export interface ShelfState {
  filter: LibraryFilter;
  showFilters: boolean;
  slice: ShelfSlice;
  sort: ShelfSort;
  query: string;
}

export const emptyShelf = (): ShelfState => ({
  filter: noFilter(),
  showFilters: false,
  slice: "all",
  sort: "recent",
  query: "",
});

interface LibraryViewProps {
  shelf: ShelfState;
  onShelfChange: (update: (current: ShelfState) => ShelfState) => void;
  onOpenSeries: (id: number) => void;
  /** Escape hatch to the original scan-a-folder path. */
  onOpenFolder: () => void;
  onOpenHistory: () => void;
  onRead: (target: ReaderTarget) => void;
  onError: (message: string | null) => void;
  /**
   * How many queued tasks have finished. Adding through a source returns a
   * row at once and fills its cover/counts on the task thread; this is the
   * nudge that says "read the shelf again", rather than each view polling.
   */
  settleCount: number;
}

/** How many "continue reading" cards: one row on a laptop screen. */
const CONTINUE_COUNT = 4;

/**
 * The shelf (Figma 06 · Estante): what to read next, and every series with
 * where its volumes stand. History is folded in as "Continue reading" rather
 * than being a screen of its own; the full list is one link away.
 */
export function LibraryView({
  shelf,
  onShelfChange,
  onOpenSeries,
  onOpenFolder,
  onOpenHistory,
  onRead,
  onError,
  settleCount,
}: LibraryViewProps) {
  const t = useT();
  const [series, setSeries] = useState<Series[] | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [adding, setAdding] = useState(false);
  const [addingFromSource, setAddingFromSource] = useState(false);
  const [removing, setRemoving] = useState<Series | null>(null);
  const searchBox = useRef<HTMLInputElement>(null);
  // Held by the app: opening a series unmounts this view, and a filter you set
  // two taps ago should still be set when you come back.
  const { filter, showFilters, slice, sort, query } = shelf;
  const update = useCallback(
    (fields: Partial<ShelfState>) => onShelfChange((current) => ({ ...current, ...fields })),
    [onShelfChange],
  );

  const scroll = useRestoredScroll<HTMLElement>("library", (series?.length ?? 0) > 0);

  const refresh = useCallback(async () => {
    try {
      const [all, recent] = await Promise.all([librarySeries(), readingHistory(60)]);
      setSeries(all);
      setHistory(recent);
    } catch (e) {
      onError(String(e));
      setSeries([]);
    }
  }, [onError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // A task finishing means a row may have quietly filled in — the cover and
  // chapter counts an add-through-source defers to the queue. Skipped on the
  // mount pass, which `refresh` above already did.
  const settled = useRef(settleCount);
  useEffect(() => {
    if (settled.current !== settleCount) {
      settled.current = settleCount;
      void refresh();
    }
  }, [settleCount, refresh]);

  // Ctrl/⌘-K, as the search box's hint says.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchBox.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /** One entry per series: the most recent unfinished chapter of each. */
  const continuing = useMemo(() => {
    const seen = new Set<number>();
    const out: HistoryEntry[] = [];
    for (const entry of history) {
      if (entry.finished || seen.has(entry.series_id)) continue;
      seen.add(entry.series_id);
      out.push(entry);
    }
    return out;
  }, [history]);

  const readingIds = useMemo(() => new Set(continuing.map((e) => e.series_id)), [continuing]);

  const slices: { value: ShelfSlice; label: string; keep: (s: Series) => boolean }[] = [
    { value: "all", label: t("libraryView.sliceAll"), keep: () => true },
    { value: "reading", label: t("libraryView.sliceReading"), keep: (s) => readingIds.has(s.id) },
    {
      value: "gaps",
      label: t("libraryView.sliceGaps"),
      keep: (s) => s.known_chapters > s.have_chapters,
    },
    {
      value: "ready",
      label: t("libraryView.sliceReady"),
      keep: (s) => s.known_chapters > 0 && s.have_chapters >= s.known_chapters,
    },
  ];
  const shelved = series ?? [];
  const activeSlice = slices.find((s) => s.value === slice) ?? slices[0];

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const kept = shelved.filter(
      (s) =>
        activeSlice.keep(s) &&
        matches(s, filter) &&
        (!needle ||
          [s.title, s.title_romaji, s.title_native, s.author]
            .filter(Boolean)
            .some((v) => v!.toLowerCase().includes(needle))),
    );
    const sorted = [...kept];
    if (sort === "title") sorted.sort((a, b) => a.title.localeCompare(b.title));
    else if (sort === "missing")
      sorted.sort(
        (a, b) => b.known_chapters - b.have_chapters - (a.known_chapters - a.have_chapters),
      );
    else sorted.sort((a, b) => b.added_at - a.added_at);
    return sorted;
    // `activeSlice` is rebuilt every render; its identity is `slice` + the ids.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shelved, slice, readingIds, filter, query, sort]);

  const haveTotal = shelved.reduce((n, s) => n + s.have_chapters, 0);
  const knownTotal = shelved.reduce((n, s) => n + Math.max(s.known_chapters, s.have_chapters), 0);

  return (
    <main
      ref={scroll.ref}
      onScroll={scroll.onScroll}
      className="scrollbar-thin h-full overflow-y-auto"
    >
      <div className="mx-auto flex max-w-[1048px] flex-col gap-6 px-5 pb-10 pt-6 sm:px-10 sm:pt-8">
        <header className="flex flex-wrap items-center gap-x-6 gap-y-4">
          <div className="min-w-0 flex-1">
            <h1 className="type-display max-sm:text-[32px] max-sm:leading-9">
              {t("libraryView.title")}
            </h1>
            {series !== null && (
              <p className="mt-1 text-sm text-text-secondary">
                {t("libraryView.subtitle", {
                  series: shelved.length,
                  have: haveTotal.toLocaleString(),
                  known: knownTotal.toLocaleString(),
                })}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3 max-sm:w-full">
            <label className="flex h-[38px] min-w-0 items-center gap-2 rounded-[10px] border border-line-strong bg-raised px-3 max-sm:flex-1 sm:w-[280px]">
              <Search className="size-4 shrink-0 text-text-tertiary" />
              <input
                ref={searchBox}
                type="search"
                value={query}
                onChange={(e) => update({ query: e.target.value })}
                placeholder={t("libraryView.searchPlaceholder")}
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-text-tertiary"
              />
              {!isMobile && (
                <kbd className="rounded border border-line bg-sunken px-1.5 font-mono text-[11px] text-text-secondary">
                  Ctrl K
                </kbd>
              )}
            </label>
            {canPickFolders && (
              <Hint label={t("libraryView.buildFromFolderHint")}>
                <Button variant="outline" size="icon" onClick={onOpenFolder}>
                  <FolderOpen />
                </Button>
              </Hint>
            )}
            <Button onClick={() => setAdding(true)}>
              <Plus />
              <span className="max-sm:sr-only">{t("libraryView.addSeries")}</span>
            </Button>
          </div>
        </header>

        {continuing.length > 0 && (
          <section className="flex flex-col gap-3">
            <div className="flex items-center gap-4">
              <h2 className="type-subtitle flex-1">{t("libraryView.continueReading")}</h2>
              <Button variant="link" className="text-xs" onClick={onOpenHistory}>
                {t("libraryView.seeHistory")}
              </Button>
            </div>
            <div className="scrollbar-thin -mx-5 flex snap-x gap-3 overflow-x-auto px-5 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-4">
              {continuing.slice(0, CONTINUE_COUNT).map((entry) => (
                <ContinueCard
                  key={entry.series_id}
                  entry={entry}
                  onOpen={() => onRead(historyTarget(entry))}
                />
              ))}
            </div>
          </section>
        )}

        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <h2 className="type-subtitle flex-1">{t("libraryView.series")}</h2>
            <div className="flex flex-wrap items-center gap-2">
              <div
                role="radiogroup"
                aria-label={t("libraryView.series")}
                className="scrollbar-thin flex gap-1.5 overflow-x-auto max-sm:-mx-5 max-sm:w-screen max-sm:px-5"
              >
                {slices.map((s) => (
                  <Chip
                    key={s.value}
                    selected={slice === s.value}
                    onClick={() => update({ slice: s.value })}
                    className="h-[30px]"
                  >
                    {s.label} · {series ? shelved.filter(s.keep).length : "…"}
                  </Chip>
                ))}
              </div>
              <Select value={sort} onValueChange={(v) => update({ sort: v as ShelfSort })}>
                <SelectTrigger className="h-[30px] w-auto gap-1.5 text-xs" aria-label={t("libraryView.sort")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="recent">{t("libraryView.sortRecent")}</SelectItem>
                  <SelectItem value="title">{t("libraryView.sortTitle")}</SelectItem>
                  <SelectItem value="missing">{t("libraryView.sortMissing")}</SelectItem>
                </SelectContent>
              </Select>
              <Hint label={t("libraryView.filters")}>
                <Button
                  variant={showFilters || isFiltering(filter) ? "secondary" : "ghost"}
                  size="icon"
                  className="size-[30px]"
                  onClick={() => update({ showFilters: !showFilters })}
                  aria-pressed={showFilters}
                >
                  <SlidersHorizontal />
                </Button>
              </Hint>
            </div>
          </div>

          {showFilters && series !== null && (
            <LibraryFilters filter={filter} onChange={(next) => update({ filter: next })} series={shelved} />
          )}

          {series === null ? (
            <p className="flex items-center gap-2 text-sm text-text-secondary">
              <Loader2 className="size-4 animate-spin" /> {t("libraryView.openingLibrary")}
            </p>
          ) : shelved.length === 0 ? (
            <AddCard onClick={() => setAdding(true)} />
          ) : shown.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line-strong px-6 py-14 text-center">
              <p className="type-heading">{t("libraryView.noMatchesTitle")}</p>
              <p className="mt-1 text-sm text-text-secondary">
                {t("libraryView.noMatchesDescription")}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(138px,1fr))] gap-x-4 gap-y-7">
              {shown.map((entry) => (
                <SeriesCard
                  key={entry.id}
                  series={entry}
                  settleCount={settleCount}
                  onOpen={() => onOpenSeries(entry.id)}
                  onRemove={() => setRemoving(entry)}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      <AddSeriesDialog
        open={adding}
        onOpenChange={setAdding}
        onSearchExtensions={() => {
          setAdding(false);
          setAddingFromSource(true);
        }}
        onAdded={(added) => {
          void refresh();
          onOpenSeries(added.id);
        }}
      />

      <AddFromSourceDialog
        open={addingFromSource}
        onOpenChange={setAddingFromSource}
        onAdded={(added) => {
          void refresh();
          onOpenSeries(added.id);
        }}
      />

      <RemoveSeriesDialog
        series={removing}
        onOpenChange={(next) => !next && setRemoving(null)}
        onRemoved={() => void refresh()}
      />
    </main>
  );
}

function ContinueCard({ entry, onOpen }: { entry: HistoryEntry; onOpen: () => void }) {
  const t = useT();
  const { ref, url } = useThumbnail(entry.cover_path ?? "", 120);
  const progress = entry.page_count > 0 ? ((entry.last_page + 1) / entry.page_count) * 100 : 0;

  return (
    <button
      // The thumbnail hook only needs an element to watch; a button is one.
      ref={ref as unknown as React.Ref<HTMLButtonElement>}
      onClick={onOpen}
      className="flex w-[260px] shrink-0 snap-start items-center gap-3 rounded-xl border border-line bg-raised p-2.5 text-left transition-colors hover:border-line-strong sm:w-auto"
    >
      <span className="flex h-[60px] w-[42px] shrink-0 items-center justify-center overflow-hidden rounded-[6px] bg-sunken">
        {url ? (
          <img src={url} alt="" className="size-full object-cover" />
        ) : (
          <BookOpen className="size-4 text-text-tertiary" />
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-sm font-medium">{entry.series_title}</span>
        <span className="truncate text-xs text-text-secondary">
          {entry.page_count > 0
            ? t("libraryView.continueDetail", {
                chapter: entry.chapter,
                page: entry.last_page + 1,
                total: entry.page_count,
              })
            : t("libraryView.continueChapter", { chapter: entry.chapter })}
        </span>
        <span className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-sunken">
          <span
            className="block h-full rounded-full bg-strong"
            style={{ width: `${Math.min(100, progress)}%` }}
          />
        </span>
      </span>
    </button>
  );
}

/** Where each volume of a series stands — the coloured strip under a card. */
type VolumeState = "built" | "complete" | "missing";

/**
 * Volume states per series, fetched when a card scrolls into view and kept
 * for the visit. A big shelf asking for every series' volumes up front is a
 * few hundred queries for cards nobody scrolled to.
 */
const volumeCache = new Map<number, VolumeState[]>();

/** `settleCount` changing means a task finished and the answer may have too. */
function useVolumeStates(
  seriesId: number,
  visible: boolean,
  settleCount: number,
): VolumeState[] | null {
  const [states, setStates] = useState<VolumeState[] | null>(
    () => volumeCache.get(seriesId) ?? null,
  );
  const fetchedAt = useRef<number | null>(volumeCache.has(seriesId) ? settleCount : null);
  useEffect(() => {
    if (!visible || fetchedAt.current === settleCount) return;
    fetchedAt.current = settleCount;
    let live = true;
    libraryVolumes(seriesId)
      .then((volumes) => {
        const next = volumes
          .filter((v) => v.number !== UNSORTED)
          .map<VolumeState>((v) => (v.built ? "built" : isComplete(v) ? "complete" : "missing"));
        volumeCache.set(seriesId, next);
        if (live) setStates(next);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [seriesId, visible, settleCount]);
  return states;
}

function SeriesCard({
  series,
  settleCount,
  onOpen,
  onRemove,
}: {
  series: Series;
  settleCount: number;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const t = useT();
  // The cover is a file in the library, so it goes through the same thumbnail
  // cache as page images rather than a second mechanism.
  const { ref, url } = useThumbnail(series.cover_path ?? "", 300);
  const [visible, setVisible] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), {
      rootMargin: "200px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const states = useVolumeStates(series.id, visible, settleCount);

  const counts = states && {
    built: states.filter((s) => s === "built").length,
    complete: states.filter((s) => s === "complete").length,
    missing: states.filter((s) => s === "missing").length,
  };
  const summary = counts
    ? [
        counts.built && t("libraryView.countBuilt", { n: counts.built }),
        counts.complete && t("libraryView.countReady", { n: counts.complete }),
        counts.missing && t("libraryView.countMissing", { n: counts.missing }),
      ]
        .filter(Boolean)
        .join(" · ") ||
      t("libraryView.chaptersCount", { have: series.have_chapters, known: series.known_chapters || "?" })
    : t("libraryView.chaptersCount", { have: series.have_chapters, known: series.known_chapters || "?" });

  return (
    <div
      ref={(el) => {
        box.current = el;
        ref.current = el;
      }}
      className="group relative flex flex-col gap-2"
    >
      <button onClick={onOpen} className="flex flex-col gap-2.5 text-left">
        <span className="flex aspect-[2/3] w-full items-center justify-center overflow-hidden rounded-[10px] bg-sunken shadow-[0_1px_2px_rgb(20_22_27/0.12)] ring-1 ring-line/70 transition-transform group-hover:-translate-y-0.5">
          {series.cover_path && url ? (
            <img src={url} alt="" className="size-full object-cover" />
          ) : (
            <BookOpen className="size-6 text-text-tertiary" />
          )}
        </span>
        <span className="flex flex-col gap-0.5">
          <span className="line-clamp-2 text-[15px] font-semibold leading-5" title={series.title}>
            {series.title}
          </span>
          <span className="truncate text-xs text-text-secondary">
            {[series.author || t("libraryView.unknownAuthor"), series.year].filter(Boolean).join(" · ")}
          </span>
        </span>
      </button>

      {states && states.length > 0 && (
        <div className="flex flex-wrap gap-1" aria-hidden>
          {states.slice(0, 24).map((state, i) => (
            <span
              key={i}
              className={cn(
                "h-1 w-3.5 rounded-full",
                state === "built" ? "bg-info" : state === "complete" ? "bg-text-tertiary" : "bg-warning",
              )}
            />
          ))}
        </div>
      )}
      <p className="text-xs leading-4 text-text-secondary">{summary}</p>

      <button
        onClick={onRemove}
        title={t("libraryView.removeFromLibrary", { title: series.title })}
        className={cn(
          "absolute right-1.5 top-1.5 rounded-md bg-raised/90 p-1.5 text-text-secondary backdrop-blur-sm transition-opacity hover:text-danger focus-visible:opacity-100",
          !isMobile && "opacity-0 group-hover:opacity-100",
        )}
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );
}

/** Figma "v2/Card adicionar série": the empty shelf's one action. */
function AddCard({ onClick }: { onClick: () => void }) {
  const t = useT();
  return (
    <button
      onClick={onClick}
      className="flex w-full max-w-[220px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong px-5 py-10 text-center transition-colors hover:border-strong hover:bg-hover"
    >
      <span className="flex size-9 items-center justify-center rounded-full bg-sunken">
        <Plus className="size-4" />
      </span>
      <span className="text-sm font-medium">{t("libraryView.addFirstSeries")}</span>
      <span className="text-xs text-text-secondary">{t("libraryView.emptyDescription")}</span>
    </button>
  );
}
