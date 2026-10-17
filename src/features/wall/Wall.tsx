import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { session, useSession, type Session } from "@/app/store";
import { useWallEntries, useWallLoading } from "@/app/selectors";
import { findSimilar, openViewer, select } from "@/features/browse/commands";
import { THUMB_WIDTH, usePreferences } from "@/features/settings/preferences";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/bridge";
import type { SearchScore } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CAPTION_HEIGHT, layout, neighbor, type Direction } from "./layout";
import { Tile } from "./Tile";

/** px-6 on both sides of the scroll container. */
const PADDING_X = 48;
const OVERSCAN = 600;
const NO_SCORES: Record<string, SearchScore> = {};

const ARROWS: Partial<Record<string, Direction>> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};

// The similar view ranks by likeness, so the search's scores do not apply to it.
const scoresOf = (s: Session) => (s.browse.similar ? NO_SCORES : s.browse.results.scores);

/** Changes whenever the result set means something new; the wall returns to the top. */
const scrollKeyOf = (s: Session) => {
  const { query, filter, sort, ranking, similar } = s.browse;
  return JSON.stringify([query.trim(), filter, sort, ranking, similar?.source ?? null]);
};

const selectedPath = () => session().browse.selected;

export function Wall({ empty }: { empty: React.ReactNode }) {
  const entries = useWallEntries();
  const loading = useWallLoading();
  const pending = useSession((s) => s.browse.pending);
  const selected = useSession((s) => s.browse.selected);
  const reveal = useSession((s) => s.browse.reveal);
  const scores = useSession(scoresOf);
  const scrollKey = useSession(scrollKeyOf);
  const mode = usePreferences((p) => p.layout);
  const cell = usePreferences((p) => THUMB_WIDTH[p.size]);
  const showNames = usePreferences((p) => p.showNames);

  const viewport = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [box, setBox] = useState({ width: 0, height: 0 });

  // The scroll container only exists while there are tiles, so it is wired
  // up whenever it mounts rather than once with the wall.
  const attach = useCallback((element: HTMLDivElement) => {
    viewport.current = element;
    const measure = () =>
      setBox((last) =>
        last.width === element.clientWidth && last.height === element.clientHeight
          ? last
          : { width: element.clientWidth, height: element.clientHeight },
      );
    measure();
    setScrollTop(element.scrollTop);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setScrollTop(element.scrollTop);
      });
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
      viewport.current = null;
    };
  }, []);

  useEffect(() => {
    viewport.current?.scrollTo({ top: 0 });
  }, [scrollKey]);

  const scored = useMemo(() => Object.keys(scores).length > 0, [scores]);
  const caption = showNames || scored;
  const { placed, height } = useMemo(
    () =>
      layout(entries, {
        width: Math.max(0, box.width - PADDING_X),
        cell,
        uniform: mode === "grid",
        caption: caption ? CAPTION_HEIGHT : 0,
      }),
    [entries, box.width, cell, mode, caption],
  );

  // The tile may not be on the wall yet (a locate can clear the search first),
  // so this waits for a layout that has it, then handles each request once.
  const handled = useRef(0);
  useEffect(() => {
    const element = viewport.current;
    if (!reveal || reveal.nonce === handled.current || !element) return;
    const tile = placed.find((item) => item.entry.relPath === reveal.relPath);
    if (!tile) return;
    handled.current = reveal.nonce;
    const style = getComputedStyle(element);
    const paddingTop = parseFloat(style.paddingTop) || 0;
    const paddingBottom = parseFloat(style.paddingBottom) || 0;
    const top = paddingTop + tile.y;
    if (reveal.align === "center") {
      element.scrollTo({ top: Math.max(0, top + tile.height / 2 - element.clientHeight / 2), behavior: "smooth" });
      return;
    }
    // The header floats over the top padding, so a tile under it is out of view.
    const bottom = top + tile.height + (caption ? CAPTION_HEIGHT : 0) + paddingBottom;
    if (top - paddingTop < element.scrollTop) element.scrollTo({ top: top - paddingTop });
    else if (bottom > element.scrollTop + element.clientHeight) element.scrollTo({ top: bottom - element.clientHeight });
    // The viewer holds the keyboard while it is open; the tile takes it back after.
    if (session().browse.viewing) return;
    element
      .querySelector<HTMLElement>(`[data-rel-path="${CSS.escape(reveal.relPath)}"]`)
      ?.focus({ preventScroll: true });
  }, [reveal, placed, caption]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    // Tab can put focus on a tile other than the selected one; keys act from
    // the tile that shows the focus ring.
    const focused = event.target instanceof HTMLElement ? event.target.dataset.relPath : undefined;
    const origin = focused ?? selected;
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      if (focused) select(focused);
      openViewer();
      return;
    }
    const direction = ARROWS[event.key];
    let next: string | null | undefined;
    if (direction) {
      const onWall = origin !== null && placed.some((tile) => tile.entry.relPath === origin);
      next = onWall ? neighbor(placed, origin, direction) : placed[0]?.entry.relPath;
    } else if (event.key === "Home") next = placed[0]?.entry.relPath;
    else if (event.key === "End") next = placed.at(-1)?.entry.relPath;
    else return;
    event.preventDefault();
    if (next) select(next, true);
  };

  let body: React.ReactNode;
  if (entries.length === 0) {
    // First load: tiles in the wall's own shape, never a spinner.
    body = loading ? (
      <div
        className="grid min-h-0 flex-1 grid-cols-(--columns) content-start gap-4 overflow-hidden px-6 pt-16 pb-4"
        style={{ "--columns": `repeat(auto-fill, minmax(${cell}px, 1fr))` } as React.CSSProperties}
        aria-busy
      >
        {Array.from({ length: 12 }, (_, index) => (
          <Skeleton key={index} className="aspect-square" />
        ))}
      </div>
    ) : (
      empty
    );
  } else {
    const top = scrollTop - OVERSCAN;
    const bottom = scrollTop + box.height + OVERSCAN;
    const captionHeight = caption ? CAPTION_HEIGHT : 0;
    body = (
      // pt-16 starts the tiles below the 48px header, which blurs over them.
      <div
        ref={attach}
        className="min-h-0 flex-1 overflow-y-auto px-6 pt-16 pb-4"
        onKeyDown={onKeyDown}
        data-testid="grid"
        data-layout={mode}
      >
        <div style={{ height, position: "relative" }}>
          {placed
            // The selected tile always renders: it holds the keyboard focus and
            // the picture the viewer grows from, even when scrolled away.
            .filter(
              (tile) =>
                (tile.y + tile.height + captionHeight > top && tile.y < bottom) || tile.entry.relPath === selected,
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
                caption={caption}
                showNames={showNames}
              />
            ))}
        </div>
      </div>
    );
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger
        className={cn("flex min-h-0 flex-1 flex-col transition-opacity", pending && "opacity-60")}
        onContextMenu={(event) => {
          // Only tiles have a menu; the tile itself selects on right-click.
          if (!(event.target as Element).closest("[data-testid=thumb]")) event.preventBaseUIHandler();
        }}
      >
        {body}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={openViewer}>
          预览
          <ContextMenuShortcut>Space</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => {
            const relPath = selectedPath();
            if (relPath) void findSimilar(relPath);
          }}
        >
          查找相似素材
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => {
            const relPath = selectedPath();
            if (relPath) void api.reveal(relPath).catch(() => undefined);
          }}
        >
          在访达中显示
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
