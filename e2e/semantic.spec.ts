import { expect, test } from "@playwright/test";

// Proves the model path end to end: the app starts the Python sidecar, the
// indexer fills vectors for every file, and the toolbar then reports semantic
// ranking instead of keyword ranking.
test("模型就绪后搜索走语义排序", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await page.getByRole("button", { name: "打开文件夹", exact: true }).click();
  await page.getByLabel("文件夹路径").fill("public/vault");
  await page.getByLabel("文件夹路径").press("Enter");
  await expect(page.locator('[data-slot="sidebar"]')).toBeVisible();

  await expect(page.getByTestId("index-status")).toHaveText("索引已完成", { timeout: 150_000 });
  await page.getByLabel("搜索素材").fill("傍晚的海边");
  await expect(page.locator('[data-semantic="true"]')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("thumb").first()).toBeVisible();
});
