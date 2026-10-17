import { create } from "zustand";
import { readStored } from "@/lib/storage";
import type { Ranking, Sort } from "@/lib/types";
import type { SessionEvent } from "@/features/vault/events";
import { initialSession, reduce, type Session } from "./session";

export type { Session };

export const SORT_KEY = "shelf.sort";
export const RANKING_KEY = "shelf.ranking";

const SORTS: Sort[] = ["name", "modified", "size", "rating"];

function storedSort(): Sort {
  const stored = readStored(SORT_KEY);
  return SORTS.find((sort) => sort === stored) ?? "name";
}

function storedRanking(): Ranking {
  return readStored(RANKING_KEY) === "keyword" ? "keyword" : "semantic";
}

export const useSession = create<Session>()(() => initialSession(storedSort(), storedRanking()));

export function dispatch(event: SessionEvent) {
  useSession.setState((session) => reduce(session, event), true);
}

export const session = () => useSession.getState();

/**
 * An effect outside React: runs `run` whenever the selected tuple changes and
 * calls the previous cleanup first, like `useEffect` with those dependencies.
 */
export function watch<const T extends readonly unknown[]>(
  select: (session: Session) => T,
  run: (value: T, previous: T | null) => void | (() => void),
): () => void {
  let previous: T | null = null;
  let cleanup: void | (() => void);
  const check = (state: Session) => {
    const next = select(state);
    if (previous && next.every((value, index) => Object.is(value, previous?.[index]))) return;
    cleanup?.();
    const last = previous;
    previous = next;
    cleanup = run(next, last);
  };
  check(useSession.getState());
  const unsubscribe = useSession.subscribe(check);
  return () => {
    unsubscribe();
    cleanup?.();
  };
}
