export type ListSelectionState = {
  activeId: string;
  selectedIds: readonly string[];
  selectionMode: boolean;
};

/**
 * Active and selected bits only. Selection mode is painted from the list root
 * (`data-list-selection-mode`) so entering multi-select does not re-render every row.
 */
export function listItemHighlightKey(state: ListSelectionState, id: string): string {
  const active = state.activeId === id ? "1" : "0";
  const selected = state.selectedIds.includes(id) ? "1" : "0";
  return `${active}${selected}`;
}

function sameSelectedIds(a: readonly string[], b: readonly string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((id, index) => id === b[index]);
}

export function createListSelectionStore() {
  let state: ListSelectionState = {
    activeId: "",
    selectedIds: [],
    selectionMode: false,
  };
  let version = 0;
  const listeners = new Set<() => void>();

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getState(): ListSelectionState {
      return state;
    },
    getVersion(): number {
      return version;
    },
    highlightKey(id: string): string {
      return listItemHighlightKey(state, id);
    },
    setState(next: ListSelectionState): boolean {
      if (
        state.activeId === next.activeId &&
        state.selectionMode === next.selectionMode &&
        sameSelectedIds(state.selectedIds, next.selectedIds)
      ) {
        return false;
      }
      version += 1;
      state = {
        activeId: next.activeId,
        selectedIds: next.selectedIds,
        selectionMode: next.selectionMode,
      };
      return true;
    },
    notify(): void {
      listeners.forEach((listener) => {
        listener();
      });
    },
  };
}

export type ListSelectionStore = ReturnType<typeof createListSelectionStore>;
