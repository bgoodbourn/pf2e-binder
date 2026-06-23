import { useState, useEffect, useMemo, useCallback, useRef, createContext, useContext } from "react";
import { ScenarioProvider, useScenarioData } from "./data/ScenarioContext.jsx";

/* ------------------------------------------------------------------ *
 *  Persistence
 *
 *  Scenario base content + the user overlay are loaded and saved through
 *  the data layer (IndexedDB runtime store + Supabase background sync),
 *  surfaced to the UI via ScenarioContext. The data layer installs an
 *  IndexedDB-backed window.storage on boot.
 * ------------------------------------------------------------------ */

/* ==================================================================== *
 *  Campaign Binder — Pathfinder Society
 *
 *  One artifact, two linked workspaces:
 *    • party     — PC manager (ingests Pathbuilder 2e JSON)
 *    • scenario  — GM scenario notes ("The Second Confirmation")
 *
 *  Cross-artifact links aren't possible in the sandbox (each artifact
 *  is an isolated iframe), so both tools live here and the "links"
 *  between them are real in-app navigation via the workspace switch.
 *
 *  Pathbuilder ingest:
 *    Export Character → Export to Foundry VTT (JSON) gives a 6-digit id,
 *    served at https://pathbuilder2e.com/json.php?id=XXXXXX (JSON).
 *    That endpoint has no CORS headers, so in-browser auto-fetch is
 *    best-effort via a proxy and ALWAYS falls back to pasting the JSON.
 *
 *  Persistence: the data layer (see src/data) stores raw Pathbuilder builds
 *    in the per-scenario overlay and re-parses on load, so future parser
 *    changes never orphan saved characters. Legacy localStorage keys are
 *    migrated once into the overlay on first run.
 * ==================================================================== */

/* ----------------------------- PF2e math --------------------------- */
const amod = (s) => Math.floor((Number(s || 10) - 10) / 2);
const sign = (n) => (n >= 0 ? `+${n}` : `${n}`);
const RANK = { 0: "untrained", 2: "trained", 4: "expert", 6: "master", 8: "legendary" };
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

const ABILITIES = [
  ["str", "strength"],
  ["dex", "dexterity"],
  ["con", "constitution"],
  ["int", "intelligence"],
  ["wis", "wisdom"],
  ["cha", "charisma"],
];

const SKILLS = [
  ["acrobatics", "dex"],
  ["arcana", "int"],
  ["athletics", "str"],
  ["crafting", "int"],
  ["deception", "cha"],
  ["diplomacy", "cha"],
  ["intimidation", "cha"],
  ["medicine", "wis"],
  ["nature", "wis"],
  ["occultism", "int"],
  ["performance", "cha"],
  ["religion", "wis"],
  ["society", "int"],
  ["stealth", "dex"],
  ["survival", "wis"],
  ["thievery", "dex"],
];

/* --------------------- normalize a Pathbuilder build ---------------- */
function parseBuild(input) {
  let raw = input;
  if (typeof input === "string") raw = JSON.parse(input);
  const b = raw && raw.build ? raw.build : raw;
  if (!b || !b.abilities) throw new Error("not a pathbuilder character");

  const level = Number(b.level || 1);
  const A = b.abilities;
  const mods = {};
  ABILITIES.forEach(([k]) => (mods[k] = amod(A[k])));
  const prof = b.proficiencies || {};
  const itemMods = b.mods || {};

  const trained = (p, abilityKey, extraItem = 0) => {
    const ab = mods[abilityKey] || 0;
    const base = p > 0 ? level + p : 0;
    return ab + base + extraItem;
  };

  // skills
  const skills = SKILLS.map(([key, ab]) => {
    const p = Number(prof[key] || 0);
    const item = (itemMods[cap(key)] && itemMods[cap(key)]["Item Bonus"]) || 0;
    return { key, ab, prof: p, rank: RANK[p] || "untrained", total: trained(p, ab, item), item };
  });

  // lores (int-based)
  const lores = (b.lores || []).map(([name, p]) => ({
    name: `${name} lore`,
    prof: Number(p || 0),
    rank: RANK[Number(p || 0)] || "untrained",
    total: trained(Number(p || 0), "int"),
  }));

  // saves + perception
  const sv = (key, ab) => {
    const p = Number(prof[key] || 0);
    return { key, prof: p, rank: RANK[p] || "untrained", total: trained(p, ab) };
  };
  const saves = [sv("fortitude", "con"), sv("reflex", "dex"), sv("will", "wis")];
  const perception = sv("perception", "wis");

  // hp
  const at = b.attributes || {};
  const hp =
    Number(at.ancestryhp || 0) +
    (Number(at.classhp || 0) + mods.con) * level +
    Number(at.bonushp || 0) +
    Number(at.bonushpPerLevel || 0) * level;

  // class dc
  const keyAb = b.keyability || "str";
  const classDCprof = Number(prof.classDC || 0);
  const classDC = 10 + (classDCprof > 0 ? level + classDCprof : 0) + (mods[keyAb] || 0);

  // weapons / armor
  const weapons = (b.weapons || []).map((w) => ({
    name: w.display || w.name,
    attack: typeof w.attack === "number" ? w.attack : null,
    die: w.die,
    dmgType: w.damageType,
    dmgBonus: Number(w.damageBonus || 0),
    prof: w.prof,
    extra: w.extraDamage || [],
  }));
  const armor = (b.armor || []).map((a) => ({
    name: a.display || a.name,
    prof: a.prof,
    worn: !!a.worn,
  }));
  const ac = b.acTotal || {};

  // spellcasters
  const casters = (b.spellCasters || []).map((c) => {
    const cp = Number(c.proficiency || 0);
    const ab = c.ability || "int";
    const dc = 10 + (cp > 0 ? level + cp : 0) + (mods[ab] || 0);
    const atk = (cp > 0 ? level + cp : 0) + (mods[ab] || 0);
    const byLevel = (arr) =>
      (arr || [])
        .slice()
        .sort((x, y) => (x.spellLevel || 0) - (y.spellLevel || 0))
        .map((g) => ({ level: g.spellLevel || 0, list: g.list || [] }))
        .filter((g) => g.list.length);
    return {
      name: c.name,
      tradition: c.magicTradition,
      type: c.spellcastingType,
      ability: ab,
      dc,
      atk,
      perDay: c.perDay || [],
      prepared: byLevel(c.prepared),
      known: byLevel(c.spells),
    };
  });

  // focus
  let focus = null;
  if (b.focus && typeof b.focus === "object") {
    const cantrips = [];
    const spells = [];
    Object.values(b.focus).forEach((trad) =>
      Object.values(trad).forEach((entry) => {
        (entry.focusCantrips || []).forEach((s) => cantrips.push(s));
        (entry.focusSpells || []).forEach((s) => spells.push(s));
      })
    );
    if (cantrips.length || spells.length || b.focusPoints)
      focus = { points: Number(b.focusPoints || 0), cantrips, spells };
  }

  // feats
  const feats = (b.feats || []).map((f) => ({
    name: f[0],
    type: f[2] || "feat",
    level: f[3] || null,
  }));

  // gear
  const equipment = (b.equipment || []).map((e) => ({ name: e[0], qty: Number(e[1] || 1) }));
  const money = b.money || {};

  const familiars = (b.familiars || []).map((f) => ({
    name: f.name || f.type,
    abilities: f.abilities || [],
  }));
  const pets = (b.pets || []).map((p) => ({ name: p.name || p.type || "companion" }));

  return {
    id: `${b.name}-${b.class}-${level}`.toLowerCase().replace(/\s+/g, "-"),
    name: b.name || "unnamed",
    cls: b.class,
    dualClass: b.dualClass,
    level,
    ancestry: b.ancestry,
    heritage: b.heritage,
    background: b.background,
    alignment: b.alignment,
    size: b.sizeName,
    deity: b.deity,
    keyAb,
    speed: Number(at.speed || 0) + Number(at.speedBonus || 0),
    languages: b.languages || [],
    rituals: b.rituals || [],
    specials: b.specials || [],
    mods,
    scores: ABILITIES.reduce((o, [k]) => ((o[k] = A[k]), o), {}),
    skills,
    lores,
    saves,
    perception,
    hp,
    ac,
    classDC,
    classDCrank: RANK[classDCprof] || "untrained",
    weapons,
    armor,
    casters,
    focus,
    feats,
    equipment,
    money,
    familiars,
    pets,
    raw,
  };
}

/* ----------------------------- icons ------------------------------- */
function Sym({ name, className }) {
  const p = { viewBox: "0 0 40 40", className, "aria-hidden": true };
  switch (name) {
    case "party":
      return (
        <svg {...p}>
          <circle cx="14" cy="14" r="6" />
          <circle cx="27" cy="17" r="4.6" />
          <path d="M4 34c0-6 4.6-9.5 10-9.5S24 28 24 34z" />
          <path d="M23 34c.4-4.6 3.4-7.4 7.2-7.4 3.6 0 6.3 2.6 6.8 7.4z" />
        </svg>
      );
    case "scenario":
      return (
        <svg {...p}>
          <path d="M19 11C13.5 8.2 8 8.2 4 10.4v18.4c4-2.2 9.5-2.2 15 .6z" />
          <path d="M21 11c5.5-2.8 11-2.8 15-.6v18.4c-4-2.2-9.5-2.2-15 .6z" />
        </svg>
      );
    case "overview":
      return (
        <svg {...p}>
          <path d="M20 2.5l4.6 12.9L37.5 20l-12.9 4.6L20 37.5l-4.6-12.9L2.5 20l12.9-4.6z" />
        </svg>
      );
    case "abilities":
      return (
        <svg {...p}>
          <circle cx="20" cy="20" r="13" fill="none" stroke="currentColor" strokeWidth="2.6" />
          <circle cx="20" cy="20" r="5" />
        </svg>
      );
    case "skills":
      return (
        <svg {...p}>
          <rect x="6" y="9" width="28" height="4.2" rx="2.1" />
          <rect x="6" y="18" width="20" height="4.2" rx="2.1" />
          <rect x="6" y="27" width="24" height="4.2" rx="2.1" />
        </svg>
      );
    case "combat":
      return (
        <svg {...p}>
          <path d="M20 3l13 5v9c0 9-5.6 15-13 20C12.6 32 7 26 7 17V8z" />
        </svg>
      );
    case "gmnotes":
      return (
        <svg {...p}>
          <rect x="9" y="5.5" width="22" height="29" rx="3.4" fill="none" stroke="currentColor" strokeWidth="2.6" />
          <path d="M14 14h12M14 20h12M14 26h8" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
        </svg>
      );
    case "feats":
      return (
        <svg {...p}>
          <path d="M20 4l4 11h11l-9 7 3.4 11L20 27l-9.4 6L14 22l-9-7h11z" />
        </svg>
      );
    case "spells":
      return (
        <svg {...p}>
          <circle cx="20" cy="20" r="5.4" />
          <circle cx="20" cy="6" r="2.4" />
          <circle cx="20" cy="34" r="2.4" />
          <circle cx="6" cy="20" r="2.4" />
          <circle cx="34" cy="20" r="2.4" />
          <circle cx="10" cy="10" r="2" />
          <circle cx="30" cy="30" r="2" />
        </svg>
      );
    case "gear":
      return (
        <svg {...p}>
          <path d="M14 6h12l-1.5 7h-9z" />
          <rect x="8" y="13" width="24" height="21" rx="4" />
        </svg>
      );
    default:
      return <svg {...p}><circle cx="20" cy="20" r="6" /></svg>;
  }
}

/* ================================================================== *
 *  PARTY WORKSPACE — PC manager
 * ================================================================== */

const SHEET_NAV = [
  { id: "overview", label: "overview", sym: "overview" },
  { id: "abilities", label: "abilities", sym: "abilities" },
  { id: "skills", label: "skills & lore", sym: "skills" },
  { id: "combat", label: "combat", sym: "combat" },
  { id: "feats", label: "feats & features", sym: "feats" },
  { id: "spells", label: "spells", sym: "spells" },
  { id: "gear", label: "gear", sym: "gear" },
];

function Stat({ label, value, sub }) {
  return (
    <div className="stat">
      <div className="stat-val">{value}</div>
      <div className="stat-label">{label}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

function Sheet({ pc, section }) {
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
          <div><dt>ancestry</dt><dd>{pc.ancestry}{pc.heritage ? ` · ${pc.heritage}` : ""}</dd></div>
          <div><dt>background</dt><dd>{pc.background || "—"}</dd></div>
          <div><dt>class</dt><dd>{pc.cls}{pc.dualClass ? ` / ${pc.dualClass}` : ""} {pc.level}</dd></div>
          <div><dt>size</dt><dd>{pc.size || "—"}</dd></div>
          <div><dt>deity</dt><dd>{pc.deity || "—"}</dd></div>
          <div><dt>alignment</dt><dd>{pc.alignment || "—"}</dd></div>
        </dl>

        {pc.languages.length > 0 && (
          <>
            <h3 className="sheet-h">languages</h3>
            <div className="chips">{pc.languages.map((l) => <span key={l} className="chip">{l}</span>)}</div>
          </>
        )}

        {pc.specials.length > 0 && (
          <>
            <h3 className="sheet-h">features</h3>
            <div className="chips">{pc.specials.map((s) => <span key={s} className="chip ghost">{s}</span>)}</div>
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
              <span className="line-name">{s.key}</span>
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
              <span className="line-name">{w.name}</span>
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
              <span className="line-name">{a.name}</span>
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
                <div className="companion-name">{f.name}</div>
                <div className="chips">{f.abilities.map((a) => <span key={a} className="chip ghost">{a}</span>)}</div>
              </div>
            ))}
          </>
        )}
        {pc.pets.length > 0 && (
          <>
            <h3 className="sheet-h">companions</h3>
            {pc.pets.map((p, i) => <div className="companion" key={i}><div className="companion-name">{p.name}</div></div>)}
          </>
        )}
      </>
    );

  if (section === "feats")
    return (
      <>
        <h3 className="sheet-h">feats</h3>
        <div className="row-list">
          {pc.feats.map((f, i) => (
            <div className="line wide" key={i}>
              <span className="line-name">{f.name}</span>
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
                <div className="chips">{g.list.map((s, i) => <span key={i} className="chip">{s}</span>)}</div>
              </div>
            ))}
            {c.prepared.length > 0 && c.known.length > 0 && (
              <details className="known">
                <summary>spellbook · {c.known.reduce((n, g) => n + g.list.length, 0)} spells</summary>
                {c.known.map((g) => (
                  <div className="spell-tier" key={g.level}>
                    <div className="spell-rank">{g.level === 0 ? "cantrips" : `rank ${g.level}`}</div>
                    <div className="chips">{g.list.map((s, i) => <span key={i} className="chip ghost">{s}</span>)}</div>
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
                <div className="chips">{pc.focus.cantrips.map((s) => <span key={s} className="chip">{s}</span>)}</div></div>
            )}
            {pc.focus.spells.length > 0 && (
              <div className="spell-tier"><div className="spell-rank">focus spells</div>
                <div className="chips">{pc.focus.spells.map((s) => <span key={s} className="chip">{s}</span>)}</div></div>
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
              <span className="line-name">{e.name}</span>
              {e.qty > 1 && <span className="rank">×{e.qty}</span>}
            </div>
          ))}
        </div>
      </>
    );

  return null;
}

/* ------------------------- import / empty state -------------------- */
function Importer({ onAdd, busy, error }) {
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

/* ================================================================== *
 *  NPCS — key scenario NPCs (stat block for Rain; identity + "?" for
 *  the rest, who have no combat block in the adventure).
 * ================================================================== */
/* SCENARIO_MAP_IMAGES: loaded at runtime from the scenario data layer */

/* SCENARIO_MAPS: loaded at runtime from the scenario data layer */

/* SCENARIO_NPCS: loaded at runtime from the scenario data layer */

function groupNpcs(list) {
  const order = [];
  const map = {};
  list.forEach((n) => {
    const g = n.group || "npcs";
    if (!map[g]) { map[g] = { label: g, items: [] }; order.push(map[g]); }
    map[g].items.push(n);
  });
  // always surface an "npcs" group so the "add npc" button is reachable,
  // even for a blank custom scenario with no NPCs yet
  if (!map["npcs"]) order.push({ label: "npcs", items: [] });
  return order;
}

function NotesBox({ value, onChange }) {
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
function NewScenario({ onCreate, onClose }) {
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

/* parse helpers for the full-npc form */
const npcNum = (s) => {
  const t = (s || "").trim();
  if (!t) return null;
  const n = parseInt(t, 10);
  return Number.isNaN(n) ? null : n;
};
const npcList = (s) => (s || "").split(",").map((x) => x.trim()).filter(Boolean);
const npcLines = (s) => (s || "").split(/[;\n]/).map((x) => x.trim()).filter(Boolean);
const npcSkills = (s) =>
  npcList(s).map((item) => {
    const m = item.match(/^(.*?)\s*([+-]\d+)\s*$/);
    return m ? [m[1].trim(), parseInt(m[2], 10)] : [item, 0];
  });

const NPC_ABILS = ["str", "dex", "con", "int", "wis", "cha"];

/* add NPC: two modes — quick (name + description) or full stat block */
function AddNpc({ onAdd, onClose }) {
  const [mode, setMode] = useState("quick");
  const [f, setF] = useState({
    name: "", ancestry: "", source: "", description: "", tactics: "",
    level: "", ac: "", hp: "", perception: "", fort: "", ref: "", will: "",
    traits: "", skills: "", speed: "", languages: "", strikes: "", spells: "",
    str: "", dex: "", con: "", int: "", wis: "", cha: "",
  });
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const valid = f.name.trim();

  const submit = () => {
    if (!valid) return;
    if (mode === "quick") {
      onAdd({ name: f.name.trim(), ancestry: f.ancestry.trim(), description: f.description.trim() });
    } else {
      const traits = npcList(f.traits);
      const ancestry = f.ancestry.trim();
      if (ancestry && !traits.some((t) => t.toLowerCase() === ancestry.toLowerCase())) traits.unshift(ancestry);
      const anyAb = NPC_ABILS.some((k) => f[k].trim());
      onAdd({
        name: f.name.trim(),
        ancestry,
        traits,
        source: f.source.trim(),
        description: f.description.trim(),
        notes: f.tactics.trim(),
        level: npcNum(f.level),
        ac: npcNum(f.ac), hp: npcNum(f.hp), perception: npcNum(f.perception),
        fort: npcNum(f.fort), ref: npcNum(f.ref), will: npcNum(f.will),
        abilities: anyAb ? Object.fromEntries(NPC_ABILS.map((k) => [k, npcNum(f[k]) ?? 0])) : null,
        skills: npcSkills(f.skills),
        speed: f.speed.trim(),
        languages: npcList(f.languages),
        attacks: npcLines(f.strikes),
        spells: npcLines(f.spells),
      });
    }
    onClose();
  };

  const tabStyle = { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 1, padding: "9px 14px", borderRadius: 9 };
  const groupHead = { fontSize: 10.5, letterSpacing: ".04em", textTransform: "lowercase", color: "var(--faint)", margin: "2px 0 9px" };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" style={{ maxWidth: 580, maxHeight: "88vh", display: "flex", flexDirection: "column", padding: 0, overflow: "hidden" }} onClick={(e) => e.stopPropagation()}>
        {/* head + mode toggle */}
        <div style={{ padding: "22px 24px 14px" }}>
          <div className="modal-head" style={{ marginBottom: 14 }}>
            <h3 className="modal-title" style={{ flex: 1 }}>add npc</h3>
            <button className="modal-x" onClick={onClose} aria-label="close">×</button>
          </div>
          <div className="toggle" style={{ borderRadius: 13, padding: 5, gap: 5 }}>
            <button className={`toggle-opt${mode === "quick" ? " on" : ""}`} style={tabStyle} onClick={() => setMode("quick")}>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>name + description</span>
              <span style={{ fontSize: 11, fontWeight: 400, color: "var(--faint)" }}>quick npc</span>
            </button>
            <button className={`toggle-opt${mode === "full" ? " on" : ""}`} style={tabStyle} onClick={() => setMode("full")}>
              <span style={{ fontSize: 13.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}><span style={{ color: "var(--accent)" }}>✦</span>full details</span>
              <span style={{ fontSize: 11, fontWeight: 400, color: "var(--faint)" }}>full npc</span>
            </button>
          </div>
        </div>

        {/* body */}
        <div style={{ overflowY: "auto", padding: "6px 24px 10px", flex: 1 }}>
          {mode === "quick" ? (
            <>
              <div className="form-grid name-row">
                <label className="field"><span>name <i>*</i></span><input className="inp" value={f.name} onChange={set("name")} placeholder="e.g. themolin" autoFocus /></label>
                <label className="field"><span>ancestry</span><input className="inp" value={f.ancestry} onChange={set("ancestry")} placeholder="e.g. human" /></label>
              </div>
              <label className="field span2" style={{ marginTop: 14 }}><span>description</span><textarea className="inp area" rows={4} value={f.description} onChange={set("description")} placeholder="who they are, what the party knows…" /></label>
            </>
          ) : (
            <>
              <div className="form-grid name-row">
                <label className="field"><span>name <i>*</i></span><input className="inp" value={f.name} onChange={set("name")} autoFocus /></label>
                <label className="field"><span>creature lvl</span><input className="inp" type="number" value={f.level} onChange={set("level")} placeholder="3" /></label>
              </div>
              <div className="form-grid name-row" style={{ marginTop: 12 }}>
                <label className="field"><span>ancestry</span><input className="inp" value={f.ancestry} onChange={set("ancestry")} placeholder="human" /></label>
                <label className="field"><span>source</span><input className="inp" value={f.source} onChange={set("source")} placeholder="appendix p.21" /></label>
              </div>
              <label className="field span2" style={{ marginTop: 12 }}><span>traits</span><input className="inp" value={f.traits} onChange={set("traits")} placeholder="unique, le, medium, human, humanoid" /></label>
              <label className="field span2" style={{ marginTop: 12 }}><span>description</span><textarea className="inp area" rows={3} value={f.description} onChange={set("description")} placeholder="who they are, what the party knows…" /></label>
              <label className="field span2" style={{ marginTop: 12 }}><span>role / tactics</span><textarea className="inp area" rows={2} value={f.tactics} onChange={set("tactics")} placeholder="how they behave in a scene or fight…" /></label>

              <div style={{ ...groupHead, marginTop: 18 }}>combat stats</div>
              <div className="form-grid three">
                <label className="field"><span>armor class</span><input className="inp" value={f.ac} onChange={set("ac")} placeholder="17" /></label>
                <label className="field"><span>hit points</span><input className="inp" value={f.hp} onChange={set("hp")} placeholder="31" /></label>
                <label className="field"><span>perception</span><input className="inp" value={f.perception} onChange={set("perception")} placeholder="+7" /></label>
              </div>

              <div style={{ ...groupHead, marginTop: 16 }}>saving throws</div>
              <div className="form-grid three">
                <label className="field"><span>fortitude</span><input className="inp" value={f.fort} onChange={set("fort")} placeholder="+8" /></label>
                <label className="field"><span>reflex</span><input className="inp" value={f.ref} onChange={set("ref")} placeholder="+9" /></label>
                <label className="field"><span>will</span><input className="inp" value={f.will} onChange={set("will")} placeholder="+10" /></label>
              </div>

              <div style={{ ...groupHead, marginTop: 16 }}>ability modifiers</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 7 }}>
                {NPC_ABILS.map((k) => (
                  <label className="field" key={k} style={{ alignItems: "center", gap: 4 }}>
                    <span style={{ textTransform: "uppercase" }}>{k}</span>
                    <input className="inp" value={f[k]} onChange={set(k)} placeholder="+0" style={{ textAlign: "center", padding: "8px 4px" }} />
                  </label>
                ))}
              </div>

              <label className="field span2" style={{ marginTop: 16 }}><span>skills</span><input className="inp" value={f.skills} onChange={set("skills")} placeholder="arcana +11, society +9, stealth +7" /></label>
              <div className="form-grid name-row" style={{ marginTop: 12 }}>
                <label className="field"><span>speed</span><input className="inp" value={f.speed} onChange={set("speed")} placeholder="25 feet" /></label>
                <label className="field"><span>languages</span><input className="inp" value={f.languages} onChange={set("languages")} placeholder="common, jotun, varisian" /></label>
              </div>
              <label className="field span2" style={{ marginTop: 12 }}><span>strikes</span><textarea className="inp area" rows={2} value={f.strikes} onChange={set("strikes")} placeholder="melee — staff +7 (1d4 B); ranged — crossbow +7 (1d8 P)" /></label>
              <label className="field span2" style={{ marginTop: 12 }}><span>spells &amp; reactions</span><textarea className="inp area" rows={3} value={f.spells} onChange={set("spells")} placeholder="arcane prepared DC 20, attack +12; counterspell reaction…" /></label>
            </>
          )}
        </div>

        {/* footer */}
        <div className="modal-foot" style={{ margin: 0, padding: "16px 24px 18px", borderTop: "1px solid var(--hush)" }}>
          <button className="mini" onClick={onClose}>cancel</button>
          <button className="btn" disabled={!valid} onClick={submit}>add npc</button>
        </div>
      </div>
    </div>
  );
}

function NpcSheet({ npc, note, onNote, onRemove }) {
  const v = (x) => (x == null ? "?" : x);
  const sv = (x) => (x == null ? "?" : sign(x));
  const eyebrow = [npc.role, npc.source].filter(Boolean).join(" · ");
  const hasStats = npc.ac != null || npc.hp != null || npc.perception != null;
  return (
    <article className="article">
      <div className="pc-head">
        <Sym name="party" className="article-sym" />
        <div className="pc-head-main">
          {eyebrow && <div className="article-eyebrow">{eyebrow}</div>}
          <h2 className="article-title">{npc.name}</h2>
          <div className="pc-sub">{npc.level != null ? `creature ${npc.level}` : "npc · no combat block"}</div>
        </div>
        <div className="pc-head-right">
          <NotesBox value={note} onChange={onNote} />
          {onRemove && <div className="pc-actions"><button className="mini danger" onClick={onRemove}>remove</button></div>}
        </div>
      </div>

      {npc.traits && npc.traits.length > 0 && (
        <div className="chips npc-traits">{npc.traits.map((t) => <span key={t} className="chip ghost">{t}</span>)}</div>
      )}

      {npc.description && <p className="npc-desc">{npc.description}</p>}

      {npc.notes && (
        <>
          <h3 className="sheet-h">role</h3>
          <p className="sec-p">{npc.notes}</p>
        </>
      )}

      {hasStats && (
        <div className="stat-grid">
          <Stat label="armor class" value={v(npc.ac)} />
          <Stat label="hit points" value={v(npc.hp)} />
          <Stat label="perception" value={sv(npc.perception)} />
        </div>
      )}

      <h3 className="sheet-h">saving throws</h3>
      <div className="row-list">
        {[["fortitude", npc.fort], ["reflex", npc.ref], ["will", npc.will]].map(([k, val]) => (
          <div className="line" key={k}>
            <span className="line-name">{k}</span>
            <span className="line-val">{sv(val)}</span>
          </div>
        ))}
      </div>

      {npc.abilities && (
        <>
          <h3 className="sheet-h">abilities</h3>
          <div className="ability-grid">
            {ABILITIES.map(([k]) => (
              <div className="ability" key={k}>
                <div className="ability-mod">{sign(npc.abilities[k])}</div>
                <div className="ability-name">{k}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {npc.skills && (
        <>
          <h3 className="sheet-h">skills</h3>
          <div className="row-list">
            {npc.skills.map(([name, mod]) => (
              <div className="line" key={name}><span className="line-name">{name}</span><span className="line-val">{sign(mod)}</span></div>
            ))}
          </div>
        </>
      )}

      {(npc.speed || npc.languages) && (
        <>
          <h3 className="sheet-h">details</h3>
          <dl className="kv">
            {npc.speed && <div><dt>speed</dt><dd>{npc.speed}</dd></div>}
            {npc.languages && <div><dt>languages</dt><dd>{npc.languages.join(", ")}{npc.langNote ? `; ${npc.langNote}` : ""}</dd></div>}
          </dl>
        </>
      )}

      {npc.attacks && (
        <>
          <h3 className="sheet-h">strikes</h3>
          <ul className="npc-lines">{npc.attacks.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </>
      )}
      {npc.spells && (
        <>
          <h3 className="sheet-h">spells</h3>
          <ul className="npc-lines">{npc.spells.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </>
      )}
      {npc.special && (
        <>
          <h3 className="sheet-h">abilities & reactions</h3>
          <ul className="npc-lines">{npc.special.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </>
      )}
    </article>
  );
}

/* ================================================================== *
 *  SCENARIO WORKSPACE — full published port (verbatim content + wiki links)
 * ================================================================== */
/* SCENARIO_META: loaded at runtime from the scenario data layer */

/* SCENARIO_TABS: loaded at runtime from the scenario data layer */

/* SCENARIO_CONTENT: loaded at runtime from the scenario data layer */

/* ------------------------------------------------------------------ */
/*  symbol-logos — bold geometric marks, one visual weight            */
/*  (the brand's primary visual language: black on off-white)         */
/* ------------------------------------------------------------------ */


function ScenSym({ name, className }) {
  const p = { viewBox: "0 0 40 40", className, "aria-hidden": true };
  switch (name) {
    case "overview": // compass star
      return (
        <svg {...p}>
          <path d="M20 2.5l4.6 12.9L37.5 20l-12.9 4.6L20 37.5l-4.6-12.9L2.5 20l12.9-4.6z" />
        </svg>
      );
    case "background": // open book
      return (
        <svg {...p}>
          <path d="M19 11C13.5 8.2 8 8.2 4 10.4v18.4c4-2.2 9.5-2.2 15 .6z" />
          <path d="M21 11c5.5-2.8 11-2.8 15-.6v18.4c-4-2.2-9.5-2.2-15 .6z" />
        </svg>
      );
    case "start": // orbiting marks
      return (
        <svg {...p}>
          <circle cx="20" cy="20" r="13" fill="none" stroke="currentColor" strokeWidth="2.4" />
          <circle cx="20" cy="20" r="5.6" />
          <circle cx="20" cy="6.4" r="2.6" />
          <circle cx="32" cy="26" r="2.6" />
          <circle cx="8" cy="26" r="2.6" />
        </svg>
      );
    case "journey": // boat
      return (
        <svg {...p}>
          <path d="M5.5 26h29l-3.2 6.3c-.3.5-.8.7-1.4.7H10.1c-.6 0-1.1-.2-1.4-.7z" />
          <path d="M19 6.6c0-1 1.3-1.5 1.9-.6l8.5 11.1c.5.7 0 1.6-.9 1.6H19z" />
          <rect x="18.3" y="6" width="1.7" height="18" rx=".85" />
        </svg>
      );
    case "cassomir": // three-legged frog (eyes)
      return (
        <svg {...p}>
          <ellipse cx="20" cy="25" rx="13" ry="8" />
          <circle cx="13" cy="14" r="5.6" />
          <circle cx="27" cy="14" r="5.6" />
          <circle cx="13" cy="13" r="2" fill="#f4f4f2" />
          <circle cx="27" cy="13" r="2" fill="#f4f4f2" />
        </svg>
      );
    case "swamp": // quicksand rings
      return (
        <svg {...p}>
          <g fill="none" stroke="currentColor" strokeWidth="3">
            <circle cx="20" cy="20" r="14" />
            <circle cx="20" cy="20" r="8.4" />
          </g>
          <circle cx="20" cy="20" r="2.8" />
        </svg>
      );
    case "trail": // winding trail
      return (
        <svg {...p}>
          <path
            d="M9 7c0 9 22 9 22 18 0 4.5-3.2 7-8 7"
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
          />
        </svg>
      );
    case "enclave": // hut
      return (
        <svg {...p}>
          <path d="M20 6l15 16.5H5z" />
          <rect x="9" y="22" width="22" height="10.5" rx="1.5" />
          <rect x="16.6" y="25.5" width="6.8" height="7" rx="1" fill="#f4f4f2" />
        </svg>
      );
    case "ruinsB": // broken columns
      return (
        <svg {...p}>
          <rect x="8" y="12" width="7" height="24" rx="1.6" />
          <rect x="8" y="8.5" width="7" height="2.6" rx="1.3" />
          <rect x="25" y="18" width="7" height="18" rx="1.6" />
          <circle cx="20.5" cy="33.5" r="1.7" />
        </svg>
      );
    case "real": // mushroom (Rain)
      return (
        <svg {...p}>
          <path d="M6 21c0-8 6.3-13.5 14-13.5S34 13 34 21z" />
          <path d="M16 21h8v9.5c0 1.1-.9 2-2 2h-4c-1.1 0-2-.9-2-2z" />
          <circle cx="15" cy="16" r="2" fill="#f4f4f2" />
          <circle cx="24.5" cy="14" r="1.6" fill="#f4f4f2" />
        </svg>
      );
    case "ruinsC": // summoning-rune column
      return (
        <svg {...p}>
          <circle cx="20" cy="20" r="14" fill="none" stroke="currentColor" strokeWidth="3" />
          <circle cx="20" cy="20" r="9" />
          <circle cx="20" cy="20" r="3.2" fill="#f4f4f2" />
        </svg>
      );
    case "conclusion": // medal / wayfinder
      return (
        <svg {...p}>
          <circle cx="20" cy="20" r="14" fill="none" stroke="currentColor" strokeWidth="3" />
          <path d="M20 9.6l2.9 6 6.6.9-4.8 4.6 1.2 6.5L20 28.5l-5.9 3.1 1.2-6.5-4.8-4.6 6.6-.9z" />
        </svg>
      );
    case "rewards": // gem
      return (
        <svg {...p}>
          <path d="M20 5l11 10-11 20L9 15z" />
          <path d="M9 15h22M20 5v30" fill="none" stroke="#f4f4f2" strokeWidth="1.6" />
        </svg>
      );
    default:
      return <svg {...p} />;
  }
}

/* SYM_FOR: loaded at runtime from the scenario data layer */

/* monoline pictograms for in-content cues */
function Pict({ name }) {
  const p = {
    viewBox: "0 0 20 20",
    className: "pict",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  };
  switch (name) {
    case "read":
      return (
        <svg {...p}>
          <rect x="3" y="3.6" width="14" height="10" rx="3" />
          <path d="M7 13.6v3l3.4-3" />
        </svg>
      );
    case "check":
      return (
        <svg {...p}>
          <path d="M10 2.2l6.6 3.7v8.2L10 17.8l-6.6-3.7V5.9z" />
          <circle cx="10" cy="9.9" r="1.5" fill="currentColor" stroke="none" />
        </svg>
      );
    case "hazard":
      return (
        <svg {...p}>
          <path d="M10 3l7.2 12.8H2.8z" />
          <path d="M10 8.2v3.6" />
          <circle cx="10" cy="14" r=".5" fill="currentColor" stroke="none" />
        </svg>
      );
    case "reward":
      return (
        <svg {...p}>
          <path d="M10 3l5.2 4.6L10 17.2 4.8 7.6z" />
        </svg>
      );
    case "hero":
      return (
        <svg {...p}>
          <path d="M10 2.6l2.2 4.7 5.1.6-3.8 3.5.9 5.1L10 14.6l-4.4 2.5.9-5.1L2.7 8.5l5.1-.6z" />
        </svg>
      );
    case "dev":
      return (
        <svg {...p}>
          <path d="M10 3.2v11M5.6 10.5L10 14.8l4.4-4.3" />
        </svg>
      );
    case "note":
      return (
        <svg {...p}>
          <path d="M10 3.4l1.7 4.9 4.9 1.7-4.9 1.7L10 16.6l-1.7-4.9L3.4 10l4.9-1.7z" fill="currentColor" stroke="none" />
        </svg>
      );
    case "down":
      return (
        <svg {...p}>
          <path d="M10 4v11M5.6 11l4.4 4.4L14.4 11" />
        </svg>
      );
    default:
      return <svg {...p} />;
  }
}

const CALL_PICT = { dev: "dev", hero: "hero", reward: "reward", note: "note" };

/* severity meter — monochrome, structure encodes the threat level */
const THREAT_LEVEL = { Trivial: 1, Low: 2, Moderate: 3, Severe: 4 };
function Severity({ threat }) {
  if (!threat) return null;
  const n = THREAT_LEVEL[threat] || 0;
  return (
    <span className="sev" title={threat}>
      <span className="sev-dots">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={`sev-dot ${i < n ? "on" : ""}`} />
        ))}
      </span>
      <span className="sev-label">{threat}</span>
    </span>
  );
}

/* tier marker — filled = success degrees, hollow = failure degrees */
function TierMark({ k }) {
  const spec = {
    "crit-success": [["on"], ["on"]],
    success: [["on"]],
    fail: [[""]],
    "crit-fail": [[""], [""]],
  }[k] || [];
  return (
    <span className="tier-mark">
      {spec.map((d, i) => (
        <span key={i} className={`tdot ${d[0]}`} />
      ))}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  rendering helpers                                                 */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 *  PathfinderWiki links
 *  Each term -> the page title on pathfinderwiki.com (verified to exist).
 *  Only the FIRST occurrence of a term per section is linked, so the
 *  page stays readable. Links render bold with a faint dotted underline:
 *  visible, but quiet enough not to fight the prose.
 * ------------------------------------------------------------------ */
/* WIKI base + LINKS now load at runtime; the link lookup/regex for the active
 * scenario are built in ScenarioContext and handed down through LinkScope. */

// Carries the active scenario's link maps ({ lookup, re, wiki }) down to
// RichText. The per-block `seen` set lives inside RichText (a local, so render
// stays pure — mutating shared state during render breaks under StrictMode).
const LinkScope = createContext(null);

function linkify(text, links, seen, keyer) {
  if (!text || !links || !links.re) return [text];
  const { lookup, wiki } = links;
  // Clone the regex per call: links.re is shared/memoized and stateful (the /g
  // flag tracks lastIndex), so reusing it directly corrupts matching.
  const re = new RegExp(links.re.source, links.re.flags);
  const out = [];
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    const matched = m[0];
    const canon = lookup[matched.toLowerCase()];
    if (!canon || seen.has(canon)) continue; // leave repeats as plain text
    seen.add(canon);
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <a
        key={keyer()}
        className="wlink"
        href={wiki + canon}
        target="_blank"
        rel="noopener noreferrer"
      >
        {matched}
      </a>
    );
    last = m.index + matched.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out.length ? out : [text];
}

function RichText({ x }) {
  // supports **bold**, *italic*, and PathfinderWiki auto-links
  const links = useContext(LinkScope);
  const seen = new Set(); // local to this block; keeps render pure under StrictMode
  let key = 0;
  const keyer = () => "k" + key++;
  const nodes = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let last = 0;
  let m;
  while ((m = re.exec(x)) !== null) {
    if (m.index > last) nodes.push(...linkify(x.slice(last, m.index), links, seen, keyer));
    const token = m[0];
    if (token.startsWith("**")) {
      nodes.push(<strong key={keyer()}>{linkify(token.slice(2, -2), links, seen, keyer)}</strong>);
    } else {
      nodes.push(<em key={keyer()}>{linkify(token.slice(1, -1), links, seen, keyer)}</em>);
    }
    last = m.index + token.length;
  }
  if (last < x.length) nodes.push(...linkify(x.slice(last), links, seen, keyer));
  return <>{nodes}</>;
}

const CALL_LABEL = {
  dev: "Development",
  hero: "Hero Points",
  reward: "Reward",
  note: "Note",
  hazard: "Caution",
};

function ScenarioBlock({ b }) {
  switch (b.t) {
    case "h":
      return (
        <h3 className="sec-h">
          <RichText x={b.x} />
          <Severity threat={b.threat} />
        </h3>
      );
    case "p":
      return (
        <p className="sec-p">
          <RichText x={b.x} />
        </p>
      );
    case "list":
      return (
        <ul className="sec-list">
          {b.items.map((it, i) => (
            <li key={i}>
              <RichText x={it} />
            </li>
          ))}
        </ul>
      );
    case "read":
      return (
        <figure className="read">
          <span className="read-tab">
            <Pict name="read" /> read aloud
          </span>
          {b.x.map((para, i) => (
            <p key={i}>
              <RichText x={para} />
            </p>
          ))}
        </figure>
      );
    case "check":
      return (
        <div className="check">
          <div className="check-head">
            <Pict name="check" />
            <span className="check-skill">{b.skill}</span>
            <span className="check-dc">dc {b.dc}</span>
            <span className="check-action">{b.action}</span>
          </div>
          <dl className="check-tiers">
            {b.tiers.map((tr, i) => (
              <div key={i} className={`tier ${tr.k}`}>
                <dt>
                  <TierMark k={tr.k} />
                  {TIER_LABEL[tr.k]}
                </dt>
                <dd>
                  <RichText x={tr.x} />
                </dd>
              </div>
            ))}
          </dl>
        </div>
      );
    case "loc":
      return (
        <div className="loc">
          <span className="loc-code">{b.code}</span>
          <span className="loc-name">{b.name}</span>
          <Severity threat={b.threat} />
        </div>
      );
    case "enc":
      return (
        <div className="enc">
          <div className="enc-head">
            <span className="enc-area">{b.area} encounter</span>
            <span className="enc-die">{b.die}</span>
          </div>
          {b.note && (
            <p className="enc-note">
              <RichText x={b.note} />
            </p>
          )}
          <ul className="enc-options">
            {b.options.map((o, i) => (
              <li key={i}>
                <span className="enc-opt-name">{o.name}</span>
                <span className="enc-opt-cr">{o.cr}</span>
              </li>
            ))}
          </ul>
        </div>
      );
    case "hazard":
      return (
        <div className="hazard">
          <div className="hazard-head">
            <span className="hazard-flag">
              <Pict name="hazard" /> hazard
            </span>
            <span className="hazard-name">{b.name}</span>
          </div>
          <p className="hazard-x">
            <RichText x={b.x} />
          </p>
          {b.dcs && (
            <ul className="hazard-dcs">
              {b.dcs.map((d, i) => (
                <li key={i}>
                  <RichText x={d} />
                </li>
              ))}
            </ul>
          )}
        </div>
      );
    case "call":
      return (
        <aside className={`call call-${b.kind}`}>
          <div className="call-label">
            <Pict name={CALL_PICT[b.kind] || "note"} />
            {CALL_LABEL[b.kind] || "Note"}
          </div>
          <div className="call-body">
            <div className="call-title">{b.title}</div>
            <p>
              <RichText x={b.x} />
            </p>
          </div>
        </aside>
      );
    case "npcs":
      return (
        <div className="npcs">
          {b.items.map((n, i) => (
            <div className="npc" key={i}>
              <span className="npc-name">{n.name}</span>
              <span className="npc-tag">{n.tag}</span>
            </div>
          ))}
        </div>
      );
    default:
      return null;
  }
}

const TIER_LABEL = {
  "crit-success": "Critical Success",
  success: "Success",
  fail: "Failure",
  "crit-fail": "Critical Failure",
};

function MapsView({ maps, onGo }) {
  const { scenario } = useScenarioData();
  if (!maps || maps.length === 0) return null;
  return (
    <article className="article">
      <div className="article-head">
        <ScenSym name="overview" className="article-sym" />
        <div className="article-eyebrow">{scenario?.meta?.sub}</div>
        <h2 className="article-title">Maps</h2>
        <span className="scroll-cue" aria-hidden="true"><Pict name="down" /></span>
      </div>
      {maps.map((m) => (
        <section className="map-block" key={m.id}>
          <div className="map-block-head">
            <span className="loc-code">{m.code}</span>
            <span className="loc-name">{m.name}</span>
          </div>
          <div className="map-fig">
            <img className="map-img" src={m.src} alt={`${m.name} map`} />
            {m.refs.map((r) => (
              <button
                key={r.label}
                className="map-pin"
                style={{ left: `${r.x}%`, top: `${r.y}%` }}
                title={`${r.label} · ${r.name}`}
                onClick={() => onGo(r.to)}
              >{r.label}</button>
            ))}
          </div>
          {m.caption && <p className="map-caption">{m.caption}</p>}
          {m.refs.length > 0 && (
            <ul className="map-legend">
              {m.refs.map((r) => (
                <li key={r.label}>
                  <button className="map-legend-row" onClick={() => onGo(r.to)}>
                    <span className="map-legend-code">{r.label}</span>
                    <span className="map-legend-name">{r.name}</span>
                    <span className="rail-arrow">→</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </article>
  );
}

function ScenarioView({ section, onGo }) {
  const { scenario, links } = useScenarioData();
  const tabs = scenario?.tabs || [];
  const symFor = scenario?.symFor || {};
  const meta = scenario?.meta || {};
  // A custom campaign has no authored notes (no tabs) — show a friendly empty state.
  if (tabs.length === 0) {
    return (
      <article className="article">
        <div className="importer">
          <ScenSym name="overview" className="import-sym" />
          <h2 className="import-title">{meta.title || "custom campaign"}</h2>
          <p className="import-lead">no scenario notes are available for a custom campaign.</p>
        </div>
      </article>
    );
  }
  if (section === "maps") return <MapsView maps={scenario?.maps || []} onGo={onGo} />;
  const group = tabs.find((g) => g.items.some((i) => i.id === section));
  const item = group && group.items.find((i) => i.id === section);
  const content = (scenario?.content || {})[section] || [];
  return (
    <article className="article">
      <div className="article-head">
        <ScenSym name={symFor[section]} className="article-sym" />
        <div className="article-eyebrow">{group ? group.group : meta.sub}</div>
        <h2 className="article-title">{item ? item.label : section}</h2>
        <span className="scroll-cue" aria-hidden="true"><Pict name="down" /></span>
      </div>
      <LinkScope.Provider value={links}>
        {content.map((b, i) => <ScenarioBlock key={i} b={b} />)}
      </LinkScope.Provider>
    </article>
  );
}

/* ================================================================== *
 *  ENCOUNTERS WORKSPACE — combat tracker
 * ================================================================== */
const uid = () => Math.random().toString(36).slice(2, 9);
const d20 = () => Math.floor(Math.random() * 20) + 1;

// PF2e conditions (remaster). VALUED ones commonly carry a numeric value,
// but the picker allows a free integer on any condition.
const CONDITIONS = [
  "Blinded", "Broken", "Clumsy", "Concealed", "Confused", "Controlled", "Dazzled",
  "Deafened", "Doomed", "Drained", "Dying", "Encumbered", "Enfeebled", "Fascinated",
  "Fatigued", "Fleeing", "Frightened", "Grabbed", "Hidden", "Immobilized", "Invisible",
  "Observed", "Off-Guard", "Paralyzed", "Persistent Damage", "Petrified", "Prone",
  "Quickened", "Restrained", "Sickened", "Slowed", "Stunned", "Stupefied",
  "Unconscious", "Undetected", "Unnoticed", "Wounded",
];
const VALUED = new Set([
  "Clumsy", "Doomed", "Drained", "Dying", "Enfeebled", "Frightened",
  "Sickened", "Slowed", "Stunned", "Stupefied", "Wounded", "Persistent Damage",
]);

/* ------------------------------------------------------------------ *
 *  Condition effects engine (PF2e remaster, sourced from Archives of Nethys)
 *
 *  Each condition maps to a list of contributions { target, v, type }:
 *    target — an on-sheet stat (ac/fort/ref/will/per) or an off-sheet label
 *    v      — signed modifier (penalty < 0, bonus > 0); n = condition value
 *    type   — "status" | "circ" | "untyped" (drives PF2e stacking)
 *
 *  Stacking: penalties/bonuses of the SAME type don't stack (take the worst
 *  penalty + best bonus per type); different types stack. AC counts as a DC,
 *  so frightened/sickened reduce it too.
 * ------------------------------------------------------------------ */
const ON_SHEET = ["ac", "fort", "ref", "will", "per"];
const OFF_ORDER = [
  "attack", "melee attack", "ranged attack", "spell attack", "damage", "melee damage",
  "athletics", "skills", "dex skills", "mental skills", "con skills",
  "spell dc", "actions", "speed", "max hp", "dying threshold", "persistent",
];

// all-checks-and-DCs penalty (frightened, sickened): every on-sheet stat + off-sheet
const allChecks = (n) => [
  { target: "ac", v: -n, type: "status" },
  { target: "fort", v: -n, type: "status" },
  { target: "ref", v: -n, type: "status" },
  { target: "will", v: -n, type: "status" },
  { target: "per", v: -n, type: "status" },
  { target: "attack", v: -n, type: "status" },
  { target: "skills", v: -n, type: "status" },
  { target: "spell dc", v: -n, type: "status" },
];
const offGuard = () => [{ target: "ac", v: -2, type: "circ" }];

const CONDITION_FX = {
  "Off-Guard": { desc: "−2 circumstance penalty to AC.", fx: offGuard },
  "Frightened": { desc: "−value status penalty to all your checks and DCs (incl. AC). Decreases by 1 at the end of each turn.", fx: allChecks },
  "Sickened": { desc: "−value status penalty to all your checks and DCs (incl. AC). You can't willingly ingest anything; retch to reduce it.", fx: allChecks },
  "Clumsy": { desc: "−value status penalty to Dexterity-based rolls and DCs: AC, Reflex, ranged attacks, and Acrobatics/Stealth/Thievery.", fx: (n) => [
    { target: "ac", v: -n, type: "status" }, { target: "ref", v: -n, type: "status" },
    { target: "ranged attack", v: -n, type: "status" }, { target: "dex skills", v: -n, type: "status" },
  ] },
  "Enfeebled": { desc: "−value status penalty to Strength-based rolls and DCs: melee (Str) attack & damage, and Athletics.", fx: (n) => [
    { target: "melee attack", v: -n, type: "status" }, { target: "melee damage", v: -n, type: "status" },
    { target: "athletics", v: -n, type: "status" },
  ] },
  "Drained": { desc: "−value status penalty to Constitution-based rolls (Fortitude saves). Reduces max HP by your level × value.", fx: (n, c) => [
    { target: "fort", v: -n, type: "status" }, { target: "con skills", v: -n, type: "status" },
    { target: "max hp", v: -(Math.max(1, c.level || 1) * n), type: "untyped" },
  ] },
  "Stupefied": { desc: "−value status penalty to Int/Wis/Cha rolls and DCs: Will saves, spell attacks, spell DCs, and mental skills. Flat DC 5+value to Cast a Spell.", fx: (n) => [
    { target: "will", v: -n, type: "status" }, { target: "spell attack", v: -n, type: "status" },
    { target: "spell dc", v: -n, type: "status" }, { target: "mental skills", v: -n, type: "status" },
  ] },
  "Fatigued": { desc: "−1 status penalty to AC and all saving throws. Can't use exploration activities while travelling.", fx: () => [
    { target: "ac", v: -1, type: "status" }, { target: "fort", v: -1, type: "status" },
    { target: "ref", v: -1, type: "status" }, { target: "will", v: -1, type: "status" },
  ] },
  "Unconscious": { desc: "−4 status penalty to AC, Perception, and Reflex. You're blinded, off-guard, and prone.", fx: () => [
    { target: "ac", v: -4, type: "status" }, { target: "per", v: -4, type: "status" },
    { target: "ref", v: -4, type: "status" }, { target: "ac", v: -2, type: "circ" },
  ] },
  "Blinded": { desc: "You can't see; −4 status penalty to Perception. Everything is concealed/hidden to you; you auto-fail Perception checks that require sight.", fx: () => [{ target: "per", v: -4, type: "status" }] },
  "Deafened": { desc: "You can't hear; −2 status penalty to Perception. You auto-fail Perception checks that require hearing.", fx: () => [{ target: "per", v: -2, type: "status" }] },
  "Fascinated": { desc: "−2 status penalty to Perception and skill checks. You can't use concentrate actions unless they relate to the fascinating subject.", fx: () => [
    { target: "per", v: -2, type: "status" }, { target: "skills", v: -2, type: "status" },
  ] },
  "Dazzled": { desc: "If vision is your only precise sense, everything is concealed to you (DC 5 flat check to hit your targets).", fx: () => [] },
  "Encumbered": { desc: "Clumsy 1 and a −10-foot penalty to all your Speeds.", fx: () => [
    { target: "ac", v: -1, type: "status" }, { target: "ref", v: -1, type: "status" },
    { target: "ranged attack", v: -1, type: "status" }, { target: "dex skills", v: -1, type: "status" },
    { target: "speed", v: -10, type: "untyped" },
  ] },
  "Prone": { desc: "−2 circumstance penalty to attack rolls; you're off-guard (−2 circ AC) to melee. Crawl or Stand to move.", fx: () => [
    { target: "ac", v: -2, type: "circ" }, { target: "attack", v: -2, type: "circ" },
  ] },
  "Confused": { desc: "Off-guard; you can't act except to Strike randomly determined targets, and treat everyone as an enemy.", fx: offGuard },
  "Grabbed": { desc: "Off-guard and immobilized. Manipulate actions require a DC 5 flat check or they're lost.", fx: offGuard },
  "Restrained": { desc: "Off-guard and immobilized; you can only use actions with no manipulate/move trait (tighter than grabbed).", fx: offGuard },
  "Paralyzed": { desc: "Off-guard; you can't act except to Recall Knowledge and use purely mental actions.", fx: offGuard },
  "Quickened": { desc: "You gain 1 extra action at the start of your turn (usable only as the source allows).", fx: () => [{ target: "actions", v: 1, type: "untyped" }] },
  "Slowed": { desc: "You lose this many actions at the start of your turn.", fx: (n) => [{ target: "actions", v: -n, type: "untyped" }] },
  "Stunned": { desc: "You lose this many actions; reduces by the actions you lose. Overrides slowed for the same actions.", fx: (n) => [{ target: "actions", v: -n, type: "untyped" }] },
  "Doomed": { desc: "Your dying threshold is reduced by your doomed value (you die at dying = 4 − doomed). Decreases by 1 each full night's rest.", fx: (n) => [{ target: "dying threshold", v: -n, type: "untyped" }] },
  "Dying": { desc: "You're unconscious and near death; you die at dying 4. Increases when you take damage; remove with recovery checks.", fx: () => [] },
  "Wounded": { desc: "When you're knocked into dying, add your wounded value to the dying value. Increases by 1 each time you recover from dying.", fx: () => [] },
  "Persistent Damage": { desc: "You take this much damage at the end of each turn; a DC 15 flat check (or help) ends it.", fx: (n) => [{ target: "persistent", v: -n, type: "untyped" }] },
  "Concealed": { desc: "Attackers must succeed at a DC 5 flat check to target you with attacks or effects.", fx: () => [] },
  "Hidden": { desc: "Attackers know roughly where you are but must succeed at a DC 11 flat check to target you.", fx: () => [] },
  "Undetected": { desc: "Attackers don't know your location; they must guess your square and succeed at a DC 11 flat check. You're off-guard to them.", fx: () => [] },
  "Unnoticed": { desc: "A creature has no idea you're present at all.", fx: () => [] },
  "Observed": { desc: "You're in the open with no detection penalty against you.", fx: () => [] },
  "Invisible": { desc: "You're undetected to everyone; attackers must guess your square (DC 11 flat). Seek to pin you to hidden.", fx: () => [] },
  "Immobilized": { desc: "You can't take any action with the move trait; forced movement can still relocate you.", fx: () => [] },
  "Fleeing": { desc: "You must spend each action trying to escape the source of the condition; you can't Delay or Ready.", fx: () => [] },
  "Controlled": { desc: "Another creature dictates your actions.", fx: () => [] },
  "Petrified": { desc: "You're turned to stone — unaware of your surroundings and unable to act; your body is an object.", fx: () => [] },
  "Broken": { desc: "An object is damaged past its Broken Threshold and functions poorly (shields give no circumstance bonus, etc.).", fx: () => [] },
};

function stackDelta(list) {
  let untyped = 0;
  const typed = {};
  list.forEach(({ v, type }) => {
    if (!type || type === "untyped") { untyped += v; return; }
    const e = typed[type] || (typed[type] = { bonus: 0, penalty: 0 });
    if (v >= 0) e.bonus = Math.max(e.bonus, v);
    else e.penalty = Math.min(e.penalty, v);
  });
  let total = untyped;
  Object.values(typed).forEach((e) => { total += e.bonus + e.penalty; });
  return total;
}

// Given a combatant, return adjusted on-sheet stats + deltas + off-sheet pills.
function conditionEffects(c) {
  const base = { ac: c.ac, fort: c.fort, ref: c.ref, will: c.will, per: c.perception };
  const contribs = [];
  (c.conditions || []).forEach((cond) => {
    const def = CONDITION_FX[cond.name];
    if (!def || !def.fx) return;
    const n = cond.value != null ? cond.value : 1;
    def.fx(n, c).forEach((x) => contribs.push(x));
  });
  const adjusted = { ...base };
  const deltas = {};
  ON_SHEET.forEach((stat) => {
    const d = stackDelta(contribs.filter((x) => x.target === stat));
    deltas[stat] = d;
    adjusted[stat] = (base[stat] || 0) + d;
  });
  const offMap = {};
  contribs.filter((x) => !ON_SHEET.includes(x.target)).forEach((x) => {
    (offMap[x.target] = offMap[x.target] || []).push(x);
  });
  const offSheet = Object.keys(offMap)
    .map((label) => ({ label, delta: stackDelta(offMap[label]) }))
    .filter((o) => o.delta !== 0)
    .sort((a, b) => {
      const ai = OFF_ORDER.indexOf(a.label), bi = OFF_ORDER.indexOf(b.label);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
  return { base, adjusted, deltas, offSheet };
}

// Tooltip text for a condition chip: its mechanical summary.
function conditionTip(cond) {
  const def = CONDITION_FX[cond.name];
  const base = def ? def.desc : "";
  return cond.value != null ? `${cond.name} ${cond.value} — ${base}` : base;
}

// XP budgeting (party of 4 thresholds, adjusted per extra/fewer PC)
function creatureXP(diff) {
  if (diff < -4) return 0;
  if (diff > 4) return 160;
  return { "-4": 10, "-3": 15, "-2": 20, "-1": 30, 0: 40, 1: 60, 2: 80, 3: 120, 4: 160 }[diff];
}
function encounterBudget(combatants, partyPcs) {
  const enemies = combatants.filter((c) => c.kind === "enemy");
  const pcsIn = combatants.filter((c) => c.kind === "pc");
  const levelsSrc = pcsIn.length ? pcsIn : (partyPcs || []).map((p) => ({ level: p.level }));
  const partySize = pcsIn.length || (partyPcs ? partyPcs.length : 0) || 4;
  const partyLevel = levelsSrc.length
    ? Math.round(levelsSrc.reduce((s, c) => s + (c.level || 0), 0) / levelsSrc.length)
    : 1;
  let xp = 0;
  enemies.forEach((e) => (xp += creatureXP((e.level || 0) - partyLevel)));
  const base = { Trivial: 40, Low: 60, Moderate: 80, Severe: 120, Extreme: 160 };
  const per = { Trivial: 10, Low: 20, Moderate: 20, Severe: 30, Extreme: 40 };
  const adj = {};
  Object.keys(base).forEach((k) => (adj[k] = base[k] + (partySize - 4) * per[k]));
  let label = xp === 0 ? "—" : "trivial";
  ["Trivial", "Low", "Moderate", "Severe", "Extreme"].forEach((k) => {
    if (xp >= adj[k]) label = k.toLowerCase();
  });
  return { xp, label, partyLevel };
}

function combatantFromPc(pc) {
  const sv = (k) => (pc.saves.find((s) => s.key === k) || {}).total || 0;
  return {
    id: uid(),
    name: pc.name,
    kind: "pc",
    level: pc.level,
    init: null,
    maxHp: pc.hp,
    hp: pc.hp,
    ac: (pc.ac && pc.ac.acTotal) || 10,
    perception: (pc.perception && pc.perception.total) || 0,
    fort: sv("fortitude"),
    ref: sv("reflex"),
    will: sv("will"),
    conditions: [],
    pcId: pc.id,
    notes: "",
  };
}

function combatantFromNpc(npc) {
  return {
    id: uid(),
    name: npc.name,
    kind: "ally",
    level: npc.level == null ? 0 : npc.level,
    init: null,
    maxHp: npc.hp,
    hp: npc.hp,
    ac: npc.ac,
    perception: npc.perception,
    fort: npc.fort == null ? 0 : npc.fort,
    ref: npc.ref == null ? 0 : npc.ref,
    will: npc.will == null ? 0 : npc.will,
    conditions: [],
    pcId: null,
    npcId: npc.id,
    notes: "",
  };
}

/* ---- standard creatures (Archives of Nethys data) ----
 * The bestiary lives in src/data/creatures.json (regenerated by
 * tools/fetch-creatures.mjs). It's loaded lazily the first time the creature
 * palette opens so it never weighs on initial page load. */
const AON_BASE = "https://2e.aonprd.com";
let _creatureCache = null;
let _creaturePromise = null;
function loadCreatures() {
  if (_creatureCache) return Promise.resolve(_creatureCache);
  if (!_creaturePromise) {
    _creaturePromise = import("./data/creatures.json").then((m) => {
      _creatureCache = m.default;
      return _creatureCache;
    });
  }
  return _creaturePromise;
}

// Turn a standard creature record into an enemy combatant, carrying its AoN id
// + page url so the card's ↗ link can open the Archives of Nethys entry.
function combatantFromCreature(cr) {
  return {
    id: uid(),
    name: cr.name,
    kind: "enemy",
    level: cr.level,
    init: null,
    maxHp: cr.hp,
    hp: cr.hp,
    ac: cr.ac,
    perception: cr.per,
    fort: cr.fort,
    ref: cr.ref,
    will: cr.will,
    conditions: [],
    pcId: null,
    notes: "",
    aon: cr.id,
    aonUrl: AON_BASE + cr.url,
  };
}

/* ---- prefill: encounters + creature stats transcribed from the
 *      scenario PDF appendix (The Second Confirmation). Each area is a
 *      "pick one option" table, so one of each option is loaded; trim or
 *      duplicate to the rolled result. ---- */
/* SCENARIO_ENCOUNTERS: loaded at runtime from the scenario data layer */

/* Encounter maps live in the scenario data (keyed by encounter name). We seed
 * them onto encounters at load/prefill so persisted encounters always show their
 * map, and strip them before persisting so the overlay isn't bloated with the
 * (already-in-scenario) image — the map is rehydrated from the scenario on the
 * next load. A user's own uploaded map (different from the scenario map) is
 * preserved and persisted. */
// Build the name -> map lookup from the active scenario's encounters.
function scenEncMap(scenEnc) {
  return (scenEnc || []).reduce((m, e) => {
    if (e.map) m[e.name] = e.map;
    return m;
  }, {});
}
function seedEncounterMaps(list, scenEnc) {
  const sm = scenEncMap(scenEnc);
  return list.map((e) => (!e.map && sm[e.name] ? { ...e, map: sm[e.name] } : e));
}
function stripSeededMaps(list, scenEnc) {
  const sm = scenEncMap(scenEnc);
  return list.map((e) => (sm[e.name] && e.map === sm[e.name] ? { ...e, map: "" } : e));
}

function buildScenarioEncounters(existingNames, scenEnc) {
  return (scenEnc || []).filter((e) => !existingNames.has(e.name)).map((e) => ({
    id: uid(),
    name: e.name,
    note: e.note || "",
    map: e.map || "",
    combatants: e.creatures.map((c) => ({
      id: uid(),
      name: c.name,
      kind: c.kind || "enemy",
      level: c.level,
      init: null,
      maxHp: c.hp,
      hp: c.hp,
      ac: c.ac,
      perception: c.perception,
      fort: c.fort,
      ref: c.ref,
      will: c.will,
      conditions: [],
      pcId: null,
      npcId: c.npcId || null,
      notes: c.qty && c.qty > 1 ? `run ×${c.qty}` : "",
    })),
  }));
}

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
  const [all, setAll] = useState(_creatureCache);
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

function EncountersView({ encounter, pcs, onChange, onOpenPc, onOpenNpc, onNew, onRemove, onPrefill }) {
  const { scenario } = useScenarioData();
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
  const availableNpcs = (scenario?.npcs || []).filter(
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

/* ================================================================== *
 *  GM NOTES WORKSPACE — prep/run document editor (ported from design)
 *
 *  A left rail of pages (each with optional forks), a prep/run mode toggle,
 *  search, and a document of editable blocks (heading, paragraph, read-aloud,
 *  skill check, q&a, links, live note). Text edits mutate a working model and
 *  debounce-save to the per-scenario overlay; structural changes re-render.
 * ================================================================== */
const gmClone = (x) => JSON.parse(JSON.stringify(x || []));
const gmStamp = () => {
  const d = new Date();
  let h = d.getHours();
  const m = d.getMinutes();
  const ap = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${ap}`;
};
function gmSeedUid(pages) {
  let max = 0;
  const scan = (s) => {
    const mm = /(\d+)$/.exec(String(s || ""));
    if (mm) max = Math.max(max, +mm[1]);
  };
  (pages || []).forEach((p) => {
    scan(p.id);
    (p.blocks || []).forEach((b) => scan(b.id));
  });
  return max + 1;
}

const GM_BLOCK_TYPES = [
  { type: "heading", label: "section heading" },
  { type: "p", label: "paragraph" },
  { type: "read", label: "read-aloud box" },
  { type: "check", label: "skill check" },
  { type: "qa", label: "q&a table" },
  { type: "links", label: "linked entities" },
];

const GM_NPC = "oklch(0.6 0.13 32)";
const GM_ENC = "oklch(0.6 0.13 250)";
const GM_PAGE = "oklch(0.58 0.12 150)";
const GM_URL = "oklch(0.55 0.13 310)";
const gmLinkColor = (t) =>
  t === "enc" ? GM_ENC : t === "pc" ? "#111" : t === "page" ? GM_PAGE : t === "url" ? GM_URL : GM_NPC;

const gmLiveBadge = {
  fontSize: 10.5, textTransform: "lowercase", letterSpacing: ".04em", color: "#9a6a2e",
  background: "#f2e6d4", padding: "3px 8px", borderRadius: 999, whiteSpace: "nowrap",
};

/* contenteditable that never overwrites itself while focused (cursor-safe) */
function GmEditable({ value, editable, tag = "div", className, style, placeholder, onText, onBlur, onKeyDown, id }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const want = value == null ? "" : value;
    if (document.activeElement !== el && el.textContent !== want) el.textContent = want;
  });
  const Tag = tag;
  return (
    <Tag
      id={id}
      ref={ref}
      contentEditable={editable ? true : undefined}
      suppressContentEditableWarning
      data-ph={placeholder}
      className={className}
      style={style}
      onInput={onText ? (e) => onText(e.currentTarget.textContent) : undefined}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
    />
  );
}

function GmDots({ n }) {
  return (
    <span style={{ display: "inline-flex", gap: 3, marginRight: 1 }}>
      {[0, 1, 2, 3].map((k) => (
        <span key={k} style={{ width: 6, height: 6, borderRadius: "50%", border: "1.3px solid #111", background: k < n ? "#111" : "transparent", display: "inline-block" }} />
      ))}
    </span>
  );
}

function GmInsertMenu({ onPick }) {
  return (
    <div className="gmn-palette">
      <div className="gmn-palette-label">insert block</div>
      {GM_BLOCK_TYPES.map((b) => (
        <button key={b.type} className="gmn-palette-item" onClick={() => onPick(b.type)}>{b.label}</button>
      ))}
    </div>
  );
}

const GM_LP_FILTERS = [
  { key: "all", label: "all" },
  { key: "npc", label: "npcs" },
  { key: "enc", label: "encounters" },
  { key: "page", label: "pages" },
  { key: "url", label: "url" },
];

/* Concept A · command-bar link picker — keyboard-first search across npcs,
 * encounters, pages/forks, plus an external-url mode. */
function GmLinkPicker({ npcs, encounters, pageEntries, onPick, onClose }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [url, setUrl] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef(null);
  const urlRef = useRef(null);
  const cardRef = useRef(null);

  useEffect(() => { (filter === "url" ? urlRef : inputRef).current?.focus(); }, [filter]);
  useEffect(() => {
    const onDown = (e) => { if (cardRef.current && !cardRef.current.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose]);

  const q = query.trim().toLowerCase();
  const has = (s) => !!s && s.toLowerCase().includes(q);
  const npcMeta = (n) => [n.role, n.source].filter(Boolean).join(" · ");
  const wantNpc = filter === "all" || filter === "npc";
  const wantEnc = filter === "all" || filter === "enc";
  const wantPage = filter === "all" || filter === "page";

  const people = wantNpc ? npcs.filter((n) => !q || has(n.name) || has(npcMeta(n))).map((n) => ({ type: "npc", refId: n.id, name: n.name, meta: npcMeta(n) })) : [];
  const encs = wantEnc ? encounters.filter((e) => !q || has(e.name)).map((e) => ({ type: "enc", refId: e.id, name: e.name, meta: "" })) : [];
  const pgs = wantPage ? pageEntries.filter((p) => !q || has(p.name) || has(p.meta)).map((p) => ({ type: "page", refId: p.id, name: p.name, meta: p.meta })) : [];
  const groups = [
    { key: "people", label: "people", items: people },
    { key: "encounters", label: "encounters", items: encs },
    { key: "pages", label: "pages & forks", items: pgs },
  ].filter((g) => g.items.length > 0);
  const flat = groups.flatMap((g) => g.items);
  const isUrl = filter === "url";
  const hi = Math.min(highlight, Math.max(0, flat.length - 1));

  const setQ = (v) => { setQuery(v); setHighlight(0); };
  const setF = (k) => { setFilter(k); setHighlight(0); };
  const linkUrl = () => { const u = url.trim(); if (u) onPick({ type: "url", name: u, url: u }); };

  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
    if (isUrl) { if (e.key === "Enter") { e.preventDefault(); linkUrl(); } return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => Math.min(flat.length - 1, h + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((h) => Math.max(0, h - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); if (flat[hi]) onPick(flat[hi]); }
  };

  let idx = -1; // running index across visible groups for keyboard highlight
  return (
    <div ref={cardRef} className="gmn-lp" onMouseDown={(e) => e.stopPropagation()}>
      <div className="gmn-lp-search">
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="#9a9a95" strokeWidth="1.4" strokeLinecap="round"><circle cx="7" cy="7" r="4.4" /><path d="M10.2 10.2 14 14" /></svg>
        <input ref={inputRef} value={query} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="link to a person, place, page, or url…" />
        <span className="gmn-lp-esc">esc</span>
      </div>
      <div className="gmn-lp-chips">
        {GM_LP_FILTERS.map((f) => (
          <button key={f.key} className={`gmn-lp-chip${filter === f.key ? " active" : ""}`} onClick={() => setF(f.key)}>
            {f.key !== "all" && <span className="gmn-lp-chipdot" style={{ background: gmLinkColor(f.key) }} />}
            {f.label}
          </button>
        ))}
      </div>

      {isUrl ? (
        <div className="gmn-lp-urlwrap">
          <div className="gmn-lp-urllabel">paste an external link</div>
          <div className="gmn-lp-urlrow">
            <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="oklch(0.55 0.13 310)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="8" r="5.6" /><path d="M2.6 8h10.8M8 2.4c1.7 1.8 1.7 9.4 0 11.2M8 2.4c-1.7 1.8-1.7 9.4 0 11.2" /></svg>
            <input ref={urlRef} value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={onKey} placeholder="https://…" />
          </div>
          <button className="gmn-lp-urlbtn" disabled={!url.trim()} onClick={linkUrl}>link this url</button>
        </div>
      ) : (
        <div className="gmn-lp-list">
          {groups.map((g) => (
            <div key={g.key}>
              <div className="gmn-lp-ghead"><span className="gmn-lp-glabel">{g.label}</span><span className="gmn-lp-gcount">{g.items.length}</span></div>
              {g.items.map((it) => {
                idx++;
                const at = idx;
                return (
                  <button
                    key={it.type + it.refId}
                    className="gmn-lp-row"
                    style={{ background: at === hi ? "#f1f0ec" : "transparent" }}
                    onMouseEnter={() => setHighlight(at)}
                    onClick={() => onPick(it)}
                  >
                    <span className="gmn-lp-dot" style={{ background: gmLinkColor(it.type) }} />
                    <span className="gmn-lp-name">{it.name}</span>
                    {it.meta && <span className="gmn-lp-meta">{it.meta}</span>}
                  </button>
                );
              })}
            </div>
          ))}
          {flat.length === 0 && <div className="gmn-lp-empty">no matches for “{query}”</div>}
        </div>
      )}

      <div className="gmn-lp-foot">
        <span className="gmn-lp-hint"><span className="gmn-lp-key">↑↓</span> move</span>
        <span className="gmn-lp-hint"><span className="gmn-lp-key">↵</span> link</span>
      </div>
    </div>
  );
}

function gmNewBlock(id, type) {
  switch (type) {
    case "heading": return { id, type: "heading", text: "" };
    case "read": return { id, type: "read", text: "" };
    case "check": return { id, type: "check", skill: "", dc: "", secret: true, tiers: [
      { label: "crit success", dotsOn: 4, text: "" },
      { label: "success", dotsOn: 3, text: "" },
      { label: "failure", dotsOn: 2, text: "" },
      { label: "crit failure", dotsOn: 1, text: "" },
    ] };
    case "qa": return { id, type: "qa", qaTitle: "if the players ask…", rows: [{ q: "", a: "" }, { q: "", a: "" }] };
    case "links": return { id, type: "links", items: [] };
    default: return { id, type: "p", text: "" };
  }
}

/* eslint-disable react-hooks/immutability -- GM notes deliberately mutates the
 * working model in place for cursor-stable contenteditable, then forces a
 * re-render with a fresh array ref on structural changes. No React Compiler
 * runs in this build, so this uncontrolled-input pattern is safe. */
function GmNotes({ initialPages, onPersist, npcs = [], encounters = [], onOpenNpc, onOpenEncounter }) {
  // Working model in state (read during render → lint-safe). Text edits mutate
  // block objects in place WITHOUT setState (no re-render → cursor stays put);
  // structural changes call setPages. `latest` mirrors the model for saves.
  const [pages, setPages] = useState(() => gmClone(initialPages || []));
  const [uidStart] = useState(() => gmSeedUid(initialPages || []));
  const uidRef = useRef(uidStart);
  const latest = useRef(pages);
  const saveTimer = useRef(null);
  const dragFrom = useRef(null);
  const focusComposer = useRef(false);

  const [activeId, setActiveId] = useState(() => (gmClone(initialPages || [])[0]?.id ?? null));
  const [mode, setMode] = useState("prep");
  const [search, setSearch] = useState("");
  const [menuAt, setMenuAt] = useState(null);
  const [composerAt, setComposerAt] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const [linkPickerAt, setLinkPickerAt] = useState(null); // block id with the link picker open

  const isPrep = mode === "prep";
  const uid = (pfx = "b") => pfx + uidRef.current++;

  useEffect(() => { latest.current = pages; });

  // next = authoritative pages to persist; immediate flushes now (structural),
  // otherwise debounced (text). Debounced fires use latest.current.
  const save = (next, immediate) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (immediate) {
      saveTimer.current = null;
      latest.current = next;
      onPersist(gmClone(next));
    } else {
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        onPersist(gmClone(latest.current));
      }, 500);
    }
  };

  // Flush any pending save when unmounting (scenario switch / leaving the tab).
  useEffect(
    () => () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        onPersist(gmClone(latest.current));
      }
    },
    [onPersist]
  );

  // Focus the live-note composer when it opens.
  useEffect(() => {
    if (composerAt !== null && focusComposer.current) {
      const el = document.getElementById("gm-live-composer");
      if (el) el.focus();
      focusComposer.current = false;
    }
  }, [composerAt]);

  const mains = pages.filter((p) => p.group !== "fork");
  const active = pages.find((p) => p.id === activeId) || pages[0] || null;

  const goPage = (pid) => { setActiveId(pid); setMenuAt(null); setComposerAt(null); setLinkPickerAt(null); setSearch(""); };
  const openMenu = (i) => { setComposerAt(null); setLinkPickerAt(null); setMenuAt((cur) => (cur === i ? null : i)); };
  const startNote = (i) => { focusComposer.current = true; setMenuAt(null); setComposerAt(i); };

  // mutate active.blocks in place, then re-render with a fresh array ref
  const commitStructural = (immediate = true) => {
    const next = [...pages];
    setPages(next);
    save(next, immediate);
  };
  const insertBlock = (i, type) => {
    const nb = gmNewBlock(uid(), type);
    active.blocks.splice(i, 0, nb);
    setMenuAt(null);
    commitStructural();
    if (type === "links") setLinkPickerAt(nb.id); // open the picker on a fresh links block
  };
  const removeBlock = (block) => { active.blocks = active.blocks.filter((b) => b !== block); commitStructural(); };

  // link picker: append / remove items on a links block (store the canonical shape)
  const addLink = (block, item) => {
    const clean = item.type === "url"
      ? { type: "url", name: item.name, url: item.url }
      : { type: item.type, name: item.name, refId: item.refId };
    block.items.push(clean);
    setLinkPickerAt(null);
    commitStructural();
  };
  const removeLink = (block, li) => { block.items.splice(li, 1); commitStructural(); };

  // navigate a chip to its target (npc sheet, encounter, page/fork, or url)
  const navigateLink = (it) => {
    if (it.type === "url") { if (it.url) window.open(it.url, "_blank", "noopener,noreferrer"); return; }
    if (it.type === "page") { if (pages.some((p) => p.id === it.refId)) goPage(it.refId); return; }
    if (it.type === "npc") { onOpenNpc && onOpenNpc(it.refId); return; }
    if (it.type === "enc") { onOpenEncounter && onOpenEncounter(it.refId); return; }
  };

  // targets for the picker: other pages/forks in this notes tab
  const pageEntries = pages
    .filter((p) => p.id !== (active && active.id))
    .map((p) =>
      p.group === "fork"
        ? { id: p.id, name: p.title, meta: "fork · " + (pages.find((x) => x.id === p.parentId)?.title || "") }
        : { id: p.id, name: p.title, meta: "page " + (mains.findIndex((m) => m.id === p.id) + 1) }
    );

  // a link is "dangling" when its target no longer exists (urls never dangle)
  const npcIdSet = new Set(npcs.map((n) => n.id));
  const encIdSet = new Set(encounters.map((e) => e.id));
  const pageIdSet = new Set(pages.map((p) => p.id));
  const linkDangling = (it) =>
    it.type === "npc" ? !npcIdSet.has(it.refId)
    : it.type === "enc" ? !encIdSet.has(it.refId)
    : it.type === "page" ? !pageIdSet.has(it.refId)
    : it.type === "url" ? !it.url
    : false;
  const commitNote = (i, text) => {
    const t = (text || "").trim();
    if (t) active.blocks.splice(i, 0, { id: uid(), type: "note", text: t, stamp: gmStamp() });
    setComposerAt(null);
    if (t) commitStructural();
  };
  const onNoteKey = (e, i) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commitNote(i, e.currentTarget.textContent); }
    else if (e.key === "Escape") { e.preventDefault(); setComposerAt(null); }
  };

  const addPage = () => {
    const pid = uid("page");
    const next = [...pages, { id: pid, title: "new page", group: "main", blocks: [] }];
    setPages(next);
    setActiveId(pid); setMode("prep"); setMenuAt(null); setComposerAt(null); setSearch("");
    save(next, true);
  };
  const addFork = (pageId) => {
    const fid = uid("fork");
    let j = pages.findIndex((p) => p.id === pageId) + 1;
    while (j < pages.length && pages[j].group === "fork" && pages[j].parentId === pageId) j++;
    const next = [...pages];
    next.splice(j, 0, { id: fid, title: "new fork", group: "fork", parentId: pageId, blocks: [] });
    setPages(next);
    setActiveId(fid); setMode("prep"); setMenuAt(null); setComposerAt(null); setSearch("");
    save(next, true);
  };
  const deletePage = (pid) => {
    const pg = pages.find((p) => p.id === pid);
    if (!pg) return;
    const removeIds = [pid];
    if (pg.group !== "fork") pages.filter((p) => p.parentId === pid).forEach((f) => removeIds.push(f.id));
    const next = pages.filter((p) => removeIds.indexOf(p.id) === -1);
    setPages(next);
    let nid = activeId;
    if (removeIds.indexOf(nid) !== -1) nid = next[0]?.id ?? null;
    setActiveId(nid); setMenuAt(null); setComposerAt(null);
    save(next, true);
  };

  const onDragOver = (e) => { if (e) e.preventDefault(); };
  const onDragEnd = () => { dragFrom.current = null; setDragOver(null); };
  const startDrag = (i) => { dragFrom.current = i; };
  const dragEnter = (i) => { if (dragFrom.current == null || dragOver === i) return; setDragOver(i); };
  const drop = (i) => {
    const from = dragFrom.current;
    if (from != null && to_ok(from, i, mains.length) && from !== i) {
      const reordered = [...mains];
      const moved = reordered.splice(from, 1)[0];
      reordered.splice(i, 0, moved);
      const next = [];
      reordered.forEach((mn) => {
        next.push(mn);
        pages.filter((p) => p.group === "fork" && p.parentId === mn.id).forEach((f) => next.push(f));
      });
      setPages(next);
      save(next, true);
    }
    dragFrom.current = null;
    setDragOver(null);
  };

  // search across pages/blocks
  const q = search.trim().toLowerCase();
  const results = [];
  if (q) {
    const push = (page, kind, text) => {
      if (text && text.toLowerCase().includes(q)) {
        results.push({ page: page.title, kind, snippet: text.length > 90 ? text.slice(0, 90) + "…" : text, id: page.id });
      }
    };
    pages.forEach((page) => {
      (page.blocks || []).forEach((b) => {
        if (b.text) push(page, b.type === "read" ? "read-aloud" : b.type === "note" ? "live note" : "note", b.text);
        if (b.type === "check") { push(page, "check", b.skill); b.tiers.forEach((t) => push(page, "check · " + t.label, t.text)); }
        if (b.type === "qa") { push(page, "q&a", b.qaTitle); b.rows.forEach((r) => { push(page, "q&a", r.q); push(page, "q&a", r.a); }); }
      });
    });
  }
  const shown = results.slice(0, 8);

  const parent = active && active.group === "fork" ? pages.find((x) => x.id === active.parentId) : null;
  const crumb = !active
    ? ""
    : active.group === "fork"
    ? (parent ? `${parent.title} → ${active.title}` : `fork → ${active.title}`)
    : `running order · page ${mains.findIndex((x) => x.id === active.id) + 1} of ${mains.length}`;

  const renderZone = (index) => {
    if (isPrep) {
      return (
        <div style={{ position: "relative" }}>
          <div className="gmn-insert" onClick={() => openMenu(index)}>
            <span className="gmn-insert-plus">+</span>
            <span className="gmn-insert-line" />
            {index === 0 && <span className="gmn-insert-label">insert block</span>}
          </div>
          {menuAt === index && <GmInsertMenu onPick={(t) => insertBlock(index, t)} />}
        </div>
      );
    }
    return (
      <div style={{ position: "relative" }}>
        <div className="gmn-notezone" onClick={() => startNote(index)}>＋ live note</div>
        {composerAt === index && (
          <div className="gmn-composer">
            <span style={gmLiveBadge}>live note</span>
            <div id="gm-live-composer" contentEditable suppressContentEditableWarning onKeyDown={(e) => onNoteKey(e, index)} data-ph="type a live note — enter to save, esc to cancel" style={{ flex: 1, fontSize: 13.5, color: "#3a3a38", lineHeight: 1.5, minHeight: 20 }} />
          </div>
        )}
      </div>
    );
  };

  const renderBlock = (b) => {
    const editable = isPrep || b.type === "note";
    const onText = (text) => { b.text = text; save(pages, false); };
    switch (b.type) {
      case "heading":
        return <GmEditable tag="h3" className="gmn-h" editable={editable} placeholder="section heading" value={b.text} onText={onText} />;
      case "p":
        return <GmEditable tag="p" className="gmn-p" editable={editable} placeholder="write a note…" value={b.text} onText={onText} />;
      case "read":
        return (
          <div className="gmn-read">
            <span className="gmn-read-tag">read aloud</span>
            <GmEditable className="gmn-read-body" editable={editable} placeholder="boxed text to read aloud, verbatim…" value={b.text} onText={onText} />
          </div>
        );
      case "check": {
        const secret = b.secret !== false;
        return (
          <div className="gmn-card">
            <div className="gmn-card-head">
              <Sym name="combat" className="gmn-card-ico" />
              <GmEditable tag="span" className="gmn-card-title" editable={editable} placeholder="skill — what they're rolling" value={b.skill} onText={(t) => { b.skill = t; save(pages, false); }} />
              <span className="gmn-dc">dc <GmEditable tag="span" editable={editable} placeholder="0" value={b.dc} onText={(t) => { b.dc = t; save(pages, false); }} style={{ minWidth: 14, display: "inline-block" }} /></span>
              <button
                className={`gmn-secret-toggle${secret ? "" : " open"}`}
                title="click to toggle secret / open"
                onClick={(e) => { e.stopPropagation(); b.secret = !secret; commitStructural(); }}
              >
                {secret ? "secret" : "open"}
              </button>
            </div>
            <dl style={{ margin: 0 }}>
              {b.tiers.map((t, ti) => (
                <div className="gmn-tier" key={ti}>
                  <dt><GmDots n={t.dotsOn} />{t.label}</dt>
                  <GmEditable tag="dd" editable={editable} placeholder="what happens…" value={t.text} onText={(x) => { t.text = x; save(pages, false); }} />
                </div>
              ))}
            </dl>
          </div>
        );
      }
      case "qa":
        return (
          <div className="gmn-card">
            <div className="gmn-card-head">
              <Sym name="overview" className="gmn-card-ico" />
              <GmEditable tag="span" className="gmn-card-title" editable={editable} placeholder="if the players ask…" value={b.qaTitle} onText={(t) => { b.qaTitle = t; save(pages, false); }} />
            </div>
            <dl style={{ margin: 0 }}>
              {b.rows.map((row, ri) => (
                <div className="gmn-qarow" key={ri}>
                  <GmEditable tag="dt" editable={editable} placeholder="the question…" value={row.q} onText={(x) => { row.q = x; save(pages, false); }} />
                  <GmEditable tag="dd" editable={editable} placeholder="your answer / what to reveal…" value={row.a} onText={(x) => { row.a = x; save(pages, false); }} />
                </div>
              ))}
            </dl>
          </div>
        );
      case "links":
        return (
          <div className="gmn-links">
            <div className="gmn-links-label">linked to this page</div>
            <div className="gmn-links-row">
              {b.items.map((it, li) => {
                const dangling = linkDangling(it);
                const kind = it.type === "enc" ? "encounter" : it.type === "page" ? "page" : "npc";
                return (
                  <span
                    className={`gmn-chip gmn-chip-link${dangling ? " dangling" : ""}`}
                    key={li}
                    title={dangling ? `${kind} no longer exists` : it.type === "url" ? it.url : `open ${kind}`}
                    onClick={() => { if (!dangling) navigateLink(it); }}
                  >
                    <span className="gmn-chip-dot" style={{ background: gmLinkColor(it.type) }} />
                    {it.name}
                    {it.type === "url" && !dangling && <span className="gmn-chip-ext" aria-hidden="true">↗</span>}
                    {isPrep && <button className="gmn-chipdel" title="remove link" onClick={(e) => { e.stopPropagation(); removeLink(b, li); }}>✕</button>}
                  </span>
                );
              })}
              {b.items.length === 0 && !isPrep && <span className="gmn-links-empty">no links</span>}
            </div>
            {isPrep && (
              <div style={{ position: "relative", marginTop: 9 }}>
                <button className="gmn-addlink" onMouseDown={(e) => e.stopPropagation()} onClick={() => setLinkPickerAt((cur) => (cur === b.id ? null : b.id))}>+ add link</button>
                {linkPickerAt === b.id && (
                  <GmLinkPicker
                    npcs={npcs}
                    encounters={encounters}
                    pageEntries={pageEntries}
                    onPick={(item) => addLink(b, item)}
                    onClose={() => setLinkPickerAt(null)}
                  />
                )}
              </div>
            )}
          </div>
        );
      case "note":
        return (
          <div className="gmn-note">
            <span style={gmLiveBadge}>live note</span>
            <GmEditable className="gmn-note-body" editable value={b.text} onText={onText} />
            {b.stamp && <span className="gmn-note-stamp">{b.stamp}</span>}
            <button className="gmn-notedel" title="delete note" onClick={() => removeBlock(b)}>✕</button>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <>
      <nav className="gmn-rail">
        <div className="gmn-railsc">
          <div style={{ marginBottom: 14 }}>
            <div className="gmn-rail-head">
              <span>pages</span>
              {mains.length > 1 && <span style={{ color: "#c2c1ba" }}>drag to reorder</span>}
            </div>
            {mains.map((mn, mi) => {
              const act = mn.id === activeId;
              return (
                <div
                  key={mn.id}
                  draggable
                  onDragStart={() => startDrag(mi)}
                  onDragEnter={() => dragEnter(mi)}
                  onDragOver={onDragOver}
                  onDrop={() => drop(mi)}
                  onDragEnd={onDragEnd}
                  style={{ position: "relative" }}
                >
                  {dragOver === mi && <div className="gmn-dropline" />}
                  <div className={`gmn-row${act ? " active" : ""}`} onClick={() => goPage(mn.id)}>
                    <Sym name="gmnotes" className="gmn-row-ico" />
                    <span className="gmn-row-title">{mn.title}</span>
                    <button className="gmn-ctrl" title="add a sub-fork" onClick={(e) => { e.stopPropagation(); addFork(mn.id); }}>+</button>
                    <button className="gmn-ctrl del" title="delete page" onClick={(e) => { e.stopPropagation(); deletePage(mn.id); }}>✕</button>
                  </div>
                  {pages.filter((x) => x.group === "fork" && x.parentId === mn.id).map((f) => {
                    const fa = f.id === activeId;
                    return (
                      <div key={f.id} className="gmn-fork-wrap">
                        <div className={`gmn-fork${fa ? " active" : ""}`} onClick={() => goPage(f.id)}>
                          <span className="gmn-fork-arrow">→</span>
                          <span className="gmn-row-title">{f.title}</span>
                          <button className="gmn-ctrl del" title="delete fork" onClick={(e) => { e.stopPropagation(); deletePage(f.id); }}>✕</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
          <button className="gmn-addpage" onClick={addPage}>
            <span style={{ width: 18, textAlign: "center", fontSize: 17 }}>+</span>
            <span>add page</span>
          </button>
        </div>
      </nav>

      <main className="gmn-main">
        <div className="gmn-panel">
          <div className="gmn-topbar">
            <div className="gmn-seg">
              <span className={`gmn-seg-opt${isPrep ? " on" : ""}`} onClick={() => { setMode("prep"); setComposerAt(null); }}>prep</span>
              <span className={`gmn-seg-opt${!isPrep ? " on" : ""}`} onClick={() => { setMode("run"); setMenuAt(null); setLinkPickerAt(null); }}>run</span>
            </div>
            <span className="gmn-modehint">{isPrep ? "author freely — insert, edit, delete blocks" : "click anywhere to drop a live note as you run"}</span>
            <div style={{ marginLeft: "auto", position: "relative" }}>
              <div className="gmn-searchbox">
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="#9a9a95" strokeWidth="1.4" strokeLinecap="round"><circle cx="7" cy="7" r="4.4" /><path d="M10.2 10.2 14 14" /></svg>
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="search every page & note…" />
              </div>
              {shown.length > 0 && (
                <div className="gmn-results">
                  <div className="gmn-results-label">{results.length} match{results.length === 1 ? "" : "es"}</div>
                  {shown.map((res, ri) => (
                    <button key={ri} className="gmn-result" onClick={() => goPage(res.id)}>
                      <div className="gmn-result-meta">{res.page} · {res.kind}</div>
                      <div className="gmn-result-snip">{res.snippet}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="gmn-doc">
            {!active ? (
              <div className="gmn-blank">no pages yet — use “+ add page” to start your notes.</div>
            ) : (
              <div key={`${active.id}:${mode}`}>
                <div className="gmn-crumb">{crumb}</div>
                <GmEditable
                  tag="h2"
                  className="gmn-pagetitle"
                  editable={isPrep}
                  placeholder="page title"
                  value={active.title}
                  onText={(t) => { active.title = t; save(pages, false); }}
                  onBlur={() => setPages((p) => [...p])}
                />
                {renderZone(0)}
                {active.blocks.map((b, i) => (
                  <div key={b.id} style={{ position: "relative" }}>
                    <div onClick={!isPrep && b.type !== "note" ? () => startNote(i + 1) : undefined} style={{ position: "relative", cursor: !isPrep ? "text" : "default" }}>
                      {renderBlock(b)}
                    </div>
                    {isPrep && b.type !== "note" && (
                      <button className="gmn-blockdel" title="delete block" onClick={() => removeBlock(b)}>✕</button>
                    )}
                    {renderZone(i + 1)}
                  </div>
                ))}
                {active.blocks.length === 0 && (
                  <div className="gmn-blank">empty page — use the + above to insert your first block.</div>
                )}
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
/* eslint-enable react-hooks/immutability */

function to_ok(from, to, len) {
  return from >= 0 && from < len && to >= 0 && to < len;
}

/* the persistent top switch */
const MANAGERS = [
  { id: "gmnotes", label: "gm notes", sym: "gmnotes" },
  { id: "encounters", label: "encounters", sym: "combat" },
  { id: "characters", label: "characters", sym: "party" },
  { id: "scenario", label: "scenario", sym: "scenario" },
];

/* ------------------------------------------------------------------ *
 *  CONTEXTUAL HELP — corner "?" pill → per-tab slide-over reference.
 *
 *  Content is pure data keyed by workspace id; the panel renders whatever
 *  the active tab maps to, so adjusting help never touches markup. Feature
 *  numbers (01, 02…) derive from index — they aren't stored.
 * ------------------------------------------------------------------ */
const HELP_CONTENT = {
  scenario: {
    eyebrow: "the official adventure",
    lead: "the scenario as published, brought in to the app in a readable form.",
    features: [
      { t: "sectioned chapters", d: "a breakdown of briefings, general notes, areas, and appendices." },
      { t: "dynamic text", d: "read alouds, stat blocks, rolls are all brought in optimised for readability." },
      { t: "wiki links", d: "tap any highlighted npc, place, or encounter to jump to its wiki entry." },
      { t: "maps gallery", d: "the maps view collects every battle map for the adventure in one place." },
    ],
    foot: "custom campaigns start empty — generate or write your own notes in the gm notes tab.",
  },
  characters: {
    eyebrow: "character manager",
    lead: "details of all player characters and npcs",
    features: [
      { t: "import your players", d: "import player characters direct from pathbuilder and see their character build in full." },
      { t: "manage npcs", d: "see summary and story details, stats where they're available, and make your own per-character notes." },
      { t: "at-a-glance stats", d: "key stats at the top of the sheet." },
    ],
  },
  encounters: {
    eyebrow: "combat manager",
    lead: "run combat end to end — initiative, hit points, conditions and rounds.",
    features: [
      { t: "initiative tracker", d: "auto roll perception for all non player characters and the order will auto sort." },
      { t: "build the field", d: "add players, scenario npcs, creatures from the archives of nethys, or a custom creature." },
      { t: "round bar & log", d: "advance or step back the round and then jot a per-round log as the fight unfolds for any quick round stamp notes on what happened." },
      { t: "threat budget", d: "an xp pill auto-rates the encounter trivial → extreme and xp points, override either field if you like." },
      { t: "conditions", d: "apply conditions per combatant and see their impact on stats." },
      { t: "roll saves", d: "roll saves for any non player character by clicking on the save." },
      { t: "make your own updates", d: "edit creature stats directly or write per combatant notes." },
    ],
  },
  gmnotes: {
    eyebrow: "running sheet",
    lead: "write your session like a binder of pages.",
    features: [
      { t: "prep & run modes", d: "prep mode is fully editable with different block types — run mode locks the text and lets you drop timestamped live notes anywhere you want." },
      { t: "insert blocks", d: "the “+” between lines opens special content formatting for read-aloud boxes, skill checks, q&a tables, and links." },
      { t: "link to anything", d: "drop in an inline link to another page, character card, encounter, or external url." },
      { t: "skill checks with tiers", d: "set a dc and write what happens in each outcome." },
      { t: "structure how you want", d: "drag pages to reorder or create sub-page forks." },
    ],
  },
};

/* The quiet corner trigger — reads as utility chrome, never competing. */
function HelpCorner({ onClick }) {
  return (
    <button type="button" className="help-corner" onClick={onClick} title="what's this tab?">
      <span className="help-corner-q">?</span>
      <span className="help-corner-label">help</span>
    </button>
  );
}

/* The slide-over reference panel. Owns its exit animation: a "closing" state
 * plays the reverse transition, then a timer fires onClose to unmount. */
function HelpPanel({ tab, onClose }) {
  const c = HELP_CONTENT[tab];
  const [closing, setClosing] = useState(false);
  const timer = useRef(null);

  const begin = useCallback(() => {
    setClosing(true);
    timer.current = setTimeout(onClose, 260);
  }, [onClose]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") begin(); };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); clearTimeout(timer.current); };
  }, [begin]);

  if (!c) return null;

  return (
    <div className={`help-layer${closing ? " closing" : ""}`}>
      <div className="help-dim" onClick={begin} />
      <aside className="help-panel" role="dialog" aria-modal="true" aria-label="what this tab does">
        <header className="help-head">
          <div className="help-eyebrow">{c.eyebrow}</div>
          <h2 className="help-title">what this tab does</h2>
          <button type="button" className="help-x" onClick={begin} aria-label="close help">✕</button>
        </header>
        <div className="help-body">
          <p className="help-lead">{c.lead}</p>
          {c.features.map((f, i) => (
            <div className="help-feat" key={i}>
              <span className="help-num">{String(i + 1).padStart(2, "0")}</span>
              <div className="help-feat-main">
                <div className="help-feat-t">{f.t}</div>
                <div className="help-feat-d">{f.d}</div>
              </div>
            </div>
          ))}
          {c.foot && <div className="help-foot">{c.foot}</div>}
        </div>
        <footer className="help-footer">{c.features.length} features · tap outside to close</footer>
      </aside>
    </div>
  );
}

/* ================================================================== *
 *  ROOT — binder shell + manager switch + persistence
 * ================================================================== */
function BinderApp() {
  const { ready, scenario: S, scenarios, activeId, setActiveId, createScenario, overlay, patch } = useScenarioData();

  // UI-only state (selections, modals); all persisted data comes from overlay.
  const [workspace, setWorkspace] = useState("characters"); // characters | scenario | encounters
  const [activePc, setActivePc] = useState(null);
  const [npcSel, setNpcSel] = useState(null);
  const [section, setSection] = useState("overview");
  const [scenSection, setScenSection] = useState("overview");
  const [navOpen, setNavOpen] = useState(false);
  // hideable top dock: auto-pin on narrow screens (no hover), hover-reveal on desktop
  const [dockLocked, setDockLocked] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width:880px)").matches);
  const [dockHover, setDockHover] = useState(false);
  const dockVisible = dockLocked || dockHover;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [activeEnc, setActiveEnc] = useState(null);
  const [addNpcOpen, setAddNpcOpen] = useState(false);
  const [newScenOpen, setNewScenOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  // Overlay-derived collections (the user's editable state for this scenario).
  const pcs = useMemo(() => (overlay.pcs || []).map((raw) => parseBuild(raw)).filter(Boolean), [overlay.pcs]);
  const cnotes = overlay.notes || {};
  const encounters = useMemo(() => seedEncounterMaps(overlay.encounters || [], S?.encounters), [overlay.encounters, S]);

  // Switching scenarios: load the new one and clear stale selections.
  const switchScenario = useCallback(
    (id) => {
      setActiveId(id);
      setActivePc(null);
      setNpcSel(null);
      setActiveEnc(null);
      setScenSection("overview");
      setAdding(false);
      setWorkspace("scenario");
    },
    [setActiveId]
  );

  const handleCreateScenario = useCallback(
    async (title) => {
      await createScenario(title);
      setActivePc(null);
      setNpcSel(null);
      setActiveEnc(null);
      setScenSection("overview");
      setAdding(false);
      setWorkspace("scenario");
      setNewScenOpen(false);
    },
    [createScenario]
  );

  // Stable writer for the GM notes workspace (overlay.gmPages). Stable identity
  // so GmNotes' unmount-flush effect binds to the right scenario.
  const persistGmPages = useCallback((gmPages) => patch({ gmPages }), [patch]);

  // Effective selections fall back to the first item (no setState-in-effect).
  const effPcId = (activePc && pcs.some((p) => p.id === activePc) && activePc) || pcs[0]?.id || null;
  const effEncId = (activeEnc && encounters.some((e) => e.id === activeEnc) && activeEnc) || encounters[0]?.id || null;

  const setNote = useCallback(
    (id, text) => patch({ notes: { ...(overlay.notes || {}), [id]: text } }),
    [patch, overlay.notes]
  );

  const addCustomNpc = useCallback(
    (data) => {
      const id = "c" + uid();
      const npc = {
        id, custom: true, group: "npcs",
        name: data.name, role: "",
        traits: data.traits && data.traits.length ? data.traits : (data.ancestry ? [data.ancestry] : []),
        description: data.description || "",
        level: data.level ?? null,
        perception: data.perception ?? null,
        ac: data.ac ?? null, hp: data.hp ?? null,
        fort: data.fort ?? null, ref: data.ref ?? null, will: data.will ?? null,
        notes: data.notes || "",
        source: data.source || "added by you",
      };
      // full-mode optional blocks — only attach when present so NpcSheet stays clean for quick adds
      if (data.abilities) npc.abilities = data.abilities;
      if (data.skills && data.skills.length) npc.skills = data.skills;
      if (data.speed) npc.speed = data.speed;
      if (data.languages && data.languages.length) npc.languages = data.languages;
      if (data.attacks && data.attacks.length) npc.attacks = data.attacks;
      if (data.spells && data.spells.length) npc.spells = data.spells;
      patch({ customNpcs: [...(overlay.customNpcs || []), npc] });
      setNpcSel(id);
      setAdding(false);
      setWorkspace("characters");
      setNavOpen(false);
    },
    [patch, overlay.customNpcs]
  );

  const removeCustomNpc = useCallback(
    (id) => {
      patch({ customNpcs: (overlay.customNpcs || []).filter((n) => n.id !== id) });
      setNpcSel((cur) => (cur === id ? null : cur));
    },
    [patch, overlay.customNpcs]
  );

  // Encounters are persisted with seeded maps stripped (rehydrated on read).
  const writeEncounters = useCallback(
    (list) => patch({ encounters: stripSeededMaps(list, S?.encounters) }),
    [patch, S]
  );

  const addEncounter = useCallback(() => {
    const id = uid();
    const e = { id, name: `encounter ${encounters.length + 1}`, map: "", combatants: [] };
    writeEncounters([...encounters, e]);
    setActiveEnc(id);
    setNavOpen(false);
  }, [encounters, writeEncounters]);

  const updateEncounter = useCallback(
    (id, updater) => writeEncounters(encounters.map((e) => (e.id === id ? updater(e) : e))),
    [encounters, writeEncounters]
  );

  const removeEncounter = useCallback(
    (id) => {
      const next = encounters.filter((e) => e.id !== id);
      writeEncounters(next);
      setActiveEnc((cur) => (cur === id ? (next[0] ? next[0].id : null) : cur));
    },
    [encounters, writeEncounters]
  );

  const openPc = useCallback((pcId) => {
    setActivePc(pcId);
    setNpcSel(null);
    setAdding(false);
    setSection("overview");
    setWorkspace("characters");
    setNavOpen(false);
  }, []);

  const openNpc = useCallback((id) => {
    setNpcSel(id);
    setAdding(false);
    setWorkspace("characters");
    setNavOpen(false);
  }, []);

  const openEncounter = useCallback((id) => {
    setActiveEnc(id);
    setWorkspace("encounters");
    setNavOpen(false);
  }, []);

  const prefillEncounters = useCallback(() => {
    const names = new Set(encounters.map((e) => e.name));
    const added = buildScenarioEncounters(names, S?.encounters);
    setNavOpen(false);
    if (!added.length) {
      // all scenario encounters already present — just jump to the first
      const first = encounters.find((e) => (S?.encounters || []).some((s) => s.name === e.name));
      if (first) setActiveEnc(first.id);
      return;
    }
    writeEncounters([...encounters, ...added]);
    setActiveEnc(added[0].id);
  }, [encounters, writeEncounters, S]);

  const addPc = useCallback(
    async (parsedOrFlag, idOrErr) => {
      // error path from importer
      if (parsedOrFlag === null) {
        setError(idOrErr);
        return;
      }
      // auto-fetch path
      if (parsedOrFlag === "FETCH") {
        setBusy(true);
        setError(null);
        const target = `https://pathbuilder2e.com/json.php?id=${idOrErr}`;
        const proxies = [
          (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
          (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
        ];
        let got = null;
        for (const make of proxies) {
          try {
            const res = await fetch(make(target));
            if (!res.ok) continue;
            const data = JSON.parse(await res.text());
            if (data && (data.success || data.build)) { got = data; break; }
          } catch { /* try next proxy */ }
        }
        setBusy(false);
        if (!got) {
          setError("auto-fetch was blocked (CORS / proxy). Open the json.php link in your browser, copy the JSON, and paste it below.");
          return;
        }
        try {
          parsedOrFlag = parseBuild(got);
        } catch {
          setError("fetched data wasn't a valid character.");
          return;
        }
      }

      // Replace any same-id build, then append. `pcs` is already parsed and each
      // entry carries its `.raw`, so we dedup off it rather than re-parsing.
      const pc = parsedOrFlag;
      const nextRaw = [...pcs.filter((p) => p.id !== pc.id).map((p) => p.raw), pc.raw];
      patch({ pcs: nextRaw });
      setActivePc(pc.id);
      setSection("overview");
      setAdding(false);
      setError(null);
    },
    [patch, pcs]
  );

  const removePc = useCallback(
    (id) => {
      patch({ pcs: pcs.filter((p) => p.id !== id).map((p) => p.raw) });
      setActivePc((cur) => (cur === id ? null : cur));
    },
    [patch, pcs]
  );

  const exportPc = (pc) => {
    const blob = new Blob([JSON.stringify(pc.raw, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${pc.name}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const allNpcs = useMemo(() => [...(S?.npcs || []), ...(overlay.customNpcs || [])], [S, overlay.customNpcs]);
  const pc = useMemo(() => pcs.find((p) => p.id === effPcId) || null, [pcs, effPcId]);
  const npc = useMemo(() => allNpcs.find((n) => n.id === npcSel) || null, [allNpcs, npcSel]);
  const encounter = useMemo(() => encounters.find((e) => e.id === effEncId) || null, [encounters, effEncId]);
  const sheetSections = useMemo(() => {
    const has = (id) => {
      if (id === "spells") return pc && (pc.casters.length || pc.focus);
      return true;
    };
    return SHEET_NAV.filter((s) => has(s.id));
  }, [pc]);

  const goScen = (id) => { setScenSection(id); setNavOpen(false); };
  const switchTo = (w) => { setWorkspace(w); setNavOpen(false); };

  const crumbNow =
    workspace === "characters"
      ? adding
        ? "add character"
        : npc
        ? npc.name
        : pc
        ? pc.name
        : "characters"
      : workspace === "scenario"
      ? scenSection
      : encounter
      ? encounter.name
      : "encounters";

  if (!ready) {
    return (
      <div className="shell">
        <div className="app">
          <main className="content"><div className="panel" style={{ padding: 40, color: "var(--ink-3)" }}>loading…</div></main>
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      {/* hideable top dock — hover the top edge to reveal, pin to lock */}
      <div
        className={`dock-region ${dockVisible ? "shown" : ""}`}
        onMouseEnter={() => setDockHover(true)}
        onMouseLeave={() => setDockHover(false)}
      >
        <div className="managers">
          <div className="managers-brand">campaign binder</div>
          <div className="managers-tabs">
            {MANAGERS.map((m) => (
              <button
                key={m.id}
                className={`ms-btn ${workspace === m.id ? "on" : ""}`}
                onClick={() => switchTo(m.id)}
              >
                <span className="ms-box"><Sym name={m.sym} className="ms-sym" /></span>
                <span>{m.label}</span>
              </button>
            ))}
          </div>
          <div className="dock-right">
            <button
              className={`dock-pin ${dockLocked ? "on" : ""}`}
              onClick={() => { setDockLocked((v) => !v); setDockHover(false); }}
            >
              <span className="dock-pin-dot" />
              {dockLocked ? "pinned" : "pin menu"}
            </button>
            {scenarios.length > 0 && (
              <select
                className="scen-switch"
                value={activeId || ""}
                onChange={(e) => {
                  if (e.target.value === "__new__") setNewScenOpen(true);
                  else switchScenario(e.target.value);
                }}
                aria-label="active scenario"
              >
                {scenarios.map((s) => (
                  <option key={s.scenario_id} value={s.scenario_id}>{s.title}</option>
                ))}
                <option value="__new__">+ new custom scenario…</option>
              </select>
            )}
          </div>
        </div>

        {!dockVisible && (
          <button className="dock-handle" onClick={() => setDockLocked(true)} aria-label="show menu">
            menu
            <span className="dock-handle-caret">▾</span>
          </button>
        )}
      </div>

      <div className={`app ${dockLocked ? "docked" : ""}`}>
        {workspace === "gmnotes" ? (
          <GmNotes key={activeId || "none"} initialPages={overlay.gmPages || []} onPersist={persistGmPages} npcs={allNpcs} encounters={encounters} onOpenNpc={openNpc} onOpenEncounter={openEncounter} />
        ) : (
        <>
        {/* ---- rail ---- */}
        <nav className={`rail ${navOpen ? "open" : ""}`}>
          <div className="rail-scroll">
            {workspace === "characters" && (
              <>
                <div className="rail-group">
                  <div className="rail-group-label">player characters</div>
                  {pcs.map((p) => (
                    <button
                      key={p.id}
                      className={`rail-tab ${effPcId === p.id && !adding && !npcSel ? "active" : ""}`}
                      onClick={() => { setActivePc(p.id); setNpcSel(null); setAdding(false); setSection("overview"); setNavOpen(false); }}
                    >
                      <Sym name="party" className="rail-sym" />
                      <span className="rail-label">{p.name}<span className="rail-sub"> · {p.cls} {p.level}</span></span>
                      <span className="rail-arrow">→</span>
                    </button>
                  ))}
                  <button className={`rail-tab add ${adding ? "active" : ""}`} onClick={() => { setAdding(true); setNpcSel(null); setNavOpen(false); }}>
                    <span className="rail-plus">+</span><span className="rail-label">add character</span>
                  </button>
                </div>

                {groupNpcs(allNpcs).map((g) => (
                  <div className="rail-group" key={g.label}>
                    <div className="rail-group-label">{g.label}</div>
                    {g.items.map((n) => (
                      <button
                        key={n.id}
                        className={`rail-tab ${npcSel === n.id ? "active" : ""}`}
                        onClick={() => { setNpcSel(n.id); setAdding(false); setNavOpen(false); }}
                      >
                        <Sym name="party" className="rail-sym" />
                        <span className="rail-label">{n.name}{n.role ? <span className="rail-sub"> · {n.role}</span> : null}</span>
                        <span className="rail-arrow">→</span>
                      </button>
                    ))}
                    {g.label === "npcs" && (
                      <button className="rail-tab add" onClick={() => { setAddNpcOpen(true); setNavOpen(false); }}>
                        <span className="rail-plus">+</span><span className="rail-label">add npc</span>
                      </button>
                    )}
                  </div>
                ))}
              </>
            )}

            {workspace === "scenario" && (S?.maps?.length > 0) && (
              <div className="rail-group">
                <div className="rail-group-label">reference</div>
                <button className={`rail-tab ${scenSection === "maps" ? "active" : ""}`} onClick={() => goScen("maps")}>
                  <ScenSym name="overview" className="rail-sym" />
                  <span className="rail-label">Maps</span>
                  <span className="rail-arrow">→</span>
                </button>
              </div>
            )}

            {workspace === "scenario" &&
              (S?.tabs || []).map((g) => (
                <div className="rail-group" key={g.group}>
                  <div className="rail-group-label">{g.group}</div>
                  {g.items.map((it) => (
                    <button key={it.id} className={`rail-tab ${scenSection === it.id ? "active" : ""}`} onClick={() => goScen(it.id)}>
                      <ScenSym name={(S?.symFor || {})[it.id]} className="rail-sym" />
                      <span className="rail-label">{it.label}</span>
                      <span className="rail-arrow">→</span>
                    </button>
                  ))}
                </div>
              ))}

            {workspace === "encounters" && (
              <div className="rail-group">
                <div className="rail-group-label">encounters</div>
                {encounters.map((e) => (
                  <button
                    key={e.id}
                    className={`rail-tab ${effEncId === e.id ? "active" : ""}`}
                    onClick={() => { setActiveEnc(e.id); setNavOpen(false); }}
                  >
                    <Sym name="combat" className="rail-sym" />
                    <span className="rail-label">{e.name || "untitled"}<span className="rail-sub"> · {e.combatants.length}</span></span>
                    <span className="rail-arrow">→</span>
                  </button>
                ))}
                <button className="rail-tab add" onClick={addEncounter}>
                  <span className="rail-plus">+</span><span className="rail-label">new encounter</span>
                </button>
                <button className="rail-tab add" onClick={prefillEncounters}>
                  <span className="rail-plus">↡</span><span className="rail-label">prefill from scenario</span>
                </button>
              </div>
            )}
          </div>
        </nav>

        {navOpen && <div className="scrim" onClick={() => setNavOpen(false)} />}

        {/* ---- main ---- */}
        <main className={`content${workspace === "encounters" ? " enc-active" : ""}`}>
          <div className="panel">
            <header className="topbar">
              <button className="menu-btn" onClick={() => setNavOpen((v) => !v)} aria-label="sections">
                <span /><span /><span />
              </button>
              <div className="crumb">
                <span>{workspace}</span>
                <span className="crumb-sep">→</span>
                <span className="crumb-now">{crumbNow}</span>
              </div>
            </header>

            {workspace === "characters" &&
              (adding ? (
                <div className="article"><Importer onAdd={addPc} busy={busy} error={error} /></div>
              ) : npc ? (
                <NpcSheet
                  npc={npc}
                  note={cnotes[npc.id] || ""}
                  onNote={(t) => setNote(npc.id, t)}
                  onRemove={npc.custom ? () => removeCustomNpc(npc.id) : null}
                />
              ) : !pc ? (
                <div className="article"><Importer onAdd={addPc} busy={busy} error={error} /></div>
              ) : (
                <article className="article">
                  <div className="pc-head">
                    <Sym name="party" className="article-sym" />
                    <div className="pc-head-main">
                      <div className="article-eyebrow">
                        {pc.ancestry}{pc.heritage ? ` · ${pc.heritage}` : ""} · {pc.background || "—"}
                      </div>
                      <h2 className="article-title">{pc.name}</h2>
                      <div className="pc-sub">{pc.cls}{pc.dualClass ? ` / ${pc.dualClass}` : ""} · level {pc.level}</div>
                    </div>
                    <div className="pc-head-right">
                      <NotesBox value={cnotes[pc.id] || ""} onChange={(t) => setNote(pc.id, t)} />
                      <div className="pc-actions">
                        <button className="mini" onClick={() => exportPc(pc)}>export</button>
                        <button className="mini danger" onClick={() => removePc(pc.id)}>remove</button>
                      </div>
                    </div>
                  </div>

                  <div className="pills">
                    {sheetSections.map((s) => (
                      <button key={s.id} className={`pill ${section === s.id ? "on" : ""}`} onClick={() => setSection(s.id)}>
                        {s.label}
                      </button>
                    ))}
                  </div>

                  <Sheet pc={pc} section={section} />
                </article>
              ))}

            {workspace === "scenario" && <ScenarioView section={scenSection} onGo={goScen} />}
            {workspace === "encounters" && (
              <EncountersView
                encounter={encounter}
                pcs={pcs}
                onChange={(updater) => updateEncounter(effEncId, updater)}
                onOpenPc={openPc}
                onOpenNpc={openNpc}
                onNew={addEncounter}
                onRemove={() => removeEncounter(effEncId)}
                onPrefill={prefillEncounters}
              />
            )}
          </div>
        </main>
        </>
        )}

        {/* per-tab contextual help — quiet corner trigger + slide-over */}
        <HelpCorner onClick={() => setHelpOpen(true)} />
        {helpOpen && <HelpPanel tab={workspace} onClose={() => setHelpOpen(false)} />}
      </div>

      {addNpcOpen && <AddNpc onAdd={addCustomNpc} onClose={() => setAddNpcOpen(false)} />}
      {newScenOpen && <NewScenario onCreate={handleCreateScenario} onClose={() => setNewScenOpen(false)} />}
    </div>
  );
}

/* The root wraps the binder in the data-layer provider (IndexedDB + sync). */
export default function App() {
  return (
    <ScenarioProvider>
      <BinderApp />
    </ScenarioProvider>
  );
}
