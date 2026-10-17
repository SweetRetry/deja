import { useEffect, useRef } from "react";

/** A text field, textarea, select or contenteditable has the keyboard. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

type Options = {
  /** Also fire while a text field has focus (for ⌘ shortcuts). */
  whileTyping?: boolean;
  enabled?: boolean;
};

/**
 * Binds one shortcut on the window. `combo` is a key with optional modifiers,
 * as in "mod+f", "mod+,", "/" or "escape"; `mod` is ⌘ on macOS, Ctrl elsewhere.
 * The handler is read from a ref, so passing a new function each render is fine.
 */
export function useHotkey(combo: string, handler: (event: KeyboardEvent) => void, options: Options = {}) {
  const { whileTyping = false, enabled = true } = options;
  const latest = useRef(handler);
  latest.current = handler;

  useEffect(() => {
    if (!enabled) return;
    const parts = combo.toLowerCase().split("+");
    const key = parts.pop() ?? "";
    const mod = parts.includes("mod");
    const shift = parts.includes("shift");
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.key.toLowerCase() !== key) return;
      if ((event.metaKey || event.ctrlKey) !== mod || event.shiftKey !== shift || event.altKey) return;
      if (!whileTyping && isTyping(event.target)) return;
      event.preventDefault();
      latest.current(event);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [combo, whileTyping, enabled]);
}
