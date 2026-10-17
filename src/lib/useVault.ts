import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { api } from "./bridge";
import {
  emptyFilter,
  type Entry,
  type EntryMeta,
  type Filter,
  type ImportItem,
  type IndexProgress,
  type SearchScore,
  type SimilarRow,
  type VaultView,
} from "./types";
import { initial, reduce, shouldIndex } from "./vault-machine";

const LAST_VAULT = "shelf.vault";
const SORT_KEY = "shelf.sort";
const RANKING_KEY = "shelf.semanticMode";

/** `semanticEnabled` is the user's setting; while it is off the model is never
 *  warmed and its failures are not reported. */
export function useVault(semanticEnabled: boolean) {
  const [machine, dispatch] = useReducer(reduce, initial);
  const [vault, setVault] = useState<VaultView | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>(emptyFilter);
  const [sort, setSortState] = useState(() => localStorage.getItem(SORT_KEY) ?? "name");
  const [semantic, setSemantic] = useState(false);
  const [semanticMode, setSemanticModeState] = useState(() => localStorage.getItem(RANKING_KEY) !== "false");
  const [tookMs, setTookMs] = useState(0);
  const [scores, setScores] = useState<Record<string, SearchScore>>({});
  const [colorCounts, setColorCounts] = useState<number[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [similar, setSimilar] = useState<SimilarRow[] | null>(null);
  /** A tile the wall should scroll to; the nonce repeats a locate on the same file. */
  const [focus, setFocus] = useState<{ relPath: string; nonce: number } | null>(null);

  const root = vault?.root ?? null;
  const semanticModeRef = useRef(semanticMode);
  semanticModeRef.current = semanticMode;
  const queryRef = useRef(query);
  queryRef.current = query;
  const filterRef = useRef(filter);
  filterRef.current = filter;
  const sortRef = useRef(sort);
  sortRef.current = sort;

  // Searches overlap (typing, index ticks, imports); only the latest may land,
  // or an older answer overwrites the selection a newer one just made.
  const searchSeq = useRef(0);

  // `quiet` is for searches nobody asked for (index ticks, rescans, imports):
  // they swap results in place instead of dimming the wall while they run.
  const runSearch = useCallback(async (q: string, f: Filter, s: string, quiet = false) => {
    const seq = ++searchSeq.current;
    if (!quiet) dispatch({ type: "SEARCH_START" });
    const settle = () => {
      if (!quiet) dispatch({ type: "SEARCH_END" });
    };
    try {
      const res = await api.search(q, f, s, semanticModeRef.current);
      if (seq !== searchSeq.current) {
        settle();
        return;
      }
      setEntries(res.entries);
      // The inspector never goes blank: a selection the new results dropped
      // moves to the first result; with no results it stays where it was.
      setSelected((current) =>
        current && res.entries.some((entry) => entry.relPath === current)
          ? current
          : (res.entries[0]?.relPath ?? current),
      );
      setScores(res.scores);
      setColorCounts(res.colorCounts);
      setSemantic(res.semantic);
      setTookMs(res.tookMs);
      settle();
    } catch (problem) {
      dispatch({
        type: "SEARCH_FAILED",
        error: problem instanceof Error ? problem.message : String(problem),
      });
    }
  }, []);

  useEffect(() => {
    if (!root) return;
    const timer = setTimeout(() => void runSearch(query, filter, sort), 160);
    return () => clearTimeout(timer);
  }, [root, query, filter, sort, semanticMode, semanticEnabled, machine.modelEpoch, runSearch]);

  const applyView = useCallback((view: VaultView) => {
    setVault(view);
    setEntries(view.entries);
    setScores({});
  }, []);

  /** The folder changed underneath an open view. Only the vault and counts move
   *  here; the wall keeps its results until the quiet search replaces them, so
   *  it never flashes the unfiltered list. */
  const rescanned = useCallback(async (view: VaultView) => {
    setVault(view);
    dispatch({
      type: "RESCAN",
      indexed: view.indexed,
      embedded: view.embedded,
      total: view.total,
      remaining: view.total - view.indexed,
    });
    await runSearch(queryRef.current, filterRef.current, sortRef.current, true);
  }, [runSearch]);

  const openVault = useCallback(
    async (path: string) => {
      dispatch({ type: "OPEN", path });
      try {
        const view = await api.openVault(path);
        localStorage.setItem(LAST_VAULT, path);
        applyView(view);
        setSelected(view.entries[0]?.relPath ?? null);
        setSimilar(null);
        setQuery("");
        setFilter(emptyFilter);
        dispatch({
          type: "OPENED",
          root: view.root,
          indexed: view.indexed,
          embedded: view.embedded,
          total: view.total,
          remaining: view.total - view.indexed,
        });
      } catch (problem) {
        setVault(null);
        dispatch({
          type: "OPEN_FAILED",
          error: problem instanceof Error ? problem.message : String(problem),
        });
      }
    },
    [applyView],
  );

  const close = useCallback(() => {
    localStorage.removeItem(LAST_VAULT);
    setVault(null);
    setEntries([]);
    setQuery("");
    setSelected(null);
    setSimilar(null);
    dispatch({ type: "CLOSE" });
  }, []);

  useEffect(() => {
    const last = localStorage.getItem(LAST_VAULT);
    if (last) void openVault(last);
  }, [openVault]);

  // The model loads in its own process; report its state to the machine and let
  // the machine's epoch trigger one re-search once it is warm.
  useEffect(() => {
    if (!root || !semanticEnabled) return;
    let cancelled = false;
    dispatch({ type: "MODEL_WARMING" });
    void api
      .warmModel()
      .then(() => {
        if (!cancelled) dispatch({ type: "MODEL_READY" });
      })
      .catch(() => {
        if (!cancelled) dispatch({ type: "MODEL_FAILED", error: "model failed to start" });
      });
    return () => {
      cancelled = true;
    };
  }, [root, semanticEnabled]);

  // One repeatable tick. The machine decides whether a tick may do work, so a
  // paused folder, a finished folder or a failed one simply ignores it.
  useEffect(() => {
    if (!root || !shouldIndex(machine)) return;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      try {
        const step = await api.indexSlice(4);
        if (stopped) return;
        dispatch({
          type: "SLICE",
          indexed: step.indexed,
          embedded: step.embedded,
          total: step.total,
          remaining: step.remaining,
        });
        if (step.modelError) dispatch({ type: "MODEL_FAILED", error: step.modelError });
        if (step.derived > 0 || step.embeddedNow > 0) {
          await runSearch(queryRef.current, filterRef.current, sortRef.current, true);
        }
      } catch (problem) {
        if (!stopped) {
          dispatch({
            type: "SEARCH_FAILED",
            error: problem instanceof Error ? problem.message : String(problem),
          });
        }
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 500);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [root, machine.phase, machine.modelEpoch, runSearch]);

  // Finder changes arrive through FSEvents in Rust; this poll folds them in.
  useEffect(() => {
    if (!root) return;
    const timer = setInterval(() => {
      void (async () => {
        try {
          const { dirty } = await api.takeDirty();
          if (!dirty) return;
          await rescanned(await api.refresh());
        } catch {
          /* the folder may be mid-move; the next poll retries */
        }
      })();
    }, 2000);
    return () => clearInterval(timer);
  }, [root, rescanned]);

  const saveMeta = useCallback(async (relPath: string, meta: EntryMeta) => {
    try {
      const updated = await api.saveMeta(relPath, meta);
      setEntries((rows) => rows.map((row) => (row.relPath === relPath ? updated : row)));
      setVault((current) =>
        current
          ? { ...current, entries: current.entries.map((row) => (row.relPath === relPath ? updated : row)) }
          : current,
      );
    } catch (problem) {
      dispatch({
        type: "SEARCH_FAILED",
        error: problem instanceof Error ? problem.message : String(problem),
      });
    }
  }, []);

  // Dropped files land in the folder being viewed and become the selection, so
  // the inspector shows what just arrived. The caller reports the outcome, so
  // failures do not also go to the error bar.
  const importDrop = useCallback(
    async (items: ImportItem[]): Promise<{ imported: string[]; existing: string[] } | { error: string }> => {
      if (items.length === 0) return { error: "not an image or video" };
      try {
        const res = await api.importItems(filterRef.current.folder, items);
        const first = res.imported[0] ?? res.existing[0];
        if (first) setSelected(first);
        await rescanned(res.view);
        return { imported: res.imported, existing: res.existing };
      } catch (problem) {
        return { error: problem instanceof Error ? problem.message : String(problem) };
      }
    },
    [rescanned],
  );

  const undoImport = useCallback(
    async (relPaths: string[]): Promise<{ error: string } | null> => {
      try {
        await rescanned((await api.undoImport(relPaths)).view);
        return null;
      } catch (problem) {
        return { error: problem instanceof Error ? problem.message : String(problem) };
      }
    },
    [rescanned],
  );

  /** Selects a file and scrolls the wall to it. A search or filter hiding it is
   *  cleared, and the sidebar moves to its folder. */
  const locate = useCallback((relPath: string) => {
    setSimilar(null);
    setSelected(relPath);
    if (!entries.some((entry) => entry.relPath === relPath)) {
      setQuery("");
      setFilter({ ...emptyFilter, folder: relPath.split("/").slice(0, -1).join("/") });
    }
    setFocus({ relPath, nonce: Date.now() });
  }, [entries]);

  const retrySemantic = useCallback(async () => {
    dispatch({ type: "MODEL_WARMING" });
    try {
      await api.warmModel();
      dispatch({ type: "MODEL_READY" });
    } catch {
      dispatch({ type: "MODEL_FAILED", error: "model failed to start" });
    }
    await runSearch(queryRef.current, filterRef.current, sortRef.current);
  }, [runSearch]);

  const findSimilar = useCallback(async (relPath: string) => {
    try {
      const res = await api.similar(relPath);
      setSimilar(res.results);
    } catch (problem) {
      dispatch({
        type: "SEARCH_FAILED",
        error: problem instanceof Error ? problem.message : String(problem),
      });
    }
  }, []);

  // Similar results and a selection kept through an empty search are not in
  // the current result list, so fall back to the whole vault.
  const selectedEntry =
    entries.find((entry) => entry.relPath === selected) ??
    vault?.entries.find((entry) => entry.relPath === selected) ??
    null;
  const similarEntries = similar
    ? similar
        .map((row) => entries.find((entry) => entry.relPath === row.relPath))
        .filter((entry): entry is Entry => Boolean(entry))
    : null;

  const progress: IndexProgress = {
    indexed: machine.indexed,
    embedded: machine.embedded,
    total: machine.total,
    remaining: machine.remaining,
    derived: 0,
    embeddedNow: 0,
    modelReady: machine.model === "ready",
    modelError: machine.model === "failed" ? "模型没启动起来" : null,
    phase: machine.phase,
  };

  return {
    vault,
    phase: machine.phase,
    entries,
    scores,
    colorCounts,
    query,
    setQuery,
    filter,
    setFilter,
    sort,
    setSort: (next: string) => {
      setSortState(next);
      localStorage.setItem(SORT_KEY, next);
    },
    pending: machine.searching > 0,
    semantic,
    semanticMode,
    setSemanticMode: (next: boolean) => {
      setSemanticModeState(next);
      localStorage.setItem(RANKING_KEY, String(next));
    },
    modelWarm: machine.model === "ready",
    modelFailed: semanticEnabled && machine.model === "failed",
    tookMs,
    selected,
    setSelected,
    selectedEntry,
    progress,
    paused: machine.phase === "paused",
    setPaused: (paused: boolean) => dispatch({ type: paused ? "PAUSE" : "RESUME" }),
    similar,
    similarEntries,
    clearSimilar: () => setSimilar(null),
    findSimilar,
    saveMeta,
    importDrop,
    undoImport,
    locate,
    focus,
    retrySemantic,
    openVault,
    close,
    opening: machine.phase === "opening",
    error: machine.error,
  };
}

export type VaultState = ReturnType<typeof useVault>;
