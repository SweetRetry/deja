import { test, type Page } from "@playwright/test";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The fixture vault `npm run fixtures` writes. Specs that change files copy it first. */
export const FIXTURE_VAULT = "public/vault";

/** Types the path into the open-folder box. Each spec waits for what it needs
 *  afterwards: they differ on purpose, from a visible tile to a full index.
 *  Pass `navigate: false` when the page is already loaded. */
export async function openFolder(page: Page, path = FIXTURE_VAULT, { navigate = true } = {}) {
  if (navigate) await page.goto("/");
  await page.getByRole("button", { name: "打开文件夹", exact: true }).click();
  await page.getByLabel("文件夹路径").fill(path);
  await page.getByLabel("文件夹路径").press("Enter");
}

/** A sonner toast, of one type or of any. */
export const toast = (page: Page, type?: "success" | "error") =>
  page.locator(type ? `[data-sonner-toast][data-type="${type}"]` : "[data-sonner-toast]");

/** A fresh copy of the fixture vault for each test, removed afterwards, so the
 *  shared one stays clean. `prepare` runs on the copy before the test does.
 *  Call it at the top of a spec; read the folder as `vault.path` inside tests. */
export function scratchVault(name: string, prepare?: (path: string) => void) {
  const vault = { path: "" };
  test.beforeEach(() => {
    vault.path = mkdtempSync(join(tmpdir(), `deja-${name}-`));
    cpSync(FIXTURE_VAULT, vault.path, { recursive: true });
    prepare?.(vault.path);
  });
  test.afterEach(() => {
    rmSync(vault.path, { recursive: true, force: true });
  });
  return vault;
}
