// Every change to the session is one of these events. Both slices (vault,
// browse) see every event and each declares which states accept it, so an
// async answer that lands after the state it was asked for is dropped.
import type {
  AppSettings,
  DuplicateGroup,
  Entry,
  EntryMeta,
  Filter,
  Moved,
  Ranking,
  SearchResponse,
  Sort,
  VaultView,
} from "../../lib/types.ts";

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
  /** A plain click: this file alone. */
  | { type: "SELECT"; relPath: string; reveal?: boolean }
  /** ⌘-click: adds the file to the picked set, or takes it out. */
  | { type: "PICK_TOGGLE"; relPath: string }
  /** Exactly these files, the first one focused; none leaves the focus alone. */
  | { type: "PICK"; relPaths: string[] }
  /** The files went to the Trash: they leave the wall, selection moving on. */
  | { type: "ENTRIES_REMOVED"; relPaths: string[] }
  /** The files moved to another folder: every reference follows them. */
  | { type: "ENTRIES_MOVED"; moved: Moved[] }
  | { type: "LOCATE"; relPath: string }
  | { type: "SIMILAR_REQUESTED"; source: string }
  | { type: "SIMILAR_RESULTS"; source: string; paths: string[] }
  | { type: "SIMILAR_FAILED"; source: string }
  | { type: "DUPLICATES_REQUESTED" }
  | { type: "DUPLICATES_RESULTS"; groups: DuplicateGroup[] }
  | { type: "DUPLICATES_FAILED" }
  /** Back from the similar or the duplicates view to the search. */
  | { type: "LENS_CLEARED" }
  | { type: "VIEWER"; open: boolean };
