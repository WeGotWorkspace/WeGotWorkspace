import { createContext, useContext } from "react";

export type ListItemEventDelegation = {
  /** A row started swiping: drop the pending long press (the swipe stops its touchmove). */
  cancelPress: () => void;
};

/** Parent list owns click / drag / long-press — rows must not attach those listeners. */
export const ListItemEventDelegationContext = createContext<ListItemEventDelegation | null>(null);

export function useListItemEventDelegation(): boolean {
  return useContext(ListItemEventDelegationContext) !== null;
}

const noop = () => {};

/** Cancels the list's pending long press; a no-op when the row handles its own events. */
export function useCancelDelegatedPress(): () => void {
  return useContext(ListItemEventDelegationContext)?.cancelPress ?? noop;
}
