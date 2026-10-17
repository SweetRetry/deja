import { memo, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { StarIcon } from "@phosphor-icons/react";
import { openViewer, select } from "@/features/browse/commands";
import { mediaLayoutId } from "@/features/viewer/shared";
import { Skeleton } from "@/components/ui/skeleton";
import { fileUrl, thumbUrl } from "@/lib/bridge";
import type { Entry, SearchScore } from "@/lib/types";
import { cn } from "@/lib/utils";

/** How long the pointer rests on a clip before the tile plays it; a pass
 *  across the wall costs nothing. */
const PREVIEW_DELAY = 200;

type Props = {
  entry: Entry;
  x: number;
  y: number;
  width: number;
  height: number;
  selected: boolean;
  score: SearchScore | undefined;
  /** Scored under the lowest match the user accepts; it stays on the wall, faded. */
  dim: boolean;
  showNames: boolean;
  /** The vault's folder, for the file itself; a clip previews from it. */
  root: string | null;
};

/** One star per point, so a rating is read at a glance and an unrated file
 *  takes no room at all. It sits on the picture, so it carries its own
 *  backdrop to stay legible over a bright still. */
function Rating({ rating, className }: { rating: number; className?: string }) {
  if (rating <= 0) return null;
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-px rounded-full bg-background/80 px-1.5 py-0.5 text-foreground backdrop-blur-sm",
        className,
      )}
      role="img"
      aria-label={`${rating} 星`}
      data-testid="tile-rating"
      data-rating={rating}
    >
      {Array.from({ length: rating }, (_, index) => (
        <StarIcon key={index} size={10} weight="fill" aria-hidden />
      ))}
    </span>
  );
}

/** What sits in place of the still while the pointer rests on a clip: the file
 *  itself, muted and looping, with no controls so the tile stays one button. */
function ClipPreview({ entry, root }: { entry: Entry; root: string }) {
  return (
    <video
      src={fileUrl(root, entry)}
      poster={thumbUrl(entry) || undefined}
      muted
      loop
      autoPlay
      playsInline
      preload="auto"
      aria-hidden
      data-testid="tile-preview"
      className="size-full object-cover"
    />
  );
}

// Props are primitives plus the entry and score objects, which keep their
// identity until the file or the answer changes, so a selection change
// re-renders two tiles instead of the wall.
export const Tile = memo(function Tile({
  entry,
  x,
  y,
  width,
  height,
  selected,
  score,
  dim,
  showNames,
  root,
}: Props) {
  const { relPath } = entry;
  const [preview, setPreview] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const previewable = entry.kind === "video" && entry.indexed && !selected && root !== null;

  const stop = () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    setPreview(false);
  };
  // Armed on every move, not only on enter: tiles move under a resting pointer
  // when the wall re-sorts, and that never fires another enter.
  const arm = () => {
    if (!previewable || preview || timer.current !== undefined) return;
    timer.current = window.setTimeout(() => setPreview(true), PREVIEW_DELAY);
  };
  useEffect(() => stop, []);
  // Selecting a clip opens it in the viewer, so the preview gives way.
  useEffect(() => {
    if (!previewable) stop();
  }, [previewable]);

  return (
    <button
      type="button"
      onClick={() => select(relPath)}
      onDoubleClick={() => {
        select(relPath);
        openViewer();
      }}
      onContextMenu={() => select(relPath)}
      onPointerEnter={arm}
      onPointerMove={arm}
      onPointerLeave={stop}
      title={entry.name}
      data-testid="thumb"
      data-rel-path={relPath}
      data-kind={entry.kind}
      style={{ position: "absolute", left: x, top: y, width }}
      data-dim={dim ? "true" : undefined}
      className={cn(
        "group rounded-md text-left transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        dim && "opacity-30 hover:opacity-100 focus-visible:opacity-100",
      )}
    >
      <div
        style={{ height }}
        className={cn(
          "relative overflow-hidden rounded-md bg-surface-1",
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
        ) : preview && root ? (
          <ClipPreview entry={entry} root={root} />
        ) : (
          <img src={thumbUrl(entry)} alt={entry.name} loading="lazy" className="size-full object-cover" />
        )}
        <Rating rating={entry.rating} className="absolute right-1.5 bottom-1.5" />
      </div>
      {/* The footer only exists when it has something to say; a clip and an
          unrated still in browse show nothing under the picture. */}
      {score || showNames ? (
        <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          {score ? (
            <span className="shrink-0 tabular-nums text-foreground" data-testid="score">
              #{score.rank}
              {score.match != null && ` · 匹配 ${score.match}%`}
            </span>
          ) : null}
          {showNames ? <span className="min-w-0 flex-1 truncate">{entry.name}</span> : null}
        </div>
      ) : null}
    </button>
  );
});
