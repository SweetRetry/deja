import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyFilter } from "../../lib/types.ts";
import { emptyState, type EmptyInput } from "./empty-state.ts";

const base: EmptyInput = { query: "", filter: emptyFilter, folderTotal: 12 };

test("an empty folder offers nothing to clear", () => {
  assert.deepEqual(emptyState({ ...base, folderTotal: 0 }), {
    title: "此文件夹中没有图片或视频",
    body: "放入图片或视频后，Déjà 自动生成预览并建立语义索引。",
    action: null,
  });
});

test("a search with no hits names the query", () => {
  assert.deepEqual(emptyState({ ...base, query: " x " }), {
    title: "没有匹配「x」的素材",
    body: "可换一种描述重新搜索。",
    action: "clear-search",
  });
});

test("a search under filters clears both", () => {
  const filter = { ...emptyFilter, kinds: ["video" as const] };
  assert.deepEqual(emptyState({ ...base, query: "x", filter }), {
    title: "没有匹配的素材",
    body: "可换一种描述，或放宽筛选条件。",
    action: "clear-both",
  });
});

test("a kind filter names the kind and the count it restores", () => {
  const filter = { ...emptyFilter, kinds: ["video" as const] };
  assert.deepEqual(emptyState({ ...base, filter }), {
    title: "此文件夹中没有视频",
    body: "重置筛选后显示全部 12 项素材。",
    action: "clear-filters",
  });
  assert.equal(emptyState({ ...base, filter: { ...emptyFilter, kinds: ["image" as const] } }).title, "此文件夹中没有图片");
});

test("a color filter alone names the color", () => {
  const filter = { ...emptyFilter, color: "#d33b36" };
  assert.deepEqual(emptyState({ ...base, filter }), {
    title: "没有以红色为主色的素材",
    body: "主色取每张图面积最大的几种颜色。重置筛选后显示全部 12 项素材。",
    action: "clear-filters",
  });
  assert.equal(emptyState({ ...base, filter: { ...emptyFilter, color: "#123456" } }).title, "没有以所选颜色为主色的素材");
});

test("mixed filters get the generic wording; folder and tag scope do not count", () => {
  const mixed = { ...emptyFilter, kinds: ["video" as const], minRating: 4 };
  assert.deepEqual(emptyState({ ...base, filter: mixed }), {
    title: "没有符合筛选条件的素材",
    body: "重置筛选后显示全部 12 项素材。",
    action: "clear-filters",
  });
  const scoped = { ...emptyFilter, folder: "a", tag: "t" };
  assert.equal(emptyState({ ...base, filter: scoped, folderTotal: 0 }).action, null);
});

test("an empty duplicates view says what was compared and leads back", () => {
  assert.deepEqual(emptyState({ ...base, query: "x", lens: "duplicates", vaultTotal: 12 }), {
    title: "没有重复的素材",
    body: "比对了全部 12 项素材，没有内容相同或相近的副本。",
    action: null,
  });
});
