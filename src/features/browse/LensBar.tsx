import { useSession } from "@/app/store";
import { Button } from "@/components/ui/button";
import { useHotkey } from "@/lib/use-hotkey";
import { extraCopies, type Lens } from "./browse";
import { clearLens, pick } from "./commands";

type Duplicates = Extract<Lens, { kind: "duplicates" }>;

/** Groups and spare copies, once they are counted. */
function DuplicatesSummary({ lens }: { lens: Duplicates }) {
  if (!lens.groups) return <span className="text-xs text-muted-foreground">正在比对…</span>;
  const extras = extraCopies(lens.groups);
  return (
    <>
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums" data-testid="duplicate-summary">
        {lens.groups.length === 0 ? "没有重复" : `${lens.groups.length} 组，多出 ${extras.length} 个副本`}
      </span>
      {extras.length > 0 ? (
        // Each group keeps its first file: the most pixels, then the higher
        // rating, the bigger file, the older one.
        <Button variant="secondary" onClick={() => pick(extras)}>
          选中多余副本
        </Button>
      ) : null}
    </>
  );
}

/** Takes the toolbar's place while the wall shows a lens instead of the search. */
export function LensBar({ lens, leading }: { lens: Lens; leading?: React.ReactNode }) {
  const viewing = useSession((s) => s.browse.viewing);
  const picking = useSession((s) => s.browse.picked.length > 0);
  // The viewer owns Esc while it is open, and a picked set is cleared first.
  useHotkey("escape", clearLens, { enabled: !viewing && !picking });

  return (
    <header data-tauri-drag-region className="flex h-12 shrink-0 items-center gap-2 px-6">
      {leading}
      {/* The heading spans the bar that the removed caption used to fill, so it
          carries the drag region itself: a press in the gap still moves the window. */}
      <h2 data-tauri-drag-region className="min-w-0 flex-1 truncate text-sm font-medium">
        {lens.kind === "similar" ? "相似素材" : "重复素材"}
      </h2>
      {lens.kind === "duplicates" ? <DuplicatesSummary lens={lens} /> : null}
      <Button variant="ghost" onClick={clearLens}>
        返回全部素材
      </Button>
    </header>
  );
}
