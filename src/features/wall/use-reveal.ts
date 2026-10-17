import { useEffect, useRef } from "react";
import { session, useSession } from "@/app/store";
import { CAPTION_HEIGHT, type Placed } from "./layout";

/**
 * Scrolls a requested tile into view and gives it the keyboard. The tile may
 * not be on the wall yet (a locate can clear the search first), so this waits
 * for a layout that has it, then handles each request once.
 */
export function useReveal(viewport: React.RefObject<HTMLDivElement | null>, placed: Placed[]) {
  const reveal = useSession((s) => s.browse.reveal);
  const handled = useRef(0);
  useEffect(() => {
    const element = viewport.current;
    if (!reveal || reveal.nonce === handled.current || !element) return;
    const tile = placed.find((item) => item.entry.relPath === reveal.relPath);
    if (!tile) return;
    handled.current = reveal.nonce;
    const style = getComputedStyle(element);
    const paddingTop = parseFloat(style.paddingTop) || 0;
    const paddingBottom = parseFloat(style.paddingBottom) || 0;
    const top = paddingTop + tile.y;
    if (reveal.align === "center") {
      element.scrollTo({ top: Math.max(0, top + tile.height / 2 - element.clientHeight / 2), behavior: "smooth" });
      return;
    }
    // The header floats over the top padding, so a tile under it is out of view.
    const bottom = top + tile.height + CAPTION_HEIGHT + paddingBottom;
    if (top - paddingTop < element.scrollTop) element.scrollTo({ top: top - paddingTop });
    else if (bottom > element.scrollTop + element.clientHeight) element.scrollTo({ top: bottom - element.clientHeight });
    // The viewer holds the keyboard while it is open; the tile takes it back after.
    if (session().browse.viewing) return;
    element
      .querySelector<HTMLElement>(`[data-rel-path="${CSS.escape(reveal.relPath)}"]`)
      ?.focus({ preventScroll: true });
  }, [viewport, reveal, placed]);
}
