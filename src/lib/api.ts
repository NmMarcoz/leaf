import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";

import { canRevealFiles } from "@/lib/platform";

/**
 * Mirrors of the serde shapes in `leaf-core`. Keep these in step with the
 * Rust definitions; serde uses kebab-case for the enums.
 */
export type Direction = "right-to-left" | "left-to-right";
export type PageKind = "single" | "spread";
export type Format = "epub" | "cbz";

export type ExcludeReason =
  | { reason: "not-a-page" }
  | { reason: "unreadable" }
  | { reason: "off-size"; width: number; height: number }
  | { reason: "manual" };

export interface Page {
  path: string;
  width: number;
  height: number;
  bytes: number;
  kind: PageKind;
  excluded: ExcludeReason | null;
  split: boolean;
}

export interface Chapter {
  title: string;
  source: string;
  pages: Page[];
}

export interface Metadata {
  series: string;
  volume: number | null;
  author: string;
  language: string;
  description: string;
  direction: Direction;
  identifier: string;
}

export interface Volume {
  metadata: Metadata;
  cover: string | null;
  chapters: Chapter[];
  root: string;
}

export interface BuildReport {
  path: string;
  bytes: number;
  pages: number;
}

/* ---------------------------------------------------- online metadata lookup */

export type MetaSource = "mangadex" | "kitsu";

/**
 * Mirrors `leaf_meta::Tag`.
 *
 * Defined here rather than beside the browse filters because a series carries
 * its own tags; putting it there and importing back would be circular.
 */
export interface Tag {
  id: string;
  name: string;
  /** `genre`, `theme`, `format` or `content`. */
  group: string;
}

/** Mirrors `leaf_meta::Statistics`. */
export interface Statistics {
  rating: number | null;
  bayesian: number | null;
  follows: number | null;
}

/** Mirrors `leaf_meta::SeriesMatch`. */
export interface SeriesMatch {
  source: MetaSource;
  id: string;
  title_english: string | null;
  title_romaji: string | null;
  title_native: string | null;
  author: string | null;
  artist: string | null;
  description: string | null;
  year: number | null;
  status: string | null;
  demographic: string | null;
  thumbnail_url: string | null;
  site_url: string | null;
  /** `safe` | `suggestive` | `erotica` | `pornographic` */
  content_rating: string | null;
  tags: Tag[];
  /** Translations that exist, as language codes. Crowd-sourced, so it varies. */
  available_languages: string[];
}

export interface VolumeCover {
  volume: string | null;
  url: string;
  thumbnail_url: string;
}

/** Mirrors `leaf_meta::ChapterRef`. */
export interface ChapterRef {
  number: string;
  /** The source's own id; present means its pages can be fetched directly. */
  id: string | null;
  /** The source lists the chapter but cannot serve its images. */
  unavailable: boolean;
}

export interface VolumeChapters {
  volume: string;
  chapters: ChapterRef[];
}

export const searchSeries = (query: string) =>
  invoke<SeriesMatch[]>("search_series", { query });

export const seriesCovers = (source: MetaSource, id: string) =>
  invoke<VolumeCover[]>("series_covers", { source, id });

export const seriesChapters = (source: MetaSource, id: string) =>
  invoke<VolumeChapters[]>("series_chapters", { source, id });

/** The volume layout for one translation. `null` merges every language. */
export const seriesChaptersIn = (
  source: MetaSource,
  id: string,
  language: string | null,
) => invoke<VolumeChapters[]>("series_chapters_in", { source, id, language });

export const seriesStatistics = (source: MetaSource, id: string) =>
  invoke<Statistics>("series_statistics", { source, id });

/** Series sharing these tags. A tag search, not a recommendation. */
export const similarSeries = (source: MetaSource, tags: string[], exclude: string) =>
  invoke<SeriesMatch[]>("similar_series", { source, tags, exclude });

/**
 * Language codes as they should read on screen.
 *
 * MangaDex uses a mix of plain and regioned codes, and `Intl.DisplayNames`
 * handles both; the map only covers the few it renders unhelpfully.
 */
export const languageName = (code: string): string => {
  const special: Record<string, string> = {
    "pt-br": "Portuguese (Brazil)",
    "es-la": "Spanish (Latin America)",
    "zh-hk": "Chinese (Hong Kong)",
    "ja-ro": "Japanese (romanised)",
    "ko-ro": "Korean (romanised)",
    "zh-ro": "Chinese (romanised)",
  };
  if (special[code]) return special[code];
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
};

/** Download a cover into the app cache and return its local path. */
export const saveCover = (url: string) => invoke<string>("save_cover", { url });

export const sourceLabel = (source: MetaSource) =>
  source === "mangadex" ? "MangaDex" : "Kitsu";

/** What a source is, and so what it may do. Mirrors `leaf_extensions::Kind`. */
export type SourceKind = "metadata" | "enrich" | "reader";

/**
 * A registered source beyond the MangaDex/Kitsu pair: built in, or a
 * `.lua` extension under `<library>/extensions/`. Mirrors
 * `leaf_extensions::SourceInfo`.
 */
export interface SourceInfo {
  /** Stable and namespaced, e.g. `leaf.mangadex` or `user.some-site` —
   * this is the exact string stored in a `Series`' `source` column. */
  id: string;
  name: string;
  kind: SourceKind;
  lang: string;
  base_url: string;
  /** Further origins the script may reach; widen what an approval covers. */
  mirrors: string[];
  description: string | null;
  /** Host API level the script was written for. */
  api: number;
  nsfw: boolean;
  /** What it answers: `search`, `chapters`, `pages`, `details`, `catalogue`, … */
  capabilities: string[];
}

/** One row of a registered source's catalogue. Mirrors `MangaSummary`. */
export interface SourceManga {
  id: string;
  title: string;
  cover_url: string | null;
}

/** A page of a registered source's catalogue. Mirrors `MangasPage`. */
export interface SourceMangaPage {
  manga: SourceManga[];
  has_next_page: boolean;
}

/** Everything a registered source can offer about one series. Mirrors `MangaDetails`. */
export interface SourceMangaDetails {
  title: string;
  title_romaji: string | null;
  title_native: string | null;
  author: string | null;
  artist: string | null;
  description: string | null;
  tags: string[];
  content_rating: string | null;
  available_languages: string[];
  cover_url: string | null;
}

/** Where one script stands with the trust gate. Mirrors `ScriptState`
 * (kebab-case serde). */
export type ScriptState = "approved" | "dev" | "pending" | "disabled" | "broken";

/** One `.lua` file in the extensions folder, as the panel lists it. Mirrors
 * `UserScript`. `info` is absent exactly when the script failed to load, in
 * which case `error` explains why the row renders anyway. */
export interface UserScript extends Partial<SourceInfo> {
  file: string;
  fingerprint: string;
  state: ScriptState;
  error: string;
  /** What the loader accepted but will not act on. */
  warnings: string[];
}

/** An extension repository the user added. Mirrors `settings::ExtensionRepo`. */
export interface ExtensionRepo {
  url: string;
  name: string | null;
  added_at: number;
}

/** An index entry against the local folder. Mirrors `repo::RepoStatus`. */
export type RepoStatus = "not-installed" | "installed" | "update-available" | "incompatible";

/** One script a repository offers. Mirrors `repo::RepoRow` (flattened `RepoScript`). */
export interface RepoRow {
  file: string;
  id: string;
  name: string;
  kind: SourceKind;
  lang: string;
  base_url: string;
  mirrors: string[];
  description: string | null;
  sha256: string;
  version: string;
  api: number;
  nsfw: boolean;
  capabilities: string[];
  status: RepoStatus;
  local_file: string | null;
  local_state: ScriptState | null;
}

/** A repository's index, browsed. Mirrors `sources::RepoBrowse`. */
export interface RepoBrowse {
  url: string;
  name: string | null;
  rows: RepoRow[];
  skipped: number;
}

/** Every registered source, for an Add-from-source or Explore picker. */
export const listSources = () => invoke<SourceInfo[]>("list_sources");

/** The extensions folder as one row per file, each with its gate state. */
export const listExtensions = () => invoke<UserScript[]>("list_extensions");

/** Copy a picked `.lua` file into the extensions folder (validating it
 * loads first). `asName` renames on the way in — how Update replaces an
 * existing entry. Returns the stored filename. Copying in does not enable:
 * the new bytes still pass the gate as pending. */
export const installExtension = (sourcePath: string, asName?: string) =>
  invoke<string>("install_extension", { sourcePath, asName: asName ?? null });

/** Approve one extension, by the fingerprint it was shown with. */
export const approveExtension = (fingerprint: string) =>
  invoke<void>("approve_extension", { fingerprint });

/** Put one extension file into (or out of) development mode. */
export const setExtensionDev = (file: string, dev: boolean) =>
  invoke<void>("set_extension_dev", { file, dev });

/** Switch an extension off or back on; off files are not loaded at all. */
export const setExtensionEnabled = (file: string, enabled: boolean) =>
  invoke<void>("set_extension_enabled", { file, enabled });

/** Delete the script file and forget its name-keyed trust state. */
export const removeExtension = (file: string) =>
  invoke<void>("remove_extension", { file });

/** Freeze a dev extension's current bytes as its approval. Returns the
 * fingerprint that was locked — computed by the backend from the file. */
export const lockExtension = (file: string) =>
  invoke<string>("lock_extension", { file });

/** The extension repositories the user added. */
export const listExtensionRepos = () => invoke<ExtensionRepo[]>("list_extension_repos");

/** Add a repository by the address the user typed; its index is read first. */
export const addExtensionRepo = (url: string) =>
  invoke<ExtensionRepo>("add_extension_repo", { url });

/** Forget a repository. Scripts installed from it stay. */
export const removeExtensionRepo = (url: string) =>
  invoke<void>("remove_extension_repo", { url });

/** Fetch a repository's index and compare it with what is installed. */
export const browseExtensionRepo = (url: string) =>
  invoke<RepoBrowse>("browse_extension_repo", { url });

/** Install or update one script from a repository. It lands pending. */
export const installFromExtensionRepo = (url: string, id: string) =>
  invoke<string>("install_from_extension_repo", { url, id });

/** Search one registered source's own catalogue. */
export const searchSource = (source: string, query: string, page: number) =>
  invoke<SourceMangaPage>("search_source", { source, query, page });

/** A registered source's most-popular listing, for Explore. */
export const popularSource = (source: string, page: number) =>
  invoke<SourceMangaPage>("popular_source", { source, page });

/** A registered source's latest-updates listing, for Explore. */
export const latestSource = (source: string, page: number) =>
  invoke<SourceMangaPage>("latest_source", { source, page });

/** A registered source's detail page for one series. */
export const mangaDetailsSource = (source: string, externalId: string) =>
  invoke<SourceMangaDetails>("manga_details_source", { source, externalId });

/** A registered source's chapter list for one series, for reading online without adding it. */
export const volumesSource = (source: string, externalId: string) =>
  invoke<VolumeChapters[]>("volumes_source", { source, externalId });

export const scanFolder = (path: string) => invoke<Volume>("scan", { path });

export const buildVolume = (volume: Volume, out: string, format: Format) =>
  invoke<BuildReport>("build", { volume, out, format });

export const suggestFilename = (volume: Volume, format: Format) =>
  invoke<string>("suggest_filename", { volume, format });

export const fetchThumbnail = (path: string, max: number) =>
  invoke<ArrayBuffer>("thumbnail", { path, max });

/** Pages that will actually be written. */
export const includedPages = (chapter: Chapter) =>
  chapter.pages.filter((p) => p.excluded === null);

export const volumePageCount = (volume: Volume) =>
  volume.chapters.reduce((n, c) => n + includedPages(c).length, 0);

export const volumeSpreadCount = (volume: Volume) =>
  volume.chapters.reduce(
    (n, c) => n + includedPages(c).filter((p) => p.kind === "spread").length,
    0,
  );

/** The cover actually used: the explicit pick, else the first page. */
export const effectiveCover = (volume: Volume): string | null => {
  if (volume.cover) return volume.cover;
  for (const chapter of volume.chapters) {
    const first = includedPages(chapter)[0];
    if (first) return first.path;
  }
  return null;
};

export const excludeLabel = (reason: ExcludeReason): string => {
  switch (reason.reason) {
    case "off-size":
      return `Off-size ${reason.width}×${reason.height}`;
    case "unreadable":
      return "Unreadable";
    case "not-a-page":
      return "Not a page";
    case "manual":
      return "Excluded";
  }
};

export const fileName = (path: string) => path.split(/[/\\]/).pop() ?? path;

/**
 * Make sure a user-typed export name carries the extension for the format.
 *
 * Typing "Ichi the Witch v01" and getting a file with no extension is a real
 * way to end up with something a Kindle refuses to open, so the extension is
 * added when it is missing rather than assumed.
 */
export const withExtension = (name: string, format: Format) => {
  const trimmed = name.trim();
  if (!trimmed) return trimmed;
  return trimmed.toLowerCase().endsWith(`.${format}`)
    ? trimmed
    : `${trimmed}.${format}`;
};

export const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
};

/**
 * Hand a built volume to the user, by whatever that means on this platform.
 *
 * A desktop reveals it in the file manager. Android has no file manager to
 * reveal into, and the export folder sits under `Android/data`, which recent
 * versions hide from the pickers most apps show — so the share sheet is the way
 * a volume actually leaves the device, and the user chooses where it goes.
 */
export async function deliverBuilt(path: string, title?: string): Promise<void> {
  if (canRevealFiles) {
    await revealItemInDir(path);
    return;
  }
  await invoke("share_file", { path, title: title ?? null });
}

/** What the control doing the above should be called. */
export const DELIVER_LABEL = canRevealFiles ? "Show" : "Share";
