import { test } from "node:test";
import assert from "node:assert/strict";
import {
  startOfDay, mergeMessages, todaysMessages, unreadCount, latestTime,
  formatTime, cleanBody, cleanName, isTyping, MAX_BODY, MAX_NAME,
} from "../src/lib/chat.js";

const at = (h, m = 0, day = 9) => new Date(2026, 10, day, h, m).toISOString();
const msg = (id, author, created_at, extra = {}) => ({ id, author_id: author, author_name: author, body: id, created_at, ...extra });

test("startOfDay is local midnight", () => {
  const d = startOfDay(new Date(2026, 10, 9, 21, 15));
  assert.equal(d.getHours(), 0);
  assert.equal(d.getMinutes(), 0);
  assert.equal(d.getDate(), 9);
});

test("mergeMessages dedupes by id, later copy wins, sorted oldest first", () => {
  const pending = msg("b", "me", at(19, 5), { pending: true });
  const list = mergeMessages([msg("a", "alex", at(19, 0)), pending], []);
  const saved = msg("b", "me", at(19, 6));
  const out = mergeMessages(list, [saved, msg("c", "alex", at(18, 0))]);
  assert.deepEqual(out.map((m) => m.id), ["c", "a", "b"]);
  assert.equal(out.find((m) => m.id === "b").pending, undefined);
});

test("mergeMessages ignores rows without an id", () => {
  assert.equal(mergeMessages([], [null, { body: "x" }]).length, 0);
});

test("todaysMessages drops anything before local midnight", () => {
  const now = new Date(2026, 10, 9, 20, 0);
  const list = [msg("old", "alex", at(23, 50, 8)), msg("new", "alex", at(0, 5, 9))];
  assert.deepEqual(todaysMessages(list, now).map((m) => m.id), ["new"]);
});

test("unreadCount counts only other people's sent messages after lastRead", () => {
  const list = [
    msg("a", "alex", at(19, 0)),
    msg("b", "me", at(19, 1)),
    msg("c", "alex", at(19, 2)),
    msg("d", "alex", at(19, 3), { pending: true }),
  ];
  assert.equal(unreadCount(list, "me", null), 2);
  assert.equal(unreadCount(list, "me", at(19, 0)), 1);
  assert.equal(unreadCount(list, "me", at(19, 2)), 0);
});

test("latestTime uses the newest stored message, skipping pending ones", () => {
  const list = [msg("a", "alex", at(19, 0)), msg("b", "me", at(19, 9), { pending: true })];
  assert.equal(latestTime(list), at(19, 0));
  assert.equal(latestTime([], "fallback"), "fallback");
});

test("formatTime reads like 7:42pm", () => {
  assert.equal(formatTime(at(19, 42)), "7:42pm");
  assert.equal(formatTime(at(0, 5)), "12:05am");
  assert.equal(formatTime(at(12, 0)), "12:00pm");
  assert.equal(formatTime("nonsense"), "");
});

test("cleanBody and cleanName trim and cap length", () => {
  assert.equal(cleanBody("  hi  "), "hi");
  assert.equal(cleanBody("x".repeat(MAX_BODY + 5)).length, MAX_BODY);
  assert.equal(cleanName("  Will   G  "), "Will G");
  assert.equal(cleanName("y".repeat(99)).length, MAX_NAME);
});

test("isTyping spots text fields and editable blocks", () => {
  assert.equal(isTyping({ tagName: "INPUT" }), true);
  assert.equal(isTyping({ tagName: "TEXTAREA" }), true);
  assert.equal(isTyping({ tagName: "DIV", isContentEditable: true }), true);
  assert.equal(isTyping({ tagName: "BUTTON" }), false);
  assert.equal(isTyping(null), false);
});
