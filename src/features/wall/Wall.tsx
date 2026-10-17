import { useEffect, useMemo } from "react";
import { useSession, type Session } from "@/app/store";
import { useRoot, useWallEntries, useWallLoading } from "@/app/selectors";
import { openViewer, select } from "@/features/browse/commands";
import { belowMatch, THUMB_WIDTH, usePreferences } from "@/features/settings/preferences";
import { Skeleton } from "@/components/ui/skeleton";
import type { SearchScore } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CAPTION_HEIGHT, layout, step } from "./layout";
import { Tile } from "./Tile";
import { TileMenu } from "./TileMenu";
import { useReveal } from "./use-reveal";
import { useViewport } from "./use-viewport";

/** px-6 on both sides of the scroll container. */
const PADDING_X = 48;
const OVERSCAN = 600;
const NO_SCORES: Record<string, SearchScore> = {};

// The similar view ranks by likeness, so the search's scores do not apply to it.
const scoresOf = (s: Session) => (s.browse.similar ? NO_SCORES : s.browse.results.scores);

/** Changes whenever the result set means something new; the wall returns to the top. */
const scrollKeyOf = (s: Session) => {
  const { query, filter, sort, ranking, similar } = s.browse;
  return JSON.stringify([query.trim(), filter, sort, ranking, similar?.source ?? null]);
};

/** First load: tiles in the wall's own shape, never a spinner. */
function WallSkeleton({ cell }: { cell: number }) {
  return (
    <div
      className="grid grid-cols-(--columns) content-start gap-4"
      style={{ "--columns": `repeat(auto-fill, minmax(${cell}px, 1fr))` } as React.CSSProperties}
      aria-busy
    >
      {Array.from({ length: 12 }, (_, index) => (
        <Skeleton key={index} className="aspect-square" />
      ))}
    </div>
  );
}

export function Wall({ empty }: { empty: React.ReactNode }) {
  const entries = useWallEntries();
  const loading = useWallLoading();
  const pending = useSession((s) => s.browse.pending);
  const selected = useSession((s) => s.browse.selected);
  const scores = useSession(scoresOf);
  const scrollKey = useSession(scrollKeyOf);
  const mode = usePreferences((p) => p.layout);
  const cell = usePreferences((p) => THUMB_WIDTH[p.size]);
  const showNames = usePreferences((p) => p.showNames);
  const root = useRoot();
  const dimUnder = usePreferences((p) => (p.belowMatch === "dim" ? p.minMatch : 0));
  const { viewport, attach, box, scrollTop } = useViewport();

  useEffect(() => {
    viewport.current?.scrollTo({ top: 0 });
  }, [viewport, scrollKey]);

  const { placed, height } = useMemo(
    () =>
      layout(entries, {
        width: Math.max(0, box.width - PADDING_X),
        cell,
        uniform: mode === "grid",
        caption: CAPTION_HEIGHT,
      }),
    [entries, box.width, cell, mode],
  );
  useReveal(viewport, placed);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    // Tab can put focus on a tile other than the selected one; keys act from
    // the tile that shows the focus ring.
    const focused = event.target instanceof HTMLElement ? event.target.dataset.relPath : undefined;
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      if (focused) select(focused);
      openViewer();
      return;
    }
    const next = step(placed, focused ?? selected, event.key);
    if (next === undefined) return;
    event.preventDefault();
    if (next) select(next, true);
  };

  const top = scrollTop - OVERSCAN;
  const bottom = scrollTop + box.height + OVERSCAN;
  return (
    <TileMenu className={cn("flex min-h-0 flex-1 flex-col transition-opacity", pending && "opacity-60")}>
      {/* The scroll box is mounted before the files are, so the wall is measured
          at its final width: the first tiles land at their final size instead of
          being laid out once at zero width and resized on the next frame. */}
      <div
        ref={attach}
        className="min-h-0 flex-1 overflow-y-auto px-6 pt-16 pb-4"
        data-testid="grid"
        data-layout={mode}
      >
        {entries.length === 0 ? (
          loading ? (
            <WallSkeleton cell={cell} />
          ) : (
            <div className="flex min-h-full flex-col">{empty}</div>
          )
        ) : (
          // Keys belong to the tiles, not to the scroll box: the empty state's
          // path field sits in the same box and keeps its own Enter.
          <div style={{ height, position: "relative" }} onKeyDown={onKeyDown}>
            {placed
              // The selected tile always renders: it holds the keyboard focus and
              // the picture the viewer grows from, even when scrolled away.
              .filter(
                (tile) =>
                  (tile.y + tile.height + CAPTION_HEIGHT > top && tile.y < bottom) || tile.entry.relPath === selected,
              )
              .map((tile) => (
                <Tile
                  key={tile.entry.relPath}
                  entry={tile.entry}
                  x={tile.x}
                  y={tile.y}
                  width={tile.width}
                  height={tile.height}
                  selected={tile.entry.relPath === selected}
                  score={scores[tile.entry.relPath]}
                  dim={belowMatch(scores[tile.entry.relPath]?.match, dimUnder)}
                  showNames={showNames}
                  root={root}
                />
              ))}
          </div>
        )}
      </div>
    </TileMenu>
  );
}
