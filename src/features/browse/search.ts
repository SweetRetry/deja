// Searches whenever an input, the files or the model change. Input changes
// are what the user asked for and dim the wall while they run; the rest swap
// results in place.
import { toast } from "sonner";
import { RANKING_KEY, SORT_KEY, dispatch, session, watch, type Session } from "@/app/store";
import { api } from "@/lib/bridge";
import { humanError } from "@/lib/errors";
import { writeStored } from "@/lib/storage";
import { classify, type SearchInputs } from "./search-intent";

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

const COPIES_DEBOUNCE = 1000;

/** Compares the vault for copies whenever its files change, so the sidebar
 *  can count them and the duplicates view opens on an answer. A file just
 *  indexed brings the hash that finds its near copies. */
function countCopies(): () => void {
  return watch(
    (s) => [s.vault.library?.root ?? null, s.vault.revision] as const,
    ([root]) => {
      if (!root) return;
      const timer = setTimeout(() => {
        api
          .duplicates()
          .then(({ groups }) => dispatch({ type: "DUPLICATES_RESULTS", root, groups }))
          .catch(() => undefined);
      }, COPIES_DEBOUNCE);
      return () => clearTimeout(timer);
    },
  );
}

const selectInputs = (s: Session) =>
  [
    s.vault.library?.root ?? null,
    s.browse.query,
    s.browse.filter,
    s.browse.sort,
    s.browse.ranking,
    s.vault.settings?.semantic ?? false,
    s.vault.modelEpoch,
    s.vault.revision,
  ] as const;

const inputsOf = ([root, query, filter, sort, ranking, semantic, modelEpoch, revision]: ReturnType<
  typeof selectInputs
>): SearchInputs => ({ root, query, filter, sort, ranking, semantic, modelEpoch, revision });

export function startSearch(): () => void {
  const stopSearch = watch(
    selectInputs,
    (next, previous) => {
      if (!next[0]) return;
      // A newly opened folder already shows its files, so its first search is
      // quiet too; it applies the stored sort and counts the color swatches.
      // Picking a folder in the sidebar is navigation, not typing: it searches
      // at once and swaps the wall without dimming it first.
      const intent = classify(previous && inputsOf(previous), inputsOf(next));
      if (intent === "navigated") {
        void search(true);
        return;
      }
      const timer = setTimeout(() => void search(intent === "quiet"), DEBOUNCE);
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
  const stopCopies = countCopies();
  return () => {
    stopSearch();
    stopPersist();
    stopCopies();
  };
}
