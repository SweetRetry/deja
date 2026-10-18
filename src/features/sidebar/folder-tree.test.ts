import assert from "node:assert/strict";
import { test } from "node:test";
import { folderRows, moveTargets, openAncestors } from "./folder-tree.ts";

const folders = ["", "海报", "海报/2024", "海报/2024/春", "人像"];

test("top level is open and deeper folders start shut", () => {
  assert.deepEqual(
    folderRows(folders, {}).map((row) => [row.rel, row.depth, row.hasChildren, row.expanded]),
    [
      ["海报", 0, true, true],
      ["海报/2024", 1, true, false],
      ["人像", 0, false, true],
    ],
  );
});

test("toggling opens a deep folder and shuts a top-level one", () => {
  assert.deepEqual(
    folderRows(folders, { "海报/2024": true }).map((row) => row.rel),
    ["海报", "海报/2024", "海报/2024/春", "人像"],
  );
  assert.deepEqual(
    folderRows(folders, { 海报: false }).map((row) => row.rel),
    ["海报", "人像"],
  );
});

test("an unlisted parent does not hide its child", () => {
  assert.deepEqual(
    folderRows(["a/b"], {}).map((row) => [row.rel, row.depth]),
    [["a/b", 1]],
  );
});

test("the folder being shown opens every folder above it", () => {
  const folders = ["a", "a/b", "a/b/c", "x"];
  const shut = { a: false };
  const opened = openAncestors(shut, "a/b/c");
  assert.deepEqual(opened, { a: true, "a/b": true });
  assert.deepEqual(
    folderRows(folders, opened).map((row) => row.rel),
    ["a", "a/b", "a/b/c", "x"],
  );
  assert.equal(openAncestors(opened, "a/b/c"), opened, "already open keeps the same object");
});

test("move targets list the root, then every folder open at its depth", () => {
  assert.deepEqual(moveTargets(["", "摄影", "摄影/人像", "摄影/人像/深", "海报"], "素材"), [
    { rel: "", name: "素材", depth: 0 },
    { rel: "摄影", name: "摄影", depth: 1 },
    { rel: "摄影/人像", name: "人像", depth: 2 },
    { rel: "摄影/人像/深", name: "深", depth: 3 },
    { rel: "海报", name: "海报", depth: 1 },
  ]);
});
