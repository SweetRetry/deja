import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyFilter } from "../../lib/types.ts";
import { emptyState, type EmptyInput } from "./empty-state.ts";

const base: EmptyInput = { open: true, error: null, query: "", filter: emptyFilter, folderTotal: 12 };

test("no folder open names the space and offers to open one", () => {
  assert.deepEqual(emptyState({ ...base, open: false }), {
    title: "尚未打开素材文件夹",
    body: "文件保留在原位置，其中的图片与视频可按画面内容搜索。",
    action: "open",
  });
});

test("a failed open says why and offers to try again", () => {
  assert.deepEqual(emptyState({ ...base, open: false, error: "/tmp/a.png is not a folder" }), {
    title: "打不开这个文件夹",
    body: "所选路径不是文件夹，请选择一个文件夹。",
    action: "open",
  });
});

test("an open folder ignores a stale open error", () => {
  assert.equal(emptyState({ ...base, error: "boom", folderTotal: 0 }).title, "此文件夹中没有图片或视频");
});

test("an empty folder offers nothing to clear", () => {
  assert.deepEqual(emptyState({ ...base, folderTotal: 0 }), {
    title: "此文件夹中没有图片或视频",
    body: "放入图片或视频后，Shelf 自动生成预览并建立语义索引。",
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
  const filter = { ...emptyFilter, kinds: ["video"] };
  assert.deepEqual(emptyState({ ...base, query: "x", filter }), {
    title: "没有匹配的素材",
    body: "可换一种描述，或放宽筛选条件。",
    action: "clear-both",
  });
});

test("a kind filter names the kind and the count it restores", () => {
  const filter = { ...emptyFilter, kinds: ["video"] };
  assert.deepEqual(emptyState({ ...base, filter }), {
    title: "此文件夹中没有视频",
    body: "重置筛选后显示全部 12 项素材。",
    action: "clear-filters",
  });
  assert.equal(emptyState({ ...base, filter: { ...emptyFilter, kinds: ["image"] } }).title, "此文件夹中没有图片");
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
  const mixed = { ...emptyFilter, kinds: ["video"], minRating: 4 };
  assert.deepEqual(emptyState({ ...base, filter: mixed }), {
    title: "没有符合筛选条件的素材",
    body: "重置筛选后显示全部 12 项素材。",
    action: "clear-filters",
  });
  const scoped = { ...emptyFilter, folder: "a", tag: "t" };
  assert.equal(emptyState({ ...base, filter: scoped, folderTotal: 0 }).action, null);
});
