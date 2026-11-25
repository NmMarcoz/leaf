import { invoke } from "@tauri-apps/api/core";

import type { ExtensionRepo, Format, Volume } from "@/lib/api";
import type { Translator } from "@/lib/i18n/types";

/** Mirrors `settings::Settings`. */
export interface Settings {
  library_root: string;
  /** `null` until the user picks where builds should go. */
  output_root: string | null;
  default_format: string;
  folder_per_series: boolean;
  /** Cut double-page spreads into two pages. On by default, for Kindle. */
  split_spreads: boolean;
  /** Stamp the volume number on the cover a reader's library shows. EPUB only. */
  cover_badge: boolean;
  /** `original` | `large` | `kindle` | `compact` | `custom` */
  compression: string;
  /** The numbers behind `custom`; kept while a preset is selected. */
  custom_compression: Compression;
  /** Whether the first-run screen has been answered. */
  welcomed: boolean;
  /** The version this install last showed a "what's new" panel for. */
  last_seen_version: string | null;
  /**
   * Extension trust state. The frontend never edits these — the extension
   * panel's commands do, backend-side — but `set_settings` overwrites the
   * whole file with whatever it is handed, so the mirror must carry them for
   * a Settings round-trip not to wipe them.
   */
  approved_extensions: string[];
  dev_extensions: string[];
  disabled_extensions: string[];
  /** Same reasoning: carried so a Settings round-trip keeps them. */
  extension_repos: ExtensionRepo[];
  /** The app's own language; `null` follows the system. See `resolveLanguage`. */
  ui_language: string | null;
}

/** Mirrors `leaf_core::Compression`. */
export interface Compression {
  /** Longest edge in pixels; `null` keeps pages at their original size. */
  max_edge: number | null;
  /** JPEG quality, 1–100. */
  quality: number;
  /** Store black-and-white pages as greyscale. */
  grayscale: boolean;
}

/** Mirror `CUSTOM_*` in `leaf-core/src/compress.rs`; the backend clamps to these. */
export const CUSTOM_EDGE_MIN = 480;
export const CUSTOM_EDGE_MAX = 8000;
export const CUSTOM_QUALITY_MIN = 30;

export const getSettings = () => invoke<Settings>("get_settings");

export const setSettings = (settings: Settings) =>
  invoke<Settings>("set_settings", { settings });

/** The folder offered on first run, before it exists. */
export const suggestedOutputRoot = () => invoke<string>("suggested_output_root");

/**
 * Where "Build" would write this volume without asking, or `null` when no
 * output folder has been chosen yet.
 */
export const resolveBuildPath = (volume: Volume, format: Format) =>
  invoke<string | null>("resolve_build_path", { volume, format });

/* ------------------------------------------------------------ batch building */

export interface BuiltVolume {
  volume: string;
  path: string;
  bytes: number;
  pages: number;
}

export interface BuildBatchReport {
  built: BuiltVolume[];
  failed: { volume: string; error: string }[];
  cancelled: boolean;
}

/** Progress emitted on the `build-batch-progress` event. */
export interface BuildBatchProgress {
  volume: string;
  index: number;
  total: number;
  done: number;
  pages: number;
}

/** Build several stored volumes. `outDir` overrides the configured folder. */
export const buildLibraryVolumes = (args: {
  /** Mail each volume once written, as one job. */
  deliver?: boolean;
  id: number;
  volumes: string[];
  format: Format;
  outDir: string | null;
}) => invoke<number>("build_library_volumes", args);

/**
 * What each compression preset does, in the terms that matter: how big the
 * result is and what it looks like on the device. A function of `t`, not a
 * static array, since the labels are shown in the UI language.
 */
export const compressionPresets = (
  t: Translator,
): {
  value: string;
  label: string;
  detail: string;
}[] => [
  {
    value: "original",
    label: t("settings.compressionOriginal"),
    detail: t("settings.compressionOriginalDetail"),
  },
  {
    value: "large",
    label: t("settings.compressionLarge"),
    detail: t("settings.compressionLargeDetail"),
  },
  {
    value: "kindle",
    label: t("settings.compressionKindle"),
    detail: t("settings.compressionKindleDetail"),
  },
  {
    value: "compact",
    label: t("settings.compressionCompact"),
    detail: t("settings.compressionCompactDetail"),
  },
  {
    value: "custom",
    label: t("settings.compressionCustom"),
    detail: t("settings.compressionCustomDetail"),
  },
];
