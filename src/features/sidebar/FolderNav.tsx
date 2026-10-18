import { useMemo, useState } from "react";
import { CaretRightIcon, CopyIcon, FolderSimpleIcon, ImagesIcon } from "@phosphor-icons/react";
import { useSession } from "@/app/store";
import { clearLens, findDuplicates, patchFilter } from "@/features/browse/commands";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { RollingNumber } from "@/components/ui/rolling-number";
import { folderRows, openAncestors } from "./folder-tree";

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
  const rows = useMemo(() => folderRows(folders ?? [], toggled), [folders, toggled]);
  const gutter = rows.some((row) => row.hasChildren) ? GUTTER : 0;

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

      {rows.length > 0 ? (
        <SidebarGroup>
          <SidebarGroupLabel>文件夹</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {rows.map((row) => (
                <SidebarMenuItem key={row.rel}>
                  <SidebarMenuButton
                    isActive={active === row.rel}
                    onClick={() => openFolder(row.rel)}
                    style={{ paddingLeft: 8 + gutter + row.depth * INDENT }}
                    // The tooltip only shows while the sidebar is collapsed; a cut-off name still reads in full.
                    title={row.name}
                  >
                    <FolderSimpleIcon aria-hidden />
                    <span className="truncate">{row.name}</span>
                    <Count value={counts?.[row.rel] ?? 0} />
                  </SidebarMenuButton>
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
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ) : null}
    </>
  );
}
