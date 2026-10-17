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
      <h2 className="text-sm font-medium">相似素材</h2>
      <p data-tauri-drag-region className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
        按构图与画面内容的相似度排序
      </p>
      <Button variant="ghost" onClick={clearSimilar}>
        返回全部素材
      </Button>
    </header>
  );
}
