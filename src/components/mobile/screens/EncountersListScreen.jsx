/* Combat tab landing — the scenario's encounters. Tap a row to enter the
 * live initiative tracker. Reads the real overlay encounters. */
import { IconChevDown, IconMonitor, IconSwords } from "../parts/MobileIcons.jsx";

export function EncountersListScreen({
  campaignName, encounters, activeEncounterId,
  onOpen, onPrefill, onOpenScenarioPicker, onRequestDesktop, canPrefill,
}) {
  return (
    <div className="m-screen m-encounters">
      <header className="m-header">
        <div className="m-header-top">
          <button className="m-scen-switch" onClick={onOpenScenarioPicker}>
            {(campaignName || "scenario").toLowerCase()} · running order
            <IconChevDown size={13} />
          </button>
          <div className="m-header-actions">
            <button className="m-ghost-btn" onClick={onRequestDesktop} title="desktop view"><IconMonitor size={15} /></button>
          </div>
        </div>
        <h1 className="m-title">encounters</h1>
      </header>

      <div className="m-body">
        <div className="m-section-label">this scenario</div>
        {encounters.length === 0 && (
          <div className="m-empty">no encounters yet.</div>
        )}
        {encounters.map((e) => {
          const isActive = e.id === activeEncounterId;
          const round = e.round ?? 1;
          return (
            <button key={e.id} className={`m-enc-row ${isActive ? "active" : ""}`} onClick={() => onOpen(e.id)}>
              <span className="m-enc-icon"><IconSwords size={20} /></span>
              <span className="m-enc-main">
                <span className="m-enc-name">{e.name || "untitled"}</span>
                <span className="m-enc-sub">{e.combatants.length} combatants · round {round}</span>
              </span>
              <span className="m-enc-cta">{e.combatants.length ? "open" : "set up"}</span>
            </button>
          );
        })}

        {canPrefill && (
          <div className="m-enc-actions">
            <button className="m-add-row" onClick={onPrefill}>↡ prefill from scenario</button>
          </div>
        )}
      </div>
    </div>
  );
}
