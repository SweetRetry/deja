import assert from "node:assert/strict";
import { test } from "node:test";
import { ellipsize } from "./utils.ts";

test("short names are left alone", () => {
  assert.equal(ellipsize("海报.jpg"), "海报.jpg");
  assert.equal(ellipsize("a".repeat(24)), "a".repeat(24));
});

test("a long name is cut in the middle and keeps its extension", () => {
  assert.equal(ellipsize("23aa89b65ddccb3ed222be9c9febf655.jpg"), "23aa89b65d…c9febf655.jpg");
});

test("a long name without an extension is cut in the middle", () => {
  assert.equal(ellipsize("abcdefghijklmnopqrstuvwxyz0123456789", 10), "abcde…6789");
});
