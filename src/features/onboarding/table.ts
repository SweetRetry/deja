// Where the welcome table puts its prints. Pure, so the geometry can be
// asserted without rendering.
import { columnsFor, GAP, WALL_PAD } from "../wall/layout.ts";

/** A print's place in the stack: offsets in units of the stack's spread, and a tilt in degrees. */
export type Spot = { dx: number; dy: number; rotate: number };

export type Size = { width: number; height: number };

/** A print's frame, around a photo `photoWidth` wide: thin on three sides, a caption strip below. */
export const FRAME = { side: 10, top: 10, bottom: 36 };

/** Landscape photos print wider than square ones, so both read at a similar size. */
export const photoWidth = (ratio: number) => (ratio > 1.2 ? 210 : 160);

/**
 * The stack sits right of center. Its spread shrinks with the window and never
 * reaches the copy, which takes the left 45%: a print sticks out about 125px
 * past its center, and the outermost sit one spread out.
 */
export function stack({ width, height }: Size) {
  const x = Math.round(width * 0.69);
  return { x, y: Math.round(height * 0.52), spread: Math.round(Math.min(height * 0.3, 240, x - width * 0.45 - 125)) };
}

export function home(spot: Spot, size: Size) {
  const { x, y, spread } = stack(size);
  return { x: x + spot.dx * spread, y: y + spot.dy * spread, rotate: spot.rotate };
}

/** A thrown print still counts as part of the stack while it lands within reach of it. */
export function inStack(point: { x: number; y: number }, size: Size) {
  const { x, y, spread } = stack(size);
  return Math.hypot(point.x - x, point.y - y) < spread * 1.4;
}

/**
 * The center and side of the wall skeleton's `index`th square, in the wall's
 * scroll box: inside WALL_PAD, GAP apart, columns of at least `cell`.
 * The prints land here as the folder opens.
 */
export function skeletonSlot(index: number, { width, cell }: { width: number; cell: number }) {
  const { columns, side } = columnsFor(width - 2 * WALL_PAD.x, cell);
  const column = index % columns;
  const row = Math.floor(index / columns);
  return {
    x: WALL_PAD.x + column * (side + GAP) + side / 2,
    y: WALL_PAD.top + row * (side + GAP) + side / 2,
    side,
  };
}

/** Every skeleton slot that shows on a table of this size. */
export function skeletonSlots(size: Size, cell: number) {
  const slots = [];
  for (let index = 0; ; index++) {
    const slot = skeletonSlot(index, { width: size.width, cell });
    if (slot.y - slot.side / 2 > size.height) return slots;
    slots.push(slot);
  }
}
