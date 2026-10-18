import { memo, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { CheckIcon, StarIcon } from "@phosphor-icons/react";
import { clickTile, openViewer, select } from "@/features/browse/commands";
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
  /** One of several files picked for one action. */
  picked: boolean;
  score: SearchScore | undefined;
  /** Said under the picture in place of a score: which copy of a group this is. */
  note?: string;
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
  picked,
  score,
  note,
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
      onClick={(event) => clickTile(relPath, event)}
      onDoubleClick={(event) => {
        if (event.metaKey || event.ctrlKey) return;
        select(relPath);
        openViewer();
      }}
      // A right-click inside the picked set keeps it, so the menu acts on all of it.
      onContextMenu={() => {
        if (!picked) select(relPath);
      }}
      onPointerEnter={arm}
      onPointerMove={arm}
      onPointerLeave={stop}
      title={entry.name}
      data-testid="thumb"
      data-rel-path={relPath}
      data-kind={entry.kind}
      data-picked={picked ? "true" : undefined}
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
          selected || picked
            ? "ring-2 ring-ring ring-offset-2 ring-offset-background"
            : "group-hover:ring-1 group-hover:ring-border",
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
        {picked ? (
          <span
            aria-hidden
            className="absolute top-1.5 left-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground"
          >
            <CheckIcon size={12} weight="bold" />
          </span>
        ) : null}
      </div>
      {/* The footer only exists when it has something to say; a clip and an
          unrated still in browse show nothing under the picture. */}
      {score || note || showNames ? (
        <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          {note ? (
            <span className="shrink-0 tabular-nums text-foreground" data-testid="copy-note">
              {note}
            </span>
          ) : score ? (
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
