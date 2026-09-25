/* Text renderings of binder data for tool results: compact, readable, and
 * never carrying base64 images. */

const TIER = { "crit-success": "Critical success", success: "Success", fail: "Failure", "crit-fail": "Critical failure" };

// A base scenario content section (array of { t, … } blocks) as markdown.
export function sectionToMarkdown(blocks) {
  const out = [];
  for (const b of blocks || []) {
    switch (b.t) {
      case "h": out.push(`### ${b.x}`); break;
      case "p": out.push(b.x); break;
      case "read": out.push((Array.isArray(b.x) ? b.x : [b.x]).map((x) => `> ${x}`).join("\n>\n")); break;
      case "check":
        out.push([
          `**Check — ${b.action || b.skill}** (${b.skill}${b.dc ? `, DC ${b.dc}` : ""})`,
          ...(b.tiers || []).map((t) => `- *${TIER[t.k] || t.k}:* ${t.x}`),
        ].join("\n"));
        break;
      case "list": out.push((b.items || []).map((x) => `- ${x}`).join("\n")); break;
      case "call": out.push(`**${b.title || b.kind}** — ${b.x}`); break;
      case "loc": out.push(`## ${b.code ? `${b.code}. ` : ""}${b.name}${b.threat ? ` (threat: ${b.threat})` : ""}${b.x ? `\n${b.x}` : ""}`); break;
      case "enc":
        out.push([
          `**Encounter — ${b.area}**${b.die ? ` (${b.die})` : ""}${b.note ? `: ${b.note}` : ""}`,
          ...(b.options || []).map((o) => `- ${o.name}${o.cr ? ` — ${o.cr}` : ""}`),
        ].join("\n"));
        break;
      case "hazard":
        out.push([`**Hazard — ${b.name}**: ${b.x}`, ...(b.dcs || []).map((d) => `- ${d}`)].join("\n"));
        break;
      case "npcs": out.push((b.items || []).map((n) => `- **${n.name}**${n.tag ? ` — ${n.tag}` : ""}`).join("\n")); break;
      default: out.push("```json\n" + JSON.stringify(b) + "\n```");
    }
  }
  return out.join("\n\n");
}

// Plain text of a content block, for search.
export function blockText(b) {
  if (!b || typeof b !== "object") return "";
  return Object.entries(b)
    .filter(([k]) => k !== "t" && k !== "k" && k !== "id" && k !== "type")
    .map(([, v]) => v)
    .flatMap((v) => (typeof v === "string" ? [v] : Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : blockText(x))) : v && typeof v === "object" ? [blockText(v)] : []))
    .join(" ");
}

const isImage = (s) => typeof s === "string" && s.startsWith("data:");

// Drop images and heavy stat block bodies from an encounter for display.
export function slimEncounter(e) {
  if (!e) return e;
  const { map, ...rest } = e;
  const out = { ...rest };
  if (map) out.map = isImage(map) ? "(map image)" : map;
  if (Array.isArray(e.creatures)) out.creatures = e.creatures.map(slimCreature);
  if (Array.isArray(e.combatants)) out.combatants = e.combatants.map(slimCreature);
  return out;
}
function slimCreature(c) {
  const { statBlock, ...rest } = c;
  if (statBlock === null) return { ...rest, statBlock: "(cleared)" };
  if (statBlock) return { ...rest, statBlock: "(has stat block)" };
  return rest;
}

// A GM notes page with its forks' titles.
export function describePage(page, pages) {
  const forks = pages.filter((p) => p.group === "fork" && p.parentId === page.id).map((p) => ({ id: p.id, title: p.title }));
  return { ...page, ...(forks.length ? { forks } : {}) };
}

export const json = (x) => JSON.stringify(x, null, 1);
export const text = (s) => ({ content: [{ type: "text", text: s }] });
