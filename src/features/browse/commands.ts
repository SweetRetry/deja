import { toast } from "sonner";
import { dispatch, session } from "@/app/store";
import { api } from "@/lib/bridge";
import { humanError } from "@/lib/errors";
import { ellipsize } from "@/lib/utils";
import type { Filter, Ranking, Sort } from "@/lib/types";
import { shownPaths } from "./browse";
import { clearNarrowing } from "./filter";

export const setQuery = (query: string) => dispatch({ type: "QUERY", query });
export const setFilter = (filter: Filter) => dispatch({ type: "FILTER", filter });
export const patchFilter = (part: Partial<Filter>) => setFilter({ ...session().browse.filter, ...part });
export const clearFilters = () => setFilter(clearNarrowing(session().browse.filter));
export const setSort = (sort: Sort) => dispatch({ type: "SORT", sort });
export const setRanking = (ranking: Ranking) => dispatch({ type: "RANKING", ranking });

/** `reveal` scrolls the wall to the tile, for selections made away from it (keys, the viewer). */
export const select = (relPath: string, reveal = false) => dispatch({ type: "SELECT", relPath, reveal });

/** Selects a file and scrolls to it, clearing whatever search or filter hides it. */
export const locate = (relPath: string) => dispatch({ type: "LOCATE", relPath });

export async function findSimilar(source: string) {
  dispatch({ type: "SIMILAR_REQUESTED", source });
  try {
    const { results } = await api.similar(source);
    dispatch({ type: "SIMILAR_RESULTS", source, paths: results.map((row) => row.relPath) });
  } catch (problem) {
    dispatch({ type: "SIMILAR_FAILED", source });
    toast.error(humanError(problem));
  }
}

export const clearLens = () => dispatch({ type: "LENS_CLEARED" });

/** Opens the duplicates view. The copies are usually already counted in the
 *  background; only a vault not yet compared waits for an answer. */
export async function findDuplicates() {
  dispatch({ type: "DUPLICATES_REQUESTED" });
  const root = session().vault.library?.root;
  if (!root || session().browse.copies) return;
  try {
    const { groups } = await api.duplicates();
    dispatch({ type: "DUPLICATES_RESULTS", root, groups });
  } catch (problem) {
    dispatch({ type: "DUPLICATES_FAILED" });
    toast.error(humanError(problem));
  }
}

/** A click on a tile: ⌘ adds or removes it, plain selects it alone. */
export function clickTile(relPath: string, event: { metaKey: boolean; ctrlKey: boolean }) {
  if (event.metaKey || event.ctrlKey) dispatch({ type: "PICK_TOGGLE", relPath });
  else select(relPath);
}

export const pick = (relPaths: string[]) => dispatch({ type: "PICK", relPaths });
export const pickAll = () => pick(shownPaths(session().browse) ?? []);
/** Back to the focused file alone. */
export const clearPicked = () => pick([]);

const nameOf = (relPath: string) => ellipsize(session().vault.library?.byPath[relPath]?.name ?? relPath.split("/").pop() ?? "");
const folderName = (folder: string) => folder.split("/").pop() || session().vault.library?.root.split("/").pop() || "根目录";

/** Moves files to the system Trash. The Trash is the undo, so there is no
 *  confirmation: the tiles leave the wall and the toast says where they went.
 *  They leave before Finder answers, which takes a moment; the rescan after it
 *  brings back any file that did not go. */
export async function trashEntries(relPaths: string[]) {
  if (relPaths.length === 0) return;
  dispatch({ type: "ENTRIES_REMOVED", relPaths });
  try {
    const { trashed, error, view } = await api.trash(relPaths);
    dispatch({ type: "RESCANNED", view });
    const what = trashed.length === 1 ? `「${nameOf(trashed[0] ?? "")}」` : ` ${trashed.length} 项素材`;
    if (error) {
      toast.error(`有 ${relPaths.length - trashed.length} 项没能移到废纸篓`, { description: humanError(error) });
    } else {
      toast.success(`已将${what}移到废纸篓`);
    }
  } catch (problem) {
    toast.error(humanError(problem));
    const view = await api.refresh().catch(() => null);
    if (view) dispatch({ type: "RESCANNED", view });
  }
}

/** Moves files into another folder of the vault; tags and thumbnails go along. */
export async function moveEntries(relPaths: string[], folder: string) {
  if (relPaths.length === 0) return;
  try {
    const { moved, view } = await api.move(relPaths, folder);
    dispatch({ type: "ENTRIES_MOVED", moved });
    dispatch({ type: "RESCANNED", view });
    const where = `「${folderName(folder)}」`;
    if (moved.length === 0) {
      toast(`已经在${where}里了`);
      return;
    }
    const what = moved.length === 1 ? `「${nameOf(moved[0]?.to ?? "")}」` : ` ${moved.length} 项素材`;
    toast.success(`已将${what}移到${where}`);
  } catch (problem) {
    toast.error(humanError(problem));
  }
}
/** Makes an empty folder and opens it, so files can be moved or dropped in
 *  next. False when it was refused; the toast says why. */
export async function createFolder(parent: string, name: string): Promise<boolean> {
  try {
    const { folder, view } = await api.createFolder(parent, name);
    dispatch({ type: "RESCANNED", view });
    clearLens();
    patchFilter({ folder });
    return true;
  } catch (problem) {
    toast.error(humanError(problem));
    return false;
  }
}

export const openViewer = () => dispatch({ type: "VIEWER", open: true });
export const closeViewer = () => dispatch({ type: "VIEWER", open: false });
