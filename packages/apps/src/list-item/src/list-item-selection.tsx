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
  const selectionChanged = store.setState({ activeId, selectedIds, selectionMode });
  useLayoutEffect(() => {
    if (selectionChanged) store.notify();
  }, [selectionChanged, store]);
  return (
    <ListSelectionStoreContext.Provider value={store}>
      {children}
    </ListSelectionStoreContext.Provider>
  );
}

export function useListItemHighlight(
  id: string,
  fallback: { isActive: boolean; isSelected: boolean; selectionMode: boolean },
): { isActive: boolean; isSelected: boolean; selectionMode: boolean } {
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
    selectionMode: key.charAt(2) === "1",
  };
}

function subscribeNoop(): () => void {
  return () => undefined;
}
