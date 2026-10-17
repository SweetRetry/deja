import { useCallback, useEffect, useState } from "react";
import { api } from "./bridge";

export type Layout = "masonry" | "grid";
export type ThumbSize = "small" | "medium" | "large";
export type Theme = "system" | "light" | "dark";

/** How this window looks. Only the frontend reads it, so it lives in localStorage. */
export type View = { theme: Theme; layout: Layout; size: ThumbSize; showNames: boolean };

/** What the backend acts on: the model process and the folder scan. It lives
 *  in settings.json under the app's data dir (settings.rs). */
export type AppSettings = { semantic: boolean; modelIdleSecs: number; ignored: string[] };

/** Column width each size asks the wall for, in px. */
export const THUMB_WIDTH: Record<ThumbSize, number> = { small: 120, medium: 168, large: 232 };

const VIEW_KEY = "shelf.view";
const DEFAULT_VIEW: View = { theme: "dark", layout: "masonry", size: "medium", showNames: false };

/** Stored preferences may predate a field or be hand-edited; keep only known values. */
export function readView(): View {
  try {
    const stored = JSON.parse(localStorage.getItem(VIEW_KEY) ?? "{}") as Partial<View>;
    return {
      theme: stored.theme === "system" || stored.theme === "light" ? stored.theme : DEFAULT_VIEW.theme,
      layout: stored.layout === "grid" ? "grid" : DEFAULT_VIEW.layout,
      size: stored.size === "small" || stored.size === "large" ? stored.size : DEFAULT_VIEW.size,
      showNames: stored.showNames === true,
    };
  } catch {
    return DEFAULT_VIEW;
  }
}

export function writeView(view: View) {
  localStorage.setItem(VIEW_KEY, JSON.stringify(view));
}

const darkQuery = () => window.matchMedia("(prefers-color-scheme: dark)");

export function applyTheme(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && darkQuery().matches);
  document.documentElement.classList.toggle("dark", dark);
}

/** Applies the theme and, while it follows the system, tracks the system. */
export function useTheme(theme: Theme) {
  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const query = darkQuery();
    const follow = () => applyTheme("system");
    query.addEventListener("change", follow);
    return () => query.removeEventListener("change", follow);
  }, [theme]);
}

/** Null until the backend answers, so nothing starts the model on a guess. */
export function useAppSettings() {
  const [settings, setSettings] = useState<AppSettings | null>(null);

  useEffect(() => {
    void api.settings().then(setSettings).catch(() => undefined);
  }, []);

  // Shown at once; the backend's normalized copy (trimmed, deduplicated
  // folder names) replaces it, and a failed write falls back to what is stored.
  const save = useCallback(async (next: AppSettings) => {
    setSettings(next);
    try {
      setSettings(await api.saveSettings(next));
    } catch {
      setSettings(await api.settings().catch(() => null));
    }
  }, []);

  return { settings, save };
}
