import { expect, test, type Page } from "@playwright/test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { openFolder, scratchVault } from "./helpers";

// A scratch copy without .deja/scope.json is a folder opened for the first
// time: nothing is indexed until the user picks which folders to index.
const vault = scratchVault("scope", (path) => rmSync(join(path, ".deja/scope.json")));

async function openFresh(page: Page) {
  await openFolder(page, vault.path);
  const picker = page.getByTestId("scope");
  await expect(picker).toBeVisible();
  return picker;
}

const scopeOnDisk = () => JSON.parse(readFileSync(join(vault.path, ".deja/scope.json"), "utf8")) as { excluded: string[] };

test("首次打开先选索引范围：去掉「人像」后只索引其余 9 张，之后可从文件夹菜单改回", async ({ page }) => {
  const picker = await openFresh(page);
  await expect(page.getByText("等待选择索引范围")).toBeVisible();
  await expect(picker).toContainText("将索引 12 个文件");

  await expect(picker.getByRole("button", { name: "开始索引" })).toBeFocused();
  await picker.getByRole("checkbox", { name: "人像" }).click();
  await expect(picker.getByRole("checkbox", { name: "摄影" })).toHaveAttribute("aria-checked", "mixed");
  await expect(picker).toContainText("将索引 9 个文件");
  await picker.getByRole("button", { name: "开始索引" }).click();

  await expect(picker).toBeHidden();
  await expect(page.getByTestId("thumb")).toHaveCount(9);
  await expect(page.getByRole("button", { name: /^人像/ })).toHaveCount(0);
  expect(scopeOnDisk()).toEqual({ excluded: ["摄影/人像"] });

  await page.getByRole("button", { name: /文件夹菜单/ }).click();
  await page.getByRole("menuitem", { name: "选择索引范围…" }).click();
  await expect(picker.getByRole("button", { name: "保存" })).toBeDisabled();
  await picker.getByRole("checkbox", { name: "人像" }).click();
  await picker.getByRole("button", { name: "保存" }).click();
  await expect(picker).toBeHidden();
  await expect(page.getByTestId("thumb")).toHaveCount(12);
  expect(scopeOnDisk()).toEqual({ excluded: [] });
});

test("首次打开时取消，回到未打开的状态，不留下索引范围", async ({ page }) => {
  const picker = await openFresh(page);
  await picker.getByRole("button", { name: "取消" }).click();
  await expect(picker).toBeHidden();
  await expect(page.getByRole("button", { name: "打开文件夹", exact: true })).toBeVisible();
  expect(() => scopeOnDisk()).toThrow();
});
