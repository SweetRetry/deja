import { PaneResizer } from "@/components/ui/pane-resizer";
import { Inspector } from "@/features/inspector/Inspector";
import { INSPECTOR, setPreferences, usePreferences } from "@/features/settings/preferences";

export function InspectorPane() {
  const width = usePreferences((p) => p.inspectorWidth);
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
