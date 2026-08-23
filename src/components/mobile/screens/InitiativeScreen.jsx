/* Live initiative tracker — turn order for one encounter. "next turn"
 * advances the active actor (round bumps on wrap). Tap a combatant → card. */
import { IconChevLeft } from "../parts/MobileIcons.jsx";
import { HpBar, SidePill } from "../parts/combatBits.jsx";
import { sideOf } from "../parts/sides.js";

function Row({ c, active, onSelect }) {
  const s = sideOf(c);
  return (
    <button className={`m-init-row ${active ? "active" : ""}`} onClick={() => onSelect(c.id)}
      style={active ? undefined : { borderLeftColor: s.accent }}>
      <span className="m-init-num" style={active ? { background: "#0e0e0e", color: "#f5f5f3" } : undefined}>
        {c.init == null ? "—" : c.init}
      </span>
      <span className="m-init-main">
        <span className="m-init-name">{c.name} <SidePill c={c} /></span>
        <HpBar hp={c.hp} max={c.maxHp} />
        {(c.conditions?.length > 0 || c.effects?.length > 0) && (
          <span className="m-init-conds">
            {c.conditions?.map((cd) => (
              <span key={cd.id} className="m-cond-mini">{cd.name}{cd.value != null ? ` ${cd.value}` : ""}</span>
            ))}
            {c.effects?.map((e) => (
              <span key={e.id} className="m-cond-mini m-cond-fx">{e.name}</span>
            ))}
          </span>
        )}
      </span>
    </button>
  );
}

export function InitiativeScreen({ campaignName, round, ordered, activeId, onNextTurn, onSelect, onRollInitiative, onBack }) {
  const active = ordered.find((c) => c.id === activeId) || ordered[0] || null;
  const deck = ordered.filter((c) => c.id !== (active && active.id));

  return (
    <div className="m-screen m-initiative">
      <header className="m-header m-header-dark">
        <button className="m-back" onClick={onBack}><IconChevLeft size={16} /> encounters</button>
        <div className="m-init-headmain">
          <span className="m-init-campaign">{(campaignName || "encounter").toLowerCase()}</span>
          <span className="m-init-round">round {round}</span>
        </div>
        <button className="m-next-turn" onClick={onNextTurn}>next turn</button>
      </header>

      <div className="m-body">
        {ordered.length === 0 ? (
          <div className="m-empty">no combatants — add some from the desktop binder, then resume here.</div>
        ) : (
          <>
            {ordered.some((c) => c.init == null) && (
              <button className="m-roll-init" onClick={onRollInitiative}>roll initiative (npcs)</button>
            )}
            {active && (
              <>
                <div className="m-section-label">now acting</div>
                <Row c={active} active onSelect={onSelect} />
              </>
            )}
            {deck.length > 0 && (
              <>
                <div className="m-section-label">on deck</div>
                {deck.map((c) => <Row key={c.id} c={c} onSelect={onSelect} />)}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
