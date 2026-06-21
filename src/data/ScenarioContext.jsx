/* ------------------------------------------------------------------ *
 *  ScenarioContext — the bridge between the data layer and the UI.
 *
 *  On mount it: installs the IndexedDB-backed storage, migrates any legacy
 *  localStorage data, seeds bundled scenarios (git -> IDB), starts sync,
 *  then loads the active scenario's base content + user overlay.
 *
 *  Exposes the active base scenario (immutable) and the overlay body with a
 *  single `patch()` writer. Switching scenarios re-keys the overlay.
 * ------------------------------------------------------------------ */
import { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from "react";
import { installStorage, migrateLegacyLocalStorage, storage } from "./storage.js";
import {
  seedBundledScenarios,
  listLocalScenarios,
  getLocalScenario,
  getLocalOverlay,
  putLocalScenario,
  putLocalOverlay,
  saveOverlayDebounced,
} from "./repo.js";
import { initSync, pullScenario, pullOverlay, syncEnabled } from "./sync.js";
import { remoteUpsertScenario } from "./supabase.js";
import { emptyOverlayBody, emptyScenario, slugify, SCHEMA_VERSION, isoNow } from "./schema.js";

const WIKI = "https://pathfinderwiki.com/wiki/";
const ACTIVE_PREF = "binder:active-scenario:v1";

// Legacy (pre-data-layer) global keys, imported once into the default overlay.
const LEGACY = { pcs: "binder:pcs:v1", npcs: "binder:npcs:v1", cnotes: "binder:cnotes:v1", encounters: "binder:encounters:v1" };
const LEGACY_DONE = "binder:legacy-overlay-imported:v1";

const Ctx = createContext(null);
// eslint-disable-next-line react-refresh/only-export-components -- hook colocated with its provider
export const useScenarioData = () => useContext(Ctx);

function buildLinkMaps(links) {
  const lookup = {};
  Object.keys(links || {}).forEach((k) => (lookup[k.toLowerCase()] = links[k]));
  const re = Object.keys(links || {}).length
    ? new RegExp(
        "\\b(" +
          Object.keys(links)
            .sort((a, b) => b.length - a.length)
            .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
            .join("|") +
          ")\\b",
        "gi"
      )
    : null;
  return { lookup, re, wiki: WIKI };
}

// Once: fold any pre-existing global localStorage edits into the default
// scenario's overlay so returning users keep their work.
async function importLegacyOverlay(scenarioId) {
  try {
    if (await storage.get(LEGACY_DONE)) return null;
    const read = async (k) => {
      const r = await storage.get(k);
      if (!r) return null;
      try { return JSON.parse(r.value); } catch { return null; }
    };
    const [pcs, npcs, cnotes, encounters] = await Promise.all([
      read(LEGACY.pcs), read(LEGACY.npcs), read(LEGACY.cnotes), read(LEGACY.encounters),
    ]);
    await storage.set(LEGACY_DONE, "1");
    if (!pcs && !npcs && !cnotes && !encounters) return null;
    const body = {
      notes: cnotes && typeof cnotes === "object" ? cnotes : {},
      customNpcs: Array.isArray(npcs) ? npcs : [],
      encounters: Array.isArray(encounters) ? encounters : [],
      pcs: Array.isArray(pcs) ? pcs : [],
    };
    const blob = { scenario_id: scenarioId, schema_version: SCHEMA_VERSION, updated_at: isoNow(), overlay: body };
    await putLocalOverlay(blob);
    return body;
  } catch {
    return null;
  }
}

export function ScenarioProvider({ children }) {
  const [ready, setReady] = useState(false);
  const [scenarios, setScenarios] = useState([]);
  const [activeId, setActiveIdState] = useState(null);
  const [scenario, setScenario] = useState(null);
  const [overlay, setOverlay] = useState(emptyOverlayBody);
  const initialized = useRef(false);
  const activeIdRef = useRef(null); // guards background pulls against scenario switches

  // Background pull: refresh from Supabase without blocking the UI, adopting
  // remote data only if it's newer (pullScenario/pullOverlay handle the merge).
  // Guarded so a stale pull can't overwrite a scenario the user switched away from.
  const bgPull = useCallback((id) => {
    if (!syncEnabled) return;
    pullScenario(id)
      .then((base) => { if (base && activeIdRef.current === id) setScenario(base); })
      .catch(() => {});
    pullOverlay(id)
      .then((ov) => { if (ov && activeIdRef.current === id) setOverlay(ov.overlay); })
      .catch(() => {});
  }, []);

  // First-run bootstrap — local-first: never await the network before ready.
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    (async () => {
      installStorage();
      await migrateLegacyLocalStorage();
      await seedBundledScenarios();
      const list = await listLocalScenarios();
      setScenarios(list);

      const pref = await storage.get(ACTIVE_PREF);
      const id = (pref && list.some((s) => s.scenario_id === pref.value) && pref.value) || (list[0] && list[0].scenario_id) || null;

      if (id) {
        await importLegacyOverlay(id);
        const [base, ov] = await Promise.all([getLocalScenario(id), getLocalOverlay(id)]);
        setScenario(base);
        setOverlay(ov.overlay);
        activeIdRef.current = id;
        setActiveIdState(id);
      }
      setReady(true);

      // Now that the UI is live, start sync and pull in the background.
      initSync();
      if (id) bgPull(id);
    })();
  }, [bgPull]);

  // Load a scenario + its overlay when the active id changes (local first).
  const loadActive = useCallback(
    async (id) => {
      const [base, ov] = await Promise.all([getLocalScenario(id), getLocalOverlay(id)]);
      setScenario(base);
      setOverlay(ov.overlay);
      bgPull(id);
    },
    [bgPull]
  );

  const setActiveId = useCallback(
    (id) => {
      if (id === activeId) return;
      storage.set(ACTIVE_PREF, id);
      activeIdRef.current = id;
      setActiveIdState(id);
      loadActive(id);
    },
    [activeId, loadActive]
  );

  // Shallow-merge a partial overlay body: update UI now, debounce the write.
  const patch = useCallback(
    (partial) => {
      if (!activeId) return;
      setOverlay((prev) => {
        const next = { ...prev, ...partial };
        saveOverlayDebounced(activeId, next);
        return next;
      });
    },
    [activeId]
  );

  // Create a blank custom scenario, persist it, and make it active.
  const createScenario = useCallback(async (title) => {
    const list = await listLocalScenarios();
    const taken = new Set(list.map((s) => s.scenario_id));
    let id = slugify(title);
    if (taken.has(id)) {
      let n = 2;
      while (taken.has(`${id}-${n}`)) n++;
      id = `${id}-${n}`;
    }
    const base = emptyScenario(title, id);
    await putLocalScenario(base);
    setScenarios(await listLocalScenarios());
    await storage.set(ACTIVE_PREF, id);
    activeIdRef.current = id;
    setScenario(base);
    setOverlay(emptyOverlayBody());
    setActiveIdState(id);
    if (syncEnabled) remoteUpsertScenario(base).catch(() => {});
    return id;
  }, []);

  const links = useMemo(() => buildLinkMaps(scenario?.links), [scenario]);

  const value = useMemo(
    () => ({ ready, scenarios, activeId, setActiveId, createScenario, scenario, overlay, patch, links }),
    [ready, scenarios, activeId, setActiveId, createScenario, scenario, overlay, patch, links]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
