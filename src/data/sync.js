/* ------------------------------------------------------------------ *
 *  Sync — background backup over Supabase. Never in the write path.
 *
 *  Local IndexedDB is always the runtime source of truth. Base scenarios
 *  still sync last-write-wins (they're only written by the skill / git and
 *  by creating a custom scenario). Overlays have a second writer now — the
 *  local MCP server, i.e. Claude — so they sync by compare-and-swap with a
 *  three-way merge (see merge.js and supabase/migrations/0002_mcp_sync.sql):
 *
 *    synced[id] = { body, remoteUpdatedAt }   (persisted in the kv store)
 *      body            — the overlay body as of our last successful sync:
 *                        the merge base
 *      remoteUpdatedAt — the server's updated_at for that body: the CAS token
 *
 *    syncOverlayNow(id):
 *      1. land pending local writes, read local
 *      2. fast path — local changed, server didn't: put(local, token)
 *      3. otherwise fetch remote; target = merge(base, local, remote);
 *         put(target, remote token); on conflict loop
 *      4. if target differs from local, hand it to the UI (adopt hook),
 *         which merges it with anything typed in the meantime
 *
 *  Runs one sync at a time per scenario. Triggered by local writes
 *  (debounced), by realtime change events, on load, and when the tab regains
 *  focus. Disabled when there's no Supabase env, or when VITE_SYNC === "off"
 *  (use that on dev branches so prod overlays stay untouched).
 * ------------------------------------------------------------------ */
import {
  remoteEnabled,
  remoteListScenarios,
  remoteGetScenario,
  remoteUpsertScenario,
  remoteGetOverlay,
  remotePutOverlay,
  remoteSetView,
  OverlayConflict,
} from "./supabase.js";
import { migrateScenario, migrateOverlay, EPOCH, SCHEMA_VERSION, isoNow } from "./schema.js";
import {
  getLocalScenario,
  putLocalScenario,
  getLocalOverlay,
  putLocalOverlay,
  setOverlayWriteHook,
  flushOverlayWrites,
} from "./repo.js";
import { storage } from "./storage.js";
import { mergeOverlay, deepEqual } from "./merge.js";

const syncFlag = import.meta.env.VITE_SYNC;
export const syncEnabled = remoteEnabled && syncFlag !== "off";

const newer = (a, b) => new Date(a || 0).getTime() > new Date(b || 0).getTime();

// Compare two server timestamps exactly (to the microsecond) regardless of
// formatting: PostgREST, RPC results and realtime payloads don't all render
// timestamptz the same way.
function tsKey(s) {
  if (!s) return null;
  const str = String(s).replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00");
  const ms = Date.parse(str);
  if (Number.isNaN(ms)) return String(s);
  const frac = /\.(\d+)/.exec(str);
  return `${ms}.${frac ? (frac[1] + "000000").slice(3, 6) : "000"}`;
}
const sameTs = (a, b) => a != null && b != null && tsKey(a) === tsKey(b);

// Pull base scenario from remote and adopt iff strictly newer than local.
// (Base normally flows git -> local via seeding; this is backup recovery.)
export async function pullScenario(id) {
  if (!syncEnabled) return getLocalScenario(id);
  try {
    const [local, remote] = await Promise.all([getLocalScenario(id), remoteGetScenario(id)]);
    if (remote && (!local || newer(remote.updated_at, local.updated_at))) {
      const merged = migrateScenario(remote);
      await putLocalScenario(merged);
      return merged;
    }
    if (local && (!remote || newer(local.updated_at, remote.updated_at))) {
      remoteUpsertScenario(local).catch(() => {});
    }
    return local;
  } catch {
    return getLocalScenario(id);
  }
}

// Discover scenarios that exist remotely but not yet locally (e.g. custom
// scenarios created on another device) and pull their base content into the
// local store so they appear in the switcher and work offline thereafter.
// Returns the list of scenario_ids newly pulled. Background-only; never blocks
// first paint, so a fresh device can be fully populated without awaiting net.
export async function mergeRemoteScenarios() {
  if (!syncEnabled) return [];
  try {
    const remote = await remoteListScenarios();
    const pulled = [];
    for (const r of remote) {
      const id = r.scenario_id;
      if (!id) continue;
      if (await getLocalScenario(id)) continue; // already have it locally
      try {
        const base = remoteGetScenario ? await remoteGetScenario(id) : null;
        const merged = migrateScenario(base);
        if (merged) {
          await putLocalScenario(merged);
          pulled.push(id);
        }
      } catch {
        /* one scenario failing to pull must not abort the rest */
      }
    }
    return pulled;
  } catch {
    return [];
  }
}

/* ---- overlay sync state ------------------------------------------------ */

const syncedKey = (id) => `binder:synced:${id}`;
async function getSynced(id) {
  try {
    const r = await storage.get(syncedKey(id));
    return r ? JSON.parse(r.value) : null;
  } catch {
    return null;
  }
}
async function setSynced(id, body, remoteUpdatedAt) {
  try {
    await storage.set(syncedKey(id), JSON.stringify({ body, remoteUpdatedAt: remoteUpdatedAt ?? null }));
  } catch {
    /* best effort: without a base the next sync falls back to newest-wins */
  }
}

// UI hook: called with (id, sentLocal, target) when a sync produced a body
// that differs from the local one it started from. The UI merges `target`
// into whatever it holds now (base = sentLocal) and persists the result.
// Returns true if local edits still need pushing, false if not, or undefined
// if the UI isn't showing that scenario (then it's merged straight into IDB).
let adoptHook = null;
export function setOverlayAdoptHook(fn) {
  adoptHook = fn;
}

// Default adoption for a scenario the UI isn't showing: straight to IDB.
async function adoptOffscreen(id, sentLocal, target) {
  const cur = await getLocalOverlay(id);
  const next = mergeOverlay(sentLocal, cur.overlay, target);
  await putLocalOverlay({ scenario_id: id, schema_version: SCHEMA_VERSION, updated_at: isoNow(), overlay: next });
  return !deepEqual(next, target); // true if local edits still need pushing
}

// One sync at a time per scenario; a request made while one runs is folded
// into a single follow-up run.
const running = new Map(); // id -> Promise
const again = new Map(); // id -> { fetch }

export function syncOverlayNow(id, { fetch = false } = {}) {
  if (!syncEnabled || !id) return Promise.resolve();
  if (running.has(id)) {
    const prev = again.get(id);
    again.set(id, { fetch: fetch || (prev && prev.fetch) });
    return running.get(id);
  }
  const p = runSync(id, fetch)
    .catch(() => {})
    .finally(() => {
      running.delete(id);
      const next = again.get(id);
      if (next) {
        again.delete(id);
        syncOverlayNow(id, next);
      }
    });
  running.set(id, p);
  return p;
}

async function runSync(id, forceFetch) {
  flushOverlayWrites(); // land any debounced local edits in IDB first
  const local = await getLocalOverlay(id);
  const synced = await getSynced(id);
  const placeholder = local.updated_at === EPOCH; // nothing ever saved locally

  // Fast path: we have a base and a token, the server hasn't been reported as
  // changed, and local has edits. A conflict means the server moved: fall
  // through to the merge path.
  if (synced && synced.remoteUpdatedAt && !forceFetch && !placeholder) {
    if (deepEqual(local.overlay, synced.body)) return; // nothing to do
    try {
      const ts = await remotePutOverlay(id, local.overlay, synced.remoteUpdatedAt);
      await setSynced(id, local.overlay, ts);
      return;
    } catch (e) {
      if (!(e instanceof OverlayConflict)) throw e;
    }
  }

  let settled = false;
  for (let attempt = 0; attempt < 4 && !settled; attempt++) {
    const remote = await remoteGetOverlay(id);
    let target;
    let expected = null;

    if (!remote) {
      if (placeholder) return; // nothing anywhere
      target = local.overlay;
    } else {
      const remoteBody = migrateOverlay(remote, id).overlay;
      expected = remote.updated_at;
      if (placeholder) target = remoteBody;
      else if (synced && sameTs(remote.updated_at, synced.remoteUpdatedAt)) target = local.overlay;
      else if (synced) target = mergeOverlay(synced.body, local.overlay, remoteBody);
      // First sync on this device since the upgrade: no merge base, so keep
      // the old rule — newest blob wins.
      else target = newer(remote.updated_at, local.updated_at) ? remoteBody : local.overlay;

      if (deepEqual(target, remoteBody)) {
        await setSynced(id, remoteBody, remote.updated_at);
        settled = true;
        break;
      }
    }

    try {
      const ts = await remotePutOverlay(id, target, expected);
      await setSynced(id, target, ts);
      settled = true;
    } catch (e) {
      // Lost a race with another writer: loop to re-read and re-merge. `local`
      // stays the body this run started from; newer local edits are merged
      // in by the adopt step and pushed by a follow-up run.
      if (!(e instanceof OverlayConflict)) throw e;
    }
  }
  if (!settled) return;

  const finalBody = (await getSynced(id))?.body;
  if (!finalBody || deepEqual(finalBody, local.overlay)) return;
  // The UI hook returns undefined when it isn't showing this scenario.
  let stillDirty = adoptHook ? await adoptHook(id, local.overlay, finalBody) : undefined;
  if (stillDirty === undefined) stillDirty = await adoptOffscreen(id, local.overlay, finalBody);
  if (stillDirty) syncOverlayNow(id);
}

// Realtime: the server row changed. Skip our own writes' echoes (their
// updated_at is the token we already hold); anything else means another
// writer (Claude) moved it, so fetch and merge.
export async function onRemoteOverlayChange(id, updatedAt) {
  if (!syncEnabled) return;
  const synced = await getSynced(id);
  if (updatedAt && synced && sameTs(updatedAt, synced.remoteUpdatedAt)) return;
  syncOverlayNow(id, { fetch: true });
}

// Load-time overlay sync: reconcile with the server in the background. The
// UI receives any change through the adopt hook.
export function pullOverlay(id) {
  return syncOverlayNow(id, { fetch: true });
}

/* ---- push scheduling --------------------------------------------------- */

const pushTimers = new Map(); // id -> timer
function schedulePush(id, ms = 1500) {
  clearTimeout(pushTimers.get(id));
  pushTimers.set(
    id,
    setTimeout(() => {
      pushTimers.delete(id);
      syncOverlayNow(id);
    }, ms)
  );
}

function flushNow() {
  flushOverlayWrites(); // land pending local writes first (schedules pushes)
  for (const [id, t] of [...pushTimers]) {
    clearTimeout(t);
    pushTimers.delete(id);
    syncOverlayNow(id);
  }
}

/* ---- what the binder is showing (for the MCP server) -------------------- */

let viewState = {};
let viewTimer = null;
export function reportView(partial) {
  if (!syncEnabled) return;
  const next = { ...viewState, ...partial };
  if (deepEqual(next, viewState)) return;
  viewState = next;
  clearTimeout(viewTimer);
  viewTimer = setTimeout(() => remoteSetView(viewState).catch(() => {}), 800);
}

let installed = false;
export function initSync() {
  if (!syncEnabled || installed) return;
  installed = true;
  setOverlayWriteHook((blob) => schedulePush(blob.scenario_id));
  if (typeof window !== "undefined") {
    window.addEventListener("blur", flushNow);
    window.addEventListener("beforeunload", flushNow);
    window.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flushNow();
    });
  }
}
