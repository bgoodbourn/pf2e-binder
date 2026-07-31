/* Character detail — read-only reference stat block for a PC or NPC. */
import { IconChevLeft } from "../parts/MobileIcons.jsx";
import { Collapsible } from "../parts/Collapsible.jsx";
import { characterDetail } from "../parts/characterModel.js";

function DefTile({ label, value }) {
  return (
    <div className="m-cd-def">
      <span className="m-def-label">{label}</span>
      <span className="m-cd-def-val">{value}</span>
    </div>
  );
}

export function CharacterDetailScreen({ kind, character, onBack }) {
  if (!character) return null;
  const d = characterDetail(kind, character);

  return (
    <div className="m-screen m-chardetail">
      <header className="m-header">
        <button className="m-back m-back-light" onClick={onBack}><IconChevLeft size={16} /> characters</button>
        <div className="m-cd-head">
          <span className="m-cd-tile">{d.initials}</span>
          <div className="m-cd-headmain">
            <h1 className="m-title m-title-sm">{d.name}</h1>
            <span className="m-cd-sub">{d.sub}</span>
          </div>
        </div>
        {d.traits.length > 0 && (
          <div className="m-cd-traits">{d.traits.map((t) => <span key={t} className="m-trait">{t}</span>)}</div>
        )}
      </header>

      <div className="m-body">
        {d.desc && <p className="m-block-p">{d.desc}</p>}

        <div className="m-card m-cd-defenses">
          <div className="m-section-label">defenses</div>
          <div className="m-cd-defgrid">
            <DefTile label="ac" value={d.ac} />
            <DefTile label="hp" value={d.hp} />
            <DefTile label="per" value={d.per} />
          </div>
          <div className="m-cd-saves">
            <DefTile label="fort" value={d.fort} />
            <DefTile label="ref" value={d.ref} />
            <DefTile label="will" value={d.will} />
          </div>
        </div>

        {d.abilities.length > 0 && (
          <Collapsible title="abilities">
            <div className="m-cd-abils">
              {d.abilities.map((a) => (
                <div className="m-cd-abil" key={a.k}>
                  <span className="m-cd-abil-mod">{a.mod}</span>
                  <span className="m-cd-abil-name">{a.k}</span>
                </div>
              ))}
            </div>
          </Collapsible>
        )}

        {d.skills.length > 0 && (
          <Collapsible title="skills" pill={d.skills.length}>
            <div className="m-chips">{d.skills.map((s, i) => <span key={i} className="m-chip m-chip-plain">{s}</span>)}</div>
          </Collapsible>
        )}

        {d.strikes.length > 0 && (
          <div className="m-card m-cd-lines">
            <div className="m-section-label">strikes</div>
            {d.strikes.map((s, i) => <div key={i} className="m-cd-line">{s}</div>)}
          </div>
        )}

        {d.details.length > 0 && (
          <div className="m-card m-cd-lines">
            <div className="m-section-label">details</div>
            {d.details.map((s, i) => <div key={i} className="m-cd-line">{s}</div>)}
          </div>
        )}

        {d.spells.length > 0 && (
          <Collapsible title="spells & reactions">
            {d.spells.map((s, i) => <div key={i} className="m-cd-line">{s}</div>)}
          </Collapsible>
        )}

        {d.special.length > 0 && (
          <Collapsible title="special">
            {d.special.map((s, i) => <div key={i} className="m-cd-line">{s}</div>)}
          </Collapsible>
        )}

        {d.notes && (
          <div className="m-card m-cd-lines">
            <div className="m-section-label">gm notes</div>
            <p className="m-block-p">{d.notes}</p>
          </div>
        )}
      </div>
    </div>
  );
}
