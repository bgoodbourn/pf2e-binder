/* Defenses grid (AC / Fort / Ref / Will) reflecting active conditions, with
 * Fort/Ref/Will tappable to roll a d20 + the condition-adjusted modifier.
 * All math comes from the real conditionEffects engine — nothing reimplemented. */
import { useState } from "react";
import { conditionEffects } from "../../../lib/conditions.js";
import { d20, sign } from "../../../lib/pf2e.js";
import { haptic } from "./haptic.js";

// Per-condition contribution to one stat, derived by running the real engine
// on each condition in isolation (no duplicate FX table). Gives an honest
// reason string like "frightened −1, off-guard −2".
function contributors(c, stat) {
  // Each source is run alone — note the empty sibling array in every spread:
  // leaving the effects in while isolating a condition would fold every effect's
  // delta into every condition's reason string.
  const conds = (c.conditions || []).map((cond) => {
    const d = conditionEffects({ ...c, conditions: [cond], effects: [] }).deltas[stat] || 0;
    return d < 0 ? `${cond.name.toLowerCase()} ${sign(d)}` : null;
  });
  const fx = (c.effects || []).map((e) => {
    const d = conditionEffects({ ...c, conditions: [], effects: [e] }).deltas[stat] || 0;
    return d < 0 ? `${e.name.toLowerCase()} ${sign(d)}` : null;
  });
  return [...conds, ...fx].filter(Boolean);
}

const SAVES = [
  { key: "fort", label: "fort" },
  { key: "ref", label: "ref" },
  { key: "will", label: "will" },
];

// One defense tile. AC is read-only; saves are tappable to roll.
function DefCell({ combatant: c, statKey, label, value, rollable, onRoll }) {
  const delta = conditionEffects(c).deltas[statKey] || 0;
  const reduced = delta < 0;
  const reasons = reduced ? contributors(c, statKey) : [];
  const inner = (
    <>
      <span className="m-def-label">{label}</span>
      <span className="m-def-val" style={{ color: reduced ? "#b4544a" : "#111" }}>{value}</span>
      {reduced && (
        <span className="m-def-reason">
          <span className="m-pill m-pill-danger">{sign(delta)}</span> {reasons.join(", ")}
        </span>
      )}
    </>
  );
  const style = reduced ? { borderColor: "#f0d9d6" } : undefined;
  return rollable ? (
    <button className="m-def-cell" style={style} onClick={() => onRoll(statKey, label)}>{inner}</button>
  ) : (
    <div className="m-def-cell" style={style}>{inner}</div>
  );
}

export function SaveRoller({ combatant: c }) {
  const [roll, setRoll] = useState(null);
  const [seq, setSeq] = useState(0);
  const fx = conditionEffects(c);

  const rollSave = (key, label) => {
    const die = d20();
    const bonus = fx.adjusted[key];
    haptic(die === 20 ? [14, 45, 22] : die === 1 ? [28] : 11);
    setRoll({ key, label, die, bonus, total: die + bonus, reasons: contributors(c, key) });
    setSeq((s) => s + 1);
  };

  return (
    <div className="m-defenses">
      <div className="m-section-label">defenses · tap to roll</div>
      <div className="m-def-grid">
        <DefCell combatant={c} statKey="ac" label="ac" value={fx.adjusted.ac} rollable={false} />
        {SAVES.map((s) => (
          <DefCell key={s.key} combatant={c} statKey={s.key} label={s.label} value={sign(fx.adjusted[s.key])} rollable onRoll={rollSave} />
        ))}
      </div>

      {roll && (
        <div className="m-roll" key={seq}>
          <span className="m-roll-label">
            {roll.label} save{roll.reasons.length ? ` · ${roll.reasons.join(", ")}` : ""}
          </span>
          <span className={`m-roll-die ${roll.die === 20 ? "nat20" : roll.die === 1 ? "nat1" : ""}`}>{roll.die}</span>
          <span className="m-roll-mod">{sign(roll.bonus)}</span>
          <span className="m-roll-eq">=</span>
          <span className="m-roll-total">{roll.total}</span>
          {roll.die === 20 && <span className="m-roll-tag nat20">nat 20</span>}
          {roll.die === 1 && <span className="m-roll-tag nat1">nat 1</span>}
          <button className="m-roll-rr" onClick={() => rollSave(roll.key, roll.label)} aria-label="roll again">↻</button>
          <button className="m-roll-x" onClick={() => setRoll(null)} aria-label="dismiss">×</button>
        </div>
      )}
    </div>
  );
}
