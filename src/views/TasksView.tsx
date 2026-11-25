import { useEffect, useState } from "react";
import {
  AlertTriangle,
  BookPlus,
  CircleSlash,
  Download,
  Loader2,
  Package,
  Sparkles,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cancelTask, clearFinishedTasks, isActive, type Task } from "@/components/TaskPanel";
import { listSources, languageName, type SourceInfo } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { canSendToDevice } from "@/lib/platform";
import { sendConfig } from "@/lib/send";
import { cn } from "@/lib/utils";

interface TasksViewProps {
  tasks: Task[];
  onOpenDevices: () => void;
  onOpenExtensions: () => void;
}

/**
 * Everything the app is doing in the background, as a screen of its own.
 *
 * Grouped the way they are asked about: what went wrong first, because a
 * failure is the one thing here that needs the user; then what is running,
 * in queue order; then what finished, which is kept until cleared because
 * "did that actually work" is asked after the fact far more than during.
 */
export function TasksView({ tasks, onOpenDevices, onOpenExtensions }: TasksViewProps) {
  const t = useT();
  const failed = tasks.filter((task) => task.state === "failed");
  const running = tasks.filter(isActive);
  const finished = tasks.filter((task) => task.state === "done" || task.state === "cancelled");

  return (
    <div className="scrollbar-thin h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1048px] flex-col gap-6 px-5 pb-10 pt-6 sm:px-10 sm:pt-8">
        <header className="flex flex-wrap items-end gap-x-6 gap-y-2">
          <div className="min-w-0 flex-1">
            <h1 className="type-display max-sm:text-[32px] max-sm:leading-9">{t("tasks.title")}</h1>
            <p className="mt-1 text-sm text-text-secondary">{t("tasks.subtitle")}</p>
          </div>
          {failed.length + finished.length > 0 && (
            <Button variant="ghost" onClick={() => void clearFinishedTasks()}>
              {t("tasks.clearFinished")}
            </Button>
          )}
        </header>

        <div className="flex gap-6 max-xl:flex-col">
          <div className="flex min-w-0 flex-1 flex-col gap-6">
            {tasks.length === 0 && (
              <div className="rounded-xl border border-dashed border-line-strong px-6 py-14 text-center">
                <p className="type-heading">{t("tasks.emptyTitle")}</p>
                <p className="mt-1 text-sm text-text-secondary">{t("tasks.emptyBody")}</p>
              </div>
            )}

            {failed.length > 0 && (
              <Group title={t("tasks.attention")} count={failed.length}>
                {failed.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-start gap-3 rounded-xl border border-danger/60 bg-danger-soft px-4 py-3.5"
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-raised text-danger">
                      <AlertTriangle className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{task.title}</p>
                      <p className="mt-0.5 text-xs text-text-secondary" data-selectable>
                        {task.error}
                      </p>
                    </div>
                  </div>
                ))}
              </Group>
            )}

            {running.length > 0 && (
              <Group title={t("tasks.running")} count={running.length}>
                <List>
                  {running.map((task) => (
                    <Row key={task.id} task={task}>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void cancelTask(task.id)}
                      >
                        {t("tasks.cancel")}
                      </Button>
                    </Row>
                  ))}
                </List>
              </Group>
            )}

            {finished.length > 0 && (
              <Group title={t("tasks.finished")} count={finished.length}>
                <List>
                  {finished.map((task) => (
                    <Row key={task.id} task={task} />
                  ))}
                </List>
              </Group>
            )}
          </div>

          <aside className="flex w-full flex-col gap-4 xl:w-[290px] xl:shrink-0">
            {canSendToDevice && <DevicePanel onManage={onOpenDevices} />}
            <ExtensionsPanel onManage={onOpenExtensions} />
          </aside>
        </div>
      </div>
    </div>
  );
}

function Group({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="flex items-center gap-2 type-heading">
        {title}
        <span className="rounded-full bg-sunken px-2 text-xs font-medium leading-5 text-text-secondary">
          {count}
        </span>
      </h2>
      {children}
    </section>
  );
}

function List({ children }: { children: React.ReactNode }) {
  return (
    <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-raised">
      {children}
    </div>
  );
}

/** The icon says what kind of work it is; colour says how it ended. */
function KindIcon({ task }: { task: Task }) {
  const Icon =
    task.kind === "build"
      ? Package
      : task.kind === "metadata"
        ? task.state === "done"
          ? Sparkles
          : BookPlus
        : Download;
  return (
    <span
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-lg",
        task.state === "done"
          ? "bg-success-soft text-success"
          : task.state === "cancelled"
            ? "bg-sunken text-text-tertiary"
            : "bg-sunken text-foreground",
      )}
    >
      {task.state === "cancelled" ? <CircleSlash className="size-4" /> : <Icon className="size-4" />}
    </span>
  );
}

function Row({ task, children }: { task: Task; children?: React.ReactNode }) {
  const t = useT();
  const running = task.state === "running";
  const detail =
    task.summary ??
    (task.state === "queued"
      ? t("tasks.waiting")
      : task.state === "cancelled"
        ? t("tasks.stopped")
        : task.detail);

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <KindIcon task={task} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-3">
          <p className="min-w-0 flex-1 truncate text-sm font-medium">{task.title}</p>
          {running && task.total > 0 && (
            <span className="shrink-0 font-mono text-xs text-text-secondary">
              {task.done} / {task.total}
            </span>
          )}
        </div>
        {running && task.total > 0 && (
          <Progress value={(task.done / task.total) * 100} className="my-1.5" />
        )}
        <p className="flex items-center gap-1.5 truncate text-xs text-text-secondary">
          {running && task.total === 0 && <Loader2 className="size-3 shrink-0 animate-spin" />}
          <span className="truncate">{detail}</span>
        </p>
      </div>
      {children}
    </div>
  );
}

function DevicePanel({ onManage }: { onManage: () => void }) {
  const t = useT();
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    sendConfig()
      .then((status) => setEmail(status.config.kindle_email.trim()))
      .catch(() => setEmail(""));
  }, []);
  if (email === null) return null;

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-raised p-4">
      <p className="type-overline">{t("tasks.defaultDevice")}</p>
      <p className="type-subtitle">{email ? "Kindle" : t("tasks.noDevice")}</p>
      <p className="truncate text-xs text-text-secondary">
        {email ? t("tasks.deviceDetail", { email }) : t("tasks.noDeviceDetail")}
      </p>
      <div className="mt-1">
        <Button variant="outline" size="sm" onClick={onManage}>
          {email ? t("tasks.manage") : t("tasks.setUp")}
        </Button>
      </div>
    </div>
  );
}

function ExtensionsPanel({ onManage }: { onManage: () => void }) {
  const t = useT();
  const [sources, setSources] = useState<SourceInfo[] | null>(null);
  useEffect(() => {
    listSources()
      .then(setSources)
      .catch(() => setSources([]));
  }, []);
  if (!sources) return null;

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-raised p-4">
      <p className="type-overline">{t("tasks.extensions")}</p>
      <ul className="flex flex-col gap-1.5">
        {sources.map((source) => (
          <li key={source.id} className="flex items-center gap-2 text-xs">
            <span className="size-1.5 shrink-0 rounded-full bg-success" />
            <span className="min-w-0 flex-1 truncate font-medium">{source.name}</span>
            <span className="shrink-0 text-text-secondary">
              {source.lang === "multi" || source.lang === "all"
                ? t("tasks.manyLanguages")
                : languageName(source.lang)}
            </span>
          </li>
        ))}
      </ul>
      <div>
        <Button variant="ghost" size="sm" className="-ml-3" onClick={onManage}>
          {t("tasks.manageExtensions")}
        </Button>
      </div>
    </div>
  );
}
