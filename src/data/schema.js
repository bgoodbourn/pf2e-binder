/* ------------------------------------------------------------------ *
 *  Schema versioning + migration-on-load
 *
 *  Every blob (base scenario and user overlay) carries a schema_version.
 *  We never run DB migrations; instead we read tolerantly and upgrade in
 *  place. One code path serves IndexedDB and Supabase (identical shapes).
 *
 *  Base scenario blob:
 *    { scenario_id, schema_version, title, meta, tabs, symFor, content,
 *      npcs, maps, encounters, links, updated_at }
 *
 *  Overlay blob (per scenario_id, all user-editable state):
 *    { scenario_id, schema_version, updated_at, overlay: {
 *        notes:       { [entityId]: text },   // per-entity GM notes
 *        customNpcs:  [npc],                   // user-added NPCs
 *        encounters:  [encounter],             // initiative tracker state
 *        pcs:         [pathbuilderRawBuild],   // imported party
 *        gmPages:     [page],                  // GM notes workspace (v2)
 *    } }
 *
 *  v2: added overlay.gmPages (GM notes workspace). migrateOverlay fills it
 *  with [] for older overlays, so no DB migration is needed.
 * ------------------------------------------------------------------ */
export const SCHEMA_VERSION = 2;

// A placeholder overlay (nothing stored yet) must NEVER win last-write-wins
// against real remote data. Stamping it with "now" made a fresh device's blank
// overlay look newer than the cloud copy, so it both refused to adopt the
// remote notes AND pushed the blank up, clobbering them. Epoch guarantees any
// genuine remote/local write is strictly newer and a placeholder is never
// pushed (see pullOverlay's "don't push a placeholder" guard).
export const EPOCH = "1970-01-01T00:00:00.000Z";

export function emptyOverlayBody() {
  return { notes: {}, customNpcs: [], encounters: [], pcs: [], gmPages: [] };
}

export function emptyOverlay(scenarioId, updatedAt = EPOCH) {
  return {
    scenario_id: scenarioId,
    schema_version: SCHEMA_VERSION,
    updated_at: updatedAt,
    overlay: emptyOverlayBody(),
  };
}

// Tolerant read of a base scenario blob: fill any missing fields with
// safe defaults, stamp the current schema_version. Add cases per future bump.
export function migrateScenario(blob) {
  if (!blob || typeof blob !== "object") return null;
  const b = { ...blob };
  b.meta = b.meta || {};
  b.tabs = Array.isArray(b.tabs) ? b.tabs : [];
  b.symFor = b.symFor || {};
  b.content = b.content || {};
  b.npcs = Array.isArray(b.npcs) ? b.npcs : [];
  b.maps = Array.isArray(b.maps) ? b.maps : [];
  b.encounters = Array.isArray(b.encounters) ? b.encounters : [];
  b.links = b.links || {};
  b.title = b.title || b.meta.title || b.scenario_id || "untitled";
  b.updated_at = b.updated_at || isoNow();
  b.schema_version = SCHEMA_VERSION;
  return b;
}

// Tolerant read of an overlay blob.
export function migrateOverlay(blob, scenarioId) {
  if (!blob || typeof blob !== "object") return emptyOverlay(scenarioId);
  const body = blob.overlay && typeof blob.overlay === "object" ? blob.overlay : {};
  return {
    scenario_id: blob.scenario_id || scenarioId,
    schema_version: SCHEMA_VERSION,
    updated_at: blob.updated_at || isoNow(),
    overlay: {
      notes: body.notes && typeof body.notes === "object" ? body.notes : {},
      customNpcs: Array.isArray(body.customNpcs) ? body.customNpcs : [],
      encounters: Array.isArray(body.encounters) ? body.encounters : [],
      pcs: Array.isArray(body.pcs) ? body.pcs : [],
      gmPages: Array.isArray(body.gmPages) ? body.gmPages : [],
    },
  };
}

export function isoNow() {
  return new Date().toISOString();
}

// Turn a title into a stable slug for use as scenario_id / JSON filename.
export function slugify(s) {
  return (
    (s || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "scenario"
  );
}

// A blank custom scenario: no notes/npcs/maps/encounters/links yet.
export function emptyScenario(title, scenarioId) {
  return {
    scenario_id: scenarioId,
    schema_version: SCHEMA_VERSION,
    title: title || "Untitled campaign",
    meta: { title: title || "Untitled campaign", sub: "Custom campaign" },
    tabs: [],
    symFor: {},
    content: {},
    npcs: [],
    maps: [],
    encounters: [],
    links: {},
    custom: true,
    updated_at: isoNow(),
  };
}
