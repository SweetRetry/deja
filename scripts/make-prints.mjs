// Fetches the works the welcome screen's prints show, from the author's own
// archive at aquavo.cn, and shrinks each to the size a print needs.
//
//   node scripts/make-prints.mjs
//
// A print is at most 210px wide and lifts to 1.08×, so 440px covers 2× screens.
// Needs macOS for `sips`.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OUT = "src/features/onboarding/prints";
const WORKS = {
  "shared-sight": "shared-sight.png",
  "moonlit-reedfield": "moonlit-reedfield.png",
  "watercolor-rose": "watercolor-rose.jpeg",
  "unbound-bloom": "unbound-bloom.webp",
  rootless: "rootless-tiger.webp",
  refraction: "refraction.webp",
  "verdant-notes": "verdant-notes.webp",
};

const scratch = mkdtempSync(join(tmpdir(), "deja-prints-"));
try {
  for (const [name, file] of Object.entries(WORKS)) {
    const response = await fetch(`https://cdn.aquavo.cn/works/${file}`);
    if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
    const source = join(scratch, file);
    writeFileSync(source, Buffer.from(await response.arrayBuffer()));
    const args = ["-s", "format", "jpeg", "-s", "formatOptions", "78", "--resampleWidth", "440"];
    execFileSync("sips", [...args, source, "--out", join(OUT, `${name}.jpg`)], { stdio: "ignore" });
    console.log(`${OUT}/${name}.jpg`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
