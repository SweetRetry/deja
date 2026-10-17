import { useSession } from "@/app/store";
import { Button } from "@/components/ui/button";
import { useHotkey } from "@/lib/use-hotkey";
import { clearSimilar } from "./commands";

/** Takes the toolbar's place while the wall shows files like one. */
export function SimilarBar({ leading }: { leading?: React.ReactNode }) {
  const viewing = useSession((s) => s.browse.viewing);
  // The viewer owns Esc while it is open.
  useHotkey("escape", clearSimilar, { enabled: !viewing });

  return (
    <header data-tauri-drag-region className="flex h-12 shrink-0 items-center gap-2 px-6">
      {leading}
      {/* The heading spans the bar that the removed caption used to fill, so it
          carries the drag region itself: a press in the gap still moves the window. */}
      <h2 data-tauri-drag-region className="min-w-0 flex-1 truncate text-sm font-medium">
        相似素材
      </h2>
      <Button variant="ghost" onClick={clearSimilar}>
        返回全部素材
      </Button>
    </header>
  );
}
