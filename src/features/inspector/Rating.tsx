import { StarIcon } from "@phosphor-icons/react";
import { useSession } from "@/app/store";
import { useHotkey } from "@/lib/use-hotkey";
import { cn } from "@/lib/utils";
import { editMeta } from "./commands";

const STARS = [1, 2, 3, 4, 5];

/** Keys 1–5 rate and 0 clears, while no text field has focus, so a run of
 *  pictures can be rated without leaving the keyboard. */
export function useRatingKeys(relPath: string | null) {
  const rate = (rating: number) => {
    if (relPath) void editMeta(relPath, { rating });
  };
  useHotkey("0", () => rate(0));
  useHotkey("1", () => rate(1));
  useHotkey("2", () => rate(2));
  useHotkey("3", () => rate(3));
  useHotkey("4", () => rate(4));
  useHotkey("5", () => rate(5));
}

export function Rating({ relPath }: { relPath: string }) {
  const rating = useSession((s) => s.vault.library?.byPath[relPath]?.rating ?? 0);
  useRatingKeys(relPath);
  return (
    <span className="-ml-1 flex" role="group" aria-label={rating ? `${rating} 星` : "未评分"}>
      {STARS.map((value) => (
        <button
          key={value}
          type="button"
          aria-label={`评为 ${value} 星`}
          aria-pressed={rating >= value}
          onClick={() => void editMeta(relPath, { rating: rating === value ? 0 : value })}
          className={cn(
            "inline-flex size-6 items-center justify-center rounded-sm transition-colors",
            rating >= value ? "text-foreground" : "text-subtle-foreground hover:text-muted-foreground",
          )}
        >
          <StarIcon size={14} weight="fill" aria-hidden />
        </button>
      ))}
    </span>
  );
}
