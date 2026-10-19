import assert from "node:assert/strict";
import test from "node:test";
import { emptyFilter } from "../../lib/types.ts";
import { classify, type SearchInputs } from "./search-intent.ts";

const inputs = (parts: Partial<SearchInputs> = {}): SearchInputs => ({
  root: "/vault",
  query: "",
  filter: emptyFilter,
  sort: "name",
  ranking: "keyword",
  semantic: false,
  modelEpoch: 0,
  revision: 0,
  ...parts,
});

test("the first search of a folder is quiet", () => {
  assert.equal(classify(null, inputs()), "quiet");
});

test("opening a different folder is quiet even when an input changed", () => {
  assert.equal(classify(inputs({ root: "/a" }), inputs({ root: "/b", query: "cat" })), "quiet");
});

test("a changed model, setting, or revision is quiet", () => {
  assert.equal(classify(inputs(), inputs({ semantic: true })), "quiet");
  assert.equal(classify(inputs(), inputs({ modelEpoch: 1 })), "quiet");
  assert.equal(classify(inputs(), inputs({ revision: 1 })), "quiet");
});

test("typing a query is typed", () => {
  assert.equal(classify(inputs(), inputs({ query: "cat" })), "typed");
});

test("changing the sort or the ranking is typed", () => {
  assert.equal(classify(inputs(), inputs({ sort: "size" })), "typed");
  assert.equal(classify(inputs(), inputs({ ranking: "semantic" })), "typed");
});

test("narrowing a filter is typed", () => {
  assert.equal(classify(inputs(), inputs({ filter: { ...emptyFilter, minRating: 3 } })), "typed");
});

test("a new filter object with the same content is typed, as a reset is a request", () => {
  assert.equal(classify(inputs(), inputs({ filter: { ...emptyFilter } })), "typed");
});

test("picking a folder alone is navigated", () => {
  assert.equal(classify(inputs(), inputs({ filter: { ...emptyFilter, folder: "a" } })), "navigated");
});

test("picking a folder with the other filters unchanged is navigated", () => {
  const before = inputs({ filter: { ...emptyFilter, folder: "a", tag: "red" } });
  const after = inputs({ filter: { ...emptyFilter, folder: "b", tag: "red" } });
  assert.equal(classify(before, after), "navigated");
});

test("a folder change together with a query change is typed", () => {
  const after = inputs({ query: "cat", filter: { ...emptyFilter, folder: "a" } });
  assert.equal(classify(inputs(), after), "typed");
});

test("a folder change together with a sort change is typed", () => {
  const after = inputs({ sort: "size", filter: { ...emptyFilter, folder: "a" } });
  assert.equal(classify(inputs(), after), "typed");
});

test("a folder change together with another filter change is typed", () => {
  const after = inputs({ filter: { ...emptyFilter, folder: "a", minRating: 3 } });
  assert.equal(classify(inputs(), after), "typed");
});
