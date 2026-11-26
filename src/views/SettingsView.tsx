import { useCallback, useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { CheckCircle2, FolderOpen, Loader2, RefreshCw } from "lucide-react";

import { LogoMark } from "@/components/Logo";
import { Pane, PathWell, SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { UpdateStage } from "@/hooks/useUpdater";
import { LANGUAGES, useT } from "@/lib/i18n";
import { canPickFolders, canRevealFiles, isAndroid } from "@/lib/platform";
import {
  defaultPrefs,
  loadPrefs,
  readerFits,
  readerModes,
  savePrefs,
  type ReaderPrefs,
} from "@/lib/reader";
import {
  getSettings,
  setSettings,
  type Settings,
} from "@/lib/settings";
import type { ThemePreference } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { ExtensionsView } from "@/views/ExtensionsView";
import { DevicesView } from "@/views/DevicesView";

export type SettingsPage = "general" | "devices" | "reading" | "extensions" | "about";

interface SettingsViewProps {
  page: SettingsPage;
  onPageChange: (page: SettingsPage) => void;
  /** Lets the rest of the app pick up a changed library or output folder. */
  onSaved: (settings: Settings) => void;
  onError: (message: string | null) => void;
  updateStage: UpdateStage;
  onCheckUpdates: () => void;
  onWhatsNew: () => void;
  /** Applied immediately: it is chrome, not configuration. */
  theme: ThemePreference;
  onThemeChange: (next: ThemePreference) => void;
}

/** How long after the last change a save goes out. Long enough to coalesce
 * a run of toggles, short enough that leaving the screen never loses one. */
const SAVE_DELAY_MS = 400;

/**
 * Settings, as a page with its own sub-navigation (Figma 17 · Configurações).
 *
 * Saving is automatic: every change is written shortly after it is made, and
 * the header says so. There is no Save button to forget — the old screen's
 * one was the most common way a changed folder "didn't take".
 */
export function SettingsView({
  page,
  onPageChange,
  onSaved,
  onError,
  updateStage,
  onCheckUpdates,
  onWhatsNew,
  theme,
  onThemeChange,
}: SettingsViewProps) {
  const t = useT();
  const pages: { value: SettingsPage; label: string }[] = [
    { value: "general", label: t("settingsView.pageGeneral") },
    // On every platform: a device is also the build profile, and a phone
    // builds too. Sending is what is limited there, inside the page.
    { value: "devices", label: t("settingsView.pageDevices") },
    { value: "reading", label: t("settingsView.pageReading") },
    { value: "extensions", label: t("settingsView.pageExtensions") },
    { value: "about", label: t("settingsView.pageAbout") },
  ];
  const current = pages.find((p) => p.value === page) ?? pages[0];

  return (
    <div className="flex h-full min-h-0 max-md:flex-col">
      <aside className="flex shrink-0 flex-col gap-1 md:w-[232px] md:px-5 md:pt-8 max-md:border-b max-md:border-line max-md:px-5 max-md:pt-3">
        <h1 className="type-title px-2 pb-4 max-md:px-0 max-md:pb-3">{t("settingsView.title")}</h1>
        <nav
          className="flex gap-1 md:flex-col max-md:scrollbar-none max-md:-mx-5 max-md:overflow-x-auto max-md:px-5 max-md:pb-3"
          aria-label={t("settingsView.title")}
        >
          {pages.map((p) => (
            <button
              key={p.value}
              onClick={() => onPageChange(p.value)}
              aria-current={p.value === current.value ? "page" : undefined}
              className={cn(
                "shrink-0 rounded-[10px] px-3 py-2.5 text-left text-sm font-medium transition-colors max-md:rounded-full max-md:border max-md:px-3.5 max-md:py-1.5",
                p.value === current.value
                  ? "bg-pressed text-foreground max-md:border-strong max-md:bg-strong max-md:text-on-strong"
                  : "text-text-secondary hover:bg-hover hover:text-foreground max-md:border-line",
              )}
            >
              {p.label}
            </button>
          ))}
        </nav>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {current.value === "devices" ? (
          <DevicesView onSaved={onSaved} onError={onError} />
        ) : current.value === "extensions" ? (
          <ExtensionsView onError={onError} />
        ) : current.value === "reading" ? (
          <Pane title={current.label}>
            <ReadingPage />
          </Pane>
        ) : current.value === "about" ? (
          <Pane title={current.label}>
            <AboutPage
              updateStage={updateStage}
              onCheckUpdates={onCheckUpdates}
              onWhatsNew={onWhatsNew}
            />
          </Pane>
        ) : (
          <GeneralPage
            title={current.label}
            onSaved={onSaved}
            onError={onError}
            updateStage={updateStage}
            onCheckUpdates={onCheckUpdates}
            onWhatsNew={onWhatsNew}
            theme={theme}
            onThemeChange={onThemeChange}
          />
        )}
      </div>
    </div>
  );
}

function GeneralPage({
  title,
  onSaved,
  onError,
  updateStage,
  onCheckUpdates,
  onWhatsNew,
  theme,
  onThemeChange,
}: Omit<SettingsViewProps, "page" | "onPageChange"> & { title: string }) {
  const t = useT();
  const [settings, setLocal] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  // The latest values, for the timer to save — not the ones it closed over.
  const latest = useRef<Settings | null>(null);

  useEffect(() => {
    getSettings()
      .then((s) => {
        latest.current = s;
        setLocal(s);
      })
      .catch((e) => onError(String(e)));
  }, [onError]);

  const flush = useCallback(async () => {
    const next = latest.current;
    if (!next) return;
    setSaving(true);
    try {
      const stored = await setSettings(next);
      onSaved(stored);
    } catch (e) {
      onError(String(e));
    } finally {
      setSaving(false);
    }
  }, [onSaved, onError]);

  // A change still waiting when the page goes away is saved on the way out.
  useEffect(
    () => () => {
      if (timer.current !== undefined) {
        window.clearTimeout(timer.current);
        void flush();
      }
    },
    [flush],
  );

  const patch = useCallback(
    (fields: Partial<Settings>) => {
      if (!latest.current) return;
      latest.current = { ...latest.current, ...fields };
      setLocal(latest.current);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        timer.current = undefined;
        void flush();
      }, SAVE_DELAY_MS);
    },
    [flush],
  );

  const pickFolder = useCallback(async (): Promise<string | null> => {
    const picked = await openDialog({ directory: true, multiple: false });
    return typeof picked === "string" ? picked : null;
  }, []);

  const status = settings && (
    <span className="flex items-center gap-1.5 text-xs text-text-secondary">
      {saving ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <CheckCircle2 className="size-3.5 text-success" />
      )}
      {saving ? t("settingsView.saving") : t("settingsView.savedAutomatically")}
    </span>
  );

  const themes: { value: ThemePreference; label: string }[] = [
    { value: "system", label: t("settingsView.themeSystem") },
    { value: "light", label: t("settingsView.themeLight") },
    { value: "dark", label: t("settingsView.themeDark") },
  ];

  return (
    <Pane title={title} status={status}>
      {!settings ? (
        <p className="flex items-center gap-2 text-sm text-text-secondary">
          <Loader2 className="size-4 animate-spin" /> {t("settingsView.loading")}
        </p>
      ) : (
        <>
          <SettingsSection title={t("settingsView.appearance")}>
            <SettingsRow title={t("settingsView.language")} description={t("settingsView.languageDetail")}>
              <Select
                value={settings.ui_language ?? "system"}
                onValueChange={(v) => patch({ ui_language: v === "system" ? null : v })}
              >
                <SelectTrigger className="w-48" aria-label={t("settingsView.language")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="system">{t("settingsView.languageSystem")}</SelectItem>
                  {LANGUAGES.map((l) => (
                    <SelectItem key={l.value} value={l.value}>
                      {l.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingsRow>
            <SettingsRow title={t("settingsView.theme")} description={t("settingsView.themeDetail")}>
              <div role="radiogroup" aria-label={t("settingsView.theme")} className="flex gap-1.5">
                {themes.map((option) => (
                  <Chip
                    key={option.value}
                    selected={theme === option.value}
                    onClick={() => onThemeChange(option.value)}
                  >
                    {option.label}
                  </Chip>
                ))}
              </div>
            </SettingsRow>
          </SettingsSection>

          <SettingsSection title={t("settingsView.folders")}>
            <SettingsRow
              title={t("settingsView.libraryFolder")}
              description={t("settingsView.libraryFolderDetail")}
            >
              <PathWell
                title={canRevealFiles ? t("settingsView.reveal") : undefined}
                onClick={canRevealFiles ? () => void revealItemInDir(settings.library_root) : undefined}
              >
                {settings.library_root}
              </PathWell>
              {canPickFolders && (
                <Button
                  variant="outline"
                  onClick={async () => {
                    const picked = await pickFolder();
                    if (picked) patch({ library_root: picked });
                  }}
                >
                  <FolderOpen />
                  {t("settingsView.change")}
                </Button>
              )}
            </SettingsRow>
            <SettingsRow
              title={t("settingsView.buildFolder")}
              description={t("settingsView.buildFolderDetail")}
            >
              <PathWell
                title={settings.output_root && canRevealFiles ? t("settingsView.reveal") : undefined}
                onClick={
                  settings.output_root && canRevealFiles
                    ? () => void revealItemInDir(settings.output_root!)
                    : undefined
                }
              >
                {settings.output_root ?? t("settingsView.buildFolderUnset")}
              </PathWell>
              {canPickFolders && (
                <Button
                  variant="outline"
                  onClick={async () => {
                    const picked = await pickFolder();
                    if (picked) patch({ output_root: picked });
                  }}
                >
                  <FolderOpen />
                  {t("settingsView.change")}
                </Button>
              )}
              {canPickFolders && settings.output_root && (
                <Button variant="ghost" onClick={() => patch({ output_root: null })}>
                  {t("settingsView.clear")}
                </Button>
              )}
            </SettingsRow>
            <SettingsRow
              htmlFor="folder-per-series"
              title={t("settingsView.folderPerSeries")}
              description={
                settings.folder_per_series
                  ? t("settingsView.folderPerSeriesOn")
                  : t("settingsView.folderPerSeriesOff")
              }
            >
              <Switch
                id="folder-per-series"
                checked={settings.folder_per_series}
                onCheckedChange={(on) => patch({ folder_per_series: on })}
              />
            </SettingsRow>
          </SettingsSection>

          <SettingsSection title={t("settingsView.generated")}>
            <SettingsRow
              htmlFor="cover-badge"
              title={t("settingsView.coverBadge")}
              description={
                settings.cover_badge ? t("settingsView.coverBadgeOn") : t("settingsView.coverBadgeOff")
              }
            >
              <Switch
                id="cover-badge"
                checked={settings.cover_badge}
                onCheckedChange={(on) => patch({ cover_badge: on })}
              />
            </SettingsRow>
          </SettingsSection>

          <SettingsSection title={t("settingsView.updates")}>
            <UpdatesRow
              updateStage={updateStage}
              onCheckUpdates={onCheckUpdates}
              onWhatsNew={onWhatsNew}
            />
          </SettingsSection>
        </>
      )}
    </Pane>
  );
}

function UpdatesRow({
  updateStage,
  onCheckUpdates,
  onWhatsNew,
}: {
  updateStage: UpdateStage;
  onCheckUpdates: () => void;
  onWhatsNew: () => void;
}) {
  const t = useT();
  const [version, setVersion] = useState("");
  useEffect(() => {
    void getVersion().then(setVersion);
  }, []);

  return (
    <SettingsRow
      title={t("settingsView.version", { version })}
      description={
        isAndroid
          ? t("settingsView.androidUpdates")
          : updateStage === "uptodate"
            ? t("settingsView.upToDate")
            : updateStage === "available" || updateStage === "installed"
              ? t("settingsView.updateAvailable")
              : t("settingsView.updateUnknown")
      }
    >
      <Button variant="ghost" onClick={onWhatsNew}>
        {t("settingsView.whatsNew")}
      </Button>
      <Button variant="outline" onClick={onCheckUpdates} disabled={updateStage === "checking"}>
        {updateStage === "checking" ? <Loader2 className="animate-spin" /> : <RefreshCw />}
        {t("settingsView.checkNow")}
      </Button>
    </SettingsRow>
  );
}

/**
 * Reader defaults: the same preferences the reader's own panel changes,
 * reachable without opening a chapter first.
 */
function ReadingPage() {
  const t = useT();
  const [prefs, setPrefs] = useState<ReaderPrefs>(loadPrefs);
  const change = (fields: Partial<ReaderPrefs>) => {
    const next = { ...prefs, ...fields };
    setPrefs(next);
    savePrefs(next);
  };

  const backgrounds: { value: ReaderPrefs["background"]; label: string }[] = [
    { value: "black", label: t("settingsView.bgBlack") },
    { value: "grey", label: t("settingsView.bgGrey") },
    { value: "white", label: t("settingsView.bgWhite") },
  ];
  const animations: { value: ReaderPrefs["animation"]; label: string }[] = [
    { value: "slide", label: t("settingsView.animSlide") },
    { value: "fade", label: t("settingsView.animFade") },
    { value: "none", label: t("settingsView.animNone") },
  ];

  return (
    <SettingsSection title={t("settingsView.readingDefaults")}>
      <SettingsRow
        stack
        title={t("settingsView.readerMode")}
        description={readerModes(t).find((m) => m.value === prefs.mode)?.detail}
      >
        <ChipGroup
          label={t("settingsView.readerMode")}
          options={readerModes(t)}
          value={prefs.mode}
          onChange={(mode) => change({ mode })}
        />
      </SettingsRow>
      <SettingsRow stack title={t("settingsView.readerFit")}>
        <ChipGroup
          label={t("settingsView.readerFit")}
          options={readerFits(t)}
          value={prefs.fit}
          onChange={(fit) => change({ fit })}
        />
      </SettingsRow>
      <SettingsRow stack title={t("settingsView.readerBackground")}>
        <ChipGroup
          label={t("settingsView.readerBackground")}
          options={backgrounds}
          value={prefs.background}
          onChange={(background) => change({ background })}
        />
      </SettingsRow>
      <SettingsRow
        stack
        title={t("settingsView.readerAnimation")}
        description={t("settingsView.readingDefaultsDetail")}
      >
        <ChipGroup
          label={t("settingsView.readerAnimation")}
          options={animations}
          value={prefs.animation ?? defaultPrefs().animation}
          onChange={(animation) => change({ animation })}
        />
      </SettingsRow>
    </SettingsSection>
  );
}

function ChipGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((option) => (
        <Chip key={option.value} selected={value === option.value} onClick={() => onChange(option.value)}>
          {option.label}
        </Chip>
      ))}
    </div>
  );
}

function AboutPage({
  updateStage,
  onCheckUpdates,
  onWhatsNew,
}: {
  updateStage: UpdateStage;
  onCheckUpdates: () => void;
  onWhatsNew: () => void;
}) {
  const t = useT();
  return (
    <>
      <div className="flex items-center gap-4 rounded-xl border border-line bg-raised p-5">
        <LogoMark width={56} title="Leaf" />
        <p className="text-sm leading-5 text-text-secondary">{t("settingsView.aboutBody")}</p>
      </div>
      <SettingsSection title={t("settingsView.updates")}>
        <UpdatesRow
          updateStage={updateStage}
          onCheckUpdates={onCheckUpdates}
          onWhatsNew={onWhatsNew}
        />
      </SettingsSection>
    </>
  );
}
