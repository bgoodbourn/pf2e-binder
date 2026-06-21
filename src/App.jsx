import { useState, useMemo, useCallback, useRef, createContext, useContext } from "react";
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

/* quick-add NPC: name, ancestry, description */
function AddNpc({ onAdd, onClose }) {
  const [f, setF] = useState({ name: "", ancestry: "", description: "" });
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const valid = f.name.trim();
  const submit = () => {
    if (!valid) return;
    onAdd({ name: f.name.trim(), ancestry: f.ancestry.trim(), description: f.description.trim() });
    onClose();
  };
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card narrow" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3 className="modal-title">add npc</h3>
          <button className="modal-x" onClick={onClose} aria-label="close">×</button>
        </div>
        <div className="form-grid name-row">
          <label className="field"><span>name <i>*</i></span><input className="inp" value={f.name} onChange={set("name")} autoFocus /></label>
          <label className="field"><span>ancestry</span><input className="inp" value={f.ancestry} onChange={set("ancestry")} placeholder="e.g. human" /></label>
        </div>
        <label className="field span2" style={{ marginTop: 14 }}><span>description</span><textarea className="inp area" rows={3} value={f.description} onChange={set("description")} placeholder="who they are, what they want…" /></label>
        <div className="modal-foot">
          <button className="mini" onClick={onClose}>cancel</button>
          <button className="btn" disabled={!valid} onClick={submit}>add</button>
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

function ThreatPill({ threat }) {
  return <Severity threat={threat} />;
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
          <ThreatPill threat={b.threat} />
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
          <ThreatPill threat={b.threat} />
        </div>
      );
    case "enc":
      return (
        <div className="enc">
          <div className="enc-head">
            <span className="enc-area">{b.area} encounter</span>
            <span className="enc-die">{b.die}</span>
            <span className="enc-ptr">encounters tool →</span>
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
            <span className="enc-ptr">encounters tool →</span>
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

/* ---- a single combatant row ---- */
function CombatantRow({ c, onPatch, onRemove, onOpenPc, onOpenNpc, onAddCondition }) {
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
          ) : null}
          <span className={`cbt-kind k-${c.kind}`}>{c.kind}</span>
          <span className="cbt-level">lvl {c.level}</span>
        </div>
        <div className="cbt-def">{c.ac} AC · Fort {sign(c.fort)}, Ref {sign(c.ref)}, Will {sign(c.will)} · Per {sign(c.perception)}</div>
        {c.notes && <div className="cbt-note">{c.notes}</div>}
        <div className="cbt-conds">
          {c.conditions.map((cond) => (
            <span key={cond.id} className="cond">
              {cond.name}{cond.value != null ? ` ${cond.value}` : ""}
              <button className="cond-x" onClick={() => onPatch((cur) => ({ conditions: cur.conditions.filter((x) => x.id !== cond.id) }))} aria-label="remove condition">×</button>
            </span>
          ))}
          <button className="cond-add" onClick={onAddCondition}>+ condition</button>
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

  const onMapFile = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onChange((enc) => ({ ...enc, map: reader.result }));
    reader.readAsDataURL(file);
  };

  return (
    <article className="article enc">
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
          {encounter.note && <div className="enc-note-sub">{encounter.note}</div>}
        </div>
        <div className="enc-head-actions">
          <span className={`enc-threat t-${budget.label.replace(/[^a-z]/g, "")}`}>{budget.label} · {budget.xp} xp</span>
          <button className="mini danger" onClick={onRemove}>remove</button>
        </div>
      </div>

      <div className="enc-toolbar">
        <button className="tb roll" onClick={rollInitiative}>
          <Sym name="abilities" className="tb-sym" /> roll initiative
        </button>

        <div className="tb-wrap">
          <button className="tb" disabled={availablePcs.length === 0} onClick={() => setPlayerMenu((v) => !v)}>add player</button>
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

        <button className="tb" onClick={() => setAddOpen(true)}>add creature</button>

        <div className="tb-wrap">
          <button className="tb" disabled={availableNpcs.length === 0} onClick={() => setNpcMenu((v) => !v)}>add npc</button>
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

/* the persistent top switch */
const MANAGERS = [
  { id: "scenario", label: "scenario", sym: "scenario" },
  { id: "characters", label: "characters", sym: "party" },
  { id: "encounters", label: "encounters", sym: "combat" },
];

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [activeEnc, setActiveEnc] = useState(null);
  const [addNpcOpen, setAddNpcOpen] = useState(false);
  const [newScenOpen, setNewScenOpen] = useState(false);

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
        name: data.name, role: "", traits: data.ancestry ? [data.ancestry] : [],
        description: data.description || "",
        level: null, perception: null, ac: null, hp: null, fort: null, ref: null, will: null,
        notes: "", source: "added by you",
      };
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

      const pc = parsedOrFlag;
      const nextRaw = [
        ...(overlay.pcs || []).filter((raw) => {
          const p = parseBuild(raw);
          return !p || p.id !== pc.id;
        }),
        pc.raw,
      ];
      patch({ pcs: nextRaw });
      setActivePc(pc.id);
      setSection("overview");
      setAdding(false);
      setError(null);
    },
    [patch, overlay.pcs]
  );

  const removePc = useCallback(
    (id) => {
      const nextRaw = (overlay.pcs || []).filter((raw) => {
        const p = parseBuild(raw);
        return !p || p.id !== id;
      });
      patch({ pcs: nextRaw });
      setActivePc((cur) => (cur === id ? null : cur));
    },
    [patch, overlay.pcs]
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
        <div className="managers"><div className="managers-brand">campaign binder</div></div>
        <div className="app">
          <main className="content"><div className="panel" style={{ padding: 40, color: "var(--ink-3)" }}>loading…</div></main>
        </div>
        <Style />
      </div>
    );
  }

  return (
    <div className="shell">
      {/* persistent manager switch — always at the top */}
      <div className="managers">
        <div className="managers-brand">campaign binder</div>
        <div className="managers-tabs">
          {MANAGERS.map((m) => (
            <button
              key={m.id}
              className={`ms-btn ${workspace === m.id ? "on" : ""}`}
              onClick={() => switchTo(m.id)}
            >
              <Sym name={m.sym} className="ms-sym" />
              <span>{m.label}</span>
            </button>
          ))}
        </div>
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

      <div className="app">
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
        <main className="content">
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
      </div>

      {addNpcOpen && <AddNpc onAdd={addCustomNpc} onClose={() => setAddNpcOpen(false)} />}
      {newScenOpen && <NewScenario onCreate={handleCreateScenario} onClose={() => setNewScenOpen(false)} />}

      <Style />
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

/* ------------------------------------------------------------------ */
function Style() {
  return (
    <style>{`
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;450;500;600&family=Inter+Tight:wght@500;600;700&display=swap');
:root{
  --canvas:#F4F4F2;--panel:#FFFFFF;--ink:#111111;--ink-2:#3a3a38;--ink-3:#6c6c68;
  --faint:#9a9a95;--line:#e7e6e1;--line-2:#ededea;--hush:#f1f0ec;--pill:#0e0e0e;--pill-text:#f5f5f3;
}
*{box-sizing:border-box;}
html,body,#root{height:100%;}
.shell{display:flex;flex-direction:column;height:100vh;background:var(--canvas);color:var(--ink);
  font-family:'Inter',system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased;}
.app{flex:1;display:flex;min-height:0;}
svg{display:block;}
button{font-family:inherit;}

/* persistent top manager switch */
.managers{display:flex;align-items:center;gap:18px;padding:13px 22px;background:var(--canvas);
  border-bottom:1px solid var(--line);}
.managers-brand{font-family:'Inter Tight',sans-serif;font-weight:700;font-size:15px;letter-spacing:-.02em;
  text-transform:lowercase;color:var(--ink);padding-right:4px;}
.managers-tabs{display:flex;gap:8px;}
.ms-btn{display:flex;align-items:center;gap:8px;border:1px solid var(--line);background:var(--panel);
  border-radius:12px;padding:9px 16px;font-size:13.5px;color:var(--ink-3);cursor:pointer;text-transform:lowercase;
  transition:background .14s,color .14s,border-color .14s;}
.ms-sym{width:15px;height:15px;}
.ms-btn:hover{border-color:var(--ink-3);color:var(--ink);}
.ms-btn.on{background:var(--pill);color:var(--pill-text);border-color:var(--pill);}
.ms-btn.on .ms-sym{color:var(--pill-text);}
.scen-switch{margin-left:auto;border:1px solid var(--line);background:var(--panel);border-radius:12px;
  padding:8px 12px;font-size:13px;color:var(--ink-2);font-family:inherit;text-transform:lowercase;cursor:pointer;
  max-width:42vw;}
.scen-switch:hover{border-color:var(--ink-3);color:var(--ink);}

/* rail */
.rail{width:290px;flex:0 0 290px;display:flex;flex-direction:column;padding:24px 18px 14px;}
.rail-empty{font-size:12.5px;color:var(--faint);text-transform:lowercase;padding:4px 12px;}

.rail-scroll{flex:1;overflow-y:auto;padding:6px 0;}
.rail-scroll::-webkit-scrollbar{width:0;}
.rail-group{margin-bottom:18px;}
.rail-group-label{font-size:10.5px;letter-spacing:.04em;text-transform:lowercase;color:var(--faint);padding:0 12px 7px;}
.rail-tab{display:flex;align-items:center;gap:11px;width:100%;background:transparent;border:0;cursor:pointer;
  padding:9px 12px;border-radius:13px;color:var(--ink-2);font-size:14px;text-align:left;line-height:1.2;
  transition:background .14s,color .14s;}
.rail-sym{width:18px;height:18px;flex:0 0 18px;color:var(--ink);}
.rail-label{flex:1;text-transform:lowercase;letter-spacing:-.005em;}
.rail-sub{color:var(--faint);}
.rail-arrow{opacity:0;transform:translateX(-3px);transition:opacity .14s,transform .14s;font-size:13px;color:var(--ink-3);}
.rail-tab:hover{background:#ececea;color:var(--ink);}
.rail-tab:hover .rail-arrow{opacity:1;transform:translateX(0);}
.rail-tab.active{background:var(--pill);color:var(--pill-text);}
.rail-tab.active .rail-sym{color:var(--pill-text);}
.rail-tab.active .rail-arrow,.rail-tab.active .rail-sub{opacity:1;transform:translateX(0);color:var(--pill-text);}
.rail-tab.add{color:var(--ink-3);}
.rail-plus{width:18px;text-align:center;font-size:17px;color:var(--ink-3);}

/* content + panel */
.content{flex:1;overflow-y:auto;padding:24px 24px 24px 4px;}
.panel{max-width:920px;margin:0 auto;background:var(--panel);border:1px solid var(--line);border-radius:26px;
  box-shadow:0 1px 1px rgba(17,17,17,.02),0 22px 48px -30px rgba(17,17,17,.22);min-height:calc(100vh - 116px);}
.topbar{display:none;}
.article{padding:42px 50px 90px;}
.article-head{margin-bottom:24px;}
.article-sym{width:50px;height:50px;color:var(--ink);margin-bottom:18px;}
.article-eyebrow{font-size:12px;color:var(--ink-3);text-transform:lowercase;letter-spacing:.01em;margin-bottom:7px;}
.article-title{font-family:'Inter Tight',sans-serif;font-weight:700;font-size:38px;line-height:1.02;
  letter-spacing:-.03em;text-transform:lowercase;color:var(--ink);margin:0;}

/* pc head */
.pc-head{display:flex;gap:18px;align-items:flex-start;margin-bottom:22px;}
.pc-head .article-sym{margin-bottom:0;width:46px;height:46px;flex:0 0 46px;}
.pc-head-main{flex:1;min-width:0;}
.pc-head-right{flex:0 0 270px;display:flex;flex-direction:column;gap:10px;align-items:stretch;}
.notes-box{border:1px solid var(--line);border-radius:14px;background:var(--hush);overflow:hidden;}
.notes-head{display:flex;justify-content:space-between;align-items:center;padding:8px 12px 0;}
.notes-head>span:first-child{font-size:11px;text-transform:lowercase;letter-spacing:.04em;color:var(--ink-3);}
.notes-status{font-size:10px;color:var(--faint);text-transform:lowercase;}
.notes-area{display:block;width:100%;min-height:88px;resize:vertical;border:0;background:transparent;outline:none;
  padding:8px 12px 12px;font-family:inherit;font-size:13px;line-height:1.5;color:var(--ink);}
.npc-desc{font-size:15.5px;line-height:1.62;color:var(--ink-2);margin:0 0 6px;}
.pc-sub{margin-top:6px;font-size:13px;color:var(--ink-3);text-transform:lowercase;}
.pc-actions{display:flex;gap:8px;}
.mini{background:transparent;border:1px solid var(--line);border-radius:9px;padding:6px 11px;font-size:12px;
  color:var(--ink-3);cursor:pointer;text-transform:lowercase;transition:border-color .14s,color .14s;}
.mini:hover{border-color:var(--ink);color:var(--ink);}
.mini.danger:hover{border-color:#b23b3b;color:#b23b3b;}

/* section pills */
.pills{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:26px;padding-bottom:22px;border-bottom:1px solid var(--line);}
.pill{background:var(--hush);border:0;border-radius:999px;padding:7px 14px;font-size:12.5px;color:var(--ink-2);
  cursor:pointer;text-transform:lowercase;transition:background .14s,color .14s;}
.pill:hover{background:#e8e7e2;}
.pill.on{background:var(--pill);color:var(--pill-text);}

/* sheet headings */
.sheet-h{font-family:'Inter Tight',sans-serif;font-weight:600;font-size:13px;letter-spacing:.02em;
  text-transform:lowercase;color:var(--faint);margin:30px 0 12px;}

/* stat grid */
.stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:6px;}
.stat{background:var(--hush);border-radius:16px;padding:16px 16px 14px;}
.stat-val{font-family:'Inter Tight',sans-serif;font-weight:700;font-size:30px;letter-spacing:-.03em;color:var(--ink);line-height:1;}
.stat-label{font-size:11.5px;text-transform:lowercase;letter-spacing:.02em;color:var(--ink-3);margin-top:8px;}
.stat-sub{font-size:11px;color:var(--faint);margin-top:2px;text-transform:lowercase;}

/* key-value */
.kv{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:2px 24px;margin:0;}
.kv>div{display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid var(--line-2);}
.kv dt{font-size:13px;color:var(--ink-3);text-transform:lowercase;margin:0;}
.kv dd{font-size:13.5px;color:var(--ink);margin:0;text-align:right;text-transform:lowercase;}

/* chips */
.chips{display:flex;flex-wrap:wrap;gap:7px;}
.chip{background:var(--pill);color:var(--pill-text);border-radius:999px;padding:5px 12px;font-size:12px;text-transform:lowercase;}
.chip.ghost{background:transparent;color:var(--ink-2);border:1px solid var(--line);}

/* ability grid */
.ability-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(96px,1fr));gap:10px;}
.ability{position:relative;background:var(--hush);border-radius:16px;padding:16px 12px 13px;text-align:center;}
.ability.key{background:var(--pill);}
.ability.key .ability-mod,.ability.key .ability-name,.ability.key .ability-score{color:var(--pill-text);}
.ability-mod{font-family:'Inter Tight',sans-serif;font-weight:700;font-size:26px;letter-spacing:-.02em;color:var(--ink);}
.ability-name{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-3);margin-top:6px;}
.ability-score{font-size:12px;color:var(--faint);margin-top:3px;}
.ability-tag{position:absolute;top:8px;right:8px;font-size:9px;text-transform:lowercase;letter-spacing:.04em;
  color:var(--pill-text);opacity:.6;}

/* row lists */
.row-list{display:flex;flex-direction:column;}
.line{display:flex;align-items:baseline;gap:10px;padding:10px 2px;border-bottom:1px solid var(--line-2);}
.line.untrained{opacity:.5;}
.line-name{flex:1;font-size:14px;color:var(--ink);text-transform:lowercase;}
.line-val{font-family:'Inter Tight',sans-serif;font-weight:600;font-size:15px;color:var(--ink);min-width:34px;text-align:right;}
.ab-tag{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--faint);}
.rank{font-size:11px;color:var(--ink-3);text-transform:lowercase;}
.dmg{font-size:12px;color:var(--ink-3);min-width:74px;text-align:right;text-transform:lowercase;}
.line.wide .line-name{flex:1;}
.empty-line{font-size:13px;color:var(--faint);padding:12px 2px;text-transform:lowercase;}

/* companions */
.companion{background:var(--hush);border-radius:14px;padding:14px 16px;margin-bottom:10px;}
.companion-name{font-family:'Inter Tight',sans-serif;font-weight:600;font-size:15px;color:var(--ink);margin-bottom:9px;text-transform:lowercase;}

/* casters */
.caster{border:1px solid var(--line);border-radius:18px;padding:18px 20px;margin-bottom:16px;}
.caster-head{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-bottom:14px;padding-bottom:13px;border-bottom:1px solid var(--line-2);}
.caster-name{font-family:'Inter Tight',sans-serif;font-weight:600;font-size:16px;text-transform:lowercase;color:var(--ink);}
.caster-dc{margin-left:auto;font-size:12px;color:var(--ink-3);text-transform:lowercase;}
.spell-tier{margin-bottom:13px;}
.spell-rank{font-size:11px;text-transform:lowercase;letter-spacing:.03em;color:var(--faint);margin-bottom:7px;}
.slots{color:var(--ink-3);}
.known{margin-top:6px;border-top:1px solid var(--line-2);padding-top:12px;}
.known summary{font-size:12px;color:var(--ink-3);cursor:pointer;text-transform:lowercase;margin-bottom:10px;}
.focus-pool{display:inline-flex;gap:4px;margin-left:auto;}
.fp{width:11px;height:11px;border-radius:50%;background:var(--pill);}

/* coins */
.coins{display:flex;gap:10px;}
.coin{background:var(--hush);border-radius:13px;padding:12px 18px;text-align:center;min-width:64px;}
.coin-n{display:block;font-family:'Inter Tight',sans-serif;font-weight:700;font-size:20px;color:var(--ink);}
.coin-l{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--faint);}

/* importer */
.importer{max-width:520px;}
.import-sym{width:48px;height:48px;color:var(--ink);margin-bottom:18px;}
.import-title{font-family:'Inter Tight',sans-serif;font-weight:700;font-size:30px;letter-spacing:-.03em;
  text-transform:lowercase;color:var(--ink);margin:0 0 12px;}
.import-lead{font-size:14.5px;line-height:1.62;color:var(--ink-2);margin:0 0 22px;}
.import-lead strong{color:var(--ink);font-weight:600;}
.import-row{display:flex;gap:9px;margin-bottom:18px;}
.import-input{flex:1;border:1px solid var(--line);border-radius:12px;padding:11px 14px;font-size:14px;
  font-family:inherit;color:var(--ink);background:var(--panel);outline:none;}
.import-input:focus{border-color:var(--ink);}
.btn{background:var(--pill);color:var(--pill-text);border:0;border-radius:12px;padding:11px 18px;font-size:13.5px;
  cursor:pointer;text-transform:lowercase;white-space:nowrap;transition:opacity .14s;}
.btn:hover{opacity:.88;}
.btn:disabled{opacity:.4;cursor:not-allowed;}
.btn.block{width:100%;margin-top:10px;}
.import-or{display:flex;align-items:center;gap:12px;font-size:11.5px;color:var(--faint);text-transform:lowercase;margin:6px 0 12px;}
.import-or::before,.import-or::after{content:"";flex:1;height:1px;background:var(--line);}
.import-text{width:100%;border:1px solid var(--line);border-radius:14px;padding:14px;font-size:12.5px;
  font-family:ui-monospace,Menlo,monospace;color:var(--ink-2);background:var(--hush);outline:none;resize:vertical;}
.import-text:focus{border-color:var(--ink);}
.import-error{margin-top:14px;background:#fbeeee;border:1px solid #eccfcf;color:#a23a3a;border-radius:12px;
  padding:12px 14px;font-size:13px;line-height:1.5;}
.import-note{font-size:12px;line-height:1.55;color:var(--faint);margin-top:16px;}
.import-note code{background:var(--hush);padding:1px 5px;border-radius:5px;font-size:11.5px;}

/* scenario blocks — full port */
/* pathfinderwiki links */
.wlink{color:inherit;font-weight:600;text-decoration:none;border-bottom:1px dotted var(--faint);
  transition:border-color .14s;}
.wlink:hover,.wlink:focus-visible{border-bottom:1px solid var(--ink);outline:none;}
.scroll-cue{position:absolute;right:2px;bottom:2px;color:var(--faint);}
.scroll-cue .pict{width:20px;height:20px;}

/* ---------- prose ---------- */
.sec-h{
  font-family:'Inter Tight',sans-serif;
  font-weight:600;font-size:18px;letter-spacing:-.01em;text-transform:lowercase;
  color:var(--ink);margin:34px 0 11px;
  display:flex;align-items:center;gap:12px;
}
.sec-p{font-size:15.5px;line-height:1.68;color:var(--ink-2);margin:0 0 14px;}
.sec-p strong,.sec-list strong,.call-body strong,.hazard-x strong,.check dd strong{color:var(--ink);font-weight:600;}
.sec-list{margin:0 0 16px;padding-left:0;list-style:none;}
.sec-list li{position:relative;padding-left:22px;font-size:15px;line-height:1.6;color:var(--ink-2);margin-bottom:8px;}
.sec-list li::before{content:"";position:absolute;left:2px;top:9px;width:6px;height:6px;background:var(--ink);border-radius:50%;}

/* ---------- read aloud ---------- */
.read{
  position:relative;margin:20px 0 24px;
  padding:24px 26px 20px;
  background:var(--hush);
  border-radius:4px 18px 18px 4px;
  border-left:3px solid var(--ink);
}
.read-tab{
  display:inline-flex;align-items:center;gap:6px;
  position:absolute;top:-11px;left:18px;
  background:var(--pill);color:var(--pill-text);
  font-size:10.5px;letter-spacing:.04em;text-transform:lowercase;
  padding:4px 11px;border-radius:999px;
}
.read-tab .pict{width:12px;height:12px;}
.read p{
  font-size:16px;line-height:1.72;color:#26241f;
  font-weight:450;margin:0 0 12px;
}
.read p:last-child{margin-bottom:0;}

/* ---------- skill check ---------- */
.check{margin:20px 0 24px;border:1px solid var(--line);border-radius:16px;overflow:hidden;}
.check-head{
  display:flex;align-items:center;gap:10px;flex-wrap:wrap;
  background:var(--canvas);border-bottom:1px solid var(--line);
  padding:12px 18px;
}
.check-head .pict{width:17px;height:17px;color:var(--ink);}
.check-skill{font-weight:600;font-size:13.5px;text-transform:lowercase;letter-spacing:.01em;}
.check-dc{
  font-size:12px;font-weight:600;text-transform:lowercase;
  background:var(--pill);color:var(--pill-text);padding:2px 10px;border-radius:999px;
}
.check-action{font-size:12px;color:var(--ink-3);text-transform:lowercase;}
.check-tiers{margin:0;}
.tier{display:grid;grid-template-columns:150px 1fr;padding:12px 18px;border-bottom:1px solid var(--line-2);align-items:baseline;}
.tier:last-child{border-bottom:0;}
.tier dt{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;text-transform:lowercase;letter-spacing:.01em;color:var(--ink);}
.tier dd{margin:0;font-size:14px;line-height:1.56;color:var(--ink-2);}
.tier-mark{display:inline-flex;gap:3px;}
.tdot{width:7px;height:7px;border-radius:50%;border:1.4px solid var(--ink);}
.tdot.on{background:var(--ink);}

/* ---------- location header ---------- */
.loc{display:flex;align-items:center;gap:12px;margin:38px 0 6px;padding-bottom:10px;border-bottom:2px solid var(--ink);}
.loc-code{font-family:'Inter Tight',sans-serif;font-weight:700;font-size:12.5px;background:var(--pill);color:var(--pill-text);padding:3px 9px;border-radius:7px;letter-spacing:.02em;}
.loc-name{font-family:'Inter Tight',sans-serif;font-weight:600;font-size:20px;letter-spacing:-.02em;text-transform:lowercase;color:var(--ink);}

/* ---------- maps view (area/town maps) ---------- */
.map-block{margin:0 0 34px;}
.map-block-head{display:flex;align-items:center;gap:12px;margin:0 0 12px;padding-bottom:10px;border-bottom:2px solid var(--ink);}
.map-fig{position:relative;display:inline-block;max-width:100%;line-height:0;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--panel);}
.map-img{display:block;max-width:100%;height:auto;}
.map-pin{position:absolute;transform:translate(-50%,-50%);min-width:30px;height:24px;padding:0 7px;
  font-family:'Inter Tight',sans-serif;font-weight:700;font-size:12.5px;line-height:21px;text-align:center;
  background:var(--pill);color:var(--pill-text);border:2px solid #fff;border-radius:7px;cursor:pointer;
  box-shadow:0 1px 5px rgba(0,0,0,.5);letter-spacing:.02em;transition:transform .08s ease;}
.map-pin:hover{transform:translate(-50%,-50%) scale(1.15);z-index:2;}
.map-caption{margin:12px 2px 0;font-size:13.5px;color:var(--ink-3);line-height:1.5;max-width:700px;}
.map-legend{list-style:none;margin:14px 0 0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(248px,1fr));gap:6px;max-width:780px;}
.map-legend-row{display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:var(--panel);
  border:1px solid var(--line);border-radius:8px;padding:8px 11px;cursor:pointer;font:inherit;color:var(--ink);}
.map-legend-row:hover{border-color:var(--pill);background:var(--canvas);}
.map-legend-code{font-family:'Inter Tight',sans-serif;font-weight:700;font-size:12px;background:var(--pill);color:var(--pill-text);padding:2px 8px;border-radius:6px;letter-spacing:.02em;}
.map-legend-name{flex:1;font-size:13.5px;}
.map-legend-row .rail-arrow{opacity:.4;}

/* ---------- severity meter ---------- */
.sev{display:inline-flex;align-items:center;gap:8px;}
.sev-dots{display:inline-flex;gap:3px;}
.sev-dot{width:7px;height:7px;border-radius:2px;background:var(--line);}
.sev-dot.on{background:var(--ink);}
.sev-label{font-size:11px;text-transform:lowercase;letter-spacing:.04em;color:var(--ink-3);}

/* ---------- encounter pointer ---------- */
.enc{margin:20px 0 24px;border:1px dashed #cfcec8;border-radius:16px;background:#faf9f7;padding:16px 18px;}
.enc-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:4px;}
.enc-area{font-weight:600;font-size:12px;letter-spacing:.02em;text-transform:lowercase;color:var(--ink);}
.enc-die{font-family:'Inter Tight',sans-serif;font-weight:600;font-size:11.5px;background:#e9e8e3;color:var(--ink);padding:1px 8px;border-radius:6px;}
.enc-ptr{margin-left:auto;font-size:11px;color:var(--faint);text-transform:lowercase;letter-spacing:.02em;}
.enc-note{font-size:13.5px;line-height:1.56;color:var(--ink-3);margin:7px 0 11px;}
.enc-options{list-style:none;margin:0;padding:0;display:grid;gap:6px;}
.enc-options li{display:flex;justify-content:space-between;align-items:baseline;gap:10px;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:8px 12px;font-size:13.5px;}
.enc-opt-name{font-weight:500;color:var(--ink);}
.enc-opt-cr{font-size:11.5px;color:var(--faint);}

/* ---------- hazard pointer ---------- */
.hazard{margin:20px 0 24px;border:1px solid var(--line);border-left:3px solid var(--ink);border-radius:4px 16px 16px 4px;background:#fbfbfa;padding:15px 18px;}
.hazard-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px;}
.hazard-flag{display:inline-flex;align-items:center;gap:5px;font-size:10.5px;font-weight:600;letter-spacing:.04em;text-transform:lowercase;color:var(--pill-text);background:var(--pill);padding:3px 9px;border-radius:999px;}
.hazard-flag .pict{width:12px;height:12px;}
.hazard-name{font-family:'Inter Tight',sans-serif;font-weight:600;font-size:16px;letter-spacing:-.01em;text-transform:lowercase;color:var(--ink);}
.hazard-x{font-size:14px;line-height:1.6;color:var(--ink-2);margin:0 0 10px;}
.hazard-dcs{list-style:none;margin:0;padding:0;display:grid;gap:6px;}
.hazard-dcs li{font-size:13px;line-height:1.45;color:var(--ink-3);padding-left:18px;position:relative;}
.hazard-dcs li::before{content:"→";position:absolute;left:0;top:0;color:var(--ink);}

/* ---------- callout (monochrome) ---------- */
.call{display:flex;margin:18px 0 20px;border:1px solid var(--line);border-radius:16px;overflow:hidden;}
.call-label{flex:0 0 116px;display:flex;align-items:flex-start;gap:7px;padding:14px 14px;background:var(--canvas);border-right:1px solid var(--line);font-size:11px;font-weight:600;letter-spacing:.02em;text-transform:lowercase;color:var(--ink);line-height:1.3;}
.call-label .pict{width:14px;height:14px;flex:0 0 14px;margin-top:1px;}
.call-body{flex:1;padding:14px 18px;}
.call-title{font-family:'Inter Tight',sans-serif;font-weight:600;font-size:15px;letter-spacing:-.01em;color:var(--ink);margin-bottom:3px;}
.call-body p{font-size:14px;line-height:1.6;color:var(--ink-2);margin:0;}

/* ---------- npc roster ---------- */
.npcs{display:grid;gap:8px;margin:8px 0 18px;}
.npc{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;background:var(--hush);border-radius:12px;padding:11px 15px;}
.npc-name{font-family:'Inter Tight',sans-serif;font-weight:600;font-size:15px;letter-spacing:-.01em;color:var(--ink);}
.npc-tag{font-size:12.5px;color:var(--ink-3);}

.scrim{display:none;}
.stub{background:var(--hush);border-radius:16px;padding:22px 24px;}

.scrim{display:none;}

/* ===================== encounters ===================== */
.enc-head{display:flex;gap:18px;align-items:flex-start;margin-bottom:22px;}
.enc-head .article-sym{margin-bottom:0;width:46px;height:46px;flex:0 0 46px;}
.enc-head-main{flex:1;min-width:0;}
.enc-name{font-family:'Inter Tight',sans-serif;font-weight:700;font-size:34px;line-height:1.04;letter-spacing:-.03em;
  text-transform:lowercase;color:var(--ink);background:transparent;border:0;border-bottom:1px solid transparent;
  width:100%;padding:2px 0;outline:none;}
.enc-name:hover{border-bottom-color:var(--line);}
.enc-name:focus{border-bottom-color:var(--ink);}
.enc-head-actions{display:flex;flex-direction:column;align-items:flex-end;gap:8px;}
.enc-note-sub{font-size:12.5px;color:var(--ink-3);margin-top:6px;text-transform:lowercase;}
.cbt-note{font-size:11px;color:var(--faint);margin-top:3px;text-transform:lowercase;}
.npc-traits{margin-bottom:16px;}
.npc-lines{list-style:none;margin:0 0 6px;padding:0;display:flex;flex-direction:column;gap:9px;}
.npc-lines li{font-size:14px;line-height:1.55;color:var(--ink-2);padding-left:16px;position:relative;}
.npc-lines li::before{content:"";position:absolute;left:2px;top:9px;width:5px;height:5px;border-radius:50%;background:var(--ink);}
.enc-threat{font-size:12px;font-weight:600;text-transform:lowercase;letter-spacing:.01em;
  background:var(--hush);color:var(--ink);padding:5px 12px;border-radius:999px;white-space:nowrap;}
.enc-threat.t-moderate{background:#ece9df;}
.enc-threat.t-severe,.enc-threat.t-extreme{background:#0e0e0e;color:#f5f5f3;}

.enc-toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:18px;}
.tb{display:flex;align-items:center;gap:7px;border:1px solid var(--line);background:var(--panel);border-radius:11px;
  padding:9px 14px;font-size:13px;color:var(--ink-2);cursor:pointer;text-transform:lowercase;
  transition:border-color .14s,color .14s,background .14s;}
.tb:hover{border-color:var(--ink-3);color:var(--ink);}
.tb:disabled{opacity:.4;cursor:not-allowed;}
.tb.on{background:var(--pill);color:var(--pill-text);border-color:var(--pill);}
.tb.on .tb-sym{color:var(--pill-text);}
.tb-sym{width:15px;height:15px;color:var(--ink);}
.tb.roll{background:var(--pill);color:var(--pill-text);border-color:var(--pill);font-weight:500;}
.tb.roll .tb-sym{color:var(--pill-text);}
.tb.roll:hover{opacity:.9;}
.danger-tb{margin-left:auto;}
.danger-tb:hover{border-color:#b23b3b;color:#b23b3b;}
.tb-wrap{position:relative;}
.menu{position:absolute;top:calc(100% + 6px);left:0;z-index:30;min-width:190px;background:var(--panel);
  border:1px solid var(--line);border-radius:13px;box-shadow:0 18px 40px -22px rgba(17,17,17,.4);padding:6px;}
.menu-item{display:flex;justify-content:space-between;align-items:baseline;gap:10px;width:100%;border:0;background:transparent;
  cursor:pointer;padding:9px 11px;border-radius:9px;font-size:14px;color:var(--ink);text-align:left;text-transform:lowercase;}
.menu-item:hover{background:var(--hush);}
.menu-sub{font-size:11.5px;color:var(--faint);}

.enc-map{border:1px solid var(--line);border-radius:16px;overflow:hidden;margin-bottom:20px;}
.enc-map img{display:block;width:100%;max-height:420px;object-fit:contain;background:var(--hush);}
.enc-map-empty{padding:30px;text-align:center;color:var(--faint);font-size:13px;text-transform:lowercase;background:var(--hush);}
.enc-map-ctrl{display:flex;gap:8px;align-items:center;padding:12px 14px;border-top:1px solid var(--line);flex-wrap:wrap;}
.enc-map-ctrl .inp{flex:1;min-width:160px;}
.filebtn{cursor:pointer;}

.cbt-list{display:flex;flex-direction:column;gap:8px;}
.cbt-empty{color:var(--faint);font-size:13.5px;text-transform:lowercase;padding:18px 2px;}
.cbt{display:flex;align-items:flex-start;gap:14px;padding:14px 16px;border:1px solid var(--line);border-radius:16px;background:var(--panel);}
.cbt.kind-enemy{border-left:3px solid var(--ink);}
.cbt.kind-ally{border-left:3px solid var(--line);}
.cbt.kind-pc{border-left:3px solid var(--faint);}
.cbt-init{flex:0 0 54px;}
.init-inp{width:54px;height:46px;text-align:center;font-family:'Inter Tight',sans-serif;font-weight:700;font-size:19px;
  color:var(--ink);background:var(--hush);border:1px solid var(--line);border-radius:11px;outline:none;}
.init-inp:focus{border-color:var(--ink);}
.cbt-avatar{flex:0 0 38px;width:38px;height:38px;border-radius:50%;background:var(--hush);display:flex;align-items:center;justify-content:center;margin-top:3px;}
.cbt-sym{width:19px;height:19px;color:var(--ink-2);}
.cbt-main{flex:1;min-width:0;}
.cbt-name-row{display:flex;align-items:baseline;gap:9px;flex-wrap:wrap;}
.cbt-name{font-family:'Inter Tight',sans-serif;font-weight:600;font-size:16px;color:var(--ink);text-transform:lowercase;}
.cbt-link{border:0;background:transparent;cursor:pointer;color:var(--ink-3);font-size:13px;padding:0;line-height:1;}
.cbt-link:hover{color:var(--ink);}
.cbt-kind{font-size:9.5px;text-transform:lowercase;letter-spacing:.04em;padding:2px 7px;border-radius:999px;}
.cbt-kind.k-enemy{background:var(--pill);color:var(--pill-text);}
.cbt-kind.k-ally{background:var(--hush);color:var(--ink-2);}
.cbt-kind.k-pc{background:transparent;color:var(--faint);border:1px solid var(--line);}
.cbt-level{font-size:11.5px;color:var(--faint);text-transform:lowercase;}
.cbt-def{font-size:12.5px;color:var(--ink-3);margin-top:4px;text-transform:lowercase;}
.cbt-conds{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px;align-items:center;}
.cond{display:inline-flex;align-items:center;gap:5px;background:var(--hush);border-radius:999px;padding:3px 6px 3px 10px;
  font-size:11.5px;color:var(--ink);text-transform:lowercase;}
.cond-x{border:0;background:transparent;cursor:pointer;color:var(--ink-3);font-size:13px;line-height:1;padding:0 2px;}
.cond-x:hover{color:#b23b3b;}
.cond-add{border:1px dashed var(--line);background:transparent;border-radius:999px;padding:3px 10px;font-size:11px;
  color:var(--ink-3);cursor:pointer;text-transform:lowercase;transition:border-color .14s,color .14s;}
.cond-add:hover{border-color:var(--ink-3);color:var(--ink);}
.cbt-hp{display:flex;align-items:center;gap:6px;flex:0 0 auto;margin-top:3px;}
.hp-inp{width:58px;height:40px;text-align:center;font-family:'Inter Tight',sans-serif;font-weight:600;font-size:16px;
  color:var(--ink);background:var(--panel);border:1px solid var(--line);border-radius:10px;outline:none;}
.hp-inp:focus{border-color:var(--ink);}
.hp-sep{color:var(--faint);}
.hp-max{font-family:'Inter Tight',sans-serif;font-weight:600;font-size:16px;color:var(--ink-3);min-width:26px;}
.cbt-x{border:0;background:transparent;cursor:pointer;color:var(--faint);font-size:18px;line-height:1;padding:2px 4px;margin-top:6px;}
.cbt-x:hover{color:#b23b3b;}

/* ----- modals ----- */
.modal-overlay{position:fixed;inset:0;z-index:60;background:rgba(17,17,17,.34);backdrop-filter:blur(2px);
  display:flex;align-items:center;justify-content:center;padding:20px;}
.modal-card{width:100%;max-width:540px;background:var(--panel);border-radius:22px;padding:26px 28px;
  box-shadow:0 30px 70px -30px rgba(17,17,17,.5);max-height:88vh;overflow-y:auto;}
.modal-card.narrow{max-width:420px;}
.modal-head{display:flex;align-items:center;gap:12px;margin-bottom:20px;}
.modal-title{font-family:'Inter Tight',sans-serif;font-weight:700;font-size:22px;letter-spacing:-.02em;
  text-transform:lowercase;color:var(--ink);margin:0;flex:1;}
.modal-ref{font-size:12px;color:var(--ink-3);text-decoration:none;text-transform:lowercase;}
.modal-ref:hover{color:var(--ink);}
.modal-x{border:0;background:transparent;cursor:pointer;font-size:22px;color:var(--ink-3);line-height:1;}
.modal-x:hover{color:var(--ink);}
.toggle{display:flex;gap:4px;background:var(--hush);padding:3px;border-radius:10px;}
.toggle-opt{border:0;background:transparent;cursor:pointer;padding:6px 16px;border-radius:8px;font-size:13px;
  color:var(--ink-3);text-transform:lowercase;}
.toggle-opt.on{background:var(--panel);color:var(--ink);box-shadow:0 1px 2px rgba(17,17,17,.08);font-weight:500;}
.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
.form-grid.three{grid-template-columns:1fr 1fr 1fr;}
.form-grid.name-row{grid-template-columns:2fr 1fr;}
.field{display:flex;flex-direction:column;gap:6px;}
.field.span2{grid-column:1 / -1;}
.field>span{font-size:12px;color:var(--ink-3);text-transform:lowercase;}
.field i{color:#b23b3b;font-style:normal;}
.inp{border:1px solid var(--line);border-radius:11px;padding:10px 12px;font-size:14px;font-family:inherit;
  color:var(--ink);background:var(--panel);outline:none;width:100%;}
.inp:focus{border-color:var(--ink);}
.inp.area{resize:vertical;}
.form-div{height:1px;background:var(--line);margin:18px 0;}
.modal-foot{display:flex;justify-content:flex-end;gap:10px;margin-top:22px;}
.cond-list{display:flex;flex-wrap:wrap;gap:6px;margin:14px 0;max-height:260px;overflow-y:auto;padding:2px;}
.cond-opt{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);background:var(--panel);
  border-radius:999px;padding:6px 12px;font-size:12.5px;color:var(--ink-2);cursor:pointer;text-transform:lowercase;
  transition:border-color .14s,background .14s,color .14s;}
.cond-opt:hover{border-color:var(--ink-3);}
.cond-opt.on{background:var(--pill);color:var(--pill-text);border-color:var(--pill);}
.cond-valued{font-size:9px;opacity:.6;letter-spacing:.04em;}
.cond-foot{display:flex;gap:12px;align-items:flex-end;}
.cond-foot .field{flex:1;}

@media (max-width:880px){
  .shell{height:auto;min-height:100vh;}
  .managers{flex-wrap:wrap;gap:10px 12px;padding:12px 16px;position:sticky;top:0;z-index:25;
    background:rgba(244,244,242,.96);backdrop-filter:blur(6px);}
  .managers-brand{width:100%;}
  .managers-tabs{flex:1;}
  .ms-btn{flex:1;justify-content:center;padding:9px 8px;}
  .app{display:block;height:auto;min-height:0;}
  .rail{position:fixed;top:0;left:0;bottom:0;z-index:40;width:280px;background:var(--canvas);padding-top:20px;
    transform:translateX(-100%);transition:transform .22s ease;box-shadow:0 0 60px rgba(0,0,0,.12);}
  .rail.open{transform:translateX(0);}
  .scrim{display:block;position:fixed;inset:0;z-index:30;background:rgba(17,17,17,.32);}
  .content{height:auto;padding:0;}
  .panel{border-radius:0;border:0;min-height:60vh;box-shadow:none;}
  .topbar{display:flex;align-items:center;gap:13px;position:sticky;top:0;z-index:20;padding:13px 18px;
    background:rgba(244,244,242,.94);backdrop-filter:blur(6px);border-bottom:1px solid var(--line);}
  .menu-btn{display:flex;flex-direction:column;gap:4px;background:transparent;border:0;cursor:pointer;padding:4px;}
  .menu-btn span{width:20px;height:2px;background:var(--ink);border-radius:2px;}
  .crumb{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--ink-3);text-transform:lowercase;}
  .crumb-sep{color:var(--line);}
  .crumb-now{color:var(--ink);font-weight:500;}
  .article{padding:26px 22px 70px;}
  .article-title{font-size:28px;}
  .pc-head{flex-wrap:wrap;}
  .pc-head-right{flex-basis:auto;width:100%;}
  .pc-actions{order:3;width:100%;}
  .enc-head{flex-wrap:wrap;}
  .enc-head-actions{flex-direction:row;width:100%;justify-content:space-between;}
  .enc-name{font-size:26px;}
  .form-grid,.form-grid.three,.form-grid.name-row{grid-template-columns:1fr 1fr;}
  .cbt{flex-wrap:wrap;}
  .cbt-hp{margin-left:auto;}
  .danger-tb{margin-left:0;}
}
`}</style>
  );
}
