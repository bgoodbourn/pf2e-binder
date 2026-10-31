/* ==================================================================== *
 *  GM notes — shared helpers
 *
 *  Small bits shared between the desktop GmNotes editor and the mobile
 *  Notes screen so a live note written on either surface has the exact
 *  same block shape and timestamp format.
 * ==================================================================== */

// "3:14 pm" — local wall-clock stamp shown on live notes.
export function gmStamp() {
  const d = new Date();
  let h = d.getHours();
  const m = d.getMinutes();
  const ap = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${ap}`;
}

// Canonical live-note block. `id` must be unique within its page.
export function makeNoteBlock(id, text) {
  return { id, type: "note", text, stamp: gmStamp() };
}

// Fixed labels + dot counts for a skill check's four outcome tiers. Only each
// tier's `text` is editable; the editor renders label/dots from here.
export const GM_CHECK_TIERS = [
  { label: "crit success", dotsOn: 4 },
  { label: "success", dotsOn: 3 },
  { label: "failure", dotsOn: 2 },
  { label: "crit failure", dotsOn: 1 },
];

export const GM_BLOCK_KINDS = ["heading", "p", "read", "check", "qa", "links", "note"];

// A blank block of the given type (the editor's "add block" menu).
export function gmNewBlock(id, type) {
  switch (type) {
    case "heading": return { id, type: "heading", text: "" };
    case "read": return { id, type: "read", text: "" };
    case "check": return { id, type: "check", skill: "", dc: "", secret: true,
      tiers: GM_CHECK_TIERS.map((t) => ({ ...t, text: "" })) };
    case "qa": return { id, type: "qa", qaTitle: "if the players ask…", rows: [{ q: "", a: "" }, { q: "", a: "" }] };
    case "links": return { id, type: "links", items: [] };
    case "note": return makeNoteBlock(id, "");
    default: return { id, type: "p", text: "" };
  }
}

const str = (v) => (v == null ? "" : String(v));

// Canonical link item: an in-binder reference ({type,name,refId}) or a url.
export function normalizeLinkItem(it) {
  if (!it || typeof it !== "object") return null;
  if (it.type === "url") {
    const url = str(it.url).trim();
    return url ? { type: "url", name: str(it.name).trim() || url, url } : null;
  }
  if (it.type === "npc" || it.type === "enc" || it.type === "page") {
    const refId = str(it.refId).trim();
    return refId ? { type: it.type, name: str(it.name), refId } : null;
  }
  return null;
}

// Build a well-formed block from a partial description (e.g. written by the
// MCP server): start from the type's blank shape, copy only the fields that
// type owns, coerce them, and drop everything else.
export function normalizeBlock(partial, id) {
  const p = partial && typeof partial === "object" ? partial : {};
  const type = GM_BLOCK_KINDS.includes(p.type) ? p.type : "p";
  const b = gmNewBlock(id, type);
  switch (type) {
    case "heading":
    case "p":
    case "read":
      b.text = str(p.text);
      break;
    case "note":
      b.text = str(p.text);
      if (p.stamp) b.stamp = str(p.stamp);
      break;
    case "check": {
      b.skill = str(p.skill);
      b.dc = str(p.dc);
      b.secret = p.secret !== false;
      const src = Array.isArray(p.tiers) ? p.tiers : [];
      b.tiers = GM_CHECK_TIERS.map((t, i) => ({ ...t, text: str(src[i] && (typeof src[i] === "string" ? src[i] : src[i].text)) }));
      break;
    }
    case "qa":
      if (p.qaTitle != null) b.qaTitle = str(p.qaTitle);
      if (Array.isArray(p.rows)) b.rows = p.rows.map((r) => ({ q: str(r && r.q), a: str(r && r.a) }));
      break;
    case "links":
      b.items = (Array.isArray(p.items) ? p.items : []).map(normalizeLinkItem).filter(Boolean);
      break;
  }
  return b;
}

// Ids for pages/blocks created outside the desktop editor. The "m-" prefix can
// never collide with the editor's own counter ids (b<n> / page<n> / fork<n>).
export function newExternalId() {
  return "m-" + Math.random().toString(36).slice(2, 10);
}

// True for ids minted by the desktop editor's counter.
export const isCounterId = (id) => /^(b|page|fork)\d+$/.test(String(id || ""));

/* -------------------------------------------------------------------- *
 *  Page hierarchy — main pages with one level of sub-pages ("forks").
 *  A sub-page is { group: "fork", parentId }. The array keeps each main
 *  page followed by its sub-pages, in rail order.
 * -------------------------------------------------------------------- */

// [{ page, subs }] in rail order, plus forks whose parent is gone.
export function gmPageTree(pages) {
  const list = pages || [];
  const tree = list.filter((p) => p.group !== "fork").map((page) => ({
    page,
    subs: list.filter((f) => f.group === "fork" && f.parentId === page.id),
  }));
  const mainIds = new Set(tree.map((t) => t.page.id));
  const orphans = list.filter((f) => f.group === "fork" && !mainIds.has(f.parentId));
  return { tree, orphans };
}

function gmLocate(tree, id) {
  for (const group of tree) {
    if (group.page.id === id) return { group, sub: null };
    const sub = group.subs.find((s) => s.id === id);
    if (sub) return { group, sub };
  }
  return null;
}

// Where a rail drop lands, as { parentId, beforeId } (parentId null = top
// level; beforeId null = end of that list), or null when the drop isn't
// allowed. `zone` is "before" | "inside" | "after" relative to the hovered
// row; `nearLeft` pulls a drop after a group's last sub-page out to the top
// level. `isCollapsed(id)` says whether a main page's sub-pages are hidden.
export function gmResolveDrop(pages, dragId, overId, zone, nearLeft, isCollapsed = () => false) {
  const { tree } = gmPageTree(pages);
  const drag = gmLocate(tree, dragId);
  const over = gmLocate(tree, overId);
  if (!drag || !over || dragId === overId) return null;
  if (!drag.sub && over.group === drag.group) return null; // onto its own sub-pages
  const hasSubs = !drag.sub && drag.group.subs.length > 0;
  const nextTop = (g) => {
    for (let k = tree.indexOf(g) + 1; k < tree.length; k++) if (tree[k].page.id !== dragId) return tree[k].page.id;
    return null;
  };
  const top = (beforeId) => ({ parentId: null, beforeId });
  const sub = (g, beforeId) => (hasSubs ? null : { parentId: g.page.id, beforeId });
  const g = over.group;
  const sibs = g.subs.filter((s) => s.id !== dragId);

  if (!over.sub) {
    if (zone === "before") return top(g.page.id);
    if (zone === "inside") return sub(g, null);
    if (g.subs.length && !isCollapsed(g.page.id)) return sub(g, sibs[0]?.id ?? null);
    return top(nextTop(g));
  }
  if (zone === "before") return sub(g, over.sub.id);
  const i = sibs.indexOf(over.sub);
  if (i < sibs.length - 1) return sub(g, sibs[i + 1].id);
  return nearLeft ? top(nextTop(g)) : sub(g, null);
}

// New pages array with `dragId` moved to `dest` (from gmResolveDrop). A main
// page carries its sub-pages with it. Returns `pages` itself if nothing moves.
export function gmMovePage(pages, dragId, dest) {
  if (!dest) return pages;
  const { tree, orphans } = gmPageTree(pages);
  const from = gmLocate(tree, dragId);
  if (!from) return pages;
  let node;
  if (from.sub) {
    from.group.subs = from.group.subs.filter((s) => s !== from.sub);
    node = { page: from.sub, subs: [] };
  } else {
    tree.splice(tree.indexOf(from.group), 1);
    node = from.group;
  }
  const insertBefore = (list, item, beforeId, idOf) => {
    const at = beforeId == null ? -1 : list.findIndex((x) => idOf(x) === beforeId);
    list.splice(at === -1 ? list.length : at, 0, item);
  };
  if (dest.parentId) {
    const target = tree.find((t) => t.page.id === dest.parentId);
    if (!target || node.subs.length) return pages; // would nest two levels deep
    const moved = { ...node.page, group: "fork", parentId: target.page.id };
    insertBefore(target.subs, moved, dest.beforeId, (s) => s.id);
  } else {
    let moved = node.page;
    if (moved.group === "fork") {
      moved = { ...moved, group: "main" };
      delete moved.parentId;
    }
    insertBefore(tree, { page: moved, subs: node.subs }, dest.beforeId, (t) => t.page.id);
  }
  return [...tree.flatMap((t) => [t.page, ...t.subs]), ...orphans];
}
