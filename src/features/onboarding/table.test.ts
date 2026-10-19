import assert from "node:assert/strict";
import { test } from "node:test";
import { home, inStack, skeletonSlot, skeletonSlots, stack } from "./table.ts";

const window = { width: 1440, height: 900 };

test("the stack sits right of center and spreads as far as the copy allows", () => {
  // 994 − 648 (the copy's 45%) − 125 (half a print) = 221.
  assert.deepEqual(stack(window), { x: 994, y: 468, spread: 221 });
  // A short window caps the spread at 30% of its height.
  assert.deepEqual(stack({ width: 1440, height: 500 }), { x: 994, y: 260, spread: 150 });
  // At the narrowest window the copy wins: 707 − 461 − 125 = 121.
  assert.deepEqual(stack({ width: 1024, height: 700 }), { x: 707, y: 364, spread: 121 });
});

test("a print's home is its offset in units of the spread", () => {
  assert.deepEqual(home({ dx: 0.5, dy: -1, rotate: 7 }, window), { x: 1104.5, y: 247, rotate: 7 });
});

test("a print thrown far from the stack no longer belongs to it", () => {
  assert.equal(inStack({ x: 1100, y: 500 }, window), true);
  assert.equal(inStack({ x: 200, y: 800 }, window), false);
});

test("slots match the skeleton grid: 24 by 64 padding, 16 gap, columns of at least the cell", () => {
  // 1440 − 48 = 1392 wide fits 7 columns of at least 168 with 16 between: (1392 − 96) / 7.
  const side = 1296 / 7;
  assert.deepEqual(skeletonSlot(0, { width: 1440, cell: 168 }), { x: 24 + side / 2, y: 64 + side / 2, side });
  assert.deepEqual(skeletonSlot(8, { width: 1440, cell: 168 }), {
    x: 24 + side + 16 + side / 2,
    y: 64 + side + 16 + side / 2,
    side,
  });
});

test("the table lays out as many slots as reach into view, and stops", () => {
  // 1000 − 48 = 952 fits 5 columns of 168: side (952 − 64) / 5 = 177.6. Rows start at 64 and 257.6;
  // the third would start at 451.2, below a 400-tall table.
  const slots = skeletonSlots({ width: 1000, height: 400 }, 168);
  assert.equal(slots.length, 10);
  assert.equal(slots.at(-1)?.y, 64 + (177.6 + 16) + 177.6 / 2);
});
