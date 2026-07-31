/* ==================================================================== *
 *  PF2e math + Pathbuilder ingest
 *
 *  Pure helpers shared across the binder: ability math, the skill/ability
 *  tables, a normalizer for Pathbuilder 2e "Export to Foundry VTT" JSON,
 *  and a couple of tiny RNG/id utilities.
 * ==================================================================== */

import { parsePet } from "./companions.js";

/* ----------------------------- PF2e math --------------------------- */
const amod = (s) => Math.floor((Number(s || 10) - 10) / 2);
export const sign = (n) => (n >= 0 ? `+${n}` : `${n}`);
const RANK = { 0: "untrained", 2: "trained", 4: "expert", 6: "master", 8: "legendary" };
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export const ABILITIES = [
  ["str", "strength"],
  ["dex", "dexterity"],
  ["con", "constitution"],
  ["int", "intelligence"],
  ["wis", "wisdom"],
  ["cha", "charisma"],
];

export const SKILLS = [
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
export function parseBuild(input) {
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

  // Pathbuilder puts animal companions AND familiars in `pets` and leaves
  // `familiars` empty, so split on the entry's own type rather than trusting
  // which list it arrived in.
  const parsedPets = (b.pets || []).map(parsePet);
  const familiars = [
    ...(b.familiars || []).map((f) => ({
      name: f.name || f.type,
      species: f.specific || null,
      abilities: f.abilities || [],
    })),
    ...parsedPets.filter((p) => p.kind === "familiar"),
  ];
  const pets = parsedPets.filter((p) => p.kind === "companion");
  const otherPets = parsedPets.filter((p) => p.kind === "other");

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
    otherPets,
    raw,
  };
}

/* ----------------------------- RNG / ids --------------------------- */
export const uid = () => Math.random().toString(36).slice(2, 9);
export const d20 = () => Math.floor(Math.random() * 20) + 1;
