// How this window looks. Only the frontend reads it, so it lives in
// localStorage; stored values are checked field by field because they may
// predate a field or be hand-edited.
import { create } from "zustand";
import { readStored, writeStored } from "@/lib/storage";

export type Layout = "masonry" | "grid";
export type ThumbSize = "small" | "medium" | "large";
export type Theme = "system" | "light" | "dark";
/** What the wall does with a semantic result scored under `minMatch`. */
export type BelowMatch = "dim" | "hide";

export type Preferences = {
  theme: Theme;
  layout: Layout;
  size: ThumbSize;
  showNames: boolean;
  /** Folders with no image or video at any depth still get a sidebar row. */
  showEmptyFolders: boolean;
  inspectorWidth: number;
  /** Lowest match (0–100) a semantic result needs to count; 0 lets every result through. */
  minMatch: number;
  belowMatch: BelowMatch;
};

/** Column width each size asks the wall for, in px. */
export const THUMB_WIDTH: Record<ThumbSize, number> = { small: 120, medium: 168, large: 232 };

export const INSPECTOR = { min: 280, max: 480, initial: 320 };

const KEY = "deja.view";
const DEFAULTS: Preferences = {
  theme: "dark",
  layout: "masonry",
  size: "medium",
  showNames: false,
  showEmptyFolders: true,
  inspectorWidth: INSPECTOR.initial,
  minMatch: 0,
  belowMatch: "dim",
};

function read(): Preferences {
  try {
    const stored = JSON.parse(readStored(KEY) ?? "{}") as Partial<Preferences>;
    const width = Number(stored.inspectorWidth);
    const minMatch = Number(stored.minMatch);
    return {
      theme: stored.theme === "system" || stored.theme === "light" ? stored.theme : DEFAULTS.theme,
      layout: stored.layout === "grid" ? "grid" : DEFAULTS.layout,
      size: stored.size === "small" || stored.size === "large" ? stored.size : DEFAULTS.size,
      showNames: stored.showNames === true,
      showEmptyFolders: stored.showEmptyFolders !== false,
      inspectorWidth: width >= INSPECTOR.min && width <= INSPECTOR.max ? width : DEFAULTS.inspectorWidth,
      minMatch: minMatch >= 0 && minMatch <= 100 ? minMatch : DEFAULTS.minMatch,
      belowMatch: stored.belowMatch === "hide" ? "hide" : DEFAULTS.belowMatch,
    };
  } catch {
    return DEFAULTS;
  }
}

export const usePreferences = create<Preferences>()(read);

/** `persist: false` while a value is still moving (a drag); the last call stores it. */
export function setPreferences(part: Partial<Preferences>, persist = true) {
  usePreferences.setState(part);
  if (persist) writeStored(KEY, JSON.stringify(usePreferences.getState()));
}

const darkQuery = () => window.matchMedia("(prefers-color-scheme: dark)");

function applyTheme(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && darkQuery().matches);
  document.documentElement.classList.toggle("dark", dark);
}

/** Applies the theme now (before the first paint) and keeps following it, and
 *  the system while it is set to follow the system. */
export function startTheme(): () => void {
  const apply = () => applyTheme(usePreferences.getState().theme);
  apply();
  const query = darkQuery();
  query.addEventListener("change", apply);
  const unsubscribe = usePreferences.subscribe((next, previous) => {
    if (next.theme !== previous.theme) apply();
  });
  return () => {
    query.removeEventListener("change", apply);
    unsubscribe();
  };
}

/** A result the model scored under the lowest match the user accepts. Results
 *  without a model score (keyword ranking, the similar view) are never below. */
export const isBelowMatch = (match: number | null | undefined, minMatch: number) =>
  match != null && match < minMatch;
