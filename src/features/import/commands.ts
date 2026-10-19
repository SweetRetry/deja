import { dispatch, session } from "@/app/store";
import { api } from "@/lib/bridge";
import { humanError } from "@/lib/errors";
import type { ImportItem, ImportResponse } from "@/lib/types";

/** `error` is already worded for the user. */
export type ImportResult = { imported: string[] } | { error: string };

async function land(run: () => Promise<ImportResponse>): Promise<ImportResult> {
  try {
    const res = await run();
    dispatch({ type: "RESCANNED", view: res.view, select: res.imported[0] });
    return { imported: res.imported };
  } catch (problem) {
    return { error: humanError(problem) };
  }
}

/** Dropped files land in the folder being viewed and the first becomes the
 *  selection, so the inspector shows what just arrived. */
export function importDrop(items: ImportItem[]): Promise<ImportResult> {
  if (items.length === 0) return Promise.resolve({ error: humanError("not an image or video") });
  return land(() => api.importItems(session().browse.filter.folder, items));
}

/** The picture on the system clipboard, into the folder being viewed. */
export const importClipboard = () => land(() => api.importClipboard(session().browse.filter.folder));

/** Resolves to a worded error, or null once the files are gone. */
export async function undoImport(relPaths: string[]): Promise<string | null> {
  try {
    dispatch({ type: "RESCANNED", view: (await api.undoImport(relPaths)).view });
    return null;
  } catch (problem) {
    return humanError(problem);
  }
}
