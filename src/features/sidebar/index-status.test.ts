import assert from "node:assert/strict";
import { test } from "node:test";
import { indexStatus } from "./index-status.ts";
import type { VaultState } from "../vault/machine.ts";

const settings = { semantic: true } as VaultState["settings"];
const base = {
  phase: "ready",
  progress: { indexed: 10, embedded: 10, total: 10, remaining: 0 },
  model: "ready",
  settings,
} satisfies Parameters<typeof indexStatus>[0];

test("a settled folder reads as done", () => {
  assert.deepEqual(indexStatus(base), {
    tone: "success",
    label: "索引已完成",
    notice: null,
    pausable: true,
    paused: false,
  });
});

test("preview generation counts indexed files", () => {
  const status = indexStatus({
    ...base,
    phase: "deriving",
    progress: { indexed: 3, embedded: 0, total: 10, remaining: 7 },
  });
  assert.equal(status?.label, "生成预览");
  assert.deepEqual(status?.count, { done: 3, total: 10 });
  assert.equal(status?.tone, "muted");
});

test("semantic indexing counts embedded files once the model is ready", () => {
  const status = indexStatus({
    ...base,
    phase: "embedding",
    progress: { indexed: 10, embedded: 4, total: 10, remaining: 0 },
  });
  assert.equal(status?.label, "建立语义索引");
  assert.deepEqual(status?.count, { done: 4, total: 10 });
});

test("embedding waits on the model without a count", () => {
  const status = indexStatus({
    ...base,
    phase: "embedding",
    model: "warming",
    progress: { indexed: 10, embedded: 0, total: 10, remaining: 0 },
  });
  assert.equal(status?.label, "启动语义模型");
  assert.equal(status?.count, undefined);
  assert.deepEqual(status?.notice, { text: "语义模型就绪前，搜索仅匹配文件名、标签与备注。", retry: false });
});

test("paused is a warning with no count", () => {
  const status = indexStatus({ ...base, phase: "paused" });
  assert.equal(status?.label, "索引已暂停");
  assert.equal(status?.tone, "warning");
  assert.equal(status?.paused, true);
});

test("a failed model gets a retry notice", () => {
  const status = indexStatus({ ...base, model: "failed" });
  assert.deepEqual(status?.notice, { text: "语义模型启动失败，搜索仅匹配文件名、标签与备注。", retry: true });
});

test("no pending-model notice when semantic search is off", () => {
  assert.equal(indexStatus({ ...base, model: "unknown", settings: { semantic: false } as VaultState["settings"] })?.notice, null);
  assert.equal(indexStatus({ ...base, model: "unknown", settings: null })?.notice, null);
});

test("opening disables the pause button and idle shows nothing", () => {
  assert.equal(indexStatus({ ...base, phase: "opening" })?.pausable, false);
  assert.equal(indexStatus({ ...base, phase: "idle" }), null);
  assert.equal(indexStatus({ ...base, phase: "failed" }), null);
});
