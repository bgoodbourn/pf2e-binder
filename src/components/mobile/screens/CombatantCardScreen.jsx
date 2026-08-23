/* Combatant card — the "run this creature's turn" view: HP, defenses (with
 * condition effects + save rolls), conditions, and turn advance. Writes go
 * through onPatch → the same overlay the desktop encounter tracker uses. */
import { uid } from "../../../lib/pf2e.js";
import { VALUED } from "../../../lib/conditions.js";
import { IconChevLeft } from "../parts/MobileIcons.jsx";
import { HpBar, SidePill } from "../parts/combatBits.jsx";
import { hpColor } from "../parts/sides.js";
import { HpStepper } from "../parts/HpStepper.jsx";
import { ConditionChips } from "../parts/ConditionChips.jsx";
import { SaveRoller } from "../parts/SaveRoller.jsx";
import { haptic } from "../parts/haptic.js";

export function CombatantCardScreen({ combatant: c, round, pending, setPending, onPatch, onBack, onNext }) {
  if (!c) return null;
  const bloodied = c.hp > 0 && c.hp <= c.maxHp / 2;
  const down = c.hp === 0;

  const applyHp = (delta) => {
    haptic(8);
    onPatch({ hp: Math.max(0, Math.min(c.maxHp, c.hp + delta)) });
  };
  const addCond = (name) => {
    if (c.conditions.some((x) => x.name === name)) return;
    onPatch({ conditions: [...c.conditions, { id: uid(), name, value: VALUED.has(name) ? 1 : null, sinceRound: round }] });
  };
  const removeCond = (id) => onPatch({ conditions: c.conditions.filter((x) => x.id !== id) });
  /* Re-stamps sinceRound: the age dots count how long the condition has held
   * THIS value, so dragging frightened 2 down to 1 starts the count again. */
  const setCondVal = (id, value) =>
    onPatch({ conditions: c.conditions.map((x) => (x.id === id ? { ...x, value, sinceRound: round } : x)) });
  const removeEffect = (id) => onPatch({ effects: (c.effects || []).filter((x) => x.id !== id) });

  return (
    <div className="m-screen m-combatant">
      <header className="m-header">
        <div className="m-header-top">
          <button className="m-back m-back-light" onClick={onBack}><IconChevLeft size={16} /> initiative</button>
          <span className="m-cbt-round">round {round} · init {c.init == null ? "—" : c.init}</span>
        </div>
        <div className="m-cbt-name-row">
          <h1 className="m-title m-title-sm">{c.name} <SidePill c={c} /></h1>
          <span className="m-cbt-ac">ac {c.ac}</span>
        </div>
      </header>

      <div className="m-body">
        <div className="m-hp-card">
          <div className="m-hp-top">
            <span className="m-section-label">hit points</span>
            {bloodied && <span className="m-pill m-pill-danger">bloodied</span>}
            {down && <span className="m-pill m-pill-danger">down</span>}
          </div>
          <div className="m-hp-big" key={c.hp} style={{ color: hpColor(c.hp, c.maxHp) }}>
            {c.hp} <span className="m-hp-max">/ {c.maxHp}</span>
          </div>
          <HpBar hp={c.hp} max={c.maxHp} />
          <HpStepper pending={pending} setPending={setPending} onDamage={() => applyHp(-pending)} onHeal={() => applyHp(pending)} />
        </div>

        <SaveRoller combatant={c} />

        <div className="m-conds-card">
          <div className="m-section-label">conditions</div>
          <ConditionChips
            conditions={c.conditions}
            effects={c.effects || []}
            round={round}
            onAdd={addCond}
            onRemove={removeCond}
            onSetValue={setCondVal}
            onRemoveEffect={removeEffect}
          />
        </div>

        {c.notes && (
          <div className="m-card m-cbt-notes">
            <div className="m-section-label">notes</div>
            <p className="m-block-p">{c.notes}</p>
          </div>
        )}
      </div>

      <footer className="m-cbt-footer">
        <button className="m-foot-ghost" onClick={onBack}>back to list</button>
        <button className="m-foot-dark" onClick={onNext}>next in initiative</button>
      </footer>
    </div>
  );
}
