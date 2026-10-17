import { useEffect, useRef, useState } from "react";
import { motion, type Transition } from "motion/react";
import { select } from "@/features/browse/commands";
import { thumbUrl } from "@/lib/bridge";
import type { Entry } from "@/lib/types";

/** Every other file is a narrow slice; the current one opens to its own shape, as in Photos on iOS. */
const HEIGHT = 40;
const SLICE = 20;
const GAP = 2;
/** The current file is never narrower than this, so a portrait still stands out. */
const MIN_CURRENT = 32;
/** The current file stands a little apart from its neighbours. */
const AROUND = 6;
/** Dragging or scrolling this far moves one file. */
const STEP = SLICE + GAP;
const SLIDE: Transition = { duration: 0.18, ease: "easeOut" };

function currentWidth(entry: Entry) {
  const ratio = entry.width && entry.height ? entry.width / entry.height : 1;
  return Math.min(Math.max(HEIGHT * ratio, MIN_CURRENT), HEIGHT * 2);
}

/** Left edge of file `i`, measured from the strip's centre, which the current file straddles. */
function offset(i: number, current: number, width: number) {
  if (i < current) return -width / 2 - AROUND - (current - i) * STEP + GAP;
  if (i === current) return -width / 2;
  return width / 2 + AROUND + (i - current - 1) * STEP;
}

/** The scrubber under the viewer: the wall in its order, centred on the open
 *  file. Click a slice to jump; drag or scroll across the strip to scrub. Only
 *  the slices in view render, so a library of thousands costs the same. */
export function Filmstrip({ entries, index }: { entries: Entry[]; index: number }) {
  const strip = useRef<HTMLDivElement>(null);
  const [span, setSpan] = useState(0);
  // Wheel and drag events can outrun a render, so they step from the latest target, not the prop.
  const target = useRef(index);
  target.current = index;
  const wheel = useRef(0);
  const drag = useRef<{ x: number; from: number; moved: boolean } | null>(null);

  useEffect(() => {
    const element = strip.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setSpan(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const go = (to: number) => {
    const clamped = Math.min(Math.max(to, 0), entries.length - 1);
    const entry = entries[clamped];
    if (!entry || clamped === target.current) return;
    target.current = clamped;
    select(entry.relPath, true);
  };

  const onWheel = (event: React.WheelEvent) => {
    wheel.current += Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    const steps = Math.trunc(wheel.current / STEP);
    if (steps === 0) return;
    wheel.current -= steps * STEP;
    go(target.current + steps);
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    drag.current = { x: event.clientX, from: target.current, moved: false };
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const state = drag.current;
    if (!state) return;
    const dx = event.clientX - state.x;
    if (!state.moved) {
      if (Math.abs(dx) < 4) return;
      // Captured only once it is a drag, so a plain press still clicks the slice under it.
      state.moved = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    go(state.from - Math.round(dx / STEP));
  };

  const onPointerEnd = () => {
    drag.current = null;
  };

  const current = entries[index];
  if (!current) return null;
  const width = currentWidth(current);
  const reach = Math.ceil(span / 2 / STEP) + 2;
  const first = Math.max(0, index - reach);

  const slices = entries.slice(first, index + reach + 1).map((entry, k) => {
    const i = first + k;
    const thumb = entry.indexed ? thumbUrl(entry) : "";
    return (
      <motion.button
        key={entry.relPath}
        type="button"
        // The arrows already step the viewer; the strip stays out of the tab order.
        tabIndex={-1}
        aria-label={entry.name}
        aria-current={i === index ? "true" : undefined}
        title={entry.name}
        data-testid="filmstrip-item"
        data-rel-path={entry.relPath}
        onClick={() => go(i)}
        initial={false}
        animate={{ x: offset(i, index, width), width: i === index ? width : SLICE }}
        transition={SLIDE}
        style={{ height: HEIGHT }}
        className="absolute top-0 left-1/2 overflow-hidden rounded-[3px] bg-surface-1 outline-none hover:brightness-110"
      >
        {thumb ? <img src={thumb} alt="" draggable={false} className="size-full object-cover" /> : null}
      </motion.button>
    );
  });

  return (
    <div
      ref={strip}
      role="group"
      aria-label="缩略图"
      data-testid="filmstrip"
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      style={{ height: HEIGHT }}
      className="relative w-full touch-none overflow-hidden select-none"
    >
      {slices}
    </div>
  );
}
