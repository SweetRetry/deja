import { expect, test, type Page } from "@playwright/test";
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SCRATCH_TRASH } from "./scratch-trash";

// Deleting happens on a scratch copy of the fixture vault, and the backend is
// started with a scratch Trash, so a run leaves neither the fixtures nor the
// user's own Trash touched.
const DELETED = "摄影/人像/黄昏逆光-01.jpg";
const NAME = "黄昏逆光-01.jpg";

let vault = "";

test.beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "deja-delete-"));
  cpSync("public/vault", vault, { recursive: true });
  rmSync(SCRATCH_TRASH, { recursive: true, force: true });
});

test.afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

async function openVault(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "打开文件夹", exact: true }).click();
  await page.getByLabel("文件夹路径").fill(vault);
  await page.getByLabel("文件夹路径").press("Enter");
  await expect(page.getByTestId("thumb")).toHaveCount(12);
}

const inspector = (page: Page) => page.getByTestId("inspector").locator("[data-entry]");

test("右键删除把素材移到废纸篓，墙上不再有它", async ({ page }) => {
  await openVault(page);
  await page.locator(`[data-rel-path="${DELETED}"]`).click({ button: "right" });
  await expect(inspector(page)).toHaveAttribute("data-entry", DELETED);
  await page.getByRole("menuitem", { name: "移到废纸篓", exact: true }).click();

  await expect(page.getByTestId("thumb")).toHaveCount(11);
  await expect(page.locator(`[data-rel-path="${DELETED}"]`)).toHaveCount(0);
  // The file is where the user can still get it back.
  expect(existsSync(join(vault, DELETED))).toBe(false);
  expect(readdirSync(SCRATCH_TRASH)).toContain(NAME);
  // The inspector moves on instead of going blank.
  await expect(inspector(page)).not.toHaveAttribute("data-entry", DELETED);
  await expect(page.locator('[data-sonner-toast][data-type="success"]')).toContainText("移到废纸篓");
});

test("斜杠以外的路径不被接受", async ({ page }) => {
  await openVault(page);
  const answer = await page.evaluate(async () => {
    const response = await fetch("/api/trash_entry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ relPath: "../not-in-the-vault.jpg" }),
    });
    return (await response.json()) as { ok: boolean; error?: string };
  });
  expect(answer.ok).toBe(false);
  expect(answer.error).toContain("is not in the vault");
});
