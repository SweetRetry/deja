import { useEffect, useRef, useState } from "react";
import { DownloadSimpleIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { ImportItem } from "@/lib/types";
import { useDropTarget } from "@/app/selectors";
import { locate } from "@/features/browse/commands";
import { importDrop, undoImport } from "./commands";
import { isEditable, mayCarryImage, readTransfer } from "./drop";

/** One import's toast: loading, then its outcome in place, with locate and undo. */
function runImport(items: ImportItem[], folder: string | null) {
  if (folder === null) return;
  const id = toast.loading(`正在导入 ${Math.max(items.length, 1)} 项…`);
  void importDrop(items).then((result) => {
    if ("error" in result) {
      toast.error(result.error, { id });
      return;
    }
    const undo = result.imported;
    const first = undo[0];
    toast.success(`已导入 ${undo.length} 项到「${folder}」`, {
      id,
      duration: 6000,
      action: first
        ? {
            label: "定位",
            onClick: (click) => {
              // Locating keeps the toast, so undo is still one click away.
              click.preventDefault();
              locate(first);
            },
          }
        : undefined,
      cancel: {
        label: "撤回",
        onClick: () => {
          const undoing = toast.loading("正在撤回…");
          void undoImport(undo).then((error) =>
            error ? toast.error(error, { id: undoing }) : toast.success("已撤回导入", { id: undoing }),
          );
        },
      },
    });
  });
}

/**
 * Listens on the whole window so an image dragged out of a browser can be let
 * go anywhere, or pasted with Cmd+V when the page offers no image to drag. `dragover` repeats while the pointer is held still, so hover is
 * "a dragover in the last 150 ms" instead of counting enter and leave pairs,
 * which child elements unbalance.
 */
export function DropImport() {
  const target = useDropTarget();
  const [hover, setHover] = useState(false);
  const internal = useRef(false);
  const latest = useRef(target);
  latest.current = target;
  const open = target !== null;

  useEffect(() => {
    if (!open) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const end = () => {
      clearTimeout(timer);
      setHover(false);
    };
    // A thumbnail dragged inside the app would otherwise import a copy of itself.
    const start = () => {
      internal.current = true;
    };
    const stop = () => {
      internal.current = false;
    };
    const accepts = (event: DragEvent): event is DragEvent & { dataTransfer: DataTransfer } =>
      !internal.current && event.dataTransfer !== null && mayCarryImage(event.dataTransfer.types);
    const over = (event: DragEvent) => {
      if (!accepts(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      setHover(true);
      clearTimeout(timer);
      timer = setTimeout(end, 150);
    };
    const drop = (event: DragEvent) => {
      if (!accepts(event)) return;
      event.preventDefault();
      end();
      void readTransfer(event.dataTransfer).then((items) => runImport(items, latest.current));
    };
    // Cmd+V for an image a page would not let go of: "Copy Image" on a CSS
    // background, a canvas, or a viewer. Text fields keep their own paste, and
    // a clipboard with no picture in it is left alone.
    const paste = (event: ClipboardEvent) => {
      const data = event.clipboardData;
      if (!data || isEditable(event.target) || !mayCarryImage(data.types)) return;
      event.preventDefault();
      void readTransfer(data).then((items) => {
        if (items.length > 0) runImport(items, latest.current);
      });
    };
    window.addEventListener("dragstart", start);
    window.addEventListener("dragend", stop);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    window.addEventListener("paste", paste);
    return () => {
      end();
      window.removeEventListener("dragstart", start);
      window.removeEventListener("dragend", stop);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
      window.removeEventListener("paste", paste);
    };
  }, [open]);

  return (
    <div
      aria-hidden={!hover}
      data-testid="drop-overlay"
      data-state={hover ? "open" : "closed"}
      className={cn(
        "pointer-events-none fixed inset-0 z-50 flex flex-col items-center justify-center gap-2 bg-background/80 backdrop-blur-md transition-opacity duration-150",
        hover ? "opacity-100" : "opacity-0",
      )}
    >
      <DownloadSimpleIcon aria-hidden className="size-8 text-muted-foreground" />
      <p className="text-sm font-medium">松开以导入到「{target}」</p>
    </div>
  );
}
