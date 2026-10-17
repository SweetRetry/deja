import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { EmptyWall } from "@/features/browse/EmptyWall";
import { Toolbar } from "@/features/browse/Toolbar";
import { DropImport } from "@/features/import/DropImport";
import { ScopeDialog } from "@/features/scope/ScopeDialog";
import { usePreferences } from "@/features/settings/preferences";
import { AppSidebar } from "@/features/sidebar/AppSidebar";
import { CollapsedTrigger } from "@/features/sidebar/CollapsedTrigger";
import { Viewer } from "@/features/viewer/Viewer";
import { Wall } from "@/features/wall/Wall";
import { InspectorPane } from "./InspectorPane";

const SIDEBAR_WIDTH = { "--sidebar-width": "13.5rem" } as React.CSSProperties;

/** Three columns: folders, the wall, the inspector. Each feature reads the
 *  session itself, so this file is layout only. */
export function App() {
  const theme = usePreferences((p) => p.theme);
  return (
    <SidebarProvider
      defaultOpen
      style={SIDEBAR_WIDTH}
      className="h-screen w-screen overflow-hidden bg-background text-foreground"
    >
      <AppSidebar />
      <SidebarInset className="flex min-w-0 flex-row bg-background">
        <div className="relative isolate flex min-w-0 flex-1 flex-col" data-testid="center">
          {/* Chrome the wall scrolls under: blur, not a line. */}
          <div className="absolute inset-x-0 top-0 z-20 bg-background/85 backdrop-blur">
            <Toolbar leading={<CollapsedTrigger />} />
          </div>
          <Wall empty={<EmptyWall />} />
        </div>
        <InspectorPane />
      </SidebarInset>
      <Viewer />
      <DropImport />
      <ScopeDialog />
      <Toaster theme={theme} position="bottom-center" />
    </SidebarProvider>
  );
}
