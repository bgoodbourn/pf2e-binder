/* Read-only tools: find your way around a scenario and the GM's own notes. */
import { z } from "zod";
import { applyNpcEdits } from "../../src/lib/npcs.js";
import {
  listScenarios, getScenarioPart, getScenarioParts, getOverlay, getView, getCreatures, recentChanges, ToolError,
} from "../store.js";
import { sectionToMarkdown, blockText, slimEncounter, describePage, json, text } from "../format.js";

const RO = { readOnlyHint: true, openWorldHint: false };
const scenarioId = z.string().describe("Scenario id, e.g. \"the-path-river-peeler\" (see list_scenarios / get_current_view)");

export async function allNpcs(id, overlay) {
  const base = (await getScenarioPart(id, "npcs")) || [];
  return [
    ...applyNpcEdits(base, overlay.npcEdits).map((n) => ({ ...n, _kind: "base" })),
    ...(overlay.customNpcs || []).map((n) => ({ ...n, _kind: "custom" })),
  ];
}

export function registerReadTools(server) {
  server.registerTool(
    "list_scenarios",
    { title: "List scenarios", description: "List every scenario in the binder with its id.", annotations: RO },
    async () => {
      const rows = await listScenarios();
      return text(rows.map((r) => `${r.id} — ${r.title}${r.custom ? " (custom campaign)" : ""}`).join("\n"));
    }
  );

  server.registerTool(
    "get_current_view",
    {
      title: "What the binder is showing",
      description:
        "What the GM currently has open in the binder: scenario, workspace tab, scenario section and GM notes page. " +
        "Use it to resolve \"this page\", \"here\", \"the current scenario\". May be stale if the binder isn't open.",
      annotations: RO,
    },
    async () => {
      const v = await getView();
      if (!v || !v.scenario_id) return text("The binder hasn't reported a view yet (it may not be open).");
      const [title, tabs, overlay] = await Promise.all([
        getScenarioPart(v.scenario_id, "title"),
        getScenarioPart(v.scenario_id, "tabs"),
        getOverlay(v.scenario_id),
      ]);
      const section = (tabs || []).flatMap((g) => g.items).find((i) => i.id === v.section_id);
      const page = overlay.body.gmPages.find((p) => p.id === v.gm_page_id);
      const ageMin = Math.round((Date.now() - new Date(v.updated_at).getTime()) / 60000);
      return text(json({
        scenario: { id: v.scenario_id, title },
        tab: v.tab,
        section: v.section_id ? { id: v.section_id, label: section?.label } : null,
        gm_page: page ? { id: page.id, title: page.title } : null,
        reported: ageMin <= 1 ? "just now" : `${ageMin} minutes ago`,
      }));
    }
  );

  server.registerTool(
    "get_scenario_outline",
    {
      title: "Scenario outline",
      description:
        "Start here for any scenario. Returns its sections (ids for get_section), NPC ids, the scenario's encounters, " +
        "the GM's tracker encounters, GM notes pages and map pins. Everything else is looked up by these ids.",
      inputSchema: { scenario_id: scenarioId },
      annotations: RO,
    },
    async ({ scenario_id }) => {
      const [parts, ov] = await Promise.all([
        getScenarioParts(scenario_id, ["title", "meta", "tabs", "encounters", "maps"]),
        getOverlay(scenario_id),
      ]);
      const overlay = ov.body;
      const npcs = await allNpcs(scenario_id, overlay);
      const outline = {
        title: parts.title,
        meta: parts.meta,
        sections: (parts.tabs || []).map((g) => ({ group: g.group, items: g.items.map((i) => `${i.id}: ${i.label}`) })),
        npcs: npcs.map((n) => `${n.id}: ${n.name}${n.role ? ` — ${n.role}` : ""}${n._kind === "custom" ? " [custom]" : ""}${n.edited ? " [edited]" : ""}`),
        scenario_encounters: (parts.encounters || []).map((e) =>
          `${e.name}: ${(e.creatures || []).map((c) => `${c.name}${c.qty > 1 ? ` ×${c.qty}` : ""} (L${c.level})`).join(", ")}`),
        tracker_encounters: overlay.encounters.map((e) => `${e.id}: ${e.name} — ${e.combatants?.length || 0} combatants${e.round > 1 ? `, round ${e.round}` : ""}`),
        gm_pages: overlay.gmPages.map((p) =>
          `${p.id}: ${p.title}${p.group === "fork" ? ` [fork of ${p.parentId}]` : ""} — ${(p.blocks || []).length} blocks`),
        maps: (parts.maps || []).map((m) => ({
          id: m.id, name: `${m.code ? `${m.code} ` : ""}${m.name}`,
          pins: (m.refs || []).map((r) => `${r.label} ${r.name || ""} → section ${r.to}`),
        })),
        entity_notes: Object.keys(overlay.notes).length ? Object.keys(overlay.notes) : undefined,
      };
      return text(json(outline));
    }
  );

  server.registerTool(
    "get_section",
    {
      title: "Read a scenario section",
      description: "Read one section of the published scenario text as markdown (read-aloud boxes, checks, encounters, hazards).",
      inputSchema: { scenario_id: scenarioId, section_id: z.string().describe("Section id from get_scenario_outline") },
      annotations: RO,
    },
    async ({ scenario_id, section_id }) => {
      const [content, tabs] = await Promise.all([getScenarioPart(scenario_id, "content"), getScenarioPart(scenario_id, "tabs")]);
      const blocks = content?.[section_id];
      if (!blocks) {
        const ids = (tabs || []).flatMap((g) => g.items.map((i) => i.id));
        throw new ToolError(`No section "${section_id}". Sections: ${ids.join(", ")}`);
      }
      const label = (tabs || []).flatMap((g) => g.items).find((i) => i.id === section_id)?.label;
      return text(`# ${label || section_id}\n\n${sectionToMarkdown(blocks)}`);
    }
  );

  server.registerTool(
    "get_npc",
    {
      title: "Read an NPC",
      description: "Full details of an NPC (scenario or custom), including the GM's edits and their private note.",
      inputSchema: { scenario_id: scenarioId, npc_id: z.string() },
      annotations: RO,
    },
    async ({ scenario_id, npc_id }) => {
      const { body } = await getOverlay(scenario_id);
      const npcs = await allNpcs(scenario_id, body);
      const n = npcs.find((x) => x.id === npc_id);
      if (!n) throw new ToolError(`No NPC "${npc_id}". NPCs: ${npcs.map((x) => x.id).join(", ")}`);
      const { _kind, ...npc } = n;
      return text(json({ kind: _kind, ...npc, gm_note: body.notes[npc_id] || undefined }));
    }
  );

  server.registerTool(
    "get_encounter",
    {
      title: "Read an encounter",
      description:
        "An encounter by tracker id or name: the scenario's version (creatures, quantities) and the GM's tracker copy " +
        "(combatants with HP, conditions, initiative). Map images and stat block bodies are omitted.",
      inputSchema: { scenario_id: scenarioId, encounter: z.string().describe("Tracker encounter id, or encounter name like \"A1 · Approach\"") },
      annotations: RO,
    },
    async ({ scenario_id, encounter }) => {
      const [base, { body }] = await Promise.all([getScenarioPart(scenario_id, "encounters"), getOverlay(scenario_id)]);
      const q = encounter.toLowerCase();
      const tracker = body.encounters.find((e) => e.id === encounter) || body.encounters.find((e) => e.name.toLowerCase() === q)
        || body.encounters.find((e) => e.name.toLowerCase().includes(q));
      const name = tracker?.name || encounter;
      const scen = (base || []).find((e) => e.name.toLowerCase() === name.toLowerCase())
        || (base || []).find((e) => e.name.toLowerCase().includes(q));
      if (!tracker && !scen) {
        throw new ToolError(`No encounter matching "${encounter}". Try get_scenario_outline for names and ids.`);
      }
      return text(json({ scenario_version: slimEncounter(scen) || null, tracker: slimEncounter(tracker) || null }));
    }
  );

  server.registerTool(
    "get_gm_page",
    {
      title: "Read a GM notes page",
      description: "A GM notes page with every block and its id (needed to insert after, update or delete a block).",
      inputSchema: { scenario_id: scenarioId, page_id: z.string() },
      annotations: RO,
    },
    async ({ scenario_id, page_id }) => {
      const { body } = await getOverlay(scenario_id);
      const page = body.gmPages.find((p) => p.id === page_id);
      if (!page) throw new ToolError(`No GM page "${page_id}". Pages: ${body.gmPages.map((p) => `${p.id} (${p.title})`).join(", ") || "none yet"}`);
      return text(json(describePage(page, body.gmPages)));
    }
  );

  server.registerTool(
    "search_scenario",
    {
      title: "Search a scenario",
      description: "Case-insensitive text search across the scenario's sections, NPCs and the GM's notes pages.",
      inputSchema: { scenario_id: scenarioId, query: z.string().min(2) },
      annotations: RO,
    },
    async ({ scenario_id, query }) => {
      const q = query.toLowerCase();
      const [content, tabs, { body }] = await Promise.all([
        getScenarioPart(scenario_id, "content"), getScenarioPart(scenario_id, "tabs"), getOverlay(scenario_id),
      ]);
      const labels = Object.fromEntries((tabs || []).flatMap((g) => g.items.map((i) => [i.id, i.label])));
      const snippet = (s) => {
        const i = s.toLowerCase().indexOf(q);
        return (i > 60 ? "…" : "") + s.slice(Math.max(0, i - 60), i + q.length + 80).replace(/\s+/g, " ") + "…";
      };
      const hits = [];
      for (const [sid, blocks] of Object.entries(content || {})) {
        for (const b of blocks || []) {
          const t = blockText(b);
          if (t.toLowerCase().includes(q)) hits.push(`section ${sid} (${labels[sid] || sid}): ${snippet(t)}`);
        }
      }
      for (const n of await allNpcs(scenario_id, body)) {
        const t = [n.name, n.role, n.description, n.notes].filter(Boolean).join(" ");
        if (t.toLowerCase().includes(q)) hits.push(`npc ${n.id} (${n.name}): ${snippet(t)}`);
      }
      for (const p of body.gmPages) {
        for (const b of p.blocks || []) {
          const t = blockText(b);
          if (t.toLowerCase().includes(q)) hits.push(`gm page ${p.id} (${p.title}), block ${b.id}: ${snippet(t)}`);
        }
      }
      return text(hits.length ? hits.slice(0, 40).join("\n") + (hits.length > 40 ? `\n…and ${hits.length - 40} more` : "") : "No matches.");
    }
  );

  server.registerTool(
    "search_bestiary",
    {
      title: "Search the bestiary",
      description:
        "Search the Archives of Nethys creature list (PF2e remaster bestiaries). Returns AoN ids for create_encounter / add_combatants.",
      inputSchema: {
        query: z.string().optional().describe("Name or family substring"),
        trait: z.string().optional().describe("Trait, e.g. \"undead\", \"fey\""),
        level_min: z.number().int().optional(),
        level_max: z.number().int().optional(),
        limit: z.number().int().min(1).max(50).default(20),
      },
      annotations: RO,
    },
    async ({ query, trait, level_min, level_max, limit }) => {
      const q = query?.toLowerCase();
      const t = trait?.toLowerCase();
      const rows = (await getCreatures()).filter((c) =>
        (!q || c.name.toLowerCase().includes(q) || (c.family || "").toLowerCase().includes(q)) &&
        (!t || (c.traits || []).some((x) => x.toLowerCase() === t)) &&
        (level_min == null || c.level >= level_min) &&
        (level_max == null || c.level <= level_max));
      if (!rows.length) return text("No creatures match.");
      return text(rows.slice(0, limit).map((c) =>
        `aon ${c.id}: ${c.name} — L${c.level}, AC ${c.ac}, HP ${c.hp}, Per ${c.per}, F/R/W ${c.fort}/${c.ref}/${c.will}` +
        `${c.traits?.length ? ` [${c.traits.join(", ")}]` : ""}${c.source ? ` (${c.source})` : ""}`).join("\n") +
        (rows.length > limit ? `\n…${rows.length - limit} more; narrow the search.` : ""));
    }
  );

  server.registerTool(
    "list_recent_changes",
    {
      title: "Recent Claude changes",
      description: "The most recent changes made to a scenario through these tools (newest first). undo_last_change reverts the newest.",
      inputSchema: { scenario_id: scenarioId },
      annotations: RO,
    },
    async ({ scenario_id }) => {
      const rows = await recentChanges(scenario_id);
      if (!rows.length) return text("No changes recorded yet.");
      return text(rows.map((r) => `${new Date(r.created_at).toLocaleString()} — ${r.source === "mcp-undo" ? "undo: " : ""}${r.summary || "(no summary)"}`).join("\n"));
    }
  );
}
