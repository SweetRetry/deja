// Where every tile sits on the wall, and which tile an arrow key lands on.
// Pure and alias-free so `node --test` runs it as is.
import type { Entry } from "../../lib/types.ts";

export const GAP = 16;
/** The scroll box's padding around the tiles: `x` on each side, `top` under the toolbar. */
export const WALL_PAD = { x: 24, top: 64 };
export const CAPTION_HEIGHT = 24;
const MIN_HEIGHT = 48;

/** A tile's box in wall coordinates; `height` is the picture, the caption sits below it. */
export type Placed = { entry: Entry; x: number; y: number; width: number; height: number };

export type Direction = "left" | "right" | "up" | "down";

type Options = {
  /** Usable width of the wall, padding excluded. */
  width: number;
  /** Column width the user asked for; columns stretch to fill the row. */
  cell: number;
  /** Square tiles in rows (grid) instead of each file's own aspect (masonry). */
  uniform: boolean;
  caption: number;
  /** Tiles that start a band of their own, below every column: one per group of copies. */
  breaks?: ReadonlySet<string>;
};

function aspectOf(entry: Entry): number {
  if (entry.width && entry.height && entry.width > 0 && entry.height > 0) return entry.width / entry.height;
  return 1;
}

/** How many columns of at least `cell` fit in `width` with GAP between them,
 *  and how wide each is once they stretch to fill it. */
export function columnsFor(width: number, cell: number): { columns: number; side: number } {
  const columns = Math.max(1, Math.floor((width + GAP) / (cell + GAP)));
  return { columns, side: (width - GAP * (columns - 1)) / columns };
}

/** Waterfall: shortest column first, height from the file's own aspect ratio.
 *  Column width stays fractional so the wall fills the row and both margins match.
 *  Square tiles all have one height, so the same rule fills rows left to right. */
export function layout(
  entries: Entry[],
  { width, cell, uniform, caption, breaks }: Options,
): { placed: Placed[]; height: number } {
  const { columns, side } = columnsFor(width, cell);
  const columnWidth = side || cell;
  const heights = new Array<number>(columns).fill(0);
  const placed: Placed[] = [];
  for (const entry of entries) {
    if (placed.length > 0 && breaks?.has(entry.relPath)) {
      // A band's gap is twice a tile's, so the eye reads where a group ends.
      heights.fill(Math.max(...heights) + GAP);
    }
    let column = 0;
    for (let index = 1; index < columns; index += 1) {
      if ((heights[index] ?? 0) < (heights[column] ?? 0) - 1) column = index;
    }
    const height = Math.max(MIN_HEIGHT, Math.round(columnWidth / (uniform ? 1 : aspectOf(entry))));
    const y = heights[column] ?? 0;
    placed.push({ entry, x: column * (columnWidth + GAP), y, width: columnWidth, height });
    heights[column] = y + height + caption + GAP;
  }
  return { placed, height: Math.max(0, ...heights) };
}

/** The tile an arrow key moves to: left and right walk the result order, up
 *  and down stay in the column under the tile's centre. Null at an edge. */
export function neighbor(placed: Placed[], relPath: string, direction: Direction): string | null {
  const index = placed.findIndex((tile) => tile.entry.relPath === relPath);
  const current = placed[index];
  if (!current) return null;
  if (direction === "left" || direction === "right") {
    return placed[direction === "left" ? index - 1 : index + 1]?.entry.relPath ?? null;
  }
  const centre = current.x + current.width / 2;
  let best: Placed | null = null;
  for (const tile of placed) {
    if (centre < tile.x || centre >= tile.x + tile.width) continue;
    const ahead = direction === "up" ? tile.y < current.y : tile.y > current.y;
    if (!ahead) continue;
    if (!best || (direction === "up" ? tile.y > best.y : tile.y < best.y)) best = tile;
  }
  return best?.entry.relPath ?? null;
}

const ARROWS: Partial<Record<string, Direction>> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};

/** Where a navigation key moves the selection from `origin`: undefined when
 *  the key does not navigate, null at an edge. An origin off the wall starts
 *  from the first tile. */
export function step(placed: Placed[], origin: string | null, key: string): string | null | undefined {
  if (key === "Home") return placed[0]?.entry.relPath ?? null;
  if (key === "End") return placed.at(-1)?.entry.relPath ?? null;
  const direction = ARROWS[key];
  if (!direction) return undefined;
  const onWall = origin !== null && placed.some((tile) => tile.entry.relPath === origin);
  return onWall ? neighbor(placed, origin, direction) : (placed[0]?.entry.relPath ?? null);
}
