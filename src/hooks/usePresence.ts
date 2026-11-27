import { useEffect, useState } from "react";

/**
 * Keep something mounted long enough to animate out.
 *
 * `mounted` stays true for `exitMs` after `open` goes false, with `leaving`
 * set meanwhile, so the caller can swap its entry class for an exit one.
 * A timer rather than `animationend`: under reduced motion the animation is
 * removed outright and never ends, and the element must still go.
 */
export function usePresence(open: boolean, exitMs: number): { mounted: boolean; leaving: boolean } {
  const [leaving, setLeaving] = useState(false);
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setLeaving(false);
      return;
    }
    if (!mounted) return;
    setLeaving(true);
    const timer = window.setTimeout(() => {
      setLeaving(false);
      setMounted(false);
    }, exitMs);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, exitMs]);

  // Leaving from the very render `open` drops, not one effect later: a frame
  // still carrying the entry class would be a frame of nothing happening.
  return { mounted: open || mounted, leaving: !open && (mounted || leaving) };
}
