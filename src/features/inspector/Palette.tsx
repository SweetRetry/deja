import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { clearLens, patchFilter } from "@/features/browse/commands";
import type { Entry } from "@/lib/types";

/** Filtering by a color leaves any lens first, so the filter shows on the wall. */
function filterByColor(hex: string) {
  clearLens();
  patchFilter({ color: hex });
}

export function Palette({ entry }: { entry: Entry }) {
  const total = entry.colors.reduce((sum, color) => sum + color.share, 0) || 1;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-medium text-muted-foreground">主色</h3>
      {entry.colors.length > 0 ? (
        <div className="flex h-6 overflow-hidden rounded-sm" role="group" aria-label="主色，点击按该色筛选">
          {entry.colors.map((color) => (
            <Tooltip key={color.hex}>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={`按主色 ${color.hex} 筛选`}
                    onClick={() => filterByColor(color.hex)}
                    className="h-full basis-0 bg-(--swatch) transition-opacity hover:opacity-80"
                    style={{ "--swatch": color.hex, flexGrow: color.share / total } as React.CSSProperties}
                  />
                }
              />
              <TooltipContent>
                <span className="font-mono">{color.hex}</span>
                <span className="tabular-nums">{Math.round((color.share / total) * 100)}%</span>
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      ) : entry.indexed ? (
        <span className="text-xs text-subtle-foreground">—</span>
      ) : (
        <Skeleton className="h-6 w-full" />
      )}
    </section>
  );
}
