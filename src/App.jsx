import { useState, useMemo, useCallback, useEffect } from "react";
import { useScenarioData } from "./data/ScenarioContext.jsx";
import { parseBuild, uid } from "./lib/pf2e.js";
import { loadAonIndex } from "./lib/aon.js";
import { seedEncounterMaps, stripSeededMaps, buildScenarioEncounters, orderCombatants } from "./lib/combatants.js";
import { Sym, ScenSym } from "./components/icons.jsx";
import { Sheet, Importer, NotesBox, NewScenario } from "./components/party.jsx";
import { AddNpc, NpcSheet } from "./components/npcs.jsx";
import { applyNpcEdits, setNpcEdit } from "./lib/npcs.js";
import { ScenarioView } from "./components/scenario.jsx";
import { EncountersView } from "./components/encounters.jsx";
import { EncNavProvider, EncounterRail } from "./components/encrail.jsx";
import { GmNotes } from "./components/gmnotes.jsx";
import { HelpTab } from "./components/helptab.jsx";
import { HELP_INDEX, HELP_TABS } from "./data/help-index.js";

/* ------------------------------------------------------------------ *
 *  Persistence
 *
 *  Scenario base content + the user overlay are loaded and saved through
 *  the data layer (IndexedDB runtime store + Supabase background sync),
 *  surfaced to the UI via ScenarioContext. The data layer installs an
 *  IndexedDB-backed window.storage on boot.
 * ------------------------------------------------------------------ */

/* ==================================================================== *
 *  Campaign Binder — Pathfinder Society
 *
 *  One artifact, two linked workspaces:
 *    • party     — PC manager (ingests Pathbuilder 2e JSON)
 *    • scenario  — GM scenario notes ("The Second Confirmation")
 *
 *  Cross-artifact links aren't possible in the sandbox (each artifact
 *  is an isolated iframe), so both tools live here and the "links"
 *  between them are real in-app navigation via the workspace switch.
 *
 *  Pathbuilder ingest:
 *    Export Character → Export to Foundry VTT (JSON) gives a 6-digit id,
 *    served at https://pathbuilder2e.com/json.php?id=XXXXXX (JSON).
 *    That endpoint has no CORS headers, so in-browser auto-fetch is
 *    best-effort via a proxy and ALWAYS falls back to pasting the JSON.
 *
 *  Persistence: the data layer (see src/data) stores raw Pathbuilder builds
 *    in the per-scenario overlay and re-parses on load, so future parser
 *    changes never orphan saved characters. Legacy localStorage keys are
 *    migrated once into the overlay on first run.
 * ==================================================================== */

/* ================================================================== *
 *  PARTY WORKSPACE — PC manager
 * ================================================================== */

const SHEET_NAV = [
  { id: "overview", label: "overview", sym: "overview" },
  { id: "abilities", label: "abilities", sym: "abilities" },
  { id: "skills", label: "skills & lore", sym: "skills" },
  { id: "combat", label: "combat", sym: "combat" },
  { id: "companion", label: "companion", sym: "companion" },
  { id: "feats", label: "feats & features", sym: "feats" },
  { id: "spells", label: "spells", sym: "spells" },
  { id: "gear", label: "gear", sym: "gear" },
];

/* ================================================================== *
 *  NPCS — key scenario NPCs (stat block for Rain; identity + "?" for
 *  the rest, who have no combat block in the adventure).
 * ================================================================== */
/* SCENARIO_MAP_IMAGES: loaded at runtime from the scenario data layer */

/* SCENARIO_MAPS: loaded at runtime from the scenario data layer */

/* SCENARIO_NPCS: loaded at runtime from the scenario data layer */

function groupNpcs(list) {
  const order = [];
  const map = {};
  list.forEach((n) => {
    const g = n.group || "npcs";
    if (!map[g]) { map[g] = { label: g, items: [] }; order.push(map[g]); }
    map[g].items.push(n);
  });
  // always surface an "npcs" group so the "add npc" button is reachable,
  // even for a blank custom scenario with no NPCs yet
  if (!map["npcs"]) order.push({ label: "npcs", items: [] });
  return order;
}

/* the persistent top switch */
const MANAGERS = [
  { id: "gmnotes", label: "gm notes", sym: "gmnotes" },
  { id: "encounters", label: "encounters", sym: "combat" },
  { id: "characters", label: "characters", sym: "party" },
  { id: "scenario", label: "scenario", sym: "scenario" },
];

/* ================================================================== *
 *  ROOT — binder shell + manager switch + persistence
 * ================================================================== */
export function BinderApp({ onRequestMobile }) {
  const { ready, scenario: S, scenarios, activeId, setActiveId, createScenario, overlay, overlayId, patch } = useScenarioData();

  // UI-only state (selections, modals); all persisted data comes from overlay.
  // null = "no explicit choice yet" → fall back to the per-adventure default tab.
  const [workspace, setWorkspace] = useState(null); // null | gmnotes | characters | scenario | encounters

  // Fully-custom adventures have no authored scenario notes, so the scenario tab
  // is hidden and they default to gm notes. Map any lingering "scenario" workspace
  // to gm notes so a hidden tab can never be the active/rendered view.
  // Detect by the absence of scenario notes (same signal as ScenarioView's empty
  // state) rather than the `custom` flag alone — that flag is dropped when a
  // scenario round-trips through Supabase, so remote custom scenarios lack it.
  const isCustom = !!S && (S.custom === true || (S.tabs?.length || 0) === 0);
  const visibleManagers = useMemo(
    () => MANAGERS.filter((m) => m.id !== "scenario" || !isCustom),
    [isCustom]
  );
  // Help mirrors that: a custom adventure has no scenario tab, so its help
  // entries would advertise a workspace the user can't reach.
  const helpTabs = useMemo(() => HELP_TABS.filter((t) => t.id !== "scenario" || !isCustom), [isCustom]);
  const helpEntries = useMemo(() => HELP_INDEX.filter((e) => e.tab !== "scenario" || !isCustom), [isCustom]);
  const picked = workspace ?? (isCustom ? "gmnotes" : "characters");
  const effWorkspace = isCustom && picked === "scenario" ? "gmnotes" : picked;
  const [activePc, setActivePc] = useState(null);
  const [npcSel, setNpcSel] = useState(null);
  const [section, setSection] = useState("overview");
  const [scenSection, setScenSection] = useState("overview");
  // gm notes page last open per scenario, so leaving the tab and coming back
  // (GmNotes unmounts) lands on the same page instead of the first one.
  const [gmPageByScen, setGmPageByScen] = useState({});
  const [navOpen, setNavOpen] = useState(false);
  // hideable top dock: auto-pin on narrow screens (no hover), hover-reveal on desktop
  const [dockLocked, setDockLocked] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width:880px)").matches);
  const [dockHover, setDockHover] = useState(false);
  const dockVisible = dockLocked || dockHover;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [activeEnc, setActiveEnc] = useState(null);
  const [addNpcOpen, setAddNpcOpen] = useState(false);
  const [newScenOpen, setNewScenOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  // Warm the Archives of Nethys name index as soon as the characters tab is
  // reached, so sheet links are deep links rather than search fallbacks by the
  // time anything paints. No-op after the first call.
  useEffect(() => {
    if (effWorkspace === "characters") loadAonIndex();
  }, [effWorkspace]);

  // Overlay-derived collections (the user's editable state for this scenario).
  const pcs = useMemo(() => (overlay.pcs || []).map((raw) => parseBuild(raw)).filter(Boolean), [overlay.pcs]);
  const cnotes = overlay.notes || {};
  const encounters = useMemo(() => seedEncounterMaps(overlay.encounters || [], S?.encounters), [overlay.encounters, S]);

  // Switching scenarios: load the new one and clear stale selections.
  const switchScenario = useCallback(
    (id) => {
      setActiveId(id);
      setActivePc(null);
      setNpcSel(null);
      setActiveEnc(null);
      setScenSection("overview");
      setAdding(false);
      setWorkspace("scenario");
    },
    [setActiveId]
  );

  const handleCreateScenario = useCallback(
    async (title) => {
      await createScenario(title);
      setActivePc(null);
      setNpcSel(null);
      setActiveEnc(null);
      setScenSection("overview");
      setAdding(false);
      setWorkspace("gmnotes"); // new scenarios are custom — no scenario tab
      setNewScenOpen(false);
    },
    [createScenario]
  );

  // Stable writer for the GM notes workspace (overlay.gmPages). Stable identity
  // so GmNotes' unmount-flush effect binds to the right scenario.
  const persistGmPages = useCallback((gmPages) => patch({ gmPages }), [patch]);
  const rememberGmPage = useCallback(
    (pid) => setGmPageByScen((cur) => (cur[activeId] === pid ? cur : { ...cur, [activeId]: pid })),
    [activeId]
  );

  // Effective selections fall back to the first item (no setState-in-effect).
  const effPcId = (activePc && pcs.some((p) => p.id === activePc) && activePc) || pcs[0]?.id || null;
  const effEncId = (activeEnc && encounters.some((e) => e.id === activeEnc) && activeEnc) || encounters[0]?.id || null;

  const setNote = useCallback(
    (id, text) => patch({ notes: { ...(overlay.notes || {}), [id]: text } }),
    [patch, overlay.notes]
  );

  const addCustomNpc = useCallback(
    (data) => {
      const id = "c" + uid();
      const npc = {
        id, custom: true, group: "npcs",
        name: data.name, role: "",
        traits: data.traits && data.traits.length ? data.traits : (data.ancestry ? [data.ancestry] : []),
        description: data.description || "",
        level: data.level ?? null,
        perception: data.perception ?? null,
        ac: data.ac ?? null, hp: data.hp ?? null,
        fort: data.fort ?? null, ref: data.ref ?? null, will: data.will ?? null,
        notes: data.notes || "",
        source: data.source || "added by you",
      };
      // full-mode optional blocks — only attach when present so NpcSheet stays clean for quick adds
      if (data.abilities) npc.abilities = data.abilities;
      if (data.skills && data.skills.length) npc.skills = data.skills;
      if (data.speed) npc.speed = data.speed;
      if (data.languages && data.languages.length) npc.languages = data.languages;
      if (data.attacks && data.attacks.length) npc.attacks = data.attacks;
      if (data.spells && data.spells.length) npc.spells = data.spells;
      patch({ customNpcs: [...(overlay.customNpcs || []), npc] });
      setNpcSel(id);
      setAdding(false);
      setWorkspace("characters");
      setNavOpen(false);
    },
    [patch, overlay.customNpcs]
  );

  const removeCustomNpc = useCallback(
    (id) => {
      patch({ customNpcs: (overlay.customNpcs || []).filter((n) => n.id !== id) });
      setNpcSel((cur) => (cur === id ? null : cur));
    },
    [patch, overlay.customNpcs]
  );

  // Edit an NPC's description / role text. Custom NPCs are edited in place;
  // base scenario NPCs get an override in overlay.npcEdits (the base is immutable).
  const editNpcText = useCallback(
    (id, field, text) => {
      const base = (S?.npcs || []).find((n) => n.id === id);
      if (base) patch({ npcEdits: setNpcEdit(overlay.npcEdits, base, field, text) });
      else patch({ customNpcs: (overlay.customNpcs || []).map((n) => (n.id === id ? { ...n, [field]: text } : n)) });
    },
    [patch, S, overlay.npcEdits, overlay.customNpcs]
  );

  const resetNpcText = useCallback(
    (id) => {
      const next = { ...(overlay.npcEdits || {}) };
      delete next[id];
      patch({ npcEdits: next });
    },
    [patch, overlay.npcEdits]
  );

  // Encounters are persisted with seeded maps stripped (rehydrated on read).
  const writeEncounters = useCallback(
    (list) => patch({ encounters: stripSeededMaps(list, S?.encounters) }),
    [patch, S]
  );

  const addEncounter = useCallback(() => {
    const id = uid();
    const e = { id, name: `encounter ${encounters.length + 1}`, map: "", combatants: [] };
    writeEncounters([...encounters, e]);
    setActiveEnc(id);
    setNavOpen(false);
  }, [encounters, writeEncounters]);

  const updateEncounter = useCallback(
    (id, updater) => writeEncounters(encounters.map((e) => (e.id === id ? updater(e) : e))),
    [encounters, writeEncounters]
  );

  const removeEncounter = useCallback(
    (id) => {
      const next = encounters.filter((e) => e.id !== id);
      writeEncounters(next);
      setActiveEnc((cur) => (cur === id ? (next[0] ? next[0].id : null) : cur));
    },
    [encounters, writeEncounters]
  );

  const openPc = useCallback((pcId, sect = "overview") => {
    setActivePc(pcId);
    setNpcSel(null);
    setAdding(false);
    setSection(sect);
    setWorkspace("characters");
    setNavOpen(false);
  }, []);

  const openNpc = useCallback((id) => {
    setNpcSel(id);
    setAdding(false);
    setWorkspace("characters");
    setNavOpen(false);
  }, []);

  const openEncounter = useCallback((id) => {
    setActiveEnc(id);
    setWorkspace("encounters");
    setNavOpen(false);
  }, []);

  const prefillEncounters = useCallback(() => {
    const names = new Set(encounters.map((e) => e.name));
    const added = buildScenarioEncounters(names, S?.encounters);
    setNavOpen(false);
    if (!added.length) {
      // all scenario encounters already present — just jump to the first
      const first = encounters.find((e) => (S?.encounters || []).some((s) => s.name === e.name));
      if (first) setActiveEnc(first.id);
      return;
    }
    writeEncounters([...encounters, ...added]);
    setActiveEnc(added[0].id);
  }, [encounters, writeEncounters, S]);

  const addPc = useCallback(
    async (parsedOrFlag, idOrErr) => {
      // error path from importer
      if (parsedOrFlag === null) {
        setError(idOrErr);
        return;
      }
      // auto-fetch path
      if (parsedOrFlag === "FETCH") {
        setBusy(true);
        setError(null);
        const target = `https://pathbuilder2e.com/json.php?id=${idOrErr}`;
        const proxies = [
          (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
          (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
        ];
        let got = null;
        for (const make of proxies) {
          try {
            const res = await fetch(make(target));
            if (!res.ok) continue;
            const data = JSON.parse(await res.text());
            if (data && (data.success || data.build)) { got = data; break; }
          } catch { /* try next proxy */ }
        }
        setBusy(false);
        if (!got) {
          setError("auto-fetch was blocked (CORS / proxy). Open the json.php link in your browser, copy the JSON, and paste it below.");
          return;
        }
        try {
          parsedOrFlag = parseBuild(got);
        } catch {
          setError("fetched data wasn't a valid character.");
          return;
        }
      }

      // Replace any same-id build, then append. `pcs` is already parsed and each
      // entry carries its `.raw`, so we dedup off it rather than re-parsing.
      const pc = parsedOrFlag;
      const nextRaw = [...pcs.filter((p) => p.id !== pc.id).map((p) => p.raw), pc.raw];
      patch({ pcs: nextRaw });
      setActivePc(pc.id);
      setSection("overview");
      setAdding(false);
      setError(null);
    },
    [patch, pcs]
  );

  const removePc = useCallback(
    (id) => {
      patch({ pcs: pcs.filter((p) => p.id !== id).map((p) => p.raw) });
      setActivePc((cur) => (cur === id ? null : cur));
    },
    [patch, pcs]
  );

  const exportPc = (pc) => {
    const blob = new Blob([JSON.stringify(pc.raw, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${pc.name}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const allNpcs = useMemo(
    () => [...applyNpcEdits(S?.npcs, overlay.npcEdits), ...(overlay.customNpcs || [])],
    [S, overlay.npcEdits, overlay.customNpcs]
  );
  const pc = useMemo(() => pcs.find((p) => p.id === effPcId) || null, [pcs, effPcId]);
  const npc = useMemo(() => allNpcs.find((n) => n.id === npcSel) || null, [allNpcs, npcSel]);
  const encounter = useMemo(() => encounters.find((e) => e.id === effEncId) || null, [encounters, effEncId]);
  // Shared with the rail's mini initiative order — same collection, same sort as
  // the main combatant list, never re-ordered or filtered independently.
  const orderedCombatants = useMemo(
    () => (encounter ? orderCombatants(encounter.combatants) : []),
    [encounter]
  );
  const sheetSections = useMemo(() => {
    const has = (id) => {
      if (id === "spells") return pc && (pc.casters.length || pc.focus);
      if (id === "companion") return pc && pc.pets.length > 0;
      return true;
    };
    return SHEET_NAV.filter((s) => has(s.id));
  }, [pc]);

  const goScen = (id) => { setScenSection(id); setNavOpen(false); };
  // Not every scenario authors an "overview" section — land on the first one it has.
  const effScenSection = useMemo(() => {
    const ids = (S?.tabs || []).flatMap((g) => g.items.map((i) => i.id));
    return scenSection === "maps" || ids.includes(scenSection) || ids.length === 0 ? scenSection : ids[0];
  }, [S, scenSection]);
  const switchTo = (w) => { setWorkspace(w); setNavOpen(false); };

  // Help's "open it in the … tab" button. Where the app already tracks the
  // state a feature lives in, land on it rather than dropping the user at the
  // top of the tab to hunt for it again.
  const goHelp = useCallback(
    (target) => {
      setHelpOpen(false);
      if (!target) return;
      if (target.tab === "scenario" && target.scen) setScenSection(target.scen);
      if (target.tab === "characters") {
        setAdding(!!target.add);
        if (!target.add) {
          setNpcSel(null);
          // the companion section's pill only exists for a PC that has one —
          // don't strand the sheet on a section it won't render
          if (target.section && (target.section !== "companion" || pc?.pets.length)) {
            setSection(target.section);
          }
        }
      }
      setWorkspace(target.tab);
      setNavOpen(false);
    },
    [pc]
  );

  const crumbNow =
    effWorkspace === "characters"
      ? adding
        ? "add character"
        : npc
        ? npc.name
        : pc
        ? pc.name
        : "characters"
      : effWorkspace === "scenario"
      ? effScenSection
      : encounter
      ? encounter.name
      : "encounters";

  if (!ready) {
    return (
      <div className="shell">
        <div className="app">
          <main className="content"><div className="panel" style={{ padding: 40, color: "var(--ink-3)" }}>loading…</div></main>
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      {/* hideable top dock — hover the top edge to reveal, pin to lock */}
      <div
        className={`dock-region ${dockVisible ? "shown" : ""}`}
        onMouseEnter={() => setDockHover(true)}
        onMouseLeave={() => setDockHover(false)}
      >
        <div className="managers">
          <div className="managers-brand">campaign binder</div>
          <div className="managers-tabs">
            {visibleManagers.map((m) => (
              <button
                key={m.id}
                className={`ms-btn ${!helpOpen && effWorkspace === m.id ? "on" : ""}`}
                onClick={() => { setHelpOpen(false); switchTo(m.id); }}
              >
                <span className="ms-box"><Sym name={m.sym} className="ms-sym" /></span>
                <span>{m.label}</span>
              </button>
            ))}
          </div>
          <div className="dock-right">
            <button
              className={`dock-pin ${dockLocked ? "on" : ""}`}
              onClick={() => { setDockLocked((v) => !v); setDockHover(false); }}
            >
              <span className="dock-pin-dot" />
              {dockLocked ? "pinned" : "pin menu"}
            </button>
            {onRequestMobile && (
              <button className="dock-pin" onClick={onRequestMobile} title="switch to the mobile layout">
                mobile view
              </button>
            )}
            {scenarios.length > 0 && (
              <select
                className="scen-switch"
                value={activeId || ""}
                onChange={(e) => {
                  if (e.target.value === "__new__") setNewScenOpen(true);
                  else switchScenario(e.target.value);
                }}
                aria-label="active scenario"
              >
                {scenarios.map((s) => (
                  <option key={s.scenario_id} value={s.scenario_id}>{s.title}</option>
                ))}
                <option value="__new__">+ new custom scenario…</option>
              </select>
            )}
            <button
              className={`dock-help ${helpOpen ? "on" : ""}`}
              onClick={() => setHelpOpen((v) => !v)}
              title="what this app can do"
            >
              <span className="dock-help-q">?</span>
              help
            </button>
          </div>
        </div>

        {!dockVisible && (
          <button className="dock-handle" onClick={() => setDockLocked(true)} aria-label="show menu">
            menu
            <span className="dock-handle-caret">▾</span>
          </button>
        )}
      </div>

      <div className={`app ${dockLocked ? "docked" : ""}`}>
        {helpOpen ? (
          <HelpTab
            tabs={helpTabs}
            entries={helpEntries}
            fromTab={effWorkspace}
            onGo={goHelp}
            onClose={() => setHelpOpen(false)}
          />
        ) : effWorkspace === "gmnotes" ? (
          // GmNotes snapshots its content from initialPages once per mount, so it
          // must not mount until the loaded overlay belongs to the active scenario.
          // After a switch, activeId flips synchronously while the overlay loads
          // async — render a brief placeholder until they agree, otherwise GmNotes
          // would freeze on the previous scenario's notes.
          overlayId === activeId ? (
            <GmNotes key={activeId || "none"} initialPages={overlay.gmPages || []} initialPageId={gmPageByScen[activeId]} onPageChange={rememberGmPage} onPersist={persistGmPages} npcs={allNpcs} encounters={encounters} onOpenNpc={openNpc} onOpenEncounter={openEncounter} />
          ) : (
            <main className="content"><div className="panel" style={{ padding: 40, color: "var(--ink-3)" }}>loading…</div></main>
          )
        ) : (
        <EncNavProvider>
        {/* ---- rail ---- */}
        <nav className={`rail ${navOpen ? "open" : ""}${effWorkspace === "encounters" ? " rail-enc-mode" : ""}`}>
          {effWorkspace === "encounters" ? (
            <EncounterRail
              encounters={encounters}
              activeId={effEncId}
              ordered={orderedCombatants}
              onSelect={(id) => { setActiveEnc(id); setNavOpen(false); }}
              onNew={addEncounter}
              onPrefill={prefillEncounters}
            />
          ) : (
          <div className="rail-scroll">
            {effWorkspace === "characters" && (
              <>
                <div className="rail-group">
                  <div className="rail-group-label">player characters</div>
                  {pcs.map((p) => (
                    <button
                      key={p.id}
                      className={`rail-tab ${effPcId === p.id && !adding && !npcSel ? "active" : ""}`}
                      onClick={() => { setActivePc(p.id); setNpcSel(null); setAdding(false); setSection("overview"); setNavOpen(false); }}
                    >
                      <Sym name="party" className="rail-sym" />
                      <span className="rail-label">{p.name}<span className="rail-sub"> · {p.cls} {p.level}</span></span>
                      <span className="rail-arrow">→</span>
                    </button>
                  ))}
                  <button className={`rail-tab add ${adding ? "active" : ""}`} onClick={() => { setAdding(true); setNpcSel(null); setNavOpen(false); }}>
                    <span className="rail-plus">+</span><span className="rail-label">add character</span>
                  </button>
                </div>

                {groupNpcs(allNpcs).map((g) => (
                  <div className="rail-group" key={g.label}>
                    <div className="rail-group-label">{g.label}</div>
                    {g.items.map((n) => (
                      <button
                        key={n.id}
                        className={`rail-tab ${npcSel === n.id ? "active" : ""}`}
                        onClick={() => { setNpcSel(n.id); setAdding(false); setNavOpen(false); }}
                      >
                        <Sym name="party" className="rail-sym" />
                        <span className="rail-label">{n.name}{n.role ? <span className="rail-sub"> · {n.role}</span> : null}</span>
                        <span className="rail-arrow">→</span>
                      </button>
                    ))}
                    {g.label === "npcs" && (
                      <button className="rail-tab add" onClick={() => { setAddNpcOpen(true); setNavOpen(false); }}>
                        <span className="rail-plus">+</span><span className="rail-label">add npc</span>
                      </button>
                    )}
                  </div>
                ))}
              </>
            )}

            {effWorkspace === "scenario" && (S?.maps?.length > 0) && (
              <div className="rail-group">
                <div className="rail-group-label">reference</div>
                <button className={`rail-tab ${effScenSection === "maps" ? "active" : ""}`} onClick={() => goScen("maps")}>
                  <ScenSym name="overview" className="rail-sym" />
                  <span className="rail-label">Maps</span>
                  <span className="rail-arrow">→</span>
                </button>
              </div>
            )}

            {effWorkspace === "scenario" &&
              (S?.tabs || []).map((g) => (
                <div className="rail-group" key={g.group}>
                  <div className="rail-group-label">{g.group}</div>
                  {g.items.map((it) => (
                    <button key={it.id} className={`rail-tab ${effScenSection === it.id ? "active" : ""}`} onClick={() => goScen(it.id)}>
                      <ScenSym name={(S?.symFor || {})[it.id]} className="rail-sym" />
                      <span className="rail-label">{it.label}</span>
                      <span className="rail-arrow">→</span>
                    </button>
                  ))}
                </div>
              ))}

          </div>
          )}
        </nav>

        {navOpen && <div className="scrim" onClick={() => setNavOpen(false)} />}

        {/* ---- main ---- */}
        <main className={`content${effWorkspace === "encounters" ? " enc-active" : ""}`}>
          <div className="panel">
            <header className="topbar">
              <button className="menu-btn" onClick={() => setNavOpen((v) => !v)} aria-label="sections">
                <span /><span /><span />
              </button>
              <div className="crumb">
                <span>{effWorkspace}</span>
                <span className="crumb-sep">→</span>
                <span className="crumb-now">{crumbNow}</span>
              </div>
            </header>

            {effWorkspace === "characters" &&
              (adding ? (
                <div className="article"><Importer onAdd={addPc} busy={busy} error={error} /></div>
              ) : npc ? (
                <NpcSheet
                  npc={npc}
                  note={cnotes[npc.id] || ""}
                  onNote={(t) => setNote(npc.id, t)}
                  onEditText={(field, t) => editNpcText(npc.id, field, t)}
                  onResetText={npc.edited ? () => resetNpcText(npc.id) : null}
                  onRemove={npc.custom ? () => removeCustomNpc(npc.id) : null}
                />
              ) : !pc ? (
                <div className="article"><Importer onAdd={addPc} busy={busy} error={error} /></div>
              ) : (
                <article className="article">
                  <div className="pc-head">
                    <Sym name="party" className="article-sym" />
                    <div className="pc-head-main">
                      <div className="article-eyebrow">
                        {pc.ancestry}{pc.heritage ? ` · ${pc.heritage}` : ""} · {pc.background || "—"}
                      </div>
                      <h2 className="article-title">{pc.name}</h2>
                      <div className="pc-sub">{pc.cls}{pc.dualClass ? ` / ${pc.dualClass}` : ""} · level {pc.level}</div>
                    </div>
                    <div className="pc-head-right">
                      <NotesBox value={cnotes[pc.id] || ""} onChange={(t) => setNote(pc.id, t)} />
                      <div className="pc-actions">
                        <button className="mini" onClick={() => exportPc(pc)}>export</button>
                        <button className="mini danger" onClick={() => removePc(pc.id)}>remove</button>
                      </div>
                    </div>
                  </div>

                  <div className="pills">
                    {sheetSections.map((s) => (
                      <button key={s.id} className={`pill ${section === s.id ? "on" : ""}`} onClick={() => setSection(s.id)}>
                        {s.label}
                      </button>
                    ))}
                  </div>

                  <Sheet pc={pc} section={section} />
                </article>
              ))}

            {effWorkspace === "scenario" && <ScenarioView section={effScenSection} onGo={goScen} />}
            {effWorkspace === "encounters" && (
              <EncountersView
                encounter={encounter}
                pcs={pcs}
                onChange={(updater) => updateEncounter(effEncId, updater)}
                onOpenPc={openPc}
                onOpenNpc={openNpc}
                onNew={addEncounter}
                onRemove={() => removeEncounter(effEncId)}
                onPrefill={prefillEncounters}
              />
            )}
          </div>
        </main>
        </EncNavProvider>
        )}
      </div>

      {addNpcOpen && <AddNpc onAdd={addCustomNpc} onClose={() => setAddNpcOpen(false)} />}
      {newScenOpen && <NewScenario onCreate={handleCreateScenario} onClose={() => setNewScenOpen(false)} />}
    </div>
  );
}

