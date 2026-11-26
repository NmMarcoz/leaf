import { Loader2, X } from "lucide-react";
import type * as React from "react";

import { useT } from "@/lib/i18n";
import { languageName } from "@/lib/api";
import { isMobile } from "@/lib/platform";
import { readerFits, readerModes, type ReaderPrefs } from "@/lib/reader";
import { cn } from "@/lib/utils";

interface ReaderSettingsProps {
  /** Every translation the source has, or empty when there is nothing to pick. */
  translations: string[];
  language: string;
  switching: boolean;
  onLanguage: (code: string) => void;
  prefs: ReaderPrefs;
  /** What the series itself says, shown as the "Auto" option. */
  seriesDirection: string;
  onChange: (patch: Partial<ReaderPrefs>) => void;
  onClose: () => void;
  className?: string;
}

/**
 * Reader preferences, over the page rather than on another screen.
 *
 * Every one of these is something you change *while* reading and want to see
 * the effect of immediately — a mode that suits one series is wrong for the
 * next. They are stored client-side because they are chrome, not library data.
 *
 * Drawn in ink whatever the app theme (Figma "14 · Leitor · ajustes"): it
 * floats over the page being read, and a paper-coloured panel there flashes.
 * The selected option is the one thing in paper, so it reads at a glance.
 */
export function ReaderSettings({
  prefs,
  seriesDirection,
  translations,
  language,
  switching,
  onLanguage,
  onChange,
  onClose,
  className,
}: ReaderSettingsProps) {
  const t = useT();
  const autoArrow = seriesDirection === "right-to-left" ? "←" : "→";

  return (
    <aside
      className={cn(
        "flex max-h-[calc(100dvh-2.5rem)] w-[340px] flex-col overflow-hidden rounded-[18px] bg-ink-raised text-on-ink shadow-[0_16px_40px_rgba(0,0,0,0.4)]",
        className,
      )}
    >
      <div className="flex shrink-0 items-center gap-2 px-5 pb-1 pt-5">
        <h2 className="type-subtitle flex-1">{t("readerSettings.title")}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("readerSettings.close")}
          className="-m-1.5 rounded-full p-1.5 text-on-ink-muted transition-colors hover:bg-ink hover:text-on-ink"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="scrollbar-none flex min-h-0 flex-col gap-4 overflow-y-auto px-5 pb-5 pt-3">
        {/* Only when there is a choice. Swapping keeps the chapter and the page
            and changes nothing but which images are fetched. */}
        {translations.length > 1 && (
          <Section title={t("readerSettings.translation")}>
            <div className="flex items-center gap-2">
              <select
                value={language}
                disabled={switching}
                onChange={(e) => onLanguage(e.target.value)}
                className="h-9 min-w-0 flex-1 rounded-[10px] border-0 bg-ink px-3 text-sm text-on-ink disabled:opacity-50"
              >
                {translations.map((code) => (
                  <option key={code} value={code} className="bg-ink">
                    {languageName(code, t)}
                  </option>
                ))}
              </select>
              {switching && <Loader2 className="size-3.5 animate-spin text-on-ink-muted" />}
            </div>
            <p className="text-xs text-on-ink-muted">{t("readerSettings.translationHint")}</p>
          </Section>
        )}

        <Section title={t("readerSettings.layout")}>
          <div role="radiogroup" className="flex flex-col gap-1.5">
            {readerModes(t).map((mode) => (
              <button
                key={mode.value}
                type="button"
                role="radio"
                aria-checked={prefs.mode === mode.value}
                onClick={() => onChange({ mode: mode.value })}
                className={cn(
                  "flex w-full flex-col gap-px rounded-[10px] px-3 py-2.5 text-left transition-colors",
                  prefs.mode === mode.value ? "bg-on-ink" : "bg-ink hover:bg-ink/60",
                )}
              >
                <span
                  className={cn(
                    "text-sm font-medium",
                    prefs.mode === mode.value ? "text-ink" : "text-on-ink",
                  )}
                >
                  {mode.label}
                </span>
                <span
                  className={cn(
                    "text-xs",
                    prefs.mode === mode.value ? "text-ink/65" : "text-on-ink-muted",
                  )}
                >
                  {mode.detail}
                </span>
              </button>
            ))}
          </div>
        </Section>

        <Section title={t("readerSettings.fit")}>
          <Pills
            value={prefs.fit}
            onChange={(fit) => onChange({ fit })}
            options={readerFits(t).map((f) => [f.value, f.label])}
          />
        </Section>

        <Section title={t("readerSettings.direction")}>
          <Pills
            value={prefs.direction ?? "auto"}
            onChange={(d) => onChange({ direction: d === "auto" ? null : d })}
            options={[
              ["auto", t("readerSettings.directionAuto", { arrow: autoArrow })],
              ["right-to-left", t("readerSettings.directionOptionRightToLeft")],
              ["left-to-right", t("readerSettings.directionOptionLeftToRight")],
            ]}
          />
          <p className="text-xs text-on-ink-muted">{t("readerSettings.directionHint")}</p>
        </Section>

        <Section title={t("readerSettings.background")}>
          <Pills
            value={prefs.background}
            onChange={(background) => onChange({ background })}
            options={[
              ["black", t("readerSettings.backgroundBlack")],
              ["grey", t("readerSettings.backgroundGrey")],
              ["white", t("readerSettings.backgroundWhite")],
            ]}
          />
        </Section>

        <Section title={t("readerSettings.animation")}>
          <Pills
            value={prefs.animation}
            onChange={(animation) => onChange({ animation })}
            options={[
              ["slide", t("readerSettings.animationSlide")],
              ["fade", t("readerSettings.animationFade")],
              ["none", t("readerSettings.animationNone")],
            ]}
          />
        </Section>

        {/* Keyboard shortcuts mean nothing on a phone; what the fingers do does. */}
        <p className="rounded-[10px] bg-ink px-3 py-2.5 text-xs text-on-ink-muted">
          {isMobile ? t("readerSettings.helpTouch") : t("readerSettings.help")}
        </p>
      </div>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="type-overline text-on-ink-muted">{title}</h3>
      {children}
    </section>
  );
}

/** A row of single-choice pills; the chosen one in paper, the rest in ink. */
function Pills<V extends string>({
  value,
  onChange,
  options,
}: {
  value: V;
  onChange: (value: V) => void;
  options: [V, string][];
}) {
  return (
    <div role="radiogroup" className="flex flex-wrap gap-1.5">
      {options.map(([option, label]) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          onClick={() => onChange(option)}
          className={cn(
            "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
            value === option
              ? "bg-on-ink text-ink"
              : "bg-ink text-on-ink hover:bg-ink/60",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
