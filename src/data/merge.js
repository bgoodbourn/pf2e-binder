/* ------------------------------------------------------------------ *
 *  Three-way overlay merge
 *
 *  The overlay is one JSON blob per scenario. Two writers now touch it: this
 *  app (whole-blob pushes) and the MCP server (Claude, patching one key at a
 *  time). When both have changed it since the last sync we merge instead of
 *  letting the later push clobber the other:
 *
 *    base   — the overlay as of our last successful pull/push
 *    local  — what this device has now
 *    remote — what the server has now
 *
 *  Rules, applied recursively:
 *    • a value only one side changed takes that side's value;
 *    • arrays of {id} objects (gmPages, page blocks, customNpcs, encounters,
 *      combatants…) merge item-by-item by id, keeping adds from both sides
 *      and honouring a delete only when the other side left the item alone;
 *    • plain objects (notes, npcEdits, an NPC…) merge key-by-key;
 *    • a genuine conflict on the same scalar goes to remote (the newer server
 *      write, which the server has snapshotted for undo).
 *
 *  Pure and dependency-free so both the app and the tests can import it.
 * ------------------------------------------------------------------ */

// Structural equality. Key order is ignored on purpose: Postgres jsonb
// re-orders object keys, so the same object round-trips with a new order.
export function deepEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a == b; // null and undefined are the same "absent"
  if (typeof a !== typeof b || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  const ka = Object.keys(a).filter((k) => a[k] !== undefined);
  const kb = Object.keys(b).filter((k) => b[k] !== undefined);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!deepEqual(a[k], b[k])) return false;
  return true;
}

const isPlainObject = (x) => x != null && typeof x === "object" && !Array.isArray(x);
const isIdArray = (x) =>
  Array.isArray(x) && x.every((o) => isPlainObject(o) && o.id != null);

export function merge3(base, local, remote) {
  if (deepEqual(local, remote)) return local;
  if (deepEqual(base, local)) return remote;
  if (deepEqual(base, remote)) return local;
  if (isIdArray(local) && isIdArray(remote)) {
    return mergeById(isIdArray(base) ? base : [], local, remote);
  }
  if (isPlainObject(local) && isPlainObject(remote)) {
    return mergeObject(isPlainObject(base) ? base : {}, local, remote);
  }
  return remote;
}

function mergeObject(base, local, remote) {
  const out = {};
  const keys = new Set([...Object.keys(local), ...Object.keys(remote)]);
  for (const k of keys) {
    const inL = local[k] !== undefined;
    const inR = remote[k] !== undefined;
    const inB = base[k] !== undefined;
    if (inL && inR) out[k] = merge3(base[k], local[k], remote[k]);
    else if (inL) {
      // remote removed it: honour that only if local didn't touch it
      if (!(inB && deepEqual(base[k], local[k]))) out[k] = local[k];
    } else if (inR) {
      if (!(inB && deepEqual(base[k], remote[k]))) out[k] = remote[k];
    }
  }
  return out;
}

const ids = (list) => list.map((o) => String(o.id));

function mergeById(base, local, remote) {
  const B = new Map(base.map((o) => [String(o.id), o]));
  const L = new Map(local.map((o) => [String(o.id), o]));
  const R = new Map(remote.map((o) => [String(o.id), o]));

  // Decide each item's fate.
  const kept = new Map();
  for (const id of new Set([...L.keys(), ...R.keys()])) {
    const b = B.get(id), l = L.get(id), r = R.get(id);
    if (l && r) kept.set(id, merge3(b, l, r));
    else if (l) {
      if (!(b && deepEqual(b, l))) kept.set(id, l); // remote deleted an untouched item → drop
    } else if (r) {
      if (!(b && deepEqual(b, r))) kept.set(id, r);
    }
  }

  // Order: follow whichever side reordered; if neither (or both) did, remote.
  // A side "reordered" if the items it shares with base appear in a different
  // relative order (adds and deletes alone don't count).
  const reordered = (list) => {
    const inList = new Set(ids(list));
    const was = ids(base).filter((i) => inList.has(i));
    const now = ids(list).filter((i) => B.has(i));
    return was.join("\u0000") !== now.join("\u0000");
  };
  const localReordered = reordered(local);
  const remoteReordered = reordered(remote);
  const [primary, secondary] = localReordered && !remoteReordered ? [local, remote] : [remote, local];

  const order = ids(primary).filter((id) => kept.has(id));
  // Slot the secondary side's extra items in: at the end if nothing follows
  // them on their side (an append stays an append), else after their nearest
  // predecessor.
  const sec = ids(secondary);
  sec.forEach((id, i) => {
    if (!kept.has(id) || order.includes(id)) return;
    if (!sec.slice(i + 1).some((s) => order.includes(s))) { order.push(id); return; }
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const k = order.indexOf(sec[j]);
      if (k !== -1) { at = k + 1; break; }
    }
    order.splice(at, 0, id);
  });
  return order.map((id) => kept.get(id));
}

// Merge two overlay bodies against their common base. `base` may be null
// (never synced): then both sides' additions are unioned and conflicts go to
// remote.
export function mergeOverlay(base, local, remote) {
  return mergeObject(isPlainObject(base) ? base : {}, local || {}, remote || {});
}
