import { createContext, useContext } from "react";

/** Parent list owns click / drag / long-press — rows must not attach those listeners. */
export const ListItemEventDelegationContext = createContext(false);

export function useListItemEventDelegation(): boolean {
  return useContext(ListItemEventDelegationContext);
}
