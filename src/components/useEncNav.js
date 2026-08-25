/* Shared plumbing between the encounter rail's mini initiative order and the
 * combatant list it navigates. The rail lives in App's <nav> and the list lives
 * inside EncountersView, so they meet here: the view registers its scroll
 * container and each row element, the rail reads visibility off them and calls
 * back to jump. Provider and rail UI live in encrail.jsx. */
import { createContext, useContext } from "react";

export const EncNavContext = createContext(null);

export function useEncNav() {
  return useContext(EncNavContext);
}
