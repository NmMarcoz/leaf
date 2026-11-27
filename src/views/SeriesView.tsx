import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  ArrowLeft,
  BookOpen,
  ChevronDown,
  MoreHorizontal,
  Send,
  CircleCheck,
  CircleDashed,
  Download,
  FolderInput,
  Layers,
  Loader2,
  PenLine,
  Pin,
  RefreshCw,
  Trash2,
  X,
  ExternalLink,
  Cloud,
  Plus,
} from "lucide-react";

import { BatchDownloadDialog } from "@/components/BatchDownloadDialog";
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
  type ContextMenuPosition,
} from "@/components/ContextMenu";
import { ChapterFetchDialog } from "@/components/ChapterFetchDialog";
import { OrganizeChaptersPanel } from "@/components/OrganizeChaptersPanel";
import {
  isReadable,
  ReadingModeChapters,
  sourceOrder,
} from "@/components/ReadingModeChapters";
import { RemoteImage } from "@/components/RemoteImage";
import { RemoveSeriesDialog } from "@/components/RemoveSeriesDialog";
import { SourceDownloadDialog } from "@/components/SourceDownloadDialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Hint } from "@/components/ui/tooltip";
import { useThumbnail } from "@/hooks/useThumbnail";
import { useT } from "@/lib/i18n";
import type { Translator } from "@/lib/i18n/types";
import {
  languageName,
  deliverBuilt,
  deliverLabel,
  type MetaSource,
  formatBytes,
  type Format,
  type Volume,
} from "@/lib/api";
import { buildLibraryVolumes, type Device } from "@/lib/settings";
import {
  canFetchDirectly,
  downloadChapterFromSource,
  downloadedCount,
  importChapter,
  isComplete,
  libraryAssignChaptersToVolume,
  libraryBuildVolume,
  libraryDeleteChapter,
  libraryDownloadCovers,
  libraryRefetchMetadata,
  librarySeries,
  librarySyncSeries,
  libraryLanguages,
  librarySetLanguage,
  libraryUnlockChapters,
  libraryVolumes,
  missingChapters,
  summariseRuns,
  UNSORTED,
  volumeLabel,
  type ChapterStatus,
  type Series,
  type VolumeStatus,
} from "@/lib/library";
import type { ReaderTarget } from "@/lib/reader";
import {
  clearSeriesHistory,
  resumePoint,
  seriesHistory,
  type HistoryEntry,
} from "@/lib/reader";
import { canSendToDevice, isMobile } from "@/lib/platform";
import { cn } from "@/lib/utils";

interface SeriesViewProps {
  seriesId: number;
  selectedVolume: string | null;
  onSelectedVolumeChange: (selected: string | null) => void;
  onBack: () => void;
  /** Hand a built volume to the editor. */
  onEditVolume: (volume: Volume, source: { seriesId: number; number: string }) => void;
  /** The user's readers; builds use the default one unless another is picked. */
  devices: Device[];
  defaultDevice: Device | null;
  /** Settings → Devices, for the send button when there is no device yet. */
  onOpenDevices: () => void;
  /** Open a downloaded chapter in the reader. */
  /**
   * Open a chapter, however it can be reached.
   *
   * A finished target rather than a chapter number: whether it opens from disk
   * or streams depends on what is actually there, and this view is the one
   * holding both the chapter and the series it belongs to.
   */
  onRead: (target: ReaderTarget) => void;
  onError: (message: string | null) => void;
  /** The queue changed; the app should show it. */
  onTasksChanged: () => void;
}

const READING_MODE_KEY = "leaf:series-reading-mode";

/**
 * Whether series pages open in reading mode.
 *
 * One switch for every series rather than one each: it is a way of using the
 * app — reading through, not assembling volumes — and someone in that mode
 * does not want to turn it on again for every title they open.
 */
function loadReadingMode(): boolean {
  try {
    return localStorage.getItem(READING_MODE_KEY) === "1";
  } catch {
    return false;
  }
}

function saveReadingMode(on: boolean) {
  try {
    localStorage.setItem(READING_MODE_KEY, on ? "1" : "0");
  } catch {
    // Private storage off: the mode just will not outlive this page.
  }
}

/**
 * Where the page is in the reading-mode film (Figma "v2 · Modo de leitura ·
 * transições em etapas"). The `to-` stages are the outgoing half: both
 * layouts are briefly on screen, one leaving.
 */
type Stage = "volumes" | "to-chapters" | "chapters" | "to-volumes";

/** The panel's slide (420ms) and the content's collapse (220ms) in ms. */
const PANEL_MS = 420;
const COLLAPSE_MS = 220;

/**
 * One series as a shelf of volumes, with the gaps visible at a glance.
 *
 * The gallery is the point: published cover art makes a volume recognisable in a
 * way "Volume 7" never does, and the completeness badge turns "what am I
 * missing" into something answerable by looking rather than reading. Selecting a
 * volume opens its chapters in the side panel.
 */
export function SeriesView({
  seriesId,
  selectedVolume,
  onSelectedVolumeChange,
  onBack,
  onEditVolume,
  devices,
  defaultDevice,
  onOpenDevices,
  onRead,
  onError,
  onTasksChanged,
}: SeriesViewProps) {
  const t = useT();
  // What a build writes when nothing more specific is asked: the default
  // device's format. EPUB with no device, as before there were devices.
  const defaultFormat = defaultDevice?.format ?? "epub";
  const [series, setSeries] = useState<Series | null>(null);
  const [volumes, setVolumes] = useState<VolumeStatus[] | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [refetching, setRefetching] = useState(false);
  const [building, setBuilding] = useState<string | null>(null);
  const [fetching, setFetching] = useState<string | null>(null);
  const [organizing, setOrganizing] = useState(false);
  const [removing, setRemoving] = useState(false);
  // A "get missing" run, once the user has chosen how to fetch. `wanted` is
  // what will be attempted: the whole series, or just one volume's gap.
  const [batching, setBatching] = useState<string[] | null>(null);
  const [fromSource, setFromSource] = useState<string[] | null>(null);
  // Where to pop the choice of route, and what it would cover.
  const [routing, setRouting] = useState<
    { at: ContextMenuPosition; wanted: string[] } | null
  >(null);
  const [rebuild, setRebuild] = useState<VolumeStatus | null>(null);
  const [resume, setResume] = useState<ChapterStatus | null>(null);
  const [read, setRead] = useState<HistoryEntry[]>([]);
  const [forgetting, setForgetting] = useState(false);
  // Fetched when the picker is first opened rather than with the page: it is a
  // network call for something most visits never look at.
  const [languages, setLanguages] = useState<string[] | null>(null);
  const [switching, setSwitching] = useState(false);

  const [readingMode, setReadingMode] = useState(loadReadingMode);
  const [stage, setStage] = useState<Stage>(() => (loadReadingMode() ? "chapters" : "volumes"));
  /** Whether a toggle has happened: what arrives on first load just appears. */
  const [animated, setAnimated] = useState(false);
  const [panelMotion, setPanelMotion] = useState<"in" | "out" | null>(null);
  /** The volume whose panel reading mode closed, to bring back on leaving it. */
  const restoreVolume = useRef<string | null>(null);
  const stageTimers = useRef<number[]>([]);
  useEffect(() => () => stageTimers.current.forEach((id) => window.clearTimeout(id)), []);

  // Volume numbers picked for a batch build, plus the anchor shift-click extends
  // from. Mirrors how the page grid in the editor already behaves.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [menu, setMenu] = useState<ContextMenuPosition | null>(null);
  // A set, not one chapter. Downloads are started one tap at a time but run
  // together, so a single value made the previous chapter's spinner stop the
  // moment the next was tapped, and the first one to finish stopped all of them.
  const [fetchingDirect, setFetchingDirect] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const refresh = useCallback(async () => {
    try {
      const [all, found, next, log] = await Promise.all([
        librarySeries(),
        libraryVolumes(seriesId),
        // Both are reading state rather than library state, and both are
        // cheap enough to come along rather than needing their own refresh.
        resumePoint(seriesId).catch(() => null),
        seriesHistory(seriesId).catch(() => []),
      ]);
      setSeries(all.find((s) => s.id === seriesId) ?? null);
      setVolumes(found);
      setResume(next);
      setRead(log);
      return found;
    } catch (e) {
      onError(String(e));
      return null;
    }
  }, [seriesId, onError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Leaving the volume that was being organized (or closing the panel
  // entirely) always leaves organize mode too, rather than carrying it into
  // whatever is opened next.
  useEffect(() => {
    setOrganizing(false);
  }, [selectedVolume]);

  /**
   * Pull any volume covers we do not hold yet, then show them.
   *
   * Done once per series rather than on every render, and silently: a cover that
   * will not download is a cosmetic problem, not something to interrupt over.
   */
  useEffect(() => {
    let cancelled = false;
    libraryDownloadCovers(seriesId)
      .then((fetched) => {
        if (fetched > 0 && !cancelled) void refresh();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [seriesId, refresh]);

  const sync = useCallback(async () => {
    setSyncing(true);
    onError(null);
    try {
      await librarySyncSeries(seriesId);
      await refresh();
      // A sync can introduce volumes whose art we have never fetched.
      if ((await libraryDownloadCovers(seriesId)) > 0) await refresh();
    } catch (e) {
      onError(String(e));
    } finally {
      setSyncing(false);
    }
  }, [seriesId, refresh, onError]);

  const refetchMetadata = useCallback(async () => {
    setRefetching(true);
    onError(null);
    try {
      await libraryRefetchMetadata(seriesId);
      await refresh();
    } catch (e) {
      onError(String(e));
    } finally {
      setRefetching(false);
    }
  }, [seriesId, refresh, onError]);

  const assignToVolume = useCallback(
    async (numbers: string[], volume: string) => {
      onError(null);
      try {
        await libraryAssignChaptersToVolume(seriesId, numbers, volume);
        await refresh();
      } catch (e) {
        onError(String(e));
      }
    },
    [seriesId, refresh, onError],
  );

  /** Undo a manual assignment and re-pull the real volume in one action. */
  const resetToSource = useCallback(
    async (numbers: string[]) => {
      onError(null);
      try {
        await libraryUnlockChapters(seriesId, numbers);
        await librarySyncSeries(seriesId);
        await refresh();
      } catch (e) {
        onError(String(e));
      }
    },
    [seriesId, refresh, onError],
  );

  const edit = useCallback(
    async (number: string) => {
      setBuilding(number);
      onError(null);
      try {
        const built = await libraryBuildVolume(seriesId, number);
        onEditVolume(built, { seriesId, number });
      } catch (e) {
        onError(String(e));
      } finally {
        setBuilding(null);
      }
    },
    [seriesId, onEditVolume, onError],
  );

  const importFolder = useCallback(
    async (chapter: string) => {
      const picked = await openDialog({ directory: true, multiple: false });
      if (typeof picked !== "string") return;
      onError(null);
      try {
        await importChapter(seriesId, chapter, picked);
        await refresh();
      } catch (e) {
        onError(String(e));
      }
    },
    [seriesId, refresh, onError],
  );

  /**
   * Pull a chapter straight from the metadata source.
   *
   * Only offered when a sync recorded the source's chapter id and the source
   * actually hosts the images. Everything else falls back to pasting a URL.
   */
  const fetchDirect = useCallback(
    async (chapter: string) => {
      let already = false;
      setFetchingDirect((current) => {
        already = current.has(chapter);
        if (already) return current;
        return new Set(current).add(chapter);
      });
      // Tapping the same chapter twice should not start a second download of it.
      if (already) return;

      onError(null);
      try {
        await downloadChapterFromSource(seriesId, chapter);
        await refresh();
      } catch (e) {
        onError(String(e));
      } finally {
        setFetchingDirect((current) => {
          const next = new Set(current);
          next.delete(chapter);
          return next;
        });
      }
    },
    [seriesId, refresh, onError],
  );

  const removeChapter = useCallback(
    async (chapter: string) => {
      onError(null);
      try {
        await libraryDeleteChapter(seriesId, chapter);
        await refresh();
      } catch (e) {
        onError(String(e));
      }
    },
    [seriesId, refresh, onError],
  );

  /** Every chapter the library knows about but does not hold, in order. */
  const missing = useMemo(
    () =>
      (volumes ?? []).flatMap((volume) =>
        missingChapters(volume).map((chapter) => chapter.number),
      ),
    [volumes],
  );

  const detail = volumes?.find((v) => v.number === selectedVolume) ?? null;

  /* ----------------------------------------------------------- selection */

  const order = useMemo(() => (volumes ?? []).map((v) => v.number), [volumes]);

  /** Volumes with at least one chapter on disk; the rest cannot be built. */
  const buildable = useMemo(
    () => new Set((volumes ?? []).filter((v) => downloadedCount(v) > 0).map((v) => v.number)),
    [volumes],
  );

  /**
   * Click to select and open, ctrl/cmd-click to toggle, shift-click to extend.
   *
   * The same three gestures the page grid in the editor uses, so a range of
   * volumes is picked exactly the way a range of pages is.
   */
  const pick = useCallback(
    (number: string, event: React.MouseEvent) => {
      if (event.shiftKey && anchor) {
        const from = order.indexOf(anchor);
        const to = order.indexOf(number);
        if (from !== -1 && to !== -1) {
          const [lo, hi] = from < to ? [from, to] : [to, from];
          setPicked((prev) => new Set([...prev, ...order.slice(lo, hi + 1)]));
          return;
        }
      }
      if (event.metaKey || event.ctrlKey) {
        setPicked((prev) => {
          const next = new Set(prev);
          if (next.has(number)) next.delete(number);
          else next.add(number);
          return next;
        });
        setAnchor(number);
        return;
      }
      // A plain click is both "this one" and "show me its chapters".
      setPicked(new Set([number]));
      setAnchor(number);
      onSelectedVolumeChange(selectedVolume === number ? null : number);
    },
    [anchor, order],
  );

  const openMenu = useCallback(
    (number: string, event: React.MouseEvent) => {
      event.preventDefault();
      // Right-clicking outside the current selection replaces it, which is what
      // every file manager does and what avoids acting on something unseen.
      setPicked((prev) => (prev.has(number) ? prev : new Set([number])));
      setAnchor(number);
      setMenu({ x: event.clientX, y: event.clientY });
    },
    [],
  );

  /* ------------------------------------------------------- batch building */

  /**
   * Queue a build of the selected volumes.
   *
   * Writing a volume is a minute of re-encoding per volume, so it goes on the
   * queue like a download does. The selection is cleared once it is handed
   * over: leaving it ticked invites building the same thing twice.
   */
  const runBuild = useCallback(
    async (askWhere: boolean): Promise<boolean> => {
      const chosen = order.filter((n) => picked.has(n) && buildable.has(n));
      if (chosen.length === 0) return false;

      let outDir: string | null = null;
      if (askWhere) {
        const folder = await openDialog({ directory: true, multiple: false });
        if (typeof folder !== "string") return false;
        outDir = folder;
      }

      onError(null);
      try {
        await buildLibraryVolumes({
          id: seriesId,
          volumes: chosen,
          format: defaultFormat as Format,
          outDir,
        });
        setPicked(new Set());
        onTasksChanged();
        return true;
      } catch (e) {
        onError(String(e));
        return false;
      }
    },
    [order, picked, buildable, seriesId, defaultFormat, onError, onTasksChanged],
  );

  /** Build the selection and mail each volume, as one queued job. */
  const runBuildAndSend = useCallback(async () => {
    const chosen = order.filter((n) => picked.has(n) && buildable.has(n));
    if (chosen.length === 0) return;
    onError(null);
    try {
      await buildLibraryVolumes({
        id: seriesId,
        volumes: chosen,
        format: defaultFormat as Format,
        outDir: null,
        deliver: true,
      });
      setPicked(new Set());
      onTasksChanged();
    } catch (e) {
      onError(String(e));
    }
  }, [order, picked, buildable, seriesId, defaultFormat, onError, onTasksChanged]);

  /**
   * The volume panel's main actions, for the one volume showing.
   *
   * `send` builds and mails it as one queued job; otherwise it is built to the
   * build folder (or wherever the user picks). Both go on the queue, so the
   * panel stays usable while they run.
   */
  const buildOne = useCallback(
    async (number: string, how: "send" | "build" | "build-as", deviceId?: string) => {
      // Another device is a different build, not just a different address:
      // its own format, page size and spreads.
      const device = devices.find((d) => d.id === deviceId) ?? defaultDevice;
      let outDir: string | null = null;
      if (how === "build-as") {
        const folder = await openDialog({ directory: true, multiple: false });
        if (typeof folder !== "string") return;
        outDir = folder;
      }
      onError(null);
      try {
        await buildLibraryVolumes({
          id: seriesId,
          volumes: [number],
          format: (device?.format ?? "epub") as Format,
          outDir,
          deliver: how === "send",
          device: device?.id ?? null,
        });
        onTasksChanged();
      } catch (e) {
        onError(String(e));
      }
    },
    [seriesId, devices, defaultDevice, onError, onTasksChanged],
  );

  // "Protect before acting": building a volume with chapters missing asks
  // first, and offers to fetch them instead (Figma 09 · Volume incompleto).
  const [confirming, setConfirming] = useState<
    { volume: VolumeStatus; how: "send" | "build" | "build-as"; device?: string } | null
  >(null);
  const [more, setMore] = useState<ContextMenuPosition | null>(null);

  /**
   * How to open a chapter of this series.
   *
   * Downloaded pages come off disk. Anything else the source indexed is
   * streamed, which needs the series' own id — without it the reader would
   * record a nameless series it could never find again.
   */
  const openChapter = useCallback(
    (chapter: ChapterStatus) => {
      if (chapter.folder || !chapter.source_id || !series?.source_id) {
        onRead({ kind: "library", seriesId, chapter: chapter.number });
        return;
      }
      onRead({
        kind: "online",
        source: (series.source ?? "mangadex") as MetaSource,
        chapterId: chapter.source_id,
        seriesTitle: series.title,
        chapterNumber: chapter.number,
        direction: series.direction === "left-to-right" ? "left-to-right" : "right-to-left",
        language: series.language,
        // The whole series in reading order, so finishing one chapter moves to
        // the next rather than stopping at whatever was opened.
        chapters: (volumes ?? [])
          .flatMap((v) => v.chapters)
          .filter((c) => c.source_id && !c.unavailable)
          .map((c) => ({ id: c.source_id as string, number: c.number })),
        seriesSourceId: series.source_id,
        coverUrl: null,
        librarySeriesId: seriesId,
      });
    },
    [series, seriesId, volumes, onRead],
  );

  /**
   * Turn reading mode on or off, in the design's stages.
   *
   * On: the volume panel slides away and gives its width back, the shelf
   * folds up, and only then does the chapter list come in. Off runs it
   * backwards — list folds, shelf returns, and the panel that was open slides
   * back last. Each step waits for the one before so nothing moves under
   * something else that is moving.
   */
  const toggleReadingMode = useCallback(
    (on: boolean) => {
      stageTimers.current.forEach((id) => window.clearTimeout(id));
      stageTimers.current = [];
      const quick = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const later = (ms: number, run: () => void) => {
        stageTimers.current.push(window.setTimeout(run, quick ? 0 : ms));
      };

      setReadingMode(on);
      saveReadingMode(on);
      setAnimated(true);

      if (on) {
        // On a phone the panel covers the page, switch included, so it can
        // only be closed already; nothing to slide or bring back.
        const panelOpen = !isMobile && selectedVolume !== null;
        restoreVolume.current = panelOpen ? selectedVolume : null;
        setPanelMotion(panelOpen ? "out" : null);
        setStage("to-chapters");
        later(panelOpen ? PANEL_MS + 20 : COLLAPSE_MS + 20, () => {
          setStage("chapters");
          setPanelMotion(null);
          if (selectedVolume !== null) onSelectedVolumeChange(null);
        });
      } else {
        setStage("to-volumes");
        later(COLLAPSE_MS + 20, () => {
          setStage("volumes");
          const back = restoreVolume.current;
          restoreVolume.current = null;
          if (!back) return;
          later(200, () => {
            setPanelMotion("in");
            onSelectedVolumeChange(back);
            later(PANEL_MS + 20, () => setPanelMotion(null));
          });
        });
      }
    },
    [selectedVolume, onSelectedVolumeChange],
  );

  const showVolumes = stage === "volumes" || stage === "to-chapters";
  const showChapters = stage === "chapters" || stage === "to-volumes";

  /** The whole series in the order the source lists it, for reading mode. */
  const listed = useMemo(
    () => sourceOrder((volumes ?? []).flatMap((v) => v.chapters)),
    [volumes],
  );
  /** Where "straight to a chapter" goes: where reading left off, or the start. */
  const quickRead = resume ?? listed.find(isReadable) ?? null;

  const pickedBuildable = order.filter((n) => picked.has(n) && buildable.has(n));

  const builtCount = (volumes ?? []).filter((v) => v.built).length;
  const readyCount = (volumes ?? []).filter(
    (v) => !v.built && v.number !== UNSORTED && isComplete(v),
  ).length;
  const chapterTotal = (volumes ?? []).reduce((n, v) => n + v.chapters.length, 0);
  const publishedCount = (volumes ?? []).filter((v) => v.number !== UNSORTED).length;

  return (
    // overflow-hidden: the volume panel slides out past the right edge.
    <div className="relative flex h-full min-h-0 overflow-hidden">
      <main
        className="scrollbar-thin min-w-0 flex-1 overflow-y-auto"
        onClick={(e) => {
          if (e.target === e.currentTarget) setPicked(new Set());
        }}
      >
        <div
          className={cn(
            "mx-auto flex flex-col gap-7 px-5 pb-10 pt-5 transition-[max-width] duration-300 sm:px-8 sm:pt-8",
            // The list has more to say per row than a volume card, and reading
            // mode has the panel's width to spend on it.
            showChapters ? "max-w-[1048px]" : "max-w-[880px]",
          )}
        >
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              className="-ml-3"
              onClick={() => {
                // On mobile, closing the volume panel comes before leaving the series.
                if (isMobile && selectedVolume) onSelectedVolumeChange(null);
                else onBack();
              }}
            >
              <ArrowLeft />
              {t("seriesView.backToShelf")}
            </Button>
            <div className="flex-1" />
            {/* Figma 07c: the switch sits in the top bar in both modes, so
                the way back out is where the way in was. */}
            <div className="flex items-center gap-3 pr-1">
              <Label
                htmlFor="reading-mode"
                className="cursor-pointer whitespace-nowrap text-sm font-medium normal-case tracking-normal text-foreground"
              >
                {t("seriesView.readingMode")}
              </Label>
              <Switch
                id="reading-mode"
                checked={readingMode}
                onCheckedChange={toggleReadingMode}
                title={t("seriesView.readingModeHint")}
              />
            </div>
            {/* In reading mode this moves down beside the chapter filters. */}
            {missing.length > 0 && showVolumes && (
              <Button
                variant="outline"
                className={cn(stage === "to-chapters" && "collapse-out")}
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  setRouting({ at: { x: r.left, y: r.bottom + 4 }, wanted: missing });
                }}
                title={t("seriesView.findMissingHint", { count: missing.length })}
                aria-label={t("seriesView.getMissing", { count: missing.length })}
              >
                <Download />
                {/* A phone's top bar has the switch to fit as well. */}
                <span className="max-sm:hidden">
                  {t("seriesView.getMissing", { count: missing.length })}
                </span>
              </Button>
            )}
            <Button
              variant="outline"
              size="icon"
              aria-label={t("seriesView.more")}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setMore({ x: r.right - 220, y: r.bottom + 4 });
              }}
            >
              {syncing || refetching ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
            </Button>
          </div>

          {/* The same things the discover dialog shows, above the volumes
              rather than in a dialog: this page is where a series in the
              library is looked at. */}
          {series && (
            <SeriesDetails
              series={series}
              languages={languages}
              switching={switching}
              onLoadLanguages={() => {
                if (languages !== null) return;
                void libraryLanguages(seriesId)
                  .then(setLanguages)
                  .catch(() => setLanguages([]));
              }}
              onLanguage={(code) => {
                setSwitching(true);
                onError(null);
                void librarySetLanguage(seriesId, code)
                  .then(() => refresh())
                  .catch((e) => onError(String(e)))
                  .finally(() => setSwitching(false));
              }}
              resume={showChapters ? null : resume}
              readCount={read.length}
              onResume={() => resume && openChapter(resume)}
              onForget={() => setForgetting(true)}
              aside={
                showChapters && quickRead ? (
                  <QuickRead
                    chapter={quickRead}
                    onRead={() => openChapter(quickRead)}
                    className={cn(
                      stage === "to-volumes" ? "collapse-out" : animated ? "rise-in" : undefined,
                    )}
                  />
                ) : null
              }
            />
          )}

          {showChapters && volumes !== null && (
            <section
              className={cn(
                "flex flex-col gap-4",
                stage === "to-volumes" && "collapse-out",
              )}
            >
              <div className="flex items-baseline gap-4">
                <h2 className="type-subtitle flex-1">{t("seriesView.chaptersOverline")}</h2>
                {volumes.length > 0 && (
                  <span className="text-xs text-text-secondary">
                    {t("seriesView.publishedSummary", {
                      volumes: publishedCount,
                      chapters: chapterTotal,
                    })}
                  </span>
                )}
              </div>
              <ReadingModeChapters
                chapters={listed}
                resume={resume?.number ?? null}
                missingCount={missing.length}
                sourceName={
                  series?.source === "mangadex" || series?.source === "kitsu"
                    ? sourceLabel(series.source, t)
                    : null
                }
                // Only a chapter's own URL names where it came from: the id
                // fallback in `chapterSource` assumes MangaDex, which is wrong
                // for a series read through an extension.
                sourceOf={(chapter) => (chapter.source_url ? chapterSource(chapter) : null)}
                fetchingDirect={fetchingDirect}
                onRead={openChapter}
                onFetchDirect={(chapter) => void fetchDirect(chapter)}
                onGet={setFetching}
                onGetMissing={(at) => setRouting({ at, wanted: missing })}
                animate={animated && stage === "chapters"}
              />
            </section>
          )}

          {showVolumes && volumes !== null && volumes.length > 0 && (
            <div
              className={cn(
                "grid grid-cols-3 gap-3 max-sm:gap-2",
                stage === "to-chapters"
                  ? "collapse-out"
                  : animated
                    ? "rise-in"
                    : undefined,
              )}
              // The shelf folds while the panel is still leaving, not before.
              style={stage === "to-chapters" && panelMotion === "out" ? { animationDelay: "200ms" } : undefined}
            >
              <StatCard tone="info" label={t("seriesView.statBuilt")} value={builtCount} />
              <StatCard tone="ink" label={t("seriesView.statReady")} value={readyCount} />
              <StatCard tone="warning" label={t("seriesView.statMissing")} value={missing.length} />
            </div>
          )}

          {showVolumes && (
          <section
            className={cn(
              "flex flex-col gap-4",
              stage === "to-chapters" ? "collapse-out" : animated ? "rise-in" : undefined,
            )}
            style={
              stage === "to-chapters" && panelMotion === "out"
                ? { animationDelay: "200ms" }
                : stage === "volumes" && animated
                  ? { animationDelay: "60ms" }
                  : undefined
            }
          >
            <div className="flex items-baseline gap-4">
              <h2 className="type-subtitle flex-1">{t("seriesView.volumes")}</h2>
              {volumes !== null && volumes.length > 0 && (
                <span className="text-xs text-text-secondary">
                  {t("seriesView.publishedSummary", {
                    volumes: publishedCount,
                    chapters: chapterTotal,
                  })}
                </span>
              )}
            </div>

          {volumes === null ? (
            <div className="flex items-center gap-2 text-sm text-text-secondary">
              <Loader2 className="size-4 animate-spin" /> {t("seriesView.loadingVolumes")}
            </div>
          ) : volumes.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line-strong px-6 py-12 text-center">
              <BookOpen className="mx-auto size-7 text-text-tertiary" />
              <h3 className="mt-3 type-heading">{t("seriesView.noVolumeLayoutTitle")}</h3>
              <p className="mt-1 text-sm text-text-secondary">
                {t("seriesView.noVolumeLayoutDescription")}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-x-3 gap-y-5">
              {volumes.map((volume) => (
                <VolumeCard
                  key={volume.number}
                  volume={volume}
                  open={selectedVolume === volume.number}
                  picked={picked.has(volume.number)}
                  building={building === volume.number}
                  onPick={(e) => pick(volume.number, e)}
                  onContextMenu={(e) => openMenu(volume.number, e)}
                  onEdit={() => void edit(volume.number)}
                />
              ))}
            </div>
          )}
          </section>
          )}
        </div>
      </main>

        {detail && showVolumes && (
          <VolumePanel
            className={
              panelMotion === "out" ? "panel-out" : panelMotion === "in" ? "panel-in" : undefined
            }
            volume={detail}
            pageCount={detail.chapters.reduce((n, c) => n + (c.folder ? c.page_count : 0), 0)}
            building={building === detail.number}
            onClose={() => onSelectedVolumeChange(null)}
            onBuild={() => (detail.built ? setRebuild(detail) : void edit(detail.number))}
            device={defaultDevice}
            otherDevices={devices.filter((d) => d.id !== defaultDevice?.id)}
            onOpenDevices={onOpenDevices}
            onDeliver={(how, device) =>
              isComplete(detail)
                ? void buildOne(detail.number, how, device)
                : setConfirming({ volume: detail, how, device })
            }
            onShare={() =>
              detail.built &&
              void deliverBuilt(detail.built.path, volumeLabel(detail)).catch((e) =>
                onError(String(e)),
              )
            }
            onGetMissing={(at) =>
              setRouting({
                at,
                wanted: missingChapters(detail).map((c) => c.number),
              })
            }
            onGet={setFetching}
            onRead={openChapter}
            onFetchDirect={(chapter) => void fetchDirect(chapter)}
            fetchingDirect={fetchingDirect}
            onImport={(chapter) => void importFolder(chapter)}
            onRemove={(chapter) => void removeChapter(chapter)}
            organizing={organizing}
            onToggleOrganize={() => setOrganizing((o) => !o)}
            onAssignToVolume={assignToVolume}
            onResetToSource={(chapter) => void resetToSource([chapter])}
          />
        )}

      {more && (
        <ContextMenu at={more} onClose={() => setMore(null)}>
          <ContextMenuItem
            onSelect={() => {
              setMore(null);
              void sync();
            }}
            disabled={syncing}
          >
            {t("seriesView.rePullHint")}
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => {
              setMore(null);
              void refetchMetadata();
            }}
            disabled={refetching || !series?.source}
          >
            {t("seriesView.refetchHint")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            onSelect={() => {
              setMore(null);
              setRemoving(true);
            }}
            disabled={!series}
          >
            {t("seriesView.removeSeriesHint")}
          </ContextMenuItem>
        </ContextMenu>
      )}

      <Dialog open={confirming !== null} onOpenChange={(next) => !next && setConfirming(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t("seriesView.incompleteTitle", {
                label: confirming ? volumeLabel(confirming.volume) : "",
              })}
            </DialogTitle>
            <DialogDescription>
              {confirming &&
                t("seriesView.incompleteDescription", {
                  have: downloadedCount(confirming.volume),
                  total: confirming.volume.chapters.length,
                  missing: summariseRuns(missingChapters(confirming.volume).map((c) => c.number)),
                })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                const target = confirming;
                setConfirming(null);
                if (target) void buildOne(target.volume.number, target.how, target.device);
              }}
            >
              {t("seriesView.buildAnyway")}
            </Button>
            <Button
              onClick={(e) => {
                const target = confirming;
                setConfirming(null);
                if (!target) return;
                const r = e.currentTarget.getBoundingClientRect();
                setRouting({
                  at: { x: r.left, y: r.bottom + 4 },
                  wanted: missingChapters(target.volume).map((c) => c.number),
                });
              }}
            >
              <Download />
              {t("seriesView.getMissingFirst")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {menu && (
        <ContextMenu at={menu} onClose={() => setMenu(null)}>
          <ContextMenuItem
            onSelect={() => {
              setMenu(null);
              void runBuild(false);
            }}
            disabled={pickedBuildable.length === 0}
            hint={defaultFormat.toUpperCase()}
          >
            {pickedBuildable.length > 1
              ? t("seriesView.buildVolumesCount", { count: pickedBuildable.length })
              : t("seriesView.buildVolume")}
          </ContextMenuItem>

          <ContextMenuItem
            onSelect={() => {
              setMenu(null);
              void runBuild(true);
            }}
            disabled={pickedBuildable.length === 0}
          >
            {t("seriesView.buildAs")}
          </ContextMenuItem>

          <ContextMenuItem
            onSelect={() => {
              setMenu(null);
              void runBuildAndSend();
            }}
            disabled={pickedBuildable.length === 0}
          >
            {t("seriesView.buildAndSend")}
          </ContextMenuItem>

          {pickedBuildable.length < picked.size && (
            <ContextMenuItem onSelect={() => {}} disabled>
              {t("seriesView.notDownloadedYet", { count: picked.size - pickedBuildable.length })}
            </ContextMenuItem>
          )}

          <ContextMenuSeparator />

          <ContextMenuItem
            onSelect={() => {
              setPicked(new Set(order.filter((n) => buildable.has(n))));
              setMenu(null);
            }}
          >
            {t("seriesView.selectAllBuilt")}
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => {
              setPicked(new Set());
              setMenu(null);
            }}
          >
            {t("seriesView.clearSelection")}
          </ContextMenuItem>
        </ContextMenu>
      )}

      <RemoveSeriesDialog
        series={removing ? series : null}
        onOpenChange={setRemoving}
        onRemoved={onBack}
      />

      <BatchDownloadDialog
        open={batching !== null}
        onOpenChange={(next) => !next && setBatching(null)}
        seriesId={seriesId}
        missing={batching ?? []}
        onStarted={() => void refresh()}
      />

      {fromSource && (
        <SourceDownloadDialog
          open
          onOpenChange={(next) => !next && setFromSource(null)}
          seriesId={seriesId}
          sourceName={sourceLabel(series?.source, t)}
          chapters={fromSource}
          onStarted={() => void refresh()}
        />
      )}

      <Dialog open={forgetting} onOpenChange={setForgetting}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("seriesView.forgetTitle")}</DialogTitle>
            <DialogDescription>
              {t("seriesView.forgetDescription", {
                title: series?.title ?? t("seriesView.thisSeries"),
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setForgetting(false)}>
              {t("seriesView.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setForgetting(false);
                void clearSeriesHistory(seriesId)
                  .then(() => refresh())
                  .catch((e) => onError(String(e)));
              }}
            >
              <Trash2 />
              {t("seriesView.forget")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Building again costs a minute or more of re-encoding for a file that
          already exists, so the choice is offered rather than assumed. */}
      <Dialog open={rebuild !== null} onOpenChange={(next) => !next && setRebuild(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t("seriesView.alreadyBuilt", { label: rebuild ? volumeLabel(rebuild) : "" })}
            </DialogTitle>
            <DialogDescription>
              {rebuild?.built && (
                <span className="break-all">{rebuild.built.path}</span>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRebuild(null)}>
              {t("seriesView.cancel")}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                const target = rebuild;
                setRebuild(null);
                if (target) void edit(target.number);
              }}
            >
              <PenLine />
              {t("seriesView.buildAgain")}
            </Button>
            <Button
              onClick={() => {
                const built = rebuild?.built;
                const label = rebuild ? volumeLabel(rebuild) : undefined;
                setRebuild(null);
                if (built) {
                  void deliverBuilt(built.path, label).catch((e) => onError(String(e)));
                }
              }}
            >
              {deliverLabel(t)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Two ways to reach the same chapters, and which is available depends on
          the series rather than on a preference. */}
      {routing && (
        <ContextMenu at={routing.at} onClose={() => setRouting(null)}>
          <ContextMenuItem
            disabled={!series?.source || routing.wanted.length === 0}
            hint={series?.source ? undefined : t("seriesView.noMetadataSource")}
            onSelect={() => setFromSource(routing.wanted)}
          >
            {t("seriesView.fromSource", { source: sourceLabel(series?.source, t) })}
          </ContextMenuItem>
          <ContextMenuItem
            disabled={routing.wanted.length === 0}
            onSelect={() => setBatching(routing.wanted)}
          >
            {t("seriesView.fromChapterUrl")}
          </ContextMenuItem>
        </ContextMenu>
      )}

      {fetching !== null && (
        <ChapterFetchDialog
          open
          onOpenChange={(next) => !next && setFetching(null)}
          seriesId={seriesId}
          chapter={fetching}
          onDownloaded={() => {
            setFetching(null);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

/** One of the three counts under the hero: built, ready, missing. */
function StatCard({
  tone,
  label,
  value,
}: {
  tone: "info" | "ink" | "warning";
  label: string;
  value: number;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-line bg-raised px-4 py-3 max-sm:px-3">
      <span className="flex items-center gap-1.5 text-xs text-text-secondary">
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            tone === "info" ? "bg-info" : tone === "warning" ? "bg-warning" : "bg-strong",
          )}
        />
        <span className="truncate">{label}</span>
      </span>
      <span className="type-title">{value}</span>
    </div>
  );
}

/**
 * One volume on the shelf: its art and where it stands, as the design's status
 * chip — missing (with how many it has), complete, or built.
 */
function VolumeCard({
  volume,
  open,
  picked,
  building,
  onPick,
  onContextMenu,
  onEdit,
}: {
  volume: VolumeStatus;
  /** Its chapters are showing in the side panel. */
  open: boolean;
  /** Included in the current batch selection. */
  picked: boolean;
  building: boolean;
  onPick: (event: React.MouseEvent) => void;
  onContextMenu: (event: React.MouseEvent) => void;
  onEdit: () => void;
}) {
  const t = useT();
  const have = downloadedCount(volume);
  const complete = isComplete(volume);
  const total = volume.chapters.length;
  const label =
    volume.number === UNSORTED ? t("seriesView.unsorted") : t("seriesView.volShort", { number: volume.number });

  return (
    <div
      onContextMenu={onContextMenu}
      className={cn(
        "group relative rounded-xl p-1.5 transition-colors",
        open || picked ? "ring-2 ring-strong" : "hover:bg-hover",
      )}
    >
      <button onClick={onPick} className="flex w-full flex-col gap-2 text-left">
        <VolumeArt volume={volume} dimmed={have === 0} />
        <span className="flex flex-col items-start gap-1.5 px-0.5">
          <span className="truncate text-[13px] font-medium">{label}</span>
          {volume.built ? (
            <Badge variant="info" title={volume.built.path}>
              <Dot />
              {t("seriesView.built")}
            </Badge>
          ) : complete ? (
            <Badge variant="secondary">
              <Dot />
              {t("seriesView.complete")}
            </Badge>
          ) : (
            <Badge variant="warning">
              <Dot />
              {have}/{total || "?"}
            </Badge>
          )}
        </span>
      </button>

      {have > 0 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          disabled={building}
          title={t("seriesView.buildTitleFor", { label: volumeLabel(volume) })}
          className={cn(
            "absolute right-3 top-3 rounded-md bg-raised/90 p-1.5 text-text-secondary backdrop-blur-sm transition-opacity hover:text-foreground focus-visible:opacity-100",
            !isMobile && "opacity-0 group-hover:opacity-100",
          )}
        >
          {building ? <Loader2 className="size-3.5 animate-spin" /> : <PenLine className="size-3.5" />}
        </button>
      )}
    </div>
  );
}

/** The status chip's leading dot, in the chip's own colour. */
function Dot() {
  return <span className="size-1.5 rounded-full bg-current" />;
}

/**
 * The cover, from the library when we hold it and from the source when we do
 * not, so a volume is never a blank rectangle while its art is still arriving.
 */
function VolumeArt({ volume, dimmed }: { volume: VolumeStatus; dimmed: boolean }) {
  const { ref, url } = useThumbnail(volume.cover_path ?? "", 400);
  // Nothing downloaded reads as "not yours yet" at a glance.
  const fade = cn("transition-opacity", dimmed && "opacity-40");

  return (
    <div
      ref={ref}
      className="flex aspect-[2/3] w-full items-center justify-center overflow-hidden rounded-lg bg-sunken ring-1 ring-line/70"
    >
      {volume.cover_path ? (
        url && <img src={url} alt="" className={cn("h-full w-full object-cover", fade)} />
      ) : volume.cover_url ? (
        <RemoteImage
          url={volume.cover_url}
          max={400}
          className="h-full w-full"
          imageClassName={fade}
        />
      ) : (
        <BookOpen className="size-5 text-text-tertiary" />
      )}
    </div>
  );
}


/**
 * The selected volume (Figma 07 · Série · volume pronto): where it stands as
 * two steps — chapters, then the EPUB — its chapters, and the one thing to do
 * next at the foot. On a desktop that is sending it to the Kindle, in the
 * delivery colour; building and saving elsewhere sit behind the chevron.
 */
function VolumePanel({
  className,
  volume,
  pageCount,
  building,
  onClose,
  onBuild,
  onDeliver,
  device,
  otherDevices,
  onOpenDevices,
  onGet,
  onRead,
  onFetchDirect,
  fetchingDirect,
  onImport,
  onRemove,
  onShare,
  onGetMissing,
  organizing,
  onToggleOrganize,
  onAssignToVolume,
  onResetToSource,
}: {
  /** The reading-mode slide, when one is running. */
  className?: string;
  volume: VolumeStatus;
  /** Pages on disk across the volume's chapters. */
  pageCount: number;
  building: boolean;
  onClose: () => void;
  /** Open it in the editor. */
  onBuild: () => void;
  /** Queue a build: sent to a device (the default unless named), to the
   * build folder, or somewhere picked. */
  onDeliver: (how: "send" | "build" | "build-as", device?: string) => void;
  /** Where "Send" goes, named on the button. `null` until one is added. */
  device: Device | null;
  /** The rest, offered behind the chevron. */
  otherDevices: Device[];
  onOpenDevices: () => void;
  onGet: (chapter: string) => void;
  onRead: (chapter: ChapterStatus) => void;
  onFetchDirect: (chapter: string) => void;
  /** Chapter numbers currently being pulled from the source. */
  fetchingDirect: ReadonlySet<string>;
  onImport: (chapter: string) => void;
  onRemove: (chapter: string) => void;
  /** Hand the built file to another app, or reveal it. */
  onShare: () => void;
  /** Fetch only the chapters this volume is still missing. */
  onGetMissing: (at: ContextMenuPosition) => void;
  /** Whether this panel is in "sort Unsorted chapters by hand" mode. */
  organizing: boolean;
  onToggleOrganize: () => void;
  onAssignToVolume: (numbers: string[], volume: string) => Promise<void>;
  onResetToSource: (chapter: string) => void;
}) {
  const t = useT();
  const have = downloadedCount(volume);
  const missing = missingChapters(volume);
  const complete = isComplete(volume);
  const isUnsorted = volume.number === UNSORTED;
  const [options, setOptions] = useState<ContextMenuPosition | null>(null);
  const { ref, url } = useThumbnail(volume.cover_path ?? "", 160);
  const numbers = volume.chapters.map((c) => c.number);
  const range =
    numbers.length > 0 ? summariseRuns(numbers) : "";

  return (
    <aside
      className={cn(
        "flex flex-col bg-raised",
        // A 380px panel beside a grid leaves a phone's grid nothing, so there
        // it covers the grid instead of sitting next to it.
        isMobile ? "absolute inset-0 z-30" : "w-[380px] shrink-0 border-l border-line",
        className,
      )}
    >
      <div className="flex flex-col gap-4 border-b border-line p-5">
        <div className="flex items-start gap-4">
          <div
            ref={ref as React.Ref<HTMLDivElement>}
            className="flex h-24 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-sunken shadow-sm"
          >
            {url ? (
              <img src={url} alt="" className="size-full object-cover" />
            ) : volume.cover_url ? (
              <RemoteImage url={volume.cover_url} max={160} className="size-full" />
            ) : (
              <BookOpen className="size-4 text-text-tertiary" />
            )}
          </div>
          <div className="min-w-0 flex-1 pt-1">
            <p className="type-overline">
              {isUnsorted ? t("seriesView.unsorted") : t("seriesView.volumeOverline", { number: volume.number })}
            </p>
            <h2 className="type-subtitle mt-1 truncate">
              {range ? t("seriesView.chaptersRange", { range }) : volumeLabel(volume)}
            </h2>
            <p className="mt-0.5 text-xs text-text-secondary">
              {t("seriesView.panelSummary", { chapters: volume.chapters.length, pages: pageCount })}
            </p>
          </div>
          {isUnsorted && !organizing && (
            <Hint label={t("seriesView.organizeHint")}>
              <Button variant="ghost" size="sm" onClick={onToggleOrganize}>
                <Layers className="size-3.5" />
                {t("seriesView.organize")}
              </Button>
            </Hint>
          )}
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={t("seriesView.close")}>
            <X />
          </Button>
        </div>

        {/* The volume's two steps, in order. */}
        <div className="grid grid-cols-2 gap-2">
          <div
            className={cn(
              "flex flex-col gap-0.5 rounded-lg px-3 py-2.5",
              complete ? "bg-success-soft" : "bg-warning-soft",
            )}
          >
            <span
              className={cn(
                "flex items-center gap-1.5 text-xs font-medium",
                complete ? "text-success" : "text-warning",
              )}
            >
              {complete ? <CircleCheck className="size-3.5" /> : <CircleDashed className="size-3.5" />}
              {t("seriesView.stepChapters")}
            </span>
            <span className="text-xs text-text-secondary">
              {t("seriesView.stepChaptersDetail", { have, total: volume.chapters.length })}
            </span>
          </div>
          <div
            className={cn(
              "flex flex-col gap-0.5 rounded-lg px-3 py-2.5",
              volume.built ? "bg-info-soft" : "bg-sunken",
            )}
          >
            <span
              className={cn(
                "flex items-center gap-1.5 text-xs font-medium",
                volume.built ? "text-info" : "text-text-secondary",
              )}
            >
              {volume.built ? <CircleCheck className="size-3.5" /> : <CircleDashed className="size-3.5" />}
              EPUB
            </span>
            <span className="truncate text-xs text-text-secondary" title={volume.built?.path}>
              {volume.built
                ? t("seriesView.builtSize", { size: formatBytes(volume.built.bytes) })
                : t("seriesView.notBuilt")}
            </span>
          </div>
        </div>
      </div>

      {organizing ? (
        <OrganizeChaptersPanel
          chapters={volume.chapters}
          onAssign={onAssignToVolume}
          onDone={onToggleOrganize}
        />
      ) : (
        <>
          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
            <p className="type-overline px-5 pb-1 pt-4">{t("seriesView.chaptersOverline")}</p>
            {volume.chapters.length === 0 ? (
              <p className="px-5 py-4 text-xs text-text-secondary">
                {t("seriesView.noChaptersListed")}
              </p>
            ) : (
              volume.chapters.map((chapter) => (
                <ChapterRow
                  key={chapter.number}
                  chapter={chapter}
                  busy={fetchingDirect.has(chapter.number)}
                  onGet={() => onGet(chapter.number)}
                  onRead={() => onRead(chapter)}
                  onFetchDirect={() => onFetchDirect(chapter.number)}
                  onImport={() => onImport(chapter.number)}
                  onRemove={() => onRemove(chapter.number)}
                  onResetToSource={() => onResetToSource(chapter.number)}
                />
              ))
            )}
          </div>

          <div className="flex flex-col gap-2.5 border-t border-line p-4">
            {missing.length > 0 && (
              <Button
                variant="outline"
                className="w-full"
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  onGetMissing({ x: r.left, y: r.bottom + 4 });
                }}
              >
                <Download />
                {t("seriesView.getMissingInVolume", { count: missing.length })}
              </Button>
            )}

            {canSendToDevice && !device ? (
              // Principle 1 still holds with no device: the main action is
              // setting one up, not a send that can only fail.
              <Button variant="deliver" className="h-11 w-full" onClick={onOpenDevices}>
                <Plus />
                {t("seriesView.addDevice")}
              </Button>
            ) : canSendToDevice && device ? (
              <div className="flex">
                <Button
                  variant="deliver"
                  className="h-11 min-w-0 flex-1 rounded-r-none"
                  disabled={have === 0 || building}
                  onClick={() => onDeliver("send")}
                >
                  {building ? <Loader2 className="animate-spin" /> : <Send />}
                  <span className="truncate">{t("seriesView.sendTo", { name: device.name })}</span>
                </Button>
                <Button
                  variant="deliver"
                  className="h-11 w-11 rounded-l-none border-l border-white/25 px-0"
                  aria-label={t("seriesView.moreWays")}
                  disabled={have === 0 || building}
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    setOptions({
                      x: r.right - 240,
                      y: r.top - 4 - 132 - otherDevices.length * 36,
                    });
                  }}
                >
                  <ChevronDown />
                </Button>
              </div>
            ) : volume.built ? (
              <div className="flex gap-2">
                <Button variant="deliver" className="h-11 flex-1" onClick={onShare}>
                  <Send />
                  {t("seriesView.shareEpub")}
                </Button>
                <Button variant="outline" className="h-11" onClick={onBuild} disabled={building}>
                  {building ? <Loader2 className="animate-spin" /> : <PenLine />}
                  {t("seriesView.buildAgain")}
                </Button>
              </div>
            ) : (
              <Button className="h-11 w-full" onClick={onBuild} disabled={have === 0 || building}>
                {building ? <Loader2 className="animate-spin" /> : <PenLine />}
                {t("seriesView.buildThisVolume")}
              </Button>
            )}
          </div>
        </>
      )}

      {options && (
        <ContextMenu at={options} onClose={() => setOptions(null)}>
          {otherDevices.map((other) => (
            <ContextMenuItem
              key={other.id}
              onSelect={() => {
                setOptions(null);
                onDeliver("send", other.id);
              }}
            >
              {t("seriesView.sendTo", { name: other.name })}
            </ContextMenuItem>
          ))}
          <ContextMenuItem
            onSelect={() => {
              setOptions(null);
              onDeliver("build");
            }}
          >
            {t("seriesView.buildOnly")}
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => {
              setOptions(null);
              onDeliver("build-as");
            }}
          >
            {t("seriesView.buildAs")}
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => {
              setOptions(null);
              onBuild();
            }}
          >
            {t("seriesView.editPages")}
          </ContextMenuItem>
          {volume.built && (
            <ContextMenuItem
              onSelect={() => {
                setOptions(null);
                onShare();
              }}
            >
              {t("seriesView.showFile")}
            </ContextMenuItem>
          )}
        </ContextMenu>
      )}
    </aside>
  );
}

function ChapterRow({
  chapter,
  busy,
  onGet,
  onRead,
  onFetchDirect,
  onImport,
  onRemove,
  onResetToSource,
}: {
  chapter: ChapterStatus;
  busy: boolean;
  onGet: () => void;
  onRead: () => void;
  onFetchDirect: () => void;
  onImport: () => void;
  onRemove: () => void;
  /** Undo a manual volume assignment and re-pull the real one. */
  onResetToSource: () => void;
}) {
  const t = useT();
  const have = chapter.folder !== null;
  const direct = canFetchDirectly(chapter);
  // Two layers: what you need to decide at a glance (is it here, and the one
  // thing to do with it), and everything else on demand. With every action and
  // the source host on one line, a 384px panel truncated the part that mattered.
  const [open, setOpen] = useState(false);
  const source = have ? chapterSource(chapter) : null;

  const detail = have
    ? t("seriesView.pagesCount", { count: chapter.page_count }) +
      (chapter.read_at
        ? t("seriesView.readSuffix")
        : chapter.last_page > 0
          ? t("seriesView.pageSuffix", { page: chapter.last_page + 1 })
          : "")
    : chapter.unavailable
      ? t("seriesView.notHostedBySource")
      : t("seriesView.notDownloaded");

  const primary = have ? (
    <Hint
      label={
        chapter.last_page > 0 && !chapter.read_at
          ? t("seriesView.resumeOnPage", { page: chapter.last_page + 1 })
          : t("seriesView.readThisChapter")
      }
    >
      <Button variant="ghost" size="sm" onClick={onRead}>
        <BookOpen />
        {chapter.read_at
          ? t("seriesView.reRead")
          : chapter.last_page > 0
            ? t("seriesView.resume")
            : t("seriesView.read")}
      </Button>
    </Hint>
  ) : (
    <Hint
      label={
        direct
          ? t("seriesView.downloadDirectHint")
          : chapter.unavailable
            ? t("seriesView.notHostedHint")
            : t("seriesView.pastePageHint")
      }
    >
      <Button
        variant="outline"
        size="sm"
        onClick={direct ? onFetchDirect : onGet}
        disabled={busy}
      >
        {busy ? <Loader2 className="animate-spin" /> : <Download />}
        {t("seriesView.get")}
      </Button>
    </Hint>
  );

  return (
    <div className="border-b border-line/60 last:border-b-0">
      <div className="flex items-center gap-3 py-2.5 pl-5 pr-3">
        <span
          className={cn(
            "w-8 shrink-0 font-mono text-xs",
            have ? "text-text-tertiary" : "text-warning",
          )}
        >
          {chapter.number}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {t("seriesView.chapterNumber", { number: chapter.number })}
            {chapter.title && (
              <span className="font-normal text-text-secondary"> · {chapter.title}</span>
            )}
          </p>
          <p
            className={cn(
              "truncate text-xs",
              have ? "text-text-secondary" : "text-warning",
            )}
          >
            {detail}
            {source && ` · ${source}`}
          </p>
        </div>
        {primary}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? t("seriesView.hideDetails") : t("seriesView.showDetails")}
        >
          <ChevronDown className={cn("transition-transform", open && "rotate-180")} />
        </Button>
      </div>

      {open && (
        <div className="flex flex-col gap-3 pb-4 pl-16 pr-4">
          {(source || chapter.source_url) && (
            <div className="flex items-center gap-3 text-[11px]">
              <span className="w-14 shrink-0 text-text-secondary">{t("seriesView.sourceLabel")}</span>
              <span className="min-w-0 truncate" title={chapter.source_url ?? undefined} data-selectable>
                {source ?? chapter.source_url}
              </span>
            </div>
          )}
          {!have && (
            <p className="text-xs leading-4 text-text-secondary">
              {chapter.unavailable ? t("seriesView.notHostedHint") : t("seriesView.missingExplainer")}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {have ? (
              <>
                <Hint label={t("seriesView.replaceHint")}>
                  <Button variant="outline" size="sm" onClick={onGet}>
                    <RefreshCw />
                    {t("seriesView.replace")}
                  </Button>
                </Hint>
                <Hint label={t("seriesView.deleteChapterHint")}>
                  <Button variant="ghost" size="sm" onClick={onRemove}>
                    <Trash2 />
                    {t("seriesView.delete")}
                  </Button>
                </Hint>
                {chapter.source_url && (
                  <Button variant="link" size="sm" asChild>
                    <a href={chapter.source_url} target="_blank" rel="noreferrer">
                      <ExternalLink />
                      {t("seriesView.openSource")}
                    </a>
                  </Button>
                )}
              </>
            ) : (
              <>
                <Hint label={t("seriesView.importFolderHint")}>
                  <Button variant="outline" size="sm" onClick={onImport} disabled={busy}>
                    <FolderInput />
                    {t("seriesView.importFolder")}
                  </Button>
                </Hint>
                {/* A chapter you do not hold is still readable when the source
                    serves it. That is what streaming is for. */}
                {direct && (
                  <Hint label={t("seriesView.readFromSourceHint")}>
                    <Button variant="ghost" size="sm" onClick={onRead} disabled={busy}>
                      <Cloud />
                      {t("seriesView.read")}
                    </Button>
                  </Hint>
                )}
                {direct && (
                  <Hint label={t("seriesView.pasteUrlHint")}>
                    <Button variant="ghost" size="sm" onClick={onGet} disabled={busy}>
                      {t("seriesView.url")}
                    </Button>
                  </Hint>
                )}
              </>
            )}
            {/* Sorted into this volume by hand (`OrganizeChaptersPanel`), so a
                sync leaves it here rather than re-deriving it — offered as a way
                back for whoever changes their mind. */}
            {chapter.volume_locked && (
              <Hint label={t("seriesView.undoAssignmentHint")}>
                <Button variant="ghost" size="sm" onClick={onResetToSource}>
                  <Pin />
                  {t("seriesView.unpin")}
                </Button>
              </Hint>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
/**
 * Where a downloaded chapter's pages came from.
 *
 * Worth showing because a library fills up from more than one place, and the
 * answer decides what "get this again" will do — a chapter the source hosts can
 * be re-fetched with one tap, a scraped one needs its URL again.
 *
 * The host rather than the full URL: the question is which site, and a reader
 * URL is long and mostly opaque ids.
 */
function chapterSource(chapter: ChapterStatus): string | null {
  if (chapter.source_url) {
    try {
      return new URL(chapter.source_url).host.replace(/^www\./, "");
    } catch {
      return null;
    }
  }
  // A proper noun — not translated.
  return chapter.source_id ? "MangaDex" : null;
}

/** How to name where a series' chapters come from. */
function sourceLabel(source: string | null | undefined, t: Translator): string {
  switch (source) {
    case "mangadex":
      return "MangaDex";
    case "kitsu":
      return "Kitsu";
    default:
      return t("seriesView.theSource");
  }
}

/**
 * What a series is, above its shelf of volumes.
 *
 * The description collapses because a good one runs to a paragraph and the
 * volumes are what the page is for — the detail should be reachable without
 * pushing them below the fold.
 */
function SeriesDetails({
  series,
  languages,
  switching,
  onLoadLanguages,
  onLanguage,
  resume,
  readCount,
  onResume,
  onForget,
  aside,
}: {
  /** A column beside the details: reading mode's way straight into a chapter. */
  aside?: React.ReactNode;
  series: Series;
  /** Translations the source has, once asked for. `null` means not yet. */
  languages: string[] | null;
  switching: boolean;
  onLoadLanguages: () => void;
  onLanguage: (code: string) => void;
  /** Where reading left off, when it did. */
  resume: ChapterStatus | null;
  readCount: number;
  onResume: () => void;
  onForget: () => void;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const { ref, url } = useThumbnail(series.cover_path ?? "", 320);

  const subtitle = [series.title_romaji, series.title_native]
    .filter((t) => t && t !== series.title)
    .join(" · ");

  return (
    <div ref={ref as React.Ref<HTMLDivElement>} className="flex gap-7 max-sm:flex-col max-sm:gap-5">
      <div className="flex h-[180px] w-[120px] shrink-0 items-center justify-center overflow-hidden rounded-md bg-sunken shadow-[0_6px_20px_rgb(20_22_27/0.18)]">
        {series.cover_path && url ? (
          <img src={url} alt="" className="h-full w-full object-cover" />
        ) : (
          <BookOpen className="size-6 text-text-tertiary" />
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <p className="type-overline">
          {[t("seriesView.seriesOverline"), series.status].filter(Boolean).join(" · ")}
        </p>
        <h1 className="type-display break-words max-sm:text-[32px] max-sm:leading-9">{series.title}</h1>
        <p className="text-sm text-text-secondary">
          {[
            subtitle,
            [series.author, series.artist !== series.author ? series.artist : null]
              .filter(Boolean)
              .join(" · ") || t("seriesView.unknownAuthor"),
            series.year,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>

        {series.description && (
          <div>
            <p
              className={cn(
                "whitespace-pre-line text-sm leading-5 text-text-secondary",
                !expanded && "line-clamp-2",
              )}
              data-selectable
            >
              {series.description}
            </p>
            <button
              onClick={() => setExpanded((v) => !v)}
              className="mt-1 text-xs font-medium text-info underline-offset-4 hover:underline"
            >
              {expanded ? t("seriesView.showLess") : t("seriesView.showMore")}
            </button>
          </div>
        )}

        {/* The translation decides which chapters exist and how they are
            numbered, so it sits with the series rather than in settings. */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Select
            value={series.language}
            onValueChange={onLanguage}
            disabled={switching}
            onOpenChange={(isOpen: boolean) => isOpen && onLoadLanguages()}
          >
            <SelectTrigger
              className="h-8 w-auto gap-1.5 rounded-full px-3 text-xs"
              title={t("seriesView.translationHint")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(languages && languages.length > 0 ? languages : [series.language]).map((code) => (
                <SelectItem key={code} value={code}>
                  {languageName(code, t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {switching && <Loader2 className="size-3.5 animate-spin text-text-tertiary" />}
          {series.site_url && (
            <a
              href={series.site_url}
              target="_blank"
              rel="noreferrer"
              className="flex h-8 items-center gap-1.5 rounded-full border border-line-strong bg-raised px-3 text-xs font-medium text-info hover:bg-hover"
            >
              <ExternalLink className="size-3.5" />
              {sourceLabel(series.source, t)}
            </a>
          )}
          {series.content_rating && series.content_rating !== "safe" && (
            <Badge variant="warning">{series.content_rating}</Badge>
          )}
          {series.tags.slice(0, 6).map((tag) => (
            <Badge key={tag} variant="outline">
              {tag}
            </Badge>
          ))}
        </div>

        {/* What this series is to *you*: where to pick it up, and how much of
            it you have been through. */}
        {(resume || readCount > 0) && (
          <div className="flex flex-wrap items-center gap-3 pt-1">
            {resume && (
              <Button onClick={onResume}>
                <BookOpen />
                {resume.opened_at && resume.last_page > 0
                  ? t("seriesView.continueChapter", {
                      number: resume.number,
                      page: resume.last_page + 1,
                    })
                  : t("seriesView.readChapterNumber", { number: resume.number })}
              </Button>
            )}
            {readCount > 0 && (
              <span className="text-xs text-text-secondary">
                {t(
                  readCount === 1 ? "seriesView.readHistorySingular" : "seriesView.readHistoryPlural",
                  { count: readCount },
                )}{" "}
                ·{" "}
                <button
                  onClick={onForget}
                  className="underline-offset-2 hover:text-foreground hover:underline"
                >
                  {t("seriesView.forget")}
                </button>
              </span>
            )}
          </div>
        )}
      </div>

      {aside}
    </div>
  );
}

/**
 * Figma 07c "Leitura rápida": the one chapter to open, beside the series.
 *
 * Where reading left off when it did, the first chapter that can be opened
 * otherwise — the shelf's resume button, promoted, because in reading mode
 * opening a chapter is what the page is for.
 */
function QuickRead({
  chapter,
  onRead,
  className,
}: {
  chapter: ChapterStatus;
  onRead: () => void;
  className?: string;
}) {
  const t = useT();
  const resuming = chapter.opened_at !== null && chapter.last_page > 0 && !chapter.read_at;
  return (
    <div
      className={cn(
        "flex w-[200px] shrink-0 flex-col justify-center gap-3 max-sm:w-full",
        className,
      )}
    >
      <p className="type-overline">{t("seriesView.straightToChapter")}</p>
      <Button className="h-10 w-full justify-start" onClick={onRead}>
        <BookOpen />
        <span className="truncate">
          {resuming
            ? t("seriesView.continueChapterShort", { number: chapter.number })
            : t("seriesView.readChapterNumber", { number: chapter.number })}
        </span>
      </Button>
      <p className="text-xs text-text-tertiary">
        {chapter.folder ? t("seriesView.readHereCaption") : t("seriesView.readOnlineCaption")}
      </p>
    </div>
  );
}
