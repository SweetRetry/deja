import assert from "node:assert/strict";
import { test } from "node:test";
import { baseName, ellipsize } from "./utils.ts";

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

test("baseName is the last path segment, or the fallback when there is none", () => {
  assert.equal(baseName("a/b/海报.jpg"), "海报.jpg");
  assert.equal(baseName("海报.jpg"), "海报.jpg");
  assert.equal(baseName("", "根目录"), "根目录");
  assert.equal(baseName("a/b/", "根目录"), "根目录");
  assert.equal(baseName(""), "");
});
