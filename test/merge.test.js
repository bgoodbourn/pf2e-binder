import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeOverlay, deepEqual } from "../src/data/merge.js";

const page = (id, blocks, extra = {}) => ({ id, title: id, group: "main", blocks, ...extra });
const p = (id, text) => ({ id, type: "p", text });

test("deepEqual ignores key order (jsonb round-trips reorder keys)", () => {
  assert.ok(deepEqual({ a: 1, b: [1, { x: 1, y: 2 }] }, { b: [1, { y: 2, x: 1 }], a: 1 }));
  assert.ok(!deepEqual({ a: 1 }, { a: 2 }));
  assert.ok(deepEqual({ a: 1, b: undefined }, { a: 1 }));
});

test("disjoint keys: each side's change survives", () => {
  const base = { notes: {}, gmPages: [] };
  const local = { notes: { npc1: "local note" }, gmPages: [] };
  const remote = { notes: {}, gmPages: [page("m-1", [])] };
  assert.deepEqual(mergeOverlay(base, local, remote), {
    notes: { npc1: "local note" },
    gmPages: [page("m-1", [])],
  });
});

test("same page, different blocks: local typing and remote append both kept", () => {
  const base = { gmPages: [page("page1", [p("b1", "hello")])] };
  const local = { gmPages: [page("page1", [p("b1", "hello world")])] };
  const remote = { gmPages: [page("page1", [p("b1", "hello"), p("m-2", "from claude")])] };
  const out = mergeOverlay(base, local, remote);
  assert.deepEqual(out.gmPages[0].blocks, [p("b1", "hello world"), p("m-2", "from claude")]);
});

test("remote block inserted mid-page keeps its position", () => {
  const base = { gmPages: [page("page1", [p("b1", "a"), p("b2", "b")])] };
  const local = { gmPages: [page("page1", [p("b1", "a"), p("b2", "b"), p("b3", "c")])] };
  const remote = { gmPages: [page("page1", [p("b1", "a"), p("m-x", "x"), p("b2", "b")])] };
  const out = mergeOverlay(base, local, remote);
  assert.deepEqual(out.gmPages[0].blocks.map((b) => b.id), ["b1", "m-x", "b2", "b3"]);
});

test("same block conflict goes to remote", () => {
  const base = { gmPages: [page("page1", [p("b1", "orig")])] };
  const local = { gmPages: [page("page1", [p("b1", "mine")])] };
  const remote = { gmPages: [page("page1", [p("b1", "claude")])] };
  assert.equal(mergeOverlay(base, local, remote).gmPages[0].blocks[0].text, "claude");
});

test("deletes: honoured when untouched, edits win over deletes", () => {
  const base = { customNpcs: [{ id: "c1", name: "A" }, { id: "c2", name: "B" }] };
  // remote deleted c1 (local untouched) and c2 (local edited)
  const local = { customNpcs: [{ id: "c1", name: "A" }, { id: "c2", name: "B2" }] };
  const remote = { customNpcs: [] };
  assert.deepEqual(mergeOverlay(base, local, remote).customNpcs, [{ id: "c2", name: "B2" }]);
});

test("local page delete is honoured when remote didn't touch the page", () => {
  const base = { gmPages: [page("page1", []), page("page2", [])] };
  const local = { gmPages: [page("page1", [])] };
  const remote = { gmPages: [page("page1", [p("m-1", "new")]), page("page2", [])] };
  assert.deepEqual(mergeOverlay(base, local, remote).gmPages, [page("page1", [p("m-1", "new")])]);
});

test("local reorder is kept while remote adds a page", () => {
  const base = { gmPages: [page("a", []), page("b", [])] };
  const local = { gmPages: [page("b", []), page("a", [])] };
  const remote = { gmPages: [page("a", []), page("b", []), page("m-c", [])] };
  assert.deepEqual(mergeOverlay(base, local, remote).gmPages.map((x) => x.id), ["b", "a", "m-c"]);
});

test("encounter HP edit locally + remote combatant add", () => {
  const c = (id, hp) => ({ id, name: id, hp });
  const enc = (combatants) => ({ id: "e1", name: "A1", combatants });
  const base = { encounters: [enc([c("x", 10)])] };
  const local = { encounters: [enc([c("x", 4)])] };
  const remote = { encounters: [enc([c("x", 10), c("m-y", 20)])] };
  assert.deepEqual(mergeOverlay(base, local, remote).encounters[0].combatants, [c("x", 4), c("m-y", 20)]);
});

test("null base unions both sides", () => {
  const out = mergeOverlay(null, { notes: { a: "1" } }, { notes: { b: "2" } });
  assert.deepEqual(out.notes, { a: "1", b: "2" });
});
