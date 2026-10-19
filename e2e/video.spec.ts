import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { openFolder } from "./helpers";

// The demo vault holds photographs only, so the clip is built for this run.
const DIR = "public/vault/短片";
const REL_PATH = "短片/悬停-01.mp4";

test.beforeAll(() => {
  mkdirSync(DIR, { recursive: true });
  execFileSync("ffmpeg", [
    "-y",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=320x180:rate=12:duration=6",
    "-pix_fmt",
    "yuv420p",
    join(DIR, "悬停-01.mp4"),
  ]);
});

test.afterAll(() => {
  rmSync(DIR, { recursive: true, force: true });
});

test("悬停视频时原地播放，移开后回到静帧", async ({ page }) => {
  test.setTimeout(180_000);
  await openFolder(page);
  const tile = page.locator(`[data-rel-path="${REL_PATH}"]`);
  await expect(tile).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("index-status")).toHaveText("索引已完成", { timeout: 150_000 });
  // The wall re-sorts once the first search answers, moving tiles under the
  // pointer; wait until this one has stopped before asking it to play.
  let last = "";
  await expect
    .poll(
      async () => {
        const box = await tile.boundingBox();
        const now = `${Math.round(box?.x ?? -1)},${Math.round(box?.y ?? -1)}`;
        const settled = now === last;
        last = now;
        return settled;
      },
      { intervals: [400], timeout: 20_000 },
    )
    .toBe(true);

  const preview = tile.getByTestId("tile-preview");
  await expect(preview).toHaveCount(0);

  await tile.hover();
  await expect(preview).toHaveCount(1, { timeout: 5000 });
  const time = () => preview.evaluate((video: HTMLVideoElement) => video.currentTime);
  await expect.poll(time, { timeout: 5000 }).toBeGreaterThan(0.3);

  // The preview is a glance, not a player: no controls, no sound.
  await expect(preview).toHaveJSProperty("controls", false);
  await expect(preview).toHaveJSProperty("muted", true);

  await page.mouse.move(4, 4);
  await expect(preview).toHaveCount(0);
});
