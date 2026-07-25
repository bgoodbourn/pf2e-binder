#!/usr/bin/env node
/*
 * Regenerate src/data/aon-index.json from the Archives of Nethys search index.
 *
 * Pulls every category a character sheet can name (feats, spells, gear,
 * ancestries, class features, …) from the public AoN Elasticsearch index and
 * writes one lowercased name -> page-url map per group, so the binder can turn
 * a bare Pathbuilder name into a deep link.
 *
 * Run:  node tools/fetch-aon-index.mjs
 *
 * Remaster handling matters more here than it does for creatures, because a
 * remaster printing often RENAMES the thing. A superseded legacy entry keeps
 * its own name as an alias pointing at the winning remaster page — that's what
 * makes "magic missile" resolve to the Force Barrage page, which is what a
 * Pathbuilder build exported before the remaster will still call it.
 */
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { normalize } from "../src/lib/aon.js";

const ES = "https://elasticsearch.aonprd.com/aon/_search";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "data", "aon-index.json");

// index group -> AoN categories folded into it. Groups match the `kind`
// argument of aonUrl() in src/lib/aon.js.
const GROUPS = {
  feat: ["feat"],
  spell: ["spell", "ritual"],
  item: ["equipment", "weapon", "armor", "shield", "relic"],
  classFeature: ["class-feature"],
  ancestry: ["ancestry"],
  heritage: ["heritage"],
  background: ["background"],
  deity: ["deity"],
  class: ["class"],
  language: ["language"],
  skill: ["skill"],
  familiarAbility: ["familiar-ability"],
  companion: ["animal-companion"],
};

// Remaster printings win over legacy ones when both survive under one name.
const REMASTER = new Set([
  "Player Core", "Player Core 2", "GM Core",
  "Monster Core", "Monster Core 2", "NPC Core",
]);
const isRemaster = (doc) => (doc.source || []).some((s) => REMASTER.has(s));

const FIELDS = ["id", "name", "url", "source", "legacy_id", "class"];

async function fetchPage(category, from, size) {
  const res = await fetch(ES, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      size,
      _source: FIELDS,
      query: { bool: { filter: [{ term: { category } }] } },
    }),
  });
  if (!res.ok) throw new Error(`AoN responded ${res.status} ${res.statusText}`);
  return res.json();
}

async function fetchCategory(category) {
  const out = [];
  const size = 1000;
  const first = await fetchPage(category, 0, size);
  const total = first.hits.total.value;
  out.push(...first.hits.hits.map((h) => h._source));
  for (let from = size; from < total; from += size) {
    const page = await fetchPage(category, from, Math.min(size, total - from));
    out.push(...page.hits.hits.map((h) => h._source));
  }
  return out;
}

/* Build one group's name -> url map.
 *
 * `keyFor` lets class features key on "<class>|<name>" instead of the bare
 * name; every other group keys on the name alone. Precedence, strongest first:
 * a real (non-superseded) name beats an alias, and a remaster printing beats a
 * legacy one. */
function buildMap(docs, keyFor) {
  // legacy id -> the remaster doc that replaced it
  const supersededBy = new Map();
  for (const d of docs) {
    for (const lid of d.legacy_id || []) supersededBy.set(lid, d);
  }

  const chosen = new Map(); // key -> { url, remaster, alias }
  const put = (key, url, remaster, alias) => {
    if (!key || !url) return;
    const prev = chosen.get(key);
    if (!prev) { chosen.set(key, { url, remaster, alias }); return; }
    if (prev.alias && !alias) { chosen.set(key, { url, remaster, alias }); return; }
    if (prev.alias === alias && remaster && !prev.remaster) chosen.set(key, { url, remaster, alias });
  };

  for (const d of docs) {
    const winner = supersededBy.get(d.id);
    if (winner) put(keyFor(d), winner.url, true, true); // legacy name -> remaster page
    else put(keyFor(d), d.url, isRemaster(d), false);
  }

  // Sort keys so the file is stable across runs and diffs stay readable.
  const map = {};
  for (const key of [...chosen.keys()].sort()) map[key] = chosen.get(key).url;
  return map;
}

const byName = (d) => normalize(d.name);
const byClassAndName = (d) => `${normalize(d.class)}|${normalize(d.name)}`;

async function main() {
  const index = {};
  const counts = {};
  for (const [group, categories] of Object.entries(GROUPS)) {
    const docs = [];
    for (const c of categories) docs.push(...(await fetchCategory(c)));
    index[group] = buildMap(docs, group === "classFeature" ? byClassAndName : byName);
    counts[group] = { docs: docs.length, keys: Object.keys(index[group]).length };
    process.stdout.write(`\rfetched ${group}…`.padEnd(40));
  }
  process.stdout.write("\n");

  await writeFile(OUT, JSON.stringify(index) + "\n");

  console.log(`\nwrote ${OUT}`);
  let total = 0;
  for (const [group, { docs, keys }] of Object.entries(counts)) {
    total += keys;
    console.log(`  ${String(keys).padStart(6)} keys  ${String(docs).padStart(6)} docs  ${group}`);
  }
  console.log(`  ${String(total).padStart(6)} keys  total`);
}

main().catch((err) => {
  console.error("\nfailed:", err.message);
  process.exit(1);
});
