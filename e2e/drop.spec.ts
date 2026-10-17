import { expect, test, type Page } from "@playwright/test";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A browser drag arrives as a DataTransfer: file bytes when the page can read
// them, otherwise the image's markup and link. Both shapes are synthesized here
// and land in a scratch copy of the fixture vault, so the shared one stays clean.
let vault = "";

test.beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "shelf-drop-"));
  cpSync("public/vault", vault, { recursive: true });
});

test.afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

async function openScratch(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "打开文件夹", exact: true }).click();
  await page.getByLabel("文件夹路径").fill(vault);
  await page.getByLabel("文件夹路径").press("Enter");
  await expect(page.getByTestId("thumb")).toHaveCount(12);
}

/** A fixture image with one byte appended: still a jpeg, but new to the vault. */
function freshJpeg(): string {
  return Buffer.concat([readFileSync("public/vault/乱码名-A7f3.jpg"), Buffer.from([0])]).toString("base64");
}

async function dropFile(page: Page, base64: string, name: string, hold = false) {
  await page.evaluate(
    ({ base64, name, hold }) => {
      const data = new DataTransfer();
      const raw = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      data.items.add(new File([raw], name, { type: "image/jpeg" }));
      data.setData("text/uri-list", "https://example.com/pic.jpg");
      window.dispatchEvent(new DragEvent("dragover", { dataTransfer: data, cancelable: true }));
      if (hold) (window as unknown as { __drop: DataTransfer }).__drop = data;
      else window.dispatchEvent(new DragEvent("drop", { dataTransfer: data, cancelable: true }));
    },
    { base64, name, hold },
  );
}

const inspector = (page: Page) => page.getByRole("complementary", { name: "检视面板" });
const toast = (page: Page, type: string) => page.locator(`[data-sonner-toast][data-type="${type}"]`);

test("悬停显示导入提示，松开后文件进入当前文件夹并被选中", async ({ page }) => {
  await openScratch(page);
  await page.getByRole("button", { name: /海报/ }).first().click();

  await dropFile(page, freshJpeg(), "拖进来的.jpg", true);
  await expect(page.getByTestId("drop-overlay")).toHaveAttribute("data-state", "open");
  await expect(page.getByTestId("drop-overlay")).toContainText("松开以导入到「海报」");

  await page.evaluate(() => {
    const data = (window as unknown as { __drop: DataTransfer }).__drop;
    window.dispatchEvent(new DragEvent("drop", { dataTransfer: data, cancelable: true }));
  });
  await expect(page.getByTestId("drop-overlay")).toHaveAttribute("data-state", "closed");
  await expect(toast(page, "success")).toContainText("已导入 1 项到「海报」");
  await expect(inspector(page)).toHaveAttribute("data-entry", "海报/拖进来的.jpg");
  expect(existsSync(join(vault, "海报/拖进来的.jpg"))).toBe(true);
  expect(readFileSync(join(vault, ".shelf/meta/海报/拖进来的.jpg.md"), "utf8")).toContain(
    "source: https://example.com/pic.jpg",
  );
});

test("导入后墙不闪：结果不先换成整个文件夹，也不变暗", async ({ page }) => {
  await openScratch(page);
  await page.getByRole("button", { name: /海报/ }).first().click();
  await expect(page.getByTestId("thumb")).toHaveCount(3);
  // Records every tile count and dim state the wall passes through after the drop.
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __seen: string[] }).__seen = seen;
    const wall = document.querySelector('[data-testid="center"]')!;
    new MutationObserver(() => {
      const dim = wall.querySelector(".opacity-60") ? "dim" : "lit";
      seen.push(`${document.querySelectorAll('[data-testid="thumb"]').length}:${dim}`);
    }).observe(wall, { subtree: true, childList: true, attributes: true });
  });
  await dropFile(page, freshJpeg(), "新.jpg");
  await expect(inspector(page)).toHaveAttribute("data-entry", "海报/新.jpg");
  await expect(page.getByTestId("thumb")).toHaveCount(4);
  // Long enough for the watcher's rescan and the index ticks to come and go.
  await page.waitForTimeout(3000);
  const seen = await page.evaluate(() => (window as unknown as { __seen: string[] }).__seen);
  expect([...new Set(seen)].sort()).toEqual(["3:lit", "4:lit"]);
});

test("同样内容的图不重复导入，选中已有的那张", async ({ page, baseURL }) => {
  await openScratch(page);
  // Served by vite from the fixture vault; the backend downloads it with curl.
  const src = `${baseURL}/vault/${encodeURIComponent("乱码名-A7f3.jpg")}?name=x`;
  await page.locator('[data-rel-path="海报/和风-02.jpg"]').click();
  await page.evaluate((url) => {
    const data = new DataTransfer();
    data.setData("text/html", `<a href="https://example.com/page"><img src="${url}"></a>`);
    data.setData("text/uri-list", "https://example.com/page");
    window.dispatchEvent(new DragEvent("drop", { dataTransfer: data, cancelable: true }));
  }, src);
  await expect(toast(page, "success")).toContainText("素材库里已有这张图");
  await expect(toast(page, "success").getByRole("button", { name: "撤回" })).toHaveCount(0);
  await expect(inspector(page)).toHaveAttribute("data-entry", "乱码名-A7f3.jpg");
  expect(existsSync(join(vault, "乱码名-A7f3 2.jpg"))).toBe(false);
  await expect(page.getByTestId("thumb")).toHaveCount(12);
});

test("定位清掉挡住它的搜索并滚到那张图，撤回删掉导入的文件", async ({ page }) => {
  await openScratch(page);
  await page.getByRole("button", { name: /海报/ }).first().click();
  await dropFile(page, freshJpeg(), "zz-最后一张.jpg");
  await expect(toast(page, "success")).toContainText("已导入 1 项到「海报」");

  await page.getByLabel("搜索素材").fill("不会命中的词");
  await page.getByRole("button", { name: "定位" }).click();
  await expect(page.getByLabel("搜索素材")).toHaveValue("");
  await expect(page.locator('[data-rel-path="海报/zz-最后一张.jpg"]')).toBeInViewport();
  await expect(inspector(page)).toHaveAttribute("data-entry", "海报/zz-最后一张.jpg");

  await page.getByRole("button", { name: "撤回" }).click();
  await expect(toast(page, "success")).toContainText("已撤回导入");
  expect(existsSync(join(vault, "海报/zz-最后一张.jpg"))).toBe(false);
  expect(existsSync(join(vault, ".shelf/meta/海报/zz-最后一张.jpg.md"))).toBe(false);
  await expect(page.locator('[data-rel-path="海报/zz-最后一张.jpg"]')).toHaveCount(0);
});

test("拖动应用内的缩略图不会导入副本", async ({ page }) => {
  await openScratch(page);
  await page.getByTestId("thumb").first().dragTo(page.getByTestId("thumb").nth(3));
  await expect(page.getByTestId("drop-overlay")).toHaveAttribute("data-state", "closed");
  await expect(page.getByTestId("thumb")).toHaveCount(12);
});

test("拖入的内容里没有图片时提示原因", async ({ page }) => {
  await openScratch(page);
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData("text/html", "<p>一段文字</p>");
    window.dispatchEvent(new DragEvent("drop", { dataTransfer: data, cancelable: true }));
  });
  await expect(toast(page, "error")).toContainText("拖入的内容里没有图片或视频。");
});
