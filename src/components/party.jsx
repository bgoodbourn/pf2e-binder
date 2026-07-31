/* ==================================================================== *
 *  Party workspace components
 *
 *  The PC character sheet (one section at a time), the Pathbuilder importer
 *  / empty state, the generic auto-saving notes box, and the "new custom
 *  scenario" modal. Stat and NotesBox are shared leaves reused by the NPC
 *  sheet too.
 * ==================================================================== */
import { useState, useRef } from "react";
import { sign, ABILITIES, parseBuild } from "../lib/pf2e.js";
import { statblockFor } from "../lib/companions.js";
import { AON_BASE } from "../lib/aon.js";
import { Sym } from "./icons.jsx";
import { AonLink } from "./aonlink.jsx";
import { useAonIndex } from "./useAonIndex.js";
import { useCompanions } from "./useCompanions.js";

export function Stat({ label, value, sub }) {
  return (
    <div className="stat">
      <div className="stat-val">{value}</div>
      <div className="stat-label">{label}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

/* ---- animal companions ----
 * Pathbuilder only tells us the species and how far the companion has been
 * advanced; statblockFor does the per-level math against the base stat blocks
 * in companions.json. It returns null until those load (and for a species we
 * don't have), so both of these degrade to what Pathbuilder gave us. */
const tierChips = (pet) => [pet.tier, ...pet.specializations, pet.barding?.key !== "none" ? pet.barding.label : null].filter(Boolean);

function CompanionLine({ pet, level }) {
  const sb = statblockFor(pet, level);
  return (
    <div className="companion">
      <div className="companion-name">
        {pet.name}
        {pet.species && <span className="companion-species"> · {pet.tier} {pet.species.toLowerCase()}</span>}
      </div>
      {sb && <div className="companion-quick">ac {sb.ac} · hp {sb.hp} · per {sign(sb.perception.total)}</div>}
    </div>
  );
}

function CompanionSheet({ pet, level }) {
  const sb = statblockFor(pet, level);

  if (!sb)
    return (
      <div className="companion-block">
        <div className="pc-head">
          <Sym name="companion" className="article-sym" />
          <div className="pc-head-main">
            <div className="article-eyebrow">animal companion</div>
            <h2 className="article-title">{pet.name}</h2>
            <div className="pc-sub">{pet.tier}{pet.species ? ` ${pet.species.toLowerCase()}` : ""}</div>
          </div>
        </div>
        <div className="chips">{tierChips(pet).map((c) => <span key={c} className="chip ghost">{c}</span>)}</div>
        <p className="npc-desc">
          {pet.species ? `No stat block on file for a ${pet.species.toLowerCase()} — ` : "No species recorded — "}
          <AonLink kind="companion" name={pet.species || pet.name} />
        </p>
      </div>
    );

  return (
    <div className="companion-block">
      <div className="pc-head">
        <Sym name="companion" className="article-sym" />
        <div className="pc-head-main">
          <div className="article-eyebrow">animal companion{sb.mount ? " · mount" : ""}</div>
          <h2 className="article-title">{sb.name}</h2>
          <div className="pc-sub">
            <a className="alink" href={AON_BASE + sb.url} target="_blank" rel="noopener noreferrer">
              {sb.tier} {sb.species.toLowerCase()}
            </a>{" "}
            · {sb.size.toLowerCase()} · level {sb.level}
          </div>
        </div>
      </div>

      <div className="chips npc-traits">
        {sb.traits.map((t) => <span key={t} className="chip ghost">{t.toLowerCase()}</span>)}
      </div>

      {sb.summary && <p className="npc-desc">{sb.summary}</p>}

      <div className="stat-grid">
        <Stat label="armor class" value={sb.ac} sub={sb.acNote} />
        <Stat label="hit points" value={sb.hp} />
        <Stat label="perception" value={sign(sb.perception.total)} sub={sb.perception.rankName} />
      </div>

      <h3 className="sheet-h">saving throws</h3>
      <div className="row-list">
        {sb.saves.map((s) => (
          <div className="line" key={s.key}>
            <span className="line-name">{s.key}</span>
            <span className="rank">{s.rankName}</span>
            <span className="line-val">{sign(s.total)}</span>
          </div>
        ))}
      </div>

      <h3 className="sheet-h">abilities</h3>
      <div className="ability-grid">
        {ABILITIES.map(([k]) => (
          <div className="ability" key={k}>
            <div className="ability-mod">{sign(sb.mods[k])}</div>
            <div className="ability-name">{k}</div>
          </div>
        ))}
      </div>

      <h3 className="sheet-h">skills</h3>
      <div className="row-list">
        {sb.skills.map((s) => (
          <div className="line" key={s.key}>
            <span className="line-name"><AonLink kind="skill" name={s.key} /></span>
            <span className="rank">{s.rankName}</span>
            <span className="line-val">{sign(s.total)}</span>
          </div>
        ))}
      </div>

      <h3 className="sheet-h">strikes</h3>
      <div className="row-list">
        {sb.strikes.map((s, i) => (
          <div className="line wide" key={i}>
            <span className="line-name">
              {s.name}
              {s.traits.length > 0 && <span className="companion-traits"> ({s.traits.join(", ")})</span>}
            </span>
            <span className="line-val">{sign(s.attack)}</span>
            <span className="dmg">{s.damage} {s.type}</span>
          </div>
        ))}
      </div>

      <h3 className="sheet-h">details</h3>
      <dl className="kv">
        <div><dt>speed</dt><dd>{sb.speeds.map((s) => `${s.label === "speed" ? "" : `${s.label} `}${s.value} ft`).join(", ")}</dd></div>
        {sb.senses && <div><dt>senses</dt><dd>{sb.senses}</dd></div>}
        <div>
          <dt>barding</dt>
          <dd>{sb.barding.label}{sb.checkPenalty ? ` · ${sb.checkPenalty} to Acrobatics, Athletics, Stealth and Thievery` : ""}</dd>
        </div>
        {sb.special && <div><dt>special</dt><dd>{sb.special}</dd></div>}
      </dl>

      {sb.support && (
        <>
          <h3 className="sheet-h">support benefit</h3>
          <p className="sec-p">{sb.support}</p>
        </>
      )}

      {sb.advanced && (
        <>
          <h3 className="sheet-h">advanced maneuver</h3>
          <p className="sec-p">
            <AonLink kind="feat" name={sb.advanced} />
            {sb.tier === "mature" && <span className="companion-note"> — learned at nimble or savage</span>}
          </p>
        </>
      )}

      {sb.specializations.length > 0 && (
        <>
          <h3 className="sheet-h">specialization</h3>
          {sb.specializations.map((s) => (
            <div key={s.name} className="companion-spec">
              <div className="companion-spec-name">
                {s.url ? (
                  <a className="alink" href={AON_BASE + s.url} target="_blank" rel="noopener noreferrer">{s.name}</a>
                ) : s.name}
                {!s.known && <span className="companion-note"> — effects not applied above</span>}
              </div>
              {s.text && <p className="sec-p">{s.text}</p>}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

export function Sheet({ pc, section }) {
  // Only here to re-render the whole sheet once the AoN index lands, which
  // upgrades every AonLink below from a search fallback to a deep link.
  useAonIndex();
  // Same idea for the companion stat blocks.
  useCompanions();

  if (section === "overview")
    return (
      <>
        <div className="stat-grid">
          <Stat label="armor class" value={pc.ac.acTotal ?? "—"} sub={pc.ac.shieldBonus ? `+${pc.ac.shieldBonus} shield` : null} />
          <Stat label="hit points" value={pc.hp} />
          <Stat label="speed" value={`${pc.speed} ft`} />
          <Stat label="class dc" value={pc.classDC} sub={pc.classDCrank} />
          <Stat label="perception" value={sign(pc.perception.total)} sub={pc.perception.rank} />
        </div>

        <h3 className="sheet-h">identity</h3>
        <dl className="kv">
          <div><dt>ancestry</dt><dd><AonLink kind="ancestry" name={pc.ancestry} />{pc.heritage ? <> · <AonLink kind="heritage" name={pc.heritage} /></> : ""}</dd></div>
          <div><dt>background</dt><dd>{pc.background ? <AonLink kind="background" name={pc.background} /> : "—"}</dd></div>
          <div><dt>class</dt><dd><AonLink kind="class" name={pc.cls} />{pc.dualClass ? <> / <AonLink kind="class" name={pc.dualClass} /></> : ""} {pc.level}</dd></div>
          <div><dt>size</dt><dd>{pc.size || "—"}</dd></div>
          <div><dt>deity</dt><dd>{pc.deity ? <AonLink kind="deity" name={pc.deity} /> : "—"}</dd></div>
          <div><dt>alignment</dt><dd>{pc.alignment || "—"}</dd></div>
        </dl>

        {pc.languages.length > 0 && (
          <>
            <h3 className="sheet-h">languages</h3>
            <div className="chips">{pc.languages.map((l) => <AonLink key={l} className="chip" kind="language" name={l} />)}</div>
          </>
        )}

        {pc.specials.length > 0 && (
          <>
            <h3 className="sheet-h">features</h3>
            <div className="chips">{pc.specials.map((s) => <AonLink key={s} className="chip ghost" kind="classFeature" name={s} cls={pc.cls} />)}</div>
          </>
        )}
      </>
    );

  if (section === "abilities")
    return (
      <>
        <h3 className="sheet-h">ability scores</h3>
        <div className="ability-grid">
          {ABILITIES.map(([k]) => (
            <div className={`ability ${k === pc.keyAb ? "key" : ""}`} key={k}>
              <div className="ability-mod">{sign(pc.mods[k])}</div>
              <div className="ability-name">{k}</div>
              <div className="ability-score">{pc.scores[k]}</div>
              {k === pc.keyAb && <div className="ability-tag">key</div>}
            </div>
          ))}
        </div>

        <h3 className="sheet-h">saving throws</h3>
        <div className="row-list">
          {pc.saves.map((s) => (
            <div className="line" key={s.key}>
              <span className="line-name">{s.key}</span>
              <span className="rank">{s.rank}</span>
              <span className="line-val">{sign(s.total)}</span>
            </div>
          ))}
        </div>
      </>
    );

  if (section === "skills")
    return (
      <>
        <h3 className="sheet-h">skills</h3>
        <div className="row-list">
          {pc.skills.map((s) => (
            <div className={`line ${s.prof === 0 ? "untrained" : ""}`} key={s.key}>
              <span className="line-name"><AonLink kind="skill" name={s.key} /></span>
              <span className="ab-tag">{s.ab}</span>
              <span className="rank">{s.rank}</span>
              <span className="line-val">{sign(s.total)}</span>
            </div>
          ))}
        </div>
        {pc.lores.length > 0 && (
          <>
            <h3 className="sheet-h">lore</h3>
            <div className="row-list">
              {pc.lores.map((l) => (
                <div className="line" key={l.name}>
                  <span className="line-name">{l.name}</span>
                  <span className="rank">{l.rank}</span>
                  <span className="line-val">{sign(l.total)}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </>
    );

  if (section === "combat")
    return (
      <>
        <div className="stat-grid">
          <Stat label="armor class" value={pc.ac.acTotal ?? "—"} sub={pc.ac.shieldBonus ? `+${pc.ac.shieldBonus} shield` : null} />
          <Stat label="hit points" value={pc.hp} />
          {pc.casters[0] && <Stat label="spell dc" value={pc.casters[0].dc} sub={`spell atk ${sign(pc.casters[0].atk)}`} />}
        </div>

        <h3 className="sheet-h">strikes</h3>
        <div className="row-list">
          {pc.weapons.length === 0 && <div className="empty-line">no weapons</div>}
          {pc.weapons.map((w, i) => (
            <div className="line wide" key={i}>
              <span className="line-name"><AonLink kind="item" name={w.name} /></span>
              <span className="line-val">{w.attack != null ? sign(w.attack) : "—"}</span>
              <span className="dmg">
                {w.die}
                {w.dmgBonus ? ` ${sign(w.dmgBonus)}` : ""} {w.dmgType}
              </span>
            </div>
          ))}
        </div>

        <h3 className="sheet-h">armor</h3>
        <div className="row-list">
          {pc.armor.map((a, i) => (
            <div className="line" key={i}>
              <span className="line-name"><AonLink kind="item" name={a.name} /></span>
              {a.worn && <span className="rank">worn</span>}
              <span className="ab-tag">{a.prof}</span>
            </div>
          ))}
        </div>

        {pc.familiars.length > 0 && (
          <>
            <h3 className="sheet-h">familiar</h3>
            {pc.familiars.map((f, i) => (
              <div className="companion" key={i}>
                <div className="companion-name">{f.name}{f.species && f.species !== f.name ? <span className="companion-species"> · {f.species}</span> : null}</div>
                <div className="chips">{f.abilities.map((a) => <AonLink key={a} className="chip ghost" kind="familiarAbility" name={a} />)}</div>
              </div>
            ))}
          </>
        )}
        {(pc.pets.length > 0 || pc.otherPets.length > 0) && (
          <>
            <h3 className="sheet-h">companions</h3>
            {pc.pets.map((p, i) => <CompanionLine key={i} pet={p} level={pc.level} />)}
            {pc.otherPets.map((p, i) => (
              <div className="companion" key={`o${i}`}><div className="companion-name">{p.name}</div></div>
            ))}
          </>
        )}
      </>
    );

  if (section === "companion") {
    // The nav pill only appears for a PC that has one, but the section can
    // survive a switch to a character that doesn't.
    if (pc.pets.length === 0) return <div className="empty-line">this character has no animal companion.</div>;
    return <>{pc.pets.map((p, i) => <CompanionSheet key={i} pet={p} level={pc.level} />)}</>;
  }

  if (section === "feats")
    return (
      <>
        <h3 className="sheet-h">feats</h3>
        <div className="row-list">
          {pc.feats.map((f, i) => (
            <div className="line wide" key={i}>
              <span className="line-name"><AonLink kind="feat" name={f.name} cls={pc.cls} /></span>
              <span className="ab-tag">{f.type.toLowerCase()}</span>
              {f.level && <span className="rank">lvl {f.level}</span>}
            </div>
          ))}
        </div>
      </>
    );

  if (section === "spells") {
    if (pc.casters.length === 0 && !pc.focus)
      return <div className="empty-line">this character has no spellcasting.</div>;
    return (
      <>
        {pc.casters.map((c, ci) => (
          <div key={ci} className="caster">
            <div className="caster-head">
              <span className="caster-name">{c.name}</span>
              <span className="chip">{c.tradition}</span>
              <span className="chip ghost">{c.type}</span>
              <span className="caster-dc">dc {c.dc} · atk {sign(c.atk)}</span>
            </div>
            {(c.prepared.length ? c.prepared : c.known).map((g) => (
              <div className="spell-tier" key={g.level}>
                <div className="spell-rank">
                  {g.level === 0 ? "cantrips" : `rank ${g.level}`}
                  {c.perDay[g.level] > 0 && g.level > 0 && <span className="slots"> · {c.perDay[g.level]} slots</span>}
                </div>
                <div className="chips">{g.list.map((s, i) => <AonLink key={i} className="chip" kind="spell" name={s} />)}</div>
              </div>
            ))}
            {c.prepared.length > 0 && c.known.length > 0 && (
              <details className="known">
                <summary>spellbook · {c.known.reduce((n, g) => n + g.list.length, 0)} spells</summary>
                {c.known.map((g) => (
                  <div className="spell-tier" key={g.level}>
                    <div className="spell-rank">{g.level === 0 ? "cantrips" : `rank ${g.level}`}</div>
                    <div className="chips">{g.list.map((s, i) => <AonLink key={i} className="chip ghost" kind="spell" name={s} />)}</div>
                  </div>
                ))}
              </details>
            )}
          </div>
        ))}

        {pc.focus && (
          <div className="caster">
            <div className="caster-head">
              <span className="caster-name">focus spells</span>
              <span className="focus-pool" aria-label={`${pc.focus.points} focus points`}>
                {Array.from({ length: Math.max(pc.focus.points, 1) }).map((_, i) => <span key={i} className="fp" />)}
              </span>
            </div>
            {pc.focus.cantrips.length > 0 && (
              <div className="spell-tier"><div className="spell-rank">focus cantrips</div>
                <div className="chips">{pc.focus.cantrips.map((s) => <AonLink key={s} className="chip" kind="spell" name={s} />)}</div></div>
            )}
            {pc.focus.spells.length > 0 && (
              <div className="spell-tier"><div className="spell-rank">focus spells</div>
                <div className="chips">{pc.focus.spells.map((s) => <AonLink key={s} className="chip" kind="spell" name={s} />)}</div></div>
            )}
          </div>
        )}
      </>
    );
  }

  if (section === "gear")
    return (
      <>
        <h3 className="sheet-h">coins</h3>
        <div className="coins">
          {["pp", "gp", "sp", "cp"].map((c) => (
            <div className="coin" key={c}><span className="coin-n">{pc.money[c] || 0}</span><span className="coin-l">{c}</span></div>
          ))}
        </div>
        <h3 className="sheet-h">inventory</h3>
        <div className="row-list">
          {pc.equipment.length === 0 && <div className="empty-line">no items</div>}
          {pc.equipment.map((e, i) => (
            <div className="line" key={i}>
              <span className="line-name"><AonLink kind="item" name={e.name} /></span>
              {e.qty > 1 && <span className="rank">×{e.qty}</span>}
            </div>
          ))}
        </div>
      </>
    );

  return null;
}

/* ------------------------- import / empty state -------------------- */
export function Importer({ onAdd, busy, error }) {
  const [json, setJson] = useState("");
  const [idval, setIdval] = useState("");

  const loadJson = () => {
    try {
      onAdd(parseBuild(json.trim()), null);
    } catch {
      onAdd(null, "couldn't read that JSON — make sure you copied the whole thing.");
    }
  };
  const idFrom = (v) => {
    const m = String(v).match(/(\d{4,})/);
    return m ? m[1] : null;
  };

  return (
    <div className="importer">
      <Sym name="party" className="import-sym" />
      <h2 className="import-title">add a character</h2>
      <p className="import-lead">
        In Pathbuilder 2e: <strong>Export Character → Export to Foundry VTT (JSON)</strong>. You get a 6-digit number — paste
        it below to auto-fetch, or paste the full JSON directly (always works).
      </p>

      <div className="import-row">
        <input
          className="import-input"
          placeholder="6-digit id or json.php link"
          value={idval}
          onChange={(e) => setIdval(e.target.value)}
        />
        <button className="btn" disabled={busy || !idFrom(idval)} onClick={() => onAdd("FETCH", idFrom(idval))}>
          {busy ? "fetching…" : "auto-fetch →"}
        </button>
      </div>

      <div className="import-or">or paste json</div>

      <textarea
        className="import-text"
        placeholder='{"success":true,"build":{ … }}'
        value={json}
        onChange={(e) => setJson(e.target.value)}
        rows={5}
      />
      <button className="btn block" disabled={!json.trim()} onClick={loadJson}>load from json</button>

      {error && <div className="import-error">{error}</div>}
      <p className="import-note">
        auto-fetch routes through a public CORS proxy and can fail (rate limits, proxy downtime). pasting the JSON never
        depends on the network.
      </p>
    </div>
  );
}

export function NotesBox({ value, onChange }) {
  const [status, setStatus] = useState("saved");
  const t = useRef(null);
  const handle = (v) => {
    onChange(v);
    setStatus("saving");
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(() => setStatus("saved"), 600);
  };
  return (
    <div className="notes-box">
      <div className="notes-head">
        <span>notes</span>
        <span className="notes-status">{status === "saving" ? "saving…" : "saved"}</span>
      </div>
      <textarea
        className="notes-area"
        value={value || ""}
        placeholder="jot notes…"
        onChange={(e) => handle(e.target.value)}
        onBlur={() => setStatus("saved")}
      />
    </div>
  );
}

/* create a blank custom scenario: just a title */
export function NewScenario({ onCreate, onClose }) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = title.trim();
  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    await onCreate(title.trim());
  };
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card narrow" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3 className="modal-title">new custom scenario</h3>
          <button className="modal-x" onClick={onClose} aria-label="close">×</button>
        </div>
        <label className="field span2"><span>title <i>*</i></span>
          <input
            className="inp"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="e.g. My Homebrew Campaign"
            autoFocus
          />
        </label>
        <p className="import-note" style={{ marginTop: 12 }}>
          Starts empty — add your own characters, NPCs, and encounters. Scenario notes can be generated later.
        </p>
        <div className="modal-foot">
          <button className="mini" onClick={onClose}>cancel</button>
          <button className="btn" disabled={!valid || busy} onClick={submit}>{busy ? "creating…" : "create"}</button>
        </div>
      </div>
    </div>
  );
}
