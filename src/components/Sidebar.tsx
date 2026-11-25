import { useEffect, useState } from "react";
import { BookOpen, ChevronRight, Compass, ListChecks, Settings } from "lucide-react";

import type { UpdateStage } from "@/hooks/useUpdater";
import { LogoMark } from "@/components/Logo";
import { useT } from "@/lib/i18n";
import type { Translator } from "@/lib/i18n/types";
import { canSendToDevice } from "@/lib/platform";
import { sendConfig } from "@/lib/send";
import { cn } from "@/lib/utils";

/**
 * Top-level destinations. A series, the editor and history all live under the
 * shelf; devices and extensions are pages of Settings.
 */
export type Section = "library" | "explore" | "tasks" | "settings";

/**
 * Where the app's navigation sits.
 *
 * `rail` is the desktop column. `bar` is the phone's bottom row, which is not
 * the same control turned sideways: a thumb reaches the bottom of a phone and
 * nothing else, so the items get wider targets and always-on labels.
 */
export type NavVariant = "rail" | "bar";

interface SidebarProps {
  active: Section;
  onNavigate: (to: Section) => void;
  /** Opens Settings on the Devices page, from the export card. */
  onOpenDevices: () => void;
  updateStage: UpdateStage;
  /** Queued and running tasks — the badge on Tasks. */
  activeTasks: number;
  variant?: NavVariant;
}

interface Destination {
  section: Section;
  icon: React.ReactNode;
  label: string;
}

/** Settings is apart from these: it sits at the bottom of the rail. */
function primary(t: Translator): Destination[] {
  return [
    { section: "library", icon: <BookOpen />, label: t("sidebar.library") },
    { section: "explore", icon: <Compass />, label: t("sidebar.explore") },
    { section: "tasks", icon: <ListChecks />, label: t("sidebar.tasks") },
  ];
}

/**
 * The app's navigation.
 *
 * The rail is ink on paper — the chrome is the one dark thing in a light
 * window — with Settings and the default device at its foot. Below `lg` it
 * folds to icons, because the volume editor wants the width more than the
 * labels do; there is no toggle, the window size decides.
 */
export function Sidebar({
  active,
  onNavigate,
  onOpenDevices,
  updateStage,
  activeTasks,
  variant = "rail",
}: SidebarProps) {
  const t = useT();
  // A pip on Settings rather than an entry of its own: updates live on the
  // General page now, and there is only ever one to take.
  const updatePip = updateStage === "available" || updateStage === "installed";

  if (variant === "bar") {
    const all: Destination[] = [
      ...primary(t),
      { section: "settings", icon: <Settings />, label: t("sidebar.settings") },
    ];
    return (
      <nav
        className="flex shrink-0 items-stretch border-t border-white/5 bg-ink text-on-ink-muted"
        // Android's gesture bar is already padded around by the activity; this
        // is for a platform that reports it to CSS instead, and is zero here.
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {all.map((d) => (
          <button
            key={d.section}
            onClick={() => onNavigate(d.section)}
            aria-label={d.label}
            aria-current={active === d.section ? "page" : undefined}
            className={cn(
              "flex min-w-0 flex-1 flex-col items-center justify-center gap-1 pb-2 pt-2.5 text-[11px] font-medium transition-colors",
              active === d.section ? "text-on-ink" : "text-on-ink-muted",
            )}
          >
            <span
              className={cn(
                "relative flex h-7 w-14 items-center justify-center rounded-full transition-colors [&_svg]:size-[18px]",
                active === d.section && "bg-ink-raised",
              )}
            >
              {d.icon}
              {d.section === "tasks" && activeTasks > 0 && (
                <span className="absolute -top-1 right-1.5 rounded-full bg-deliver px-1.5 text-[10px] leading-4 text-on-deliver">
                  {activeTasks}
                </span>
              )}
              {d.section === "settings" && updatePip && (
                <span className="absolute right-3.5 top-0.5 size-1.5 rounded-full bg-deliver" />
              )}
            </span>
            <span className="max-w-full truncate">{d.label}</span>
          </button>
        ))}
      </nav>
    );
  }

  return (
    <nav className="flex w-[72px] shrink-0 flex-col gap-1 bg-ink px-3 pb-4 pt-5 text-on-ink-muted lg:w-[232px] lg:px-4">
      <div className="flex items-center gap-2.5 px-1 pb-5 max-lg:justify-center">
        <LogoMark width={44} title="Leaf" />
        <span className="font-brand text-[28px] font-medium leading-none tracking-[0.04em] text-on-ink max-lg:hidden">
          leaf
        </span>
      </div>

      {primary(t).map((d) => (
        <Item
          key={d.section}
          {...d}
          active={active === d.section}
          onClick={() => onNavigate(d.section)}
          count={d.section === "tasks" ? activeTasks : 0}
        />
      ))}

      <div className="flex-1" />

      <Item
        section="settings"
        icon={<Settings />}
        label={t("sidebar.settings")}
        active={active === "settings"}
        onClick={() => onNavigate("settings")}
        pip={updatePip}
      />
      {canSendToDevice && <DeviceCard onClick={onOpenDevices} />}
    </nav>
  );
}

function Item({
  icon,
  label,
  active,
  count = 0,
  pip = false,
  onClick,
}: Destination & {
  active: boolean;
  count?: number;
  pip?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      // Folded to icons, the label is the only thing naming the control.
      title={label}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex h-10 items-center gap-3 rounded-[10px] px-3 text-sm font-medium transition-colors max-lg:justify-center [&_svg]:size-4 [&_svg]:shrink-0",
        active ? "bg-ink-raised text-on-ink" : "hover:bg-ink-raised hover:text-on-ink",
      )}
    >
      {icon}
      <span className="flex-1 truncate text-left max-lg:hidden">{label}</span>
      {count > 0 && (
        <span className="rounded-full bg-deliver px-[7px] text-xs leading-4 text-on-deliver max-lg:absolute max-lg:right-1 max-lg:top-1 max-lg:px-1 max-lg:text-[10px]">
          {count}
        </span>
      )}
      {pip && <span className="absolute left-6 top-2.5 size-1.5 rounded-full bg-deliver" />}
    </button>
  );
}

/**
 * Where a built volume goes by default — the design's "Export to" card.
 *
 * There is one device today, the Kindle address mail is sent to; the card
 * names it, or invites setting it up, and opens Devices either way.
 */
function DeviceCard({ onClick }: { onClick: () => void }) {
  const t = useT();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    sendConfig()
      .then((status) => setEmail(status.config.kindle_email.trim() || ""))
      .catch(() => setEmail(""));
  }, []);

  if (email === null) return null;
  return (
    <button
      onClick={onClick}
      className="flex flex-col gap-1.5 rounded-xl bg-ink-raised p-3 text-left max-lg:hidden"
    >
      <span className="font-mono text-[11px] font-medium uppercase leading-[14px] tracking-[0.06em]">
        {t("sidebar.exportTo")}
      </span>
      <span className="flex w-full items-center gap-1.5 text-xs font-medium text-on-ink">
        <span className="min-w-0 flex-1 truncate">
          {email ? t("sidebar.kindle") : t("sidebar.noDevice")}
        </span>
        <ChevronRight className="size-3.5 shrink-0" />
      </span>
      <span className="truncate text-xs" title={email || undefined}>
        {email ? t("sidebar.byEmail", { email }) : t("sidebar.setUpDevice")}
      </span>
    </button>
  );
}
