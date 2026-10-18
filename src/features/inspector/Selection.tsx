import { ArrowBendUpRightIcon, TrashIcon } from "@phosphor-icons/react";
import { useMoveTargets, usePicked } from "@/app/selectors";
import { useSession } from "@/app/store";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { clearPicked, moveEntries, trashEntries } from "@/features/browse/commands";
import { thumbUrl } from "@/lib/bridge";
import { formatBytes } from "./format";

const STACK = 9;

const HINTS: [string[], string][] = [
  [["⌘", "点按"], "加选或取消"],
  [["⌘", "A"], "全选"],
  [["Esc"], "取消选择"],
];

/** The inspector while several files are picked: what they are, and what can
 *  be done to all of them at once. */
export function Selection() {
  const picked = usePicked();
  const byPath = useSession((s) => s.vault.library?.byPath);
  const targets = useMoveTargets();
  const entries = picked.flatMap((path) => byPath?.[path] ?? []);
  const bytes = entries.reduce((sum, entry) => sum + entry.sizeBytes, 0);

  return (
    <aside className="relative isolate h-full w-full" aria-label="检视面板" data-picked-count={picked.length}>
      <div
        data-tauri-drag-region
        className="absolute inset-x-0 top-0 z-20 flex h-12 items-center gap-2 bg-sidebar/85 px-6 backdrop-blur"
      >
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground tabular-nums">
          已选 {picked.length} 项
        </h2>
        <span className="shrink-0 text-xs text-subtle-foreground tabular-nums">{formatBytes(bytes)}</span>
      </div>
      <div className="flex h-full flex-col gap-6 overflow-y-auto px-6 pt-16 pb-6">
        <div className="grid grid-cols-3 gap-2">
          {entries.slice(0, STACK).map((entry) => (
            <img
              key={entry.relPath}
              src={thumbUrl(entry)}
              alt={entry.name}
              className="aspect-square w-full rounded-sm bg-surface-1 object-cover"
            />
          ))}
        </div>
        {entries.length > STACK ? (
          <p className="-mt-4 text-xs text-muted-foreground tabular-nums">另有 {entries.length - STACK} 项</p>
        ) : null}

        <div className="flex flex-col gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="secondary" className="w-full" />}>
              <ArrowBendUpRightIcon aria-hidden />
              移动到…
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-(--anchor-width)">
              {targets.map((target) => (
                <DropdownMenuItem
                  key={target.rel}
                  style={{ paddingLeft: 8 + target.depth * 12 }}
                  onClick={() => void moveEntries(picked, target.rel)}
                >
                  <span className="truncate">{target.name}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="destructive" className="w-full" onClick={() => void trashEntries(picked)}>
            <TrashIcon aria-hidden />
            移到废纸篓
          </Button>
          <Button variant="ghost" className="w-full" onClick={clearPicked}>
            取消选择
          </Button>
        </div>

        <dl className="flex flex-col gap-2 text-xs text-muted-foreground">
          {HINTS.map(([keys, what]) => (
            <div key={what} className="flex items-center gap-3">
              <dt className="flex w-16 shrink-0 gap-1">
                {keys.map((key) => (
                  <Kbd key={key}>{key}</Kbd>
                ))}
              </dt>
              <dd>{what}</dd>
            </div>
          ))}
        </dl>
      </div>
    </aside>
  );
}
