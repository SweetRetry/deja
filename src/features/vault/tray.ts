import { listen } from "@tauri-apps/api/event";
import { inTauri } from "@/lib/bridge";
import { openVault } from "./commands";

/** Must match `OPEN_VAULT_EVENT` in src-tauri/src/tray.rs. */
const OPEN_VAULT_EVENT = "tray-open-vault";

/** A recent folder picked from the menu bar icon opens like a picked one. The
 *  browser build has no tray. */
export function startTray(): () => void {
  if (!inTauri) return () => {};
  const unlisten = listen<string>(OPEN_VAULT_EVENT, (event) => void openVault(event.payload));
  return () => void unlisten.then((stop) => stop());
}
