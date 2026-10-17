// One state machine for the vault. Every bug this project hit came from the
// same shape: an async result landing in a state that no longer existed. Here
// each event declares which phases accept it, so a stale response is dropped
// instead of overwriting the present.
export type Phase = "idle" | "opening" | "deriving" | "embedding" | "ready" | "paused" | "failed";

export type ModelState = "unknown" | "warming" | "ready" | "failed";

type IndexPhase = Extract<Phase, "deriving" | "embedding">;

export type Machine = {
  phase: Phase;
  /** Where resume returns to; set only while paused. */
  pausedFrom: IndexPhase | null;
  root: string | null;
  error: string | null;
  indexed: number;
  embedded: number;
  total: number;
  remaining: number;
  model: ModelState;
  /** Bumped when the model turns ready, so the last search can be replayed. */
  modelEpoch: number;
  searching: number;
};

export const initial: Machine = {
  phase: "idle",
  pausedFrom: null,
  root: null,
  error: null,
  indexed: 0,
  embedded: 0,
  total: 0,
  remaining: 0,
  model: "unknown",
  modelEpoch: 0,
  searching: 0,
};

export type Event =
  | { type: "OPEN"; path: string }
  | { type: "OPENED"; root: string; indexed: number; embedded: number; total: number; remaining: number }
  | { type: "OPEN_FAILED"; error: string }
  | { type: "SLICE"; indexed: number; embedded: number; total: number; remaining: number }
  | { type: "PAUSE" }
  | { type: "RESUME" }
  | { type: "CLOSE" }
  | { type: "RESCAN"; indexed: number; embedded: number; total: number; remaining: number }
  | { type: "MODEL_WARMING" }
  | { type: "MODEL_READY" }
  | { type: "MODEL_FAILED"; error: string }
  | { type: "SEARCH_START" }
  | { type: "SEARCH_END" }
  | { type: "SEARCH_FAILED"; error: string }
  | { type: "CLEAR_ERROR" };

function phaseFor(embedded: number, total: number, remaining: number): Phase {
  if (remaining > 0) return "deriving";
  if (embedded < total) return "embedding";
  return "ready";
}

/** Only these phases may run a slice; everything else drops the tick. */
export function shouldIndex(machine: Machine): boolean {
  return machine.phase === "deriving" || machine.phase === "embedding";
}

export function reduce(machine: Machine, event: Event): Machine {
  switch (event.type) {
    case "OPEN":
      if (machine.phase === "opening") return machine;
      return { ...machine, phase: "opening", error: null, pausedFrom: null, root: event.path };

    case "OPENED":
      // A slow open that lands after the user closed the folder is stale.
      if (machine.phase !== "opening") return machine;
      return {
        ...machine,
        phase: phaseFor(event.embedded, event.total, event.remaining),
        root: event.root,
        indexed: event.indexed,
        embedded: event.embedded,
        total: event.total,
        remaining: event.remaining,
        error: null,
      };

    case "OPEN_FAILED":
      if (machine.phase !== "opening") return machine;
      return { ...machine, phase: "failed", error: event.error, root: null };

    case "SLICE":
      if (!shouldIndex(machine)) return machine;
      return {
        ...machine,
        phase: phaseFor(event.embedded, event.total, event.remaining),
        indexed: event.indexed,
        embedded: event.embedded,
        total: event.total,
        remaining: event.remaining,
      };

    case "PAUSE":
      // Pausing a settled folder is allowed: it stops work that a new file
      // would otherwise start the moment it lands.
      if (machine.phase !== "ready" && !shouldIndex(machine)) return machine;
      return {
        ...machine,
        phase: "paused",
        pausedFrom: machine.phase === "ready" ? "deriving" : (machine.phase as IndexPhase),
      };

    case "RESUME":
      if (machine.phase !== "paused") return machine;
      return { ...machine, phase: machine.pausedFrom ?? "deriving", pausedFrom: null };

    case "CLOSE":
      // The model process outlives the folder, so its state is kept.
      return { ...initial, model: machine.model, modelEpoch: machine.modelEpoch };

    case "RESCAN":
      // Finder changes arrive here. Counts always update; the phase only moves
      // while the folder is actually being worked on or has settled.
      if (machine.phase === "idle" || machine.phase === "opening" || machine.phase === "failed") return machine;
      return {
        ...machine,
        indexed: event.indexed,
        embedded: event.embedded,
        total: event.total,
        remaining: event.remaining,
        phase: machine.phase === "paused" ? "paused" : phaseFor(event.embedded, event.total, event.remaining),
      };

    case "MODEL_WARMING":
      if (machine.model === "ready") return machine;
      return { ...machine, model: "warming" };

    case "MODEL_READY":
      if (machine.model === "ready") return { ...machine, modelEpoch: machine.modelEpoch };
      return { ...machine, model: "ready", error: null, modelEpoch: machine.modelEpoch + 1 };

    case "MODEL_FAILED":
      if (machine.model === "ready") return machine;
      return { ...machine, model: "failed" };

    case "SEARCH_START":
      return { ...machine, searching: machine.searching + 1 };

    case "SEARCH_END":
      return { ...machine, searching: Math.max(0, machine.searching - 1) };

    case "SEARCH_FAILED":
      return {
        ...machine,
        searching: Math.max(0, machine.searching - 1),
        error: event.error,
      };

    case "CLEAR_ERROR":
      return machine.error === null ? machine : { ...machine, error: null };

    default:
      return machine;
  }
}
