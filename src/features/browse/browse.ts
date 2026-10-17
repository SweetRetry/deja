// What the wall shows: the inputs (query, filter, sort, ranking), the answer
// that last landed, the selection, and the similar-to view that can replace it.
// Results only land for the latest request, so typing fast never lets an older
// answer overwrite a newer one.
import { emptyFilter, type Filter, type Ranking, type SearchScore, type Sort, type VaultView } from "../../lib/types.ts";
import type { SessionEvent } from "../vault/events.ts";
import { isPlainFolder } from "./filter.ts";

export type Results = {
  paths: string[];
  scores: Record<string, SearchScore>;
  /** Files each color swatch would leave, given the other filters. */
  colorCounts: number[];
  /** True when the model ranked this answer. */
  semantic: boolean;
};

/** A request for the wall to bring a tile into view; the nonce repeats it. */
export type Reveal = { relPath: string; nonce: number; align: "center" | "nearest" };

export type BrowseState = {
  query: string;
  filter: Filter;
  sort: Sort;
  ranking: Ranking;
  results: Results;
  /** Id of the latest search; only its answer may land. */
  request: number;
  /** A search the user asked for is in flight; the wall fades its stale results. */
  pending: boolean;
  selected: string | null;
  reveal: Reveal | null;
  /** Files ranked by likeness to `source`; null paths while they load. */
  similar: { source: string; paths: string[] | null } | null;
  /** The selected file is open full size. */
  viewing: boolean;
};

const noResults: Results = { paths: [], scores: {}, colorCounts: [], semantic: false };

export function initialBrowse(sort: Sort = "name", ranking: Ranking = "semantic"): BrowseState {
  return {
    query: "",
    filter: emptyFilter,
    sort,
    ranking,
    results: noResults,
    request: 0,
    pending: false,
    selected: null,
    reveal: null,
    similar: null,
    viewing: false,
  };
}

function fresh(browse: BrowseState, view: VaultView): BrowseState {
  return {
    ...initialBrowse(browse.sort, browse.ranking),
    // In-flight answers belong to the previous folder.
    request: browse.request + 1,
    results: { ...noResults, paths: view.entries.map((entry) => entry.relPath) },
    selected: view.entries[0]?.relPath ?? null,
  };
}

function parentOf(relPath: string): string {
  return relPath.split("/").slice(0, -1).join("/");
}

export function reduceBrowse(browse: BrowseState, event: SessionEvent): BrowseState {
  switch (event.type) {
    case "OPENED":
      return fresh(browse, event.view);

    case "CLOSE":
      return { ...initialBrowse(browse.sort, browse.ranking), request: browse.request + 1 };

    case "RESCANNED":
      // An import selects what just arrived, so the inspector shows it.
      if (!event.select) return browse;
      return { ...browse, selected: event.select, similar: null, viewing: false };

    case "QUERY":
      return { ...browse, query: event.query };

    case "FILTER":
      return { ...browse, filter: event.filter };

    case "SORT":
      return { ...browse, sort: event.sort };

    case "RANKING":
      return { ...browse, ranking: event.ranking };

    case "SEARCH_STARTED":
      return { ...browse, request: browse.request + 1, pending: event.quiet ? browse.pending : true };

    case "RESULTS": {
      if (event.request !== browse.request) return browse;
      const paths = event.response.entries.map((entry) => entry.relPath);
      // The inspector never goes blank: a selection the new results dropped
      // moves to the first result; with no results it stays where it was.
      const selected =
        browse.selected && paths.includes(browse.selected) ? browse.selected : (paths[0] ?? browse.selected);
      return {
        ...browse,
        pending: false,
        selected,
        results: {
          paths,
          scores: event.response.scores,
          colorCounts: event.response.colorCounts,
          semantic: event.response.semantic,
        },
      };
    }

    case "SEARCH_FAILED":
      if (event.request !== browse.request) return browse;
      return { ...browse, pending: false };

    case "SELECT":
      if (browse.selected === event.relPath && !event.reveal) return browse;
      return {
        ...browse,
        selected: event.relPath,
        reveal: event.reveal ? { relPath: event.relPath, nonce: (browse.reveal?.nonce ?? 0) + 1, align: "nearest" } : browse.reveal,
      };

    case "LOCATE": {
      // The view stays only when it is a plain folder holding the file; any
      // search or filter hiding it is cleared. Decided from the inputs, not the
      // results, which may still be in flight.
      const keep = isPlainFolder(browse.query, browse.filter) &&
        (browse.filter.folder === "" || event.relPath.startsWith(`${browse.filter.folder}/`));
      return {
        ...browse,
        similar: null,
        viewing: false,
        selected: event.relPath,
        reveal: { relPath: event.relPath, nonce: (browse.reveal?.nonce ?? 0) + 1, align: "center" },
        ...(keep ? {} : { query: "", filter: { ...emptyFilter, folder: parentOf(event.relPath) } }),
      };
    }

    case "SIMILAR_REQUESTED":
      return { ...browse, similar: { source: event.source, paths: null }, viewing: false };

    case "SIMILAR_RESULTS":
      if (browse.similar?.source !== event.source) return browse;
      return { ...browse, similar: { source: event.source, paths: event.paths } };

    case "SIMILAR_FAILED":
      if (browse.similar?.source !== event.source) return browse;
      return { ...browse, similar: null };

    case "SIMILAR_CLEARED":
      return browse.similar ? { ...browse, similar: null } : browse;

    case "VIEWER": {
      const viewing = event.open && browse.selected !== null;
      return viewing === browse.viewing ? browse : { ...browse, viewing };
    }

    default:
      return browse;
  }
}
