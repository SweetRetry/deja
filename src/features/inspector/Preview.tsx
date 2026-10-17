import { useRoot } from "@/app/selectors";
import { openViewer } from "@/features/browse/commands";
import { fileUrl, thumbUrl } from "@/lib/bridge";
import type { Entry } from "@/lib/types";

/** A full-width tray keeps the picture's edges on the panel's column; it is
 *  only as tall as the picture needs, up to max-h-80. The picture carries no
 *  layoutId: the wall tile owns the shared element that opens into the viewer. */
export function Preview({ entry }: { entry: Entry }) {
  const root = useRoot();
  if (!root) return null;
  const size = { width: entry.width ?? undefined, height: entry.height ?? undefined };

  return (
    <div className="flex justify-center rounded-md bg-surface-1" data-testid="viewer">
      {entry.kind === "video" ? (
        <video
          src={fileUrl(root, entry)}
          controls
          {...size}
          className="block h-auto max-h-80 w-auto max-w-full rounded-md"
        />
      ) : (
        <button
          type="button"
          onClick={openViewer}
          aria-label={`放大查看 ${entry.name}`}
          className="flex max-w-full cursor-zoom-in rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <img
            src={entry.indexed ? thumbUrl(entry) : fileUrl(root, entry)}
            alt={entry.name}
            {...size}
            className="block h-auto max-h-80 w-auto max-w-full rounded-md object-contain"
          />
        </button>
      )}
    </div>
  );
}
