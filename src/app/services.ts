import { startSearch } from "@/features/browse/search";
import { reopenLastVault, loadSettings } from "@/features/vault/commands";
import { startIndexing } from "@/features/vault/indexer";
import { startTray } from "@/features/vault/tray";

/** Everything that runs on its own once the app is up. Idempotent across HMR. */
export function startServices(): () => void {
  void loadSettings();
  const stops = [startSearch(), startIndexing(), startTray()];
  reopenLastVault();
  return () => stops.forEach((stop) => stop());
}
