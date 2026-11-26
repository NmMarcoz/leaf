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
  /** The readers builds are made for and sent to. See `devices.rs`. */
  devices: Device[];
  /** The `id` builds start from and "Send to" uses; `null` = the first. */
  default_device: string | null;
}

/** Mirrors `devices::Device` — serde names, so the whole list round-trips. */
export interface Device {
  id: string;
  name: string;
  kind: DeviceKind;
  /** `email` mails the file; `folder` copies it, a plugged-in reader included. */
  delivery: "email" | "folder";
  address: string;
  /** Empty = find the plugged-in reader of this kind. */
  folder: string;
  /** `null` keeps pages at their original size. */
  resolution: { width: number; height: number } | null;
  format: "epub" | "cbz";
  grayscale: boolean;
  split_spreads: boolean;
  quality: number;
}

export type DeviceKind = "kindle" | "kobo" | "boox" | "other";

/** A reader found mounted right now (`connected_readers`). */
export interface ConnectedReader {
  kind: DeviceKind;
  label: string;
  root: string;
}

export const connectedReaders = () => invoke<ConnectedReader[]>("connected_readers");

/**
 * Screens people actually own, for the device form's resolution picker.
 * Named by model because nobody knows their screen in pixels; a size typed
 * into an older settings file still shows, just without a name.
 */
export const RESOLUTIONS: { width: number; height: number; model: string; kind: DeviceKind }[] = [
  { width: 1072, height: 1448, model: "Kindle · Paperwhite 3/4", kind: "kindle" },
  { width: 1236, height: 1648, model: "Paperwhite 5 · Kindle 2024", kind: "kindle" },
  { width: 1264, height: 1680, model: "Oasis · Kobo Libra 2", kind: "kindle" },
  { width: 1860, height: 2480, model: "Kindle Scribe", kind: "kindle" },
  { width: 1072, height: 1448, model: "Kobo Clara", kind: "kobo" },
  { width: 1440, height: 1920, model: "Kobo Sage", kind: "kobo" },
  { width: 1404, height: 1872, model: "Boox Note Air", kind: "boox" },
  { width: 1860, height: 2480, model: "Boox Tab X", kind: "boox" },
];

/** The device builds start from: the named default, else the first. */
export function defaultDevice(settings: Settings | null): Device | null {
  if (!settings || settings.devices.length === 0) return null;
  return (
    settings.devices.find((d) => d.id === settings.default_device) ?? settings.devices[0]
  );
}

/** "Kindle · e-mail · 1072 × 1448", the line under a device's name. */
export function deviceSummary(t: Translator, device: Device, withKind = true): string {
  const parts: string[] = [];
  if (withKind) parts.push(t(`settings.deviceKind.${device.kind}`));
  parts.push(
    device.delivery === "email"
      ? t("settings.deliveryEmailShort")
      : device.folder
        ? t("settings.deliveryFolderShort")
        : t("settings.deliveryUsbShort"),
  );
  parts.push(
    device.resolution
      ? `${device.resolution.width} × ${device.resolution.height}`
      : t("settings.resolutionOriginal"),
  );
  return parts.join(" · ");
}

/** A new device of a kind, sized for its most common screen. */
export function newDevice(t: Translator, kind: DeviceKind, taken: string[]): Device {
  const screen = RESOLUTIONS.find((r) => r.kind === kind) ?? RESOLUTIONS[0];
  let n = 1;
  while (taken.includes(`device-${n}`)) n += 1;
  return {
    id: `device-${n}`,
    name: t(`settings.deviceKind.${kind}`),
    kind,
    // A Kindle takes mail; the others are reached over USB.
    delivery: kind === "kindle" ? "email" : "folder",
    address: "",
    folder: "",
    resolution: { width: screen.width, height: screen.height },
    format: "epub",
    grayscale: true,
    split_spreads: true,
    quality: 85,
  };
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
  /** Build for (and send to) this device; `null` = the default one. */
  device?: string | null;
}) => invoke<number>("build_library_volumes", { device: null, deliver: false, ...args });

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
