import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Search } from "lucide-react";

import { RemoteImage } from "@/components/RemoteImage";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/lib/i18n";
import {
  approveExtension,
  listExtensions,
  listSources,
  lockExtension,
  searchSource,
  setExtensionDev,
  type SourceInfo,
  type SourceManga,
  type UserScript,
} from "@/lib/api";
import { addSeriesFromSource, type Series } from "@/lib/library";
import { cn } from "@/lib/utils";

interface AddFromSourceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: (series: Series) => void;
}

/**
 * Add a series found through a registered `Source` — built in beyond
 * MangaDex/Kitsu, or a `.lua` extension under `<library>/extensions/` —
 * rather than the MangaDex/Kitsu metadata search `AddSeriesDialog` runs.
 *
 * Deliberately simpler than that dialog: a `Source` only ever answers a
 * `title`/`cover_url` pair up front, not the title-language triad or the
 * cover gallery MangaDex offers, so there is nothing to choose between before
 * adding — the backend fetches full details itself once a result is picked.
 */
export function AddFromSourceDialog({ open, onOpenChange, onAdded }: AddFromSourceDialogProps) {
  const t = useT();
  const [sources, setSources] = useState<SourceInfo[] | null>(null);
  const [pending, setPending] = useState<UserScript[]>([]);
  const [dev, setDev] = useState<UserScript[]>([]);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SourceManga[] | null>(null);
  const [selected, setSelected] = useState<SourceManga | null>(null);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setResults(null);
    setSelected(null);
    setError(null);
    listSources()
      .then((found) => {
        setSources(found);
        setSourceId((current) => current ?? found[0]?.id ?? null);
      })
      .catch((e) => setError(String(e)));
    // The trust gate's queues live in this dialog because the dialog is
    // where a source gets *used*, and so where "why isn't the extension I
    // just dropped in the folder here?" gets asked. Failures are ignored on
    // purpose: pending extensions are an opportunity to review, never a
    // precondition for searching the sources that are already approved.
    void refreshGate();
  }, [open]);

  const refreshGate = useCallback(async () => {
    try {
      const found = await listExtensions();
      setPending(found.filter((e) => e.state === "pending"));
      setDev(found.filter((e) => e.state === "dev"));
    } catch {
      setPending([]);
      setDev([]);
    }
  }, []);

  const reloadSources = useCallback(async () => {
    const [found] = await Promise.all([listSources(), refreshGate()]);
    setSources(found);
  }, [refreshGate]);

  const approve = useCallback(
    async (fingerprint: string) => {
      try {
        await approveExtension(fingerprint);
        await reloadSources();
      } catch (e) {
        setError(String(e));
      }
    },
    [reloadSources],
  );

  const markDev = useCallback(
    async (file: string, dev: boolean) => {
      try {
        await setExtensionDev(file, dev);
        await reloadSources();
      } catch (e) {
        setError(String(e));
      }
    },
    [reloadSources],
  );

  const lock = useCallback(
    async (file: string) => {
      try {
        await lockExtension(file);
        await reloadSources();
      } catch (e) {
        setError(String(e));
      }
    },
    [reloadSources],
  );

  const runSearch = useCallback(async () => {
    if (!sourceId || !query.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const page = await searchSource(sourceId, query, 1);
      setResults(page.manga);
      setSelected(page.manga[0] ?? null);
      if (page.manga.length === 0) setError(t("addFromSourceDialog.noMatches"));
    } catch (e) {
      setError(String(e));
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [sourceId, query, t]);

  const add = useCallback(async () => {
    if (!sourceId || !selected) return;
    setAdding(true);
    setError(null);
    try {
      const added = await addSeriesFromSource(sourceId, selected.id, selected.title);
      onAdded(added);
      onOpenChange(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setAdding(false);
    }
  }, [sourceId, selected, onAdded, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("addFromSourceDialog.title")}</DialogTitle>
          <DialogDescription>{t("addFromSourceDialog.description")}</DialogDescription>
        </DialogHeader>

        <DialogBody>
          {(pending.length > 0 || dev.length > 0) && (
            <Callout tone="warning">
              <div className="flex flex-col gap-2">
                {pending.length > 0 && (
                  <>
                    <p className="text-xs">
                      {t("addFromSourceDialog.pendingTitle", { count: pending.length })}
                    </p>
                    {pending.map((p) => (
                      <div key={p.fingerprint} className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium">
                            {p.name} <span className="text-muted-foreground">({p.file})</span>
                          </p>
                          <p className="truncate text-xs text-muted-foreground" dir="ltr">
                            {p.base_url}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void markDev(p.file, true)}
                        >
                          {t("addFromSourceDialog.develop")}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void approve(p.fingerprint)}
                        >
                          {t("addFromSourceDialog.approve")}
                        </Button>
                      </div>
                    ))}
                  </>
                )}
                {dev.length > 0 && (
                  <>
                    <p className="text-xs">
                      {t("addFromSourceDialog.devTitle", { count: dev.length })}
                    </p>
                    {dev.map((p) => (
                      <div key={p.file} className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium">
                            {p.name} <span className="text-muted-foreground">({p.file})</span>
                          </p>
                          <p className="truncate text-xs text-muted-foreground" dir="ltr">
                            {p.base_url}
                          </p>
                        </div>
                        <Button size="sm" variant="ghost" onClick={() => void markDev(p.file, false)}>
                          {t("addFromSourceDialog.stopDeveloping")}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => void lock(p.file)}>
                          {t("addFromSourceDialog.lock")}
                        </Button>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </Callout>
          )}
          {sources !== null && sources.length === 0 ? (
            <Callout tone="info">
              {(() => {
                const [before, rest] = t("addFromSourceDialog.noSources").split("{ext}");
                const [middle, after] = rest.split("{folder}");
                return (
                  <>
                    {before}
                    <code>.lua</code>
                    {middle}
                    <code>extensions</code>
                    {after}
                  </>
                );
              })()}
            </Callout>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                <label
                  htmlFor="source"
                  className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                >
                  {t("addFromSourceDialog.sourceLabel")}
                </label>
                <Select value={sourceId ?? undefined} onValueChange={setSourceId}>
                  <SelectTrigger id="source">
                    <SelectValue placeholder={t("addFromSourceDialog.sourcePlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {sources?.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2">
                <Input
                  autoFocus
                  value={query}
                  placeholder={t("addFromSourceDialog.seriesNamePlaceholder")}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void runSearch();
                  }}
                />
                <Button size="icon" onClick={() => void runSearch()} disabled={searching}>
                  {searching ? <Loader2 className="animate-spin" /> : <Search />}
                </Button>
              </div>

              <div className="scrollbar-thin flex max-h-72 min-h-0 flex-col gap-1 overflow-y-auto rounded-lg border border-border p-1">
                {results === null && !searching && (
                  <p className="p-3 text-xs text-muted-foreground">
                    {t("addFromSourceDialog.pressEnter")}
                  </p>
                )}
                {results?.map((manga) => (
                  <button
                    key={manga.id}
                    onClick={() => setSelected(manga)}
                    className={cn(
                      "flex w-full shrink-0 items-center gap-3 rounded-lg p-2.5 text-left transition-colors",
                      selected?.id === manga.id
                        ? "bg-primary/10 ring-1 ring-inset ring-primary"
                        : "hover:bg-accent",
                    )}
                  >
                    {manga.cover_url ? (
                      <RemoteImage
                        url={manga.cover_url}
                        max={96}
                        className="h-16 w-11 shrink-0 rounded"
                      />
                    ) : (
                      <div className="h-16 w-11 shrink-0 rounded bg-muted" />
                    )}
                    <p className="min-w-0 flex-1 truncate text-xs font-medium">{manga.title}</p>
                  </button>
                ))}
              </div>
            </>
          )}
        </DialogBody>

        <DialogFooter error={error}>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("addFromSourceDialog.cancel")}
          </Button>
          <Button onClick={() => void add()} disabled={!selected || adding}>
            {adding ? <Loader2 className="animate-spin" /> : <Plus />}
            {t("addFromSourceDialog.addToLibrary")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
