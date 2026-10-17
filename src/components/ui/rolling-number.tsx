import { AnimatePresence, motion, useReducedMotion } from "motion/react";

/**
 * Tabular digits where only the digits that changed roll. A digit is keyed by
 * its place from the right, so a digit that stays put never re-mounts.
 */
export function RollingNumber({ value }: { value: number }) {
  const reduced = useReducedMotion();
  const text = String(value);

  if (reduced) {
    return <span className="tabular-nums">{text}</span>;
  }

  return (
    <span role="img" aria-label={text} className="relative inline-flex overflow-clip tabular-nums">
      <AnimatePresence initial={false} mode="popLayout">
        {Array.from(text, (digit, index) => (
          <motion.span
            key={`${text.length - 1 - index}:${digit}`}
            aria-hidden
            initial={{ y: "100%", opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: "-100%", opacity: 0 }}
          >
            {digit}
          </motion.span>
        ))}
      </AnimatePresence>
    </span>
  );
}
