/* ==================================================================== *
 *  MobileApp — phone companion shell
 *
 *  3-tab bottom bar (notes · characters · combat) + a state-driven screen
 *  router. Reads/writes the SAME overlay as the desktop binder via
 *  useScenarioData()/patch — live notes, HP, conditions and round all
 *  round-trip through IndexedDB + Supabase. Combat math is reused from
 *  src/lib (conditionEffects, d20, combatant factories); nothing here
 *  reimplements PF2e rules.
 * ==================================================================== */
import { useState, useMemo, useCallback } from "react";
import "../../mobile.css";
import { useScenarioData } from "../../data/ScenarioContext.jsx";
import { seedEncounterMaps, stripSeededMaps, buildScenarioEncounters } from "../../lib/combatants.js";
import { uid, d20, parseBuild } from "../../lib/pf2e.js";
import { makeNoteBlock } from "../../lib/gmnotes-util.js";
import { haptic } from "./parts/haptic.js";
import { IconNotes, IconPeople, IconShield } from "./parts/MobileIcons.jsx";
import { NotesScreen } from "./screens/NotesScreen.jsx";
import { EncountersListScreen } from "./screens/EncountersListScreen.jsx";
import { InitiativeScreen } from "./screens/InitiativeScreen.jsx";
import { CombatantCardScreen } from "./screens/CombatantCardScreen.jsx";
import { CharactersScreen } from "./screens/CharactersScreen.jsx";
import { CharacterDetailScreen } from "./screens/CharacterDetailScreen.jsx";
import { LiveNoteSheet } from "./sheets/LiveNoteSheet.jsx";
import { PageJumperSheet } from "./sheets/PageJumperSheet.jsx";
import { ScenarioPickerSheet } from "./sheets/ScenarioPickerSheet.jsx";

const clamp = (i, len) => (len <= 0 ? 0 : Math.max(0, Math.min(len - 1, i)));
const sortByInit = (combatants) =>
  [...combatants].sort((a, b) => (b.init == null ? -Infinity : b.init) - (a.init == null ? -Infinity : a.init));

const TABS = [
  { id: "notes", label: "notes", Icon: IconNotes },
  { id: "characters", label: "characters", Icon: IconPeople },
  { id: "combat", label: "combat", Icon: IconShield },
];
// which tab is highlighted for a given screen
const TAB_FOR = { notes: "notes", characters: "characters", charDetail: "characters", combat: "combat", initiative: "combat", combatant: "combat" };

export default function MobileApp({ onRequestDesktop }) {
  const { ready, scenario: S, scenarios, activeId, setActiveId, overlay, patch } = useScenarioData();

  const [screen, setScreen] = useState("notes");
  const [pageIndex, setPageIndex] = useState(0);
  const [activeEncounterId, setActiveEncounterId] = useState(null);
  const [selectedCombatantId, setSelectedCombatantId] = useState(null);
  const [pending, setPending] = useState(8);
  const [charSel, setCharSel] = useState(null); // null | { kind:"pc"|"npc", id }
  const [sheet, setSheet] = useState(null); // null | "jumper" | "scenario" | "note"

  // ---- derived data (same sources as the desktop binder) ----
  const pages = useMemo(() => overlay.gmPages || [], [overlay.gmPages]);
  const pageIdx = clamp(pageIndex, pages.length);
  const page = pages[pageIdx] || null;

  const encounters = useMemo(
    () => seedEncounterMaps(overlay.encounters || [], S?.encounters),
    [overlay.encounters, S]
  );
  const writeEncounters = useCallback(
    (list) => patch({ encounters: stripSeededMaps(list, S?.encounters) }),
    [patch, S]
  );
  const updateEncounter = useCallback(
    (id, updater) => writeEncounters(encounters.map((e) => (e.id === id ? updater(e) : e))),
    [encounters, writeEncounters]
  );

  const encounter =
    encounters.find((e) => e.id === activeEncounterId) || encounters[0] || null;
  const ordered = useMemo(() => (encounter ? sortByInit(encounter.combatants) : []), [encounter]);
  const activeIdx = encounter ? clamp(encounter.activeIdx ?? 0, ordered.length) : 0;
  const activeTurnId = ordered[activeIdx]?.id ?? null;
  const selected = encounter ? encounter.combatants.find((c) => c.id === selectedCombatantId) || null : null;

  const campaignName = S?.title || "scenario";

  // ---- characters ----
  const pcs = useMemo(() => (overlay.pcs || []).map((raw) => parseBuild(raw)).filter(Boolean), [overlay.pcs]);
  const allNpcs = useMemo(() => [...(S?.npcs || []), ...(overlay.customNpcs || [])], [S, overlay.customNpcs]);
  const openCharacter = useCallback((kind, id) => { setCharSel({ kind, id }); setScreen("charDetail"); }, []);
  const selectedChar = charSel
    ? (charSel.kind === "pc" ? pcs.find((p) => p.id === charSel.id) : allNpcs.find((n) => n.id === charSel.id)) || null
    : null;

  // ---- notes ----
  const addLiveNote = useCallback(
    (text) => {
      haptic(10);
      const note = makeNoteBlock(uid(), text);
      if (page) {
        const next = pages.map((p, i) => (i === pageIdx ? { ...p, blocks: [...(p.blocks || []), note] } : p));
        patch({ gmPages: next });
      } else {
        // no running order yet — start one so the note has a home
        patch({ gmPages: [...pages, { id: uid(), title: "live notes", group: "main", blocks: [note] }] });
        setPageIndex(pages.length);
      }
    },
    [page, pages, pageIdx, patch]
  );

  // ---- deep links from notes ----
  const openNpc = useCallback((id) => openCharacter("npc", id), [openCharacter]);
  const openEncounterById = useCallback((id) => {
    if (encounters.some((e) => e.id === id)) { setActiveEncounterId(id); setScreen("initiative"); }
  }, [encounters]);
  const goPageById = useCallback((id) => {
    const i = pages.findIndex((p) => p.id === id);
    if (i >= 0) setPageIndex(i);
  }, [pages]);

  // ---- combat ----
  const openEncounter = useCallback((id) => { setActiveEncounterId(id); setScreen("initiative"); }, []);
  const selectCombatant = useCallback((cid) => { setSelectedCombatantId(cid); setPending(8); setScreen("combatant"); }, []);

  const advance = (enc, len) => {
    const cur = clamp(enc.activeIdx ?? 0, len);
    const next = len ? (cur + 1) % len : 0;
    return { ...enc, activeIdx: next, round: next === 0 ? (enc.round ?? 1) + 1 : (enc.round ?? 1) };
  };
  const nextTurn = useCallback(() => {
    if (!encounter || !ordered.length) return;
    haptic(14);
    updateEncounter(encounter.id, (enc) => advance(enc, ordered.length));
  }, [encounter, ordered.length, updateEncounter]);

  const nextInInitiative = useCallback(() => {
    if (!encounter || !ordered.length) return;
    haptic(14);
    const cur = clamp(encounter.activeIdx ?? 0, ordered.length);
    const nextId = ordered[(cur + 1) % ordered.length]?.id ?? null;
    updateEncounter(encounter.id, (enc) => advance(enc, ordered.length));
    setSelectedCombatantId(nextId);
    setPending(8);
  }, [encounter, ordered, updateEncounter]);

  const rollInitiative = useCallback(() => {
    if (!encounter) return;
    haptic(10);
    updateEncounter(encounter.id, (enc) => ({
      ...enc,
      combatants: enc.combatants.map((c) => (c.kind === "pc" ? c : { ...c, init: d20() + (c.perception || 0) })),
    }));
  }, [encounter, updateEncounter]);

  const patchCombatant = useCallback(
    (cid, p) =>
      updateEncounter(encounter.id, (enc) => ({
        ...enc,
        combatants: enc.combatants.map((c) => (c.id === cid ? { ...c, ...p } : c)),
      })),
    [encounter, updateEncounter]
  );

  const prefillEncounters = useCallback(() => {
    const names = new Set(encounters.map((e) => e.name));
    const added = buildScenarioEncounters(names, S?.encounters);
    if (!added.length) return;
    writeEncounters([...encounters, ...added]);
    setActiveEncounterId(added[0].id);
    setScreen("initiative");
  }, [encounters, writeEncounters, S]);

  // ---- tabs ----
  const activeTab = TAB_FOR[screen] || "notes";
  const switchTab = (tab) => { setSheet(null); setScreen(tab); };

  if (!ready) {
    return <div className="m-app"><div className="m-boot">loading…</div></div>;
  }

  let body;
  if (screen === "notes") {
    body = (
      <NotesScreen
        campaignName={campaignName}
        page={page}
        pageIndex={pageIdx}
        pageCount={pages.length}
        onOpenJumper={() => setSheet("jumper")}
        onOpenScenarioPicker={() => setSheet("scenario")}
        onRequestDesktop={onRequestDesktop}
        onOpenComposer={() => setSheet("note")}
        onOpenNpc={openNpc}
        onOpenEncounter={openEncounterById}
        onGoPage={goPageById}
      />
    );
  } else if (screen === "combat") {
    body = (
      <EncountersListScreen
        campaignName={campaignName}
        encounters={encounters}
        activeEncounterId={encounter?.id}
        onOpen={openEncounter}
        onPrefill={prefillEncounters}
        canPrefill={(S?.encounters || []).length > 0}
        onOpenScenarioPicker={() => setSheet("scenario")}
        onRequestDesktop={onRequestDesktop}
      />
    );
  } else if (screen === "initiative") {
    body = (
      <InitiativeScreen
        campaignName={campaignName}
        round={encounter?.round ?? 1}
        ordered={ordered}
        activeId={activeTurnId}
        onNextTurn={nextTurn}
        onSelect={selectCombatant}
        onRollInitiative={rollInitiative}
        onBack={() => setScreen("combat")}
      />
    );
  } else if (screen === "combatant") {
    body = (
      <CombatantCardScreen
        combatant={selected}
        round={encounter?.round ?? 1}
        pending={pending}
        setPending={setPending}
        onPatch={(p) => patchCombatant(selected.id, p)}
        onBack={() => setScreen("initiative")}
        onNext={nextInInitiative}
      />
    );
  } else if (screen === "characters") {
    body = <CharactersScreen pcs={pcs} npcs={allNpcs} onOpen={openCharacter} />;
  } else if (screen === "charDetail") {
    body = <CharacterDetailScreen kind={charSel?.kind} character={selectedChar} onBack={() => setScreen("characters")} />;
  }

  // tab bar shows on the three landing screens; drill-ins use a back affordance
  const isLanding = screen === "notes" || screen === "characters" || screen === "combat";

  return (
    <div className="m-app">
      <div className="m-screen-wrap" key={screen}>{body}</div>

      {isLanding && (
        <nav className="m-tabbar">
          {TABS.map(({ id, label, Icon }) => (
            <button key={id} className={`m-tab ${activeTab === id ? "on" : ""}`} onClick={() => switchTab(id)}>
              <Icon size={23} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      )}

      {sheet === "note" && (
        <LiveNoteSheet campaignName={campaignName} onAdd={addLiveNote} onClose={() => setSheet(null)} />
      )}
      {sheet === "jumper" && (
        <PageJumperSheet pages={pages} currentIndex={pageIdx} onPick={setPageIndex} onClose={() => setSheet(null)} />
      )}
      {sheet === "scenario" && (
        <ScenarioPickerSheet scenarios={scenarios} activeId={activeId} onPick={setActiveId} onClose={() => setSheet(null)} />
      )}
    </div>
  );
}
