// Cuts the README pictures from the shots the app took: same frames, smaller
// files, and nothing else. `npm run shots` writes .shots/*.png first.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const WIDTH = Number(process.env.README_SHOT_WIDTH ?? 1600);
const OUT = "docs/screenshots";

/** The shots the README uses, in reading order. */
const SHOTS = [
  "02-wall",
  "04-search",
  "05-viewer",
  "03-similar",
  "06-import",
  "07-scope",
  "08-settings",
  "09-light",
  "01-empty",
];

mkdirSync(resolve(OUT), { recursive: true });

for (const name of SHOTS) {
  const source = resolve(".shots", `${name}.png`);
  if (!existsSync(source)) {
    console.error(`missing ${source}. run npm run shots first`);
    process.exit(1);
  }
  const target = resolve(OUT, `${name}.jpg`);
  const result = spawnSync(
    "ffmpeg",
    ["-y", "-v", "error", "-i", source, "-vf", `scale=${WIDTH}:-2:flags=lanczos`, "-q:v", "3", target],
    { stdio: "inherit" },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`wrote ${SHOTS.length} pictures at ${WIDTH}px wide to ${OUT}`);
