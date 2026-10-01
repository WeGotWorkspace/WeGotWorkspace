import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  createListSelectionStore,
  type ListSelectionState,
  type ListSelectionStore,
} from "@/list-item/src/list-item-selection-store";

const ListSelectionStoreContext = createContext<ListSelectionStore | null>(null);

export type ListSelectionProviderProps = ListSelectionState & {
  children: ReactNode;
};

/** Pushes selection into an external store so only rows whose highlight key changes re-render. */
export function ListSelectionProvider({
  activeId,
  selectedIds,
  selectionMode,
  children,
}: ListSelectionProviderProps) {
  const storeRef = useRef<ListSelectionStore | null>(null);
  if (!storeRef.current) storeRef.current = createListSelectionStore();
  const store = storeRef.current;
  // Version, not a boolean: consecutive selection updates all return true, and a
  // boolean dep would notify only the first one. Memoized rows would stay stale.
  store.setState({ activeId, selectedIds, selectionMode });
  const version = store.getVersion();
  useLayoutEffect(() => {
    store.notify();
  }, [version, store]);
  return (
    <ListSelectionStoreContext.Provider value={store}>
      {children}
    </ListSelectionStoreContext.Provider>
  );
}

export type ListItemHighlight = {
  isActive: boolean;
  isSelected: boolean;
};

/**
 * Active and selected state for one row. Selection mode is not part of this
 * snapshot: inside a provider the list root owns it, and outside it the row
 * prop does.
 */
export function useListItemHighlight(id: string, fallback: ListItemHighlight): ListItemHighlight {
  const store = useContext(ListSelectionStoreContext);
  const key = useSyncExternalStore(
    store ? store.subscribe : subscribeNoop,
    () => (store ? store.highlightKey(id) : ""),
    () => "",
  );
  if (!store) return fallback;
  return {
    isActive: key.charAt(0) === "1",
    isSelected: key.charAt(1) === "1",
  };
}

/** True when this row is painted by `ListSelectionProvider` rather than its own props. */
export function useHasListSelectionStore(): boolean {
  return useContext(ListSelectionStoreContext) != null;
}

function subscribeNoop(): () => void {
  return () => undefined;
}
