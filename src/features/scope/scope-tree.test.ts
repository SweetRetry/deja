import assert from "node:assert/strict";
import { test } from "node:test";
import { checks, indexedFiles, normalize, rootFiles, sameScope, selectAll, selectNone, toggle } from "./scope-tree.ts";

// 3 files sit directly in the root, 2 directly in 海报.
const tree = [
  { path: "", files: 20 },
  { path: "人像", files: 5 },
  { path: "海报", files: 12 },
  { path: "海报/2023", files: 4 },
  { path: "海报/2024", files: 6 },
  { path: "海报/2024/春", files: 2 },
  { path: "海报/2024/夏", files: 3 },
];

test("everything is on and indexed when nothing is excluded", () => {
  assert.deepEqual(checks(tree, []), {
    "": "on",
    人像: "on",
    海报: "on",
    "海报/2023": "on",
    "海报/2024": "on",
    "海报/2024/春": "on",
    "海报/2024/夏": "on",
  });
  assert.equal(indexedFiles(tree, []), 20);
});

test("an excluded folder takes its subtree out and marks its ancestors mixed", () => {
  assert.deepEqual(checks(tree, ["海报/2024"]), {
    "": "mixed",
    人像: "on",
    海报: "mixed",
    "海报/2023": "on",
    "海报/2024": "off",
    "海报/2024/春": "off",
    "海报/2024/夏": "off",
  });
  assert.equal(indexedFiles(tree, ["海报/2024"]), 14);
});

test("normalize drops the root, duplicates and folders inside excluded ones", () => {
  assert.deepEqual(normalize(["海报/2024/春", "", "人像", "海报", "人像"]), ["人像", "海报"]);
  assert.equal(sameScope(["海报", "海报/2023"], ["海报"]), true);
  assert.equal(sameScope(["海报"], []), false);
});

test("toggling an included folder off excludes its subtree", () => {
  assert.deepEqual(toggle(tree, [], "人像"), ["人像"]);
  assert.deepEqual(toggle(tree, ["人像"], "海报/2024"), ["人像", "海报/2024"]);
});

test("toggling an excluded or mixed folder brings its whole subtree back", () => {
  assert.deepEqual(toggle(tree, ["人像"], "人像"), []);
  assert.deepEqual(toggle(tree, ["海报/2023", "海报/2024/春"], "海报"), []);
});

test("re-including a child of an excluded folder excludes the child's siblings instead", () => {
  assert.deepEqual(toggle(tree, ["海报"], "海报/2024"), ["海报/2023"]);
  assert.deepEqual(toggle(tree, ["海报", "人像"], "海报/2024/春"), ["人像", "海报/2023", "海报/2024/夏"]);
  assert.equal(checks(tree, ["海报/2023", "海报/2024/夏"])["海报/2024"], "mixed");
});

test("the root cannot be toggled", () => {
  assert.deepEqual(toggle(tree, ["人像"], ""), ["人像"]);
});

test("select none leaves only the files directly in the root", () => {
  assert.deepEqual(selectNone(tree), ["人像", "海报"]);
  assert.equal(indexedFiles(tree, selectNone(tree)), 3);
  assert.equal(rootFiles(tree), 3);
  assert.deepEqual(selectAll(), []);
});

test("an excluded folder no longer on disk counts nothing", () => {
  assert.equal(indexedFiles(tree, ["已删除"]), 20);
});
