// Background work for the open folder, each loop owned by one watch so it
// starts and stops with exactly the state that allows it.
import { toast } from "sonner";
import { dispatch, session, watch } from "@/app/store";
import { api } from "@/lib/bridge";
import { humanError } from "@/lib/errors";
import { shouldIndex } from "./machine";
import { warmModel } from "./commands";

const BATCH = 4;
/** Back to back while files are waiting; a slow beat once a slice finds nothing. */
const BUSY_GAP = 50;
const IDLE_GAP = 500;
const DIRTY_POLL = 2000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** One slice at a time, never overlapping. The machine decides whether a slice
 *  may run, so a paused, finished or failed folder simply stops the loop. */
function indexLoop() {
  return watch(
    (s) => [s.vault.library?.root ?? null, shouldIndex(s.vault), s.vault.modelEpoch] as const,
    ([root, indexing]) => {
      if (!root || !indexing) return;
      let stopped = false;
      void (async () => {
        while (!stopped) {
          let gap = IDLE_GAP;
          try {
            const step = await api.indexSlice(BATCH);
            if (stopped) return;
            const changed = step.derived > 0 || step.embeddedNow > 0;
            dispatch({
              type: "SLICE",
              progress: { indexed: step.indexed, embedded: step.embedded, total: step.total, remaining: step.remaining },
              changed,
            });
            if (step.modelError) dispatch({ type: "MODEL_FAILED" });
            if (changed) gap = BUSY_GAP;
          } catch (problem) {
            if (stopped) return;
            toast.error(humanError(problem), { id: "index" });
          }
          await sleep(gap);
        }
      })();
      return () => {
        stopped = true;
      };
    },
  );
}

/** Finder changes arrive through FSEvents in Rust; this poll folds them in. */
function dirtyPoll() {
  return watch(
    (s) => [s.vault.library?.root ?? null] as const,
    ([root]) => {
      if (!root) return;
      let stopped = false;
      void (async () => {
        while (!stopped) {
          await sleep(DIRTY_POLL);
          try {
            const { dirty } = await api.takeDirty();
            if (dirty && !stopped) dispatch({ type: "RESCANNED", view: await api.refresh() });
          } catch {
            /* the folder may be mid-move; the next poll retries */
          }
        }
      })();
      return () => {
        stopped = true;
      };
    },
  );
}

/** The model loads in its own process, only while semantic search is on. Its
 *  epoch in the machine replays the last search once it is warm. */
function modelWarmup() {
  return watch(
    (s) => [s.vault.library?.root ?? null, s.vault.settings?.semantic ?? false] as const,
    ([root, semantic]) => {
      if (root && semantic && session().vault.model !== "ready") void warmModel();
    },
  );
}

export function startIndexing(): () => void {
  const stops = [indexLoop(), dirtyPoll(), modelWarmup()];
  return () => stops.forEach((stop) => stop());
}
