import type { Transition } from "motion/react";

/** The Motion `layoutId` a file's picture carries, so the wall tile and the
 *  viewer are one element moving between two places. Only the selected tile
 *  sets it, which keeps the shared-layout bookkeeping to one element. */
export const mediaLayoutId = (relPath: string) => `media:${relPath}`;

/** Opening grows the wall tile into the viewer, and closing shrinks it back. */
export const GROW: Transition = { layout: { duration: 0.24 } };
/** Every other move of the shared picture lands at once. */
export const SWAP: Transition = { layout: { duration: 0 } };
