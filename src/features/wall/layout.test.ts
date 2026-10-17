// node --test src/features/wall/layout.test.ts  (Node 24 strips the types)
import assert from "node:assert/strict";
import test from "node:test";
import type { Entry } from "../../lib/types.ts";
import { layout, neighbor, step } from "./layout.ts";

function entry(relPath: string, width: number | null = 100, height: number | null = 100): Entry {
  return {
    relPath,
    name: relPath,
    ext: "jpg",
    kind: "image",
    sizeBytes: 1,
    modified: 0,
    width,
    height,
    colors: [],
    dhash: "",
    thumbPath: null,
    indexed: true,
    embedded: false,
    tags: [],
    rating: 0,
    note: "",
    source: null,
  };
}

const boxes = (placed: ReturnType<typeof layout>["placed"]) =>
  placed.map(({ entry, x, y, width, height }) => [entry.relPath, x, y, width, height]);

// 332px holds three 100px columns with two 16px gaps.
const masonry = layout(
  [entry("a", 100, 200), entry("b"), entry("c", 200, 100), entry("d"), entry("e"), entry("f"), entry("g", null, null)],
  { width: 332, cell: 100, uniform: false, caption: 0 },
);

test("masonry drops each tile into the shortest column at its own aspect", () => {
  assert.deepEqual(boxes(masonry.placed), [
    ["a", 0, 0, 100, 200],
    ["b", 116, 0, 100, 100],
    ["c", 232, 0, 100, 50],
    ["d", 232, 66, 100, 100],
    ["e", 116, 116, 100, 100],
    ["f", 232, 182, 100, 100],
    ["g", 0, 216, 100, 100],
  ]);
  assert.equal(masonry.height, 332);
});

test("columns stretch to fill the row, and a wall not yet measured is one column of the asked width", () => {
  const wide = layout([entry("a"), entry("b")], { width: 352, cell: 100, uniform: true, caption: 0 });
  assert.deepEqual(wide.placed.map((tile) => Math.round(tile.width * 100) / 100), [106.67, 106.67]);
  const unmeasured = layout([entry("a"), entry("b")], { width: 0, cell: 168, uniform: true, caption: 0 });
  assert.deepEqual(boxes(unmeasured.placed), [
    ["a", 0, 0, 168, 168],
    ["b", 0, 184, 168, 168],
  ]);
});

test("left and right follow the result order", () => {
  assert.equal(neighbor(masonry.placed, "a", "right"), "b");
  assert.equal(neighbor(masonry.placed, "c", "left"), "b");
  assert.equal(neighbor(masonry.placed, "a", "left"), null);
  assert.equal(neighbor(masonry.placed, "g", "right"), null);
});

test("up and down stay in the masonry column", () => {
  assert.equal(neighbor(masonry.placed, "a", "down"), "g");
  assert.equal(neighbor(masonry.placed, "b", "down"), "e");
  assert.equal(neighbor(masonry.placed, "c", "down"), "d");
  assert.equal(neighbor(masonry.placed, "d", "down"), "f");
  assert.equal(neighbor(masonry.placed, "f", "up"), "d");
  assert.equal(neighbor(masonry.placed, "g", "up"), "a");
  assert.equal(neighbor(masonry.placed, "a", "up"), null);
  assert.equal(neighbor(masonry.placed, "g", "down"), null);
});

test("the grid moves by rows, and stops where the last row runs out", () => {
  const grid = layout([entry("a", 100, 300), entry("b"), entry("c"), entry("d"), entry("e")], {
    width: 332,
    cell: 100,
    uniform: true,
    caption: 24,
  });
  assert.deepEqual(boxes(grid.placed), [
    ["a", 0, 0, 100, 100],
    ["b", 116, 0, 100, 100],
    ["c", 232, 0, 100, 100],
    ["d", 0, 140, 100, 100],
    ["e", 116, 140, 100, 100],
  ]);
  assert.equal(grid.height, 280);
  assert.equal(neighbor(grid.placed, "a", "down"), "d");
  assert.equal(neighbor(grid.placed, "e", "up"), "b");
  assert.equal(neighbor(grid.placed, "c", "down"), null);
  assert.equal(neighbor(grid.placed, "missing", "down"), null);
});

test("keys step from the selection, Home and End jump, other keys do nothing", () => {
  assert.equal(step(masonry.placed, "a", "ArrowRight"), "b");
  assert.equal(step(masonry.placed, "a", "ArrowLeft"), null);
  assert.equal(step(masonry.placed, "c", "Home"), "a");
  assert.equal(step(masonry.placed, "a", "End"), "g");
  assert.equal(step(masonry.placed, "gone", "ArrowDown"), "a", "a selection off the wall starts at the first tile");
  assert.equal(step(masonry.placed, null, "ArrowUp"), "a");
  assert.equal(step(masonry.placed, "a", "x"), undefined);
  assert.equal(step([], null, "End"), null);
});
