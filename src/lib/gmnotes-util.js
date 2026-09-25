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
