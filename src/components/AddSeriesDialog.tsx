import { useCallback, useEffect, useState } from "react";
import { ChevronRight, Globe, Loader2, Plus } from "lucide-react";

import { SeriesDetail, type TitleChoice } from "@/components/SeriesDetail";
import { SeriesSearch } from "@/components/SeriesSearch";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSeriesDetail } from "@/hooks/useSeriesDetail";
import { cn } from "@/lib/utils";
import type { SeriesMatch } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { libraryAddSeries, type Series } from "@/lib/library";

interface AddSeriesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: (series: Series) => void;
  /** "Not it?" — hand over to searching one extension's own catalogue. */
  onSearchExtensions?: () => void;
}

/**
 * Search for a series and add it to the library.
 *
 * Adding also pulls the published volume layout, which is what turns the
 * library from a list of files into something that can say what is missing.
 */
export function AddSeriesDialog({
  open,
  onOpenChange,
  onAdded,
  onSearchExtensions,
}: AddSeriesDialogProps) {
  const t = useT();
  const [session, setSession] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SeriesMatch | null>(null);
  const [titleChoice, setTitleChoice] = useState<TitleChoice>("english");
  const [chosenCover, setChosenCover] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const detail = useSeriesDetail(selected, setError);

  useEffect(() => {
    if (!open) return;
    setSession((n) => n + 1);
    setSelected(null);
    setChosenCover(null);
    setError(null);
  }, [open]);

  const choose = useCallback((match: SeriesMatch) => {
    setSelected(match);
    setChosenCover(null);
    setTitleChoice(
      match.title_english ? "english" : match.title_romaji ? "romaji" : "native",
    );
  }, []);

  const add = useCallback(async () => {
    if (!selected) return;
    setAdding(true);
    setError(null);
    try {
      // The title choice and the chosen cover ride along on the match, so the
      // backend stores what the user picked rather than re-deciding for itself.
      const title =
        (titleChoice === "english"
          ? selected.title_english
          : titleChoice === "romaji"
            ? selected.title_romaji
            : selected.title_native) ?? selected.title_english;

      const added = await libraryAddSeries({
        ...selected,
        title_english: title,
        thumbnail_url: chosenCover ?? selected.thumbnail_url,
      });
      onAdded(added);
      onOpenChange(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setAdding(false);
    }
  }, [selected, titleChoice, chosenCover, onAdded, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] max-w-4xl">
        <DialogHeader>
          <DialogTitle>{t("addSeriesDialog.title")}</DialogTitle>
          <DialogDescription>{t("addSeriesDialog.description")}</DialogDescription>
        </DialogHeader>

        {/* A fixed height, so the dialog does not jump about as results and
            covers arrive; `flex-auto` still lets it shrink under max-h. */}
        {/* On a phone the two panes stack: side by side, the details were
            squeezed to a word per line. */}
        <DialogBody className="h-[480px] flex-auto flex-row gap-0 overflow-hidden border-t border-border p-0 max-sm:flex-col">
          <SeriesSearch
            initialQuery=""
            session={session}
            selected={selected}
            onSelect={choose}
            onError={setError}
          />

          <div
            className={cn(
              "scrollbar-thin min-w-0 flex-1 overflow-y-auto p-6 max-sm:p-4",
              !selected && "max-sm:hidden",
            )}
          >
            <SeriesDetail
              selected={selected}
              detail={detail}
              titleChoice={titleChoice}
              onTitleChoice={setTitleChoice}
              chosenCover={chosenCover}
              onChooseCover={setChosenCover}
            >
              {detail.layout.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {t("addSeriesDialog.volumesAndChapters", {
                    volumes: detail.layout.length,
                    chapters: detail.layout.reduce((n, v) => n + v.chapters.length, 0),
                  })}
                </p>
              )}
            </SeriesDetail>
          </div>
        </DialogBody>

        <DialogFooter
          // The hint takes its own line on a phone instead of sliding under the buttons.
          className="max-sm:flex-wrap max-sm:[&>div:first-child]:basis-full"
          error={error}
          hint={
            onSearchExtensions && (
              <button
                onClick={onSearchExtensions}
                className="flex items-center gap-2.5 rounded-lg border border-dashed border-line-strong px-3 py-2 text-left transition-colors hover:bg-hover"
              >
                <Globe className="size-4 shrink-0 text-text-secondary" />
                <span className="flex min-w-0 flex-col">
                  <span className="text-xs font-medium">{t("addSeriesDialog.notIt")}</span>
                  <span className="truncate text-[11px] text-text-secondary">
                    {t("addSeriesDialog.searchExtension")}
                  </span>
                </span>
                <ChevronRight className="size-3.5 shrink-0 text-text-secondary" />
              </button>
            )
          }
        >
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("addSeriesDialog.cancel")}
          </Button>
          <Button onClick={() => void add()} disabled={!selected || adding}>
            {adding ? <Loader2 className="animate-spin" /> : <Plus />}
            {t("addSeriesDialog.add")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
