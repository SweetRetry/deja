// Every change to the session is one of these events. Both slices (vault,
// browse) see every event and each declares which states accept it, so an
// async answer that lands after the state it was asked for is dropped.
import type { AppSettings, Entry, EntryMeta, Filter, Ranking, SearchResponse, Sort, VaultView } from "../../lib/types.ts";

export type Progress = { indexed: number; embedded: number; total: number; remaining: number };

export type SessionEvent =
  // Folder lifecycle
  | { type: "OPEN"; path: string }
  | { type: "OPENED"; view: VaultView }
  | { type: "OPEN_FAILED"; error: string }
  | { type: "CLOSE" }
  /** The user picked which folders to index; the view is rescanned under it. */
  | { type: "SCOPED"; view: VaultView }
  /** The folder changed on disk (Finder, an import, an undo). `select` picks a file in it. */
  | { type: "RESCANNED"; view: VaultView; select?: string }
  // Background indexing and the model process
  | { type: "SLICE"; progress: Progress; changed: boolean }
  | { type: "PAUSE" }
  | { type: "RESUME" }
  | { type: "MODEL_WARMING" }
  | { type: "MODEL_READY" }
  | { type: "MODEL_FAILED" }
  | { type: "SETTINGS"; settings: AppSettings }
  // Metadata edits: applied at once, confirmed or reverted when the write answers
  | { type: "META_EDITED"; relPath: string; meta: EntryMeta }
  | { type: "META_SAVED"; entry: Entry }
  | { type: "META_FAILED"; relPath: string }
  // Browsing
  | { type: "QUERY"; query: string }
  | { type: "FILTER"; filter: Filter }
  | { type: "SORT"; sort: Sort }
  | { type: "RANKING"; ranking: Ranking }
  /** `quiet` searches were not asked for (index ticks, rescans) and must not dim the wall. */
  | { type: "SEARCH_STARTED"; quiet: boolean }
  | { type: "RESULTS"; request: number; response: SearchResponse }
  | { type: "SEARCH_FAILED"; request: number }
  | { type: "SELECT"; relPath: string; reveal?: boolean }
  | { type: "LOCATE"; relPath: string }
  | { type: "SIMILAR_REQUESTED"; source: string }
  | { type: "SIMILAR_RESULTS"; source: string; paths: string[] }
  | { type: "SIMILAR_FAILED"; source: string }
  | { type: "SIMILAR_CLEARED" }
  | { type: "VIEWER"; open: boolean };
