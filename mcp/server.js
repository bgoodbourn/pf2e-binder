#!/usr/bin/env node
/* ==================================================================== *
 *  PF2e binder — local MCP server
 *
 *  Lets Claude (Desktop or Code, over stdio) read the binder's scenarios and
 *  write into the GM's own layer of it: GM notes pages, NPC / PC notes,
 *  custom NPCs and NPC text edits, and initiative-tracker encounters.
 *  Talks to the same Supabase project as the app; an open binder tab picks
 *  Claude's edits up live over realtime.
 *
 *  Run:  node --env-file=/path/to/pf2e-binder/.env mcp/server.js
 * ==================================================================== */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerReadTools } from "./tools/read.js";
import { registerWriteTools } from "./tools/write.js";

const instructions = `
Tools for a Pathfinder 2e GM's "campaign binder" web app.

Data model:
- A scenario is a published adventure (read-only here): sections of text, an NPC roster, encounters, maps.
- On top of it the GM keeps their own layer, which these tools can edit:
  - GM notes pages: ordered pages of blocks (heading, paragraph, read-aloud, skill check, q&a, links, live note). A "fork" page is an alternate branch under a main page.
  - Private notes on NPCs and PCs.
  - Custom NPCs, and edits to a scenario NPC's description or notes.
  - Initiative-tracker encounters and their combatants.

How to work:
- If the GM says "this page", "here" or doesn't name a scenario, call get_current_view first.
- Call get_scenario_outline to learn a scenario's ids before reading or writing.
- Block text is plain text: markdown is not rendered in GM notes blocks.
- Every write shows up live in the binder and is recorded. undo_last_change reverts the most recent one, and list_recent_changes shows the history.
- Prefer adding to the GM's notes over rewriting what they wrote, unless asked.
`.trim();

const server = new McpServer({ name: "pf2e-binder", version: "0.1.0" }, { instructions });
registerReadTools(server);
registerWriteTools(server);

await server.connect(new StdioServerTransport());
