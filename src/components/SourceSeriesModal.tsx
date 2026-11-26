import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, Check, Cloud, Download, Loader2, Plus } from "lucide-react";

import { RemoteImage } from "@/components/RemoteImage";
import { Button } from "@/components/ui/button";
import { Sheet, SheetBody, SheetFooter, SheetHeader, SheetStat } from "@/components/ui/sheet";
import { ratingLabel } from "@/components/LibraryFilters";
import { Hint } from "@/components/ui/tooltip";
import { useT } from "@/lib/i18n";
import {
  mangaDetailsSource,
  volumesSource,
  type ChapterRef,
  type SourceManga,
  type SourceMangaDetails,
  type VolumeChapters,
} from "@/lib/api";
import {
  addSeriesFromSource,
  downloadChapterFromSource,
  type Series,
} from "@/lib/library";
import type { ReaderTarget } from "@/lib/reader";
import { cn } from "@/lib/utils";

interface SourceSeriesModalProps {
  source: string;
  /** What the extension calls itself, for the header's overline. */
  sourceName: string;
  manga: SourceManga;
  /** The library entry, when this series has already been added. */
  owned: Series | null;
  onClose: () => void;
  onOpenSeries: (id: number) => void;
  onRead: (target: ReaderTarget) => void;
  onAdded: () => void;
  onError: (message: string | null) => void;
}

/**
 * The registered-`Source` counterpart of `SeriesModal`.
 *
 * Deliberately simpler: a `Source` only ever answers a flat `manga_details` +
 * `volumes` pair, not MangaDex's statistics, tag-based similar-series search,
 * or per-translation chapter lists — so there is no rating, no "more like
 * this", and no language picker here.
 */
export function SourceSeriesModal({
  source,
  sourceName,
  manga,
  owned,
  onClose,
  onOpenSeries,
  onRead,
  onAdded,
  onError,
}: SourceSeriesModalProps) {
  const t = useT();
  const [details, setDetails] = useState<SourceMangaDetails | null>(null);
  const [layout, setLayout] = useState<VolumeChapters[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [fetching, setFetching] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDetails(null);
    setLayout(null);

    mangaDetailsSource(source, manga.id)
      .then((found) => !cancelled && setDetails(found))
      .catch((e) => !cancelled && onError(String(e)));

    volumesSource(source, manga.id)
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
  }, [source, manga.id, onError]);

  const flat = useMemo(
    () => (layout ?? []).flatMap((volume) => volume.chapters),
    [layout],
  );

  const title = details?.title ?? manga.title;

  const ensureAdded = useCallback(async (): Promise<Series | null> => {
    if (owned) return owned;
    const added = await addSeriesFromSource(source, manga.id, manga.title);
    onAdded();
    return added;
  }, [owned, source, manga.id, onAdded]);

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
        source,
        chapterId: chapter.id,
        seriesTitle: title,
        chapterNumber: chapter.number,
        // Nothing in `MangaDetails` says otherwise, and nearly every site a
        // `Source` extension targets is drawn right to left.
        direction: "right-to-left",
        language: "",
        chapters: flat
          .filter((c) => c.id && !c.unavailable)
          .map((c) => ({ id: c.id as string, number: c.number })),
        seriesSourceId: manga.id,
        coverUrl: details?.cover_url ?? manga.cover_url,
        librarySeriesId: owned?.id ?? null,
      });
    },
    [flat, source, manga.id, manga.cover_url, details?.cover_url, title, owned, onRead],
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

  const altTitles = [details?.title_romaji, details?.title_native]
    .filter((alt) => alt && alt !== title)
    .join(" · ");

  const readable = flat.filter((c) => c.id && !c.unavailable);
  const firstReadable = readable[0] ?? null;
  const volumeCount = (layout ?? []).filter((v) => v.volume && v.volume !== "none").length;
  const cover = details?.cover_url ?? manga.cover_url;

  return (
    <Sheet open onClose={onClose} title={title}>
      <SheetHeader
        closeLabel={t("sourceSeriesModal.close")}
        cover={
          cover ? (
            <RemoteImage url={cover} max={512} className="h-full w-full" />
          ) : (
            <div className="flex h-full items-center justify-center">
              <BookOpen className="size-6 text-on-ink-muted" />
            </div>
          )
        }
        overline={t("sourceSeriesModal.overline", { source: sourceName })}
        title={title}
        byline={[
          details?.author ?? t("sourceSeriesModal.unknownAuthor"),
          details?.artist && details.artist !== details.author ? details.artist : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      />

      <SheetBody>
        <div className="flex gap-2">
          <SheetStat value={layout === null ? "…" : volumeCount} label={t("sourceSeriesModal.statVolumes")} />
          <SheetStat value={layout === null ? "…" : flat.length} label={t("sourceSeriesModal.statChapters")} />
          <SheetStat value={layout === null ? "…" : readable.length} label={t("sourceSeriesModal.statReadable")} />
        </div>

        {altTitles && <p className="-mt-1 text-xs text-text-tertiary">{altTitles}</p>}

        {details?.description && (
          <p className="line-clamp-6 text-sm leading-5 text-text-secondary">{details.description}</p>
        )}

        {details && (details.tags.length > 0 || details.content_rating) && (
          <div className="flex flex-wrap gap-1.5">
            {details.content_rating && details.content_rating !== "safe" && (
              <span className="rounded-full bg-warning-soft px-2.5 py-1 text-xs font-medium text-warning">
                {ratingLabel(t, details.content_rating)}
              </span>
            )}
            {details.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-line px-2.5 py-1 text-xs font-medium text-text-secondary"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        <section className="flex flex-col gap-2">
          <h3 className="type-overline">{t("sourceSeriesModal.chapters")}</h3>
          {layout === null ? (
            <p className="flex items-center gap-2 py-2 text-xs text-text-secondary">
              <Loader2 className="size-3.5 animate-spin" /> {t("sourceSeriesModal.loadingChapters")}
            </p>
          ) : flat.length === 0 ? (
            <p className="py-2 text-xs text-text-secondary">{t("sourceSeriesModal.noChapters")}</p>
          ) : (
            <div className="max-h-80 overflow-y-auto rounded-xl border border-line">
              {layout.map((volume) => (
                <div key={volume.volume}>
                  <p className="sticky top-0 z-10 bg-sunken px-3.5 py-1.5 text-[11px] font-medium text-text-secondary">
                    {t("sourceSeriesModal.volumeHeading", {
                      number: volume.volume,
                      count: volume.chapters.length,
                    })}
                  </p>
                  {volume.chapters.map((chapter) => (
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
      </SheetBody>

      <SheetFooter>
        {owned ? (
          <Button className="w-full" onClick={() => onOpenSeries(owned.id)}>
            <Check />
            {t("sourceSeriesModal.openOnShelf")}
          </Button>
        ) : (
          <Button className="w-full" onClick={() => void add()} disabled={adding}>
            {adding ? <Loader2 className="animate-spin" /> : <Plus />}
            {t("sourceSeriesModal.addToLibrary")}
          </Button>
        )}
        <Button
          variant="outline"
          className="w-full"
          disabled={!firstReadable}
          onClick={() => firstReadable && readChapter(firstReadable)}
        >
          <BookOpen />
          {firstReadable
            ? t("sourceSeriesModal.readChapter", { number: firstReadable.number })
            : t("sourceSeriesModal.nothingToRead")}
        </Button>
        {!owned && <p className="text-xs text-text-tertiary">{t("sourceSeriesModal.addHint")}</p>}
      </SheetFooter>
    </Sheet>
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
        {t("sourceSeriesModal.chapterTitle", { number: chapter.number })}
        {!fetchable && (
          <span className="ml-2 text-[11px] font-normal text-warning">
            {t("sourceSeriesModal.notHosted")}
          </span>
        )}
      </span>

      {fetchable && (
        <div className="flex items-center gap-1">
          <Hint label={t("sourceSeriesModal.readHint")}>
            <Button variant="ghost" size="sm" onClick={onRead} disabled={busy}>
              <Cloud />
              {t("sourceSeriesModal.read")}
            </Button>
          </Hint>
          <Hint label={t("sourceSeriesModal.getHint")}>
            <Button variant="ghost" size="sm" onClick={onGet} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Download />}
              {t("sourceSeriesModal.get")}
            </Button>
          </Hint>
        </div>
      )}
    </div>
  );
}
