import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/** Height of one row, in CSS pixels (Figma "Chapter picker": 40). */
const ROW = 40;
/** Rows visible at once. */
const VISIBLE = 5;
/** Rows between the middle of the viewport and either edge. */
const HALF = (VISIBLE - 1) / 2;
/** How far round the drum one row sits. 20° puts the outer rows near edge-on,
 * which is what makes the wheel read as a cylinder rather than a list. */
const STEP_DEG = 20;
/** The drum's radius, from the row height and the angle one row spans. */
const RADIUS = ROW / 2 / Math.tan(((STEP_DEG / 2) * Math.PI) / 180);
/** How many rows of stretch the ends give at most when pulled past. */
const STRETCH = 1.6;
/** Spring that settles the wheel on a row: critically damped, so it lands
 * without wobbling — except when a fling carries it past an end, where the
 * velocity it arrives with is the bounce. */
const STIFFNESS = 180;
const DAMPING = 2 * Math.sqrt(STIFFNESS);
/** How far a fling carries, as seconds of its release velocity (iOS uses a
 * deceleration whose time constant is about this). */
const MOMENTUM = 0.3;
/** Pixels a press may wander before it is a drag rather than a click. */
const SLOP = 5;

/**
 * Pulled past an end, the wheel stretches less the further it goes — the
 * iOS rubber band. `x` is how far past, in rows; the result never reaches
 * `STRETCH`, so a long pull feels like a spring tightening, not a wall.
 */
function band(x: number): number {
  return (1 - 1 / ((x * 0.55) / STRETCH + 1)) * STRETCH;
}

function rubber(raw: number, lo: number, hi: number): number {
  if (raw < lo) return lo - band(lo - raw);
  if (raw > hi) return hi + band(raw - hi);
  return raw;
}

const clamp = (value: number, lo: number, hi: number) => Math.min(Math.max(value, lo), hi);

export interface WheelPickerProps {
  /** What each row says, in order. */
  labels: string[];
  /** The row that is "here" — highlighted, and the one the list opens on. */
  current: number;
  /** A row was chosen: clicked, or Enter on the keyboard's row. */
  onPick: (index: number) => void;
  /** Escape. */
  onCancel?: () => void;
  ariaLabel: string;
  className?: string;
}

/**
 * A drum of rows that turns under the finger, like an iPhone picker.
 *
 * Drawn here rather than left to native scrolling, for the two things the
 * design asks of it that no engine's scroller does on every platform: the
 * rows turn round a cylinder as they move off-centre, and pulling past either
 * end stretches and springs back instead of stopping dead. Desktop WebKitGTK
 * and Chrome on Windows have no overscroll bounce at all.
 *
 * Only the rows near the centre are rendered, so a series with a few hundred
 * chapters costs the same as one with ten.
 *
 * At rest the list sits flush against its ends, as an iOS list does: the
 * first chapter fills the top row, not the middle one with blank rows above
 * it. The blank only shows while the list is pulled past an end — that is
 * the stretch — and the spring takes it away again on release.
 *
 * Any row opens with a click. A press that lands on a list still coasting
 * only stops it, as on iOS, so catching a fling never opens what happened to
 * be passing under the finger.
 */
export function WheelPicker({
  labels,
  current,
  onPick,
  onCancel,
  ariaLabel,
  className,
}: WheelPickerProps) {
  const last = Math.max(0, labels.length - 1);
  // `offset` is the row under the middle of the viewport. It rests between
  // `lo` and `hi`, which put the first row in the top slot and the last in
  // the bottom one. A list shorter than the viewport just sits centred.
  const lo = Math.min(HALF, last / 2);
  const hi = Math.max(last - HALF, last / 2);
  const [offset, setOffset] = useState(() => clamp(current, lo, hi));
  /** The row the keyboard is on; starts on the current one. */
  const [active, setActive] = useState(() => clamp(current, 0, last));
  /** Whether the keyboard is driving, which is when the active row shows. */
  const [keyboard, setKeyboard] = useState(false);

  // Physics lives in refs: it changes every frame and only `offset` paints.
  const pos = useRef(offset);
  const vel = useRef(0);
  const target = useRef<number | null>(null);
  const frame = useRef(0);
  const lastTime = useRef(0);
  const viewport = useRef<HTMLDivElement | null>(null);

  const reducedMotion = useRef(
    typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  const paint = useCallback((value: number) => {
    pos.current = value;
    setOffset(value);
  }, []);

  const stop = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
  }, []);

  const step = useCallback(
    (now: number) => {
      const goal = target.current;
      if (goal === null) return;
      // A frame's timestamp is when the frame began, which can be just before
      // the `performance.now()` that queued it: never step backwards in time.
      const dt = clamp((now - lastTime.current) / 1000, 0.001, 0.032);
      lastTime.current = now;
      const accel = -STIFFNESS * (pos.current - goal) - DAMPING * vel.current;
      vel.current += accel * dt;
      const next = pos.current + vel.current * dt;
      if (Math.abs(next - goal) < 0.002 && Math.abs(vel.current) < 0.02) {
        vel.current = 0;
        target.current = null;
        frame.current = 0;
        paint(goal);
        return;
      }
      paint(next);
      frame.current = requestAnimationFrame(step);
    },
    [paint],
  );

  /** Turn to a row, carrying whatever velocity the wheel already has. */
  const animateTo = useCallback(
    (index: number, kick = 0) => {
      const goal = clamp(Math.round(index), lo, hi);
      if (reducedMotion.current) {
        stop();
        vel.current = 0;
        target.current = null;
        paint(goal);
        return;
      }
      target.current = goal;
      vel.current += kick;
      if (!frame.current) {
        lastTime.current = performance.now();
        frame.current = requestAnimationFrame(step);
      }
    },
    [lo, hi, paint, step, stop],
  );

  /** Let go at `velocity` rows/second: coast, then land on the nearest row. */
  const release = useCallback(
    (velocity: number) => {
      vel.current = clamp(velocity, -40, 40);
      animateTo(pos.current + vel.current * MOMENTUM);
    },
    [animateTo],
  );

  useEffect(() => stop, [stop]);

  /* --------------------------------------------------------------- wheel */

  // Non-passive, so the page behind never scrolls along with the wheel.
  const wheelRaw = useRef<number | null>(null);
  const wheelIdle = useRef(0);
  useEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      // A mouse wheel moves in notches of 120 "wheel units"; a trackpad
      // streams small deltas. A notch is one row — scrolling a 100px notch
      // as 2.5 rows would skip chapters — and a trackpad is followed exactly.
      const legacy = (event as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY ?? 0;
      const notch =
        event.deltaMode !== 0 || (Math.abs(event.deltaY) >= 50 && legacy !== 0 && legacy % 120 === 0);
      if (notch) {
        wheelRaw.current = null;
        const direction = Math.sign(event.deltaY);
        const from = target.current ?? Math.round(pos.current);
        const to = from + direction;
        // Past an end, the notch still lands — as a nudge that springs back.
        animateTo(to, to < lo || to > hi ? direction * 6 : 0);
        return;
      }
      stop();
      target.current = null;
      vel.current = 0;
      wheelRaw.current = (wheelRaw.current ?? pos.current) + event.deltaY / ROW;
      paint(rubber(wheelRaw.current, lo, hi));
      window.clearTimeout(wheelIdle.current);
      wheelIdle.current = window.setTimeout(() => {
        wheelRaw.current = null;
        animateTo(pos.current);
      }, 90);
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      node.removeEventListener("wheel", onWheel);
      window.clearTimeout(wheelIdle.current);
    };
  }, [animateTo, lo, hi, paint, stop]);

  /* ---------------------------------------------------------------- drag */

  const drag = useRef<{
    id: number;
    y: number;
    from: number;
    moved: boolean;
    samples: { t: number; raw: number }[];
  } | null>(null);
  /** Set when the press that just ended was a drag, or caught the list
   * coasting, so the click that follows it opens nothing. */
  const dragged = useRef(false);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    setKeyboard(false);
    const coasting = frame.current !== 0 && Math.abs(vel.current) > 2;
    stop();
    target.current = null;
    vel.current = 0;
    dragged.current = coasting;
    drag.current = {
      id: event.pointerId,
      y: event.clientY,
      from: pos.current,
      moved: false,
      samples: [{ t: event.timeStamp, raw: pos.current }],
    };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    const dy = event.clientY - current.y;
    if (!current.moved) {
      if (Math.abs(dy) < SLOP) return;
      // Captured only once it is a drag: capturing on press would send the
      // click to the viewport instead of the row that was pressed.
      current.moved = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    const raw = current.from - dy / ROW;
    current.samples.push({ t: event.timeStamp, raw });
    if (current.samples.length > 6) current.samples.shift();
    paint(rubber(raw, lo, hi));
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    drag.current = null;
    if (!current || current.id !== event.pointerId) return;
    // The click a press produces arrives straight after this, in the same
    // task; after that the flag must not linger. A drag captured on the list
    // delivers no click to a row at all, and a stale flag would swallow the
    // next real tap.
    window.setTimeout(() => {
      dragged.current = false;
    }, 0);
    if (!current.moved) {
      // A press that never moved: the row's own click decides. Settle when
      // the press caught the list between rows or out on its stretch.
      if (Math.abs(pos.current - clamp(Math.round(pos.current), lo, hi)) > 0.01) {
        animateTo(pos.current);
      }
      return;
    }
    dragged.current = true;
    // Velocity from the last ~100ms only: the start of a long drag says
    // nothing about how it was let go.
    const end = current.samples[current.samples.length - 1];
    const start = current.samples.find((s) => end.t - s.t <= 100) ?? current.samples[0];
    const seconds = (end.t - start.t) / 1000;
    release(seconds > 0 ? (end.raw - start.raw) / seconds : 0);
  };

  /* ------------------------------------------------------------ keyboard */

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    /** Move the keyboard's row, scrolling only as far as keeps it in view. */
    const go = (to: number) => {
      const next = clamp(to, 0, last);
      setKeyboard(true);
      setActive(next);
      const base = target.current ?? pos.current;
      if (to < 0 || to > last) {
        // Already at an end: a nudge into the stretch, sprung back.
        animateTo(base, Math.sign(to) * 6);
      } else if (next < base - HALF + 0.5 || next > base + HALF - 0.5) {
        animateTo(next < base ? next + HALF - 1 : next - HALF + 1);
      }
    };
    switch (event.key) {
      case "ArrowUp":
        go(active - 1);
        break;
      case "ArrowDown":
        go(active + 1);
        break;
      case "PageUp":
        go(Math.max(0, active - VISIBLE));
        break;
      case "PageDown":
        go(Math.min(last, active + VISIBLE));
        break;
      case "Home":
        go(0);
        break;
      case "End":
        go(last);
        break;
      case "Enter":
      case " ":
        onPick(active);
        break;
      case "Escape":
        onCancel?.();
        break;
      default:
        return;
    }
    // The reader listens on the window for the same keys — arrows turn pages,
    // Escape leaves — and none of them should while the wheel has focus.
    event.preventDefault();
    event.stopPropagation();
  };

  /* -------------------------------------------------------------- render */

  const rows: number[] = [];
  for (let i = Math.floor(offset) - 4; i <= Math.ceil(offset) + 4; i += 1) {
    if (i >= 0 && i <= last) rows.push(i);
  }

  return (
    <div
      ref={viewport}
      role="listbox"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-activedescendant={`wheel-row-${active}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      className={cn(
        "relative cursor-grab select-none overflow-hidden outline-none touch-none active:cursor-grabbing",
        className,
      )}
      style={{ height: ROW * VISIBLE, perspective: 1000 }}
    >
      <div
        className="absolute inset-x-0 top-1/2"
        style={{ transformStyle: "preserve-3d", transform: `translateZ(${-RADIUS}px)` }}
      >
        {rows.map((index) => {
          const angle = (index - offset) * STEP_DEG;
          if (Math.abs(angle) >= 90) return null;
          return (
            <button
              key={index}
              id={`wheel-row-${index}`}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={index === current}
              onClick={() => {
                if (dragged.current) {
                  dragged.current = false;
                  return;
                }
                onPick(index);
              }}
              className={cn(
                "absolute inset-x-1 flex h-10 items-center justify-center rounded-xl px-4 text-sm font-medium text-on-ink transition-colors [backface-visibility:hidden]",
                // Figma "Current chapter selection": the well turns with
                // its row rather than sitting fixed in the middle.
                index === current ? "bg-ink-pressed" : "hover:bg-ink/60",
                keyboard && index === active && "ring-1 ring-on-ink-muted",
              )}
              style={{
                top: -ROW / 2,
                transform: `rotateX(${-angle}deg) translateZ(${RADIUS}px)`,
                // Rows turning away dim, as the light on a drum would, but
                // never so far that the row at an end becomes hard to read.
                opacity: 0.4 + 0.6 * Math.cos((angle * Math.PI) / 180) ** 2,
              }}
            >
              <span className="truncate">{labels[index]}</span>
            </button>
          );
        })}
      </div>

      {/* Figma "Wheel top/bottom fade": the drum disappears into the panel
          where there is more list beyond the edge. At an end there is
          nothing past it, so the fade goes and the end row reads plainly. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-ink-raised via-ink-raised/60 via-50% to-transparent"
        style={{ opacity: clamp(offset - lo, 0, 1) }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-ink-raised via-ink-raised/60 via-50% to-transparent"
        style={{ opacity: clamp(hi - offset, 0, 1) }}
      />
    </div>
  );
}
