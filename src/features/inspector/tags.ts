import type { Entry } from "@/lib/types";

let lastSource: Record<string, Entry> | undefined;
let lastRanked: string[] = [];

const NONE: string[] = [];

/** Every tag in the vault, most used first. Memoized on the `byPath` identity,
 *  so a store selector can return it without a new array per update. */
export function tagsByUse(byPath: Record<string, Entry> | undefined): string[] {
  if (!byPath) return NONE;
  if (byPath === lastSource) return lastRanked;
  const counts = new Map<string, number>();
  for (const entry of Object.values(byPath)) {
    for (const tag of entry.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  lastSource = byPath;
  lastRanked = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag]) => tag);
  return lastRanked;
}
