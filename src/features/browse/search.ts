// Searches whenever an input, the files or the model change. Input changes
// are what the user asked for and dim the wall while they run; the rest swap
// results in place.
import { toast } from "sonner";
import { RANKING_KEY, SORT_KEY, dispatch, session, watch } from "@/app/store";
import { api } from "@/lib/bridge";
import { humanError } from "@/lib/errors";
import { writeStored } from "@/lib/storage";

const DEBOUNCE = 160;

async function search(quiet: boolean) {
  dispatch({ type: "SEARCH_STARTED", quiet });
  const { request, query, filter, sort, ranking } = session().browse;
  try {
    const response = await api.search(query, filter, sort, ranking === "semantic");
    dispatch({ type: "RESULTS", request, response });
  } catch (problem) {
    dispatch({ type: "SEARCH_FAILED", request });
    if (session().browse.request === request) toast.error(humanError(problem), { id: "search" });
  }
}

export function startSearch(): () => void {
  const stopSearch = watch(
    (s) =>
      [
        s.vault.library?.root ?? null,
        s.browse.query,
        s.browse.filter,
        s.browse.sort,
        s.browse.ranking,
        s.vault.settings?.semantic ?? false,
        s.vault.modelEpoch,
        s.vault.revision,
      ] as const,
    (next, previous) => {
      const [root] = next;
      if (!root) return;
      // A newly opened folder already shows its files, so its first search is
      // quiet too; it applies the stored sort and counts the color swatches.
      const asked =
        previous !== null &&
        previous[0] === root &&
        next.slice(1, 5).some((value, index) => !Object.is(value, previous[index + 1]));
      const timer = setTimeout(() => void search(!asked), DEBOUNCE);
      return () => clearTimeout(timer);
    },
  );
  const stopPersist = watch(
    (s) => [s.browse.sort, s.browse.ranking] as const,
    ([sort, ranking]) => {
      writeStored(SORT_KEY, sort);
      writeStored(RANKING_KEY, ranking);
    },
  );
  return () => {
    stopSearch();
    stopPersist();
  };
}
