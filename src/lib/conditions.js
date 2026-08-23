/* ==================================================================== *
 *  PF2e conditions + encounter budgeting
 *
 *  The remaster condition list, the effects engine that turns active
 *  conditions into adjusted on-sheet stats / off-sheet pills (with proper
 *  PF2e typed stacking), and the XP-threshold encounter budgeter.
 * ==================================================================== */

// PF2e conditions (remaster). VALUED ones commonly carry a numeric value,
// but the picker allows a free integer on any condition.
export const CONDITIONS = [
  "Blinded", "Broken", "Clumsy", "Concealed", "Confused", "Controlled", "Dazzled",
  "Deafened", "Doomed", "Drained", "Dying", "Encumbered", "Enfeebled", "Fascinated",
  "Fatigued", "Fleeing", "Frightened", "Grabbed", "Hidden", "Immobilized", "Invisible",
  "Observed", "Off-Guard", "Paralyzed", "Persistent Damage", "Petrified", "Prone",
  "Quickened", "Restrained", "Sickened", "Slowed", "Stunned", "Stupefied",
  "Unconscious", "Undetected", "Unnoticed", "Wounded",
];
export const VALUED = new Set([
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
export function conditionEffects(c) {
  const base = { ac: c.ac, fort: c.fort, ref: c.ref, will: c.will, per: c.perception };
  const contribs = [];
  (c.conditions || []).forEach((cond) => {
    const def = CONDITION_FX[cond.name];
    if (!def || !def.fx) return;
    const n = cond.value != null ? cond.value : 1;
    def.fx(n, c).forEach((x) => contribs.push(x));
  });
  // GM-authored custom effects. Untyped on purpose: a hand-written effect has no
  // declared PF2e bonus type, so it must sum with everything rather than compete
  // with status/circumstance penalties — which is exactly what stackDelta does.
  (c.effects || []).forEach((e) => {
    (e.mods || []).forEach((m) => contribs.push({ target: m.target, v: m.v, type: "untyped" }));
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

/* ---- chip age ----
 * Conditions and custom effects carry `sinceRound`: the round their CURRENT
 * state began. Stepping frightened 2 down to frightened 1 re-stamps it, so the
 * marker answers "how long has it been frightened 1", not "how long has it been
 * frightened at all". Legacy chips (saved before the field existed) have no
 * stamp and read as null — they render no marker rather than a false full one.
 *
 * Floors at 0 so the round bar's back / reset buttons make the marker fade out
 * instead of going negative. Those buttons deliberately do NOT re-stamp:
 * stepping back should look like stepping back. */
export function roundsUnchanged(item, round) {
  if (!item || item.sinceRound == null) return null;
  return Math.max(0, (round ?? 1) - item.sinceRound);
}

function ageLine(item, n) {
  if (n == null) return "";
  if (n === 0) return "applied this round";
  return `unchanged for ${n} round${n === 1 ? "" : "s"} · since round ${item.sinceRound}`;
}

// Tooltip text for a condition chip: how long it's held, then its mechanics.
export function conditionTip(cond, n) {
  const def = CONDITION_FX[cond.name];
  const desc = def ? def.desc : "";
  const base = cond.value != null ? `${cond.name} ${cond.value} — ${desc}` : desc;
  const age = ageLine(cond, n);
  return age ? `${age}\n${base}` : base;
}

// Tooltip for a custom effect chip: its modifiers, spelled out.
export function effectTip(e, n) {
  const parts = (e.mods || []).map((m) => `${m.target} ${m.v > 0 ? "+" : "−"}${Math.abs(m.v)}`);
  const base = parts.length ? `${e.name} — ${parts.join(", ")}` : e.name;
  const age = ageLine(e, n);
  return age ? `${age}\n${base}` : base;
}

// XP budgeting (party of 4 thresholds, adjusted per extra/fewer PC)
function creatureXP(diff) {
  if (diff < -4) return 0;
  if (diff > 4) return 160;
  return { "-4": 10, "-3": 15, "-2": 20, "-1": 30, 0: 40, 1: 60, 2: 80, 3: 120, 4: 160 }[diff];
}
export function encounterBudget(combatants, partyPcs) {
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
