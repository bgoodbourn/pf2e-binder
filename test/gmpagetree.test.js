import { test } from "node:test";
import assert from "node:assert/strict";
import { gmResolveDrop, gmMovePage } from "../src/lib/gmnotes-util.js";

// a (with a1, a2), b, c (with c1)
const main = (id) => ({ id, title: id, group: "main", blocks: [] });
const fork = (id, parentId) => ({ id, title: id, group: "fork", parentId, blocks: [] });
const PAGES = [main("a"), fork("a1", "a"), fork("a2", "a"), main("b"), main("c"), fork("c1", "c")];
const layout = (pages) => pages.map((p) => (p.group === "fork" ? `${p.parentId}>${p.id}` : p.id)).join(" ");
const move = (dragId, overId, zone, nearLeft = false, collapsed = []) =>
  layout(gmMovePage(PAGES, dragId, gmResolveDrop(PAGES, dragId, overId, zone, nearLeft, (id) => collapsed.includes(id))));

test("drop inside a top-level page makes it the last sub-page", () => {
  assert.equal(move("b", "c", "inside"), "a a>a1 a>a2 c c>c1 c>b");
  assert.equal(move("b", "a", "inside"), "a a>a1 a>a2 a>b c c>c1");
});

test("before/after a top-level row stays top level; parents carry their sub-pages", () => {
  assert.equal(move("c", "a", "before"), "c c>c1 a a>a1 a>a2 b");
  assert.equal(move("a", "b", "after"), "b a a>a1 a>a2 c c>c1");
});

test("after an expanded parent becomes its first sub-page; collapsed stays top level", () => {
  assert.equal(move("b", "a", "after"), "a a>b a>a1 a>a2 c c>c1");
  assert.equal(move("b", "a", "after", false, ["a"]), "a a>a1 a>a2 b c c>c1");
});

test("after a sub-page followed by another stays a sub-page", () => {
  assert.equal(move("b", "a1", "after"), "a a>a1 a>b a>a2 c c>c1");
  assert.equal(move("c1", "a1", "before"), "a a>c1 a>a1 a>a2 b c");
});

test("after the last sub-page: left edge pulls out, otherwise nests", () => {
  assert.equal(move("a1", "a2", "after", true), "a a>a2 a1 b c c>c1");
  assert.equal(move("a1", "a2", "after", false), "a a>a2 a>a1 b c c>c1");
  assert.equal(move("b", "c1", "after", false), "a a>a1 a>a2 c c>c1 c>b");
});

test("a sub-page dropped before a top-level row becomes top level", () => {
  assert.equal(move("a2", "c", "before"), "a a>a1 b a2 c c>c1");
});

test("a page with sub-pages can never be nested", () => {
  assert.equal(gmResolveDrop(PAGES, "a", "b", "inside"), null);
  assert.equal(gmResolveDrop(PAGES, "a", "c", "after"), null); // c's sub-pages are visible
  assert.equal(gmResolveDrop(PAGES, "a", "c1", "before"), null);
  assert.equal(gmResolveDrop(PAGES, "a", "c1", "after", false), null);
  assert.deepEqual(gmResolveDrop(PAGES, "a", "c1", "after", true), { parentId: null, beforeId: null });
  assert.equal(move("a", "c1", "after", true), "b c c>c1 a a>a1 a>a2");
});

test("cannot drop onto itself or its own sub-pages", () => {
  assert.equal(gmResolveDrop(PAGES, "a", "a", "before"), null);
  assert.equal(gmResolveDrop(PAGES, "a", "a1", "after"), null);
  assert.equal(gmResolveDrop(PAGES, "a1", "a1", "after"), null);
});

test("moved pages are copies with the right group; missing parentId pages load top level", () => {
  const out = gmMovePage(PAGES, "a1", { parentId: null, beforeId: "b" });
  const a1 = out.find((p) => p.id === "a1");
  assert.equal(a1.group, "main");
  assert.equal("parentId" in a1, false);
  assert.equal(PAGES[1].group, "fork"); // input untouched
  const legacy = [{ id: "x", title: "x", blocks: [] }, { id: "y", title: "y", blocks: [] }];
  assert.equal(layout(gmMovePage(legacy, "y", gmResolveDrop(legacy, "y", "x", "inside"))), "x x>y");
});
