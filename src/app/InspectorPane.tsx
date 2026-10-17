import { useVaultPath } from "@/app/selectors";
import { PaneResizer } from "@/components/ui/pane-resizer";
import { Inspector } from "@/features/inspector/Inspector";
import { INSPECTOR, setPreferences, usePreferences } from "@/features/settings/preferences";

/** From the moment a folder starts opening, so the wall keeps its width instead
 *  of narrowing once the pane appears. */
export function InspectorPane() {
  const width = usePreferences((p) => p.inspectorWidth);
  const open = useVaultPath() !== null;
  if (!open) return null;
  return (
    <div className="relative isolate shrink-0 bg-sidebar" style={{ width }} data-testid="inspector">
      <Inspector />
      <PaneResizer
        label="调整检视面板宽度"
        width={width}
        {...INSPECTOR}
        onWidth={(next, commit) => setPreferences({ inspectorWidth: next }, commit)}
      />
    </div>
  );
}
