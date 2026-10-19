import { toast } from "sonner";
import { dispatch, session } from "@/app/store";
import { api } from "@/lib/bridge";
import { humanError, messageOf } from "@/lib/errors";
import { readStored, writeStored } from "@/lib/storage";
import type { AppSettings } from "@/lib/types";

const LAST_VAULT = "deja.vault";

export async function openVault(path: string) {
  dispatch({ type: "OPEN", path });
  try {
    // Opened in the order this window sorts in, so the wall the open paints is
    // the wall the first search answers with.
    const view = await api.openVault(path, session().browse.sort);
    writeStored(LAST_VAULT, path);
    dispatch({ type: "OPENED", view });
  } catch (problem) {
    dispatch({ type: "OPEN_FAILED", error: messageOf(problem) });
  }
}

/** Reopens the folder from the last session, once per app load. */
export function reopenLastVault() {
  const last = readStored(LAST_VAULT);
  if (last) void openVault(last);
}

export function closeVault() {
  writeStored(LAST_VAULT, null);
  dispatch({ type: "CLOSE" });
}

export function setPaused(paused: boolean) {
  dispatch({ type: paused ? "PAUSE" : "RESUME" });
}

export async function warmModel() {
  dispatch({ type: "MODEL_WARMING" });
  try {
    await api.warmModel();
    dispatch({ type: "MODEL_READY" });
  } catch {
    dispatch({ type: "MODEL_FAILED" });
  }
}

export async function loadSettings() {
  try {
    dispatch({ type: "SETTINGS", settings: await api.settings() });
  } catch {
    /* the sections that need them keep waiting */
  }
}

/** Shown at once; the backend's normalized copy (trimmed, deduplicated folder
 *  names) replaces it, and a failed write falls back to what is stored. */
export async function saveSettings(next: AppSettings) {
  dispatch({ type: "SETTINGS", settings: next });
  try {
    dispatch({ type: "SETTINGS", settings: await api.saveSettings(next) });
  } catch (problem) {
    toast.error(humanError(problem));
    await loadSettings();
  }
}
