# Binder MCP server

A local [MCP](https://modelcontextprotocol.io) server that lets Claude read the binder's scenarios and write into the GM's own layer of them. Claude Desktop or Claude Code runs it on your Mac over stdio, so it's covered by your Claude subscription. It talks to the same Supabase project as the app, and an open binder tab shows Claude's edits live.

Claude can edit:
- GM notes pages and forks, with every block type
- private notes on NPCs and PCs
- custom NPCs, and the description or notes of a scenario NPC
- initiative-tracker encounters and combatants

The published scenario text is read-only.

## One-time setup

1. **Apply the database migration.** Open the Supabase dashboard's SQL editor and run `supabase/migrations/0002_mcp_sync.sql`. It is safe to re-run. It adds three things:
   - compare-and-swap writes, so the app and Claude never overwrite each other
   - an undo history for Claude's changes
   - realtime on the overlay table, and a one-row table recording what the binder is showing

   The app keeps working before the migration, using its old blind upsert. The server's write tools refuse to run until the migration is applied.

2. **Install the server's dependencies:**

   ```bash
   cd mcp && npm install
   ```

3. **Connect Claude.**
   - **Claude Code:** the repo's `.mcp.json` registers the server. Open Claude Code in the repo and approve `pf2e-binder` when asked.
   - **Claude Desktop:** add this to `~/Library/Application Support/Claude/claude_desktop_config.json`, then restart Desktop. Use absolute paths.

     ```json
     {
       "mcpServers": {
         "pf2e-binder": {
           "command": "node",
           "args": [
             "--env-file=/Users/you/Projects/pf2e-binder/.env",
             "/Users/you/Projects/pf2e-binder/mcp/server.js"
           ]
         }
       }
     }
     ```

The server reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from the repo's `.env`.

## Tools

| Read | Write |
|---|---|
| `list_scenarios` | `create_gm_page` (page or fork, optionally with blocks) |
| `get_current_view` (what the binder has open) | `add_gm_blocks`, `update_gm_block`, `delete_gm_block` |
| `get_scenario_outline` (start here) | `update_gm_page`, `delete_gm_page` |
| `get_section` | `set_entity_note` |
| `get_npc` | `add_custom_npc`, `update_npc` |
| `get_encounter` | `create_encounter`, `add_combatants`, `prefill_encounters` |
| `get_gm_page` | `undo_last_change` |
| `search_scenario`, `search_bestiary`, `list_recent_changes` | |

## How edits stay safe

- Every write reads the overlay and its `updated_at`, then calls the `patch_overlay` database function with only the keys it changed. If the app wrote in between, the write is retried against fresh data.
- The app pushes through `put_overlay` in the same way. When it loses a race, it three-way merges using `src/data/merge.js` and pushes again. Typing in a GM notes block while Claude appends to the same page keeps both.
- Each Claude write stores the prior state in `overlay_history`, which keeps the last 50 per scenario. `undo_last_change` applies the inverse of the newest one on top of whatever is there now.

## Trying it

```bash
cd mcp && npm run inspect
```

This opens the MCP Inspector against your real Supabase project.
