import { useCallback, useEffect, useState } from "react";
import { Loader2, Search } from "lucide-react";

import { RemoteImage } from "@/components/RemoteImage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { searchSeries, sourceLabel, type SeriesMatch } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface SeriesSearchProps {
  /** Seeds the box, and is searched for automatically when non-empty. */
  initialQuery: string;
  /** Re-seeded and re-run whenever this changes, e.g. a dialog reopening. */
  session: number;
  selected: SeriesMatch | null;
  onSelect: (match: SeriesMatch) => void;
  onError: (message: string | null) => void;
}

/**
 * The search box and result list, shared by "fetch metadata for this folder"
 * and "add this series to the library".
 *
 * The two do very different things with the result, but finding the series is
 * the same job, and it is the part with the fiddly behaviour: auto-running on
 * open, auto-selecting the first hit, and not re-querying on every keystroke.
 */
export function SeriesSearch({
  initialQuery,
  session,
  selected,
  onSelect,
  onError,
}: SeriesSearchProps) {
  const t = useT();
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SeriesMatch[] | null>(null);
  const [searching, setSearching] = useState(false);

  const runSearch = useCallback(
    async (term: string) => {
      if (!term.trim()) return;
      setSearching(true);
      onError(null);
      try {
        const hits = await searchSeries(term);
        setResults(hits);
        if (hits.length === 0) {
          onError(t("seriesSearch.noMatches"));
        } else {
          onSelect(hits[0]);
        }
      } catch (e) {
        onError(String(e));
        setResults([]);
      } finally {
        setSearching(false);
      }
    },
    [onError, onSelect, t],
  );

  // A new session means a reopened dialog: reset, then search if we were given
  // something to search for. Deliberately not keyed on `query`, which would
  // fire a request at the API on every keystroke.
  useEffect(() => {
    setQuery(initialQuery);
    setResults(null);
    if (initialQuery.trim()) void runSearch(initialQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  return (
    <div className="flex w-[336px] shrink-0 flex-col gap-3 border-r border-border p-4 max-sm:min-h-0 max-sm:w-full max-sm:flex-1 max-sm:border-r-0 max-sm:border-b">
      <div className="flex items-center gap-2">
        <Input
          autoFocus
          value={query}
          placeholder={t("seriesSearch.placeholder")}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void runSearch(query);
          }}
        />
        <Button size="icon" onClick={() => void runSearch(query)} disabled={searching}>
          {searching ? <Loader2 className="animate-spin" /> : <Search />}
        </Button>
      </div>

      {/* The rings on a selected row would be clipped by the scroller's edge
          without the slight inset. */}
      <div className="scrollbar-thin -mx-1 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-1 py-0.5">
        {results === null && !searching && (
          <p className="py-2 text-xs text-muted-foreground">{t("seriesSearch.pressEnter")}</p>
        )}
        {results?.map((match) => (
          <button
            key={`${match.source}-${match.id}`}
            onClick={() => onSelect(match)}
            className={cn(
              "flex w-full shrink-0 items-center gap-3 rounded-lg p-2.5 text-left transition-colors",
              selected?.id === match.id ? "bg-primary/10 ring-1 ring-primary" : "hover:bg-accent",
            )}
          >
            {match.thumbnail_url ? (
              <RemoteImage
                url={match.thumbnail_url}
                max={96}
                className="h-16 w-11 shrink-0 rounded"
              />
            ) : (
              <div className="h-16 w-11 shrink-0 rounded bg-muted" />
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <p className="truncate text-xs font-medium">
                {match.title_english ?? match.title_romaji ?? match.title_native}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">
                {match.author ?? t("seriesSearch.unknownAuthor")}
                {match.year ? ` · ${match.year}` : ""}
              </p>
              <Badge variant="outline" className="mt-1 self-start">
                {sourceLabel(match.source)}
              </Badge>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
