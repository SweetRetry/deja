import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { thumbUrl } from "../lib/bridge";
import type { Entry, SearchScore } from "../lib/types";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type Props = {
  entries: Entry[];
  scores: Record<string, SearchScore>;
  cell: number;
  mode: "masonry" | "grid";
  showNames: boolean;
  selected: string | null;
  onSelect: (relPath: string) => void;
  loading: boolean;
  /** Changes whenever the result set means something new; the wall returns to the top. */
  scrollKey: string;
  /** Scroll this tile into the middle of the view once it is laid out. */
  focus?: { relPath: string; nonce: number } | null;
  emptyTitle: string;
  emptyBody: string;
  emptyAction?: React.ReactNode;
};

const GAP = 16;
const CAPTION_HEIGHT = 24;
const PADDING = 48;
const OVERSCAN = 600;

type Placed = { entry: Entry; x: number; y: number; width: number; height: number };

function aspectOf(entry: Entry): number {
  if (entry.width && entry.height && entry.width > 0 && entry.height > 0) {
    return entry.width / entry.height;
  }
  return 1;
}

/** Waterfall: shortest column first, height from the file's own aspect ratio.
 *  Column width stays fractional so the wall fills the row and both margins match. */
function layout(
  entries: Entry[],
  columns: number,
  width: number,
  uniform: boolean,
  caption: number,
): { placed: Placed[]; height: number } {
  const heights = new Array<number>(columns).fill(0);
  const placed: Placed[] = [];
  for (const entry of entries) {
    let column = 0;
    for (let index = 1; index < columns; index += 1) {
      const candidate = heights[index];
      const current = heights[column];
      if (candidate !== undefined && current !== undefined && candidate < current - 1) column = index;
    }
    const aspect = uniform ? 1 : aspectOf(entry);
    const height = Math.max(48, Math.round(width / aspect));
    const y = heights[column] ?? 0;
    placed.push({ entry, x: column * (width + GAP), y, width, height });
    heights[column] = y + height + caption + GAP;
  }
  return { placed, height: Math.max(0, ...heights) };
}

export function Grid({
  entries,
  scores,
  cell,
  mode,
  showNames,
  selected,
  onSelect,
  loading,
  scrollKey,
  focus = null,
  emptyTitle,
  emptyBody,
  emptyAction,
}: Props) {
  const viewport = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [box, setBox] = useState({ width: 0, height: 0 });

  // The scroll container only exists once there is something to show, so this
  // has to run again on the empty -> filled transition. Measuring once on mount
  // left the wall stuck at one column.
  const hasEntries = entries.length > 0;
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => setBox({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [hasEntries]);

  useEffect(() => {
    viewport.current?.scrollTo({ top: 0 });
    setScrollTop(0);
  }, [scrollKey]);

  const usable = Math.max(0, box.width - PADDING);
  const columns = Math.max(1, Math.floor((usable + GAP) / (cell + GAP)));
  const columnWidth = (usable - GAP * (columns - 1)) / columns;
  const scored = Object.keys(scores).length > 0;
  const caption = showNames || scored ? CAPTION_HEIGHT : 0;
  const { placed, height } = useMemo(
    () => layout(entries, columns, columnWidth || cell, mode === "grid", caption),
    [entries, columns, columnWidth, cell, mode, caption],
  );

  // The tile may not be in the results yet (a locate can clear the search), so
  // this waits for a layout that has it, then handles each request once.
  const focused = useRef(0);
  useEffect(() => {
    const element = viewport.current;
    if (!focus || focus.nonce === focused.current || !element) return;
    const item = placed.find((tile) => tile.entry.relPath === focus.relPath);
    if (!item) return;
    focused.current = focus.nonce;
    const paddingTop = parseFloat(getComputedStyle(element).paddingTop) || 0;
    const top = paddingTop + item.y + item.height / 2 - element.clientHeight / 2;
    element.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }, [focus, placed]);

  // First load: tiles in the wall's own shape, never a spinner.
  // Every state starts below the 48px header that floats over the wall (pt-16).
  if (entries.length === 0 && loading) {
    return (
      <div
        className="grid min-h-0 flex-1 grid-cols-(--columns) content-start gap-4 overflow-hidden px-6 pt-16 pb-4"
        style={{ "--columns": `repeat(auto-fill, minmax(${cell}px, 1fr))` } as React.CSSProperties}
        aria-busy
      >
        {Array.from({ length: 12 }, (_, index) => (
          <Skeleton key={index} className="aspect-square" />
        ))}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      // The whole canvas is empty, so the message takes its optical centre
      // below the floating header instead of hugging the left edge.
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 pt-12 text-center">
        <div className="flex max-w-sm flex-col gap-1">
          <p className="text-sm font-medium text-foreground">{emptyTitle}</p>
          <p className="text-sm text-muted-foreground">{emptyBody}</p>
        </div>
        {emptyAction}
      </div>
    );
  }

  const top = scrollTop - OVERSCAN;
  const bottom = scrollTop + box.height + OVERSCAN;

  return (
    <div
      ref={viewport}
      className="min-h-0 flex-1 overflow-y-auto px-6 pt-16 pb-4"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      data-testid="grid"
      data-layout={mode}
    >
      <div style={{ height, position: "relative" }}>
        {placed
          .filter((item) => item.y + item.height + caption > top && item.y < bottom)
          .map((item) => {
            const isSelected = selected === item.entry.relPath;
            return (
              <button
                key={item.entry.relPath}
                onClick={() => onSelect(item.entry.relPath)}
                title={item.entry.name}
                data-testid="thumb"
                data-rel-path={item.entry.relPath}
                style={{ position: "absolute", left: item.x, top: item.y, width: item.width }}
                className="group rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <div
                  style={{ height: item.height }}
                  className={cn(
                    "overflow-hidden rounded-md bg-surface-1",
                    isSelected ? "ring-2 ring-ring ring-offset-2 ring-offset-background" : "group-hover:ring-1 group-hover:ring-border",
                  )}
                >
                  {item.entry.indexed ? (
                    <img
                      src={thumbUrl(item.entry)}
                      alt={item.entry.name}
                      loading="lazy"
                      className="size-full object-cover"
                    />
                  ) : (
                    <Skeleton className="size-full" />
                  )}
                </div>
                {caption > 0 ? (
                  <div className="mt-1 flex items-baseline gap-2 text-xs text-muted-foreground">
                    {scores[item.entry.relPath] && (
                      <span className="shrink-0 tabular-nums text-foreground" data-testid="score">
                        #{scores[item.entry.relPath]?.rank}
                        {scores[item.entry.relPath]?.match != null && ` · 匹配 ${scores[item.entry.relPath]?.match}%`}
                      </span>
                    )}
                    {showNames ? <span className="truncate">{item.entry.name}</span> : null}
                  </div>
                ) : null}
              </button>
            );
          })}
      </div>
    </div>
  );
}
