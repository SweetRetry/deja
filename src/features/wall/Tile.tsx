import { memo } from "react";
import { motion } from "motion/react";
import { openViewer, select } from "@/features/browse/commands";
import { mediaLayoutId } from "@/features/viewer/shared";
import { Skeleton } from "@/components/ui/skeleton";
import { thumbUrl } from "@/lib/bridge";
import type { Entry, SearchScore } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = {
  entry: Entry;
  x: number;
  y: number;
  width: number;
  height: number;
  selected: boolean;
  score: SearchScore | undefined;
  /** Room below the picture for the score and name; every tile reserves it or none does. */
  caption: boolean;
  showNames: boolean;
};

// Props are primitives plus the entry and score objects, which keep their
// identity until the file or the answer changes, so a selection change
// re-renders two tiles instead of the wall.
export const Tile = memo(function Tile({ entry, x, y, width, height, selected, score, caption, showNames }: Props) {
  const { relPath } = entry;
  return (
    <button
      type="button"
      onClick={() => select(relPath)}
      onDoubleClick={() => {
        select(relPath);
        openViewer();
      }}
      onContextMenu={() => select(relPath)}
      title={entry.name}
      data-testid="thumb"
      data-rel-path={relPath}
      style={{ position: "absolute", left: x, top: y, width }}
      className="group rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <div
        style={{ height }}
        className={cn(
          "overflow-hidden rounded-md bg-surface-1",
          selected ? "ring-2 ring-ring ring-offset-2 ring-offset-background" : "group-hover:ring-1 group-hover:ring-border",
        )}
      >
        {!entry.indexed ? (
          <Skeleton className="size-full" />
        ) : selected ? (
          // Only the selected picture is shared with the viewer, which grows it
          // to full size. Motion registers a layoutId on mount, so selecting
          // swaps the element instead of flipping the prop.
          <motion.img
            layoutId={mediaLayoutId(relPath)}
            src={thumbUrl(entry)}
            alt={entry.name}
            loading="lazy"
            className="size-full object-cover"
          />
        ) : (
          <img src={thumbUrl(entry)} alt={entry.name} loading="lazy" className="size-full object-cover" />
        )}
      </div>
      {caption ? (
        <div className="mt-1 flex items-baseline gap-2 text-xs text-muted-foreground">
          {score ? (
            <span className="shrink-0 tabular-nums text-foreground" data-testid="score">
              #{score.rank}
              {score.match != null && ` · 匹配 ${score.match}%`}
            </span>
          ) : null}
          {showNames ? <span className="truncate">{entry.name}</span> : null}
        </div>
      ) : null}
    </button>
  );
});
