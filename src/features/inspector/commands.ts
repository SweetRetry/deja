import { toast } from "sonner";
import { dispatch, session } from "@/app/store";
import { api } from "@/lib/bridge";
import { humanError } from "@/lib/errors";
import type { EntryMeta } from "@/lib/types";

/** Tags, rating and note are undoable and rarely fail: shown at once, written
 *  in the background, and reverted with a toast if the write fails. */
export async function editMeta(relPath: string, part: Partial<EntryMeta>) {
  const entry = session().vault.library?.byPath[relPath];
  if (!entry) return;
  const meta: EntryMeta = { tags: entry.tags, rating: entry.rating, note: entry.note, source: entry.source, ...part };
  dispatch({ type: "META_EDITED", relPath, meta });
  try {
    dispatch({ type: "META_SAVED", entry: await api.saveMeta(relPath, meta) });
  } catch (problem) {
    dispatch({ type: "META_FAILED", relPath });
    toast.error(`没能保存「${entry.name}」的修改，已恢复原值。${humanError(problem)}`);
  }
}
