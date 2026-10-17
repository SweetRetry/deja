// One place that knows what "filtering" means, so the toolbar chips, the reset
// button, the empty state and locate all agree.
import { COLOR_PRESETS, emptyFilter, type Filter } from "../../lib/types.ts";

/** Filters the user narrows with; the folder and tag scope the view instead. */
export function narrowing(filter: Filter) {
  return {
    kind: filter.kinds[0] ?? "",
    rating: filter.minRating,
    color: filter.color,
    width: filter.minWidth,
  };
}

export function isFiltering(filter: Filter): boolean {
  const { kind, rating, color, width } = narrowing(filter);
  return kind !== "" || rating > 0 || color !== "" || width > 0;
}

/** Drops every narrowing filter and keeps where the view is scoped. */
export function clearNarrowing(filter: Filter): Filter {
  return { ...emptyFilter, folder: filter.folder, tag: filter.tag };
}

/** No query and nothing narrowing: the wall is a folder as it is on disk. */
export function isPlainFolder(query: string, filter: Filter): boolean {
  return query.trim() === "" && !isFiltering(filter) && filter.tag === "";
}

export function colorName(hex: string): string | null {
  return COLOR_PRESETS.find((preset) => preset.hex.toLowerCase() === hex.toLowerCase())?.label ?? null;
}
