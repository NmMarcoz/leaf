import { useCallback, useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  ChevronDown,
  ChevronRight,
  Download,
  FilePlus2,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { useT } from "@/lib/i18n";
import {
  addExtensionRepo,
  approveExtension,
  browseExtensionRepo,
  installExtension,
  installFromExtensionRepo,
  listExtensionRepos,
  listExtensions,
  lockExtension,
  removeExtension,
  removeExtensionRepo,
  setExtensionDev,
  setExtensionEnabled,
  type ExtensionRepo,
  type RepoBrowse,
  type RepoRow,
  type RepoStatus,
  type ScriptState,
  type SourceKind,
  type UserScript,
} from "@/lib/api";
import { canInstallExtensions } from "@/lib/platform";
import { cn } from "@/lib/utils";

interface ExtensionsViewProps {
  onError: (message: string | null) => void;
}

/**
 * The extensions folder as a list: every `.lua` file, what the trust gate
 * thinks of it, and every action that changes that — plus the repositories
 * the user added, which only ever put files into that same folder.
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

            <Repositories t={t} onError={onError} onInstalled={reload} />
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ badges */

const STATE_TONE: Record<ScriptState, string> = {
  approved: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  dev: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  pending: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  disabled: "bg-muted text-muted-foreground",
  broken: "bg-red-500/15 text-red-600 dark:text-red-400",
};

/** A reader is the kind that fetches pages, so it is the one drawn loudest. */
const KIND_TONE: Record<SourceKind, string> = {
  metadata: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  enrich: "bg-muted text-muted-foreground",
  reader: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
};

const BADGE = "border-none px-1.5 py-0 text-[10px] font-semibold uppercase";

function KindBadge({ kind, t }: { kind: SourceKind; t: ReturnType<typeof useT> }) {
  return (
    <Chip className={cn(BADGE, KIND_TONE[kind])} title={t(`extensionsView.kindHint.${kind}`)}>
      {t(`extensionsView.kind.${kind}`)}
    </Chip>
  );
}

/** Name, badges, and the lines saying what the script is and can reach —
 * shared by an installed row and a repository row, so the two describe a
 * script the same way. */
function Describe({
  name,
  kind,
  lang,
  nsfw,
  description,
  baseUrl,
  mirrors,
  capabilities,
  badge,
  t,
}: {
  name: string;
  kind?: SourceKind;
  lang?: string;
  nsfw?: boolean;
  description?: string | null;
  baseUrl?: string;
  mirrors?: string[];
  capabilities?: string[];
  badge?: React.ReactNode;
  t: ReturnType<typeof useT>;
}) {
  return (
    <div className="min-w-0 flex-1">
      <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
        <span className="truncate">{name}</span>
        {kind && <KindBadge kind={kind} t={t} />}
        {badge}
        {lang && (
          <Chip className={cn(BADGE, "bg-muted text-muted-foreground")}>{lang}</Chip>
        )}
        {nsfw && (
          <Chip className={cn(BADGE, "bg-red-500/15 text-red-600 dark:text-red-400")}>18+</Chip>
        )}
      </p>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
      {baseUrl && (
        <p className="truncate text-xs text-muted-foreground" dir="ltr">
          {[baseUrl, ...(mirrors ?? [])].join(" · ")}
        </p>
      )}
      {capabilities && capabilities.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          {t("extensionsView.can", {
            what: capabilities.map((c) => t(`extensionsView.capability.${c}`)).join(" · "),
          })}
        </p>
      )}
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
      <div className="flex items-start gap-3">
        {s.state === "broken" ? (
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 truncate text-sm font-medium">
              {s.file}
              <Chip className={cn(BADGE, STATE_TONE.broken)}>
                {t("extensionsView.state.broken")}
              </Chip>
            </p>
            <p className="text-xs text-muted-foreground" dir="ltr">
              {s.error}
            </p>
          </div>
        ) : (
          <Describe
            name={s.name ?? s.file}
            kind={s.kind}
            lang={s.lang}
            nsfw={s.nsfw}
            description={s.description}
            baseUrl={s.base_url}
            mirrors={s.mirrors}
            capabilities={s.capabilities}
            badge={
              <Chip className={cn(BADGE, STATE_TONE[s.state])}>
                {t(`extensionsView.state.${s.state}`)}
              </Chip>
            }
            t={t}
          />
        )}

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

      {/* What approving means for this kind, said where the button is. */}
      {s.state === "pending" && s.kind && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {t(`extensionsView.kindHint.${s.kind}`)}
        </p>
      )}
      {s.warnings.length > 0 && (
        <ul className="list-inside list-disc text-[11px] text-muted-foreground">
          {s.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

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

/* ------------------------------------------------------------ repositories */

/**
 * Repositories the user added by typing an address. The app suggests none
 * and ships none — an empty list with an address box is the whole default.
 * Installing from one writes a file into the extensions folder and stops:
 * the row above then asks for approval like any other new file.
 */
function Repositories({
  t,
  onError,
  onInstalled,
}: {
  t: ReturnType<typeof useT>;
  onError: (message: string | null) => void;
  onInstalled: () => Promise<void>;
}) {
  const [repos, setRepos] = useState<ExtensionRepo[]>([]);
  const [address, setAddress] = useState("");
  const [adding, setAdding] = useState(false);

  const reload = useCallback(async () => {
    try {
      setRepos(await listExtensionRepos());
    } catch (e) {
      onError(String(e));
    }
  }, [onError]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const add = useCallback(async () => {
    if (!address.trim()) return;
    setAdding(true);
    try {
      await addExtensionRepo(address.trim());
      setAddress("");
      await reload();
    } catch (e) {
      onError(String(e));
    } finally {
      setAdding(false);
    }
  }, [address, onError, reload]);

  return (
    <section className="mt-6 flex flex-col gap-2">
      <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t("extensionsView.repos.title")}
      </h2>
      <p className="text-xs text-muted-foreground">{t("extensionsView.repos.explainer")}</p>
      <div className="flex items-center gap-2">
        <Input
          value={address}
          placeholder="https://…/index.json"
          dir="ltr"
          type="url"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void add();
          }}
        />
        <Button onClick={() => void add()} disabled={adding || !address.trim()}>
          {adding ? <Loader2 className="animate-spin" /> : <Plus />}
          {t("extensionsView.repos.add")}
        </Button>
      </div>
      {repos.map((repo) => (
        <Repository
          key={repo.url}
          repo={repo}
          t={t}
          onError={onError}
          onInstalled={onInstalled}
          onRemove={async () => {
            try {
              await removeExtensionRepo(repo.url);
              await reload();
            } catch (e) {
              onError(String(e));
            }
          }}
        />
      ))}
    </section>
  );
}

const STATUS_TONE: Record<RepoStatus, string> = {
  "not-installed": "bg-muted text-muted-foreground",
  installed: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  "update-available": "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  incompatible: "bg-red-500/15 text-red-600 dark:text-red-400",
};

function Repository({
  repo,
  t,
  onError,
  onInstalled,
  onRemove,
}: {
  repo: ExtensionRepo;
  t: ReturnType<typeof useT>;
  onError: (message: string | null) => void;
  onInstalled: () => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [browse, setBrowse] = useState<RepoBrowse | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  // Fetched on opening, never on mount: reading a repository is network,
  // and network is something the user asks for.
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setBrowse(await browseExtensionRepo(repo.url));
    } catch (e) {
      onError(String(e));
    } finally {
      setLoading(false);
    }
  }, [repo.url, onError]);

  const install = useCallback(
    async (rows: RepoRow[]) => {
      for (const row of rows) {
        setBusy(row.id);
        try {
          await installFromExtensionRepo(repo.url, row.id);
        } catch (e) {
          onError(String(e));
        }
      }
      setBusy(null);
      await Promise.all([load(), onInstalled()]);
    },
    [repo.url, onError, load, onInstalled],
  );

  const updates = browse?.rows.filter((r) => r.status === "update-available") ?? [];

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-card/60 p-3">
      <div className="flex items-center gap-2">
        <button
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => {
            const next = !open;
            setOpen(next);
            if (next && !browse) void load();
          }}
        >
          {open ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{browse?.name ?? repo.name ?? repo.url}</p>
            <p className="truncate text-xs text-muted-foreground" dir="ltr">
              {repo.url}
            </p>
          </div>
        </button>
        {open && (
          <Button size="icon" variant="ghost" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground hover:text-red-600"
          onClick={() => void onRemove()}
        >
          <Trash2 />
          {t("extensionsView.remove")}
        </Button>
      </div>

      {open && browse && (
        <div className="flex flex-col gap-2 border-t border-border pt-2">
          {updates.length > 1 && (
            <Button
              size="sm"
              variant="outline"
              className="self-start"
              disabled={busy !== null}
              onClick={() => void install(updates)}
            >
              <Download />
              {t("extensionsView.repos.stageAll", { count: updates.length })}
            </Button>
          )}
          {browse.rows.length === 0 && (
            <p className="text-xs text-muted-foreground">{t("extensionsView.repos.empty")}</p>
          )}
          {browse.rows.map((row) => (
            <div key={row.id} className="flex items-start gap-3">
              <Describe
                name={row.name}
                kind={row.kind}
                lang={row.lang}
                nsfw={row.nsfw}
                description={row.description}
                baseUrl={row.base_url}
                mirrors={row.mirrors}
                capabilities={row.capabilities}
                badge={
                  <Chip className={cn(BADGE, STATUS_TONE[row.status])}>
                    {t(`extensionsView.repos.status.${row.status}`)}
                  </Chip>
                }
                t={t}
              />
              {(row.status === "not-installed" || row.status === "update-available") && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => void install([row])}
                >
                  {busy === row.id ? <Loader2 className="animate-spin" /> : <Download />}
                  {t(
                    row.status === "update-available"
                      ? "extensionsView.repos.update"
                      : "extensionsView.repos.install",
                  )}
                </Button>
              )}
            </div>
          ))}
          {browse.skipped > 0 && (
            <p className="text-[11px] text-muted-foreground">
              {t("extensionsView.repos.skipped", { count: browse.skipped })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
