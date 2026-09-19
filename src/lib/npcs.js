/* NPC text edits. The base scenario's NPCs are immutable, so an edited
 * description / role paragraph lives in overlay.npcEdits as a per-field
 * override and is layered on at read time. Custom NPCs are edited in place. */
export const NPC_TEXT_FIELDS = ["description", "notes"];

// Layer overlay.npcEdits onto the base NPC list. An edited NPC is flagged
// `edited` so the sheet can offer a reset. "" is a valid override (cleared).
export function applyNpcEdits(npcs, edits) {
  const list = npcs || [];
  if (!edits) return list;
  return list.map((n) => {
    const e = edits[n.id];
    if (!e) return n;
    const over = {};
    for (const k of NPC_TEXT_FIELDS) if (typeof e[k] === "string") over[k] = e[k];
    return Object.keys(over).length ? { ...n, ...over, edited: true } : n;
  });
}

// Next npcEdits map after setting one field on a base NPC. An edit that
// matches the original text drops the override instead of storing a copy.
export function setNpcEdit(edits, baseNpc, field, text) {
  const next = { ...(edits || {}) };
  const entry = { ...(next[baseNpc.id] || {}) };
  if (text === (baseNpc[field] || "")) delete entry[field];
  else entry[field] = text;
  if (Object.keys(entry).length) next[baseNpc.id] = entry;
  else delete next[baseNpc.id];
  return next;
}
