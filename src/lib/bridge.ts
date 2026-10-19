import type {
  AppSettings,
  DuplicateGroup,
  Entry,
  EntryMeta,
  Filter,
  ImportItem,
  ImportResponse,
  IndexProgress,
  Moved,
  SearchResponse,
  SimilarResponse,
  Sort,
  VaultView,
} from "./types";

import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { COLOR_PRESETS } from "./types";

export const inTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>);

async function call<T>(name: string, args: unknown = {}): Promise<T> {
  if (inTauri) {
    return invoke<T>("command", { name, args });
  }
  const response = await fetch(`/api/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!response.ok) {
    throw new Error(`${name} failed with ${response.status}`);
  }
  const payload = (await response.json()) as { ok: boolean; data?: T; error?: string };
  if (!payload.ok) {
    throw new Error(payload.error ?? `${name} failed`);
  }
  return payload.data as T;
}

export const api = {
  openVault: (path: string, sort: Sort) => call<VaultView>("open_vault", { path, sort }),
  search: (query: string, filter: Filter, sort: Sort, semantic: boolean) =>
    call<SearchResponse>("search", {
      query,
      filter,
      sort,
      semantic,
      countColors: COLOR_PRESETS.map((preset) => preset.hex),
    }),
  saveMeta: (relPath: string, meta: EntryMeta) => call<Entry>("save_meta", { relPath, meta }),
  indexSlice: (batch: number) => call<IndexProgress>("index_slice", { batch }),
  refresh: () => call<VaultView>("refresh"),
  importItems: (folder: string, items: ImportItem[]) => call<ImportResponse>("import", { folder, items }),
  undoImport: (relPaths: string[]) => call<{ view: VaultView }>("undo_import", { relPaths }),
  setScope: (excluded: string[]) => call<VaultView>("set_scope", { excluded }),
  takeDirty: () => call<{ dirty: boolean }>("take_dirty"),
  settings: () => call<AppSettings>("settings"),
  saveSettings: (settings: AppSettings) => call<AppSettings>("save_settings", { settings }),
  warmModel: () => call<{ ready: boolean; warmMs: number }>("warm_model"),
  similar: (relPath: string, limit = 24) => call<SimilarResponse>("similar", { relPath, limit }),
  entry: (relPath: string) => call<Entry>("entry", { relPath }),
  reveal: (relPath: string) => call<{ revealed: boolean }>("reveal", { relPath }),
  /** One request for every file; `trashed` lists the ones that left the vault. */
  trash: (relPaths: string[]) =>
    call<{ trashed: string[]; error: string | null; view: VaultView }>("trash_entries", { relPaths }),
  move: (relPaths: string[], folder: string) => call<{ moved: Moved[]; view: VaultView }>("move_entries", { relPaths, folder }),
  duplicates: () => call<{ groups: DuplicateGroup[] }>("duplicates"),
  selfcheck: () =>
    call<{ enabled: boolean; vault: string | null; out: string | null }>("selfcheck_requested"),
  selfcheckReport: (report: unknown) => call<{ written: string }>("selfcheck_report", { report }),
};

/** A thumbnail is a cache file in the app's data dir; the browser build has no
 *  file access, so it reads the demo vault from the web root instead. */
export function thumbUrl(entry: Entry): string {
  if (!inTauri) {
    return `/vault/${entry.relPath.split("/").map(encodeURIComponent).join("/")}`;
  }
  return entry.thumbPath ? convertFileSrc(entry.thumbPath) : "";
}

/** The original file, for the viewer and for video playback. */
export function fileUrl(root: string, entry: Entry): string {
  const absolute = `${root}/${entry.relPath}`;
  return inTauri ? convertFileSrc(absolute) : `/vault/${entry.relPath.split("/").map(encodeURIComponent).join("/")}`;
}
