import { expect, test, type Page } from "@playwright/test";

async function matches(page: Page) {
  const texts = await page.getByTestId("score").allInnerTexts();
  return texts.map((text) => Number(/匹配 (\d+)%/.exec(text)?.[1])).filter((n) => !Number.isNaN(n));
}

const below = (page: Page, name: "置暗" | "隐藏") =>
  page.getByRole("group", { name: "低于匹配度的结果" }).getByRole("button", { name, exact: true });

async function setMinMatch(page: Page, value: number) {
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const slider = page.getByRole("slider", { name: "最低匹配度" });
  await slider.focus();
  await page.keyboard.press("Home");
  for (let at = 0; at < value; at += 5) await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("settings")).toContainText(`${value}%`);
}

// The threshold acts on the model's own "匹配 N%" numbers: under it a result
// is faded by default, or leaves the results when the user picks hide.
test("最低匹配度：低于阈值的结果置暗，切到隐藏后不再出现", async ({ page }) => {
  test.setTimeout(240_000);
  // Start from the default preferences once; the reload below must keep what was set.
  await page.goto("/");
  await page.evaluate(() => localStorage.removeItem("shelf.view"));
  await page.reload();
  await page.getByRole("button", { name: "打开文件夹", exact: true }).click();
  await page.getByLabel("文件夹路径").fill("public/vault");
  await page.getByLabel("文件夹路径").press("Enter");
  await expect(page.getByTestId("index-status")).toHaveText("索引已完成", { timeout: 150_000 });
  await page.getByLabel("搜索素材").fill("傍晚的海边");
  await expect(page.locator('[data-semantic="true"]')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("score").first()).toContainText("匹配");

  const scored = await matches(page);
  const total = await page.getByTestId("thumb").count();
  // A threshold that splits the results, on the slider's 5% grid.
  const sorted = [...scored].sort((a, b) => a - b);
  const threshold = Math.ceil((sorted[Math.floor(sorted.length / 2)]! + 1) / 5) * 5;
  const under = scored.filter((n) => n < threshold).length;
  expect(under).toBeGreaterThan(0);
  expect(under).toBeLessThan(scored.length);
  console.log(`matches ${scored.join(",")} threshold ${threshold} under ${under} of ${total}`);

  await setMinMatch(page, threshold);
  await expect(below(page, "置暗")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-testid="thumb"][data-dim="true"]')).toHaveCount(under);
  await expect(page.getByTestId("thumb")).toHaveCount(total);

  await page.getByRole("button", { name: "设置", exact: true }).click();
  await below(page, "隐藏").click();
  await expect(page.getByTestId("settings")).toContainText("不出现在结果中");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("thumb")).toHaveCount(total - under);
  expect(Math.min(...(await matches(page)))).toBeGreaterThanOrEqual(threshold);
  await page.screenshot({ path: process.env.SHOT ?? "test-results/match-hide.png" });

  // The choice survives a reload.
  await page.reload();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.getByTestId("settings")).toContainText(`${threshold}%`);
  await expect(below(page, "隐藏")).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: process.env.SETTINGS_SHOT ?? "test-results/match-settings.png" });
});
