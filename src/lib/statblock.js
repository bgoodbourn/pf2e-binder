/* ==================================================================== *
 *  Creature stat blocks
 *
 *  The structured block behind the encounter tracker's stat-block card:
 *  speeds, senses, skills, defences, strikes, abilities and spells.
 *
 *    statBlock: {
 *      source: "npc" | "scenario" | "bestiary" | "custom",
 *      basis:  "variant jinkin · monster core 181",   // optional, where the numbers came from
 *      speeds:   [{ type: "walk", ft: 25 }, { type: "climb", ft: 25 }],
 *      senses:   ["darkvision", "web sense"],
 *      skills:   [{ name: "athletics", mod: 5 }],
 *      defences: { immunities: [], weaknesses: [], resistances: [], notes: [] },
 *      actions: [
 *        { kind: "strike", type: "melee" | "ranged", cost: 1, name, attack: 9,
 *          traits: ["finesse"], range: 30, reach: 10, damage, rider, text },
 *        { kind: "ability", cost, name, traits: [], detail, text },
 *      ],
 *      spells: [{ name: "arcane prepared", dc: 36, attack: 26, note: "",
 *                 ranks: [{ rank: "1st", spells: ["fleet step"] }] }],
 *    }
 *
 *  `cost` is 1 | 2 | 3 | "free" | "reaction" | "passive", or a span like
 *  "1-3" for a variable-action activity. A strike stores its first attack
 *  bonus only; the multiple-attack series is derived from it and the agile
 *  trait, so the three numbers can't drift apart.
 *
 *  Pure module — no JSON or React imports — so tools/fetch-creatures.mjs can
 *  share the text helpers under plain node.
 * ==================================================================== */

const MINUS = "−";

// "+9" / "−3": a signed modifier with a true minus sign.
export const fmtMod = (n) => (n < 0 ? `${MINUS}${Math.abs(n)}` : `+${n}`);

const hasTrait = (traits, t) => (traits || []).some((x) => String(x).toLowerCase().trim() === t);

// The multiple-attack series for a strike: −5/−10, or −4/−8 when agile.
export function mapSeries(attack, traits) {
  const step = hasTrait(traits, "agile") ? 4 : 5;
  return [attack, attack - step, attack - step * 2];
}

const PIPS = { 1: "◆", 2: "◆◆", 3: "◆◆◆", free: "◇", reaction: "⟳", passive: "—" };
export function costGlyph(cost) {
  if (cost == null) return PIPS.passive;
  if (PIPS[cost]) return PIPS[cost];
  const span = String(cost).match(/^([123])-([123])$/);
  return span ? `${PIPS[span[1]]}–${PIPS[span[2]]}` : PIPS.passive;
}
export const COSTS = [1, 2, 3, "1-2", "1-3", "free", "reaction", "passive"];
export const COST_LABEL = {
  1: "1 action", 2: "2 actions", 3: "3 actions", "1-2": "1–2 actions", "1-3": "1–3 actions",
  free: "free action", reaction: "reaction", passive: "passive",
};

/* Split on a separator, but never inside parentheses — "physical 10 (except
 * magic, silver), cold 5" is two entries, not three. */
export function splitTop(str, sep = ",") {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of String(str || "")) {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === sep && depth === 0) { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

/* ---- text <-> structure, for the editor's comma-separated fields ---- */
export const listToText = (list) => (list || []).join(", ");
export const parseList = (text) => splitTop(text);

export const speedLabel = (s) => `${s.type === "walk" ? "" : `${s.type} `}${s.ft} ft${s.note ? ` (${s.note})` : ""}`;
export const speedsToText = (speeds) => (speeds || []).map(speedLabel).join(", ");
export function parseSpeeds(text) {
  return splitTop(text).map((part) => {
    const m = part.match(/^(?:([a-z][a-z ]*?)\s+)?(\d+)\s*(?:ft\.?|feet|foot)?\s*(?:\((.*)\))?$/i);
    if (!m) return null;
    const type = (m[1] || "walk").toLowerCase().trim();
    const s = { type: type === "land" || type === "speed" ? "walk" : type, ft: Number(m[2]) };
    if (m[3]) s.note = m[3].trim();
    return s;
  }).filter(Boolean);
}

export const skillsToText = (skills) =>
  (skills || []).map((s) => `${s.name} ${fmtMod(s.mod).replace(MINUS, "-")}${s.note ? ` (${s.note})` : ""}`).join(", ");
export function parseSkills(text) {
  return splitTop(text).map((part) => {
    const m = part.match(/^(.*?)\s*([+\-−]\s*\d+)\s*(?:\((.*)\))?$/);
    if (!m || !m[1].trim()) return null;
    const s = { name: m[1].trim().toLowerCase(), mod: Number(m[2].replace(MINUS, "-").replace(/\s+/g, "")) };
    if (m[3]) s.note = m[3].trim();
    return s;
  }).filter(Boolean);
}

/* Spells as text: one list per paragraph, a header line then a line per rank.
 *
 *   arcane prepared · dc 36 · attack +26
 *   cantrips (6th): detect magic, shield
 *   1st: fleet step, true strike
 */
export function spellsToText(spells) {
  return (spells || []).map((l) => {
    const head = [l.name];
    if (l.dc != null) head.push(`dc ${l.dc}`);
    if (l.attack != null) head.push(`attack ${fmtMod(l.attack).replace(MINUS, "-")}`);
    if (l.note) head.push(l.note);
    return [head.join(" · "), ...(l.ranks || []).map((r) => `${r.rank}: ${r.spells.join(", ")}`)].join("\n");
  }).join("\n\n");
}
export function parseSpells(text) {
  return String(text || "").split(/\n\s*\n/).map((para) => {
    const lines = para.split("\n").map((s) => s.trim()).filter(Boolean);
    if (!lines.length) return null;
    const list = { name: "", ranks: [] };
    const notes = [];
    for (const [i, bit] of lines[0].split(/\s*[·;,]\s*/).entries()) {
      const dc = bit.match(/^dc\s*(\d+)$/i);
      const atk = bit.match(/^attack\s*([+\-−]?\s*\d+)$/i);
      if (dc) list.dc = Number(dc[1]);
      else if (atk) list.attack = Number(atk[1].replace(MINUS, "-").replace(/\s+/g, ""));
      else if (i === 0) list.name = bit.toLowerCase();
      else if (bit) notes.push(bit);
    }
    if (notes.length) list.note = notes.join(", ");
    for (const line of lines.slice(1)) {
      const at = line.indexOf(":");
      if (at === -1) continue;
      const spells = splitTop(line.slice(at + 1));
      if (spells.length) list.ranks.push({ rank: line.slice(0, at).trim().toLowerCase(), spells });
    }
    return list.name || list.ranks.length ? list : null;
  }).filter(Boolean);
}

// A spell's bare name for an AoN lookup: "ray of enfeeblement (x2)" -> the name.
export const spellLinkName = (s) => String(s || "").replace(/\s*\(.*$/, "").trim();

/* ---- bestiary shards ----
 * The bestiary's blocks are split across src/data/statblocks/NN.json by AoN id,
 * so one creature costs one small fetch. tools/fetch-creatures.mjs writes the
 * shards with the same function the app reads them with. */
export const STATBLOCK_SHARDS = 32;
export const statBlockShard = (aonId) => String(Number(aonId) % STATBLOCK_SHARDS).padStart(2, "0");

/* ---- shape helpers ---- */
export const emptyStatBlock = () => ({
  source: "custom", speeds: [], senses: [], skills: [],
  defences: { immunities: [], weaknesses: [], resistances: [], notes: [] },
  actions: [], spells: [],
});
export const blankStrike = () => ({ kind: "strike", type: "melee", cost: 1, name: "", attack: 0, traits: [], damage: "" });
export const blankAbility = () => ({ kind: "ability", cost: 1, name: "", traits: [], detail: "", text: "" });

// Tolerant read: a block from any source, with every list present.
export function normalizeStatBlock(sb, source) {
  if (!sb || typeof sb !== "object") return null;
  const d = sb.defences || {};
  return {
    ...sb,
    source: source || sb.source || "custom",
    speeds: Array.isArray(sb.speeds) ? sb.speeds : [],
    senses: Array.isArray(sb.senses) ? sb.senses : [],
    skills: Array.isArray(sb.skills) ? sb.skills : [],
    defences: {
      immunities: Array.isArray(d.immunities) ? d.immunities : [],
      weaknesses: Array.isArray(d.weaknesses) ? d.weaknesses : [],
      resistances: Array.isArray(d.resistances) ? d.resistances : [],
      notes: Array.isArray(d.notes) ? d.notes : [],
    },
    actions: Array.isArray(sb.actions) ? sb.actions : [],
    spells: Array.isArray(sb.spells) ? sb.spells : [],
  };
}

export function isEmptyStatBlock(sb) {
  if (!sb) return true;
  const d = sb.defences || {};
  return ![sb.speeds, sb.senses, sb.skills, sb.actions, sb.spells, d.immunities, d.weaknesses, d.resistances, d.notes]
    .some((l) => Array.isArray(l) && l.length > 0);
}

/* ---- resolution ----
 * A creature's name as a lookup key. The tracker's copies of one creature are
 * usually told apart by a trailing number or letter ("sprigjack 2", "kobold
 * #3"), which the scenario and the bestiary know nothing about. */
export const creatureKey = (name) =>
  String(name || "").toLowerCase().replace(/\s+/g, " ").replace(/\s*(#\s*)?\d+$/, "").trim();

// Does this kind of combatant get a stat-block card at all? PCs and companions
// already link out to their own sheets.
export const takesStatBlock = (c) => !!c && c.kind !== "pc" && c.kind !== "companion";

/* The scenario's own block for a combatant, resolved live so it costs the
 * overlay nothing and tracks corrections to the scenario: the linked NPC first,
 * then a scenario creature of the same name — this encounter's before any
 * other's, since an adventure can restat a creature between areas. */
export function scenarioStatBlock(c, { npcs, scenEncounters, encounterName } = {}) {
  if (c.npcId) {
    const npc = (npcs || []).find((n) => n.id === c.npcId);
    if (npc && !isEmptyStatBlock(npc.statBlock)) return normalizeStatBlock(npc.statBlock, "npc");
  }
  const key = creatureKey(c.name);
  if (!key) return null;
  const encs = scenEncounters || [];
  const ordered = [...encs.filter((e) => e.name === encounterName), ...encs.filter((e) => e.name !== encounterName)];
  for (const e of ordered) {
    for (const cr of e.creatures || []) {
      if (!isEmptyStatBlock(cr.statBlock) && creatureKey(cr.name) === key) return normalizeStatBlock(cr.statBlock, "scenario");
    }
  }
  return null;
}

/* An adventure often runs a book creature under its own name — "Big Eye" is a
 * giant gecko — and says so instead of printing a block. The scenario records
 * that as `bestiary: "Giant Gecko"` on the creature; this is the name the
 * bestiary fallback should look up in place of the combatant's own. */
export function scenarioBestiaryRef(c, { scenEncounters, encounterName } = {}) {
  const key = creatureKey(c.name);
  if (!key) return null;
  const encs = scenEncounters || [];
  const ordered = [...encs.filter((e) => e.name === encounterName), ...encs.filter((e) => e.name !== encounterName)];
  for (const e of ordered) {
    const hit = (e.creatures || []).find((cr) => cr.bestiary && creatureKey(cr.name) === key);
    if (hit) return hit.bestiary;
  }
  return null;
}

/* What the card shows, in order of trust: the GM's own edit, then what the
 * adventure prints, then a bestiary block copied onto the combatant when it was
 * added. The scenario outranks the bestiary copy because an adventure's version
 * of a creature is the one being run, even where the bestiary has the same name.
 * `null` on the combatant is deliberate: the GM cleared the block, so nothing
 * below may bring it back. */
export function resolveStatBlock(c, ctx) {
  if (!takesStatBlock(c)) return null;
  if (c.statBlock === null) return null;
  const own = c.statBlock && !isEmptyStatBlock(c.statBlock) ? normalizeStatBlock(c.statBlock) : null;
  if (own && own.source !== "bestiary") return own;
  return scenarioStatBlock(c, ctx) || own;
}
