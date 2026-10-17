import { expect, test } from "@playwright/test";

const SHOTS = process.env.REVIEW_DIR;

test("预览底部的缩略图条：居中当前文件，点击跳转，拖动和滚动逐个切换", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "打开文件夹", exact: true }).click();
  await page.getByLabel("文件夹路径").fill("public/vault");
  await page.getByLabel("文件夹路径").press("Enter");
  await expect(page.getByTestId("thumb").first()).toBeVisible();
  await page.getByTestId("thumb").first().dblclick();

  const strip = page.getByTestId("filmstrip");
  const current = strip.locator('[aria-current="true"]');
  const items = strip.getByTestId("filmstrip-item");
  await expect(items.nth(2)).toBeVisible();
  // The strip runs in the viewer's own order, the one the arrows step through.
  // Right after opening, the wall re-sorts once the first search answers.
  const read = () => items.evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.relPath!));
  let order: string[] = [];
  await expect
    .poll(async () => {
      const last = order.join();
      order = await read();
      return order.join() === last;
    })
    .toBe(true);
  // The strip's current slice is the position readout: the viewer's own
  // counter left with the arrow buttons.
  const expectAt = async (index: number) => {
    await expect(current).toHaveAttribute("data-rel-path", order[index]!);
  };

  await strip.locator(`[data-rel-path="${order[0]}"]`).click();
  await expectAt(0);

  // The current slice settles in the middle of the strip.
  await page.waitForTimeout(300);
  const box = (await strip.boundingBox())!;
  const mid = (await current.boundingBox())!;
  expect(Math.abs(mid.x + mid.width / 2 - (box.x + box.width / 2))).toBeLessThan(2);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/filmstrip-first.png` });

  await strip.locator(`[data-rel-path="${order[4]}"]`).click();
  await expectAt(4);

  // Dragging left by three slices moves three files on.
  await page.waitForTimeout(300);
  const a = (await strip.locator(`[data-rel-path="${order[5]}"]`).boundingBox())!;
  const b = (await strip.locator(`[data-rel-path="${order[6]}"]`).boundingBox())!;
  const pitch = b.x - a.x;
  const y = box.y + box.height / 2;
  const x = box.x + box.width / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - pitch, y, { steps: 4 });
  await page.mouse.move(x - pitch * 3, y, { steps: 8 });
  await page.mouse.up();
  await expectAt(7);

  // Scrolling steps too, and the viewer stays open throughout.
  await strip.hover();
  await page.mouse.wheel(0, -pitch * 2);
  await expectAt(5);
  await page.waitForTimeout(300);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/filmstrip-middle.png` });
});
