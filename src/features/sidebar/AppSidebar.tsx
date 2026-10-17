import { CaretUpDownIcon } from "@phosphor-icons/react";
import { useRoot } from "@/app/selectors";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { SettingsDialog } from "@/features/settings/SettingsDialog";
import { OpenFolder } from "@/features/vault/OpenFolder";
import { inTauri } from "@/lib/bridge";
import { cn } from "@/lib/utils";
import { FolderNav } from "./FolderNav";
import { IndexStatus } from "./IndexStatus";

export function AppSidebar() {
  const root = useRoot();
  const name = root ? (root.split("/").pop() || root) : "";

  return (
    <Sidebar collapsible="offcanvas">
      {/* Shares the 48px header line with the toolbar and the inspector; the
          desktop window's traffic lights sit in its left inset. */}
      <div
        data-tauri-drag-region
        className={cn("flex h-12 shrink-0 items-center justify-end px-2", inTauri && "pl-20")}
      >
        <SidebarTrigger aria-label="收起侧栏" />
      </div>

      {root ? (
        <>
          <SidebarHeader className="px-2 pt-0 pb-2">
            <OpenFolder
              variant="ghost"
              aria-label={`更换文件夹，当前为 ${name}`}
              title={root}
              className="w-full justify-between px-2 text-foreground"
            >
              <span className="truncate">{name}</span>
              <CaretUpDownIcon aria-hidden className="text-muted-foreground" />
            </OpenFolder>
          </SidebarHeader>

          {/* Keyed by folder so a different library starts with its own expansion state. */}
          <SidebarContent>
            <FolderNav key={root} />
          </SidebarContent>

          <SidebarFooter className="gap-1 px-4 pb-3">
            <IndexStatus>
              <SettingsDialog />
            </IndexStatus>
          </SidebarFooter>
        </>
      ) : (
        <SidebarContent />
      )}
    </Sidebar>
  );
}
