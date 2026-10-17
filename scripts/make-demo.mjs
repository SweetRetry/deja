// Builds the demo library the README screenshots are taken on: real images,
// given real names, folders, tags and notes, so the shots show a library
// someone actually keeps rather than twelve numbered files.
//
//   DEJA_DEMO_SOURCE=/path/to/a/folder/of/photos node scripts/make-demo.mjs
//
// Writes demo/素材库, a vault that lives outside public/. The browser build has
// no file access, so `npm run shots` starts vite with DEJA_SHOTS_VAULT pointing
// here and vite serves the pictures at /vault/…; the e2e fixture vault in
// public/vault is left alone.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const SOURCE = process.env.DEJA_DEMO_SOURCE;
if (!SOURCE) {
  console.error("set DEJA_DEMO_SOURCE to the folder holding the photographs");
  process.exit(1);
}
const ROOT = process.env.DEJA_DEMO_ROOT || "demo/素材库";

/** Source file, vault path, and what the person who saved it wrote down. */
const LIBRARY = [
  // 插画，人物
  ["03-acf1b11780a76ac86db73af16b5ad3fd.jpg", "插画/人物/棱镜光.jpg", ["棱镜", "光", "少女"], 5, "棱镜拆出来的彩虹正好落在眼睛上，封面可以照这个思路。"],
  ["04-6e201cd1f939fd2f3e136aa19dcda36a.jpg", "插画/人物/黑发少女.jpg", ["黑发", "肖像"], 0, ""],
  ["05-8f40f1bce22ba312ef6ca0e1cfcaa9f1.jpg", "插画/人物/蓝色兜帽.jpg", ["蓝色", "兜帽"], 0, ""],
  ["08-f4281b127302ebad0c8bf6a3b790c493.jpg", "插画/人物/金发.jpg", ["金发", "浅色"], 0, ""],
  ["30-ca702cddd216a2990f402aa303f4a03e.jpg", "插画/人物/蓝底与猫.jpg", ["蓝色", "猫", "短发"], 4, ""],
  ["44-4c9131201fd00c8c9d0cb44ca41b3731.jpg", "插画/人物/白发特写.jpg", ["白发", "特写", "深色"], 0, ""],
  ["47-422e5e20bc0bd951528732323a290dc0.jpg", "插画/人物/红底.jpg", ["红色", "长发"], 0, ""],
  ["46-0b73239c057013d22f336e3c59befdf1.jpg", "插画/人物/浅色特写.jpg", ["浅色", "特写"], 0, ""],
  ["49-4803ef70e1392a132e4326ca22d9f092.jpg", "插画/人物/雏菊.jpg", ["橙色", "特写", "花"], 0, ""],
  ["29-cebce503c31760609590f47bd5f5fbea.jpg", "插画/人物/银杏.jpg", ["绿色", "银杏"], 0, ""],
  ["39-a967acaa1020978966dadb2786cbcc75.jpg", "插画/人物/蓝光.jpg", ["蓝色", "夜"], 0, ""],
  // 插画，场景与漫画
  ["09-5d9af5e8038440091f7ff47fc449cb06.jpg", "插画/场景/水下鱼群.jpg", ["水下", "蓝色", "鱼"], 4, ""],
  ["13-4cfb1226ca50b8815795d507381a714e.jpg", "插画/场景/巨树村.jpg", ["树", "奇幻", "场景"], 5, "树屋的层次可以照这个排，别做成一整块绿色。"],
  ["16-3d0f7893f5bbb1ec64667c2d997e3b3f.jpg", "插画/场景/昏暗室内.jpg", ["室内", "青色", "光"], 0, ""],
  ["18-aaa335b486143890fa9b75169e10ece3.jpg", "插画/漫画/橙色分镜.jpg", ["橙色", "分镜"], 0, ""],
  ["21-6b9ed137546979c94c928a6b6e1c6041.jpg", "插画/漫画/黑白线稿.jpg", ["黑白", "线稿", "眼镜"], 0, ""],
  ["6e00c86fb8c3a11c0a6a6b2eb388c1ea.jpg", "插画/漫画/网点分镜.jpg", ["漫画", "网点", "黑白"], 0, ""],
  // 科幻
  ["02-1cd80866e57717beba65ee385e54a0f1.jpg", "科幻/白色飞船.jpg", ["飞船", "白色", "极简"], 5, "留白很大，标题可以直接压在右上角。"],
  ["07-8b00b45375a598cd45e4a4d96cedcc41.jpg", "科幻/雨中飞船.jpg", ["飞船", "夜", "雨"], 0, ""],
  // 摄影，人像
  ["10-cbaf691c4555c927887bfe15391f9049.jpg", "摄影/人像/百叶窗的光.jpg", ["室内", "暖光", "阴影"], 3, ""],
  ["33-527cb0b1e88201feb59ae5168b71718b.jpg", "摄影/人像/蹲在墙角.jpg", ["人像", "胶片", "室内"], 0, ""],
  ["37-68524d73f578c8820903b4d4343cfef0.jpg", "摄影/人像/树荫下.jpg", ["绿色", "树荫"], 0, ""],
  ["38-844ad5aebfb6f3395b3b7e91fba314ef.jpg", "摄影/人像/白裙与天空.jpg", ["蓝天", "白裙", "逆光"], 5, ""],
  ["50-53141b69ad87559de9d1d7644d6c8057.jpg", "摄影/人像/窗边针织.jpg", ["窗光", "胶片"], 4, ""],
  ["42-54ae3dc9cba4e187ec95d4f98116a960.jpg", "摄影/人像/蓝天上的火.jpg", ["蓝色", "超现实", "拼贴"], 4, "两张图拼出来的方向，值得试一次。"],
  // 摄影，花
  ["1af0b9b1cba7168bd537f13ca18c26e0.jpg", "摄影/花/窗边的玫瑰.jpg", ["玫瑰", "红色", "窗"], 4, ""],
  ["20-77dd43d00f8b178378cd132ae8045f8d.jpg", "摄影/花/紫花丛.jpg", ["紫色", "花", "逆光"], 5, "紫花的散景可以垫在登录页底下。"],
  ["43-235868c1f3fbb6d6d8c58303752e9549.jpg", "摄影/花/花瓣落下.jpg", ["红色", "花", "飘落"], 0, ""],
  ["40-adc4fe56ca8a81ef37a1e92104ed1b74.jpg", "摄影/花/粉黄花朵.jpg", ["粉色", "花", "特写"], 0, ""],
  // 摄影，街头、海、风景与特写
  ["34-5e0ac5bb7d6c8461c3330324a0213498.jpg", "摄影/街/心形红绿灯.jpg", ["街头", "黄昏", "灯"], 5, ""],
  ["19-ef4e76274cfcbb0f60fb255b648df6ea.jpg", "摄影/海/夜浪.jpg", ["海", "夜", "蓝色"], 0, ""],
  ["31-efcd141e7cc0df13b45879343c40428d.jpg", "摄影/风景/星野.jpg", ["星空", "云", "蓝色"], 4, ""],
  ["36-7a5ade692804c58076952d7e3403a833.jpg", "摄影/风景/锦鲤池.jpg", ["锦鲤", "绿色", "水面"], 3, ""],
  ["48-daf172a65e77fb2bf459ee1a6dc97a82.jpg", "摄影/特写/眼睛.jpg", ["特写", "眼睛", "光"], 0, ""],
  // 参考，版式与配色
  ["12-a345c27971c6b8de6d06203096bfcb0c.jpg", "参考/版式/杂志封面.jpg", ["版式", "杂志", "排版"], 4, "左栏大字和右边人像的比例，是这份稿子的参考。"],
  ["a9676738c1542fc2db6c35f4773e48e0.jpg", "参考/版式/漫画封面.jpg", ["版式", "漫画", "封面"], 0, ""],
  ["26-2fd36d337df7658ebff8b526095b0f09.jpg", "参考/配色/橙色背景.jpg", ["橙色", "时尚", "平面"], 0, ""],
  ["23-b7c5632c43b5b6bd0bf77b25434e96a2.jpg", "参考/配色/黄色背景.jpg", ["黄色", "人物", "平面"], 0, ""],
  ["24-5d6d3cce8b901dbd6a9de0a35e729ec6.jpg", "参考/配色/青色背景.jpg", ["青色", "抽象", "平面"], 0, ""],
  ["25-b9a615f2a051a44571ab7ed6d1a5ab0d.jpg", "参考/配色/绿色背景.jpg", ["绿色", "人像", "平面"], 0, ""],
  ["28-cceba48f4f77ae6f2f45ef1893179f73.jpg", "参考/配色/橙色人物.jpg", ["橙色", "街舞", "人物"], 0, ""],
  // 动物
  ["45-c7c575e8b6656154ca54c2df2bb53a38.jpg", "动物/小猫.jpg", ["猫", "室内", "抓拍"], 0, ""],
];

/** Where each photograph was saved from, when the source folder records it. */
function pins(dir) {
  const path = join(dir, "manifest.json");
  if (!existsSync(path)) return new Map();
  const entries = JSON.parse(readFileSync(path, "utf8"));
  return new Map(entries.map((entry) => [entry.file, entry.pin]));
}

function frontmatter(tags, rating, note, source) {
  const lines = ["---", `tags: [${tags.join(", ")}]`, `rating: ${rating}`];
  if (source) lines.push(`source: ${source}`);
  lines.push("---");
  if (note) lines.push("", note);
  return lines.join("\n") + "\n";
}

const pinOf = pins(SOURCE);

rmSync(ROOT, { recursive: true, force: true });
let bytes = 0;
let kept = 0;
const missing = [];

for (const [file, relPath, tags, rating, note] of LIBRARY) {
  const source = join(SOURCE, file);
  // The source folder is someone's working pile: a photograph can be gone.
  if (!existsSync(source)) {
    missing.push(file);
    continue;
  }
  kept += 1;
  const target = join(ROOT, relPath);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  bytes += statSync(target).size;

  const metaPath = join(ROOT, ".deja/meta", `${relPath}.md`);
  mkdirSync(dirname(metaPath), { recursive: true });
  writeFileSync(metaPath, frontmatter(tags, rating, note, pinOf.get(file)));
}

// Everything in, so opening the folder lands on the wall instead of the picker.
mkdirSync(join(ROOT, ".deja"), { recursive: true });
writeFileSync(join(ROOT, ".deja/scope.json"), JSON.stringify({ excluded: [] }) + "\n");

const folders = new Set(LIBRARY.map(([, relPath]) => dirname(relPath)));
console.log(`wrote ${kept} photographs (${Math.round(bytes / 1024)} KB) in ${folders.size} folders to ${ROOT}`);
if (missing.length) console.log(`skipped ${missing.length} no longer in the source: ${missing.join(", ")}`);
