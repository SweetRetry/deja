export type ColorShare = { hex: string; share: number };

export type EntryMeta = {
  tags: string[];
  rating: number;
  note: string;
  source: string | null;
};

export type Entry = EntryMeta & {
  relPath: string;
  name: string;
  ext: string;
  kind: "image" | "video";
  sizeBytes: number;
  modified: number;
  width: number | null;
  height: number | null;
  colors: ColorShare[];
  dhash: string;
  thumbPath: string | null;
  indexed: boolean;
  embedded: boolean;
};

/** One folder on disk and the images and videos under it, at any depth. */
export type FolderCount = { path: string; files: number };

/**
 * Which parts of a vault are indexed. Excluding a folder leaves its whole
 * subtree out; folders that appear later are in. `chosen` is false until the
 * user has picked once for this vault, and nothing is indexed before that.
 */
export type Scope = {
  chosen: boolean;
  excluded: string[];
  /** Every folder found on disk, excluded ones included, "" being the vault root. */
  tree: FolderCount[];
};

export type VaultView = {
  root: string;
  scope: Scope;
  folders: string[];
  entries: Entry[];
  indexed: number;
  embedded: number;
  total: number;
  model: { ready: boolean };
};

/** What the backend acts on: the model process. It lives in settings.json
 *  under the app's data dir (settings.rs). */
export type AppSettings = { semantic: boolean; modelIdleSecs: number };

export type Sort = "name" | "modified" | "size" | "rating";

/** How a query is ranked: by picture content, or by names, tags and notes only. */
export type Ranking = "semantic" | "keyword";

export type Filter = {
  kinds: string[];
  minWidth: number;
  minRating: number;
  color: string;
  folder: string;
  tag: string;
};

/** Position in the result list, and the text→image match (0–100) when the model scored it. */
export type SearchScore = { rank: number; match: number | null };

export type SearchResponse = {
  entries: Entry[];
  scores: Record<string, SearchScore>;
  /** Files each COLOR_PRESETS swatch would leave, given the other filters. */
  colorCounts: number[];
  semantic: boolean;
  warmMs: number;
  tookMs: number;
};

export type IndexProgress = {
  indexed: number;
  embedded: number;
  total: number;
  remaining: number;
  derived: number;
  embeddedNow: number;
  modelReady: boolean;
  modelError: string | null;
  phase: string;
};

/** Copies of one picture, the one to keep first. `exact` when every copy has the same bytes. */
export type DuplicateGroup = { paths: string[]; exact: boolean };

export type Moved = { from: string; to: string };

export type SimilarRow = {
  relPath: string;
  score: number;
  hashScore: number;
  vectorScore: number;
};

export type SimilarResponse = { results: SimilarRow[] };

/** One dropped item: a `data:` URL for bytes the page read, or the image's web address. */
export type ImportItem = { url: string; name: string | null; source: string | null };

/** A small png of the clipboard's picture, as a data URL, and its pixel size. */
export type ClipboardPreview = { url: string; width: number | null; height: number | null };

export type ImportResponse = { imported: string[]; view: VaultView };

export const emptyFilter: Filter = {
  kinds: [],
  minWidth: 0,
  minRating: 0,
  color: "",
  folder: "",
  tag: "",
};

/**
 * Built in OKLCH: three neutrals by lightness, brown (a dark orange), and eight
 * hues. The backend names every palette colour by its nearest swatch, so each
 * hue and shade lands on some swatch (color::Family). Each swatch must name
 * itself; color::tests::every_swatch_names_itself holds that.
 */
export const COLOR_PRESETS: { hex: string; label: string }[] = [
  { hex: "#1b1b1b", label: "黑" },
  { hex: "#717171", label: "灰" },
  { hex: "#e8e8e8", label: "白" },
  { hex: "#774826", label: "棕" },
  { hex: "#d33b36", label: "红" },
  { hex: "#e87f25", label: "橙" },
  { hex: "#f0cf4c", label: "黄" },
  { hex: "#4f9b3e", label: "绿" },
  { hex: "#2bb3b9", label: "青" },
  { hex: "#3065be", label: "蓝" },
  { hex: "#7d4dad", label: "紫" },
  { hex: "#e694bb", label: "粉" },
];
