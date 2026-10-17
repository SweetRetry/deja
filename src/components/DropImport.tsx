import { useEffect, useRef, useState } from "react";
import { DownloadSimpleIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { mayCarryImage, readDrop } from "@/lib/drop";
import type { ImportItem } from "@/lib/types";

/** `error` is already worded for the user. */
export type DropResult = { imported: string[]; existing: string[] } | { error: string };

type Props = {
  /** Where a drop lands, as the user reads it; null while no folder is open. */
  target: string | null;
  onDrop: (items: ImportItem[]) => Promise<DropResult>;
  onLocate: (relPath: string) => void;
  /** Resolves to a worded error, or null once the files are gone. */
  onUndo: (relPaths: string[]) => Promise<string | null>;
};

/** What the drop did, in one line: new files, files the vault already had, or both. */
function summary(imported: number, existing: number, folder: string | null): string {
  if (imported > 0 && existing > 0) return `已导入 ${imported} 项，${existing} 项已在素材库中`;
  if (imported > 0) return `已导入 ${imported} 项到「${folder}」`;
  return existing === 1 ? "素材库里已有这张图" : `这 ${existing} 项已在素材库中`;
}

/**
 * Listens on the whole window so an image dragged out of a browser can be let
 * go anywhere. `dragover` repeats while the pointer is held still, so hover is
 * "a dragover in the last 150 ms" instead of counting enter and leave pairs,
 * which child elements unbalance. Each drop owns one toast, which turns from
 * loading into its outcome in place.
 */
export function DropImport({ target, onDrop, onLocate, onUndo }: Props) {
  const [hover, setHover] = useState(false);
  const internal = useRef(false);
  const latest = useRef({ target, onDrop, onLocate, onUndo });
  latest.current = { target, onDrop, onLocate, onUndo };

  useEffect(() => {
    if (target === null) return;
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
      const folder = latest.current.target;
      void readDrop(event.dataTransfer).then(async (items) => {
        const id = toast.loading(`正在导入 ${Math.max(items.length, 1)} 项…`);
        const result = await latest.current.onDrop(items);
        if ("error" in result) {
          toast.error(result.error, { id });
          return;
        }
        const locate = result.imported[0] ?? result.existing[0];
        const undo = result.imported;
        toast.success(summary(undo.length, result.existing.length, folder), {
          id,
          duration: 6000,
          action: locate
            ? {
                label: "定位",
                onClick: (click) => {
                  // Locating keeps the toast, so undo is still one click away.
                  click.preventDefault();
                  latest.current.onLocate(locate);
                },
              }
            : undefined,
          cancel:
            undo.length > 0
              ? {
                  label: "撤回",
                  onClick: () => {
                    const undoing = toast.loading("正在撤回…");
                    void latest.current.onUndo(undo).then((error) =>
                      error ? toast.error(error, { id: undoing }) : toast.success("已撤回导入", { id: undoing }),
                    );
                  },
                }
              : undefined,
        });
      });
    };
    window.addEventListener("dragstart", start);
    window.addEventListener("dragend", stop);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      end();
      window.removeEventListener("dragstart", start);
      window.removeEventListener("dragend", stop);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [target]);

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
      <p className="text-xs text-muted-foreground">原文件复制进此文件夹，网页图片会记下来源网址</p>
    </div>
  );
}
