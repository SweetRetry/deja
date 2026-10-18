// What the wall shows: the inputs (query, filter, sort, ranking), the answer
// that last landed, the selection, and the lens (similar, duplicates) that can
// replace it.
// Results only land for the latest request, so typing fast never lets an older
// answer overwrite a newer one.
import {
  emptyFilter,
  type DuplicateGroup,
  type Filter,
  type Ranking,
  type SearchScore,
  type Sort,
  type VaultView,
} from "../../lib/types.ts";
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

/** A wall that replaces the search's: files like one, or copies of one
 *  picture by group. Null contents while they load. */
export type Lens =
  | { kind: "similar"; source: string; paths: string[] | null }
  | { kind: "duplicates"; groups: DuplicateGroup[] | null };

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
  /** The focused file: the inspector shows it, the viewer opens it, keys move it. */
  selected: string | null;
  /** Files picked with ⌘ or ⇧ for one action. Empty, or two or more that
   *  include `selected`; `normalize` holds that after every event. */
  picked: string[];
  reveal: Reveal | null;
  lens: Lens | null;
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
    picked: [],
    reveal: null,
    lens: null,
    viewing: false,
  };
}

/** The wall's files in order; null while a lens loads. */
export function shownPaths(browse: BrowseState): string[] | null {
  const { lens } = browse;
  if (!lens) return browse.results.paths;
  if (lens.kind === "similar") return lens.paths;
  return lens.groups?.flatMap((group) => group.paths) ?? null;
}

/** What an action applies to: the picked files, else the focused one. */
export function chosen(browse: BrowseState): string[] {
  if (browse.picked.length > 0) return browse.picked;
  return browse.selected ? [browse.selected] : [];
}

/** Every copy but the one to keep, in each group. */
export function extraCopies(groups: DuplicateGroup[]): string[] {
  return groups.flatMap((group) => group.paths.slice(1));
}

function withPicked(browse: BrowseState, paths: string[], focus: string | null): BrowseState {
  return { ...browse, picked: paths.length > 1 ? paths : [], selected: focus ?? paths[0] ?? browse.selected };
}

/** Holds the picked set's shape: only files on the wall, two or more of them,
 *  the focus among them. */
function normalize(browse: BrowseState): BrowseState {
  if (browse.picked.length === 0) return browse;
  const shown = new Set(shownPaths(browse) ?? []);
  const picked = browse.picked.filter((path) => shown.has(path));
  if (picked.length > 1 && picked.length === browse.picked.length && browse.selected && picked.includes(browse.selected)) {
    return browse;
  }
  if (picked.length < 2) return { ...browse, picked: [], selected: browse.selected ?? picked[0] ?? null };
  const selected = browse.selected && picked.includes(browse.selected) ? browse.selected : (picked.at(-1) ?? null);
  return { ...browse, picked, selected };
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
  const next = step(browse, event);
  return next === browse ? browse : normalize(next);
}

function step(browse: BrowseState, event: SessionEvent): BrowseState {
  switch (event.type) {
    case "OPENED":
      return fresh(browse, event.view);

    case "CLOSE":
      return { ...initialBrowse(browse.sort, browse.ranking), request: browse.request + 1 };

    case "RESCANNED":
      // An import selects what just arrived, so the inspector shows it.
      if (!event.select) return browse;
      return { ...browse, selected: event.select, picked: [], lens: null, viewing: false };

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
      if (browse.selected === event.relPath && browse.picked.length === 0 && !event.reveal) return browse;
      return {
        ...browse,
        selected: event.relPath,
        picked: [],
        reveal: event.reveal ? { relPath: event.relPath, nonce: (browse.reveal?.nonce ?? 0) + 1, align: "nearest" } : browse.reveal,
      };

    case "PICK_TOGGLE": {
      const current = chosen(browse);
      if (!current.includes(event.relPath)) return withPicked(browse, [...current, event.relPath], event.relPath);
      // The last file stays chosen: the inspector never goes blank.
      if (current.length === 1) return browse;
      const left = current.filter((path) => path !== event.relPath);
      return withPicked(browse, left, browse.selected === event.relPath ? (left.at(-1) ?? null) : browse.selected);
    }

    case "PICK_RANGE": {
      const shown = shownPaths(browse) ?? [];
      const from = browse.selected ? shown.indexOf(browse.selected) : -1;
      const to = shown.indexOf(event.relPath);
      if (to < 0) return browse;
      if (from < 0) return { ...browse, selected: event.relPath, picked: [] };
      // The focus stays the anchor, so the next ⇧-click redraws from it.
      const range = shown.slice(Math.min(from, to), Math.max(from, to) + 1);
      return withPicked(browse, range, browse.selected);
    }

    case "PICK":
      return withPicked(browse, event.relPaths, event.relPaths[0] ?? null);

    case "ENTRIES_REMOVED": {
      const removed = new Set(event.relPaths);
      const gone = (paths: string[]) => paths.filter((path) => !removed.has(path));
      const shown = shownPaths(browse) ?? [];
      const left = gone(shown);
      // The tile after the deleted ones takes the selection, else the one before;
      // deleting is usually a sweep, and the pointer should not have to travel.
      const hit = browse.selected !== null && removed.has(browse.selected);
      const at = hit ? gone(shown.slice(0, Math.max(0, shown.indexOf(browse.selected ?? "")))).length : 0;
      const { lens } = browse;
      return {
        ...browse,
        selected: hit ? (left[at] ?? left[at - 1] ?? null) : browse.selected,
        picked: gone(browse.picked),
        // A viewer can only show a file that still exists.
        viewing: browse.viewing && !hit,
        results: { ...browse.results, paths: gone(browse.results.paths) },
        lens:
          lens?.kind === "similar" && lens.paths
            ? { ...lens, paths: gone(lens.paths) }
            : lens?.kind === "duplicates" && lens.groups
              ? {
                  ...lens,
                  // A group down to one file has no copies left.
                  groups: lens.groups
                    .map((group) => ({ ...group, paths: gone(group.paths) }))
                    .filter((group) => group.paths.length > 1),
                }
              : lens,
      };
    }

    case "ENTRIES_MOVED": {
      const to = new Map(event.moved.map((move) => [move.from, move.to]));
      const follow = (path: string) => to.get(path) ?? path;
      const { lens } = browse;
      return {
        ...browse,
        selected: browse.selected && follow(browse.selected),
        picked: browse.picked.map(follow),
        results: { ...browse.results, paths: browse.results.paths.map(follow) },
        lens:
          lens?.kind === "similar"
            ? { ...lens, source: follow(lens.source), paths: lens.paths?.map(follow) ?? null }
            : lens?.kind === "duplicates" && lens.groups
              ? { ...lens, groups: lens.groups.map((group) => ({ ...group, paths: group.paths.map(follow) })) }
              : lens,
      };
    }

    case "LOCATE": {
      // The view stays only when it is a plain folder holding the file; any
      // search or filter hiding it is cleared. Decided from the inputs, not the
      // results, which may still be in flight.
      const keep = isPlainFolder(browse.query, browse.filter) &&
        (browse.filter.folder === "" || event.relPath.startsWith(`${browse.filter.folder}/`));
      return {
        ...browse,
        lens: null,
        viewing: false,
        selected: event.relPath,
        picked: [],
        reveal: { relPath: event.relPath, nonce: (browse.reveal?.nonce ?? 0) + 1, align: "center" },
        ...(keep ? {} : { query: "", filter: { ...emptyFilter, folder: parentOf(event.relPath) } }),
      };
    }

    case "SIMILAR_REQUESTED":
      return { ...browse, lens: { kind: "similar", source: event.source, paths: null }, picked: [], viewing: false };

    case "SIMILAR_RESULTS":
      if (browse.lens?.kind !== "similar" || browse.lens.source !== event.source) return browse;
      return { ...browse, lens: { ...browse.lens, paths: event.paths } };

    case "SIMILAR_FAILED":
      if (browse.lens?.kind !== "similar" || browse.lens.source !== event.source) return browse;
      return { ...browse, lens: null };

    case "DUPLICATES_REQUESTED":
      return { ...browse, lens: { kind: "duplicates", groups: null }, picked: [], viewing: false };

    case "DUPLICATES_RESULTS":
      if (browse.lens?.kind !== "duplicates") return browse;
      // The inspector follows the wall: a focus the copies do not include moves
      // to the first file to keep.
      return {
        ...browse,
        lens: { kind: "duplicates", groups: event.groups },
        selected: event.groups.some((group) => group.paths.includes(browse.selected ?? ""))
          ? browse.selected
          : (event.groups[0]?.paths[0] ?? browse.selected),
      };

    case "DUPLICATES_FAILED":
      return browse.lens?.kind === "duplicates" ? { ...browse, lens: null } : browse;

    case "LENS_CLEARED":
      return browse.lens ? { ...browse, lens: null, picked: [] } : browse;

    case "VIEWER": {
      const viewing = event.open && browse.selected !== null;
      return viewing === browse.viewing ? browse : { ...browse, viewing };
    }

    default:
      return browse;
  }
}
