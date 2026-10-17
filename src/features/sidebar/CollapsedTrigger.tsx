import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { inTauri } from "@/lib/bridge";
import { cn } from "@/lib/utils";

/** The sidebar owns its trigger while open; once it is gone the toolbar takes
 *  over, leaving room for the desktop window's traffic lights. */
export function CollapsedTrigger() {
  const { open } = useSidebar();
  if (open) return null;
  return (
    <div className={cn("flex shrink-0 items-center", inTauri && "pl-14")}>
      <SidebarTrigger aria-label="展开侧栏" />
    </div>
  );
}
