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

test("悬停显示导入提示，松开后文件进入当前文件夹并被选中", async ({ page }) => {
  await openScratch(page);
  await page.getByRole("button", { name: /海报/ }).first().click();

  const bytes = readFileSync("public/vault/乱码名-A7f3.jpg").toString("base64");
  await page.evaluate((base64) => {
    const data = new DataTransfer();
    const raw = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    data.items.add(new File([raw], "拖进来的.jpg", { type: "image/jpeg" }));
    data.setData("text/uri-list", "https://example.com/pic.jpg");
    (window as unknown as { __drop: DataTransfer }).__drop = data;
    window.dispatchEvent(new DragEvent("dragover", { dataTransfer: data, cancelable: true }));
  }, bytes);
  await expect(page.getByTestId("drop-overlay")).toHaveAttribute("data-state", "open");
  await expect(page.getByTestId("drop-overlay")).toContainText("松开以导入到「海报」");

  await page.evaluate(() => {
    const data = (window as unknown as { __drop: DataTransfer }).__drop;
    window.dispatchEvent(new DragEvent("drop", { dataTransfer: data, cancelable: true }));
  });
  await expect(page.getByTestId("drop-overlay")).toHaveAttribute("data-state", "closed");
  await expect(page.getByRole("complementary", { name: "检视面板" })).toHaveAttribute(
    "data-entry",
    "海报/拖进来的.jpg",
  );
  await expect(page.getByTestId("import-toast")).toHaveText("已导入 1 项到「海报」");
  expect(existsSync(join(vault, "海报/拖进来的.jpg"))).toBe(true);
  expect(readFileSync(join(vault, ".shelf/meta/海报/拖进来的.jpg.md"), "utf8")).toContain(
    "source: https://example.com/pic.jpg",
  );
});

test("只带图片链接的拖放由后端下载，扩展名按内容判断", async ({ page, baseURL }) => {
  await openScratch(page);
  // Served by vite from the fixture vault; the name lies about the format on purpose.
  const src = `${baseURL}/vault/${encodeURIComponent("乱码名-A7f3.jpg")}?name=x`;
  await page.evaluate((url) => {
    const data = new DataTransfer();
    data.setData("text/html", `<a href="https://example.com/page"><img src="${url}"></a>`);
    data.setData("text/uri-list", "https://example.com/page");
    window.dispatchEvent(new DragEvent("dragover", { dataTransfer: data, cancelable: true }));
    window.dispatchEvent(new DragEvent("drop", { dataTransfer: data, cancelable: true }));
  }, src);
  await expect(page.getByRole("complementary", { name: "检视面板" })).toHaveAttribute(
    "data-entry",
    "乱码名-A7f3 2.jpg",
  );
  // The wall only renders tiles in view, so look for the new tile, not a count.
  await expect(page.locator('[data-rel-path="乱码名-A7f3 2.jpg"]')).toBeVisible();
  expect(existsSync(join(vault, ".shelf/meta/乱码名-A7f3 2.jpg.md"))).toBe(true);
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
  await expect(page.getByTestId("import-toast")).toHaveAttribute("data-kind", "failed");
  await expect(page.getByTestId("import-toast")).toHaveText("拖入的内容里没有图片或视频。");
});
