import { useSession } from "@/app/store";
import { useVaultPath } from "@/app/selectors";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarTrigger } from "@/components/ui/sidebar";
import { SettingsDialog } from "@/features/settings/SettingsDialog";
import { inTauri } from "@/lib/bridge";
import { cn } from "@/lib/utils";
import { FolderNav } from "./FolderNav";
import { IndexNotice, IndexStatus } from "./IndexStatus";
import { VaultMenu } from "./VaultMenu";

export function AppSidebar() {
  // The folder's path is known before its files are: the header keeps its place
  // from the first paint, and the nav fills in under it.
  const path = useVaultPath();
  const loaded = useSession((s) => s.vault.library !== null);

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

      {path ? (
        <>
          <SidebarHeader className="px-2 pt-0 pb-2">
            <VaultMenu root={path} />
          </SidebarHeader>

          <SidebarContent>
            {/* Keyed by folder so a different library starts with its own expansion state. */}
            {loaded ? <FolderNav key={path} /> : null}
          </SidebarContent>
        </>
      ) : (
        <SidebarContent />
      )}

      {/* Before a folder is open the welcome table carries the settings, so
          there is one settings button, and one ⌘, binding, at a time. */}
      <SidebarFooter className="gap-1 px-4 pb-3">
        <div className="flex h-8 items-center gap-2 text-xs text-muted-foreground">
          <IndexStatus />
          <div className="ml-auto">{path ? <SettingsDialog /> : null}</div>
        </div>
        <IndexNotice />
      </SidebarFooter>
    </Sidebar>
  );
}
