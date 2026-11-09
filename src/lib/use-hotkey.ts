import { useEffect, useRef } from "react";

/** True when a keystroke or paste lands in a field that handles text itself: a
 *  text field, textarea, select or contenteditable. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

type Options = {
  /** Also fire while a text field has focus (for ⌘ shortcuts). */
  whileTyping?: boolean;
  enabled?: boolean;
  /** Read at the keystroke; false leaves the key to the page, as if unbound. */
  when?: () => boolean;
};

/**
 * Binds one shortcut on the window. `combo` is a key with optional modifiers,
 * as in "mod+f", "mod+,", "/", "escape" or "alt+mod+c"; `mod` is ⌘ on macOS,
 * Ctrl elsewhere. With `alt` a letter is matched by its physical key, since ⌥
 * turns the typed character into another one (⌥C types "ç").
 * The handler is read from a ref, so passing a new function each render is fine.
 */
export function useHotkey(combo: string, handler: (event: KeyboardEvent) => void, options: Options = {}) {
  const { whileTyping = false, enabled = true } = options;
  const latest = useRef(handler);
  latest.current = handler;
  const allowed = useRef(options.when);
  allowed.current = options.when;

  useEffect(() => {
    if (!enabled) return;
    const parts = combo.toLowerCase().split("+");
    const key = parts.pop() ?? "";
    const mod = parts.includes("mod");
    const shift = parts.includes("shift");
    const alt = parts.includes("alt");
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const pressed = alt && /^[a-z]$/.test(key) ? event.code === `Key${key.toUpperCase()}` : event.key.toLowerCase() === key;
      if (!pressed) return;
      if ((event.metaKey || event.ctrlKey) !== mod || event.shiftKey !== shift || event.altKey !== alt) return;
      if (!whileTyping && isTyping(event.target)) return;
      if (allowed.current && !allowed.current()) return;
      event.preventDefault();
      latest.current(event);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [combo, whileTyping, enabled]);
}
