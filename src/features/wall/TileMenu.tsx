import { useMoveTargets } from "@/app/selectors";
import { session, useSession } from "@/app/store";
import { chosen } from "@/features/browse/browse";
import { findSimilar, moveEntries, openViewer, trashEntries } from "@/features/browse/commands";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { api } from "@/lib/bridge";

const selectedPath = () => session().browse.selected;
const chosenPaths = () => chosen(session().browse);

/** The right-click menu of a tile. A right-click outside the picked set selects
 *  that tile alone, so every item acts on what is chosen; anywhere else on the
 *  wall has no menu. */
export function TileMenu({ className, children }: { className?: string; children: React.ReactNode }) {
  const count = useSession((s) => chosen(s.browse).length);
  const targets = useMoveTargets();
  const many = count > 1;
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
        {many ? null : (
          <>
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
            <ContextMenuSeparator />
          </>
        )}
        <ContextMenuSub>
          <ContextMenuSubTrigger>{many ? `将 ${count} 项移动到` : "移动到"}</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {targets.map((target) => (
              <ContextMenuItem
                key={target.rel}
                style={{ paddingLeft: 8 + target.depth * 12 }}
                onClick={() => void moveEntries(chosenPaths(), target.rel)}
              >
                <span className="truncate">{target.name}</span>
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={() => void trashEntries(chosenPaths())}>
          {many ? `将 ${count} 项移到废纸篓` : "移到废纸篓"}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
