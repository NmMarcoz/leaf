import { useCallback, useEffect, useMemo, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  BookOpen,
  Check,
  ChevronRight,
  Compass,
  FolderInput,
  FolderOpen,
  Layers,
  Loader2,
  Plus,
  Usb,
} from "lucide-react";

import { LogoMark } from "@/components/Logo";
import { MailAccountDialog } from "@/components/MailAccountDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/lib/i18n";
import { setLibraryRoot } from "@/lib/library";
import { canPickFolders, canSendToDevice } from "@/lib/platform";
import { sendConfig, type DeliveryStatus } from "@/lib/send";
import {
  connectedReaders,
  deviceSummary,
  getSettings,
  newDevice,
  RESOLUTIONS,
  setSettings,
  suggestedOutputRoot,
  type ConnectedReader,
  type Device,
  type DeviceKind,
  type Settings,
} from "@/lib/settings";
import { cn } from "@/lib/utils";

/** Where to land once the welcome is over. */
export type WelcomeNext = "explore" | "library";

interface WelcomeViewProps {
  onDone: (settings: Settings, next: WelcomeNext) => void;
  onError: (message: string | null) => void;
}

type Step = "folder" | "devices" | "series";

const KINDS: DeviceKind[] = ["kindle", "kobo", "boox", "other"];

/**
 * First run (Figma "02 · Boas-vindas · pasta" and "03 · … leitores").
 *
 * Three steps, each answerable with one click: the library folder (a
 * sensible one is filled in), the readers volumes are built for, and where
 * to find a first series. Builds go to the suggested output folder without
 * asking, so the first Build simply works; Settings changes it.
 *
 * `welcomed` is only set at the end. Quitting halfway shows this again, but
 * whatever was already chosen — the folder, a saved device — is kept.
 *
 * A phone has no folder picker and cannot send to a device, so there the
 * folder step only says where things go and the devices step is skipped.
 */
export function WelcomeView({ onDone, onError }: WelcomeViewProps) {
  const t = useT();
  const [settings, setLocal] = useState<Settings | null>(null);
  const [step, setStep] = useState<Step>("folder");
  const [folder, setFolder] = useState<string | null>(null);
  const [output, setOutput] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([getSettings(), suggestedOutputRoot()])
      .then(([s, out]) => {
        setLocal(s);
        setFolder(s.library_root);
        setOutput(s.output_root ?? out);
      })
      .catch((e) => onError(String(e)));
  }, [onError]);

  const steps: Step[] = canSendToDevice ? ["folder", "devices", "series"] : ["folder", "series"];
  const index = steps.indexOf(step);

  const save = useCallback(async (next: Settings) => {
    const stored = await setSettings(next);
    setLocal(stored);
    return stored;
  }, []);

  const confirmFolder = async () => {
    if (!settings || !folder) return;
    setBusy(true);
    onError(null);
    try {
      // Opening the library there is the check: an unwritable folder or a
      // newer index fails here, not at the first download.
      if (folder !== settings.library_root) await setLibraryRoot(folder);
      const current = await getSettings();
      await save({ ...current, output_root: current.output_root ?? output });
      setStep(steps[index + 1]);
    } catch (e) {
      onError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const finish = async (next: WelcomeNext) => {
    setBusy(true);
    onError(null);
    try {
      const current = await getSettings();
      onDone(await save({ ...current, welcomed: true }), next);
    } catch (e) {
      onError(String(e));
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full bg-canvas max-md:flex-col">
      <Presentation steps={steps} current={index} />

      {/* A phone gets a slim header instead of the ink panel. */}
      <header className="flex items-center gap-2 bg-ink px-5 py-4 md:hidden">
        <LogoMark width={32} />
        <span className="font-brand text-xl font-medium tracking-[0.04em] text-on-ink">leaf</span>
      </header>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-20 pb-10 pt-16 max-lg:px-10 max-sm:px-5 max-sm:pb-6 max-sm:pt-6">
        <p className="type-overline text-deliver">
          {t("welcomeView.stepOf", { step: index + 1, count: steps.length })}
        </p>

        {step === "folder" && (
          <FolderStep
            folder={folder}
            output={output}
            busy={busy || !settings}
            onPick={async () => {
              const picked = await openDialog({ directory: true, multiple: false });
              if (typeof picked === "string") setFolder(picked);
            }}
            onContinue={() => void confirmFolder()}
          />
        )}

        {step === "devices" && settings && (
          <DevicesStep
            settings={settings}
            onSave={save}
            onError={onError}
            onContinue={() => setStep("series")}
          />
        )}

        {step === "series" && <SeriesStep busy={busy} onFinish={(next) => void finish(next)} />}
      </div>
    </div>
  );
}

/** The ink panel: what Leaf is, and the steps with the current one lit. */
function Presentation({ steps, current }: { steps: Step[]; current: number }) {
  const t = useT();
  const label: Record<Step, [string, string]> = {
    folder: [t("welcomeView.stepFolder"), t("welcomeView.stepFolderDetail")],
    devices: [t("welcomeView.stepDevices"), t("welcomeView.stepDevicesDetail")],
    series: [t("welcomeView.stepSeries"), t("welcomeView.stepSeriesDetail")],
  };
  return (
    <aside className="flex w-[480px] shrink-0 flex-col gap-5 overflow-hidden bg-ink p-12 max-lg:w-[400px] max-lg:p-10 max-md:hidden">
      <div className="flex items-center gap-2.5">
        <LogoMark width={44} />
        <span className="font-brand text-[28px] font-medium tracking-[0.04em] text-on-ink">leaf</span>
      </div>
      <div className="flex-1" />
      <h1 className="font-display text-[40px] font-bold leading-[44px] tracking-[-0.015em] text-on-ink max-lg:text-[32px] max-lg:leading-9">
        {t("welcomeView.headline")}
      </h1>
      <p className="text-sm leading-5 text-on-ink-muted">{t("welcomeView.pitch")}</p>
      <ol className="flex flex-col gap-1.5 pt-3">
        {steps.map((step, i) => {
          const done = i < current;
          const here = i === current;
          return (
            <li
              key={step}
              aria-current={here ? "step" : undefined}
              className={cn("flex items-center gap-3 rounded-xl px-3 py-2.5", here && "bg-ink-raised")}
            >
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-medium",
                  done
                    ? "bg-success text-on-ink"
                    : here
                      ? "bg-deliver text-on-deliver"
                      : "bg-ink-raised text-on-ink-muted",
                )}
              >
                {done ? <Check className="size-3.5" /> : i + 1}
              </span>
              <span className="flex min-w-0 flex-col">
                <span
                  className={cn("text-sm font-medium", done || here ? "text-on-ink" : "text-on-ink-muted")}
                >
                  {label[step][0]}
                </span>
                <span className="truncate text-xs text-on-ink-muted">{label[step][1]}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}

function FolderStep({
  folder,
  output,
  busy,
  onPick,
  onContinue,
}: {
  folder: string | null;
  output: string | null;
  busy: boolean;
  onPick: () => void;
  onContinue: () => void;
}) {
  const t = useT();
  return (
    <>
      <div className="mt-6 flex flex-col gap-2">
        <h2 className="type-title">{t("welcomeView.folderTitle")}</h2>
        <p className="text-sm leading-5 text-text-secondary">
          {canPickFolders ? t("welcomeView.folderIntro") : t("welcomeView.folderIntroNoPicker")}
        </p>
      </div>

      <div className="mt-6 flex flex-col gap-1.5">
        <span className="text-xs font-medium text-text-secondary">{t("welcomeView.libraryFolder")}</span>
        <div className="flex items-center gap-2">
          <span className="flex min-w-0 flex-1 items-center gap-2 rounded-[10px] border border-line-strong bg-raised px-3 py-2.5">
            <FolderOpen className="size-4 shrink-0 text-text-secondary" />
            <span className="truncate font-mono text-xs">{folder ?? "…"}</span>
          </span>
          {canPickFolders && (
            <Button variant="secondary" onClick={onPick} disabled={busy}>
              {t("welcomeView.choose")}
            </Button>
          )}
        </div>
        {output && (
          <p className="text-xs text-text-tertiary">
            {t("welcomeView.buildsGoTo")} <span className="break-all font-mono">{output}</span>
          </p>
        )}
      </div>

      {canPickFolders && (
        <div className="mt-6 flex items-start gap-3 rounded-xl bg-info-soft px-4 py-3.5">
          <FolderInput className="mt-px size-[18px] shrink-0 text-info" />
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-medium text-info">{t("welcomeView.existingTitle")}</p>
            <p className="text-xs text-text-secondary">{t("welcomeView.existingDetail")}</p>
          </div>
        </div>
      )}

      <div className="min-h-6 flex-1" />
      <div className="flex justify-end">
        <Button onClick={onContinue} disabled={busy || !folder}>
          {busy ? <Loader2 className="animate-spin" /> : <ChevronRight />}
          {t("welcomeView.continue")}
        </Button>
      </div>
    </>
  );
}

function DevicesStep({
  settings,
  onSave,
  onError,
  onContinue,
}: {
  settings: Settings;
  onSave: (next: Settings) => Promise<Settings>;
  onError: (message: string | null) => void;
  onContinue: () => void;
}) {
  const t = useT();
  const devices = settings.devices;
  // The form starts open when there is nothing yet — the common case.
  const [draft, setDraft] = useState<Device | null>(() =>
    devices.length === 0 ? newDevice(t, "kindle", []) : null,
  );
  const [saving, setSaving] = useState(false);
  const [account, setAccount] = useState<DeliveryStatus | null>(null);
  const [editingAccount, setEditingAccount] = useState(false);
  const [attached, setAttached] = useState<ConnectedReader[]>([]);

  useEffect(() => {
    sendConfig()
      .then(setAccount)
      .catch(() => {});
    const look = () =>
      void connectedReaders()
        .then(setAttached)
        .catch(() => {});
    look();
    const every = window.setInterval(look, 4000);
    return () => window.clearInterval(every);
  }, []);

  const defaultId = settings.default_device ?? devices[0]?.id ?? null;
  const isNew = draft !== null && !devices.some((d) => d.id === draft.id);

  const saveDraft = async (): Promise<boolean> => {
    if (!draft) return true;
    setSaving(true);
    onError(null);
    try {
      await onSave({
        ...settings,
        devices: isNew ? [...devices, draft] : devices.map((d) => (d.id === draft.id ? draft : d)),
        // The first reader added is the default; later ones are not.
        default_device: settings.default_device ?? (devices.length === 0 ? draft.id : null),
      });
      setDraft(null);
      return true;
    } catch (e) {
      onError(String(e));
      return false;
    } finally {
      setSaving(false);
    }
  };

  // A form that was filled in and not saved is meant, not abandoned.
  const next = async () => {
    if (draft && draft.name.trim() && !(await saveDraft())) return;
    onContinue();
  };

  const mailSet = !!account?.config?.from.trim() && !!account?.config?.host.trim();

  return (
    <>
      <div className="mt-4 flex flex-col gap-1.5">
        <h2 className="type-title">{t("welcomeView.devicesTitle")}</h2>
        <p className="text-sm leading-5 text-text-secondary">{t("welcomeView.devicesIntro")}</p>
      </div>

      <div className="mt-4 flex flex-col gap-4">
        {devices.length > 0 && (
          <div className="overflow-hidden rounded-[14px] border border-line bg-raised">
            {devices.map((device) => (
              <div
                key={device.id}
                className="flex items-center gap-3 border-b border-line px-3.5 py-3 last:border-b-0"
              >
                <span className="rounded-lg bg-sunken p-[7px]">
                  <Layers className="size-4 text-text-secondary" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{device.name}</span>
                    {device.id === defaultId && (
                      <span className="shrink-0 rounded-full bg-deliver-soft px-[7px] py-px text-xs font-medium text-deliver">
                        {t("welcomeView.default")}
                      </span>
                    )}
                  </span>
                  <span className="truncate text-xs text-text-tertiary">
                    {deviceSummary(t, device)} · {device.format.toUpperCase()}
                  </span>
                </span>
                <Button variant="ghost" onClick={() => setDraft(device)} disabled={draft?.id === device.id}>
                  {t("welcomeView.edit")}
                </Button>
              </div>
            ))}
          </div>
        )}

        {draft ? (
          <DeviceDraft
            draft={draft}
            isNew={isNew}
            attached={attached}
            saving={saving}
            mailSet={mailSet}
            onChange={(fields) => setDraft({ ...draft, ...fields })}
            onKind={(kind) =>
              // A new device takes the kind's defaults; an existing one keeps
              // what the user already set and only changes kind.
              setDraft(isNew ? newDevice(t, kind, devices.map((d) => d.id)) : { ...draft, kind })
            }
            onSetUpMail={() => setEditingAccount(true)}
            onSave={() => void saveDraft()}
          />
        ) : (
          <button
            type="button"
            onClick={() => setDraft(newDevice(t, "kindle", devices.map((d) => d.id)))}
            className="flex items-center justify-center gap-2 rounded-[14px] border border-dashed border-line-strong px-4 py-3 text-sm font-medium text-text-secondary transition-colors hover:bg-hover hover:text-foreground"
          >
            <Plus className="size-4" />
            {t("welcomeView.addDevice")}
          </button>
        )}
      </div>

      <div className="min-h-6 flex-1" />
      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={onContinue} disabled={saving}>
          {t("welcomeView.later")}
        </Button>
        <span className="flex-1" />
        <Button onClick={() => void next()} disabled={saving}>
          {saving ? <Loader2 className="animate-spin" /> : <ChevronRight />}
          {t("welcomeView.continue")}
        </Button>
      </div>

      <MailAccountDialog
        open={editingAccount}
        onOpenChange={setEditingAccount}
        status={account}
        onSaved={setAccount}
      />
    </>
  );
}

/** The design's "Novo dispositivo" card: the essentials; the rest is in Settings. */
function DeviceDraft({
  draft,
  isNew,
  attached,
  saving,
  mailSet,
  onChange,
  onKind,
  onSetUpMail,
  onSave,
}: {
  draft: Device;
  isNew: boolean;
  attached: ConnectedReader[];
  saving: boolean;
  mailSet: boolean;
  onChange: (fields: Partial<Device>) => void;
  onKind: (kind: DeviceKind) => void;
  onSetUpMail: () => void;
  onSave: () => void;
}) {
  const t = useT();
  // Keyed by size and model, as in Settings: two models share a screen size.
  const keyOf = (r: { width: number; height: number; model: string }) =>
    `${r.width}x${r.height}|${r.model}`;
  const resolutions = useMemo(
    () => [
      ...RESOLUTIONS.filter((r) => r.kind === draft.kind),
      ...RESOLUTIONS.filter((r) => r.kind !== draft.kind),
    ],
    [draft.kind],
  );
  const match = draft.resolution
    ? resolutions.find(
        (r) => r.width === draft.resolution!.width && r.height === draft.resolution!.height,
      )
    : undefined;
  const resolutionValue = !draft.resolution
    ? "original"
    : match
      ? keyOf(match)
      : `${draft.resolution.width}x${draft.resolution.height}|`;
  const detects = draft.kind === "kindle" || draft.kind === "kobo";
  const reader = attached.find((c) => c.kind === draft.kind);

  return (
    <div className="flex flex-col gap-3 rounded-[14px] border border-foreground bg-raised p-4">
      <p className="text-[15px] font-semibold">{isNew ? t("welcomeView.newDevice") : draft.name}</p>

      <div role="radiogroup" className="flex flex-wrap gap-1.5">
        {KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            role="radio"
            aria-checked={draft.kind === kind}
            onClick={() => onKind(kind)}
            className={cn(
              "rounded-full border px-[11px] py-[5px] text-xs font-medium transition-colors",
              draft.kind === kind
                ? "border-foreground bg-foreground text-background"
                : "border-line text-text-secondary hover:text-foreground",
            )}
          >
            {t(`settings.deviceKind.${kind}`)}
          </button>
        ))}
      </div>

      <div className="flex gap-3 max-sm:flex-col">
        <label className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="text-xs font-medium text-text-secondary">{t("welcomeView.name")}</span>
          <Input value={draft.name} onChange={(e) => onChange({ name: e.target.value })} />
        </label>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="text-xs font-medium text-text-secondary">{t("welcomeView.resolution")}</span>
          <Select
            value={resolutionValue}
            onValueChange={(v) => {
              if (v === "original") return onChange({ resolution: null });
              const [width, height] = v.split("|")[0].split("x").map(Number);
              onChange({ resolution: { width, height } });
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {!match && draft.resolution && (
                <SelectItem value={resolutionValue}>
                  {draft.resolution.width} × {draft.resolution.height}
                </SelectItem>
              )}
              {resolutions.map((r) => (
                <SelectItem key={keyOf(r)} value={keyOf(r)}>
                  {r.width} × {r.height} · {r.model}
                </SelectItem>
              ))}
              <SelectItem value="original">{t("settings.resolutionOriginal")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-end gap-3 max-sm:flex-col max-sm:items-stretch">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-text-secondary">{t("welcomeView.howToSend")}</span>
          <Segmented
            value={draft.delivery}
            onChange={(delivery) => onChange({ delivery })}
            options={[
              ["email", t("welcomeView.byEmail")],
              ["folder", t("welcomeView.byFolder")],
            ]}
          />
        </div>
        {draft.delivery === "email" ? (
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="text-xs font-medium text-text-secondary">{t("welcomeView.deviceEmail")}</span>
            <Input
              value={draft.address}
              placeholder={t("welcomeView.deviceEmailPlaceholder")}
              onChange={(e) => onChange({ address: e.target.value })}
              className="font-mono text-xs"
              spellCheck={false}
              autoCapitalize="off"
            />
          </label>
        ) : (
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="text-xs font-medium text-text-secondary">{t("welcomeView.readerFolder")}</span>
            <div className="flex h-9 items-center gap-2 rounded-[10px] border border-line-strong bg-raised pl-3 pr-1">
              {draft.folder ? (
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{draft.folder}</span>
              ) : (
                <span
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-1.5 truncate text-xs",
                    reader ? "text-success" : "text-text-tertiary",
                  )}
                >
                  {detects && <Usb className="size-3.5 shrink-0" />}
                  {detects
                    ? reader
                      ? t("welcomeView.readerFound", { label: reader.label })
                      : t("welcomeView.readerWhenPlugged")
                    : t("welcomeView.folderNeeded")}
                </span>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  const picked = await openDialog({ directory: true, multiple: false });
                  if (typeof picked === "string") onChange({ folder: picked });
                }}
              >
                {t("welcomeView.choose")}
              </Button>
            </div>
          </div>
        )}
      </div>

      {draft.delivery === "email" && !mailSet && (
        <p className="text-xs text-text-tertiary">
          {t("welcomeView.mailAccountNeeded")}{" "}
          <button
            type="button"
            onClick={onSetUpMail}
            className="font-medium text-foreground underline underline-offset-2"
          >
            {t("welcomeView.setUpMail")}
          </button>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-medium text-text-secondary">{t("welcomeView.format")}</span>
        <Segmented
          value={draft.format}
          onChange={(format) => onChange({ format })}
          options={[
            ["epub", "EPUB"],
            // In the design; the writer does not exist yet, so shown and not offered.
            ["kepub", "KEPUB", t("welcomeView.kepubSoon")],
            ["cbz", "CBZ"],
          ]}
        />
        <span className="flex-1" />
        <Button variant="secondary" onClick={onSave} disabled={saving || !draft.name.trim()}>
          {saving ? <Loader2 className="animate-spin" /> : <Check />}
          {t("welcomeView.saveDevice")}
        </Button>
      </div>
    </div>
  );
}

function SeriesStep({ busy, onFinish }: { busy: boolean; onFinish: (next: WelcomeNext) => void }) {
  const t = useT();
  const option = (next: WelcomeNext, Icon: typeof Compass, title: string, detail: string) => (
    <button
      type="button"
      disabled={busy}
      onClick={() => onFinish(next)}
      className="group flex items-center gap-3 rounded-[14px] border border-line bg-raised px-4 py-3.5 text-left transition-colors hover:border-foreground disabled:opacity-60"
    >
      <span className="rounded-lg bg-sunken p-2">
        <Icon className="size-4 text-text-secondary" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-text-tertiary">{detail}</span>
      </span>
      {busy ? (
        <Loader2 className="size-4 animate-spin text-text-tertiary" />
      ) : (
        <ChevronRight className="size-4 text-text-tertiary transition-transform group-hover:translate-x-0.5" />
      )}
    </button>
  );
  return (
    <>
      <div className="mt-4 flex flex-col gap-1.5">
        <h2 className="type-title">{t("welcomeView.seriesTitle")}</h2>
        <p className="text-sm leading-5 text-text-secondary">{t("welcomeView.seriesIntro")}</p>
      </div>
      <div className="mt-5 flex flex-col gap-2.5">
        {option("explore", Compass, t("welcomeView.goExplore"), t("welcomeView.goExploreDetail"))}
        {option("library", BookOpen, t("welcomeView.goShelf"), t("welcomeView.goShelfDetail"))}
      </div>
    </>
  );
}
