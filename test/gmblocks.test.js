import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeBlock, isCounterId, newExternalId } from "../src/lib/gmnotes-util.js";

test("check block gets fixed tiers and string dc", () => {
  const b = normalizeBlock({ type: "check", skill: "Diplomacy", dc: 15, tiers: ["great", { text: "ok" }], junk: 1 }, "m-1");
  assert.equal(b.dc, "15");
  assert.equal(b.secret, true);
  assert.deepEqual(b.tiers.map((t) => [t.label, t.dotsOn, t.text]), [
    ["crit success", 4, "great"], ["success", 3, "ok"], ["failure", 2, ""], ["crit failure", 1, ""],
  ]);
  assert.equal(b.junk, undefined);
});

test("unknown type falls back to paragraph; links are cleaned", () => {
  assert.equal(normalizeBlock({ type: "weird", text: "x" }, "m").type, "p");
  const l = normalizeBlock({ type: "links", items: [{ type: "npc", refId: "albin", name: "Albin" }, { type: "npc" }, { type: "url", url: "https://x" }] }, "m");
  assert.deepEqual(l.items, [{ type: "npc", name: "Albin", refId: "albin" }, { type: "url", name: "https://x", url: "https://x" }]);
});

test("note blocks carry a stamp", () => {
  assert.match(normalizeBlock({ type: "note", text: "hi" }, "m").stamp, /\d:\d\d (am|pm)/);
});

test("external ids never look like editor counter ids", () => {
  for (let i = 0; i < 200; i++) assert.ok(!isCounterId(newExternalId()));
  assert.ok(isCounterId("b12") && isCounterId("page3") && !isCounterId("m-b12"));
});
