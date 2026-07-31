#!/usr/bin/env node
/*
 * Regenerate src/data/companions.json from the Archives of Nethys search index.
 *
 * Pulls every animal companion type and specialization from the public AoN
 * Elasticsearch index and writes a compact record per type. Companions aren't
 * flat stat blocks the way creatures are — their numbers depend on the owner's
 * level and how far the companion has been advanced — so what we store is the
 * *base*: ability modifiers, ancestry HP, strikes, skill, senses, speed. The
 * per-level math lives in src/lib/companions.js.
 *
 * Run:  node tools/fetch-companions.mjs
 *
 * Most fields come through structured. Strikes, Support Benefit, Advanced
 * Maneuver and Special are only in the entry's markdown, which is rigidly
 * formatted, so they're parsed out of it (and every record is checked below —
 * the script fails loudly if a shape it doesn't understand appears).
 */
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ES = "https://elasticsearch.aonprd.com/aon/_search";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "data", "companions.json");

// numeric AoN id out of "animal-companion-68"
const numId = (id) => Number(String(id).replace(/[^0-9]/g, ""));

// "[low-light vision](/Rules.aspx?ID=416)" -> "low-light vision"
const unlink = (s) => String(s || "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
// Stripping a link can leave a space before the punctuation that followed it
// ("a zephyr hawk ." -> "a zephyr hawk.").
const tidy = (s) => unlink(s).replace(/\s+/g, " ").replace(/\s+([.,;:)])/g, "$1").trim();

async function fetchCategory(category, source) {
  const out = [];
  const size = 500;
  for (let from = 0; ; from += size) {
    const res = await fetch(ES, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        size,
        _source: source,
        query: { bool: { filter: [{ term: { category } }] } },
      }),
    });
    if (!res.ok) throw new Error(`AoN responded ${res.status} ${res.statusText}`);
    const page = await res.json();
    out.push(...page.hits.hits.map((h) => h._source));
    if (out.length >= page.hits.total.value) break;
  }
  return out;
}

/* ---- markdown parsing ----
 * A companion entry's stat block section looks like:
 *
 *   **Melee**
 *   <actions string="Single Action" />
 *   claw ([Agile](/Traits.aspx?ID=170)),
 *   **Damage** 1d6 slashing
 *
 *   **Hit Points** 8
 *   **Special** [mount](/Rules.aspx?ID=150)
 *   **Support Benefit** Your badger digs around…
 *   **Advanced Maneuver** Badger Rage
 */
const STRIKE = /\*\*(Melee|Ranged)\*\*\s*\n\s*<actions[^>]*\/>\s*\n\s*(.+?),?\s*\n\s*\*\*Damage\*\*\s*(.+)/g;

function parseStrikes(md) {
  const out = [];
  for (const m of md.matchAll(STRIKE)) {
    const [, range, head, dmg] = m;
    // "claw ([Agile](/Traits.aspx?ID=170))" -> name "claw", traits ["agile"]
    const parens = head.match(/\(([\s\S]*)\)\s*$/);
    const name = tidy(head.replace(/\(([\s\S]*)\)\s*$/, "")).replace(/,$/, "");
    const traits = parens
      ? tidy(parens[1]).split(",").map((t) => t.trim().toLowerCase()).filter(Boolean)
      : [];
    // "1d8 piercing" / "1d6 bludgeoning plus grab"
    const d = tidy(dmg).match(/^(\d+d\d+)\s*(.*)$/);
    out.push({
      name,
      range: range.toLowerCase(),
      traits,
      damage: d ? d[1] : null,
      type: d ? d[2] : tidy(dmg),
    });
  }
  return out;
}

// A **Label** line, up to the next blank line + **Label** (Support Benefit runs long).
function field(md, label) {
  const re = new RegExp(`\\*\\*${label}\\*\\*\\s*([\\s\\S]*?)(?=\\n\\s*\\n|\\n\\s*\\*\\*|\\n\\s*<)`);
  const m = md.match(re);
  return m ? tidy(m[1]) : null;
}

// The flavour paragraph sits between the **Source** line and the stat block's
// <column>. AoN's own `summary` field is truncated mid-sentence for the longer
// ones, so take it from the markdown instead.
function parseDescription(md) {
  const body = md.split(/<column/)[0];
  const paras = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith("<") && !p.startsWith("**Source**") && !p.startsWith("_"));
  return paras.length ? tidy(paras[paras.length - 1]) : null;
}

function toRecord(c) {
  const md = c.markdown || "";
  const strikes = parseStrikes(md);
  return {
    id: numId(c.id),
    name: c.name,
    url: c.url,
    source: c.primary_source || (c.source || [])[0] || null,
    // AoN's `level` on a companion is the level you must be to take it, not the
    // companion's level (a griffon is "Animal Companion 14").
    minLevel: c.level ?? 1,
    rarity: c.rarity || "common",
    traits: c.trait || [],
    size: (c.size || []).join(" or ") || null,
    baseHp: c.hp ?? null,
    mods: {
      str: c.strength ?? 0,
      dex: c.dexterity ?? 0,
      con: c.constitution ?? 0,
      int: c.intelligence ?? 0,
      wis: c.wisdom ?? 0,
      cha: c.charisma ?? 0,
    },
    skill: c.skill || [],
    senses: tidy(c.sense_markdown || "") || null,
    speed: c.speed_raw || null,
    speeds: c.speed || {},
    mount: !!c.mount,
    strikes,
    special: field(md, "Special"),
    support: field(md, "Support Benefit"),
    advanced: field(md, "Advanced Maneuver"),
    summary: parseDescription(md) || tidy(c.summary || "") || null,
  };
}

async function main() {
  const types = await fetchCategory("animal-companion", [
    "id", "name", "url", "level", "rarity", "trait", "size", "hp", "mount",
    "strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma",
    "skill", "sense_markdown", "speed", "speed_raw", "source", "primary_source",
    "summary", "remaster_id", "markdown",
  ]);
  const specs = await fetchCategory("animal-companion-specialization", [
    "id", "name", "url", "source", "primary_source", "text", "remaster_id",
  ]);
  console.log(`fetched ${types.length} companion types, ${specs.length} specializations`);

  // Remaster wins: a legacy entry names its replacement in `remaster_id`, so any
  // entry that has one has been superseded and is dropped. (Companion records
  // carry no `legacy_id`, so this is the only link between the two printings.)
  const kept = types.filter((c) => !(c.remaster_id || []).length);

  const records = kept.map(toRecord).sort((a, b) => a.name.localeCompare(b.name));

  // Every companion in the game has at least one Strike and a Support Benefit;
  // if the markdown shape ever drifts, fail here rather than shipping holes.
  const broken = records.filter((r) => !r.strikes.length || !r.support || !r.baseHp);
  if (broken.length) {
    console.error(`\n${broken.length} record(s) failed to parse:`);
    for (const r of broken) {
      console.error(`  ${r.name} — strikes:${r.strikes.length} support:${!!r.support} hp:${r.baseHp}`);
    }
    process.exit(1);
  }

  const specializations = specs
    .filter((s) => !(s.remaster_id || []).length) // same remaster-wins rule
    .map((s) => ({
      name: s.name,
      url: s.url,
      source: s.primary_source || (s.source || [])[0] || null,
      // AoN's `text` repeats the name and source before the benefit itself.
      text: tidy(s.text || "").replace(/^\s*\S[\s\S]*?pg\.\s*\d+\s*/, ""),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  await writeFile(OUT, JSON.stringify({ types: records, specializations }) + "\n");
  console.log(`\nwrote ${records.length} companion types + ${specializations.length} specializations to ${OUT}`);
  console.log(`  dropped ${types.length - kept.length} superseded legacy entries`);
}

main().catch((err) => {
  console.error("\nfailed:", err.message);
  process.exit(1);
});
