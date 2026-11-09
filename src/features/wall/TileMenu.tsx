import { useMoveTargets } from "@/app/selectors";
import { session, useSession } from "@/app/store";
import { chosen } from "@/features/browse/browse";
import {
  actedOn,
  copyEntries,
  findSimilarFromHere,
  moveEntries,
  openViewer,
  revealEntry,
  trashEntries,
} from "@/features/browse/commands";
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

/** The shortcuts the menus show; `useFileHotkeys` binds the same combos. */
export const FILE_KEYS = { copy: "⌘C", copyPath: "⌥⌘C", trash: "⌘⌫" } as const;

/** Every action on files, for the wall's right-click and the viewer's. Paths
 *  are read when an item is clicked, after the right-click has settled the
 *  selection. In the viewer it acts on the file on screen alone. */
export function FileMenuItems({ count, viewer = false }: { count: number; viewer?: boolean }) {
  const targets = useMoveTargets();
  const many = count > 1;
  const one = () => session().browse.selected;
  return (
    <>
      {many ? null : (
        <>
          {viewer ? null : (
            <ContextMenuItem onClick={openViewer}>
              预览
              <ContextMenuShortcut>Space</ContextMenuShortcut>
            </ContextMenuItem>
          )}
          <ContextMenuItem
            onClick={() => {
              const relPath = one();
              if (relPath) findSimilarFromHere(relPath);
            }}
          >
            查找相似素材
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => {
              const relPath = one();
              if (relPath) revealEntry(relPath);
            }}
          >
            在访达中显示
          </ContextMenuItem>
          <ContextMenuSeparator />
        </>
      )}
      <ContextMenuItem onClick={() => void copyEntries(actedOn(), "file")}>
        {many ? `拷贝 ${count} 项` : "拷贝"}
        <ContextMenuShortcut>{FILE_KEYS.copy}</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem onClick={() => void copyEntries(actedOn(), "path")}>
        {many ? `拷贝 ${count} 条路径` : "拷贝路径"}
        <ContextMenuShortcut>{FILE_KEYS.copyPath}</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuSub>
        <ContextMenuSubTrigger>{many ? `将 ${count} 项移动到` : "移动到"}</ContextMenuSubTrigger>
        <ContextMenuSubContent>
          {targets.map((target) => (
            <ContextMenuItem
              key={target.rel}
              style={{ paddingLeft: 8 + target.depth * 12 }}
              onClick={() => void moveEntries(actedOn(), target.rel)}
            >
              <span className="truncate">{target.name}</span>
            </ContextMenuItem>
          ))}
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" onClick={() => void trashEntries(actedOn())}>
        {many ? `将 ${count} 项移到废纸篓` : "移到废纸篓"}
        <ContextMenuShortcut>{FILE_KEYS.trash}</ContextMenuShortcut>
      </ContextMenuItem>
    </>
  );
}

/** The right-click menu of a tile. A right-click outside the picked set selects
 *  that tile alone, so every item acts on what is chosen; anywhere else on the
 *  wall has no menu. */
export function TileMenu({ className, children }: { className?: string; children: React.ReactNode }) {
  const count = useSession((s) => chosen(s.browse).length);
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
        <FileMenuItems count={count} />
      </ContextMenuContent>
    </ContextMenu>
  );
}
