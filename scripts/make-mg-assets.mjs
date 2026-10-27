// Builds promo/.vault/ for promo/mg.html from a real Déjà vault: downscaled
// pictures, their Markdown sources, and what embeddinggemma-2 makes of them.
//
//   DEJA_VAULT=~/Documents/Deja\ Vault node scripts/make-mg-assets.mjs
//
// Scores use the app's own recipe (src-tauri/src/search.rs): 512 dims, the
// query wrapped as "<q>的照片", cosine mapped by (c - 0.58) / 0.12. The 2D map is
// the first two principal components of the image vectors, so where a picture
// sits in the film is where the model put it.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join, resolve } from "node:path";
import { createInterface } from "node:readline";

const VAULT = resolve(process.env.DEJA_VAULT ?? join(homedir(), "Documents/Deja Vault"));
const OUT = resolve("promo/.vault");
/** The searches the film types, in order. */
const QUERIES = (process.env.MG_QUERIES ?? "红色的花,雨夜的赛车").split(",");
const DIM = 512;
const PORT = 5199;

// Personal photos and other products' screens stay out of a promo.
const SKIP = [/^life\//, /^website\/HU-iLOebgAAoIUd\.jpg$/, /^website\/image( 2)?\.png$/];
const PICTURE = new Set([".jpg", ".jpeg", ".png", ".webp"]);

function walk(dir, prefix = "") {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".")) return [];
    const rel = prefix + entry.name;
    if (entry.isDirectory()) return walk(join(dir, entry.name), `${rel}/`);
    return PICTURE.has(extname(entry.name).toLowerCase()) ? [rel] : [];
  });
}

const pictures = walk(VAULT).filter((rel) => !SKIP.some((rule) => rule.test(rel))).sort();
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const items = pictures.map((rel, index) => {
  const file = `${String(index).padStart(2, "0")}.jpg`;
  const made = spawnSync("ffmpeg", ["-v", "error", "-y", "-i", join(VAULT, rel), "-vf", "scale='min(1200,iw)':-2", "-q:v", "3", "-frames:v", "1", join(OUT, file)]);
  if (made.status !== 0) throw new Error(`ffmpeg failed on ${rel}: ${made.stderr}`);
  const probe = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", join(OUT, file)]);
  const [w, h] = probe.stdout.toString().trim().split(",").map(Number);
  const meta = join(VAULT, ".deja/meta", `${rel}.md`);
  const source = existsSync(meta) ? (readFileSync(meta, "utf8").match(/^source:\s*(.+)$/m)?.[1] ?? null) : null;
  return { rel, file, w, h, source };
});
console.log(`${items.length} pictures from ${VAULT}`);

// ---------- the model ----------

const server = spawn("sidecar/.venv/bin/python", ["sidecar/embed_server.py", "--port", String(PORT), "--dim", String(DIM), "--offline", "--exit-with-stdin", "--idle-timeout", "0"], {
  stdio: ["pipe", "pipe", "inherit"],
});
await new Promise((ready, fail) => {
  createInterface({ input: server.stdout }).on("line", (line) => line.trim() === "ready" && ready());
  server.on("exit", (code) => fail(new Error(`sidecar exited ${code}`)));
});

async function embed(batch) {
  const response = await fetch(`http://127.0.0.1:${PORT}/embed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ items: batch, dim: DIM }),
  });
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()).vectors.map((v) => v.vector);
}

const vectors = [];
for (let i = 0; i < items.length; i += 8) {
  vectors.push(...(await embed(items.slice(i, i + 8).map((item, k) => ({ id: String(i + k), image: join(VAULT, item.rel) })))));
}
const queryVectors = await embed(QUERIES.map((q, i) => ({ id: `q${i}`, text: `${q}的照片` })));
server.stdin.end();

const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);
const percent = (cosine) => Math.round(Math.min(1, Math.max(0, (cosine - 0.58) / 0.12)) * 100);

for (const [qi, q] of QUERIES.entries()) {
  const ranked = items.map((item, i) => ({ rel: item.rel, c: dot(vectors[i], queryVectors[qi]) })).sort((a, b) => b.c - a.c);
  console.log(`\n「${q}」`);
  for (const r of ranked.slice(0, 8)) console.log(`  ${percent(r.c).toString().padStart(3)}%  ${r.c.toFixed(3)}  ${r.rel}`);
}

// ---------- the map ----------

/** Top two principal components by power iteration with deflation. */
function project(rows) {
  const mean = rows[0].map((_, j) => rows.reduce((s, r) => s + r[j], 0) / rows.length);
  const centered = rows.map((r) => r.map((x, j) => x - mean[j]));
  const axes = [];
  for (let k = 0; k < 2; k += 1) {
    let v = mean.map((_, j) => Math.sin(j * 12.9898 + k * 78.233));
    for (let step = 0; step < 200; step += 1) {
      const scores = centered.map((r) => dot(r, v));
      let next = mean.map((_, j) => centered.reduce((s, r, i) => s + r[j] * scores[i], 0));
      for (const axis of axes) {
        const along = dot(next, axis);
        next = next.map((x, j) => x - along * axis[j]);
      }
      const norm = Math.hypot(...next);
      v = next.map((x) => x / norm);
    }
    axes.push(v);
  }
  return (r) => axes.map((axis) => dot(r.map((x, j) => x - mean[j]), axis));
}

const map = project(vectors);
const points = vectors.map(map);
const xs = points.map((p) => p[0]);
const ys = points.map((p) => p[1]);
const norm = ([x, y]) => [
  (x - Math.min(...xs)) / (Math.max(...xs) - Math.min(...xs)),
  (y - Math.min(...ys)) / (Math.max(...ys) - Math.min(...ys)),
];

const manifest = {
  queries: QUERIES,
  model: "google/embeddinggemma-2",
  dim: DIM,
  items: items.map((item, i) => {
    const cosine = queryVectors.map((q) => dot(vectors[i], q));
    return {
      ...item,
      folder: item.rel.includes("/") ? item.rel.split("/")[0] : "",
      name: item.rel.split("/").pop(),
      cosine: cosine.map((c) => Number(c.toFixed(4))),
      match: cosine.map(percent),
      at: norm(points[i]).map((v) => Number(v.toFixed(4))),
    };
  }),
};
writeFileSync(join(OUT, "manifest.js"), `window.VAULT = ${JSON.stringify(manifest, null, 1)};\n`);
console.log(`\nwrote ${join(OUT, "manifest.js")}`);
