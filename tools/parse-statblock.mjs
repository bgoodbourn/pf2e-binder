/*
 * Parse an Archives of Nethys creature record into the binder's statBlock shape
 * (see src/lib/statblock.js).
 *
 * Speeds, skills and immunities come from the index's structured fields. Strikes,
 * abilities, spells, weaknesses and resistances only exist in the record's
 * `markdown`, a regular but hand-authored format:
 *
 *   **Melee**
 *   <actions string="Single Action" />
 *   jaws +9 ([Finesse](/Traits.aspx?ID=602)),
 *   **Damage** 1d8+1 piercing plus [Grab](/MonsterAbilities.aspx?ID=45)
 *
 *   **Counterspell** <actions string="Reaction" /> **Trigger** A creature casts…
 *
 * The stat block is three <column>s split by `---`: perception and interaction
 * abilities, then defences and reactive abilities, then speed and offence.
 */
import { splitTop } from "../src/lib/statblock.js";

const COST = {
  "single action": 1, "two actions": 2, "three actions": 3,
  "reaction": "reaction", "free action": "free",
};
function costFrom(str) {
  const s = String(str || "").toLowerCase().trim();
  if (COST[s] != null) return COST[s];
  const span = s.match(/^(single action|two actions) (?:to|or) (two actions|three actions)$/);
  return span ? `${COST[span[1]]}-${COST[span[2]]}` : "passive";
}

// Bold labels that head a line of the stat block proper, not an ability.
const FIELDS = new Set([
  "source", "perception", "languages", "skills", "str", "dex", "con", "int", "wis", "cha",
  "items", "ac", "fort", "ref", "will", "hp", "hardness", "immunities", "weaknesses", "resistances", "speed",
]);
// Bold labels that belong to the entry above them, wherever the line breaks.
const INLINE = /^(damage|effect|trigger|requirements?|frequency|saving throw|onset|maximum duration|stage \d+|critical success|success|failure|critical failure|cost|special|area|range|targets?|duration|prerequisites?)$/i;

const stripLinks = (s) => s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
const tidy = (s) => s.replace(/<[^>]+>/g, " ").replace(/\*\*/g, "").replace(/(^|\s)_([^_]+)_/g, "$1$2").replace(/\s+/g, " ").replace(/\s+([,;.])/g, "$1").trim();

function statBlockSection(markdown) {
  const md = String(markdown || "");
  // A lore sidebar can open with its own level-2 title; ours names the level.
  const start = md.search(/<title level="2" right="[^"]*\d"/);
  if (start === -1) return null;
  let body = md.slice(start);
  body = body.slice(body.indexOf("</title>") + 8);
  // A page can carry sidebars, a family blurb, or a second creature after ours.
  const end = body.search(/<aside|<document|<title level="[12]"/);
  return end === -1 ? body : body.slice(0, end);
}

/* Break a column into entries: each starts at a line opening with a bold label
 * and runs to the next such line. */
function entries(column) {
  const lines = stripLinks(column).replace(/<br\s*\/?>/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean);
  const out = [];
  for (const line of lines) {
    const m = line.match(/^\*\*(.+?)\*\*/);
    const label = m ? m[1].trim() : null;
    if (label && !INLINE.test(label)) out.push({ label, body: line.slice(m[0].length) });
    else if (out.length) out[out.length - 1].body += ` ${line}`;
  }
  return out;
}

const SAVE = { fortitude: "fort", reflex: "ref", will: "will" };
/* The glanceable one-liner for an ability: its reach or area, its save, its
 * damage. The full text is kept alongside, so this only has to be useful. */
function summarize(text) {
  const parts = [];
  const area = text.match(/(\d+)-foot[- ](cone|line|emanation|burst|radius|aura)/i);
  const within = text.match(/^(\d+) feet\b/i) || text.match(/\bwithin (\d+) feet\b/i);
  if (area) parts.push(`${area[1]} ft ${area[2].toLowerCase()}`);
  else if (within) parts.push(`${within[1]} ft`);
  const dmg = text.match(/\b(\d+d\d+(?:\s*[+\-]\s*\d+)?)\s+([a-z]+)\s+damage/i);
  if (dmg) parts.push(`${dmg[1].replace(/\s+/g, "")} ${dmg[2].toLowerCase()}`);
  const dcA = text.match(/DC (\d+)\s+(basic\s+)?(Fortitude|Reflex|Will)/i);
  const dcB = text.match(/(basic\s+)?(Fortitude|Reflex|Will)(?: save)?,? DC (\d+)/i);
  const dcC = text.match(/\bDC (\d+)\b/);
  if (dcA) parts.push(`${dcA[2] ? "basic " : ""}${SAVE[dcA[3].toLowerCase()]} dc ${dcA[1]}`);
  else if (dcB) parts.push(`${dcB[1] ? "basic " : ""}${SAVE[dcB[2].toLowerCase()]} dc ${dcB[3]}`);
  else if (dcC) parts.push(`dc ${dcC[1]}`);
  if (parts.length) return parts.join(" · ");
  return text.length <= 44 ? text.toLowerCase() : "";
}

function parseAbility(label, body) {
  const act = body.match(/<actions string="([^"]*)"\s*\/>/);
  let rest = body.replace(/<actions string="[^"]*"\s*\/>/g, " ").trim();
  let traits = [];
  const tm = rest.match(/^\(([^)]*)\)\s*/);
  if (tm) {
    traits = splitTop(tm[1]).map((t) => t.toLowerCase());
    rest = rest.slice(tm[0].length);
  }
  const text = tidy(rest.replace(/\*\*(.+?)\*\*/g, "$1"));
  const a = { kind: "ability", cost: costFrom(act && act[1]), name: tidy(label).toLowerCase(), traits, detail: summarize(text) };
  if (text && text.toLowerCase() !== a.detail) a.text = text;
  return a;
}

function parseStrike(label, body) {
  const act = body.match(/<actions string="([^"]*)"\s*\/>/);
  const rest = body.replace(/<actions string="[^"]*"\s*\/>/g, " ").trim();
  const [head, ...tail] = rest.split(/\*\*(?:Damage|Effect)\*\*/);
  const m = tidy(head).match(/^(.*?)\s*([+\-]\d+)\s*(?:\[[^\]]*\])?\s*(?:\((.*)\))?,?$/);
  if (!m) return null;
  const s = {
    kind: "strike", type: label.toLowerCase() === "ranged" ? "ranged" : "melee",
    cost: act ? costFrom(act[1]) : 1, name: m[1].toLowerCase(), attack: Number(m[2]), traits: [],
  };
  for (const t of splitTop(m[3] || "").map((x) => x.toLowerCase())) {
    const range = t.match(/^range(?: increment)? (\d+) (?:feet|ft)/);
    const reach = t.match(/^reach (\d+) (?:feet|ft)/);
    const thrown = t.match(/^thrown (\d+) (?:feet|ft)/);
    if (range) s.range = Number(range[1]);
    else if (reach) s.reach = Number(reach[1]);
    else {
      if (thrown) s.range = Number(thrown[1]);
      s.traits.push(t);
    }
  }
  // "1d6+2 piercing plus hunting spider venom": damage, then the rider. A
  // "plus" followed by dice is more damage, not a rider.
  const dmg = tidy(tail.join(" ")).replace(/,$/, "");
  const cut = dmg.search(/\s+plus\s+(?!\d)/i);
  s.damage = (cut === -1 ? dmg : dmg.slice(0, cut)).trim();
  if (cut !== -1) s.riderName = dmg.slice(cut).replace(/^\s+plus\s+/i, "").trim().toLowerCase();
  return s;
}

function parseSpellList(label, body) {
  const [head, ...groups] = body.split(/\s-\s(?=\*\*)/);
  // "Arcane Prepared Spells" -> "arcane prepared"; rituals keep the word, since
  // nothing else says what the list is.
  const list = { name: label.replace(/\s+spells$/i, "").toLowerCase() };
  const h = tidy(head);
  const dc = h.match(/DC (\d+)/i);
  const atk = h.match(/attack ([+\-]\d+)/i);
  if (dc) list.dc = Number(dc[1]);
  if (atk) list.attack = Number(atk[1]);
  const note = h.replace(/DC \d+/i, "").replace(/attack [+\-]\d+/i, "").replace(/^[\s,;]+|[\s,;]+$/g, "").replace(/\s*,\s*,/g, ",");
  if (note) list.note = note.toLowerCase();
  list.ranks = [];
  for (const g of groups) {
    const m = g.match(/^\*\*(.+?)\*\*\s*(.*)$/);
    if (!m) continue;
    const spells = splitTop(tidy(m[2])).map((x) => x.toLowerCase());
    if (spells.length) list.ranks.push({ rank: tidy(m[1]).toLowerCase(), spells });
  }
  return list;
}

const plainList = (body) => splitTop(tidy(body)).map((x) => x.toLowerCase());

export function parseStatBlock(src) {
  const sb = { speeds: [], senses: [], skills: [], defences: { immunities: [], weaknesses: [], resistances: [], notes: [] }, actions: [], spells: [] };

  for (const [k, ft] of Object.entries(src.speed || {})) {
    if (k !== "max" && typeof ft === "number") sb.speeds.push({ type: k === "land" ? "walk" : k, ft });
  }
  sb.speeds.sort((a, b) => (a.type === "walk" ? -1 : b.type === "walk" ? 1 : 0));
  sb.senses = splitTop(stripLinks(String(src.sense_markdown || src.sense || ""))).map((x) => tidy(x).toLowerCase()).filter(Boolean);
  sb.skills = Object.entries(src.skill_mod || {}).map(([name, mod]) => ({ name: name.replace(/_/g, " "), mod })).sort((a, b) => a.name.localeCompare(b.name));
  sb.defences.immunities = (src.immunity || []).map((x) => String(x).toLowerCase());

  const section = statBlockSection(src.markdown);
  if (!section) return sb;
  const columns = section.split(/\n---\n/);
  const strikes = [];
  const byColumn = [[], [], []];
  columns.forEach((col, ci) => {
    for (const { label, body } of entries(col)) {
      const key = label.toLowerCase();
      if (key === "weaknesses") sb.defences.weaknesses = plainList(body);
      else if (key === "resistances") sb.defences.resistances = plainList(body);
      else if (key === "immunities") { if (!sb.defences.immunities.length) sb.defences.immunities = plainList(body); }
      else if (key === "hp") {
        const note = tidy(body).match(/\((.*)\)/);
        if (note) sb.defences.notes.push(...splitTop(note[1]).map((x) => x.toLowerCase()));
      } else if (key === "will") {
        // A line after the saves row: "+1 status to all saves vs. magic".
        const note = tidy(body).replace(/^[+\-]?\d+\s*/, "").replace(/^[;,]\s*/, "");
        if (note) sb.defences.notes.push(note.toLowerCase());
      } else if (FIELDS.has(key)) continue;
      else if (key === "melee" || key === "ranged") {
        const s = parseStrike(label, body);
        if (s) strikes.push(s);
      } else if (/(^|\s)(spells|rituals)$/i.test(label)) sb.spells.push(parseSpellList(label, body));
      else byColumn[Math.min(ci, 2)].push(parseAbility(label, body));
    }
  });

  // Offence first, then reactions and auras, then the interaction abilities
  // from the top of the block — the order a GM reaches for them mid-turn.
  const abilities = [...byColumn[2], ...byColumn[1], ...byColumn[0]];
  for (const s of strikes) {
    if (s.riderName) {
      // Name the rider's save where an ability of that name spells it out.
      const hit = abilities.find((a) => s.riderName.startsWith(a.name) || a.name === s.riderName);
      const dc = hit && hit.detail.match(/(?:basic )?(?:fort|ref|will) dc \d+|dc \d+/);
      s.rider = `plus **${s.riderName}**${dc ? ` — ${dc[0].replace(/dc (\d+)/, "**dc $1**")}` : ""}`;
      delete s.riderName;
    }
  }
  sb.actions = [...strikes, ...abilities];
  return sb;
}

/* Drop everything empty so the bundled file carries no dead weight; the app's
 * normalizeStatBlock puts the empty lists back on read. */
export function compactStatBlock(sb) {
  const prune = (v) => {
    if (Array.isArray(v)) return v.length ? v.map(prune) : undefined;
    if (v && typeof v === "object") {
      const o = {};
      for (const [k, x] of Object.entries(v)) {
        const p = prune(x);
        if (p !== undefined && p !== "") o[k] = p;
      }
      return Object.keys(o).length ? o : undefined;
    }
    return v;
  };
  return prune(sb) || {};
}
