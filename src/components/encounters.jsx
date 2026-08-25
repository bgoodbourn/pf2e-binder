/* ==================================================================== *
 *  Encounters workspace components
 *
 *  The combat tracker: add-combatant modal, bestiary command palette,
 *  condition picker, auto-growing note textarea, the per-combatant row
 *  (initiative, HP, condition-adjusted stats), and the EncountersView shell.
 *  Only EncountersView is consumed outside this module.
 * ==================================================================== */
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { sign, uid, d20 } from "../lib/pf2e.js";
import {
  CONDITIONS, VALUED, conditionEffects, conditionTip, effectTip, roundsUnchanged, encounterBudget,
} from "../lib/conditions.js";
import {
  combatantFromPc, combatantFromNpc, combatantFromCreature, combatantFromCompanion,
  orderCombatants, loadCreatures, cachedCreatures,
} from "../lib/combatants.js";
import { statblockFor } from "../lib/companions.js";
import { AON_BASE } from "../lib/aon.js";
import { useScenarioData } from "../data/ScenarioContext.jsx";
import { Sym } from "./icons.jsx";
import { useCompanions } from "./useCompanions.js";
import { useEncNav } from "./useEncNav.js";

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
      conditions: [], effects: [], pcId: null, notes: f.notes.trim(),
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

/* ---- shared bits for the two "apply to N combatants" modals ---- */

/* The row of targets a modal is about to write to. Dropping a chip removes that
 * target without leaving the modal, so a mis-tick in select mode costs nothing. */
function ApplyBand({ targets, onDrop }) {
  return (
    <div className="apply-band">
      <span className="apply-band-label">applying to</span>
      {targets.map((t) => (
        <span key={t.id} className="cond">
          {t.name}
          <button className="cond-x" onClick={() => onDrop(t.id)} aria-label={`don't apply to ${t.name}`}>×</button>
        </span>
      ))}
      {targets.length === 0 && <span className="apply-band-empty">no targets left</span>}
    </div>
  );
}

/* Who applied this — optional, and it does real work: it decides which round the
 * age clock starts on (see startRoundFor). Everyone in the fight is offered,
 * including the target, since applying something to yourself is ordinary. */
function AppliedByField({ combatants, value, onChange }) {
  return (
    <label className="field applied-by">
      <span>applied by (optional)</span>
      <select className="inp" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">— not recorded —</option>
        {combatants.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </label>
  );
}

/* One dot per round the chip has held its current state, capped at three plus a
 * "+" so a six-round-old chip and a ten-round-old one read the same — both are
 * long overdue a look. Nothing renders for the round it was set in. */
function AgeDots({ n }) {
  if (n == null || n < 1) return null;
  const dots = Math.min(n, 3);
  return (
    <span className="cond-age" aria-label={`unchanged for ${n} round${n === 1 ? "" : "s"}`}>
      {Array.from({ length: dots }, (_, i) => <span key={i} className="cond-age-dot" />)}
      {n > 3 && <span className="cond-age-more">+</span>}
    </span>
  );
}

/* ---- Condition picker ---- */
function ConditionPicker({ targets, combatants, onDropTarget, onPick, onClose }) {
  const [q, setQ] = useState("");
  const [level, setLevel] = useState("");
  const [sel, setSel] = useState(null);
  const [by, setBy] = useState("");
  const list = CONDITIONS.filter((c) => c.toLowerCase().includes(q.toLowerCase()));
  const many = targets.length > 1;
  const add = () => {
    if (!sel || !targets.length) return;
    onPick(sel, level === "" ? null : Number(level), by);
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
        <ApplyBand targets={targets} onDrop={onDropTarget} />
        <AppliedByField combatants={combatants} value={by} onChange={setBy} />
        <input className="inp cond-search" placeholder="search conditions" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
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
          <button className="btn" disabled={!sel || !targets.length} onClick={add}>
            apply{sel ? ` ${sel.toLowerCase()}` : ""}{many ? ` to ${targets.length}` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---- Custom effect modal ----
 * A GM-authored, named effect with arbitrary modifiers, for the many spells that
 * impose condition-like penalties the rules never named. Eight fixed lines cover
 * what's on the sheet; anything else the GM types becomes an off-sheet pill. */
const FX_LINES = [
  { target: "ac", label: "ac" },
  { target: "fort", label: "fortitude" },
  { target: "ref", label: "reflex" },
  { target: "will", label: "will" },
  { target: "per", label: "perception" },
  { target: "attack", label: "attack" },
  { target: "damage", label: "damage" },
  { target: "actions", label: "actions" },
];
const FX_CLAMP = 6;

/* Select-mode group picks. "pcs" takes companions too — they're the party's, and
 * a GM buffing the party means the pets as well. */
const QUICK_PICKS = [
  { label: "all", match: () => true },
  { label: "enemies", match: (c) => c.kind === "enemy" },
  { label: "pcs", match: (c) => c.kind === "pc" || c.kind === "companion" },
];

function FxStep({ v, onSet }) {
  return (
    <span className="fx-step">
      <button onClick={() => onSet(Math.max(-FX_CLAMP, v - 1))} aria-label="decrease">−</button>
      <button className="fx-val" title="reset to 0" onClick={() => onSet(0)}>{v > 0 ? `+${v}` : v}</button>
      <button onClick={() => onSet(Math.min(FX_CLAMP, v + 1))} aria-label="increase">+</button>
    </span>
  );
}

function CustomEffectModal({ targets, combatants, onDropTarget, onApply, onClose }) {
  const [name, setName] = useState("");
  const [by, setBy] = useState("");
  const [fixed, setFixed] = useState(() => FX_LINES.map(() => 0));
  const [custom, setCustom] = useState([]); // { id, label, v }
  const [focusId, setFocusId] = useState(null); // custom line to focus once mounted

  const setFixedAt = (i, v) => setFixed((cur) => cur.map((x, k) => (k === i ? v : x)));
  const setCustomAt = (id, p) => setCustom((cur) => cur.map((c) => (c.id === id ? { ...c, ...p } : c)));
  const addCustom = () => {
    const line = { id: uid(), label: "", v: 0 };
    setCustom((cur) => [...cur, line]);
    setFocusId(line.id);
  };

  /* A zero on one of the eight fixed lines just means "unset" and is dropped. A
   * custom line is different: left at zero it becomes a note (v: null) rather
   * than a modifier, so the GM can write "can't use reactions" without inventing
   * a number for it. Either way a custom line needs a label to mean anything. */
  const mods = [
    ...FX_LINES.map((l, i) => ({ target: l.target, v: fixed[i] })).filter((m) => m.v !== 0),
    ...custom.map((c) => ({ target: c.label.trim(), v: c.v === 0 ? null : c.v })).filter((m) => m.target),
  ];
  const valid = name.trim() !== "" && mods.length > 0 && targets.length > 0;
  const many = targets.length > 1;

  const submit = () => {
    if (!valid) return;
    onApply(name.trim(), mods, by);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card narrow" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3 className="modal-title">custom effect</h3>
          <button className="modal-x" onClick={onClose} aria-label="close">×</button>
        </div>
        <ApplyBand targets={targets} onDrop={onDropTarget} />
        <AppliedByField combatants={combatants} value={by} onChange={setBy} />
        <label className="field"><span>name</span>
          <input className="inp" placeholder="e.g. bane" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <div className="fx-lines">
          {FX_LINES.map((l, i) => (
            <div key={l.target} className={`fx-line${fixed[i] !== 0 ? " on" : ""}`}>
              <span className="fx-line-label">{l.label}</span>
              <FxStep v={fixed[i]} onSet={(v) => setFixedAt(i, v)} />
            </div>
          ))}
          {custom.map((c) => (
            <div key={c.id} className={`fx-line${c.v !== 0 ? " on" : ""}`}>
              <input
                className="fx-line-custom"
                placeholder="effect"
                value={c.label}
                ref={(el) => { if (el && focusId === c.id) { el.focus(); setFocusId(null); } }}
                onChange={(e) => setCustomAt(c.id, { label: e.target.value })}
                aria-label="effect target"
              />
              <FxStep v={c.v} onSet={(v) => setCustomAt(c.id, { v })} />
              <button className="fx-line-x" onClick={() => setCustom((cur) => cur.filter((x) => x.id !== c.id))} aria-label="remove line">×</button>
            </div>
          ))}
          <button className="fx-add" onClick={addCustom}>+ add new</button>
        </div>
        <div className="fx-preview">
          {!name.trim() && !mods.length && <span className="fx-preview-empty">nothing set yet</span>}
          {(name.trim() || mods.length > 0) && (
            <>
              <span className="cond"><span className="cond-fx-dot" aria-hidden />{name.trim() || "unnamed"}</span>
              {mods.map((m, i) => (
                <span key={`${m.target}-${i}`} className={`cbt-offpill${m.v == null ? " note" : m.v > 0 ? " up" : ""}`}>
                  {m.target}{m.v != null && <> <strong>{sign(m.v)}</strong></>}
                </span>
              ))}
            </>
          )}
        </div>
        <div className="modal-foot">
          <button className="mini" onClick={onClose}>cancel</button>
          <button className="btn" disabled={!valid} onClick={submit}>
            apply{name.trim() ? ` ${name.trim().toLowerCase()}` : ""}{many ? ` to ${targets.length}` : ""}
          </button>
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

/* ---- a single combatant row ----
 * `tucked` is set for an animal companion whose owner is in this encounter: it
 * sits under the owner, acts on the owner's initiative, and so has no
 * initiative cell of its own. Everything else about the row is unchanged. */
function CombatantRow({
  c, tucked, index, round, compact, selected,
  onPatch, onRemove, onOpenPc, onOpenNpc, onAddCondition, onAddEffect, onToggleSelect,
}) {
  // Hand the row element to the rail's nav registry so the mini order can
  // measure it for dimming and scroll to it on a jump.
  const nav = useEncNav();
  const setRow = nav && nav.setRow;
  const rowRef = useCallback(
    (el) => { if (setRow) setRow(c.id, el); },
    [setRow, c.id]
  );
  const [roll, setRoll] = useState(null); // ephemeral save-roll readout (not persisted)
  const [editing, setEditing] = useState(false); // stat-edit mode (roll vs edit, one at a time)
  const [stepping, setStepping] = useState(null); // condition id whose value stepper is open
  const fx = conditionEffects(c);

  // the stepper is a transient editor: escape closes it, and so does going compact
  const stepId = compact ? null : stepping; // going compact closes the editor
  useEffect(() => {
    if (!stepping) return;
    const onKey = (e) => { if (e.key === "Escape") setStepping(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stepping]);

  const removeCond = (id) => onPatch((cur) => ({ conditions: cur.conditions.filter((x) => x.id !== id) }));
  /* A value change re-stamps sinceRound: the age marker tracks how long the
   * condition has held THIS value, so stepping frightened 2 down to 1 starts the
   * count again rather than carrying the older reading across. The clock restarts
   * from now with no turn-order offset — you adjusting a chip isn't the applier
   * acting again — but `appliedRound` and `appliedBy` ride along untouched, so
   * the tooltip still says where the condition came from. */
  const setCondValue = (id, v) => {
    if (v < 1) { removeCond(id); setStepping(null); return; }
    onPatch((cur) => ({
      conditions: cur.conditions.map((x) => (x.id === id ? { ...x, value: Math.min(10, v), sinceRound: round } : x)),
    }));
  };
  const removeEffect = (id) => onPatch((cur) => ({ effects: (cur.effects || []).filter((x) => x.id !== id) }));

  const chipCount = c.conditions.length + (c.effects || []).length;
  const summary = chipCount === 0 ? "clear" : `${chipCount} condition${chipCount === 1 ? "" : "s"}`;
  const stop = (e) => e.stopPropagation();
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
    <div
      ref={rowRef}
      className={`cbt kind-${c.kind}${tucked ? " tucked" : ""}${compact ? " compact" : ""}${selected ? " sel" : ""}`}
      style={{ "--i": Math.min(index, 7) }}
      onClick={compact ? onToggleSelect : undefined}
    >
      <span className="cbt-check">
        <button
          className={selected ? "on" : ""}
          onClick={(e) => { e.stopPropagation(); onToggleSelect(); }}
          aria-label={`${selected ? "deselect" : "select"} ${c.name}`}
          tabIndex={compact ? 0 : -1}
        >{selected ? "✓" : ""}</button>
      </span>
      {!tucked && (
        <div className="cbt-init" onClick={stop}>
          <input
            type="number"
            className="init-inp"
            value={c.init == null ? "" : c.init}
            placeholder="—"
            onChange={(e) => onPatch({ init: e.target.value === "" ? null : Number(e.target.value) })}
            aria-label="initiative"
          />
        </div>
      )}
      <div className="cbt-avatar">
        <Sym name={c.kind === "enemy" ? "combat" : c.kind === "companion" ? "companion" : "party"} className="cbt-sym" />
      </div>
      <div className="cbt-main">
        <div className="cbt-name-row">
          <span className="cbt-name">{c.name}</span>
          {c.pcId ? (
            <button className="cbt-link" title="open character sheet" onClick={() => onOpenPc(c.pcId)}>↗</button>
          ) : c.ownerPcId ? (
            <button className="cbt-link" title="open companion stat block" onClick={() => onOpenPc(c.ownerPcId, "companion")}>↗</button>
          ) : c.npcId ? (
            <button className="cbt-link" title="open npc sheet" onClick={() => onOpenNpc(c.npcId)}>↗</button>
          ) : c.aonUrl ? (
            <a className="cbt-link" href={c.aonUrl} target="_blank" rel="noopener noreferrer" title="open in Archives of Nethys">↗</a>
          ) : null}
          <span className={`cbt-kind k-${c.kind}`}>{c.kind}</span>
          <span className="cbt-level">{c.species ? `${c.species.toLowerCase()} · ` : ""}lvl {c.level}</span>
          {c.kind !== "pc" && (
            <button
              className={`cbt-edit${editing ? " on" : ""}`}
              onClick={() => setEditing((v) => !v)}
              title={editing ? "finish editing stats" : "edit stats"}
            >
              {editing ? "✓ done" : "✎ edit"}
            </button>
          )}
          <span className="cbt-summary">{summary}</span>
        </div>
        <div className="cbt-detail">
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
        {(fx.offSheet.length > 0 || fx.notes.length > 0) && (
          <div className="cbt-offpills">
            {fx.offSheet.map((o) => (
              <span key={o.label} className={`cbt-offpill${o.delta > 0 ? " up" : ""}`}>{o.label} <strong>{sign(o.delta)}</strong></span>
            ))}
            {/* an effect line with no number — the GM's own words, shown as-is */}
            {fx.notes.map((n, i) => (
              <span key={`note-${i}`} className="cbt-offpill note">{n}</span>
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
          {c.conditions.map((cond) => {
            const n = roundsUnchanged(cond, round);
            const valued = VALUED.has(cond.name);
            const open = stepId === cond.id;
            const v = cond.value == null ? 1 : cond.value;
            return (
              <span key={cond.id} className={`cond${open ? " editing" : ""}`} title={conditionTip(cond, n)}>
                <button
                  className={`cond-name${valued ? " valued" : ""}`}
                  onClick={(e) => { e.stopPropagation(); if (valued) setStepping(open ? null : cond.id); }}
                >
                  {open ? cond.name : `${cond.name}${cond.value != null ? ` ${cond.value}` : ""}`}
                </button>
                <AgeDots n={n} />
                {open && (
                  <>
                    <span className="cond-step">
                      <button
                        className={v <= 1 ? "warn" : ""}
                        title={v <= 1 ? "remove condition" : "decrease"}
                        onClick={() => setCondValue(cond.id, v - 1)}
                      >−</button>
                      <span className="cond-val">{v}</span>
                      <button title="increase" onClick={() => setCondValue(cond.id, v + 1)}>+</button>
                    </span>
                    <button className="cond-done" title="done" onClick={() => setStepping(null)}>✓</button>
                  </>
                )}
                <button className="cond-x" onClick={() => removeCond(cond.id)} aria-label="remove condition">×</button>
              </span>
            );
          })}
          {(c.effects || []).map((e) => {
            const n = roundsUnchanged(e, round);
            return (
              <span key={e.id} className="cond" title={effectTip(e, n)}>
                <span className="cond-fx-dot" aria-hidden />
                {e.name}
                <AgeDots n={n} />
                <button className="cond-x" onClick={() => removeEffect(e.id)} aria-label="remove effect">×</button>
              </span>
            );
          })}
          <button className="cond-add" onClick={onAddCondition}>+ condition</button>
          <button className="cond-add fx" onClick={onAddEffect}>+ effect</button>
        </div>
        <div className="cbt-noterow">
          <span className="cbt-note-label">note</span>
          <AutoTextarea className="cbt-note-input" value={c.notes} onChange={(v) => onPatch({ notes: v })} placeholder="add a note…" ariaLabel="combatant note" />
        </div>
        </div>
      </div>
      <div className="cbt-hp" onClick={stop}>
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
      <button className="cbt-x" onClick={(e) => { e.stopPropagation(); onRemove(); }} aria-label="remove combatant">×</button>
    </div>
  );
}

export function EncountersView({ encounter, pcs, onChange, onOpenPc, onOpenNpc, onNew, onRemove, onPrefill }) {
  const { scenario, overlay } = useScenarioData();
  const [addOpen, setAddOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Which combatants a modal is about to write to. An array so the same modal
  // serves both the per-row shortcut and a multi-combatant apply.
  const [condFor, setCondFor] = useState(null);
  const [fxFor, setFxFor] = useState(null);
  // Select mode is ephemeral — deliberately never persisted to the overlay.
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState([]);
  const [playerMenu, setPlayerMenu] = useState(false);
  const [npcMenu, setNpcMenu] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [mapUrl, setMapUrl] = useState("");
  // Re-renders once the companion stat blocks land, so the party's companions
  // can be offered in the "add player" menu with their derived numbers.
  useCompanions();
  // The rail's mini initiative order scrolls and measures against this
  // element; see encrail.jsx.
  const nav = useEncNav();
  const setScroller = nav && nav.setScroller;
  const scrollerRef = useCallback((el) => { if (setScroller) setScroller(el); }, [setScroller]);

  /* The running sheet grows with the log and only scrolls in the rare case that
   * it outgrows the space beside the list. When it does, the newest line is the
   * one worth seeing, so a new entry pins the box to the bottom. Read off the
   * prop rather than the local `log` so the hook sits above the early return. */
  const logCount = (encounter && Array.isArray(encounter.log) ? encounter.log : []).length;
  const logBoxRef = useRef(null);
  const seenLogCount = useRef(logCount);
  useEffect(() => {
    const box = logBoxRef.current;
    if (box && logCount > seenLogCount.current) box.scrollTop = box.scrollHeight;
    seenLogCount.current = logCount;
  }, [logCount]);

  // Switching encounters drops the selection (React's adjust-state-on-prop-change
  // pattern — an effect here would render the stale selection for a frame first).
  const encounterId = encounter && encounter.id;
  const [seenEncounter, setSeenEncounter] = useState(encounterId);
  if (seenEncounter !== encounterId) {
    setSeenEncounter(encounterId);
    setSelectMode(false);
    setSelected([]);
  }

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

  const toggleSelected = (id) =>
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  /* A quick pick is a toggle: pressing the group again clears it. "Already this
   * group" means the selection is exactly the group — untick one row by hand and
   * the pill goes quiet, so pressing it re-selects rather than clearing. */
  const sameSet = (ids) => ids.length === selected.length && ids.every((id) => selected.includes(id));
  const quickPick = (ids) => setSelected(sameSet(ids) ? [] : ids);
  const exitSelect = () => { setSelectMode(false); setSelected([]); };

  /* Which round a chip's age clock starts on, resolved once here and stored —
   * the age is really "how many of the TARGET's turns have passed", and that
   * depends on where the applier sits in the turn order.
   *
   * Initiative A 20, B 18, C 16; B applies sickened to A and C in round 1.
   * C acts after B, so C still gets a turn in round 1 and the clock starts
   * there — by round 2 it reads 1. A already acted before B did, so A's first
   * turn under the condition is round 2 and the clock starts there — round 2
   * reads 0, round 3 reads 1. A self-apply lands on your own turn, so it counts
   * like the applier being "not before you": the clock starts next round.
   *
   * Resolved at apply time rather than derived live, so re-rolling initiative
   * mid-fight doesn't silently re-age everything already on the board. */
  const startRoundFor = (targetId, byId, r) => {
    if (!byId) return r;
    const iBy = ordered.findIndex((c) => c.id === byId);
    const iTarget = ordered.findIndex((c) => c.id === targetId);
    if (iBy === -1 || iTarget === -1) return r;
    return iBy < iTarget ? r : r + 1;
  };

  /* Both applies write every target in ONE patch so the whole action is a single
   * undo, and read the round once up front — they were all applied in the same
   * round, even where the turn order gives them different start rounds. */
  const applyCondition = (ids, name, value, byId) => {
    const r = encounter.round ?? 1;
    const byName = byId ? (encounter.combatants.find((c) => c.id === byId) || {}).name : null;
    setCombatants((cs) => cs.map((c) => {
      if (!ids.includes(c.id)) return c;
      const conds = c.conditions || [];
      const stamp = { sinceRound: startRoundFor(c.id, byId, r), appliedRound: r, appliedBy: byName || null };
      // Re-applying a condition a combatant already has updates it rather than
      // stacking a second chip. An unchanged value is a no-op re-application, so
      // it keeps the clock it already had rather than restarting on nothing.
      if (conds.some((x) => x.name === name)) {
        return { ...c, conditions: conds.map((x) => (x.name === name
          ? (x.value === value ? x : { ...x, value, ...stamp })
          : x)) };
      }
      return { ...c, conditions: [...conds, { id: uid(), name, value, ...stamp }] };
    }));
    exitSelect();
  };

  const applyEffect = (ids, name, mods, byId) => {
    const r = encounter.round ?? 1;
    const byName = byId ? (encounter.combatants.find((c) => c.id === byId) || {}).name : null;
    setCombatants((cs) => cs.map((c) => (ids.includes(c.id)
      ? { ...c, effects: [...(c.effects || []), {
          id: uid(), name, mods,
          sinceRound: startRoundFor(c.id, byId, r), appliedRound: r, appliedBy: byName || null,
        }] }
      : c)));
    exitSelect();
  };

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

  const ordered = orderCombatants(encounter.combatants);

  const inEncounter = new Set(encounter.combatants.map((c) => c.pcId).filter(Boolean));
  const availablePcs = pcs.filter((p) => !inEncounter.has(p.id));
  // Companions the party has that aren't in this encounter yet, each with its
  // derived stat block (null until companions.json loads, which the hook waits on).
  const inCompanion = new Set(encounter.combatants.map((c) => c.companionId).filter(Boolean));
  const availableCompanions = pcs.flatMap((p) =>
    p.pets
      .map((pet, i) => ({ pc: p, pet, companionId: `${p.id}::pet${i}`, sb: statblockFor(pet, p.level) }))
      .filter((x) => x.sb && !inCompanion.has(x.companionId))
  );
  // A companion is tucked under its owner only when the owner is in the fight.
  const tuckedIds = new Set(
    encounter.combatants.filter((c) => c.kind === "companion" && inEncounter.has(c.ownerPcId)).map((c) => c.id)
  );
  const inNpc = new Set(encounter.combatants.map((c) => c.npcId).filter(Boolean));
  const allNpcs = [...(scenario?.npcs || []), ...(overlay?.customNpcs || [])];
  const availableNpcs = allNpcs.filter(
    (n) => n.ac != null && n.hp != null && n.perception != null && !inNpc.has(n.id)
  );
  const byId = (ids) => (ids || []).map((id) => encounter.combatants.find((c) => c.id === id)).filter(Boolean);
  const condTargets = byId(condFor);
  const fxTargets = byId(fxFor);

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
      {/* One scroll for the whole thing: the toolbar sticks to the top of it and
          the running sheet floats alongside the list rather than scrolling away. */}
      <div className="enc-scroll" ref={scrollerRef}>
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

      <div className="enc-chrome">
      <div className="enc-toolbar">
        <button className="tb roll" onClick={rollInitiative}>
          <Sym name="abilities" className="tb-sym" /> roll initiative
        </button>

        <div className="tb-wrap">
          <button
            className="tb tb-add"
            disabled={availablePcs.length + availableCompanions.length === 0}
            onClick={() => setPlayerMenu((v) => !v)}
          >
            <span className="tb-chip" aria-hidden>+</span> add player
          </button>
          {playerMenu && availablePcs.length + availableCompanions.length > 0 && (
            <div className="menu" onMouseLeave={() => setPlayerMenu(false)}>
              {availablePcs.map((p) => (
                <button key={p.id} className="menu-item" onClick={() => { addCombatant(combatantFromPc(p)); setPlayerMenu(false); }}>
                  {p.name}<span className="menu-sub">{p.cls} {p.level}</span>
                </button>
              ))}
              {availableCompanions.map((x) => (
                <button
                  key={x.companionId}
                  className="menu-item sub"
                  onClick={() => { addCombatant(combatantFromCompanion(x.sb, x.pc, x.companionId)); setPlayerMenu(false); }}
                >
                  {x.sb.name}<span className="menu-sub">{x.pc.name}’s {x.sb.species.toLowerCase()}</span>
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

        <button
          className={`tb sel-toggle${selectMode ? " on" : ""}`}
          onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
        >
          <span className="sel-box" aria-hidden /> select
        </button>

        <button className={`tb ${mapOpen ? "on" : ""}`} onClick={() => setMapOpen((v) => !v)}>map</button>
        <button className="tb danger-tb" onClick={() => setCombatants(() => [])}>clear</button>
      </div>

      {/* always mounted so it can animate open and shut */}
      <div className={`sel-bar-wrap${selectMode ? " on" : ""}`}>
        <div className="sel-bar">
          <span className="sel-readout">
            <span className="sel-count">{selected.length}</span>
            <span className="sel-label">selected</span>
          </span>
          <span className="sel-div" />
          {QUICK_PICKS.map((q) => {
            const ids = encounter.combatants.filter(q.match).map((c) => c.id);
            return (
              <button
                key={q.label}
                className={`sel-quick${ids.length && sameSet(ids) ? " on" : ""}`}
                disabled={!ids.length}
                onClick={() => quickPick(ids)}
              >{q.label}</button>
            );
          })}
          <span className="sel-actions">
            <button className="sel-act" disabled={!selected.length} onClick={() => setCondFor(selected)}>+ condition</button>
            <button className="sel-act fx" disabled={!selected.length} onClick={() => setFxFor(selected)}>+ effect</button>
            <button className="sel-x" onClick={exitSelect} aria-label="leave select mode">×</button>
          </span>
        </div>
      </div>
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
        <div className={`cbt-list${selectMode ? " compact" : ""}`}>
        {ordered.length === 0 && <div className="cbt-empty">no combatants yet — add players or creatures above.</div>}
        {ordered.map((c, i) => (
          <CombatantRow
            key={c.id}
            c={c}
            tucked={tuckedIds.has(c.id)}
            index={i}
            round={round}
            compact={selectMode}
            selected={selected.includes(c.id)}
            onToggleSelect={() => toggleSelected(c.id)}
            onPatch={(p) => patch(c.id, p)}
            onRemove={() => removeCombatant(c.id)}
            onOpenPc={onOpenPc}
            onOpenNpc={onOpenNpc}
            onAddCondition={() => setCondFor([c.id])}
            onAddEffect={() => setFxFor([c.id])}
          />
        ))}
        </div>

        <aside className="running-sheet">
        <div className="rs-head">
          <span className="rs-label">running sheet</span>
          <button className="rs-add" onClick={addLog}>+ log</button>
        </div>
        <div className="rs-entries" ref={logBoxRef}>
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
          targets={condTargets}
          combatants={ordered}
          onDropTarget={(id) => setCondFor((cur) => cur.filter((x) => x !== id))}
          onPick={(name, value, by) => applyCondition(condFor, name, value, by)}
          onClose={() => setCondFor(null)}
        />
      )}
      {fxFor && (
        <CustomEffectModal
          targets={fxTargets}
          combatants={ordered}
          onDropTarget={(id) => setFxFor((cur) => cur.filter((x) => x !== id))}
          onApply={(name, mods, by) => applyEffect(fxFor, name, mods, by)}
          onClose={() => setFxFor(null)}
        />
      )}
    </article>
  );
}
