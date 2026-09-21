/* ==================================================================== *
 *  Creature stat block: the tracker's popover card and its editor
 *
 *  StatBlockCard is a read-only reference surface anchored to a combatant
 *  row — speeds, senses, defences, strikes (with the multiple-attack series),
 *  spells and abilities. It is not a dialog: it never traps focus, and the
 *  tracker stays fully usable underneath it.
 *
 *  StatBlockEditor lives in the row's ✎ edit mode. Strikes and abilities are
 *  structured rows; everything else is a comma-separated text field parsed
 *  when the field is left. The data shape is documented in lib/statblock.js.
 * ==================================================================== */
import { useState, useEffect, useLayoutEffect, useRef, useCallback, Fragment } from "react";
import { createPortal } from "react-dom";
import {
  fmtMod, mapSeries, costGlyph, COSTS, COST_LABEL, speedLabel,
  listToText, parseList, speedsToText, parseSpeeds, skillsToText, parseSkills,
  spellsToText, parseSpells, spellLinkName, blankStrike, blankAbility,
} from "../lib/statblock.js";
import { AonLink } from "./aonlink.jsx";
import { useAonIndex } from "./useAonIndex.js";

const CARD_W = 410;
const GAP = 8; // card's offset from the row
const EDGE = 12; // breathing room kept from the viewport's edges
const MIN_ROOM = 240; // a side with less than this is abandoned for the other
const MIN_CARD = 160; // never squeeze the card below this, even off a cramped row

// "plus **spider venom** — fort **dc 16**" -> text with the starred runs bold.
function Rich({ text }) {
  return String(text || "").split(/\*\*(.+?)\*\*/g).map((part, i) =>
    (i % 2 ? <strong key={i}>{part}</strong> : <Fragment key={i}>{part}</Fragment>));
}

function StrikeRow({ a, open, onToggle }) {
  const [first, ...rest] = mapSeries(a.attack || 0, a.traits);
  const where = a.range ? `${a.range} ft` : a.reach ? `reach ${a.reach} ft` : "";
  const more = [a.type, ...(a.traits || [])].filter(Boolean).join(" · ");
  const expandable = !!(more || a.text);
  return (
    <div className="sb-entry">
      <button className="sb-row" onClick={onToggle} disabled={!expandable} aria-expanded={expandable ? open : undefined}>
        <span className="sb-cost strike">{costGlyph(a.cost)}</span>
        <span className="sb-name">{a.name}{where && <span className="sb-range"> {where}</span>}</span>
        <span className="sb-attack">{fmtMod(first)}<span className="sb-map"> / {rest.map(fmtMod).join(" / ")}</span></span>
        <span className={`sb-damage${a.damage ? "" : " none"}`}>{a.damage || "no damage"}</span>
      </button>
      {a.rider && <div className="sb-rider"><Rich text={a.rider} /></div>}
      {open && expandable && (
        <div className="sb-more">
          {more && <div className="sb-traits">{more}</div>}
          {a.text && <div>{a.text}</div>}
        </div>
      )}
    </div>
  );
}

function AbilityRow({ a, open, onToggle }) {
  const traits = (a.traits || []).join(" · ");
  const expandable = !!(traits || a.text);
  return (
    <div className="sb-entry">
      <button className="sb-row" onClick={onToggle} disabled={!expandable} aria-expanded={expandable ? open : undefined}>
        <span className="sb-cost">{costGlyph(a.cost)}</span>
        <span className="sb-name">{a.name}</span>
        <span className="sb-detail">{a.detail}</span>
      </button>
      {open && expandable && (
        <div className="sb-more">
          {traits && <div className="sb-traits">{traits}</div>}
          {a.text && <div>{a.text}</div>}
        </div>
      )}
    </div>
  );
}

function SpellRow({ l, open, onToggle }) {
  const head = [l.dc != null && `dc ${l.dc}`, l.attack != null && `attack ${fmtMod(l.attack)}`, l.note].filter(Boolean).join(" · ");
  const ranks = l.ranks || [];
  return (
    <div className="sb-entry">
      <button className="sb-row" onClick={onToggle} disabled={!ranks.length} aria-expanded={ranks.length ? open : undefined}>
        <span className="sb-cost">✦</span>
        <span className="sb-name">{/spells|rituals/.test(l.name) ? l.name : `${l.name} spells`}</span>
        <span className="sb-detail">{head}</span>
      </button>
      {open && ranks.length > 0 && (
        <div className="sb-more sb-ranks">
          {ranks.map((r, i) => (
            <div key={i} className="sb-rank">
              <span className="sb-rank-label">{r.rank}</span>
              <span>
                {r.spells.map((s, j) => {
                  const name = spellLinkName(s);
                  return (
                    <Fragment key={j}>
                      {j > 0 && ", "}
                      <AonLink kind="spell" name={name} className="sb-spell" />{s.slice(name.length)}
                    </Fragment>
                  );
                })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const SOURCE_TAG = { bestiary: "from bestiary", custom: "edited" };

/* The card is position:fixed in a portal — the tracker's list is a scroll
 * container, which would clip an absolutely-placed child — and re-measures its
 * row on every scroll or resize: below the row by default, above when there
 * isn't room. It keeps the side it opened on for as long as that side stays
 * usable, and takes up a shortfall by scrolling its list, so expanding an entry
 * grows the card in place rather than throwing it across the row. */
export function StatBlockCard({ name, level, sb, anchor, focusOnOpen, onClose }) {
  useAonIndex(); // upgrades the spell links from AoN searches to deep links
  const cardRef = useRef(null);
  const listRef = useRef(null);
  const side = useRef(null); // "below" | "above", sticky while the card is open
  const [pos, setPos] = useState(null);
  const [open, setOpen] = useState(null); // key of the expanded entry

  const place = useCallback(() => {
    const card = cardRef.current;
    const list = listRef.current;
    if (!anchor || !card || !list) return;
    const row = anchor.getBoundingClientRect();
    const main = anchor.querySelector(".cbt-main");
    const startX = main ? main.getBoundingClientRect().left : row.left;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // the height the card wants: everything, up to the 60vh the design caps it at
    const want = Math.min(card.offsetHeight - list.clientHeight + list.scrollHeight, vh * 0.6);
    const room = { below: vh - EDGE - (row.bottom + GAP), above: row.top - GAP - EDGE };
    const usable = (k) => room[k] >= Math.min(want, MIN_ROOM);
    if (!side.current || !usable(side.current)) {
      side.current = room.below >= want ? "below" : room.above >= want ? "above" : room.below >= room.above ? "below" : "above";
    }
    const maxHeight = Math.max(MIN_CARD, Math.min(want, room[side.current]));
    const top = side.current === "below" ? row.bottom + GAP : row.top - GAP - maxHeight;
    setPos({
      left: Math.max(EDGE, Math.min(startX, vw - CARD_W - EDGE)),
      top: Math.max(EDGE, Math.min(top, vh - EDGE - maxHeight)),
      maxHeight,
    });
  }, [anchor]);

  // `open` is a dependency so an expanded entry re-runs the flip/clamp maths.
  useLayoutEffect(place, [place, sb, open]);
  useEffect(() => {
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [place]);

  useEffect(() => {
    if (focusOnOpen && cardRef.current) cardRef.current.focus({ preventScroll: true });
  }, [focusOnOpen]);

  const toggle = (key) => setOpen((cur) => (cur === key ? null : key));
  const actions = sb.actions.map((a, i) => ({ a, key: `a${i}` }));
  const strikes = actions.filter((x) => x.a.kind === "strike");
  const abilities = actions.filter((x) => x.a.kind !== "strike");
  const [walk, ...otherSpeeds] = sb.speeds;
  const d = sb.defences;
  const facts = [
    ["skills", sb.skills.map((s) => `${s.name} ${fmtMod(s.mod)}${s.note ? ` (${s.note})` : ""}`).join(" · ")],
    ["immune", d.immunities.join(", ")],
    ["weak", d.weaknesses.join(", ")],
    ["resist", d.resistances.join(", ")],
    ["also", d.notes.join(" · ")],
  ].filter(([, v]) => v);
  const empty = strikes.length + abilities.length + sb.spells.length === 0;

  return createPortal(
    <div
      ref={cardRef}
      className="sb-card"
      role="dialog"
      aria-label={`${name} stat block`}
      tabIndex={-1}
      data-sb-card
      style={pos ? { left: pos.left, top: pos.top, maxHeight: pos.maxHeight } : { left: 0, top: 0, visibility: "hidden" }}
    >
      <div className="sb-head">
        <span className="sb-title">{name}</span>
        <span className="sb-level">lvl {level}</span>
        {SOURCE_TAG[sb.source] && <span className="sb-source">{SOURCE_TAG[sb.source]}</span>}
        <button className="sb-close" onClick={onClose} aria-label="close stat block">×</button>
      </div>
      {(sb.speeds.length > 0 || sb.senses.length > 0 || facts.length > 0) && (
        <div className="sb-strip">
          {(sb.speeds.length > 0 || sb.senses.length > 0) && (
            <div className="sb-cells">
              {walk && (
                <div className="sb-cell">
                  <div className="sb-label">speed</div>
                  <div className="sb-speed">
                    {speedLabel(walk)}
                    {otherSpeeds.map((s, i) => <span key={i} className="sb-speed-alt"> · {speedLabel(s)}</span>)}
                  </div>
                </div>
              )}
              {sb.senses.length > 0 && (
                <div className="sb-cell">
                  <div className="sb-label">senses</div>
                  <div className="sb-senses">{sb.senses.join(" · ")}</div>
                </div>
              )}
            </div>
          )}
          {facts.length > 0 && (
            <dl className="sb-facts">
              {facts.map(([label, value]) => (
                <div key={label}><dt className="sb-label">{label}</dt><dd>{value}</dd></div>
              ))}
            </dl>
          )}
        </div>
      )}
      <div className="sb-list" ref={listRef}>
        {empty && <div className="sb-none">no strikes or abilities recorded</div>}
        {strikes.map(({ a, key }) => <StrikeRow key={key} a={a} open={open === key} onToggle={() => toggle(key)} />)}
        {sb.spells.map((l, i) => <SpellRow key={`s${i}`} l={l} open={open === `s${i}`} onToggle={() => toggle(`s${i}`)} />)}
        {abilities.map(({ a, key }) => <AbilityRow key={key} a={a} open={open === key} onToggle={() => toggle(key)} />)}
      </div>
    </div>,
    document.body
  );
}

/* ---- editor ---- */

/* A text field over a parsed value ("25 ft, climb 25 ft" <-> speeds). It keeps
 * its own text while focused and commits on blur — re-rendering it from the
 * parsed value mid-keystroke would eat a half-typed entry. */
function ParsedField({ label, value, onCommit, placeholder, area, wide }) {
  const [text, setText] = useState(value);
  const [seen, setSeen] = useState(value);
  const [focused, setFocused] = useState(false);
  if (seen !== value) {
    setSeen(value);
    if (!focused) setText(value);
  }
  const props = {
    value: text,
    placeholder,
    onChange: (e) => setText(e.target.value),
    onFocus: () => setFocused(true),
    onBlur: () => { setFocused(false); if (text !== value) onCommit(text); },
  };
  return (
    <label className={`sbe-field${wide ? " wide" : ""}`}>
      <span>{label}</span>
      {area ? <textarea rows={4} {...props} /> : <input {...props} />}
    </label>
  );
}

function TextField({ label, value, onChange, placeholder, grow, area }) {
  const props = { value: value || "", placeholder, onChange: (e) => onChange(e.target.value) };
  return (
    <label className={`sbe-field${grow ? " grow" : ""}${area ? " wide" : ""}`}>
      <span>{label}</span>
      {area ? <textarea rows={2} {...props} /> : <input {...props} />}
    </label>
  );
}

function NumField({ label, value, onChange, placeholder }) {
  return (
    <label className="sbe-field num">
      <span>{label}</span>
      <input
        type="number"
        value={value == null ? "" : value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      />
    </label>
  );
}

function CostSelect({ value, onChange }) {
  return (
    <label className="sbe-field">
      <span>cost</span>
      <select value={String(value)} onChange={(e) => onChange(/^[123]$/.test(e.target.value) ? Number(e.target.value) : e.target.value)}>
        {COSTS.map((c) => <option key={c} value={String(c)}>{COST_LABEL[c]}</option>)}
      </select>
    </label>
  );
}

function ActionEditor({ a, first, last, onChange, onMove, onRemove }) {
  const set = (k) => (v) => {
    const next = { ...a, [k]: v };
    if (v == null || v === "") delete next[k];
    onChange(next);
  };
  const strike = a.kind === "strike";
  return (
    <div className="sbe-action">
      <div className="sbe-action-head">
        <span className="sbe-kind">{strike ? "strike" : "ability"}</span>
        <button className="sbe-mini" onClick={() => onMove(-1)} disabled={first} title="move up" aria-label="move up">↑</button>
        <button className="sbe-mini" onClick={() => onMove(1)} disabled={last} title="move down" aria-label="move down">↓</button>
        <button className="sbe-mini danger" onClick={onRemove} title="remove" aria-label={`remove ${a.name || (strike ? "strike" : "ability")}`}>×</button>
      </div>
      <div className="sbe-fields">
        <TextField label="name" value={a.name} onChange={(v) => onChange({ ...a, name: v })} placeholder={strike ? "jaws" : "breath weapon"} grow />
        <CostSelect value={a.cost} onChange={(v) => onChange({ ...a, cost: v })} />
        {strike && (
          <>
            <label className="sbe-field">
              <span>type</span>
              <select value={a.type || "melee"} onChange={(e) => onChange({ ...a, type: e.target.value })}>
                <option value="melee">melee</option>
                <option value="ranged">ranged</option>
              </select>
            </label>
            <NumField label="attack" value={a.attack} onChange={(v) => onChange({ ...a, attack: v == null ? 0 : v })} />
            <TextField label="damage" value={a.damage} onChange={(v) => onChange({ ...a, damage: v })} placeholder="1d8+4 piercing" grow />
            <NumField label="range ft" value={a.range} onChange={set("range")} placeholder="—" />
            <NumField label="reach ft" value={a.reach} onChange={set("reach")} placeholder="—" />
          </>
        )}
        {!strike && <TextField label="summary" value={a.detail} onChange={(v) => onChange({ ...a, detail: v })} placeholder="30 ft cone · basic ref dc 24" grow />}
        <ParsedField wide label={strike ? "traits — agile sets the −4 / −8 series" : "traits"} value={listToText(a.traits)} onCommit={(t) => onChange({ ...a, traits: parseList(t).map((x) => x.toLowerCase()) })} placeholder="agile, finesse" />
        {strike && <TextField area label="rider — shown under the strike; **stars** make bold" value={a.rider} onChange={set("rider")} placeholder="plus **spider venom** — fort **dc 16**" />}
        <TextField area label="full text — shown when the row is expanded" value={a.text} onChange={set("text")} />
      </div>
    </div>
  );
}

/* `sb` is the block the card currently shows (already normalized), or null when
 * the creature has none. Every change is handed up whole; the row stores it on
 * the combatant as a "custom" block, which is what makes an edit outrank the
 * scenario and the bestiary from then on. */
export function StatBlockEditor({ sb, onChange }) {
  const setDef = (k) => (t) => onChange({ ...sb, defences: { ...sb.defences, [k]: parseList(t) } });
  const setAction = (i, a) => onChange({ ...sb, actions: sb.actions.map((x, j) => (j === i ? a : x)) });
  const move = (i, by) => {
    const next = [...sb.actions];
    const [a] = next.splice(i, 1);
    next.splice(i + by, 0, a);
    onChange({ ...sb, actions: next });
  };
  return (
    <div className="sbe">
      <div className="sbe-fields">
        <ParsedField wide label="speeds" value={speedsToText(sb.speeds)} onCommit={(t) => onChange({ ...sb, speeds: parseSpeeds(t) })} placeholder="25 ft, climb 25 ft" />
        <ParsedField wide label="senses" value={listToText(sb.senses)} onCommit={(t) => onChange({ ...sb, senses: parseList(t) })} placeholder="darkvision, scent (imprecise) 30 ft" />
        <ParsedField wide label="skills" value={skillsToText(sb.skills)} onCommit={(t) => onChange({ ...sb, skills: parseSkills(t) })} placeholder="athletics +9, stealth +7" />
        <ParsedField wide label="immunities" value={listToText(sb.defences.immunities)} onCommit={setDef("immunities")} placeholder="fire, paralyzed" />
        <ParsedField wide label="weaknesses" value={listToText(sb.defences.weaknesses)} onCommit={setDef("weaknesses")} placeholder="cold 10" />
        <ParsedField wide label="resistances" value={listToText(sb.defences.resistances)} onCommit={setDef("resistances")} placeholder="physical 5 (except silver)" />
        <ParsedField wide label="other defences" value={listToText(sb.defences.notes)} onCommit={setDef("notes")} placeholder="+1 status to all saves vs. magic" />
      </div>
      {sb.actions.map((a, i) => (
        <ActionEditor
          key={i}
          a={a}
          first={i === 0}
          last={i === sb.actions.length - 1}
          onChange={(next) => setAction(i, next)}
          onMove={(by) => move(i, by)}
          onRemove={() => onChange({ ...sb, actions: sb.actions.filter((_, j) => j !== i) })}
        />
      ))}
      <div className="sbe-add">
        <button className="cond-add" onClick={() => onChange({ ...sb, actions: [...sb.actions, blankStrike()] })}>+ strike</button>
        <button className="cond-add" onClick={() => onChange({ ...sb, actions: [...sb.actions, blankAbility()] })}>+ ability</button>
      </div>
      <div className="sbe-fields">
        <ParsedField
          wide
          area
          label="spells — a header line, then a line per rank; blank line between lists"
          value={spellsToText(sb.spells)}
          onCommit={(t) => onChange({ ...sb, spells: parseSpells(t) })}
          placeholder={"arcane prepared · dc 24 · attack +16\ncantrips (3rd): shield, detect magic\n1st: fear, grease"}
        />
      </div>
    </div>
  );
}
