/* ==================================================================== *
 *  useAonIndex
 *
 *  Loads the Archives of Nethys name index and re-renders once it lands.
 *  AonLink reads the cached index at render time instead of subscribing,
 *  so one call to this hook somewhere above a group of links is what
 *  upgrades them all from search fallbacks to deep links.
 *
 *  Its own file because aonlink.jsx exports a component, and react-refresh
 *  wants component and non-component exports kept apart.
 * ==================================================================== */
import { useEffect, useState } from "react";
import { loadAonIndex, cachedAonIndex } from "../lib/aon.js";

export function useAonIndex() {
  const [idx, setIdx] = useState(cachedAonIndex);
  useEffect(() => {
    if (!idx) loadAonIndex().then(setIdx);
  }, [idx]);
  return idx;
}
