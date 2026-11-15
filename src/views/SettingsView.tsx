import { useCallback, useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Check, CloudDownload, FolderOpen, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Label } from "@/components/ui/label";
import type { ThemePreference } from "@/lib/theme";
import type { UpdateStage } from "@/hooks/useUpdater";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { canPickFolders, canRevealFiles, isAndroid } from "@/lib/platform";
import {
  COMPRESSION_PRESETS,
  CUSTOM_EDGE_MAX,
  CUSTOM_EDGE_MIN,
  CUSTOM_QUALITY_MIN,
  getSettings,
  setSettings,
  type Compression,
  type Settings,
} from "@/lib/settings";
import { Input } from "@/components/ui/input";

interface SettingsViewProps {
  /** Lets the rest of the app pick up a changed library or output folder. */
  onSaved: (settings: Settings) => void;
  onError: (message: string | null) => void;
  /** Android only: the rail that normally carries these is not there. */
  updateStage: UpdateStage;
  onCheckUpdates: () => void;
  /** Applied immediately rather than on Save: it is chrome, not configuration. */
  theme: ThemePreference;
  onThemeChange: (next: ThemePreference) => void;
}

const THEMES: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "Match system" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/** Where things live and what Build does by default. */
export function SettingsView({
  onSaved,
  onError,
  updateStage,
  onCheckUpdates,
  theme,
  onThemeChange,
}: SettingsViewProps) {
  const [settings, setLocal] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getSettings()
      .then(setLocal)
      .catch((e) => onError(String(e)));
  }, [onError]);

  const patch = useCallback((fields: Partial<Settings>) => {
    setSaved(false);
    setLocal((current) => (current ? { ...current, ...fields } : current));
  }, []);

  const pickFolder = useCallback(async (): Promise<string | null> => {
    const picked = await openDialog({ directory: true, multiple: false });
    return typeof picked === "string" ? picked : null;
  }, []);

  const save = useCallback(async () => {
    if (!settings) return;
    setSaving(true);
    onError(null);
    try {
      const stored = await setSettings(settings);
      setLocal(stored);
      setSaved(true);
      onSaved(stored);
    } catch (e) {
      onError(String(e));
    } finally {
      setSaving(false);
    }
  }, [settings, onSaved, onError]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-border bg-card/60 px-5 py-3">
        <h1 className="flex-1 text-sm font-semibold">Settings</h1>
        <Button onClick={() => void save()} disabled={!settings || saving}>
          {saving ? <Loader2 className="animate-spin" /> : saved ? <Check /> : null}
          {saved ? "Saved" : "Save"}
        </Button>
      </header>

      <main className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        {!settings ? (
          <div className="flex items-center gap-2 p-5 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Loading…
          </div>
        ) : (
          <div className="mx-auto flex max-w-2xl flex-col gap-7 px-6 py-8">
            <div className="flex flex-col gap-2">
              <Label>Appearance</Label>
              <div role="radiogroup" aria-label="Appearance" className="flex gap-2">
                {THEMES.map((option) => (
                  <Chip
                    key={option.value}
                    selected={theme === option.value}
                    onClick={() => onThemeChange(option.value)}
                  >
                    {option.label}
                  </Chip>
                ))}
              </div>
            </div>

            <Separator />

            <FolderSetting
              label="Library folder"
              hint="Where series, chapters and cover art are stored. Moving this does not move existing files; point it at a folder you have already copied."
              value={settings.library_root}
              onPick={async () => {
                const picked = await pickFolder();
                if (picked) patch({ library_root: picked });
              }}
            />

            <Separator />

            <FolderSetting
              label="Build folder"
              hint="Where Build writes without asking. Build as… still lets you choose a one-off location."
              value={settings.output_root}
              placeholder="Not set — Build will ask every time"
              onPick={async () => {
                const picked = await pickFolder();
                if (picked) patch({ output_root: picked });
              }}
              onClear={() => patch({ output_root: null })}
            />

            <label className="flex cursor-pointer items-start gap-3">
              <Switch
                checked={settings.folder_per_series}
                onCheckedChange={(on) => patch({ folder_per_series: on })}
                className="mt-0.5"
              />
              <span className="text-xs">
                <span className="font-medium">A folder per series</span>
                <span className="mt-0.5 block text-muted-foreground">
                  {settings.folder_per_series
                    ? "Ichi the Witch/Ichi the Witch v01.epub"
                    : "Ichi the Witch v01.epub — everything in one folder"}
                </span>
              </span>
            </label>

            <label className="flex cursor-pointer items-start gap-3">
              <Switch
                checked={settings.split_spreads}
                onCheckedChange={(on) => patch({ split_spreads: on })}
                className="mt-0.5"
              />
              <span className="text-xs">
                <span className="font-medium">Split double-page spreads</span>
                <span className="mt-0.5 block text-muted-foreground">
                  {settings.split_spreads
                    ? "Each spread becomes two pages, right half first for manga. Kindle zooms into part of a wide page instead of fitting it, so this is almost always what you want."
                    : "Spreads stay whole. On a Kindle the spread is shown whole, smaller, with white bars above and below — pinch to zoom in."}
                </span>
              </span>
            </label>

            <label className="flex cursor-pointer items-start gap-3">
              <Switch
                checked={settings.cover_badge}
                onCheckedChange={(on) => patch({ cover_badge: on })}
                className="mt-0.5"
              />
              <span className="text-xs">
                <span className="font-medium">Volume number on the cover</span>
                <span className="mt-0.5 block text-muted-foreground">
                  {settings.cover_badge
                    ? "The cover in your Kindle's library gets the volume number on a bookmark ribbon at the left edge, clear of Kindle's own progress marker, so a long series can be told apart at a glance. The book itself still opens on the untouched cover. EPUB only."
                    : "The cover is shown exactly as published."}
                </span>
              </span>
            </label>

            <Separator />


            <div className="flex flex-col gap-2">
              <Label htmlFor="compression">Page size</Label>
              <Select
                value={settings.compression}
                onValueChange={(v) => patch({ compression: v })}
              >
                <SelectTrigger id="compression" className="w-60">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMPRESSION_PRESETS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {COMPRESSION_PRESETS.find((p) => p.value === settings.compression)
                  ?.detail}
              </p>
              {settings.compression === "custom" ? (
                <CustomCompression
                  value={settings.custom_compression}
                  onChange={(custom_compression) => patch({ custom_compression })}
                />
              ) : (
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Black-and-white pages are stored as greyscale, which removes about
                  a third again. Colour covers keep their colour, and a page already
                  smaller than the limit is left alone.
                </p>
              )}
            </div>

            <Separator />

            <div className="flex flex-col gap-2">
              <Label htmlFor="format">Default format</Label>
              <Select
                value={settings.default_format}
                onValueChange={(v) => patch({ default_format: v })}
              >
                <SelectTrigger id="format" className="w-52">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="epub">EPUB · Kindle</SelectItem>
                  <SelectItem value="cbz">CBZ · Comic readers</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Pre-selected in the editor, and what a batch build uses.
              </p>
            </div>

            {/* Only on Android. Everywhere else this lives in the rail, which a
                phone does not have and the bottom bar has no room for. */}
            {isAndroid && (
              <div className="flex flex-col gap-2">
                <Label>Updates</Label>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onCheckUpdates}
                    disabled={updateStage === "checking"}
                  >
                    {updateStage === "checking" ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <CloudDownload />
                    )}
                    {updateStage === "uptodate" ? "Up to date" : "Check for updates"}
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  There is no store to update a sideloaded build, so the app
                  fetches the release itself and Android asks before installing
                  it. An update signed with a different key is refused — by the
                  system, not by us.
                </p>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function FolderSetting({
  label,
  hint,
  value,
  placeholder,
  onPick,
  onClear,
}: {
  label: string;
  hint: string;
  value: string | null;
  placeholder?: string;
  onPick: () => void;
  onClear?: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => value && canRevealFiles && void revealItemInDir(value)}
          disabled={!value || !canRevealFiles}
          title={value ? "Reveal in file manager" : undefined}
          className="min-w-0 flex-1 truncate rounded-md border border-border bg-background px-3 py-2 text-left font-mono text-[11px] enabled:hover:border-muted-foreground/40 disabled:text-muted-foreground"
        >
          {value ?? placeholder ?? "Not set"}
        </button>
        {canPickFolders && (
          <Button variant="outline" size="sm" onClick={onPick}>
            <FolderOpen />
            Change
          </Button>
        )}
        {onClear && value && (
          <Button variant="ghost" size="sm" onClick={onClear}>
            Clear
          </Button>
        )}
      </div>
      <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p>
    </div>
  );
}

/**
 * The three numbers behind the "Custom" page size.
 *
 * Fields hold their own text while being typed in, so clearing one to retype it
 * does not snap it straight back; the value is clamped when the field is left,
 * to the same bounds the backend enforces, so what is shown is what is used.
 */
function CustomCompression({
  value,
  onChange,
}: {
  value: Compression;
  onChange: (next: Compression) => void;
}) {
  const [edge, setEdge] = useState(value.max_edge?.toString() ?? "");
  const [quality, setQuality] = useState(value.quality.toString());

  // Pick up values the backend clamped on save.
  useEffect(() => setEdge(value.max_edge?.toString() ?? ""), [value.max_edge]);
  useEffect(() => setQuality(value.quality.toString()), [value.quality]);

  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

  const commitEdge = () => {
    const n = Number.parseInt(edge, 10);
    // Empty means "no limit": pages keep their size and are only re-encoded.
    const max_edge = edge.trim() === "" || Number.isNaN(n)
      ? null
      : clamp(n, CUSTOM_EDGE_MIN, CUSTOM_EDGE_MAX);
    setEdge(max_edge?.toString() ?? "");
    onChange({ ...value, max_edge });
  };

  const commitQuality = () => {
    const n = Number.parseInt(quality, 10);
    const q = Number.isNaN(n) ? value.quality : clamp(n, CUSTOM_QUALITY_MIN, 100);
    setQuality(q.toString());
    onChange({ ...value, quality: q });
  };

  return (
    <div className="mt-1 flex flex-col gap-4 rounded-md border border-border p-4">
      <div className="flex flex-wrap gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="custom-edge" className="text-xs">
            Longest edge
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id="custom-edge"
              type="number"
              inputMode="numeric"
              min={CUSTOM_EDGE_MIN}
              max={CUSTOM_EDGE_MAX}
              step={100}
              placeholder="No limit"
              value={edge}
              onChange={(e) => setEdge(e.target.value)}
              onBlur={commitEdge}
              className="w-32"
            />
            <span className="text-xs text-muted-foreground">px</span>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="custom-quality" className="text-xs">
            JPEG quality
          </Label>
          <Input
            id="custom-quality"
            type="number"
            inputMode="numeric"
            min={CUSTOM_QUALITY_MIN}
            max={100}
            value={quality}
            onChange={(e) => setQuality(e.target.value)}
            onBlur={commitQuality}
            className="w-24"
          />
        </div>
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Leave the edge empty to keep every page at its original size. Pages are
        only ever shrunk, never enlarged, and between {CUSTOM_EDGE_MIN} and{" "}
        {CUSTOM_EDGE_MAX}px. Quality runs from {CUSTOM_QUALITY_MIN} to 100: 85 is
        what the Kindle preset uses, and much below 70 starts to smear
        screentones.
      </p>

      <label className="flex cursor-pointer items-start gap-3">
        <Switch
          checked={value.grayscale}
          onCheckedChange={(grayscale) => onChange({ ...value, grayscale })}
          className="mt-0.5"
        />
        <span className="text-xs">
          <span className="font-medium">Store black-and-white pages as greyscale</span>
          <span className="mt-0.5 block text-muted-foreground">
            Removes about a third again on an e-ink screen. Colour pages keep
            their colour either way.
          </span>
        </span>
      </label>
    </div>
  );
}
