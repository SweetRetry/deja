import type { Filter, Ranking, Sort } from "../../lib/types.ts";

/** Everything a search depends on. */
export type SearchInputs = {
  root: string | null;
  query: string;
  filter: Filter;
  sort: Sort;
  ranking: Ranking;
  semantic: boolean;
  modelEpoch: number;
  revision: number;
};

/** quiet: the files or the model changed, or a folder just opened. typed: the
 *  user changed a query, filter, sort or ranking. navigated: only the folder
 *  changed, as when picking one in the sidebar. */
export type SearchIntent = "quiet" | "typed" | "navigated";

export function classify(previous: SearchInputs | null, next: SearchInputs): SearchIntent {
  if (!previous || previous.root !== next.root) return "quiet";
  const sameQuery = Object.is(next.query, previous.query);
  const sameFilter = Object.is(next.filter, previous.filter);
  const sameOrder = Object.is(next.sort, previous.sort) && Object.is(next.ranking, previous.ranking);
  if (sameQuery && sameFilter && sameOrder) return "quiet";
  const onlyFolder =
    next.filter.folder !== previous.filter.folder &&
    JSON.stringify({ ...next.filter, folder: "" }) === JSON.stringify({ ...previous.filter, folder: "" });
  return sameQuery && sameOrder && onlyFolder ? "navigated" : "typed";
}
