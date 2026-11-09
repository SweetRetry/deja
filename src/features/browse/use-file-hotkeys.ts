import { useHotkey } from "@/lib/use-hotkey";
import { actedOn, copyEntries, trashEntries } from "./commands";

/** Inside a dialog other than the viewer (settings, the folder picker) the
 *  keys belong to that dialog, not to the file behind it. */
function onFiles(): boolean {
  const dialog = document.activeElement?.closest("[role=dialog], [role=alertdialog]");
  return !dialog || dialog.hasAttribute("data-viewer");
}

/** Text the person selected on the page keeps ⌘C for itself. */
const nothingSelected = () => onFiles() && !window.getSelection()?.toString();

/** Finder's keys for the chosen files on the wall, or the file the viewer shows. */
export function useFileHotkeys() {
  useHotkey("mod+c", () => void copyEntries(actedOn(), "file"), { when: nothingSelected });
  useHotkey("alt+mod+c", () => void copyEntries(actedOn(), "path"), { when: onFiles });
  useHotkey("mod+backspace", () => void trashEntries(actedOn()), { when: onFiles });
}
