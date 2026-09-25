/* ------------------------------------------------------------------ *
 *  Supabase — background backup/sync, NOT load-bearing.
 *
 *  The publishable (anon) key ships in the client by design. If env vars
 *  are absent (e.g. local dev with sync off) the client is null and every
 *  function here degrades to a no-op — the app runs fully on IndexedDB.
 *
 *  Maps between the app's blob shapes and the Postgres row shapes:
 *    scenario row:  { scenario_id, title, content jsonb, schema_version, updated_at }
 *    overlay  row:  { scenario_id, overlay jsonb, schema_version, updated_at }
 *  (content jsonb = the base blob minus scenario_id/title/schema_version)
 * ------------------------------------------------------------------ */
import { createClient } from "@supabase/supabase-js";
import { SCHEMA_VERSION } from "./schema.js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = url && anon ? createClient(url, anon) : null;
export const remoteEnabled = !!supabase;

// Fields that are real columns on the `scenario` row. Everything ELSE on the
// blob is round-tripped wholesale inside the `content` jsonb — storing the
// remainder rather than a hand-maintained whitelist means a newly-added
// scenario field can never be silently dropped on a remote round-trip (the bug
// that made `custom` vanish cross-device until it was added to the old list).
const SCENARIO_COLUMNS = ["scenario_id", "title", "schema_version", "updated_at"];

function toScenarioRow(blob) {
  const content = {};
  for (const k of Object.keys(blob)) {
    if (!SCENARIO_COLUMNS.includes(k)) content[k] = blob[k];
  }
  return {
    scenario_id: blob.scenario_id,
    title: blob.title,
    content,
    schema_version: blob.schema_version ?? SCHEMA_VERSION,
  };
}

function fromScenarioRow(row) {
  if (!row) return null;
  // Spread content first so the canonical column values always win, even if a
  // stale copy of one ever ended up nested inside content.
  return {
    ...(row.content || {}),
    scenario_id: row.scenario_id,
    schema_version: row.schema_version ?? SCHEMA_VERSION,
    title: row.title,
    updated_at: row.updated_at,
  };
}

function fromOverlayRow(row) {
  if (!row) return null;
  return {
    scenario_id: row.scenario_id,
    schema_version: row.schema_version ?? SCHEMA_VERSION,
    overlay: row.overlay || {},
    updated_at: row.updated_at,
  };
}

export async function remoteListScenarios() {
  if (!supabase) return [];
  const { data, error } = await supabase.from("scenario").select("scenario_id, title, updated_at");
  if (error) throw error;
  return data || [];
}

export async function remoteGetScenario(id) {
  if (!supabase) return null;
  const { data, error } = await supabase.from("scenario").select("*").eq("scenario_id", id).maybeSingle();
  if (error) throw error;
  return fromScenarioRow(data);
}

export async function remoteUpsertScenario(blob) {
  if (!supabase) return null;
  const { error } = await supabase.from("scenario").upsert(toScenarioRow(blob), { onConflict: "scenario_id" });
  if (error) throw error;
  return true;
}

export async function remoteGetOverlay(id) {
  if (!supabase) return null;
  const { data, error } = await supabase.from("scenario_overlay").select("*").eq("scenario_id", id).maybeSingle();
  if (error) throw error;
  return fromOverlayRow(data);
}

export async function remoteUpsertOverlay(blob) {
  if (!supabase) return null;
  const { error } = await supabase.from("scenario_overlay").upsert(
    {
      scenario_id: blob.scenario_id,
      overlay: blob.overlay,
      schema_version: blob.schema_version ?? SCHEMA_VERSION,
    },
    { onConflict: "scenario_id" }
  );
  if (error) throw error;
  return true;
}

// Raised when a compare-and-swap write loses: the row changed since `expected`.
export class OverlayConflict extends Error {}

// Compare-and-swap overlay write (supabase/migrations/0002_mcp_sync.sql).
// `expected` is the updated_at string last read from the server (null when no
// row was seen). Returns the new updated_at string. Until the migration is
// applied the RPC doesn't exist; then fall back to the old blind upsert and
// return null (no version token), so sync keeps working as before.
let casMissing = false;
export async function remotePutOverlay(id, body, expected) {
  if (!supabase) return null;
  if (!casMissing) {
    const { data, error } = await supabase.rpc("put_overlay", {
      p_scenario_id: id,
      p_overlay: body,
      p_expected: expected ?? null,
      p_schema_version: SCHEMA_VERSION,
    });
    if (!error) return data;
    if (error.code === "PT409" || error.status === 409) throw new OverlayConflict(error.message);
    if (error.code !== "PGRST202" && error.status !== 404) throw error;
    casMissing = true;
    console.warn("[sync] put_overlay RPC missing: apply supabase/migrations/0002_mcp_sync.sql. Falling back to blind upsert.");
  }
  await remoteUpsertOverlay({ scenario_id: id, overlay: body, schema_version: SCHEMA_VERSION });
  return null;
}

// Realtime: call onChange(updatedAt|null) whenever this scenario's overlay row
// changes on the server, and onReady() each time the channel (re)subscribes so
// the caller can catch up on anything missed while disconnected. Returns an
// unsubscribe function.
export function subscribeOverlay(id, onChange, onReady) {
  if (!supabase) return () => {};
  const channel = supabase
    .channel(`overlay:${id}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "scenario_overlay", filter: `scenario_id=eq.${id}` },
      (payload) => onChange(payload?.new?.updated_at ?? null)
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") onReady?.();
    });
  return () => {
    supabase.removeChannel(channel);
  };
}

// What the binder is showing (single row), for the MCP server's
// get_current_view. Best effort: silently ignored before the migration.
export async function remoteSetView(view) {
  if (!supabase) return null;
  const { error } = await supabase.from("binder_view").upsert({ id: 1, ...view }, { onConflict: "id" });
  if (error && error.code !== "42P01" && error.code !== "PGRST205") throw error;
  return true;
}

export async function remoteHeartbeat() {
  if (!supabase) return null;
  const { error } = await supabase.from("heartbeat").upsert({ id: 1 }, { onConflict: "id" });
  if (error) throw error;
  return true;
}
