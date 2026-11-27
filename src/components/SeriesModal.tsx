import { ratingLabel, statusLabel } from "@/components/LibraryFilters";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Check,
  CircleAlert,
  CircleCheck,
  Cloud,
  Download,
  ExternalLink,
  Loader2,
  Plus,
  Star,
  Users,
} from "lucide-react";

import { RemoteImage } from "@/components/RemoteImage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetBody, SheetFooter, SheetHeader, SheetStat } from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Hint } from "@/components/ui/tooltip";
import {
  languageName,
  seriesChaptersIn,
  seriesStatistics,
  similarSeries,
  sourceLabel,
  type ChapterRef,
  type SeriesMatch,
  type Statistics,
  type VolumeChapters,
} from "@/lib/api";
import {
  downloadChapterFromSource,
  libraryAddSeries,
  type Series,
} from "@/lib/library";
import { ChapterOrderToggle } from "@/components/ui/chapter-order-toggle";
import { inOrder, useChapterOrder } from "@/lib/chapterOrder";
import { useT } from "@/lib/i18n";
import type { ReaderTarget } from "@/lib/reader";
import { cn } from "@/lib/utils";

interface SeriesModalProps {
  series: SeriesMatch;
  /** The library entry, when this series has already been added. */
  owned: Series | null;
  onClose: () => void;
  onOpenSeries: (id: number) => void;
  onRead: (target: ReaderTarget) => void;
  /** Switch the modal to another series without closing it. */
  onPick: (series: SeriesMatch) => void;
  onAdded: () => void;
  onError: (message: string | null) => void;
}

/**
 * Everything about one series, over the browse rather than beside it.
 *
 * A side panel had to be narrow enough to leave the grid usable, which left no
 * room for the things that actually decide whether you want to read something —
 * the rating, the tags, a description you can read without a magnifying glass.
 */
export function SeriesModal({
  series,
  owned,
  onClose,
  onOpenSeries,
  onRead,
  onPick,
  onAdded,
  onError,
}: SeriesModalProps) {
  const [stats, setStats] = useState<Statistics | null>(null);
  const [similar, setSimilar] = useState<SeriesMatch[]>([]);
  const [layout, setLayout] = useState<VolumeChapters[] | null>(null);
  const [order, toggleOrder] = useChapterOrder();
  const [language, setLanguage] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [fetching, setFetching] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const t = useT();

  const title =
    series.title_english ??
    series.title_romaji ??
    series.title_native ??
    t("seriesModal.untitled");
  const altTitles = [series.title_romaji, series.title_native]
    .filter((alt) => alt && alt !== title)
    .join(" · ");

  /**
   * Which translation to show first.
   *
   * A series already in the library keeps whatever was chosen for it, so its
   * chapters stay consistent with what has been downloaded. Otherwise English
   * if it exists, else whatever does — an empty chapter list is a worse first
   * impression than one in a language you did not ask for.
   */
  useEffect(() => {
    const available = series.available_languages;
    const preferred =
      (owned?.language && available.includes(owned.language) && owned.language) ||
      (available.includes("en") ? "en" : available[0]) ||
      null;
    setLanguage(preferred);
    setExpanded(false);
  }, [series.id, series.available_languages, owned?.language]);

  // Rating and neighbours are independent of language and only fetched once.
  useEffect(() => {
    let cancelled = false;
    setStats(null);
    setSimilar([]);

    seriesStatistics(series.source, series.id)
      .then((found) => !cancelled && setStats(found))
      .catch(() => {});

    const genres = series.tags.filter((t) => t.group === "genre").map((t) => t.id);
    similarSeries(series.source, genres, series.id)
      .then((found) => !cancelled && setSimilar(found))
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [series.source, series.id, series.tags]);

  // Chapters follow the chosen language.
  useEffect(() => {
    let cancelled = false;
    setLayout(null);

    seriesChaptersIn(series.source, series.id, language)
      .then((found) => !cancelled && setLayout(found))
      .catch((e) => {
        if (!cancelled) {
          onError(String(e));
          setLayout([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [series.source, series.id, language, onError]);

  const flat = useMemo(
    () => (layout ?? []).flatMap((volume) => volume.chapters),
    [layout],
  );

  const ensureAdded = useCallback(async (): Promise<Series | null> => {
    if (owned) return owned;
    const added = await libraryAddSeries(series, language);
    onAdded();
    return added;
  }, [owned, series, language, onAdded]);

  const add = useCallback(async () => {
    setAdding(true);
    onError(null);
    try {
      const entry = await ensureAdded();
      if (entry) onOpenSeries(entry.id);
    } catch (e) {
      onError(String(e));
    } finally {
      setAdding(false);
    }
  }, [ensureAdded, onOpenSeries, onError]);

  const readChapter = useCallback(
    (chapter: ChapterRef) => {
      if (!chapter.id) return;
      onRead({
        kind: "online",
        source: series.source,
        chapterId: chapter.id,
        seriesTitle: title,
        chapterNumber: chapter.number,
        // MangaDex publishes no reading direction, and nearly everything it
        // carries is drawn right to left.
        direction: "right-to-left",
        language: language ?? "",
        // Only the ones that can actually be opened, so "next" never lands on
        // a chapter the source indexes but does not serve.
        chapters: flat
          .filter((c) => c.id && !c.unavailable)
          .map((c) => ({ id: c.id as string, number: c.number })),
        seriesSourceId: series.id,
        coverUrl: series.thumbnail_url ?? null,
        librarySeriesId: owned?.id ?? null,
      });
    },
    [flat, series.source, series.id, series.thumbnail_url, title, owned, onRead],
  );

  const getChapter = useCallback(
    async (chapter: ChapterRef) => {
      setFetching(chapter.number);
      onError(null);
      try {
        const entry = await ensureAdded();
        if (!entry) return;
        await downloadChapterFromSource(entry.id, chapter.number);
      } catch (e) {
        onError(String(e));
      } finally {
        setFetching(null);
      }
    },
    [ensureAdded, onError],
  );

  // What the design's three tiles count: published volumes (chapters with no
  // volume are not one), chapters in this translation, and the translation.
  const volumeCount = (layout ?? []).filter((v) => v.volume && v.volume !== "none").length;
  const readable = flat.filter((c) => c.id && !c.unavailable);
  const firstReadable = readable[0] ?? null;
  const otherLanguages = Math.max(0, series.available_languages.length - 1);
  const languageLabel = language ? languageName(language, t) : "—";

  return (
    <Sheet open onClose={onClose} title={title}>
      <SheetHeader
        closeLabel={t("seriesModal.close")}
        cover={
          series.thumbnail_url ? (
            <RemoteImage url={series.thumbnail_url} max={512} className="h-full w-full" />
          ) : (
            <div className="flex h-full items-center justify-center">
              <BookOpen className="size-6 text-on-ink-muted" />
            </div>
          )
        }
        overline={
          series.status
            ? t("seriesModal.overlineStatus", { status: statusLabel(t, series.status) })
            : t("seriesModal.overline")
        }
        title={title}
        byline={[
          series.author ?? t("seriesModal.unknownAuthor"),
          series.artist && series.artist !== series.author ? series.artist : null,
          series.year,
        ]
          .filter(Boolean)
          .join(" · ")}
      />

      <SheetBody>
        <div className="flex gap-2">
          <SheetStat
            value={layout === null ? "…" : volumeCount}
            label={t("seriesModal.statVolumes")}
          />
          <SheetStat
            value={layout === null ? "…" : flat.length}
            label={t("seriesModal.statChapters")}
          />
          <SheetStat
            value={languageLabel}
            label={
              otherLanguages > 0
                ? t("seriesModal.statMoreLanguages", { count: otherLanguages })
                : t("seriesModal.statTranslation")
            }
          />
        </div>

        {/* Alternate titles only when they add something. */}
        {altTitles && <p className="-mt-1 text-xs text-text-tertiary">{altTitles}</p>}

        {series.description && (
          <div className="flex flex-col items-start gap-1">
            <p
              className={cn(
                "text-sm leading-5 text-text-secondary",
                !expanded && "line-clamp-5",
              )}
            >
              {series.description}
            </p>
            {series.description.length > 300 && (
              <Button
                variant="link"
                size="sm"
                className="h-auto px-0 text-xs"
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? t("seriesModal.showLess") : t("seriesModal.showMore")}
              </Button>
            )}
          </div>
        )}

        {(series.tags.length > 0 || series.content_rating) && (
          <div className="flex flex-wrap gap-1.5">
            {series.content_rating && series.content_rating !== "safe" && (
              <span className="rounded-full bg-warning-soft px-2.5 py-1 text-xs font-medium text-warning">
                {ratingLabel(t, series.content_rating)}
              </span>
            )}
            {series.tags.map((tag) => (
              <span
                key={tag.id}
                className="rounded-full border border-line px-2.5 py-1 text-xs font-medium text-text-secondary"
              >
                {tag.name}
              </span>
            ))}
          </div>
        )}

        {(stats?.rating != null || stats?.follows != null) && (
          <p className="flex items-center gap-3 text-xs text-text-tertiary">
            {stats?.rating != null && (
              <span className="flex items-center gap-1">
                <Star className="size-3" /> {stats.rating.toFixed(2)}
              </span>
            )}
            {stats?.follows != null && (
              <span className="flex items-center gap-1">
                <Users className="size-3" /> {compact(stats.follows)}
              </span>
            )}
          </p>
        )}

        {/* Whether a volume can actually be made from this, said before the
            user commits to anything — the question this panel exists for. */}
        {layout !== null && (
          <Availability
            total={flat.length}
            readable={readable.length}
            volumes={volumeCount}
            language={languageLabel}
            source={sourceLabel(series.source)}
          />
        )}

        <section className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <h3 className="type-overline flex-1">{t("seriesModal.translation")}</h3>
            <ChapterOrderToggle order={order} onToggle={toggleOrder} />
            <Select
              value={language ?? ""}
              onValueChange={(v) => setLanguage(v)}
              disabled={series.available_languages.length === 0}
            >
              <SelectTrigger className="h-8 w-48 text-xs" aria-label={t("seriesModal.translation")}>
                <SelectValue placeholder={t("seriesModal.noTranslationsListed")} />
              </SelectTrigger>
              <SelectContent>
                {series.available_languages.map((code) => (
                  <SelectItem key={code} value={code}>
                    {languageName(code, t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {layout === null ? (
            <p className="flex items-center gap-2 py-2 text-xs text-text-secondary">
              <Loader2 className="size-3.5 animate-spin" /> {t("seriesModal.loadingChapters")}
            </p>
          ) : flat.length === 0 ? (
            <p className="py-2 text-xs text-text-secondary">
              {t("seriesModal.noChaptersInTranslation")}
              {series.available_languages.length > 1 && t("seriesModal.tryAnotherOne")}
            </p>
          ) : (
            <div className="max-h-72 overflow-y-auto rounded-xl border border-line">
              {inOrder(layout, order).map((volume) => (
                <div key={volume.volume}>
                  <p className="sticky top-0 z-10 bg-sunken px-3.5 py-1.5 text-[11px] font-medium text-text-secondary">
                    {t("seriesModal.volumeHeader", {
                      volume: volume.volume,
                      count: volume.chapters.length,
                    })}
                  </p>
                  {inOrder(volume.chapters, order).map((chapter) => (
                    <ChapterRow
                      key={`${volume.volume}-${chapter.number}`}
                      chapter={chapter}
                      busy={fetching === chapter.number}
                      onRead={() => readChapter(chapter)}
                      onGet={() => void getChapter(chapter)}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
        </section>

        {similar.length > 0 && (
          <section className="flex flex-col gap-2.5">
            <h3 className="type-overline">
              {/* Deliberately not called "similar": this is a tag search,
                  and MangaDex publishes no similarity ranking. */}
              {t("seriesModal.moreWithTheseTags")}
            </h3>
            <div className="scrollbar-none -mx-7 flex gap-3 overflow-x-auto px-7 pb-1 max-sm:-mx-5 max-sm:px-5">
              {similar.map((other) => (
                <button
                  key={other.id}
                  onClick={() => onPick(other)}
                  className="w-20 shrink-0 text-left"
                >
                  <div className="flex aspect-[2/3] items-center justify-center overflow-hidden rounded-md bg-sunken">
                    {other.thumbnail_url ? (
                      <RemoteImage
                        url={other.thumbnail_url}
                        max={256}
                        className="h-full w-full"
                        imageClassName="transition-opacity hover:opacity-80"
                      />
                    ) : (
                      <BookOpen className="size-4 text-text-tertiary" />
                    )}
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-[11px] leading-tight">
                    {other.title_english ?? other.title_romaji ?? other.title_native}
                  </p>
                </button>
              ))}
            </div>
          </section>
        )}
      </SheetBody>

      <SheetFooter>
        {owned ? (
          <Button className="w-full" onClick={() => onOpenSeries(owned.id)}>
            <Check />
            {t("seriesModal.openOnShelf")}
          </Button>
        ) : (
          <Button className="w-full" onClick={() => void add()} disabled={adding}>
            {adding ? <Loader2 className="animate-spin" /> : <Plus />}
            {t("seriesModal.addToLibrary")}
          </Button>
        )}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="min-w-0 flex-1"
            disabled={!firstReadable}
            onClick={() => firstReadable && readChapter(firstReadable)}
          >
            <BookOpen />
            <span className="truncate">
              {firstReadable
                ? t("seriesModal.readChapter", { number: firstReadable.number })
                : t("seriesModal.nothingToRead")}
            </span>
          </Button>
          {series.site_url && (
            <Button variant="ghost" asChild className="shrink-0">
              <a href={series.site_url} target="_blank" rel="noreferrer">
                <ExternalLink />
                {sourceLabel(series.source)}
              </a>
            </Button>
          )}
        </div>
        {!owned && <p className="text-xs text-text-tertiary">{t("seriesModal.addHint")}</p>}
      </SheetFooter>
    </Sheet>
  );
}

/** "All 140 chapters available…" — green when a volume can be made from it. */
function Availability({
  total,
  readable,
  volumes,
  language,
  source,
}: {
  total: number;
  readable: number;
  volumes: number;
  language: string;
  source: string;
}) {
  const t = useT();
  if (total === 0) return null;
  const all = readable === total;
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-[10px] px-3 py-2.5 text-xs text-text-secondary",
        all ? "bg-success-soft" : "bg-warning-soft",
      )}
    >
      {all ? (
        <CircleCheck className="mt-px size-3.5 shrink-0 text-success" />
      ) : (
        <CircleAlert className="mt-px size-3.5 shrink-0 text-warning" />
      )}
      <p>
        {all
          ? volumes > 1
            ? t("seriesModal.availableAll", { count: total, language, source, volumes })
            : volumes === 1
              ? t("seriesModal.availableAllOneVolume", { count: total, language, source })
            : t("seriesModal.availableAllNoVolumes", { count: total, language, source })
          : readable === 0
            ? t("seriesModal.availableNone", { source })
            : t("seriesModal.availableSome", { readable, count: total, language, source })}
      </p>
    </div>
  );
}

function ChapterRow({
  chapter,
  busy,
  onRead,
  onGet,
}: {
  chapter: ChapterRef;
  busy: boolean;
  onRead: () => void;
  onGet: () => void;
}) {
  const t = useT();
  const fetchable = chapter.id !== null && !chapter.unavailable;

  return (
    <div
      className={cn(
        "flex items-center gap-3 border-b border-line px-3.5 py-1.5 last:border-b-0",
        !fetchable && "bg-warning-soft/40",
      )}
    >
      <span className="min-w-0 flex-1 truncate text-xs font-medium">
        {t("seriesModal.chapterTitle", { number: chapter.number })}
        {!fetchable && (
          <span className="ml-2 text-[11px] font-normal text-warning">
            {t("seriesModal.notHostedBySource")}
          </span>
        )}
      </span>

      {fetchable ? (
        <div className="flex items-center gap-1">
          <Hint label={t("seriesModal.readNowHint")}>
            <Button variant="ghost" size="sm" onClick={onRead} disabled={busy}>
              <Cloud />
              {t("seriesModal.read")}
            </Button>
          </Hint>
          <Hint label={t("seriesModal.downloadHint")}>
            <Button variant="ghost" size="sm" onClick={onGet} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Download />}
              {t("seriesModal.get")}
            </Button>
          </Hint>
        </div>
      ) : (
        <Badge variant="outline">{t("seriesModal.urlOnly")}</Badge>
      )}
    </div>
  );
}

/** 213106 -> 213k. Exact follow counts are noise. */
function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}
