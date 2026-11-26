import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  Check,
  CheckCircle2,
  CircleAlert,
  Layers,
  Loader2,
  Plus,
  Send,
  Trash2,
  Usb,
} from "lucide-react";

import { MailAccountDialog, keychainName } from "@/components/MailAccountDialog";
import { PathWell, SettingsRow, SettingsSection } from "@/components/SettingsRow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/lib/i18n";
import { canPickFolders, canSendToDevice } from "@/lib/platform";
import { presets, sendConfig, sendTestEmail, type DeliveryStatus } from "@/lib/send";
import {
  connectedReaders,
  deviceSummary,
  getSettings,
  newDevice,
  RESOLUTIONS,
  setSettings,
  type ConnectedReader,
  type Device,
  type DeviceKind,
  type Settings,
} from "@/lib/settings";
import { cn } from "@/lib/utils";

/** Long enough to let a burst of typing settle into one write. */
const SAVE_DELAY_MS = 500;
const KINDS: DeviceKind[] = ["kindle", "kobo", "boox", "other"];

/**
 * Settings → Devices (Figma "18 · Configurações · Dispositivos").
 *
 * The readers a volume is built for and sent to. Left, the list with the
 * default marked and the one mail account email devices share; right, the
 * selected device: what it is, how a volume reaches it, and the build
 * profile — screen size, format, greyscale, spreads — every build for it
 * starts from. Saves as it goes, like the rest of Settings.
 */
export function DevicesView({
  onSaved,
  onError,
}: {
  onSaved: (settings: Settings) => void;
  onError: (message: string | null) => void;
}) {
  const t = useT();
  const [settings, setLocal] = useState<Settings | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [account, setAccount] = useState<DeliveryStatus | null>(null);
  const [editingAccount, setEditingAccount] = useState(false);
  const [attached, setAttached] = useState<ConnectedReader[]>([]);
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef<Settings | null>(null);

  useEffect(() => {
    getSettings()
      .then((s) => {
        latest.current = s;
        setLocal(s);
        setSelected(s.default_device ?? s.devices[0]?.id ?? null);
      })
      .catch((e) => onError(String(e)));
    if (canSendToDevice) {
      sendConfig()
        .then(setAccount)
        .catch(() => {});
    }
  }, [onError]);

  // Plugging a reader in should show up without leaving the page. Cheap: it
  // lists a couple of mount folders and looks for two marker directories.
  useEffect(() => {
    if (!canPickFolders) return;
    const look = () =>
      void connectedReaders()
        .then(setAttached)
        .catch(() => {});
    look();
    const every = window.setInterval(look, 4000);
    return () => window.clearInterval(every);
  }, []);

  const flush = useCallback(async () => {
    const next = latest.current;
    if (!next) return;
    setSaving(true);
    try {
      onSaved(await setSettings(next));
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

  const commit = useCallback(
    (next: Settings, now = false) => {
      latest.current = next;
      setLocal(next);
      window.clearTimeout(timer.current);
      if (now) {
        timer.current = undefined;
        void flush();
        return;
      }
      timer.current = window.setTimeout(() => {
        timer.current = undefined;
        void flush();
      }, SAVE_DELAY_MS);
    },
    [flush],
  );

  const patchDevice = useCallback(
    (id: string, fields: Partial<Device>) => {
      const current = latest.current;
      if (!current) return;
      commit({
        ...current,
        devices: current.devices.map((d) => (d.id === id ? { ...d, ...fields } : d)),
      });
    },
    [commit],
  );

  const add = (kind: DeviceKind) => {
    const current = latest.current;
    if (!current) return;
    const device = newDevice(t, kind, current.devices.map((d) => d.id));
    commit(
      {
        ...current,
        devices: [...current.devices, device],
        // The first device is the default; there is nothing else it could be.
        default_device: current.devices.length === 0 ? device.id : current.default_device,
      },
      true,
    );
    setSelected(device.id);
    setAdding(false);
  };

  const remove = (id: string) => {
    const current = latest.current;
    if (!current) return;
    const devices = current.devices.filter((d) => d.id !== id);
    commit(
      {
        ...current,
        devices,
        default_device:
          current.default_device === id ? (devices[0]?.id ?? null) : current.default_device,
      },
      true,
    );
    setSelected(devices[0]?.id ?? null);
  };

  const defaultId = settings ? (settings.default_device ?? settings.devices[0]?.id) : null;
  const device = settings?.devices.find((d) => d.id === selected) ?? null;

  const status = settings && (
    <span className="flex items-center gap-1.5 text-xs text-text-tertiary">
      {saving ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <CheckCircle2 className="size-3.5 text-success" />
      )}
      {saving ? t("settingsView.saving") : t("settingsView.savedAutomatically")}
    </span>
  );

  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
      <div className="flex max-w-[1000px] flex-col gap-4 px-5 pb-10 pt-5 md:pl-6 md:pr-12 md:pt-10">
        <header className="flex items-center gap-4">
          <h2 className="type-subtitle flex-1">{t("devicesView.title")}</h2>
          {status}
        </header>

        {!settings ? (
          <p className="flex items-center gap-2 text-sm text-text-secondary">
            <Loader2 className="size-4 animate-spin" /> {t("settingsView.loading")}
          </p>
        ) : (
          <div className="flex gap-4 max-lg:flex-col">
            {/* ---------------------------------------------- the list */}
            <div className="flex w-[300px] shrink-0 flex-col gap-2 max-lg:w-full">
              <h3 className="type-overline">{t("devicesView.yourReaders")}</h3>

              {settings.devices.length > 0 && (
                <div className="divide-y divide-line overflow-hidden rounded-[14px] border border-line bg-raised">
                  {settings.devices.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => setSelected(d.id)}
                      aria-current={d.id === selected ? "true" : undefined}
                      className={cn(
                        "flex w-full items-center gap-2.5 px-3.5 py-3 text-left transition-colors",
                        d.id === selected ? "bg-sunken" : "hover:bg-hover",
                      )}
                    >
                      <span
                        className={cn(
                          "rounded-lg p-[7px]",
                          d.id === selected ? "bg-raised" : "bg-sunken",
                        )}
                      >
                        <Layers className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-medium">{d.name}</span>
                          {d.id === defaultId && (
                            <span className="shrink-0 rounded-full bg-deliver-soft px-[7px] text-xs font-medium leading-4 text-deliver">
                              {t("devicesView.default")}
                            </span>
                          )}
                        </span>
                        <span className="block truncate text-xs text-text-tertiary">
                          {deviceSummary(t, d)}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {adding ? (
                <div className="flex flex-col gap-2 rounded-xl border border-dashed border-line-strong p-3">
                  <p className="text-xs text-text-secondary">{t("devicesView.whichKind")}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {KINDS.map((kind) => (
                      <button
                        key={kind}
                        type="button"
                        onClick={() => add(kind)}
                        className="rounded-full border border-line px-3 py-1 text-xs font-medium hover:border-line-strong hover:bg-hover"
                      >
                        {t(`settings.deviceKind.${kind}`)}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setAdding(true)}
                  className="flex items-center gap-2 rounded-xl border border-dashed border-line-strong px-3.5 py-3 text-sm font-medium text-text-secondary transition-colors hover:bg-hover hover:text-foreground"
                >
                  <Plus className="size-4" />
                  {t("devicesView.add")}
                </button>
              )}

              {canSendToDevice && (
                <AccountCard status={account} onEdit={() => setEditingAccount(true)} />
              )}
            </div>

            {/* ---------------------------------------- the selected one */}
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              {!device ? (
                <div className="rounded-[14px] border border-dashed border-line-strong px-5 py-8 text-center">
                  <p className="text-sm font-medium">{t("devicesView.emptyTitle")}</p>
                  <p className="mt-1 text-xs text-text-secondary">{t("devicesView.emptyDetail")}</p>
                </div>
              ) : (
                <DeviceForm
                  key={device.id}
                  device={device}
                  isDefault={device.id === defaultId}
                  sender={account?.config.from ?? ""}
                  attached={attached}
                  onChange={(fields) => patchDevice(device.id, fields)}
                  onMakeDefault={() =>
                    latest.current && commit({ ...latest.current, default_device: device.id }, true)
                  }
                  onRemove={() => remove(device.id)}
                  onError={onError}
                />
              )}
            </div>
          </div>
        )}
      </div>

      <MailAccountDialog
        open={editingAccount}
        onOpenChange={setEditingAccount}
        status={account}
        onSaved={setAccount}
      />
    </div>
  );
}

/** "Conta para envio por e-mail": the shared sending account, summarised. */
function AccountCard({ status, onEdit }: { status: DeliveryStatus | null; onEdit: () => void }) {
  const t = useT();
  const config = status?.config;
  const set = config && config.from.trim() && config.host.trim();
  const provider = config && presets(t).find((p) => p.host === config.host)?.label;

  return (
    <div className="flex flex-col gap-1.5 rounded-[14px] border border-line bg-raised px-4 py-3.5">
      <h3 className="type-overline">{t("devicesView.mailAccount")}</h3>
      {set ? (
        <>
          <p className="truncate text-xs font-medium">
            {config.from}
            {provider ? ` · ${provider}` : ""}
          </p>
          <p className="flex items-center gap-1.5 text-xs text-text-secondary">
            {status.has_password ? (
              <CheckCircle2 className="size-3.5 shrink-0 text-success" />
            ) : (
              <CircleAlert className="size-3.5 shrink-0 text-warning" />
            )}
            {status.has_password
              ? t("devicesView.passwordSaved", { store: keychainName(t) })
              : t("devicesView.noPassword")}
          </p>
        </>
      ) : (
        <p className="text-xs text-text-secondary">{t("devicesView.mailAccountUnset")}</p>
      )}
      <Button variant="ghost" size="sm" className="-ml-2 mt-0.5 self-start" onClick={onEdit}>
        {set
          ? status?.has_password
            ? t("devicesView.changePassword")
            : t("devicesView.editAccount")
          : t("devicesView.setUpAccount")}
      </Button>
    </div>
  );
}

function DeviceForm({
  device,
  isDefault,
  sender,
  attached,
  onChange,
  onMakeDefault,
  onRemove,
  onError,
}: {
  device: Device;
  isDefault: boolean;
  sender: string;
  attached: ConnectedReader[];
  onChange: (fields: Partial<Device>) => void;
  onMakeDefault: () => void;
  onRemove: () => void;
  onError: (message: string | null) => void;
}) {
  const t = useT();
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  // Presets that fit this kind first, then the rest; the device's own size
  // stays selectable even when it matches none (a size from an older file).
  const resolutions = useMemo(() => {
    const own = RESOLUTIONS.filter((r) => r.kind === device.kind);
    const rest = RESOLUTIONS.filter((r) => r.kind !== device.kind);
    return [...own, ...rest];
  }, [device.kind]);
  // Keyed by size *and* model: a Paperwhite and a Kobo Clara share a screen,
  // and two items with one value confuse the picker. The device's size is
  // shown as the first model that has it, its own kind first.
  const keyOf = (r: { width: number; height: number; model: string }) =>
    `${r.width}x${r.height}|${r.model}`;
  const match = device.resolution
    ? resolutions.find(
        (r) => r.width === device.resolution!.width && r.height === device.resolution!.height,
      )
    : undefined;
  const resolutionValue = !device.resolution
    ? "original"
    : match
      ? keyOf(match)
      : `${device.resolution.width}x${device.resolution.height}|`;
  const known = match !== undefined;

  const reader = attached.find((c) => c.kind === device.kind);
  // A Kindle or Kobo on a cable needs no folder; anything else does.
  const detects = device.kind === "kindle" || device.kind === "kobo";

  const test = async () => {
    setTesting(true);
    setTested(false);
    onError(null);
    try {
      await sendTestEmail(device.id);
      setTested(true);
    } catch (e) {
      onError(String(e));
    } finally {
      setTesting(false);
    }
  };

  return (
    <>
      <h3 className="type-overline truncate">{device.name}</h3>
      <SettingsSection className="[&>div]:rounded-[14px]">
        <SettingsRow title={t("devicesView.name")}>
          <Input
            value={device.name}
            onChange={(e) => onChange({ name: e.target.value })}
            className="h-8 w-52 bg-canvas text-xs font-medium max-sm:w-full"
          />
        </SettingsRow>

        <SettingsRow title={t("devicesView.kind")}>
          <Select value={device.kind} onValueChange={(v) => onChange({ kind: v as DeviceKind })}>
            <SelectTrigger className="h-8 w-40 bg-canvas text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {t(`settings.deviceKind.${k}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>

        {canSendToDevice && (
          <SettingsRow title={t("devicesView.howToSend")}>
            <Segmented
              value={device.delivery}
              onChange={(delivery) => onChange({ delivery })}
              options={[
                ["email", t("devicesView.byEmail")],
                ["folder", t("devicesView.byFolder")],
              ]}
            />
          </SettingsRow>
        )}

        {canSendToDevice && device.delivery === "email" && (
          <SettingsRow
            title={t("devicesView.deviceEmail")}
            description={
              device.kind === "kindle"
                ? sender
                  ? t("devicesView.approveSender", { sender })
                  : t("devicesView.approveSenderUnset")
                : undefined
            }
          >
            <Input
              value={device.address}
              placeholder={t("devicesView.deviceEmailPlaceholder")}
              onChange={(e) => onChange({ address: e.target.value })}
              className="h-8 w-56 bg-canvas font-mono text-xs max-sm:w-full"
              spellCheck={false}
              autoCapitalize="off"
            />
          </SettingsRow>
        )}

        {canSendToDevice && device.delivery === "folder" && (
          <SettingsRow
            title={t("devicesView.folder")}
            description={
              device.folder
                ? t("devicesView.folderChosen")
                : detects
                  ? reader
                    ? t("devicesView.readerFound", { label: reader.label })
                    : t("devicesView.readerMissing", { kind: t(`settings.deviceKind.${device.kind}`) })
                  : t("devicesView.folderNeeded")
            }
          >
            {device.folder ? (
              <PathWell title={device.folder}>{device.folder}</PathWell>
            ) : (
              detects && (
                <span
                  className={cn(
                    "flex items-center gap-1.5 text-xs",
                    reader ? "text-success" : "text-text-tertiary",
                  )}
                >
                  <Usb className="size-3.5" />
                  {reader ? t("devicesView.connected") : t("devicesView.notConnected")}
                </span>
              )
            )}
            {canPickFolders && (
              <Button
                variant="secondary"
                size="sm"
                onClick={async () => {
                  const picked = await openDialog({ directory: true, multiple: false });
                  if (typeof picked === "string") onChange({ folder: picked });
                }}
              >
                {t("devicesView.chooseFolder")}
              </Button>
            )}
            {device.folder && detects && (
              <Button variant="ghost" size="sm" onClick={() => onChange({ folder: "" })}>
                {t("devicesView.useUsb")}
              </Button>
            )}
          </SettingsRow>
        )}

        <SettingsRow title={t("devicesView.resolution")} description={t("devicesView.resolutionDetail")}>
          <Select
            value={resolutionValue}
            onValueChange={(v) => {
              if (v === "original") return onChange({ resolution: null });
              const [width, height] = v.split("|")[0].split("x").map(Number);
              onChange({ resolution: { width, height } });
            }}
          >
            <SelectTrigger className="h-8 w-60 bg-canvas text-xs max-sm:w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {!known && device.resolution && (
                <SelectItem value={resolutionValue}>
                  {device.resolution.width} × {device.resolution.height}
                </SelectItem>
              )}
              {resolutions.map((r) => (
                <SelectItem key={keyOf(r)} value={keyOf(r)}>
                  {r.width} × {r.height} · {r.model}
                </SelectItem>
              ))}
              <SelectItem value="original">{t("devicesView.resolutionOriginal")}</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>

        <SettingsRow title={t("devicesView.format")}>
          <Segmented
            value={device.format}
            onChange={(format) => onChange({ format })}
            options={[
              ["epub", "EPUB"],
              // In the design, and worth having for a Kobo — but the writer
              // does not exist yet, so it is shown and not offered.
              ["kepub", "KEPUB", t("devicesView.kepubSoon")],
              ["cbz", "CBZ"],
            ]}
          />
        </SettingsRow>

        <SettingsRow
          htmlFor={`gray-${device.id}`}
          title={t("devicesView.grayscale")}
          description={t("devicesView.grayscaleDetail")}
        >
          <Switch
            id={`gray-${device.id}`}
            checked={device.grayscale}
            onCheckedChange={(grayscale) => onChange({ grayscale })}
          />
        </SettingsRow>

        <SettingsRow
          htmlFor={`split-${device.id}`}
          title={t("devicesView.splitSpreads")}
          description={t("devicesView.splitSpreadsDetail")}
        >
          <Switch
            id={`split-${device.id}`}
            checked={device.split_spreads}
            onCheckedChange={(split_spreads) => onChange({ split_spreads })}
          />
        </SettingsRow>
      </SettingsSection>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        {canSendToDevice && (
          <Button variant="outline" onClick={() => void test()} disabled={testing}>
            {testing ? <Loader2 className="animate-spin" /> : tested ? <Check /> : <Send />}
            {tested
              ? device.delivery === "email"
                ? t("devicesView.testSent")
                : t("devicesView.testReachable")
              : t("devicesView.sendTest")}
          </Button>
        )}
        {!isDefault && (
          <Button variant="ghost" onClick={onMakeDefault}>
            {t("devicesView.makeDefault")}
          </Button>
        )}
        <span className="flex-1" />
        {confirmRemove ? (
          <>
            <Button variant="ghost" onClick={() => setConfirmRemove(false)}>
              {t("devicesView.keep")}
            </Button>
            <Button variant="destructive" onClick={onRemove}>
              <Trash2 />
              {t("devicesView.confirmRemove")}
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={() => setConfirmRemove(true)}>
            <Trash2 />
            {t("devicesView.remove")}
          </Button>
        )}
      </div>
    </>
  );
}

/** The design's segmented control: a sunken track, the chosen one raised. */
function Segmented<V extends string>({
  value,
  onChange,
  options,
}: {
  value: V;
  onChange: (value: V) => void;
  /** `[value, label, disabledReason?]` — a reason disables the option. */
  options: [string, string, string?][];
}) {
  return (
    <div role="radiogroup" className="flex shrink-0 gap-0.5 rounded-[10px] bg-sunken p-[3px]">
      {options.map(([option, label, disabled]) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          disabled={!!disabled}
          title={disabled}
          onClick={() => onChange(option as V)}
          className={cn(
            "rounded-lg px-2.5 py-[5px] text-xs font-medium transition-colors",
            value === option
              ? "bg-raised text-foreground shadow-xs"
              : "text-text-secondary enabled:hover:text-foreground disabled:opacity-45",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
