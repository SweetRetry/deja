// Read hooks shared across features. Components subscribe to the narrowest
// value they render, so typing in the search box does not re-render the
// inspector or the sidebar.
import { useShallow } from "zustand/react/shallow";
import { belowMatch, usePreferences } from "@/features/settings/preferences";
import type { Entry } from "@/lib/types";
import { useSession, type Session } from "./store";

const NONE: Entry[] = [];

function wallPaths(s: Session): string[] | null {
  const { similar, results } = s.browse;
  return similar ? similar.paths : results.paths;
}

/** The tiles on the wall, in order: the similar view when it is up, else the
 *  results, less any the user hides for scoring under the lowest match. */
export function useWallEntries(): Entry[] {
  const hideUnder = usePreferences((p) => (p.belowMatch === "hide" ? p.minMatch : 0));
  return useSession(
    useShallow((s) => {
      const byPath = s.vault.library?.byPath;
      const paths = wallPaths(s);
      if (!byPath || !paths) return NONE;
      const scores = s.browse.similar ? undefined : s.browse.results.scores;
      return paths.flatMap((path) =>
        belowMatch(scores?.[path]?.match, hideUnder) ? [] : (byPath[path] ?? []),
      );
    }),
  );
}

/** The folder this window shows. The path is known the moment an open starts,
 *  before the scan answers, so the shell can take its final shape on the first
 *  paint instead of growing a column when the files arrive. */
export const useVaultPath = () =>
  useSession((s) => s.vault.library?.root ?? (s.vault.phase === "opening" ? s.vault.path : null));

/** True while the wall's tiles are on their way: a folder opening, or a similar view loading. */
export const useWallLoading = () =>
  useSession((s) => s.vault.phase === "opening" || (s.browse.similar !== null && s.browse.similar.paths === null));

export const useSelectedEntry = (): Entry | null =>
  useSession((s) => (s.browse.selected ? (s.vault.library?.byPath[s.browse.selected] ?? null) : null));

export const useRoot = () => useSession((s) => s.vault.library?.root ?? null);

/** The folder a drop lands in, as the user reads it; null while nothing is open. */
export const useDropTarget = () =>
  useSession((s) => {
    const root = s.vault.library?.root;
    if (!root) return null;
    return s.browse.filter.folder.split("/").pop() || root.split("/").pop() || root;
  });

export const useSemanticEnabled = () => useSession((s) => s.vault.settings?.semantic ?? false);
