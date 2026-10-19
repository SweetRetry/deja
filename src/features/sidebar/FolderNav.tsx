import { useEffect, useMemo, useRef, useState } from "react";
import { CaretRightIcon, CopyIcon, DotsThreeIcon, FolderSimpleIcon, FolderSimplePlusIcon, ImagesIcon } from "@phosphor-icons/react";
import { useSession } from "@/app/store";
import { clearLens, createFolder, findDuplicates, moveEntries, patchFilter } from "@/features/browse/commands";
import { carriesEntries, droppedEntries } from "@/features/browse/drag";
import { setPreferences, usePreferences } from "@/features/settings/preferences";
import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Input } from "@/components/ui/input";
import { RollingNumber } from "@/components/ui/rolling-number";
import { folderRows, openAncestors, visibleFolders, type FolderRow } from "./folder-tree";

const INDENT = 16;
// Room for the chevron before the folder icon, so rows with and without
// children line up. A flat library has no chevrons and keeps the room for names.
const GUTTER = 16;

function openFolder(folder: string) {
  clearLens();
  patchFilter({ folder });
}

function Count({ value }: { value: number }) {
  return (
    <span className="ml-auto shrink-0 text-xs text-subtle-foreground">
      <RollingNumber value={value} />
    </span>
  );
}

/** Where a new folder's name is typed, in the row it will take: Enter makes
 *  it, Esc or leaving it empty takes the row back. A refused name keeps the
 *  row so it can be fixed. */
function NewFolderRow({ parent, inset, onDone }: { parent: string; inset: number; onDone: () => void }) {
  const [name, setName] = useState("");
  // Set while a name is on its way and once the row is done, so the blur that
  // follows an Enter or an Esc does not send it again.
  const settled = useRef(false);
  const finish = () => {
    settled.current = true;
    onDone();
  };
  const submit = async () => {
    if (settled.current) return;
    if (!name.trim()) return finish();
    settled.current = true;
    if (await createFolder(parent, name)) onDone();
    else settled.current = false;
  };
  return (
    <SidebarMenuItem>
      <div className="flex h-8 items-center gap-2 pr-2" style={{ paddingLeft: inset }}>
        <FolderSimpleIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <Input
          autoFocus
          aria-label="新文件夹名称"
          placeholder="未命名文件夹"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) void submit();
            if (event.key === "Escape") finish();
          }}
          onBlur={() => void submit()}
          className="h-7 px-2"
        />
      </div>
    </SidebarMenuItem>
  );
}

function FolderActions({ onCreate }: { onCreate: () => void }) {
  const showEmpty = usePreferences((p) => p.showEmptyFolders);
  return (
    <div className="ml-auto flex items-center">
      <Button variant="ghost" size="icon-xs" aria-label="新建文件夹" title="新建文件夹" onClick={onCreate}>
        <FolderSimplePlusIcon aria-hidden />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label="文件夹选项" />}>
          <DotsThreeIcon aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuCheckboxItem
            checked={showEmpty}
            onCheckedChange={(checked) => setPreferences({ showEmptyFolders: checked })}
          >
            显示空文件夹
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** How long a dragged file rests on a shut folder before it opens. */
const DRAG_OPEN_DELAY = 600;

/** A folder row that takes files dragged from the wall. `dragover` repeats
 *  while the pointer is held, so hover is "a dragover in the last 150 ms"
 *  instead of counting enter and leave pairs, which child elements unbalance. */
function FolderButton({
  row,
  active,
  inset,
  count,
  onOpen,
  onHover,
}: {
  row: FolderRow;
  active: boolean;
  inset: number;
  count: number;
  onOpen: () => void;
  onHover: () => void;
}) {
  const [over, setOver] = useState(false);
  const idle = useRef<number | undefined>(undefined);
  const opening = useRef<number | undefined>(undefined);
  const end = () => {
    window.clearTimeout(idle.current);
    window.clearTimeout(opening.current);
    opening.current = undefined;
    setOver(false);
  };
  useEffect(() => end, []);
  return (
    <SidebarMenuButton
      isActive={active}
      onClick={onOpen}
      onDragOver={(event) => {
        if (!carriesEntries(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setOver(true);
        window.clearTimeout(idle.current);
        idle.current = window.setTimeout(end, 150);
        opening.current ??= window.setTimeout(onHover, DRAG_OPEN_DELAY);
      }}
      onDrop={(event) => {
        if (!carriesEntries(event.dataTransfer)) return;
        event.preventDefault();
        end();
        void moveEntries(droppedEntries(event.dataTransfer), row.rel);
      }}
      data-drop-target={over ? "true" : undefined}
      className={over ? "bg-sidebar-accent ring-1 ring-sidebar-ring" : undefined}
      style={{ paddingLeft: inset }}
      // The tooltip only shows while the sidebar is collapsed; a cut-off name still reads in full.
      title={row.name}
    >
      <FolderSimpleIcon aria-hidden />
      <span className="truncate">{row.name}</span>
      <Count value={count} />
    </SidebarMenuButton>
  );
}

export function FolderNav() {
  const folders = useSession((s) => s.vault.library?.folders);
  const counts = useSession((s) => s.vault.library?.counts);
  const lens = useSession((s) => s.browse.lens?.kind ?? null);
  // Every file in a group, as the duplicates view shows them; nothing until compared.
  const copies = useSession((s) => s.browse.copies?.reduce((sum, group) => sum + group.paths.length, 0) ?? null);
  // A folder row is only active while the wall shows that folder.
  const active = useSession((s) => (s.browse.lens ? null : s.browse.filter.folder));
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const [shown, setShown] = useState(active);
  if (shown !== active) {
    setShown(active);
    if (active !== null) setToggled((state) => openAncestors(state, active));
  }
  const showEmpty = usePreferences((p) => p.showEmptyFolders);
  // The folder a new one goes in, while its name is being typed.
  const [creating, setCreating] = useState<string | null>(null);
  const listed = useMemo(
    () => visibleFolders(folders ?? [], counts ?? {}, showEmpty, active),
    [folders, counts, showEmpty, active],
  );
  const rows = useMemo(() => folderRows(listed, toggled), [listed, toggled]);
  const gutter = rows.some((row) => row.hasChildren) ? GUTTER : 0;
  /** The header button makes a top-level folder; a row's menu makes one inside it. */
  const startCreating = (parent: string) => {
    if (parent) setToggled((state) => ({ ...openAncestors(state, parent), [parent]: true }));
    setCreating(parent);
  };
  const newRow = (parent: string) =>
    creating === parent ? (
      <NewFolderRow
        key={`new:${parent}`}
        parent={parent}
        inset={8 + gutter + (parent ? parent.split("/").length : 0) * INDENT}
        onDone={() => setCreating(null)}
      />
    ) : null;

  return (
    <>
      <SidebarGroup>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton isActive={active === ""} onClick={() => openFolder("")}>
              <ImagesIcon aria-hidden />
              <span className="truncate">全部素材</span>
              <Count value={counts?.[""] ?? 0} />
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton isActive={lens === "duplicates"} onClick={() => void findDuplicates()}>
              <CopyIcon aria-hidden />
              <span className="truncate">重复素材</span>
              {copies === null ? null : <Count value={copies} />}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>

      <SidebarGroup>
        <SidebarGroupLabel className="pr-0">
          文件夹
          <FolderActions onCreate={() => startCreating("")} />
        </SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {newRow("")}
            {rows.map((row) => [
              <SidebarMenuItem key={row.rel}>
                <ContextMenu>
                  <ContextMenuTrigger className="block">
                    <FolderButton
                      row={row}
                      active={active === row.rel}
                      inset={8 + gutter + row.depth * INDENT}
                      count={counts?.[row.rel] ?? 0}
                      onOpen={() => openFolder(row.rel)}
                      onHover={() => setToggled((state) => (row.hasChildren && !row.expanded ? { ...state, [row.rel]: true } : state))}
                    />
                  </ContextMenuTrigger>
                  {/* Focus stays with the name field the item opens, not back on the row. */}
                  <ContextMenuContent finalFocus={false}>
                    <ContextMenuItem onClick={() => startCreating(row.rel)}>新建子文件夹</ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
                {/* After the row in the DOM, so the row stays the first button for this folder. */}
                {row.hasChildren ? (
                  <button
                    type="button"
                    aria-label={`${row.expanded ? "收起" : "展开"} ${row.name}`}
                    aria-expanded={row.expanded}
                    onClick={() => setToggled((state) => ({ ...state, [row.rel]: !row.expanded }))}
                    style={{ left: 4 + row.depth * INDENT }}
                    className="absolute top-1.5 flex size-5 items-center justify-center rounded-sm text-muted-foreground ring-sidebar-ring outline-hidden transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2"
                  >
                    <CaretRightIcon
                      aria-hidden
                      className={row.expanded ? "size-3 rotate-90 transition-transform" : "size-3 transition-transform"}
                    />
                  </button>
                ) : null}
              </SidebarMenuItem>,
              newRow(row.rel),
            ])}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  );
}
