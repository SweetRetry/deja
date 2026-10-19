import { CaretRightIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { INDENT, type FolderRow } from "./folder-tree";

/** The chevron that opens or shuts a folder row, in the gutter left of it.
 *  It goes after the row in the DOM, so Tab reaches the row first. The caller
 *  gives the colours and the top offset, which follow its row's surface. */
export function TreeToggle({ row, onToggle, className }: { row: FolderRow; onToggle: () => void; className: string }) {
  return (
    <button
      type="button"
      aria-label={`${row.expanded ? "收起" : "展开"} ${row.name}`}
      aria-expanded={row.expanded}
      onClick={onToggle}
      style={{ left: 4 + row.depth * INDENT }}
      className={cn(
        "absolute flex size-5 items-center justify-center rounded-sm text-muted-foreground transition-colors focus-visible:ring-2",
        className,
      )}
    >
      <CaretRightIcon
        aria-hidden
        className={row.expanded ? "size-3 rotate-90 transition-transform" : "size-3 transition-transform"}
      />
    </button>
  );
}
