import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The building blocks of every settings page, from Figma 17 · Configurações:
 * a mono overline over a raised card of rows, each row a title and a line of
 * explanation on the left with its control on the right.
 */
export function SettingsSection({
  title,
  children,
  className,
}: {
  title?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-2.5", className)}>
      {title && <h2 className="type-overline">{title}</h2>}
      <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-raised">
        {children}
      </div>
    </section>
  );
}

export function SettingsRow({
  title,
  description,
  children,
  htmlFor,
  stack = false,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** The control: a switch, a select, a button or two. */
  children?: React.ReactNode;
  /** Makes the whole text a label for the control, so a tap anywhere toggles it. */
  htmlFor?: string;
  /** Put the control under the text rather than beside it — for wide controls. */
  stack?: boolean;
  className?: string;
}) {
  const Text = htmlFor ? "label" : "div";
  return (
    <div
      className={cn(
        "flex gap-x-4 gap-y-3 px-4 py-3.5 sm:px-5",
        stack ? "flex-col" : "items-center max-sm:flex-wrap",
        className,
      )}
    >
      <Text
        htmlFor={htmlFor}
        className={cn("min-w-0 flex-1", htmlFor && "cursor-pointer")}
      >
        <span className="block text-sm font-medium">{title}</span>
        {description && (
          <span className="mt-0.5 block text-xs leading-4 text-text-secondary">{description}</span>
        )}
      </Text>
      {children && (
        <div
          className={cn(
            "flex shrink-0 items-center gap-2 max-sm:min-w-0 max-sm:max-w-full",
            stack && "w-full",
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/** A path, shown the way the design does: mono, in a sunken well. */
export function PathWell({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      title={title}
      className="min-w-0 max-w-[260px] truncate rounded-md border border-line bg-sunken px-2.5 py-1.5 text-left font-mono text-xs enabled:hover:border-line-strong max-sm:max-w-full"
      data-selectable
    >
      {children}
    </button>
  );
}

/** The right-hand column every settings page shares: title, status, scroll. */
export function Pane({
  title,
  status,
  children,
}: {
  title: string;
  status?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
      <div className="flex max-w-[800px] flex-col gap-6 px-5 pb-10 pt-5 md:px-9 md:pt-10">
        <header className="flex items-center gap-4">
          <h2 className="type-subtitle flex-1">{title}</h2>
          {status}
        </header>
        {children}
      </div>
    </div>
  );
}
