import { useRoot } from "@/app/selectors";
import { openViewer } from "@/features/browse/commands";
import { fileUrl, thumbUrl } from "@/lib/bridge";
import type { Entry } from "@/lib/types";

/** A fixed-height stage: stepping through files keeps everything below it in
 *  place, and a tall picture sits centered instead of in a letterboxed tray.
 *  The picture carries no layoutId: the wall tile owns the one the viewer grows. */
export function Preview({ entry }: { entry: Entry }) {
  const root = useRoot();
  if (!root) return null;
  const size = { width: entry.width ?? undefined, height: entry.height ?? undefined };

  return (
    <div className="flex h-64 items-center justify-center" data-testid="viewer">
      {entry.kind === "video" ? (
        <video
          src={fileUrl(root, entry)}
          controls
          {...size}
          className="block h-auto max-h-64 w-auto max-w-full rounded-md bg-surface-1"
        />
      ) : (
        <button
          type="button"
          onClick={openViewer}
          aria-label={`放大查看 ${entry.name}`}
          className="flex max-w-full cursor-zoom-in rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
        >
          <img
            src={entry.indexed ? thumbUrl(entry) : fileUrl(root, entry)}
            alt={entry.name}
            {...size}
            className="block h-auto max-h-64 w-auto max-w-full rounded-md bg-surface-1 object-contain"
          />
        </button>
      )}
    </div>
  );
}
