/* ==================================================================== *
 *  Encounters workspace components
 *
 *  The combat tracker: add-combatant modal, bestiary command palette,
 *  condition picker, auto-growing note textarea, the per-combatant row
 *  (initiative, HP, condition-adjusted stats), and the EncountersView shell.
 *  Only EncountersView is consumed outside this module.
 * ==================================================================== */
import { useState, useEffect, useMemo, useRef } from "react";
import { sign, uid, d20 } from "../lib/pf2e.js";
import { CONDITIONS, VALUED, conditionEffects, conditionTip, encounterBudget } from "../lib/conditions.js";
import {
  combatantFromPc, combatantFromNpc, combatantFromCreature,
  loadCreatures, cachedCreatures,
} from "../lib/combatants.js";
import { AON_BASE } from "../lib/aon.js";
import { useScenarioData } from "../data/ScenarioContext.jsx";
import { Sym } from "./icons.jsx";

/* ---- Add Combatant modal (custom ally / enemy) ---- */
function AddCombatant({ onAdd, onClose }) {
  const [kind, setKind] = useState("enemy");
  const [f, setF] = useState({ name: "", level: -1, maxHp: "", ac: "", perception: "", fort: "", ref: "", will: "", notes: "" });
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const num = (v) => (v === "" || v == null ? 0 : Number(v));
  const valid = f.name.trim() && f.maxHp !== "" && f.ac !== "" && f.perception !== "";
  const submit = () => {
    if (!valid) return;
    onAdd({
      id: uid(), name: f.name.trim(), kind, level: Number(f.level),
      init: null, maxHp: num(f.maxHp), hp: num(f.maxHp), ac: num(f.ac),
      perception: num(f.perception), fort: num(f.fort), ref: num(f.ref), will: num(f.will),
      conditions: [], pcId: null, notes: f.notes.trim(),
    });
    onClose();
  };
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3 className="modal-title">add combatant</h3>
          <div className="toggle">
            <button className={`toggle-opt ${kind === "ally" ? "on" : ""}`} onClick={() => setKind("ally")}>ally</button>
            <button className={`toggle-opt ${kind === "enemy" ? "on" : ""}`} onClick={() => setKind("enemy")}>enemy</button>
          </div>
          <button className="modal-x" onClick={onClose} aria-label="close">×</button>
        </div>
        <div className="form-grid name-row">
          <label className="field"><span>name <i>*</i></span><input className="inp" value={f.name} onChange={set("name")} autoFocus /></label>
          <label className="field"><span>level <i>*</i></span><input className="inp" type="number" value={f.level} onChange={set("level")} /></label>
        </div>
        <div className="form-div" />
        <div className="form-grid three">
          <label className="field"><span>max hp <i>*</i></span><input className="inp" type="number" value={f.maxHp} onChange={set("maxHp")} placeholder="—" /></label>
          <label className="field"><span>ac <i>*</i></span><input className="inp" type="number" value={f.ac} onChange={set("ac")} placeholder="—" /></label>
          <label className="field"><span>perception <i>*</i></span><input className="inp" type="number" value={f.perception} onChange={set("perception")} placeholder="—" /></label>
          <label className="field"><span>fort</span><input className="inp" type="number" value={f.fort} onChange={set("fort")} placeholder="—" /></label>
          <label className="field"><span>ref</span><input className="inp" type="number" value={f.ref} onChange={set("ref")} placeholder="—" /></label>
          <label className="field"><span>will</span><input className="inp" type="number" value={f.will} onChange={set("will")} placeholder="—" /></label>
        </div>
        <div className="form-div" />
        <label className="field span2"><span>notes / abilities</span><textarea className="inp area" rows={2} value={f.notes} onChange={set("notes")} /></label>
        <div className="modal-foot">
          <button className="mini" onClick={onClose}>cancel</button>
          <button className="btn" disabled={!valid} onClick={submit}>add</button>
        </div>
      </div>
    </div>
  );
}

/* ---- Command palette: search the bestiary, add a standard creature ---- */
function CreaturePalette({ onAdd, onClose, onBuildCustom }) {
  const [all, setAll] = useState(cachedCreatures());
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef(null);

  useEffect(() => {
    let live = true;
    loadCreatures().then((c) => { if (live) setAll(c); });
    return () => { live = false; };
  }, []);

  const results = useMemo(() => {
    if (!all) return [];
    const s = q.trim().toLowerCase();
    const pool = s
      ? all.filter((cr) =>
          cr.name.toLowerCase().includes(s) ||
          (cr.family && cr.family.toLowerCase().includes(s)) ||
          cr.traits.some((t) => t.toLowerCase().includes(s)))
      : all;
    return pool.slice(0, 8);
  }, [all, q]);

  useEffect(() => {
    const el = listRef.current && listRef.current.querySelector(".cpal-row.active");
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [active, results]);

  const choose = (cr) => { onAdd(combatantFromCreature(cr)); onClose(); };
  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (results[active]) choose(results[active]); }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  };

  return (
    <div className="cpal-scrim" onClick={onClose}>
      <div className="cpal" onClick={(e) => e.stopPropagation()} onKeyDown={onKey}>
        <div className="cpal-head">
          <span className="cpal-glyph" aria-hidden>⌕</span>
          <input
            className="cpal-input"
            value={q}
            onChange={(e) => { setQ(e.target.value); setActive(0); }}
            placeholder="add a creature…"
            aria-label="search creatures"
            autoFocus
          />
          <span className="cpal-esc">esc</span>
        </div>
        <div className="cpal-list" ref={listRef}>
          {!all && <div className="cpal-msg">loading creatures…</div>}
          {all && results.length === 0 && <div className="cpal-msg">no creatures match.</div>}
          {results.map((cr, i) => (
            <div
              key={cr.id}
              className={`cpal-row${i === active ? " active" : ""}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(cr)}
            >
              <span className="cpal-lvl">{cr.level < 0 ? cr.level : `lvl ${cr.level}`}</span>
              <div className="cpal-mid">
                <div className="cpal-namerow">
                  <span className="cpal-name">{cr.name}</span>
                  <a
                    className="cpal-link"
                    href={AON_BASE + cr.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="open in Archives of Nethys"
                    onClick={(e) => e.stopPropagation()}
                  >↗</a>
                </div>
                <div className="cpal-stats">ac {cr.ac} · hp {cr.hp} · fort {sign(cr.fort)} ref {sign(cr.ref)} will {sign(cr.will)}</div>
              </div>
              {i === active && <span className="cpal-go">↵ add</span>}
            </div>
          ))}
        </div>
        <div className="cpal-foot">
          <span className="cpal-hints"><b>↑↓</b> navigate&nbsp;&nbsp;<b>↵</b> add</span>
          <button className="cpal-custom" onClick={() => { onClose(); onBuildCustom(); }}>+ build custom creature</button>
        </div>
      </div>
    </div>
  );
}

/* ---- Condition picker ---- */
function ConditionPicker({ onPick, onClose }) {
  const [q, setQ] = useState("");
  const [level, setLevel] = useState("");
  const [sel, setSel] = useState(null);
  const list = CONDITIONS.filter((c) => c.toLowerCase().includes(q.toLowerCase()));
  const add = () => {
    if (!sel) return;
    onPick(sel, level === "" ? null : Number(level));
    onClose();
  };
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card narrow" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3 className="modal-title">apply condition</h3>
          <a className="modal-ref" href="https://2e.aonprd.com/Conditions.aspx" target="_blank" rel="noopener noreferrer">reference ↗</a>
          <button className="modal-x" onClick={onClose} aria-label="close">×</button>
        </div>
        <input className="inp" placeholder="search conditions" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        <div className="cond-list">
          {list.map((c) => (
            <button key={c} className={`cond-opt ${sel === c ? "on" : ""}`} onClick={() => setSel(c)}>
              {c}{VALUED.has(c) && <span className="cond-valued">value</span>}
            </button>
          ))}
          {list.length === 0 && <div className="rail-empty">no match</div>}
        </div>
        <div className="cond-foot">
          <label className="field"><span>level (optional)</span><input className="inp" type="number" placeholder="e.g. 1" value={level} onChange={(e) => setLevel(e.target.value)} /></label>
          <button className="btn" disabled={!sel} onClick={add}>apply{sel ? ` ${sel.toLowerCase()}` : ""}</button>
        </div>
      </div>
    </div>
  );
}

/* auto-growing, borderless textarea (encounter note, combatant note, log lines) */
function AutoTextarea({ value, onChange, className, placeholder, ariaLabel, onKeyDown }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; }
  });
  return (
    <textarea
      ref={ref}
      className={className}
      value={value || ""}
      placeholder={placeholder}
      aria-label={ariaLabel}
      rows={1}
      onKeyDown={onKeyDown}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/* ---- a single combatant row ---- */
function CombatantRow({ c, onPatch, onRemove, onOpenPc, onOpenNpc, onAddCondition }) {
  const [roll, setRoll] = useState(null); // ephemeral save-roll readout (not persisted)
  const [editing, setEditing] = useState(false); // stat-edit mode (roll vs edit, one at a time)
  const fx = conditionEffects(c);
  const rollSave = (save) => {
    const die = d20();
    setRoll({ save, die, bonus: fx.adjusted[save], total: die + fx.adjusted[save] });
  };
  const tiles = [
    { key: "ac", label: "ac", save: false, val: String(fx.adjusted.ac), delta: fx.deltas.ac },
    { key: "fort", label: "fort", save: true, val: sign(fx.adjusted.fort), delta: fx.deltas.fort },
    { key: "ref", label: "ref", save: true, val: sign(fx.adjusted.ref), delta: fx.deltas.ref },
    { key: "will", label: "will", save: true, val: sign(fx.adjusted.will), delta: fx.deltas.will },
    { key: "per", label: "per", save: false, val: sign(fx.adjusted.per), delta: fx.deltas.per },
  ];
  const crit = roll && roll.die === 20;
  const fumble = roll && roll.die === 1;
  const rollCol = crit ? "#3f7d52" : fumble ? "#b4544a" : "#111";
  return (
    <div className={`cbt kind-${c.kind}`}>
      <div className="cbt-init">
        <input
          type="number"
          className="init-inp"
          value={c.init == null ? "" : c.init}
          placeholder="—"
          onChange={(e) => onPatch({ init: e.target.value === "" ? null : Number(e.target.value) })}
          aria-label="initiative"
        />
      </div>
      <div className="cbt-avatar"><Sym name={c.kind === "enemy" ? "combat" : "party"} className="cbt-sym" /></div>
      <div className="cbt-main">
        <div className="cbt-name-row">
          <span className="cbt-name">{c.name}</span>
          {c.pcId ? (
            <button className="cbt-link" title="open character sheet" onClick={() => onOpenPc(c.pcId)}>↗</button>
          ) : c.npcId ? (
            <button className="cbt-link" title="open npc sheet" onClick={() => onOpenNpc(c.npcId)}>↗</button>
          ) : c.aonUrl ? (
            <a className="cbt-link" href={c.aonUrl} target="_blank" rel="noopener noreferrer" title="open in Archives of Nethys">↗</a>
          ) : null}
          <span className={`cbt-kind k-${c.kind}`}>{c.kind}</span>
          <span className="cbt-level">lvl {c.level}</span>
          {c.kind !== "pc" && (
            <button
              className={`cbt-edit${editing ? " on" : ""}`}
              onClick={() => setEditing((v) => !v)}
              title={editing ? "finish editing stats" : "edit stats"}
            >
              {editing ? "✓ done" : "✎ edit"}
            </button>
          )}
        </div>
        {editing ? (
          <div className="cbt-editgrid">
            {[["ac", "ac"], ["maxHp", "total hp"], ["fort", "fort"], ["ref", "ref"], ["will", "will"], ["perception", "per"]].map(([k, label]) => (
              <label key={k} className="cbt-editfield">
                <span>{label}</span>
                <input
                  type="number"
                  value={c[k]}
                  onChange={(e) => onPatch({ [k]: e.target.value === "" ? 0 : Number(e.target.value) })}
                  aria-label={label}
                />
              </label>
            ))}
          </div>
        ) : (
        <div className="cbt-tiles">
          {tiles.map((t) => {
            const dir = t.delta < 0 ? "down" : t.delta > 0 ? "up" : "";
            const rolled = roll && roll.save === t.key;
            const cls = `cbt-tile${t.save ? " save" : ""}${dir ? " " + dir : ""}${rolled ? " rolled" : ""}`;
            const inner = (
              <>
                <div className="cbt-tile-top">
                  <span className="cbt-tile-label">{t.label}</span>
                  {t.save && <span className="cbt-diemark"><span /></span>}
                </div>
                <div className="cbt-tile-val">{t.val}</div>
                {t.delta !== 0 && <span className={`cbt-tile-badge${dir === "up" ? " up" : ""}`}>{sign(t.delta)}</span>}
              </>
            );
            return t.save ? (
              <button key={t.key} className={cls} onClick={() => rollSave(t.key)} title={`roll ${t.label} save`}>{inner}</button>
            ) : (
              <div key={t.key} className={cls}>{inner}</div>
            );
          })}
        </div>
        )}
        {fx.offSheet.length > 0 && (
          <div className="cbt-offpills">
            {fx.offSheet.map((o) => (
              <span key={o.label} className={`cbt-offpill${o.delta > 0 ? " up" : ""}`}>{o.label} <strong>{sign(o.delta)}</strong></span>
            ))}
          </div>
        )}
        {roll && (
          <div className="cbt-roll">
            <span className="cbt-roll-label">{roll.save} save</span>
            <span className="cbt-roll-die" style={{ borderColor: rollCol, color: rollCol }}>{roll.die}</span>
            <span className="cbt-roll-plus">{roll.bonus >= 0 ? `+ ${roll.bonus}` : `− ${Math.abs(roll.bonus)}`}</span>
            <span className="cbt-roll-eq">=</span>
            <span className="cbt-roll-total" style={{ color: rollCol }}>{roll.total}</span>
            {(crit || fumble) && <span className={`cbt-roll-tag${crit ? " up" : ""}`}>{crit ? "nat 20" : "nat 1"}</span>}
            <button className="cbt-roll-rr" title="roll again" onClick={() => rollSave(roll.save)}>↻</button>
            <button className="cbt-roll-x" title="dismiss roll" onClick={() => setRoll(null)}>×</button>
          </div>
        )}
        <div className="cbt-conds">
          {c.conditions.map((cond) => (
            <span key={cond.id} className="cond" title={conditionTip(cond)}>
              {cond.name}{cond.value != null ? ` ${cond.value}` : ""}
              <button className="cond-x" onClick={() => onPatch((cur) => ({ conditions: cur.conditions.filter((x) => x.id !== cond.id) }))} aria-label="remove condition">×</button>
            </span>
          ))}
          <button className="cond-add" onClick={onAddCondition}>+ condition</button>
        </div>
        <div className="cbt-noterow">
          <span className="cbt-note-label">note</span>
          <AutoTextarea className="cbt-note-input" value={c.notes} onChange={(v) => onPatch({ notes: v })} placeholder="add a note…" ariaLabel="combatant note" />
        </div>
      </div>
      <div className="cbt-hp">
        <input
          type="number"
          className="hp-inp"
          value={c.hp}
          onChange={(e) => onPatch({ hp: e.target.value === "" ? 0 : Number(e.target.value) })}
          aria-label="current hp"
        />
        <span className="hp-sep">/</span>
        <span className="hp-max">{c.maxHp}</span>
      </div>
      <button className="cbt-x" onClick={onRemove} aria-label="remove combatant">×</button>
    </div>
  );
}

export function EncountersView({ encounter, pcs, onChange, onOpenPc, onOpenNpc, onNew, onRemove, onPrefill }) {
  const { scenario, overlay } = useScenarioData();
  const [addOpen, setAddOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [condFor, setCondFor] = useState(null);
  const [playerMenu, setPlayerMenu] = useState(false);
  const [npcMenu, setNpcMenu] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [mapUrl, setMapUrl] = useState("");

  if (!encounter) {
    return (
      <div className="article">
        <div className="importer">
          <Sym name="combat" className="import-sym" />
          <h2 className="import-title">no encounter selected</h2>
          <p className="import-lead">Create an encounter to start tracking initiative, hit points, and conditions — then drop in your party and any creatures.</p>
          <div className="import-row">
            <button className="btn" onClick={onNew}>new encounter</button>
            <button className="tb" onClick={onPrefill}>prefill from scenario</button>
          </div>
          <p className="import-note">Prefill loads this adventure's encounters with each creature's stats transcribed from the scenario's appendix.</p>
        </div>
      </div>
    );
  }

  const setCombatants = (fn) => onChange((enc) => ({ ...enc, combatants: fn(enc.combatants) }));
  const patch = (id, p) => setCombatants((cs) => cs.map((c) => (c.id === id ? { ...c, ...(typeof p === "function" ? p(c) : p) } : c)));
  const addCombatant = (c) => setCombatants((cs) => [...cs, c]);
  const removeCombatant = (id) => setCombatants((cs) => cs.filter((c) => c.id !== id));

  // round bar + running sheet (round/log default tolerantly on read)
  const round = encounter.round ?? 1;
  const log = Array.isArray(encounter.log) ? encounter.log : [];
  const advance = () => onChange((enc) => ({ ...enc, round: (enc.round ?? 1) + 1 }));
  const back = () => onChange((enc) => ({ ...enc, round: Math.max(1, (enc.round ?? 1) - 1) }));
  const resetRnd = () => onChange((enc) => ({ ...enc, round: 1 }));
  const setNote = (note) => onChange((enc) => ({ ...enc, note }));
  const addLog = () => onChange((enc) => ({ ...enc, log: [...(enc.log || []), { id: uid(), round: enc.round ?? 1, text: "" }] }));
  const patchLog = (id, text) => onChange((enc) => ({ ...enc, log: (enc.log || []).map((l) => (l.id === id ? { ...l, text } : l)) }));
  const deleteLog = (id) => onChange((enc) => ({ ...enc, log: (enc.log || []).filter((l) => l.id !== id) }));

  const rollInitiative = () =>
    setCombatants((cs) => cs.map((c) => (c.kind === "pc" ? c : { ...c, init: d20() + (c.perception || 0) })));

  const ordered = [...encounter.combatants].sort((a, b) => {
    const av = a.init == null ? -Infinity : a.init;
    const bv = b.init == null ? -Infinity : b.init;
    return bv - av;
  });

  const inEncounter = new Set(encounter.combatants.map((c) => c.pcId).filter(Boolean));
  const availablePcs = pcs.filter((p) => !inEncounter.has(p.id));
  const inNpc = new Set(encounter.combatants.map((c) => c.npcId).filter(Boolean));
  const allNpcs = [...(scenario?.npcs || []), ...(overlay?.customNpcs || [])];
  const availableNpcs = allNpcs.filter(
    (n) => n.ac != null && n.hp != null && n.perception != null && !inNpc.has(n.id)
  );
  const budget = encounterBudget(encounter.combatants, pcs);
  // The threat pill auto-computes, but a GM can override either field; once set,
  // the override sticks (and drives the pill's colour). `?? ` keeps a 0 override.
  const threatLabel = encounter.threatLabel ?? budget.label;
  const threatXp = encounter.threatXp ?? budget.xp;
  const threatCls = String(threatLabel).toLowerCase().replace(/[^a-z]/g, "");

  const onMapFile = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onChange((enc) => ({ ...enc, map: reader.result }));
    reader.readAsDataURL(file);
  };

  return (
    <article className="article encv">
      <div className="enc-scroll">
      <div className="enc-head">
        <Sym name="combat" className="article-sym" />
        <div className="enc-head-main">
          <div className="article-eyebrow">combat manager</div>
          <input
            className="enc-name"
            value={encounter.name}
            onChange={(e) => onChange((enc) => ({ ...enc, name: e.target.value }))}
            aria-label="encounter name"
          />
        </div>
        <div className="enc-head-actions">
          <span className={`enc-threat t-${threatCls}`}>
            <input
              className="enc-threat-label"
              value={threatLabel}
              size={Math.max(String(threatLabel).length, 3)}
              onChange={(e) => onChange((enc) => ({ ...enc, threatLabel: e.target.value }))}
              title="edit threat level"
              aria-label="threat level"
            />
            <span className="enc-threat-sep">·</span>
            <input
              className="enc-threat-xp"
              type="number"
              value={threatXp}
              style={{ width: `${String(threatXp).length + 1}ch` }}
              onChange={(e) => onChange((enc) => ({ ...enc, threatXp: e.target.value === "" ? 0 : Number(e.target.value) }))}
              title="edit encounter xp"
              aria-label="encounter xp"
            />
            <span className="enc-threat-unit">xp</span>
          </span>
          <button className="mini danger" onClick={onRemove}>remove</button>
        </div>
      </div>

      <div className="enc-note">
        <svg className="enc-note-pencil" viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="#b4b3ad" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11.5 2.5l2 2L6 12l-3 1 1-3z" /></svg>
        <AutoTextarea className="enc-note-input" value={encounter.note} onChange={setNote} placeholder="describe the encounter — terrain, stakes, how it kicks off…" ariaLabel="encounter note" />
      </div>

      <div className="enc-toolbar">
        <button className="tb roll" onClick={rollInitiative}>
          <Sym name="abilities" className="tb-sym" /> roll initiative
        </button>

        <div className="tb-wrap">
          <button className="tb tb-add" disabled={availablePcs.length === 0} onClick={() => setPlayerMenu((v) => !v)}>
            <span className="tb-chip" aria-hidden>+</span> add player
          </button>
          {playerMenu && availablePcs.length > 0 && (
            <div className="menu" onMouseLeave={() => setPlayerMenu(false)}>
              {availablePcs.map((p) => (
                <button key={p.id} className="menu-item" onClick={() => { addCombatant(combatantFromPc(p)); setPlayerMenu(false); }}>
                  {p.name}<span className="menu-sub">{p.cls} {p.level}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="tb-wrap">
          <button className="tb tb-add" disabled={availableNpcs.length === 0} onClick={() => setNpcMenu((v) => !v)}>
            <span className="tb-chip" aria-hidden>+</span> add npc
          </button>
          {npcMenu && availableNpcs.length > 0 && (
            <div className="menu" onMouseLeave={() => setNpcMenu(false)}>
              {availableNpcs.map((n) => (
                <button key={n.id} className="menu-item" onClick={() => { addCombatant(combatantFromNpc(n)); setNpcMenu(false); }}>
                  {n.name}<span className="menu-sub">{n.role}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="tb-split">
          <button className="tb-split-main" onClick={() => setPaletteOpen(true)}>
            <span className="tb-chip" aria-hidden>+</span> add creature
          </button>
          <button className="tb-split-sec" onClick={() => setAddOpen(true)}>add custom</button>
        </div>

        <button className={`tb ${mapOpen ? "on" : ""}`} onClick={() => setMapOpen((v) => !v)}>map</button>
        <button className="tb danger-tb" onClick={() => setCombatants(() => [])}>clear</button>
      </div>

      {mapOpen && (
        <div className="enc-map">
          {encounter.map ? (
            <img src={encounter.map} alt="encounter map" />
          ) : (
            <div className="enc-map-empty">no map set for this encounter</div>
          )}
          <div className="enc-map-ctrl">
            <input className="inp" placeholder="image url" value={mapUrl} onChange={(e) => setMapUrl(e.target.value)} />
            <button className="mini" disabled={!mapUrl.trim()} onClick={() => { onChange((enc) => ({ ...enc, map: mapUrl.trim() })); setMapUrl(""); }}>set</button>
            <label className="mini filebtn">upload<input type="file" accept="image/*" hidden onChange={onMapFile} /></label>
            {encounter.map && <button className="mini danger" onClick={() => onChange((enc) => ({ ...enc, map: "" }))}>remove</button>}
          </div>
        </div>
      )}

      <div className="enc-body">
        <div className="cbt-list">
          {ordered.length === 0 && <div className="cbt-empty">no combatants yet — add players or creatures above.</div>}
          {ordered.map((c) => (
            <CombatantRow
              key={c.id}
              c={c}
              onPatch={(p) => patch(c.id, p)}
              onRemove={() => removeCombatant(c.id)}
              onOpenPc={onOpenPc}
              onOpenNpc={onOpenNpc}
              onAddCondition={() => setCondFor(c.id)}
            />
          ))}
        </div>

        <aside className="running-sheet">
          <div className="rs-head">
            <span className="rs-label">running sheet</span>
            <button className="rs-add" onClick={addLog}>+ log</button>
          </div>
          <div className="rs-entries">
            {log.length === 0 && <div className="rs-empty">log key beats as the fight unfolds.</div>}
            {log.map((l) => (
              <div className="rs-entry" key={l.id}>
                <span className="rs-badge">r{l.round}</span>
                <AutoTextarea className="rs-input" value={l.text} onChange={(v) => patchLog(l.id, v)} placeholder="what happened…" ariaLabel="log entry" />
                <button className="rs-del" title="clear this line" onClick={() => deleteLog(l.id)}>×</button>
              </div>
            ))}
          </div>
        </aside>
      </div>
      </div>

      <div className="round-bar">
        <div className="rb-readout">
          <span className="rb-label">round</span>
          <span className="rb-num">{round}</span>
        </div>
        <button className="rb-step" title="back one round" onClick={back}>◀</button>
        <button className="rb-advance" onClick={advance}>advance to round {round + 1} <span className="rb-arrow">→</span></button>
        <button className="rb-reset" title="reset to round 1" onClick={resetRnd}>⟲</button>
      </div>

      {paletteOpen && (
        <CreaturePalette
          onAdd={addCombatant}
          onClose={() => setPaletteOpen(false)}
          onBuildCustom={() => setAddOpen(true)}
        />
      )}
      {addOpen && <AddCombatant onAdd={addCombatant} onClose={() => setAddOpen(false)} />}
      {condFor && (
        <ConditionPicker
          onPick={(name, value) => patch(condFor, (cur) => ({ conditions: [...cur.conditions, { id: uid(), name, value }] }))}
          onClose={() => setCondFor(null)}
        />
      )}
    </article>
  );
}
