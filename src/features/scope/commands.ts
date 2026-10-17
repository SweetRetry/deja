import { toast } from "sonner";
import { create } from "zustand";
import { dispatch } from "@/app/store";
import { api } from "@/lib/bridge";
import { humanError } from "@/lib/errors";

/** Whether the user reopened the picker to change an earlier choice. The first
 *  choice needs no flag: the vault's "scoping" phase opens the picker itself. */
export const useScopeEditor = create<{ open: boolean }>()(() => ({ open: false }));

export const editScope = (open = true) => useScopeEditor.setState({ open });

/** Saves the choice; the backend answers with the vault rescanned under it.
 *  Resolves false when the write failed, so the picker stays open. */
export async function chooseScope(excluded: string[]): Promise<boolean> {
  try {
    dispatch({ type: "SCOPED", view: await api.setScope(excluded) });
    return true;
  } catch (problem) {
    toast.error(humanError(problem));
    return false;
  }
}
