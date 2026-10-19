import { expect, test, type Page } from "@playwright/test";
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SCRATCH_TRASH } from "./scratch-trash";

// Managing many files at once, on a scratch copy of the fixture vault with a
// scratch Trash. The fixture ships 黄昏逆光-01 and -02 as the same bytes.
const ORIGINAL = "摄影/人像/黄昏逆光-01.jpg";
const COPY = "摄影/人像/黄昏逆光-02.jpg";
const OTHER = "摄影/人像/逆光-03.jpg";

let vault = "";

test.beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "deja-manage-"));
  cpSync("public/vault", vault, { recursive: true });
  // The older of two byte copies is the one to keep; make that one -01.
  utimesSync(join(vault, ORIGINAL), new Date(2020, 0, 1), new Date(2020, 0, 1));
  rmSync(SCRATCH_TRASH, { recursive: true, force: true });
});

test.afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

async function openVault(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "打开文件夹", exact: true }).click();
  await page.getByLabel("文件夹路径").fill(vault);
  await page.getByLabel("文件夹路径").press("Enter");
  await expect(page.getByTestId("thumb")).toHaveCount(12);
}

const tile = (page: Page, relPath: string) => page.locator(`[data-rel-path="${relPath}"]`);
const panel = (page: Page) => page.getByTestId("inspector").locator("aside");

test("⌘ 点按选中两项，右键一次移到废纸篓", async ({ page }) => {
  await openVault(page);
  await tile(page, ORIGINAL).click();
  await tile(page, OTHER).click({ modifiers: ["ControlOrMeta"] });
  await expect(panel(page)).toHaveAttribute("data-picked-count", "2");
  await expect(page.locator('[data-picked="true"]')).toHaveCount(2);

  // Finder takes a moment to answer; the tiles must not wait for it, and both
  // files go in one request.
  const requests: string[] = [];
  await page.route("**/api/trash_entries", async (route) => {
    requests.push(route.request().postData() ?? "");
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  await tile(page, ORIGINAL).click({ button: "right" });
  await page.getByRole("menuitem", { name: "将 2 项移到废纸篓" }).click();

  await expect(page.getByTestId("thumb")).toHaveCount(10, { timeout: 500 });
  await expect(page.locator('[data-sonner-toast][data-type="success"]')).toContainText("2 项素材");
  expect(requests).toHaveLength(1);
  expect(readdirSync(SCRATCH_TRASH).sort()).toEqual(["逆光-03.jpg", "黄昏逆光-01.jpg"].sort());
  await expect(page.locator('[data-sonner-toast][data-type="success"]')).toContainText("2 项素材");
  await expect(panel(page)).not.toHaveAttribute("data-picked-count");
});

test("⌘ 点按选中三项，Esc 取消，再从检视面板移到另一个文件夹", async ({ page }) => {
  await openVault(page);
  const pickPortraits = async () => {
    await tile(page, ORIGINAL).click();
    await tile(page, COPY).click({ modifiers: ["ControlOrMeta"] });
    await tile(page, OTHER).click({ modifiers: ["ControlOrMeta"] });
    await expect(panel(page)).toHaveAttribute("data-picked-count", "3");
  };
  await pickPortraits();
  await page.keyboard.press("Escape");
  await expect(panel(page)).not.toHaveAttribute("data-picked-count");
  // A ⇧-click is a plain click: it picks nothing.
  await tile(page, COPY).click({ modifiers: ["Shift"] });
  await expect(panel(page)).not.toHaveAttribute("data-picked-count");
  await pickPortraits();

  await page.getByRole("button", { name: "移动到…" }).click();
  await page.getByRole("menuitem", { name: "海报" }).click();
  await expect(page.locator('[data-sonner-toast][data-type="success"]')).toContainText("已将 3 项素材移到「海报」");
  expect(existsSync(join(vault, "海报/逆光-03.jpg"))).toBe(true);
  // Finder may leave a .DS_Store behind; no picture stays.
  expect(readdirSync(join(vault, "摄影/人像")).filter((name) => !name.startsWith("."))).toEqual([]);
  // They stay picked under their new paths, ready for the next action.
  await expect(panel(page)).toHaveAttribute("data-picked-count", "3");
  await expect(page.getByTestId("thumb")).toHaveCount(12);
  await expect(tile(page, "海报/黄昏逆光-01.jpg")).toBeVisible();
});

test("重复素材按组列出，选中多余副本后移到废纸篓", async ({ page }) => {
  await openVault(page);
  await page.getByRole("button", { name: "重复素材" }).click();
  await expect(page.getByTestId("duplicate-summary")).toHaveText("1 组，多出 1 个副本");
  await expect(page.getByTestId("thumb")).toHaveCount(2);
  await expect(tile(page, ORIGINAL).getByTestId("copy-note")).toContainText("保留");
  await expect(tile(page, COPY).getByTestId("copy-note")).toContainText("相同副本");

  await page.getByRole("button", { name: "选中多余副本" }).click();
  await expect(page.getByTestId("inspector").locator("[data-entry]")).toHaveAttribute("data-entry", COPY);
  await tile(page, COPY).click({ button: "right" });
  await page.getByRole("menuitem", { name: "移到废纸篓", exact: true }).click();

  await expect(page.getByTestId("duplicate-summary")).toHaveText("没有重复");
  // The tile leaves before Finder answers; the toast is the answer.
  await expect(page.locator('[data-sonner-toast][data-type="success"]')).toContainText("移到废纸篓");
  expect(readdirSync(SCRATCH_TRASH)).toEqual(["黄昏逆光-02.jpg"]);
  await page.getByRole("button", { name: "返回全部素材" }).click();
  await expect(page.getByTestId("thumb")).toHaveCount(11);
});
