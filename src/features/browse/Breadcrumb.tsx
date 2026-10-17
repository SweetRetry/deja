import { CaretRightIcon } from "@phosphor-icons/react";
import { useSession } from "@/app/store";
import { cn } from "@/lib/utils";
import { patchFilter } from "./commands";

/** Where the wall is scoped: the vault root, then each folder down to the
 *  current one. Ancestors navigate up; the last crumb is the current view. */
export function Breadcrumb() {
  const folder = useSession((s) => s.browse.filter.folder);
  const count = useSession((s) => s.browse.results.paths.length);
  const parts = folder ? folder.split("/") : [];
  const crumbs = [
    { rel: "", name: "全部素材" },
    ...parts.map((name, i) => ({ rel: parts.slice(0, i + 1).join("/"), name })),
  ];

  return (
    <div data-tauri-drag-region className="flex min-w-0 flex-1 items-center gap-2">
      <nav data-tauri-drag-region aria-label="当前位置" className="min-w-0 shrink">
        <ol data-tauri-drag-region className="flex min-w-0 items-center gap-1 text-sm">
          {crumbs.map((crumb, i) => {
            const last = i === crumbs.length - 1;
            return (
              <li key={crumb.rel} className={cn("flex min-w-0 items-center gap-1", last ? "shrink" : "shrink-[2]")}>
                {i > 0 ? <CaretRightIcon size={12} aria-hidden className="shrink-0 text-subtle-foreground" /> : null}
                {last ? (
                  <span aria-current="page" className="truncate font-medium text-foreground">
                    {crumb.name}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => patchFilter({ folder: crumb.rel })}
                    className="truncate rounded-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {crumb.name}
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
      <span data-tauri-drag-region className="shrink-0 text-xs text-subtle-foreground tabular-nums">
        {count} 项
      </span>
    </div>
  );
}
