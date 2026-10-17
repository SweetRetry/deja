import { session } from "@/app/store";
import { findSimilar, openViewer } from "@/features/browse/commands";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { api } from "@/lib/bridge";

const selectedPath = () => session().browse.selected;

/** The right-click menu of a tile. The tile selects itself on right-click, so
 *  every item acts on the selection; anywhere else on the wall has no menu. */
export function TileMenu({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <ContextMenu>
      <ContextMenuTrigger
        className={className}
        onContextMenu={(event) => {
          if (!(event.target as Element).closest("[data-testid=thumb]")) event.preventBaseUIHandler();
        }}
      >
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={openViewer}>
          预览
          <ContextMenuShortcut>Space</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => {
            const relPath = selectedPath();
            if (relPath) void findSimilar(relPath);
          }}
        >
          查找相似素材
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => {
            const relPath = selectedPath();
            if (relPath) void api.reveal(relPath).catch(() => undefined);
          }}
        >
          在访达中显示
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
