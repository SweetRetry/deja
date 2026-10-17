import { expect, test, type Page } from "@playwright/test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const VAULT = "public/vault";
const META_DIR = join(VAULT, ".shelf/meta");

async function openVault(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "打开文件夹", exact: true }).click();
  await page.getByLabel("文件夹路径").fill(VAULT);
  await page.getByLabel("文件夹路径").press("Enter");
  await expect(page.locator('[data-slot="sidebar"]')).toHaveAttribute("data-state", "expanded");
  await expect(page.getByTestId("thumb").first()).toBeVisible();
}

/** Ranking must be deterministic here, so the keyword list is the one asserted.
 *  While there is a query the filter panel offers the ranking instead of the sort. */
async function useKeywordRanking(page: Page) {
  await openPanel(page);
  await page.getByRole("button", { name: "关键词", exact: true }).click();
  await expect(page.getByRole("button", { name: "关键词", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
}

async function openPanel(page: Page) {
  await page.getByTestId("center").getByRole("button", { name: "筛选", exact: true }).click();
}

async function selectImage(page: Page, relPath: string) {
  await page.goto("/");
  await expect(page.getByTestId("thumb").first()).toBeVisible();
  await page.locator(`[data-rel-path="${relPath}"]`).click();
  await expect(page.getByRole("complementary", { name: "检视面板" })).toHaveAttribute("data-entry", relPath);
}

function metaFile(relPath: string) {
  return join(META_DIR, `${relPath}.md`);
}

test.afterEach(() => {
  for (const relPath of ["摄影/人像/黄昏逆光-01.jpg", "海报/深色海报.jpg"]) {
    const path = metaFile(relPath);
    if (existsSync(path) && !relPath.includes("深色登录")) {
      const text = readFileSync(path, "utf8");
      // Only remove files this suite created; the seeded fixtures stay.
      if (!text.includes("source:")) rmSync(path, { force: true });
    }
  }
});

test("打开文件夹后三栏同时出现，缩略图墙有素材", async ({ page }) => {
  await openVault(page);
  await expect(page.locator('[data-slot="sidebar"]')).toHaveAttribute("data-state", "expanded");
  await expect(page.getByTestId("center")).toBeVisible();
  await expect(page.getByTestId("inspector")).toBeVisible();
  await expect(page.getByTestId("thumb")).toHaveCount(12);
});

test("侧栏能收起和展开", async ({ page }) => {
  await openVault(page);
  const sidebar = page.locator('[data-slot="sidebar"]');
  await expect(sidebar).toHaveAttribute("data-state", "expanded");
  await page.getByRole("button", { name: "收起侧栏" }).click();
  await expect(sidebar).toHaveAttribute("data-state", "collapsed");
  await page.getByRole("button", { name: "展开侧栏" }).click();
  await expect(sidebar).toHaveAttribute("data-state", "expanded");
});

test("中文搜索命中文件名与标签", async ({ page }) => {
  await openVault(page);
  await page.getByLabel("搜索素材").fill("黄昏");
  await useKeywordRanking(page);
  await expect(page.getByTestId("thumb")).toHaveCount(3);
  await expect(page.getByTestId("thumb").first()).toHaveAttribute(
    "data-rel-path",
    "摄影/人像/黄昏逆光-01.jpg",
  );
});

test("无空格中文查询也能命中", async ({ page }) => {
  await openVault(page);
  await page.getByLabel("搜索素材").fill("深色登录");
  await useKeywordRanking(page);
  await expect(page.getByTestId("thumb").first()).toHaveAttribute(
    "data-rel-path",
    "UI参考/登录页/深色登录-dribbble.jpg",
  );
  await page.getByLabel("搜索素材").fill("不存在的词");
  await expect(page.getByText("没有匹配「不存在的词」的素材")).toBeVisible();
});

test("筛选视频类型时显示空态", async ({ page }) => {
  await openVault(page);
  await openPanel(page);
  await page.getByRole("button", { name: "视频", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByText("此文件夹中没有视频")).toBeVisible();
  // The active filter stays removable from the toolbar without the panel.
  await page.getByRole("button", { name: "移除筛选：视频" }).click();
  await expect(page.getByTestId("thumb").first()).toBeVisible();
});

test("标签写进 .shelf/meta 并跨刷新保留", async ({ page }) => {
  await openVault(page);
  await selectImage(page, "摄影/人像/黄昏逆光-01.jpg");
  await page.getByLabel("添加标签").fill("逆光参考");
  await page.getByLabel("添加标签").press("Enter");
  const file = metaFile("摄影/人像/黄昏逆光-01.jpg");
  await expect
    .poll(() => (existsSync(file) ? readFileSync(file, "utf8") : ""), { timeout: 5000 })
    .toContain("逆光参考");
  await page.reload();
  await selectImage(page, "摄影/人像/黄昏逆光-01.jpg");
  await expect(page.getByRole("button", { name: /逆光参考/ })).toBeVisible();
});

test("评分与备注写进 frontmatter", async ({ page }) => {
  await openVault(page);
  await selectImage(page, "海报/深色海报.jpg");
  await page.getByRole("button", { name: "评为 4 星" }).click();
  await expect(page.getByRole("button", { name: "评为 4 星" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "评为 5 星" })).toHaveAttribute("aria-pressed", "false");
  await page.getByLabel("备注").fill("深色底，留白多，可做封面。");
  const file = metaFile("海报/深色海报.jpg");
  await expect
    .poll(() => (existsSync(file) ? readFileSync(file, "utf8") : ""), { timeout: 6000 })
    .toContain("深色底，留白多，可做封面。");
  const text = readFileSync(file, "utf8");
  expect(text).toContain("rating: 4");
  expect(text.startsWith("---\n")).toBe(true);
});

test("以图找图把近似重复排在第一位", async ({ page }) => {
  await openVault(page);
  await selectImage(page, "摄影/人像/黄昏逆光-01.jpg");
  await page.getByRole("button", { name: "查找相似素材" }).click();
  await expect(page.getByRole("heading", { name: "相似素材" })).toBeVisible();
  await expect(page.getByTestId("thumb").first()).toHaveAttribute(
    "data-rel-path",
    "摄影/人像/黄昏逆光-02.jpg",
  );
  await page.getByRole("button", { name: "返回全部素材" }).click();
  await expect(page.getByRole("heading", { name: "相似素材" })).toHaveCount(0);
  await expect(page.getByTestId("thumb")).toHaveCount(12);
});

test("切换排序会改变结果顺序", async ({ page }) => {
  await openVault(page);
  const first = () => page.getByTestId("thumb").first().getAttribute("data-rel-path");
  const byName = await first();
  await openPanel(page);
  await page.getByRole("button", { name: "大小", exact: true }).click();
  await expect
    .poll(async () => first())
    .not.toBe(byName);
});

test("在 Finder 里新增文件后几秒内出现在素材墙", async ({ page }) => {
  await openVault(page);
  const name = "验收-新增.jpg";
  const target = join(VAULT, name);
  writeFileSync(target, readFileSync(join(VAULT, "海报/和风-02.jpg")));
  try {
    await expect(page.locator(`[data-rel-path="${name}"]`)).toBeVisible({ timeout: 15_000 });
  } finally {
    rmSync(target, { force: true });
  }
  await expect(page.locator(`[data-rel-path="${name}"]`)).toHaveCount(0, { timeout: 15_000 });
});

test("暂停后索引不再推进，继续后恢复", async ({ page }) => {
  await openVault(page);
  await page.getByRole("button", { name: "暂停" }).click();
  await expect(page.getByRole("button", { name: "继续" })).toBeVisible();
  await expect(page.getByText("已暂停")).toBeVisible();
  await page.getByRole("button", { name: "继续" }).click();
  await expect(page.getByRole("button", { name: "暂停" })).toBeVisible();
});

test("瀑布流与网格可以切换", async ({ page }) => {
  await openVault(page);
  await expect(page.getByTestId("grid")).toHaveAttribute("data-layout", "masonry");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "网格" }).click();
  await expect(page.getByTestId("grid")).toHaveAttribute("data-layout", "grid");
  await page.getByRole("button", { name: "瀑布流" }).click();
  await expect(page.getByTestId("grid")).toHaveAttribute("data-layout", "masonry");
});
