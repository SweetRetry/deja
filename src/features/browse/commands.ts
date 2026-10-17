import { toast } from "sonner";
import { dispatch, session } from "@/app/store";
import { api } from "@/lib/bridge";
import { humanError } from "@/lib/errors";
import type { Filter, Ranking, Sort } from "@/lib/types";
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

export const clearSimilar = () => dispatch({ type: "SIMILAR_CLEARED" });
export const openViewer = () => dispatch({ type: "VIEWER", open: true });
export const closeViewer = () => dispatch({ type: "VIEWER", open: false });
