import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A panel that slides over the right edge, the page behind it dimmed and
 * blurred (Figma "16 · Descobrir · detalhe da série").
 *
 * A dialog underneath — focus trap, Esc, a click outside closes — shaped as a
 * sheet so the grid it was opened from stays in view. Full width on a phone,
 * where there is no "beside" to keep anything in view.
 *
 * The ink header is the caller's: `SheetHeader` draws the cover band and the
 * close button, the rest is free-form and scrolls between it and `SheetFooter`.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** For screen readers; the visible title is in the header. */
  title: string;
  children: React.ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-ink/25 backdrop-blur-[7px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 right-0 z-50 flex w-[440px] max-w-full flex-col overflow-hidden bg-raised shadow-[-12px_0_40px_rgba(0,0,0,0.2)] outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-right"
        >
          <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** The ink band: cover on the left, overline / title / byline beside it. */
export function SheetHeader({
  cover,
  overline,
  title,
  byline,
  closeLabel,
}: {
  cover: React.ReactNode;
  overline?: React.ReactNode;
  title: React.ReactNode;
  byline?: React.ReactNode;
  closeLabel: string;
}) {
  return (
    <div className="relative flex shrink-0 items-end gap-5 bg-ink p-7 text-on-ink max-sm:gap-4 max-sm:p-5">
      <div className="h-[180px] w-[120px] shrink-0 overflow-hidden rounded-lg bg-ink-raised max-sm:h-[150px] max-sm:w-[100px]">
        {cover}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1 pr-6">
        {overline && <p className="type-overline text-on-ink-muted">{overline}</p>}
        <h2 className="type-title line-clamp-3 break-words">{title}</h2>
        {byline && <p className="text-xs text-on-ink-muted">{byline}</p>}
      </div>
      <DialogPrimitive.Close
        aria-label={closeLabel}
        className="absolute right-5 top-5 rounded-full bg-ink-raised p-1.5 text-on-ink transition-colors hover:bg-ink-raised/70"
      >
        <X className="size-4" />
      </DialogPrimitive.Close>
    </div>
  );
}

export function SheetBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "scrollbar-thin flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-7 py-6 max-sm:px-5",
        className,
      )}
      {...props}
    />
  );
}

export function SheetFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex shrink-0 flex-col gap-2 border-t border-line px-7 py-5 max-sm:px-5",
        className,
      )}
      {...props}
    />
  );
}

/** One of the three figure tiles under the header: a number and what it counts. */
export function SheetStat({ value, label }: { value: React.ReactNode; label: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col rounded-[10px] bg-canvas px-3 py-2.5">
      <span className="type-subtitle truncate">{value}</span>
      <span className="truncate text-xs text-text-tertiary">{label}</span>
    </div>
  );
}
