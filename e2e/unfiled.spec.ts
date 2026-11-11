import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { openFolder, scratchVault } from "./helpers";

// The fixture keeps one file at the vault's root, in no folder.
const LOOSE = "乱码名-A7f3.jpg";
const POSTER = "海报/深色海报.jpg";
const vault = scratchVault("unfiled");

const unfiled = (page: import("@playwright/test").Page) => page.getByRole("button", { name: /^未归档/ });

test("未归档只列出库根目录的素材，拖进去的文件移到根目录", async ({ page }) => {
  await openFolder(page, vault.path);
  await expect(page.getByTestId("thumb")).toHaveCount(12);

  await unfiled(page).click();
  await expect(unfiled(page)).toHaveAttribute("data-active");
  await expect(page.getByTestId("thumb")).toHaveCount(1);
  await expect(page.locator(`[data-rel-path="${LOOSE}"]`)).toBeVisible();
  await expect(page.getByRole("navigation", { name: "当前位置" })).toHaveText(/全部素材.*未归档/);

  await page.getByRole("navigation", { name: "当前位置" }).getByRole("button", { name: "全部素材" }).click();
  await expect(page.getByTestId("thumb")).toHaveCount(12);
  await page.locator(`[data-rel-path="${POSTER}"]`).dragTo(unfiled(page));
  await expect.poll(() => existsSync(join(vault.path, "深色海报.jpg"))).toBe(true);
  await expect(unfiled(page)).toContainText("2");

  await unfiled(page).click();
  await expect(page.getByTestId("thumb")).toHaveCount(2);
});
