// The folder's lifecycle. Every bug this project hit came from the same shape:
// an async result landing in a state that no longer existed. Here each event
// declares which phases accept it, so a stale response is dropped instead of
// overwriting the present.
import type { AppSettings, Entry, EntryMeta, VaultView } from "../../lib/types.ts";
import type { Progress, SessionEvent } from "./events.ts";

export type Phase = "idle" | "opening" | "deriving" | "embedding" | "ready" | "paused" | "failed";

export type ModelState = "unknown" | "warming" | "ready" | "failed";

type IndexPhase = Extract<Phase, "deriving" | "embedding">;

/** The open folder, with every file stored once by path. Result lists hold paths. */
export type Library = {
  root: string;
  folders: string[];
  byPath: Record<string, Entry>;
  /** Files under each folder path; "" is the whole vault. */
  counts: Record<string, number>;
};

/** An edit not yet confirmed by disk, and the entry to return to if it fails. */
type Saving = { count: number; original: Entry };

export type VaultState = {
  phase: Phase;
  /** Where resume returns to; set only while paused. */
  pausedFrom: IndexPhase | null;
  /** The folder asked for while opening; then the one open. */
  path: string | null;
  library: Library | null;
  progress: Progress;
  model: ModelState;
  /** Bumped when the model turns ready, so the last search can be replayed. */
  modelEpoch: number;
  /** Bumped whenever the files behind the current results changed. */
  revision: number;
  /** Why the last open failed, worded by the backend. */
  error: string | null;
  /** Null until the backend answers, so nothing starts the model on a guess. */
  settings: AppSettings | null;
  saving: Record<string, Saving>;
};

const noProgress: Progress = { indexed: 0, embedded: 0, total: 0, remaining: 0 };

export const initialVault: VaultState = {
  phase: "idle",
  pausedFrom: null,
  path: null,
  library: null,
  progress: noProgress,
  model: "unknown",
  modelEpoch: 0,
  revision: 0,
  error: null,
  settings: null,
  saving: {},
};

function phaseFor({ embedded, total, remaining }: Progress): Phase {
  if (remaining > 0) return "deriving";
  if (embedded < total) return "embedding";
  return "ready";
}

function progressOf(view: VaultView): Progress {
  return { indexed: view.indexed, embedded: view.embedded, total: view.total, remaining: view.total - view.indexed };
}

function metaOf(entry: Entry): EntryMeta {
  return { tags: entry.tags, rating: entry.rating, note: entry.note, source: entry.source };
}

/** Fresh entries from disk, except that an edit still being written keeps its local value. */
function merge(byPath: Record<string, Entry>, fresh: Entry[], saving: Record<string, Saving>): Record<string, Entry> {
  const next = { ...byPath };
  for (const entry of fresh) {
    const local = saving[entry.relPath] ? byPath[entry.relPath] : undefined;
    next[entry.relPath] = local ? { ...entry, ...metaOf(local) } : entry;
  }
  return next;
}

function libraryOf(view: VaultView, saving: Record<string, Saving>, previous: Library | null): Library {
  const counts: Record<string, number> = { "": view.entries.length };
  for (const entry of view.entries) {
    const parts = entry.relPath.split("/");
    for (let i = 1; i < parts.length; i += 1) {
      const key = parts.slice(0, i).join("/");
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }
  return {
    root: view.root,
    folders: view.folders,
    byPath: merge(previous?.byPath ?? {}, view.entries, saving),
    counts,
  };
}

/** Only these phases may run a slice; everything else drops the tick. */
export function shouldIndex(vault: VaultState): boolean {
  return vault.phase === "deriving" || vault.phase === "embedding";
}

export function reduceVault(vault: VaultState, event: SessionEvent): VaultState {
  switch (event.type) {
    case "OPEN":
      if (vault.phase === "opening") return vault;
      return { ...vault, phase: "opening", error: null, pausedFrom: null, path: event.path };

    case "OPENED":
      // A slow open that lands after the user closed the folder is stale.
      if (vault.phase !== "opening") return vault;
      return {
        ...vault,
        phase: phaseFor(progressOf(event.view)),
        path: event.view.root,
        library: libraryOf(event.view, {}, null),
        progress: progressOf(event.view),
        saving: {},
        error: null,
      };

    case "OPEN_FAILED":
      if (vault.phase !== "opening") return vault;
      return { ...vault, phase: "failed", error: event.error, path: null, library: null };

    case "CLOSE":
      // The model process and the settings outlive the folder.
      return { ...initialVault, model: vault.model, modelEpoch: vault.modelEpoch, settings: vault.settings };

    case "RESCANNED":
      // Counts always update; the phase only moves while the folder is being
      // worked on or has settled, and a pause holds.
      if (!vault.library || vault.phase === "opening") return vault;
      return {
        ...vault,
        library: libraryOf(event.view, vault.saving, vault.library),
        progress: progressOf(event.view),
        phase: vault.phase === "paused" ? "paused" : phaseFor(progressOf(event.view)),
        revision: vault.revision + 1,
      };

    case "SLICE":
      if (!shouldIndex(vault)) return vault;
      return {
        ...vault,
        phase: phaseFor(event.progress),
        progress: event.progress,
        revision: event.changed ? vault.revision + 1 : vault.revision,
      };

    case "PAUSE":
      // Pausing a settled folder is allowed: it stops work that a new file
      // would otherwise start the moment it lands.
      if (vault.phase !== "ready" && !shouldIndex(vault)) return vault;
      return {
        ...vault,
        phase: "paused",
        pausedFrom: vault.phase === "ready" ? "deriving" : (vault.phase as IndexPhase),
      };

    case "RESUME":
      if (vault.phase !== "paused") return vault;
      return { ...vault, phase: vault.pausedFrom ?? "deriving", pausedFrom: null };

    case "MODEL_WARMING":
      if (vault.model === "ready" || vault.model === "warming") return vault;
      return { ...vault, model: "warming" };

    case "MODEL_READY":
      if (vault.model === "ready") return vault;
      return { ...vault, model: "ready", modelEpoch: vault.modelEpoch + 1 };

    case "MODEL_FAILED":
      if (vault.model === "ready" || vault.model === "failed") return vault;
      return { ...vault, model: "failed" };

    case "SETTINGS":
      return { ...vault, settings: event.settings };

    case "META_EDITED": {
      const entry = vault.library?.byPath[event.relPath];
      if (!vault.library || !entry) return vault;
      const pending = vault.saving[event.relPath];
      return {
        ...vault,
        library: { ...vault.library, byPath: { ...vault.library.byPath, [event.relPath]: { ...entry, ...event.meta } } },
        saving: {
          ...vault.saving,
          [event.relPath]: { count: (pending?.count ?? 0) + 1, original: pending?.original ?? entry },
        },
      };
    }

    case "META_SAVED":
    case "META_FAILED": {
      const relPath = event.type === "META_SAVED" ? event.entry.relPath : event.relPath;
      const pending = vault.saving[relPath];
      if (!vault.library || !pending) return vault;
      // A later edit is still in flight and carries the whole meta; it decides.
      if (pending.count > 1) {
        return { ...vault, saving: { ...vault.saving, [relPath]: { ...pending, count: pending.count - 1 } } };
      }
      const { [relPath]: _, ...saving } = vault.saving;
      const settled = event.type === "META_SAVED" ? event.entry : pending.original;
      return { ...vault, saving, library: { ...vault.library, byPath: { ...vault.library.byPath, [relPath]: settled } } };
    }

    case "RESULTS":
      // Search answers carry the freshest entries (thumbnails, colors).
      if (!vault.library || event.response.entries.length === 0) return vault;
      return {
        ...vault,
        library: { ...vault.library, byPath: merge(vault.library.byPath, event.response.entries, vault.saving) },
      };

    default:
      return vault;
  }
}
