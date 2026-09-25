/* ------------------------------------------------------------------ *
 *  Data access for the binder MCP server.
 *
 *  Reads base scenarios from the Supabase `scenario` row one part at a time
 *  (content->npcs, content->tabs, …) so the 1–2 MB of base64 map images is
 *  only fetched when a tool actually needs encounters or maps. Falls back to
 *  the bundled public/scenarios/<id>.json if a scenario isn't in Supabase.
 *
 *  Writes go through the patch_overlay RPC (supabase/migrations/
 *  0002_mcp_sync.sql): read the overlay + its updated_at, compute the new
 *  value of the top-level keys being changed, and compare-and-swap. A write
 *  that loses a race with the app is retried against fresh data.
 * ------------------------------------------------------------------ */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { migrateOverlay, migrateScenario } from "../src/data/schema.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(here, "..");

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
if (!url || !key) {
  throw new Error(
    "Supabase isn't configured. Start the server with the repo's .env, e.g. " +
      "`node --env-file=.env mcp/server.js` (needs VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY)."
  );
}
export const supabase = createClient(url, key, { auth: { persistSession: false } });

// A friendly, tool-visible error (shown to Claude as the tool result).
export class ToolError extends Error {}

/* ---- base scenarios ------------------------------------------------------ */

const TTL = 60_000;
const cache = new Map(); // `${id}:${part}` -> { at, value }

async function bundled(id) {
  const k = `${id}:__file`;
  if (!cache.has(k)) {
    const p = readFile(path.join(REPO, "public", "scenarios", `${id}.json`), "utf8")
      .then((s) => migrateScenario(JSON.parse(s)))
      .catch(() => null);
    cache.set(k, { at: Infinity, value: p });
  }
  return cache.get(k).value;
}

export async function listScenarios() {
  const { data, error } = await supabase.from("scenario").select("scenario_id, title, custom:content->custom");
  if (error) throw error;
  const rows = (data || []).map((r) => ({ id: r.scenario_id, title: r.title, custom: r.custom === true }));
  // Bundled scenarios the app hasn't pushed yet.
  try {
    const manifest = JSON.parse(await readFile(path.join(REPO, "public", "scenarios", "index.json"), "utf8"));
    for (const m of manifest) {
      if (!rows.some((r) => r.id === m.scenario_id)) rows.push({ id: m.scenario_id, title: m.title, custom: false });
    }
  } catch {
    /* no manifest: Supabase list only */
  }
  return rows.sort((a, b) => a.title.localeCompare(b.title));
}

// One top-level part of a base scenario: title, meta, tabs, content, npcs,
// encounters, maps, links, custom.
export async function getScenarioPart(id, part) {
  const k = `${id}:${part}`;
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  let value;
  if (part === "title") {
    const { data, error } = await supabase.from("scenario").select("title").eq("scenario_id", id).maybeSingle();
    if (error) throw error;
    value = data ? data.title : (await bundled(id))?.title;
  } else {
    const { data, error } = await supabase
      .from("scenario")
      .select(`part:content->${part}`)
      .eq("scenario_id", id)
      .maybeSingle();
    if (error) throw error;
    value = data ? data.part : (await bundled(id))?.[part];
  }
  if (value === undefined && !(await scenarioExists(id))) {
    throw new ToolError(`No scenario "${id}". Call list_scenarios for valid ids.`);
  }
  cache.set(k, { at: Date.now(), value });
  return value;
}

async function scenarioExists(id) {
  const { data } = await supabase.from("scenario").select("scenario_id").eq("scenario_id", id).maybeSingle();
  return !!data || !!(await bundled(id));
}

export async function getScenarioParts(id, parts) {
  const values = await Promise.all(parts.map((p) => getScenarioPart(id, p)));
  return Object.fromEntries(parts.map((p, i) => [p, values[i]]));
}

/* ---- overlay ------------------------------------------------------------- */

export async function getOverlay(id) {
  const { data, error } = await supabase
    .from("scenario_overlay")
    .select("overlay, updated_at")
    .eq("scenario_id", id)
    .maybeSingle();
  if (error) throw error;
  return {
    body: migrateOverlay(data ? { overlay: data.overlay } : null, id).overlay,
    updatedAt: data ? data.updated_at : null,
  };
}

const MIGRATION_HINT =
  "The binder database is missing the MCP support functions. Apply " +
  "supabase/migrations/0002_mcp_sync.sql in the Supabase SQL editor, then retry.";

async function rpcPatch(id, patch, expected, source, summary) {
  const { data, error } = await supabase.rpc("patch_overlay", {
    p_scenario_id: id,
    p_patch: patch,
    p_expected: expected,
    p_source: source,
    p_summary: summary,
  });
  if (!error) return { ok: true, updatedAt: data };
  if (error.code === "PT409") return { ok: false };
  if (error.code === "PGRST202") throw new ToolError(MIGRATION_HINT);
  if (error.code === "23503") throw new ToolError(`No scenario "${id}" in the binder database yet. Open it in the binder once so it syncs, then retry.`);
  throw error;
}

/**
 * Read-modify-write the overlay. `fn(body)` returns { patch, summary } where
 * patch holds only the top-level keys to replace (notes, customNpcs,
 * encounters, gmPages, npcEdits); it may throw ToolError. Retries when the
 * app wrote in between. Returns { summary, body } with the new body.
 */
export async function patchOverlay(id, fn, { source = "mcp" } = {}) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const { body, updatedAt } = await getOverlay(id);
    const { patch, summary } = await fn(structuredClone(body));
    if (!patch || !Object.keys(patch).length) return { summary: summary || "nothing to change", body };
    const res = await rpcPatch(id, patch, updatedAt, source, summary || null);
    if (res.ok) return { summary, body: { ...body, ...patch } };
    // lost a race: back off with jitter so competing writers spread out
    await new Promise((r) => setTimeout(r, 50 + Math.random() * 100 * (attempt + 1)));
  }
  throw new ToolError("The binder kept changing while writing (it was being edited). Try again in a moment.");
}

/* ---- history (undo) ------------------------------------------------------ */

export async function recentChanges(id, limit = 10) {
  const { data, error } = await supabase
    .from("overlay_history")
    .select("id, source, summary, created_at")
    .eq("scenario_id", id)
    .order("id", { ascending: false })
    .limit(limit);
  if (error) {
    if (error.code === "PGRST205" || error.code === "42P01") throw new ToolError(MIGRATION_HINT);
    throw error;
  }
  return data || [];
}

export async function lastMcpChange(id) {
  const { data, error } = await supabase
    .from("overlay_history")
    .select("id, summary, before, patch, created_at")
    .eq("scenario_id", id)
    .eq("source", "mcp")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (error.code === "PGRST205" || error.code === "42P01") throw new ToolError(MIGRATION_HINT);
    throw error;
  }
  return data;
}

export async function dropHistoryRow(rowId) {
  const { error } = await supabase.from("overlay_history").delete().eq("id", rowId);
  if (error) throw error;
}

/* ---- what the binder is showing ------------------------------------------ */

export async function getView() {
  const { data, error } = await supabase.from("binder_view").select("*").eq("id", 1).maybeSingle();
  if (error) {
    if (error.code === "PGRST205" || error.code === "42P01") throw new ToolError(MIGRATION_HINT);
    throw error;
  }
  return data;
}

/* ---- bestiary ------------------------------------------------------------ */

let creatures = null;
export async function getCreatures() {
  if (!creatures) {
    creatures = JSON.parse(await readFile(path.join(REPO, "src", "data", "creatures.json"), "utf8"));
  }
  return creatures;
}
