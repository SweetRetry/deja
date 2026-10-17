import { useSession } from "@/app/store";
import { Button } from "@/components/ui/button";
import { clearFilters, setQuery } from "./commands";
import { emptyState } from "./empty-state";

/** Fills the wall's area and clears the 48px header floating over it. */
export function EmptyWall() {
  const query = useSession((s) => s.browse.query);
  const filter = useSession((s) => s.browse.filter);
  const folderTotal = useSession((s) => s.vault.library?.counts[s.browse.filter.folder] ?? 0);
  const { title, body, action } = emptyState({ query, filter, folderTotal });

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 pt-12 pb-8 text-center">
      <div className="flex max-w-sm flex-col gap-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground">{body}</p>
      </div>
      {action === "clear-search" ? (
        <Button variant="secondary" onClick={() => setQuery("")}>
          清除搜索
        </Button>
      ) : action === "clear-filters" ? (
        <Button variant="secondary" onClick={clearFilters}>
          重置筛选
        </Button>
      ) : action === "clear-both" ? (
        <Button
          variant="secondary"
          onClick={() => {
            setQuery("");
            clearFilters();
          }}
        >
          清除搜索与筛选
        </Button>
      ) : null}
    </div>
  );
}
