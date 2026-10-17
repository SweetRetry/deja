import { useRef, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { CaretLeftIcon, CaretRightIcon, XIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion, type Transition } from "motion/react";
import { useRoot, useSelectedEntry, useWallEntries } from "@/app/selectors";
import { useSession } from "@/app/store";
import { Button } from "@/components/ui/button";
import { closeViewer, select } from "@/features/browse/commands";
import { fileUrl, thumbUrl } from "@/lib/bridge";
import type { Entry } from "@/lib/types";
import { mediaLayoutId } from "./shared";

/** Opening grows the wall tile into place; stepping with the arrows swaps at once. */
const GROW: Transition = { layout: { duration: 0.24 } };
const SWAP: Transition = { layout: { duration: 0 } };

/** Fills the stage without upscaling past the file's own pixels. Without known
 *  dimensions the picture sizes itself and the max-* classes bound it. */
function fit(entry: Entry): React.CSSProperties | undefined {
  const { width, height } = entry;
  if (!width || !height) return undefined;
  return {
    aspectRatio: `${width} / ${height}`,
    width: `min(100cqw, 100cqh * ${width / height}, ${width}px)`,
  };
}

/** Keyed by file, so each swap mounts a fresh element under the new layoutId,
 *  which is how Motion pairs it with the matching wall tile. */
function Picture({ entry, root, transition }: { entry: Entry; root: string; transition: Transition }) {
  const [loaded, setLoaded] = useState(false);
  const thumb = thumbUrl(entry);
  const shared = {
    layoutId: mediaLayoutId(entry.relPath),
    transition,
    className: "max-h-full max-w-full bg-cover bg-center bg-no-repeat object-contain",
  };

  if (entry.kind === "video") {
    return (
      <motion.video {...shared} style={fit(entry)} src={fileUrl(root, entry)} poster={thumb || undefined} controls autoPlay />
    );
  }
  // The thumbnail is already decoded from the wall, so it stands in under the
  // original until the original has loaded.
  const placeholder = thumb && !loaded ? { backgroundImage: `url("${thumb}")` } : undefined;
  return (
    <motion.img
      {...shared}
      style={{ ...fit(entry), ...placeholder }}
      src={fileUrl(root, entry)}
      alt={entry.name}
      onLoad={() => setLoaded(true)}
    />
  );
}

/** Closes only for presses on the element itself, not on the picture or buttons inside it. */
function closeOnSelf(event: React.MouseEvent) {
  if (event.target === event.currentTarget) closeViewer();
}

function ViewerContent() {
  const entry = useSelectedEntry();
  const root = useRoot();
  const entries = useWallEntries();
  const popup = useRef<HTMLDivElement>(null);
  // The first file grows out of its tile; once the arrows have moved on, swaps are instant.
  const [origin, setOrigin] = useState(entry?.relPath ?? null);
  if (origin !== null && entry && entry.relPath !== origin) setOrigin(null);

  if (!entry || !root) return null;
  const index = entries.findIndex((other) => other.relPath === entry.relPath);
  const previous = index > 0 ? entries[index - 1] : undefined;
  const next = index >= 0 ? entries[index + 1] : undefined;

  const onKeyDown = (event: React.KeyboardEvent) => {
    // A focused video keeps its own keys: Space plays, the arrows seek.
    if (event.target instanceof HTMLVideoElement || event.metaKey || event.ctrlKey || event.altKey) return;
    const to = event.key === "ArrowLeft" ? previous : event.key === "ArrowRight" ? next : undefined;
    if (to) select(to.relPath, true);
    else if (event.key === " ") closeViewer();
    else return;
    // Also keeps Space from clicking a focused button once the key comes up.
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <>
      {/* AnimatePresence decides when these leave, so Base UI must not hide them
          at close: the picture has to stay visible while it shrinks back into the wall. */}
      <Dialog.Backdrop
        hidden={false}
        render={<motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />}
        className="fixed inset-0 z-50 bg-background/95"
      />
      <Dialog.Popup
        ref={popup}
        hidden={false}
        // The popup takes focus, not the first button, so Space and the arrows act on the viewer.
        initialFocus={popup}
        render={<motion.div exit={{ opacity: 0 }} />}
        onKeyDown={onKeyDown}
        className="fixed inset-0 z-50 flex flex-col outline-none"
      >
        <motion.header
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          onClick={closeOnSelf}
          className="flex h-12 shrink-0 items-center gap-2 pr-2 pl-4"
        >
          <div className="pointer-events-none flex min-w-0 flex-1 items-baseline gap-2">
            <Dialog.Title className="truncate text-sm font-medium text-foreground">{entry.name}</Dialog.Title>
            <Dialog.Description className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {index >= 0 ? `${index + 1} / ${entries.length}` : null}
              {index >= 0 && entry.width && entry.height ? " · " : null}
              {entry.width && entry.height ? `${entry.width} × ${entry.height}` : null}
            </Dialog.Description>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="上一张"
            disabled={!previous}
            onClick={() => previous && select(previous.relPath, true)}
          >
            <CaretLeftIcon aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="下一张"
            disabled={!next}
            onClick={() => next && select(next.relPath, true)}
          >
            <CaretRightIcon aria-hidden />
          </Button>
          <Dialog.Close render={<Button variant="ghost" size="icon-sm" aria-label="关闭预览" />}>
            <XIcon aria-hidden />
          </Dialog.Close>
        </motion.header>
        <div onClick={closeOnSelf} className="flex min-h-0 flex-1 items-center justify-center px-6 pb-6 @container-size">
          <Picture key={entry.relPath} entry={entry} root={root} transition={origin === null ? SWAP : GROW} />
        </div>
      </Dialog.Popup>
    </>
  );
}

/** Quick Look over the whole window while `browse.viewing`: the selected file
 *  full size, stepping through the wall in its order. */
export function Viewer() {
  const viewing = useSession((s) => s.browse.viewing);
  return (
    <Dialog.Root open={viewing} onOpenChange={(open) => !open && closeViewer()}>
      <AnimatePresence>
        {viewing ? (
          <Dialog.Portal keepMounted key="viewer">
            <ViewerContent />
          </Dialog.Portal>
        ) : null}
      </AnimatePresence>
    </Dialog.Root>
  );
}
