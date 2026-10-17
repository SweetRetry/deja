// The whole session as one pure reducer over two slices. Kept free of React,
// zustand and path aliases so `node --test` can run it as is.
import { initialBrowse, reduceBrowse, type BrowseState } from "../features/browse/browse.ts";
import type { SessionEvent } from "../features/vault/events.ts";
import { initialVault, reduceVault, type VaultState } from "../features/vault/machine.ts";
import type { Ranking, Sort } from "../lib/types.ts";

export type Session = { vault: VaultState; browse: BrowseState };

export function initialSession(sort?: Sort, ranking?: Ranking): Session {
  return { vault: initialVault, browse: initialBrowse(sort, ranking) };
}

export function reduce(session: Session, event: SessionEvent): Session {
  // An answer to a superseded search is stale for every slice, not only browse.
  if (event.type === "RESULTS" && event.request !== session.browse.request) return session;
  // So is a rescan of a folder that is no longer open: one in flight when the
  // user switched folders must not paint the old files under the new name.
  if ((event.type === "RESCANNED" || event.type === "SCOPED") && event.view.root !== session.vault.library?.root) {
    return session;
  }
  const vault = reduceVault(session.vault, event);
  const browse = reduceBrowse(session.browse, event);
  return vault === session.vault && browse === session.browse ? session : { vault, browse };
}
