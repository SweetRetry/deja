// npm run test:unit  (Node 24 strips the types)
import assert from "node:assert/strict";
import test from "node:test";
import type { Entry, Scope, VaultView } from "../../lib/types.ts";
import type { Progress, SessionEvent } from "./events.ts";
import { initialVault, reduceVault, shouldIndex, type VaultState } from "./machine.ts";

const run = (events: SessionEvent[], start: VaultState = initialVault): VaultState =>
  events.reduce((vault, event) => reduceVault(vault, event), start);

function entry(relPath: string, extra: Partial<Entry> = {}): Entry {
  return {
    relPath,
    name: relPath.split("/").pop() ?? relPath,
    ext: "jpg",
    kind: "image",
    sizeBytes: 1,
    modified: 0,
    width: 10,
    height: 10,
    colors: [],
    thumbPath: null,
    indexed: false,
    embedded: false,
    tags: [],
    rating: 0,
    note: "",
    source: null,
    ...extra,
  };
}

const chosen: Scope = { chosen: true, excluded: [], tree: [] };

function view(entries: Entry[], indexed = 0, embedded = 0, scope = chosen): VaultView {
  return { root: "/v", folders: [], scope, entries, indexed, embedded, total: entries.length };
}

const four = [entry("a.jpg"), entry("b.jpg"), entry("p/c.jpg"), entry("p/q/d.jpg")];
const opened: SessionEvent = { type: "OPENED", view: view(four) };
const slice = (progress: Partial<Progress>, changed = true): SessionEvent => ({
  type: "SLICE",
  progress: { indexed: 0, embedded: 0, total: 4, remaining: 4, ...progress },
  changed,
});
const embedding = run([{ type: "OPEN", path: "/v" }, opened, slice({ indexed: 4, remaining: 0 })]);
const ready = run([slice({ indexed: 4, embedded: 4, remaining: 0 })], embedding);

test("opening leads to deriving, not straight to ready", () => {
  const vault = run([{ type: "OPEN", path: "/v" }, opened]);
  assert.equal(vault.phase, "deriving");
  assert.equal(shouldIndex(vault), true);
});

test("an open counts files under every folder once", () => {
  const vault = run([{ type: "OPEN", path: "/v" }, opened]);
  assert.deepEqual(vault.library?.counts, { "": 4, p: 2, "p/q": 1 });
});

test("slices move deriving to embedding to ready", () => {
  assert.equal(embedding.phase, "embedding");
  assert.equal(ready.phase, "ready");
  assert.equal(shouldIndex(ready), false);
});

test("only a slice that changed something bumps the revision", () => {
  const quiet = reduceVault(embedding, slice({ indexed: 4, remaining: 0 }, false));
  assert.equal(quiet.revision, embedding.revision);
  const busy = reduceVault(embedding, slice({ indexed: 4, embedded: 1, remaining: 0 }, true));
  assert.equal(busy.revision, embedding.revision + 1);
});

test("pause remembers the phase it came from and resume returns there", () => {
  const paused = reduceVault(embedding, { type: "PAUSE" });
  assert.equal(paused.phase, "paused");
  assert.equal(paused.pausedFrom, "embedding");
  assert.equal(shouldIndex(paused), false);
  assert.equal(reduceVault(paused, { type: "RESUME" }).phase, "embedding");
});

test("a settled folder can be paused so new files wait", () => {
  const paused = reduceVault(ready, { type: "PAUSE" });
  assert.equal(paused.phase, "paused", "ready is a legal phase to pause from");
  assert.equal(reduceVault(paused, { type: "RESUME" }).phase, "deriving");
});

test("a slice during pause changes nothing", () => {
  const paused = run([{ type: "OPEN", path: "/v" }, opened, { type: "PAUSE" }]);
  assert.equal(reduceVault(paused, slice({ indexed: 99, embedded: 99, remaining: 0 })), paused);
});

test("a slice before the folder is open is dropped", () => {
  assert.equal(reduceVault(initialVault, slice({ indexed: 9 })), initialVault);
});

test("a late open result cannot land after close", () => {
  const late = run([{ type: "OPEN", path: "/v" }, { type: "CLOSE" }, opened]);
  assert.equal(late.phase, "idle", "stale scan is ignored");
  assert.equal(late.library, null);
});

test("model ready re-arms the search in any phase, including paused", () => {
  const paused = run([{ type: "OPEN", path: "/v" }, opened, { type: "PAUSE" }]);
  const warm = reduceVault(paused, { type: "MODEL_READY" });
  assert.equal(warm.model, "ready");
  assert.equal(warm.modelEpoch, 1);
  assert.equal(warm.phase, "paused", "warming the model does not resume indexing");
  assert.equal(reduceVault(warm, { type: "MODEL_READY" }).modelEpoch, 1, "the epoch bumps once");
});

test("close clears the folder but keeps a warm model and the settings", () => {
  const settings = { semantic: true, modelIdleSecs: 60 };
  const closed = run([{ type: "SETTINGS", settings }, { type: "MODEL_READY" }, { type: "CLOSE" }], ready);
  assert.equal(closed.phase, "idle");
  assert.equal(closed.library, null);
  assert.equal(closed.progress.total, 0);
  assert.equal(closed.model, "ready");
  assert.deepEqual(closed.settings, settings);
});

test("a rescan after ready reopens the work when new files appear", () => {
  const more = view([...four, entry("e.jpg")], 4, 4);
  const withNewFile = reduceVault(ready, { type: "RESCANNED", view: more });
  assert.equal(withNewFile.phase, "deriving", "a new file puts the machine back to work");
  assert.equal(withNewFile.progress.total, 5);
  assert.equal(withNewFile.revision, ready.revision + 1);
});

test("a rescan keeps the pause", () => {
  const paused = reduceVault(ready, { type: "PAUSE" });
  assert.equal(reduceVault(paused, { type: "RESCANNED", view: view(four, 4, 4) }).phase, "paused");
});

test("a failed open cannot be resumed into indexing", () => {
  const failed = run([{ type: "OPEN", path: "/nope" }, { type: "OPEN_FAILED", error: "not a folder" }]);
  assert.equal(failed.phase, "failed");
  assert.equal(failed.error, "not a folder");
  assert.equal(shouldIndex(failed), false);
  assert.equal(reduceVault(failed, { type: "RESUME" }).phase, "failed");
  assert.equal(reduceVault(failed, { type: "OPEN", path: "/v" }).phase, "opening", "opening again is allowed");
});

const meta = (rating: number) => ({ tags: [], rating, note: "", source: null });

test("an edit shows at once and the saved entry replaces it", () => {
  const edited = reduceVault(ready, { type: "META_EDITED", relPath: "a.jpg", meta: meta(4) });
  assert.equal(edited.library?.byPath["a.jpg"]?.rating, 4);
  const saved = reduceVault(edited, { type: "META_SAVED", entry: entry("a.jpg", { rating: 4, note: "disk" }) });
  assert.equal(saved.library?.byPath["a.jpg"]?.note, "disk");
  assert.deepEqual(saved.saving, {});
});

test("a failed edit returns to what was on disk", () => {
  const edited = reduceVault(ready, { type: "META_EDITED", relPath: "a.jpg", meta: meta(4) });
  const failed = reduceVault(edited, { type: "META_FAILED", relPath: "a.jpg" });
  assert.equal(failed.library?.byPath["a.jpg"]?.rating, 0);
  assert.deepEqual(failed.saving, {});
});

test("with two edits in flight, only the last answer settles the entry", () => {
  const twice = run(
    [
      { type: "META_EDITED", relPath: "a.jpg", meta: meta(2) },
      { type: "META_EDITED", relPath: "a.jpg", meta: meta(5) },
      { type: "META_FAILED", relPath: "a.jpg" },
    ],
    ready,
  );
  assert.equal(twice.library?.byPath["a.jpg"]?.rating, 5, "the first failure does not undo the second edit");
  const settled = reduceVault(twice, { type: "META_SAVED", entry: entry("a.jpg", { rating: 5 }) });
  assert.deepEqual(settled.saving, {});
});

test("a rescan while an edit is in flight keeps the edit", () => {
  const edited = reduceVault(ready, { type: "META_EDITED", relPath: "a.jpg", meta: meta(3) });
  const rescanned = reduceVault(edited, { type: "RESCANNED", view: view(four, 4, 4) });
  assert.equal(rescanned.library?.byPath["a.jpg"]?.rating, 3);
});

const unscoped = view(four, 0, 0, { chosen: false, excluded: [], tree: [{ path: "", files: 4 }] });
const asking = run([{ type: "OPEN", path: "/v" }, { type: "OPENED", view: unscoped }]);

test("a folder opened for the first time waits for its scope before indexing", () => {
  assert.equal(asking.phase, "scoping");
  assert.equal(shouldIndex(asking), false);
  assert.equal(reduceVault(asking, slice({ indexed: 4, remaining: 0 })), asking, "no slice runs while asking");
  assert.equal(reduceVault(asking, { type: "PAUSE" }), asking, "there is nothing to pause");
});

test("a rescan while asking keeps asking, and the answer starts the work", () => {
  assert.equal(reduceVault(asking, { type: "RESCANNED", view: unscoped }).phase, "scoping");
  const scoped = reduceVault(asking, { type: "SCOPED", view: view(four.slice(0, 2)) });
  assert.equal(scoped.phase, "deriving");
  assert.equal(scoped.progress.total, 2);
  assert.equal(scoped.library?.scope.chosen, true);
});

test("narrowing the scope later keeps a pause", () => {
  const paused = reduceVault(ready, { type: "PAUSE" });
  assert.equal(reduceVault(paused, { type: "SCOPED", view: view(four.slice(0, 1), 1, 1) }).phase, "paused");
});

const paths = (vault: VaultState) => Object.keys(vault.library?.byPath ?? {}).sort();

test("a rescan forgets a file that left the disk, so its tags are no longer counted", () => {
  const tagged = run([
    { type: "OPEN", path: "/v" },
    { type: "OPENED", view: view([entry("a.jpg", { tags: ["x"] }), entry("b.jpg")]) },
  ]);
  const rescanned = reduceVault(tagged, { type: "RESCANNED", view: view([entry("b.jpg")]) });
  assert.deepEqual(paths(rescanned), ["b.jpg"]);
  assert.equal(rescanned.library?.counts[""], 1);
});

test("excluding a folder from the scope drops its files from the library", () => {
  const scoped = reduceVault(ready, { type: "SCOPED", view: view(four.slice(0, 2), 2, 2) });
  assert.deepEqual(paths(scoped), ["a.jpg", "b.jpg"]);
});

test("a rescan still keeps an edit in flight on a file that stays", () => {
  const edited = reduceVault(ready, { type: "META_EDITED", relPath: "a.jpg", meta: meta(3) });
  const rescanned = reduceVault(edited, { type: "RESCANNED", view: view(four.slice(0, 2), 2, 2) });
  assert.equal(rescanned.library?.byPath["a.jpg"]?.rating, 3);
  assert.deepEqual(paths(rescanned), ["a.jpg", "b.jpg"]);
});

test("a search answer adds fresh entries without dropping the files it did not list", () => {
  const answered = reduceVault(ready, {
    type: "RESULTS",
    request: 0,
    response: { entries: [entry("a.jpg", { rating: 2 })], scores: {}, colorCounts: [], semantic: false, tookMs: 0 },
  });
  assert.equal(answered.library?.byPath["a.jpg"]?.rating, 2);
  assert.deepEqual(paths(answered), ["a.jpg", "b.jpg", "p/c.jpg", "p/q/d.jpg"]);
});
