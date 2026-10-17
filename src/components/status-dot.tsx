import { cn } from "@/lib/utils";

type Tone = "success" | "warning" | "muted";

/** Status is a dot plus a word, never a badge. */
export function StatusDot({ tone }: { tone: Tone }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-1.5 rounded-full",
        tone === "success" && "bg-success",
        tone === "warning" && "bg-warning",
        tone === "muted" && "bg-subtle-foreground",
      )}
    />
  );
}
