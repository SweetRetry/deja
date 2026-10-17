import { test } from "@playwright/test";

// Keeps a picture of the three columns as they ship, for design review.
test("留一张三栏截图", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await page.getByRole("button", { name: "打开文件夹", exact: true }).click();
  await page.getByLabel("文件夹路径").fill("public/vault");
  await page.getByLabel("文件夹路径").press("Enter");
  await page.getByTestId("thumb").first().waitFor();
  await page.locator('[data-rel-path="摄影/风景/海边-dusk.jpg"]').click();
  await page.getByLabel("搜索素材").fill("黄昏");
  // The first query is answered with keywords while the model warms; wait for
  // the upgrade so the shot shows the shipped state.
  await page.locator('[data-semantic="true"]').waitFor({ timeout: 60_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: "verification/three-columns.jpg", fullPage: false });
});

test("留一张未打开文件夹的截图", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "打开文件夹", exact: true }).waitFor();
  await page.screenshot({ path: "verification/empty-vault.jpg" });
});
