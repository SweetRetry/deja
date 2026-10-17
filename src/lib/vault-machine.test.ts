// node --test src/lib/vault-machine.test.ts  (Node 24 strips the types)
import assert from "node:assert/strict";
import test from "node:test";
import { initial, reduce, shouldIndex, type Event, type Machine } from "./vault-machine.ts";

const run = (events: Event[], start: Machine = initial): Machine =>
  events.reduce((machine, event) => reduce(machine, event), start);

const opened: Event = { type: "OPENED", root: "/v", indexed: 0, embedded: 0, total: 4, remaining: 4 };

test("opening leads to deriving, not straight to ready", () => {
  const machine = run([{ type: "OPEN", path: "/v" }, opened]);
  assert.equal(machine.phase, "deriving");
  assert.equal(shouldIndex(machine), true);
});

test("slices move deriving to embedding to ready", () => {
  const afterThumbs = run([{ type: "OPEN", path: "/v" }, opened, { type: "SLICE", indexed: 4, embedded: 0, total: 4, remaining: 0 }]);
  assert.equal(afterThumbs.phase, "embedding");
  const afterVectors = reduce(afterThumbs, { type: "SLICE", indexed: 4, embedded: 4, total: 4, remaining: 0 });
  assert.equal(afterVectors.phase, "ready");
  assert.equal(shouldIndex(afterVectors), false);
});

test("pause remembers the phase it came from and resume returns there", () => {
  const embedding = run([{ type: "OPEN", path: "/v" }, opened, { type: "SLICE", indexed: 4, embedded: 0, total: 4, remaining: 0 }]);
  const paused = reduce(embedding, { type: "PAUSE" });
  assert.equal(paused.phase, "paused");
  assert.equal(paused.pausedFrom, "embedding");
  assert.equal(shouldIndex(paused), false);
  assert.equal(reduce(paused, { type: "RESUME" }).phase, "embedding");
});

test("a settled folder can be paused so new files wait", () => {
  const ready = run([
    { type: "OPEN", path: "/v" },
    opened,
    { type: "SLICE", indexed: 4, embedded: 4, total: 4, remaining: 0 },
  ]);
  const paused = reduce(ready, { type: "PAUSE" });
  assert.equal(paused.phase, "paused", "ready is a legal phase to pause from");
  assert.equal(reduce(paused, { type: "RESUME" }).phase, "deriving");
});

test("a slice during pause changes nothing", () => {
  const paused = run([{ type: "OPEN", path: "/v" }, opened, { type: "PAUSE" }]);
  const after = reduce(paused, { type: "SLICE", indexed: 99, embedded: 99, total: 4, remaining: 0 });
  assert.deepEqual(after, paused, "the paused counters stay put");
});

test("a slice before the folder is open is dropped", () => {
  const machine = reduce(initial, { type: "SLICE", indexed: 9, embedded: 9, total: 9, remaining: 0 });
  assert.equal(machine.phase, "idle");
  assert.equal(machine.indexed, 0);
});

test("a late open result cannot land after close", () => {
  const closed = run([{ type: "OPEN", path: "/v" }, { type: "CLOSE" }]);
  const late = reduce(closed, opened);
  assert.equal(late.phase, "idle", "stale scan is ignored");
  assert.equal(late.root, null);
});

test("model ready re-arms the search in any phase, including paused", () => {
  const paused = run([{ type: "OPEN", path: "/v" }, opened, { type: "PAUSE" }]);
  const warm = reduce(paused, { type: "MODEL_READY" });
  assert.equal(warm.model, "ready");
  assert.equal(warm.modelEpoch, 1);
  assert.equal(warm.phase, "paused", "warming the model does not resume indexing");
  assert.equal(reduce(warm, { type: "MODEL_READY" }).modelEpoch, 1, "the epoch bumps once");
});

test("search counters never go below zero and failures carry a message", () => {
  const started = run([{ type: "SEARCH_START" }, { type: "SEARCH_START" }]);
  assert.equal(started.searching, 2);
  const ended = run([{ type: "SEARCH_END" }, { type: "SEARCH_END" }, { type: "SEARCH_END" }], started);
  assert.equal(ended.searching, 0);
  const failed = reduce(started, { type: "SEARCH_FAILED", error: "boom" });
  assert.equal(failed.searching, 1);
  assert.equal(failed.error, "boom");
  assert.equal(reduce(failed, { type: "CLEAR_ERROR" }).error, null);
});

test("close clears the folder but keeps a warm model", () => {
  const warm = run([{ type: "OPEN", path: "/v" }, opened, { type: "MODEL_READY" }, { type: "CLOSE" }]);
  assert.equal(warm.phase, "idle");
  assert.equal(warm.root, null);
  assert.equal(warm.total, 0);
  assert.equal(warm.model, "ready");
});

test("a rescan after ready reopens the work when new files appear", () => {
  const ready = run([
    { type: "OPEN", path: "/v" },
    opened,
    { type: "SLICE", indexed: 4, embedded: 4, total: 4, remaining: 0 },
  ]);
  assert.equal(ready.phase, "ready");
  const withNewFile = reduce(ready, { type: "RESCAN", indexed: 4, embedded: 4, total: 5, remaining: 1 });
  assert.equal(withNewFile.phase, "deriving", "a new file puts the machine back to work");
  assert.equal(withNewFile.total, 5);
});

test("a rescan keeps the pause", () => {
  const paused = run([{ type: "OPEN", path: "/v" }, opened, { type: "PAUSE" }]);
  const rescanned = reduce(paused, { type: "RESCAN", indexed: 4, embedded: 4, total: 4, remaining: 0 });
  assert.equal(rescanned.phase, "paused");
});

test("a failed open cannot be resumed into indexing", () => {
  const failed = run([{ type: "OPEN", path: "/nope" }, { type: "OPEN_FAILED", error: "not a folder" }]);
  assert.equal(failed.phase, "failed");
  assert.equal(shouldIndex(failed), false);
  assert.equal(reduce(failed, { type: "RESUME" }).phase, "failed");
  assert.equal(reduce(failed, { type: "OPEN", path: "/v" }).phase, "opening", "opening again is allowed");
});
