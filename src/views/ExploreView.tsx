import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BookOpen, Check, Compass, Globe, Loader2, Search, SlidersHorizontal } from "lucide-react";

import { BrowseFilters, FilterSummary } from "@/components/BrowseFilters";
import { RemoteImage } from "@/components/RemoteImage";
import { SeriesModal } from "@/components/SeriesModal";
import { SourceSeriesModal } from "@/components/SourceSeriesModal";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/lib/i18n";
import {
  latestSource,
  listSources,
  popularSource,
  searchSource,
  type SeriesMatch,
  type SourceInfo,
  type SourceManga,
} from "@/lib/api";
import {
  browseSeries,
  defaultQuery,
  isFiltered,
  mangadexTags,
  PAGE_SIZE,
  type BrowseQuery,
  type Tag,
} from "@/lib/browse";
import { useRestoredScroll } from "@/hooks/useRestoredScroll";
import { librarySeries, type Series } from "@/lib/library";
import type { ReaderTarget } from "@/lib/reader";

/** The id `MangaDex` is registered under, and Explore's own default. */
const MANGADEX = "mangadex";

/** What a visit to Explore is, so it can be picked up where it was left. */
export interface BrowseState {
  query: BrowseQuery;
  text: string;
  /** `"mangadex"`, or a registered `Source`'s own id. */
  source: string;
}

export const emptyBrowse = (): BrowseState => ({
  query: defaultQuery(),
  text: "",
  source: MANGADEX,
});

interface ExploreViewProps {
  browse: BrowseState;
  onBrowseChange: (update: (current: BrowseState) => BrowseState) => void;
  /** Jump to a series' page in the library. */
  onOpenSeries: (id: number) => void;
  /** Read a chapter straight from the source, without downloading it. */
  onRead: (target: ReaderTarget) => void;
  /** Settings → Extensions, from the source card's "Manage". */
  onManageSources: () => void;
  onError: (message: string | null) => void;
}

/**
 * Browse the catalogue, not just search it — and from whichever source is
 * picked, not only MangaDex.
 *
 * MangaDex keeps its own rich tag/rating/status filtering (`MangaDexExplore`,
 * below), since nothing else registered offers anything close to it. A
 * registered `Source` — built in beyond MangaDex, or a `.lua` extension —
 * only ever answers a flat Popular/Latest/Search, so it gets the simpler
 * `RegisteredSourceExplore` instead. The picker between them lives here, one
 * level up, so switching source doesn't remount the MangaDex view's own
 * state (filters, scroll position) needlessly.
 */
export function ExploreView(props: ExploreViewProps) {
  const [sources, setSources] = useState<SourceInfo[]>([]);
  useEffect(() => {
    listSources()
      .then(setSources)
      .catch(() => {});
  }, []);

  // MangaDex is offered natively, with its own filter UI, rather than as
  // just another registered `Source` — the registry lists it too, under
  // `leaf.mangadex` (so the download path can look it up by the same id
  // space as an extension), but showing it twice in one picker would be
  // confusing.
  const otherSources = useMemo(
    () => sources.filter((s) => s.id !== "leaf.mangadex"),
    [sources],
  );

  const setSource = useCallback(
    (source: string) => props.onBrowseChange((current) => ({ ...current, source })),
    [props.onBrowseChange],
  );

  if (props.browse.source !== MANGADEX && otherSources.some((s) => s.id === props.browse.source)) {
    return (
      <RegisteredSourceExplore
        {...props}
        sourceId={props.browse.source}
        sources={otherSources}
        onSourceChange={setSource}
      />
    );
  }

  return (
    <MangaDexExplore
      {...props}
      sourcePicker={<SourcePicker value={MANGADEX} sources={otherSources} onChange={setSource} />}
    />
  );
}

/**
 * Which catalogue is being browsed — the design's "Source" card: an overline
 * over the picked name, in a raised box beside the title.
 */
function SourcePicker({
  value,
  sources,
  onChange,
}: {
  value: string;
  sources: SourceInfo[];
  onChange: (id: string) => void;
}) {
  const t = useT();
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        className="h-auto w-auto min-w-[200px] gap-3 rounded-xl px-3 py-2 text-left"
        aria-label={t("exploreView.source")}
      >
        <Globe className="size-4 shrink-0 text-text-secondary" />
        {/* A div, not a span: the trigger line-clamps its direct span children. */}
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="font-mono text-[10px] font-medium uppercase leading-3 tracking-[0.06em] text-text-tertiary">
            {t("exploreView.source")}
          </span>
          <div className="truncate text-[13px] font-medium leading-5">
            <SelectValue />
          </div>
        </div>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={MANGADEX}>MangaDex</SelectItem>
        {sources.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {s.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Opening on an empty search box asks the user to already know what they want,
 * which is the opposite of exploring. This opens on the most-followed series and
 * gives sorting, tags and content rating to move around with; the search box is
 * one more filter rather than the way in.
 *
 * Picking a series opens it as a dialog. Everything worth knowing about one —
 * rating, tags, a readable description, every translation it has — does not fit
 * in a panel narrow enough to leave this grid usable.
 */
function MangaDexExplore({
  browse,
  onBrowseChange,
  onOpenSeries,
  onRead,
  onManageSources,
  onError,
  sourcePicker,
}: ExploreViewProps & { sourcePicker: ReactNode }) {
  const t = useT();
  // Held by the app rather than here: leaving for a series unmounts this view,
  // and coming back to a cleared filter bar and the top of the catalogue is not
  // "back", it is starting again.
  const { query, text } = browse;
  const setQuery = useCallback(
    (next: BrowseQuery | ((current: BrowseQuery) => BrowseQuery)) =>
      onBrowseChange((current) => ({
        ...current,
        query: typeof next === "function" ? next(current.query) : next,
      })),
    [onBrowseChange],
  );
  const setText = useCallback(
    (next: string) => onBrowseChange((current) => ({ ...current, text: next })),
    [onBrowseChange],
  );
  const [tags, setTags] = useState<Tag[]>([]);
  const [showFilters, setShowFilters] = useState(false);

  const [results, setResults] = useState<SeriesMatch[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<SeriesMatch | null>(null);
  const [owned, setOwned] = useState<Series[]>([]);

  /** Guards against a slow earlier page landing after a newer one. */
  const request = useRef(0);

  // Restored once the first page of results is on screen; before that there is
  // nothing tall enough to scroll.
  const scroll = useRestoredScroll<HTMLElement>("explore", results.length > 0);

  const refreshOwned = useCallback(() => {
    librarySeries()
      .then(setOwned)
      .catch(() => {});
  }, []);

  useEffect(refreshOwned, [refreshOwned]);

  // The tag list is effectively static, so it is fetched once rather than with
  // every browse.
  useEffect(() => {
    mangadexTags()
      .then(setTags)
      .catch(() => {});
  }, []);

  const run = useCallback(
    async (next: BrowseQuery, append: boolean) => {
      const ticket = ++request.current;
      setLoading(true);
      onError(null);
      try {
        const page = await browseSeries(next);
        // A filter changed while this was in flight; its results are stale.
        if (ticket !== request.current) return;
        setResults((current) => (append ? [...current, ...page.series] : page.series));
        setTotal(page.total);
      } catch (e) {
        if (ticket === request.current) onError(String(e));
      } finally {
        if (ticket === request.current) setLoading(false);
      }
    },
    [onError],
  );

  // Any change to the query starts a fresh first page.
  useEffect(() => {
    void run({ ...query, offset: 0 }, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    query.title,
    query.sort,
    query.descending,
    query.included_tags,
    query.excluded_tags,
    query.content_ratings,
    query.status,
    query.demographic,
  ]);

  const patch = useCallback((fields: Partial<BrowseQuery>) => {
    setQuery((current) => ({ ...current, ...fields, offset: 0 }));
  }, []);

  const submitSearch = useCallback(() => {
    const trimmed = text.trim();
    patch({
      title: trimmed || null,
      // Relevance is only meaningful with a term; dropping it on clear restores
      // an ordering that actually means something.
      sort: trimmed ? "relevance" : "follows",
      descending: true,
    });
  }, [text, patch]);

  const loadMore = useCallback(() => {
    const offset = results.length;
    setQuery((current) => ({ ...current, offset }));
    void run({ ...query, offset }, true);
  }, [results.length, query, run]);

  const ownedFor = useCallback(
    (match: SeriesMatch) =>
      owned.find((s) => s.source === match.source && s.source_id === match.id) ?? null,
    [owned],
  );

  const presets: { key: string; label: string; fields: Partial<BrowseQuery> }[] = [
    { key: "popular", label: t("exploreView.presetPopular"), fields: { sort: "follows", descending: true, status: [] } },
    { key: "latest", label: t("exploreView.presetLatest"), fields: { sort: "latest-upload", descending: true, status: [] } },
    { key: "new", label: t("exploreView.presetNew"), fields: { sort: "recently-added", descending: true, status: [] } },
    { key: "rated", label: t("exploreView.presetRated"), fields: { sort: "rating", descending: true, status: [] } },
    { key: "ongoing", label: t("exploreView.presetOngoing"), fields: { sort: "follows", descending: true, status: ["ongoing"] } },
    { key: "completed", label: t("exploreView.presetCompleted"), fields: { sort: "follows", descending: true, status: ["completed"] } },
  ];
  const presetActive = (fields: Partial<BrowseQuery>) =>
    !query.title &&
    query.sort === fields.sort &&
    query.descending === fields.descending &&
    query.status.join() === (fields.status ?? []).join();

  return (
    <main
      ref={scroll.ref}
      onScroll={scroll.onScroll}
      className="scrollbar-thin h-full overflow-y-auto"
    >
      <div className="mx-auto flex max-w-[1048px] flex-col gap-5 px-5 pb-10 pt-3 sm:px-10 sm:pt-8">
        <ExploreHeader
          subtitle={
            total > 0
              ? t("exploreView.totalOn", { total: total.toLocaleString(), source: "MangaDex" })
              : t("exploreView.subtitleMangaDex")
          }
          picker={sourcePicker}
          onManage={onManageSources}
        />

        <SearchBar
          value={text}
          placeholder={t("exploreView.searchPlaceholder")}
          onChange={setText}
          onSubmit={submitSearch}
          trailing={
            <Button
              variant={showFilters || isFiltered(query) ? "default" : "secondary"}
              size="sm"
              className="h-9 shrink-0"
              onClick={() => setShowFilters((open) => !open)}
              aria-pressed={showFilters}
            >
              <SlidersHorizontal />
              <span className="max-sm:sr-only">{t("exploreView.filters")}</span>
            </Button>
          }
        />

        {showFilters ? (
          <div className="overflow-hidden rounded-xl border border-line bg-raised">
            <BrowseFilters
              query={query}
              tags={tags}
              onChange={patch}
              onReset={() => {
                setText("");
                setQuery(defaultQuery());
              }}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div
              role="radiogroup"
              aria-label={t("exploreView.presets")}
              className="scrollbar-none -mx-5 flex gap-1.5 overflow-x-auto px-5 sm:mx-0 sm:flex-wrap sm:px-0"
            >
              {presets.map((preset) => (
                <Chip
                  key={preset.key}
                  selected={presetActive(preset.fields)}
                  className="h-[30px] px-3.5"
                  onClick={() => {
                    setText("");
                    patch({ ...preset.fields, title: null });
                  }}
                >
                  {preset.label}
                </Chip>
              ))}
            </div>
            <FilterSummary query={query} tags={tags} />
          </div>
        )}

        {results.length === 0 && loading ? (
          <div className="flex items-center gap-2 text-sm text-text-secondary">
            <Loader2 className="size-4 animate-spin" /> {t("exploreView.loading")}
          </div>
        ) : results.length === 0 ? (
          <div className="mx-auto mt-12 max-w-md text-center">
            <Compass className="mx-auto size-8 text-text-tertiary" />
            <h2 className="mt-3 type-heading">{t("exploreView.noMatchesTitle")}</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("exploreView.noMatchesDescription")}
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(118px,1fr))] gap-x-4 gap-y-6">
              {results.map((match) => (
                <ResultCard
                  key={`${match.source}-${match.id}`}
                  match={match}
                  owned={ownedFor(match) !== null}
                  onSelect={() => setSelected(match)}
                />
              ))}
            </div>

            {results.length < total && (
              <div className="mt-5 flex justify-center">
                <Button variant="outline" onClick={loadMore} disabled={loading}>
                  {loading && <Loader2 className="animate-spin" />}
                  {t("exploreView.loadMore", { count: Math.min(PAGE_SIZE, total - results.length) })}
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {selected && (
        <SeriesModal
          series={selected}
          owned={ownedFor(selected)}
          onClose={() => setSelected(null)}
          onOpenSeries={onOpenSeries}
          onRead={onRead}
          // Following a tag suggestion replaces what the dialog is showing
          // rather than stacking another one on top of it.
          onPick={setSelected}
          onAdded={refreshOwned}
          onError={onError}
        />
      )}
    </main>
  );
}

/** The top of Discover, whichever catalogue is showing (Figma 15 · Descobrir). */
function ExploreHeader({
  subtitle,
  picker,
  onManage,
}: {
  subtitle: ReactNode;
  picker: ReactNode;
  onManage: () => void;
}) {
  const t = useT();
  return (
    <header className="flex flex-wrap items-center gap-x-5 gap-y-3">
      {/* A full row on a phone: beside the source card the title was
          squeezed until the card drew over it. */}
      <div className="min-w-0 flex-1 max-sm:basis-full">
        <h1 className="type-display max-sm:text-[32px] max-sm:leading-9">{t("exploreView.title")}</h1>
        <p className="mt-1 text-sm text-text-secondary">{subtitle}</p>
      </div>
      {picker}
      <Button variant="link" className="text-sm" onClick={onManage}>
        {t("exploreView.manage")}
      </Button>
    </header>
  );
}

/**
 * The search field, big and on its own row, with filters inside its right end.
 *
 * Its value lives at the top of the app (it survives opening a series), so
 * every keystroke re-renders from there — fine on a desktop, and the reason
 * the field has a floor on its width: squeezed to nothing on a phone, the
 * caret stayed at 0 and every letter landed in front of the last.
 */
function SearchBar({
  value,
  placeholder,
  onChange,
  onSubmit,
  trailing,
}: {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex h-12 min-w-0 items-center gap-3 rounded-xl border border-line-strong bg-raised pl-4 pr-1.5 focus-within:ring-2 focus-within:ring-ring/40">
      <button type="button" onClick={onSubmit} aria-label={placeholder} className="shrink-0">
        <Search className="size-4 text-text-tertiary" />
      </button>
      <input
        type="search"
        enterKeyHint="search"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSubmit();
        }}
        className="min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-text-tertiary"
      />
      {trailing}
    </div>
  );
}

/** Cover, title, one line of detail — the design's discovery card. */
function DiscoverCard({
  title,
  detail,
  cover,
  owned,
  onSelect,
}: {
  title: string;
  detail?: string;
  cover: string | null;
  owned: boolean;
  onSelect: () => void;
}) {
  return (
    <button onClick={onSelect} className="group flex min-w-0 flex-col gap-2 text-left">
      <span className="relative flex aspect-[2/3] w-full items-center justify-center overflow-hidden rounded-[10px] bg-sunken ring-1 ring-line/70 transition-transform group-hover:-translate-y-0.5">
        {cover ? (
          <RemoteImage url={cover} max={256} className="h-full w-full" />
        ) : (
          <BookOpen className="size-5 text-text-tertiary" />
        )}
        {owned && (
          <span className="absolute right-2 top-2 rounded-full bg-strong p-1">
            <Check className="size-2.5 text-on-strong" />
          </span>
        )}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-[13px] font-medium leading-5">{title}</span>
        {detail && <span className="truncate text-xs text-text-secondary">{detail}</span>}
      </span>
    </button>
  );
}

function ResultCard({
  match,
  owned,
  onSelect,
}: {
  match: SeriesMatch;
  owned: boolean;
  onSelect: () => void;
}) {
  const t = useT();
  return (
    <DiscoverCard
      title={match.title_english ?? match.title_romaji ?? match.title_native ?? ""}
      detail={[match.author ?? t("exploreView.unknownAuthor"), match.year].filter(Boolean).join(" · ")}
      cover={match.thumbnail_url}
      owned={owned}
      onSelect={onSelect}
    />
  );
}

/**
 * The registered-`Source` counterpart of `MangaDexExplore`.
 *
 * A `Source` only ever answers `popular(page)` / `latest(page)` /
 * `search(query, page)` — three flat lists, no tags, no status, no content
 * rating — so there is no filter panel here, only a Popular/Latest toggle
 * next to the search box. Pagination follows `has_next_page` rather than a
 * total count, since a `Source` is never asked to report one.
 */
function RegisteredSourceExplore({
  sourceId,
  sources,
  onSourceChange,
  onOpenSeries,
  onRead,
  onManageSources,
  onError,
}: {
  sourceId: string;
  sources: SourceInfo[];
  onSourceChange: (id: string) => void;
  onOpenSeries: (id: number) => void;
  onRead: (target: ReaderTarget) => void;
  onManageSources: () => void;
  onError: (message: string | null) => void;
}) {
  const t = useT();
  const [mode, setMode] = useState<"popular" | "latest">("popular");
  const [text, setText] = useState("");
  const [results, setResults] = useState<SourceManga[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<SourceManga | null>(null);
  const [owned, setOwned] = useState<Series[]>([]);

  const request = useRef(0);
  const scroll = useRestoredScroll<HTMLElement>("explore-source", results.length > 0);

  const refreshOwned = useCallback(() => {
    librarySeries()
      .then(setOwned)
      .catch(() => {});
  }, []);
  useEffect(refreshOwned, [refreshOwned]);

  const run = useCallback(
    async (searchText: string, targetPage: number, append: boolean) => {
      const ticket = ++request.current;
      setLoading(true);
      onError(null);
      try {
        const found = searchText.trim()
          ? await searchSource(sourceId, searchText, targetPage)
          : mode === "popular"
            ? await popularSource(sourceId, targetPage)
            : await latestSource(sourceId, targetPage);
        if (ticket !== request.current) return;
        setResults((current) => (append ? [...current, ...found.manga] : found.manga));
        setHasMore(found.has_next_page);
      } catch (e) {
        if (ticket === request.current) onError(String(e));
      } finally {
        if (ticket === request.current) setLoading(false);
      }
    },
    [sourceId, mode, onError],
  );

  // A source or mode change starts a fresh first page; the search box is
  // submitted by hand instead, same as MangaDex's.
  useEffect(() => {
    setPage(1);
    void run("", 1, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceId, mode]);

  const submitSearch = useCallback(() => {
    setPage(1);
    void run(text, 1, false);
  }, [text, run]);

  const loadMore = useCallback(() => {
    const next = page + 1;
    setPage(next);
    void run(text, next, true);
  }, [page, text, run]);

  const ownedFor = useCallback(
    (manga: SourceManga) =>
      owned.find((s) => s.source === sourceId && s.source_id === manga.id) ?? null,
    [owned, sourceId],
  );

  const current = sources.find((source) => source.id === sourceId);

  return (
    <main
      ref={scroll.ref}
      onScroll={scroll.onScroll}
      className="scrollbar-thin h-full overflow-y-auto"
    >
      <div className="mx-auto flex max-w-[1048px] flex-col gap-5 px-5 pb-10 pt-3 sm:px-10 sm:pt-8">
        <ExploreHeader
          subtitle={current?.description || t("exploreView.subtitleSource", { source: current?.name ?? sourceId })}
          picker={<SourcePicker value={sourceId} sources={sources} onChange={onSourceChange} />}
          onManage={onManageSources}
        />

        <SearchBar
          value={text}
          placeholder={t("exploreView.searchSourcePlaceholder")}
          onChange={setText}
          onSubmit={submitSearch}
        />

        <div
          role="radiogroup"
          aria-label={t("exploreView.presets")}
          className="flex gap-1.5"
        >
          <Chip selected={mode === "popular"} className="h-[30px] px-3.5" onClick={() => setMode("popular")}>
            {t("exploreView.popular")}
          </Chip>
          <Chip selected={mode === "latest"} className="h-[30px] px-3.5" onClick={() => setMode("latest")}>
            {t("exploreView.latest")}
          </Chip>
        </div>

        {results.length === 0 && loading ? (
          <div className="flex items-center gap-2 text-sm text-text-secondary">
            <Loader2 className="size-4 animate-spin" /> {t("exploreView.loading")}
          </div>
        ) : results.length === 0 ? (
          <div className="mx-auto mt-12 max-w-md text-center">
            <Compass className="mx-auto size-8 text-text-tertiary" />
            <h2 className="mt-3 type-heading">{t("exploreView.emptyTitle")}</h2>
            <p className="mt-1 text-sm text-text-secondary">{t("exploreView.emptyDescription")}</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(118px,1fr))] gap-x-4 gap-y-6">
              {results.map((manga) => (
                <SourceResultCard
                  key={manga.id}
                  manga={manga}
                  owned={ownedFor(manga) !== null}
                  onSelect={() => setSelected(manga)}
                />
              ))}
            </div>

            {hasMore && (
              <div className="mt-5 flex justify-center">
                <Button variant="outline" onClick={loadMore} disabled={loading}>
                  {loading && <Loader2 className="animate-spin" />}
                  {t("exploreView.loadMorePlain")}
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {selected && (
        <SourceSeriesModal
          source={sourceId}
          manga={selected}
          owned={ownedFor(selected)}
          onClose={() => setSelected(null)}
          onOpenSeries={onOpenSeries}
          onRead={onRead}
          onAdded={refreshOwned}
          onError={onError}
        />
      )}
    </main>
  );
}

function SourceResultCard({
  manga,
  owned,
  onSelect,
}: {
  manga: SourceManga;
  owned: boolean;
  onSelect: () => void;
}) {
  return (
    <DiscoverCard title={manga.title} cover={manga.cover_url} owned={owned} onSelect={onSelect} />
  );
}
