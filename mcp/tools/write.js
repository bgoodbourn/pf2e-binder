/* Write tools: Claude edits the GM's overlay (notes pages, entity notes,
 * NPCs, tracker encounters). Every write is a compare-and-swap through
 * store.patchOverlay, recorded in overlay_history, and appears live in an
 * open binder tab. The published scenario text itself is never modified. */
import { z } from "zod";
import { normalizeBlock, newExternalId, GM_BLOCK_KINDS } from "../../src/lib/gmnotes-util.js";
import { setNpcEdit, NPC_TEXT_FIELDS } from "../../src/lib/npcs.js";
import { combatantFromNpc, combatantFromCreature, buildScenarioEncounters, stripSeededMaps } from "../../src/lib/combatants.js";
import { uid } from "../../src/lib/pf2e.js";
import { mergeOverlay } from "../../src/data/merge.js";
import { patchOverlay, getScenarioPart, getCreatures, lastMcpChange, dropHistoryRow, ToolError } from "../store.js";
import { allNpcs } from "./read.js";
import { text } from "../format.js";

const scenarioId = z.string().describe("Scenario id (see list_scenarios / get_current_view)");

/* ---- GM notes blocks ---------------------------------------------------- */

const linkItem = z.object({
  type: z.enum(["npc", "enc", "page", "url"]).describe("npc = NPC id, enc = tracker encounter id, page = GM page id, url = web link"),
  refId: z.string().optional().describe("Target id for npc / enc / page"),
  url: z.string().optional().describe("For type url"),
  name: z.string().optional().describe("Label; defaults to the target's name"),
});

const blockSchema = z.object({
  type: z.enum(GM_BLOCK_KINDS).describe(
    "heading = section heading; p = paragraph; read = read-aloud box; check = skill check with four outcome tiers; " +
    "qa = 'if the players ask' question/answer table; links = chips linking NPCs, encounters, pages or urls; " +
    "note = timestamped live note"),
  text: z.string().optional().describe("heading / p / read / note text. Plain text only: no markdown is rendered."),
  skill: z.string().optional().describe("check: skill, e.g. \"Diplomacy\" or \"Society or Warfare Lore\""),
  dc: z.union([z.string(), z.number()]).optional().describe("check: DC"),
  secret: z.boolean().optional().describe("check: secret roll (default true)"),
  tiers: z.array(z.string()).max(4).optional().describe("check: outcome text in order [critical success, success, failure, critical failure]"),
  qaTitle: z.string().optional().describe("qa: table title (default \"if the players ask…\")"),
  rows: z.array(z.object({ q: z.string(), a: z.string() })).optional().describe("qa: question/answer rows"),
  items: z.array(linkItem).optional().describe("links: the chips"),
});

// Resolve link chips against real ids; fill missing names from the target.
async function resolveLinks(scenario_id, body, block) {
  if (block.type !== "links") return block;
  const npcs = await allNpcs(scenario_id, body);
  const missing = [];
  block.items = (block.items || []).map((it) => {
    if (it.type === "url") return it;
    const target =
      it.type === "npc" ? npcs.find((n) => n.id === it.refId)
        : it.type === "enc" ? body.encounters.find((e) => e.id === it.refId)
          : body.gmPages.find((p) => p.id === it.refId);
    if (!target) { missing.push(`${it.type} ${it.refId}`); return it; }
    return { ...it, name: it.name || target.name || target.title };
  });
  if (missing.length) {
    throw new ToolError(`Link targets not found: ${missing.join(", ")}. Enc links need tracker encounter ids (create or prefill encounters first).`);
  }
  return block;
}

async function buildBlocks(scenario_id, body, specs) {
  const out = [];
  for (const spec of specs || []) {
    const b = normalizeBlock(spec, newExternalId());
    out.push(await resolveLinks(scenario_id, body, b));
  }
  return out;
}

function findPage(body, page_id) {
  const page = body.gmPages.find((p) => p.id === page_id);
  if (!page) {
    throw new ToolError(`No GM page "${page_id}". Pages: ${body.gmPages.map((p) => `${p.id} (${p.title})`).join(", ") || "none yet"}`);
  }
  return page;
}

/* ---- combatants ---------------------------------------------------------- */

const combatantSpec = z.object({
  creature_id: z.number().int().optional().describe("AoN creature id from search_bestiary"),
  npc_id: z.string().optional().describe("An NPC id from the scenario / custom NPCs (joins as an ally by default)"),
  name: z.string().optional().describe("Name override, or the name of a custom combatant"),
  kind: z.enum(["enemy", "ally"]).optional(),
  qty: z.number().int().min(1).max(20).default(1).describe("How many copies (numbered 1..n)"),
  level: z.number().int().optional(), hp: z.number().int().optional(), ac: z.number().int().optional(),
  perception: z.number().int().optional(), fort: z.number().int().optional(), ref: z.number().int().optional(),
  will: z.number().int().optional(),
  notes: z.string().optional(),
}).describe("One of creature_id, npc_id, or name + stats for a custom combatant");

async function buildCombatants(scenario_id, body, specs) {
  const out = [];
  let creatures = null;
  let npcs = null;
  for (const s of specs) {
    let proto;
    if (s.creature_id != null) {
      creatures ||= await getCreatures();
      const cr = creatures.find((c) => c.id === s.creature_id);
      if (!cr) throw new ToolError(`No bestiary creature with AoN id ${s.creature_id}. Use search_bestiary.`);
      proto = combatantFromCreature(cr);
    } else if (s.npc_id) {
      npcs ||= await allNpcs(scenario_id, body);
      const n = npcs.find((x) => x.id === s.npc_id);
      if (!n) throw new ToolError(`No NPC "${s.npc_id}".`);
      proto = combatantFromNpc(n);
    } else if (s.name) {
      proto = {
        id: uid(), name: s.name, kind: "enemy", level: 0, init: null, maxHp: 0, hp: 0, ac: 10,
        perception: 0, fort: 0, ref: 0, will: 0, conditions: [], effects: [], pcId: null, notes: "",
      };
    } else {
      throw new ToolError("Each combatant needs creature_id, npc_id or name.");
    }
    if (s.name) proto.name = s.name;
    if (s.kind) proto.kind = s.kind;
    for (const k of ["level", "ac", "perception", "fort", "ref", "will"]) if (s[k] != null) proto[k] = s[k];
    if (s.hp != null) { proto.hp = s.hp; proto.maxHp = s.hp; }
    if (s.notes) proto.notes = s.notes;
    for (let i = 1; i <= s.qty; i++) {
      out.push({ ...structuredClone(proto), id: uid(), name: s.qty > 1 ? `${proto.name} ${i}` : proto.name });
    }
  }
  return out;
}

function findEncounter(body, id) {
  const e = body.encounters.find((x) => x.id === id);
  if (!e) throw new ToolError(`No tracker encounter "${id}". Encounters: ${body.encounters.map((x) => `${x.id} (${x.name})`).join(", ") || "none yet"}`);
  return e;
}

/* ---- tools --------------------------------------------------------------- */

const W = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const D = { ...W, destructiveHint: true };

export function registerWriteTools(server) {
  server.registerTool(
    "create_gm_page",
    {
      title: "Create a GM notes page",
      description:
        "Add a page to the GM's notes workspace, optionally filled with blocks. Give parent_page_id to make it a fork " +
        "(an alternate branch shown under that page). New main pages go after after_page_id, or at the end.",
      inputSchema: {
        scenario_id: scenarioId,
        title: z.string().min(1),
        parent_page_id: z.string().optional().describe("Make this a fork of that main page"),
        after_page_id: z.string().optional().describe("Main pages only: insert after this page (and its forks)"),
        blocks: z.array(blockSchema).optional(),
      },
      annotations: W,
    },
    async ({ scenario_id, title, parent_page_id, after_page_id, blocks }) => {
      let newId;
      const { summary } = await patchOverlay(scenario_id, async (body) => {
        const pages = body.gmPages;
        const page = { id: (newId = newExternalId()), title, group: "main", blocks: await buildBlocks(scenario_id, body, blocks) };
        // after a main page = after it and its trailing forks (the editor's layout)
        const endOfFamily = (pid) => {
          let j = pages.findIndex((p) => p.id === pid);
          while (j + 1 < pages.length && pages[j + 1].group === "fork") j++;
          return j + 1;
        };
        if (parent_page_id) {
          const parent = findPage(body, parent_page_id);
          if (parent.group === "fork") throw new ToolError("Forks can only hang off main pages.");
          page.group = "fork";
          page.parentId = parent.id;
          pages.splice(endOfFamily(parent.id), 0, page);
        } else if (after_page_id) {
          findPage(body, after_page_id);
          pages.splice(endOfFamily(after_page_id), 0, page);
        } else {
          pages.push(page);
        }
        return { patch: { gmPages: pages }, summary: `created GM page "${title}"${parent_page_id ? " (fork)" : ""} with ${page.blocks.length} blocks` };
      });
      return text(`${summary}. Page id: ${newId}`);
    }
  );

  server.registerTool(
    "add_gm_blocks",
    {
      title: "Add blocks to a GM page",
      description: "Insert blocks into a GM notes page, after after_block_id or at the end. Returns the new block ids.",
      inputSchema: {
        scenario_id: scenarioId,
        page_id: z.string(),
        blocks: z.array(blockSchema).min(1),
        after_block_id: z.string().optional(),
      },
      annotations: W,
    },
    async ({ scenario_id, page_id, blocks, after_block_id }) => {
      let ids = [];
      const { summary } = await patchOverlay(scenario_id, async (body) => {
        const page = findPage(body, page_id);
        const nb = await buildBlocks(scenario_id, body, blocks);
        ids = nb.map((b) => b.id);
        page.blocks = page.blocks || [];
        let at = page.blocks.length;
        if (after_block_id) {
          const i = page.blocks.findIndex((b) => b.id === after_block_id);
          if (i === -1) throw new ToolError(`No block "${after_block_id}" on page ${page_id}.`);
          at = i + 1;
        }
        page.blocks.splice(at, 0, ...nb);
        return { patch: { gmPages: body.gmPages }, summary: `added ${nb.length} block(s) to "${page.title}"` };
      });
      return text(`${summary}. New block ids: ${ids.join(", ")}`);
    }
  );

  server.registerTool(
    "update_gm_block",
    {
      title: "Update a GM notes block",
      description: "Change fields of an existing block (text, check tiers, q&a rows, link chips…). Fields not given are kept.",
      inputSchema: { scenario_id: scenarioId, page_id: z.string(), block_id: z.string(), changes: blockSchema.partial() },
      annotations: W,
    },
    async ({ scenario_id, page_id, block_id, changes }) => {
      const { summary } = await patchOverlay(scenario_id, async (body) => {
        const page = findPage(body, page_id);
        const i = (page.blocks || []).findIndex((b) => b.id === block_id);
        if (i === -1) throw new ToolError(`No block "${block_id}" on page ${page_id}.`);
        const old = page.blocks[i];
        const merged = { ...old, ...changes };
        if (changes.tiers) merged.tiers = changes.tiers; // strings; normalizeBlock maps them onto the fixed tiers
        else if (old.tiers) merged.tiers = old.tiers.map((t) => t.text);
        const nb = normalizeBlock(merged, old.id);
        if (old.type === "note" && old.stamp && !changes.type) nb.stamp = old.stamp;
        page.blocks[i] = await resolveLinks(scenario_id, body, nb);
        return { patch: { gmPages: body.gmPages }, summary: `updated a ${nb.type} block on "${page.title}"` };
      });
      return text(summary);
    }
  );

  server.registerTool(
    "delete_gm_block",
    {
      title: "Delete a GM notes block",
      description: "Remove one block from a GM notes page.",
      inputSchema: { scenario_id: scenarioId, page_id: z.string(), block_id: z.string() },
      annotations: D,
    },
    async ({ scenario_id, page_id, block_id }) => {
      const { summary } = await patchOverlay(scenario_id, async (body) => {
        const page = findPage(body, page_id);
        const before = (page.blocks || []).length;
        page.blocks = (page.blocks || []).filter((b) => b.id !== block_id);
        if (page.blocks.length === before) throw new ToolError(`No block "${block_id}" on page ${page_id}.`);
        return { patch: { gmPages: body.gmPages }, summary: `deleted a block from "${page.title}"` };
      });
      return text(summary);
    }
  );

  server.registerTool(
    "update_gm_page",
    {
      title: "Rename a GM notes page",
      description: "Change a GM notes page's title.",
      inputSchema: { scenario_id: scenarioId, page_id: z.string(), title: z.string().min(1) },
      annotations: W,
    },
    async ({ scenario_id, page_id, title }) => {
      const { summary } = await patchOverlay(scenario_id, async (body) => {
        const page = findPage(body, page_id);
        const was = page.title;
        page.title = title;
        return { patch: { gmPages: body.gmPages }, summary: `renamed GM page "${was}" to "${title}"` };
      });
      return text(summary);
    }
  );

  server.registerTool(
    "delete_gm_page",
    {
      title: "Delete a GM notes page",
      description: "Delete a GM notes page. Deleting a main page also deletes its forks.",
      inputSchema: { scenario_id: scenarioId, page_id: z.string() },
      annotations: D,
    },
    async ({ scenario_id, page_id }) => {
      const { summary } = await patchOverlay(scenario_id, async (body) => {
        const page = findPage(body, page_id);
        const gone = new Set([page.id]);
        if (page.group !== "fork") body.gmPages.filter((p) => p.parentId === page.id).forEach((p) => gone.add(p.id));
        return {
          patch: { gmPages: body.gmPages.filter((p) => !gone.has(p.id)) },
          summary: `deleted GM page "${page.title}"${gone.size > 1 ? ` and ${gone.size - 1} fork(s)` : ""}`,
        };
      });
      return text(summary);
    }
  );

  server.registerTool(
    "set_entity_note",
    {
      title: "Set an NPC or PC note",
      description: "Write the GM's private note on an NPC (by NPC id) or a PC (by PC id). mode append adds a new line.",
      inputSchema: {
        scenario_id: scenarioId,
        entity_id: z.string(),
        text: z.string(),
        mode: z.enum(["replace", "append"]).default("append"),
      },
      annotations: W,
    },
    async ({ scenario_id, entity_id, text: note, mode }) => {
      const { summary } = await patchOverlay(scenario_id, async (body) => {
        const cur = body.notes[entity_id] || "";
        body.notes[entity_id] = mode === "append" && cur ? `${cur}\n${note}` : note;
        return { patch: { notes: body.notes }, summary: `${mode === "append" ? "appended to" : "set"} the note on ${entity_id}` };
      });
      return text(summary);
    }
  );

  server.registerTool(
    "add_custom_npc",
    {
      title: "Add a custom NPC",
      description: "Add an NPC of the GM's own to this scenario's roster. Only name is required.",
      inputSchema: {
        scenario_id: scenarioId,
        name: z.string().min(1),
        role: z.string().optional(),
        traits: z.array(z.string()).optional(),
        description: z.string().optional(),
        notes: z.string().optional().describe("GM-facing role/tactics text shown on the sheet"),
        level: z.number().int().optional(), perception: z.number().int().optional(), ac: z.number().int().optional(),
        hp: z.number().int().optional(), fort: z.number().int().optional(), ref: z.number().int().optional(),
        will: z.number().int().optional(),
        abilities: z.object({ str: z.number(), dex: z.number(), con: z.number(), int: z.number(), wis: z.number(), cha: z.number() }).optional(),
        skills: z.array(z.tuple([z.string(), z.number()])).optional().describe("[[\"Stealth\", 9], …]"),
        speed: z.string().optional(),
        languages: z.array(z.string()).optional(),
        attacks: z.array(z.string()).optional().describe("One line each, e.g. \"Melee — dagger +9 (agile), 1d4+3\""),
        spells: z.array(z.string()).optional(),
      },
      annotations: W,
    },
    async ({ scenario_id, ...f }) => {
      const id = "c" + uid();
      const npc = {
        id, custom: true, group: "npcs", name: f.name, role: f.role || "", traits: f.traits || [],
        description: f.description || "", level: f.level ?? null, perception: f.perception ?? null, ac: f.ac ?? null,
        hp: f.hp ?? null, fort: f.fort ?? null, ref: f.ref ?? null, will: f.will ?? null, notes: f.notes || "",
        source: "added by Claude",
      };
      for (const k of ["abilities", "skills", "speed", "languages", "attacks", "spells"]) if (f[k] != null) npc[k] = f[k];
      const { summary } = await patchOverlay(scenario_id, async (body) => ({
        patch: { customNpcs: [...body.customNpcs, npc] },
        summary: `added custom NPC "${f.name}"`,
      }));
      return text(`${summary}. NPC id: ${id}`);
    }
  );

  server.registerTool(
    "update_npc",
    {
      title: "Update an NPC",
      description:
        "Edit an NPC. Custom NPCs accept any field. Scenario NPCs only accept description and notes " +
        "(stored as the GM's edits; the published text stays available to reset to).",
      inputSchema: {
        scenario_id: scenarioId,
        npc_id: z.string(),
        changes: z.record(z.string(), z.unknown()).describe("Fields to set, e.g. {\"description\": \"…\", \"hp\": 40}"),
      },
      annotations: W,
    },
    async ({ scenario_id, npc_id, changes }) => {
      const { summary } = await patchOverlay(scenario_id, async (body) => {
        const custom = body.customNpcs.find((n) => n.id === npc_id);
        if (custom) {
          const rest = { ...changes };
          delete rest.id; // identity fields stay put
          delete rest.custom;
          Object.assign(custom, rest);
          return { patch: { customNpcs: body.customNpcs }, summary: `updated custom NPC "${custom.name}" (${Object.keys(rest).join(", ")})` };
        }
        const base = ((await getScenarioPart(scenario_id, "npcs")) || []).find((n) => n.id === npc_id);
        if (!base) throw new ToolError(`No NPC "${npc_id}".`);
        const bad = Object.keys(changes).filter((k) => !NPC_TEXT_FIELDS.includes(k));
        if (bad.length) throw new ToolError(`Scenario NPCs only accept ${NPC_TEXT_FIELDS.join(" and ")}; not ${bad.join(", ")}.`);
        let edits = body.npcEdits;
        for (const k of Object.keys(changes)) edits = setNpcEdit(edits, base, k, String(changes[k] ?? ""));
        return { patch: { npcEdits: edits }, summary: `edited ${Object.keys(changes).join(" and ")} of "${base.name}"` };
      });
      return text(summary);
    }
  );

  server.registerTool(
    "create_encounter",
    {
      title: "Create a tracker encounter",
      description:
        "Add an encounter to the GM's initiative tracker. Combatants come from the bestiary (creature_id), " +
        "the NPC roster (npc_id) or custom stats. Stat blocks fill in automatically when the GM opens it.",
      inputSchema: {
        scenario_id: scenarioId,
        name: z.string().min(1),
        note: z.string().optional(),
        combatants: z.array(combatantSpec).default([]),
      },
      annotations: W,
    },
    async ({ scenario_id, name, note, combatants }) => {
      const id = uid();
      const { summary } = await patchOverlay(scenario_id, async (body) => {
        const list = await buildCombatants(scenario_id, body, combatants);
        const enc = { id, name, note: note || "", map: "", combatants: list };
        return { patch: { encounters: [...body.encounters, enc] }, summary: `created encounter "${name}" with ${list.length} combatant(s)` };
      });
      return text(`${summary}. Encounter id: ${id}`);
    }
  );

  server.registerTool(
    "add_combatants",
    {
      title: "Add combatants to an encounter",
      description: "Add combatants to an existing tracker encounter.",
      inputSchema: { scenario_id: scenarioId, encounter_id: z.string(), combatants: z.array(combatantSpec).min(1) },
      annotations: W,
    },
    async ({ scenario_id, encounter_id, combatants }) => {
      const { summary } = await patchOverlay(scenario_id, async (body) => {
        const enc = findEncounter(body, encounter_id);
        const list = await buildCombatants(scenario_id, body, combatants);
        enc.combatants = [...(enc.combatants || []), ...list];
        return { patch: { encounters: body.encounters }, summary: `added ${list.length} combatant(s) to "${enc.name}"` };
      });
      return text(summary);
    }
  );

  server.registerTool(
    "prefill_encounters",
    {
      title: "Prefill tracker from the scenario",
      description: "Copy the scenario's encounters into the tracker (skipping ones already there by name), like the tracker's prefill button.",
      inputSchema: { scenario_id: scenarioId },
      annotations: W,
    },
    async ({ scenario_id }) => {
      const scenEnc = (await getScenarioPart(scenario_id, "encounters")) || [];
      const { summary } = await patchOverlay(scenario_id, async (body) => {
        const added = buildScenarioEncounters(new Set(body.encounters.map((e) => e.name)), scenEnc);
        if (!added.length) return { patch: null, summary: "every scenario encounter is already in the tracker" };
        // maps stay in the scenario; the app re-attaches them by name
        const list = stripSeededMaps([...body.encounters, ...added], scenEnc);
        return { patch: { encounters: list }, summary: `prefilled ${added.length} encounter(s): ${added.map((e) => e.name).join(", ")}` };
      });
      return text(summary);
    }
  );

  server.registerTool(
    "undo_last_change",
    {
      title: "Undo Claude's last change",
      description:
        "Revert the most recent change made through these tools on a scenario. Edits the GM made since are kept " +
        "where they don't overlap. Call repeatedly to step further back.",
      inputSchema: { scenario_id: scenarioId },
      annotations: D,
    },
    async ({ scenario_id }) => {
      const row = await lastMcpChange(scenario_id);
      if (!row) return text("Nothing to undo.");
      const before = row.before || {};
      const after = { ...before, ...row.patch };
      const { summary } = await patchOverlay(
        scenario_id,
        async (body) => {
          const keys = Object.keys(row.patch);
          // Apply the inverse of that change on top of whatever is there now.
          const reverted = mergeOverlay(pick(after, keys), pick(body, keys), pick(before, keys, body));
          return { patch: reverted, summary: `undid: ${row.summary || "last change"}` };
        },
        { source: "mcp-undo" }
      );
      await dropHistoryRow(row.id);
      return text(summary);
    }
  );
}

// Subset of an overlay body; keys missing from `src` fall back to an empty
// value of the same shape as in `shape` (e.g. undoing the very first write).
function pick(src, keys, shape) {
  const out = {};
  for (const k of keys) {
    if (src[k] !== undefined) out[k] = src[k];
    else if (shape) out[k] = Array.isArray(shape[k]) ? [] : {};
  }
  return out;
}

