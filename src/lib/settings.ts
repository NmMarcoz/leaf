import { invoke } from "@tauri-apps/api/core";

import type { Format, Volume } from "@/lib/api";

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
 * result is and what it looks like on the device.
 */
export const COMPRESSION_PRESETS: {
  value: string;
  label: string;
  detail: string;
}[] = [
  {
    value: "original",
    label: "Original",
    detail:
      "Pages are copied untouched. Largest files, and usually far more detail than any e-reader can show.",
  },
  {
    value: "large",
    label: "Large · 2400px",
    detail: "For a Kindle Scribe or a tablet. Roughly half the size of the original.",
  },
  {
    value: "kindle",
    label: "Kindle · 1600px",
    detail:
      "Matches a Paperwhite or Oasis exactly. Typically a quarter of the original size, with nothing visible lost on the device.",
  },
  {
    value: "compact",
    label: "Compact · 1280px",
    detail:
      "When a volume has to fit an email attachment limit. Softer if you zoom right in.",
  },
  {
    value: "custom",
    label: "Custom",
    detail:
      "Your own size and quality — for a device none of the presets fit, or to trade file size against sharpness yourself.",
  },
];
