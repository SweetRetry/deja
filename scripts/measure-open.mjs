// What the app does between process start and a settled window: cumulative
// layout shift, the order the wall paints, and whether any tile moves after it
// is on screen. Run with the e2e API and vite up (`npm run e2e:api`, `npx vite`).
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

// A vault as the last session, so every load reopens it.
await page.goto("http://127.0.0.1:5273/");
await page.evaluate(() => localStorage.setItem("shelf.vault", "public/vault"));

await page.addInitScript(() => {
  window.__shifts = [];
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.hadRecentInput) continue;
      window.__shifts.push({ t: Math.round(entry.startTime), value: Number(entry.value.toFixed(5)) });
    }
  }).observe({ type: "layout-shift", buffered: true });
  window.__frames = [];
  const sample = () => {
    const tiles = [...document.querySelectorAll('[data-testid="thumb"]')];
    const first = tiles[0];
    const img = first?.querySelector("img");
    window.__frames.push({
      t: Math.round(performance.now()),
      inspector: document.querySelector('[data-testid="inspector"]')?.clientWidth ?? 0,
      skeletons: document.querySelectorAll('[data-slot="skeleton"]').length,
      tiles: tiles.length,
      order: tiles.map((tile) => tile.dataset.relPath).join("|"),
      box: first ? [Math.round(first.getBoundingClientRect().x), Math.round(first.getBoundingClientRect().width)] : null,
      picture: img ? Math.round(img.getBoundingClientRect().width) : null,
    });
    if (performance.now() < 3000) requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
});

await page.goto("http://127.0.0.1:5273/");
await page.waitForTimeout(3200);

const { shifts, frames } = await page.evaluate(() => ({ shifts: window.__shifts, frames: window.__frames }));
const content = frames.find((frame) => frame.tiles > 0);
const after = frames.filter((frame) => content && frame.t > content.t);
const moved = after.filter(
  (frame) => frame.order !== content.order || frame.box?.join() !== content.box?.join() || frame.picture !== content.picture,
);
console.log(`shifts: ${shifts.length}`, JSON.stringify(shifts));
console.log(`first paint with a folder: t=${frames.find((f) => f.inspector)?.t}ms`);
console.log(`first paint with tiles:   t=${content?.t}ms`);
console.log(`tiles moving after they land: ${moved.length}`);
for (const frame of moved.slice(0, 5)) console.log("   ", JSON.stringify(frame));
await browser.close();
