import { expect, test, type Page } from "@playwright/test";
import { cpSync, existsSync, statSync, mkdtempSync, readdirSync, rmSync, utimesSync } from "node:fs";
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

const folderRow = (page: Page, name: string) =>
  page.locator('[data-sidebar="menu-button"]').filter({ hasText: new RegExp(`^${name}\\s*\\d*$`) });

test("侧栏新建文件夹，空文件夹可在侧栏隐藏", async ({ page }) => {
  await openVault(page);
  await page.getByRole("button", { name: "新建文件夹" }).click();
  await page.getByLabel("新文件夹名称").fill("待整理");
  await page.getByLabel("新文件夹名称").press("Enter");

  // The wall opens the new folder, empty, and its row is the active one.
  await expect(folderRow(page, "待整理")).toHaveAttribute("data-active");
  expect(statSync(join(vault, "待整理")).isDirectory()).toBe(true);
  await expect(page.getByTestId("thumb")).toHaveCount(0);

  // The header button makes a top-level folder from inside another folder too,
  // so a taken top-level name is refused and the field stays for another try.
  await page.getByRole("button", { name: "新建文件夹" }).click();
  await page.getByLabel("新文件夹名称").fill("海报");
  await page.getByLabel("新文件夹名称").press("Enter");
  await expect(page.locator('[data-sonner-toast][data-type="error"]')).toContainText("同名");
  await page.getByLabel("新文件夹名称").press("Escape");
  await expect(page.getByLabel("新文件夹名称")).toHaveCount(0);

  // Hidden empty folders keep the one being viewed until the wall leaves it.
  await folderRow(page, "待整理").click();
  await page.getByRole("button", { name: "文件夹选项" }).click();
  await page.getByRole("menuitemcheckbox", { name: "显示空文件夹" }).click();
  await page.keyboard.press("Escape");
  await expect(folderRow(page, "待整理")).toBeVisible();
  await folderRow(page, "全部素材").click();
  await expect(folderRow(page, "待整理")).toHaveCount(0);

  // A subfolder from a folder's own menu; it opens even with empty folders hidden.
  await folderRow(page, "海报").click({ button: "right" });
  await page.getByRole("menuitem", { name: "新建子文件夹" }).click();
  await page.getByLabel("新文件夹名称").fill("旧稿");
  await page.getByLabel("新文件夹名称").press("Enter");
  await expect(folderRow(page, "旧稿")).toHaveAttribute("data-active");
  expect(statSync(join(vault, "海报/旧稿")).isDirectory()).toBe(true);

  // The setting and the sidebar menu are one switch.
  await page.getByRole("button", { name: "设置" }).click();
  const settings = page.getByTestId("settings");
  const empty = settings.getByRole("group", { name: "空文件夹" });
  await expect(empty.getByRole("button", { name: "隐藏" })).toHaveAttribute("aria-pressed", "true");
  await empty.getByRole("button", { name: "显示" }).click();
  await page.keyboard.press("Escape");
  await expect(folderRow(page, "待整理")).toBeVisible();
});
