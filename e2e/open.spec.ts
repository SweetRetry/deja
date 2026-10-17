import { expect, test, type Page } from "@playwright/test";

// The wall used to be laid out once at zero width and again once measured, and
// the open painted files in scan order until the first search re-sorted them.
// Both showed up as tiles sliding into place every time the app started.

type Frame = {
  t: number;
  inspector: number;
  tiles: number;
  order: string;
  box: string;
};

/** Every animation frame until the caller stops asking: what the shell looks
 *  like, and where the first tile is, from the very first paint. */
async function recordFrames(page: Page) {
  await page.addInitScript(() => {
    const frames: Frame[] = ((window as unknown as { __frames?: Frame[] }).__frames = []);
    const sample = () => {
      const tiles = [...document.querySelectorAll('[data-testid="thumb"]')];
      const first = tiles[0]?.getBoundingClientRect();
      frames.push({
        t: Math.round(performance.now()),
        inspector: document.querySelector('[data-testid="inspector"]')?.clientWidth ?? 0,
        tiles: tiles.length,
        order: tiles.map((tile) => tile.getAttribute("data-rel-path")).join("|"),
        box: first ? `${Math.round(first.x)},${Math.round(first.y)},${Math.round(first.width)}` : "",
      });
      if (performance.now() < 4000) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

async function openVault(page: Page) {
  await page.getByRole("button", { name: "打开文件夹", exact: true }).click();
  await page.getByLabel("文件夹路径").fill("public/vault");
  await page.getByLabel("文件夹路径").press("Enter");
  await expect(page.getByTestId("thumb").first()).toBeVisible();
}

test("重新打开上次的文件夹时，三栏位置和素材顺序都不跳动", async ({ page }) => {
  await page.goto("/");
  await openVault(page);
  await expect(page.getByTestId("thumb")).toHaveCount(12);

  await recordFrames(page);
  await page.goto("/");
  await expect(page.getByTestId("thumb").first()).toBeVisible();
  // Long enough for the quiet first search to land and reorder, if it would.
  await page.waitForTimeout(800);
  const frames: Frame[] = await page.evaluate(() => (window as unknown as { __frames: Frame[] }).__frames);

  const shell = frames.filter((frame) => frame.inspector > 0);
  const walls = frames.filter((frame) => frame.tiles > 0);
  expect(walls.length).toBeGreaterThan(0);

  // The inspector is there from the first frame the shell is, and never resizes.
  expect(new Set(shell.map((frame) => frame.inspector)).size).toBe(1);
  // Tiles keep the order and the place they first appeared in.
  expect(new Set(walls.map((frame) => frame.order)).size).toBe(1);
  expect(new Set(walls.map((frame) => frame.box)).size).toBe(1);
});
