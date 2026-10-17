// Draws the Déjà mark, one image tile under an acute accent, and renders every
// icon from it: the app icon set and the menu bar template.
//
//   pnpm icons
//
// The tile is neutral because it stands for any image; the accent is the one
// emerald moment, the mark of having seen it before.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ICONS = "src-tauri/icons";
const color = { base: "#1c1c1e", tile: "#48484a", accent: "#30bf71" }; // dark background, surface, primary

/** The mark centered at (512, 512) on a 1024 canvas. The menu bar copy opens
 *  the gap and thickens the accent so both survive at 18pt. */
function mark({ gap, head, tail }) {
  const tile = { w: 480, h: 320, r: 56 };
  const len = 190;
  const angle = (52 * Math.PI) / 180;
  const rise = len * Math.sin(angle);
  const top = 512 - (rise + gap + tile.h) / 2;
  const foot = { x: 552 - (len / 2) * Math.cos(angle), y: top + rise };
  const crown = { x: foot.x + len * Math.cos(angle), y: top };
  // Both ends are cut level, the way a typeset accent sits.
  const points = [
    [foot.x - tail / 2, foot.y],
    [foot.x + tail / 2, foot.y],
    [crown.x + head / 2, crown.y],
    [crown.x - head / 2, crown.y],
  ]
    .map((p) => p.map((v) => v.toFixed(1)).join(","))
    .join(" ");
  return { tile: { ...tile, x: 512 - tile.w / 2, y: top + rise + gap }, points };
}

function svg({ tile, points }, fill, { base, view = "0 0 1024 1024" } = {}) {
  const plate = base ? `<rect x="100" y="100" width="824" height="824" rx="185" fill="${base}"/>\n` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${view}">
${plate}<rect x="${tile.x}" y="${tile.y.toFixed(1)}" width="${tile.w}" height="${tile.h}" rx="${tile.r}" fill="${fill.tile}"/>
<polygon points="${points}" fill="${fill.accent}" stroke="${fill.accent}" stroke-width="14" stroke-linejoin="round"/>
</svg>
`;
}

// The app icon sits on macOS's 824pt plate inside the 1024 canvas.
writeFileSync("design/icon.svg", svg(mark({ gap: 44, head: 84, tail: 62 }), color, { base: color.base }));
// The menu bar icon is a template: macOS keeps only its alpha and tints it. The
// view crops to the mark so it stands about 16pt tall in the 18pt slot.
writeFileSync(
  "design/tray.svg",
  svg(mark({ gap: 72, head: 112, tail: 88 }), { tile: "#000", accent: "#000" }, { view: "212 212 600 600" }),
);

const tauri = (...args) => execFileSync("npx", ["tauri", "icon", ...args], { stdio: "inherit" });
tauri("design/icon.svg");
// The bundle targets macOS only; tauri icon also writes mobile sets.
rmSync(join(ICONS, "android"), { recursive: true, force: true });
rmSync(join(ICONS, "ios"), { recursive: true, force: true });

// 36px is the 18pt menu bar slot at 2x.
const out = mkdtempSync(join(tmpdir(), "deja-tray-"));
tauri("design/tray.svg", "-p", "36", "-o", out);
copyFileSync(join(out, "36x36.png"), join(ICONS, "tray.png"));
rmSync(out, { recursive: true });
