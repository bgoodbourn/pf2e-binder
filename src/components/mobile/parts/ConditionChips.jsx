/* Condition chips with add-picker + drag-to-set-value gesture, plus read-only
 * chips for GM-authored custom effects (authored on desktop). Reuses the real
 * CONDITIONS / VALUED tables and the combatant condition shape
 * { id, name, value, sinceRound }. ~20px of vertical drag = one step, clamped 1–9. */
import { useState, useRef } from "react";
import { CONDITIONS, VALUED, conditionTip, effectTip, roundsUnchanged } from "../../../lib/conditions.js";
import { haptic } from "./haptic.js";
import { IconClose, IconPlus } from "./MobileIcons.jsx";

/* One dot per round the chip has held its current state, three max then a "+".
 * pointer-events:none keeps the dots out of the drag gesture. */
function AgeDots({ n }) {
  if (n == null || n < 1) return null;
  return (
    <span className="cond-age" aria-label={`unchanged for ${n} round${n === 1 ? "" : "s"}`}>
      {Array.from({ length: Math.min(n, 3) }, (_, i) => <span key={i} className="cond-age-dot" />)}
      {n > 3 && <span className="cond-age-more">+</span>}
    </span>
  );
}

function ValueChip({ cond, round, onRemove, onSetValue }) {
  const drag = useRef(null);
  const valued = cond.value != null;
  const age = roundsUnchanged(cond, round);

  const onDown = (e) => {
    if (!valued) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    drag.current = { startY: e.clientY, startVal: cond.value, lastVal: cond.value };
  };
  const onMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const steps = Math.round((d.startY - e.clientY) / 20);
    const nv = Math.max(1, Math.min(9, d.startVal + steps));
    if (nv !== d.lastVal) { d.lastVal = nv; haptic(6); onSetValue(cond.id, nv); }
  };
  const onUp = () => { drag.current = null; };

  return (
    <span
      className={`m-cond-chip ${valued ? "valued" : ""}`}
      title={conditionTip(cond, age)}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      style={{ touchAction: valued ? "none" : "auto" }}
    >
      {cond.name}{valued ? ` ${cond.value}` : ""}
      <AgeDots n={age} />
      {valued && <span className="m-cond-updown">↕</span>}
      <button className="m-cond-x" onClick={() => onRemove(cond.id)} aria-label={`remove ${cond.name}`}>
        <IconClose size={12} />
      </button>
    </span>
  );
}

export function ConditionChips({ conditions = [], effects = [], round, onAdd, onRemove, onSetValue, onRemoveEffect }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const applied = new Set(conditions.map((c) => c.name));
  const options = CONDITIONS.filter((n) => !applied.has(n));

  return (
    <div className="m-conds">
      <div className="m-conds-row">
        {conditions.map((c) => (
          <ValueChip key={c.id} cond={c} round={round} onRemove={onRemove} onSetValue={onSetValue} />
        ))}
        {effects.map((e) => {
          const age = roundsUnchanged(e, round);
          return (
            <span key={e.id} className="m-cond-chip m-cond-fx" title={effectTip(e, age)}>
              <span className="cond-fx-dot" aria-hidden />
              {e.name}
              <AgeDots n={age} />
              <button className="m-cond-x" onClick={() => onRemoveEffect(e.id)} aria-label={`remove ${e.name}`}>
                <IconClose size={12} />
              </button>
            </span>
          );
        })}
        <button className="m-cond-add" onClick={() => setMenuOpen((v) => !v)}>
          <IconPlus size={13} /> condition
        </button>
      </div>
      {conditions.some((c) => c.value != null) && (
        <div className="m-conds-hint">drag a value ↕ to adjust</div>
      )}
      {menuOpen && (
        <div className="m-condmenu">
          {options.map((n) => (
            <button
              key={n}
              className="m-condmenu-item"
              onClick={() => { haptic(8); onAdd(n, VALUED.has(n)); setMenuOpen(false); }}
            >
              {n}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
