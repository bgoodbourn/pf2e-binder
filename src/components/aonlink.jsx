/* ==================================================================== *
 *  Archives of Nethys link
 *
 *  Wraps a name from a character sheet in a link to its AoN page. The
 *  href is resolved from src/lib/aon.js, which always yields something —
 *  a deep link when the name is in the index, an AoN search for that name
 *  when it isn't (or before the index has finished loading).
 *
 *  AonLink reads the cached index at render time rather than subscribing
 *  to it, so a parent must call useAonIndex() once to force the re-render
 *  that upgrades search fallbacks into deep links. Sheet does this.
 * ==================================================================== */
import { aonUrl, aonLookup } from "../lib/aon.js";

/* `exact` suppresses the search fallback: use it for names that are the
 * player's own words (a pet's name), where a search would only ever be noise. */
export function AonLink({ kind, name, cls, className = "alink", exact = false, children }) {
  if (!name) return null;
  const href = exact ? aonLookup(kind, name, { cls }) : aonUrl(kind, name, { cls });
  const label = children ?? name;
  if (!href) return label;
  return (
    <a className={className} href={href} target="_blank" rel="noopener noreferrer" title="open in Archives of Nethys">
      {label}
    </a>
  );
}
