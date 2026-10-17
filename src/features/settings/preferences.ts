// How this window looks. Only the frontend reads it, so it lives in
// localStorage; stored values are checked field by field because they may
// predate a field or be hand-edited.
import { create } from "zustand";
import { readStored, writeStored } from "@/lib/storage";

export type Layout = "masonry" | "grid";
export type ThumbSize = "small" | "medium" | "large";
export type Theme = "system" | "light" | "dark";

export type Preferences = {
  theme: Theme;
  layout: Layout;
  size: ThumbSize;
  showNames: boolean;
  inspectorWidth: number;
};

/** Column width each size asks the wall for, in px. */
export const THUMB_WIDTH: Record<ThumbSize, number> = { small: 120, medium: 168, large: 232 };

export const INSPECTOR = { min: 280, max: 480, initial: 320 };

const KEY = "shelf.view";
const DEFAULTS: Preferences = {
  theme: "dark",
  layout: "masonry",
  size: "medium",
  showNames: false,
  inspectorWidth: INSPECTOR.initial,
};

function read(): Preferences {
  try {
    const stored = JSON.parse(readStored(KEY) ?? "{}") as Partial<Preferences>;
    const width = Number(stored.inspectorWidth);
    return {
      theme: stored.theme === "system" || stored.theme === "light" ? stored.theme : DEFAULTS.theme,
      layout: stored.layout === "grid" ? "grid" : DEFAULTS.layout,
      size: stored.size === "small" || stored.size === "large" ? stored.size : DEFAULTS.size,
      showNames: stored.showNames === true,
      inspectorWidth: width >= INSPECTOR.min && width <= INSPECTOR.max ? width : DEFAULTS.inspectorWidth,
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
