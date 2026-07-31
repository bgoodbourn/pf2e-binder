/* ==================================================================== *
 *  useCompanions
 *
 *  Loads the animal-companion base stat blocks and re-renders once they
 *  land, so a companion block can go from "just what Pathbuilder told us"
 *  to a derived stat block without the caller managing the promise.
 *
 *  Its own file for the same reason as useAonIndex: react-refresh wants
 *  component and non-component exports kept apart.
 * ==================================================================== */
import { useEffect, useState } from "react";
import { loadCompanions, cachedCompanions } from "../lib/companions.js";

export function useCompanions() {
  const [data, setData] = useState(cachedCompanions);
  useEffect(() => {
    if (!data) loadCompanions().then(setData);
  }, [data]);
  return data;
}
