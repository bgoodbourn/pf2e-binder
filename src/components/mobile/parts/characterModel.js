/* Normalize a parsed PC (parseBuild output) or a scenario/custom NPC into the
 * display models the mobile cast list + detail screen render. Keeps the JSX
 * presentational and tolerant of missing fields (NPCs are often narrative-only). */
import { ABILITIES, sign } from "../../../lib/pf2e.js";
import { statblockFor } from "../../../lib/companions.js";

export const initialsOf = (name = "") =>
  name.replace(/[^a-z0-9 ]/gi, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toLowerCase() || "?";

const NPC_ACCENT = "oklch(0.6 0.13 32)";
const PC_ACCENT = "#111";
const COMPANION_ACCENT = "#bc5f3c";

// An animal companion is passed around as { id, pet, owner } — its numbers are
// derived from its owner's level, so the two always travel together.
const companionSub = (o) =>
  [o.pet.species && `${o.pet.tier} ${o.pet.species.toLowerCase()}`, `lvl ${o.owner.level}`].filter(Boolean).join(" · ");

// One row in the cast list.
export function characterRow(kind, o) {
  if (kind === "companion") {
    const sb = statblockFor(o.pet, o.owner.level);
    return {
      kind, id: o.id, accent: COMPANION_ACCENT, initials: initialsOf(o.pet.name), name: o.pet.name,
      sub: companionSub(o),
      ac: sb?.ac ?? null, hp: sb?.hp ?? null, tucked: true,
    };
  }
  if (kind === "pc") {
    return {
      kind, id: o.id, accent: PC_ACCENT, initials: initialsOf(o.name), name: o.name,
      sub: [o.ancestry, o.cls && `${o.cls} ${o.level}`].filter(Boolean).join(" · ") || "pc",
      ac: o.ac?.acTotal ?? null, hp: o.hp ?? null,
    };
  }
  return {
    kind, id: o.id, accent: NPC_ACCENT, initials: initialsOf(o.name), name: o.name,
    sub: [o.level != null ? `lvl ${o.level}` : null, o.role || "npc"].filter(Boolean).join(" · "),
    ac: o.ac ?? null, hp: o.hp ?? null,
  };
}

const perText = (v) => (v == null ? "—" : sign(v));

// Full read-only stat block model.
export function characterDetail(kind, o) {
  if (kind === "companion") {
    const sb = statblockFor(o.pet, o.owner.level);
    if (!sb) {
      return {
        kind, initials: initialsOf(o.pet.name), name: o.pet.name, sub: companionSub(o),
        traits: [o.pet.tier, ...o.pet.specializations].filter(Boolean),
        desc: `No stat block on file for this companion${o.pet.species ? ` (${o.pet.species.toLowerCase()})` : ""}.`,
        ac: "—", hp: "—", per: "—", fort: "—", ref: "—", will: "—",
        abilities: [], skills: [], strikes: [], spells: [], details: [], special: [], notes: "",
      };
    }
    const traitLine = (s) => (s.traits.length ? ` (${s.traits.join(", ")})` : "");
    return {
      kind, initials: initialsOf(sb.name), name: sb.name,
      sub: `${sb.tier} ${sb.species.toLowerCase()} · level ${sb.level}`,
      traits: [sb.size.toLowerCase(), ...sb.traits.map((t) => t.toLowerCase()), ...sb.specializations.map((s) => s.name.toLowerCase())],
      desc: sb.summary || "",
      ac: sb.ac, hp: sb.hp, per: perText(sb.perception.total),
      fort: perText(sb.saves[0].total), ref: perText(sb.saves[1].total), will: perText(sb.saves[2].total),
      abilities: ABILITIES.map(([k]) => ({ k, mod: sign(sb.mods[k]) })),
      skills: sb.skills.map((s) => `${s.key} ${sign(s.total)}`),
      strikes: sb.strikes.map((s) => `${s.name}${traitLine(s)} · ${sign(s.attack)} to hit · ${s.damage} ${s.type}`),
      spells: [],
      details: [
        `speed ${sb.speeds.map((s) => `${s.label === "speed" ? "" : `${s.label} `}${s.value} ft`).join(", ")}`,
        sb.senses && `senses ${sb.senses}`,
        `barding ${sb.barding.label}`,
      ].filter(Boolean),
      special: [
        sb.support && `Support Benefit — ${sb.support}`,
        sb.advanced && `Advanced Maneuver — ${sb.advanced}`,
        sb.special && `Special — ${sb.special}`,
        ...sb.specializations.map((s) => s.text && `${s.name} — ${s.text}`),
      ].filter(Boolean),
      notes: "",
    };
  }
  if (kind === "pc") {
    const sv = (k) => (o.saves?.find((s) => s.key === k) || {}).total;
    return {
      kind, initials: initialsOf(o.name), name: o.name,
      sub: [o.ancestry && (o.heritage ? `${o.ancestry} · ${o.heritage}` : o.ancestry), o.cls && `${o.cls} ${o.level}`].filter(Boolean).join(" · "),
      traits: [o.background].filter(Boolean),
      desc: "",
      ac: o.ac?.acTotal ?? "—", hp: o.hp ?? "—", per: perText(o.perception?.total),
      fort: perText(sv("fortitude")), ref: perText(sv("reflex")), will: perText(sv("will")),
      abilities: ABILITIES.map(([k]) => ({ k, mod: sign(o.mods?.[k] ?? 0) })),
      skills: (o.skills || []).filter((s) => s.prof > 0).map((s) => `${s.key} ${sign(s.total)}`)
        .concat((o.lores || []).map((l) => `${l.name} ${sign(l.total)}`)),
      strikes: (o.weapons || []).map((w) =>
        `${w.name} · ${w.attack != null ? sign(w.attack) : "—"} to hit · ${w.die}${w.dmgBonus ? ` ${sign(w.dmgBonus)}` : ""}${w.dmgType ? ` ${w.dmgType}` : ""}`),
      spells: (o.casters || []).map((c) => `${c.name} · ${c.tradition} · dc ${c.dc} · atk ${sign(c.atk)}`)
        .concat(o.focus ? [`focus spells · ${o.focus.points} point${o.focus.points === 1 ? "" : "s"}`] : []),
      details: [],
      special: [],
      notes: "",
    };
  }
  return {
    kind, initials: initialsOf(o.name), name: o.name,
    sub: o.level != null ? `creature ${o.level}` : "npc · no combat block",
    traits: o.traits || [],
    desc: o.description || "",
    ac: o.ac ?? "—", hp: o.hp ?? "—", per: perText(o.perception),
    fort: perText(o.fort), ref: perText(o.ref), will: perText(o.will),
    abilities: o.abilities ? ABILITIES.map(([k]) => ({ k, mod: sign(o.abilities[k]) })) : [],
    skills: (o.skills || []).map(([name, mod]) => `${name} ${sign(mod)}`),
    strikes: o.attacks || [],
    spells: o.spells || [],
    details: [],
    special: o.special || [],
    notes: o.notes || "",
  };
}
