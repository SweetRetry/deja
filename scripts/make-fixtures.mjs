// Builds the demo vault from real photographs and writes the contract file that
// both the Rust scanner test and the e2e run read.
//
//   node scripts/make-fixtures.mjs
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

const SOURCE = "/Users/zhangzimin/Documents/aquavo/olio/assets/pinterest-home-50";
const ROOT = "public/vault";

const meta = {
  "UI参考/登录页/深色登录-dribbble.jpg": {
    tags: ["深色", "登录", "参考"],
    rating: 4,
    source: "https://dribbble.com/shots/1234567",
    note: "深色底加细边框输入框，间距可以照这个来。",
  },
  "摄影/风景/海边-dusk.jpg": {
    tags: ["黄昏", "海"],
    rating: 5,
    note: "逆光下的海岸线，适合做封面。",
  },
  "UI参考/登录页/渐变按钮-03.jpg": {
    tags: ["渐变", "按钮"],
    rating: 3,
    note: "",
  },
};

// Source file per vault path. 01 和 02 共用同一张照片，让「找相似」有一个真的近似重复。
const images = [
  ["UI参考/登录页/深色登录-dribbble.jpg", "01"],
  ["UI参考/登录页/渐变按钮-03.jpg", "02"],
  ["UI参考/渐变按钮-04.jpg", "03"],
  ["摄影/人像/黄昏逆光-01.jpg", "04"],
  ["摄影/人像/黄昏逆光-02.jpg", "04"],
  ["摄影/人像/逆光-03.jpg", "05"],
  ["摄影/风景/海边-dusk.jpg", "06"],
  ["摄影/风景/极简-墙面.jpg", "07"],
  ["海报/日式极简包装.jpg", "08"],
  ["海报/深色海报.jpg", "09"],
  ["海报/和风-02.jpg", "10"],
  ["乱码名-A7f3.jpg", "11"],
];

const sources = readdirSync(SOURCE).filter((name) => name.endsWith(".jpg"));

function sourcePath(prefix) {
  const name = sources.find((entry) => entry.startsWith(`${prefix}-`));
  if (!name) throw new Error(`no source photograph for prefix ${prefix}`);
  return join(SOURCE, name);
}

/** Enough JPEG/PNG header reading to fill width and height into the contract. */
function imageSize(path) {
  const buffer = readFileSync(path);
  if (buffer.readUInt32BE(0) === 0x89504e47) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) return { width: 0, height: 0 };
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isFrame) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return { width: 0, height: 0 };
}

function frontmatter(entry) {
  const lines = ["---", `tags: [${entry.tags.join(", ")}]`, `rating: ${entry.rating}`];
  if (entry.source) lines.push(`source: ${entry.source}`);
  lines.push("---");
  if (entry.note) lines.push("", entry.note);
  return lines.join("\n") + "\n";
}

rmSync(ROOT, { recursive: true, force: true });
const entries = [];

for (const [relPath, prefix] of images) {
  const target = join(ROOT, relPath);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(sourcePath(prefix), target);
  const info = meta[relPath];
  const { width, height } = imageSize(target);
  entries.push({
    relPath,
    name: relPath.split("/").pop(),
    ext: "jpg",
    sizeBytes: statSync(target).size,
    width,
    height,
    tags: info?.tags ?? [],
    rating: info?.rating ?? 0,
    note: info?.note ?? "",
    source: info?.source ?? null,
  });
}

mkdirSync(join(ROOT, ".git"), { recursive: true });
copyFileSync(sourcePath("01"), join(ROOT, ".git/ignored.jpg"));
mkdirSync(join(ROOT, "node_modules"), { recursive: true });
copyFileSync(sourcePath("02"), join(ROOT, "node_modules/ignored.jpg"));
writeFileSync(join(ROOT, "README.md"), "# 素材库\n\n不是图片，不该进索引。\n");

for (const [relPath, info] of Object.entries(meta)) {
  const target = join(ROOT, ".shelf/meta", `${relPath}.md`);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, frontmatter(info));
}

entries.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));
const folders = [
  ...new Set([
    "",
    ...entries.flatMap((entry) => {
      const parts = entry.relPath.split("/").slice(0, -1);
      return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
    }),
  ]),
].sort();

writeFileSync(
  "fixtures/expected-vault.json",
  JSON.stringify({ vault: ROOT, source: SOURCE, folders, entries }, null, 2) + "\n",
);

const bytes = entries.reduce((total, entry) => total + entry.sizeBytes, 0);
console.log(`wrote ${entries.length} real photos (${Math.round(bytes / 1024)} KB) to ${ROOT}, ${folders.length} folders`);
