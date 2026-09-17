export type ListSelectionState = {
  activeId: string;
  selectedIds: readonly string[];
  selectionMode: boolean;
};

export function listItemHighlightKey(state: ListSelectionState, id: string): string {
  const active = state.activeId === id ? "1" : "0";
  const selected = state.selectedIds.includes(id) ? "1" : "0";
  const mode = state.selectionMode ? "1" : "0";
  return `${active}${selected}${mode}`;
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
