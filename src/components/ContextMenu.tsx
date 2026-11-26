import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface ContextMenuPosition {
  x: number;
  y: number;
}

interface ContextMenuProps {
  /** Where the right-click happened, in viewport coordinates. */
  at: ContextMenuPosition;
  onClose: () => void;
  children: ReactNode;
}

/**
 * A menu anchored at the pointer.
 *
 * Hand-rolled rather than pulled in as a dependency: the whole requirement is
 * "appear here, close on Escape or a click elsewhere", and the one subtlety —
 * not hanging off the edge of the window — is a few lines.
 */
export function ContextMenu({ at, onClose, children }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState(at);

  // Measure after mount so a menu opened near the right or bottom edge flips
  // back inside the window instead of being clipped.
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const { width, height } = node.getBoundingClientRect();
    setPosition({
      x: Math.min(at.x, window.innerWidth - width - 8),
      y: Math.min(at.y, window.innerHeight - height - 8),
    });
  }, [at]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // `pointerdown` rather than `click`, so the menu is gone before whatever
    // was underneath reacts to the press.
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={{ left: position.x, top: position.y }}
      className="fixed z-50 flex min-w-56 flex-col overflow-hidden rounded-xl border border-line bg-raised p-1 text-foreground shadow-xl"
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </div>
  );
}

export function ContextMenuItem({
  onSelect,
  disabled,
  hint,
  children,
}: {
  onSelect: () => void;
  disabled?: boolean;
  /** Right-aligned secondary text, e.g. a count or a shortcut. */
  hint?: string;
  children: ReactNode;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex h-9 w-full shrink-0 items-center gap-3 rounded-lg px-3 text-left text-sm transition-colors",
        disabled
          ? "cursor-not-allowed opacity-45"
          : "hover:bg-hover",
      )}
    >
      <span className="flex-1 truncate">{children}</span>
      {hint && <span className="shrink-0 font-mono text-[11px] text-text-tertiary">{hint}</span>}
    </button>
  );
}

export function ContextMenuSeparator() {
  return <div className="-mx-1 my-1 h-px shrink-0 bg-line" />;
}
