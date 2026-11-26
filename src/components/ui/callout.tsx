import * as React from "react";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * An inline message inside a dialog or panel — the Figma "Callout".
 *
 * `info` is a neutral note, `warning` an amber state the user can fix,
 * `success` a confirmation, `destructive` a consequence that cannot be undone.
 */
export type CalloutTone = "info" | "warning" | "success" | "destructive";

const TONE: Record<CalloutTone, { box: string; icon: string; Icon: typeof Info }> = {
  info: { box: "bg-info-soft", icon: "text-info", Icon: Info },
  warning: { box: "bg-warning-soft", icon: "text-warning", Icon: AlertTriangle },
  success: { box: "bg-success-soft", icon: "text-success", Icon: CheckCircle2 },
  destructive: { box: "bg-danger-soft", icon: "text-danger", Icon: AlertTriangle },
};

export function Callout({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: CalloutTone;
  title?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  const { box, icon, Icon } = TONE[tone];
  return (
    <div className={cn("flex gap-3 rounded-xl px-4 py-3", box, className)}>
      <Icon className={cn("mt-px size-4 shrink-0", icon)} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-xs">
        {title && <p className="font-medium text-foreground">{title}</p>}
        {children && <div className="leading-4 text-text-secondary">{children}</div>}
      </div>
    </div>
  );
}
