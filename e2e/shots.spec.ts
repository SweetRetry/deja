import { existsSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// The product pictures in the README, and the frames the promo is cut from.
// Skipped in the normal run: `npm run shots` builds demo/素材库 and starts vite
// with DEJA_SHOTS_VAULT, so /vault/… serves that folder.
const DIR = process.env.SHOTS_DIR;
test.skip(!DIR, "set SHOTS_DIR (npm run shots)");

const VAULT = process.env.DEJA_DEMO_ROOT || "demo/素材库";
/** The one file the shots hold on: it has tags, a rating and a note. */
const HERO = "插画/场景/巨树村.jpg";

test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

const status = (page: Page) => page.getByTestId("index-status");

async function openVault(page: Page) {
  await page.getByRole("button", { name: "打开文件夹", exact: true }).click();
  await page.getByLabel("文件夹路径").fill(VAULT);
  await page.getByLabel("文件夹路径").press("Enter");
  await expect(page.getByTestId("thumb").first()).toBeVisible({ timeout: 60_000 });
  await expect(status(page)).toHaveText("索引已完成", { timeout: 240_000 });
}

/** Waits for the file to be previewed, so its tile is a picture and not a skeleton. */
async function selectHero(page: Page) {
  const tile = page.locator(`[data-rel-path="${HERO}"]`);
  await tile.scrollIntoViewIfNeeded();
  await expect(tile.locator("img")).toHaveCount(1, { timeout: 120_000 });
  await tile.click();
  await expect(page.getByRole("complementary", { name: "检视面板" })).toHaveAttribute("data-entry", HERO);
  await expect(page.getByRole("img", { name: /星/ }).first()).toBeVisible();
}

async function shot(page: Page, name: string) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${DIR}/${name}.png` });
}

test("README pictures", async ({ page }) => {
  test.setTimeout(600_000);
  expect(existsSync(VAULT), `run npm run demo first: ${VAULT}`).toBe(true);

  await page.goto("/");
  await page.getByRole("button", { name: "打开文件夹", exact: true }).waitFor();
  await shot(page, "01-empty");

  await openVault(page);
  await selectHero(page);
  await shot(page, "02-wall");

  await page.getByRole("button", { name: "查找相似素材" }).click();
  await expect(page.getByText("相似素材", { exact: true })).toBeVisible();
  await expect(page.getByTestId("thumb").first()).toBeVisible();
  await page.waitForTimeout(1500);
  await shot(page, "03-similar");
  await page.getByRole("button", { name: "返回全部素材" }).click();

  await page.getByLabel("搜索素材").fill("蓝天下的白裙");
  await expect(page.locator('[data-semantic="true"]')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId("score").first()).toContainText("匹配");
  // Selected, so the inspector agrees with what the query found.
  await page.getByTestId("thumb").first().click();
  await page.waitForTimeout(1200);
  await shot(page, "04-search");

  await page.getByTestId("thumb").first().dblclick();
  await expect(page.getByTestId("filmstrip")).toBeVisible();
  await page.waitForTimeout(800);
  await shot(page, "05-viewer");
  await page.keyboard.press("Escape");
  await page.getByLabel("搜索素材").fill("");

  await page.getByRole("button", { name: /人物/ }).first().click();
  await expect(page.getByTestId("thumb").first()).toBeVisible();
  // The hint is "a dragover in the last 150 ms", so hold it with a heartbeat.
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.items.add(new File([new Uint8Array(8)], "拖进来.png", { type: "image/png" }));
    data.setData("text/uri-list", "https://www.pinterest.com/pin/123456789/");
    const beat = () => window.dispatchEvent(new DragEvent("dragover", { dataTransfer: data, cancelable: true }));
    beat();
    (window as unknown as { __beat: number }).__beat = window.setInterval(beat, 60);
  });
  await expect(page.getByTestId("drop-overlay")).toHaveAttribute("data-state", "open");
  await page.screenshot({ path: `${DIR}/06-import.png` });
  await page.evaluate(() => window.clearInterval((window as unknown as { __beat: number }).__beat));

  await page.getByRole("button", { name: /文件夹菜单/ }).click();
  await page.getByRole("menuitem", { name: "选择索引范围…" }).click();
  await expect(page.getByTestId("scope")).toBeVisible();
  await expect(page.getByTestId("scope")).toContainText("将索引");
  await shot(page, "07-scope");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.getByTestId("settings")).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${DIR}/08-settings.png` });

  // One light pass over the same wall, from the same settings dialog.
  await page.getByRole("group", { name: "主题" }).getByRole("button", { name: "浅色", exact: true }).click();
  await page.keyboard.press("Escape");
  await selectHero(page);
  await shot(page, "09-light");
});
