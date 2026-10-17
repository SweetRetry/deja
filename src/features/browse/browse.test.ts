import assert from "node:assert/strict";
import test from "node:test";
import { initialSession, reduce, type Session } from "../../app/session.ts";
import { emptyFilter, type Entry, type SearchResponse } from "../../lib/types.ts";
import type { SessionEvent } from "../vault/events.ts";

const run = (events: SessionEvent[], start: Session = initialSession()): Session =>
  events.reduce((session, event) => reduce(session, event), start);

function entry(relPath: string): Entry {
  return {
    relPath,
    name: relPath,
    ext: "jpg",
    kind: "image",
    sizeBytes: 1,
    modified: 0,
    width: 10,
    height: 10,
    colors: [],
    dhash: "",
    thumbPath: null,
    indexed: true,
    embedded: true,
    tags: [],
    rating: 0,
    note: "",
    source: null,
  };
}

const response = (paths: string[]): SearchResponse => ({
  entries: paths.map(entry),
  scores: {},
  colorCounts: [],
  semantic: false,
  warmMs: 0,
  tookMs: 0,
});

const scope = { chosen: true, excluded: [], tree: [] };

const open = run([
  { type: "OPEN", path: "/v" },
  {
    type: "OPENED",
    view: {
      root: "/v",
      folders: ["p"],
      scope,
      entries: ["a.jpg", "b.jpg", "p/c.jpg"].map(entry),
      indexed: 3,
      embedded: 3,
      total: 3,
      model: { ready: false },
    },
  },
]);

test("opening shows the folder and selects its first file", () => {
  assert.deepEqual(open.browse.results.paths, ["a.jpg", "b.jpg", "p/c.jpg"]);
  assert.equal(open.browse.selected, "a.jpg");
});

test("only the latest search may land", () => {
  const first = reduce(open, { type: "SEARCH_STARTED", quiet: false });
  const older = first.browse.request;
  const second = reduce(first, { type: "SEARCH_STARTED", quiet: false });
  const late = reduce(second, { type: "RESULTS", request: older, response: response(["b.jpg"]) });
  assert.equal(late, second, "the older answer changes nothing");
  const landed = reduce(second, { type: "RESULTS", request: second.browse.request, response: response(["b.jpg"]) });
  assert.deepEqual(landed.browse.results.paths, ["b.jpg"]);
  assert.equal(landed.browse.pending, false);
});

test("a quiet search does not dim the wall", () => {
  assert.equal(reduce(open, { type: "SEARCH_STARTED", quiet: true }).browse.pending, false);
  assert.equal(reduce(open, { type: "SEARCH_STARTED", quiet: false }).browse.pending, true);
});

test("a selection the results dropped moves to the first result, and stays with none", () => {
  const started = reduce(open, { type: "SEARCH_STARTED", quiet: false });
  const moved = reduce(started, { type: "RESULTS", request: started.browse.request, response: response(["p/c.jpg"]) });
  assert.equal(moved.browse.selected, "p/c.jpg");
  const again = reduce(moved, { type: "SEARCH_STARTED", quiet: false });
  const none = reduce(again, { type: "RESULTS", request: again.browse.request, response: response([]) });
  assert.equal(none.browse.selected, "p/c.jpg", "the inspector never goes blank");
});

test("locate keeps a plain folder that holds the file", () => {
  const inFolder = reduce(open, { type: "FILTER", filter: { ...emptyFilter, folder: "p" } });
  const located = reduce(inFolder, { type: "LOCATE", relPath: "p/c.jpg" });
  assert.equal(located.browse.filter.folder, "p");
  assert.equal(located.browse.selected, "p/c.jpg");
  assert.equal(located.browse.reveal?.align, "center");
});

test("locate clears a search or filter that hides the file", () => {
  const hidden = run(
    [
      { type: "QUERY", query: "nothing" },
      { type: "FILTER", filter: { ...emptyFilter, minRating: 5 } },
    ],
    open,
  );
  const located = reduce(hidden, { type: "LOCATE", relPath: "p/c.jpg" });
  assert.equal(located.browse.query, "");
  assert.deepEqual(located.browse.filter, { ...emptyFilter, folder: "p" });
});

test("similar answers for a source no longer shown are dropped", () => {
  const asked = run(
    [
      { type: "SIMILAR_REQUESTED", source: "a.jpg" },
      { type: "SIMILAR_REQUESTED", source: "b.jpg" },
    ],
    open,
  );
  const late = reduce(asked, { type: "SIMILAR_RESULTS", source: "a.jpg", paths: ["p/c.jpg"] });
  assert.equal(late.browse.similar?.paths, null);
  const cleared = run([{ type: "SIMILAR_CLEARED" }, { type: "SIMILAR_RESULTS", source: "b.jpg", paths: ["a.jpg"] }], asked);
  assert.equal(cleared.browse.similar, null);
});

test("an import selects what arrived and leaves the similar view", () => {
  const similar = reduce(open, { type: "SIMILAR_REQUESTED", source: "a.jpg" });
  const imported = reduce(similar, {
    type: "RESCANNED",
    view: { root: "/v", folders: [], scope, entries: [entry("new.jpg")], indexed: 0, embedded: 0, total: 1, model: { ready: false } },
    select: "new.jpg",
  });
  assert.equal(imported.browse.selected, "new.jpg");
  assert.equal(imported.browse.similar, null);
});

test("the viewer only opens on a selection", () => {
  assert.equal(reduce(initialSession(), { type: "VIEWER", open: true }).browse.viewing, false);
  assert.equal(reduce(open, { type: "VIEWER", open: true }).browse.viewing, true);
});

test("an answer from the previous folder cannot land in the next one", () => {
  const started = reduce(open, { type: "SEARCH_STARTED", quiet: false });
  const request = started.browse.request;
  const reopened = run([{ type: "CLOSE" }, { type: "OPEN", path: "/v" }], started);
  assert.equal(reduce(reopened, { type: "RESULTS", request, response: response(["x.jpg"]) }), reopened);
});
