import assert from "node:assert/strict";
import test from "node:test";
import { initialSession, reduce, type Session } from "../../app/session.ts";
import { emptyFilter, type Entry, type SearchResponse } from "../../lib/types.ts";
import type { SessionEvent } from "../vault/events.ts";
import { extraCopies } from "./browse.ts";

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
  assert.deepEqual(late.browse.lens, { kind: "similar", source: "b.jpg", paths: null });
  const cleared = run([{ type: "LENS_CLEARED" }, { type: "SIMILAR_RESULTS", source: "b.jpg", paths: ["a.jpg"] }], asked);
  assert.equal(cleared.browse.lens, null);
});

test("an import selects what arrived and leaves the similar view", () => {
  const similar = reduce(open, { type: "SIMILAR_REQUESTED", source: "a.jpg" });
  const imported = reduce(similar, {
    type: "RESCANNED",
    view: { root: "/v", folders: [], scope, entries: [entry("new.jpg")], indexed: 0, embedded: 0, total: 1, model: { ready: false } },
    select: "new.jpg",
  });
  assert.equal(imported.browse.selected, "new.jpg");
  assert.equal(imported.browse.lens, null);
});

test("the viewer only opens on a selection", () => {
  assert.equal(reduce(initialSession(), { type: "VIEWER", open: true }).browse.viewing, false);
  assert.equal(reduce(open, { type: "VIEWER", open: true }).browse.viewing, true);
});

test("a deleted file leaves the wall and the next tile takes the selection", () => {
  const selected = reduce(open, { type: "SELECT", relPath: "b.jpg" });
  const removed = reduce(selected, { type: "ENTRIES_REMOVED", relPaths: ["b.jpg"] });
  assert.deepEqual(removed.browse.results.paths, ["a.jpg", "p/c.jpg"]);
  assert.equal(removed.browse.selected, "p/c.jpg");
});

test("deleting the last tile selects the one before it", () => {
  const selected = reduce(open, { type: "SELECT", relPath: "p/c.jpg" });
  const removed = reduce(selected, { type: "ENTRIES_REMOVED", relPaths: ["p/c.jpg"] });
  assert.equal(removed.browse.selected, "b.jpg");
});

test("deleting a file the similar view lists takes it out of that view too", () => {
  const similar = run(
    [{ type: "SIMILAR_REQUESTED", source: "a.jpg" }, { type: "SIMILAR_RESULTS", source: "a.jpg", paths: ["b.jpg", "p/c.jpg"] }],
    open,
  );
  const removed = reduce(reduce(similar, { type: "SELECT", relPath: "b.jpg" }), { type: "ENTRIES_REMOVED", relPaths: ["b.jpg"] });
  assert.deepEqual(removed.browse.lens, { kind: "similar", source: "a.jpg", paths: ["p/c.jpg"] });
  assert.deepEqual(removed.browse.results.paths, ["a.jpg", "p/c.jpg"], "the search behind it forgets the file too");
  assert.equal(removed.browse.selected, "p/c.jpg");
});

test("the viewer closes on the file it was showing", () => {
  const viewing = reduce(open, { type: "VIEWER", open: true });
  assert.equal(reduce(viewing, { type: "ENTRIES_REMOVED", relPaths: ["b.jpg"] }).browse.viewing, true, "another file is open");
  assert.equal(reduce(viewing, { type: "ENTRIES_REMOVED", relPaths: ["a.jpg"] }).browse.viewing, false);
});

test("an answer from the previous folder cannot land in the next one", () => {
  const started = reduce(open, { type: "SEARCH_STARTED", quiet: false });
  const request = started.browse.request;
  const reopened = run([{ type: "CLOSE" }, { type: "OPEN", path: "/v" }], started);
  assert.equal(reduce(reopened, { type: "RESULTS", request, response: response(["x.jpg"]) }), reopened);
});

test("a rescan of the previous folder cannot land in the next one", () => {
  const other = { root: "/elsewhere", folders: [], scope, entries: [entry("z.jpg")], indexed: 1, embedded: 1, total: 1, model: { ready: false } };
  assert.equal(reduce(open, { type: "RESCANNED", view: other, select: "z.jpg" }), open);
  assert.equal(reduce(open, { type: "SCOPED", view: other }), open);
});

const picks = (session: Session) => [session.browse.selected, session.browse.picked];

test("⌘-click adds to the picked set and takes out again, never down to nothing", () => {
  const two = reduce(open, { type: "PICK_TOGGLE", relPath: "p/c.jpg" });
  assert.deepEqual(picks(two), ["p/c.jpg", ["a.jpg", "p/c.jpg"]], "the clicked file takes the focus");
  const one = reduce(two, { type: "PICK_TOGGLE", relPath: "p/c.jpg" });
  assert.deepEqual(picks(one), ["a.jpg", []], "back to one file, which is a plain selection");
  assert.equal(reduce(one, { type: "PICK_TOGGLE", relPath: "a.jpg" }), one, "the last file stays");
});

test("a plain click starts over from a picked set", () => {
  const all = reduce(open, { type: "PICK", relPaths: ["a.jpg", "b.jpg"] });
  assert.deepEqual(picks(reduce(all, { type: "SELECT", relPath: "p/c.jpg" })), ["p/c.jpg", []]);
});

test("deleting picked files moves the focus past the whole run", () => {
  const all = reduce(open, { type: "PICK", relPaths: ["a.jpg", "b.jpg"] });
  const removed = reduce(all, { type: "ENTRIES_REMOVED", relPaths: ["a.jpg", "b.jpg"] });
  assert.deepEqual(picks(removed), ["p/c.jpg", []]);
  assert.deepEqual(removed.browse.results.paths, ["p/c.jpg"]);
});

test("a search that drops picked files keeps the rest picked", () => {
  const all = reduce(open, { type: "PICK", relPaths: ["a.jpg", "b.jpg", "p/c.jpg"] });
  const started = reduce(all, { type: "SEARCH_STARTED", quiet: false });
  const landed = reduce(started, { type: "RESULTS", request: started.browse.request, response: response(["b.jpg", "p/c.jpg"]) });
  assert.deepEqual(picks(landed), ["b.jpg", ["b.jpg", "p/c.jpg"]]);
});

test("moved files keep their place in the selection under the new path", () => {
  const all = reduce(open, { type: "PICK", relPaths: ["a.jpg", "b.jpg"] });
  const moved = reduce(all, { type: "ENTRIES_MOVED", moved: [{ from: "a.jpg", to: "p/a.jpg" }] });
  assert.deepEqual(picks(moved), ["p/a.jpg", ["p/a.jpg", "b.jpg"]]);
  assert.deepEqual(moved.browse.results.paths, ["p/a.jpg", "b.jpg", "p/c.jpg"]);
});

test("the duplicates view lists copies by group, and a group with one copy left goes", () => {
  const groups = [
    { paths: ["a.jpg", "b.jpg"], exact: true },
    { paths: ["p/c.jpg", "p/d.jpg", "p/e.jpg"], exact: false },
  ];
  const shown = run([{ type: "DUPLICATES_REQUESTED" }, { type: "DUPLICATES_RESULTS", groups }], reduce(open, { type: "SELECT", relPath: "x.jpg" }));
  assert.equal(shown.browse.selected, "a.jpg", "the focus moves onto the wall, to the first file to keep");
  assert.deepEqual(extraCopies(groups), ["b.jpg", "p/d.jpg", "p/e.jpg"]);
  const extras = reduce(shown, { type: "PICK", relPaths: extraCopies(groups) });
  const removed = reduce(extras, { type: "ENTRIES_REMOVED", relPaths: ["b.jpg", "p/d.jpg"] });
  assert.deepEqual(removed.browse.lens, { kind: "duplicates", groups: [{ paths: ["p/c.jpg", "p/e.jpg"], exact: false }] });
  assert.deepEqual(picks(removed), ["p/c.jpg", []], "one picked file is no set; the focus lands after the removed run");
});
