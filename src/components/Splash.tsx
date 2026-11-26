import { LogoMark } from "@/components/Logo";
import { useT } from "@/lib/i18n";

/**
 * What the window shows while settings are still being read — the moment
 * before the first real screen (Figma "01 · Abertura"). It used to be blank,
 * which on a slow disk looked like the app had failed to start.
 */
export function Splash() {
  const t = useT();
  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center gap-5 bg-ink">
      <div className="flex items-center gap-4" role="img" aria-label="Leaf">
        <LogoMark width={120} className="max-sm:w-20" />
        <span className="font-brand text-[72px] font-medium leading-none tracking-[0.04em] text-on-ink max-sm:text-5xl">
          leaf
        </span>
      </div>
      <p className="text-sm text-on-ink-muted">{t("app.tagline")}</p>
      <div className="h-1 w-[200px] overflow-hidden rounded-full bg-ink-raised">
        <div className="h-full w-2/5 animate-[splash_1.2s_ease-in-out_infinite] rounded-full bg-deliver" />
      </div>
      <p className="text-xs text-on-ink-muted">{t("app.opening")}</p>
    </div>
  );
}
