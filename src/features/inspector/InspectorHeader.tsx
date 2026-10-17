import { FolderOpenIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/bridge";
import type { Entry } from "@/lib/types";

/** Shares the 48px header line with the sidebar and the toolbar, and floats
 *  over the panel so its content scrolls under a blur instead of a line. */
export function InspectorHeader({ entry }: { entry: Entry | null }) {
  const folder = entry?.relPath.includes("/") ? entry.relPath.slice(0, entry.relPath.lastIndexOf("/")) : "根目录";
  return (
    <div
      data-tauri-drag-region
      className="absolute inset-x-0 top-0 z-20 flex h-12 items-center gap-2 bg-sidebar/85 px-6 backdrop-blur"
    >
      {entry ? (
        <>
          <h2 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground" title={entry.name}>
            {entry.name}
          </h2>
          <span className="shrink-0 text-xs text-subtle-foreground">{entry.ext.toUpperCase()}</span>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="在访达中显示"
                  className="-mr-1.5"
                  // Revealing is a convenience; a failure has nothing useful to say.
                  onClick={() => void api.reveal(entry.relPath).catch(() => undefined)}
                />
              }
            >
              <FolderOpenIcon aria-hidden />
            </TooltipTrigger>
            <TooltipContent>在访达中显示 · {folder}</TooltipContent>
          </Tooltip>
        </>
      ) : (
        <h2 className="text-sm font-medium text-foreground">未选择素材</h2>
      )}
    </div>
  );
}
