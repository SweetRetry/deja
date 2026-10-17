import { AnimatePresence, motion } from "motion/react";
import { XIcon } from "@phosphor-icons/react";
import { useSession } from "@/app/store";
import { patchFilter } from "./commands";
import { narrowing } from "./filter";

type Chip = { id: string; label: string; text: string; remove: () => void; swatch?: string };

/** Active narrowing filters, removable in place without reopening the panel. */
export function FilterChips() {
  const filter = useSession((s) => s.browse.filter);
  const { kind, rating, color } = narrowing(filter);
  const kindText = kind === "video" ? "视频" : "图片";

  const chips: Chip[] = [];
  if (kind) chips.push({ id: "kind", label: `移除筛选：${kindText}`, text: kindText, remove: () => patchFilter({ kinds: [] }) });
  if (rating > 0) {
    chips.push({
      id: "rating",
      label: `移除筛选：${rating} 星及以上`,
      text: rating === 5 ? "5 星" : `${rating} 星+`,
      remove: () => patchFilter({ minRating: 0 }),
    });
  }
  if (color) chips.push({ id: "color", label: "移除筛选：主色", text: "主色", swatch: color, remove: () => patchFilter({ color: "" }) });

  // Relative so a leaving chip, lifted out of the flow by popLayout, keeps its place while the rest slide over.
  return (
    <div className="relative flex shrink-0 items-center gap-2">
      <AnimatePresence mode="popLayout" initial={false}>
        {chips.map((chip) => (
          <motion.button
            key={chip.id}
            layout
            type="button"
            aria-label={chip.label}
            onClick={chip.remove}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-surface-2 pr-2 pl-2.5 text-sm text-foreground transition-colors hover:bg-surface-3"
          >
            {chip.swatch ? (
              <span
                aria-hidden
                className="size-3 rounded-full border border-border bg-(--swatch)"
                style={{ "--swatch": chip.swatch } as React.CSSProperties}
              />
            ) : null}
            <span className="tabular-nums">{chip.text}</span>
            <XIcon size={12} aria-hidden className="text-muted-foreground" />
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}
