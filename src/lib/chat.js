/* ------------------------------------------------------------------ *
 *  co-GM chat — pure helpers (no React, no network), so they're testable
 *
 *  A message is a chat_messages row:
 *    { id, scenario_id, author_id, author_name, body, created_at }
 *  plus `pending: true` while an optimistic send is in flight.
 * ------------------------------------------------------------------ */

export const MAX_BODY = 2000;
export const MAX_NAME = 40;

const ts = (iso) => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
};

// Local midnight at the start of `now`'s day. Chat only shows today.
export function startOfDay(now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Merge rows into a list by id (a later copy wins, so the server's row
// replaces an optimistic one), oldest first.
export function mergeMessages(list, rows) {
  const byId = new Map(list.map((m) => [m.id, m]));
  for (const r of rows) if (r && r.id) byId.set(r.id, r);
  return [...byId.values()].sort((a, b) => ts(a.created_at) - ts(b.created_at) || (a.id < b.id ? -1 : 1));
}

export function todaysMessages(list, now = new Date()) {
  const from = startOfDay(now).getTime();
  return list.filter((m) => ts(m.created_at) >= from);
}

// Messages from someone else, newer than lastRead (an ISO time; null = never read).
export function unreadCount(list, myId, lastRead) {
  const after = lastRead ? ts(lastRead) : -Infinity;
  return list.filter((m) => m.author_id !== myId && !m.pending && ts(m.created_at) > after).length;
}

// The newest server time in the list, for marking everything as read. Uses the
// rows' own timestamps rather than this computer's clock, so clock skew between
// the two laptops can't hide or resurrect messages.
export function latestTime(list, fallback = null) {
  let best = fallback;
  for (const m of list) if (!m.pending && (!best || ts(m.created_at) > ts(best))) best = m.created_at;
  return best;
}

// "7:42pm"
export function formatTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const h = d.getHours();
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")}${h < 12 ? "am" : "pm"}`;
}

export const cleanBody = (text) => String(text ?? "").trim().slice(0, MAX_BODY);
export const cleanName = (text) => String(text ?? "").trim().replace(/\s+/g, " ").slice(0, MAX_NAME);

// True when a keypress is going into a text field, so shortcuts stay out of the way.
export function isTyping(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!target.isContentEditable;
}
