import { expect, test, type Page } from "@playwright/test";
import { openFolder } from "./helpers";

// Relative to baseURL: vite proxies /api to the e2e backend.
const API = "/api";
const DEFAULTS = { semantic: true, modelIdleSecs: 300 };

async function openVault(page: Page) {
  await openFolder(page);
  await expect(page.getByTestId("thumb").first()).toBeVisible();
}

async function openSettings(page: Page) {
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.getByTestId("settings")).toBeVisible();
}

// settings.json is shared by every test against this backend; leave it as found.
test.afterEach(async ({ request }) => {
  await request.post(`${API}/save_settings`, { data: { settings: DEFAULTS } });
});

test("主题切到浅色后去掉 dark，刷新后仍是浅色", async ({ page }) => {
  await openVault(page);
  await expect(page.locator("html")).toHaveClass(/dark/);
  await openSettings(page);
  await page.getByRole("button", { name: "浅色", exact: true }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
});

test("关闭语义搜索后不再提供搜索方式，后端也只按关键词排序", async ({ page, request }) => {
  await openVault(page);
  await openSettings(page);
  await page.getByRole("group", { name: "按画面内容搜索" }).getByRole("button", { name: "关闭" }).click();
  await expect(page.getByText("已关闭。不加载语义模型")).toBeVisible();
  await expect(page.getByRole("group", { name: "空闲后释放模型" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.getByPlaceholder(/搜索/).fill("黄昏");
  await page.getByTestId("center").getByRole("button", { name: "筛选", exact: true }).click();
  await expect(page.getByRole("group", { name: "搜索方式" })).toHaveCount(0);

  const res = await request.post(`${API}/search`, { data: { query: "黄昏", semantic: true, filter: {} } });
  const body = (await res.json()) as { data: { semantic: boolean } };
  expect(body.data.semantic).toBe(false);
});

test("排序选择跨刷新保留", async ({ page }) => {
  await openVault(page);
  await page.getByTestId("center").getByRole("button", { name: "筛选", exact: true }).click();
  await page.getByRole("button", { name: "修改时间", exact: true }).click();
  await page.reload();
  await expect(page.getByTestId("thumb").first()).toBeVisible();
  await page.getByTestId("center").getByRole("button", { name: "筛选", exact: true }).click();
  await expect(page.getByRole("button", { name: "修改时间", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "名称", exact: true }).click();
});
