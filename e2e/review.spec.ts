import { expect, test, type Page } from "@playwright/test";

// Design review shots of every state worth judging. Skipped in the normal run;
// REVIEW_DIR=<dir> npx playwright test e2e/review.spec.ts writes them there.
const DIR = process.env.REVIEW_DIR;
test.skip(!DIR, "set REVIEW_DIR to take review shots");

async function shot(page: Page, name: string) {
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${DIR}/${name}.png` });
}

async function openVault(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "打开文件夹", exact: true }).click();
  await page.getByLabel("文件夹路径").fill("public/vault");
  await page.getByLabel("文件夹路径").press("Enter");
  await expect(page.getByTestId("thumb").first()).toBeVisible();
}

for (const theme of ["dark", "light"] as const) {
  test(`review ${theme}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.addInitScript((value) => {
      localStorage.setItem("shelf.view", JSON.stringify({ theme: value }));
    }, theme);
    await page.goto("/");
    await page.getByRole("button", { name: "打开文件夹", exact: true }).waitFor();
    await shot(page, `${theme}-01-empty`);

    await openVault(page);
    await page.locator('[data-rel-path="摄影/风景/海边-dusk.jpg"]').click();
    await shot(page, `${theme}-02-wall`);

    await page.getByTestId("center").getByRole("button", { name: "筛选", exact: true }).click();
    await shot(page, `${theme}-03-filter`);
    await page.getByRole("button", { name: "图片", exact: true }).click();
    await page.keyboard.press("Escape");
    await page.getByLabel("搜索素材").fill("黄昏");
    await shot(page, `${theme}-04-search`);
    await page.getByLabel("搜索素材").fill("不存在的词");
    await shot(page, `${theme}-05-no-results`);
    await page.getByLabel("搜索素材").fill("");
    await page.getByRole("button", { name: "移除筛选：图片" }).click();

    await page.locator('[data-rel-path="摄影/风景/海边-dusk.jpg"]').dblclick();
    await page.waitForTimeout(400);
    await shot(page, `${theme}-06-viewer`);
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "查找相似素材" }).click();
    await shot(page, `${theme}-07-similar`);
    await page.getByRole("button", { name: "返回全部素材" }).click();

    await page.getByRole("button", { name: "设置", exact: true }).click();
    await shot(page, `${theme}-08-settings`);
    await page.keyboard.press("Escape");

    await page.setViewportSize({ width: 1024, height: 700 });
    await shot(page, `${theme}-09-narrow`);
  });
}
