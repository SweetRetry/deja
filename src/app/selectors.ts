// Read hooks shared across features. Components subscribe to the narrowest
// value they render, so typing in the search box does not re-render the
// inspector or the sidebar.
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { shownPaths } from "@/features/browse/browse";
import { belowMatch, usePreferences } from "@/features/settings/preferences";
import { moveTargets } from "@/features/sidebar/folder-tree";
import type { Entry } from "@/lib/types";
import { useSession } from "./store";

const NONE: Entry[] = [];

/** The tiles on the wall, in order: the lens when one is up, else the
 *  results, less any the user hides for scoring under the lowest match. */
export function useWallEntries(): Entry[] {
  const hideUnder = usePreferences((p) => (p.belowMatch === "hide" ? p.minMatch : 0));
  return useSession(
    useShallow((s) => {
      const byPath = s.vault.library?.byPath;
      const paths = shownPaths(s.browse);
      if (!byPath || !paths) return NONE;
      const scores = s.browse.lens ? undefined : s.browse.results.scores;
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

/** True while the wall's tiles are on their way: a folder opening, or a lens loading. */
export const useWallLoading = () => useSession((s) => s.vault.phase === "opening" || shownPaths(s.browse) === null);

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

/** Every folder of the vault a file can move into, for "移动到". */
export function useMoveTargets() {
  const folders = useSession((s) => s.vault.library?.folders);
  const root = useSession((s) => s.vault.library?.root ?? "");
  return useMemo(() => moveTargets(folders ?? [], root.split("/").pop() || "根目录"), [folders, root]);
}

/** The picked files, in the order they were picked; empty with one file chosen. */
export const usePicked = () => useSession((s) => s.browse.picked);
