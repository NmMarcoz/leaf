import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  Download,
  FilePlus2,
  Globe,
  Library,
  Loader2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
} from "lucide-react";

import { Pane } from "@/components/SettingsRow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/lib/i18n";
import type { Translator } from "@/lib/i18n/types";
import {
  addExtensionRepo,
  approveExtension,
  browseExtensionRepo,
  installExtension,
  installFromExtensionRepo,
  languageName,
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
  type SourceKind,
  type UserScript,
} from "@/lib/api";
import { canInstallExtensions } from "@/lib/platform";
import { cn } from "@/lib/utils";

interface ExtensionsViewProps {
  onError: (message: string | null) => void;
}

type Tab = "installed" | "available" | "updates";

/** A repository's index once read, with where it came from. */
interface Browsed {
  repo: ExtensionRepo;
  browse: RepoBrowse | null;
  error: string | null;
}

/** One script a repository offers, and which repository. */
interface Offer {
  repo: string;
  repoName: string;
  row: RepoRow;
}

/**
 * Settings → Extensions (Figma 21 · Configurações · Extensões), plus the
 * repositories the design does not draw, built from the same rows.
 *
 * Installed is the extensions folder: every `.lua` file and where it stands
 * with the trust gate. Available and Updates are what the user's
 * repositories offer. Reading a repository is network, and network is
 * something the user asks for — so they are read when one of those tabs is
 * opened or refreshed, never just because this page was.
 */
export function ExtensionsView({ onError }: ExtensionsViewProps) {
  const t = useT();
  const [tab, setTab] = useState<Tab>("installed");
  const [query, setQuery] = useState("");
  const [scripts, setScripts] = useState<UserScript[] | null>(null);
  const [repos, setRepos] = useState<ExtensionRepo[]>([]);
  const [browsed, setBrowsed] = useState<Browsed[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const picker = canInstallExtensions;

  const reload = useCallback(async () => {
    try {
      const [files, added] = await Promise.all([listExtensions(), listExtensionRepos()]);
      setScripts(files);
      setRepos(added);
    } catch (e) {
      onError(String(e));
      setScripts([]);
    }
  }, [onError]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** Read every repository's index. One failing does not hide the others. */
  const check = useCallback(async () => {
    setChecking(true);
    try {
      const added = await listExtensionRepos();
      setRepos(added);
      const results = await Promise.all(
        added.map(async (repo): Promise<Browsed> => {
          try {
            return { repo, browse: await browseExtensionRepo(repo.url), error: null };
          } catch (e) {
            return { repo, browse: null, error: String(e) };
          }
        }),
      );
      setBrowsed(results);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (tab !== "installed" && browsed === null && !checking) void check();
  }, [tab, browsed, checking, check]);

  /** Run one mutation and refresh from the backend, never from what the
   * click assumed — the fingerprint a Lock records is the file's, and only
   * the survey knows the file's current bytes. */
  const act = useCallback(
    async (key: string, fn: () => Promise<unknown>) => {
      setBusy(key);
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

  /** Pick a `.lua` file and copy it in; with `replaceFor` it lands under
   * that entry's name. Works on Android too, through the system picker. */
  const addFromFile = useCallback(
    async (replaceFor?: string) => {
      const picked = await openDialog({
        multiple: false,
        filters: [{ name: "Lua extension", extensions: ["lua"] }],
      });
      if (typeof picked !== "string") return;
      await act(replaceFor ?? "", () => installExtension(picked, replaceFor));
    },
    [act],
  );

  const install = useCallback(
    async (offers: Offer[]) => {
      for (const { repo, row } of offers) {
        setBusy(`repo:${row.id}`);
        try {
          await installFromExtensionRepo(repo, row.id);
        } catch (e) {
          onError(String(e));
        }
      }
      setBusy(null);
      await Promise.all([reload(), check()]);
    },
    [onError, reload, check],
  );

  const offered = useMemo<Offer[]>(
    () =>
      (browsed ?? []).flatMap((b) =>
        (b.browse?.rows ?? []).map((row) => ({
          repo: b.repo.url,
          repoName: b.browse?.name ?? b.repo.name ?? hostOf(b.repo.url),
          row,
        })),
      ),
    [browsed],
  );
  const updates = offered.filter((o) => o.row.status === "update-available");
  const available = offered.filter(
    (o) => o.row.status === "not-installed" || o.row.status === "incompatible",
  );
  /** Installed files a repository has newer bytes for, by local file name. */
  const updateFor = useMemo(
    () => new Map(updates.map((u) => [u.row.local_file ?? u.row.file, u])),
    [updates],
  );

  const needle = query.trim().toLowerCase();
  const hit = (...fields: (string | null | undefined)[]) =>
    !needle || fields.some((f) => f?.toLowerCase().includes(needle));

  const tabs: { value: Tab; label: string; count: number | null }[] = [
    { value: "installed", label: t("extensionsView.tabInstalled"), count: scripts?.length ?? null },
    {
      value: "available",
      label: t("extensionsView.tabAvailable"),
      count: browsed ? available.length : null,
    },
    { value: "updates", label: t("extensionsView.tabUpdates"), count: browsed ? updates.length : null },
  ];
  const shownOffers = (tab === "updates" ? updates : available).filter((o) =>
    hit(o.row.name, o.row.description, o.row.base_url),
  );

  return (
    <Pane
      title={t("extensionsView.title")}
      status={
        <div className="flex items-center gap-1">
          {picker && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void addFromFile()}
              disabled={busy === ""}
            >
              {busy === "" ? <Loader2 className="animate-spin" /> : <FilePlus2 />}
              {t("extensionsView.addFromFile")}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            title={t("extensionsView.refresh")}
            aria-label={t("extensionsView.refresh")}
            onClick={() => {
              void reload();
              if (browsed !== null || tab !== "installed") void check();
            }}
          >
            {checking ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          </Button>
        </div>
      }
    >
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex h-10 min-w-[200px] flex-1 items-center gap-2 rounded-[10px] border border-line-strong bg-raised px-3">
          <Search className="size-4 shrink-0 text-text-tertiary" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("extensionsView.search")}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-text-tertiary"
          />
        </label>
        <div role="tablist" className="flex shrink-0 rounded-[10px] bg-sunken p-1">
          {tabs.map((item) => (
            <button
              key={item.value}
              role="tab"
              aria-selected={tab === item.value}
              onClick={() => setTab(item.value)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                tab === item.value
                  ? "bg-raised text-foreground shadow-sm"
                  : "text-text-secondary hover:text-foreground",
              )}
            >
              {item.label}
              {item.count !== null && item.count > 0 && ` · ${item.count}`}
            </button>
          ))}
        </div>
      </div>

      {tab === "installed" &&
        (scripts === null ? (
          <Loading />
        ) : (
          <>
            {scripts.length === 0 ? (
              <Empty>{t("extensionsView.empty")}</Empty>
            ) : (
              <List>
                {scripts
                  .filter((s) => hit(s.name, s.file, s.description, s.base_url))
                  .map((s) => (
                    <InstalledRow
                      key={s.file}
                      script={s}
                      busy={busy === s.file}
                      update={updateFor.get(s.file) ?? null}
                      t={t}
                      onApprove={() => void act(s.file, () => approveExtension(s.fingerprint))}
                      onDevelop={(on) => void act(s.file, () => setExtensionDev(s.file, on))}
                      onLock={() => void act(s.file, () => lockExtension(s.file))}
                      onToggle={(on) => void act(s.file, () => setExtensionEnabled(s.file, on))}
                      onReplace={picker ? () => void addFromFile(s.file) : undefined}
                      onUpdate={(u) => void install([u])}
                      onRemove={() => void act(s.file, () => removeExtension(s.file))}
                    />
                  ))}
              </List>
            )}
            <Callout tone="info">{t("extensionsView.explainer")}</Callout>
          </>
        ))}

      {tab !== "installed" && (
        <>
          {repos.length > 0 &&
            (browsed === null ? (
              <Loading />
            ) : (
              <>
                {browsed
                  .filter((b) => b.error)
                  .map((b) => (
                    <Callout
                      key={b.repo.url}
                      tone="destructive"
                      title={b.repo.name ?? hostOf(b.repo.url)}
                    >
                      {b.error}
                    </Callout>
                  ))}
                {tab === "updates" && updates.length > 1 && (
                  <div>
                    <Button
                      variant="outline"
                      disabled={busy !== null}
                      onClick={() => void install(updates)}
                    >
                      <Download />
                      {t("extensionsView.repos.stageAll", { count: updates.length })}
                    </Button>
                  </div>
                )}
                {shownOffers.length === 0 ? (
                  <Empty>
                    {tab === "updates"
                      ? t("extensionsView.noUpdates")
                      : t("extensionsView.noneAvailable")}
                  </Empty>
                ) : (
                  <section className="flex flex-col gap-2.5">
                    <h3 className="type-overline">
                      {tab === "updates"
                        ? t("extensionsView.tabUpdates")
                        : t("extensionsView.availableToInstall")}
                    </h3>
                    <List>
                      {shownOffers.map((o) => (
                        <OfferedRow
                          key={`${o.repo}|${o.row.id}`}
                          offer={o}
                          busy={busy === `repo:${o.row.id}`}
                          disabled={busy !== null}
                          t={t}
                          onInstall={() => void install([o])}
                        />
                      ))}
                    </List>
                    {browsed.some((b) => (b.browse?.skipped ?? 0) > 0) && (
                      <p className="text-xs text-text-secondary">
                        {t("extensionsView.repos.skipped", {
                          count: browsed.reduce((n, b) => n + (b.browse?.skipped ?? 0), 0),
                        })}
                      </p>
                    )}
                  </section>
                )}
              </>
            ))}

          <Repositories
            repos={repos}
            browsed={browsed}
            t={t}
            onError={onError}
            onChanged={async () => {
              await reload();
              await check();
            }}
          />
        </>
      )}
    </Pane>
  );
}

/* ------------------------------------------------------------------ pieces */

function Loading() {
  return (
    <div className="flex justify-center py-10">
      <Loader2 className="animate-spin text-text-tertiary" />
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-line-strong px-6 py-8 text-center text-sm text-text-secondary">
      {children}
    </p>
  );
}

function List({ children }: { children: React.ReactNode }) {
  return <div className="divide-y divide-line rounded-xl border border-line bg-raised">{children}</div>;
}

/** The square the design puts at the head of every extension row. */
function Tile({ icon = <Globe /> }: { icon?: React.ReactNode }) {
  return (
    <span className="flex size-[34px] shrink-0 items-center justify-center rounded-lg bg-sunken text-text-secondary [&_svg]:size-4">
      {icon}
    </span>
  );
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/** A catalogue is drawn in the "info" colour the design gives MangaDex's
 * metadata badge; a reader and a details source in plain ones. */
const KIND_BADGE: Record<SourceKind, "info" | "secondary" | "outline"> = {
  metadata: "info",
  reader: "secondary",
  enrich: "outline",
};

function KindBadge({ kind, t }: { kind: SourceKind; t: Translator }) {
  return (
    <Badge variant={KIND_BADGE[kind]} title={t(`extensionsView.kindHint.${kind}`)}>
      {t(`extensionsView.kind.${kind}`)}
    </Badge>
  );
}

/** "English · English scans" — the line under a name. */
function detailLine(t: Translator, lang?: string, ...rest: (string | null | undefined)[]) {
  const language =
    lang === "multi" || lang === "all"
      ? t("extensionsView.manyLanguages")
      : lang
        ? languageName(lang)
        : null;
  return [language, ...rest].filter(Boolean).join(" · ");
}

interface InstalledRowProps {
  script: UserScript;
  busy: boolean;
  update: Offer | null;
  t: Translator;
  onApprove: () => void;
  onDevelop: (on: boolean) => void;
  onLock: () => void;
  onToggle: (on: boolean) => void;
  onReplace?: () => void;
  onUpdate: (update: Offer) => void;
  onRemove: () => void;
}

function InstalledRow({
  script: s,
  busy,
  update,
  t,
  onApprove,
  onDevelop,
  onLock,
  onToggle,
  onReplace,
  onUpdate,
  onRemove,
}: InstalledRowProps) {
  const broken = s.state === "broken";
  const origins = [s.base_url, ...(s.mirrors ?? [])].filter(Boolean) as string[];

  return (
    <div className="flex flex-col gap-2.5 px-4 py-3.5">
      <div className="flex items-center gap-3 max-sm:flex-wrap">
        <Tile />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
            <span className="truncate">{broken ? s.file : (s.name ?? s.file)}</span>
            {s.kind && <KindBadge kind={s.kind} t={t} />}
            {s.state === "pending" && (
              <Badge variant="warning">{t("extensionsView.state.pending")}</Badge>
            )}
            {s.state === "dev" && <Badge variant="info">{t("extensionsView.state.dev")}</Badge>}
            {broken && <Badge variant="destructive">{t("extensionsView.state.broken")}</Badge>}
            {update && (
              <Badge variant="deliver">{t("extensionsView.repos.status.update-available")}</Badge>
            )}
            {s.nsfw && <Badge variant="destructive">18+</Badge>}
          </p>
          <p className="truncate text-xs text-text-secondary" dir={broken ? "ltr" : undefined}>
            {broken ? s.error : detailLine(t, s.lang, s.description)}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2 max-sm:ml-[46px]">
          {s.state === "pending" && (
            <Button size="sm" onClick={onApprove} disabled={busy}>
              <ShieldCheck />
              {t("extensionsView.approve")}
            </Button>
          )}
          {s.state === "dev" && (
            <Button size="sm" onClick={onLock} disabled={busy}>
              <ShieldCheck />
              {t("extensionsView.lock")}
            </Button>
          )}
          {update && (
            <Button size="sm" variant="outline" onClick={() => onUpdate(update)} disabled={busy}>
              <RefreshCw />
              {t("extensionsView.update")}
            </Button>
          )}
          {busy && <Loader2 className="size-4 animate-spin text-text-tertiary" />}
          {!broken && (
            <Switch
              checked={s.state !== "disabled"}
              onCheckedChange={onToggle}
              disabled={busy}
              aria-label={t(
                s.state !== "disabled" ? "extensionsView.deactivate" : "extensionsView.activate",
              )}
            />
          )}
          <RowMenu
            label={t("extensionsView.more")}
            items={[
              ...(s.state === "pending"
                ? [{ label: t("extensionsView.develop"), onSelect: () => onDevelop(true) }]
                : []),
              ...(s.state === "dev"
                ? [{ label: t("extensionsView.stopDeveloping"), onSelect: () => onDevelop(false) }]
                : []),
              ...(onReplace && !broken
                ? [{ label: t("extensionsView.replaceFromFile"), onSelect: onReplace }]
                : []),
              { label: t("extensionsView.remove"), onSelect: onRemove, danger: true },
            ]}
          />
        </div>
      </div>

      {/* What approving means, said where the button is: the kind, and every
          address the script will be allowed to reach. */}
      {(s.state === "pending" || s.state === "dev") && s.kind && (
        <div className="rounded-lg bg-warning-soft px-3 py-2 text-xs leading-4 text-warning sm:ml-[46px]">
          <p>{t(`extensionsView.kindHint.${s.kind}`)}</p>
          {origins.length > 0 && (
            <p className="mt-1 break-all font-mono text-[11px] text-text-secondary" dir="ltr">
              {t("extensionsView.reaches", { origins: origins.join(" · ") })}
            </p>
          )}
        </div>
      )}
      {s.warnings.length > 0 && (
        <ul className="list-inside list-disc text-xs text-text-secondary sm:ml-[46px]">
          {s.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function OfferedRow({
  offer: { row, repoName },
  busy,
  disabled,
  t,
  onInstall,
}: {
  offer: Offer;
  busy: boolean;
  disabled: boolean;
  t: Translator;
  onInstall: () => void;
}) {
  const incompatible = row.status === "incompatible";
  const update = row.status === "update-available";
  return (
    <div className="flex items-center gap-3 px-4 py-3.5 max-sm:flex-wrap">
      <Tile />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
          <span className="truncate">{row.name}</span>
          <KindBadge kind={row.kind} t={t} />
          {incompatible && (
            <Badge variant="destructive">{t("extensionsView.repos.status.incompatible")}</Badge>
          )}
          {row.nsfw && <Badge variant="destructive">18+</Badge>}
        </p>
        <p className="truncate text-xs text-text-secondary">
          {detailLine(t, row.lang, row.description)}
        </p>
        <p className="truncate font-mono text-[11px] text-text-tertiary" dir="ltr">
          v{row.version} · {hostOf(row.base_url)} · {t("extensionsView.fromRepo", { repo: repoName })}
        </p>
      </div>
      {!incompatible && (
        <Button
          variant="outline"
          onClick={onInstall}
          disabled={disabled}
          className="max-sm:ml-[46px]"
        >
          {busy ? <Loader2 className="animate-spin" /> : update ? <RefreshCw /> : <Download />}
          {update ? t("extensionsView.repos.update") : t("extensionsView.repos.install")}
        </Button>
      )}
    </div>
  );
}

/** The design's "…" button: the rarer actions, kept out of the row. */
function RowMenu({
  label,
  items,
}: {
  label: string;
  items: { label: string; onSelect: () => void; danger?: boolean }[];
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal />
      </Button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-8 z-30 min-w-44 overflow-hidden rounded-lg border border-line bg-raised p-1 shadow-lg"
        >
          {items.map((item) => (
            <button
              key={item.label}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={cn(
                "flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-hover",
                item.danger && "text-danger",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ repositories */

/**
 * Repositories the user added by typing an address. The app suggests none and
 * ships none — an empty list with an address box is the whole default.
 * Installing from one writes a file into the extensions folder and stops:
 * Installed then asks for approval like any other new file.
 */
function Repositories({
  repos,
  browsed,
  t,
  onError,
  onChanged,
}: {
  repos: ExtensionRepo[];
  browsed: Browsed[] | null;
  t: Translator;
  onError: (message: string | null) => void;
  onChanged: () => Promise<void>;
}) {
  const [address, setAddress] = useState("");
  const [adding, setAdding] = useState(false);

  const add = useCallback(async () => {
    if (!address.trim()) return;
    setAdding(true);
    try {
      await addExtensionRepo(address.trim());
      setAddress("");
      await onChanged();
    } catch (e) {
      onError(String(e));
    } finally {
      setAdding(false);
    }
  }, [address, onError, onChanged]);

  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="type-overline">{t("extensionsView.repos.title")}</h3>
      <List>
        {repos.map((repo) => {
          const found = browsed?.find((b) => b.repo.url === repo.url);
          const count = found?.browse?.rows.length;
          return (
            <div key={repo.url} className="flex items-center gap-3 px-4 py-3.5">
              <Tile icon={<Library />} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {found?.browse?.name ?? repo.name ?? hostOf(repo.url)}
                </p>
                <p className="truncate font-mono text-[11px] text-text-secondary" dir="ltr">
                  {repo.url}
                </p>
              </div>
              {count !== undefined && (
                <span className="shrink-0 text-xs text-text-secondary max-sm:hidden">
                  {t("extensionsView.repos.count", { count })}
                </span>
              )}
              {found?.error && (
                <Badge variant="destructive">{t("extensionsView.repos.unreachable")}</Badge>
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                title={t("extensionsView.remove")}
                aria-label={t("extensionsView.remove")}
                onClick={async () => {
                  try {
                    await removeExtensionRepo(repo.url);
                    await onChanged();
                  } catch (e) {
                    onError(String(e));
                  }
                }}
              >
                <Trash2 />
              </Button>
            </div>
          );
        })}
        <div className="flex flex-col gap-2.5 px-4 py-3.5">
          {repos.length === 0 && (
            <p className="text-xs leading-4 text-text-secondary">
              {t("extensionsView.repos.explainer")}
            </p>
          )}
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
              className="h-[38px]"
              aria-label={t("extensionsView.repos.addLabel")}
            />
            <Button onClick={() => void add()} disabled={adding || !address.trim()}>
              {adding ? <Loader2 className="animate-spin" /> : <Plus />}
              {t("extensionsView.repos.add")}
            </Button>
          </div>
        </div>
      </List>
      {repos.length > 0 && (
        <p className="text-xs leading-4 text-text-secondary">{t("extensionsView.repos.explainer")}</p>
      )}
    </section>
  );
}
