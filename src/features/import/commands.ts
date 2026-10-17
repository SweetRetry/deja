import { dispatch, session } from "@/app/store";
import { api } from "@/lib/bridge";
import { humanError } from "@/lib/errors";
import type { ImportItem } from "@/lib/types";

/** `error` is already worded for the user. */
export type ImportResult = { imported: string[] } | { error: string };

/** Dropped files land in the folder being viewed and the first becomes the
 *  selection, so the inspector shows what just arrived. */
export async function importDrop(items: ImportItem[]): Promise<ImportResult> {
  if (items.length === 0) return { error: humanError("not an image or video") };
  try {
    const res = await api.importItems(session().browse.filter.folder, items);
    dispatch({ type: "RESCANNED", view: res.view, select: res.imported[0] });
    return { imported: res.imported };
  } catch (problem) {
    return { error: humanError(problem) };
  }
}

/** Resolves to a worded error, or null once the files are gone. */
export async function undoImport(relPaths: string[]): Promise<string | null> {
  try {
    dispatch({ type: "RESCANNED", view: (await api.undoImport(relPaths)).view });
    return null;
  } catch (problem) {
    return humanError(problem);
  }
}
