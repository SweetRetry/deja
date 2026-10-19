import { expect, test, type Page } from "@playwright/test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FIXTURE_VAULT, openFolder } from "./helpers";

const META_DIR = join(FIXTURE_VAULT, ".deja/meta");

async function openVault(page: Page) {
  await openFolder(page);
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
    if (existsSync(path)) {
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

test("标签写进 .deja/meta 并跨刷新保留", async ({ page }) => {
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

test("在 Finder 里新增文件后几秒内出现在素材墙", async ({ page }) => {
  await openVault(page);
  const name = "验收-新增.jpg";
  const target = join(FIXTURE_VAULT, name);
  writeFileSync(target, readFileSync(join(FIXTURE_VAULT, "海报/和风-02.jpg")));
  try {
    await expect(page.locator(`[data-rel-path="${name}"]`)).toBeVisible({ timeout: 15_000 });
  } finally {
    rmSync(target, { force: true });
  }
  await expect(page.locator(`[data-rel-path="${name}"]`)).toHaveCount(0, { timeout: 15_000 });
});

test("每项页脚给出类型图标与评分，未评分的不占位", async ({ page }) => {
  await openVault(page);
  const tile = (relPath: string) => page.locator(`[data-rel-path="${relPath}"]`);

  // 12 files, so each tile is measured against the same wall.
  await expect(page.getByTestId("thumb")).toHaveCount(12);
  await expect(tile("摄影/风景/海边-dusk.jpg")).toHaveAttribute("data-kind", "image");
  await expect(tile("摄影/风景/海边-dusk.jpg").getByTestId("tile-rating")).toHaveAttribute("data-rating", "5");
  await expect(tile("UI参考/登录页/渐变按钮-03.jpg").getByTestId("tile-rating")).toHaveAttribute("data-rating", "3");
  // 黄昏逆光-01 ships without meta, so its footer carries no stars at all.
  await expect(tile("摄影/人像/黄昏逆光-01.jpg").getByTestId("tile-rating")).toHaveCount(0);
});
