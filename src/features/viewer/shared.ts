/** The Motion `layoutId` a file's picture carries, so the wall tile and the
 *  viewer are one element moving between two places. Only the selected tile
 *  sets it, which keeps the shared-layout bookkeeping to one element. */
export const mediaLayoutId = (relPath: string) => `media:${relPath}`;
