import { session } from "@/app/store";
import { chosen } from "./browse";

const ENTRIES = "application/x-deja-entries";

/** Starts a drag of the files a tile stands for: the whole picked set when the
 *  tile is in it, else that tile alone. */
export function dragEntries(data: DataTransfer, relPath: string) {
  const { browse } = session();
  const paths = browse.picked.includes(relPath) ? chosen(browse) : [relPath];
  data.setData(ENTRIES, JSON.stringify(paths));
  data.effectAllowed = "move";
}

/** True while the drag in flight carries files of the wall. */
export const carriesEntries = (data: DataTransfer) => data.types.includes(ENTRIES);

/** The files a drop carried. Only readable inside the drop handler. */
export function droppedEntries(data: DataTransfer): string[] {
  try {
    const paths: unknown = JSON.parse(data.getData(ENTRIES));
    return Array.isArray(paths) ? paths.filter((path) => typeof path === "string") : [];
  } catch {
    return [];
  }
}
