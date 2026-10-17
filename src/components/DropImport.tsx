import { useEffect, useRef, useState } from "react";
import { CheckCircleIcon, CircleNotchIcon, DownloadSimpleIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { mayCarryImage, readDrop } from "@/lib/drop";
import type { ImportItem } from "@/lib/types";

/** `error` is already worded for the user. */
export type DropResult = { count: number } | { error: string };

type Props = {
  /** Where a drop lands, as the user reads it; null while no folder is open. */
  target: string | null;
  onDrop: (items: ImportItem[]) => Promise<DropResult>;
};

type Toast =
  | { kind: "busy"; text: string }
  | { kind: "done"; text: string }
  | { kind: "failed"; text: string };

const TOAST_ICON = {
  busy: <CircleNotchIcon aria-hidden className="size-4 animate-spin" />,
  done: <CheckCircleIcon aria-hidden weight="fill" className="size-4 text-success" />,
  failed: <WarningCircleIcon aria-hidden weight="fill" className="size-4 text-destructive" />,
};

/**
 * Listens on the whole window so an image dragged out of a browser can be let
 * go anywhere. `dragover` repeats while the pointer is held still, so hover is
 * "a dragover in the last 150 ms" instead of counting enter and leave pairs,
 * which child elements unbalance.
 */
export function DropImport({ target, onDrop }: Props) {
  const [hover, setHover] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const internal = useRef(false);
  const busy = useRef(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef({ target, onDrop });
  latest.current = { target, onDrop };

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
        busy.current += Math.max(items.length, 1);
        clearTimeout(hideTimer.current);
        setToast({ kind: "busy", text: `正在导入 ${busy.current} 项…` });
        const result = await latest.current.onDrop(items);
        busy.current -= Math.max(items.length, 1);
        // A drop still in flight keeps the spinner; the last one to finish speaks.
        if (busy.current > 0) return;
        setToast(
          "error" in result
            ? { kind: "failed", text: result.error }
            : { kind: "done", text: `已导入 ${result.count} 项到「${folder}」` },
        );
        hideTimer.current = setTimeout(() => setToast(null), "error" in result ? 4000 : 2400);
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

  useEffect(() => () => clearTimeout(hideTimer.current), []);

  return (
    <>
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
      <div
        role="status"
        aria-live="polite"
        data-testid="import-toast"
        data-kind={toast?.kind ?? "none"}
        className={cn(
          "pointer-events-none fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border bg-popover px-4 py-2 text-sm text-popover-foreground transition-[opacity,translate] duration-200",
          toast ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
        )}
      >
        {toast ? (
          <>
            {TOAST_ICON[toast.kind]}
            {toast.text}
          </>
        ) : null}
      </div>
    </>
  );
}
