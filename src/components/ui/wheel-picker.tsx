import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/** Height of one row, in CSS pixels (Figma "Chapter picker": 40). */
const ROW = 40;
/** Rows visible at once; the middle one is the selection. */
const VISIBLE = 5;
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

function rubber(raw: number, last: number): number {
  if (raw < 0) return -band(-raw);
  if (raw > last) return last + band(raw - last);
  return raw;
}

const clamp = (value: number, lo: number, hi: number) => Math.min(Math.max(value, lo), hi);

export interface WheelPickerProps {
  /** What each row says, in order. */
  labels: string[];
  /** The row to start on. */
  initial: number;
  /** A row was chosen: clicked while centred, or Enter on the centred one. */
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
 * Choosing is two steps, as on iOS: a row is turned to the centre first, and
 * the centred row is the one a click opens. A click on any other row turns
 * the wheel to it, so a mis-tap never opens the wrong chapter.
 */
export function WheelPicker({
  labels,
  initial,
  onPick,
  onCancel,
  ariaLabel,
  className,
}: WheelPickerProps) {
  const last = Math.max(0, labels.length - 1);
  const [offset, setOffset] = useState(() => clamp(initial, 0, last));

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
      const goal = clamp(Math.round(index), 0, last);
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
    [last, paint, step, stop],
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

  const selected = clamp(Math.round(offset), 0, last);

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
        animateTo(to, to < 0 || to > last ? direction * 6 : 0);
        return;
      }
      stop();
      target.current = null;
      vel.current = 0;
      wheelRaw.current = (wheelRaw.current ?? pos.current) + event.deltaY / ROW;
      paint(rubber(wheelRaw.current, last));
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
  }, [animateTo, last, paint, stop]);

  /* ---------------------------------------------------------------- drag */

  const drag = useRef<{
    id: number;
    y: number;
    from: number;
    moved: boolean;
    samples: { t: number; raw: number }[];
  } | null>(null);
  /** Set when the press that just ended was a drag, so its click is ignored. */
  const dragged = useRef(false);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    stop();
    target.current = null;
    vel.current = 0;
    dragged.current = false;
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
    paint(rubber(raw, last));
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    drag.current = null;
    if (!current || current.id !== event.pointerId) return;
    if (!current.moved) {
      // A press that never moved: the row's own click decides. Settle only
      // when the press caught the wheel between rows, mid-turn.
      if (Math.abs(pos.current - Math.round(pos.current)) > 0.01) animateTo(pos.current);
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
    const from = target.current ?? selected;
    switch (event.key) {
      case "ArrowUp":
        animateTo(from - 1, from - 1 < 0 ? -6 : 0);
        break;
      case "ArrowDown":
        animateTo(from + 1, from + 1 > last ? 6 : 0);
        break;
      case "PageUp":
        animateTo(from - VISIBLE);
        break;
      case "PageDown":
        animateTo(from + VISIBLE);
        break;
      case "Home":
        animateTo(0);
        break;
      case "End":
        animateTo(last);
        break;
      case "Enter":
      case " ":
        onPick(selected);
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
      aria-activedescendant={`wheel-row-${selected}`}
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
      {/* The centred row's well, drawn behind the drum so the label turning
          through it stays legible. */}
      <div
        aria-hidden
        className="absolute inset-x-1 top-1/2 h-10 -translate-y-1/2 rounded-xl bg-ink-pressed"
      />

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
              aria-selected={index === selected}
              onClick={() => {
                if (dragged.current) {
                  dragged.current = false;
                  return;
                }
                // Centred and at rest: open it. Anything else turns to it.
                if (index === selected && Math.abs(pos.current - index) < 0.25) onPick(index);
                else animateTo(index);
              }}
              className="absolute inset-x-0 flex h-10 items-center justify-center px-4 text-sm font-medium text-on-ink [backface-visibility:hidden]"
              style={{
                top: -ROW / 2,
                transform: `rotateX(${-angle}deg) translateZ(${RADIUS}px)`,
                // Rows turning away also dim, as the light on a drum would.
                opacity: Math.max(0, Math.cos((angle * Math.PI) / 180)) ** 1.5,
              }}
            >
              <span className="truncate">{labels[index]}</span>
            </button>
          );
        })}
      </div>

      {/* Figma "Wheel top/bottom fade": the drum disappears into the panel
          instead of being cut off at a hard edge. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-ink-raised via-ink-raised/60 via-50% to-transparent"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-ink-raised via-ink-raised/60 via-50% to-transparent"
      />
    </div>
  );
}
