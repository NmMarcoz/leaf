import { useCallback, useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FilePlus2, Loader2, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Chip } from "@/components/ui/chip";
import { useT } from "@/lib/i18n";
import {
  approveExtension,
  installExtension,
  listExtensions,
  lockExtension,
  removeExtension,
  setExtensionDev,
  setExtensionEnabled,
  type ScriptState,
  type UserScript,
} from "@/lib/api";
import { canInstallExtensions } from "@/lib/platform";
import { cn } from "@/lib/utils";

interface ExtensionsViewProps {
  onError: (message: string | null) => void;
}

/**
 * The extensions folder as a list: every `.lua` file, what the trust gate
 * thinks of it, and every action that changes that.
 *
 * The Add-from-source dialog shows the *pending queue*; this is the whole
 * folder, including the approved, the off, and the broken — which is the
 * difference between being nudged about a new file and being able to
 * actually manage the set.
 */
export function ExtensionsView({ onError }: ExtensionsViewProps) {
  const t = useT();
  const [scripts, setScripts] = useState<UserScript[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const picker = canInstallExtensions;

  const reload = useCallback(async () => {
    try {
      setScripts(await listExtensions());
    } catch (e) {
      onError(String(e));
      setScripts([]);
    }
  }, [onError]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** Run one mutation and refresh the row state from the backend, never
   * from what the click optimistically assumed — the fingerprint a Lock
   * records is the file's, and only `survey` knows the file's current bytes. */
  const act = useCallback(
    async (file: string, fn: () => Promise<unknown>) => {
      setBusy(file);
      try {
        await fn();
        await reload();
      } catch (e) {
        onError(String(e));
      } finally {
        setBusy(null);
      }
    },
    [onError, reload],
  );

  /** Pick a `.lua` file from anywhere and copy it into the extensions
   * folder. With `replaceFor`, the same call answers "Update": the picked
   * file lands under the existing entry's name. */
  const addOrUpdate = useCallback(
    async (replaceFor?: string) => {
      const picked = await openDialog({
        multiple: false,
        filters: [{ name: "Lua extension", extensions: ["lua"] }],
      });
      if (typeof picked !== "string") return; // Cancelled.
      const file = replaceFor ?? undefined;
      if (file) {
        await act(file, () => installExtension(picked, file));
      } else {
        // No row to key the busy-state on for a first add. The fresh file
        // renders on its pending row after the reload — the state is the
        // message, no toast needed.
        setBusy("");
        try {
          await installExtension(picked);
          await reload();
        } catch (e) {
          onError(String(e));
        } finally {
          setBusy(null);
        }
      }
    },
    [act, onError, reload],
  );

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-border bg-card/60 px-5 py-3">
        <h1 className="flex-1 text-sm font-semibold">{t("extensionsView.title")}</h1>
        <Button variant="outline" size="icon" onClick={() => void reload()}>
          <RefreshCw />
        </Button>
        {/* Picking a file works on both platforms — desktop browses the
            real filesystem, Android's system dialog answers with a
            content:// URI the backend reads through the share plugin. The
            trust gate downstream is identical either way. */}
        {picker && (
          <Button onClick={() => void addOrUpdate()}>
            <FilePlus2 />
            {t("extensionsView.add")}
          </Button>
        )}
      </header>

      <div className="scrollbar-thin flex-1 overflow-y-auto p-5">
        {scripts === null ? (
          <div className="flex justify-center py-10">
            <Loader2 className="animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="mx-auto flex max-w-2xl flex-col gap-2">
            <Callout tone="info">{t("extensionsView.explainer")}</Callout>
            {scripts.length === 0 && (
              <p className="py-8 text-center text-xs text-muted-foreground">
                {t("extensionsView.empty")}
              </p>
            )}
            {scripts.map((s) => (
              <Row
                key={s.file}
                script={s}
                busy={busy === s.file}
                canInstall={picker}
                t={t}
                onApprove={() => void act(s.file, () => approveExtension(s.fingerprint))}
                onDevelop={() => void act(s.file, () => setExtensionDev(s.file, true))}
                onUndevelop={() => void act(s.file, () => setExtensionDev(s.file, false))}
                onLock={() => void act(s.file, () => lockExtension(s.file))}
                onToggle={() =>
                  void act(s.file, () => setExtensionEnabled(s.file, s.state === "disabled"))
                }
                onUpdate={() => void addOrUpdate(s.file)}
                onRemove={() => void act(s.file, () => removeExtension(s.file))}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ one row */

interface RowProps {
  script: UserScript;
  busy: boolean;
  canInstall: boolean;
  t: ReturnType<typeof useT>;
  onApprove: () => void;
  onDevelop: () => void;
  onUndevelop: () => void;
  onLock: () => void;
  onToggle: () => void;
  onUpdate: () => void;
  onRemove: () => void;
}

const STATE_TONE: Record<ScriptState, string> = {
  approved: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  dev: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  pending: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  disabled: "bg-muted text-muted-foreground",
  broken: "bg-red-500/15 text-red-600 dark:text-red-400",
};

function Row({
  script: s,
  busy,
  canInstall: picker,
  t,
  onApprove,
  onDevelop,
  onUndevelop,
  onLock,
  onToggle,
  onUpdate,
  onRemove,
}: RowProps) {
  const enabled = s.state !== "disabled";
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-card/60 p-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 truncate text-sm font-medium">
            {s.name ?? s.file}
            <Chip
              className={cn("border-none px-1.5 py-0 text-[10px] font-semibold uppercase", STATE_TONE[s.state])}
            >
              {t(`extensionsView.state.${s.state}`)}
            </Chip>
          </p>
          <p className="truncate text-xs text-muted-foreground" dir="ltr">
            {s.base_url ?? s.error}
          </p>
        </div>

        {/* A switch on every live row; a broken file has nothing to enable. */}
        {s.state !== "broken" && (
          <button
            role="switch"
            aria-checked={enabled}
            title={t(enabled ? "extensionsView.deactivate" : "extensionsView.activate")}
            onClick={onToggle}
            disabled={busy}
            className={cn(
              "relative h-5 w-9 shrink-0 rounded-full transition-colors",
              enabled ? "bg-primary" : "bg-muted",
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 size-4 rounded-full bg-white transition-all",
                enabled ? "left-[18px]" : "left-0.5",
              )}
            />
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {s.state === "pending" && (
          <>
            <Button size="sm" onClick={onApprove} disabled={busy}>
              <ShieldCheck />
              {t("extensionsView.approve")}
            </Button>
            <Button size="sm" variant="outline" onClick={onDevelop} disabled={busy}>
              {t("extensionsView.develop")}
            </Button>
          </>
        )}
        {s.state === "dev" && (
          <>
            <Button size="sm" onClick={onLock} disabled={busy}>
              <ShieldCheck />
              {t("extensionsView.lock")}
            </Button>
            <Button size="sm" variant="outline" onClick={onUndevelop} disabled={busy}>
              {t("extensionsView.stopDeveloping")}
            </Button>
          </>
        )}
        {picker && s.state !== "broken" && (
          <Button size="sm" variant="ghost" onClick={onUpdate} disabled={busy}>
            <RefreshCw />
            {t("extensionsView.update")}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto text-muted-foreground hover:text-red-600"
          onClick={onRemove}
          disabled={busy}
        >
          {busy ? <Loader2 className="animate-spin" /> : <Trash2 />}
          {t("extensionsView.remove")}
        </Button>
      </div>
    </div>
  );
}
