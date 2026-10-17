import { tmpdir } from "node:os";
import { join } from "node:path";

/** Where the e2e backend sends deleted files. playwright.config.ts starts the
 *  backend with DEJA_TRASH_DIR here, so a suite never touches the real Trash. */
export const SCRATCH_TRASH = join(tmpdir(), "deja-e2e-trash");
