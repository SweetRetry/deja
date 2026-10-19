import { useEffect, useRef, useState } from "react";
import { ClipboardIcon, XIcon } from "@phosphor-icons/react";
import { useDropTarget } from "@/app/selectors";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/bridge";
import type { ClipboardPreview } from "@/lib/types";
import { importClipboard } from "./commands";
import { report } from "./report";

/**
 * Some pages show a picture that cannot be dragged, only copied. Coming back to
 * the window with one on the clipboard offers to import it, in the sidebar's
 * free space so nothing around it moves. Each copy is offered once: closing it
 * or importing it hides that copy until the clipboard changes.
 */
export function ClipboardOffer() {
  const folder = useDropTarget();
  const [offer, setOffer] = useState<{ change: number; preview: ClipboardPreview | null } | null>(null);
  const handled = useRef<number | null>(null);
  const open = folder !== null;

  useEffect(() => {
    if (!open) return;
    // The offer appears with its preview or not at all, so it never grows after it shows.
    const look = async () => {
      const { change } = await api.clipboardImage().catch(() => ({ change: null }));
      if (change === null || change === handled.current) return setOffer(null);
      const preview = await api.clipboardPreview().catch(() => null);
      setOffer({ change, preview });
    };
    // Cmd+V already took the clipboard's picture, so the offer is spent.
    const pasted = () =>
      setOffer((current) => {
        handled.current = current?.change ?? handled.current;
        return null;
      });
    const onFocus = () => void look();
    onFocus();
    window.addEventListener("focus", onFocus);
    window.addEventListener("paste", pasted);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("paste", pasted);
    };
  }, [open]);

  if (offer === null || folder === null) return null;

  const done = () => {
    handled.current = offer.change;
    setOffer(null);
  };
  const { preview } = offer;

  return (
    <div
      data-testid="clipboard-offer"
      className="mx-2 mb-2 flex shrink-0 flex-col gap-2 rounded-lg border border-border bg-card p-3 text-xs"
    >
      {preview ? (
        <img
          src={preview.url}
          alt="剪贴板里的图片"
          className="max-h-40 w-full rounded-md bg-muted object-contain"
        />
      ) : null}
      <div className="flex items-start gap-2">
        <ClipboardIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <p className="min-w-0 flex-1">
          剪贴板里有一张图片
          {preview?.width && preview.height ? (
            <span className="block text-muted-foreground">
              {preview.width} × {preview.height}
            </span>
          ) : null}
        </p>
        <Button variant="ghost" size="icon-sm" aria-label="忽略" className="-mt-1 -mr-1" onClick={done}>
          <XIcon aria-hidden />
        </Button>
      </div>
      <Button
        size="sm"
        className="min-w-0"
        onClick={() => {
          done();
          report(importClipboard(), 1, folder);
        }}
      >
        <span className="truncate">导入到「{folder}」</span>
      </Button>
    </div>
  );
}
