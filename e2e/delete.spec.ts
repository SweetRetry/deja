import { expect, test, type Page } from "@playwright/test";
import { existsSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { openFolder, scratchVault, toast } from "./helpers";
import { SCRATCH_TRASH } from "./scratch-trash";

// Deleting happens on a scratch copy of the fixture vault, and the backend is
// started with a scratch Trash, so a run leaves neither the fixtures nor the
// user's own Trash touched.
const DELETED = "摄影/人像/黄昏逆光-01.jpg";
const NAME = "黄昏逆光-01.jpg";

const vault = scratchVault("delete", () => rmSync(SCRATCH_TRASH, { recursive: true, force: true }));

async function openVault(page: Page) {
  await openFolder(page, vault.path);
  await expect(page.getByTestId("thumb")).toHaveCount(12);
}

const inspector = (page: Page) => page.getByTestId("inspector").locator("[data-entry]");

test("右键删除把素材移到废纸篓，墙上不再有它", async ({ page }) => {
  await openVault(page);
  await page.locator(`[data-rel-path="${DELETED}"]`).click({ button: "right" });
  await expect(inspector(page)).toHaveAttribute("data-entry", DELETED);
  await page.getByRole("menuitem", { name: "移到废纸篓", exact: true }).click();

  await expect(page.getByTestId("thumb")).toHaveCount(11);
  await expect(page.locator(`[data-rel-path="${DELETED}"]`)).toHaveCount(0);
  // The tile leaves before Finder answers; the toast is the answer.
  await expect(toast(page, "success")).toContainText("移到废纸篓");
  // The file is where the user can still get it back.
  expect(existsSync(join(vault.path, DELETED))).toBe(false);
  expect(readdirSync(SCRATCH_TRASH)).toContain(NAME);
  // The inspector moves on instead of going blank.
  await expect(inspector(page)).not.toHaveAttribute("data-entry", DELETED);
  await expect(toast(page, "success")).toContainText("移到废纸篓");
});

test("斜杠以外的路径不被接受", async ({ page }) => {
  await openVault(page);
  const answer = await page.evaluate(async () => {
    const response = await fetch("/api/trash_entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ relPaths: ["../not-in-the-vault.jpg"] }),
    });
    return (await response.json()) as { ok: boolean; error?: string };
  });
  expect(answer.ok).toBe(false);
  expect(answer.error).toContain("is not in the vault");
});

const viewer = (page: Page) => page.getByRole("dialog");
/** What the e2e backend writes in place of the system clipboard. */
const COPIED = join(".e2e-data", "copied.json");
const copied = () => (existsSync(COPIED) ? (JSON.parse(readFileSync(COPIED, "utf8")) as { text?: string; files?: string[] }) : null);

test("预览里 ⌘⌫ 删除当前文件后停在预览里，换到下一张", async ({ page }) => {
  await openVault(page);
  await page.locator(`[data-rel-path="${DELETED}"]`).dblclick();
  await expect(viewer(page)).toContainText(NAME);

  await page.keyboard.press("Meta+Backspace");
  await expect(toast(page, "success")).toContainText(NAME);
  expect(readdirSync(SCRATCH_TRASH)).toContain(NAME);
  // Still open, now on another file.
  await expect(viewer(page)).toBeVisible();
  await expect(viewer(page).getByRole("heading")).not.toHaveText(NAME);
  await expect(page.getByTestId("thumb")).toHaveCount(11);

  // The header's button does the same.
  const next = (await viewer(page).getByRole("heading").textContent()) ?? "";
  await viewer(page).getByRole("button", { name: "移到废纸篓" }).click();
  await expect(page.getByTestId("thumb")).toHaveCount(10);
  await expect.poll(() => readdirSync(SCRATCH_TRASH)).toContain(next);
});

test("预览里拷贝路径：按钮、右键菜单和 ⌥⌘C", async ({ page }) => {
  await openVault(page);
  await page.locator(`[data-rel-path="${DELETED}"]`).dblclick();
  const absolute = join(realpathSync(vault.path), DELETED);

  await viewer(page).getByRole("button", { name: "拷贝路径" }).click();
  await expect(toast(page, "success")).toContainText("已拷贝路径");
  expect(copied()).toEqual({ text: absolute });

  await viewer(page).getByRole("img", { name: NAME }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "拷贝", exact: true }).click();
  await expect.poll(copied).toEqual({ files: [absolute] });
  // The viewer's menu has no 预览 item; it is already the preview.
  await expect(page.getByRole("menuitem", { name: "预览" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  rmSync(COPIED);
  await page.keyboard.press("Alt+Meta+KeyC");
  await expect.poll(copied).toEqual({ text: absolute });
});

test("墙上 ⌘C 拷贝选中的几张，设置打开时 ⌘⌫ 不删除", async ({ page }) => {
  await openVault(page);
  const [a, b] = await page.getByTestId("thumb").evaluateAll((nodes) =>
    nodes.slice(0, 2).map((node) => node.closest("[data-rel-path]")!.getAttribute("data-rel-path")!),
  );
  await page.locator(`[data-rel-path="${a}"]`).click();
  await page.locator(`[data-rel-path="${b}"]`).click({ modifiers: ["Meta"] });
  await page.keyboard.press("Meta+c");
  await expect(toast(page, "success")).toContainText("已拷贝 2 项素材");
  const root = realpathSync(vault.path);
  expect(copied()?.files).toEqual([join(root, a!), join(root, b!)]);

  await page.keyboard.press("Meta+Comma");
  await expect(page.getByTestId("settings")).toBeVisible();
  await page.keyboard.press("Meta+Backspace");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("thumb")).toHaveCount(12);
});
