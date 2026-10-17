import { useMemo, useState } from "react";
import { CaretRightIcon, FolderSimpleIcon, ImagesIcon } from "@phosphor-icons/react";
import { useSession } from "@/app/store";
import { patchFilter, clearSimilar } from "@/features/browse/commands";
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
// children line up.
const GUTTER = 16;

function openFolder(folder: string) {
  clearSimilar();
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
  const active = useSession((s) => s.browse.filter.folder);
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const [shown, setShown] = useState(active);
  if (shown !== active) {
    setShown(active);
    setToggled((state) => openAncestors(state, active));
  }
  const rows = useMemo(() => folderRows(folders ?? [], toggled), [folders, toggled]);

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
                    style={{ paddingLeft: 8 + GUTTER + row.depth * INDENT }}
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
