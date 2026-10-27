// Renders promo/promo.html frame by frame and pipes the frames into ffmpeg, so
// the promo is as reproducible as the screenshots it is cut from.
//
//   npm run shots   # writes .shots/*.png from the real app
//   npm run promo   # writes docs/promo.mp4
//   npm run mg      # writes docs/mg.mp4 from promo/mg.html, which draws
//                   # its own pictures and needs no shots
//
// The page's timeline is a pure function of t (window.__render), so frame 411
// is the same picture on every machine and on every run.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { once } from "node:events";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const FPS = Number(process.env.PROMO_FPS ?? 30);
const DPR = Number(process.env.PROMO_DPR ?? 2);
const PAGE = resolve(process.env.PROMO_PAGE ?? "promo/promo.html");
const OUT = process.env.PROMO_OUT ?? "docs/promo.mp4";
/** The encode lands here first, so a stopped run leaves the last film intact. */
const PART = OUT.replace(/\.mp4$/, ".part.mp4");
/** A short loop of the three-column scene, for a README that cannot play video. */
const LOOP = process.env.PROMO_LOOP ?? "docs/promo.gif";
const LOOP_FROM = Number(process.env.PROMO_LOOP_FROM ?? 3.3);
const LOOP_SECONDS = Number(process.env.PROMO_LOOP_SECONDS ?? 6.3);
/** Optional score, loudness-normalized to -14 LUFS, the common target for social video. */
const AUDIO = process.env.PROMO_AUDIO;

const sources = process.env.PROMO_PAGE ? [] : [
  ".shots/02-wall.png",
  ".shots/04-search.png",
  ".shots/05-viewer.png",
].map((path) => resolve(path));
for (const path of sources) {
  if (!existsSync(path)) {
    console.error(`missing ${path}. run npm run shots first`);
    process.exit(1);
  }
}

mkdirSync(resolve(OUT, ".."), { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: DPR });
const problems = [];
page.on("pageerror", (error) => problems.push(error.message));
await page.goto(`file://${PAGE}`);
await page.waitForFunction(() => window.__fontsReady === true, undefined, { timeout: 30_000 });
await page.waitForFunction(
  () => [...document.images].every((image) => image.complete && image.naturalWidth > 0),
  undefined,
  { timeout: 30_000 },
);

const duration = await page.evaluate(() => window.__duration);
const frames = Math.round(duration * FPS);
console.log(`rendering ${frames} frames at ${FPS}fps, ${DPR}x`);

const ffmpeg = spawn(
  "ffmpeg",
  [
    "-y",
    "-v",
    "error",
    "-f",
    "image2pipe",
    "-framerate",
    String(FPS),
    "-c:v",
    "png",
    "-i",
    "pipe:0",
    ...(AUDIO ? ["-i", resolve(AUDIO)] : []),
    "-vf",
    "scale=1920:1080:flags=lanczos",
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    process.env.PROMO_CRF ?? "22",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    ...(AUDIO ? ["-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-c:a", "aac", "-b:a", "192k", "-shortest"] : ["-an"]),
    PART,
  ],
  { stdio: ["pipe", "inherit", "inherit"] },
);
const encoded = once(ffmpeg, "close");

const started = Date.now();
for (let index = 0; index < frames; index += 1) {
  const t = index / FPS;
  await page.evaluate((time) => window.__render(time), t);
  const png = await page.screenshot({ type: "png" });
  if (!ffmpeg.stdin.write(png)) await once(ffmpeg.stdin, "drain");
  if (index % 60 === 0) {
    const perFrame = (Date.now() - started) / (index + 1);
    process.stdout.write(`\r${index}/${frames} frames · ${Math.round(perFrame)}ms each`);
  }
}
ffmpeg.stdin.end();
const [code] = await encoded;
process.stdout.write("\n");
if (code !== 0) {
  console.error(`ffmpeg exited ${code}`);
  process.exit(1);
}

await browser.close();
renameSync(PART, OUT);

// The loop is cut from the encode, so it cannot drift from the film.
const loop = spawnSync(
  "ffmpeg",
  [
    "-y", "-v", "error",
    "-ss", String(LOOP_FROM),
    "-t", String(LOOP_SECONDS),
    "-i", OUT,
    "-vf",
    "fps=12,scale=720:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3",
    "-loop", "0",
    LOOP,
  ],
  { stdio: "inherit" },
);
if (loop.status !== 0) console.error(`gif exited ${loop.status}`);

if (problems.length) console.error(`page errors: ${problems.join("; ")}`);
const mb = (path) => (statSync(path).size / 1024 / 1024).toFixed(1);
console.log(`${OUT} · ${mb(OUT)} MB · ${duration}s`);
console.log(`${LOOP} · ${mb(LOOP)} MB · ${LOOP_SECONDS}s of it`);
